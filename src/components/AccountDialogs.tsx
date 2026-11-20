import { ArrowUpRight, Brain, LogOut, Plus, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ACCOUNT_PROVIDERS } from '../../shared/account.ts';
import type { AccountStatus } from '../../shared/account.ts';
import { MAX_MEMORY_CHARS, MAX_MEMORY_NOTE, MAX_MEMORY_NOTES, parseMemory, parseMemoryNotes } from '../../shared/memory.ts';
import type { MemoryProfile } from '../../shared/memory.ts';
import { deleteAccount, passwordSignIn, saveMemory, signOut, startSignIn } from '../lib/account.ts';
import { Dialog } from './Dialog.tsx';

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef<AbortController | null>(null);
  useEffect(() => () => ref.current?.abort(), []);
  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (ref.current) return;
    const controller = new AbortController();
    ref.current = controller; setBusy(true); setError('');
    try { await work(controller.signal); }
    catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'The action did not complete.'); }
    finally { ref.current = null; if (!controller.signal.aborted) setBusy(false); }
  }
  return { busy, error, run };
}

export function AccountDialog({ account, error, onRetry, onClose, onMemory }: {
  account: AccountStatus; error?: string; onRetry: () => void; onClose: () => void; onMemory: () => void;
}) {
  const task = useAction();
  const [register, setRegister] = useState(false);
  const [remove, setRemove] = useState(false);
  return <Dialog title={account.user ? 'Your Xyvora account' : 'Sign in or create an account'}
    subtitle="Accounts are optional. You can keep using chat as a guest." onClose={() => { if (!task.busy) onClose(); }}>
    {account.user ? <>
      <div className="identity-card"><span className="plugin-icon tint-violet"><UserRound size={20} /></span><div>
        <strong>{account.user.name || 'Signed in'}</strong>{account.user.email && <p>{account.user.email}</p>}
      </div></div>
      <p className="form-hint">Your account syncs saved memory notes. Chats are kept separately for each workspace in this browser; they don’t sync or get erased when you sign out.</p>
      <div className="dialog-actions account-actions">
        <button type="button" className="secondary-button" onClick={onMemory} disabled={task.busy}><Brain size={15} /> Manage memory</button>
        <button type="button" className="secondary-button" onClick={() => void task.run((signal) => signOut(account.user!.id, signal))} disabled={task.busy}><LogOut size={15} /> Sign out</button>
        <button type="button" className="text-button" disabled={task.busy} onClick={() => setRemove(!remove)} aria-expanded={remove}>Delete account</button>
      </div>
      {remove && <div className="confirm-box"><p>Delete your Xyvora account, synced notes, background tasks, and all sessions? This also clears this account’s chats in this browser, but not browser storage on other devices. This can’t be undone.</p>
        <div><button type="button" className="secondary-button" disabled={task.busy} onClick={() => setRemove(false)}>Cancel</button>
          <button type="button" className="danger-button" disabled={task.busy} onClick={() => void task.run((signal) => deleteAccount(account.user!.id, signal))}><Trash2 size={15} /> Delete permanently</button></div>
      </div>}
    </> : account.providers.length || account.passwords ? <>
      {account.providers.length > 0 && <>
        <p className="form-hint">Choose a provider to sign in or create your Xyvora account on your first visit. Finish unsent drafts first. Signing in doesn’t connect Gmail, GitHub repositories, or other tools.</p>
        <div className="provider-options">
          {account.providers.map((provider) => <button className="provider-option" type="button" key={provider} disabled={task.busy}
            onClick={() => void task.run((signal) => startSignIn(provider, signal))}>
            <span className="provider-mark" aria-hidden="true">{ACCOUNT_PROVIDERS[provider].slice(0, 1)}</span>
            <strong>Continue with {ACCOUNT_PROVIDERS[provider]}</strong><ArrowUpRight size={15} />
          </button>)}
        </div>
      </>}
      {account.passwords && <form className="plugin-fields password-form" onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        void task.run((signal) => passwordSignIn(String(fields.get('username')), String(fields.get('password')), register, signal));
      }}>
        <label className="field-label">Username<input className="plugin-input" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={24} pattern="[A-Za-z0-9][A-Za-z0-9_\-]{2,23}" required disabled={task.busy} /></label>
        <label className="field-label">Password<input className="plugin-input" name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={12} maxLength={128} required disabled={task.busy} /></label>
        {register && <p className="form-hint">Choose 3–24 letters, numbers, underscores, or dashes for your username and at least 12 characters for your password. Password recovery is not available.</p>}
        <div className="dialog-actions"><button type="button" className="text-button" disabled={task.busy} onClick={() => setRegister(!register)}>{register ? 'Use an existing account' : 'Create an account'}</button>
          <button type="submit" className="plugin-primary" disabled={task.busy}>{task.busy ? 'Working…' : register ? 'Create Xyvora account' : 'Sign in with password'}</button></div>
      </form>}
      <p className="form-hint">By creating an account, you agree to the <a href="/terms">Terms of Use</a>. Read the <a href="/privacy">Privacy Policy</a>.</p>
    </> : <p className="plugin-notice"><ShieldCheck size={16} /> {error || 'Sign-in is not configured on this deployment. Guest chat and on-device memory still work.'}</p>}
    {error && !account.user && <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onRetry}>Check sign-in again</button></div>}
    {task.error && <p className="plugin-error" role="alert">{task.error}</p>}
  </Dialog>;
}

