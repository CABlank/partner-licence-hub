'use server';

import { cookies } from 'next/headers';
import { getActor } from '@/lib/session';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { findActor } from '@/lib/actors';
import { decideRenewal, Decision, requestRenewal } from '@/lib/renewals';
import { decideTransfer, requestTransfer, TransferDecision } from '@/lib/transfers';
import { dispatchOnce } from '@/lib/dispatcher';
import { setOdooDown } from '@/lib/odoo';
import { resetDemo } from '@/lib/db';
import { AppError, type ErrorCode, type NoticeCode } from '@/lib/messages';

const currentActor = getActor;

// Solo rutas internas conocidas: el "volver a" nunca puede ser una URL externa.
const BackTo = z.enum(['/', '/drones', '/licences', '/history', '/insights', '/welcome']).catch('/');

/**
 * Ejecuta la operación y vuelve a la página con un código de aviso o error.
 * redirect() va FUERA del try: Next lo implementa lanzando una excepción, y
 * un catch alrededor se la tragaría.
 */
async function run(
  formData: FormData,
  op: () => Promise<NoticeCode>,
  extra: Record<string, string> = {},
): Promise<never> {
  const back = BackTo.parse(formData.get('back'));
  let params: Record<string, string>;
  try {
    params = { notice: await op(), ...extra };
  } catch (error) {
    const code: ErrorCode =
      error instanceof AppError ? error.code : error instanceof z.ZodError ? 'invalid_input' : 'not_found';
    if (!(error instanceof AppError) && !(error instanceof z.ZodError)) console.error(error);
    params = { error: code, ...extra };
  }
  redirect(`${back}?${new URLSearchParams(params).toString()}`);
}

async function requirePlatform(): Promise<void> {
  // El dispatcher y el Odoo simulado son infraestructura y no pasan por RLS,
  // así que aquí el rol SÍ se comprueba a mano.
  if ((await currentActor()).role !== 'Platform') throw new AppError('platform_only', 'Only Wingtra can do that');
}

// El "login" de la demo. findActor valida con zod: un id inventado cae en el
// actor por defecto, nunca en una sesión arbitraria.
export async function switchActor(formData: FormData): Promise<void> {
  const actor = findActor(formData.get('actor'));
  (await cookies()).set('actor', actor.id, { httpOnly: true, sameSite: 'lax', path: '/' });
  redirect('/');
}

export async function requestRenewalAction(formData: FormData): Promise<void> {
  await run(formData, async () => {
    await requestRenewal(await currentActor(), z.string().parse(formData.get('licence')));
    return 'renewal_requested';
  });
}

export async function decideRenewalAction(formData: FormData): Promise<void> {
  await run(formData, async () => {
    const decision = Decision.parse(formData.get('decision'));
    await decideRenewal(await currentActor(), formData.get('request'), decision);
    return decision === 'approved' ? 'renewal_approved' : 'renewal_rejected';
  });
}

export async function runSyncAction(formData: FormData): Promise<void> {
  await run(formData, async () => {
    await requirePlatform();
    const { failed } = await dispatchOnce();
    return failed > 0 ? 'sync_failed' : 'sync_done';
  });
}

export async function setOdooDownAction(formData: FormData): Promise<void> {
  await run(formData, async () => {
    await requirePlatform();
    const down = z.enum(['true', 'false']).parse(formData.get('down')) === 'true';
    await setOdooDown(down);
    return down ? 'odoo_down' : 'odoo_up';
  });
}

export async function requestTransferAction(formData: FormData): Promise<void> {
  const serial = z.string().parse(formData.get('serial'));
  await run(
    formData,
    async () => {
      await requestTransfer(await currentActor(), serial, formData.get('reason'));
      return 'transfer_requested';
    },
    { serial },
  );
}

export async function decideTransferAction(formData: FormData): Promise<void> {
  await run(formData, async () => {
    const decision = TransferDecision.parse(formData.get('decision'));
    await decideTransfer(await currentActor(), formData.get('transfer'), decision);
    return decision === 'approved' ? 'transfer_approved' : 'transfer_rejected';
  });
}

// Cualquier visitante puede reiniciar: es una demo pública con datos de mentira
// y la función solo puede volver al punto de partida.
export async function resetDemoAction(formData: FormData): Promise<void> {
  await run(formData, async () => {
    await resetDemo();
    return 'demo_reset';
  });
}
