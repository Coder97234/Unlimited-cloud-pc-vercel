import type { ModelId } from '../shared/models.ts';

// Only enabled by the local development server, never by the Vercel function.
function example(prompt: string, model: ModelId) {
  if (/recursion/i.test(prompt)) return (model === 'gpt-oss' || model === 'smollm')
    ? '**Recursion has two parts:** a base case that stops, and a step that reduces the problem. To count down from 3, say 3, then use the same rule for 2, then 1. Stop at 0. Without that stop condition, the function keeps calling itself.'
    : 'Think of a set of **nesting dolls**. You open one and find a smaller version of the same thing. Keep opening until you reach the smallest doll.\n\nThat’s recursion: solve a problem by repeating the same process on a smaller problem, until you reach a simple stopping point.';
  if (/story|opening|novel/i.test(prompt)) return 'The moon had been missing for three nights before anyone in the harbor admitted they could still hear it. Each evening at low tide, a silver note rang out from under the pier. On the fourth night, Mara brought a ladder.';
  if (/week|learn|plan/i.test(prompt)) return '**A small start is the best start.**\n\n1. Pick one skill you want to practice.\n2. Spend 20 minutes on the basics each day.\n3. Build something small by the end of the week.\n4. Write down what worked and what you want to try next.';
  if (/code|app|function|javascript/i.test(prompt)) return 'Start by defining what the program should take in, what it should return, and one example that proves it works. Then build the smallest version that handles that example before adding more features.';
  return (model === 'gpt-oss' || model === 'smollm')
    ? 'In a live chat, I would break your question into parts, state my assumptions, and work through the answer. This preview lets you test the conversation flow without using a hosted model.'
    : 'You’re in the interface preview. Try one of the suggested prompts, switch models, or open Compare to try the workspace. Real replies run on the server on the deployed site.';
}

export function previewResponse(prompt: string, model: ModelId, signal: AbortSignal) {
  const text = `*Sample response · interface preview*\n\n${example(prompt, model)}`;
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
