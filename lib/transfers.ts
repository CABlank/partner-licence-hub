import { z } from 'zod';
import type { Actor } from './actors';
import { queryRows, withSession } from './db';
import { AppError } from './messages';

// Transferencia de dron (Figma, sección 2). La autorización vive en la base:
// la política de INSERT y la función decide_transfer() en db/transfers.sql.

export const DroneSerial = z.string().trim().toUpperCase().pipe(z.string().regex(/^WG-\d{5}$/));
export const TransferReason = z.string().trim().min(5).max(500);
export const TransferId = z.coerce.number().int().positive();
export const TransferDecision = z.enum(['approved', 'rejected']);

export const ClaimStatus = z.enum(['unknown', 'yours', 'other_partner']);
export type ClaimStatus = z.infer<typeof ClaimStatus>;

export const TransferRow = z.object({
  id: z.number().int(),
  drone_serial: z.string(),
  from_tenant_id: z.string(),
  to_tenant_id: z.string(),
  reason: z.string(),
  status: z.enum(['pending', 'approved', 'rejected']),
  created_at: z.date(),
  due_at: z.date(),
  overdue: z.boolean(),
  decided_by: z.string().nullable(),
});
export type TransferRow = z.infer<typeof TransferRow>;

export const DroneEventRow = z.object({
  id: z.number().int(),
  drone_serial: z.string(),
  event: z.string(),
  licence_code: z.string().nullable(),
  from_tenant_id: z.string().nullable(),
  to_tenant_id: z.string().nullable(),
  decided_by: z.string(),
  at: z.date(),
});
export type DroneEventRow = z.infer<typeof DroneEventRow>;


/** "Configure drones": ¿este Drone ID es libre, tuyo o de otro partner? */
export async function droneClaimStatus(actor: Actor, rawSerial: unknown): Promise<ClaimStatus> {
  const serial = DroneSerial.parse(rawSerial);
  return withSession(actor, async (c) => {
    const [row] = await queryRows(c, z.object({ status: ClaimStatus }), 'SELECT drone_claim_status($1) AS status', [serial]);
    return row?.status ?? 'unknown';
  });
}

/** Pide la transferencia. Idempotente para el mismo solicitante. */
export async function requestTransfer(actor: Actor, rawSerial: unknown, rawReason: unknown): Promise<number> {
  const serial = DroneSerial.parse(rawSerial);
  const reason = TransferReason.parse(rawReason);
  return withSession(actor, async (c) => {
    const inserted = await queryRows(
      c,
      z.object({ id: z.number().int() }),
      `INSERT INTO transfer_requests (drone_serial, from_tenant_id, to_tenant_id, reason)
       SELECT $1, drone_owner($1), current_tenant(), $2
        WHERE drone_claim_status($1) = 'other_partner'
       ON CONFLICT (drone_serial) WHERE status = 'pending' DO NOTHING
       RETURNING id`,
      [serial, reason],
    );
    if (inserted[0]) return inserted[0].id;

    const mine = await queryRows(
      c,
      z.object({ id: z.number().int() }),
      `SELECT id FROM transfer_requests
        WHERE drone_serial = $1 AND status = 'pending' AND to_tenant_id = current_tenant()`,
      [serial],
    );
    if (mine[0]) return mine[0].id;

    const [{ status }] = await queryRows(c, z.object({ status: ClaimStatus }), 'SELECT drone_claim_status($1) AS status', [serial]);
    if (status === 'yours') throw new AppError('already_yours', `${serial} is already yours.`);
    if (status === 'unknown') throw new AppError('unknown_drone', `${serial} is not a registered drone.`);
    throw new AppError('already_requested', `${serial} already has a pending transfer request from another partner.`);
  });
}

/** Decide. Quién puede decidir lo comprueba decide_transfer() en la base. */
export async function decideTransfer(actor: Actor, rawId: unknown, rawDecision: unknown): Promise<void> {
  const id = TransferId.parse(rawId);
  const decision = TransferDecision.parse(rawDecision);
  return withSession(actor, async (c) => {
    try {
      await c.query('SELECT decide_transfer($1, $2)', [id, decision]);
    } catch (error) {
      // Solo los rechazos conocidos de decide_transfer() se traducen. Cualquier
      // otro error (conexión caída, bug) se relanza tal cual para que se vea en
      // los logs, en vez de esconderlo detrás de "not found".
      const message = error instanceof Error ? error.message : '';
      if (/open licence renewal/.test(message)) throw new AppError('open_renewal', message);
      if (/not found or not yours to decide/.test(message)) throw new AppError('not_found', message);
      throw error;
    }
  });
}

export function getTransfers(actor: Actor): Promise<TransferRow[]> {
  return withSession(actor, (c) =>
    queryRows(
      c,
      TransferRow,
      `SELECT id, drone_serial, from_tenant_id, to_tenant_id, reason, status,
              created_at, due_at, (status = 'pending' AND due_at < now()) AS overdue, decided_by
         FROM transfer_requests
        ORDER BY (status = 'pending') DESC, created_at DESC`,
    ),
  );
}

export const TransferImpactRow = z.object({
  transfer_id: z.number().int(),
  licence_code: z.string(),
  product_name: z.string(),
  transferable: z.boolean(),
});
export type TransferImpactRow = z.infer<typeof TransferImpactRow>;

/**
 * Qué pasa con cada licencia del dron si se aprueba: viaja o termina.
 * Lo ve quien decide (dueño, distribuidor, Wingtra). El solicitante no ve
 * ninguna fila: RLS le esconde las licencias ajenas, igual que el dueño.
 */
export function getTransferImpact(actor: Actor): Promise<TransferImpactRow[]> {
  return withSession(actor, (c) =>
    queryRows(
      c,
      TransferImpactRow,
      `SELECT t.id AS transfer_id, l.code AS licence_code, p.name AS product_name, p.transferable
         FROM transfer_requests t
         JOIN licences l ON l.drone_serial = t.drone_serial AND l.ended_at IS NULL
         JOIN products p ON p.code = l.product
        WHERE t.status = 'pending'
        ORDER BY t.id, p.transferable DESC, l.code`,
    ),
  );
}

export function getDroneEvents(actor: Actor): Promise<DroneEventRow[]> {
  return withSession(actor, (c) =>
    queryRows(c, DroneEventRow, 'SELECT * FROM drone_events ORDER BY at DESC, id DESC'),
  );
}
