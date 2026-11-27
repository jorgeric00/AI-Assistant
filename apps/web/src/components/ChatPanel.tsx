import { useMutation } from '@tanstack/react-query';
import { MAX_CHAT_FILES, MAX_CHAT_FILE_BYTES, type AiOptions, type ChatFile, type ChatMessage, type ChatPart, type ChatPermission, type ChatPermissionReply, type ChatQuestionReplyInput, type ChatSendInput, type ChatState } from '@dev-assistant/shared';
import { ChevronDown, ChevronUp, Circle, Lock, Paperclip, Search, Send, Square, X } from 'lucide-react';
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

/** Contenido del archivo en base64 (sin el prefijo `data:...;base64,`). */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error(file.name));
    reader.readAsDataURL(file);
  });
}

/** Rangos del texto visible de `root` que contienen `query` (sin distinguir mayúsculas). */
function findRanges(root: HTMLElement, query: string): Range[] {
  const needle = query.toLocaleLowerCase();
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue?.toLocaleLowerCase() ?? '';
    // El texto de un cuadro cerrado (salida de herramientas) no se ve: no cuenta.
    if (!text.includes(needle) || !node.parentElement?.checkVisibility?.()) continue;
    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      ranges.push(range);
    }
  }
  return ranges;
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

  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const addFiles = (incoming: File[]) => {
    setFileError(null);
    const next = [...files];
    for (const file of incoming) {
      if (next.length >= MAX_CHAT_FILES) return setFileError(t('session.chat.tooMany', { count: MAX_CHAT_FILES })), setFiles(next);
      if (file.size > MAX_CHAT_FILE_BYTES) {
        setFileError(t('session.chat.tooBig', { name: file.name, mb: MAX_CHAT_FILE_BYTES / 1024 / 1024 }));
        continue;
      }
      next.push(file);
    }
    setFiles(next);
  };

  const send = useMutation({
    mutationFn: async ({ message, attached }: { message: string; attached: File[] }) => {
      const encoded: ChatFile[] = await Promise.all(
        attached.map(async (f) => ({ name: f.name, data: await toBase64(f).catch(() => Promise.reject(new Error(t('session.chat.readError', { name: f.name })))) })),
      );
      return actionsApi.send({ text: message, model, agent, ...(encoded.length ? { files: encoded } : {}) });
    },
    onSuccess: onData,
  });
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

  // Buscador de texto de la conversación: resalta con la API de resaltado del navegador, sin tocar lo que se pinta.
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const supportsHighlight = typeof CSS !== 'undefined' && 'highlights' in CSS;
  useEffect(() => {
    if (!supportsHighlight) return;
    const clear = () => {
      CSS.highlights.delete('chat-search');
      CSS.highlights.delete('chat-search-current');
    };
    const root = log.current;
    if (!searching || !query || !root) {
      clear();
      setTotal(0);
      return clear;
    }
    const ranges = findRanges(root, query);
    setTotal(ranges.length);
    const index = ranges.length ? Math.min(current, ranges.length - 1) : -1;
    CSS.highlights.set('chat-search', new Highlight(...ranges));
    if (index >= 0) {
      CSS.highlights.set('chat-search-current', new Highlight(ranges[index]!));
      pinned.current = false;
      ranges[index]!.startContainer.parentElement?.scrollIntoView({ block: 'center' });
    } else CSS.highlights.delete('chat-search-current');
    return clear;
  }, [searching, query, current, tail, supportsHighlight]);
  const step = (delta: number) => total && setCurrent((c) => (c + delta + total) % total);
  const closeSearch = () => {
    setSearching(false);
    setQuery('');
    setCurrent(0);
  };

  const submit = (message: string) => {
    const clean = message.trim();
    if (!clean || send.isPending || !data?.available) return;
    pinned.current = true;
    send.mutate(
      { message: clean, attached: files },
      {
        onSuccess: () => {
          setText('');
          setFiles([]);
          setFileError(null);
        },
      },
    );
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
        <div className="flex flex-wrap items-center gap-2">
          {supportsHighlight && (
            <button
              type="button"
              aria-expanded={searching}
              title={t('session.chat.searchTitle')}
              className={smallButton}
              onClick={() => {
                if (searching) closeSearch();
                else {
                  setSearching(true);
                  setTimeout(() => searchInput.current?.focus());
                }
              }}
            >
              <Search size={14} strokeWidth={1.5} aria-hidden />
              {t('session.chat.search')}
            </button>
          )}
          {actions}
        </div>
      </div>
      {searching && (
        <div role="search" className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
          <input
            ref={searchInput}
            type="search"
            value={query}
            aria-label={t('session.chat.searchLabel')}
            placeholder={t('session.chat.searchLabel')}
            onChange={(e) => {
              setQuery(e.target.value);
              setCurrent(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                step(e.shiftKey ? -1 : 1);
              } else if (e.key === 'Escape') {
                e.stopPropagation();
                closeSearch();
              }
            }}
            className="h-8 min-w-0 flex-[1_1_220px] rounded-md border border-line-strong bg-surface-raised px-2.5 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
          <span role="status" className="min-w-[72px] text-small text-ink-muted">
            {query && (total ? t('session.chat.searchCount', { current: Math.min(current, total - 1) + 1, total }) : t('session.chat.searchNone'))}
          </span>
          <button type="button" aria-label={t('session.chat.searchPrev')} disabled={!total} onClick={() => step(-1)} className={`${smallButton} px-2`}>
            <ChevronUp size={14} aria-hidden />
          </button>
          <button type="button" aria-label={t('session.chat.searchNext')} disabled={!total} onClick={() => step(1)} className={`${smallButton} px-2`}>
            <ChevronDown size={14} aria-hidden />
          </button>
          <button type="button" aria-label={t('session.chat.searchClose')} onClick={closeSearch} className={`${smallButton} px-2`}>
            <X size={14} aria-hidden />
          </button>
        </div>
      )}

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

      <form
        onSubmit={onSubmit}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragging(false);
          addFiles([...e.dataTransfer.files]);
        }}
        className={`flex flex-col gap-2.5 border-t px-4 pt-3 pb-4 ${dragging ? 'border-accent bg-surface-raised' : 'border-line'}`}
      >
        {dragging && <p className="m-0 text-small text-accent">{t('session.chat.dropHere')}</p>}
        {data && !data.available && (
          <p role="alert" className="m-0 text-danger">
            {t('session.chat.unavailable', { error: data.error ?? '' })}
          </p>
        )}
        {(fileError || error) && (
          <p role="alert" className="m-0 text-danger">
            {fileError ?? error?.message}
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
        {files.length > 0 && (
          <ul aria-label={t('session.chat.attach')} className="m-0 flex list-none flex-wrap gap-2 p-0">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex max-w-full items-center gap-1.5 rounded-md border border-line-strong bg-surface-raised py-1 pr-1 pl-2.5 text-small">
                <span className="min-w-0 truncate">{f.name}</span>
                <button
                  type="button"
                  aria-label={t('session.chat.removeFile', { name: f.name })}
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  className="flex size-6 shrink-0 items-center justify-center rounded-sm text-ink-muted hover:text-danger"
                >
                  <X size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            tabIndex={-1}
            onChange={(e) => {
              addFiles([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
          <button type="button" title={t('session.chat.attachTitle')} aria-label={t('session.chat.attachTitle')} className={smallButton} onClick={() => picker.current?.click()}>
            <Paperclip size={14} strokeWidth={1.5} aria-hidden />
            {t('session.chat.attach')}
          </button>
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
