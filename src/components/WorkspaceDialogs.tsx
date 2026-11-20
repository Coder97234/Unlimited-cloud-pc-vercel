import { Brain, Columns2, HardDrive, MessageSquare, Moon, Search, Sun, Trash2, UserRound } from 'lucide-react';
import { useState } from 'react';
import { XYVORA_NAME, XYVORA_SITE, XYVORA_URL } from '../../shared/models.ts';
import { ABOUT_PATH, SCHOOLS_PATH, TEAM_LINK_LABEL, TEAM_NAME, XYVORA_SLOGAN } from '../../shared/site.ts';
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

export function SettingsDialog({ theme, count, signedIn, onAccount, onMemory, onTheme, onClear, onClose }: {
  theme: Theme; count: number; signedIn: boolean; onAccount: () => void; onMemory: () => void; onTheme: (theme: Theme) => void; onClear: () => void; onClose: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return <Dialog title="Workspace settings" subtitle="Make Xyvora feel at home on this device." onClose={onClose}>
    <section className="settings-section"><h3>Personalization</h3>
      <div className="theme-options"><button type="button" className="secondary-button" onClick={onAccount}><UserRound size={16} />{signedIn ? 'Your account' : 'Sign in'}</button>
        <button type="button" className="secondary-button" onClick={onMemory}><Brain size={16} />Manage memory</button></div>
    </section>
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
    <section className="settings-section"><h3>Privacy &amp; data</h3>
      <div className="theme-options"><a className="secondary-button" href="/cookies">Cookie choices</a><a className="secondary-button" href="/privacy">Privacy policy</a></div>
    </section>
    <div className="dialog-note"><HardDrive size={16} /> No account is required. Saved chats and theme preferences stay in this browser. Temporary chats don’t enter history.</div>
  </Dialog>;
}

export function AboutDialog({ onClose }: { onClose: () => void }) {
  return <Dialog title={`About ${XYVORA_NAME}`} subtitle={XYVORA_SLOGAN} onClose={onClose}>
    <div className="about-content">
      <p><strong>{XYVORA_NAME}</strong> is the assistant at <a href={XYVORA_URL} target="_blank" rel="noopener noreferrer">{XYVORA_SITE}</a>. Choose Instant for a quick reply, Normal for everyday chat, Thinker for comparisons, Pro for technical work, or Creative for ideas. Earlier chats and comparisons remain in your history.</p>
      <p>Built by the <strong>{TEAM_NAME}</strong>. <a href={ABOUT_PATH}>{TEAM_LINK_LABEL}</a> · <a href={SCHOOLS_PATH}>Information for schools</a></p>
      <p><strong>Built-in tools:</strong> Ask for math, conversions, time, or help with a file. Type <code>/tools</code> for commands. Plugins ask you to review scripts, account reads, and external requests before they run.</p>
      <p><strong>Web search:</strong> Turn on Web search for a prompt or type <code>/search</code> followed by a query. Results link to their original pages. Search covers the Wiby independent-web index and English Wikipedia; it does not cover every site or guarantee breaking news.</p>
      <p className="brand-downloads"><strong>Brand artwork:</strong> <a href="/brand/xyvora-lockup-4k.webp" download>4K light logo</a> · <a href="/brand/xyvora-lockup-dark-4k.webp" download>4K dark logo</a></p>
      <p><strong>Time and date:</strong> Ask for the time, today’s date, or the time in a city such as Tokyo. Type <code>/time Tokyo</code> for example. The live clock uses your device’s time zone unless you ask for another.</p>
      <p><strong>Privacy:</strong> Saved history stays in this browser. Temporary chats aren’t saved; their prompts may still be sent for a reply. On-device tool turns stay there and aren’t included in later chat requests. Other replies can send the prompt, recent chat context, attachments, enabled memory notes, and time zone to the server. Temporary chats and This message only never send memory. Hosted image tools send only approved inputs to OpenAI. When you use Web search, the query alone is sent to <a href="https://wiby.me/json/" target="_blank" rel="noopener noreferrer">Wiby</a> and <a href="https://foundation.wikimedia.org/wiki/Policy:Privacy_policy" target="_blank" rel="noopener noreferrer">Wikipedia</a> to look up results. Do not include private information in a search.</p>
    </div>
  </Dialog>;
}
