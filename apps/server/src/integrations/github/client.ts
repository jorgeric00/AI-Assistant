// GitHub por su API GraphQL (lectura): tus PR abiertas con sus checks, revisiones y comentarios.
// Una sola consulta trae todo lo que necesitan los avisos de "Avisos de tus PR".
import type { PrCheckAnnotation, PrCheckFailure, PrChecksState, PrState } from '@dev-assistant/shared';
import { t } from '../../i18n/index.js';

export interface GithubConfig {
  token: string;
  /** https://api.github.com/graphql por defecto; otra URL para GitHub Enterprise. */
  graphqlUrl?: string;
}

/** Error que se muestra tal cual al usuario. */
export class GithubError extends Error {}

export interface GhActivity {
  author: string;
  at: string;
}

export interface GhReview extends GhActivity {
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  /** Comentarios en el código de esa revisión (+1 si tiene texto general). */
  comments: number;
}

/** Una PR con lo que interesa para avisar. Las revisiones y comentarios ya vienen sin los tuyos ni los de bots. */
export interface GhPullRequest {
  id: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  state: PrState;
  isDraft: boolean;
  headRef: string;
  updatedAt: string;
  checks: PrChecksState | null;
  failingChecks: string[];
  reviews: GhReview[];
  comments: GhActivity[];
}

const PR_FIELDS = `
  id number title url state isDraft headRefName updatedAt
  repository { nameWithOwner }
  commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 100) { nodes {
    __typename
    ... on CheckRun { name conclusion }
    ... on StatusContext { context state }
  } } } } } }
  reviews(last: 30) { nodes { author { login __typename } state submittedAt body comments { totalCount } } }
  comments(last: 30) { nodes { author { login __typename } createdAt } }
`;

// Lo que publica cada check (título, resumen, anotaciones en el código). Solo se pide al ver los fallos.
const FAILURES = `query($id: ID!) { node(id: $id) { ... on PullRequest {
  commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 100) { nodes {
    __typename
    ... on CheckRun { name conclusion title summary text detailsUrl
      annotations(first: 30) { totalCount nodes { path location { start { line } } message title annotationLevel } } }
    ... on StatusContext { context state description targetUrl }
  } } } } } }
} } }`;

const CLOSED_PRS = `query { viewer { login pullRequests(states: [MERGED, CLOSED], first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ${PR_FIELDS} } } } }`;

const OPEN_PRS = `query { viewer { login pullRequests(states: OPEN, first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ${PR_FIELDS} } } } }`;
const BY_IDS = `query($ids: [ID!]!) { nodes(ids: $ids) { ... on PullRequest { ${PR_FIELDS} } } }`;

interface RawAuthor {
  login: string;
  __typename: string;
}
interface RawPr {
  id: string;
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  isDraft: boolean;
  headRefName: string;
  updatedAt: string;
  repository: { nameWithOwner: string };
  commits: {
    nodes: {
      commit: {
        statusCheckRollup: {
          state: string;
          contexts: { nodes: ({ __typename: 'CheckRun'; name: string; conclusion: string | null } | { __typename: 'StatusContext'; context: string; state: string })[] };
        } | null;
      };
    }[];
  };
  reviews: { nodes: { author: RawAuthor | null; state: GhReview['state']; submittedAt: string | null; body: string; comments: { totalCount: number } }[] };
  comments: { nodes: { author: RawAuthor | null; createdAt: string }[] };
}

interface RawAnnotation {
  path: string;
  location: { start: { line: number | null } | null } | null;
  message: string;
  title: string | null;
  annotationLevel: 'FAILURE' | 'WARNING' | 'NOTICE' | null;
}
type RawFailureContext =
  | {
      __typename: 'CheckRun';
      name: string;
      conclusion: string | null;
      title: string | null;
      summary: string | null;
      text: string | null;
      detailsUrl: string | null;
      annotations: { totalCount: number; nodes: (RawAnnotation | null)[] } | null;
    }
  | { __typename: 'StatusContext'; context: string; state: string; description: string | null; targetUrl: string | null };

const MAX_SUMMARY = 3000;
const MAX_ANNOTATIONS = 8;
const LEVEL_ORDER = { failure: 0, warning: 1, notice: 2 } as const;
const clip = (text: string | null | undefined, max: number) => {
  const clean = text?.trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
};

