// Repeticiones de recordatorios (R12). Se calculan en la hora local del ordenador, para que
// "cada día a las 09:30" siga siendo a las 09:30 tras el cambio de hora.
import type { Repeat, SnoozeInput } from '@dev-assistant/shared';

const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const; // índice = día ISO - 1
const WEEKDAYS = [1, 2, 3, 4, 5];

/** Repetición → regla guardada en `reminders.rrule` (subconjunto de RFC 5545). */
export function repeatToRrule(repeat: Repeat): string | null {
  switch (repeat.kind) {
    case 'none':
      return null;
    case 'daily':
      return 'FREQ=DAILY';
    case 'weekdays':
      return `FREQ=WEEKLY;BYDAY=${WEEKDAYS.map((d) => BYDAY[d - 1]).join(',')}`;
    case 'weekly':
      return `FREQ=WEEKLY;BYDAY=${[...new Set(repeat.days)].sort().map((d) => BYDAY[d - 1]).join(',')}`;
  }
}

export function rruleToRepeat(rrule: string | null): Repeat {
  if (!rrule) return { kind: 'none' };
  if (rrule === 'FREQ=DAILY') return { kind: 'daily' };
  const byday = rrule.match(/BYDAY=([A-Z,]+)/)?.[1];
  const days = (byday?.split(',') ?? [])
    .map((code) => BYDAY.indexOf(code as (typeof BYDAY)[number]) + 1)
    .filter((d) => d > 0)
    .sort();
  if (days.join() === WEEKDAYS.join()) return { kind: 'weekdays' };
  return days.length ? { kind: 'weekly', days } : { kind: 'none' };
}

function isoWeekday(date: Date): number {
  return date.getDay() === 0 ? 7 : date.getDay();
}

function allowedDays(repeat: Repeat): number[] | null {
  if (repeat.kind === 'weekdays') return WEEKDAYS;
  if (repeat.kind === 'weekly') return repeat.days;
  return null; // diario: todos los días
}

/** Mismo reloj local, un día después (setDate respeta los cambios de hora). */
function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Primera repetición válida a partir de `start` incluido (p. ej. un sábado en "de lunes a viernes" pasa al lunes). */
export function firstOccurrence(repeat: Repeat, start: Date): Date {
  const days = allowedDays(repeat);
  if (!days) return start;
  let date = start;
  for (let i = 0; i < 7 && !days.includes(isoWeekday(date)); i++) date = addLocalDays(date, 1);
  return date;
}

/** Siguiente repetición estrictamente posterior a `from`. Para 'none' devuelve null. */
export function nextOccurrence(repeat: Repeat, from: Date): Date | null {
  if (repeat.kind === 'none') return null;
  return firstOccurrence(repeat, addLocalDays(from, 1));
}

/** Avanza un recurrente hasta la primera repetición posterior a `now` (no acumula avisos perdidos). */
export function advancePast(repeat: Repeat, due: Date, now: Date): Date {
  let next = due;
  while (next <= now) {
    const candidate = nextOccurrence(repeat, next);
    if (!candidate) return due;
    next = candidate;
  }
  return next;
}

/** Momento al que pospone cada opción: 10 min, 1 hora o mañana a las 9:00 (hora local). */
export function snoozeUntil(option: SnoozeInput['until'], now: Date): Date {
  switch (option) {
    case '10m':
      return new Date(now.getTime() + 10 * 60_000);
    case '1h':
      return new Date(now.getTime() + 60 * 60_000);
    case 'tomorrow': {
      const t = addLocalDays(now, 1);
      t.setHours(9, 0, 0, 0);
      return t;
    }
  }
}
