import type { ReplyMode } from '../shared/modes.ts';

// Only enabled by the local development server, never by the Vercel function.
function example(prompt: string, mode: ReplyMode) {
  if (/recursion/i.test(prompt) && mode === 'thinker') return '**The key check:** Can each step solve a smaller version of the same problem? With nesting dolls, opening each doll leaves a smaller one. The smallest doll needs no further step. That stopping rule is what makes the process finish.';
  if (/recursion/i.test(prompt) && mode === 'pro') return '**Base case and recursive step**\n\n\`\`\`js\nconst count = (n) => n <= 0 ? 0 : 1 + count(n - 1);\n\`\`\`\n\nCheck \`count(0) === 0\` and \`count(3) === 3\`. For large inputs, prefer a loop to avoid exhausting the call stack.';
  if (/recursion/i.test(prompt) && mode === 'creative') return 'A little library lives inside a book. On its shelf sits a smaller book with a smaller library, then a tinier book again. At last you open a book with just one word: **stop**. Recursion is the rule that takes you through those smaller doors.';
  if (/recursion/i.test(prompt)) return 'Think of a set of **nesting dolls**. You open one and find a smaller version of the same thing. Keep opening until you reach the smallest doll.\n\nThat’s recursion: solve a problem by repeating the same process on a smaller problem, until you reach a simple stopping point.';
  if (/story|opening|novel/i.test(prompt)) return 'The moon had been missing for three nights before anyone in the harbor admitted they could still hear it. Each evening at low tide, a silver note rang out from under the pier. On the fourth night, Mara brought a ladder.';
  if (/week|learn|plan/i.test(prompt)) return '**A small start is the best start.**\n\n1. Pick one skill you want to practice.\n2. Spend 20 minutes on the basics each day.\n3. Build something small by the end of the week.\n4. Write down what worked and what you want to try next.';
  if (/code|app|function|javascript/i.test(prompt)) return 'Start by defining what the program should take in, what it should return, and one example that proves it works. Then build the smallest version that handles that example before adding more features.';
  return 'You’re in the interface preview. Try one of the suggested prompts or ask for the time. Live replies and Web search run on the deployed site.';
}

export function previewResponse(prompt: string, signal: AbortSignal, mode: ReplyMode = 'normal') {
  const text = `*Sample response · interface preview*\n\n${example(prompt, mode)}`;
  const chunks = text.match(/.{1,14}/gs) ?? [];
  const encoder = new TextEncoder();
  let next = 0;
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise<void>((resolve) => setTimeout(resolve, next === 0 ? 190 : 19));
      if (cancelled) return;
      if (signal.aborted) { controller.close(); return; }
      if (next === chunks.length) {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[next++] } }] })}\n\n`));
    },
    cancel() { cancelled = true; },
  });
}
