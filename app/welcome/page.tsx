import { getActor } from '@/lib/session';
import { switchActor } from '@/app/actions';
import { Shell } from '@/components/Shell';

export const dynamic = 'force-dynamic';

// La primera pantalla de quien llega por el enlace: qué es esto, de quién es,
// y un recorrido de 5 minutos. Un revisor da dos minutos; hay que guiarle.
export default async function Welcome() {
  const actor = await getActor();
  return (
    <Shell actor={actor} current="/welcome">
      <header className="pagehead">
        <div>
          <h1>Partner Licence Hub</h1>
          <p>
            A prototype of a portal where a drone maker&apos;s distributors and dealers renew software licences,
            transfer drones between partners, and see their recurring revenue.
          </p>
        </div>
      </header>

      <p className="note">
        Independent prototype by Carlos Blank, built to understand a manufacturer that sells through a two-tier channel.
        Not affiliated with or endorsed by Wingtra. All companies, licences, prices and numbers are fictional; the
        Insights page uses a simulated network.
      </p>

      <section aria-label="The problem" className="panel stack">
        <h2>The problem it works on</h2>
        <ul className="tour">
          <li><strong>Renewals</strong> <span>travel dealer → distributor → manufacturer → ERP, today by email.</span></li>
          <li><strong>Second-hand drones</strong> <span>get blocked when a new dealer configures them, and support decides by hand.</span></li>
          <li><strong>Partners compete</strong> <span>so each one must see only its own customers. The database enforces it, not the screens.</span></li>
          <li><strong>Software is recurring revenue</strong> <span>so the manufacturer needs ARR, retention and a renewal desk, with each customer attributed to its partner.</span></li>
        </ul>
      </section>

      <section aria-label="Suggested tour" className="panel stack">
        <h2>Suggested tour, about 5 minutes</h2>
        <ol className="tour">
          <li><strong>Dealer Valencia</strong> <span>sees licences by urgency. Click Request renewal on WR-1042.</span></li>
          <li><strong>Iberia Distribution</strong> <span>(switch at the top left) approves it. The sale order is queued.</span></li>
          <li><strong>Wingtra → Operations</strong> <span>Simulate an Odoo outage, run the sync (it retries, nothing is lost), bring Odoo back, sync again.</span></li>
          <li><strong>Back to Dealer Valencia</strong> <span>the licence is extended from its expiry date, with the Odoo order number.</span></li>
          <li><strong>Wingtra → Insights</strong> <span>renewal rate, ARR bridge, NRR and GRR, and a renewal desk whose risk signal is backtested.</span></li>
        </ol>
        <form action={switchActor} className="inline">
          <input type="hidden" name="actor" value="dealer-valencia" />
          <button type="submit" className="btn primary">Start as Dealer Valencia</button>
        </form>
        <p className="hint">Someone else may have clicked around before you. Reset demo (bottom left) puts everything back.</p>
      </section>

      <p className="hint">
        Next.js, TypeScript (strict, zod at every boundary), Postgres with row-level security, an outbox to the ERP,
        and dbt for the analytics. Design decisions and their trade-offs are in DECISIONS.md in the repository.
      </p>
    </Shell>
  );
}
