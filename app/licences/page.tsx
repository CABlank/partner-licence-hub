import { redirect } from 'next/navigation';
import { getActor } from '@/lib/session';
import { getExpiry } from '@/lib/db';
import { getRenewals } from '@/lib/renewals';
import { Shell } from '@/components/Shell';
import { LicenceTable } from '@/components/LicenceTable';
import { ExpiryStats, Flash, latestByLicence, type SearchParams } from '@/components/ui';

export const dynamic = 'force-dynamic';

// Distribuidor ("Dealer licences") y Wingtra ("All licences"). Para un dealer
// o un cliente su inicio ya es esta tabla.
export default async function Licences({ searchParams }: { searchParams: SearchParams }) {
  const [actor, params] = await Promise.all([getActor(), searchParams]);
  if (actor.role !== 'Distributor' && actor.role !== 'Platform') redirect('/');

  const [licences, renewals] = await Promise.all([getExpiry(actor), getRenewals(actor)]);
  return (
    <Shell actor={actor} current="/licences">
      <Flash params={params} />
      <header className="pagehead">
        <div>
          <h1>{actor.role === 'Platform' ? 'All licences' : 'Your dealers’ licences'}</h1>
          <p>Every licence you can see, by expiry. The database decides which ones that is.</p>
        </div>
      </header>
      <ExpiryStats licences={licences} />
      <LicenceTable actor={actor} licences={licences} latest={latestByLicence(renewals)} back="/licences" />
    </Shell>
  );
}
