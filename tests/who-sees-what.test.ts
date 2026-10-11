// La tabla "Ve / No ve" del Figma, probada a través del código de la app.
//
// Los tests SQL de db/ prueban las políticas. Estos prueban además el cableado:
// que withSession declara la sesión correcta para cada actor. Si alguien rompe
// set_config en lib/db.ts, fallan aquí aunque las políticas estén bien.
//
// Requisito: docker compose up -d y la base cargada (ver README).

import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { findActor, type Actor } from '@/lib/actors';
import { getExpiry, getLeads, pool, queryRows, withSession } from '@/lib/db';

const CodeRow = z.object({ code: z.string() });
const CountRow = z.object({ n: z.number().int() });

afterAll(async () => {
  await pool.end();
});

async function codesFor(actor: Actor): Promise<string[]> {
  const rows = await getExpiry(actor);
  return rows.map((r) => r.code).sort();
}

describe('who sees what (Figma, section 4)', () => {
  it.each([
    ['wingtra', ['WC-0881', 'WC-1042', 'WO-0881', 'WO-0882', 'WR-1042', 'WR-1043', 'WR-2210']],
    ['iberia', ['WC-0881', 'WC-1042', 'WO-0881', 'WO-0882', 'WR-1042', 'WR-1043']],
    ['dealer-valencia', ['WC-1042', 'WR-1042', 'WR-1043']],
    ['dealer-oslo', ['WR-2210']],
    ['ayto-valencia', ['WC-1042', 'WR-1042']],
    ['survey-leads', []],
  ])('%s sees exactly %j', async (actorId, expected) => {
    // toEqual con la lista exacta: comprueba lo que ve y, a la vez, lo que NO ve.
    expect(await codesFor(findActor(actorId))).toEqual(expected);
  });

  it('a distributor never sees another distributor’s licences', async () => {
    expect(await codesFor(findActor('iberia'))).not.toContain('WR-2210');
  });

  it('the referral partner sees the status of its lead, nothing else', async () => {
    const leads = await getLeads(findActor('survey-leads'));
    expect(leads.map((l) => [l.company, l.status])).toEqual([['Topografía Levante', 'demo']]);
  });

  it('an unknown actor id falls back to the default, never to full access', async () => {
    const actor = findActor('admin');
    expect(actor.id).toBe('dealer-valencia');
    expect(actor.session.actor).toBeUndefined();
  });
});

describe('sessions do not leak between requests', () => {
  it('no session declared returns zero rows, not all rows', async () => {
    const client = await pool.connect();
    try {
      const rows = await queryRows(client, CodeRow, 'SELECT code FROM licence_expiry');
      expect(rows).toHaveLength(0);
    } finally {
      client.release();
    }
  });

  it('a pooled connection does not inherit the previous actor', async () => {
    // Una conexión primero como Wingtra (ve todo) y después sin sesión.
    // Con SET en vez de SET LOCAL, la segunda consulta vería 5 filas.
    await withSession(findActor('wingtra'), (c) => c.query('SELECT 1'));
    const results = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const client = await pool.connect();
        try {
          const [row] = await queryRows(client, CountRow, 'SELECT count(*)::int AS n FROM licences');
          return row.n;
        } finally {
          client.release();
        }
      }),
    );
    expect(results.every((n) => n === 0)).toBe(true);
  });
});

describe('expiry panel', () => {
  it('buckets and who acts, as Dealer Valencia', async () => {
    const rows = await getExpiry(findActor('dealer-valencia'));
    expect(rows.map((r) => [r.code, r.bucket, r.who_acts])).toEqual([
      ['WR-1042', '30', 'dealer + distributor'],
      ['WC-1042', '60', 'none (auto-renews)'],
      ['WR-1043', '60', 'dealer'],
    ]);
  });

  it('dates come back as YYYY-MM-DD, without a timezone shift', async () => {
    const [row] = await getExpiry(findActor('ayto-valencia'));
    expect(row.expires_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const expected = new Date(Date.now() + row.days_left * 86_400_000);
    // Compara con la fecha local de hoy + días restantes.
    const local = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`;
    expect(row.expires_on).toBe(local);
  });
});

describe('each product follows its own mechanics (catalogue table)', () => {
  it('WingtraCARE auto-renews: nobody acts, and the opt-out deadline is 30 days before', async () => {
    const care = (await getExpiry(findActor('dealer-valencia'))).find((r) => r.code === 'WC-1042');
    expect(care?.renewal_mode).toBe('auto');
    expect(care?.who_acts).toBe('none (auto-renews)');
    expect(care?.transferable).toBe(false);
    const expires = new Date(`${care?.expires_on}T00:00:00Z`).getTime();
    const optOut = new Date(`${care?.opt_out_by}T00:00:00Z`).getTime();
    expect((expires - optOut) / 86_400_000).toBe(30);
  });

  it('LIDAR is perpetual: within 90 days the dealer offers updates, nothing is lost', async () => {
    const lidar = (await getExpiry(findActor('iberia'))).find((r) => r.code === 'WO-0881');
    expect([lidar?.renewal_mode, lidar?.who_acts, lidar?.opt_out_by]).toEqual(['perpetual', 'dealer (offer updates)', null]);
  });
});
