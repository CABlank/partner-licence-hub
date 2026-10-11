# Partner Licence Hub

**Live demo: https://partner-licence-hub.vercel.app** (start at the welcome page; "Reset demo" bottom left)

A prototype portal for a hardware manufacturer that sells through a two-tier
channel (manufacturer → distributors → dealers → end customers) and earns
recurring revenue from software licences tied to each device. Built by Carlos
Blank as an independent study. **Not affiliated with or endorsed by Wingtra.**
All companies, licences, prices and numbers are fictional.

## What it does
| Who | Can do | Shows |
|---|---|---|
| Dealer | See licences by urgency, request renewals, request a second-hand drone from another partner | The front line of the channel |
| Distributor | Approve or reject its dealers' renewals and transfers | Money flows up the hierarchy; the order is billed to the distributor |
| Manufacturer (Operations) | Watch orders reach the ERP (a mock Odoo), simulate an outage, decide escalated transfers | An outbox that survives an ERP outage without losing or duplicating orders |
| Manufacturer (Insights) | Renewal rate, ARR bridge, NRR/GRR, a renewal desk with backtested risk signals, each dealer's book | GTM analytics on a simulated network, built with dbt |
| End customer | See its own licences and whether they are being renewed | The portal supports the dealer instead of bypassing it |
| Referral partner | See the status of the leads it introduced | Each party sees exactly what it should |

## How it is built
- **Next.js 15 + TypeScript** (strict, no `any`, zod at every boundary).
- **Postgres row-level security.** Who sees what is enforced by the database,
  not by the screens. A query that forgets a filter returns nothing, never
  another partner's customers.
- **Outbox pattern** between "approved" and the ERP, with idempotent delivery.
- **dbt** for the analytics layer: staging → intermediate → marts. There are 51
  data tests, including an ARR bridge that must reconcile every month.
- **Tests:** 55 vitest tests and 2 SQL test scripts. Many tests are attack
  attempts ("a dealer cannot forge an approved event"), not just happy paths.
- **Hosting:** Vercel (Frankfurt) and Neon Postgres (Frankfurt).

Every design decision, with the alternative I rejected and the bugs I found,
is in **[DECISIONS.md](DECISIONS.md)**. The analytics layer is described in
[analytics/README.md](analytics/README.md).

## Run it locally (Git Bash or any POSIX shell)
```bash
export MSYS_NO_PATHCONV=1
docker compose up -d
docker compose exec -T db psql -q -U postgres -d licence_hub -f /db/schema.sql -f /db/seed.sql -f /db/expiry.sql -f /db/renewals.sql -f /db/transfers.sql -f /db/seed_transfers.sql -f /db/demo_reset.sql
for t in test_who_sees_what test_expiry; do
  docker compose exec -T db psql -q "postgresql://hub_app:hub_app@localhost/licence_hub" -f /db/$t.sql
done
```
To start from scratch: `docker compose down -v`. This also deletes the
analytics database (`licence_hub_sim`); see `analytics/README.md` to rebuild it.

App and tests:
```bash
npm install
cp .env.example .env.local   # local Docker connection strings
npm run typecheck
npm test            # 55 tests, needs the database running
npm run dev         # http://localhost:3005
npm run demo:reset  # back to the seeded data (same as the "Reset demo" button)
```

The local passwords (`hub_app` / `hub_app`) are for Docker only. The published
demo uses random passwords that live in Vercel, not in this repository.

## Known simplifications
- The actor picker at the top stands in for a real login (SSO).
- Software plans are modelled as licences per drone; the real plans may be
  per account.
- Prices are illustrative.
- A licence is extended when the ERP order is created; in reality it is
  probably when the invoice is paid.

Each of these is listed in DECISIONS.md as a question for the business, not as
a fact.
