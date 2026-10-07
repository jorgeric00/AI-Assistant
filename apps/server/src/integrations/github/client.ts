// GitHub por su API GraphQL (lectura): tus PR abiertas con sus checks, revisiones y comentarios.
// Una sola consulta trae todo lo que necesitan los avisos de "Avisos de tus PR".
import type { PrChecksState, PrState } from '@dev-assistant/shared';
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

  /** PR concretas por id (para saber si una que ya no está abierta se mergeó o se cerró). */
  async prsByIds(ids: string[], me: string): Promise<GhPullRequest[]> {
    if (!ids.length) return [];
    const data = await this.query<{ nodes: (RawPr | null)[] }>(BY_IDS, { ids });
    return data.nodes.flatMap((p) => (p && p.id ? [normalizePr(p, me)] : []));
  }
}
