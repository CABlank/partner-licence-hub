import { z } from 'zod';

// Los actores de la demo: exactamente la tabla "quién ve qué" del Figma.
//
// En producción esto saldría del login (SSO de my.wingtra.com). En el
// prototipo, el selector de arriba hace de login. Lo importante es lo mismo en
// los dos casos: el servidor decide la sesión, el navegador solo manda un id
// que zod valida contra esta lista.

export const ActorId = z.enum([
  'wingtra',
  'iberia',
  'dealer-valencia',
  'dealer-barcelona',
  'dealer-oslo',
  'ayto-valencia',
  'survey-leads',
]);
export type ActorId = z.infer<typeof ActorId>;

export type Actor = {
  id: ActorId;
  label: string;
  role: 'Platform' | 'Distributor' | 'Dealer' | 'Customer' | 'Referral partner';
  session: { actor?: 'platform'; tenant?: string; customer?: string };
};

export const ACTORS: readonly Actor[] = [
  { id: 'wingtra', label: 'Wingtra', role: 'Platform', session: { actor: 'platform' } },
  { id: 'iberia', label: 'Iberia Distribution', role: 'Distributor', session: { tenant: 'iberia' } },
  { id: 'dealer-valencia', label: 'Dealer Valencia', role: 'Dealer', session: { tenant: 'dealer-valencia' } },
  { id: 'dealer-barcelona', label: 'Dealer Barcelona', role: 'Dealer', session: { tenant: 'dealer-barcelona' } },
  { id: 'dealer-oslo', label: 'Dealer Oslo', role: 'Dealer', session: { tenant: 'dealer-oslo' } },
  { id: 'ayto-valencia', label: 'Ayto. de Valencia', role: 'Customer', session: { customer: 'ayto-valencia' } },
  { id: 'survey-leads', label: 'Survey Leads', role: 'Referral partner', session: { tenant: 'survey-leads' } },
];

export const DEFAULT_ACTOR: ActorId = 'dealer-valencia';

/**
 * Acepta unknown a propósito: el valor viene de una cookie o de un formulario.
 * Cualquier cosa que no sea un id de la lista cae en el actor por defecto,
 * nunca en una sesión arbitraria ni en acceso total.
 */
export function findActor(raw: unknown): Actor {
  const parsed = ActorId.safeParse(raw);
  const id = parsed.success ? parsed.data : DEFAULT_ACTOR;
  const actor = ACTORS.find((a) => a.id === id);
  if (!actor) throw new Error(`Actor ${id} is in ActorId but missing from ACTORS`);
  return actor;
}
