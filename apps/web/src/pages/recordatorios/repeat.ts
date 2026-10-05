import type { Repeat } from '@dev-assistant/shared';
import { hhmm } from '../../dates';

export const WEEKDAYS = [
  { day: 1, short: 'L', name: 'lunes' },
  { day: 2, short: 'M', name: 'martes' },
  { day: 3, short: 'X', name: 'miércoles' },
  { day: 4, short: 'J', name: 'jueves' },
  { day: 5, short: 'V', name: 'viernes' },
  { day: 6, short: 'S', name: 'sábado' },
  { day: 7, short: 'D', name: 'domingo' },
] as const;

const dayMonth = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' });

function joinSpanish(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

function dayNames(days: number[]): string {
  return joinSpanish([...days].sort().map((d) => WEEKDAYS[d - 1]!.name));
}

/** Texto corto para la lista: "De lunes a viernes · 09:30". */
export function repeatLabel(repeat: Repeat, dueAt: string): string {
  const at = hhmm(dueAt);
  switch (repeat.kind) {
    case 'none':
      return at;
    case 'daily':
      return `Cada día · ${at}`;
    case 'weekdays':
      return `De lunes a viernes · ${at}`;
    case 'weekly':
      return `Cada ${dayNames(repeat.days)} · ${at}`;
  }
}

/** Frase de resumen bajo "Repetir": "De lunes a viernes a las 09:30, empezando el 6 de octubre." */
export function repeatSummary(repeat: Repeat, start: Date): string {
  const at = hhmm(start);
  const from = dayMonth.format(start);
  switch (repeat.kind) {
    case 'none':
      return `Una sola vez, el ${from} a las ${at}.`;
    case 'daily':
      return `Cada día a las ${at}, empezando el ${from}.`;
    case 'weekdays':
      return `De lunes a viernes a las ${at}, empezando el ${from}.`;
    case 'weekly':
      return repeat.days.length ? `Cada ${dayNames(repeat.days)} a las ${at}.` : 'Elige al menos un día.';
  }
}
