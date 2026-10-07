// Textos de la interfaz: un fichero JSON por idioma y zona de la app (namespace).
// El castellano es la referencia: los tipos de las claves salen de los ficheros es/.
import common_es from './locales/es/common.json';
import hoy_es from './locales/es/hoy.json';
import prs_es from './locales/es/prs.json';
import notes_es from './locales/es/notes.json';
import reminders_es from './locales/es/reminders.json';
import diary_es from './locales/es/diary.json';
import tasks_es from './locales/es/tasks.json';
import repos_es from './locales/es/repos.json';
import settings_es from './locales/es/settings.json';
import common_en from './locales/en/common.json';
import hoy_en from './locales/en/hoy.json';
import prs_en from './locales/en/prs.json';
import notes_en from './locales/en/notes.json';
import reminders_en from './locales/en/reminders.json';
import diary_en from './locales/en/diary.json';
import tasks_en from './locales/en/tasks.json';
import repos_en from './locales/en/repos.json';
import settings_en from './locales/en/settings.json';

export const NAMESPACES = ['common', 'hoy', 'prs', 'notes', 'reminders', 'diary', 'tasks', 'repos', 'settings'] as const;

export const resources = {
  es: {
    common: common_es,
    hoy: hoy_es,
    prs: prs_es,
    notes: notes_es,
    reminders: reminders_es,
    diary: diary_es,
    tasks: tasks_es,
    repos: repos_es,
    settings: settings_es,
  },
  en: {
    common: common_en,
    hoy: hoy_en,
    prs: prs_en,
    notes: notes_en,
    reminders: reminders_en,
    diary: diary_en,
    tasks: tasks_en,
    repos: repos_en,
    settings: settings_en,
  },
} as const;
