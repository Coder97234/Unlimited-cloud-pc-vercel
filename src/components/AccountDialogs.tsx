import { ArrowUpRight, Brain, LogOut, Plus, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ACCOUNT_PROVIDERS, EMAIL_CODE_LENGTH, EMAIL_CODE_MINUTES, EMAIL_RESEND_SECONDS } from '../../shared/account.ts';
import type { AccountLink, AccountStatus, EmailPurpose } from '../../shared/account.ts';
import { MAX_ACCOUNT_MEMORY_CHARS, MAX_ACCOUNT_MEMORY_NOTES, MAX_MEMORY_CHARS, MAX_MEMORY_NOTE, MAX_MEMORY_NOTES, parseMemory, parseMemoryNotes } from '../../shared/memory.ts';
import type { MemoryProfile } from '../../shared/memory.ts';
import { deleteAccount, finishAccountEmail, passwordSignIn, requestAccountEmail, saveMemory, signOut, startSignIn, supabaseEmail } from '../lib/account.ts';
import { Dialog } from './Dialog.tsx';
import { SessionSettings } from './SessionSettings.tsx';

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
  return { busy, error, run, clear: () => setError('') };
}

export function AccountDialog({ account, error, unsynced, initialView, onRetry, onClose, onMemory }: {
  account: AccountStatus; error?: string; unsynced: boolean; initialView?: 'signup'; onRetry: () => void; onClose: () => void; onMemory: () => void;
}) {
  const task = useAction();
  const [view, setView] = useState<'login' | 'signup' | 'reset'>(initialView ?? 'login');
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState('');
  const [legacy, setLegacy] = useState(false);
  const auth = legacy ? undefined : account.supabase;
  const providers = auth?.providers ?? account.providers;
  const passwords = auth?.passwords ?? account.passwords;
  const codeMode = !!auth || account.emailVerification === 'code';
  const awaitingCode = passwords && codeMode && sent;
  const purpose = view === 'reset' ? 'reset' : 'signup';
  function show(next: typeof view) { setView(next); setSent(false); task.clear(); }
  const [showSessions, setShowSessions] = useState(false);
  const [remove, setRemove] = useState(false);
  return <Dialog title={account.user ? 'Your Xyvora account' : awaitingCode ? 'Check your email' : view === 'reset' ? 'Reset your password' : passwords || providers.length ? view === 'signup' ? 'Create a Xyvora account' : 'Sign in to Xyvora' : 'Guest workspace'}
    subtitle={account.user ? 'Manage your sign-in and saved workspace.' : 'Sign-in is optional. Guest chats stay on this device.'} onClose={() => { if (!task.busy) onClose(); }}>
    {account.user ? <>
      <div className="identity-card"><span className="plugin-icon tint-orange"><UserRound size={20} /></span><div>
        <strong>{account.user.name || 'Signed in'}</strong>{account.user.email && <p>{account.user.email}</p>}
      </div></div>
      <p className="form-hint">Saved chats, workspace settings, and memory sync across devices signed in to this account. Guest and Temporary chats are not synced.</p>
      {unsynced && <p className="plugin-notice"><ShieldCheck size={16} /> Some chats haven’t synced yet. Wait for sync or export them before signing out.</p>}
      <div className="dialog-actions account-actions">
        <button type="button" className="secondary-button" onClick={onMemory} disabled={task.busy}><Brain size={15} /> Manage memory</button>
        <button type="button" className="secondary-button" onClick={() => void task.run((signal) => signOut(account.user!.id, signal))} disabled={task.busy}><LogOut size={15} /> Sign out</button>
        <button type="button" className="text-button" disabled={task.busy} onClick={() => setRemove(!remove)} aria-expanded={remove}>Delete account</button>
      </div>
      {account.sessions && <button type="button" className="secondary-button session-trigger" onClick={() => setShowSessions(!showSessions)} aria-expanded={showSessions}>{showSessions ? 'Hide active sessions' : 'Manage sessions'}</button>}
      {showSessions && account.sessions && <SessionSettings account={account.user.id} />}
      {remove && <div className="confirm-box"><p>Delete your Xyvora account, saved chats, settings, notes, background tasks, and all sessions? Previously exported files aren’t affected. This can’t be undone.</p>
        <div><button type="button" className="secondary-button" disabled={task.busy} onClick={() => setRemove(false)}>Cancel</button>
          <button type="button" className="danger-button" disabled={task.busy} onClick={() => void task.run((signal) => deleteAccount(account.user!.id, signal))}><Trash2 size={15} /> Delete permanently</button></div>
      </div>}
    </> : providers.length || passwords ? <>
      {providers.length > 0 && <>
        <p className="form-hint">Choose a provider to sign in or create your Xyvora account on your first visit. Finish unsent drafts first. This only signs you in to Xyvora.</p>
        <div className="provider-options">
          {providers.map((provider) => <button className="provider-option" type="button" key={provider} disabled={task.busy}
            onClick={() => void task.run((signal) => startSignIn(provider, signal, auth))}>
            <span className="provider-mark" aria-hidden="true">{ACCOUNT_PROVIDERS[provider].slice(0, 1)}</span>
            <strong>Continue with {ACCOUNT_PROVIDERS[provider]}</strong><ArrowUpRight size={15} />
          </button>)}
        </div>
      </>}
      {auth && <p className="form-hint">Sign-in and verification are handled by Supabase Auth.</p>}
      {account.supabase && (account.passwords || account.providers.length > 0) && <button className="text-button" type="button" disabled={task.busy} onClick={() => { setLegacy(!legacy); show('login'); }}>
        {legacy ? 'Use Supabase sign-in' : 'Use existing Xyvora sign-in'}
      </button>}
      {passwords && <>
        {view !== 'reset' && <div className="theme-options auth-tabs" aria-label="Account action">
          <button type="button" className="theme-choice" aria-pressed={view === 'login'} disabled={task.busy} onClick={() => show('login')}>Sign in</button>
          <button type="button" className="theme-choice" aria-pressed={view === 'signup'} disabled={task.busy} onClick={() => show('signup')}>Sign up</button>
        </div>}
        {awaitingCode ? <>
          <p className="form-hint" role="status">{purpose === 'signup' ? 'If this address can be used to sign up, we’ll email a code.' : 'If this address has a password account, we’ll email a reset code.'} Use the latest code within {EMAIL_CODE_MINUTES} minutes.</p>
          {auth && purpose === 'signup' ? <form className="plugin-fields" onSubmit={(event) => {
            event.preventDefault(); const fields = new FormData(event.currentTarget);
            void task.run((signal) => supabaseEmail('confirm', email, signal, undefined, String(fields.get('code') ?? '')));
          }}>
            <label className="field-label">Verification code<input className="plugin-input" name="code" required pattern="[0-9]{6}" maxLength={6} inputMode="numeric" autoComplete="one-time-code" data-dialog-focus disabled={task.busy} /></label>
            <div className="dialog-actions"><button type="submit" className="plugin-primary" disabled={task.busy}>Verify and sign in</button></div>
          </form> : <AccountPasswordForm challenge={{ purpose, email }} task={task} supabase={!!auth} />}
          <p className="form-hint">No email? Check spam or wait {EMAIL_RESEND_SECONDS} seconds before requesting another code.</p>
          <button type="button" className="text-button" disabled={task.busy} onClick={() => show(view)}>Change email or resend</button>
        </> : sent ? <div className="confirm-box" role="status">
          <p>{view === 'signup' ? 'If this address can be used to sign up, we’ll email a link to verify it and set your password.' : 'If this address has a password account, we’ll email a reset link.'} The link is valid for 30 minutes.</p>
          <button type="button" className="secondary-button" onClick={() => show('login')}>Back to sign in</button>
        </div> : <form className="plugin-fields password-form" key={view} onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          void task.run(async (signal) => {
            const password = String(fields.get('password') ?? '');
            if (auth) {
              if (view === 'signup' && password !== fields.get('confirm')) throw new Error('The passwords do not match.');
              await supabaseEmail(view === 'reset' ? 'recover' : view, email, signal, password || undefined);
              if (view !== 'login') { signal.throwIfAborted(); setSent(true); }
            } else if (view === 'login') await passwordSignIn(email, password, signal);
            else { await requestAccountEmail(purpose, email, signal); signal.throwIfAborted(); setSent(true); }
          });
        }}>
          <label className="field-label">Email<input className="plugin-input" name="email" type={view === 'login' ? 'text' : 'email'} inputMode="email" value={email}
            onChange={({ target }) => setEmail(target.value)} autoComplete={view === 'login' ? 'username' : 'email'} autoCapitalize="none" spellCheck={false} maxLength={254} required disabled={task.busy} data-dialog-focus={codeMode && view !== 'login' || undefined} /></label>
          {view === 'login' && <label className="field-label">Password<input className="plugin-input" name="password" type="password" autoComplete="current-password" maxLength={128} required disabled={task.busy} /></label>}
          {auth && view === 'signup' ? <><label className="field-label">Password<input className="plugin-input" name="password" type="password" minLength={12} maxLength={72} autoComplete="new-password" required disabled={task.busy} /></label>
            <label className="field-label">Confirm password<input className="plugin-input" name="confirm" type="password" autoComplete="new-password" maxLength={72} required disabled={task.busy} /></label>
            <p className="form-hint">Use at least 12 characters. You’ll need the verification code to finish creating this account.</p></>
            : view === 'signup' && <p className="form-hint">We’ll email a {codeMode ? 'code' : 'link'} to verify your address before you choose a password.</p>}
          <div className="dialog-actions">
            {view !== 'signup' && <button type="button" className="text-button" disabled={task.busy} onClick={() => show(view === 'reset' ? 'login' : 'reset')}>{view === 'reset' ? 'Back to sign in' : 'Forgot password?'}</button>}
            <button type="submit" className="plugin-primary" disabled={task.busy}>{task.busy ? 'Working…' : view === 'login' ? 'Sign in with password' : `Email ${purpose === 'signup' ? 'verification' : 'reset'} ${codeMode ? 'code' : 'link'}`}</button>
          </div>
        </form>}
      </>}
      <p className="form-hint">By creating an account, you agree to the <a href="/terms">Terms of Use</a>. Read the <a href="/privacy">Privacy Policy</a>.</p>
    </> : <p className="plugin-notice"><ShieldCheck size={16} /> {error || 'You can use chat, files, and on-device memory as a guest.'}</p>}
    {task.error && <p className="plugin-error" role="alert">{task.error}</p>}
    {!account.user && <div className="dialog-actions">
      <button type="button" className="text-button" onClick={onClose} disabled={task.busy}>Continue as guest</button>
      {error && <button type="button" className="secondary-button" onClick={onRetry}>Check sign-in again</button>}
    </div>}
  </Dialog>;
}

