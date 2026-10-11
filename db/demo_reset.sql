-- "Reset demo": deja la demo como recién sembrada. Online, todos los
-- visitantes comparten los mismos datos: si uno aprueba la renovación, el
-- siguiente la encuentra hecha. Este botón lo deshace.
--
-- SECURITY DEFINER porque vacía tablas que hub_app no puede tocar. Por eso no
-- recibe parámetros y solo hace una cosa: lo que siembra está fijado en
-- seed_demo() y seed_demo_transfers(), que nadie más puede ejecutar.
CREATE OR REPLACE FUNCTION reset_demo() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  TRUNCATE drone_events, transfer_requests, renewal_requests, outbox, odoo.sale_orders,
           leads, licences, drones, customers, tenants RESTART IDENTITY CASCADE;
  UPDATE odoo.settings SET down = false;
  PERFORM seed_demo();
  PERFORM seed_demo_transfers();
END;
$$;
REVOKE EXECUTE ON FUNCTION reset_demo() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reset_demo() TO hub_app;
