import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '../../api';

/** Estado de la conexión con JIRA y acción "Sincronizar". */
export function useJiraSync() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: queryKeys.jiraStatus, queryFn: api.jiraStatus, refetchInterval: 60_000 });
  const sync = useMutation({
    mutationFn: api.syncJira,
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
  });
  return { status, sync };
}

export function useTaskList(done: boolean) {
  // La sincronización automática corre en el servidor cada 15 min; la lista se refresca cada minuto.
  return useQuery({ queryKey: queryKeys.taskList(done), queryFn: () => api.listTasks(done), placeholderData: (prev) => prev, refetchInterval: 60_000 });
}
