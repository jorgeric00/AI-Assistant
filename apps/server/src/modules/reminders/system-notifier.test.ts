import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { registerWindowsAppId, WINDOWS_APP_ID } from './system-notifier.js';

const APPDATA = 'C:\\Users\\j\\AppData\\Roaming';
const SHORTCUT = join(APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'AI-Assistant.lnk');

function deps(existing: string[], fail = false) {
  const files = new Set(existing);
  const runs: string[][] = [];
  return {
    runs,
    deps: {
      platform: 'win32' as const,
      appData: APPDATA,
      exists: (p: string) => files.has(p),
      runSnoreToast: async (args: string[]) => {
        runs.push(args);
        if (fail) throw new Error('snoretoast falló');
        files.add(SHORTCUT);
      },
      nodePath: 'C:\\node\\node.exe',
    },
  };
}

describe('registro de la app en Windows para las notificaciones', () => {
  it('crea una vez el acceso directo con el appID y después lo reutiliza', async () => {
    const first = deps([]);
    expect(await registerWindowsAppId(first.deps)).toBe(WINDOWS_APP_ID);
    expect(first.runs).toEqual([['-install', 'AI-Assistant.lnk', 'C:\\node\\node.exe', 'AI-Assistant']]);

    const again = deps([SHORTCUT]);
    expect(await registerWindowsAppId(again.deps)).toBe(WINDOWS_APP_ID);
    expect(again.runs).toEqual([]);
  });

  it('si no se puede registrar, usa el appID por defecto para que el aviso salga igualmente', async () => {
    expect(await registerWindowsAppId(deps([], true).deps)).toBeUndefined();
  });

  it('fuera de Windows no registra nada', async () => {
    const other = deps([]);
    expect(await registerWindowsAppId({ ...other.deps, platform: 'linux' })).toBe(WINDOWS_APP_ID);
    expect(other.runs).toEqual([]);
  });
});
