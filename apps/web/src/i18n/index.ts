// Internacionalización (Ajustes > Idioma): castellano e inglés con i18next. El idioma elegido se guarda
// en el servidor (lo usan también sus mensajes y la IA) y aquí se recuerda para arrancar sin parpadeo.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LANGUAGES, type Language } from '@dev-assistant/shared';
import { NAMESPACES, resources } from './resources';

const STORAGE_KEY = 'ai-assistant.language';

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.includes(value as Language);
}

/** El que usó la última vez; si no, el del navegador (inglés si es inglés, si no castellano). */
export function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(saved)) return saved;
  } catch {
    // Sin localStorage: se usa el del navegador.
  }
  return browserLanguage();
}

export function browserLanguage(): Language {
  return navigator.language.toLowerCase().startsWith('en') ? 'en' : 'es';
}

export function applyLanguage(lang: Language) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Sin localStorage solo se pierde el recordatorio local; el servidor lo guarda igual.
  }
  document.documentElement.lang = lang;
  if (i18n.language !== lang) void i18n.changeLanguage(lang);
}

/** Locale para Intl (fechas y números). */
export function locale(): string {
  return i18n.language === 'en' ? 'en-GB' : 'es-ES';
}

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage(),
  fallbackLng: 'es',
  ns: [...NAMESPACES],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
});
document.documentElement.lang = i18n.language;

export default i18n;
