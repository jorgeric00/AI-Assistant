import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { openDatabase } from '../db/client.js';
import { language, locale, setLanguage, t } from './index.js';

let close: (() => Promise<unknown>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
  // El idioma es un ajuste de todo el proceso: cada test deja el de por defecto.
  setLanguage('es');
});

describe('idioma del servidor', () => {
  it('al elegir inglés, los errores salen en inglés y el ajuste se guarda', async () => {
    const app = await buildApp(openDatabase(':memory:').db);
    close = () => app.close();

    const put = await app.inject({ method: 'PUT', url: '/api/settings/language', payload: { language: 'en' } });
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json()).toEqual({ language: 'en' });
    expect(language()).toBe('en');
    expect(locale()).toBe('en-GB');

    const res = await app.inject({ method: 'POST', url: '/api/prs/check' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'GitHub is not configured: add GITHUB_TOKEN to the .env file.' });

    // Mensajes propios de los esquemas compartidos, también traducidos.
    const bad = await app.inject({ method: 'POST', url: '/api/notes', payload: { title: '  ' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toContain('The title is required');

    expect((await app.inject({ method: 'GET', url: '/api/settings/language' })).json()).toEqual({ language: 'en' });
  });

  it('setLanguage("es") vuelve al castellano', async () => {
    setLanguage('en');
    expect(t('tasks.notFound')).toBe('Task not found');
    expect(t('prs.alert.commentsOther', { count: 3 })).toBe('3 new comments');
    setLanguage('es');
    expect(t('tasks.notFound')).toBe('Tarea no encontrada');
    expect(locale()).toBe('es-ES');

    const app = await buildApp(openDatabase(':memory:').db);
    close = () => app.close();
    const res = await app.inject({ method: 'POST', url: '/api/prs/check' });
    expect(res.json()).toEqual({ error: 'GitHub no está configurado: añade GITHUB_TOKEN al fichero .env.' });
  });
});
