-- Transferencia de dron: la sección 2 del Figma.
--
-- Hoy: un dealer introduce un Drone ID que configuró otro partner -> bloqueado
-- -> email a support@wingtra.com -> una persona decide a mano quién es el dueño.
--
-- Aquí: el dealer pide la transferencia. Decide quien tiene la información:
-- el partner que tiene el dron ahora, o su distribuidor. Soporte solo entra si
-- nadie contesta en 5 días. Todo queda en un historial.

-- ---------------------------------------------------------------------------
-- Comprobar un Drone ID sin ver datos ajenos.
--
-- RLS esconde los drones de otros partners, así que el dealer ni sabría que
-- existe. Esta función responde solo lo necesario: libre, tuyo o de otro
-- partner. Nunca quién es el otro ni su cliente.
-- ---------------------------------------------------------------------------
CREATE FUNCTION drone_claim_status(p_serial TEXT) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN current_tenant() IS NULL THEN 'unknown'
    WHEN d.serial IS NULL THEN 'unknown'
    WHEN d.owner_tenant_id IN (SELECT visible_tenants()) THEN 'yours'
    ELSE 'other_partner'
  END
  FROM (SELECT p_serial) AS input(serial)
  LEFT JOIN drones d ON d.serial = input.serial;
$$;

-- El dueño actual, para rellenar la solicitud. Solo se usa dentro de la
-- política y del INSERT; la app nunca lo muestra al solicitante.
CREATE FUNCTION drone_owner(p_serial TEXT) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT owner_tenant_id FROM drones WHERE serial = p_serial;
$$;

CREATE TABLE transfer_requests (
  id             SERIAL PRIMARY KEY,
  drone_serial   TEXT NOT NULL REFERENCES drones(serial),
  from_tenant_id TEXT NOT NULL REFERENCES tenants(id),
  to_tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  reason         TEXT NOT NULL CHECK (length(reason) BETWEEN 5 AND 500),
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at         TIMESTAMPTZ NOT NULL DEFAULT now() + interval '5 days',
  decided_at     TIMESTAMPTZ NULL,
  decided_by     TEXT NULL,
  CHECK (from_tenant_id <> to_tenant_id)
);

-- Una sola solicitud abierta por dron.
CREATE UNIQUE INDEX transfer_one_open_per_drone
  ON transfer_requests (drone_serial) WHERE status = 'pending';

ALTER TABLE transfer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_requests FORCE  ROW LEVEL SECURITY;

-- Leer: las dos partes y sus distribuidores, y Wingtra.
CREATE POLICY transfer_read ON transfer_requests FOR SELECT USING (
  is_platform()
  OR from_tenant_id IN (SELECT visible_tenants())
  OR to_tenant_id   IN (SELECT visible_tenants())
);

-- El tipo de partner del tenant actual. SECURITY DEFINER: tenants tiene RLS.
CREATE FUNCTION current_tenant_kind() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT kind FROM tenants WHERE id = current_tenant();
$$;

-- Pedir: solo para ti, contra el dueño REAL del dron, y solo si tu tipo de
-- partner puede tener drones. Un referral partner solo trae leads: si pudiera
-- recibir un dron, vería sus licencias (revisión del 09.10: lo conseguía).
CREATE POLICY transfer_create ON transfer_requests FOR INSERT WITH CHECK (
  to_tenant_id = current_tenant()
  AND current_tenant_kind() IN ('dealer', 'distributor')
  AND from_tenant_id = drone_owner(drone_serial)
  AND status = 'pending'
);

GRANT SELECT, INSERT ON transfer_requests TO hub_app;
GRANT USAGE, SELECT ON SEQUENCE transfer_requests_id_seq TO hub_app;
-- Sin UPDATE: decidir solo se puede con decide_transfer(), que comprueba quién
-- decide y mueve el dron y sus licencias en la misma transacción.

