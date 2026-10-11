import type { ReactNode } from 'react';
import type { Actor } from '@/lib/actors';
import { ActorSelect } from '@/components/ActorSelect';
import { resetDemoAction, switchActor } from '@/app/actions';

export type Path = '/' | '/drones' | '/licences' | '/history' | '/insights' | '/welcome';
type IconName = 'table' | 'drone' | 'check' | 'ops' | 'history' | 'leads' | 'chart';
type NavItem = { href: Path; label: string; icon: IconName };

const NAV: Record<Actor['role'], NavItem[]> = {
  Dealer: [
    { href: '/', label: 'Licences', icon: 'table' },
    { href: '/drones', label: 'Configure drones', icon: 'drone' },
    { href: '/history', label: 'Drone history', icon: 'history' },
  ],
  Distributor: [
    { href: '/', label: 'Approvals', icon: 'check' },
    { href: '/licences', label: 'Dealer licences', icon: 'table' },
    { href: '/history', label: 'Drone history', icon: 'history' },
  ],
  Platform: [
    { href: '/', label: 'Operations', icon: 'ops' },
    { href: '/insights', label: 'Insights', icon: 'chart' },
    { href: '/licences', label: 'All licences', icon: 'table' },
    { href: '/history', label: 'Drone history', icon: 'history' },
  ],
  Customer: [{ href: '/', label: 'Your licences', icon: 'table' }],
  'Referral partner': [{ href: '/', label: 'Your leads', icon: 'leads' }],
};

const SUBTITLE: Record<Actor['id'], string> = {
  wingtra: 'Platform · sees the whole network',
  iberia: 'Distributor · 2 dealers',
  'dealer-valencia': 'Dealer · under Iberia Distribution',
  'dealer-barcelona': 'Dealer · under Iberia Distribution',
  'dealer-oslo': 'Dealer · under Nordic Distribution',
  'ayto-valencia': 'Customer of Dealer Valencia',
  'survey-leads': 'Referral partner · Iberia',
};

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    table: (<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 4v16" /></>),
    drone: (<><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><circle cx="12" cy="12" r="4" /></>),
    check: (<><path d="M4 13l3 3 5-6" /><path d="M12 16l2 2 6-8" /></>),
    ops: (<><path d="M4 7h16M4 12h10M4 17h6" /><circle cx="18" cy="16" r="3" /></>),
    history: (<><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4M9 13h7M9 17h5" /></>),
    chart: (<><path d="M4 20V4M4 20h16" /><path d="M7 15l4-4 3 3 5-6" /></>),
    leads: (<><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 3-5 6-5s6 2 6 5M17 11l2 2 3-4" /></>),
  };
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

type Props = { actor: Actor; current: Path; badge?: number; children: ReactNode };

export function Shell({ actor, current, badge = 0, children }: Props) {
  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <div className="brand">
          <strong>Partner Licence Hub</strong>
          <span>Independent prototype by Carlos Blank · fictional data</span>
        </div>

        <form action={switchActor} className="who">
          <label htmlFor="actor">Signed in as</label>
          <ActorSelect current={actor.id} />
          <small>{SUBTITLE[actor.id]}</small>
          {/* Sin JavaScript el select no se envía solo: el botón queda de respaldo. */}
          <noscript><button type="submit" className="btn small">Switch</button></noscript>
        </form>

        <div className="navlinks">
          {NAV[actor.role].map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="navlink"
              aria-current={item.href === current ? 'page' : undefined}
            >
              <Icon name={item.icon} />
              {item.label}
              {item.href === '/' && badge > 0 ? <span className="badge">{badge}</span> : null}
            </a>
          ))}
        </div>

        <div className="navfoot">
          <a href="/welcome" className="navlink" aria-current={current === '/welcome' ? 'page' : undefined}>
            Start here: what this is
          </a>
          <form action={resetDemoAction}>
            <input type="hidden" name="back" value={current} />
            <button type="submit" className="btn small">Reset demo</button>
          </form>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
