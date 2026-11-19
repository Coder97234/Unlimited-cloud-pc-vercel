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

const hops = new WeakMap<HTMLSpanElement, Animation>();
let reducedMotion: MediaQueryList | undefined;

export function hopMascot(art: HTMLSpanElement | null) {
  if (!art?.animate || (reducedMotion ??= window.matchMedia('(prefers-reduced-motion: reduce)')).matches) return;
  const inFlight = hops.get(art);
  // Fast replies (and pastes) share one hop. Never queue an animation behind
  // the stream or re-render the transcript just to move the mascot.
  if (inFlight?.pending || inFlight?.playState === 'running') return;
  hops.set(art, art.animate([
    { transform: 'none', offset: 0, easing: 'ease-in' },
    { transform: 'translateY(3%) scale(1.08, .93)', offset: .16, easing: 'cubic-bezier(.18,.66,.44,1)' },
    { transform: 'translateY(-26%) rotate(-5deg) scale(.99, 1.05)', offset: .48, easing: 'cubic-bezier(.52,0,.84,.46)' },
    { transform: 'translateY(3%) scale(1.06, .94)', offset: .84, easing: 'ease-out' },
    { transform: 'none', offset: 1 },
  ], { id: 'xyvora-word-hop', duration: 290 }));
  art.animate([
    { backgroundPosition: '0% 0%', offset: 0, easing: 'steps(1, end)' },
    { backgroundPosition: '100% 0%', offset: .16, easing: 'steps(1, end)' },
    { backgroundPosition: '0% 0%', offset: .53 },
  ], { id: 'xyvora-word-blink', duration: 290 });
}