-- ---------------------------------------------------------------------------
-- Historial del dron. Lo que hoy vive en un hilo de email de soporte.
-- ---------------------------------------------------------------------------
CREATE TABLE drone_events (
  id             SERIAL PRIMARY KEY,
  drone_serial   TEXT NOT NULL REFERENCES drones(serial),
  event          TEXT NOT NULL,
  licence_code   TEXT NULL REFERENCES licences(code),  -- para 'licence_ended'
  from_tenant_id TEXT NULL REFERENCES tenants(id),
  to_tenant_id   TEXT NULL REFERENCES tenants(id),
  decided_by     TEXT NOT NULL,
  at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE drone_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE drone_events FORCE  ROW LEVEL SECURITY;
CREATE POLICY drone_events_read ON drone_events FOR SELECT USING (
  is_platform()
  OR from_tenant_id IN (SELECT visible_tenants())
  OR to_tenant_id   IN (SELECT visible_tenants())
);
GRANT SELECT ON drone_events TO hub_app;

-- ---------------------------------------------------------------------------
-- Decidir. SECURITY DEFINER porque mueve filas que el que decide no podría
-- tocar (el dron pasa a otro partner). Por eso TODA la autorización está aquí
-- dentro, explícita, y cubierta por tests:
--   - el dueño actual, o
--   - el distribuidor del dueño actual, o
--   - Wingtra (soporte), pero solo si ya venció el plazo de 5 días.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION decide_transfer(p_id INT, p_decision TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r transfer_requests%ROWTYPE;
  owner_parent TEXT;
  decider TEXT;
  allowed BOOLEAN;
BEGIN
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid decision %', p_decision;
  END IF;

  -- FOR UPDATE: dos personas aprobando a la vez no pueden mover el dron dos veces.
  SELECT * INTO r FROM transfer_requests WHERE id = p_id FOR UPDATE;
  SELECT parent_id INTO owner_parent FROM tenants WHERE id = r.from_tenant_id;

  -- coalesce(..., false) en cada comparación: Wingtra no tiene tenant, así que
  -- "from_tenant_id = current_tenant()" da NULL, NOT(NULL) es NULL, y un IF con
  -- NULL NO entra. Sin esto, soporte podía decidir antes de los 5 días: la
  -- comprobación fallaba ABIERTA. Lo encontró el test, no la lectura del código.
  allowed :=
       coalesce(r.from_tenant_id = current_tenant(), false)
    OR coalesce(owner_parent     = current_tenant(), false)
    OR (is_platform() AND coalesce(r.due_at < now(), false));

  -- Nadie decide su propia solicitud. Sin esto, un distribuidor podía pedir el
  -- dron de uno de sus dealers y aprobárselo él mismo como "distribuidor del
  -- dueño", sin que el dealer se enterara (revisión del 09.10).
  allowed := allowed AND coalesce(r.to_tenant_id <> current_tenant(), true);

  IF r.id IS NULL OR r.status <> 'pending' OR NOT allowed THEN
    -- Mismo mensaje para "no existe", "no es tuya" y "ya decidida": no
    -- revelamos qué solicitudes ajenas existen.
    RAISE EXCEPTION 'transfer request % not found or not yours to decide', p_id;
  END IF;

  decider := CASE WHEN is_platform() THEN 'wingtra-support' ELSE current_tenant() END;

  IF p_decision = 'approved' THEN
    -- Una renovación a medias quedaría facturada al dealer anterior. Primero
    -- se cierra, después se transfiere.
    IF EXISTS (
      SELECT 1 FROM renewal_requests rr
      JOIN licences l ON l.code = rr.licence_code
      WHERE l.drone_serial = r.drone_serial AND rr.status IN ('pending', 'approved')
    ) THEN
      RAISE EXCEPTION 'drone % has an open licence renewal; finish it before transferring', r.drone_serial;
    END IF;

    -- No todas las licencias viajan con el dron. WingtraCARE es intransferible
    -- por contrato ("covers only drones registered to the original
    -- subscriber"): termina aquí y queda en el historial. Las demás pasan al
    -- nuevo dealer, sin cliente: lo asigna él.
    INSERT INTO drone_events (drone_serial, event, licence_code, from_tenant_id, to_tenant_id, decided_by)
    SELECT r.drone_serial, 'licence_ended', l.code, r.from_tenant_id, r.to_tenant_id, decider
      FROM licences l JOIN products p ON p.code = l.product
     WHERE l.drone_serial = r.drone_serial AND l.ended_at IS NULL AND NOT p.transferable;

    UPDATE licences l
       SET ended_at = CURRENT_DATE, ended_reason = 'not transferable: drone changed hands'
      FROM products p
     WHERE p.code = l.product AND l.drone_serial = r.drone_serial
       AND l.ended_at IS NULL AND NOT p.transferable;

    UPDATE drones   SET owner_tenant_id = r.to_tenant_id, customer_id = NULL WHERE serial = r.drone_serial;
    UPDATE licences l
       SET tenant_id = r.to_tenant_id, customer_id = NULL
      FROM products p
     WHERE p.code = l.product AND l.drone_serial = r.drone_serial
       AND l.ended_at IS NULL AND p.transferable;
  END IF;

  UPDATE transfer_requests
     SET status = p_decision, decided_at = now(), decided_by = decider
   WHERE id = p_id;

  INSERT INTO drone_events (drone_serial, event, from_tenant_id, to_tenant_id, decided_by)
  VALUES (r.drone_serial, 'transfer_' || p_decision, r.from_tenant_id, r.to_tenant_id, decider);
END;
$$;

REVOKE ALL ON FUNCTION decide_transfer(INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION decide_transfer(INT, TEXT) TO hub_app;
