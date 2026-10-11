// Transferencia de dron: el email a soporte convertido en un flujo con reglas.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { findActor } from '@/lib/actors';
import { getExpiry, pool, withSession } from '@/lib/db';
import { requestRenewal } from '@/lib/renewals';
import { dispatcherPool } from '@/lib/odoo';
import {
  decideTransfer,
  droneClaimStatus,
  getDroneEvents,
  getTransferImpact,
  getTransfers,
  requestTransfer,
} from '@/lib/transfers';
import { z } from 'zod';
import { resetDb } from './helpers';

const valencia = findActor('dealer-valencia');
const iberia = findActor('iberia');
const oslo = findActor('dealer-oslo');
const wingtra = findActor('wingtra');
const barcelona = findActor('dealer-barcelona');

beforeEach(resetDb);
afterAll(async () => {
  await pool.end();
  await dispatcherPool.end();
});

const REASON = 'Minas del Sur moved its account to us.';

async function codes(actor: Parameters<typeof getExpiry>[0]): Promise<string[]> {
  return (await getExpiry(actor)).map((l) => l.code).sort();
}

describe('checking a Drone ID', () => {
  it('says free, yours or another partner, and never who', async () => {
    expect(await droneClaimStatus(valencia, 'WG-10042')).toBe('yours');
    expect(await droneClaimStatus(valencia, 'wg-20881')).toBe('other_partner'); // normaliza mayúsculas
    expect(await droneClaimStatus(valencia, 'WG-99999')).toBe('unknown');
    expect(await droneClaimStatus(iberia, 'WG-20881')).toBe('yours'); // el distribuidor ve a sus dealers
  });

  it('rejects malformed IDs before touching the database', async () => {
    await expect(droneClaimStatus(valencia, "WG-1'; DROP TABLE drones;--")).rejects.toThrow();
  });
});

describe('happy path: the owner approves', () => {
  it('transferable licences move, WingtraCARE ends; customer cleared; history written', async () => {
    expect(await codes(valencia)).toEqual(['WC-1042', 'WR-1042', 'WR-1043']);

    const id = await requestTransfer(valencia, 'WG-20881', REASON);
    await decideTransfer(barcelona, id, 'approved');

    // LIDAR (transferible) pasa a Valencia; WingtraCARE (no transferible) termina.
    expect(await codes(valencia)).toEqual(['WC-1042', 'WO-0881', 'WR-1042', 'WR-1043']);
    expect(await codes(barcelona)).toEqual(['WO-0882']);
    expect((await codes(wingtra)).includes('WC-0881')).toBe(false);
    const moved = (await getExpiry(valencia)).find((l) => l.code === 'WO-0881');
    expect(moved?.customer_name).toBeNull();

    const events = await getDroneEvents(valencia);
    expect(events.map((e) => [e.drone_serial, e.event, e.licence_code, e.decided_by])).toEqual([
      ['WG-20881', 'transfer_approved', null, 'dealer-barcelona'],
      ['WG-20881', 'licence_ended', 'WC-0881', 'dealer-barcelona'],
    ]);
  });

  it('the approver sees what moves and what ends before deciding; the requester sees nothing', async () => {
    const id = await requestTransfer(valencia, 'WG-20881', REASON);
    const forBarcelona = (await getTransferImpact(barcelona)).filter((i) => i.transfer_id === id);
    expect(forBarcelona.map((i) => [i.licence_code, i.transferable])).toEqual([
      ['WO-0881', true],
      ['WC-0881', false],
    ]);
    expect((await getTransferImpact(valencia)).filter((i) => i.transfer_id === id)).toEqual([]);
  });

  it('the owner’s distributor can decide too', async () => {
    const id = await requestTransfer(valencia, 'WG-20881', REASON);
    await decideTransfer(iberia, id, 'rejected');
    expect(await codes(valencia)).toEqual(['WC-1042', 'WR-1042', 'WR-1043']);
    const [t] = (await getTransfers(valencia)).filter((x) => x.id === id);
    expect([t.status, t.decided_by]).toEqual(['rejected', 'iberia']);
  });
});

