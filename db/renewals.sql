-- Renovaciones: las casillas abiertas del Figma (sección 3).
--   "¿Cómo pide el dealer la renovación al distribuidor?" -> renewal_requests
--   "¿Cómo se entera Wingtra?"                            -> outbox, visible para Wingtra
--   "¿Cómo se refleja en Odoo?"                           -> dispatcher -> pedido en Odoo (simulado)
--
-- Flujo: dealer pide (pending) -> distribuidor aprueba (approved, y en la MISMA
-- transacción un evento en el outbox) -> el dispatcher crea el pedido en Odoo y
-- marca la solicitud como ordered y extiende la licencia.

-- El distribuidor del tenant actual. SECURITY DEFINER por el mismo motivo que
-- visible_tenants(): la política necesita leer el árbol completo.
CREATE FUNCTION current_parent() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT parent_id FROM tenants WHERE id = current_tenant();
$$;

CREATE TABLE renewal_requests (
  id             SERIAL PRIMARY KEY,
  licence_code   TEXT NOT NULL REFERENCES licences(code),
  dealer_id      TEXT NOT NULL REFERENCES tenants(id),
  distributor_id TEXT NOT NULL REFERENCES tenants(id),
  customer_id    TEXT NULL REFERENCES customers(id),
  -- La caducidad que esta solicitud renueva, congelada al pedir. Sin ella no
  -- se puede medir la antelación: al renovar, licences.expires_on cambia y el
  -- dato se pierde. Lo pidió la capa de análisis (DECISIONS.md, punto 14).
  expires_on_at_request DATE NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'rejected', 'ordered')),
  odoo_order_ref TEXT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at     TIMESTAMPTZ NULL,
  decided_by     TEXT NULL
);

-- Una sola solicitud abierta por licencia. Es lo que hace que un doble clic en
-- "Renew" no cree dos pedidos: la base lo impide, no el botón.
CREATE UNIQUE INDEX renewal_one_open_per_licence
  ON renewal_requests (licence_code) WHERE status IN ('pending', 'approved');

ALTER TABLE renewal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE renewal_requests FORCE  ROW LEVEL SECURITY;

-- Leer: Wingtra todo; el dealer las suyas; el distribuidor las de sus dealers;
-- el cliente el estado de la renovación de su licencia.
CREATE POLICY renewal_read ON renewal_requests FOR SELECT USING (
  is_platform()
  OR dealer_id IN (SELECT visible_tenants())
  OR customer_id = current_customer()
);

-- Crear: solo un dealer, solo para una licencia suya, dirigida a SU
-- distribuidor y con el cliente real de la licencia. Cada condición cierra un
-- abuso concreto: pedir por licencias ajenas, saltarse al distribuidor o
-- enviar la solicitud a un distribuidor que no es el tuyo.
CREATE POLICY renewal_create ON renewal_requests FOR INSERT WITH CHECK (
  dealer_id = current_tenant()
  AND distributor_id = current_parent()
  AND status = 'pending'
  AND EXISTS (
    SELECT 1 FROM licences l
    WHERE l.code = licence_code
      AND l.tenant_id = current_tenant()
      AND l.customer_id IS NOT DISTINCT FROM renewal_requests.customer_id
      -- La fecha congelada debe ser la real: si no, un dealer podría maquillar
      -- su antelación en los informes.
      AND l.expires_on = renewal_requests.expires_on_at_request
      AND l.ended_at IS NULL
      -- Solo se piden renovaciones de productos MANUALES. WingtraCARE se
      -- renueva sola y LIDAR es perpetua: una solicitud ahí sería un pedido
      -- duplicado en Odoo.
      AND EXISTS (SELECT 1 FROM products p WHERE p.code = l.product AND p.renewal_mode = 'manual')
  )
);

-- Decidir: solo el distribuidor destinatario, solo mientras está pending, y
-- solo hacia approved o rejected. 'ordered' lo pone el dispatcher, nadie más.
CREATE POLICY renewal_decide ON renewal_requests FOR UPDATE
  USING      (distributor_id = current_tenant() AND status = 'pending')
  WITH CHECK (distributor_id = current_tenant() AND status IN ('approved', 'rejected'));

GRANT SELECT, INSERT ON renewal_requests TO hub_app;
-- Permiso por columna: aunque la política deje actualizar la fila, el
-- distribuidor no puede cambiar a qué licencia o dealer apunta.
GRANT UPDATE (status, decided_at, decided_by) ON renewal_requests TO hub_app;
GRANT USAGE, SELECT ON SEQUENCE renewal_requests_id_seq TO hub_app;

