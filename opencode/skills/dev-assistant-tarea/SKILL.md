---
name: dev-assistant-tarea
description: Forma de trabajar en una tarea de JIRA lanzada desde AI-Assistant. Úsala siempre que desarrolles una tarea con clave de JIRA (p. ej. ABC-123), para mantener al día su PLAN.md y su HISTORIAL.md.
---

# Desarrollo de una tarea de JIRA con AI-Assistant

AI-Assistant es la app local de Jorge para seguir sus tareas de JIRA. Lee dos ficheros que mantienes tú
para mostrar en qué fase está la tarea y qué cambios se han hecho. Sigue estas reglas en todas las tareas.

## Carpeta de la tarea

Cada tarea tiene una carpeta fuera de los repositorios de la empresa:

```
~/.dev-assistant/worktrees/<CLAVE>/
  PLAN.md         ← el plan de desarrollo (lo escribes tú)
  HISTORIAL.md    ← una línea por commit (la añades tú)
  <repo>/         ← un worktree de git por cada repositorio de la tarea
```

`<CLAVE>` es la clave de JIRA en mayúsculas (p. ej. `ABC-123`). En Windows, `~` es la carpeta del usuario
(`C:\Users\<usuario>`). Crea la carpeta si no existe. **Nunca** guardes `PLAN.md` ni `HISTORIAL.md` dentro
de un repositorio ni los incluyas en un commit.

## Antes de tocar código: el plan

1. Lee el ticket de JIRA (con el MCP de JIRA) y analiza los repositorios implicados.
2. Escribe `PLAN.md` con este formato exacto y pide a Jorge que lo apruebe. No toques código hasta que lo apruebe.

```markdown
# <CLAVE> · <resumen del ticket>

## Análisis
- [x] Leer el ticket y los criterios de aceptación
- [x] Revisar el código afectado en <repo>

## Plan aprobado
- [ ] Jorge aprueba el plan

## Implementación · <repo>
- [ ] Paso concreto y verificable
- [ ] Otro paso

## Pruebas y PR
- [ ] Ejecutar los tests de <repo>
- [ ] Abrir la PR (con confirmación de Jorge)
```

Reglas del plan:
- Las fases van en este orden: `Análisis`, `Plan aprobado`, `Implementación`, `Pruebas y PR`.
- Si la tarea toca varios repositorios, usa una sección `## Implementación · <repo>` por repositorio.
- Cada paso es una casilla `- [ ]` en una sola línea, corto y verificable.
- Marca cada paso con `- [x]` en cuanto lo termines, sin esperar al final. Si el plan cambia, edítalo.

## Commits

- Rama: `feature/<CLAVE>-<resumen-en-minusculas-con-guiones>` (máx. 40 caracteres tras la clave).
- Mensaje: `<CLAVE>: <explicación breve en español>` (p. ej. `ABC-123: validar el email en el alta`).
- Propón cada commit a Jorge y hazlo solo cuando lo confirme.
- **Justo después de cada commit**, añade una línea al final de `HISTORIAL.md` (créalo si no existe):

```
- <AAAA-MM-DD HH:MM> | <repo> | <hash corto> | <URL del commit en GitHub> | <explicación breve>
```

Ejemplo:

```
- 2026-10-06 12:31 | orders-api | 4f2a9c1 | https://github.com/empresa/orders-api/commit/4f2a9c1 | Tests del servicio de exportación a CSV
```

La URL es `https://github.com/<owner>/<repo>/commit/<hash>`; si el commit aún no está en GitHub, pon `-`.
Usa la hora local. Una línea por commit, sin borrar ni reordenar las anteriores.

## Lo que nunca haces sin confirmación de Jorge

- `git push`, crear o actualizar PR, y cualquier cambio en JIRA (comentarios o estados).
