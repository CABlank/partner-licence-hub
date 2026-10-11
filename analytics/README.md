# Analytics layer (dbt)

It answers two questions: **is the portal working?** and **is software
recurring revenue growing?**

The portal, in three measures:

1. **Renewal rate:** of the manually renewed licences that expired, how many
   were renewed. The care plan renews itself and LIDAR is perpetual, so neither
   counts.
2. **Money at risk:** what expires in 90 days with nobody renewing it, plus
   this week's call list (under 30 days, no request yet).
3. **Support time saved:** how many drone transfers partners decided without
   support, and how fast.

The software (PRO and UNLIMITED):

4. **ARR and its bridge:** new, reactivated, expansion, contraction and churn,
   month by month, with a 30-day grace period (`arr_grace_days`).
5. **12-month NRR and GRR,** per distributor and per dealer. Each customer is
   attributed to the partner whose invitation code it signed up with.
6. **Renewal desk** (`mart_renewal_desk`). For every subscription expiring in
   90 days it gives:
   - a churn-risk band (macro `churn_risk_band`);
   - a recommended price from the policy in the seed `renewal_price_policy`;
   - an UNLIMITED offer when storage is close to the PRO quota;
   - the next action.
7. **Backtests:** do the risk band and the storage signal really warn, using
   only the data available at the time?

**SIMULATED data.** The demo has 7 licences, and measuring needs history.
`simulate.sql` generates about 3 years of an invented network in a separate
database, `licence_hub_sim`, with the same schema:
- 3 distributors and 9 dealers;
- about 580 licences;
- monthly usage telemetry per drone, in the `telemetry` schema.

It is deterministic (fixed seed). Its assumptions are written at the top of
the file. Prices in `seeds/product_prices.csv` are illustrative.

## Layers
```
sources (the app's tables, read-only; telemetry)
  -> staging/        rename and clean, 1:1 with each table (views)
  -> intermediate/   int_licence_term_outcomes: every ended term, renewed or lapsed
                     int_licence_terms: every subscription term, past or current
                     int_customer_arr_monthly: ARR per customer and month
                     int_drone_usage_features: usage signals as known on the 1st of each month
  -> marts/          monthly renewal rate, 90-day risk, transfers, distributor
                     scorecard, ARR bridge, 12-month retention, renewal desk,
                     backtests and a book per dealer
```

There are 51 data tests. Most are standard checks: uniqueness, not null,
accepted values and relationships. Five are custom, in `tests/`:
- the monthly mart has one row per month and distributor;
- rates stay between 0 and 1;
- no negative durations;
- the ARR bridge reconciles every month;
- reconstructed terms never overlap.

## Rebuild (from the project folder)
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
The published demo uses the `neon` target in `profiles.yml`. Its credentials
come from environment variables, never from the file.

The app shows all of this at `/insights` (signed in as the manufacturer).
