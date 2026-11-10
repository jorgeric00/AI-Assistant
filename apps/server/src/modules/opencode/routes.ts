import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AiSettingsUpdate, ChatPermissionReplyInput, ChatSendInput, JiraKey } from '@dev-assistant/shared';
import type { AiOptionsService, AiSettingsStore } from './ai-settings.js';
import type { TaskChatService } from './chat.js';

const KeyParams = z.object({ key: JiraKey });
const PermissionParams = KeyParams.extend({ id: z.string().min(1).max(200) });
const OptionsQuery = z.object({ refresh: z.enum(['1']).optional() });

/** Modelos y modos de opencode (Ajustes) y el chat de cada tarea con opencode. */
export async function opencodeAiRoutes(
  app: FastifyInstance,
  { aiSettings, aiOptions, chat }: { aiSettings: AiSettingsStore; aiOptions: AiOptionsService; chat: TaskChatService },
) {
  app.get('/api/ai/options', async (req) => aiOptions.options(OptionsQuery.parse(req.query).refresh === '1'));
  app.get('/api/ai/settings', async () => aiSettings.get());
  app.put('/api/ai/settings', async (req) => aiSettings.update(AiSettingsUpdate.parse(req.body)));

  app.get('/api/tasks/:key/chat', async (req) => chat.get(KeyParams.parse(req.params).key));
  app.post('/api/tasks/:key/chat/messages', async (req) => chat.send(KeyParams.parse(req.params).key, ChatSendInput.parse(req.body)));
  app.post('/api/tasks/:key/chat/abort', async (req) => chat.abort(KeyParams.parse(req.params).key));
  app.post('/api/tasks/:key/chat/reset', async (req) => chat.reset(KeyParams.parse(req.params).key));
  app.post('/api/tasks/:key/chat/permissions/:id', async (req) => {
    const { key, id } = PermissionParams.parse(req.params);
    return chat.replyPermission(key, id, ChatPermissionReplyInput.parse(req.body).reply);
  });
}
