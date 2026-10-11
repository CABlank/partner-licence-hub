# Decisions (and why)

Each decision comes with the alternative I rejected. The point is not only what
I built, but why it fits better.

## 1. The manufacturer is not a tenant, it is a session type
- **Rejected:** the manufacturer as the root of the partner tree (parent of
  every distributor).
- **Why:** the rule "a parent sees its children" would give it full access by
  inheritance, without anyone deciding it. If that rule ever became recursive,
  access would change by accident. With `is_platform()`, full access is
  explicit and easy to search for.

## 2. End customers and referral partners are outside the partner tree
- **Why:** they appear on the same diagram, but they are not channel partners.
  The customer sees by `customer_id`. The referral partner reads a different
  table (`leads`) and never `licences`. So "sees 0 of 7" does not depend on
  anyone remembering to filter.

## 3. Isolation lives in the database (RLS), not in the app
- **Rejected:** `WHERE tenant_id = ...` in every query.
- **Why:** one forgotten WHERE in one endpoint leaks a partner's customers to a
  competitor. With RLS the query has no filter and the database decides. A
  hand-written `tenant_id = X` would also break the distributor's view, since a
  distributor has no licences of its own.
- **Accepted cost:** the app must declare the session in every transaction
  (`set_config(..., true)`). If it does not, it gets zero rows (fail-closed).
- **Honest limit:** the database cannot know whether the app lies about who is
  asking. The session variables are set by the server from the login, never by
  the browser.

## 4. The "who sees what" table is the test
- `db/test_who_sees_what.sql` checks the design's "sees / does not see" table
  row by row, running as `hub_app`, an unprivileged role. As a superuser the
  test would pass for the wrong reason, because RLS does not apply.

## 5. Readable IDs (`dealer-valencia`) instead of UUIDs
- **Why:** it is a prototype meant to be read; in the demo and in the tests
  you can see who is who. In production they would be UUIDs.

## 6. The expiry panel is a view with `security_invoker`
- **Found by testing, not by reading:** a normal view runs with its owner's
  permissions and skips RLS. Dealer Valencia saw 5 of 5 licences. With
  `security_invoker = true` the view applies the rules of whoever queries it.
- **Second bug found:** the end customer cannot read `tenants`, so a plain
  `JOIN` made its licence disappear. Changed to `LEFT JOIN`.
- **Who acts:** the dealer from 90 days (it is the front line); the
  distributor joins at 30 days. This is a proposal to validate with the
  business, not a fact.

## 7. A test that cannot fail proves nothing
- The first panel test said "OK" on an empty result: `NULL <> array` is NULL,
  not TRUE, so the `IF` never fired. Every comparison now uses
  `IS DISTINCT FROM`.