describe('who may decide', () => {
  it('the requester cannot approve its own request', async () => {
    const id = await requestTransfer(valencia, 'WG-20881', REASON);
    await expect(decideTransfer(valencia, id, 'approved')).rejects.toThrow(/not yours to decide/);
  });

  it('a partner from another distributor cannot decide', async () => {
    const id = await requestTransfer(valencia, 'WG-20881', REASON);
    await expect(decideTransfer(oslo, id, 'approved')).rejects.toThrow(/not yours to decide/);
  });

  it('Wingtra support cannot jump in before the 5 days are up', async () => {
    const id = await requestTransfer(valencia, 'WG-20881', REASON);
    await expect(decideTransfer(wingtra, id, 'approved')).rejects.toThrow(/not yours to decide/);
  });

  it('Wingtra support decides the overdue one (seed: Oslo, 7 days without answer)', async () => {
    const [overdue] = (await getTransfers(wingtra)).filter((t) => t.overdue);
    expect(overdue.drone_serial).toBe('WG-20882');
    await decideTransfer(wingtra, overdue.id, 'approved');
    expect(await codes(oslo)).toEqual(['WO-0882', 'WR-2210']);
    const [event] = await getDroneEvents(oslo);
    expect([event.event, event.decided_by]).toEqual(['transfer_approved', 'wingtra-support']);
  });

  it('REVIEW 09.10: a distributor cannot approve its own request for its dealer\u2019s drone', async () => {
    // El agujero: Iberia pedía el dron de un dealer suyo y se lo aprobaba ella
    // misma como "distribuidor del dueño", sin que el dealer se enterara.
    const id = await withSession(iberia, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO transfer_requests (drone_serial, from_tenant_id, to_tenant_id, reason)
         VALUES ('WG-10043', drone_owner('WG-10043'), 'iberia', 'Distributor wants the drone') RETURNING id`,
      );
      return z.object({ id: z.number().int() }).parse(rows[0]).id;
    });
    await expect(decideTransfer(iberia, id, 'approved')).rejects.toThrow(/not yours to decide/);
    // El dueño real, Dealer Valencia, sí puede decidir.
    await decideTransfer(valencia, id, 'rejected');
  });

  it('a decided request cannot be decided again', async () => {
    const id = await requestTransfer(valencia, 'WG-20881', REASON);
    await decideTransfer(barcelona, id, 'rejected');
    await expect(decideTransfer(barcelona, id, 'approved')).rejects.toThrow(/not yours to decide/);
  });
});

describe('what the database refuses', () => {
  it('you cannot request your own drone, an unknown one, or one already requested by someone else', async () => {
    await expect(requestTransfer(valencia, 'WG-10042', REASON)).rejects.toThrow(/already yours/);
    await expect(requestTransfer(valencia, 'WG-99999', REASON)).rejects.toThrow(/not a registered drone/);
    await expect(requestTransfer(valencia, 'WG-20882', REASON)).rejects.toThrow(/pending transfer request from another partner/);
  });

  it('REVIEW 09.10: a referral partner cannot request a drone (it would then see its licences)', async () => {
    await expect(requestTransfer(findActor('survey-leads'), 'WG-10042', REASON)).rejects.toThrow(/row-level security/);
  });

  it('a double click creates one request', async () => {
    const [a, b] = await Promise.all([
      requestTransfer(valencia, 'WG-20881', REASON),
      requestTransfer(valencia, 'WG-20881', REASON),
    ]);
    expect(a).toBe(b);
  });

  it('a forged request against the wrong owner is refused', async () => {
    await expect(
      withSession(valencia, (c) =>
        c.query(
          `INSERT INTO transfer_requests (drone_serial, from_tenant_id, to_tenant_id, reason)
           VALUES ('WG-20881', 'dealer-oslo', 'dealer-valencia', 'forged owner')`,
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('partners cannot update requests directly, only through decide_transfer()', async () => {
    const id = await requestTransfer(valencia, 'WG-20881', REASON);
    await expect(
      withSession(barcelona, (c) => c.query(`UPDATE transfer_requests SET status = 'approved' WHERE id = $1`, [id])),
    ).rejects.toThrow(/permission denied/);
  });

  it('a drone with an open renewal cannot be transferred until the renewal is closed', async () => {
    // WG-20882 (unidad de demo de Barcelona) tiene WingtraUNLIMITED, que es manual.
    await requestRenewal(barcelona, 'WO-0882');
    const [overdue] = (await getTransfers(wingtra)).filter((t) => t.overdue);
    await expect(decideTransfer(wingtra, overdue.id, 'approved')).rejects.toThrow(/open licence renewal/);
    expect(await codes(oslo)).toEqual(['WR-2210']);
  });
});

describe('who sees transfers', () => {
  it('both sides and their distributors; nobody else', async () => {
    await requestTransfer(valencia, 'WG-20881', REASON);
    const serials = async (a: Parameters<typeof getTransfers>[0]) =>
      (await getTransfers(a)).map((t) => t.drone_serial).sort();
    expect(await serials(valencia)).toEqual(['WG-20881']);
    expect(await serials(barcelona)).toEqual(['WG-20881', 'WG-20882']);
    expect(await serials(iberia)).toEqual(['WG-20881', 'WG-20882']);
    expect(await serials(oslo)).toEqual(['WG-20882']);
    expect(await serials(findActor('survey-leads'))).toEqual([]);
    expect(await serials(wingtra)).toEqual(['WG-20881', 'WG-20882']);
  });
});