/** Los checks en rojo con lo que publican: título, resumen y las líneas que marcan (primero los errores). */
export function failuresOf(contexts: RawFailureContext[]): PrCheckFailure[] {
  const seen = new Set<string>();
  return contexts.flatMap((c): PrCheckFailure[] => {
    if (c.__typename === 'StatusContext') {
      if ((c.state !== 'FAILURE' && c.state !== 'ERROR') || seen.has(c.context)) return [];
      seen.add(c.context);
      return [{ name: c.context, title: clip(c.description, 300), summary: null, url: c.targetUrl, annotations: [], annotationsTotal: 0 }];
    }
    if (!c.conclusion || !FAILED_CONCLUSIONS.has(c.conclusion) || seen.has(c.name)) return [];
    seen.add(c.name);
    const annotations = (c.annotations?.nodes ?? [])
      .flatMap((a): PrCheckAnnotation[] =>
        a ? [{ path: a.path, line: a.location?.start?.line ?? null, message: clip(a.message, 1000) ?? '', title: clip(a.title, 200), level: (a.annotationLevel?.toLowerCase() ?? 'failure') as PrCheckAnnotation['level'] }] : [],
      )
      .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
    const title = clip(c.title, 300);
    // El resumen y el texto largo van juntos; si solo repiten el título, sobran.
    const summary = clip([c.summary, c.text].filter((x) => x?.trim()).join('\n\n'), MAX_SUMMARY);
    return [
      {
        name: c.name,
        title,
        summary: summary && summary !== title ? summary : null,
        url: c.detailsUrl,
        annotations: annotations.slice(0, MAX_ANNOTATIONS),
        annotationsTotal: Math.max(c.annotations?.totalCount ?? 0, annotations.length),
      },
    ];
  });
}

const FAILED_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);

function checksOf(raw: RawPr): Pick<GhPullRequest, 'checks' | 'failingChecks'> {
  const rollup = raw.commits.nodes[0]?.commit.statusCheckRollup;
  if (!rollup) return { checks: null, failingChecks: [] };
  const checks: PrChecksState = rollup.state === 'SUCCESS' ? 'success' : rollup.state === 'FAILURE' || rollup.state === 'ERROR' ? 'failure' : 'pending';
  const failingChecks = rollup.contexts.nodes.flatMap((c) =>
    c.__typename === 'CheckRun' ? (c.conclusion && FAILED_CONCLUSIONS.has(c.conclusion) ? [c.name] : []) : c.state === 'FAILURE' || c.state === 'ERROR' ? [c.context] : [],
  );
  return { checks, failingChecks: [...new Set(failingChecks)] };
}

/** Pasa la PR al formato de la app, quitando tu actividad y la de bots. */
export function normalizePr(raw: RawPr, me: string): GhPullRequest {
  const isOther = (a: RawAuthor | null): a is RawAuthor => !!a && a.__typename !== 'Bot' && a.login.toLowerCase() !== me.toLowerCase() && !a.login.endsWith('[bot]');
  return {
    id: raw.id,
    repo: raw.repository.nameWithOwner,
    number: raw.number,
    title: raw.title,
    url: raw.url,
    state: raw.state === 'MERGED' ? 'merged' : raw.state === 'CLOSED' ? 'closed' : 'open',
    isDraft: raw.isDraft,
    headRef: raw.headRefName,
    updatedAt: raw.updatedAt,
    ...checksOf(raw),
    reviews: raw.reviews.nodes.flatMap((r) =>
      isOther(r.author) && r.submittedAt && r.state !== 'PENDING'
        ? [{ author: r.author.login, at: r.submittedAt, state: r.state, comments: r.comments.totalCount + (r.body.trim() ? 1 : 0) }]
        : [],
    ),
    comments: raw.comments.nodes.flatMap((c) => (isOther(c.author) ? [{ author: c.author.login, at: c.createdAt }] : [])),
  };
}

const TIMEOUT_MS = 20_000;

export class GithubClient {
  private readonly url: string;
  /** Avisos de la última consulta que sí devolvió datos (p. ej. repos de una organización sin autorizar el SSO). */
  warnings: string[] = [];

