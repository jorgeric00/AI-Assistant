import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import notifier from 'node-notifier';
import type { SystemNotifier } from './scheduler.js';

export const WINDOWS_APP_ID = 'AI-Assistant';
const SHORTCUT = `${WINDOWS_APP_ID}.lnk`;

interface RegisterDeps {
  platform: NodeJS.Platform;
  appData: string | undefined;
  exists: (path: string) => boolean;
  /** Ejecuta SnoreToast con esos argumentos. */
  runSnoreToast: (args: string[]) => Promise<void>;
  nodePath: string;
}

function runSnoreToast(args: string[]): Promise<void> {
  const vendor = join(dirname(createRequire(import.meta.url).resolve('node-notifier')), 'vendor', 'snoreToast');
  const exe = join(vendor, `snoretoast-${process.arch === 'x64' || process.arch === 'arm64' ? 'x64' : 'x86'}.exe`);
  return new Promise((resolve, reject) => execFile(exe, args, { windowsHide: true }, (err) => (err ? reject(err) : resolve())));
}

const defaultDeps = (): RegisterDeps => ({
  platform: process.platform,
  appData: process.env.APPDATA,
  exists: existsSync,
  runSnoreToast,
  nodePath: process.execPath,
});

/**
 * Windows solo muestra (y guarda en el centro de notificaciones) los avisos de una app registrada:
 * un acceso directo en el menú Inicio con su AppUserModelID. Se crea una vez con SnoreToast.
 * Devuelve el appID a usar, o undefined si no se pudo registrar (se usa el de SnoreToast).
 */
export async function registerWindowsAppId(deps: RegisterDeps = defaultDeps()): Promise<string | undefined> {
  if (deps.platform !== 'win32') return WINDOWS_APP_ID;
  if (!deps.appData) return undefined;
  const shortcut = join(deps.appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', SHORTCUT);
  if (deps.exists(shortcut)) return WINDOWS_APP_ID;
  try {
    // -install <ruta relativa al menú Inicio> <aplicación> <appID>
    await deps.runSnoreToast(['-install', SHORTCUT, deps.nodePath, WINDOWS_APP_ID]);
    return deps.exists(shortcut) ? WINDOWS_APP_ID : undefined;
  } catch {
    return undefined;
  }
}

let appId: Promise<string | undefined> | undefined;

/** Notificación del sistema (en Windows, el centro de notificaciones) aunque el navegador esté cerrado. */
export const desktopNotifier: SystemNotifier = async ({ reminder, late }) => {
  appId ??= registerWindowsAppId();
  const id = await appId;
  await new Promise<void>((resolve, reject) => {
    notifier.notify(
      {
        title: late ? 'Recordatorio atrasado' : 'Recordatorio',
        message: reminder.title,
        appID: id,
        wait: false,
      },
      (err) => (err ? reject(err) : resolve()),
    );
  });
};
