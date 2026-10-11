-- Datos de ejemplo: exactamente los del Figma, sección 4. Todo inventado.
-- Es una función para que el botón "Reset demo" (reset_demo, en
-- db/demo_reset.sql) siembre exactamente lo mismo que la instalación.
CREATE OR REPLACE FUNCTION seed_demo() RETURNS void LANGUAGE sql AS $seed$
INSERT INTO tenants (id, name, kind, parent_id) VALUES
  ('iberia',           'Iberia Distribution', 'distributor', NULL),
  ('nordic',           'Nordic Distribution', 'distributor', NULL),
  ('dealer-valencia',  'Dealer Valencia',     'dealer',      'iberia'),
  ('dealer-barcelona', 'Dealer Barcelona',    'dealer',      'iberia'),
  ('dealer-oslo',      'Dealer Oslo',         'dealer',      'nordic'),
  ('survey-leads',     'Survey Leads',        'referral',    'iberia');

INSERT INTO customers (id, name, dealer_id) VALUES
  ('ayto-valencia', 'Ayto. de Valencia', 'dealer-valencia'),
  ('terra-survey',  'Terra Survey',      'dealer-valencia'),
  ('minas-del-sur', 'Minas del Sur',     'dealer-barcelona'),
  ('statkraft',     'Statkraft',         'dealer-oslo');

INSERT INTO drones (serial, model, owner_tenant_id, customer_id) VALUES
  ('WG-10042', 'WingtraRAY', 'dealer-valencia',  'ayto-valencia'),
  ('WG-10043', 'WingtraRAY', 'dealer-valencia',  'terra-survey'),
  ('WG-20881', 'WingtraOne', 'dealer-barcelona', 'minas-del-sur'),
  ('WG-20882', 'WingtraOne', 'dealer-barcelona', NULL),
  ('WG-32210', 'WingtraRAY', 'dealer-oslo',      'statkraft');

-- Caducidades repartidas a propósito para el panel de 30/60/90 días, y un
-- producto de cada mecánica: manual (PRO, UNLIMITED), automática (CARE) y
-- perpetua (LIDAR).
INSERT INTO licences (code, product, drone_serial, tenant_id, customer_id, starts_on, expires_on) VALUES
  ('WR-1042', 'pro_1y',       'WG-10042', 'dealer-valencia',  'ayto-valencia', CURRENT_DATE - 340,  CURRENT_DATE + 25),
  ('WR-1043', 'pro_3y',       'WG-10043', 'dealer-valencia',  'terra-survey',  CURRENT_DATE - 1040, CURRENT_DATE + 55),
  ('WC-1042', 'care',         'WG-10042', 'dealer-valencia',  'ayto-valencia', CURRENT_DATE - 325,  CURRENT_DATE + 40),
  ('WO-0881', 'lidar',        'WG-20881', 'dealer-barcelona', 'minas-del-sur', CURRENT_DATE - 1010, CURRENT_DATE + 85),
  ('WC-0881', 'care',         'WG-20881', 'dealer-barcelona', 'minas-del-sur', CURRENT_DATE - 165,  CURRENT_DATE + 200),
  ('WO-0882', 'unlimited_1y', 'WG-20882', 'dealer-barcelona', NULL,            CURRENT_DATE - 100,  CURRENT_DATE + 265),
  ('WR-2210', 'pro_1y',       'WG-32210', 'dealer-oslo',      'statkraft',     CURRENT_DATE - 200,  CURRENT_DATE + 165);

INSERT INTO leads (referral_tenant_id, dealer_id, company, status) VALUES
  ('survey-leads', 'dealer-valencia', 'Topografía Levante', 'demo');
$seed$;
REVOKE EXECUTE ON FUNCTION seed_demo() FROM PUBLIC;
SELECT seed_demo();
