-- Panel de caducidades. Responde a la casilla del Figma (sección 3):
-- "¿Quién avisa al cliente y por qué canal?"
--
-- security_invoker = true es obligatorio. Una vista normal se ejecuta con los
-- permisos de su DUEÑO (aquí postgres), así que RLS no se aplica y un dealer
-- veía 5 de 5 licencias. Comprobado el 09.10 antes de escribir esta vista.
--
-- Qué significa "caducar" depende del producto (tabla products):
--   manual    -> hay que renovarla, o se pierde
--   auto      -> se renueva sola en expires_on; el cliente puede darse de baja
--                hasta 30 días antes (WingtraCARE)
--   perpetual -> sigue funcionando; en expires_on terminan las actualizaciones
CREATE VIEW licence_expiry WITH (security_invoker = true) AS
SELECT
  l.code,
  l.product,
  p.name                          AS product_name,
  p.renewal_mode,
  p.transferable,
  l.drone_serial,
  l.tenant_id                     AS dealer_id,
  t.parent_id                     AS distributor_id,
  l.customer_id,
  c.name                          AS customer_name,
  l.expires_on,
  l.expires_on - CURRENT_DATE     AS days_left,
  CASE WHEN p.renewal_mode = 'auto' THEN l.expires_on - 30 END AS opt_out_by,
  CASE
    WHEN l.expires_on <  CURRENT_DATE      THEN 'expired'
    WHEN l.expires_on <= CURRENT_DATE + 30 THEN '30'
    WHEN l.expires_on <= CURRENT_DATE + 60 THEN '60'
    WHEN l.expires_on <= CURRENT_DATE + 90 THEN '90'
    ELSE 'later'
  END                             AS bucket,
  -- Quién tiene que actuar. El dealer es la primera línea (Figma, sección 1);
  -- el distribuidor solo entra si el dealer no ha movido ficha a 30 días.
  CASE
    WHEN l.customer_id IS NULL                  THEN 'none (demo unit)'
    WHEN p.renewal_mode = 'auto'                THEN 'none (auto-renews)'
    WHEN p.renewal_mode = 'perpetual'
     AND l.expires_on <= CURRENT_DATE + 90      THEN 'dealer (offer updates)'
    WHEN p.renewal_mode = 'perpetual'           THEN 'none yet'
    WHEN l.expires_on <= CURRENT_DATE + 30      THEN 'dealer + distributor'
    WHEN l.expires_on <= CURRENT_DATE + 90      THEN 'dealer'
    ELSE 'none yet'
  END                             AS who_acts
FROM licences l
JOIN products p ON p.code = l.product
-- LEFT JOIN: el cliente final no puede leer tenants (RLS). Con JOIN normal su
-- licencia desaparecia de la vista. Para el cliente, distributor_id sale NULL.
LEFT JOIN tenants t   ON t.id = l.tenant_id
LEFT JOIN customers c ON c.id = l.customer_id
-- Las licencias terminadas antes de tiempo (CARE tras una transferencia) no
-- están "por caducar": viven en el historial del dron.
WHERE l.ended_at IS NULL;

GRANT SELECT ON licence_expiry TO hub_app;
