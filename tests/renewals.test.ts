// El flujo de renovación de punta a punta, y los abusos que la base impide.
//
//   dealer pide -> distribuidor aprueba (+ evento en outbox) -> dispatcher
//   -> pedido en Odoo -> solicitud 'ordered' -> licencia extendida.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { findActor } from '@/lib/actors';
import { getExpiry, pool, queryRows, withSession } from '@/lib/db';
import { decideRenewal, getOutbox, getRenewals, requestRenewal } from '@/lib/renewals';
import { dispatchOnce } from '@/lib/dispatcher';
import { createSaleOrder, dispatcherPool, listSaleOrders, setOdooDown } from '@/lib/odoo';
import { Client } from 'pg';
import { resetDb } from './helpers';

const valencia = findActor('dealer-valencia');
const iberia = findActor('iberia');
const nordic = findActor('dealer-oslo');
const wingtra = findActor('wingtra');
const customer = findActor('ayto-valencia');

beforeEach(resetDb);

afterAll(async () => {
  await pool.end();
  await dispatcherPool.end();
});

async function expiryOf(code: string): Promise<string> {
  const row = (await getExpiry(wingtra)).find((l) => l.code === code);
  if (!row) throw new Error(`licence ${code} not visible to Wingtra`);
  return row.expires_on;
}

function addYears(iso: string, years: number): string {
  const [y, m, d] = iso.split('-');
  return `${Number(y) + years}-${m}-${d}`;
}

describe('happy path', () => {
  it('request, approve, sync: one Odoo order and the licence extended once', async () => {
    const before = await expiryOf('WR-1042');

    const id = await requestRenewal(valencia, 'WR-1042');
    await decideRenewal(iberia, id, 'approved');
    expect(await dispatchOnce()).toEqual({ delivered: 1, failed: 0, discarded: 0 });

    const orders = await listSaleOrders();
    expect(orders.map((o) => [o.name, o.partner, o.licence_code])).toEqual([['S00001', 'iberia', 'WR-1042']]);

    const [renewal] = await getRenewals(valencia);
    expect([renewal.status, renewal.odoo_order_ref]).toEqual(['ordered', 'S00001']);

    // Renovar antes de caducar suma desde la fecha de caducidad: no se pierden días.
    expect(await expiryOf('WR-1042')).toBe(addYears(before, 1));
  });

  it('the customer sees the status of its renewal', async () => {
    const id = await requestRenewal(valencia, 'WR-1042');
    await decideRenewal(iberia, id, 'approved');
    await dispatchOnce();
    const rows = await getRenewals(customer);
    expect(rows.map((r) => [r.licence_code, r.status])).toEqual([['WR-1042', 'ordered']]);
  });

  it('a 3-year CLOUD Pro renews for 3 years', async () => {
    const before = await expiryOf('WR-1043');
    await decideRenewal(iberia, await requestRenewal(valencia, 'WR-1043'), 'approved');
    await dispatchOnce();
    expect(await expiryOf('WR-1043')).toBe(addYears(before, 3));
  });

  it('rejecting writes no event and creates no order', async () => {
    await decideRenewal(iberia, await requestRenewal(valencia, 'WR-1042'), 'rejected');
    expect(await getOutbox(wingtra)).toHaveLength(0);
    expect(await dispatchOnce()).toEqual({ delivered: 0, failed: 0, discarded: 0 });
  });
});

