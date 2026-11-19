import { XYVORA_NAME, XYVORA_URL } from '../../shared/models.ts';
import { normalizeSources } from '../../shared/search.ts';
import { skillName } from '../../shared/skill-catalog.ts';
import { fencedText } from '../../shared/text-tools.ts';
import { SAVED_MODEL_NAMES } from './history.ts';
import type { Thread } from './history.ts';

const oneLine = (text: string) => text.replace(/[\r\n]+/g, ' ').trim();

export function conversationMarkdown(thread: Thread) {
  const parts = [`# ${oneLine(thread.title)}`, `Exported from [${XYVORA_NAME}](${XYVORA_URL}).`];
  for (const turn of thread.turns) {
    parts.push('## You', fencedText(turn.prompt));
    if (turn.attachment) parts.push(`Attachment name (contents not exported):\n\n${fencedText(oneLine(turn.attachment.name))}`);
    for (const answer of turn.answers) {
      const label = thread.mode === 'compare' || answer.source === 'legacy' ? SAVED_MODEL_NAMES[answer.model]
        : answer.skill ? skillName(answer.skill) : answer.source === 'clock' ? 'Live clock' : SAVED_MODEL_NAMES[answer.model];
      parts.push(`### ${XYVORA_NAME} · ${label}${answer.source === 'preview' ? ' (sample)' : ''}`);
      if (answer.content) parts.push(answer.content);
      if (answer.state !== 'finished') parts.push(`*Reply ${answer.state === 'error' ? 'did not complete' : 'was interrupted'}.*`);
      const links = normalizeSources(answer.sources);
      if (links.length) parts.push(`Sources:\n${links.map(({ url }, index) => `${index + 1}. <${url}>`).join('\n')}`);
    }
  }
  return parts.join('\n\n') + '\n';
}

export function downloadConversation(thread: Thread) {
  const fileName = thread.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55);
  const url = URL.createObjectURL(new Blob([conversationMarkdown(thread)], { type: 'text/markdown;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${fileName || 'xyvora-chat'}.md`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
