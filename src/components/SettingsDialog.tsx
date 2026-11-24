import { Brain, ChevronRight, Globe2, Keyboard, Palette, Plug2, Search, ShieldCheck, SlidersHorizontal, Trash2, UserRound, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AccountStatus } from '../../shared/account.ts';
import { DEFAULT_EFFORT, EFFORT_IDS, EFFORTS, LANGUAGES, isEffort, isLanguage, isReplyLanguage } from '../../shared/experience.ts';
import type { Language } from '../../shared/experience.ts';
import type { MemoryProfile } from '../../shared/memory.ts';
import { DEFAULT_MODE, MODES, MODE_IDS, isReplyMode } from '../../shared/modes.ts';
import { APPEARANCE } from '../../shared/preferences.ts';
import type { Appearance, Theme, WorkspacePreferences } from '../../shared/preferences.ts';
import type { Provider } from '../../shared/workspace-tools.ts';
import { useLabels } from '../lib/labels.ts';
import { voiceSamples } from '../lib/use-voice.ts';
import type { VoiceControls } from '../lib/use-voice.ts';
import { AppConnections } from './AppConnections.tsx';
import { Dialog } from './Dialog.tsx';
import { SessionSettings } from './SessionSettings.tsx';

const categories = [
  { id: 'account', icon: UserRound, keywords: 'profile email name nickname login sign in sign up sessions password devices' },
  { id: 'appearance', icon: Palette, keywords: 'layout theme light dark color accent orange density font text size' },
  { id: 'replies', icon: SlidersHorizontal, keywords: 'model style effort low medium high extra max citations automatic web search searxng' },
  { id: 'voiceLanguage', icon: Globe2, keywords: 'pronunciation voice audio spoken read aloud language English Español Français Deutsch Português idioma langue sprache' },
  { id: 'memory', icon: Brain, keywords: 'remember notes personalization opt out saved preferences' },
  { id: 'privacyData', icon: ShieldCheck, keywords: 'privacy history delete clear cookies import export saved chats' },
  { id: 'connections', icon: Plug2, keywords: 'oauth apps gmail vercel permissions tools integrations plugins disconnect' },
] as const;
export type SettingsCategory = typeof categories[number]['id'];
const normalize = (text: string) => text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim();

function Row({ name, description, id, children }: { name: string; description?: string; id?: string; children: ReactNode }) {
  return <div className="settings-row"><div>{id ? <label className="settings-row-title" htmlFor={id}>{name}</label> : <strong>{name}</strong>}{description && <p>{description}</p>}</div><div className="settings-value">{children}</div></div>;
}
function Switch({ id, checked, disabled, onChange }: { id: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  const t = useLabels();
  return <button type="button" id={id} className="settings-switch" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}><span>{t(checked ? 'on' : 'off')}</span><i aria-hidden="true" /></button>;
}

