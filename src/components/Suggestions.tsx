import { ArrowUpRight, BookOpen, Calculator, ImagePlus, ListChecks, PenLine } from 'lucide-react';
import { SKILLS } from '../../shared/skill-catalog.ts';

const suggestions = [
  { title: 'Explain a concept', caption: 'Make it click', icon: BookOpen, color: 'violet', prompt: 'Explain recursion with a simple, everyday analogy, then show a short example.' },
  { title: 'Write something', caption: 'Find the right words', icon: PenLine, color: 'peach', prompt: 'Write an opening paragraph for a cozy mystery set in a seaside town.' },
  { title: 'Calculate something', caption: 'Get an exact result', icon: Calculator, color: 'mint', prompt: SKILLS.calc.example },
] as const;
const image = { title: 'Create an image', caption: 'Open Image Studio', icon: ImagePlus, color: 'sky', prompt: '' } as const;
const plan = { title: 'Make a plan', caption: 'Find the next steps', icon: ListChecks, color: 'sky', prompt: SKILLS.plan.example } as const;

export function Suggestions({ onPick, onImage }: { onPick: (prompt: string) => void; onImage?: () => void }) {
  return <section className="suggestions" aria-label="Suggested prompts">
    <div className="section-eyebrow">TRY A PROMPT</div>
    <div className="suggestion-grid">
      {[...suggestions, onImage ? image : plan].map(({ title, caption, icon: Icon, color, prompt }) => <button type="button" key={title} className="suggestion-card" onClick={prompt ? () => onPick(prompt) : onImage}>
        <span className={`suggestion-icon tint-${color}`}><Icon size={18} strokeWidth={1.85} /></span>
        <ArrowUpRight className="suggestion-arrow" size={15} />
        <strong>{title}</strong><span className="suggestion-caption">{caption}</span>
      </button>)}
    </div>
  </section>;
}
