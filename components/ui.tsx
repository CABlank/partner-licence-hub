import type { ExpiryRow } from '@/lib/db';
import type { RenewalRow } from '@/lib/renewals';
import { ERRORS, ErrorCode, NOTICES, NoticeCode } from '@/lib/messages';

const WARN_NOTICES: ReadonlySet<NoticeCode> = new Set<NoticeCode>(['sync_failed', 'odoo_down']);

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** El aviso tras una acción. Solo códigos conocidos; cualquier otra cosa se ignora. */
export function Flash({ params }: { params: Record<string, string | string[] | undefined> }) {
  const notice = NoticeCode.safeParse(params.notice);
  const error = ErrorCode.safeParse(params.error);
  if (error.success) return <p className="flash error" role="alert">{ERRORS[error.data]}</p>;
  if (notice.success) {
    // Algunos avisos no son un éxito aunque la acción funcionara: Odoo caído.
    const tone = WARN_NOTICES.has(notice.data) ? 'warn' : 'ok';
    return <p className={`flash ${tone}`} role="status">{NOTICES[notice.data]}</p>;
  }
  return null;
}

export function daysLabel(l: ExpiryRow): string {
  if (l.days_left < 0) return `expired ${-l.days_left} days ago`;
  return l.days_left === 1 ? '1 day' : `${l.days_left} days`;
}

/**
 * Contadores de urgencia. Solo cuentan licencias que alguien tiene que renovar
 * (manuales): WingtraCARE se renueva sola y LIDAR sigue funcionando, así que
 * meterlas inflaría la urgencia con cosas que no requieren acción.
 */
export function ExpiryStats({ licences }: { licences: ExpiryRow[] }) {
  const manual = licences.filter((l) => l.renewal_mode === 'manual');
  const count = (b: ExpiryRow['bucket']) => manual.filter((l) => l.bucket === b).length;
  return (
    <section aria-label="Renewals due" className="stats">
      <div className="stat"><span>Expired</span><strong>{count('expired')}</strong></div>
      <div className="stat u30"><span>Within 30 days</span><strong>{count('30')}</strong></div>
      <div className="stat u60"><span>31 to 60 days</span><strong>{count('60')}</strong></div>
      <div className="stat"><span>61 to 90 days</span><strong>{count('90')}</strong></div>
    </section>
  );
}

const RENEWAL_PILL: Record<RenewalRow['status'], { label: string; tone: string }> = {
  pending: { label: 'Waiting for distributor', tone: 'info' },
  approved: { label: 'Approved · sending to Odoo', tone: 'warn' },
  rejected: { label: 'Rejected by distributor', tone: 'danger' },
  ordered: { label: 'Renewed', tone: 'ok' },
};

export function RenewalPill({ renewal }: { renewal: RenewalRow }) {
  const p = RENEWAL_PILL[renewal.status];
  return (
    <span className={`pill ${p.tone}`}>
      {p.label}
      {renewal.odoo_order_ref ? <span className="mono">· {renewal.odoo_order_ref}</span> : null}
    </span>
  );
}

/** La última solicitud de cada licencia (las filas vienen ordenadas, más reciente primero). */
export function latestByLicence(renewals: RenewalRow[]): Map<string, RenewalRow> {
  const map = new Map<string, RenewalRow>();
  for (const r of renewals) if (!map.has(r.licence_code)) map.set(r.licence_code, r);
  return map;
}

// Nombres legibles para los ids de la demo. Los ids se quedan en la base
// porque se leen bien en tests y SQL; en pantalla, nombres.
const TENANT_NAME: Record<string, string> = {
  iberia: 'Iberia Distribution',
  nordic: 'Nordic Distribution',
  'dealer-valencia': 'Dealer Valencia',
  'dealer-barcelona': 'Dealer Barcelona',
  'dealer-oslo': 'Dealer Oslo',
  // Solo en la red simulada de Insights:
  dach: 'DACH Distribution',
  'dealer-madrid': 'Dealer Madrid',
  'dealer-lisboa': 'Dealer Lisboa',
  'dealer-stockholm': 'Dealer Stockholm',
  'dealer-zurich': 'Dealer Zurich',
  'dealer-munich': 'Dealer Munich',
  'dealer-vienna': 'Dealer Vienna',
  'survey-leads': 'Survey Leads',
  'wingtra-support': 'Wingtra support',
};

export function tenantName(id: string | null): string {
  if (id === null) return '-';
  return TENANT_NAME[id] ?? id;
}
