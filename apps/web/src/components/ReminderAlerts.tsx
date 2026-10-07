import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, queryKeys } from '../api';
import { hhmm } from '../dates';
import { useReminderActions } from '../pages/recordatorios/useReminderActions';
import { SnoozeMenu } from './SnoozeMenu';

/** Avisos de recordatorios vencidos, abajo a la derecha, hasta que los atiendas. */
export function ReminderAlerts() {
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const alerts = useQuery({ queryKey: queryKeys.alerts, queryFn: api.listAlerts, refetchInterval: 15_000 });
  const { complete, snooze } = useReminderActions();
  const dismiss = useMutation({
    mutationFn: (id: number) => api.markAlertSeen(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.alerts }),
  });

  if (!alerts.data?.length) return null;

  return (
    <div aria-live="polite" className="fixed right-6 bottom-6 z-40 flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-2">
      {alerts.data.map((a) => (
        <div key={a.id} role="alert" className="flex flex-col gap-3 rounded-md border border-accent bg-surface-raised p-4">
          <div className="flex items-start gap-3">
            <Bell size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-accent" aria-hidden />
            <div className="flex min-w-0 grow flex-col gap-0.5">
              <span className="font-medium break-words">{a.title}</span>
              <span className="text-small text-ink-muted">
                {a.late ? t('reminderAlerts.late', { time: hhmm(a.scheduledFor ?? a.firedAt) }) : hhmm(a.firedAt)}
              </span>
            </div>
            <button type="button" aria-label={t('reminderAlerts.dismiss')} onClick={() => dismiss.mutate(a.id)} className="flex size-6 items-center justify-center text-ink-muted hover:text-ink">
              <X size={14} aria-hidden />
            </button>
          </div>
          <div className="flex justify-end gap-2">
            <SnoozeMenu up onSnooze={(until) => snooze(a.reminderId, until)} />
            <button type="button" onClick={() => complete(a.reminderId)} className="h-8 rounded-md bg-accent px-3 text-[13px] font-semibold text-on-accent">
              {t('reminderAlerts.done')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
