---
name: dev-assistant-tarea
description: Forma de trabajar en una tarea de JIRA lanzada desde AI-Assistant. Úsala siempre que desarrolles una tarea con clave de JIRA (p. ej. ABC-123) o analices una incidencia: ramas, plan, commits, push, PR, JIRA, PLAN.md e HISTORIAL.md.
---

# Desarrollo de una tarea de JIRA con AI-Assistant

AI-Assistant es la app local del usuario para seguir sus tareas de JIRA. Lee dos ficheros que mantienes tú
para mostrar en qué fase está la tarea y qué cambios se han hecho. Sigue este flujo en todas las tareas,
en este orden, y para en cada punto marcado con **Pregunta al usuario** hasta que responda.

## Reglas que nunca se rompen

- **Nunca** hagas `git push` sin preguntar al usuario y sin que el código esté validado (tests y comprobaciones en verde).
- **Nunca** hagas un commit sin que el usuario lo confirme.
- **Nunca** pases una PR a "ready for review" sin que el usuario haya validado el trabajo y lo confirme.
- **Nunca** mergees una PR.
- **Nunca** hagas push directo a la rama base (`main`, `develop`...), ni `push --force`, ni reescribas historia ya subida
  (nada de `rebase`, `commit --amend` ni `reset` sobre commits subidos).
- **Nunca** incluyas en un commit `PLAN.md`, `HISTORIAL.md`, ficheros `.env`, tokens ni contraseñas.
- Si la rama base avanza y al traerla hay conflictos, **pregunta al usuario** antes de mezclar.
- En JIRA solo haces lo que dice este flujo: pasar a "In Progress" al crear la rama y, tras la validación,
  a "In Review" con un comentario que el usuario haya visto y validado antes (o, en un análisis, el comentario con el origen si el usuario lo confirma).
  Nada más sin que el usuario lo pida.
- Contesta **siempre** al usuario en el idioma del sistema: el que indica `TAREA.md` en «Idioma del usuario» o, si no
  lo indica, el del sistema operativo (configuración regional, `LANG`). Aunque el ticket, el código o esta skill
  estén en otro idioma. Los commits, las PR y los comentarios de JIRA siguen el formato que se indica abajo.

## Carpeta de la tarea

Cada tarea tiene una carpeta fuera de los repositorios de la empresa:

```
~/.dev-assistant/worktrees/<CLAVE>/
  PLAN.md         ← el plan de desarrollo (lo escribes tú)
  HISTORIAL.md    ← una línea por cada cambio subido (la añades tú)
  TAREA.md        ← contexto que deja AI-Assistant al abrir la sesión (no lo edites)
  AGENTS.md       ← lo deja AI-Assistant (no lo edites)
  adjuntos/       ← los adjuntos del ticket (logs, reportes...), descargados por AI-Assistant
  RESUMEN.md      ← la documentación de la tarea, al cerrarla (la escribes tú)
```

`<CLAVE>` es la clave de JIRA en mayúsculas (p. ej. `SGARFIDIN-1024`). En Windows, `~` es la carpeta del usuario
(`C:\Users\<usuario>`). Crea la carpeta si no existe. El código se trabaja en el **clon de siempre** de cada
repositorio, en la ruta que indica AI-Assistant (o el usuario); esta carpeta guarda el plan, el historial y la documentación de la tarea.

`TAREA.md` trae el ticket (título, descripción y comentarios), la lista de adjuntos descargados en `adjuntos/`, los
repositorios dados de alta en AI-Assistant (nombre, ruta local, rama base y repo de GitHub) y la ficha de cada uno
(convenciones, comandos de tests y arquitectura). Léelo antes de empezar y sigue esas fichas.

## ¿Desarrollo o solo análisis?

Algunas tareas son incidencias que no piden cambiar código: hay que analizar logs, reportes o datos que dejan los
usuarios en el ticket y encontrar el origen. Sigue el **flujo de solo análisis** (abajo) cuando el usuario lo pida (el
mensaje de inicio dice «flujo de solo análisis») o cuando, siendo una incidencia, te diga que solo hay que analizarla.
En cualquier otro caso, sigue el flujo de desarrollo (secciones 1 a 4). Si no está claro, **pregunta al usuario**.

## 1. Arranque

1. Lee el ticket en `TAREA.md` (y los adjuntos de `adjuntos/` si hacen falta); si tienes el MCP de JIRA, úsalo
   para lo que falte: resumen, descripción, comentarios, criterios de aceptación y tipo de incidencia.
   Si el ticket no tiene descripción (o solo repite el título) y el usuario aún no te ha dicho qué hay que hacer
   (en esta conversación o en `PLAN.md`), **pregunta al usuario** qué se debe hacer antes de seguir. No te lo inventes.