- Checked the other way round: run as a superuser (no RLS), the test fails on
  Iberia Distribution (it sees Nordic's WR-2210). That is how I know the test
  has teeth.

## 8. Strict TypeScript, no `any`, zod at the boundaries
- `pg` returns rows as `any`. A cast (`rows as ExpiryRow[]`) would lie to the
  compiler. `queryRows` validates every row with a zod schema, and the type
  comes from that schema (`z.infer`), so the shape is defined in one place.
- The actor id comes from a cookie or a form, so from outside. zod checks it
  against the list; an invented value falls back to the default actor.
- Test with teeth: changing `SET LOCAL` to `SET` in `withSession` makes the
  test "a pooled connection does not inherit the previous actor" fail.

## 9. Renewals go through the distributor
- **Why:** money flows up the hierarchy, and the distributor is the one that
  buys from the manufacturer. If the dealer ordered directly, the ERP order
  would carry the wrong billing customer. So the order is created in the
  distributor's name.
- **The database enforces it:** a dealer can only create requests addressed to
  ITS distributor and for ITS licences. Checked by breaking the policy: the
  test "cannot forge a request" fails.
- **Open question for the business:** do some distributors let their dealers
  renew without approval (auto-approve below an amount)? That would be a
  setting per distributor, not a change of model.

## 10. An outbox between "approved" and the ERP
- **Rejected:** calling the ERP inside the approve action.
- **Why:** they are two systems. If the ERP fails after the approval, they
  disagree and nobody notices. With the outbox, the event is stored in the same
  transaction as the approval, and a dispatcher delivers it with retries.
- **Accepted cost:** at-least-once delivery. The ERP receives `event_id` as the
  order reference, so it never creates a duplicate order. Tested with the ERP
  down (the event waits and records the error) and with a crash halfway (the
  order already existed: no duplicate, and the licence is extended once).
- **Conscious simplification:** the licence is extended when the order is
  created. In reality it is probably when the invoice is paid. Question for
  the business.

## 11. A double click does not create two orders
- A partial unique index allows one open request per licence. The database
  guarantees it, not the button. Tested with two simultaneous requests.
- Column permissions: the distributor can change the status, but not which
  licence the request points to. Only the dispatcher sets `ordered`.

## 12. Drone transfers: whoever has the information decides, not support
- **Today:** a dealer enters a Drone ID configured by another partner →
  blocked → email to support → a person decides by hand.
- **Proposal:** the dealer requests the transfer with a reason. The partner
  that has the drone, or its distributor, decides, because they know whether
  the customer really moved. Support only steps in if nobody answers in 5 days.
  Everything is recorded in `drone_events`, the history that today lives in an
  email thread.
- **Privacy:** checking a Drone ID only answers "free / yours / another
  partner's", never whose, and never which customer.
- **One door to decide:** `decide_transfer()` (SECURITY DEFINER), because it
  moves rows the decider cannot touch. That is why all the authorisation is
  written inside it and covered by tests. Partners have no UPDATE permission on
  the table.
- **Business rule:** a drone with an open renewal cannot be transferred; the
  renewal would be billed to the previous dealer.
- **Open questions for the business:** do active licences always travel with
  the drone? Are 5 days reasonable? Should the requester see who the current
  owner is?

## 13. The most important bug: a permission check that failed open
- The test "support cannot jump in before the 5 days are up" failed: support
  COULD decide early.
- **Cause:** the manufacturer has no tenant, so `from_tenant_id =
  current_tenant()` is NULL; `NOT (NULL)` is NULL; and `IF NULL` does not
  enter, so the error was never raised. The same NULL trap as point 7, this
  time in a permission check.
- **Fix:** every comparison wrapped in `coalesce(..., false)`.
- **Lesson:** in SQL, "deny if NOT allowed" is dangerous when "allowed" can be
  NULL. Compute `allowed` as a strict boolean, and test every actor that must
  NOT be able to, not only the one that can.

## 14. The analytics layer found a gap in the data model
- Measuring how early a renewal is requested needs the expiry date each
  request was renewing. The app did not store it: on renewal,
  `licences.expires_on` changes and the value is lost forever.
- **Fix:** `renewal_requests.expires_on_at_request`, frozen at request time.
  The INSERT policy requires it to be the real date; otherwise a dealer could
  polish its lead time in the reports. There is a test for it.
- **Lesson:** thinking about how a feature will be measured changes how its
  data is stored. It is cheaper to decide before there is data than to
  reconstruct it later.

## 15. Analytics separated from the app, on simulated data, and saying so
- A different database (`licence_hub_sim`) and user (`hub_analytics`). It reads
  every row because it aggregates the whole network, but it cannot write to
  the app's tables. That is the role of a data warehouse.
- **Why simulated:** 7 licences cannot be measured. The simulation has
  explicit assumptions (Nordic renews less and approves more slowly), and the
  page says "Simulated data". Prices are illustrative.
- **Panel inside the app, not Metabase:** it ships with the prototype and only
  the manufacturer sees it. With a data team behind it, Metabase would be the
  natural choice.
- **Honest charts:** the first axis started at 40% and hid Nordic's bad months
  (down to 33%) at the bottom. It now runs from 0 to 100%. The "licences per
  point" range is computed from the data: the fixed text I wrote first
  ("3 to 15") was wrong.

## 16. The catalogue is a table: four licence mechanics, not one
- **Before:** one licence type (subscription, renewed by hand, travels with
  the drone) and old plan names hard-coded.
- **What public information showed:** the software plans are ESSENTIAL / PRO /
  UNLIMITED; LIDAR is perpetual with 3 years of updates; the care plan renews
  automatically with notices at 90/60/30 days and is **not transferable** when
  the drone is resold.
- **Now:** a `products` table with `renewal_mode` (manual / auto / perpetual),
  `term_years`, `anchor` and `transferable`. Everything follows from it:
  - **the panel:** "Request renewal" only on manual products. CARE says
    "auto-renews, opt-out by X"; LIDAR says "keeps working, updates end";
  - **the database:** the INSERT policy rejects renewing CARE or LIDAR (it
    would be a duplicate ERP order). The app also gives a clear message first;
  - **the dispatcher:** the renewal length comes from `term_years`;
  - **the transfer:** transferable licences move to the new dealer; CARE ends
    (`ended_at`) and stays in the history. The decider sees "Moves" / "Ends"
    BEFORE approving; the requester never sees another partner's licences;
  - **the analytics:** the renewal rate counts manual products only. CARE
    renewing itself is not the portal's merit.
- **Marked assumptions:** the anchor and transferability of PRO and UNLIMITED
  are not public. They are questions for the business, not facts.
- **The simulated figures changed** when regenerated with the new catalogue
  (a different random sequence). Nordic went from 59% to 76% renewal. With 5
  to 15 licences per month and distributor, that gap was mostly noise; the gap
  in approval time persisted. **Lesson:** do not report as a finding a
  difference that a new sample erases.

## 17. Full code review: three permission holes
I reviewed the code file by file looking for bugs, and confirmed every
suspicion with a real attack as `hub_app` before accepting it.

| # | Finding | Severity | Fix | Test |
|---|---|---|---|---|
| 1 | **A dealer could write a "renewal approved" event into the outbox.** The dispatcher created the ERP order in the distributor's name and extended the licence a year, with no approval. Confirmed: order S00001, licence extended to 2027-11-03 | High | The app can no longer write to the outbox. The event is created by a trigger when a request moves from `pending` to `approved`, with data from the database | `a dealer cannot write an "approved" event` |
| 2 | **The dispatcher trusted the event payload** (licence, distributor) | High (with #1) | It reads the request by id and only bills it if it is `approved`; otherwise it discards the event (`discarded_at`) without retrying | `the dispatcher discards an event whose request was never approved` |
| 3 | **A distributor could request its own dealer's drone and approve it itself** | Medium | `decide_transfer()`: nobody decides their own request | `a distributor cannot approve its own request` |
| 4 | **A referral partner could request a drone**; if approved, it would see the drone's licences | Medium | The policy requires a dealer or distributor | `a referral partner cannot request a drone` |
| 5 | `decideTransfer` turned any error (even a database outage) into "not found" and hid it | Low | It only translates known rejections; everything else is rethrown | — |
| 6 | Without `DATABASE_URL`, the pool silently connected to a different database | Low | `lib/env.ts` validates the URLs with zod | — |
| 7 | Insights returned a 500 if the analytics database did not exist; with empty data it would show "Infinity" | Low | A clear message, and a guard for the empty list | — |
| 8 | The urgency counters included the care plan (auto-renews) and already expired licences | Low (UX) | They count manual products only | — |
| 9 | Outdated texts: "all licences move"; "Retrying · Odoo unavailable" on any error | Low | Corrected | — |

The new tests were checked the other way round: reopening holes 1 and 4 makes
exactly those two tests fail.

**Lesson:** the earlier tests checked what the app does, not what a user with
direct access to their own role could do. There are now "attempts to bypass the
app" tests for every write.

**Known simplifications that remain** (not bugs in the demo, but production
would differ):
- LIDAR says it is anchored to the payload, but there is no payloads table.
- The customer is stored on both the drone and the licence, with nothing
  forcing them to match.
- "Demo unit" is inferred from `customer_id IS NULL` instead of being a column.
- A distributor cannot hold renewable licences of its own, although in reality
  distributors also sell directly.

## 18. Recurring revenue: ARR, retention and a renewal desk
- **What:** reconstructed licence terms, monthly ARR per customer, an ARR
  bridge, NRR/GRR, simulated usage telemetry, a churn-risk band, a recommended
  renewal price, backtests, and a book per dealer (see `analytics/README.md`).
- **ARR counts PRO and UNLIMITED only.** The care plan renews itself and the
  portal does not store its terms (in production they would come from ERP
  invoices). LIDAR is a perpetual one-off sale.
- **A 30-day grace period in ARR** (`arr_grace_days`).
  - **Rejected:** no grace period. Every late renewal would show as churn
    followed by new business, and the bridge would lie.
  - **Cost:** a customer who does not renew counts for 30 extra days. That is
    why it is a visible variable.
- **Rules, not a statistical model.**
  - With ~250 resolved terms, a model would overfit, and a rule can be
    explained to a dealer.
  - The rule lives in one macro, used by both the renewal desk and the
    backtest. Changing it immediately shows whether it warns better.
- **Usage against last year,** like booking pace vs last year in the car-rental
  pricing engine I built before. Comparing with the previous months mistakes a
  Nordic winter for churn.
- **The pricing policy is a table (a seed), not code.** It is a commercial
  decision that belongs to GTM. An uplift needs no approval; a discount does.
- **Found by looking at the results:** Nordic had the worst renewal rate and
  the best NRR.
  - **Cause:** the simulation spread a customer's licences randomly over 3
    years, so everything looked like expansion.
  - **Fix:** purchases are now per drone, and UNLIMITED comes later as an
    upgrade. The earlier simulated figures changed as a result.
  - **Lesson:** an NRR that contradicts the renewal rate is an alarm, not a
    finding.

## How I used AI
The design (channel, blocking, open questions, who sees what) I did by hand in
Figma. Claude was my pair programmer: it reviewed the design's access policy
(it found the policy only covered one level and that the end customer was
missing from the tree), and helped write the schema, the app, the tests and
the analytics. I discussed every decision in this file and can defend it.
