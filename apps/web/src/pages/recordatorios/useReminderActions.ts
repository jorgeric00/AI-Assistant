import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SnoozeInput } from '@dev-assistant/shared';
import { api, queryKeys } from '../../api';

/** Marcar como hecho y posponer, refrescando recordatorios y avisos. */
export function useReminderActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.reminders });
  const complete = useMutation({ mutationFn: (id: number) => api.completeReminder(id), onSuccess: refresh });
  const snooze = useMutation({
    mutationFn: ({ id, until }: { id: number; until: SnoozeInput['until'] }) => api.snoozeReminder(id, until),
    onSuccess: refresh,
  });
  return {
    complete: (id: number) => complete.mutate(id),
    snooze: (id: number, until: SnoozeInput['until']) => snooze.mutate({ id, until }),
  };
}
