import type { ChurnBacktestRow, Recurring, RiskBand } from '@/lib/analytics';
import { tenantName } from '@/components/ui';

const pct = (v: number | null) => (v === null ? '-' : `${Math.round(v * 100)}%`);
const chf = (v: number) => `CHF ${Math.round(v).toLocaleString('en-CH')}`;
const ratio = (num: number, den: number) => (den === 0 ? null : num / den);

const BAND_TONE: Record<RiskBand, string> = { high: 'danger', medium: 'warn', low: 'ok', unknown: 'info' };
const BANDS: readonly RiskBand[] = ['high', 'medium', 'low', 'unknown'];

function lapseRate(rows: ChurnBacktestRow[], plan: ChurnBacktestRow['plan'], band: RiskBand) {
  const r = rows.find((x) => x.plan === plan && x.risk_band === band);
  return r ? `${pct(r.lapse_rate)} of ${r.terms}` : '-';
}

// La parte de software: el ingreso recurrente, si la base instalada crece sola
// y el motor de renovaciones. Todo sale de los marts de dbt (datos SIMULADOS).
export function RecurringRevenue({ recurring }: { recurring: Recurring }) {
  const { bridge, retention, dealers, desk, churnBacktest, upsellBacktest } = recurring;
  const last = bridge.at(-1);
  const first = bridge.at(0);
  const sum = (k: keyof Omit<(typeof bridge)[number], 'month'>) => bridge.reduce((a, r) => a + r[k], 0);
  const near = upsellBacktest.find((r) => r.near_storage_quota === true);
  const rest = upsellBacktest.find((r) => r.near_storage_quota === false);
  const totalUpgrades = (near?.upgraded_within_6m ?? 0) + (rest?.upgraded_within_6m ?? 0);

  return (
    <>
      <header className="pagehead">
        <div>
          <h2>Recurring revenue: software subscriptions</h2>
          <p>PRO and UNLIMITED at illustrative list prices, annualised. WingtraCARE and LIDAR are not ARR here.</p>
        </div>
      </header>

      <section aria-label="Recurring revenue headline" className="stats">
        <div className="stat"><span>ARR today</span><strong>{last ? chf(last.ending_arr_chf) : '-'}</strong></div>
        <div className="stat">
          <span>Net revenue retention, 12m</span>
          <strong>{retention ? pct(ratio(retention.current_arr_chf, retention.starting_arr_chf)) : '-'}</strong>
        </div>
        <div className="stat u60">
          <span>Gross revenue retention, 12m</span>
          <strong>{retention ? pct(ratio(retention.retained_arr_chf, retention.starting_arr_chf)) : '-'}</strong>
        </div>
      </section>
      <p className="hint">
        NRR above 100% means the customers we had a year ago pay more today (more drones, upgrades). GRR only counts
        losses, so it shows how much of that base we keep before any upsell.
      </p>

      <section aria-label="ARR bridge" className="stack">
        <h2>Where ARR came from in the last 12 months</h2>
        <div className="tablebox">
          <table>
            <thead>
              <tr><th>Start</th><th>+ New</th><th>+ Reactivated</th><th>+ Expansion</th><th>− Contraction</th><th>− Churn</th><th>= End</th></tr>
            </thead>
            <tbody>
              <tr className="mono">
                <td>{first ? chf(first.starting_arr_chf) : '-'}</td>
                <td>{chf(sum('new_arr_chf'))}</td>
                <td>{chf(sum('reactivated_arr_chf'))}</td>
                <td>{chf(sum('expansion_arr_chf'))}</td>
                <td>{chf(sum('contraction_arr_chf'))}</td>
                <td>{chf(sum('churned_arr_chf'))}</td>
                <td><strong>{last ? chf(last.ending_arr_chf) : '-'}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="hint">A dbt test checks that every month adds up and that each month starts where the last one ended.</p>
      </section>

      <section aria-label="Renewal desk" className="stack">
        <h2>Renewal desk: next 90 days, no renewal started</h2>
        {desk.length === 0 ? (
          <p className="empty">Every subscription expiring in 90 days already has a renewal under way.</p>
        ) : (
          <div className="tablebox">
            <table>
              <thead>
                <tr>
                  <th>Licence</th><th>Dealer</th><th>Days</th><th>Flights vs last year</th><th>Processed elsewhere</th>
                  <th>Storage used</th><th>Risk</th><th>List → recommended</th><th>Next action</th>
                </tr>
              </thead>
              <tbody>
                {desk.map((d) => (
                  <tr key={d.licence_code}>
                    <td className="mono">{d.licence_code} · {d.plan}</td>
                    <td>{tenantName(d.dealer_id)}</td>
                    <td className="mono">{d.days_left}</td>
                    <td className="mono">{pct(d.usage_index)}</td>
                    <td className="mono">{pct(d.external_share_3m)}</td>
                    <td className="mono">{pct(d.storage_used_share)}</td>
                    <td><span className={`pill ${BAND_TONE[d.risk_band]}`}>{d.risk_band}</span></td>
                    <td className="mono">{chf(d.list_price_chf)} → {chf(d.recommended_price_chf)}</td>
                    <td>{d.next_action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint">
          The price policy per risk band is a table GTM owns (seed <span className="mono">renewal_price_policy</span>):
          an uplift needs no approval; a save discount goes to the deal desk.
        </p>
      </section>

      <section aria-label="Signal backtest" className="stack">
        <h2>Do the signals work? Backtest on past renewals</h2>
        <div className="tablebox">
          <table>
            <thead>
              <tr><th>Risk band 60 days before expiry</th><th>PRO: lapsed</th><th>UNLIMITED: lapsed</th></tr>
            </thead>
            <tbody>
              {BANDS.filter((b) => churnBacktest.some((r) => r.risk_band === b)).map((b) => (
                <tr key={b}>
                  <td><span className={`pill ${BAND_TONE[b]}`}>{b}</span></td>
                  <td className="mono">{lapseRate(churnBacktest, 'PRO', b)}</td>
                  <td className="mono">{lapseRate(churnBacktest, 'UNLIMITED', b)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">
          Near the PRO storage quota: {near ? pct(near.upgrade_rate) : '-'} upgraded to UNLIMITED within 6 months, against{' '}
          {rest ? pct(rest.upgrade_rate) : '-'} for the rest. But it only flags {near?.upgraded_within_6m ?? 0} of{' '}
          {totalUpgrades} upgrades: precise, not complete.
        </p>
      </section>

      <section aria-label="Dealer book" className="stack">
        <h2>Each dealer&apos;s book (customers who signed up with its invitation code)</h2>
        <div className="tablebox">
          <table>
            <thead>
              <tr><th>Dealer</th><th>Customers</th><th>ARR</th><th>NRR 12m</th><th>GRR 12m</th><th>Expiring 90d</th><th>High risk 90d</th><th>Upsell candidates</th></tr>
            </thead>
            <tbody>
              {dealers.map((d) => (
                <tr key={d.dealer_id}>
                  <td><strong>{d.dealer_name}</strong> <span className="hint">· {tenantName(d.distributor_id)}</span></td>
                  <td className="mono">{d.customers_with_arr}</td>
                  <td className="mono">{chf(d.arr_chf)}</td>
                  <td className="mono">{pct(d.nrr_12m)}</td>
                  <td className="mono">{pct(d.grr_12m)}</td>
                  <td className="mono">{chf(d.arr_expiring_90d_chf)}</td>
                  <td className="mono">{chf(d.arr_high_risk_90d_chf)}</td>
                  <td className="mono">{d.upsell_candidates}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
