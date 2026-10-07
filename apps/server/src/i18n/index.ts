// Idioma de la app (Ajustes > Idioma): lo usan los mensajes del servidor, las notificaciones y lo que
// genera la IA. Es una app de un solo usuario, así que hay un idioma para todo el proceso.
import { z } from 'zod';
import { LANGUAGES, type Language } from '@dev-assistant/shared';
import { en } from './en.js';
import { es } from './es.js';

export type MessageKey = keyof typeof es;
export type Messages = Record<MessageKey, string>;

const messages: Record<Language, Messages> = { es, en };
let current: Language = 'es';

export function language(): Language {
  return current;
}

export function setLanguage(lang: Language) {
  current = LANGUAGES.includes(lang) ? lang : 'es';
  // Mensajes de validación de zod en el mismo idioma.
  z.config(current === 'en' ? z.locales.en() : z.locales.es());
}

/** Texto en el idioma actual; `{{name}}` se sustituye por vars.name. */
export function t(key: MessageKey, vars: Record<string, string | number> = {}): string {
  const text = messages[current][key] ?? es[key];
  return text.replace(/\{\{(\w+)\}\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** Locale para fechas y números (Intl). */
export function locale(): string {
  return current === 'en' ? 'en-GB' : 'es-ES';
}

setLanguage('es');
