# Asistente IA para developers

App local para el día a día como desarrollador: notas, enlaces, recordatorios, diario de trabajo,
tareas de JIRA y desarrollo asistido con opencode (commits y PR siempre con confirmación).

El diseño completo está en `diseno-arquitectura.md`, en la carpeta `arquitectura/` del proyecto.

## Requisitos

- Node.js 22+
- pnpm 10 (`corepack enable`, o sin instalar nada: `npx pnpm@10.28.0 …`)
- opencode instalado y configurado (con los MCP de JIRA y GitHub)

## Puesta en marcha

```bash
pnpm install
cp .env.example .env     # en Windows: copy .env.example .env
pnpm dev                 # backend en 127.0.0.1:4321 y frontend en http://127.0.0.1:5173
```

Si no tienes pnpm en el PATH, usa `npx pnpm@10.28.0 install` y `npx pnpm@10.28.0 dev`.
No hace falta Visual Studio ni compilar nada: SQLite (better-sqlite3) trae binarios para Windows, Linux y macOS.

## Estructura

| Carpeta | Contenido |
|---|---|
| `apps/server` | Backend Fastify, base de datos SQLite (Drizzle) e integraciones |
| `apps/server/drizzle` | Migraciones SQL (incluye el índice FTS5 de notas) |
| `apps/web` | Frontend React + Vite + Tailwind |
| `packages/shared` | Tipos, enumerados y esquemas Zod compartidos |

## Comandos

- `pnpm test` ejecuta los tests
- `pnpm typecheck` comprueba tipos
- `pnpm build` compila todo
- `pnpm db:generate` genera una migración tras cambiar `apps/server/src/db/schema.ts`

Los datos viven en `data/assistant.db` y nunca se suben al repositorio.
