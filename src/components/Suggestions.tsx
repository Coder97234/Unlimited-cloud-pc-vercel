import { BookOpen, Calculator, CodeXml, ImagePlus, ListChecks, PenLine } from 'lucide-react';
import { useLabels } from '../lib/labels.ts';
import { SKILLS } from '../../shared/skill-catalog.ts';

const suggestions = [
  { title: 'write', icon: PenLine, prompt: 'Write an opening paragraph for a cozy mystery set in a seaside town.' },
  { title: 'learn', icon: BookOpen, prompt: 'Explain recursion with a simple, everyday analogy, then show a short example.' },
  { title: 'code', icon: CodeXml, prompt: 'Show a small JavaScript example that groups items by category. Explain how it works in two sentences.' },
  { title: 'calculate', icon: Calculator, prompt: SKILLS.calc.example },
  { title: 'plan', icon: ListChecks, prompt: SKILLS.plan.example },
] as const;

export function Suggestions({ onPick, onImage }: { onPick: (prompt: string) => void; onImage?: () => void }) {
  const t = useLabels();
  return <section className="suggestions" aria-label="Suggested prompts">
    {suggestions.map(({ title, icon: Icon, prompt }) => <button type="button" key={title} className="suggestion-card" onClick={() => onPick(prompt)}>
      <Icon size={15} strokeWidth={1.75} />{t(title)}
    </button>)}
    {onImage && <button type="button" className="suggestion-card" onClick={onImage}><ImagePlus size={15} />Create an image</button>}
  </section>;
}
