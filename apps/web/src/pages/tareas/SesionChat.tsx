import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DevSession, TaskChat } from '@dev-assistant/shared';
import { Copy, SquareTerminal } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, queryKeys } from '../../api';
import { ChatPanel, smallButton } from '../../components/ChatPanel';
import { McpWarning } from '../../components/McpWarning';
import { primaryButtonClass, secondaryButtonClass } from '../../components/fields';

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
        title={
          <>
            {t('session.chat.title')}
            {session?.analysis && (
              <span className="ml-2.5 rounded border border-info px-2 py-0.5 align-middle text-small font-normal text-info">{t('session.chat.analysis.badge')}</span>
            )}
          </>
        }
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
        empty={(submit, disabled) => <StartOptions chat={chat.data} disabled={disabled} submit={submit} />}
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

/** Antes de empezar: analizar la incidencia (sin tocar código) o el desarrollo de siempre. */
function StartOptions({ chat, disabled, submit }: { chat: TaskChat | undefined; disabled: boolean; submit: (text: string) => void }) {
  const { t } = useTranslation('tasks');
  const analysisFirst = !!chat?.suggestAnalysis;
  const options = [
    {
      id: 'analysis',
      title: t('session.chat.analysis.title'),
      body: t('session.chat.analysis.body'),
      action: t('session.chat.analysis.start'),
      prompt: chat?.analysisPrompt,
      recommended: analysisFirst,
    },
    { id: 'development', title: t('session.chat.development.title'), body: t('session.chat.emptyBody'), action: t('session.chat.start'), prompt: chat?.starterPrompt, recommended: !analysisFirst },
  ];
  // La recomendada va primero.
  if (!analysisFirst) options.reverse();
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 font-medium">{t('session.chat.emptyTitle')}</p>
      <div className="flex flex-wrap gap-3">
        {options.map((o) => (
          <div key={o.id} className={`flex min-w-[260px] flex-1 flex-col gap-2 rounded-lg border bg-bg p-3.5 ${o.recommended ? 'border-info' : 'border-line'}`}>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h3 className="m-0 font-semibold">{o.title}</h3>
              {o.recommended && analysisFirst && <span className="text-small text-success">{t('session.chat.analysis.recommended')}</span>}
            </div>
            <p className="m-0 text-small text-ink-muted">{o.body}</p>
            <button
              type="button"
              className={`${o.recommended ? primaryButtonClass : secondaryButtonClass} self-start`}
              disabled={disabled || !o.prompt}
              onClick={() => o.prompt && submit(o.prompt)}
            >
              {o.action}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
