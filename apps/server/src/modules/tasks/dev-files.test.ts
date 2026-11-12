import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { OpencodeSkillStatus, TaskDevInfo } from '@dev-assistant/shared';
import { buildApp } from '../../app.js';
import { openDatabase } from '../../db/client.js';
import { parseHistory, parsePlan, withReadyStepDone } from './dev-files.js';

const PLAN = `# ABC-131 · Exportar informe

## Análisis
- [x] Leer el ticket

## Plan aprobado
- [x] Jorge aprueba el plan

## Implementación · orders-api
- [x] Endpoint GET /orders/export
- [ ] Paginar la consulta

## Implementación · backoffice-web
- [ ] Botón "Exportar CSV"

## Pruebas y PR
- [ ] Abrir la PR
`;

const HISTORY = `- 2026-10-06 11:20 | orders-api | 19c3e77 | https://github.com/e/orders-api/commit/19c3e77 | Endpoint GET /orders/export
línea que no encaja
- 2026-10-06 12:31 | orders-api | 4f2a9c1 | - | Tests | con barra
`;

describe('PLAN.md e HISTORIAL.md', () => {
  it('agrupa los pasos por fase y calcula la fase actual', () => {
    const plan = parsePlan(PLAN, 'x')!;
    expect(plan.total).toBe(6);
    expect(plan.done).toBe(3);
    expect(plan.currentPhase).toBe('Implementación');
    expect(plan.phases).toEqual([
      { name: 'Análisis', done: 1, total: 1 },
      { name: 'Plan aprobado', done: 1, total: 1 },
      { name: 'Implementación', done: 1, total: 3 },
      { name: 'Pruebas y PR', done: 0, total: 1 },
    ]);
    expect(plan.sections.map((s) => s.title)).toContain('Implementación · backoffice-web');
  });

  it('un plan sin casillas no cuenta como plan', () => {
    expect(parsePlan('# Nada\n\nTexto', 'x')).toBeNull();
  });

  it('lee el histórico del más reciente al más antiguo y tolera URL vacía', () => {
    expect(parseHistory(HISTORY)).toEqual([
      { date: '2026-10-06 12:31', repo: 'orders-api', sha: '4f2a9c1', url: null, text: 'Tests | con barra', kind: 'commit' },
      { date: '2026-10-06 11:20', repo: 'orders-api', sha: '19c3e77', url: 'https://github.com/e/orders-api/commit/19c3e77', text: 'Endpoint GET /orders/export', kind: 'commit' },
    ]);
  });

  it('marca las líneas de análisis', () => {
    expect(parseHistory('- 2026-11-11 12:58 | análisis | - | - | Timeout corto')).toEqual([
      { date: '2026-11-11 12:58', repo: 'análisis', sha: '-', url: null, text: 'Timeout corto', kind: 'analysis' },
    ]);
  });
});

describe('API de desarrollo y skill de opencode', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  afterEach(async () => app?.close());

  async function setup() {
    const home = mkdtempSync(join(tmpdir(), 'da-home-'));
    const skills = mkdtempSync(join(tmpdir(), 'da-skills-'));
    app = await buildApp(openDatabase(':memory:').db, { devAssistantHome: home, opencodeSkillsDir: skills });
    return { home, skills, app };
  }

  it('devuelve plan e histórico de la carpeta de la tarea, o vacío si no existen', async () => {
    const { home, app } = await setup();
    const empty = (await app.inject({ method: 'GET', url: '/api/tasks/ABC-131/dev' })).json<TaskDevInfo>();
    expect(empty).toMatchObject({ plan: null, history: [] });

    mkdirSync(join(home, 'worktrees', 'ABC-131'), { recursive: true });
    writeFileSync(join(home, 'worktrees', 'ABC-131', 'PLAN.md'), PLAN);
    writeFileSync(join(home, 'worktrees', 'ABC-131', 'HISTORIAL.md'), HISTORY);
    const info = (await app.inject({ method: 'GET', url: '/api/tasks/abc-131/dev' })).json<TaskDevInfo>();
    expect(info.plan?.done).toBe(3);
    expect(info.history).toHaveLength(2);
    expect(info.folder).toBe(join(home, 'worktrees', 'ABC-131'));

    expect((await app.inject({ method: 'GET', url: '/api/tasks/..%2F..%2Fetc/dev' })).statusCode).toBe(400);
  });

  it('instala la skill y detecta si está al día', async () => {
    const { skills, app } = await setup();
    const before = (await app.inject({ method: 'GET', url: '/api/opencode/skill' })).json<OpencodeSkillStatus>();
    expect(before).toMatchObject({ installed: false, upToDate: false });

    const after = (await app.inject({ method: 'POST', url: '/api/opencode/skill/install' })).json<OpencodeSkillStatus>();
    expect(after).toMatchObject({ installed: true, upToDate: true, path: join(skills, 'dev-assistant-tarea', 'SKILL.md') });
    expect(readFileSync(after.path, 'utf8')).toContain('name: dev-assistant-tarea');

    writeFileSync(after.path, 'versión vieja');
    expect((await app.inject({ method: 'GET', url: '/api/opencode/skill' })).json<OpencodeSkillStatus>().upToDate).toBe(false);
  });
});

describe('último paso del plan', () => {
  const plan = parsePlan('# K-1\n\n## Pruebas y PR\n- [x] Checks en verde\n- [x] El usuario valida\n- [ ] PR en "ready for review" y JIRA en "In Review"\n', 't')!;
  const ready = { prs: [{ state: 'open' as const, isDraft: false }], jiraStatus: 'In Review', jiraDone: false };

  it('se marca solo cuando las PR salieron de borrador y JIRA está en revisión', () => {
    const done = withReadyStepDone(plan, ready)!;
    expect(done.sections[0]!.steps.map((st) => st.done)).toEqual([true, true, true]);
    expect(done).toMatchObject({ done: 3, total: 3, currentPhase: null });
    expect(withReadyStepDone(plan, { ...ready, jiraStatus: 'En revisión' })!.done).toBe(3);
    expect(withReadyStepDone(plan, { ...ready, prs: [{ state: 'merged', isDraft: false }], jiraStatus: 'Hecha', jiraDone: true })!.done).toBe(3);
  });

  it('se queda pendiente si falta algo', () => {
    expect(withReadyStepDone(plan, { ...ready, prs: [{ state: 'open', isDraft: true }] })).toBe(plan);
    expect(withReadyStepDone(plan, { ...ready, prs: [{ state: 'open', isDraft: false }, { state: 'open', isDraft: true }] })).toBe(plan);
    expect(withReadyStepDone(plan, { ...ready, prs: [] })).toBe(plan);
    expect(withReadyStepDone(plan, { ...ready, jiraStatus: 'En curso' })).toBe(plan);
    expect(withReadyStepDone(plan, { ...ready, jiraStatus: null })).toBe(plan);
  });
});
