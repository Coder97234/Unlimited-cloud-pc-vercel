import { useEffect, useRef, useState } from 'react';
import { isAccountId } from '../../shared/account.ts';
import { accountJson } from '../lib/account.ts';

type Session = { id: string; createdAt: number | null; expiresAt: number; current: boolean };
const endpoint = '?section=sessions';
const stamp = (time: number) => new Date(time).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
export function SessionSettings({ account }: { account: string }) {
  const [sessions, setSessions] = useState<Session[]>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [retry, setRetry] = useState(0);
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    accountJson(endpoint, controller.signal, undefined, account).then(({ sessions: rows }) => {
      if (!Array.isArray(rows) || !rows.every((row: Session) => isAccountId(row?.id) && Number.isFinite(row.expiresAt) && (row.createdAt === null || Number.isFinite(row.createdAt)) && typeof row.current === 'boolean')) throw new Error('Could not verify active sessions.');
      if (!controller.signal.aborted) setSessions(rows);
    }).catch((problem) => { if (!controller.signal.aborted) setError(problem.message); });
    return () => controller.abort();
  }, [account, retry]);
  async function revoke(id?: string) {
    if (request.current) return;
    const controller = request.current = new AbortController();
    setPending(true); setError(''); setNotice('');
    try {
      const outcome = await accountJson(endpoint, controller.signal, id ? { action: 'revoke', id } : { action: 'revoke-others', confirm: 'REVOKE' }, account);
      controller.signal.throwIfAborted();
      if (outcome.revoked !== true) throw new Error('Session revocation was not confirmed.');
      setSessions((items) => items?.filter((item) => id ? item.id !== id : item.current));
      setConfirm(false); setNotice(id ? 'Session revoked.' : 'Other sessions revoked.');
    } catch (problem) { if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : 'Could not revoke the session.'); }
    finally { if (!controller.signal.aborted) { request.current = undefined; setPending(false); } }
  }
  return <section className="settings-section"><h3>Active sessions</h3>
    <p className="form-hint">Device and location tracking are not used. Signing out here does not sign out other devices.</p>
    {error && <p className="plugin-error" role="alert">{error} <button type="button" className="text-button" onClick={() => { setError(''); setRetry((value) => value + 1); }}>Reload</button></p>}
    {notice && <p className="form-hint" role="status">{notice}</p>}
    {!sessions && !error && <p role="status">Loading sessions…</p>}
    {sessions && <ul className="session-list">{sessions.map((entry) => <li key={entry.id}><div><strong>{entry.current ? 'This session' : 'Other session'}</strong>
      <small>{entry.createdAt ? `Started ${stamp(entry.createdAt)} · ` : ''}Expires {stamp(entry.expiresAt)}</small></div>
      {!entry.current && <button type="button" className="secondary-button" disabled={pending} onClick={() => void revoke(entry.id)}>Revoke</button>}</li>)}</ul>}
    {sessions?.some(({ current }) => !current) && (confirm ? <div className="confirm-box"><p>Sign out every other session? This browser stays signed in.</p><div><button type="button" className="secondary-button" disabled={pending} onClick={() => setConfirm(false)}>Cancel</button>
      <button type="button" className="danger-button" disabled={pending} onClick={() => void revoke()}>Confirm revocation</button></div></div>
      : <button type="button" className="secondary-button" disabled={pending} onClick={() => setConfirm(true)}>Revoke all other sessions</button>)}
  </section>;
}
