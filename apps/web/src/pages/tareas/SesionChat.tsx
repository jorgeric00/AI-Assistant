import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DevSession, TaskChat } from '@dev-assistant/shared';
import { Copy, SquareTerminal } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, queryKeys } from '../../api';
import { ChatPanel, smallButton } from '../../components/ChatPanel';
import { McpWarning } from '../../components/McpWarning';
import { primaryButtonClass } from '../../components/fields';

/** Chat con opencode en la carpeta de la tarea: se elige modelo y modo en cada mensaje y se responden sus permisos. */
export function SesionChat({ taskKey, session }: { taskKey: string; session: DevSession | null }) {
  const { t } = useTranslation('tasks');
  const queryClient = useQueryClient();
  const chatKey = queryKeys.taskChat(taskKey);
  const chat = useQuery({
    queryKey: chatKey,
    queryFn: () => api.taskChat(taskKey),
    // Mientras opencode trabaja (o espera un permiso) se sigue de cerca; en reposo, de vez en cuando.
    refetchInterval: (q) => (q.state.data?.busy ? 1500 : q.state.data?.started ? 10_000 : false),
  });
  const options = useQuery({ queryKey: queryKeys.aiOptions, queryFn: () => api.aiOptions(), staleTime: 60_000 });
  const setChat = (data: TaskChat) => queryClient.setQueryData(chatKey, data);
  const reset = useMutation({ mutationFn: () => api.resetTaskChat(taskKey), onSuccess: setChat });

  return (
    <div className="flex flex-col gap-3">
      <McpWarning />
      <ChatPanel
        titleId="chat-titulo"
        title={t('session.chat.title')}
        actions={
          <>
            <button type="button" className={smallButton} disabled={!chat.data?.started || reset.isPending} onClick={() => reset.mutate()}>
              {t('session.chat.newSession')}
            </button>
            <TerminalButton taskKey={taskKey} session={session} />
          </>
        }
        data={chat.data}
        loadError={chat.error}
        extraError={reset.error}
        options={options.data}
        actionsApi={{
          send: (input) => api.sendTaskChat(taskKey, input),
          abort: () => api.abortTaskChat(taskKey),
          reply: (id, answer) => api.replyTaskPermission(taskKey, id, answer),
          answer: (id, input) => api.answerTaskQuestion(taskKey, id, input),
        }}
        onData={setChat}
        // Al terminar un turno, opencode puede haber cambiado el plan, el historial y los repos.
        onIdle={() => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.taskSession(taskKey) });
          void queryClient.invalidateQueries({ queryKey: queryKeys.taskDev(taskKey) });
        }}
        empty={(submit, disabled) => (
          <div className="flex flex-col items-start gap-2.5">
            <p className="m-0 font-medium">{t('session.chat.emptyTitle')}</p>
            <p className="m-0 text-ink-muted">{t('session.chat.emptyBody')}</p>
            <button type="button" className={primaryButtonClass} disabled={disabled} onClick={() => chat.data && submit(chat.data.starterPrompt)}>
              {t('session.chat.start')}
            </button>
          </div>
        )}
        help={t('session.chat.help')}
      />
    </div>
  );
}

/** "Abrir en terminal" donde la app sabe abrirla (Windows); en el resto, copia el comando. */
function TerminalButton({ taskKey, session }: { taskKey: string; session: DevSession | null }) {
  const { t } = useTranslation('tasks');
  const [copied, setCopied] = useState(false);
  const open = useMutation({ mutationFn: () => api.openTaskSession(taskKey) });
  const command = open.data?.command ?? session?.command ?? '';
  const copy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  if (session && !session.canOpen) {
    return (
      <button type="button" className={smallButton} disabled={!command} onClick={copy} title={t('session.cannotOpen')}>
        <Copy size={14} strokeWidth={1.5} aria-hidden />
        {copied ? t('session.copied') : t('session.copyCommand')}
      </button>
    );
  }
  return (
    <button type="button" className={smallButton} disabled={open.isPending} onClick={() => open.mutate()} title={open.isError ? open.error.message : undefined}>
      <SquareTerminal size={14} strokeWidth={1.5} aria-hidden />
      {open.isPending ? t('session.opening') : t('session.chat.openTerminal')}
    </button>
  );
}
