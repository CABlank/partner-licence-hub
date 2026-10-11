-- Historia SIMULADA para la capa de análisis. Nada de esto son datos de Wingtra.
--
-- La demo tiene 5 licencias: suficiente para enseñar permisos, no para medir
-- nada. Esto genera ~3 años de una red inventada (3 distribuidores, 9 dealers)
-- en otra base, licence_hub_sim, con el mismo esquema. Determinista: misma
-- semilla, mismos datos, así los números del caso de estudio no cambian.
--
-- Supuestos deliberados (para que haya algo que descubrir, no "verdades"):
--   - Iberia renueva más y aprueba rápido; Nordic renueva menos y tarda más.
--   - ~15 % de las renovaciones se piden tarde, con la licencia ya caducada.
--   - Cada producto sigue su mecánica real (tabla products): PRO y UNLIMITED
--     se renuevan a mano; WingtraCARE se renueva sola (~12 % se da de baja);
--     LIDAR es perpetua y solo "caducan" sus 3 años de actualizaciones.
--   - Un dron se compra con su PRO (y a veces LIDAR y CARE) el mismo día.
--     UNLIMITED llega después, de 2 a 18 meses más tarde: es una ampliación.
--     Un cliente compra su primer dron y los siguientes en los 18 meses
--     siguientes. (Antes cada licencia empezaba en una fecha al azar: cada
--     cliente parecía estar comprando siempre y el NRR salía inflado.)

SELECT setseed(0.42);

TRUNCATE drone_events, transfer_requests, renewal_requests, outbox, odoo.sale_orders,
         leads, licences, drones, customers, tenants RESTART IDENTITY CASCADE;

INSERT INTO tenants (id, name, kind, parent_id) VALUES
  ('iberia', 'Iberia Distribution', 'distributor', NULL),
  ('nordic', 'Nordic Distribution', 'distributor', NULL),
  ('dach',   'DACH Distribution',   'distributor', NULL),
  ('dealer-valencia',  'Dealer Valencia',  'dealer', 'iberia'),
  ('dealer-barcelona', 'Dealer Barcelona', 'dealer', 'iberia'),
  ('dealer-madrid',    'Dealer Madrid',    'dealer', 'iberia'),
  ('dealer-lisboa',    'Dealer Lisboa',    'dealer', 'iberia'),
  ('dealer-oslo',      'Dealer Oslo',      'dealer', 'nordic'),
  ('dealer-stockholm', 'Dealer Stockholm', 'dealer', 'nordic'),
  ('dealer-zurich',    'Dealer Zurich',    'dealer', 'dach'),
  ('dealer-munich',    'Dealer Munich',    'dealer', 'dach'),
  ('dealer-vienna',    'Dealer Vienna',    'dealer', 'dach'),
  ('survey-leads',     'Survey Leads',     'referral', 'iberia');

-- Parámetros de comportamiento por distribuidor (los "supuestos" de arriba).
CREATE TEMP TABLE sim_params (distributor TEXT PRIMARY KEY, p_renew FLOAT, approval_hours FLOAT);
INSERT INTO sim_params VALUES ('iberia', 0.86, 18), ('nordic', 0.70, 72), ('dach', 0.80, 30);

-- 140 clientes repartidos entre los dealers.
INSERT INTO customers (id, name, dealer_id)
SELECT 'cust-' || lpad(g::text, 3, '0'),
       'Customer ' || lpad(g::text, 3, '0'),
       (ARRAY['dealer-valencia','dealer-barcelona','dealer-madrid','dealer-lisboa',
              'dealer-oslo','dealer-stockholm','dealer-zurich','dealer-munich','dealer-vienna'])[1 + floor(random() * 9)::int]
FROM generate_series(1, 140) AS g;

-- 1 a 3 drones por cliente.
INSERT INTO drones (serial, model, owner_tenant_id, customer_id)
SELECT 'WG-' || lpad((30000 + row_number() OVER ())::text, 5, '0'),
       CASE WHEN random() < 0.6 THEN 'WingtraRAY' ELSE 'WingtraOne' END,
       c.dealer_id, c.id
FROM customers c
CROSS JOIN LATERAL generate_series(1, 1 + floor(random() * 3)::int) AS n;

-- Cuándo se compró cada dron: el primero cuando el cliente llega, el resto
-- en los 18 meses siguientes. Nada después del 15.09.2026.
CREATE TEMP TABLE sim_drone_bought AS
WITH c AS (
  SELECT id, DATE '2023-06-01' + floor(random() * (DATE '2026-09-15' - DATE '2023-06-01'))::int AS joined_on
  FROM customers ORDER BY id
)
SELECT d.serial,
       least(DATE '2026-09-15',
             c.joined_on + CASE WHEN row_number() OVER (PARTITION BY d.customer_id ORDER BY d.serial) = 1 THEN 0
                                ELSE floor(random() * 540)::int END) AS bought_on
