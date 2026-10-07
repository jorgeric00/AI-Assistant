import type { Repeat } from '@dev-assistant/shared';
import { hhmm } from '../../dates';
import i18n, { locale } from '../../i18n';

export interface Weekday {
  /** Día ISO: 1 = lunes … 7 = domingo. */
  day: number;
  /** Letra del botón (L M X J V S D). */
  short: string;
  /** Nombre completo en el idioma actual ("lunes", "Monday"). */
  name: string;
}

/** Días de la semana en el idioma actual (se calcula al llamar, no al cargar el módulo). */
export function weekdays(): Weekday[] {
  const letters = i18n.t('reminders:weekdayLetters');
  const fmt = new Intl.DateTimeFormat(locale(), { weekday: 'long' });
  // El 1 de enero de 2024 fue lunes.
  return [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, short: letters[day - 1] ?? '', name: fmt.format(new Date(2024, 0, day)) }));
}

function joinList(items: string[]): string {
  return new Intl.ListFormat(locale(), { style: 'long', type: 'conjunction' }).format(items);
}

function dayNames(days: number[]): string {
  const names = weekdays();
  return joinList([...days].sort().map((d) => names[d - 1]!.name));
}

/** Texto corto para la lista: "De lunes a viernes · 09:30". */
export function repeatLabel(repeat: Repeat, dueAt: string): string {
  const at = hhmm(dueAt);
  switch (repeat.kind) {
    case 'none':
      return at;
    case 'daily':
      return i18n.t('reminders:repeatLabel.daily', { at });
    case 'weekdays':
      return i18n.t('reminders:repeatLabel.weekdays', { at });
    case 'weekly':
      return i18n.t('reminders:repeatLabel.weekly', { days: dayNames(repeat.days), at });
  }
}

/** Frase de resumen bajo "Repetir": "De lunes a viernes a las 09:30, empezando el 6 de octubre." */
export function repeatSummary(repeat: Repeat, start: Date): string {
  const at = hhmm(start);
  const from = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long' }).format(start);
  switch (repeat.kind) {
    case 'none':
      return i18n.t('reminders:repeatSummary.none', { from, at });
    case 'daily':
      return i18n.t('reminders:repeatSummary.daily', { from, at });
    case 'weekdays':
      return i18n.t('reminders:repeatSummary.weekdays', { from, at });
    case 'weekly':
      return repeat.days.length ? i18n.t('reminders:repeatSummary.weekly', { days: dayNames(repeat.days), at }) : i18n.t('reminders:repeatSummary.noDays');
  }
}
