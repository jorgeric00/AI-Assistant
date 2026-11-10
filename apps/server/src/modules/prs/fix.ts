// "Arreglar con opencode": los fallos de los checks de una PR, tal como los publica GitHub, se le pasan a
// opencode. Si la PR es de una tarea, a la sesión de esa tarea (que conoce sus repos); si no, a una
// conversación nueva del chat general.
import type { PrCheckFailure, PrFailures, PrFixResult } from '@dev-assistant/shared';
import { t } from '../../i18n/index.js';
import type { TaskChatService } from '../opencode/chat.js';
import type { GeneralChatService } from '../opencode/general-chat.js';
import type { PrWatcher } from './watcher.js';

export class PrFixError extends Error {}

function describe(failure: PrCheckFailure): string {
  const lines = [`### ${failure.name}`];
  if (failure.title) lines.push(failure.title);
  if (failure.summary) lines.push('', failure.summary);
  if (failure.annotations.length) {
    lines.push('');
    for (const a of failure.annotations) lines.push(`- ${a.path}${a.line ? `:${a.line}` : ''}: ${[a.title, a.message].filter(Boolean).join(' · ')}`);
    const more = failure.annotationsTotal - failure.annotations.length;
    if (more > 0) lines.push(`- ${t('prs.fix.more', { count: more })}`);
  }
  if (failure.url) lines.push('', failure.url);
  return lines.join('\n');
}

/** El mensaje para opencode con todos los fallos. */
export function fixPrompt(pr: PrFailures, branch: string, withTask: boolean): string {
  return [
    t('prs.fix.intro', { repo: pr.repo, number: pr.number, url: pr.url, branch }),
    ...pr.failures.map(describe),
    withTask ? t('prs.fix.outro', { branch }) : `${t('prs.fix.outro', { branch })} ${t('prs.fix.whereRepo')}`,
  ].join('\n\n');
}

export class PrFixService {
  constructor(
    private readonly prWatcher: PrWatcher,
    private readonly taskChat: TaskChatService,
    private readonly generalChat: GeneralChatService,
  ) {}

  /** null si la PR no es una de las tuyas. */
  async fix(prId: string): Promise<PrFixResult | null> {
    const pr = this.prWatcher.pr(prId);
    const failures = pr && (await this.prWatcher.failures(prId));
    if (!pr || !failures) return null;
    if (!failures.failures.length) throw new PrFixError(t('prs.fix.noFailures'));
    if (pr.taskKey) {
      await this.taskChat.send(pr.taskKey, { text: fixPrompt(failures, pr.headRef, true) });
      return { target: 'task', taskKey: pr.taskKey };
    }
    const chat = await this.generalChat.start({ text: fixPrompt(failures, pr.headRef, false) });
    return { target: 'chat', conversationId: chat.id! };
  }
}
