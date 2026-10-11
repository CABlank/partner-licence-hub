import type { MonthlyRateRow, RiskRow } from '@/lib/analytics';

// Gráficos en SVG hechos en el servidor: sin librería ni JavaScript en el
// navegador. Cada serie se distingue por color Y por trazo (continuo,
// discontinuo, punteado), así se lee también sin distinguir colores.

export const SERIES: Record<string, { name: string; color: string; dash: string }> = {
  iberia: { name: 'Iberia', color: '#101a26', dash: '' },
  dach: { name: 'DACH', color: '#1d4ed8', dash: '7 4' },
  nordic: { name: 'Nordic', color: '#c2410c', dash: '2 4' },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthLabel(iso: string): string {
  const [y, m] = iso.split('-');
  return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
}

export function Legend() {
  return (
    <div className="legend">
      {Object.entries(SERIES).map(([id, s]) => (
        <span key={id}>
          <svg width="28" height="10" aria-hidden="true">
            <line x1="0" y1="5" x2="28" y2="5" stroke={s.color} strokeWidth="2.5" strokeDasharray={s.dash} />
          </svg>
          {s.name}
        </span>
      ))}
    </div>
  );
}

/**
 * Tasa de renovación mensual por distribuidor. Eje Y de 0 % a 100 %: un eje
 * recortado obligaba a pegar al suelo los meses malos, y eso escondía datos.
 */
export function RenewalRateChart({ rows }: { rows: MonthlyRateRow[] }) {
  const months = [...new Set(rows.map((r) => r.month))].sort();
  const W = 720;
  const H = 260;
  const pad = { l: 44, r: 12, t: 12, b: 32 };
  const yMin = 0;
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(months.length - 1, 1);
  const y = (v: number) => pad.t + ((1 - (v - yMin) / (1 - yMin)) * (H - pad.t - pad.b));
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Monthly renewal rate by distributor">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#e4e8ec" />
          <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="axis">{Math.round(t * 100)}%</text>
        </g>
      ))}
      {months.map((m, i) =>
        i % 2 === 0 ? (
          <text key={m} x={x(i)} y={H - 10} textAnchor="middle" className="axis">{monthLabel(m)}</text>
        ) : null,
      )}
      {Object.entries(SERIES).map(([id, s]) => {
        const points = months
          .map((m, i) => {
            const r = rows.find((row) => row.month === m && row.distributor_id === id);
            return r && r.renewal_rate !== null ? { i, v: r.renewal_rate, r } : null;
          })
          .filter((p): p is NonNullable<typeof p> => p !== null);
        return (
          <g key={id}>
            <polyline
              points={points.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth="2.5"
              strokeDasharray={s.dash}
            />
            {points.map((p) => (
              <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r="3.5" fill={s.color}>
                <title>{`${s.name}, ${monthLabel(months[p.i])}: ${Math.round((p.r.renewal_rate ?? 0) * 100)}% of ${p.r.terms_ended} licences`}</title>
              </circle>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/** Lo que caduca en 90 días, por distribuidor: con solicitud en marcha frente a sin nadie moviéndose. */
export function RiskBars({ rows }: { rows: RiskRow[] }) {
  const ids = Object.keys(SERIES);
  const totals = ids.map((id) => rows.filter((r) => r.distributor_id === id).reduce((a, r) => a + r.with_request + r.without_request, 0));
  const max = Math.max(...totals, 1);
  return (
    <div className="bars" role="list">
      {ids.map((id) => {
        const mine = rows.filter((r) => r.distributor_id === id);
        const without = mine.reduce((a, r) => a + r.without_request, 0);
        const urgent = mine.filter((r) => r.bucket === '0-30').reduce((a, r) => a + r.without_request, 0);
        const withReq = mine.reduce((a, r) => a + r.with_request, 0);
        return (
          <div key={id} className="barrow" role="listitem">
            <span className="barlabel">{SERIES[id].name}</span>
            <div className="bartrack" aria-hidden="true">
              <span className="seg urgent" style={{ width: `${(urgent / max) * 100}%` }} />
              <span className="seg none" style={{ width: `${((without - urgent) / max) * 100}%` }} />
              <span className="seg ok" style={{ width: `${(withReq / max) * 100}%` }} />
            </div>
            <span className="barvalue">
              <strong>{without}</strong> without a request ({urgent} within 30 days) · {withReq} under way
            </span>
          </div>
        );
      })}
      <div className="legend">
        <span><i className="sw urgent" />No request, expires within 30 days</span>
        <span><i className="sw none" />No request, 31 to 90 days</span>
        <span><i className="sw ok" />Renewal under way</span>
      </div>
    </div>
  );
}
