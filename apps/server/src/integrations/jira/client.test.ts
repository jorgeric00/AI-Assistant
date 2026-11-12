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
    assignee: { displayName: 'Luis Pérez' },
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
      assignee: 'Luis Pérez',
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

  it('myself devuelve el nombre del usuario del token', async () => {
    const { impl, calls } = fakeFetch(() => ({ body: { displayName: 'Jorge Rico', name: 'jorger' } }));
    expect(await new JiraClient({ baseUrl: 'https://j', token: 't' }, impl).myself()).toBe('Jorge Rico');
    expect(calls[0]!.url.pathname).toBe('/rest/api/2/myself');
  });

  it('una incidencia que no existe devuelve null y un 401 explica qué revisar', async () => {
    const notFound = new JiraClient({ baseUrl: 'https://j', token: 't' }, fakeFetch(() => ({ status: 404 })).impl);
    expect(await notFound.getIssue('ABC-9')).toBeNull();
    // En cambio, un 404 en la búsqueda o en /myself es que JIRA_URL no apunta a JIRA.
    await expect(notFound.search('x')).rejects.toThrow(/Revisa JIRA_URL/);
    await expect(notFound.myself()).rejects.toThrow(/Revisa JIRA_URL/);

    const denied = new JiraClient({ baseUrl: 'https://j', token: 't' }, fakeFetch(() => ({ status: 401 })).impl);
    await expect(denied.search('x')).rejects.toThrow(JiraError);
    await expect(denied.search('x')).rejects.toThrow(/JIRA_TOKEN/);
  });

  it('un login corporativo delante de JIRA da un mensaje claro', async () => {
    const sso = (async () =>
      new Response(null, { status: 302, headers: { location: 'https://login.microsoftonline.com/x/oauth2' } })) as typeof fetch;
    await expect(new JiraClient({ baseUrl: 'https://j', token: 't' }, sso).search('x')).rejects.toThrow(
      /inicio de sesión \(login\.microsoftonline\.com\)/,
    );

    const html = (async () => new Response('<html>Sign in</html>', { status: 200 })) as typeof fetch;
    await expect(new JiraClient({ baseUrl: 'https://j', token: 't' }, html).search('x')).rejects.toThrow(/página web/);
  });

  it('comenta y cambia de estado por la API: texto en Server y ADF en Cloud', async () => {
    const sent: { method: string; path: string; body: unknown }[] = [];
    const impl = (async (input: string | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      sent.push({ method: init.method ?? 'GET', path: url.pathname, body: JSON.parse(String(init.body)) });
      if (url.pathname.endsWith('/transitions')) return new Response(null, { status: 204 });
      if (url.pathname.includes('ZZZ-9')) return new Response(JSON.stringify({ errorMessages: ['Issue Does Not Exist'] }), { status: 404 });
      return new Response(JSON.stringify({ id: '10' }), { status: 201 });
    }) as typeof fetch;

    const server = new JiraClient({ baseUrl: 'https://jira.empresa.com/jira', token: 'pat' }, impl);
    await server.addComment('ABC-1', 'Hecho:\n- Exportación');
    await server.transition('ABC-1', '31');
    await new JiraClient({ baseUrl: 'https://x.atlassian.net', token: 't', email: 'j@x' }, impl).addComment('ABC-1', 'Uno\n\nDos');
    expect(sent).toEqual([
      { method: 'POST', path: '/jira/rest/api/2/issue/ABC-1/comment', body: { body: 'Hecho:\n- Exportación' } },
      { method: 'POST', path: '/jira/rest/api/2/issue/ABC-1/transitions', body: { transition: { id: '31' } } },
      {
        method: 'POST',
        path: '/rest/api/3/issue/ABC-1/comment',
        body: {
          body: {
            type: 'doc',
            version: 1,
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Uno' }] },
              { type: 'paragraph', content: [] },
              { type: 'paragraph', content: [{ type: 'text', text: 'Dos' }] },
            ],
          },
        },
      },
    ]);
    await expect(server.addComment('ZZZ-9', 'x')).rejects.toThrow('JIRA no encuentra ZZZ-9');
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

describe('imputación con Tempo', () => {
  it('traduce Type of Work y Order a las claves de Tempo y crea el registro', async () => {
    let sent: unknown;
    const { impl, calls } = fakeFetch((url, init) => {
      if (url.pathname === '/rest/api/2/issue/ABC-1') return { body: { id: '10001', key: 'ABC-1' } };
      if (url.pathname === '/rest/api/2/myself') return { body: { key: 'JIRAUSER1', name: 'jorge' } };
      if (url.pathname === '/rest/tempo-core/1/work-attribute') {
        return {
          body: [
            { id: 1, key: '_TypeofWork_', name: 'Type of Work', staticListValues: [{ name: 'New Functionality', value: 'NEW' }, { name: 'Support', value: 'SUP' }] },
            { id: 2, key: '_Order_', name: 'Order', staticListValues: [{ name: 'Services', value: 'SERV' }] },
          ],
        };
      }
      expect(init.method).toBe('POST');
      sent = JSON.parse(String(init.body));
      return { body: {} };
    });
    const client = new JiraClient({ baseUrl: 'https://jira.empresa.com', token: 'pat' }, impl);
    await client.logWork('ABC-1', '2026-11-11', 7200, { 'Type of Work': 'new functionality', Order: 'Services' });
    const post = calls.at(-1)!;
    expect(post.url.pathname).toBe('/rest/tempo-timesheets/4/worklogs');
    expect(sent).toEqual({
      originTaskId: '10001',
      worker: 'JIRAUSER1',
      started: '2026-11-11',
      timeSpentSeconds: 7200,
      attributes: { _TypeofWork_: { name: 'Type of Work', workAttributeId: 1, value: 'NEW' }, _Order_: { name: 'Order', workAttributeId: 2, value: 'SERV' } },
    });
    await expect(client.logWork('ABC-1', '2026-11-11', 60, { 'Type of Work': 'Otra cosa' })).rejects.toThrow(/Support/);
  });
});
