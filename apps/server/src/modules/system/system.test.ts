import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AutostartStatus, BackupStatus } from '@dev-assistant/shared';
import { buildApp } from '../../app.js';
import { openDatabase } from '../../db/client.js';
import { Autostart, startupScript } from './autostart.js';
import { Backups } from './backup.js';

const tmp = () => mkdtemp(join(tmpdir(), 'ai-assistant-'));

let close: (() => Promise<unknown>) | undefined;
afterEach(async () => close?.());

describe('arranque automático', () => {
  it('el script de Inicio arranca la app oculta en su carpeta y deja el registro', () => {
    const vbs = startupScript('C:\\Users\\jorge\\AI-Assistant', 'C:\\Users\\jorge\\.dev-assistant\\logs\\app.log');
    expect(vbs).toContain('set AI_ASSISTANT_AUTOSTART=1&& cd /d ""C:\\Users\\jorge\\AI-Assistant""');
    expect(vbs).toContain('npx pnpm@10.28.0 start > ""C:\\Users\\jorge\\.dev-assistant\\logs\\app.log"" 2>&1", 0, False');
  });

  it('en Windows se activa y se quita desde Ajustes; "abrir en el navegador" se guarda', async () => {
    const appData = await tmp();
    const { db } = openDatabase(':memory:');
    const logFile = join(appData, 'logs', 'app.log');
    const autostart = new Autostart(db, { platform: 'win32', appData, repoRoot: 'C:\\app', logFile });
    const app = await buildApp(db, { autostart });
    close = () => app.close();
    const script = join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'AI-Assistant.vbs');

    expect((await app.inject({ method: 'GET', url: '/api/system/autostart' })).json<AutostartStatus>()).toEqual({ supported: true, enabled: false, openBrowser: true, logFile });

    let res = await app.inject({ method: 'PATCH', url: '/api/system/autostart', payload: { enabled: true, openBrowser: false } });
    expect(res.json<AutostartStatus>()).toMatchObject({ enabled: true, openBrowser: false });
    expect(await readFile(script, 'utf8')).toContain('C:\\app');
    expect(autostart.openBrowser()).toBe(false);

    res = await app.inject({ method: 'PATCH', url: '/api/system/autostart', payload: { enabled: false } });
    expect(res.json<AutostartStatus>()).toMatchObject({ enabled: false, openBrowser: false });
    expect(existsSync(script)).toBe(false);
  });

  it('fuera de Windows no está disponible', () => {
    const { db } = openDatabase(':memory:');
    expect(new Autostart(db, { platform: 'linux', appData: undefined, repoRoot: '/app', logFile: '/x.log' }).status()).toMatchObject({ supported: false, enabled: false });
  });
});

describe('copias de seguridad', () => {
  it('copia la base de datos, una diaria por día, y conserva las 7 más recientes', async () => {
    const dir = await tmp();
    const { db, sqlite } = openDatabase(join(dir, 'assistant.db'));
    const backups = new Backups(sqlite, join(dir, 'copias'));
    const app = await buildApp(db, { backups });
    close = async () => {
      await app.close();
      sqlite.close();
    };

    expect((await app.inject({ method: 'GET', url: '/api/system/backups' })).json<BackupStatus>()).toMatchObject({ supported: true, count: 0, last: null });

    await backups.run({ daily: true });
    await backups.run({ daily: true });
    expect((await backups.status()).count).toBe(1);

    const res = await app.inject({ method: 'POST', url: '/api/system/backups' });
    expect(res.statusCode).toBe(201);
    const status = res.json<BackupStatus>();
    expect(status.count).toBe(2);
    expect(status.last?.bytes).toBeGreaterThan(0);

    // Copias antiguas de otros días: se borran las que pasan de 7.
    for (let d = 1; d <= 8; d++) await writeFile(join(dir, 'copias', `assistant-2020-01-0${d}.db`), 'x');
    await mkdir(join(dir, 'copias', 'otra-cosa'), { recursive: true });
    await backups.run();
    const left = (await readdir(join(dir, 'copias'))).filter((n) => n.endsWith('.db'));
    expect(left).toHaveLength(7);
    // Se quedan las de hoy y, de las antiguas, las más nuevas.
    expect(left).not.toContain('assistant-2020-01-01.db');
    expect(left).toContain('assistant-2020-01-08.db');
  });
});

describe('web compilada', () => {
  it('sirve la web y sus ficheros, sin salir de dist ni tapar la API', async () => {
    const dist = await tmp();
    await mkdir(join(dist, 'assets'));
    await writeFile(join(dist, 'index.html'), '<!doctype html><title>AI-Assistant</title>');
    await writeFile(join(dist, 'assets', 'app.js'), 'console.log(1)');
    const app = await buildApp(openDatabase(':memory:').db, { webDist: dist });
    close = () => app.close();

    const home = await app.inject({ method: 'GET', url: '/' });
    expect(home.headers['content-type']).toContain('text/html');
    expect(home.body).toContain('AI-Assistant');
    const js = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(js.headers['content-type']).toContain('javascript');
    expect((await app.inject({ method: 'GET', url: '/assets' })).body).toContain('AI-Assistant');
    expect((await app.inject({ method: 'GET', url: '/%2e%2e/%2e%2e/package.json' })).body).toContain('AI-Assistant');
    expect((await app.inject({ method: 'GET', url: '/api/no-existe' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/prs/status' })).json()).toMatchObject({ configured: false });
  });
});
