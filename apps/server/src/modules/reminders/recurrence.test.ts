import { describe, expect, it } from 'vitest';
import { advancePast, firstOccurrence, nextOccurrence, repeatToRrule, rruleToRepeat, snoozeUntil } from './recurrence.js';

// Hora local de Madrid (fijada en vitest.config.ts). El 2026-10-25 cambia de horario de verano a invierno.
const local = (y: number, m: number, d: number, h = 9, min = 30) => new Date(y, m - 1, d, h, min);

describe('repeticiones', () => {
  it('convierte entre repetición y rrule', () => {
    expect(repeatToRrule({ kind: 'none' })).toBeNull();
    expect(repeatToRrule({ kind: 'weekdays' })).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(repeatToRrule({ kind: 'weekly', days: [3, 1, 3] })).toBe('FREQ=WEEKLY;BYDAY=MO,WE');
    expect(rruleToRepeat('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')).toEqual({ kind: 'weekdays' });
    expect(rruleToRepeat('FREQ=WEEKLY;BYDAY=MO,WE')).toEqual({ kind: 'weekly', days: [1, 3] });
    expect(rruleToRepeat('FREQ=DAILY')).toEqual({ kind: 'daily' });
  });

  it('de lunes a viernes salta el fin de semana', () => {
    const viernes = local(2026, 10, 9);
    expect(nextOccurrence({ kind: 'weekdays' }, viernes)).toEqual(local(2026, 10, 12));
    expect(firstOccurrence({ kind: 'weekdays' }, local(2026, 10, 10))).toEqual(local(2026, 10, 12));
  });

  it('semanal con días elegidos', () => {
    const repeat = { kind: 'weekly' as const, days: [1, 3] };
    expect(nextOccurrence(repeat, local(2026, 10, 5))).toEqual(local(2026, 10, 7));
    expect(nextOccurrence(repeat, local(2026, 10, 7))).toEqual(local(2026, 10, 12));
  });

  it('mantiene la hora local tras el cambio de hora', () => {
    const next = nextOccurrence({ kind: 'daily' }, local(2026, 10, 24));
    expect(next).toEqual(local(2026, 10, 25));
    expect(next!.getHours()).toBe(9);
    expect(next!.getMinutes()).toBe(30);
  });

  it('no acumula repeticiones perdidas', () => {
    const due = local(2026, 10, 1);
    expect(advancePast({ kind: 'daily' }, due, local(2026, 10, 5, 12))).toEqual(local(2026, 10, 6));
    expect(advancePast({ kind: 'none' }, due, local(2026, 10, 5))).toEqual(due);
  });

  it('posponer', () => {
    const now = local(2026, 10, 5, 17, 0);
    expect(snoozeUntil('10m', now)).toEqual(local(2026, 10, 5, 17, 10));
    expect(snoozeUntil('1h', now)).toEqual(local(2026, 10, 5, 18, 0));
    expect(snoozeUntil('tomorrow', now)).toEqual(local(2026, 10, 6, 9, 0));
  });
});
