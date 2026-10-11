-- Test del panel de caducidades. Corre como hub_app.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE got TEXT[];
BEGIN
  -- 1. La vista respeta RLS: Dealer Valencia ve sus 3, no 7.
  PERFORM set_config('app.current_tenant', 'dealer-valencia', true);
  SELECT array_agg(code || ':' || bucket ORDER BY code) INTO got FROM licence_expiry;
  IF got IS DISTINCT FROM ARRAY['WC-1042:60', 'WR-1042:30', 'WR-1043:60'] THEN
    RAISE EXCEPTION 'FALLA dealer: %', got;
  END IF;
  RAISE NOTICE 'OK  Dealer Valencia: %', got;

  -- 2. El distribuidor ve lo urgente de sus dealers, nunca Nordic.
  PERFORM set_config('app.current_tenant', 'iberia', true);
  SELECT array_agg(code || ':' || bucket ORDER BY code) INTO got
  FROM licence_expiry WHERE bucket IN ('30', '60', '90');
  IF got IS DISTINCT FROM ARRAY['WC-1042:60', 'WO-0881:90', 'WR-1042:30', 'WR-1043:60'] THEN
    RAISE EXCEPTION 'FALLA distribuidor: %', got;
  END IF;
  RAISE NOTICE 'OK  Iberia, por renovar en 90 dias: %', got;

  -- 3. El cliente ve solo la suya y cuántos días le quedan.
  PERFORM set_config('app.current_tenant', '', true);
  PERFORM set_config('app.current_customer', 'ayto-valencia', true);
  SELECT array_agg(code || ':' || days_left ORDER BY code) INTO got FROM licence_expiry;
  IF got IS DISTINCT FROM ARRAY['WC-1042:40', 'WR-1042:25'] THEN RAISE EXCEPTION 'FALLA cliente: %', got; END IF;
  RAISE NOTICE 'OK  Ayto. de Valencia: %', got;

  -- 4. Sin sesión, cero filas también a través de la vista.
  PERFORM set_config('app.current_customer', '', true);
  IF (SELECT count(*) FROM licence_expiry) <> 0 THEN
    RAISE EXCEPTION 'FALLA: la vista devuelve filas sin sesion';
  END IF;
  RAISE NOTICE 'OK  Sin sesion: 0 filas';
END $$;
ROLLBACK;
