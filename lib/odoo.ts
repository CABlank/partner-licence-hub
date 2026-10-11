import { Pool } from 'pg';
import { z } from 'zod';
import { databaseUrl } from './env';

// Odoo simulado. En producción esto sería una llamada JSON-RPC a Odoo; aquí es
// un esquema aparte de la misma base, al que solo llega el dispatcher. La
// interfaz es la que importa: createSaleOrder puede fallar, y si se repite con
// la misma clientRef no duplica el pedido.

const globalForPool = globalThis as unknown as { odooPool?: Pool };
export const dispatcherPool =
  globalForPool.odooPool ??
  new Pool({ connectionString: databaseUrl('DISPATCHER_DATABASE_URL') });
globalForPool.odooPool = dispatcherPool;

export const SaleOrder = z.object({
  id: z.number().int(),
  name: z.string(),
  client_ref: z.string(),
  partner: z.string(),
  product: z.string(),
  licence_code: z.string(),
  state: z.string(),
  created_at: z.date(),
});
export type SaleOrder = z.infer<typeof SaleOrder>;

export type NewSaleOrder = {
  clientRef: string;
  partner: string;
  product: string;
  licenceCode: string;
};

export class OdooUnavailableError extends Error {
  constructor() {
    super('Odoo unavailable (simulated outage)');
    this.name = 'OdooUnavailableError';
  }
}

/**
 * Crea un pedido de venta, o devuelve el que ya existe con esa clientRef.
 *
 * Es el equivalente a lo que se haría contra Odoo de verdad: buscar un
 * sale.order con client_order_ref = clientRef y crearlo solo si no existe.
 * Esa búsqueda es la que hace inofensivo un reintento del dispatcher.
 */
export async function createSaleOrder(input: NewSaleOrder): Promise<SaleOrder> {
  const settings = await dispatcherPool.query<Record<string, unknown>>(
    'SELECT down FROM odoo.settings',
  );
  const { down } = z.object({ down: z.boolean() }).parse(settings.rows[0]);
  if (down) throw new OdooUnavailableError();

  await dispatcherPool.query(
    `INSERT INTO odoo.sale_orders (client_ref, partner, product, licence_code)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (client_ref) DO NOTHING`,
    [input.clientRef, input.partner, input.product, input.licenceCode],
  );
  const { rows } = await dispatcherPool.query<Record<string, unknown>>(
    `UPDATE odoo.sale_orders
        SET name = coalesce(name, 'S' || lpad(id::text, 5, '0'))
      WHERE client_ref = $1
      RETURNING *`,
    [input.clientRef],
  );
  return SaleOrder.parse(rows[0]);
}

export async function listSaleOrders(): Promise<SaleOrder[]> {
  const { rows } = await dispatcherPool.query<Record<string, unknown>>(
    'SELECT * FROM odoo.sale_orders ORDER BY id DESC',
  );
  return z.array(SaleOrder).parse(rows);
}

export async function isOdooDown(): Promise<boolean> {
  const { rows } = await dispatcherPool.query<Record<string, unknown>>(
    'SELECT down FROM odoo.settings',
  );
  return z.object({ down: z.boolean() }).parse(rows[0]).down;
}

export async function setOdooDown(down: boolean): Promise<void> {
  await dispatcherPool.query('UPDATE odoo.settings SET down = $1', [down]);
}
