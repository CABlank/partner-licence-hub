-- Partner Licence Hub: esquema y reglas de acceso.
-- Diseño de partida: tablero Figma "Wingtra", sección 4 (quién ve qué).
--
-- La app se conecta como hub_app, un rol normal. Un superusuario o el dueño de
-- la tabla se saltan RLS, y los tests pasarían por la razón equivocada.

DROP ROLE IF EXISTS hub_app;
CREATE ROLE hub_app LOGIN PASSWORD 'hub_app';

-- ---------------------------------------------------------------------------
-- Quién es quién.
-- ---------------------------------------------------------------------------

-- Partners: distribuidores, dealers y referral partners. Wingtra NO está aquí:
-- si fuera el padre de todos, heredaría por accidente cualquier regla de
-- "padre ve a hijos". Wingtra es un tipo de sesión aparte (ver is_platform).
CREATE TABLE tenants (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  kind      TEXT NOT NULL CHECK (kind IN ('distributor', 'dealer', 'referral')),
  parent_id TEXT NULL REFERENCES tenants(id),
  -- Un dealer o referral siempre cuelga de un distribuidor; un distribuidor de nadie.
  CHECK ((kind = 'distributor') = (parent_id IS NULL))
);

-- El cliente final tampoco está en el árbol de partners: es cliente DE un dealer.
CREATE TABLE customers (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  dealer_id TEXT NOT NULL REFERENCES tenants(id)
);

CREATE TABLE drones (
  serial          TEXT PRIMARY KEY,
  model           TEXT NOT NULL,
  -- El partner que lo configuró. Es la columna del conflicto de la sección 2:
  -- si otro partner intenta configurarlo, hoy decide soporte a mano.
  owner_tenant_id TEXT NOT NULL REFERENCES tenants(id),
  customer_id     TEXT NULL REFERENCES customers(id)
);

-- El catálogo, como DATOS y no como código. Wingtra tiene cuatro mecánicas de
-- licencia distintas (ver entrevistas/wingtra-gtm-junior/negocio-a-fondo.md):
--   manual    -> suscripción que alguien tiene que renovar (WingtraPRO, UNLIMITED)
--   auto      -> se renueva sola salvo baja; avisos a 90/60/30 días (WingtraCARE)
--   perpetual -> funciona para siempre; lo que caduca son las actualizaciones (LIDAR)
-- y no todas viajan con el dron cuando se revende (WingtraCARE no). Si Wingtra
-- renombra o añade un plan, se cambia una fila, no la app.
CREATE TABLE products (
  code          TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  anchor        TEXT NOT NULL CHECK (anchor IN ('drone', 'payload', 'account')),
  renewal_mode  TEXT NOT NULL CHECK (renewal_mode IN ('manual', 'auto', 'perpetual')),
  term_years    INT  NOT NULL CHECK (term_years > 0),
  transferable  BOOLEAN NOT NULL
);

-- Anclajes y "transferable" de PRO y UNLIMITED son supuestos: Wingtra no los
-- publica. Están en las preguntas abiertas de DECISIONS.md.
INSERT INTO products (code, name, anchor, renewal_mode, term_years, transferable) VALUES
  ('pro_1y',       'WingtraPRO · 1 year',                 'drone',   'manual',    1, true),
  ('pro_3y',       'WingtraPRO · 3 years',                'drone',   'manual',    3, true),
  ('unlimited_1y', 'WingtraUNLIMITED · 1 year',           'drone',   'manual',    1, true),
  ('lidar',        'LIDAR · perpetual, 3 years updates',  'payload', 'perpetual', 3, true),
  ('care',         'WingtraCARE · annual',                'drone',   'auto',      1, false);

