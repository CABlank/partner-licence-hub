import { z } from 'zod';

// Las URLs de conexión, validadas con zod. Sin esto, una variable que falta
// hace que `new Pool({ connectionString: undefined })` se conecte en silencio a
// localhost:5432 con el usuario del sistema: una base equivocada, o una que no
// existe, y el error aparece lejos de su causa.
const PostgresUrl = z.string().regex(/^postgres(ql)?:\/\/.+/);

type EnvName = 'DATABASE_URL' | 'DISPATCHER_DATABASE_URL' | 'ANALYTICS_DATABASE_URL';

export function databaseUrl(name: EnvName): string {
  const parsed = PostgresUrl.safeParse(process.env[name]);
  if (!parsed.success) {
    throw new Error(`${name} is missing or is not a postgres:// URL. Set it in .env.local (see README).`);
  }
  return parsed.data;
}
