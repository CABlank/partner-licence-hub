import { z } from 'zod';
import { createSaleOrder, dispatcherPool } from './odoo';

// El dispatcher lee el outbox y entrega cada evento a Odoo.
//
// Orden de cada entrega, y por qué:
//   1. Comprobar el evento contra la base: la solicitud tiene que existir y
//      estar 'approved'. Los datos del pedido salen de la base, NO del payload.
//   2. Crear el pedido en Odoo (fuera de cualquier transacción nuestra: es otro
//      sistema y una transacción no puede abarcarlo).
//   3. En UNA transacción: marcar el evento como publicado, poner la solicitud
//      en 'ordered' con la referencia del pedido y extender la licencia.
// Si se cae entre 2 y 3, el evento sigue sin publicar y se reintenta. Odoo
// devuelve el pedido ya creado (misma clientRef), y el paso 3 se hace una vez.
// Nunca hay dos pedidos ni dos extensiones.
//
// Por qué el paso 1: en la revisión del 09.10 un evento escrito a mano hizo que
// se creara un pedido y se extendiera una licencia sin aprobación. El outbox ya
// no es escribible desde la app, pero el dispatcher tampoco debe creerse un
// evento solo porque está ahí.
//
// Un solo dispatcher. Con varios en paralelo habría que reclamar cada evento
// con SELECT ... FOR UPDATE SKIP LOCKED.

const OutboxEvent = z.object({
  id: z.number().int(),
  event_id: z.string().uuid(),
  event_type: z.literal('renewal.approved'),
  payload: z.object({ request_id: z.number().int() }),
});
type OutboxEvent = z.infer<typeof OutboxEvent>;

// Lo que se factura, leído de la base en el momento de entregar.
const ApprovedRequest = z.object({
  request_id: z.number().int(),
  status: z.string(),
  licence_code: z.string(),
  product: z.string(),
  distributor_id: z.string(),
});
type ApprovedRequest = z.infer<typeof ApprovedRequest>;

export type DispatchResult = { delivered: number; failed: number; discarded: number };

export async function dispatchOnce(limit = 20): Promise<DispatchResult> {
  const { rows } = await dispatcherPool.query<Record<string, unknown>>(
    `SELECT id, event_id::text AS event_id, event_type, payload
       FROM outbox
      WHERE published_at IS NULL AND discarded_at IS NULL
      ORDER BY created_at
      LIMIT $1`,
    [limit],
  );
  const events = z.array(OutboxEvent).parse(rows);
  const result: DispatchResult = { delivered: 0, failed: 0, discarded: 0 };

  for (const event of events) {
    const request = await loadRequest(event.payload.request_id);
    if (!request || request.status !== 'approved') {
      await dispatcherPool.query(
        `UPDATE outbox SET discarded_at = now(), last_error = $2 WHERE id = $1`,
        [event.id, `discarded: request ${event.payload.request_id} is ${request?.status ?? 'missing'}, not approved`],
      );
      result.discarded += 1;
      continue;
    }

    try {
      const order = await createSaleOrder({
        clientRef: event.event_id,
        partner: request.distributor_id,
        product: request.product,
        licenceCode: request.licence_code,
      });
      await markDelivered(event, request, order.name);
      result.delivered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await dispatcherPool.query(
        'UPDATE outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1',
        [event.id, message],
      );
      result.failed += 1;
    }
  }
  return result;
}

async function loadRequest(requestId: number): Promise<ApprovedRequest | undefined> {
  const { rows } = await dispatcherPool.query<Record<string, unknown>>(
    `SELECT r.id AS request_id, r.status, r.licence_code, l.product, r.distributor_id
       FROM renewal_requests r
       JOIN licences l ON l.code = r.licence_code
      WHERE r.id = $1`,
    [requestId],
  );
  return rows[0] ? ApprovedRequest.parse(rows[0]) : undefined;
}

async function markDelivered(event: OutboxEvent, request: ApprovedRequest, orderRef: string): Promise<void> {
  const client = await dispatcherPool.connect();
  try {
    await client.query('BEGIN');
    // El WHERE published_at IS NULL hace el paso idempotente por si otro
    // proceso ya lo marcó: si no actualiza nada, no extendemos la licencia.
    const marked = await client.query(
      `UPDATE outbox
          SET published_at = now(), attempts = attempts + 1, last_error = NULL
        WHERE id = $1 AND published_at IS NULL`,
      [event.id],
    );
    // Y la solicitud tiene que seguir 'approved' en este instante.
    const ordered = marked.rowCount === 1
      ? await client.query(
          `UPDATE renewal_requests SET status = 'ordered', odoo_order_ref = $2
            WHERE id = $1 AND status = 'approved'`,
          [request.request_id, orderRef],
        )
      : { rowCount: 0 };
    if (ordered.rowCount === 1) {
      // Desde hoy si ya caducó; si no, desde la fecha actual de caducidad.
      // Renovar antes de tiempo no hace perder días al cliente. La duración
      // sale del catálogo (products.term_years), no del código.
      await client.query(
        `UPDATE licences l
            SET expires_on = (greatest(l.expires_on, CURRENT_DATE) + make_interval(years => p.term_years))::date
           FROM products p
          WHERE p.code = l.product AND l.code = $1`,
        [request.licence_code],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
