import type { Actor } from '@/lib/actors';
import type { ExpiryRow } from '@/lib/db';
import type { RenewalRow } from '@/lib/renewals';
import { requestRenewalAction } from '@/app/actions';
import { daysLabel, RenewalPill, tenantName } from './ui';
import type { Path } from './Shell';

const RENEWABLE: ReadonlySet<ExpiryRow['bucket']> = new Set(['expired', '30', '60', '90']);
const OPEN: ReadonlySet<RenewalRow['status']> = new Set(['pending', 'approved']);

type Props = {
  actor: Actor;
  licences: ExpiryRow[];
  latest: Map<string, RenewalRow>;
  back: Path;
};

export function LicenceTable({ actor, licences, latest, back }: Props) {
  const isDealer = actor.role === 'Dealer';
  const isCustomer = actor.role === 'Customer';
  const showDealer = !isDealer && !isCustomer;

  if (licences.length === 0) return <p className="empty">No licences to show.</p>;

  return (
    <section aria-label="Licences" className="tablebox">
      <table>
        <thead>
          <tr>
            <th>Licence</th>
            <th>Product</th>
            <th>Drone</th>
            {showDealer ? <th>Dealer</th> : null}
            {isCustomer ? null : <th>Customer</th>}
            <th>Expires</th>
            {isCustomer ? null : <th>Who acts</th>}
            <th><span className="sr-only">Renewal</span></th>
          </tr>
        </thead>
        <tbody>
          {licences.map((l) => {
            const renewal = latest.get(l.code);
            const open = renewal !== undefined && OPEN.has(renewal.status);
            // Solo se pide renovar lo que es MANUAL. CARE se renueva sola y
            // LIDAR es perpetua: un botón ahí crearía un pedido duplicado.
            const canRequest =
              isDealer && l.renewal_mode === 'manual' && RENEWABLE.has(l.bucket) && l.customer_name !== null && !open;
            return (
              <tr key={l.code} className={`b-${l.bucket}`}>
                <td className="mono">{l.code}</td>
                <td>{l.product_name}</td>
                <td className="mono">{l.drone_serial ?? '-'}</td>
                {showDealer ? <td>{tenantName(l.dealer_id)}</td> : null}
                {isCustomer ? null : <td>{l.customer_name ?? <span className="muted">Demo unit</span>}</td>}
                <td>
                  <span className="mono">{l.expires_on}</span>{' '}
                  <span className={`days-${l.bucket}`}>· {daysLabel(l)}</span>
                </td>
                {isCustomer ? null : <td>{whoActs(l.who_acts)}</td>}
                <td className="end">
                  {canRequest ? (
                    <form action={requestRenewalAction} className="inline">
                      <input type="hidden" name="licence" value={l.code} />
                      <input type="hidden" name="back" value={back} />
                      <button type="submit" className="btn primary small">Request renewal</button>
                    </form>
                  ) : renewal ? (
                    <RenewalPill renewal={renewal} />
                  ) : l.renewal_mode === 'auto' && l.opt_out_by ? (
                    <span className="pill info" title="Renews automatically unless the customer opts out">
                      Auto-renews · opt-out by <span className="mono">{l.opt_out_by}</span>
                    </span>
                  ) : l.renewal_mode === 'perpetual' && RENEWABLE.has(l.bucket) ? (
                    <span className="pill warn" title="Keeps working; updates and support end on this date">
                      Keeps working · updates end
                    </span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function whoActs(raw: string): string {
  const map: Record<string, string> = {
    'dealer + distributor': 'Dealer + distributor',
    dealer: 'Dealer',
    'none yet': 'Nobody yet',
    'none (demo unit)': 'Nobody (demo unit)',
    'none (auto-renews)': 'Nobody (auto-renews)',
    'dealer (offer updates)': 'Dealer (offer updates)',
  };
  return map[raw] ?? raw;
}
