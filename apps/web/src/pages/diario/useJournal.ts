import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '../../api';

/** Entradas del diario de un día (YYYY-MM-DD) con alta y borrado. */
export function useJournal(date: string) {
  const queryClient = useQueryClient();
  const entries = useQuery({ queryKey: queryKeys.journal(date), queryFn: () => api.listJournal(date) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.journal(date) });
  const add = useMutation({ mutationFn: (text: string) => api.addJournalEntry({ date, text }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: number) => api.deleteJournalEntry(id), onSuccess: refresh });
  return { entries, add, remove };
}
