import { ArrowUpRight, Globe, Search, Sparkles, Zap } from 'lucide-react';
import { useState } from 'react';
import { MODEL_NAME } from '../../shared/models.ts';
import { SKILLS, SKILL_IDS, skillAvailable } from '../../shared/skill-catalog.ts';
import type { SkillId } from '../../shared/skill-catalog.ts';
import { Dialog } from './Dialog.tsx';

const groups = [
  { id: 'instant', title: 'On this device', short: 'On device', hint: 'No chat request or model needed', icon: Zap, tint: 'violet' },
  { id: 'live', title: 'Live tools', short: 'Live tools', hint: 'Uses the server', icon: Globe, tint: 'sky' },
  { id: 'qwen', title: 'AI workflows', short: 'AI workflows', hint: `Powered by ${MODEL_NAME}`, icon: Sparkles, tint: 'mint' },
] as const;

export function SkillsDialog({ canGenerate, canSearch, onPick, onClose }: {
  canGenerate: boolean; canSearch: boolean; onPick: (id: SkillId) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | (typeof groups)[number]['id']>('all');
  const term = query.trim().toLowerCase();
  const matches = SKILL_IDS.filter((id) => {
    const skill = SKILLS[id];
    return (filter === 'all' || skill.group === filter) && (!term || `/${id} ${skill.name} ${skill.description}`.toLowerCase().includes(term));
  });
  const firstAvailable = matches.find((id) => skillAvailable(id, canGenerate, canSearch));

  return <Dialog title="Skills" subtitle="Choose a tool to load an editable example into your message." className="skills-dialog" onClose={onClose}>
    <label className="search-field"><Search size={17} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
      placeholder="Find a skill or command…" aria-label="Find a skill or command" data-dialog-focus onKeyDown={(event) => {
        if (event.key === 'Enter' && firstAvailable) { event.preventDefault(); onPick(firstAvailable); }
      }} /></label>
    <div className="skill-filters" aria-label="Filter skills" role="group">
      <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
      {groups.map(({ id, short }) => <button type="button" key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{short}</button>)}
    </div>
    {matches.length === 0 && <p className="skill-empty" role="status">No skills match that search.</p>}
    {groups.map(({ id: group, title, hint, icon: Icon, tint }) => {
      const ids = matches.filter((id) => SKILLS[id].group === group);
      if (!ids.length) return null;
      return <section className="skill-group" key={group} aria-label={title}>
        <div className="skill-group-heading"><span className={`skill-group-icon tint-${tint}`}><Icon size={14} /></span><h3>{title}</h3><small>{hint}</small></div>
        <div className="skill-grid">
          {ids.map((id) => {
            const { name, description } = SKILLS[id];
            const available = skillAvailable(id, canGenerate, canSearch);
            return <button className="skill-card" type="button" key={id} onClick={() => onPick(id)} disabled={!available}>
              <span className="skill-card-title"><strong>{name}</strong><ArrowUpRight size={14} aria-hidden="true" /></span>
              <span className="skill-description">{description}</span>
              <span className="skill-command"><code>/{id}</code>{!available && <small>Requires live chat</small>}</span>
            </button>;
          })}
        </div>
      </section>;
    })}
    <p className="dialog-note">You can also type <code>/skills</code> in chat for the full command list.</p>
  </Dialog>;
}