function AccountPasswordForm({ challenge, task, supabase }: { challenge: AccountLink | { purpose: EmailPurpose; email: string }; task: ReturnType<typeof useAction>; supabase?: boolean }) {
  const [mismatch, setMismatch] = useState(false);
  const signup = challenge.purpose === 'signup';
  return <form className="plugin-fields" onSubmit={(event) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const password = String(fields.get('password') ?? '');
    if (password !== fields.get('confirm')) { setMismatch(true); task.clear(); return; }
    setMismatch(false);
    const proof = 'email' in challenge ? { ...challenge, code: String(fields.get('code') ?? '') } : challenge;
    void task.run((signal) => supabase && 'email' in proof ? supabaseEmail('reset', proof.email, signal, password, proof.code) : finishAccountEmail(proof, password, signal));
  }}>
    {'email' in challenge && <label className="field-label">{signup ? 'Verification code' : 'Reset code'}<input className="plugin-input" name="code" type="text" inputMode="numeric"
      autoComplete="one-time-code" pattern={`[0-9]{${EMAIL_CODE_LENGTH}}`} minLength={EMAIL_CODE_LENGTH} maxLength={EMAIL_CODE_LENGTH} required disabled={task.busy} data-dialog-focus /></label>}
    <label className="field-label">New password<input className="plugin-input" autoComplete="new-password" type="password" name="password" minLength={12} maxLength={128} required disabled={task.busy} /></label>
    <label className="field-label">Confirm password<input className="plugin-input" autoComplete="new-password" type="password" name="confirm" minLength={12} maxLength={128} required disabled={task.busy} /></label>
    <p className="form-hint">Use 12–128 characters.</p>
    {mismatch && <p className="plugin-error" role="alert">The two passwords don’t match.</p>}
    <div className="dialog-actions"><button type="submit" className="plugin-primary" disabled={task.busy}>{signup ? 'Create account' : 'Save new password'}</button></div>
  </form>;
}

