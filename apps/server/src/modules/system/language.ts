// Ajustes > Idioma: se guarda en settings y se aplica al servidor al arrancar y al cambiarlo.
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { LANGUAGES, LanguageUpdate, type Language, type LanguageSetting } from '@dev-assistant/shared';
import type { Db } from '../../db/client.js';
import { settings } from '../../db/schema.js';
import { setLanguage } from '../../i18n/index.js';

const KEY = 'ui.language';

export function storedLanguage(db: Db): Language | null {
  const value = db.select().from(settings).where(eq(settings.key, KEY)).get()?.valueJson;
  return LANGUAGES.includes(value as Language) ? (value as Language) : null;
}

export async function languageRoutes(app: FastifyInstance, { db }: { db: Db }) {
  setLanguage(storedLanguage(db) ?? 'es');

  app.get('/api/settings/language', async (): Promise<LanguageSetting> => ({ language: storedLanguage(db) }));
  app.put('/api/settings/language', async (req): Promise<LanguageSetting> => {
    const { language } = LanguageUpdate.parse(req.body);
    db.insert(settings).values({ key: KEY, valueJson: language }).onConflictDoUpdate({ target: settings.key, set: { valueJson: language } }).run();
    setLanguage(language);
    return { language };
  });
}
