import { describe, expect, it } from 'vitest';
import { adfToText } from './adf.js';
import { JiraClient, JiraError } from './client.js';

type Handler = (url: URL, init: RequestInit) => { status?: number; body?: unknown };

function fakeFetch(handler: Handler) {
  const calls: { url: URL; headers: Record<string, string> }[] = [];
  const impl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, headers: init.headers as Record<string, string> });
    const { status = 200, body = {} } = handler(url, init);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { impl, calls };
}

const raw = (key: string, extra: object = {}) => ({
  key,
  fields: {
    summary: `Resumen ${key}`,
    status: { name: 'En curso', statusCategory: { key: 'indeterminate' } },
    priority: { name: 'Media' },
    issuetype: { name: 'Historia' },
    project: { key: 'ABC', name: 'Proyecto ABC' },
    updated: '2026-10-05T10:00:00.000+0200',
    ...extra,
  },
});

describe('cliente de JIRA', () => {
  it('Server/Data Center: token como Bearer, API v2 y paginación con startAt', async () => {
    const { impl, calls } = fakeFetch((url) => {
      const startAt = Number(url.searchParams.get('startAt'));
      const all = Array.from({ length: 150 }, (_, i) => raw(`ABC-${i + 1}`));
      return { body: { total: 150, issues: all.slice(startAt, startAt + 100) } };
    });
    const client = new JiraClient({ baseUrl: 'https://jira.empresa.com/', token: 'pat' }, impl);
    const issues = await client.search('assignee = currentUser()');

    expect(issues).toHaveLength(150);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url.pathname).toBe('/rest/api/2/search');
    expect(calls[0]!.url.searchParams.get('jql')).toBe('assignee = currentUser()');
    expect(calls[0]!.headers.authorization).toBe('Bearer pat');
    expect(issues[0]).toEqual({
      key: 'ABC-1',
      summary: 'Resumen ABC-1',
      description: null,
      status: 'En curso',
      statusCategory: 'indeterminate',
      priority: 'Media',
      issueType: 'Historia',
      project: 'Proyecto ABC',
      updated: '2026-10-05T10:00:00.000+0200',
      url: 'https://jira.empresa.com/browse/ABC-1',
    });
  });

  it('Cloud: email + token en Basic, API v3, nextPageToken y descripción en ADF', async () => {
    const description = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hola' }] }] };
    const { impl, calls } = fakeFetch((url) =>
      url.searchParams.get('nextPageToken')
        ? { body: { issues: [raw('ABC-2')], isLast: true } }
        : { body: { issues: [raw('ABC-1', { description })], nextPageToken: 't2', isLast: false } },
    );
    const client = new JiraClient({ baseUrl: 'https://x.atlassian.net', token: 'tok', email: 'yo@x.com' }, impl);
    const issues = await client.search('jql');

    expect(issues.map((i) => i.key)).toEqual(['ABC-1', 'ABC-2']);
    expect(issues[0]!.description).toBe('Hola');
    expect(calls[0]!.url.pathname).toBe('/rest/api/3/search/jql');
    expect(calls[1]!.url.searchParams.get('nextPageToken')).toBe('t2');
    expect(calls[0]!.headers.authorization).toBe(`Basic ${Buffer.from('yo@x.com:tok').toString('base64')}`);
  });

  it('una incidencia que no existe devuelve null y un 401 explica qué revisar', async () => {
    const notFound = new JiraClient({ baseUrl: 'https://j', token: 't' }, fakeFetch(() => ({ status: 404 })).impl);
    expect(await notFound.getIssue('ABC-9')).toBeNull();

    const denied = new JiraClient({ baseUrl: 'https://j', token: 't' }, fakeFetch(() => ({ status: 401 })).impl);
    await expect(denied.search('x')).rejects.toThrow(JiraError);
    await expect(denied.search('x')).rejects.toThrow(/JIRA_TOKEN/);
  });

  it('un fallo de red se convierte en un mensaje con la URL', async () => {
    const offline = (async () => {
      throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND j') });
    }) as typeof fetch;
    await expect(new JiraClient({ baseUrl: 'https://j', token: 't' }, offline).search('x')).rejects.toThrow(
      'No se pudo conectar con JIRA en https://j: getaddrinfo ENOTFOUND j',
    );
  });
});

describe('ADF a texto', () => {
  it('conserva párrafos, listas y menciones', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'Contexto' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Habla con ' }, { type: 'mention', attrs: { text: '@Ana' } }] },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'uno' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'dos' }] }] },
          ],
        },
      ],
    };
    expect(adfToText(doc)).toBe('Contexto\nHabla con @Ana\n- uno\n- dos');
  });
});
