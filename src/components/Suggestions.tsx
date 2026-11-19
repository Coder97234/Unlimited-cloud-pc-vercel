import { ArrowUpRight, BookOpen, Clock3, Globe, PenLine } from 'lucide-react';

export const SUGGESTIONS = [
  { title: 'Explain a concept', caption: 'Make it click', icon: BookOpen, color: 'violet', prompt: 'Explain recursion with a simple, everyday analogy, then show a short example.' },
  { title: 'Write something', caption: 'Find the right words', icon: PenLine, color: 'peach', prompt: 'Write an opening paragraph for a cozy mystery set in a seaside town.' },
  { title: 'Search the web', caption: 'Find sources', icon: Globe, color: 'mint', prompt: 'What is NASA’s Artemis program?' },
  { title: 'Check the time', caption: 'Use the live clock', icon: Clock3, color: 'sky', prompt: 'What time is it?' },
] as const;

export function Suggestions({ onPick }: { onPick: (prompt: string, search: boolean) => void }) {
  return <section className="suggestions" aria-label="Suggested prompts">
    <div className="section-eyebrow">TRY A PROMPT</div>
    <div className="suggestion-grid">
      {SUGGESTIONS.map(({ title, caption, icon: Icon, color, prompt }) => <button type="button" key={title} className="suggestion-card" onClick={() => onPick(prompt, title === 'Search the web')}>
        <span className={`suggestion-icon tint-${color}`}><Icon size={18} strokeWidth={1.85} /></span>
        <ArrowUpRight className="suggestion-arrow" size={15} />
        <strong>{title}</strong><span className="suggestion-caption">{caption}</span>
      </button>)}
    </div>
  </section>;
}
