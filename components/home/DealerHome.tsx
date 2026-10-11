import type { Actor } from '@/lib/actors';
import type { ExpiryRow } from '@/lib/db';
import type { RenewalRow } from '@/lib/renewals';
import { LicenceTable } from '../LicenceTable';
import { ExpiryStats, latestByLicence } from '../ui';

type Props = { actor: Actor; licences: ExpiryRow[]; renewals: RenewalRow[]; today: string; networkSize: number };

export function DealerHome({ actor, licences, renewals, today, networkSize }: Props) {
  return (
    <>
      <header className="pagehead">
        <div>
          <h1>Licences by expiry</h1>
          <p>Who needs to act before a customer&apos;s licence runs out.</p>
        </div>
        <span className="mono muted">Today · {today}</span>
      </header>

      <ExpiryStats licences={licences} />
      <LicenceTable actor={actor} licences={licences} latest={latestByLicence(renewals)} back="/" />

      <ol className="steps" aria-label="How a renewal travels">
        <li className="done"><small>01 · You</small><span>Request renewal</span></li>
        <li><small>02 · Your distributor</small><span>Approves the order</span></li>
        <li><small>03 · Wingtra</small><span>Sale order created in Odoo</span></li>
        <li><small>04 · Customer</small><span>Licence extended, no lost days</span></li>
      </ol>

      <p className="note">
        You see <strong>{licences.length} of {networkSize}</strong> licences in the network. The database enforces this with
        row-level security, so a missing filter in the app shows an empty list, never another dealer&apos;s customers.
      </p>
    </>
  );
}
