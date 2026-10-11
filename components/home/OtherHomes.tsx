import type { Actor } from '@/lib/actors';
import type { ExpiryRow, LeadRow } from '@/lib/db';
import type { RenewalRow } from '@/lib/renewals';
import { LicenceTable } from '../LicenceTable';
import { latestByLicence } from '../ui';

export function CustomerHome({ actor, licences, renewals }: { actor: Actor; licences: ExpiryRow[]; renewals: RenewalRow[] }) {
  return (
    <>
      <header className="pagehead">
        <div>
          <h1>Your licences</h1>
          <p>When they run out, and whether your dealer is already renewing them.</p>
        </div>
      </header>
      <LicenceTable actor={actor} licences={licences} latest={latestByLicence(renewals)} back="/" />
      <p className="note">Your dealer renews these for you. If one is close to expiring and shows no renewal, contact your dealer.</p>
    </>
  );
}

const LEAD_TONE: Record<LeadRow['status'], string> = {
  new: 'info',
  contacted: 'info',
  demo: 'warn',
  won: 'ok',
  lost: 'danger',
};

export function ReferralHome({ leads }: { leads: LeadRow[] }) {
  return (
    <>
      <header className="pagehead">
        <div>
          <h1>Your referred leads</h1>
          <p>The status of each company you introduced. You never see licences or customers&apos; data.</p>
        </div>
      </header>
      {leads.length === 0 ? (
        <p className="empty">No leads yet.</p>
      ) : (
        <div className="tablebox">
          <table>
            <thead><tr><th>Company</th><th>Status</th></tr></thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id}>
                  <td>{l.company}</td>
                  <td><span className={`pill ${LEAD_TONE[l.status]}`}>{l.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
