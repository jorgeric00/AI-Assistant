import { useQuery } from '@tanstack/react-query';
import { FileText, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, queryKeys } from '../../api';
import { Markdown } from '../../components/Markdown';
import { Modal } from '../../components/Modal';
import { secondaryButtonClass } from '../../components/fields';
import { timeAgo } from '../../dates';

/** Botón "Ver documentos": abre un visor con los .md y .txt de la carpeta de la tarea (solo lectura). */
export function VerDocumentosButton({ taskKey }: { taskKey: string }) {
  const { t } = useTranslation('tasks');
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} className={secondaryButtonClass}>
        <FileText size={16} strokeWidth={1.5} aria-hidden />
        {t('files.button')}
      </button>
      {open && <DocumentosModal taskKey={taskKey} onClose={() => setOpen(false)} />}
    </>
  );
}

function DocumentosModal({ taskKey, onClose }: { taskKey: string; onClose: () => void }) {
  const { t } = useTranslation(['tasks', 'common']);
  const files = useQuery({ queryKey: queryKeys.taskFiles(taskKey), queryFn: () => api.listTaskFiles(taskKey) });
  const [picked, setPicked] = useState<string | null>(null);
  const name = picked ?? files.data?.[0]?.name ?? null;
  const doc = useQuery({ queryKey: queryKeys.taskFile(taskKey, name ?? ''), queryFn: () => api.getTaskFile(taskKey, name!), enabled: !!name, retry: false });

  return (
    <Modal labelledBy="docs-titulo" onClose={onClose} width="max-w-[1000px]">
      <div className="flex items-center justify-between gap-4">
        <h2 id="docs-titulo" className="m-0 text-heading font-semibold">
          {t('files.title', { key: taskKey })}
        </h2>
        <button type="button" aria-label={t('files.close')} onClick={onClose} className="flex size-8 items-center justify-center rounded-md text-ink-muted hover:text-ink">
          <X size={16} aria-hidden />
        </button>
      </div>
      {files.isPending ? (
        <p className="m-0 text-ink-muted">{t('common:status.loading')}</p>
      ) : !files.data?.length ? (
        <p className="m-0 text-ink-muted">{t('files.empty')}</p>
      ) : (
        <div className="flex min-h-[320px] flex-wrap gap-4">
          <nav aria-label={t('files.list')} className="flex min-w-0 flex-[1_1_180px] flex-col gap-1 self-start">
            {files.data.map((f) => (
              <button
                key={f.name}
                type="button"
                aria-current={f.name === name}
                onClick={() => setPicked(f.name)}
                className={`flex flex-col items-start rounded-md px-2.5 py-1.5 text-left ${f.name === name ? 'bg-surface-raised text-ink' : 'text-ink-muted hover:text-ink'}`}
              >
                <span className="max-w-full truncate font-mono text-code">{f.name}</span>
                <span className="text-small text-ink-faint">{timeAgo(f.updatedAt)}</span>
              </button>
            ))}
          </nav>
          <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-2">
            {doc.isError ? (
              <p className="m-0 text-danger">{t('files.loadError')}</p>
            ) : !doc.data ? (
              <p className="m-0 text-ink-muted">{t('common:status.loading')}</p>
            ) : (
              <>
                {doc.data.truncated && <p className="m-0 text-small text-ink-muted">{t('files.truncated')}</p>}
                <div className="max-h-[60vh] overflow-y-auto rounded-md border border-line p-4">
                  {doc.data.name.toLowerCase().endsWith('.md') ? (
                    <Markdown>{doc.data.text}</Markdown>
                  ) : (
                    <pre className="m-0 font-mono text-code break-words whitespace-pre-wrap">{doc.data.text}</pre>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
