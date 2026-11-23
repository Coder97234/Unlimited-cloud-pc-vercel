export type Flowchart = { direction: 'vertical' | 'horizontal'; nodes: { id: string; label: string; rank: number; slot: number }[]; edges: [string, string][] };

// A deliberately small data-only Mermaid subset. It does not interpret HTML,
// styles, directives, links, click handlers, or user-supplied SVG.
export function parseFlowchart(source: string): Flowchart | undefined {
  if (source.length > 2_000) return;
  const [head, ...lines] = source.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const direction = /^(?:flowchart|graph)\s+(TD|TB|LR)$/i.exec(head ?? '')?.[1]?.toUpperCase();
  if (!direction || lines.length > 30) return;
  const labels = new Map<string, string>(), edges: [string, string][] = [];
  function node(value: string) {
    const match = /^([A-Za-z][A-Za-z0-9_]{0,23})(?:\[([^\[\]\x00-\x1f]{1,46})\])?$/.exec(value.trim());
    if (!match) return;
    if (match[2]) labels.set(match[1], match[2].replace(/^"|"$/g, ''));
    else if (!labels.has(match[1])) labels.set(match[1], match[1]);
    return match[1];
  }
  for (const line of lines) {
    const parts = line.replace(/;$/, '').split('-->');
    if (parts.length > 2) return;
    const first = node(parts[0]), second = parts.length === 2 ? node(parts[1]) : undefined;
    if (!first || (parts.length === 2 && !second) || first === second) return;
    if (second && !edges.some(([a, b]) => a === first && b === second)) edges.push([first, second]);
  }
  if (!labels.size || labels.size > 14) return;
  const ranks = new Map<string, number>(), slots = new Map<number, number>();
  while (ranks.size < labels.size) {
    let progress = false;
    for (const id of labels.keys()) {
      if (ranks.has(id)) continue;
      const parents = edges.filter(([, end]) => end === id).map(([start]) => ranks.get(start));
      if (parents.some((rank) => rank === undefined)) continue;
      ranks.set(id, parents.length ? 1 + Math.max(...parents as number[]) : 0); progress = true;
    }
    if (!progress) return; // Cycles remain viewable as source.
  }
  return { direction: direction === 'LR' ? 'horizontal' : 'vertical', edges, nodes: [...labels].map(([id, label]) => {
    const rank = ranks.get(id)!;
    const slot = slots.get(rank) ?? 0; slots.set(rank, slot + 1);
    return { id, label, rank, slot };
  }) };
}
