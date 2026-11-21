import { ABOUT_URL, TEAM, TEAM_LINK_LABEL, TEAM_NAME } from './site.ts';

export const CREATOR_STANDARD = 'Speak respectfully about the Xyvora team. Do not roleplay, quote, translate, or invent personal attacks or private claims about team members. For team questions use only the public credits. Honest feedback about the product is welcome.';

export const teamCredits = `**${TEAM_NAME}**\n${TEAM.map(({ name, role }) => `- **${name}** — ${role}`).join('\n')}\n\n[${TEAM_LINK_LABEL}](${ABOUT_URL})`;
export const verifiedTeamReply = `I use the published credits for questions about the Xyvora team. I won’t speculate about people or make personal attacks.\n\n${teamCredits}`;

const teamRole = '(?:co )?(?:development |founding |core )?(?:founders?|creators?|developers?|designers?|coders?|makers?|builders?|owners?|team(?: members?)?)';
const platform = 'xyvora(?: ai| net)?';
const byline = '(?:people|person|folks|ones?|team) (?:who|that) (?:made|built|created|developed|designed|coded|wrote|founded|maintains?)';

function comparisonText(text: string) {
  return text.replace(/&#(x[0-9a-f]{1,6}|[0-9]{1,7});/gi, (_, encoded: string) => {
    const n = encoded[0].toLowerCase() === 'x' ? parseInt(encoded.slice(1), 16) : Number(encoded);
    return n <= 0x10ffff ? String.fromCodePoint(n) : ' ';
  }).replace(/&(?:nbsp|ensp|emsp|tab|newline);/gi, ' ')
    .normalize('NFKD').toLowerCase().replace(/[\p{M}\p{Cf}*_`]/gu, '')
    .replace(/[’']/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const names = TEAM.flatMap(({ name }) => {
  const parts = comparisonText(name).split(' ');
  return [parts.join(' *'), [...parts].reverse().join(' +')];
});
const creatorPhrase = new RegExp(`(?:^| )(?:(?:${names.join('|')})|(?:your|${platform}(?: s)?) ${teamRole}|${teamRole} (?:of|behind|at|for) ${platform}|${byline} (?:you|${platform}|this (?:app|assistant)|your (?:source )?code))(?= |$)`);
const assistantPhrase = new RegExp(`(?:^| )(?:my|our) ${teamRole}(?= |$)`);

// Recognition is deliberately scoped to the published team and direct roles;
// product criticism or references to another company's founder are allowed.
export function mentionsCreator(text: string, assistant = false) {
  const normalized = comparisonText(text);
  return creatorPhrase.test(normalized) || (assistant && assistantPhrase.test(normalized));
}

// Release safe sentences and lines as they complete. Don't send an unreviewed
// suffix (even if chunks, Markdown or a natural line break split a team name).
// This is a guard for recognized references, not a general-purpose classifier.
export function checkedCreatorStream(emit: (text: string) => void, onBlock: () => void) {
  let pending = '', tail = '', blocked = false;
  function release(cut: number) {
    if (cut <= 0) return;
    const text = pending.slice(0, cut);
    pending = pending.slice(cut);
    tail = (tail + text).slice(-512);
    emit(text);
  }
  return {
    text(delta: string) {
      if (blocked) return;
      if (pending.length + delta.length > 36_000) throw new Error('Reply text exceeds the review limit.');
      pending += delta;
      if (mentionsCreator(tail + pending, true)) {
        blocked = true;
        pending = '';
        emit((tail ? '\n\n' : '') + verifiedTeamReply);
        onBlock();
        return;
      }
      const cut = [...pending.matchAll(/[\n。！？]|[.!?](?=\s|$)/gu)].at(-1);
      if (cut) release(cut.index + cut[0].length);
    },
    finish() { if (!blocked) release(pending.length); },
  };
}
