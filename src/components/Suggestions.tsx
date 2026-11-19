import { ArrowUpRight, BookOpen, CodeXml, PenLine, Route } from 'lucide-react';

export const SUGGESTIONS = [
  { title: 'Explain a concept', caption: 'Make it click', icon: BookOpen, color: 'violet', prompt: 'Explain recursion with a simple, everyday analogy, then show a short example.' },
  { title: 'Write something', caption: 'Find the right words', icon: PenLine, color: 'peach', prompt: 'Write an opening paragraph for a cozy mystery set in a seaside town.' },
  { title: 'Build with code', caption: 'Go from idea to code', icon: CodeXml, color: 'mint', prompt: 'Show me how to build a small to-do list app in JavaScript. Start with the simplest version.' },
  { title: 'Make a plan', caption: 'Break it into steps', icon: Route, color: 'sky', prompt: 'Make me a realistic one-week plan to learn a new skill in 20 minutes a day.' },
] as const;

export function Suggestions({ onPick, compact = false }: { onPick: (prompt: string) => void; compact?: boolean }) {
  return <section className={`suggestions${compact ? ' suggestions-compact' : ''}`} aria-label="Suggested prompts">
    <div className="section-eyebrow">TRY A PROMPT</div>
    <div className="suggestion-grid">
      {SUGGESTIONS.map(({ title, caption, icon: Icon, color, prompt }) => <button type="button" key={title} className="suggestion-card" onClick={() => onPick(prompt)}>
        <span className={`suggestion-icon tint-${color}`}><Icon size={18} strokeWidth={1.85} /></span>
        <ArrowUpRight className="suggestion-arrow" size={15} />
        <strong>{title}</strong><span className="suggestion-caption">{caption}</span>
      </button>)}
    </div>
  </section>;
}
