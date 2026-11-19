import { Columns2, HardDrive, MessageSquare, Moon, Search, Sun, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Thread } from '../lib/history.ts';
import { Dialog } from './Dialog.tsx';

export type Theme = 'light' | 'dark';

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
  return <Dialog title="About Xyvora" subtitle="Qwen 2.5 chat with live tools." onClose={onClose}>
    <div className="about-content">
      <p><strong>Chat:</strong> Qwen 2.5 is the only AI model. Earlier chats and comparisons stay in your history.</p>
      <p><strong>Web search:</strong> Turn on Web search for a prompt or type <code>/search</code> followed by a query. Results link to their original pages. The public search service may rate-limit requests.</p>
      <p><strong>Time and date:</strong> Ask for the time, today’s date, or the time in a city such as Tokyo. The live clock uses your device’s time zone unless you ask for another.</p>
      <p><strong>Privacy:</strong> History stays in this browser. Xyvora sends the prompt, recent context, and attached text to its server for replies. When you use Web search, the search query alone is sent to <a href="https://docs.keenable.ai/api-reference" target="_blank" rel="noopener noreferrer">Keenable</a>, which logs queries. Do not include private information in a search.</p>
    </div>
  </Dialog>;
}
