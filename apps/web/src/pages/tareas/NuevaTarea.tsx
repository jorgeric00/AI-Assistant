import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JiraCreateInput, JiraExtraField } from '@dev-assistant/shared';
import { CircleAlert, Info, Plus, Sparkles } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { api, queryKeys } from '../../api';
import { Modal } from '../../components/Modal';
import { TagInput } from '../../components/TagInput';
import { inputClass, primaryButtonClass, secondaryButtonClass } from '../../components/fields';
import { navigate } from '../../sections';

const hint = 'text-small text-ink-faint';
const select = `${inputClass} w-full [color-scheme:dark] disabled:text-ink-faint`;
const EPIC_KEY = /^\s*([A-Za-z][A-Za-z0-9_]*-\d+)/;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** Diálogo "Nueva tarea en JIRA": se crea por la API REST solo al pulsar "Crear en JIRA". */
export function NuevaTareaDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['tasks', 'common']);
  const queryClient = useQueryClient();
  const projects = useQuery({ queryKey: queryKeys.jiraCreateProjects, queryFn: api.jiraCreateProjects, retry: false });

  const [project, setProject] = useState('');
  const [typeId, setTypeId] = useState('');
  const [idea, setIdea] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [epicText, setEpicText] = useState('');
  const [sprintId, setSprintId] = useState('');
  const [assignToMe, setAssignToMe] = useState(true);
  const [priorityId, setPriorityId] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const [extra, setExtra] = useState<Record<string, string | string[]>>({});

  // Primero el último proyecto y tipo usados; si no, el primero de la lista.
  useEffect(() => {
    if (project || !projects.data) return;
    const last = projects.data.last;
    const keep = last && projects.data.projects.some((p) => p.key === last.project) ? last.project : projects.data.projects[0]?.key;
    if (keep) setProject(keep);
  }, [projects.data, project]);

  const types = useQuery({ queryKey: queryKeys.jiraIssueTypes(project), queryFn: () => api.jiraIssueTypes(project), enabled: !!project, retry: false });
  useEffect(() => {
    if (!types.data || types.data.some((it) => it.id === typeId)) return;
    const last = projects.data?.last;
    const preferred = last?.project === project ? types.data.find((it) => it.id === last.issueTypeId) : undefined;
    setTypeId((preferred ?? types.data[0])?.id ?? '');
  }, [types.data, typeId, project, projects.data]);

  const form = useQuery({ queryKey: queryKeys.jiraCreateForm(project, typeId), queryFn: () => api.jiraCreateForm(project, typeId), enabled: !!project && !!typeId, retry: false });
  useEffect(() => {
    if (!form.data) return;
    setPriorityId(form.data.defaultPriorityId ?? '');
    setExtra({});
  }, [form.data]);

  const epicQuery = useDebounced(EPIC_KEY.test(epicText) && epicText.includes(' · ') ? '' : epicText.trim(), 300);
  const epics = useQuery({ queryKey: queryKeys.jiraEpics(project, epicQuery), queryFn: () => api.jiraEpics(project, epicQuery), enabled: !!project, retry: false });
  const sprints = useQuery({ queryKey: queryKeys.jiraSprints(project), queryFn: () => api.jiraSprints(project), enabled: !!project, retry: false });

  const typeName = types.data?.find((it) => it.id === typeId)?.name;
  const epicKey = epicText.match(EPIC_KEY)?.[1]?.toUpperCase();
  const sprint = sprints.data?.find((s) => String(s.id) === sprintId);

  const draft = useMutation({
    mutationFn: () => api.draftJiraTask({ idea, project, issueType: typeName }),
    onSuccess: (d) => {
      setSummary(d.summary);
      setDescription(d.description);
    },
  });
  const create = useMutation({
    mutationFn: (input: JiraCreateInput) => api.createJiraTask(input),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      if (result.warnings.length) window.alert(t('newTask.createdWithWarnings', { key: result.key, warnings: result.warnings.join('\n') }));
      onClose();
      navigate(`tareas/${result.key}/detalle`);
    },
  });

  const askDraft = () => {
    if ((summary.trim() || description.trim()) && !window.confirm(t('newTask.confirmReplace'))) return;
    draft.mutate();
  };

  const missingExtra = (form.data?.extraFields ?? []).filter((f) => {
    const v = extra[f.id];
    return f.input !== 'unsupported' && (Array.isArray(v) ? !v.length : !v?.trim());
  });
  const unsupported = (form.data?.extraFields ?? []).filter((f) => f.input === 'unsupported');
  const ready = !!project && !!typeId && form.isSuccess && !!summary.trim() && !missingExtra.length && !unsupported.length;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || create.isPending) return;
    create.mutate({
      project,
      issueTypeId: typeId,
      summary: summary.trim(),
      description,
      assignToMe: form.data?.assignee ? assignToMe : false,
      priorityId: priorityId || undefined,
      // En JIRA una etiqueta no puede llevar espacios.
      labels: labels.map((l) => l.replace(/\s+/g, '-')),
      epicKey,
      sprintId: sprint?.id,
      extra,
    });
  };

  let willCreate = t('newTask.fillSummary');
  if (summary.trim() && typeName) {
    const parts = [t('newTask.willCreate', { type: typeName, project })];
    if (assignToMe && form.data?.assignee) parts.push(t('newTask.willAssign'));
    if (epicKey) parts.push(t('newTask.willEpic', { epic: epicKey }));
    if (sprint) parts.push(t('newTask.willSprint', { sprint: sprint.name }));
    willCreate = `${parts.join(', ')}.`;
  }

  const loadError = projects.error ?? types.error ?? form.error;

  return (
    <Modal labelledBy="nueva-tarea-titulo" onClose={onClose} width="max-w-[680px]">
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 id="nueva-tarea-titulo" className="m-0 text-title font-semibold">
            {t('newTask.title')}
          </h1>
          <p className="m-0 text-ink-muted">{t('newTask.subtitle')}</p>
        </div>

        {loadError && (
          <p role="alert" className="m-0 flex items-start gap-2 rounded-md border border-line p-3 text-danger">
            <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
            <span>{loadError.message}</span>
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="nt-proyecto" className="font-medium">
              {t('newTask.project')}
            </label>
            <select id="nt-proyecto" value={project} onChange={(e) => setProject(e.target.value)} disabled={!projects.data} className={select}>
              {!projects.data && <option value="">{t('common:status.loading')}</option>}
              {projects.data?.projects.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.key} · {p.name}
                </option>
              ))}
            </select>
            <span className={hint}>{t('newTask.projectHint')}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="nt-tipo" className="font-medium">
              {t('newTask.type')}
            </label>
            <select id="nt-tipo" value={typeId} onChange={(e) => setTypeId(e.target.value)} disabled={!types.data} className={select}>
              {!types.data && <option value="">{t('common:status.loading')}</option>}
              {types.data?.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                </option>
              ))}
            </select>
            <span className={hint}>{t('newTask.typeHint')}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-line bg-bg p-3">
          <label htmlFor="nt-idea" className="font-medium">
            {t('newTask.idea')}
          </label>
          <textarea
            id="nt-idea"
            rows={2}
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder={t('newTask.ideaPlaceholder')}
            className={`${inputClass} h-auto resize-y py-2.5 leading-[21px]`}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {draft.isError ? (
              <p role="alert" className="m-0 text-small text-danger">
                {draft.error.message}
              </p>
            ) : (
              <span className={hint}>{t('newTask.ideaHint')}</span>
            )}
            <button type="button" onClick={askDraft} disabled={!idea.trim() || !project || draft.isPending} className={`${secondaryButtonClass} h-8 px-3 text-small`}>
              <Sparkles size={14} strokeWidth={1.5} className="text-accent" aria-hidden />
              {draft.isPending ? t('newTask.drafting') : t('newTask.draftWithAi')}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="nt-resumen" className="font-medium">
            {t('newTask.summary')} <span className="text-danger" aria-hidden>*</span>
          </label>
          <input
            id="nt-resumen"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            maxLength={255}
            required
            disabled={draft.isPending}
            placeholder={t('newTask.summaryPlaceholder')}
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="nt-desc" className="font-medium">
            {t('newTask.description')}
          </label>
          <textarea
            id="nt-desc"
            rows={9}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={draft.isPending}
            placeholder={t('newTask.descriptionPlaceholder')}
            className={`${inputClass} h-auto resize-y py-2.5 font-mono text-code leading-5`}
          />
          <span className={hint}>{t('newTask.descriptionHint')}</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="nt-epica" className="font-medium">
              {t('newTask.epic')}
            </label>
            <input
              id="nt-epica"
              type="search"
              list="nt-epicas"
              value={epicText}
              onChange={(e) => setEpicText(e.target.value)}
              placeholder={t('newTask.epicPlaceholder')}
              className={inputClass}
            />
            <datalist id="nt-epicas">
              {epics.data?.map((ep) => <option key={ep.key} value={`${ep.key} · ${ep.summary}`} />)}
            </datalist>
            <span className={epics.isError ? 'text-small text-danger' : hint}>{epics.isError ? epics.error.message : t('newTask.epicHint')}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="nt-sprint" className="font-medium">
              {t('newTask.sprint')}
            </label>
            <select id="nt-sprint" value={sprintId} onChange={(e) => setSprintId(e.target.value)} className={select}>
              <option value="">{t('newTask.backlog')}</option>
              {sprints.data?.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name} · {t(s.state === 'active' ? 'newTask.sprintActive' : 'newTask.sprintFuture')}
                </option>
              ))}
            </select>
            <span className={sprints.isError ? 'text-small text-danger' : hint}>
              {sprints.isError ? sprints.error.message : sprints.isSuccess && !sprints.data.length ? t('newTask.noSprints') : t('newTask.sprintHint')}
            </span>
          </div>
          {form.data?.assignee && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="nt-asignada" className="font-medium">
                {t('newTask.assignee')}
              </label>
              <select id="nt-asignada" value={assignToMe ? 'me' : 'none'} onChange={(e) => setAssignToMe(e.target.value === 'me')} className={select}>
                <option value="me">{t('newTask.toMe')}</option>
                <option value="none">{t('newTask.unassigned')}</option>
              </select>
            </div>
          )}
          {form.data?.priorities && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="nt-prioridad" className="font-medium">
                {t('newTask.priority')}
              </label>
              <select id="nt-prioridad" value={priorityId} onChange={(e) => setPriorityId(e.target.value)} className={select}>
                {form.data.priorities.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {form.data?.labels && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="nt-etiquetas" className="font-medium">
              {t('newTask.labels')}
            </label>
            <TagInput id="nt-etiquetas" value={labels} onChange={setLabels} />
          </div>
        )}

        {!!form.data?.extraFields.length && (
          <fieldset className="m-0 flex flex-col gap-3 rounded-lg border border-line p-3">
            <legend className="px-1.5 text-small font-medium tracking-[.04em] text-ink-muted uppercase">{t('newTask.requiredHere')}</legend>
            {form.data.extraFields.map((f) => (
              <ExtraField key={f.id} field={f} value={extra[f.id]} onChange={(v) => setExtra((prev) => ({ ...prev, [f.id]: v }))} />
            ))}
            <span className={hint}>{t('newTask.requiredHint')}</span>
          </fieldset>
        )}

        <p className="m-0 flex items-start gap-2 rounded-md border border-line bg-bg p-3">
          <Info size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          <span aria-live="polite">{willCreate}</span>
        </p>

        {create.isError && (
          <p role="alert" className="m-0 flex items-start gap-2 text-danger">
            <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
            {create.error.message}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={hint}>
            <Trans t={t} i18nKey="newTask.shortcuts" components={{ kbd: <kbd className="font-mono" /> }} />
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={secondaryButtonClass}>
              {t('common:actions.cancel')}
            </button>
            <button type="submit" disabled={!ready || create.isPending || draft.isPending} className={primaryButtonClass}>
              {create.isPending ? t('newTask.creating') : t('newTask.create')}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function ExtraField({ field, value, onChange }: { field: JiraExtraField; value: string | string[] | undefined; onChange: (v: string | string[]) => void }) {
  const { t } = useTranslation(['tasks', 'common']);
  const id = `nt-extra-${field.id}`;
  const label = (
    <label htmlFor={id} className="font-medium">
      {field.name} <span className="text-danger" aria-hidden>*</span>
    </label>
  );
  const text = typeof value === 'string' ? value : '';
  let control;
  switch (field.input) {
    case 'select':
      control = (
        <select id={id} value={text} onChange={(e) => onChange(e.target.value)} className={select}>
          <option value="">{t('newTask.pickOne')}</option>
          {field.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      );
      break;
    case 'multi':
      control = (
        <select
          id={id}
          multiple
          value={Array.isArray(value) ? value : []}
          onChange={(e) => onChange([...e.target.selectedOptions].map((o) => o.value))}
          className={`${select} h-auto min-h-24 py-1`}
        >
          {field.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      );
      break;
    case 'textarea':
      control = <textarea id={id} rows={3} value={text} onChange={(e) => onChange(e.target.value)} className={`${inputClass} h-auto resize-y py-2.5`} />;
      break;
    case 'unsupported':
      return (
        <div className="flex flex-col gap-1.5">
          {label}
          <p id={id} className="m-0 text-small text-danger">
            {t('newTask.unsupported')}
          </p>
        </div>
      );
    default:
      control = (
        <input
          id={id}
          type={field.input === 'number' ? 'number' : field.input === 'date' ? 'date' : 'text'}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.input === 'list' ? t('newTask.commaSeparated') : undefined}
          className={`${inputClass} [color-scheme:dark]`}
        />
      );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {label}
      {control}
    </div>
  );
}

/** Botón de la cabecera de Tareas de JIRA que abre el diálogo. */
export function NuevaTareaButton({ disabled, className }: { disabled?: boolean; className: string }) {
  const { t } = useTranslation(['tasks', 'common']);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} disabled={disabled} className={className}>
        <Plus size={16} strokeWidth={1.5} aria-hidden />
        {t('newTask.button')}
      </button>
      {open && <NuevaTareaDialog onClose={() => setOpen(false)} />}
    </>
  );
}
