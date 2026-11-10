// Textos del servidor en castellano (idioma por defecto). Cada clave debe existir también en en.ts.
// Las variables van entre llaves: {{name}}.
export const es = {
  // Comunes
  'common.unknown': 'desconocido',
  'common.routeNotFound': 'Ruta no encontrada',

  // Validación: mensajes propios de los esquemas de @dev-assistant/shared (se traducen al responder)
  'validation.jiraKey': 'Clave de JIRA no válida (ej.: ABC-123)',
  'validation.titleRequired': 'El título es obligatorio',
  'validation.pickADay': 'Elige al menos un día',
  'validation.reminderTitleRequired': 'Escribe qué quieres recordar',
  'validation.commentEmpty': 'El comentario está vacío',
  'validation.projectKey': 'Clave de proyecto de JIRA no válida (ej.: ABC)',
  'validation.githubRepo': 'El repo de GitHub debe ser dueño/nombre',

  // IA (opencode): instrucción de idioma, errores y textos de los prompts que se ven en la respuesta
  'ai.answerLanguage': 'Responde en castellano.',
  'ai.notConfigured': 'La IA no está configurada.',
  'ai.connectFailed': 'No se puede conectar con opencode en {{url}} ({{detail}}).',
  'ai.startFailed': 'No se pudo arrancar opencode ({{detail}}). Comprueba que el comando "opencode" funciona en una terminal.',
  'ai.modelError': 'El modelo devolvió un error: {{message}}',
  'ai.emptyAnswer': 'El modelo no devolvió ninguna respuesta.',
  'ai.opencodeFailed': 'Fallo al hablar con opencode: {{message}}',
  'chat.aborted': 'Parado.',
  'ai.ask.noMatches': 'No he encontrado nada en la app relacionado con la pregunta.',
  'ai.ask.notInNotes': 'No lo tengo en la app',
  'ai.daily.nothingToSummarize': 'No hay entradas en el diario desde el último día laborable ni recordatorios para hoy. Apunta qué hiciste y vuelve a generarlo.',
  'ai.daily.yesterday': 'Ayer',
  'ai.daily.today': 'Hoy',
  'ai.daily.blockers': 'Bloqueos',
  'ai.daily.nothing': 'Nada',
  'ai.repoProfile.conventions': 'Convenciones',
  'ai.repoProfile.tests': 'Tests',
  'ai.repoProfile.architecture': 'Arquitectura',
  'ai.repoProfile.noData': 'Sin datos',

  // JIRA (API REST, sincronización y "Actualizar JIRA")
  'jira.notConfigured': 'JIRA no está configurado: añade JIRA_URL y JIRA_TOKEN al fichero .env.',
  'jira.connectFailed': 'No se pudo conectar con JIRA en {{url}}: {{cause}}',
  'jira.loginRedirect': 'JIRA redirige a una página de inicio de sesión{{host}}: desde esta red la API no acepta el token. Prueba desde la red de la empresa o con la VPN.',
  'jira.unauthorized': 'JIRA rechazó las credenciales (401). Revisa JIRA_TOKEN (y JIRA_EMAIL si es JIRA Cloud).',
  'jira.forbidden': 'JIRA no da permiso a este token (403).',
  'jira.httpError': 'JIRA respondió {{status}}',
  'jira.notJson': 'JIRA no devolvió datos de la API (respondió una página web). ¿Es correcta JIRA_URL? ({{url}})',
  'jira.apiNotFound': 'JIRA no encontró la API en {{url}}/rest/api. Revisa JIRA_URL: debe ser la parte de la dirección de una tarea anterior a /browse/.',
  'jira.issueNotVisible': 'JIRA no encuentra {{key}} o este token no puede verla.',
  'jira.cannotComment': 'JIRA no encuentra {{key}} o este token no puede comentar en ella.',
  'jira.cannotTransition': 'JIRA no encuentra {{key}} o este token no puede cambiar su estado.',
  'jira.taskNotInApp': 'La tarea {{key}} no está en la app.',
  'jira.transitionGone': 'JIRA ya no permite ese cambio de estado desde "{{status}}". Cierra el diálogo y vuelve a abrirlo.',
  'jira.commentAddedTransitionFailed': 'Se añadió el comentario, pero no se pudo cambiar el estado: {{message}}',
  'jira.draft.nothingNew': 'No hay notas, entradas del diario ni commits nuevos de {{key}} desde el último envío a JIRA. Escribe el comentario tú o apunta antes qué has hecho.',
  'jira.draft.nothing': 'No hay notas, entradas del diario ni cambios de opencode de {{key}} con los que redactar el comentario. Escríbelo tú o apunta antes qué has hecho.',
  'jira.changelog.comment': 'Comentario en JIRA',
  'jira.changelog.transition': 'Estado {{from}} → {{to}}',
  'jira.create.noUser': 'JIRA no dice qué usuario es el del token: no se puede asignar la tarea.',
  'jira.create.projectNotVisible': 'JIRA no encuentra el proyecto {{project}} o este token no puede crear tareas en él.',
  'jira.create.noKey': 'JIRA no devolvió la clave de la tarea creada.',
  'jira.create.sprintNotFound': 'JIRA no encuentra ese sprint.',
  'jira.create.epicNotFound': 'JIRA no encuentra la épica {{epic}}.',
  'jira.create.notANumber': '"{{field}}" debe ser un número.',
  'jira.create.missingFields': 'Faltan campos obligatorios: {{fields}}.',
  'jira.create.epicFailed': 'No se pudo añadir a la épica {{epic}}: {{message}}',
  'jira.create.sprintFailed': 'No se pudo añadir al sprint: {{message}}',

  // GitHub (API GraphQL)
  'github.notConfigured': 'GitHub no está configurado: añade GITHUB_TOKEN al fichero .env.',
  'github.connectFailed': 'No se pudo conectar con GitHub: {{cause}}',
  'github.unauthorized': 'GitHub rechazó el token (401). Revisa GITHUB_TOKEN.',
  'github.httpError': 'GitHub respondió {{status}}',
  'github.ssoNotAuthorized': 'El token no está autorizado para el SSO de la organización. En GitHub: Settings > Developer settings > tokens > Configure SSO > Authorize.',
  'github.graphqlError': 'GitHub devolvió un error: {{message}}',
  'github.emptyResponse': 'respuesta vacía',
  'github.ssoWarning': 'Hay PR de una organización con SSO que el token no puede ver. En GitHub: Settings > Developer settings > tokens > Configure SSO > Authorize.',

  // Avisos de tus PR (se guardan en la base de datos y salen como notificación)
  'prs.alert.ciFailed': 'CI en rojo',
  'prs.alert.failing': 'Falla {{checks}}',
  'prs.alert.changesRequested': 'Cambios pedidos',
  'prs.alert.approved': 'Aprobada',
  'prs.alert.merged': 'Mergeada',
  'prs.alert.by': 'Por {{people}}',
  'prs.alert.commentsOne': '1 comentario nuevo',
  'prs.alert.commentsOther': '{{count}} comentarios nuevos',
  'prs.alert.from': 'De {{people}}',

  // Recordatorios (notificación del sistema)
  'reminders.notFound': 'Recordatorio no encontrado',
  'reminders.alertNotFound': 'Aviso no encontrado',
  'reminders.notification': 'Recordatorio',
  'reminders.notificationLate': 'Recordatorio atrasado',

  // Diario (entradas automáticas)
  'journal.entryNotFound': 'Entrada no encontrada',
  'journal.statusChange': 'Estado en JIRA: {{from}} → {{to}}',
  'journal.commit': 'Commit en {{repo}}: {{text}}',

  // Notas
  'notes.notFound': 'Nota no encontrada',

  // Tareas
  'tasks.notFound': 'Tarea no encontrada',
  'tasks.noSummary': '{{key}} aún no tiene resumen',

  // Repositorios
  'repos.notFound': 'Repositorio no encontrado',
  'repos.notGitRepo': '{{path}} no es un repositorio git (o no existe).',
  'repos.pathMissing': 'No se encuentra el repositorio en {{path}}.',
  'repos.nameTaken': 'Ya hay un repositorio llamado {{name}}.',
  'repos.inUse': 'Este repositorio se usa en sesiones de desarrollo y no se puede quitar.',

  // Sistema (copias de seguridad)
  'backups.noDatabase': 'No hay base de datos que copiar.',
} as const;