CREATE TABLE licences (
  code         TEXT PRIMARY KEY,
  product      TEXT NOT NULL REFERENCES products(code),
  drone_serial TEXT NULL REFERENCES drones(serial),
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),   -- el dealer que la vendió
  customer_id  TEXT NULL REFERENCES customers(id),     -- NULL = unidad de demo
  starts_on    DATE NOT NULL,
  expires_on   DATE NOT NULL,
  -- Una licencia que termina antes de tiempo (p. ej. WingtraCARE cuando el
  -- dron cambia de manos). Se conserva la fila para el historial.
  ended_at     DATE NULL,
  ended_reason TEXT NULL,
  CHECK (expires_on > starts_on),
  CHECK ((ended_at IS NULL) = (ended_reason IS NULL))
);
CREATE INDEX licences_tenant_idx   ON licences (tenant_id);
CREATE INDEX licences_customer_idx ON licences (customer_id);

-- El referral partner solo trae clientes: ve el estado de sus leads, nada más.
CREATE TABLE leads (
  id                 SERIAL PRIMARY KEY,
  referral_tenant_id TEXT NOT NULL REFERENCES tenants(id),
  dealer_id          TEXT NULL REFERENCES tenants(id),
  company            TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new', 'contacted', 'demo', 'won', 'lost'))
);

-- ---------------------------------------------------------------------------
-- La sesión. La app declara quién mira al inicio de cada transacción
-- (set_config(..., true) equivale a SET LOCAL). Si no declara nada: NULL, y
-- NULL nunca es TRUE en una política, así que vuelven cero filas. Fail-closed.
-- ---------------------------------------------------------------------------
CREATE FUNCTION current_tenant() RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_tenant', true), '');
$$;

CREATE FUNCTION current_customer() RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_customer', true), '');
$$;

CREATE FUNCTION is_platform() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.actor', true) = 'platform', false);
$$;

-- Partners que el tenant actual puede ver: él mismo y sus hijos directos.
-- SECURITY DEFINER porque tenants también tiene RLS y la política necesita
-- leer el árbol completo para decidir.
CREATE FUNCTION visible_tenants() RETURNS SETOF TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM tenants
  WHERE id = current_tenant() OR parent_id = current_tenant();
$$;

-- ---------------------------------------------------------------------------
-- Políticas.
-- ---------------------------------------------------------------------------
ALTER TABLE licences  ENABLE ROW LEVEL SECURITY;
ALTER TABLE licences  FORCE  ROW LEVEL SECURITY;
ALTER TABLE drones    ENABLE ROW LEVEL SECURITY;
ALTER TABLE drones    FORCE  ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE  ROW LEVEL SECURITY;
ALTER TABLE leads     ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads     FORCE  ROW LEVEL SECURITY;
ALTER TABLE tenants   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants   FORCE  ROW LEVEL SECURITY;

-- Licencias: Wingtra todo; un partner lo suyo y lo de sus dealers; un cliente
-- solo las suyas. Un referral no tiene licencias propias ni hijos: ve cero.
CREATE POLICY licences_read ON licences FOR SELECT USING (
  is_platform()
  OR tenant_id IN (SELECT visible_tenants())
  OR customer_id = current_customer()
);

CREATE POLICY drones_read ON drones FOR SELECT USING (
  is_platform()
  OR owner_tenant_id IN (SELECT visible_tenants())
  OR customer_id = current_customer()
);

CREATE POLICY customers_read ON customers FOR SELECT USING (
  is_platform()
  OR dealer_id IN (SELECT visible_tenants())
  OR id = current_customer()
);

-- Leads: el referral que lo trajo, el dealer asignado y su distribuidor.
CREATE POLICY leads_read ON leads FOR SELECT USING (
  is_platform()
  OR referral_tenant_id = current_tenant()
  OR dealer_id IN (SELECT visible_tenants())
);

CREATE POLICY tenants_read ON tenants FOR SELECT USING (
  is_platform() OR id IN (SELECT visible_tenants())
);

-- SOLO PARA LA DEMO: deja que la cabecera diga "ves X de N licencias". En
-- producción no se expondría el tamaño de la red a un partner.
CREATE FUNCTION demo_network_size() RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*) FROM licences WHERE ended_at IS NULL;
$$;

GRANT SELECT ON tenants, customers, drones, licences, leads, products TO hub_app;
-- Escrituras (renovar, transferir) llegan en la semana 2, cada una con su
-- política WITH CHECK.
