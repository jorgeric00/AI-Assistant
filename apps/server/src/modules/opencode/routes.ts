import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AiSettingsUpdate, ChatPermissionReplyInput, ChatQuestionReplyInput, ChatSendInput, ConversationId, JiraKey } from '@dev-assistant/shared';
import { t } from '../../i18n/index.js';
import type { AiOptionsService, AiSettingsStore } from './ai-settings.js';
import type { TaskChatService } from './chat.js';
import type { GeneralChatService } from './general-chat.js';
import type { McpService } from './mcp.js';

const KeyParams = z.object({ key: JiraKey });
const PermissionParams = KeyParams.extend({ id: z.string().min(1).max(200) });
const ChatParams = z.object({ id: ConversationId });
const ChatPermissionParams = ChatParams.extend({ permissionId: z.string().min(1).max(200) });
const ChatQuestionParams = ChatParams.extend({ questionId: z.string().min(1).max(200) });
const OptionsQuery = z.object({ refresh: z.enum(['1']).optional() });

/** Modelos y modos de opencode (Ajustes), el chat de cada tarea con opencode y el chat general. */
export async function opencodeAiRoutes(
  app: FastifyInstance,
  { aiSettings, aiOptions, chat, general, mcp }: { aiSettings: AiSettingsStore; aiOptions: AiOptionsService; chat: TaskChatService; general: GeneralChatService; mcp: McpService },
) {
  app.get('/api/ai/options', async (req) => aiOptions.options(OptionsQuery.parse(req.query).refresh === '1'));
  app.get('/api/ai/settings', async () => aiSettings.get());
  app.get('/api/ai/mcp', async () => mcp.overview());
  app.put('/api/ai/settings', async (req) => aiSettings.update(AiSettingsUpdate.parse(req.body)));

  app.get('/api/tasks/:key/chat', async (req) => chat.get(KeyParams.parse(req.params).key));
  app.post('/api/tasks/:key/chat/messages', async (req) => chat.send(KeyParams.parse(req.params).key, ChatSendInput.parse(req.body)));
  app.post('/api/tasks/:key/chat/abort', async (req) => chat.abort(KeyParams.parse(req.params).key));
  app.post('/api/tasks/:key/chat/reset', async (req) => chat.reset(KeyParams.parse(req.params).key));
  app.post('/api/tasks/:key/chat/permissions/:id', async (req) => {
    const { key, id } = PermissionParams.parse(req.params);
    return chat.replyPermission(key, id, ChatPermissionReplyInput.parse(req.body).reply);
  });
  app.post('/api/tasks/:key/chat/questions/:id', async (req) => {
    const { key, id } = PermissionParams.parse(req.params);
    return chat.replyQuestion(key, id, ChatQuestionReplyInput.parse(req.body));
  });

  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: t('chat.general.notFound') });
  app.get('/api/chats', async () => general.list());
  app.get('/api/chats/new', async () => general.empty());
  app.post('/api/chats', async (req) => general.start(ChatSendInput.parse(req.body)));
  app.get('/api/chats/:id', async (req, reply) => (await general.get(ChatParams.parse(req.params).id)) ?? notFound(reply));
  app.post('/api/chats/:id/messages', async (req, reply) => (await general.send(ChatParams.parse(req.params).id, ChatSendInput.parse(req.body))) ?? notFound(reply));
  app.post('/api/chats/:id/abort', async (req, reply) => (await general.abort(ChatParams.parse(req.params).id)) ?? notFound(reply));
  app.post('/api/chats/:id/permissions/:permissionId', async (req, reply) => {
    const { id, permissionId } = ChatPermissionParams.parse(req.params);
    return (await general.replyPermission(id, permissionId, ChatPermissionReplyInput.parse(req.body).reply)) ?? notFound(reply);
  });
  app.post('/api/chats/:id/questions/:questionId', async (req, reply) => {
    const { id, questionId } = ChatQuestionParams.parse(req.params);
    return (await general.replyQuestion(id, questionId, ChatQuestionReplyInput.parse(req.body))) ?? notFound(reply);
  });
  app.delete('/api/chats/:id', async (req, reply) => ((await general.delete(ChatParams.parse(req.params).id)) ? reply.code(204).send() : notFound(reply)));
}
