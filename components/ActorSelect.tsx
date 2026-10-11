'use client';

import { ACTORS, type ActorId } from '@/lib/actors';

// Cambiar de actor al elegirlo, sin botón de confirmar. Es la única pieza de
// cliente de la cabecera: envía el mismo formulario (switchActor) que antes.
export function ActorSelect({ current }: { current: ActorId }) {
  return (
    <select
      id="actor"
      name="actor"
      defaultValue={current}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
    >
      {ACTORS.map((a) => (
        <option key={a.id} value={a.id}>{a.label}</option>
      ))}
    </select>
  );
}