type Props = {
  initial?: SettingsCategory; initialProvider?: Provider; connectionFailed?: boolean; account: AccountStatus; canSignIn: boolean;
  theme: Theme; appearance: Appearance; prefs: WorkspacePreferences; onPrefs: (patch: WorkspacePreferences) => void;
  onAppearance: <K extends keyof Appearance>(key: K, value: Appearance[K]) => void; onTheme: (theme: Theme) => void;
  onClose: () => void; onAccount: () => void; onSignUp: () => void; onMemory: () => void; onMemoryChange: (value: boolean) => void;
  memory?: MemoryProfile; memoryPending: boolean; memoryError: string;
  count: number; canSearch: boolean; onImport?: () => void; onClear: () => Promise<void>; onShortcuts: () => void;
  voice: VoiceControls; voiceLanguage: Language; onSpeech: (id: string, text: string, language: Language) => void;
  onInsert: (result: string) => void;
};
export function SettingsDialog({ initial = 'account', initialProvider, connectionFailed, account, canSignIn, theme, appearance, prefs, onPrefs, onAppearance, onTheme, onClose, onAccount, onSignUp, onMemory, onMemoryChange,
  memory, memoryPending, memoryError, count, canSearch, onImport, onClear, onShortcuts, voice, voiceLanguage, onSpeech, onInsert }: Props) {
  const t = useLabels();
  const [tab, setTab] = useState(initial);
  const [query, setQuery] = useState('');
  const [name, setName] = useState(prefs.nickname ?? '');
  const [confirm, setConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  const term = normalize(query);
  const items = categories.filter(({ id, keywords }) => !term || term.split(/\s+/).every((word) => normalize(`${t(id)} ${keywords}`).includes(word)));
  const selected = items.find(({ id }) => id === tab)?.id ?? items[0]?.id;
  const user = account.user;
  useEffect(() => { if (panel.current) panel.current.scrollTop = 0; }, [selected]);
  useEffect(() => { if (selected !== 'voiceLanguage' && voice.speaking === 'test') voice.stop(); }, [selected, voice.speaking]);
  return <Dialog title={t('settings')} className="settings-dialog" onClose={() => { if (!clearing) onClose(); }}>
    <div className="settings-layout">
      <nav ref={nav} className="settings-nav" aria-label={t('settings')}>
        <label className="settings-search"><Search size={16} /><input type="search" aria-label={t('findSettings')} placeholder={t('findSettings')} value={query} maxLength={90}
          onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || !items.length) return;
            if (event.key === 'ArrowDown') { event.preventDefault(); nav.current?.querySelector('button')?.focus(); }
            else if (event.key === 'Enter' && selected) { setTab(selected); setQuery(''); panel.current?.focus(); }
          }} /></label>
        <div className="settings-categories">{items.map(({ id, icon: Icon }) => <button type="button" key={id} aria-current={selected === id ? 'page' : undefined} aria-controls="settings-content"
          onClick={() => { if (!clearing) { setTab(id); setQuery(''); } }}><Icon size={16} /><span>{t(id)}</span></button>)}</div>
        {!items.length && <p className="settings-no-match" role="status">{t('noSettings')}</p>}
      </nav>
      <div ref={panel} className="settings-content" id="settings-content" tabIndex={-1}>
        {selected && <h3 className="settings-heading">{t(selected === 'account' ? 'profile' : selected)}</h3>}
        {selected === 'account' && <>
          <Row name={user ? t('yourAccount') : t('guest')} description={user ? 'Settings and saved chats sync with this account.' : 'Chats and preferences stay in this browser.'}>
            <span className="settings-avatar" aria-hidden="true">{user?.name.trim() ? Array.from(user.name.trim())[0].toLocaleUpperCase() : <UserRound size={18} />}</span>
          </Row>
          {user && <><Row name={t('name')}><span className="settings-readonly">{user.name || 'Not provided'}</span></Row>
            <Row name={t('email')}><span className="settings-readonly">{user.email || 'Not shared by sign-in provider'}</span></Row></>}
          <form onSubmit={(event) => { event.preventDefault(); const normalized = name.trim(); onPrefs({ nickname: normalized }); setName(normalized); }}>
            <Row name={t('nickname')} id="settings-name" description="This name appears in your workspace greeting.">
              <div className="settings-inline"><input id="settings-name" className="plugin-input" maxLength={40} value={name} placeholder={user?.name.split(/\s+/)[0] || 'Optional'} onChange={(event) => setName(event.target.value)} />
                <button type="submit" className="secondary-button" disabled={name.trim() === (prefs.nickname ?? '')}>{t('save')}</button></div>
            </Row>
          </form>
          <Row name={user ? 'Sign-in & security' : 'Account access'} description={user ? 'Manage sign-out and account deletion.' : canSignIn ? 'Sign in to sync chats and settings across devices.' : 'Account sign-in and verification are not configured in this workspace.'}>
            {user ? <button type="button" className="secondary-button" onClick={onAccount}>Manage account <ChevronRight size={14} /></button> : canSignIn ? <div className="settings-inline">
              <button type="button" className="secondary-button" onClick={onAccount}>{t('signIn')}</button><button type="button" className="primary-button" onClick={onSignUp}>{t('signUp')}</button></div> : null}
          </Row>
          {user && account.sessions && <SessionSettings account={user.id} />}
        </>}
        {selected === 'appearance' && <>
          <Row name={t('theme')}><div className="settings-inline">{(['light', 'dark'] as const).map((value) => <button type="button" key={value} className={`theme-choice${value === theme ? ' active' : ''}`} aria-pressed={value === theme} onClick={() => onTheme(value)}>{t(value)}</button>)}</div></Row>
          <Row name="Accent" id="settings-accent" description="Orange is the Xyvora default."><select id="settings-accent" className="plugin-input" value={appearance.accent} onChange={({ target }) => { const next = APPEARANCE.accent.find((accent) => accent === target.value); if (next) onAppearance('accent', next); }}>{APPEARANCE.accent.map((accent) => <option value={accent} key={accent}>{accent[0].toUpperCase() + accent.slice(1)}</option>)}</select></Row>
          <Row name="Density" id="settings-density"><select id="settings-density" className="plugin-input" value={appearance.density} onChange={({ target }) => onAppearance('density', target.value === 'compact' ? 'compact' : 'comfortable')}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></Row>
          <Row name="Text size" id="settings-size"><select id="settings-size" className="plugin-input" value={appearance.textSize} onChange={({ target }) => onAppearance('textSize', target.value === 'large' ? 'large' : 'regular')}><option value="regular">Regular</option><option value="large">Large</option></select></Row>
          <Row name="Workspace font" id="settings-font"><select id="settings-font" className="plugin-input" value={appearance.font} onChange={({ target }) => onAppearance('font', target.value === 'system' ? 'system' : 'xyvora')}><option value="xyvora">Xyvora Sans</option><option value="system">System UI</option></select></Row>
          <button type="button" className="secondary-button settings-after" aria-keyshortcuts="?" onClick={onShortcuts}><Keyboard size={15} /> Keyboard shortcuts</button>
        </>}
        {selected === 'replies' && <>
          <p className="settings-intro">Choose a model in the composer. Effort sets a response budget and, on supported models, how much extra reasoning they can do. It isn’t a fixed wait time.</p>
          <Row name="Default effort" id="settings-effort" description="Low skips extra deliberation where supported. Higher levels allow more work."><select id="settings-effort" className="plugin-input" value={prefs.effort ?? DEFAULT_EFFORT} onChange={({ target }) => { if (isEffort(target.value)) onPrefs({ effort: target.value }); }}>{EFFORT_IDS.map((id) => <option key={id} value={id}>{EFFORTS[id].label}</option>)}</select></Row>
          <Row name="Default reply mode" id="settings-style" description="Reply style is separate from model and effort."><select id="settings-style" className="plugin-input" value={prefs.mode ?? DEFAULT_MODE} onChange={({ target }) => { if (isReplyMode(target.value)) onPrefs({ mode: target.value }); }}>{MODE_IDS.map((id) => <option key={id} value={id}>{MODES[id].name}</option>)}</select></Row>
          <Row name={t('autoSearch')} id="settings-search-switch" description={canSearch ? 'Xyvora looks up current facts and sources when useful. SearXNG receives only the selected query, not chat history, notes, or attachments.' : 'SearXNG is not configured in this workspace. This preference takes effect when search is available.'}>
            <Switch id="settings-search-switch" checked={prefs.autoSearch !== false} onChange={(autoSearch) => onPrefs({ autoSearch })} />
          </Row>
          <p className="settings-intro settings-after">Search references are snippets, not full pages. Open the numbered sources to check important details.</p>
        </>}
        {selected === 'voiceLanguage' && <>
          <Row name={t('uiLanguage')} id="settings-language"><select id="settings-language" className="plugin-input" value={prefs.language ?? 'en'} onChange={({ target }) => { if (isLanguage(target.value)) onPrefs({ language: target.value }); }}>{Object.entries(LANGUAGES).map(([id, { name }]) => <option value={id} key={id}>{name}</option>)}</select></Row>
          <Row name={t('replyLanguage')} id="settings-reply-language"><select id="settings-reply-language" className="plugin-input" value={prefs.replyLanguage ?? 'interface'} onChange={({ target }) => { if (target.value === 'interface' || isReplyLanguage(target.value)) onPrefs({ replyLanguage: target.value }); }}>
            <option value="interface">{t('matchApp')}</option><option value="auto">{t('matchPrompt')}</option>{Object.entries(LANGUAGES).map(([id, { name }]) => <option value={id} key={id}>{name}</option>)}
          </select></Row>
          <Row name={t('voice')} id="settings-voice" description={`${LANGUAGES[voiceLanguage].name} · ${t('local')}`}>
            <select id="settings-voice" className="plugin-input" disabled={!voice.choices.length} value={voice.favorite} onChange={({ target }) => voice.select(target.value)}>
              <option value="">{t('autoVoice')}</option>{voice.choices.map((choice) => <option value={choice.voiceURI} key={choice.voiceURI}>{choice.name} ({choice.lang})</option>)}
            </select>
          </Row>
          <div className="settings-voice-actions"><p className="form-hint">{voice.choices.length ? t('voiceHelp') : t('noVoice')}</p>
            <button type="button" className="secondary-button" disabled={!voice.choices.length} onClick={() => voice.speaking === 'test' ? voice.stop() : onSpeech('test', voiceSamples[voiceLanguage], voiceLanguage)}><Volume2 size={15} /> {t(voice.speaking === 'test' ? 'stopSpeech' : 'previewVoice')}</button></div>
        </>}
        {selected === 'memory' && <>
          <Row name={t('useMemory')} description={t('noteMemory')} id="settings-memory"><Switch id="settings-memory" checked={memory?.enabled === true} disabled={!memory || memoryPending} onChange={onMemoryChange} /></Row>
          {!memory && !memoryError && <p className="form-hint" role="status">Loading memory…</p>}
          {memoryError && <p className="plugin-error" role="alert">{memoryError}</p>}
          <Row name="Saved notes" description={user ? 'Notes sync with your Xyvora account. Turning memory off keeps the notes but stops using them.' : 'Notes stay on this device. Turning memory off keeps the notes but stops using them.'}>
            <button type="button" className="secondary-button" disabled={memoryPending} onClick={onMemory}>{t('manageMemory')}</button>
          </Row>
        </>}
        {selected === 'privacyData' && <>
          <Row name={user ? 'Cloud history' : 'Local history'} description={`${count} ${count === 1 ? 'conversation' : 'conversations'} ${user ? 'in your account' : 'on this device'}.`}>
            <button type="button" className="danger-button" disabled={!count || clearing} onClick={() => setConfirm(true)}><Trash2 size={15} /> Clear history</button>
          </Row>
          {confirm && <div className="confirm-box"><p>Delete all saved conversations {user ? 'from your account' : 'on this device'}? This can’t be undone.</p>
            <div><button type="button" className="secondary-button" disabled={clearing} onClick={() => { setConfirm(false); setClearError(''); }}>{t('cancel')}</button><button type="button" className="danger-button" disabled={clearing} onClick={() => {
              setClearing(true); setClearError('');
              void onClear().then(() => setConfirm(false)).catch((error: unknown) => setClearError(error instanceof Error ? error.message : 'Could not clear history.')).finally(() => setClearing(false));
            }}>{clearing ? 'Deleting…' : 'Delete all'}</button></div>{clearError && <p role="alert">{clearError}</p>}
          </div>}
          {onImport && <Row name="Older browser chats"><button type="button" className="secondary-button" onClick={onImport}>Import chats</button></Row>}
          <Row name="Data controls" description="Temporary chats aren’t saved to history. They can still be sent for a reply."><div className="settings-inline"><a className="secondary-button" href="/cookies">Cookie choices</a><a className="secondary-button" href="/privacy">Privacy policy</a></div></Row>
        </>}
        {selected === 'connections' && <AppConnections accountId={user?.id} canSignIn={canSignIn} initial={initialProvider} failed={connectionFailed} onAccount={onAccount} onInsert={onInsert} />}
      </div>
    </div>
  </Dialog>;
}
