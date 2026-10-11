import type { OutboxRow } from '@/lib/renewals';
import type { SaleOrder } from '@/lib/odoo';
import type { TransferImpactRow, TransferRow } from '@/lib/transfers';
import { runSyncAction, setOdooDownAction } from '@/app/actions';
import { TransferCard } from './DistributorHome';
import { tenantName } from '../ui';

type Props = { events: OutboxRow[]; orders: SaleOrder[]; odooDown: boolean; transfers: TransferRow[]; impact: TransferImpactRow[] };

export function PlatformHome({ events, orders, odooDown, transfers, impact }: Props) {
  const delivered = events.filter((e) => e.published_at !== null).length;
  const waiting = events.filter((e) => e.published_at === null && e.discarded_at === null).length;
  const decided = transfers.filter((t) => t.status !== 'pending');
  const byPartners = decided.filter((t) => t.decided_by !== 'wingtra-support').length;
  const escalated = transfers.filter((t) => t.overdue);

  return (
    <>
      <header className="pagehead">
        <div>
          <h1>Operations</h1>
          <p>What reached Odoo, what is waiting, and what still needs support.</p>
        </div>
        <div className="row">
          <form action={runSyncAction} className="inline">
            <input type="hidden" name="back" value="/" />
            <button type="submit" className="btn primary">Run sync now{waiting > 0 ? ` (${waiting})` : ''}</button>
          </form>
          <form action={setOdooDownAction} className="inline">
            <input type="hidden" name="back" value="/" />
            <input type="hidden" name="down" value={odooDown ? 'false' : 'true'} />
            <button type="submit" className="btn">{odooDown ? 'Bring Odoo back up' : 'Simulate Odoo outage'}</button>
          </form>
        </div>
      </header>

      <section aria-label="Network" className="stats">
        <div className="stat"><span>Renewals delivered to Odoo</span><strong>{delivered}</strong></div>
        <div className={`stat${waiting > 0 ? ' u60' : ''}`}><span>Waiting to reach Odoo</span><strong>{waiting}</strong></div>
        <div className="stat">
          <span>Transfers decided without support</span>
          <strong>{decided.length === 0 ? '-' : `${byPartners} of ${decided.length}`}</strong>
        </div>
      </section>

      <section aria-label="Needs support" className="stack">
        <h2>Needs support: no answer in 5 days</h2>
        {escalated.length === 0 ? (
          <p className="empty">Nothing escalated. Partners are answering their transfer requests.</p>
        ) : (
          escalated.map((t) => <TransferCard key={t.id} transfer={t} back="/" impact={impact.filter((i) => i.transfer_id === t.id)} />)
        )}
      </section>

      <section aria-label="Odoo sync" className="stack">
        <div className="row">
          <h2>Odoo sync</h2>
          <span className={`pill ${odooDown ? 'danger' : 'ok'}`}>Odoo (mock) is {odooDown ? 'down' : 'up'}</span>
        </div>
        {events.length === 0 ? (
          <p className="empty">No events yet. Approve a renewal as a distributor and it appears here.</p>
        ) : (
          <div className="tablebox">
            <table>
              <thead>
                <tr><th>Event</th><th>Licence</th><th>From</th><th>Attempts</th><th>Status</th></tr>
              </thead>
              <tbody>
                {events.map((e) => {
                  const order = orders.find((o) => o.client_ref === e.event_id);
                  return (
                    <tr key={e.event_id}>
                      <td className="mono">{e.event_type} · {e.event_id.slice(0, 8)}</td>
                      <td className="mono">{e.licence_code ?? '-'}</td>
                      <td>{tenantName(e.tenant_id)}</td>
                      <td className="mono">{e.attempts}</td>
                      <td>
                        {e.published_at ? (
                          <span className="pill ok">Delivered{order ? <span className="mono">· {order.name}</span> : null}</span>
                        ) : e.discarded_at ? (
                          <span className="pill danger" title={e.last_error ?? ''}>Discarded · request not approved</span>
                        ) : e.last_error ? (
                          <span className="pill warn" title={e.last_error}>
                            Retrying · {/unavailable/i.test(e.last_error) ? 'Odoo unavailable' : 'delivery error'}
                          </span>
                        ) : (
                          <span className="pill info">Waiting</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint">
          Each event carries its own ID as the Odoo order reference, so a retry after a crash finds the order instead of
          creating a second one.
        </p>
      </section>
    </>
  );
}