FROM drones d JOIN c ON c.id = d.customer_id
ORDER BY d.serial;

-- Licencias, término a término. Cada fila de licences es el término ACTUAL;
-- la historia de renovaciones va a renewal_requests.
DO $$
DECLARE
  d RECORD;
  prm RECORD;
  lic_seq INT := 0;
  order_seq INT := 0;
  product TEXT;
  term_years INT;
  start_d DATE;
  end_d DATE;
  lead_days INT;
  req_at TIMESTAMPTZ;
  dec_at TIMESTAMPTZ;
  today DATE := CURRENT_DATE;
  products TEXT[];
  mode TEXT;
BEGIN
  FOR d IN
    SELECT dr.serial, dr.owner_tenant_id AS dealer, dr.customer_id, t.parent_id AS distributor, b.bought_on
    FROM drones dr JOIN tenants t ON t.id = dr.owner_tenant_id
    JOIN sim_drone_bought b ON b.serial = dr.serial
    ORDER BY dr.serial
  LOOP
    SELECT * INTO prm FROM sim_params WHERE distributor = d.distributor;
    products := ARRAY[CASE WHEN random() < 0.75 THEN 'pro_1y' ELSE 'pro_3y' END];
    IF random() < 0.30 THEN products := array_append(products, 'lidar'); END IF;
    IF random() < 0.40 THEN products := array_append(products, 'unlimited_1y'); END IF;
    IF random() < 0.50 THEN products := array_append(products, 'care'); END IF;

    FOREACH product IN ARRAY products LOOP
      lic_seq := lic_seq + 1;
      SELECT p.term_years, p.renewal_mode INTO term_years, mode FROM products p WHERE p.code = product;
      start_d := d.bought_on;
      IF product = 'unlimited_1y' THEN
        start_d := start_d + 60 + floor(random() * 480)::int;
        CONTINUE WHEN start_d > DATE '2026-09-15';  -- todavía no ha ampliado
      END IF;
      -- La licencia va PRIMERO (las renovaciones la referencian con FK); sus
      -- fechas definitivas se ponen al terminar el bucle.
      INSERT INTO licences (code, product, drone_serial, tenant_id, customer_id, starts_on, expires_on)
      VALUES ('SL-' || lpad(lic_seq::text, 4, '0'), product,
              d.serial,
              d.dealer, d.customer_id, start_d, start_d + 1);

      LOOP
        end_d := (start_d + make_interval(years => term_years))::date;
        EXIT WHEN end_d > today;  -- término en curso

        -- Perpetua: no se renueva nada; en end_d acaban las actualizaciones.
        EXIT WHEN mode = 'perpetual';
        -- Automática: se renueva sola salvo baja. Sin solicitud ni pedido manual.
        IF mode = 'auto' THEN
          EXIT WHEN random() < 0.12;  -- el cliente se dio de baja
          start_d := end_d;
          CONTINUE;
        END IF;

        IF random() < prm.p_renew THEN
          -- Cuántos días antes de caducar se pide. Negativo = tarde (~15 %).
          lead_days := CASE WHEN random() < 0.15 THEN -(1 + floor(random() * 20)::int)
                            ELSE 3 + floor(random() * 70)::int END;
          req_at := (end_d - lead_days)::timestamptz + make_interval(hours => 8 + floor(random() * 9)::int);
          EXIT WHEN req_at > now();  -- caducó y nadie ha pedido todavía
          dec_at := req_at + make_interval(secs => (prm.approval_hours * -ln(1 - random()) * 3600)::int);

          IF dec_at > now() THEN
            INSERT INTO renewal_requests (licence_code, dealer_id, distributor_id, customer_id, expires_on_at_request, status, created_at)
            VALUES ('SL-' || lpad(lic_seq::text, 4, '0'), d.dealer, d.distributor, d.customer_id, end_d, 'pending', req_at);
            EXIT;
          END IF;

          order_seq := order_seq + 1;
          INSERT INTO renewal_requests
            (licence_code, dealer_id, distributor_id, customer_id, expires_on_at_request, status, odoo_order_ref, created_at, decided_at, decided_by)
          VALUES ('SL-' || lpad(lic_seq::text, 4, '0'), d.dealer, d.distributor, d.customer_id, end_d, 'ordered',
                  'S' || lpad(order_seq::text, 5, '0'), req_at, dec_at, d.distributor);
          start_d := greatest(end_d, dec_at::date);
        ELSE
          IF random() < 0.25 THEN  -- a veces se pide y el distribuidor lo rechaza
            req_at := (end_d - 10)::timestamptz;
            INSERT INTO renewal_requests
              (licence_code, dealer_id, distributor_id, customer_id, expires_on_at_request, status, created_at, decided_at, decided_by)
            VALUES ('SL-' || lpad(lic_seq::text, 4, '0'), d.dealer, d.distributor, d.customer_id, end_d, 'rejected',
                    req_at, req_at + interval '1 day', d.distributor);
          END IF;
          EXIT;  -- no renovó: la licencia queda caducada
        END IF;
      END LOOP;

      UPDATE licences SET starts_on = start_d, expires_on = end_d
       WHERE code = 'SL-' || lpad(lic_seq::text, 4, '0');
    END LOOP;
  END LOOP;
