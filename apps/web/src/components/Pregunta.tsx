import { useMutation } from '@tanstack/react-query';
import { ASK_SOURCES, type AskSourceType } from '@dev-assistant/shared';
import { Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { api } from '../api';
import { shortDay } from '../dates';
import { Markdown } from './Markdown';
import { Modal } from './Modal';
import { primaryButtonClass } from './fields';

const subheading = 'm-0 text-small font-medium tracking-[.04em] text-ink-muted uppercase';

/** "Pregunta" (Alt+P): la IA responde con lo que hay en la app y cita de dónde lo saca. */
export function Pregunta({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('common');
  const [question, setQuestion] = useState('');
  const [sources, setSources] = useState<AskSourceType[]>([...ASK_SOURCES]);
  const ask = useMutation({ mutationFn: () => api.ask(question.trim(), sources) });

  const toggle = (s: AskSourceType) => setSources((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : ASK_SOURCES.filter((x) => x === s || prev.includes(x))));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (question.trim().length >= 3 && sources.length && !ask.isPending) ask.mutate();
  };
  const answer = ask.data;

  return (
    <Modal labelledBy="pregunta-titulo" onClose={onClose} width="max-w-[720px]">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 id="pregunta-titulo" className="m-0 text-title font-semibold">
            {t('ask.title')}
          </h1>
          <span className="text-small text-ink-faint">
            <Trans t={t} i18nKey="ask.anywhere" components={{ kbd: <kbd className="font-mono" /> }} />
          </span>
        </div>

        <form role="search" onSubmit={submit} className="flex gap-2">
          <label htmlFor="pregunta-texto" className="sr-only">
            {t('ask.label')}
          </label>
          <div className="relative min-w-0 flex-1">
            <Sparkles size={16} strokeWidth={1.5} className="absolute top-3 left-3 text-accent" aria-hidden />
            <input
              id="pregunta-texto"
              type="search"
              autoFocus
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={t('ask.placeholder')}
              maxLength={500}
              className="h-10 w-full rounded-md border border-line-strong bg-surface-raised pr-3 pl-9 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
          </div>
          <button type="submit" disabled={question.trim().length < 3 || !sources.length || ask.isPending} className={primaryButtonClass}>
            {t('ask.submit')}
          </button>
        </form>

        <div role="group" aria-label={t('ask.where')} className="flex flex-wrap gap-1.5">
          {ASK_SOURCES.map((s) => {
            const active = sources.includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={active}
                onClick={() => toggle(s)}
                className={`h-7 rounded-sm border px-2.5 text-small ${active ? 'border-accent bg-surface-raised text-ink' : 'border-line-strong text-ink-muted hover:text-ink'}`}
              >
                {t(`ask.sources.${s}`)}
              </button>
            );
          })}
        </div>

        {ask.isPending ? (
          <p role="status" className="m-0 flex items-center gap-2 rounded-lg border border-line bg-bg p-4 text-ink-muted">
            <Sparkles size={16} strokeWidth={1.5} className="text-accent" aria-hidden />
            {t('ask.thinking')}
          </p>
        ) : ask.isError ? (
          <p role="alert" className="m-0 rounded-lg border border-line bg-bg p-4 text-danger">
            {ask.error.message}
          </p>
        ) : (
          answer && (
            <>
              <article aria-labelledby="pregunta-respuesta" className="flex flex-col gap-2.5 rounded-lg border border-line bg-bg p-4" onClick={(e) => (e.target as HTMLElement).closest('a[href^="#/"]') && onClose()}>
                <h2 id="pregunta-respuesta" className={subheading}>
                  {t('ask.answer')}
                </h2>
                <Markdown>{answer.answer}</Markdown>
              </article>
              {answer.sources.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h2 className={subheading}>{t('ask.sourcesTitle')}</h2>
                  <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                    {answer.sources.map((s) => (
                      <li key={s.ref}>
                        <a
                          href={s.href}
                          onClick={onClose}
                          className={`flex min-h-10 items-center gap-2.5 rounded-md px-2 py-1 no-underline hover:bg-surface-raised ${s.cited ? 'text-ink' : 'text-ink-muted'}`}
                        >
                          <span className="w-6 shrink-0 font-mono text-small text-accent">{s.cited ? `[${s.ref}]` : ''}</span>
                          <span className="w-[104px] shrink-0 text-small text-ink-muted">{t(`ask.type.${s.type}`)}</span>
                          <span className="min-w-0 flex-1 truncate">{s.title}</span>
                          <span className="shrink-0 text-small text-ink-faint">{s.cited ? (s.date ? shortDay(s.date) : '') : t('ask.notCited')}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-small text-ink-faint">
          <span>{t('ask.hint')}</span>
          <span>
            <Trans t={t} i18nKey="ask.close" components={{ kbd: <kbd className="font-mono" /> }} />
          </span>
        </div>
      </div>
    </Modal>
  );
}