-- ---------------------------------------------------------------------------
-- Outbox. El problema que resuelve es la doble escritura: aprobar en nuestra
-- base y crear el pedido en Odoo son dos sistemas, y una transacción no puede
-- abarcar una llamada HTTP. Si Odoo falla después de aprobar, quedan en
-- desacuerdo. Solución: el evento se guarda en la MISMA transacción que la
-- aprobación (o las dos cosas o ninguna) y un dispatcher lo entrega después.
--
-- Precio que se paga: entrega al menos una vez. El dispatcher puede caerse
-- después de crear el pedido y antes de marcarlo, y reintentar. Por eso Odoo
-- recibe event_id como referencia y no duplica pedidos (ver lib/odoo.ts).
-- ---------------------------------------------------------------------------
CREATE TABLE outbox (
  id           SERIAL PRIMARY KEY,
  event_id     UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  event_type   TEXT NOT NULL,
  payload      JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT NULL,
  -- Eventos que el dispatcher rechaza por no cuadrar con la base (p. ej. la
  -- solicitud no está aprobada). No se reintentan; quedan para revisar.
  discarded_at TIMESTAMPTZ NULL
);
CREATE INDEX outbox_unpublished_idx ON outbox (created_at)
  WHERE published_at IS NULL AND discarded_at IS NULL;

ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox FORCE  ROW LEVEL SECURITY;

-- Nadie de la app escribe en el outbox: solo el trigger de abajo.
--
-- Antes había una política "un partner puede insertar eventos con su propio
-- tenant". En la revisión del 09.10 se comprobó que un dealer podía escribir
-- directamente un evento 'renewal.approved' sin que su distribuidor aprobara
-- nada, y el dispatcher creaba el pedido en Odoo a nombre del distribuidor y
-- extendía la licencia un año. Un evento que dice "aprobado" solo puede
-- nacer de una aprobación real.
CREATE POLICY outbox_read ON outbox FOR SELECT USING (is_platform());
GRANT SELECT ON outbox TO hub_app;

-- Cuando una solicitud pasa de pending a approved, la base escribe el evento
-- en la MISMA transacción, con los datos sacados de la propia base (no de lo
-- que mande la app). SECURITY DEFINER: escribe en una tabla que hub_app no
-- puede tocar.
CREATE FUNCTION enqueue_renewal_approved() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO outbox (tenant_id, event_type, payload)
  SELECT NEW.distributor_id, 'renewal.approved',
         jsonb_build_object(
           'request_id',     NEW.id,
           'licence_code',   NEW.licence_code,
           'product',        l.product,
           'dealer_id',      NEW.dealer_id,
           'distributor_id', NEW.distributor_id)
    FROM licences l
   WHERE l.code = NEW.licence_code;
  RETURN NULL;
END;
$$;

CREATE TRIGGER renewal_approved_to_outbox
  AFTER UPDATE OF status ON renewal_requests
  FOR EACH ROW
  WHEN (OLD.status = 'pending' AND NEW.status = 'approved')
  EXECUTE FUNCTION enqueue_renewal_approved();

-- ---------------------------------------------------------------------------
-- Odoo simulado. En la realidad es otro sistema (XML-RPC/JSON-RPC); aquí es un
-- esquema aparte al que la app no tiene acceso. Solo el dispatcher habla con él.
-- ---------------------------------------------------------------------------
CREATE SCHEMA odoo;

CREATE TABLE odoo.sale_orders (
  id           SERIAL PRIMARY KEY,
  name         TEXT NULL,               -- 'S00001', como numera Odoo
  client_ref   TEXT NOT NULL UNIQUE,    -- = event_id: la clave de idempotencia
  partner      TEXT NOT NULL,           -- el distribuidor, que es quien compra a Wingtra
  product      TEXT NOT NULL,
  licence_code TEXT NOT NULL,
  state        TEXT NOT NULL DEFAULT 'sale',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Interruptor para la demo: "Odoo caído".
CREATE TABLE odoo.settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  down      BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO odoo.settings DEFAULT VALUES;

-- El dispatcher es infraestructura, no un partner: ve los eventos de todos.
DROP ROLE IF EXISTS hub_dispatcher;
CREATE ROLE hub_dispatcher LOGIN PASSWORD 'hub_dispatcher' BYPASSRLS;
GRANT SELECT, UPDATE ON outbox TO hub_dispatcher;
GRANT SELECT, UPDATE (status, odoo_order_ref) ON renewal_requests TO hub_dispatcher;
GRANT SELECT, UPDATE (expires_on) ON licences TO hub_dispatcher;
GRANT SELECT ON products TO hub_dispatcher;
GRANT USAGE ON SCHEMA odoo TO hub_dispatcher;
GRANT SELECT, INSERT, UPDATE ON odoo.sale_orders TO hub_dispatcher;
GRANT SELECT, UPDATE ON odoo.settings TO hub_dispatcher;
GRANT USAGE, SELECT ON SEQUENCE odoo.sale_orders_id_seq TO hub_dispatcher;