2. Propón qué repositorios toca la tarea (empieza por los de `TAREA.md`), con su ruta local y su rama base.
   **Pregunta al usuario** si son esos.
3. Analiza el ticket y el código afectado. Si el repo tiene `AGENTS.md`, `CONTRIBUTING.md` o similar, síguelos.
4. Escribe `PLAN.md` con el formato de abajo. **Pregunta al usuario** si aprueba el plan. No toques código hasta que lo apruebe.
   Si pide cambios, edita el plan y vuelve a preguntar.

## 2. Rama

5. En cada repositorio de la tarea, antes de crear la rama:
   - Si `git status` muestra cambios sin guardar, avisa al usuario y no sigas en ese repo hasta que los guarde o aparque.
   - Cámbiate a la rama base y actualízala con `git pull`.
6. Crea la rama con `git switch -c <tipo>/<CLAVE>-<explicacion-breve>`:
   - `<tipo>` es `bugfix` si la incidencia de JIRA es de tipo Bug, y `feature` en cualquier otro caso.
   - `<explicacion-breve>`: pocas palabras, en minúsculas, sin tildes ni eñes, separadas por guiones.
   - El nombre completo tiene **menos de 64 caracteres**. Ejemplo: `feature/SGARFIDIN-1024-security`.
   - Usa la misma rama en todos los repositorios de la tarea. Si ya existe (tarea retomada), cámbiate a ella.
7. Si la tarea no está ya en "In Progress", pásala con el MCP de JIRA (consulta antes sus transiciones y usa la
   que lleve a "In Progress"). Si no existe esa transición, díselo al usuario y sigue.

## 3. Desarrollo: un ciclo por cada paso del plan

8. Implementa el paso en la rama.
9. Escribe o ajusta los tests del paso.
   Si la tarea cambia una librería de la que depende otro repositorio de la tarea, enlázala con la versión
   SNAPSHOT que ya tiene la librería en su rama base (la de su `pom.xml` o `build.gradle`). Por ejemplo, si
   `lib-wmsrfidcommons` está en `6.21.0-SNAPSHOT` (última release `6.20.0`), `lib-wmsrfid` debe usar `6.21.0-SNAPSHOT`.
   No inventes versiones (nada de `6.26.0+PR583-SNAPSHOT`) ni cambies la versión de la librería. Si no está claro
   cuál toca, **pregunta al usuario**.
10. Comprobaciones locales: ejecuta los tests, el formateador y el linter del repo, y revisa que el cambio no
    incluya secretos. Si algo falla, corrígelo y vuelve a probar. Si tras dos intentos sigue fallando,
    para y explica al usuario qué falla.
11. **Pregunta al usuario** si hace el commit: enséñale los ficheros cambiados y el mensaje propuesto,
    con el mismo formato que el título de la PR: `[<CLAVE>] <explicación breve en español>`
    (p. ej. `[SGARFIDIN-1024] Revisar dependencias vulnerables`).
    Haz el commit solo cuando lo confirme.
12. Marca el paso como hecho en `PLAN.md`.
13. **Pregunta al usuario** si hace push, con un resumen de lo que se sube. Haz `git push` (con `-u origin <rama>`
    la primera vez) solo cuando lo confirme.
14. Solo tras el **primer** push de la rama en ese repo, crea la PR **en borrador** con el MCP de GitHub:
    - Contra la rama base.
    - Título `[<CLAVE>] <explicación más extensa>`. Ejemplo: `[SGARFIDIN-1024] Revisión de vulnerabilidades`.
    - Descripción: la plantilla de PR del repo si existe (`.github/pull_request_template.md` o similar);
      si no, qué cambia y por qué. Incluye siempre el enlace al ticket de JIRA y un resumen del plan.
    - Añade su enlace a la cabecera de `PLAN.md` en una línea `PR: <url>`.
    - En los siguientes ciclos no crees otra PR: el push ya la actualiza.
15. Comprueba los checks de la PR en GitHub (tests, formato, secretos...). Si alguno falla, corrígelo y vuelve al paso 10.
16. Añade la línea del cambio al final de `HISTORIAL.md` (formato abajo).

## 4. Cierre

17. Con todos los pasos del plan hechos y los checks de todas las PR en verde, **pide al usuario que valide**
    el trabajo, con el enlace a cada PR.
