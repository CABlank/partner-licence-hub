import { redirect } from 'next/navigation';
import { getActor } from '@/lib/session';
import { DroneSerial, droneClaimStatus, getTransfers, type ClaimStatus } from '@/lib/transfers';
import { requestTransferAction } from '@/app/actions';
import { Shell } from '@/components/Shell';
import { Flash, type SearchParams } from '@/components/ui';

export const dynamic = 'force-dynamic';

// "Configure drones" (Figma, sección 2): hoy, un Drone ID de otro partner
// bloquea y obliga a escribir a soporte. Aquí se convierte en una solicitud.
export default async function Drones({ searchParams }: { searchParams: SearchParams }) {
  const [actor, params] = await Promise.all([getActor(), searchParams]);
  if (actor.role !== 'Dealer') redirect('/');

  const parsed = DroneSerial.safeParse(params.serial);
  const serial = parsed.success ? parsed.data : null;
  const badInput = typeof params.serial === 'string' && params.serial !== '' && !parsed.success;

  const [status, transfers] = await Promise.all([
    serial ? droneClaimStatus(actor, serial) : Promise.resolve<ClaimStatus | null>(null),
    getTransfers(actor),
  ]);
  const mine = transfers.filter((t) => t.to_tenant_id === actor.session.tenant);
  const pendingForSerial = serial ? mine.find((t) => t.drone_serial === serial && t.status === 'pending') : undefined;

  return (
    <Shell actor={actor} current="/drones">
      <Flash params={params} />
      <header className="pagehead">
        <div>
          <h1>Configure a drone</h1>
          <p>Enter the Drone ID from the airframe label to add licences to it.</p>
        </div>
      </header>

      <form method="get" className="panel row" style={{ alignItems: 'flex-end', gap: 12 }}>
        <div className="field" style={{ flex: '1 1 260px' }}>
          <label htmlFor="serial">Drone ID</label>
          <input id="serial" name="serial" className="mono" defaultValue={serial ?? ''} placeholder="WG-20881" autoComplete="off" />
        </div>
        <button type="submit" className="btn primary">Check drone</button>
      </form>

      {badInput ? <p className="flash error" role="alert">Drone IDs look like WG-20881.</p> : null}

      {serial && status === 'yours' ? (
        <p className="flash ok" role="status">{serial} is registered to you. You can add licences to it.</p>
      ) : null}
      {serial && status === 'unknown' ? (
        <p className="flash error" role="alert">{serial} is not a registered drone. Check the label on the airframe.</p>
      ) : null}

      {serial && status === 'other_partner' && pendingForSerial ? (
        <section aria-label="Request sent" className="panel stack" style={{ gap: 20 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Transfer requested for <span className="mono">{serial}</span></h2>
            <span className="pill warn">Pending</span>
          </div>
          <ol className="steps">
            <li className="done"><small>{pendingForSerial.created_at.toISOString().slice(0, 10)} · done</small><span>You asked, with a reason</span></li>
            <li className="now"><small>by {pendingForSerial.due_at.toISOString().slice(0, 10)}</small><span>Current partner or their distributor decides</span></li>
            <li><small>only if no answer</small><span>Wingtra support decides</span></li>
          </ol>
          <p className="hint">
            When it is approved, the drone and its transferable licences move to you; protection plans like WingtraCARE
            end with the old owner. Every step is kept in the drone&apos;s history.
          </p>
        </section>
      ) : null}

      {serial && status === 'other_partner' && !pendingForSerial ? (
        <div className="split">
          <section aria-label="Today" className="before">
            <span className="eyebrow">Today</span>
            <h2>Blocked. Email support.</h2>
            <p style={{ margin: 0 }}>
              The drone was configured by another partner. A support engineer works out who the owner is and grants
              permission by hand.
            </p>
            <ul>
              <li>No status while you wait</li>
              <li>The customer is waiting too</li>
              <li>The decision lives in an email thread</li>
            </ul>
          </section>
          <section aria-label="Transfer request" className="panel stack" style={{ gap: 16 }}>
            <span className="eyebrow accent">This prototype</span>
            <h2>{serial} is registered to another partner</h2>
            <p style={{ margin: 0, color: 'var(--ink-2)' }}>
              Ask for a transfer. The partner who has it, or their distributor, decides: they know whether the customer
              really moved. Wingtra support steps in only if nobody answers within 5 days.
            </p>
            <form action={requestTransferAction} className="stack" style={{ gap: 16 }}>
              <input type="hidden" name="serial" value={serial} />
              <input type="hidden" name="back" value="/drones" />
              <div className="field">
                <label htmlFor="reason">Why should this drone move to you?</label>
                <textarea id="reason" name="reason" rows={3} minLength={5} maxLength={500} required placeholder="Minas del Sur moved its account to us." />
              </div>
              <div className="row">
                <button type="submit" className="btn accent">Request transfer</button>
                <a href="/drones" className="btn" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>Cancel</a>
              </div>
            </form>
            <p className="hint">
              You will not see who owns it or which customer it belongs to. Licences that can move go with the drone;
              protection plans like WingtraCARE do not transfer and end with the old owner.
            </p>
          </section>
        </div>
      ) : null}

      <section aria-label="Your transfer requests" className="stack">
        <h2>Your transfer requests</h2>
        {mine.length === 0 ? (
          <p className="empty">None yet. Check a Drone ID above.</p>
        ) : (
          <div className="tablebox">
            <table>
              <thead><tr><th>Drone</th><th>Asked</th><th>Reason</th><th>Status</th></tr></thead>
              <tbody>
                {mine.map((t) => (
                  <tr key={t.id}>
                    <td className="mono">{t.drone_serial}</td>
                    <td className="mono">{t.created_at.toISOString().slice(0, 10)}</td>
                    <td style={{ whiteSpace: 'normal' }}>{t.reason}</td>
                    <td>
                      <span className={`pill ${t.status === 'approved' ? 'ok' : t.status === 'rejected' ? 'danger' : t.overdue ? 'danger' : 'warn'}`}>
                        {t.status === 'pending' ? (t.overdue ? 'Overdue · with support' : 'Pending') : t.status === 'approved' ? 'Approved' : 'Rejected'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Shell>
  );
}
