import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Repo, RepoDetail, RepoProfileInput, RepoProfileStatus } from '@dev-assistant/shared';
import { CircleAlert, CircleCheck, Plus, Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, queryKeys } from '../../api';
import { inputClass, primaryButtonClass, secondaryButtonClass } from '../../components/fields';
import { timeAgo } from '../../dates';
import { navigate } from '../../sections';

const caption = 'text-small text-ink-muted';
const hint = 'text-small text-ink-faint';
const subheading = 'm-0 text-small font-medium tracking-[.04em] text-ink-muted uppercase';
const monoInput = `${inputClass} font-mono text-code`;

// La etiqueta se traduce al pintar: `t(`status.${estado}`)`.
const STATUS_CLASS: Record<RepoProfileStatus, string> = {
  completa: 'text-success',
  por_revisar: 'text-accent',
  sin_ficha: 'text-ink-muted',
};

/** Sección "Repositorios" (R17): `#/repositorios`, `#/repositorios/:id` y `#/repositorios/nuevo`. */
export function RepositoriosPage({ params }: { params: string[] }) {
  const { t } = useTranslation(['repos', 'common']);
  const repos = useQuery({ queryKey: queryKeys.repoList, queryFn: api.listRepos });
  const list = repos.data ?? [];
  const creating = params[0] === 'nuevo';
  const selectedId = creating ? undefined : Number(params[0]) || list[0]?.id;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="m-0 text-display font-semibold">{t('page.title')}</h1>
          <p className="mt-1 mb-0 text-ink-muted">{t('page.subtitle')}</p>
        </div>
        <a href="#/repositorios/nuevo" className={`${primaryButtonClass} no-underline`}>
          <Plus size={16} strokeWidth={2} aria-hidden />
          {t('page.add')}
        </a>
      </header>

      {repos.isError ? (
        <p className="m-0 text-danger">{t('page.loadError')}</p>
      ) : repos.isPending ? (
        <p className="m-0 text-ink-muted">Cargando…</p>
      ) : !list.length && !creating ? (
        <p className="m-0 text-ink-muted">
          {t('page.empty')}
        </p>
      ) : (
        <div className="flex flex-wrap items-start gap-4">
          <RepoList repos={list} current={selectedId} />
          {creating ? <NewRepoForm /> : selectedId !== undefined && <RepoPanel key={selectedId} id={selectedId} />}
        </div>
      )}
    </div>
  );
}