18. Si lo valida, **pregunta al usuario** si pasas las PR a "ready for review". Cuando lo confirme:
    - Pasa cada PR a "ready for review" con el MCP de GitHub.
    - En JIRA, pasa la tarea a "In Review" y añade un comentario corto con el enlace a cada PR y un resumen de **lo que
      se ha hecho y solo eso**: 2 a 5 líneas o viñetas, sin contexto, sin pruebas ni decisiones ni lo que quedó fuera.
      Si la tarea es una incidencia y hubo un análisis previo (tiene `Tipo: análisis` en `PLAN.md`, o secciones de
      análisis o una línea de análisis en `HISTORIAL.md`), añade antes un párrafo de 1 a 3 líneas con lo que se vio
      en el análisis (la causa) para que se entienda por qué se hizo el cambio. El comentario nunca copia ni
      reproduce `RESUMEN.md`: es mucho más corto, ese fichero es la documentación completa.
      **Antes de publicarlo, enséñale el texto exacto del comentario al usuario y espera a que lo valide** (o lo
      corrija). Sin su visto bueno no lo subas a JIRA; publícalo junto con el paso a "In Review".
    - Marca en `PLAN.md` el paso «PR en "ready for review" y JIRA en "In Review"» (y el de la validación del usuario si seguía sin marcar).
19. Escribe `RESUMEN.md` en la carpeta de la tarea con el formato de abajo: es la documentación de la tarea
    que AI-Assistant enseña en "Documentación". Si ya existe (la tarea se retomó), actualízalo entero.
20. Ahí termina tu trabajo: la revisión y el merge son de las personas.

## Flujo de solo análisis (incidencias)

Aquí **no se toca código**: nada de ramas, cambios en ficheros de los repos, commits, push ni PR. Puedes leer código
y ejecutar comandos que no cambian nada (buscar, `git log`, abrir logs, consultas de solo lectura).

A1. Lee el ticket en `TAREA.md` (descripción y comentarios) y los adjuntos de `adjuntos/`. Si faltan datos para
    analizarla (logs, fechas, ejemplos), **pregunta al usuario**.
A2. Escribe `PLAN.md` con el formato de análisis de abajo (cabecera `Tipo: análisis`).
A3. Investiga: cruza los logs y reportes con el código y la configuración de los repos de `TAREA.md`.
    Marca cada paso del plan en cuanto lo termines.
A4. Presenta al usuario el **origen**: qué pasa, desde cuándo y a quién afecta, las evidencias (líneas de log,
    `fichero:línea`, datos) y si hace falta un arreglo en el código o no. **Pregunta al usuario** si valida el
    análisis. Si no lo valida, sigue investigando con lo que te diga y vuelve a preguntar.
A5. Cuando lo valide:
    - Añade al final de `HISTORIAL.md` una línea de análisis (formato abajo): AI-Assistant la apunta en el diario.
    - Escribe `RESUMEN.md` con el formato de análisis de abajo.
    - Marca los pasos que queden en `PLAN.md`.
A6. **Pregunta al usuario** si deja en JIRA un comentario con el origen y la conclusión. Hazlo solo si lo confirma,
    y no cambies el estado del ticket salvo que te lo pida.
A7. Si hace falta un arreglo, **pregunta al usuario** si pasáis a desarrollo. Si dice que sí: en `PLAN.md` cambia la
    cabecera a `Tipo: desarrollo`, deja las secciones del análisis como están y añade debajo las del desarrollo
    (`Plan aprobado`, `Implementación`, `Pruebas y PR`). Sigue desde el paso 2 de «1. Arranque» con el flujo normal.
    Al cerrar el desarrollo, amplía `RESUMEN.md` con lo que se hizo.

### Formato de PLAN.md para un análisis

```markdown
# <CLAVE> · <resumen del ticket>

Tipo: análisis
Repos: <repo>, <otro repo>

## Ticket y adjuntos
- [x] Leer el ticket, los comentarios y los adjuntos

## Origen
- [ ] Paso concreto de la investigación (p. ej. buscar el error del log en <repo>)
- [ ] Origen encontrado

## Validación
- [ ] El usuario valida el análisis

## Resumen y diario
- [ ] RESUMEN.md y línea en HISTORIAL.md
```

### Formato de RESUMEN.md para un análisis

```markdown
# <CLAVE> · <resumen del ticket>

Fecha: <AAAA-MM-DD> · Tipo: análisis · Repos: <repo>

## Qué se reportó
Lo que dicen el ticket y los usuarios, en una o dos frases.

## Qué se analizó
- Logs, reportes, código y datos revisados.

## Origen
Qué pasa y por qué, con las evidencias (líneas de log, `fichero:línea`).

## Conclusión
- Si hace falta un arreglo o no, y el siguiente paso (desarrollo, configuración, respuesta al usuario...).
```

