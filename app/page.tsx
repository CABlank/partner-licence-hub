import { redirect } from 'next/navigation';
import { getActor, hasChosenActor } from '@/lib/session';
import { getExpiry, getLeads, getNetworkSize, getTenants, getToday } from '@/lib/db';
import { getOutbox, getRenewals } from '@/lib/renewals';
import { getTransferImpact, getTransfers } from '@/lib/transfers';
import { isOdooDown, listSaleOrders } from '@/lib/odoo';
import { Shell } from '@/components/Shell';
import { Flash, type SearchParams } from '@/components/ui';
import { DealerHome } from '@/components/home/DealerHome';
import { DistributorHome, distributorBadge } from '@/components/home/DistributorHome';
import { PlatformHome } from '@/components/home/PlatformHome';
import { CustomerHome, ReferralHome } from '@/components/home/OtherHomes';

export const dynamic = 'force-dynamic';

// Una sola entrada; cada rol ve su pantalla de inicio.
export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  // Primera visita (nadie ha elegido actor): antes de nada, qué es esto.
  if (!(await hasChosenActor())) redirect('/welcome');
  const [actor, params] = await Promise.all([getActor(), searchParams]);
  const flash = <Flash params={params} />;

  switch (actor.role) {
    case 'Dealer': {
      const [licences, renewals, today, networkSize] = await Promise.all([
        getExpiry(actor),
        getRenewals(actor),
        getToday(actor),
        getNetworkSize(actor),
      ]);
      return (
        <Shell actor={actor} current="/">
          {flash}
          <DealerHome actor={actor} licences={licences} renewals={renewals} today={today} networkSize={networkSize} />
        </Shell>
      );
    }
    case 'Distributor': {
      const [licences, renewals, transfers, tenants, impact] = await Promise.all([
        getExpiry(actor),
        getRenewals(actor),
        getTransfers(actor),
        getTenants(actor),
        getTransferImpact(actor),
      ]);
      const dealerIds = new Set(tenants.filter((t) => t.parent_id === actor.session.tenant).map((t) => t.id));
      return (
        <Shell actor={actor} current="/" badge={distributorBadge(actor, renewals, transfers, dealerIds)}>
          {flash}
          <DistributorHome actor={actor} licences={licences} renewals={renewals} transfers={transfers} dealerIds={dealerIds} impact={impact} />
        </Shell>
      );
    }
    case 'Platform': {
      const [events, orders, odooDown, transfers, impact] = await Promise.all([
        getOutbox(actor),
        listSaleOrders(),
        isOdooDown(),
        getTransfers(actor),
        getTransferImpact(actor),
      ]);
      return (
        <Shell actor={actor} current="/" badge={transfers.filter((t) => t.overdue).length}>
          {flash}
          <PlatformHome events={events} orders={orders} odooDown={odooDown} transfers={transfers} impact={impact} />
        </Shell>
      );
    }
    case 'Customer': {
      const [licences, renewals] = await Promise.all([getExpiry(actor), getRenewals(actor)]);
      return (
        <Shell actor={actor} current="/">
          {flash}
          <CustomerHome actor={actor} licences={licences} renewals={renewals} />
        </Shell>
      );
    }
    case 'Referral partner': {
      const leads = await getLeads(actor);
      return (
        <Shell actor={actor} current="/">
          {flash}
          <ReferralHome leads={leads} />
        </Shell>
      );
    }
  }
}
