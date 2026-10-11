import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

/**
 * Deja la base como recién sembrada. Usa el superusuario SOLO para esto:
 * los tests en sí corren como hub_app y hub_dispatcher, nunca como postgres.
 */
export async function resetDb(): Promise<void> {
  const admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(`
      TRUNCATE drone_events, transfer_requests, renewal_requests, outbox, odoo.sale_orders, leads, licences, drones, customers, tenants
      RESTART IDENTITY CASCADE;
      UPDATE odoo.settings SET down = false;
    `);
    for (const file of ['seed.sql', 'seed_transfers.sql']) {
      await admin.query(readFileSync(path.join(__dirname, '..', 'db', file), 'utf8'));
    }
  } finally {
    await admin.end();
  }
}