END $$;

-- Algunas licencias que caducan en los próximos 60 días ya tienen la solicitud en marcha.
INSERT INTO renewal_requests (licence_code, dealer_id, distributor_id, customer_id, expires_on_at_request, status, created_at)
SELECT l.code, l.tenant_id, t.parent_id, l.customer_id, l.expires_on, 'pending', now() - make_interval(days => floor(random() * 4)::int)
FROM licences l JOIN tenants t ON t.id = l.tenant_id
WHERE l.expires_on BETWEEN CURRENT_DATE AND CURRENT_DATE + 60
  AND random() < 0.4
  AND NOT EXISTS (SELECT 1 FROM renewal_requests r WHERE r.licence_code = l.code AND r.status = 'pending');

-- Transferencias de los últimos 11 meses: quién decidió y cuánto tardó.
DO $$
DECLARE
  i INT;
  dr RECORD;
  target TEXT;
  created TIMESTAMPTZ;
  r FLOAT;
  status_v TEXT;
  decided TIMESTAMPTZ;
  decider TEXT;
BEGIN
  FOR i IN 1..60 LOOP
    SELECT d.serial, d.owner_tenant_id, t.parent_id INTO dr
    FROM drones d JOIN tenants t ON t.id = d.owner_tenant_id
    ORDER BY random() LIMIT 1;

    -- 70 % a un dealer del mismo distribuidor.
    SELECT id INTO target FROM tenants
    WHERE kind = 'dealer' AND id <> dr.owner_tenant_id
      AND (random() < 0.7) = (parent_id = dr.parent_id)
    ORDER BY random() LIMIT 1;
    IF target IS NULL THEN
      SELECT id INTO target FROM tenants WHERE kind = 'dealer' AND id <> dr.owner_tenant_id ORDER BY random() LIMIT 1;
    END IF;

    created := now() - make_interval(days => floor(random() * 330)::int, hours => floor(random() * 24)::int);
    r := random();
    IF created > now() - interval '5 days' AND r > 0.5 THEN
      status_v := 'pending'; decided := NULL; decider := NULL;
    ELSIF r < 0.55 THEN
      status_v := 'approved'; decider := dr.owner_tenant_id;
      decided := created + make_interval(secs => (6 + random() * 60)::int * 3600);
    ELSIF r < 0.75 THEN
      status_v := 'approved'; decider := dr.parent_id;
      decided := created + make_interval(secs => (24 + random() * 72)::int * 3600);
    ELSIF r < 0.85 THEN
      status_v := 'rejected'; decider := dr.owner_tenant_id;
      decided := created + make_interval(secs => (4 + random() * 48)::int * 3600);
    ELSE
      status_v := 'approved'; decider := 'wingtra-support';
      decided := created + make_interval(secs => (120 + random() * 96)::int * 3600);
    END IF;

    INSERT INTO transfer_requests (drone_serial, from_tenant_id, to_tenant_id, reason, status, created_at, due_at, decided_at, decided_by)
    VALUES (dr.serial, dr.owner_tenant_id, target, 'Simulated: customer moved to another dealer.',
            status_v, created, created + interval '5 days', decided, decider)
    ON CONFLICT DO NOTHING;  -- un dron repetido con otra solicitud abierta: se omite
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Telemetría SIMULADA: uso mensual por dron (vuelos, datos subidos, procesados
-- en la nube o fuera). En producción vendría del cloud de Wingtra, no del
-- portal; por eso vive en otro esquema (telemetry), como otra fuente.
--
-- Supuestos deliberados, para que el motor de renovaciones tenga algo que
-- descubrir y para que el backtest pueda fallar:
--   - El 70 % de los drones que pierden su PRO vuela mucho menos en los 5 meses
--     de antes y procesa más fuera (Pix4D). El otro 30 % se va sin avisar.
--   - Los que compran UNLIMITED suben el doble de datos en los 6 meses de antes.
--   - Invierno: Nordic vuela al 40 %, el resto al 75 %. Un bajón no es siempre
--     una baja; el motor tiene que convivir con ese ruido.
-- ---------------------------------------------------------------------------
DROP SCHEMA IF EXISTS telemetry CASCADE;
CREATE SCHEMA telemetry;

