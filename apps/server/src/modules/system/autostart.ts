// Arranque automático (Ajustes > Arranque). En Windows se activa dejando un script en la carpeta Inicio
// del usuario: al iniciar sesión arranca `pnpm start` en la carpeta de la app sin ventana visible.
// Si está marcado "Abrir en el navegador", al arrancar así la app abre http://127.0.0.1:<puerto>.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import type { AutostartStatus } from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import { settings } from '../../db/schema.js';

const OPEN_BROWSER_KEY = 'autostart.openBrowser';
const SCRIPT_NAME = 'AI-Assistant.vbs';
/** Variable que pone el script de Inicio, para saber que la app arrancó sola. */
export const AUTOSTART_ENV = 'AI_ASSISTANT_AUTOSTART';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

export interface AutostartDeps {
  platform: NodeJS.Platform;
  appData: string | undefined;
  repoRoot: string;
  logFile: string;
}

/** Script de Windows Script Host: lanza cmd oculto (0) sin esperar (False). */
export function startupScript(repoRoot: string, logFile: string): string {
  const q = (s: string) => s.replace(/"/g, '""');
  const command = `cmd /d /c set ${AUTOSTART_ENV}=1&& cd /d ""${q(repoRoot)}"" && npx pnpm@10.28.0 start > ""${q(logFile)}"" 2>&1`;
  return ["' Creado por AI-Assistant (Ajustes > Arranque). Bórralo desde Ajustes para quitar el arranque automático.", `CreateObject("WScript.Shell").Run "${command}", 0, False`, ''].join('\r\n');
}

export class Autostart {
  constructor(
    private readonly db: Db,
    private readonly deps: AutostartDeps,
  ) {}

  private scriptPath(): string | null {
    if (this.deps.platform !== 'win32' || !this.deps.appData) return null;
    return join(this.deps.appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', SCRIPT_NAME);
  }

  openBrowser(): boolean {
    return (this.db.select().from(settings).where(eq(settings.key, OPEN_BROWSER_KEY)).get()?.valueJson as boolean | undefined) ?? true;
  }

  status(): AutostartStatus {
    const path = this.scriptPath();
    return { supported: !!path, enabled: !!path && existsSync(path), openBrowser: this.openBrowser(), logFile: this.deps.logFile };
  }

  async update({ enabled, openBrowser }: { enabled?: boolean; openBrowser?: boolean }): Promise<AutostartStatus> {
    if (openBrowser !== undefined) {
      this.db.insert(settings).values({ key: OPEN_BROWSER_KEY, valueJson: openBrowser }).onConflictDoUpdate({ target: settings.key, set: { valueJson: openBrowser } }).run();
    }
    const path = this.scriptPath();
    if (enabled !== undefined && path) {
      if (enabled) {
        await mkdir(dirname(path), { recursive: true });
        await mkdir(dirname(this.deps.logFile), { recursive: true });
        await writeFile(path, startupScript(this.deps.repoRoot, this.deps.logFile), 'utf8');
      } else {
        await rm(path, { force: true });
      }
    }
    return this.status();
  }
}

/** Abre la app en el navegador por defecto (al arrancar sola, si así está en Ajustes). */
export function openInBrowser(url: string) {
  if (process.platform !== 'win32') return;
  spawn('cmd.exe', ['/d', '/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}
