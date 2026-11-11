import { describe, expect, it } from 'vitest';
import { toMessage } from './chat-core.js';

const questions = [
  { question: '¿En qué rama lo subo?', header: 'Rama', options: [] },
  { question: '¿Qué tests paso?', header: 'Tests', options: [], multiple: true },
];
const asked = (state: Record<string, unknown>) =>
  toMessage({ info: { id: 'a1', role: 'assistant', time: { created: 1 } }, parts: [{ id: 't1', type: 'tool', tool: 'question', state: { input: { questions }, ...state } as never }] }, '/repo')
    .parts[0];

describe('preguntas de opencode en la conversación', () => {
  it('lo contestado se resume con el nombre corto de cada pregunta', () => {
    const output = 'User has answered your questions: "¿En qué rama lo subo?"="feature/x", "¿Qué tests paso?"="Unitarios, e2e". You can now continue.';
    expect(asked({ status: 'completed', output })).toMatchObject({ tool: 'question', status: 'completed', detail: 'Rama: feature/x · Tests: Unitarios, e2e', output: null });
  });

  it('sin contestar o en curso, solo se nombra lo que pregunta', () => {
    expect(asked({ status: 'error', error: 'The user dismissed this question' })).toMatchObject({ status: 'error', detail: 'Rama, Tests', output: null });
    expect(asked({ status: 'running' })).toMatchObject({ status: 'running', detail: 'Rama, Tests' });
  });
});
