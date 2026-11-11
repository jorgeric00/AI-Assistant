import { useMutation } from '@tanstack/react-query';
import type { AiOptions, ChatMessage, ChatPart, ChatPermission, ChatPermissionReply, ChatQuestionReplyInput, ChatSendInput, ChatState } from '@dev-assistant/shared';
import { Circle, Lock, Send, Square } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Markdown } from './Markdown';
import { ModeToggle, ModelSelect, modeName, modelName } from './ModelPicker';
import { QuestionCard } from './QuestionCard';
import { primaryButtonClass, secondaryButtonClass } from './fields';

export const smallButton = 'flex h-8 items-center gap-1.5 rounded-md border border-line-strong px-3 text-code text-ink hover:bg-surface-raised disabled:cursor-not-allowed disabled:text-ink-faint';
const KNOWN_TOOLS = ['bash', 'read', 'edit', 'write', 'grep', 'glob', 'list', 'webfetch', 'task', 'skill', 'todowrite'] as const;
const QUESTION_VERBS = { completed: 'answered', error: 'skipped' } as const;
const KNOWN_PERMISSIONS = ['bash', 'edit', 'webfetch', 'external_directory'] as const;
const known = <T extends string>(list: readonly T[], value: string): value is T => (list as readonly string[]).includes(value);

export interface ChatActions<S extends ChatState> {
  send: (input: ChatSendInput) => Promise<S>;
  abort: () => Promise<S>;
  reply: (permissionId: string, answer: ChatPermissionReply) => Promise<S>;
  answer: (questionId: string, input: ChatQuestionReplyInput) => Promise<S>;
}

interface ChatPanelProps<S extends ChatState> {
  /** Id del encabezado que nombra la sección. */
  titleId: string;
  title: ReactNode;
  /** Botones a la derecha del encabezado. */
  actions?: ReactNode;
  data: S | undefined;
  loadError: Error | null;
  options: AiOptions | undefined;
  actionsApi: ChatActions<S>;
  /** Con lo que devuelve el servidor tras enviar, parar o contestar. */
  onData: (data: S) => void;
  /** Lo que se ve antes del primer mensaje; `submit` envía un texto con el modelo y el modo elegidos. */
  empty: (submit: (text: string) => void, disabled: boolean) => ReactNode;
  /** Ayuda bajo la caja de texto (tras la del modo elegido). */
  help: string;
  /** Al pasar de trabajando a en reposo. */
  onIdle?: () => void;
  extraError?: Error | null;
  className?: string;
}

