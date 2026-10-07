import { useTranslation } from 'react-i18next';

export function PendingPage({ title }: { title: string }) {
  const { t } = useTranslation('common');
  return (
    <div className="flex flex-col gap-6">
      <h1 className="m-0 text-display font-semibold">{title}</h1>
      <p className="m-0 text-ink-muted">{t('pendingPage.notBuilt')}</p>
    </div>
  );
}
