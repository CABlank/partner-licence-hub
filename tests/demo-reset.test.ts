// El botón "Reset demo": cualquier visitante de la demo pública puede volver al
// punto de partida, pero nada más. reset_demo() es SECURITY DEFINER, así que
// lo que importa es lo que NO deja hacer.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { findActor } from '@/lib/actors';
import { getExpiry, pool, resetDemo } from '@/lib/db';
import { decideRenewal, getRenewals, requestRenewal } from '@/lib/renewals';
import { dispatcherPool, setOdooDown } from '@/lib/odoo';
import { resetDb } from './helpers';

const valencia = findActor('dealer-valencia');
const iberia = findActor('iberia');
const wingtra = findActor('wingtra');

beforeEach(resetDb);

afterAll(async () => {
  await pool.end();
  await dispatcherPool.end();
});

describe('reset demo', () => {
  it('undoes a renewal and an Odoo outage, back to the seeded state', async () => {
    const before = await getExpiry(wingtra);
    const id = await requestRenewal(valencia, 'WR-1042');
    await decideRenewal(iberia, id, 'approved');
    await setOdooDown(true);

    await resetDemo();

    expect(await getRenewals(wingtra)).toEqual([]);
    expect(await getExpiry(wingtra)).toEqual(before);
    const { rows } = await dispatcherPool.query<{ down: boolean }>('SELECT down FROM odoo.settings');
    expect(rows[0]?.down).toBe(false);
  });

  it('hub_app cannot call the seed functions directly (they would duplicate data)', async () => {
    await expect(pool.query('SELECT seed_demo()')).rejects.toThrow(/permission denied/);
    await expect(pool.query('SELECT seed_demo_transfers()')).rejects.toThrow(/permission denied/);
  });

  it('hub_app still cannot truncate or write tables on its own', async () => {
    await expect(pool.query('TRUNCATE licences CASCADE')).rejects.toThrow(/permission denied/);
    await expect(pool.query("UPDATE licences SET expires_on = '2099-01-01'")).rejects.toThrow(/permission denied/);
  });
});
