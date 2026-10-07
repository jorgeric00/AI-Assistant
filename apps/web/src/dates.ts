import i18n, { locale } from './i18n';

const formatters = new Map<string, Intl.DateTimeFormat>();
/** Formateador de Intl en el idioma actual de la app (se crea una vez por idioma y formato). */
function fmt(name: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale()}|${name}`;
  let f = formatters.get(key);
  if (!f) formatters.set(key, (f = new Intl.DateTimeFormat(locale(), options)));
  return f;
}
const dayMonth = { format: (d: Date) => fmt('dayMonth', { day: 'numeric', month: 'short' }).format(d) };
const time = { format: (d: Date) => fmt('time', { hour: '2-digit', minute: '2-digit' }).format(d) };

function dayDiff(date: Date, now: Date): number {
  const a = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** "Hoy", "Ayer" o "2 oct". */
export function shortDay(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const diff = dayDiff(date, now);
  if (diff === 0) return i18n.t('dates.today');
  if (diff === 1) return i18n.t('dates.yesterday');
  return dayMonth.format(date).replace('.', '');
}

/** "hoy a las 10:05", "ayer a las 18:30" o "el 2 oct a las 09:00" (en inglés, "today at 10:05"...). */
export function dayAndTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const diff = dayDiff(date, now);
  const day =
    diff === 0 ? i18n.t('dates.todayLower') : diff === 1 ? i18n.t('dates.yesterdayLower') : i18n.t('dates.onDay', { day: dayMonth.format(date).replace('.', '') });
  return i18n.t('dates.dayAtTime', { day, time: time.format(date) });
}

const weekdayDay = { format: (d: Date) => fmt('weekdayDay', { weekday: 'short', day: 'numeric' }).format(d) };
const longDate = { format: (d: Date) => fmt('longDate', { weekday: 'long', day: 'numeric', month: 'long' }).format(d) };

/** "10:05". */
export function hhmm(iso: string | Date): string {
  return time.format(new Date(iso));
}

/** Fecha local "YYYY-MM-DD" (la que usa el diario). */
export function localDate(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** "YYYY-MM-DD" → Date a las 00:00 locales. */
export function parseLocalDate(text: string): Date {
  const [y, m, d] = text.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Lunes 5 de octubre". */
export function longDay(date: Date): string {
  return capitalize(longDate.format(date).replace(',', ''));
}

/** "Mié 7 · 10:00" o "12:00" si es hoy. */
export function whenLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (dayDiff(date, now) === 0) return hhmm(date);
  return `${capitalize(weekdayDay.format(date).replace('.', '').replace(',', ''))} · ${hhmm(date)}`;
}

/** Días entre hoy y la fecha (negativo = futuro). */
export function daysAgo(iso: string, now = new Date()): number {
  return dayDiff(new Date(iso), now);
}

/** "hace un momento", "hace 3 min", "hace 2 h" o "el 2 oct a las 09:00". */
export function timeAgo(iso: string, now = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return i18n.t('dates.justNow');
  if (minutes < 60) return i18n.t('dates.minutesAgo', { count: minutes });
  if (minutes < 12 * 60) return i18n.t('dates.hoursAgo', { count: Math.floor(minutes / 60) });
  return dayAndTime(iso, now);
}
