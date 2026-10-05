import { branchNameForTask } from '@dev-assistant/shared';
import { describe, expect, it } from 'vitest';

describe('branchNameForTask (R15)', () => {
  it('genera feature/<ID_JIRA>-<nombre> sin acentos ni símbolos', () => {
    expect(branchNameForTask('abc-123', 'Validar email en el alta')).toBe('feature/ABC-123-validar-email-en-el-alta');
    expect(branchNameForTask('ABC-9', '¿Corrección de “Información” crítica?')).toBe('feature/ABC-9-correccion-de-informacion-critica');
  });

  it('recorta el nombre sin dejar guiones al final', () => {
    expect(branchNameForTask('ABC-1', 'a'.repeat(39) + ' bbbb')).toBe(`feature/ABC-1-${'a'.repeat(39)}`);
  });
});
