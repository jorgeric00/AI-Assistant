const dayMonth = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
const time = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });

function dayDiff(date: Date, now: Date): number {
  const a = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** "Hoy", "Ayer" o "2 oct". */
export function shortDay(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const diff = dayDiff(date, now);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  return dayMonth.format(date).replace('.', '');
}

/** "hoy a las 10:05", "ayer a las 18:30" o "el 2 oct a las 09:00". */
export function dayAndTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const diff = dayDiff(date, now);
  const day = diff === 0 ? 'hoy' : diff === 1 ? 'ayer' : `el ${dayMonth.format(date).replace('.', '')}`;
  return `${day} a las ${time.format(date)}`;
}
