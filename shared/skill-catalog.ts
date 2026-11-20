import { TEAM } from './site.ts';

// One catalog drives commands and the assistant’s tool guide.
export const SKILLS = {
  about: { group: 'instant', name: 'About Xyvora', description: 'Find the assistant’s name, website, and team.', example: 'Who are you?' },
  calc: { group: 'instant', name: 'Calculator', description: 'Evaluate arithmetic, percentages, powers, and square roots.', example: '/calc 18% of 84.50' },
  convert: { group: 'instant', name: 'Unit converter', description: 'Convert distance, weight, volume, temperature, speed, or duration.', example: '/convert 72 F to C' },
  split: { group: 'instant', name: 'Tip & split', description: 'Calculate a tip and split a bill in US dollars, down to the cent.', example: '/split 84.50 + 18% / 3' },
  date: { group: 'instant', name: 'Calendar math', description: 'Find the weekday, count days between dates, or shift a date.', example: '/date 2028-02-28 + 3 days' },
  text: { group: 'instant', name: 'Text stats', description: 'Count words, characters, and lines, and estimate reading time.', example: '/text Good ideas get better when we write them down.', attachmentCommand: '/text' },
  json: { group: 'instant', name: 'JSON formatter', description: 'Validate and indent JSON without rewriting its values.', example: '/json {"project":"Xyvora","done":true}', attachmentCommand: '/json' },
  case: { group: 'instant', name: 'Change case', description: 'Convert text to uppercase or lowercase.', example: '/case upper hello, Xyvora', attachmentCommand: '/case upper' },
  lines: { group: 'instant', name: 'Clean up a list', description: 'Remove blank and duplicate lines, or sort a list.', example: '/lines unique\nPear\nApple\nPear', attachmentCommand: '/lines unique' },
  csv: { group: 'instant', name: 'Inspect CSV', description: 'Count rows and columns and check row widths.', example: '/csv city,count\nTokyo,42' },
  jsonpick: { group: 'instant', name: 'Read a JSON value', description: 'Find a value at a JSON pointer.', example: '/jsonpick /items/0 {"items":[42]}' },
  url: { group: 'instant', name: 'URL encoding', description: 'Encode or decode a URL component as text.', example: '/url encode hello world' },
  base64: { group: 'instant', name: 'Base64', description: 'Encode or decode UTF-8 text as Base64.', example: '/base64 encode hello' },
  comparelists: { group: 'instant', name: 'Compare lists', description: 'Find shared and unique items across two lists.', example: '/comparelists\napple\npear\n---\npear\nplum' },
  time: { group: 'live', name: 'Live clock', description: 'Get the time and date here or in a named city or time zone.', example: '/time Tokyo' },
  search: { group: 'live', name: 'Web search', description: 'Look up sources and answer with links. Only the query is shared with the search providers.', example: '/search NASA Artemis program' },
  summarize: { group: 'writing', name: 'Summarize', description: 'Turn a draft, notes, or a text attachment into a short brief.', example: '/summarize ', attachmentCommand: '/summarize' },
  rewrite: { group: 'writing', name: 'Rewrite', description: 'Polish an email or draft without changing the facts.', example: '/rewrite ', attachmentCommand: '/rewrite' },
  translate: { group: 'writing', name: 'Translate', description: 'Translate text to a language you choose.', example: '/translate Spanish: Thanks for your help!', attachmentCommand: '/translate Spanish:' },
  plan: { group: 'writing', name: 'Make a plan', description: 'Turn a goal into a checklist with concrete next steps.', example: '/plan learn basic guitar in two weeks' },
} as const;

export type SkillId = keyof typeof SKILLS;
export type SkillResultId = SkillId | 'skills';
export const SKILL_IDS = Object.keys(SKILLS) as SkillId[];
export const isSkillId = (value: unknown): value is SkillId => typeof value === 'string' && Object.hasOwn(SKILLS, value);
export const isSkillResultId = (value: unknown): value is SkillResultId => value === 'skills' || isSkillId(value);
export const skillName = (id: SkillResultId) => id === 'skills' ? 'Tool guide' : SKILLS[id].name;

export function skillAvailable(id: SkillId, canGenerate: boolean, canSearch: boolean) {
  return id === 'search' ? canSearch : SKILLS[id].group !== 'writing' || canGenerate;
}

export function readSkillCommand(text: string): { id: SkillResultId; argument: string } | undefined {
  const match = /^\/([a-z][a-z0-9]*)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  const id = match?.[1].toLowerCase();
  if (id === 'team') return { id: 'about', argument: match?.[2]?.trim() ?? '' };
  if (id === 'tools') return { id: 'skills', argument: '' };
  if (isSkillResultId(id)) return { id, argument: match?.[2]?.trim() ?? '' };
}

export function normalizeQuestion(prompt: string) {
  return prompt.trim().replace(/’/g, "'").replace(/[?.!]+$/, '').replace(/(?:,? please)$/i, '').trim();
}

// Match direct questions, not quoted text, roleplay, or questions about third parties.
const identityQuestion = /^(?:who (?:exactly )?are you(?: (?:really|exactly|and (?:what can you do|what(?:'?s| is) your (?:name|website|model))))?|what (?:exactly )?are you|what(?:'?s| is) your (?:(?:real|actual) )?(?:name(?: and (?:website|model))?|model|website|site|domain)|what (?:website|site|app) (?:is this|are you on)|what(?:'?s| is) xyvora(?: ai|\.net)?|what model (?:are you(?: using)?|do you use|powers you)|(?:are|aren't) you (?:chatgpt|openai|claude|gemini|qwen(?: 2\.5)?|xyvora(?: ai)?)(?: or (?:chatgpt|qwen|xyvora(?: ai)?))?|(?:who (?:made|built|created|owns|operates)|where can i find) you|introduce yourself|tell me about yourself)$/i;
const teamQuestion = /^(?:(?:who (?:made|built|created|designed|developed|founded|runs|owns) (?:you|xyvora(?: ai)?|this app))|who(?:'?s| is) (?:the |your )?(?:founder|designer|coder|creator)(?: (?:of |at )?xyvora(?: ai)?)?|who(?:'?s| is) (?:behind xyvora(?: ai)?|on (?:the )?(?:xyvora|your) team)|(?:tell me about|show me|meet) (?:the )?xyvora team)$/i;
const memberQuestions = new Set<string>(TEAM.flatMap(({ name }) => {
  const member = name.toLowerCase();
  return [`who is ${member}`, `who's ${member}`, `what does ${member} do at xyvora`, `what is ${member}'s role at xyvora`, `what's ${member}'s role at xyvora`];
}));
const helpQuestion = /^(?:what can you do|what (?:are your|are the) (?:skills|tools)|how can you help(?: me)?|list your (?:skills|tools)|show (?:me )?your (?:skills|tools))$/i;

export function directInfoSkill(prompt: string): 'about' | 'skills' | undefined {
  if (prompt.length > 120) return;
  const text = normalizeQuestion(prompt).replace(/^please\s+/i, '').replace(/\s+/g, ' ');
  return (identityQuestion.test(text) || teamQuestion.test(text) || memberQuestions.has(text.toLowerCase())) ? 'about' : helpQuestion.test(text) ? 'skills' : undefined;
}
