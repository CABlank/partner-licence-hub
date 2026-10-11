import type { Actor } from '@/lib/actors';
import type { ExpiryRow } from '@/lib/db';
import type { RenewalRow } from '@/lib/renewals';
import type { TransferImpactRow, TransferRow } from '@/lib/transfers';
import { decideRenewalAction, decideTransferAction } from '@/app/actions';
import { daysLabel, tenantName } from '../ui';

type Props = {
  actor: Actor;
  licences: ExpiryRow[];
  renewals: RenewalRow[];
  transfers: TransferRow[];
  dealerIds: ReadonlySet<string>;
  impact: TransferImpactRow[];
};

/** Cuántas cosas esperan a este distribuidor (para el contador del menú). */
export function distributorBadge(actor: Actor, renewals: RenewalRow[], transfers: TransferRow[], dealerIds: ReadonlySet<string>): number {
  return (
    renewals.filter((r) => r.status === 'pending' && r.distributor_id === actor.session.tenant).length +
    transfers.filter((t) => t.status === 'pending' && dealerIds.has(t.from_tenant_id)).length
  );
}

export function DistributorHome({ actor, licences, renewals, transfers, dealerIds, impact }: Props) {
  const pendingRenewals = renewals.filter((r) => r.status === 'pending' && r.distributor_id === actor.session.tenant);
  // Solo las que puede decidir: el dron es hoy de uno de SUS dealers.
  const pendingTransfers = transfers.filter((t) => t.status === 'pending' && dealerIds.has(t.from_tenant_id));
  const byCode = new Map(licences.map((l) => [l.code, l]));
  // Solo lo que hay que renovar a mano, y sin contar lo ya caducado.
  const within = (days: number) =>
    licences.filter((l) => l.renewal_mode === 'manual' && l.days_left >= 0 && l.days_left <= days).length;

  return (
    <>
      <header className="pagehead">
        <div>
          <h1>Waiting for your decision</h1>
          <p>You buy from Wingtra, so renewals from your dealers pass through you.</p>
        </div>
      </header>

      <section aria-label="Your network" className="stats">
        <div className="stat"><span>Licences across your dealers</span><strong>{licences.length}</strong></div>
        <div className="stat u30"><span>To renew within 30 days</span><strong>{within(30)}</strong></div>
        <div className="stat"><span>To renew within 90 days</span><strong>{within(90)}</strong></div>
      </section>

      <section aria-label="Renewal requests" className="stack">
        <h2>Renewal requests</h2>
        {pendingRenewals.length === 0 ? (
          <p className="empty">No renewals waiting. Requests from your dealers appear here.</p>
        ) : (
          pendingRenewals.map((r) => {
            const l = byCode.get(r.licence_code);
            return (
              <article key={r.id} className="card">
                <div className="body">
                  <div className="row">
                    <strong className="mono">{r.licence_code}</strong>
                    <strong>{r.product_name}</strong>
                    {l ? <span className={`pill ${l.days_left <= 30 ? 'danger' : 'warn'}`}>{daysLabel(l)} left</span> : null}
                  </div>
                  <span>{r.customer_name ?? 'Demo unit'} · requested by {tenantName(r.dealer_id)}</span>
                </div>
                <form action={decideRenewalAction} className="inline">
                  <input type="hidden" name="request" value={r.id} />
                  <input type="hidden" name="back" value="/" />
                  <button type="submit" name="decision" value="approved" className="btn primary">Approve</button>
                  <button type="submit" name="decision" value="rejected" className="btn">Reject</button>
                </form>
              </article>
            );
          })
        )}
        <p className="hint">
          Approving creates the sale order in Wingtra&apos;s Odoo under your account. If Odoo is down, the order waits and
          retries; it is never lost or sent twice.
        </p>
      </section>

      <section aria-label="Drone transfers" className="stack">
        <h2>Drone transfers</h2>
        {pendingTransfers.length === 0 ? (
          <p className="empty">No transfer requests for your dealers&apos; drones.</p>
        ) : (
          pendingTransfers.map((t) => (
            <TransferCard key={t.id} transfer={t} back="/" impact={impact.filter((i) => i.transfer_id === t.id)} />
          ))
        )}
      </section>
    </>
  );
}

type ImpactProps = { transfer: TransferRow; back: '/'; impact?: TransferImpactRow[] };

export function TransferCard({ transfer: t, back, impact = [] }: ImpactProps) {
  const moves = impact.filter((i) => i.transferable);
  const ends = impact.filter((i) => !i.transferable);
  const daysLeft = Math.ceil((t.due_at.getTime() - Date.now()) / 86_400_000);
  return (
    <article className={`card${t.overdue ? ' alert' : ''}`}>
      <div className="body">
        <div className="row">
          <strong className="mono">{t.drone_serial}</strong>
          <strong>{tenantName(t.from_tenant_id)} → {tenantName(t.to_tenant_id)}</strong>
          {t.overdue ? (
            <span className="pill danger">Overdue · Wingtra support may decide</span>
          ) : (
            <span className="pill info">{daysLeft === 1 ? '1 day' : `${daysLeft} days`} to decide</span>
          )}
        </div>
        <span>&ldquo;{t.reason}&rdquo;</span>
        {impact.length > 0 ? (
          <ul className="impact" aria-label="What happens to this drone's licences">
            {moves.map((i) => (
              <li key={i.licence_code}><span className="pill ok">Moves</span> <span className="mono">{i.licence_code}</span> {i.product_name}</li>
            ))}
            {ends.map((i) => (
              <li key={i.licence_code}>
                <span className="pill danger">Ends</span> <span className="mono">{i.licence_code}</span> {i.product_name}: not
                transferable, the new owner has to take out their own
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <form action={decideTransferAction} className="inline">
        <input type="hidden" name="transfer" value={t.id} />
        <input type="hidden" name="back" value={back} />
        <button type="submit" name="decision" value="approved" className="btn primary">Approve transfer</button>
        <button type="submit" name="decision" value="rejected" className="btn">Reject</button>
      </form>
    </article>
  );
}
