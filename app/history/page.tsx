import { redirect } from 'next/navigation';
import { getActor } from '@/lib/session';
import { getDroneEvents } from '@/lib/transfers';
import { Shell } from '@/components/Shell';
import { Flash, tenantName, type SearchParams } from '@/components/ui';

export const dynamic = 'force-dynamic';

const EVENT_LABEL: Record<string, { label: string; tone: string }> = {
  transfer_requested: { label: 'Transfer requested', tone: 'info' },
  transfer_approved: { label: 'Transfer approved', tone: 'ok' },
  transfer_rejected: { label: 'Transfer rejected', tone: 'danger' },
  licence_ended: { label: 'Licence ended (not transferable)', tone: 'warn' },
};

// El historial que hoy vive en un hilo de email de soporte.
export default async function History({ searchParams }: { searchParams: SearchParams }) {
  const [actor, params] = await Promise.all([getActor(), searchParams]);
  if (actor.role === 'Customer' || actor.role === 'Referral partner') redirect('/');

  const events = await getDroneEvents(actor);
  return (
    <Shell actor={actor} current="/history">
      <Flash params={params} />
      <header className="pagehead">
        <div>
          <h1>Drone history</h1>
          <p>Every change of hands, who decided it and when. Today this lives in a support email thread.</p>
        </div>
      </header>
      {events.length === 0 ? (
        <p className="empty">No changes of hands involving your drones yet.</p>
      ) : (
        <div className="tablebox">
          <table>
            <thead>
              <tr><th>When</th><th>Drone</th><th>Event</th><th>From</th><th>To</th><th>Decided by</th></tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const ev = EVENT_LABEL[e.event] ?? { label: e.event, tone: '' };
                return (
                  <tr key={e.id}>
                    <td className="mono">{e.at.toISOString().slice(0, 16).replace('T', ' ')}</td>
                    <td className="mono">{e.drone_serial}</td>
                    <td>
                      <span className={`pill ${ev.tone}`}>{ev.label}</span>
                      {e.licence_code ? <span className="mono"> {e.licence_code}</span> : null}
                    </td>
                    <td>{tenantName(e.from_tenant_id)}</td>
                    <td>{tenantName(e.to_tenant_id)}</td>
                    <td>{tenantName(e.decided_by)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
