import { z } from 'zod';
import type { Actor } from './actors';
import { queryRows, withSession } from './db';
import { AppError } from './messages';

// Operaciones de renovación. Ninguna comprueba permisos a mano: las políticas
// de db/renewals.sql deciden. Si un dealer intenta renovar una licencia ajena,
// el INSERT lo rechaza la base de datos.

export const LicenceCode = z.string().regex(/^W[A-Z]-\d{4}$/);
export const RequestId = z.coerce.number().int().positive();
export const Decision = z.enum(['approved', 'rejected']);

export const RenewalRow = z.object({
  id: z.number().int(),
  licence_code: z.string(),
  dealer_id: z.string(),
  distributor_id: z.string(),
  customer_name: z.string().nullable(),
  product: z.string(),
  product_name: z.string(),
  status: z.enum(['pending', 'approved', 'rejected', 'ordered']),
  odoo_order_ref: z.string().nullable(),
  created_at: z.date(),
  decided_at: z.date().nullable(),
});
export type RenewalRow = z.infer<typeof RenewalRow>;

export const OutboxRow = z.object({
  event_id: z.string(),
  event_type: z.string(),
  licence_code: z.string().nullable(),
  tenant_id: z.string(),
  attempts: z.number().int(),
  last_error: z.string().nullable(),
  created_at: z.date(),
  published_at: z.date().nullable(),
  discarded_at: z.date().nullable(),
});
export type OutboxRow = z.infer<typeof OutboxRow>;

const IdRow = z.object({ id: z.number().int() });

/**
 * El dealer pide renovar. Idempotente: si ya hay una solicitud abierta para
 * esa licencia (índice único parcial), devuelve esa en vez de crear otra.
 */
export async function requestRenewal(actor: Actor, licenceCode: string): Promise<number> {
  const code = LicenceCode.parse(licenceCode);
  return withSession(actor, async (c) => {
    // Primero, un mensaje claro si el producto no se renueva a mano. La
    // política de la base lo impide igualmente; esto solo evita que el dealer
    // vea un error técnico de RLS.
    const [mode] = await queryRows(
      c,
      z.object({ renewal_mode: z.enum(['manual', 'auto', 'perpetual']) }),
      'SELECT p.renewal_mode FROM licences l JOIN products p ON p.code = l.product WHERE l.code = $1',
      [code],
    );
    if (mode && mode.renewal_mode !== 'manual') {
      throw new AppError('not_renewable', `Licence ${code} is ${mode.renewal_mode}; it is not renewed by request`);
    }

    // INSERT ... SELECT desde licences: el cliente sale de la propia licencia,
    // no del formulario. La política comprueba igualmente que coincide.
    const inserted = await queryRows(
      c,
      IdRow,
      `INSERT INTO renewal_requests (licence_code, dealer_id, distributor_id, customer_id, expires_on_at_request)
       SELECT l.code, current_tenant(), current_parent(), l.customer_id, l.expires_on
         FROM licences l
        WHERE l.code = $1
       ON CONFLICT (licence_code) WHERE status IN ('pending', 'approved') DO NOTHING
       RETURNING id`,
      [code],
    );
    if (inserted[0]) return inserted[0].id;

    const existing = await queryRows(
      c,
      IdRow,
      `SELECT id FROM renewal_requests
        WHERE licence_code = $1 AND status IN ('pending', 'approved')`,
      [code],
    );
    if (!existing[0]) throw new AppError('not_found', `Licence ${code} not found or not yours`);
    return existing[0].id;
  });
}

/**
 * El distribuidor decide. Si aprueba, el trigger renewal_approved_to_outbox
 * escribe el evento para Odoo en la MISMA transacción: o quedan las dos
 * cosas, o ninguna. La app no escribe en el outbox (no tiene permiso).
 */
export async function decideRenewal(actor: Actor, requestId: unknown, decision: unknown): Promise<void> {
  const id = RequestId.parse(requestId);
  const status = Decision.parse(decision);
  return withSession(actor, async (c) => {
    const updated = await queryRows(
      c,
      IdRow,
      `UPDATE renewal_requests
          SET status = $2, decided_at = now(), decided_by = current_tenant()
        WHERE id = $1
       RETURNING id`,
      [id, status],
    );
    // Cero filas = no existe, no es tuya o ya no está pending. No se distingue
    // a propósito: no le decimos a nadie qué solicitudes ajenas existen.
    if (!updated[0]) throw new AppError('not_found', `Renewal request ${id} not found or not pending`);
  });
}

export function getRenewals(actor: Actor): Promise<RenewalRow[]> {
  return withSession(actor, (c) =>
    queryRows(
      c,
      RenewalRow,
      `SELECT r.id, r.licence_code, r.dealer_id, r.distributor_id, cu.name AS customer_name,
              l.product, p.name AS product_name, r.status, r.odoo_order_ref, r.created_at, r.decided_at
         FROM renewal_requests r
         JOIN licences l ON l.code = r.licence_code
         JOIN products p ON p.code = l.product
         LEFT JOIN customers cu ON cu.id = r.customer_id
        ORDER BY r.created_at DESC`,
    ),
  );
}

/** Lo que Wingtra ve del outbox. Para cualquier otro actor, la política devuelve cero filas. */
export function getOutbox(actor: Actor): Promise<OutboxRow[]> {
  return withSession(actor, (c) =>
    queryRows(
      c,
      OutboxRow,
      `SELECT event_id::text AS event_id, event_type, payload->>'licence_code' AS licence_code,
              tenant_id, attempts, last_error, created_at, published_at, discarded_at
         FROM outbox
        ORDER BY created_at DESC`,
    ),
  );
}
