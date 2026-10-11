import { cookies } from 'next/headers';
import { findActor, type Actor } from './actors';

/** ¿Ha elegido ya actor? Si no, es la primera visita: va a la bienvenida. */
export async function hasChosenActor(): Promise<boolean> {
  return (await cookies()).has('actor');
}

/** El actor de esta petición, sacado de la cookie y validado con zod. */
export async function getActor(): Promise<Actor> {
  return findActor((await cookies()).get('actor')?.value);
}
