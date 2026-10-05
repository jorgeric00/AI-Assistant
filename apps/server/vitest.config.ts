import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Las repeticiones de recordatorios se calculan en hora local: fija la zona para que los tests sean deterministas.
  test: { env: { TZ: 'Europe/Madrid' } },
});
