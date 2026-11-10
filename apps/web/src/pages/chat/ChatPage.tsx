import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GeneralChat } from '@dev-assistant/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, queryKeys } from '../../api';
import { ChatPanel, smallButton } from '../../components/ChatPanel';
import { whenLabel } from '../../dates';
import { navigate } from '../../sections';

/** "Chat" (`#/chat`, `#/chat/:id`; Alt+C): conversaciones con opencode que no van con ninguna tarea. */
export function ChatPage({ params }: { params: string[] }) {
  const { t } = useTranslation('chat');
  const id = params[0] ?? null;
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: queryKeys.conversations, queryFn: () => api.conversations(), refetchInterval: 30_000 });
  const chatKey = queryKeys.conversation(id);
  const chat = useQuery({
    queryKey: chatKey,
    queryFn: () => (id ? api.conversation(id) : api.newConversation()),
    retry: false,
    refetchInterval: (q) => (q.state.data?.busy ? 1500 : q.state.data?.started ? 10_000 : false),
  });
  const options = useQuery({ queryKey: queryKeys.aiOptions, queryFn: () => api.aiOptions(), staleTime: 60_000 });
  const refreshList = () => void queryClient.invalidateQueries({ queryKey: queryKeys.conversations, exact: true });

  const onData = (data: GeneralChat) => {
    queryClient.setQueryData(queryKeys.conversation(data.id), data);
    if (data.id !== id) {
      // Primer mensaje de una conversación nueva: ya tiene id y sale en la lista.
      refreshList();
      if (data.id) navigate(`chat/${data.id}`);
    }
  };
  const remove = useMutation({
    mutationFn: (target: string) => api.deleteConversation(target),
    onSuccess: (_, target) => {
      queryClient.removeQueries({ queryKey: queryKeys.conversation(target) });
      refreshList();
      navigate('chat');
    },
  });

  const conversations = list.data?.conversations ?? [];
  const title = id ? (chat.data?.title ?? conversations.find((c) => c.id === id)?.title ?? '') : t('newTitle');

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="m-0 text-display font-semibold">{t('title')}</h1>
        <p className="m-0 text-ink-muted">{t('intro')}</p>
      </header>

      <div className="flex flex-wrap items-start gap-4">
        <section aria-labelledby="h-conversaciones" className="flex min-w-0 flex-[1_1_240px] flex-col gap-3 rounded-lg border border-line bg-surface p-3 md:max-w-[300px]">
          <h2 id="h-conversaciones" className="m-0 px-1 text-heading font-semibold">
            {t('list.title')}
          </h2>
          <a
            href="#/chat"
            aria-current={id === null ? 'page' : undefined}
            className="flex h-10 items-center gap-2 rounded-md border border-line-strong px-3 text-ink no-underline hover:bg-surface-raised"
          >
            <Plus size={16} strokeWidth={1.5} aria-hidden />
            {t('list.new')}
          </a>
          {list.data?.error && <p className="m-0 px-1 text-small text-danger">{t('list.unavailable', { error: list.data.error })}</p>}
          {list.isSuccess && !conversations.length ? (
            <p className="m-0 px-1 text-small text-ink-muted">{t('list.empty')}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {conversations.map((c) => {
                const active = c.id === id;
                return (
                  <li key={c.id}>
                    <a
                      href={`#/chat/${c.id}`}
                      aria-current={active ? 'page' : undefined}
                      className={`flex flex-col gap-0.5 rounded-md px-3 py-2 no-underline ${active ? 'bg-surface-raised font-medium text-ink' : 'text-ink-muted hover:bg-surface-raised hover:text-ink'}`}
                    >
                      <span className="break-words">{c.title}</span>
                      <span className="text-small font-normal text-ink-faint">{whenLabel(c.updatedAt)}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="flex min-w-0 flex-[999_1_560px] flex-col">
          {id && chat.isError && !chat.data ? (
            <div className="flex flex-col items-start gap-2 rounded-lg border border-line bg-surface p-4">
              <p className="m-0">{chat.error.message || t('notFound')}</p>
              <a href="#/chat">{t('list.new')}</a>
            </div>
          ) : (
            <ChatPanel
              key={id ?? 'nueva'}
              titleId="chat-general"
              title={title}
              actions={
                id && (
                  <button
                    type="button"
                    className={smallButton}
                    disabled={remove.isPending}
                    onClick={() => window.confirm(t('confirmDelete', { title })) && remove.mutate(id)}
                  >
                    <Trash2 size={14} strokeWidth={1.5} aria-hidden />
                    {t('delete')}
                  </button>
                )
              }
              data={chat.data}
              loadError={chat.error}
              extraError={remove.error}
              options={options.data}
              actionsApi={{
                send: (input) => (id ? api.sendConversation(id, input) : api.startConversation(input)),
                abort: () => (id ? api.abortConversation(id) : api.newConversation()),
                reply: (permissionId, answer) => (id ? api.replyConversationPermission(id, permissionId, answer) : api.newConversation()),
              }}
              onData={onData}
              // Al acabar un turno opencode ya suele haber puesto el título.
              onIdle={refreshList}
              empty={() => (
                <div className="flex flex-col items-start gap-1.5">
                  <p className="m-0 font-medium">{t('emptyTitle')}</p>
                  <p className="m-0 text-ink-muted">{t('emptyBody')}</p>
                </div>
              )}
              help={t('help')}
            />
          )}
        </div>
      </div>
    </div>
  );
}