function RepoList({ repos, current }: { repos: Repo[]; current?: number }) {
  const { t } = useTranslation(['repos', 'common']);
  return (
    <ul aria-label={t('list.label')} className="m-0 flex min-w-0 flex-[1_1_300px] list-none flex-col gap-2 p-0">
      {repos.map((r) => {
        const active = r.id === current;
        return (
          <li key={r.id}>
            <a
              href={`#/repositorios/${r.id}`}
              aria-current={active ? 'true' : undefined}
              className={`flex flex-col gap-1.5 rounded-lg border px-4 py-3.5 text-ink no-underline ${active ? 'border-line-strong bg-surface-raised' : 'border-line bg-surface hover:bg-surface-raised'}`}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate font-mono">{r.name}</span>
                <span className={`text-small whitespace-nowrap ${STATUS_CLASS[r.profileStatus]}`}>{t(`status.${r.profileStatus}`)}</span>
              </span>
              <span className={caption}>
                {r.github || t('list.noGithub')} · {t('list.branch', { branch: r.defaultBranch })}
              </span>
              {r.jiraProjectKeys.length ? (
                <span className="flex flex-wrap gap-1.5">
                  {r.jiraProjectKeys.map((k) => (
                    <span key={k} className="rounded-sm border border-line-strong px-1.5 font-mono text-small text-ink-muted">
                      {k}
                    </span>
                  ))}
                </span>
              ) : (
                <span className={hint}>{t('list.noJira')}</span>
              )}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

const panel = 'flex min-w-0 flex-[999_1_560px] flex-col gap-5 rounded-lg border border-line bg-surface p-5';

interface DataFields {
  name: string;
  localPath: string;
  github: string;
  defaultBranch: string;
  jiraKeys: string;
}

const parseKeys = (text: string) => [...new Set(text.split(/[\s,;]+/).map((k) => k.trim().toUpperCase()).filter(Boolean))];

function DataFieldset({ data, onChange, pathStatus, onPathBlur }: { data: DataFields; onChange: (d: DataFields) => void; pathStatus: 'ok' | 'bad' | 'checking' | null; onPathBlur?: () => void }) {
  const { t } = useTranslation(['repos', 'common']);
  const set = (k: keyof DataFields) => (e: { target: { value: string } }) => onChange({ ...data, [k]: e.target.value });
  return (
    <fieldset className="m-0 grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4 border-0 p-0">
      <legend className={`${subheading} pb-3`}>{t('data.legend')}</legend>
      <div className="col-span-full flex flex-col gap-1.5">
        <label htmlFor="repo-ruta" className={caption}>
          {t('data.path')}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input id="repo-ruta" value={data.localPath} onChange={set('localPath')} onBlur={onPathBlur} placeholder={t('data.pathPlaceholder')} className={`${monoInput} min-w-0 flex-1`} />
          {pathStatus === 'ok' && (
            <span className="flex items-center gap-1.5 text-small whitespace-nowrap text-success">
              <CircleCheck size={14} aria-hidden />
              {t('data.gitFound')}
            </span>
          )}
          {pathStatus === 'bad' && (
            <span className="flex items-center gap-1.5 text-small whitespace-nowrap text-danger">
              <CircleAlert size={14} aria-hidden />
              {t('data.notGit')}
            </span>
          )}
          {pathStatus === 'checking' && <span className={hint}>{t('data.checking')}</span>}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="repo-nombre" className={caption}>
          {t('data.name')}
        </label>
        <input id="repo-nombre" value={data.name} onChange={set('name')} className={monoInput} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="repo-gh" className={caption}>
          {t('data.github')}
        </label>
        <input id="repo-gh" value={data.github} onChange={set('github')} placeholder={t('data.githubPlaceholder')} className={monoInput} />
        <span className={hint}>{t('data.githubHint')}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="repo-rama" className={caption}>
          {t('data.branch')}
        </label>
        <input id="repo-rama" value={data.defaultBranch} onChange={set('defaultBranch')} className={monoInput} />
        <span className={hint}>{t('data.branchHint')}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="repo-jira" className={caption}>
          {t('data.jira')}
        </label>
        <input id="repo-jira" value={data.jiraKeys} onChange={set('jiraKeys')} placeholder="ABC, XYZ" className={monoInput} />
        <span className={hint}>{t('data.jiraHint')}</span>
      </div>
    </fieldset>
  );
}

function NewRepoForm() {
  const { t } = useTranslation(['repos', 'common']);
  const queryClient = useQueryClient();
  const [data, setData] = useState<DataFields>({ name: '', localPath: '', github: '', defaultBranch: 'main', jiraKeys: '' });
  const [checkedPath, setCheckedPath] = useState('');
  const inspect = useMutation({
    mutationFn: (path: string) => api.inspectRepo(path),
    // Solo se completan los campos que el usuario no ha tocado.
    onSuccess: (info, path) => {
      setCheckedPath(path);
      if (!info.isGitRepo) return;
      setData((d) => ({
        ...d,
        name: d.name || info.name,
        github: d.github || info.github,
        defaultBranch: info.defaultBranch && d.defaultBranch === 'main' ? info.defaultBranch : d.defaultBranch,
      }));
    },
  });
  const create = useMutation({
    mutationFn: () =>
      api.createRepo({ name: data.name, localPath: data.localPath, github: data.github, defaultBranch: data.defaultBranch, jiraProjectKeys: parseKeys(data.jiraKeys) }),
    onSuccess: (repo) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.repos });
      navigate(`repositorios/${repo.id}`);
    },
  });

  const path = data.localPath.trim();
  const pathStatus = inspect.isPending ? 'checking' : path && checkedPath === path && inspect.data ? (inspect.data.isGitRepo ? 'ok' : 'bad') : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <form onSubmit={submit} aria-labelledby="repo-nuevo" className={panel}>
      <div className="flex flex-col gap-1">
        <h2 id="repo-nuevo" className="m-0 text-title font-semibold">
          {t('newRepo.title')}
        </h2>
        <span className={caption}>{t('newRepo.intro')}</span>
      </div>
      <DataFieldset data={data} onChange={setData} pathStatus={pathStatus} onPathBlur={() => path && path !== checkedPath && inspect.mutate(path)} />
      <p className={`m-0 ${hint}`}>{t('newRepo.afterAdd')}</p>
      {create.isError && (
        <p role="alert" className="m-0 flex items-center gap-2 text-danger">
          <CircleAlert size={16} aria-hidden />
          {create.error.message}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <a href="#/repositorios" className={`${secondaryButtonClass} no-underline`}>
          {t('common:actions.cancel')}
        </a>
        <button type="submit" disabled={create.isPending || !path || !data.name.trim()} className={primaryButtonClass}>
          {create.isPending ? t('newRepo.adding') : t('newRepo.submit')}
        </button>
      </div>
    </form>
  );
}

const TABS = [
  { id: 'conventionsMd', label: 'tabs.conventions', title: 'tabs.conventionsTitle' },
  { id: 'testCommandsMd', label: 'tabs.tests', title: 'tabs.testsTitle' },
  { id: 'architectureMd', label: 'tabs.architecture', title: 'tabs.architectureTitle' },
] as const satisfies readonly { id: keyof RepoProfileInput; label: string; title: string }[];

function RepoPanel({ id }: { id: number }) {
  const { t } = useTranslation(['repos', 'common']);
  const repo = useQuery({ queryKey: queryKeys.repo(id), queryFn: () => api.getRepo(id), retry: false });
  if (repo.isError) return <p className={`${panel} m-0 text-ink-muted`}>{repo.error.message}</p>;
  if (!repo.data) return <p className={`${panel} m-0 text-ink-muted`}>{t('common:status.loading')}</p>;
  return <RepoEditor key={repo.data.profile?.updatedAt ?? 'sin-ficha'} repo={repo.data} />;
}

const dataOf = (r: RepoDetail): DataFields => ({ name: r.name, localPath: r.localPath, github: r.github, defaultBranch: r.defaultBranch, jiraKeys: r.jiraProjectKeys.join(', ') });
const profileOf = (r: RepoDetail): RepoProfileInput => ({
  conventionsMd: r.profile?.conventionsMd ?? '',
  testCommandsMd: r.profile?.testCommandsMd ?? '',
  architectureMd: r.profile?.architectureMd ?? '',
});

function RepoEditor({ repo }: { repo: RepoDetail }) {
  const { t } = useTranslation(['repos', 'common']);
  const queryClient = useQueryClient();
  const [data, setData] = useState(() => dataOf(repo));
  const [profile, setProfile] = useState(() => profileOf(repo));
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('conventionsMd');

  const original = JSON.stringify([dataOf(repo), profileOf(repo)]);
  const dirty = JSON.stringify([data, profile]) !== original;
  // Un borrador de la IA está "por revisar" hasta que se guarda, aunque no se haya cambiado nada.
  const canSave = dirty || repo.profileStatus === 'por_revisar';

  const refresh = (updated: RepoDetail) => {
    queryClient.setQueryData(queryKeys.repo(repo.id), updated);
    void queryClient.invalidateQueries({ queryKey: queryKeys.repoList });
  };
  const save = useMutation({
    mutationFn: () =>
      api.updateRepo(repo.id, {
        name: data.name,
        localPath: data.localPath,
        github: data.github,
        defaultBranch: data.defaultBranch,
        jiraProjectKeys: parseKeys(data.jiraKeys),
        profile,
      }),
    onSuccess: refresh,
  });
  const draft = useMutation({ mutationFn: () => api.draftRepoProfile(repo.id), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: () => api.deleteRepo(repo.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.repos });
      navigate('repositorios');
    },
  });

  const askDraft = () => {
    const hasProfile = Object.values(profile).some((text) => text.trim());
    if (hasProfile && !window.confirm(t('editor.confirmRedraft'))) return;
    draft.mutate();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (canSave) save.mutate();
  };
  const current = TABS.find((x) => x.id === tab)!;
  const error = save.error?.message ?? draft.error?.message ?? remove.error?.message;

  return (
    <form onSubmit={submit} aria-labelledby="repo-titulo" className={panel}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="repo-titulo" className="m-0 truncate font-mono text-title font-normal">
            {repo.name}
          </h2>
          <span className={caption}>
            <span className={STATUS_CLASS[repo.profileStatus]}>{t(`status.${repo.profileStatus}`)}</span>
            {repo.profile && ` · ${repo.profile.aiDraft ? t('editor.aiDrafted') : t('editor.reviewed')} ${timeAgo(repo.profile.updatedAt)}`}
          </span>
        </div>
        <button
          type="button"
          onClick={() => window.confirm(t('editor.confirmRemove', { name: repo.name })) && remove.mutate()}
          className="h-8 rounded-md px-3 text-small text-danger hover:bg-surface-raised"
        >
          {t('editor.remove')}
        </button>
      </div>

      <DataFieldset data={data} onChange={setData} pathStatus={data.localPath === repo.localPath ? (repo.pathOk ? 'ok' : 'bad') : null} />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={subheading}>{t('editor.profileHeading')}</h3>
          <button type="button" onClick={askDraft} disabled={draft.isPending || !repo.pathOk} className={`${secondaryButtonClass} h-8 px-3 text-small`}>
            <Sparkles size={14} strokeWidth={1.5} className="text-accent" aria-hidden />
            {draft.isPending ? t('editor.readingRepo') : t('editor.fillWithAi')}
          </button>
        </div>
        <span className={hint}>
          {t('editor.profileHint')}
        </span>
        <div role="tablist" aria-label={t('editor.tabsLabel')} className="flex gap-1 border-b border-line">
          {TABS.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={x.id === tab}
              onClick={() => setTab(x.id)}
              className={`-mb-px h-9 border-b-2 px-3 ${x.id === tab ? 'border-accent text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}
            >
              {t(x.label)}
            </button>
          ))}
        </div>
        <label htmlFor="repo-ficha" className="sr-only">
          {t(current.title)}
        </label>
        <textarea
          id="repo-ficha"
          rows={10}
          value={profile[tab]}
          onChange={(e) => setProfile({ ...profile, [tab]: e.target.value })}
          disabled={draft.isPending}
          placeholder={draft.isPending ? t('editor.aiReadingPlaceholder') : t('editor.placeholder')}
          className={`${inputClass} h-auto resize-y py-2.5 font-mono text-code`}
        />
      </div>

      {error && (
        <p role="alert" className="m-0 flex items-center gap-2 text-danger">
          <CircleAlert size={16} aria-hidden />
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={hint}>{t('editor.savedInApp')}</span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!dirty}
            onClick={() => {
              setData(dataOf(repo));
              setProfile(profileOf(repo));
            }}
            className={secondaryButtonClass}
          >
            {t('editor.discard')}
          </button>
          <button type="submit" disabled={!canSave || save.isPending} className={primaryButtonClass}>
            {save.isPending ? t('common:actions.saving') : t('common:actions.save')}
          </button>
        </div>
      </div>
    </form>
  );
}
