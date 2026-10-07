import { CircleCheck, CircleX, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SECTIONS, type SectionId } from '../sections';

interface Props {
  current: SectionId;
  serverOk: boolean | undefined;
  onQuickCapture: () => void;
}

export function Sidebar({ current, serverOk, onQuickCapture }: Props) {
  const { t } = useTranslation('common');
  return (
    <nav
      aria-label={t('sidebar.ariaLabel')}
      className="flex max-w-full flex-[1_1_232px] flex-col gap-4 border-r border-line bg-surface px-3 py-4 md:max-w-[232px]"
    >
      <div className="px-2 py-1 text-heading font-semibold">AI-Assistant</div>

      <button
        type="button"
        onClick={onQuickCapture}
        className="flex h-10 items-center gap-2 rounded-md border border-line-strong bg-surface-raised px-3 text-ink hover:border-ink-muted"
      >
        <Plus size={16} strokeWidth={1.5} aria-hidden />
        <span className="grow text-left">{t('sidebar.quickCapture')}</span>
        <kbd className="font-mono text-small text-ink-faint">Alt+N</kbd>
      </button>

      <ul className="flex flex-col gap-0.5">
        {SECTIONS.map(({ id, icon: Icon }) => {
          const active = id === current;
          return (
            <li key={id}>
              <a
                href={`#/${id}`}
                aria-current={active ? 'page' : undefined}
                className={`flex h-10 items-center gap-2.5 rounded-md px-3 no-underline transition-colors duration-[120ms] ${
                  active ? 'bg-surface-raised font-medium text-ink' : 'text-ink-muted hover:bg-surface-raised hover:text-ink'
                }`}
              >
                <Icon size={20} strokeWidth={1.5} aria-hidden className={active ? 'text-accent' : undefined} />
                {t(`sections.${id}`)}
              </a>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto flex items-center gap-1.5 p-2 text-small text-ink-muted">
        {serverOk === false ? (
          <CircleX size={12} className="text-danger" aria-hidden />
        ) : (
          <CircleCheck size={12} className="text-success" aria-hidden />
        )}
        {serverOk === false ? t('sidebar.serverOffline') : serverOk ? t('sidebar.serverOnline') : t('sidebar.connecting')}
      </div>
    </nav>
  );
}
