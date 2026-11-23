# Guía de instalación

Esta guía deja la aplicación funcionando en tu equipo (Windows, WSL, Linux o macOS). Todo es local: la app solo escucha en `127.0.0.1` y los datos viven en tu máquina.

## 1. Requisitos

| Qué | Versión | Cómo comprobarlo |
|---|---|---|
| Node.js | 22.14 o superior | `node -v` |
| pnpm | 10 | `pnpm -v` (o usa `npx pnpm@10.28.0 …` sin instalar nada) |
| git | cualquiera reciente | `git --version` |
| opencode | instalado y configurado | `opencode --version` |

- Con una versión de Node anterior a 22.14 el servidor se cierra al arrancar.
- Para activar pnpm: `corepack enable`.
- No hace falta Visual Studio ni compilar nada: SQLite trae binarios para Windows, Linux y macOS.

## 2. Descargar e instalar

```bash
git clone https://github.com/jorgeric00/AI-Assistant.git
cd AI-Assistant
pnpm install        # o: npx pnpm@10.28.0 install
```

## 3. Configurar el `.env`

```bash
cp .env.example .env     # en Windows (cmd): copy .env.example .env
```

Edita `.env`. Solo lo marcado como necesario hace falta para empezar; el resto se puede añadir luego.

| Variable | Para qué | ¿Necesaria? |
|---|---|---|
| `JIRA_URL` | URL base de JIRA, p. ej. `https://jira.miempresa.com` | Para tareas e imputar horas |
| `JIRA_TOKEN` | Token personal. Server/Data Center: Perfil > Personal Access Tokens. Cloud: token de API | Para tareas e imputar horas |
| `JIRA_EMAIL` | Solo JIRA Cloud (`*.atlassian.net`). En Server/Data Center, vacío | Solo Cloud |
| `JIRA_JQL` | Consulta de tus tareas; por defecto, las asignadas a ti | No |
| `GITHUB_TOKEN` | Token de solo lectura para ver el estado de tus PR. Fine-grained con "Pull requests: Read" y "Commit statuses / Checks: Read", o classic con `repo`. Si la organización usa SSO, autorízalo en GitHub (Settings > Developer settings > tokens > Configure SSO) | Para la sección Pull requests |
| `GITHUB_GRAPHQL_URL` | Solo GitHub Enterprise: URL de su API GraphQL | Solo Enterprise |
| `OPENCODE_CONFIG` | Config de opencode de la que se leen los servidores MCP | No (`~/.config/opencode/opencode.json`) |
| `OPENCODE_URL` | Si ya tienes `opencode serve` en marcha, su URL; vacío = la app lo arranca sola | No |
| `PORT` | Puerto local | No (4321) |
| `DATABASE_PATH` | Base de datos SQLite | No (`./data/assistant.db`) |
| `DEV_ASSISTANT_HOME` | Carpeta de trabajo (worktrees y planes de cada tarea) | No (`~/.dev-assistant`) |
| `OPENCODE_SKILLS_DIR` | Donde se instala la skill `dev-assistant-tarea` | No (`~/.config/opencode/skill`) |

Notas:
- **Nunca subas el `.env` ni pegues tokens en chats o commits.** Si un token se filtra, revócalo y crea otro.
- Si JIRA usa un certificado de empresa que Node no reconoce, define `NODE_EXTRA_CA_CERTS` (ruta al `.pem` de la CA) como variable de entorno del sistema; dentro del `.env` no tiene efecto.
- Los tokens de JIRA y GitHub del `.env` los usa la app. Los MCP de opencode (JIRA, GitHub) tienen su propia configuración en `opencode.json`.

## 4. Configurar opencode

La IA de la app pasa siempre por opencode, con los modelos que ya tengas configurados.

1. Instala opencode y elige tu proveedor/modelo (comprueba que funciona abriéndolo en una terminal).
2. En `~/.config/opencode/opencode.json` define los MCP de JIRA y GitHub. Las variables se escriben como `{env:NOMBRE}` y deben existir en el entorno donde arranca opencode.
3. En la app, **Ajustes > Inteligencia artificial** muestra qué servidores MCP ve opencode y si arrancan; si alguno aparece en fallo, ahí está el motivo.
4. **Ajustes** instala (y actualiza cuando hace falta) la skill `dev-assistant-tarea`, que guía a opencode al trabajar una tarea.

## 5. Arrancar

```bash
pnpm start     # compila la web y la sirve con el backend
```

Abre http://127.0.0.1:4321. Si no tienes pnpm en el PATH: `npx pnpm@10.28.0 start`.

La base de datos se crea y migra sola la primera vez.

### Arranque automático (Windows)

**Ajustes > Arranque** deja la app arrancando al iniciar sesión. El registro está en `~/.dev-assistant/logs/app.log`.

### Copias de seguridad

**Ajustes > Copias de seguridad** guarda una copia diaria de la base de datos en `~/.dev-assistant/copias` (las 7 más recientes).

## 6. Actualizar

```bash
git pull
pnpm install
pnpm start
```

Las migraciones de base de datos se aplican solas al arrancar. Si cambia la skill, Ajustes avisa y la reinstala.

## 7. Modo desarrollo

`pnpm dev` arranca el backend en 127.0.0.1:4321 y Vite en http://127.0.0.1:5173. Otros comandos: `pnpm test`, `pnpm typecheck`, `pnpm build`.

## 8. Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| El servidor se cierra nada más arrancar | Node anterior a 22.14. Actualiza Node. |
| Error de certificado al hablar con JIRA o GitHub | Define `NODE_EXTRA_CA_CERTS` con la CA de tu empresa. |
| No aparecen tus PR | Falta `GITHUB_TOKEN`, o no está autorizado para el SSO de la organización. |
| JIRA devuelve 401/403 | Token caducado o sin permisos; en Cloud, falta `JIRA_EMAIL`. |
| La IA no responde o no tiene la herramienta de JIRA/GitHub | Mira Ajustes > Inteligencia artificial: el MCP aparece en fallo, normalmente por una variable `{env:…}` sin definir en el entorno de opencode. |
| El puerto 4321 está ocupado | Cambia `PORT` en `.env`. |
| `pnpm` no se encuentra | `corepack enable` o usa `npx pnpm@10.28.0 …`. |