CREATE TABLE telemetry.drone_usage_monthly (
  drone_serial  TEXT    NOT NULL REFERENCES drones(serial),
  month         DATE    NOT NULL,
  flights       INT     NOT NULL CHECK (flights >= 0),
  data_gb       NUMERIC NOT NULL CHECK (data_gb >= 0),
  cloud_jobs    INT     NOT NULL CHECK (cloud_jobs >= 0),
  external_jobs INT     NOT NULL CHECK (external_jobs >= 0),
  PRIMARY KEY (drone_serial, month)
);

-- Primer término de cada licencia: las renovaciones guardan qué caducidad
-- cerraron, así que el primer inicio es la primera caducidad menos el plazo.
CREATE TEMP TABLE sim_licence_first AS
SELECT l.code, l.drone_serial, l.product, p.renewal_mode,
       least(l.starts_on,
             (SELECT (min(r.expires_on_at_request) - make_interval(years => p.term_years))::date
                FROM renewal_requests r
               WHERE r.licence_code = l.code AND r.status = 'ordered')) AS first_start,
       l.expires_on,
       -- Perdida = caducada sin solicitud viva para ese término.
       l.expires_on < CURRENT_DATE AND NOT EXISTS (
         SELECT 1 FROM renewal_requests r
          WHERE r.licence_code = l.code AND r.status IN ('pending', 'approved')
            AND r.expires_on_at_request = l.expires_on) AS lapsed
FROM licences l JOIN products p ON p.code = l.product
WHERE l.customer_id IS NOT NULL;

CREATE TEMP TABLE sim_drone_profile AS
SELECT d.serial,
       t.parent_id                                                       AS distributor,
       date_trunc('month', min(f.first_start))::date                     AS first_month,
       min(f.expires_on) FILTER (WHERE f.product IN ('pro_1y', 'pro_3y') AND f.lapsed) AS pro_lapsed_on,
       min(f.first_start) FILTER (WHERE f.product = 'unlimited_1y')      AS unlimited_from,
       4 + random() * 10                                                 AS flights_per_month,
       1 + random() * 3                                                  AS gb_per_flight,
       random() * 0.3                                                    AS external_share,
       random() < 0.7                                                    AS warns_before_leaving
FROM drones d
JOIN tenants t ON t.id = d.owner_tenant_id
JOIN sim_licence_first f ON f.drone_serial = d.serial
GROUP BY d.serial, t.parent_id
ORDER BY d.serial;

INSERT INTO telemetry.drone_usage_monthly
SELECT serial, month, flights,
       round((flights * gb_per_flight * storage_factor)::numeric, 1),
       round(flights * 0.8 * (1 - ext))::int,
       round(flights * 0.8 * ext)::int
FROM (
  SELECT p.serial, m::date AS month, p.gb_per_flight,
         round(p.flights_per_month
           * CASE WHEN extract(month FROM m) IN (12, 1, 2)
                  THEN CASE p.distributor WHEN 'nordic' THEN 0.4 ELSE 0.75 END
                  ELSE 1 END
           * CASE WHEN p.pro_lapsed_on IS NULL                  THEN 1
                  WHEN m >= p.pro_lapsed_on                     THEN 0.05  -- se queda en ESSENTIAL
                  WHEN p.warns_before_leaving
                   AND m >= p.pro_lapsed_on - 150               THEN 0.3
                  ELSE 1 END
           * (0.6 + 0.8 * random()))::int                                   AS flights,
         CASE WHEN p.unlimited_from IS NULL                     THEN 1
              WHEN m >= p.unlimited_from - 180                  THEN 2.5
              ELSE 1 END                                                    AS storage_factor,
         least(0.95, p.external_share
           + CASE WHEN p.warns_before_leaving AND p.pro_lapsed_on IS NOT NULL
                   AND m >= p.pro_lapsed_on - 150               THEN 0.4
                  ELSE 0 END)                                               AS ext
  FROM sim_drone_profile p
  -- Hasta el último mes CERRADO: el mes en curso todavía no tiene datos completos.
  CROSS JOIN generate_series(p.first_month, date_trunc('month', CURRENT_DATE) - interval '1 month',
                             interval '1 month') AS m
  ORDER BY p.serial, m
) u;

GRANT USAGE ON SCHEMA telemetry TO hub_analytics;
GRANT SELECT ON ALL TABLES IN SCHEMA telemetry TO hub_analytics;
