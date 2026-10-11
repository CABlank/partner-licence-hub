import { Pool, types, type PoolClient } from 'pg';
import { z } from 'zod';
import type { Actor } from './actors';
import { databaseUrl } from './env';

// DATE (oid 1082) como texto 'YYYY-MM-DD'. Por defecto pg crea un Date a
// medianoche LOCAL, y al formatearlo en UTC desde España sale el día anterior.
types.setTypeParser(1082, (v: string) => v);

// Un pool por proceso. En desarrollo Next recarga módulos, así que se guarda en
// globalThis para no abrir un pool nuevo en cada recarga.
const globalForPool = globalThis as unknown as { pool?: Pool };
export const pool =
  globalForPool.pool ?? new Pool({ connectionString: databaseUrl('DATABASE_URL') });
globalForPool.pool = pool;

// ---------------------------------------------------------------------------
// Esquemas. pg devuelve las filas sin tipar; zod es la frontera donde pasan a
// tener tipo. Si la vista cambia y no coincide, falla aquí con un error claro,
// no tres pantallas más tarde con un undefined.
// ---------------------------------------------------------------------------
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ExpiryRow = z.object({
  code: z.string(),
  product: z.string(),
  product_name: z.string(),
  renewal_mode: z.enum(['manual', 'auto', 'perpetual']),
  transferable: z.boolean(),
  drone_serial: z.string().nullable(),
  dealer_id: z.string(),
  customer_name: z.string().nullable(),
  expires_on: IsoDate,
  days_left: z.number().int(),
  opt_out_by: IsoDate.nullable(),
  bucket: z.enum(['expired', '30', '60', '90', 'later']),
  who_acts: z.string(),
});
export type ExpiryRow = z.infer<typeof ExpiryRow>;

export const LeadRow = z.object({
  id: z.number().int(),
  company: z.string(),
  status: z.enum(['new', 'contacted', 'demo', 'won', 'lost']),
});
export type LeadRow = z.infer<typeof LeadRow>;

/** Ejecuta una consulta y valida cada fila con el esquema dado. */
export async function queryRows<S extends z.ZodType>(
  client: PoolClient,
  schema: S,
  sql: string,
  params: readonly unknown[] = [],
): Promise<z.infer<S>[]> {
  const result = await client.query<Record<string, unknown>>(sql, [...params]);
  return z.array(schema).parse(result.rows);
}

/**
 * Ejecuta fn en una transacción con la sesión de este actor declarada.
 *
 * set_config(..., true) equivale a SET LOCAL: vale solo para esta transacción.
 * Las conexiones del pool se reutilizan; con un SET normal la siguiente
 * petición heredaría el actor anterior. Y set_config admite parámetros, así
 * que no hay interpolación de strings ni inyección SQL.
 */
export async function withSession<T>(
  actor: Actor,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.actor', $1, true),
              set_config('app.current_tenant', $2, true),
              set_config('app.current_customer', $3, true)`,
      [actor.session.actor ?? '', actor.session.tenant ?? '', actor.session.customer ?? ''],
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Sin WHERE a propósito: decide la base de datos (RLS). Un filtro a mano aquí
// rompería la vista del distribuidor, que no tiene licencias propias.
export function getExpiry(actor: Actor): Promise<ExpiryRow[]> {
  return withSession(actor, (c) =>
    queryRows(c, ExpiryRow, 'SELECT * FROM licence_expiry ORDER BY expires_on'),
  );
}

export function getLeads(actor: Actor): Promise<LeadRow[]> {
  return withSession(actor, (c) =>
    queryRows(c, LeadRow, 'SELECT id, company, status FROM leads ORDER BY id'),
  );
}

export const TenantRow = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['distributor', 'dealer', 'referral']),
  parent_id: z.string().nullable(),
});
export type TenantRow = z.infer<typeof TenantRow>;

/** Los partners que este actor puede ver (él y sus hijos). RLS decide. */
export function getTenants(actor: Actor): Promise<TenantRow[]> {
  return withSession(actor, (c) =>
    queryRows(c, TenantRow, 'SELECT id, name, kind, parent_id FROM tenants ORDER BY id'),
  );
}

/** La fecha de hoy según la base, para que la cabecera y los días coincidan. */
export function getToday(actor: Actor): Promise<string> {
  return withSession(actor, async (c) => {
    const [row] = await queryRows(c, z.object({ today: z.string() }), 'SELECT CURRENT_DATE::text AS today');
    return row?.today ?? '';
  });
}

/** Solo demo: cuántas licencias hay en toda la red, para "ves X de N". */
export function getNetworkSize(actor: Actor): Promise<number> {
  return withSession(actor, async (c) => {
    const [row] = await queryRows(c, z.object({ n: z.number().int() }), 'SELECT demo_network_size()::int AS n');
    return row?.n ?? 0;
  });
}

/**
 * Deja la demo como recién sembrada (función reset_demo, db/demo_reset.sql).
 * Sin sesión de actor: no lee nada de nadie, solo vuelve al punto de partida.
 */
export async function resetDemo(): Promise<void> {
  await pool.query('SELECT reset_demo()');
}