describe('what the database refuses', () => {
  it('a double click on Request renewal creates one request, not two', async () => {
    const [a, b] = await Promise.all([
      requestRenewal(valencia, 'WR-1042'),
      requestRenewal(valencia, 'WR-1042'),
    ]);
    expect(a).toBe(b);
    expect(await getRenewals(valencia)).toHaveLength(1);
  });

  it('a dealer cannot request renewal of another dealer’s licence', async () => {
    await expect(requestRenewal(valencia, 'WO-0881')).rejects.toThrow(/not found or not yours/);
    await expect(requestRenewal(nordic, 'WR-1042')).rejects.toThrow(/not found or not yours/);
  });

  it('a dealer cannot forge a request to another distributor or for another licence', async () => {
    // Saltándose requestRenewal: lo que se prueba es la política, no nuestro helper.
    await expect(
      withSession(valencia, (c) =>
        c.query(
          `INSERT INTO renewal_requests (licence_code, dealer_id, distributor_id, customer_id)
           VALUES ('WR-1042', 'dealer-valencia', 'nordic', 'ayto-valencia')`,
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      withSession(valencia, (c) =>
        c.query(
          `INSERT INTO renewal_requests (licence_code, dealer_id, distributor_id, customer_id)
           VALUES ('WO-0881', 'dealer-valencia', 'iberia', 'minas-del-sur')`,
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('a dealer cannot fake the expiry date frozen in the request (it feeds the reports)', async () => {
    await expect(
      withSession(valencia, (c) =>
        c.query(
          `INSERT INTO renewal_requests (licence_code, dealer_id, distributor_id, customer_id, expires_on_at_request)
           VALUES ('WR-1042', 'dealer-valencia', 'iberia', 'ayto-valencia', CURRENT_DATE + 365)`,
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('auto-renewing and perpetual products cannot be requested: it would duplicate an order', async () => {
    await expect(requestRenewal(valencia, 'WC-1042')).rejects.toThrow(/auto; it is not renewed by request/);
    await expect(requestRenewal(findActor('dealer-barcelona'), 'WO-0881')).rejects.toThrow(/perpetual/);
    // Y la base lo impide aunque alguien se salte la comprobación de la app.
    await expect(
      withSession(valencia, (c) =>
        c.query(
          `INSERT INTO renewal_requests (licence_code, dealer_id, distributor_id, customer_id, expires_on_at_request)
           SELECT code, 'dealer-valencia', 'iberia', customer_id, expires_on FROM licences WHERE code = 'WC-1042'`,
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('only the dealer’s own distributor can approve', async () => {
    const id = await requestRenewal(valencia, 'WR-1042');
    await expect(decideRenewal(valencia, id, 'approved')).rejects.toThrow(/not found or not pending/);
    await expect(decideRenewal(findActor('dealer-oslo'), id, 'approved')).rejects.toThrow(/not found or not pending/);
    await decideRenewal(iberia, id, 'approved');
    // Y una vez decidida no se puede volver a decidir.
    await expect(decideRenewal(iberia, id, 'rejected')).rejects.toThrow(/not found or not pending/);
  });

  it('a distributor cannot repoint a request to another licence', async () => {
    const id = await requestRenewal(valencia, 'WR-1042');
    await expect(
      withSession(iberia, (c) =>
        c.query(`UPDATE renewal_requests SET licence_code = 'WO-0881' WHERE id = $1`, [id]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('nobody but the dispatcher can mark a request as ordered', async () => {
    const id = await requestRenewal(valencia, 'WR-1042');
    await expect(
      withSession(iberia, (c) =>
        c.query(`UPDATE renewal_requests SET status = 'ordered' WHERE id = $1`, [id]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('REVIEW 09.10: a dealer cannot write an "approved" event into the outbox itself', async () => {
    // El agujero: un dealer escribía 'renewal.approved' a mano y el dispatcher
    // creaba el pedido en Odoo y extendía la licencia sin aprobación.
    await requestRenewal(valencia, 'WR-1042');
    await expect(
      withSession(valencia, (c) =>
        c.query(
          `INSERT INTO outbox (tenant_id, event_type, payload)
           VALUES ('dealer-valencia', 'renewal.approved', '{"request_id": 1}')`,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('REVIEW 09.10: the dispatcher discards an event whose request was never approved', async () => {
    // Aunque alguien consiguiera colar un evento (aquí como superusuario), el
    // dispatcher lo contrasta con la base y no factura nada.
    const before = await expiryOf('WR-1042');
    const id = await requestRenewal(valencia, 'WR-1042');
    const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL });
    await admin.connect();
    await admin.query(
      `INSERT INTO outbox (tenant_id, event_type, payload) VALUES ('iberia', 'renewal.approved', $1)`,
      [JSON.stringify({ request_id: id })],
    );
    await admin.end();

    expect(await dispatchOnce()).toEqual({ delivered: 0, failed: 0, discarded: 1 });
    expect(await listSaleOrders()).toHaveLength(0);
    expect(await expiryOf('WR-1042')).toBe(before);
    const [event] = await getOutbox(wingtra);
    expect(event.discarded_at).not.toBeNull();
    expect(event.last_error).toMatch(/is pending, not approved/);
  });

  it('partners cannot read the outbox; Wingtra can', async () => {
    await decideRenewal(iberia, await requestRenewal(valencia, 'WR-1042'), 'approved');
    expect(await getOutbox(iberia)).toHaveLength(0);
    expect(await getOutbox(valencia)).toHaveLength(0);
    expect(await getOutbox(wingtra)).toHaveLength(1);
  });
});

describe('when Odoo misbehaves', () => {
  it('Odoo down: the event waits and records the error; nothing is lost', async () => {
    const before = await expiryOf('WR-1042');
    await decideRenewal(iberia, await requestRenewal(valencia, 'WR-1042'), 'approved');

    await setOdooDown(true);
    expect(await dispatchOnce()).toEqual({ delivered: 0, failed: 1, discarded: 0 });
    const [event] = await getOutbox(wingtra);
    expect([event.attempts, event.published_at, event.last_error]).toEqual([
      1,
      null,
      'Odoo unavailable (simulated outage)',
    ]);
    expect(await expiryOf('WR-1042')).toBe(before);

    await setOdooDown(false);
    expect(await dispatchOnce()).toEqual({ delivered: 1, failed: 0, discarded: 0 });
    expect(await listSaleOrders()).toHaveLength(1);
    expect(await expiryOf('WR-1042')).toBe(addYears(before, 1));
  });

  it('crash after Odoo created the order but before we marked it: no duplicate order', async () => {
    const before = await expiryOf('WR-1042');
    await decideRenewal(iberia, await requestRenewal(valencia, 'WR-1042'), 'approved');

    // Simula la primera mitad de una entrega que se cayó: el pedido existe en
    // Odoo, pero el evento sigue sin publicar.
    const [event] = await getOutbox(wingtra);
    await createSaleOrder({ clientRef: event.event_id, partner: 'iberia', product: 'pro_1y', licenceCode: 'WR-1042' });

    expect(await dispatchOnce()).toEqual({ delivered: 1, failed: 0, discarded: 0 });
    expect(await listSaleOrders()).toHaveLength(1);
    expect(await expiryOf('WR-1042')).toBe(addYears(before, 1));

    // Y volver a pasar el dispatcher no hace nada más.
    expect(await dispatchOnce()).toEqual({ delivered: 0, failed: 0, discarded: 0 });
    expect(await expiryOf('WR-1042')).toBe(addYears(before, 1));
  });
});

describe('who sees renewals', () => {
  it('Nordic never sees Iberia’s requests', async () => {
    await requestRenewal(valencia, 'WR-1042');
    expect(await getRenewals(nordic)).toHaveLength(0);
    expect(await getRenewals(findActor('survey-leads'))).toHaveLength(0);
    expect(await getRenewals(iberia)).toHaveLength(1);
  });

  it('no session: zero requests', async () => {
    await requestRenewal(valencia, 'WR-1042');
    const client = await pool.connect();
    try {
      const rows = await queryRows(client, z.object({ id: z.number() }), 'SELECT id FROM renewal_requests');
      expect(rows).toHaveLength(0);
    } finally {
      client.release();
    }
  });
});
