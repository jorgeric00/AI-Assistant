// Copia de seguridad de la base de datos (Ajustes > Copias de seguridad): una al día, al arrancar o en
// cuanto cambie el día, y otra cuando se pida. Se guardan las 7 más recientes.
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type Database from 'better-sqlite3';
import type { BackupStatus } from '@dev-assistant/shared';
import { t } from '../../i18n/index.js';
import { localDay } from '../journal/feed.js';

const KEEP = 7;
const CHECK_MS = 60 * 60_000;
const FILE_RE = /^assistant-(\d{4}-\d{2}-\d{2})(?:-(\d{6}))?\.db$/;
/** Orden por la fecha del nombre (la diaria cuenta como la primera del día). */
const sortKey = (name: string) => {
  const m = FILE_RE.exec(name);
  return m ? `${m[1]}-${m[2] ?? '000000'}` : '';
};

export class Backups {
  constructor(
    private readonly sqlite: Database.Database | null,
    readonly dir: string,
  ) {}

  private async files(): Promise<{ name: string; at: string; bytes: number }[]> {
    let names: string[];
    try {
      names = (await readdir(this.dir)).filter((n) => FILE_RE.test(n));
    } catch {
      return [];
    }
    const files = await Promise.all(
      names.map(async (name) => {
        const s = await stat(join(this.dir, name));
        return { name, at: s.mtime.toISOString(), bytes: s.size };
      }),
    );
    return files.sort((a, b) => sortKey(b.name).localeCompare(sortKey(a.name)) || b.at.localeCompare(a.at));
  }

  async status(): Promise<BackupStatus> {
    const files = await this.files();
    return { supported: !!this.sqlite, dir: this.dir, count: files.length, last: files[0] ?? null };
  }

  /** Hace una copia ahora (con `daily`, solo si hoy aún no hay ninguna) y borra las que sobran. */
  async run({ daily = false }: { daily?: boolean } = {}): Promise<BackupStatus> {
    if (!this.sqlite) throw new Error(t('backups.noDatabase'));
    const now = new Date();
    const day = localDay(now);
    if (daily && (await this.files()).some((f) => FILE_RE.exec(f.name)?.[1] === day)) return this.status();
    await mkdir(this.dir, { recursive: true });
    const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
    await this.sqlite.backup(join(this.dir, daily ? `assistant-${day}.db` : `assistant-${day}-${time}.db`));
    for (const old of (await this.files()).slice(KEEP)) await rm(join(this.dir, old.name), { force: true });
    return this.status();
  }

  /** Copia diaria: al arrancar y cada hora se comprueba si ya hay una de hoy. */
  start(log: FastifyBaseLogger) {
    if (!this.sqlite) return () => {};
    const tick = () => this.run({ daily: true }).catch((err: unknown) => log.warn(`No se pudo hacer la copia de seguridad: ${err instanceof Error ? err.message : String(err)}`));
    void tick();
    const timer = setInterval(tick, CHECK_MS);
    timer.unref();
    return () => clearInterval(timer);
  }
}
