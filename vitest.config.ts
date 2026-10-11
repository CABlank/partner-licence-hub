import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname) } },
  test: {
    // Los ficheros comparten una base de datos y algunos la reinician.
    fileParallelism: false,
    // Por defecto, la base local de Docker. TEST_*_DATABASE_URL permite pasar
    // la misma batería contra la base publicada (Neon) antes de desplegar.
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://hub_app:hub_app@localhost:5433/licence_hub',
      DISPATCHER_DATABASE_URL: process.env.TEST_DISPATCHER_DATABASE_URL ?? 'postgresql://hub_dispatcher:hub_dispatcher@localhost:5433/licence_hub',
      ADMIN_DATABASE_URL: process.env.TEST_ADMIN_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/licence_hub',
    },
  },
});
