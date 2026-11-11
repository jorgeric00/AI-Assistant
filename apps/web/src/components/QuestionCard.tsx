import type { ChatQuestion, ChatQuestionItem, ChatQuestionReplyInput } from '@dev-assistant/shared';
import { CircleHelp } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { secondaryButtonClass } from './fields';

/** Lo elegido en una pregunta: opciones marcadas y, si se usa, la respuesta escrita. */
interface Choice {
  picked: string[];
  other: boolean;
  text: string;
}

const initial = (item: ChatQuestionItem): Choice => {
  // En las de una sola respuesta va marcada la que recomienda opencode.
  const recommended = item.multiple ? undefined : item.options.find((o) => o.recommended);
  return { picked: recommended ? [recommended.value] : [], other: !item.options.length, text: '' };
};

const valueOf = (item: ChatQuestionItem, c: Choice): string | string[] | null => {
  const text = c.other ? c.text.trim() : '';
  if (item.multiple) {
    const values = [...c.picked, ...(text ? [text] : [])];
    return values.length ? values : null;
  }
  return c.other ? text || null : (c.picked[0] ?? null);
};

const optionClass = (on: boolean) =>
  `flex cursor-pointer gap-2.5 rounded-md border px-2.5 py-2 ${on ? 'border-info bg-info/10' : 'border-line bg-surface'}`;

/** Preguntas que hace opencode (solo la 2.x): se eligen opciones o se escribe otra respuesta. */
export function QuestionCard({ question, disabled, onAnswer }: { question: ChatQuestion; disabled: boolean; onAnswer: (input: ChatQuestionReplyInput) => void }) {
  const { t } = useTranslation('tasks');
  const [choices, setChoices] = useState<Choice[]>(() => question.items.map(initial));
  const set = (i: number, change: Partial<Choice>) => setChoices((all) => all.map((c, j) => (j === i ? { ...c, ...change } : c)));
  const values = question.items.map((item, i) => valueOf(item, choices[i]!));
  const ready = values.every((v) => v !== null);
  const titleId = `pregunta-${question.id}`;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || disabled) return;
    onAnswer({ answers: Object.fromEntries(question.items.map((item, i) => [item.key, values[i]!])) });
  };

  return (
    <form role="group" aria-labelledby={titleId} onSubmit={submit} className="flex flex-col gap-3.5 rounded-lg border border-info bg-bg p-3">
      <div className="flex items-center gap-2">
        <CircleHelp size={16} strokeWidth={1.5} className="shrink-0 text-info" aria-hidden />
        <h3 id={titleId} className="m-0 font-semibold">
          {t('session.chat.question.title')}
        </h3>
      </div>

      {question.items.map((item, i) => {
        const c = choices[i]!;
        const name = `${titleId}-${item.key}`;
        const type = item.multiple ? 'checkbox' : 'radio';
        return (
          <fieldset key={item.key} className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
            <legend className="mb-1.5 flex flex-col gap-0.5 p-0">
              {item.header && (
                <span className="text-small text-ink-muted">{item.multiple ? t('session.chat.question.multiple', { header: item.header }) : item.header}</span>
              )}
              <span className="font-medium">{item.question}</span>
            </legend>
            {item.options.map((o) => {
              const on = c.picked.includes(o.value);
              return (
                <label key={o.value} className={optionClass(on)}>
                  <input
                    type={type}
                    name={name}
                    checked={on}
                    disabled={disabled}
                    className="mt-0.5 size-4 shrink-0 accent-info"
                    onChange={() =>
                      item.multiple ? set(i, { picked: on ? c.picked.filter((v) => v !== o.value) : [...c.picked, o.value] }) : set(i, { picked: [o.value], other: false })
                    }
                  />
                  <span className="flex min-w-0 flex-col">
                    <span>
                      {o.label}
                      {o.recommended && <span className="text-small text-success"> · {t('session.chat.question.recommended')}</span>}
                    </span>
                    {o.description && <span className="text-small text-ink-muted">{o.description}</span>}
                  </span>
                </label>
              );
            })}
            {item.custom && (
              <label className={`${optionClass(c.other)} items-center`}>
                {item.options.length > 0 && (
                  <input
                    type={type}
                    name={name}
                    checked={c.other}
                    disabled={disabled}
                    className="size-4 shrink-0 accent-info"
                    onChange={() => set(i, item.multiple ? { other: !c.other } : { other: true, picked: [] })}
                  />
                )}
                <input
                  type="text"
                  aria-label={t('session.chat.question.other')}
                  placeholder={t('session.chat.question.other')}
                  value={c.text}
                  disabled={disabled}
                  maxLength={2000}
                  onFocus={() => !c.other && set(i, item.multiple ? { other: true } : { other: true, picked: [] })}
                  onChange={(e) => set(i, { text: e.target.value, other: true, ...(item.multiple ? {} : { picked: [] }) })}
                  className="h-8 min-w-0 flex-1 rounded border border-line-strong bg-surface-raised px-2 text-ink placeholder:text-ink-faint focus:border-info focus:outline-none"
                />
              </label>
            )}
          </fieldset>
        );
      })}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={disabled || !ready}
          className="flex h-11 items-center rounded-md bg-info px-4 font-semibold text-bg hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t('session.chat.question.send')}
        </button>
        <button type="button" className={`${secondaryButtonClass} h-11`} disabled={disabled} onClick={() => onAnswer({ skip: true })}>
          {t('session.chat.question.skip')}
        </button>
        {!ready && <span className="text-small text-ink-muted">{t('session.chat.question.missing', { count: question.items.length })}</span>}
      </div>
    </form>
  );
}
