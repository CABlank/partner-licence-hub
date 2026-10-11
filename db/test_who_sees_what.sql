-- La tabla "Ve / No ve" del Figma, convertida en test.
-- Corre como hub_app (nunca como postgres). Si una fila falla, se para con error.
\set ON_ERROR_STOP on

CREATE TEMP TABLE expected (actor TEXT, setting TEXT, value TEXT, codes TEXT[]);
INSERT INTO expected VALUES
  ('Wingtra',             'app.actor',            'platform',        ARRAY['WC-0881','WC-1042','WO-0881','WO-0882','WR-1042','WR-1043','WR-2210']),
  ('Iberia Distribution', 'app.current_tenant',   'iberia',          ARRAY['WC-0881','WC-1042','WO-0881','WO-0882','WR-1042','WR-1043']),
  ('Dealer Valencia',     'app.current_tenant',   'dealer-valencia', ARRAY['WC-1042','WR-1042','WR-1043']),
  ('Ayto. de Valencia',   'app.current_customer', 'ayto-valencia',   ARRAY['WC-1042','WR-1042']),
  ('Survey Leads',        'app.current_tenant',   'survey-leads',    ARRAY[]::TEXT[]),
  ('Sin sesion',          NULL,                   NULL,              ARRAY[]::TEXT[]);

BEGIN;
DO $$
DECLARE e RECORD; got TEXT[];
BEGIN
  FOR e IN SELECT * FROM expected LOOP
    PERFORM set_config('app.actor', '', true);
    PERFORM set_config('app.current_tenant', '', true);
    PERFORM set_config('app.current_customer', '', true);
    IF e.setting IS NOT NULL THEN PERFORM set_config(e.setting, e.value, true); END IF;

    SELECT coalesce(array_agg(code ORDER BY code), ARRAY[]::TEXT[]) INTO got FROM licences;
    IF got IS DISTINCT FROM e.codes THEN
      RAISE EXCEPTION 'FALLA %: esperaba %, obtuvo %', e.actor, e.codes, got;
    END IF;
    RAISE NOTICE 'OK  % ve % de 7: %', rpad(e.actor, 20), cardinality(got), got;
  END LOOP;

  -- El referral si ve el estado de su lead.
  PERFORM set_config('app.actor', '', true);
  PERFORM set_config('app.current_customer', '', true);
  PERFORM set_config('app.current_tenant', 'survey-leads', true);
  IF (SELECT count(*) FROM leads) <> 1 THEN RAISE EXCEPTION 'FALLA referral: no ve su lead'; END IF;
  RAISE NOTICE 'OK  Survey Leads ve el estado de 1 lead';
END $$;
ROLLBACK;
