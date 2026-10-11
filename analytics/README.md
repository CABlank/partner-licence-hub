# Capa de análisis (dbt)

Responde a dos preguntas: **¿funciona el portal?** y **¿crece el ingreso
recurrente del software?** Primero, tres medidas del portal:

1. **Tasa de renovación**: de las licencias de renovación manual que caducaron,
   cuántas se renovaron (CARE se renueva sola y LIDAR es perpetua: no cuentan).
2. **Dinero en riesgo**: lo que caduca en 90 días sin que nadie lo esté renovando,
   y la lista de llamadas de esta semana (menos de 30 días, sin solicitud).
3. **Soporte ahorrado**: cuántas transferencias de dron decidieron los partners
   sin pasar por soporte, y en cuánto tiempo.

Y para el software (PRO y UNLIMITED):

4. **ARR y su puente**: nuevo, reactivado, ampliación, reducción y bajas, mes a
   mes (con 30 días de gracia, `arr_grace_days`).
5. **NRR y GRR a 12 meses**, por distribuidor y por dealer (cartera atribuida
   por el código de invitación del cliente).
6. **Motor de renovaciones** (`mart_renewal_desk`). Por cada suscripción que
   vence en 90 días da:
   - la banda de riesgo (macro `churn_risk_band`);
   - el precio recomendado según la política del seed `renewal_price_policy`;
   - una oferta de UNLIMITED si el almacenamiento está cerca del cupo;
   - el siguiente paso.
7. **Backtests**: ¿la banda de riesgo y la señal de almacenamiento avisan de
   verdad, con los datos que había antes?

**Datos SIMULADOS.** La demo tiene 5 licencias; para medir hace falta historia.
`simulate.sql` genera ~3 años de una red inventada (3 distribuidores, 9 dealers,
~580 licencias, y telemetría de uso mensual por dron en el esquema
`telemetry`) en otra base, `licence_hub_sim`, con el mismo esquema. Es
determinista (misma semilla). Los precios de `seeds/product_prices.csv` son
ilustrativos, no de Wingtra.

## Capas
```
sources (tablas de la app, solo lectura)
  -> staging/        renombra y limpia, 1:1 con cada tabla (vistas)
  -> intermediate/   int_licence_term_outcomes: cada término terminado, renovado o perdido
                     int_licence_terms: cada término de suscripción (pasado o actual)
                     int_customer_arr_monthly: ARR por cliente y mes
                     int_drone_usage_features: señales de uso conocidas cada día 1
  -> marts/          tasa mensual, riesgo 90d, transferencias, scorecard por
                     distribuidor, puente de ARR, retención 12m, motor de
                     renovaciones, backtests y cartera por dealer
```
51 tests de datos: unicidad, no nulos, valores aceptados y relaciones, y cinco
propios en `tests/`:
- grano del mart mensual;
- tasas entre 0 y 1;
- sin duraciones negativas;
- el puente de ARR cuadra;
- los términos no se solapan.

## Regenerar (desde la carpeta del proyecto)
```bash
export MSYS_NO_PATHCONV=1
X="docker compose exec -T db"
$X psql -q -U postgres -c "DROP DATABASE IF EXISTS licence_hub_sim" -c "CREATE DATABASE licence_hub_sim"
docker compose exec -T db pg_dump -U postgres --schema-only licence_hub | $X psql -q -U postgres -d licence_hub_sim
docker compose exec -T db pg_dump -U postgres --data-only -t products licence_hub | $X psql -q -U postgres -d licence_hub_sim
$X psql -q -U postgres -d licence_hub_sim < analytics/setup.sql
$X psql -q -U postgres -d licence_hub_sim < analytics/simulate.sql
cd analytics && .venv/Scripts/dbt build --profiles-dir .
```
La app lo enseña en `/insights` (entrando como Wingtra).
