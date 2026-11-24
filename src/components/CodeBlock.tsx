import { useLabels } from '../lib/labels.ts';
import { Check, Clipboard, Code2 } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Root, RootContent } from 'hast';
import { parseFlowchart } from '../../shared/flowchart.ts';
import type { Flowchart } from '../../shared/flowchart.ts';

function Token({ node }: { node: RootContent }): ReactNode {
  if (node.type === 'text') return node.value;
  if (node.type !== 'element' || node.tagName !== 'span') return null;
  const classes = Array.isArray(node.properties.className) ? node.properties.className.filter((part) => typeof part === 'string' && /^[A-Za-z0-9_-]{1,30}$/.test(part)).join(' ') : undefined;
  return <span className={classes}>{node.children.map((child, index) => <Token node={child} key={index} />)}</span>;
}

function Diagram({ graph }: { graph: Flowchart }) {
  const marker = `arrow-${useId().replace(/[^\w-]/g, '')}`;
  const across = graph.direction === 'horizontal';
  const width = 166, height = 46, dx = width + 45, dy = height + 40;
  const places = graph.nodes.map((node) => ({ ...node, x: (across ? node.rank : node.slot) * dx + 12, y: (across ? node.slot : node.rank) * dy + 12 }));
  const w = Math.max(...places.map(({ x }) => x)) + width + 12, h = Math.max(...places.map(({ y }) => y)) + height + 12;
  return <div className="flowchart-container" tabIndex={0} aria-label="Scrollable flowchart"><svg className="flowchart" xmlns="http://www.w3.org/2000/svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Flowchart">
    <title>Flowchart</title><desc>{graph.edges.map(([a, b]) => `${graph.nodes.find(({ id }) => id === a)!.label} → ${graph.nodes.find(({ id }) => id === b)!.label}`).join('; ')}</desc>
    <defs><marker id={marker} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
    {graph.edges.map(([from, to]) => {
      const a = places.find(({ id }) => id === from)!, b = places.find(({ id }) => id === to)!;
      const x1 = a.x + (across ? width : width / 2), x2 = b.x + (across ? -3 : width / 2);
      const y1 = a.y + (across ? height / 2 : height), y2 = b.y + (across ? height / 2 : -3);
      const controls = across ? `${(x1+x2)/2} ${y1} ${(x1+x2)/2} ${y2}` : `${x1} ${(y1+y2)/2} ${x2} ${(y1+y2)/2}`;
      return <path className="flow-edge" key={`${from}:${to}`} d={`M ${x1} ${y1} C ${controls} ${x2} ${y2}`} markerEnd={`url(#${marker})`} />;
    })}
    {places.map(({ id, x, y, label }) => <g key={id}><rect x={x} y={y} width={width} height={height} rx={9} /><title>{label}</title>
      <text x={x + width / 2} y={y + height / 2} textAnchor="middle" dominantBaseline="central">{[...label].length > 22 ? `${[...label].slice(0, 21).join('')}…` : label}</text></g>)}
  </svg></div>;
}

export function CodeBlock({ text, language, settled }: { text: string; language?: string; settled: boolean }) {
  const t = useLabels();
  const [highlight, setHighlight] = useState<{ text: string; lang: string; root: Root }>();
  const [feedback, setFeedback] = useState<'copied' | 'failed'>();
  const [showSource, setShowSource] = useState(false);
  const lang = language?.toLowerCase();
  const graph = useMemo(() => settled && lang === 'mermaid' ? parseFlowchart(text) : undefined, [settled, lang, text]);
  useEffect(() => {
    if (!settled || !lang || lang === 'mermaid' || text.length > 12_000) return;
    let disposed = false;
    void import('../lib/highlight.ts').then(({ highlightCode }) => {
      const root = disposed ? undefined : highlightCode(lang, text);
      if (root && !disposed) setHighlight({ root, text, lang });
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, [settled, lang, text]);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(undefined), 1_700);
    return () => clearTimeout(timer);
  }, [feedback]);
  const rendered = settled && highlight?.text === text && highlight.lang === lang ? highlight.root : undefined;
  return <div className="code-block"><div className="code-toolbar"><span><Code2 size={14} />{graph ? 'Flowchart' : lang ?? 'Code'}</span>
    {graph && <button type="button" className="text-button" onClick={() => setShowSource(!showSource)} aria-pressed={showSource}>{showSource ? 'Show diagram' : 'Show source'}</button>}
    <button type="button" className="text-button code-copy" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setFeedback('copied'); } catch { setFeedback('failed'); }
    }} aria-label={t('codeCopy')}>{feedback === 'copied' ? <Check size={14} /> : <Clipboard size={14} />}<span>{t(feedback === 'copied' ? 'copied' : 'copy')}</span></button>
  </div>
    {graph && !showSource ? <Diagram graph={graph} /> : <pre tabIndex={0}><code>{rendered ? rendered.children.map((node, index) => <Token node={node} key={index} />) : text}</code></pre>}
    {lang === 'mermaid' && settled && !graph && <p className="code-note">Showing source. Diagrams support short, acyclic Mermaid flowcharts with arrows and box labels.</p>}
    {feedback && <span role="status" className={feedback === 'copied' ? 'sr-only' : 'code-note'}>{feedback === 'copied' ? 'Code copied.' : 'Clipboard unavailable. Select and copy the code manually.'}</span>}
  </div>;
}
