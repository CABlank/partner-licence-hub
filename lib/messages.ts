import { z } from 'zod';

// Avisos que la app enseña tras una acción. La URL solo lleva un CÓDIGO de
// esta lista (?notice=renewal_requested), nunca el texto: si llevara texto
// libre, cualquiera podría mandar un enlace que muestre un mensaje falso
// dentro de la app.

export const NoticeCode = z.enum([
  'renewal_requested',
  'renewal_approved',
  'renewal_rejected',
  'sync_done',
  'sync_failed',
  'odoo_down',
  'odoo_up',
  'transfer_requested',
  'transfer_approved',
  'transfer_rejected',
  'demo_reset',
]);
export type NoticeCode = z.infer<typeof NoticeCode>;

export const ErrorCode = z.enum([
  'not_found',
  'already_yours',
  'unknown_drone',
  'already_requested',
  'open_renewal',
  'not_renewable',
  'invalid_input',
  'platform_only',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const NOTICES: Record<NoticeCode, string> = {
  renewal_requested: 'Renewal requested. Your distributor has been asked to approve it.',
  renewal_approved: 'Approved. The sale order is queued for Odoo.',
  renewal_rejected: 'Renewal rejected. The dealer can see why it stopped.',
  sync_done: 'Sync finished. Everything waiting reached Odoo.',
  sync_failed: 'Odoo did not answer. The events are kept and will be retried.',
  odoo_down: 'Odoo (mock) is now down. Approvals still work; orders wait.',
  odoo_up: 'Odoo (mock) is back up. Run the sync to deliver what was waiting.',
  transfer_requested: 'Transfer requested. The current partner has 5 days to decide.',
  transfer_approved: 'Transfer approved. The drone and its licences moved.',
  transfer_rejected: 'Transfer rejected.',
  demo_reset: 'Demo reset. Every licence, request and order is back to the starting point.',
};

export const ERRORS: Record<ErrorCode, string> = {
  not_found: 'That request does not exist, is not yours to decide, or was already decided.',
  already_yours: 'That drone is already registered to you.',
  unknown_drone: 'That Drone ID is not registered.',
  already_requested: 'That drone already has a pending transfer request from another partner.',
  open_renewal: 'This drone has an open licence renewal. Finish it before transferring.',
  not_renewable: 'This product renews automatically or is perpetual. There is nothing to request.',
  invalid_input: 'That input does not look right. Drone IDs look like WG-20881.',
  platform_only: 'Only Wingtra can do that.',
};

/** Un error de la app con un código que se puede mostrar. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