/** Conversación con opencode: mensajes, actividad, permisos y la caja para escribir con modo y modelo. */
export function ChatPanel<S extends ChatState>({ titleId, title, actions, data, loadError, options, actionsApi, onData, empty, help, onIdle, extraError, className = '' }: ChatPanelProps<S>) {
  const { t } = useTranslation(['tasks', 'common']);
  const [text, setText] = useState('');
  // undefined = lo que diga la sesión (lo último usado, o lo de Ajustes).
  const [pickedModel, setPickedModel] = useState<string | null | undefined>(undefined);
  const [pickedAgent, setPickedAgent] = useState<string | undefined>(undefined);
  const model = pickedModel !== undefined ? pickedModel : (data?.model ?? null);
  const agent = pickedAgent ?? data?.agent ?? 'build';

  const send = useMutation({ mutationFn: (message: string) => actionsApi.send({ text: message, model, agent }), onSuccess: onData });
  const abort = useMutation({ mutationFn: () => actionsApi.abort(), onSuccess: onData });
  const reply = useMutation({ mutationFn: ({ id, answer }: { id: string; answer: ChatPermissionReply }) => actionsApi.reply(id, answer), onSuccess: onData });
  const answer = useMutation({ mutationFn: ({ id, input }: { id: string; input: ChatQuestionReplyInput }) => actionsApi.answer(id, input), onSuccess: onData });

  const busy = !!data?.busy || send.isPending;
  const waiting = !!data?.permissions.length;
  const asking = !!data?.questions.length;
  const wasBusy = useRef(false);
  const idle = useRef(onIdle);
  idle.current = onIdle;
  useEffect(() => {
    if (wasBusy.current && !busy) idle.current?.();
    wasBusy.current = busy;
  }, [busy]);

  // La conversación baja sola con lo nuevo, salvo que se haya subido a leer algo anterior.
  const log = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastMessage = data?.messages[data.messages.length - 1];
  const tail = `${data?.messages.length}:${lastMessage?.parts.length}:${lastMessage?.parts[lastMessage.parts.length - 1]?.id}:${data?.permissions.length}:${data?.questions.length}`;
  useEffect(() => {
    if (pinned.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [tail]);

  const submit = (message: string) => {
    const clean = message.trim();
    if (!clean || send.isPending || !data?.available) return;
    pinned.current = true;
    send.mutate(clean, { onSuccess: () => setText('') });
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(text);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(text);
    }
  };
  const error = send.error ?? abort.error ?? reply.error ?? answer.error ?? extraError ?? loadError;
  const inputId = `${titleId}-texto`;
  const modelId = `${titleId}-modelo`;

  return (
    <section aria-labelledby={titleId} className={`flex min-w-0 flex-col rounded-lg border border-line bg-surface ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <h2 id={titleId} className="m-0 min-w-0 text-heading font-semibold break-words">
            {title}
          </h2>
          <span role="status" className="flex items-center gap-1.5 text-small text-accent empty:hidden">
            {busy && (
              <>
                <Circle size={12} strokeWidth={2} aria-hidden />
                {waiting ? t('session.chat.waitingPermission') : asking ? t('session.chat.waitingAnswer') : t('session.chat.working')}
              </>
            )}
          </span>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>

      <div
        ref={log}
        role="log"
        aria-label={t('session.chat.log')}
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="flex max-h-[62vh] min-h-[200px] flex-col gap-3.5 overflow-y-auto p-4"
      >
        {!data ? (
          <p className="m-0 text-ink-muted">{loadError ? '' : t('common:status.loading')}</p>
        ) : !data.messages.length && !busy ? (
          empty(submit, !data.available || send.isPending)
        ) : (
          data.messages.map((m) => <Message key={m.id} message={m} options={options} />)
        )}
        {data?.permissions.map((p) => (
          <PermissionCard key={p.id} permission={p} disabled={reply.isPending} onReply={(answer) => reply.mutate({ id: p.id, answer })} />
        ))}
        {data?.questions.map((q) => (
          <QuestionCard key={q.id} question={q} disabled={answer.isPending} onAnswer={(input) => answer.mutate({ id: q.id, input })} />
        ))}
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-2.5 border-t border-line px-4 pt-3 pb-4">
        {data && !data.available && (
          <p role="alert" className="m-0 text-danger">
            {t('session.chat.unavailable', { error: data.error ?? '' })}
          </p>
        )}
        {error && (
          <p role="alert" className="m-0 text-danger">
            {error.message}
          </p>
        )}
        <label htmlFor={inputId} className="sr-only">
          {t('session.chat.inputLabel')}
        </label>
        <textarea
          id={inputId}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('session.chat.placeholder')}
          maxLength={20_000}
          className="w-full resize-y rounded-md border border-line-strong bg-surface-raised px-3 py-2.5 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2.5">
          <ModeToggle value={agent} onChange={setPickedAgent} options={options} />
          <label htmlFor={modelId} className="sr-only">
            {t('common:model.label')}
          </label>
          <ModelSelect id={modelId} value={model} onChange={setPickedModel} options={options} className="max-w-full flex-[0_1_260px]" />
          {data?.contextPercent != null && <span className="text-small text-ink-faint">{t('session.chat.context', { percent: data.contextPercent })}</span>}
          <span className="flex-1" />
          {busy && data?.started && (
            <button type="button" className={secondaryButtonClass} disabled={abort.isPending} onClick={() => abort.mutate()}>
              <Square size={14} strokeWidth={2} aria-hidden />
              {t('session.chat.stop')}
            </button>
          )}
          <button type="submit" className={primaryButtonClass} disabled={!text.trim() || send.isPending || !data?.available}>
            <Send size={16} strokeWidth={1.5} aria-hidden />
            {send.isPending ? t('session.chat.sending') : t('session.chat.send')}
          </button>
        </div>
        <p className="m-0 text-small text-ink-muted">
          {agent === 'build' ? `${t('session.chat.helpBuild')} ` : agent === 'plan' ? `${t('session.chat.helpPlan')} ` : ''}
          {help}
        </p>
      </form>
    </section>
  );
}

export function Message({ message, options }: { message: ChatMessage; options: AiOptions | undefined }) {
  const { t } = useTranslation('tasks');
  if (message.role === 'user') {
    return (
      <div className="max-w-[80%] self-end rounded-lg border border-line bg-surface-raised px-3 py-2.5 break-words whitespace-pre-wrap">
        <span className="sr-only">{t('session.chat.you')}: </span>
        {message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n')}
      </div>
    );
  }
  // Los trozos seguidos de actividad van en una lista; el texto, como respuesta.
  const blocks: (ChatPart & { type: 'text' } | (ChatPart & { type: 'tool' })[])[] = [];
  for (const part of message.parts) {
    const last = blocks[blocks.length - 1];
    if (part.type === 'text') blocks.push(part);
    else if (Array.isArray(last)) last.push(part);
    else blocks.push([part]);
  }
  const mode = modeName(message.agent ?? 'build');
  const meta = message.model ? t('session.chat.meta', { mode, model: modelName(options, message.model) }) : t('session.chat.metaNoModel', { mode });
  const firstText = blocks.findIndex((b) => !Array.isArray(b));
  return (
    <>
      {blocks.map((block, i) =>
        Array.isArray(block) ? (
          <ul key={block[0]!.id} aria-label={t('session.chat.activity')} className="m-0 flex list-none flex-col gap-1 p-0 text-small text-ink-muted">
            {block.map((tool) => (
              <ToolRow key={tool.id} tool={tool} />
            ))}
          </ul>
        ) : (
          <div key={block.id} className="flex max-w-[92%] min-w-0 flex-col gap-1">
            {i === firstText && <span className="text-small text-ink-faint">{meta}</span>}
            <Markdown>{block.text}</Markdown>
          </div>
        ),
      )}
      {message.error && (
        <p className="m-0 text-small text-danger">
          {firstText === -1 && <span className="text-ink-faint">{meta} · </span>}
          {message.error}
        </p>
      )}
    </>
  );
}

export function ToolRow({ tool }: { tool: ChatPart & { type: 'tool' } }) {
  const { t } = useTranslation('tasks');
  const question = tool.tool === 'question';
  const verb = question
    ? t(`session.chat.question.${tool.status === 'completed' || tool.status === 'error' ? QUESTION_VERBS[tool.status] : 'asking'}`)
    : known(KNOWN_TOOLS, tool.tool)
      ? t(`session.chat.tool.${tool.tool}`)
      : t('session.chat.tool.other', { tool: tool.tool });
  // De una pregunta basta qué se contestó: ni «falló» al dejarla sin contestar ni lo que tardó en contestarse.
  const state = question
    ? ''
    : tool.status === 'error'
      ? t('session.chat.failed')
      : tool.status !== 'completed'
        ? t('session.chat.running')
        : tool.seconds
          ? t('session.chat.seconds', { count: tool.seconds })
          : '';
  return (
    <li className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="shrink-0 text-ink-faint">{verb}</span>
        <span className="min-w-0 font-mono break-all">{tool.detail}</span>
        {state && <span className={tool.status === 'error' ? 'text-danger' : tool.status !== 'completed' ? 'text-accent' : 'text-ink-faint'}>{state}</span>}
      </div>
      {tool.output && (
        <details>
          <summary className="w-fit cursor-pointer text-info">{t('session.chat.showOutput')}</summary>
          <pre className="m-0 mt-1 max-h-64 overflow-auto rounded-md border border-line bg-bg p-2.5 font-mono text-small whitespace-pre-wrap text-ink-muted">{tool.output}</pre>
        </details>
      )}
    </li>
  );
}

export function PermissionCard({ permission, disabled, onReply }: { permission: ChatPermission; disabled: boolean; onReply: (answer: ChatPermissionReply) => void }) {
  const { t } = useTranslation('tasks');
  const titleId = `permiso-${permission.id}`;
  const title = known(KNOWN_PERMISSIONS, permission.permission)
    ? t(`session.chat.permission.${permission.permission}`)
    : t('session.chat.permission.other', { permission: permission.permission });
  return (
    <div role="group" aria-labelledby={titleId} className="flex flex-col gap-2.5 rounded-lg border border-accent bg-bg p-3">
      <div className="flex items-center gap-2">
        <Lock size={16} strokeWidth={1.5} className="shrink-0 text-accent" aria-hidden />
        <h3 id={titleId} className="m-0 font-semibold">
          {title}
        </h3>
      </div>
      {permission.detail && (
        <code className="block overflow-x-auto rounded-md border border-line bg-surface px-2.5 py-2 font-mono text-code whitespace-pre">{permission.detail}</code>
      )}
      {permission.diff && (
        <details>
          <summary className="w-fit cursor-pointer text-small text-info">{t('session.chat.permission.showDiff')}</summary>
          <pre className="m-0 mt-1 max-h-72 overflow-auto rounded-md border border-line bg-surface p-2.5 font-mono text-small text-ink-muted">{permission.diff}</pre>
        </details>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={`${primaryButtonClass} h-11`} disabled={disabled} onClick={() => onReply('once')}>
          {t('session.chat.permission.allow')}
        </button>
        <button type="button" className={`${secondaryButtonClass} h-11`} disabled={disabled} onClick={() => onReply('always')}>
          {t('session.chat.permission.allowAlways')}
        </button>
        <button type="button" className={`${secondaryButtonClass} h-11`} disabled={disabled} onClick={() => onReply('reject')}>
          {t('session.chat.permission.deny')}
        </button>
      </div>
      {permission.always.length > 0 && (
        <p className="m-0 text-small text-ink-muted">{t('session.chat.permission.alwaysHint', { patterns: permission.always.join(', ') })}</p>
      )}
    </div>
  );
}
