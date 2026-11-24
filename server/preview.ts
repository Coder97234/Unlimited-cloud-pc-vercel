import type { ReplyLanguage } from '../shared/experience.ts';
import type { ReplyMode } from '../shared/modes.ts';

// Only enabled by the local development server, never by the Vercel function.
function example(prompt: string, mode: ReplyMode) {
  if (/recursion/i.test(prompt) && mode === 'instant') return 'Recursion solves a problem by repeatedly solving a smaller version until it reaches a simple stopping point.';
  if (/recursion/i.test(prompt) && mode === 'thinker') return '**The key check:** Can each step solve a smaller version of the same problem? With nesting dolls, opening each doll leaves a smaller one. The smallest doll needs no further step. That stopping rule is what makes the process finish.';
  if (/recursion/i.test(prompt) && mode === 'pro') return '**Base case and recursive step**\n\n\`\`\`js\nconst count = (n) => n <= 0 ? 0 : 1 + count(n - 1);\n\`\`\`\n\nCheck \`count(0) === 0\` and \`count(3) === 3\`. For large inputs, prefer a loop to avoid exhausting the call stack.';
  if (/recursion/i.test(prompt) && mode === 'creative') return 'A little library lives inside a book. On its shelf sits a smaller book with a smaller library, then a tinier book again. At last you open a book with just one word: **stop**. Recursion is the rule that takes you through those smaller doors.';
  if (/recursion/i.test(prompt)) return 'Think of a set of **nesting dolls**. You open one and find a smaller version of the same thing. Keep opening until you reach the smallest doll.\n\nThat’s recursion: solve a problem by repeating the same process on a smaller problem, until you reach a simple stopping point.';
  if (/story|opening|novel/i.test(prompt)) return 'The moon had been missing for three nights before anyone in the harbor admitted they could still hear it. Each evening at low tide, a silver note rang out from under the pier. On the fourth night, Mara brought a ladder.';
  if (/week|learn|plan/i.test(prompt)) return '**A small start is the best start.**\n\n1. Pick one skill you want to practice.\n2. Spend 20 minutes on the basics each day.\n3. Build something small by the end of the week.\n4. Write down what worked and what you want to try next.';
  if (/code|app|function|javascript/i.test(prompt)) return 'Start by defining what the program should take in, what it should return, and one example that proves it works. Then build the smallest version that handles that example before adding more features.';
  return 'You’re in the interface preview. Try one of the suggested prompts or ask for the time. Live replies need a configured model.';
}

const samples = {
  es: 'Esta es una vista previa. Las respuestas en vivo necesitan un modelo configurado. ¿Qué te gustaría explorar?',
  fr: 'Ceci est un aperçu. Les réponses en direct nécessitent un modèle configuré. Que souhaitez-vous explorer ?',
  de: 'Dies ist eine Vorschau. Antworten in Echtzeit benötigen ein konfiguriertes Modell. Was möchtest du erkunden?',
  pt: 'Esta é uma prévia. Respostas ao vivo precisam de um modelo configurado. O que você quer explorar?',
};
const sampleLabels = { es: 'Respuesta de ejemplo', fr: 'Exemple de réponse', de: 'Beispielantwort', pt: 'Resposta de exemplo' };

export function previewResponse(prompt: string, signal: AbortSignal, mode: ReplyMode = 'normal', language?: ReplyLanguage) {
  const locale = language && language !== 'en' && language !== 'auto' ? language : undefined;
  const text = locale ? `*${sampleLabels[locale]}*\n\n${samples[locale]}` : `*Sample response · interface preview*\n\n${example(prompt, mode)}`;
  // Samples do not simulate an inference budget or an artificial thinking delay.
  return signal.aborted ? '' : `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
}
