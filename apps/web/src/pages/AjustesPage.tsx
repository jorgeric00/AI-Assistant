import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Language } from '@dev-assistant/shared';
import { CircleCheck, DatabaseBackup, Download } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { api, queryKeys } from '../api';
import { Card } from '../components/Card';
import { inputClass, primaryButtonClass, secondaryButtonClass } from '../components/fields';
import { dayAndTime } from '../dates';
import { useLanguage } from '../i18n/useLanguage';

/** Sección "Ajustes": idioma, skill de opencode, arranque automático y copias de seguridad. */
export function AjustesPage() {
  const { t } = useTranslation(['settings', 'common']);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="m-0 text-display font-semibold">{t('page.title')}</h1>
      <div className="flex max-w-[640px] flex-col gap-4">
        <LanguageCard />
        <OpencodeSkillCard />
        <AutostartCard />
        <BackupsCard />
      </div>
    </div>
  );
}

const LANGUAGE_OPTIONS: Language[] = ['es', 'en'];

function LanguageCard() {
  const { t } = useTranslation(['settings', 'common']);
  const { language, setLanguage, isChanging } = useLanguage();
  return (
    <Card title={t('language.title')}>
      <label htmlFor="ajustes-idioma" className="m-0 text-ink-muted">
        {t('language.description')}
      </label>
      <select
        id="ajustes-idioma"
        value={language}
        disabled={isChanging}
        onChange={(e) => setLanguage(e.target.value as Language)}
        className={`${inputClass} max-w-[240px]`}
      >
        {LANGUAGE_OPTIONS.map((lang) => (
          <option key={lang} value={lang}>
            {t(`common:language.${lang}`)}
          </option>
        ))}
      </select>
    </Card>
  );
}

function OpencodeSkillCard() {
  const { t } = useTranslation(['settings', 'common']);
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: queryKeys.opencodeSkill, queryFn: api.opencodeSkill });
  const install = useMutation({
    mutationFn: api.installOpencodeSkill,
    onSuccess: (data) => queryClient.setQueryData(queryKeys.opencodeSkill, data),
  });
  const s = status.data;
  return (
    <Card title={t('skill.title')}>
      <p className="m-0 text-ink-muted">
        <Trans t={t} i18nKey="skill.description" components={{ code: <code className="font-mono text-code" /> }} />
      </p>
      {status.isError ? (
        <p className="m-0 text-danger">{status.error.message}</p>
      ) : s ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {s.installed && s.upToDate ? (
            <span className="flex items-center gap-2 text-success">
              <CircleCheck size={16} aria-hidden />
              {t('skill.upToDate')}
            </span>
          ) : (
            <span className="text-ink-muted">{s.installed ? t('skill.newVersion') : t('skill.notInstalled')}</span>
          )}
          {!(s.installed && s.upToDate) && (
            <button type="button" onClick={() => install.mutate()} disabled={install.isPending} className={primaryButtonClass}>
              <Download size={16} strokeWidth={2} aria-hidden />
              {install.isPending ? t('skill.installing') : s.installed ? t('skill.update') : t('skill.install')}
            </button>
          )}
        </div>
      ) : (
        <p className="m-0 text-ink-muted">{t('common:status.loading')}</p>
      )}
      {install.isError && <p className="m-0 text-danger">{install.error.message}</p>}
      {s && <p className="m-0 text-small text-ink-faint break-all">{t('skill.installedAt', { path: s.path })}</p>}
    </Card>
  );
}

const checkbox = 'mt-0.5 size-[18px] shrink-0 accent-accent';

function AutostartCard() {
  const { t } = useTranslation(['settings', 'common']);
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: queryKeys.autostart, queryFn: api.getAutostart });
  const update = useMutation({
    mutationFn: api.updateAutostart,
    onSuccess: (data) => queryClient.setQueryData(queryKeys.autostart, data),
  });
  const s = status.data;
  return (
    <Card title={t('autostart.title')}>
      <p className="m-0 text-ink-muted">
        <Trans t={t} i18nKey="autostart.description" components={{ code: <code className="font-mono text-code" /> }} />
      </p>
      {status.isError ? (
        <p className="m-0 text-danger">{status.error.message}</p>
      ) : !s ? (
        <p className="m-0 text-ink-muted">{t('common:status.loading')}</p>
      ) : (
        <>
          {!s.supported && <p className="m-0 text-ink-muted">{t('autostart.windowsOnly')}</p>}
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={s.enabled}
              disabled={!s.supported || update.isPending}
              onChange={(e) => update.mutate({ enabled: e.target.checked })}
              className={checkbox}
            />
            <span className="flex flex-col">
              <span>{t('autostart.enabled')}</span>
              <span className="text-small text-ink-muted">{t('autostart.enabledHint')}</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={s.openBrowser}
              disabled={update.isPending}
              onChange={(e) => update.mutate({ openBrowser: e.target.checked })}
              className={checkbox}
            />
            <span className="flex flex-col">
              <span>{t('autostart.openBrowser')}</span>
              <span className="text-small text-ink-muted">{t('autostart.openBrowserHint')}</span>
            </span>
          </label>
          {update.isError && <p className="m-0 text-danger">{update.error.message}</p>}
          {s.supported && <p className="m-0 text-small text-ink-faint break-all">{t('autostart.logFile', { file: s.logFile })}</p>}
        </>
      )}
    </Card>
  );
}

const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

function BackupsCard() {
  const { t } = useTranslation(['settings', 'common']);
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: queryKeys.backups, queryFn: api.getBackups });
  const run = useMutation({
    mutationFn: api.runBackup,
    onSuccess: (data) => queryClient.setQueryData(queryKeys.backups, data),
  });
  const s = status.data;
  return (
    <Card title={t('backups.title')}>
      <p className="m-0 text-ink-muted">{t('backups.description')}</p>
      {status.isError ? (
        <p className="m-0 text-danger">{status.error.message}</p>
      ) : !s ? (
        <p className="m-0 text-ink-muted">{t('common:status.loading')}</p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-ink-muted">
            {s.last ? (
              <>
                {t('backups.lastLabel')} <span className="text-ink">{dayAndTime(s.last.at)}</span> · {size(s.last.bytes)} · {t('backups.copies', { count: s.count })}
              </>
            ) : (
              t('backups.none')
            )}
          </span>
          <button type="button" onClick={() => run.mutate()} disabled={!s.supported || run.isPending} className={secondaryButtonClass}>
            <DatabaseBackup size={16} strokeWidth={2} aria-hidden />
            {run.isPending ? t('backups.copying') : t('backups.runNow')}
          </button>
        </div>
      )}
      {run.isError && <p className="m-0 text-danger">{run.error.message}</p>}
      {s && <p className="m-0 text-small text-ink-faint break-all">{t('backups.savedIn', { dir: s.dir })}</p>}
    </Card>
  );
}
