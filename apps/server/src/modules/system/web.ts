// En producción (`pnpm start`) el propio servidor sirve la web compilada (apps/web/dist):
// un solo proceso en http://127.0.0.1:4321, sin Vite. En desarrollo la sirve Vite y aquí no hay dist.
import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

export const WEB_DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../web/dist');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const isFile = (path: string) => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;

export async function webRoutes(app: FastifyInstance, { dist = WEB_DIST }: { dist?: string }) {
  if (!isFile(join(dist, 'index.html'))) return;
  const root = resolve(dist);
  app.get('/*', async (req, reply) => {
    const path = decodeURIComponent(req.url.split('?')[0] ?? '/');
    if (path.startsWith('/api/')) return reply.code(404).send({ error: 'Ruta no encontrada' });
    const file = normalize(join(root, path === '/' ? 'index.html' : path));
    // Nada fuera de dist; lo que no existe es la página (las rutas de la app van tras el #).
    const target = file.startsWith(root + sep) && isFile(file) ? file : join(root, 'index.html');
    const ext = extname(target);
    reply.header('content-type', TYPES[ext] ?? 'application/octet-stream');
    if (target.includes(`${sep}assets${sep}`)) reply.header('cache-control', 'public, max-age=31536000, immutable');
    return reply.send(await readFile(target));
  });
}