## Cuando el usuario pide cambios

El usuario puede hablarte en cualquier momento de la sesión para corregir el rumbo. Atiende lo que pida antes de seguir con el plan.

- **El plan, antes de aprobarlo:** edita `PLAN.md` y vuelve a pedir la aprobación, tantas veces como haga falta.
- **El plan, ya aprobado:** para lo que estés haciendo, edita `PLAN.md` (añade, quita o cambia pasos; los pasos hechos se
  quedan marcados) y enséñale qué ha cambiado. **Pregunta al usuario** si aprueba el plan nuevo; no sigas hasta que lo apruebe.
- **Un cambio que no le gusta y aún no tiene commit:** rehazlo como pida y vuelve a enseñárselo antes de preguntar por el commit.
- **Un cambio que ya tiene commit, sin push:** corrígelo con un commit nuevo. Si el usuario lo pide expresamente, puedes
  rehacer ese commit local (`git commit --amend` o `git reset --soft`), porque aún no está subido.
- **Un cambio ya subido:** corrígelo siempre con un commit nuevo, con su línea en `HISTORIAL.md`. Nunca reescribas
  historia ya subida ni uses `push --force`.
- Si el cambio afecta al alcance de la tarea, avisa al usuario por si quiere comentarlo en JIRA (él decide; no lo hagas tú).

## Formato de PLAN.md

```markdown
# <CLAVE> · <resumen del ticket>

Rama: feature/<CLAVE>-<explicacion-breve>
Repos: <repo>, <otro repo>
PR: https://github.com/<owner>/<repo>/pull/<número>

## Análisis
- [x] Leer el ticket y los criterios de aceptación
- [x] Revisar el código afectado en <repo>

## Plan aprobado
- [ ] El usuario aprueba el plan

## Implementación · <repo>
- [ ] Paso concreto y verificable
- [ ] Otro paso

## Pruebas y PR
- [ ] Checks de la PR en verde
- [ ] El usuario valida el trabajo
- [ ] PR en "ready for review" y JIRA en "In Review"
```

Reglas del plan:
- La cabecera la lee AI-Assistant: `Rama:` con el nombre exacto de la rama; `Repos:` con los nombres tal como
  aparecen en `TAREA.md`, separados por comas; y una línea `PR:` por cada PR, en cuanto la crees.
- Las fases van en este orden: `Análisis`, `Plan aprobado`, `Implementación`, `Pruebas y PR`.
- Si la tarea toca varios repositorios, usa una sección `## Implementación · <repo>` por repositorio.
- Cada paso es una casilla `- [ ]` en una sola línea, corto y verificable. Cada paso de implementación acaba en un commit.
- Marca cada paso con `- [x]` en cuanto lo termines, sin esperar al final. Si el plan cambia, edítalo.

## Formato de RESUMEN.md

Documentación para quien lea la tarea dentro de meses (incluido el usuario): qué se hizo y por qué, no un diario.
En español, en Markdown, con estas secciones en este orden (omite una solo si de verdad no aplica):

```markdown
# <CLAVE> · <resumen del ticket>

Fecha: <AAAA-MM-DD> · Rama: <rama> · Repos: <repo>, <otro repo>

## Qué se pidió
Una o dos frases con el objetivo del ticket.

## Qué se hizo
- Cambios principales, por repositorio.

## Decisiones
- Decisiones de diseño y alternativas descartadas, con el motivo.

## Cómo probarlo
- Comandos de test y pasos manuales para comprobarlo.

## PR y commits
- <repo>: [PR #<n>](<url>)
- Commits principales con su enlace (los de HISTORIAL.md).

## Pendiente
- Lo que queda fuera o para otra tarea, si hay algo.
```

## Formato de HISTORIAL.md

Una línea por cada commit subido, añadida justo después del push (créalo si no existe):

```
- <AAAA-MM-DD HH:MM> | <repo> | <hash corto> | <URL del commit en GitHub> | <explicación breve>
```

Ejemplo:

```
- 2026-10-06 12:31 | orders-api | 4f2a9c1 | https://github.com/empresa/orders-api/commit/4f2a9c1 | Tests del servicio de exportación a CSV
```

La URL es `https://github.com/<owner>/<repo>/commit/<hash>`. Usa la hora local. Sin borrar ni reordenar las líneas anteriores.

El análisis validado de una incidencia (sin commit) va con `análisis` en lugar del repo y `-` en el hash y la URL:

```
- 2026-11-11 12:58 | análisis | - | - | Timeout de lectura corto para más de 400 etiquetas en la tienda 0412
```