export function PasswordLinkDialog({ link, onClose }: { link: AccountLink; onClose: () => void }) {
  const task = useAction();
  const signup = link.purpose === 'signup';
  return <Dialog title={signup ? 'Set your Xyvora password' : 'Choose a new password'}
    subtitle={signup ? 'Complete your account setup.' : 'Resetting a password signs out the other sessions for that account.'}
    onClose={() => { if (!task.busy) onClose(); }}>
    <AccountPasswordForm challenge={link} task={task} />
    {task.error && <p className="plugin-error" role="alert">{task.error}</p>}
  </Dialog>;
}

export function MemoryDialog({ profile, accountId, error, initial, onSave, onReload, onClose }: {
  profile?: MemoryProfile; accountId?: string; error?: string; initial?: string; onSave: (profile: MemoryProfile) => void; onReload: () => void; onClose: () => void;
}) {
  const task = useAction();
  const maxNotes = accountId ? MAX_ACCOUNT_MEMORY_NOTES : MAX_MEMORY_NOTES;
  const maxChars = accountId ? MAX_ACCOUNT_MEMORY_CHARS : MAX_MEMORY_CHARS;
  const [enabled, setEnabled] = useState(profile?.enabled ?? false);
  const [notes, setNotes] = useState(() => {
    const items = profile?.notes ?? [];
    return initial && items.length < maxNotes ? [...items, initial] : items;
  });
  const validated = parseMemory({ enabled, notes }, !!accountId);
  return <Dialog title="Memory" subtitle={accountId ? 'Your notes sync across devices. Replies use a bounded selection of recent notes.' : 'Guest notes are stored in this browser only.'} onClose={() => { if (!task.busy) onClose(); }}>
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
      {initial && profile.notes.length >= maxNotes && <p className="form-hint">Remove an existing note before adding another.</p>}
      {notes.map((note, index) => <div className="memory-row" key={index}>
        <input className="plugin-input" aria-label={`Memory note ${index + 1}`} data-dialog-focus={initial && index === notes.length - 1 || undefined} value={note}
          maxLength={MAX_MEMORY_NOTE} disabled={task.busy} placeholder="Example: Prefer concise explanations."
          onChange={({ target }) => setNotes((current) => current.map((item, i) => i === index ? target.value : item))} />
        <button type="button" className="icon-button" aria-label={`Remove memory note ${index + 1}`} disabled={task.busy}
          onClick={() => setNotes((current) => current.filter((_, i) => i !== index))}><Trash2 size={16} /></button>
      </div>)}
      {!parseMemoryNotes(notes, !!accountId) && <p className="plugin-error" role="alert">Keep notes to {maxChars.toLocaleString()} characters total, without control characters.</p>}
      <div className="memory-tools">
        <button type="button" className="secondary-button" onClick={() => setNotes((items) => [...items, ''])} disabled={task.busy || notes.length >= maxNotes}><Plus size={15} /> Add note</button>
        {notes.length > 0 && <button type="button" className="text-button" disabled={task.busy} onClick={() => { setNotes([]); setEnabled(false); }}>Clear notes</button>}
        <span className="form-hint">{notes.length} / {maxNotes} notes</span>
      </div>
      {task.error && <p className="plugin-error" role="alert">{task.error}</p>}
      <div className="dialog-actions">
        <button type="button" className="secondary-button" onClick={onClose} disabled={task.busy}>Cancel</button>
        <button type="submit" className="plugin-primary" disabled={task.busy || !validated}>{task.busy ? 'Saving…' : 'Save memory'}</button>
      </div>
    </form>}
  </Dialog>;
}
