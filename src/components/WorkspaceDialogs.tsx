import { ArrowUpRight, Check, Columns2, HardDrive, MessageSquare, Moon, Search, ShieldCheck, Sun, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { MODELS } from '../../shared/models.ts';
import type { Availability, ModelId } from '../../shared/models.ts';
import type { Thread } from '../lib/history.ts';
import { ModelIcon } from './Brand.tsx';
import { Dialog } from './Dialog.tsx';

export type Theme = 'light' | 'dark';

export function ModelDialog({ value, excluded, lane, models, availability, onClose, onChoose }: {
  value: ModelId; excluded?: ModelId; lane?: 0 | 1; models: readonly ModelId[]; availability: Availability | 'loading';
  onClose: () => void; onChoose: (id: ModelId) => void;
}) {
  return <Dialog title="Choose a model" subtitle={lane === undefined ? 'Open models with different strengths. Switch at any time.' : `Pick a model for the ${lane === 0 ? 'left' : 'right'} side of the comparison.`} onClose={onClose}>
    <div className="model-options">
      {models.map((id) => <div key={id} className={`model-option${id === value ? ' selected' : ''}`}>
        <button type="button" disabled={id === excluded} className="model-option-select" onClick={() => onChoose(id)}>
          <ModelIcon id={id} size={20} /><span className="model-option-text"><strong>{MODELS[id].name}</strong><small>{MODELS[id].description}</small></span>
          {id === value ? <Check size={18} className="option-check" /> : <span className="model-tag">{id === excluded ? 'Other side' : MODELS[id].tag}</span>}
        </button>
        <a className="bare-icon model-link" href={MODELS[id].weights} target="_blank" rel="noopener noreferrer" title="View model weights" aria-label={`${MODELS[id].name} model weights`}><ArrowUpRight size={16} /></a>
      </div>)}
    </div>
    <div className="dialog-note"><ShieldCheck size={16} />
      {availability === 'preview' ? 'Replies are labeled samples in this interface preview.'
        : 'Replies run on a server. The first reply can take longer while a model starts.'}
    </div>
  </Dialog>;
}

export function SearchDialog({ threads, onClose, onPick }: { threads: Thread[]; onClose: () => void; onPick: (thread: Thread) => void }) {
  const [query, setQuery] = useState('');
  const term = query.trim().toLowerCase();
  const matches = threads.filter((thread) => !term || thread.title.toLowerCase().includes(term)
    || thread.turns.some((turn) => turn.prompt.toLowerCase().includes(term)));
  return <Dialog title="Search chats" subtitle="Find conversations saved in this browser." onClose={onClose}>
    <label className="search-field"><Search size={18} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your chats…" aria-label="Search your chats" data-dialog-focus onKeyDown={(event) => {
      if (event.key === 'Enter' && matches.length) { event.preventDefault(); onPick(matches[0]); }
    }} /></label>
    <div className="search-results">
      {matches.length === 0 ? <p>{threads.length ? 'No conversations match that search.' : 'No chats yet. Start a conversation to see it here.'}</p>
        : matches.map((thread) => <button type="button" className="search-result" key={thread.id} onClick={() => onPick(thread)}>
          {thread.mode === 'compare' ? <Columns2 size={17} /> : <MessageSquare size={17} />} <span>{thread.title}</span>
        </button>)}
    </div>
  </Dialog>;
}

export function SettingsDialog({ theme, count, onTheme, onClear, onClose }: {
  theme: Theme; count: number; onTheme: (theme: Theme) => void; onClear: () => void; onClose: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return <Dialog title="Workspace settings" subtitle="Make Xyvora feel at home on this device." onClose={onClose}>
    <section className="settings-section"><h3>Appearance</h3>
      <div className="theme-options">
        {(['light', 'dark'] as const).map((item) => <button type="button" className={`theme-choice${theme === item ? ' active' : ''}`} key={item} onClick={() => onTheme(item)} aria-pressed={theme === item}>
          {item === 'light' ? <Sun size={17} /> : <Moon size={17} />} {item === 'light' ? 'Light' : 'Dark'}
        </button>)}
      </div>
    </section>
    <section className="settings-section history-settings"><div><h3>Local history</h3><p>{count === 1 ? '1 conversation' : `${count} conversations`} on this device.</p></div>
      <button type="button" className="danger-button" disabled={count === 0} onClick={() => setConfirm(true)}><Trash2 size={15} /> Clear history</button>
    </section>
    {confirm && <div className="confirm-box"><p>Delete all saved conversations on this device? This can’t be undone.</p>
      <div><button type="button" className="secondary-button" onClick={() => setConfirm(false)}>Cancel</button><button type="button" className="danger-button" onClick={() => { onClear(); setConfirm(false); }}>Delete all</button></div>
    </div>}
    <div className="dialog-note"><HardDrive size={16} /> No account is required. History and theme preferences are kept in this browser.</div>
  </Dialog>;
}

export function AboutDialog({ onClose }: { onClose: () => void }) {
  return <Dialog title="About Xyvora" subtitle="A place to chat with open models and compare their answers." onClose={onClose}>
    <div className="about-content">
      <p><strong>Chat:</strong> Choose a model and start a conversation. Switch models whenever you want another perspective.</p>
      <p><strong>Compare:</strong> Send the same prompt to two server models and read their answers side by side.</p>
      <p><strong>Privacy:</strong> Chat history is saved in this browser. Your prompt, recent messages, and any attached text are sent to the Xyvora server to generate a reply. Gateway models, when enabled, also send that context to the model provider.</p>
    </div>
  </Dialog>;
}
