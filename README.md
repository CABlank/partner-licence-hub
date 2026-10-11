# Partner Licence Hub (prototipo para Wingtra, por Carlos Blank)

Prototipo independiente con datos inventados. No usa ni toca sistemas de Wingtra.
Diseño: `../../entrevistas/wingtra-gtm-junior/figma-board.md`. Decisiones: `DECISIONS.md`.

## Arrancar y probar (Git Bash)
```bash
export MSYS_NO_PATHCONV=1
docker compose up -d
docker compose exec -T db psql -q -U postgres -d licence_hub -f /db/schema.sql -f /db/seed.sql -f /db/expiry.sql -f /db/renewals.sql -f /db/transfers.sql -f /db/seed_transfers.sql -f /db/demo_reset.sql
for t in test_who_sees_what test_expiry; do
  docker compose exec -T db psql -q "postgresql://hub_app:hub_app@localhost/licence_hub" -f /db/$t.sql
done
```
Para empezar de cero: `docker compose down -v`. Ojo: borra también la base de
análisis (`licence_hub_sim`); para recrearla, ver `analytics/README.md`.

App y tests (TypeScript estricto, zod, vitest):
```bash
npm install
npm run typecheck
npm test            # 52 tests, necesita la base arrancada
npm run dev         # http://localhost:3005
npm run demo:reset  # deja los datos como recién sembrados antes de grabar
```

## Estado
- [x] Semana 1a: esquema, datos del Figma, RLS, test "quién ve qué" (7/7 OK, 09.10)
- [x] Semana 1b: panel de caducidades 30/60/90 por actor (vista + 4 tests, 09.10)
- [x] Semana 1c: app Next.js + TypeScript + zod, selector de actor y panel; 13 tests vitest (09.10)
- [x] Semana 2a: renovación dealer > distribuidor > outbox > Odoo simulado, con caída de Odoo y reintentos; 15 tests (09.10)
- [x] Semana 2b: transferencia de dron (sustituye el email a soporte); 15 tests, encontrado y arreglado un permiso que fallaba abierto (09.10)
- [x] Diseño de las 4 pantallas: https://claude.ai/artifact/Dkydoi5KhJ8MffBBnBx5E8 (09.10)
- [x] Semana 2c: diseño llevado a la app: 4 rutas, menú por rol, avisos por código; flujo completo probado en el navegador (09.10)
- [ ] Semana 2c: publicar online
- [x] Semana 3a: capa de análisis: simulación, dbt (10 modelos, 27 tests) y página /insights (09.10)
- [x] Semana 3b: ingreso recurrente: ARR, NRR/GRR, telemetría simulada, motor de renovaciones con backtest y cartera por dealer (21 modelos, 51 tests) (11.10)
- [x] Catálogo real de Wingtra: 4 mecánicas de licencia (manual, auto, perpetua, intransferible); 48 tests, dbt 42/42 (09.10)
- [x] Revisión de código completa: 3 agujeros de permisos cerrados, 6 fallos menores (DECISIONS.md, punto 17) (09.10)
- [ ] Semana 3b: caso de estudio, guion del vídeo, email