export function MemoryDialog({ profile, accountId, error, initial, onSave, onReload, onClose }: {
  profile?: MemoryProfile; accountId?: string; error?: string; initial?: string; onSave: (profile: MemoryProfile) => void; onReload: () => void; onClose: () => void;
}) {
  const task = useAction();
  const [enabled, setEnabled] = useState(profile?.enabled ?? false);
  const [notes, setNotes] = useState(() => {
    const items = profile?.notes ?? [];
    return initial && items.length < MAX_MEMORY_NOTES ? [...items, initial] : items;
  });
  const validated = parseMemory({ enabled, notes });
  return <Dialog title="Memory" subtitle={accountId ? 'Your notes sync with this Xyvora account.' : 'Guest notes are stored in this browser only.'} onClose={() => { if (!task.busy) onClose(); }}>
    {!profile ? <>
      <p className="plugin-notice" role="status"><Brain size={16} /> {error || 'Loading account memory…'}</p>
      {error && <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onReload}>Retry</button></div>}
    </> : <form className="memory-form" onSubmit={(event) => {
      event.preventDefault();
      if (!validated) return;
      void task.run(async (signal) => {
        const saved = await saveMemory(validated, accountId, signal);
        signal.throwIfAborted(); onSave(saved);
      });
    }}>
      <p className="plugin-notice"><ShieldCheck size={17} /> You decide what to save. Enabled notes can be used in ordinary replies, not Temporary Chat, This message only, image analysis, or explicit translation. Avoid secrets or sensitive details.</p>
      <label className="memory-toggle"><input type="checkbox" checked={enabled} disabled={task.busy} onChange={({ target }) => setEnabled(target.checked)} /> Use saved notes in replies</label>
      {initial && profile.notes.length >= MAX_MEMORY_NOTES && <p className="form-hint">Remove an existing note before adding another.</p>}
      {notes.map((note, index) => <div className="memory-row" key={index}>
        <input className="plugin-input" aria-label={`Memory note ${index + 1}`} data-dialog-focus={initial && index === notes.length - 1 || undefined} value={note}
          maxLength={MAX_MEMORY_NOTE} disabled={task.busy} placeholder="Example: Prefer concise explanations."
          onChange={({ target }) => setNotes((current) => current.map((item, i) => i === index ? target.value : item))} />
        <button type="button" className="icon-button" aria-label={`Remove memory note ${index + 1}`} disabled={task.busy}
          onClick={() => setNotes((current) => current.filter((_, i) => i !== index))}><Trash2 size={16} /></button>
      </div>)}
      {!parseMemoryNotes(notes) && <p className="plugin-error" role="alert">Keep notes to {MAX_MEMORY_CHARS.toLocaleString()} characters total, without control characters.</p>}
      <div className="memory-tools">
        <button type="button" className="secondary-button" onClick={() => setNotes((items) => [...items, ''])} disabled={task.busy || notes.length >= MAX_MEMORY_NOTES}><Plus size={15} /> Add note</button>
        {notes.length > 0 && <button type="button" className="text-button" disabled={task.busy} onClick={() => { setNotes([]); setEnabled(false); }}>Clear notes</button>}
        <span className="form-hint">{notes.length} / {MAX_MEMORY_NOTES} notes</span>
      </div>
      {task.error && <p className="plugin-error" role="alert">{task.error}</p>}
      <div className="dialog-actions">
        <button type="button" className="secondary-button" onClick={onClose} disabled={task.busy}>Cancel</button>
        <button type="submit" className="plugin-primary" disabled={task.busy || !validated}>{task.busy ? 'Saving…' : 'Save memory'}</button>
      </div>
    </form>}
  </Dialog>;
}