  constructor(
    private readonly config: GithubConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.url = config.graphqlUrl || 'https://api.github.com/graphql';
  }

  private async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.config.token}`, 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'AI-Assistant' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const cause = err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err);
      throw new GithubError(t('github.connectFailed', { cause }));
    }
    if (res.status === 401) throw new GithubError(t('github.unauthorized'));
    const data = (await res.json().catch(() => null)) as { data?: T; errors?: { message: string; type?: string }[]; message?: string } | null;
    if (!res.ok) throw new GithubError(`${t('github.httpError', { status: res.status })}${data?.message ? `: ${data.message}` : ''}`);
    const errors = data?.errors ?? [];
    // Con SSO de la organización, GitHub responde los datos que puede y un error por cada repo sin autorizar.
    const sso = errors.find((e) => /SAML|SSO/i.test(e.message));
    if (sso && !data?.data) throw new GithubError(t('github.ssoNotAuthorized'));
    if (!data?.data) throw new GithubError(t('github.graphqlError', { message: errors.map((e) => e.message).join('; ') || t('github.emptyResponse') }));
    this.warnings = sso
      ? [t('github.ssoWarning')]
      : errors.map((e) => e.message);
    return data.data;
  }

  /** Tu usuario y tus PR abiertas (las 50 actualizadas más recientemente). */
  async myOpenPrs(): Promise<{ login: string; prs: GhPullRequest[] }> {
    const data = await this.query<{ viewer: { login: string; pullRequests: { nodes: (RawPr | null)[] } } }>(OPEN_PRS);
    const login = data.viewer.login;
    return { login, prs: data.viewer.pullRequests.nodes.flatMap((p) => (p ? [normalizePr(p, login)] : [])) };
  }

  /** Tus últimas 50 PR mergeadas o cerradas. */
  async myClosedPrs(): Promise<{ login: string; prs: GhPullRequest[] }> {
    const data = await this.query<{ viewer: { login: string; pullRequests: { nodes: (RawPr | null)[] } } }>(CLOSED_PRS);
    const login = data.viewer.login;
    return { login, prs: data.viewer.pullRequests.nodes.flatMap((p) => (p ? [normalizePr(p, login)] : [])) };
  }

  /** PR concretas por id (para saber si una que ya no está abierta se mergeó o se cerró). */
  async prsByIds(ids: string[], me: string): Promise<GhPullRequest[]> {
    if (!ids.length) return [];
    const data = await this.query<{ nodes: (RawPr | null)[] }>(BY_IDS, { ids });
    return data.nodes.flatMap((p) => (p && p.id ? [normalizePr(p, me)] : []));
  }

  /** Lo que publican en GitHub los checks en rojo del último commit de una PR. */
  async checkFailures(prId: string): Promise<{ checks: PrChecksState | null; failures: PrCheckFailure[]; passing: string[]; pending: string[] }> {
    const data = await this.query<{ node: { commits: { nodes: { commit: { statusCheckRollup: { state: string; contexts: { nodes: (RawFailureContext | null)[] } } | null } }[] } } | null }>(
      FAILURES,
      { id: prId },
    );
    const rollup = data.node?.commits.nodes[0]?.commit.statusCheckRollup;
    if (!rollup) return { checks: null, failures: [], passing: [], pending: [] };
    const checks: PrChecksState = rollup.state === 'SUCCESS' ? 'success' : rollup.state === 'FAILURE' || rollup.state === 'ERROR' ? 'failure' : 'pending';
    const contexts = rollup.contexts.nodes.flatMap((n) => (n ? [n] : []));
    const failures = failuresOf(contexts);
    const failed = new Set(failures.map((f) => f.name));
    const passing = new Set<string>();
    const pending = new Set<string>();
    for (const c of contexts) {
      const name = c.__typename === 'CheckRun' ? c.name : c.context;
      if (failed.has(name)) continue;
      const done = c.__typename === 'CheckRun' ? c.conclusion !== null : c.state !== 'PENDING' && c.state !== 'EXPECTED';
      (done ? passing : pending).add(name);
    }
    return { checks, failures, passing: [...passing], pending: [...pending] };
  }
}
