import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Las repeticiones de recordatorios se calculan en hora local: fija la zona para que los tests sean deterministas.
  // Las sesiones de desarrollo instalan la skill de opencode: en los tests, fuera de la carpeta del usuario.
  test: { env: { TZ: 'Europe/Madrid', OPENCODE_SKILLS_DIR: join(tmpdir(), 'dev-assistant-test-skills') } },
});
