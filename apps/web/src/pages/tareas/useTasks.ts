import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api, queryKeys } from '../../api';

/** Estado de la conexión con JIRA y acción "Sincronizar". */
export function useJiraSync() {
  const queryClient = useQueryClient();
  // Mientras sincroniza (p. ej. la automática al arrancar) se consulta más a menudo para ver el resultado.
  const status = useQuery({
    queryKey: queryKeys.jiraStatus,
    queryFn: api.jiraStatus,
    refetchInterval: (q) => (q.state.data?.syncing ? 2_000 : 60_000),
  });
  // Al terminar una sincronización que no lanzó este botón (la automática), se refresca la lista.
  const syncing = !!status.data?.syncing;
  const wasSyncing = useRef(syncing);
  useEffect(() => {
    if (wasSyncing.current && !syncing) void queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
    wasSyncing.current = syncing;
  }, [syncing, queryClient]);
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
