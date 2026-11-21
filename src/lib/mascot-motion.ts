const words = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'word' }) : undefined;

// Stream chunks can split a word over several events. Count a word when its
// boundary appears, not when a token arrives, and look back only near the edit.
export function hasCompletedWord(text: string, from: number, flush = false): boolean {
  if (from > text.length || !text) return false;
  const start = Math.max(0, from - 80);
  const tail = text.slice(start);
  const boundary = from - start;
  const complete = (end: number) => end >= boundary && (end < tail.length || flush);
  if (words) {
    for (const part of words.segment(tail)) {
      if (part.isWordLike && complete(part.index + part.segment.length)) return true;
    }
  } else {
    for (const part of tail.matchAll(/[\p{L}\p{N}][\p{L}\p{M}\p{N}'’]*/gu)) {
      if (complete(part.index + part[0].length)) return true;
    }
  }
  return false;
}

export function typedCompletedWord(before: string, after: string, caret = after.length, committed = false) {
  let from = 0;
  while (from < caret && before[from] === after[from]) from++;
  return from < caret && hasCompletedWord(after.slice(0, caret), from, committed);
}

const flights = new WeakMap<HTMLSpanElement, Animation>();
let reducedMotion: MediaQueryList | undefined;

export function floatMascot(art: HTMLSpanElement | null) {
  if (!art?.animate || (reducedMotion ??= window.matchMedia('(prefers-reduced-motion: reduce)')).matches) return;
  const inFlight = flights.get(art);
  // Fast replies share one brief float. Never queue motion behind the stream.
  if (inFlight?.pending || inFlight?.playState === 'running') return;
  flights.set(art, art.animate([
    { transform: 'none', offset: 0, easing: 'cubic-bezier(.16,.8,.3,1)' },
    { transform: 'translateY(-13%) rotate(-7deg) scale(1.03)', offset: .45, easing: 'ease-in-out' },
    { transform: 'none', offset: 1 },
  ], { id: 'xyvora-orbit-float', duration: 290 }));
}
