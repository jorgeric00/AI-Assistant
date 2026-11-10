import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiSettingsUpdate, Language, McpServer, McpState } from '@dev-assistant/shared';
import { CircleCheck, DatabaseBackup, Download, RefreshCw } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { api, queryKeys } from '../api';
import { Card } from '../components/Card';
import { ModeToggle, ModelSelect } from '../components/ModelPicker';
import { inputClass, primaryButtonClass, secondaryButtonClass } from '../components/fields';
import { dayAndTime } from '../dates';
import { useLanguage } from '../i18n/useLanguage';

/** Sección "Ajustes": idioma, inteligencia artificial, skill de opencode, arranque automático y copias de seguridad. */
export function AjustesPage() {
  const { t } = useTranslation(['settings', 'common']);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="m-0 text-display font-semibold">{t('page.title')}</h1>
      <div className="flex max-w-[640px] flex-col gap-4">
        <LanguageCard />
        <AiCard />
        <McpCard />
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

/** Qué modelo usa la IA de la app y con qué modelo y modo empiezan las sesiones de desarrollo. */
function AiCard() {
  const { t } = useTranslation(['settings', 'common']);
  const queryClient = useQueryClient();
  const options = useQuery({ queryKey: queryKeys.aiOptions, queryFn: () => api.aiOptions() });
  const settings = useQuery({ queryKey: queryKeys.aiSettings, queryFn: api.aiSettings });
  const reload = useMutation({ mutationFn: () => api.aiOptions(true), onSuccess: (data) => queryClient.setQueryData(queryKeys.aiOptions, data) });
  const update = useMutation({
    mutationFn: (change: AiSettingsUpdate) => api.updateAiSettings(change),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.aiSettings, data),
  });
  const o = options.data;
  const s = settings.data;
  const count = o?.providers.reduce((n, p) => n + p.models.length, 0) ?? 0;
  const field = 'flex flex-col gap-1.5';
  return (
    <Card
      title={t('ai.title')}
      action={
        <button type="button" onClick={() => reload.mutate()} disabled={reload.isPending} className={secondaryButtonClass}>
          <RefreshCw size={16} strokeWidth={2} aria-hidden />
          {reload.isPending ? t('ai.reloading') : t('ai.reload')}
        </button>
      }
    >
      {options.isError || settings.isError ? (
        <p className="m-0 text-danger">{(options.error ?? settings.error)?.message}</p>
      ) : !o || !s ? (
        <p className="m-0 text-ink-muted">{t('common:status.loading')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {o.available ? (
            <span className="flex items-center gap-2 text-small text-ink-muted">
              <CircleCheck size={14} className="text-success" aria-hidden />
              {t('ai.connected', { count })}
            </span>
          ) : (
            <p role="alert" className="m-0 text-danger">
              {t('ai.unavailable', { error: o.error ?? '' })}
            </p>
          )}
          <div className={field}>
            <label htmlFor="ajustes-ia-app" className="font-medium">
              {t('ai.appModel')}
            </label>
            <ModelSelect id="ajustes-ia-app" value={s.appModel} onChange={(appModel) => update.mutate({ appModel })} options={o} disabled={update.isPending} className="w-full" />
            <span className="text-small text-ink-muted">{t('ai.appModelHint')}</span>
          </div>
          <div className={field}>
            <label htmlFor="ajustes-ia-sesion" className="font-medium">
              {t('ai.sessionModel')}
            </label>
            <ModelSelect id="ajustes-ia-sesion" value={s.sessionModel} onChange={(sessionModel) => update.mutate({ sessionModel })} options={o} disabled={update.isPending} className="w-full" />
          </div>
          <div className={field}>
            <span id="ajustes-ia-modo" className="font-medium">
              {t('ai.sessionAgent')}
            </span>
            <div className="self-start">
              <ModeToggle labelledBy="ajustes-ia-modo" value={s.sessionAgent} onChange={(sessionAgent) => update.mutate({ sessionAgent })} options={o} disabled={update.isPending} />
            </div>
            <span className="text-small text-ink-muted">{t('ai.sessionHint')}</span>
          </div>
          {update.isError && <p className="m-0 text-danger">{update.error.message}</p>}
          <p className="m-0 border-t border-line pt-3 text-small text-ink-faint">{t('ai.footer')}</p>
        </div>
      )}
    </Card>
  );
}

const MCP_DOT: Record<McpState, string> = { connected: 'bg-success', failed: 'bg-danger', needs_auth: 'bg-accent', disabled: 'bg-ink-faint', unknown: 'bg-ink-faint' };
const MCP_TEXT: Record<McpState, string> = { connected: 'text-success', failed: 'text-danger', needs_auth: 'text-accent', disabled: 'text-ink-muted', unknown: 'text-ink-muted' };
const code = <code className="font-mono text-code break-all" />;

/** Qué MCP ve el opencode de la app y si arrancan: para saber por qué no tiene una herramienta que sí tiene en la terminal. */
function McpCard() {
  const { t } = useTranslation(['settings', 'common']);
  const status = useQuery({ queryKey: queryKeys.aiMcp, queryFn: api.aiMcp });
  const m = status.data;
  const version = m?.version ?? '?';
  return (
    <Card
      title={t('mcp.title')}
      action={
        <button type="button" onClick={() => void status.refetch()} disabled={status.isFetching} className={secondaryButtonClass}>
          <RefreshCw size={16} strokeWidth={2} aria-hidden />
          {status.isFetching ? t('mcp.checking') : t('mcp.check')}
        </button>
      }
    >
      {status.isError ? (
        <p className="m-0 text-danger">{status.error.message}</p>
      ) : !m ? (
        <p className="m-0 text-ink-muted">{t('common:status.loading')}</p>
      ) : !m.available ? (
        <p role="alert" className="m-0 text-danger">
          {t('mcp.unavailable', { error: m.error ?? '' })}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <span className="text-small text-ink-muted">
            {m.url ? (
              <Trans t={t} i18nKey="mcp.external" values={{ url: m.url, version }} components={{ code }} />
            ) : m.binary ? (
              <Trans t={t} i18nKey="mcp.binary" values={{ binary: m.binary, version }} components={{ code }} />
            ) : (
              <Trans t={t} i18nKey="mcp.binaryUnknown" values={{ version }} components={{ code }} />
            )}
          </span>
          {m.servers.length ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {m.servers.map((s) => (
                <McpRow key={s.name} server={s} />
              ))}
            </ul>
          ) : (
            <p className="m-0 text-ink-muted">{t('mcp.none')}</p>
          )}
          <p className="m-0 border-t border-line pt-3 text-small text-ink-faint">
            {m.configDir ? <Trans t={t} i18nKey="mcp.footer" values={{ dir: m.configDir }} components={{ code }} /> : t('mcp.footerNoDir')}
          </p>
        </div>
      )}
    </Card>
  );
}

function McpRow({ server: s }: { server: McpServer }) {
  const { t } = useTranslation('settings');
  return (
    <li className="flex gap-3 border-t border-line py-2.5">
      <span aria-hidden className={`mt-[7px] size-2 shrink-0 rounded-full ${MCP_DOT[s.state]}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-code font-medium break-all">{s.name}</span>
          <span className={`text-small ${MCP_TEXT[s.state]}`}>{t(`mcp.state.${s.state}`)}</span>
        </div>
        {s.error && <span className="font-mono text-small break-words whitespace-pre-wrap text-ink-muted">{s.error}</span>}
        {s.state === 'failed' && <span className="text-small text-ink-muted">{t('mcp.failedHint')}</span>}
        {s.state === 'needs_auth' && (
          <span className="text-small text-ink-muted">
            <Trans t={t} i18nKey="mcp.authHint" values={{ name: s.name }} components={{ code }} />
          </span>
        )}
      </div>
    </li>
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
