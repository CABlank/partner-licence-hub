import { redirect } from 'next/navigation';
import { getActor } from '@/lib/session';
import { getInsights, type Insights } from '@/lib/analytics';
import { Shell } from '@/components/Shell';
import { Legend, RenewalRateChart, RiskBars } from '@/components/charts';
import { tenantName } from '@/components/ui';
import { RecurringRevenue } from '@/components/RecurringRevenue';

export const dynamic = 'force-dynamic';

const pct = (v: number | null) => (v === null ? '-' : `${Math.round(v * 100)}%`);
const chf = (v: number) => `CHF ${v.toLocaleString('en-CH')}`;

const ROLE_LABEL = {
  current_partner: 'Current partner',
  distributor: 'Their distributor',
  support: 'Wingtra support (after 5 days)',
  pending: 'Still pending',
} as const;

// Lo que Wingtra miraría para saber si el portal funciona. Lee los marts de
// dbt sobre la base SIMULADA, nunca la demo.
export default async function Insights() {
  const actor = await getActor();
  if (actor.role !== 'Platform') redirect('/');

  // La base de análisis es aparte (licence_hub_sim) y puede no existir todavía,
  // p. ej. tras un `docker compose down -v`. Sin esto la página daba un 500.
  let insights: Insights;
  try {
    insights = await getInsights();
  } catch (error) {
    console.error('Insights unavailable:', error);
    return (
      <Shell actor={actor} current="/insights">
        <header className="pagehead">
          <div>
            <h1>Insights</h1>
            <p>The analytics database is not built yet.</p>
          </div>
        </header>
        <p className="empty">
          Build it with the steps in <span className="mono">analytics/README.md</span> (simulate, then dbt build), and
          reload this page.
        </p>
      </Shell>
    );
  }
  const { scorecard, monthly, risk, transfers, callList, recurring } = insights;

  const ended = monthly.reduce((a, r) => a + r.terms_ended, 0);
  const renewed = monthly.reduce((a, r) => a + r.renewed, 0);
  // El rango real de licencias por punto, calculado: un texto fijo acabaría mintiendo.
  const sizes = monthly.map((r) => r.terms_ended);
  // Con la lista vacía, Math.min() da Infinity: se evita el texto absurdo.
  const minN = sizes.length ? Math.min(...sizes) : 0;
  const maxN = sizes.length ? Math.max(...sizes) : 0;
  const atRisk = scorecard.reduce((a, r) => a + r.value_at_risk_chf, 0);
  const decided = transfers.filter((t) => t.decided_by_role !== 'pending').reduce((a, t) => a + t.transfers, 0);
  const byPartners = transfers
    .filter((t) => t.decided_by_role === 'current_partner' || t.decided_by_role === 'distributor')
    .reduce((a, t) => a + t.transfers, 0);

  return (
    <Shell actor={actor} current="/insights">
      <header className="pagehead">
        <div>
          <h1>Insights</h1>
          <p>Is the portal working? Renewals kept, money at risk, support time saved, and recurring revenue.</p>
        </div>
        <span className="pill warn">Simulated data · not Wingtra&apos;s</span>
      </header>

      <section aria-label="Headline numbers" className="stats">
        <div className="stat"><span>Renewal rate, last 12 months</span><strong>{pct(ended ? renewed / ended : null)}</strong></div>
        <div className="stat u30"><span>Expiring in 90 days, nobody renewing</span><strong>{chf(atRisk)}</strong></div>
        <div className="stat"><span>Transfers decided without support</span><strong>{decided ? `${byPartners} of ${decided}` : '-'}</strong></div>
      </section>

      <section aria-label="Renewal rate" className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Renewal rate by month</h2>
          <Legend />
        </div>
        <RenewalRateChart rows={monthly} />
        <p className="hint">Share of licences that expired that month and were renewed. Each point is {minN} to {maxN} licences, so single months are noisy; the gap between distributors is not.</p>
      </section>

      <section aria-label="Renewal risk" className="panel stack">
        <h2>Expiring in the next 90 days</h2>
        <RiskBars rows={risk} />
      </section>

      <section aria-label="Scorecard" className="stack">
        <h2>Distributor scorecard</h2>
        <div className="tablebox">
          <table>
            <thead>
              <tr>
                <th>Distributor</th><th>ARR</th><th>NRR 12m</th><th>GRR 12m</th><th>Renewal rate 12m</th><th>Asked after expiry</th><th>Median approval</th>
                <th>At risk 90d</th><th>Transfers without support</th>
              </tr>
            </thead>
            <tbody>
              {scorecard.map((s) => (
                <tr key={s.distributor_id}>
                  <td><strong>{s.distributor_name}</strong></td>
                  <td className="mono">{chf(s.arr_chf)}</td>
                  <td className="mono">{pct(s.nrr_12m)}</td>
                  <td className="mono">{pct(s.grr_12m)}</td>
                  <td className="mono">{pct(s.renewal_rate_12m)}</td>
                  <td className="mono">{pct(s.share_requested_late)}</td>
                  <td className="mono">{s.median_approval_hours === null ? '-' : `${s.median_approval_hours} h`}</td>
                  <td className="mono">{s.expiring_90d_no_request} · {chf(s.value_at_risk_chf)}</td>
                  <td className="mono">{pct(s.share_without_support)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <RecurringRevenue recurring={recurring} />

      <section aria-label="Transfers" className="stack">
        <h2>Who decides drone transfers</h2>
        <div className="tablebox">
          <table>
            <thead><tr><th>Decided by</th><th>Transfers</th><th>Median time to decide</th></tr></thead>
            <tbody>
              {(['current_partner', 'distributor', 'support', 'pending'] as const).map((role) => {
                const t = transfers.find((x) => x.decided_by_role === role);
                return (
                  <tr key={role}>
                    <td>{ROLE_LABEL[role]}</td>
                    <td className="mono">{t?.transfers ?? 0}</td>
                    <td className="mono">{t?.median_hours == null ? '-' : `${t.median_hours} h`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label="Call list" className="stack">
        <h2>This week&apos;s call list: expires within 30 days, no renewal started</h2>
        {callList.length === 0 ? (
          <p className="empty">Nothing urgent. Every licence expiring this month has a renewal under way.</p>
        ) : (
          <div className="tablebox">
            <table>
              <thead><tr><th>Licence</th><th>Product</th><th>Dealer</th><th>Expires</th><th>Value</th></tr></thead>
              <tbody>
                {callList.map((c) => (
                  <tr key={c.licence_code} className="b-30">
                    <td className="mono">{c.licence_code}</td>
                    <td>{c.product_name}</td>
                    <td>{tenantName(c.dealer_id)}</td>
                    <td><span className="mono">{c.expires_on}</span> <span className="days-30">· {c.days_left === 1 ? '1 day' : `${c.days_left} days`}</span></td>
                    <td className="mono">{chf(c.value_chf)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="note">
        Built with dbt on a simulated network (3 distributors, 9 dealers, ~580 licences, 3 years): staging → intermediate
        → marts, 51 data tests. Usage telemetry is simulated too. Prices are illustrative, not Wingtra&apos;s. Source: <span className="mono">analytics/</span>.
      </p>
    </Shell>
  );
}
