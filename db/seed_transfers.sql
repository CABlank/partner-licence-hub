-- Una solicitud sin respuesta desde hace 7 días: el caso en el que SÍ entra
-- soporte. Dealer Oslo pide la unidad de demo de Barcelona (WG-20882), que se
-- vendió de segunda mano a Noruega, y Barcelona nunca contestó.
CREATE OR REPLACE FUNCTION seed_demo_transfers() RETURNS void LANGUAGE sql AS $seed$
INSERT INTO transfer_requests (drone_serial, from_tenant_id, to_tenant_id, reason, created_at, due_at)
VALUES ('WG-20882', 'dealer-barcelona', 'dealer-oslo',
        'Bought second-hand by a Norwegian survey firm; needs WingtraPRO set up here.',
        now() - interval '7 days', now() - interval '2 days');

INSERT INTO drone_events (drone_serial, event, from_tenant_id, to_tenant_id, decided_by, at)
VALUES ('WG-20882', 'transfer_requested', 'dealer-barcelona', 'dealer-oslo', 'dealer-oslo', now() - interval '7 days');
$seed$;
REVOKE EXECUTE ON FUNCTION seed_demo_transfers() FROM PUBLIC;
SELECT seed_demo_transfers();
