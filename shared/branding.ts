// Replace the underlying engine label in old assistant messages and live text.
// Prompts, filenames, and user-authored text are not rewritten.
export const brandAnswer = (text: string) => text.replace(/qwen/gi, 'the chat engine');

export function brandedStream(emit: (text: string) => void) {
  let pending = '';
  return {
    text(delta: string) {
      const text = brandAnswer(pending + delta);
      // Hold only a possible beginning of the label, not entire words or lines.
      pending = /q(?:w(?:e)?)?$/i.exec(text)?.[0] ?? '';
      const ready = pending ? text.slice(0, -pending.length) : text;
      if (ready) emit(ready);
    },
    finish() { if (pending) emit(pending); pending = ''; },
  };
}
