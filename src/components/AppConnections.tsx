import { ArrowLeft, ArrowUpRight, Check, Mail, Plug, ShieldCheck, Triangle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PLUGINS, VERCEL_TEAM_SLUG, WORKSPACE_AUTH_PATHS } from '../../shared/workspace-tools.ts';
import type { ConnectionStatus, Provider } from '../../shared/workspace-tools.ts';
import { WorkspaceError } from '../lib/workspace-api.ts';

const path = '/api/workspace?feature=connections';
const apps = ['gmail', 'vercel'] as const;
type Action = 'connect' | 'disconnect' | 'inbox' | 'profile' | 'projects';
const permissions = {
  gmail: 'Subject, sender, and date for up to five inbox messages. No email bodies, attachments, drafts, or sending.',
  vercel: 'Your profile and up to eight accessible project names and frameworks. No deployments, project edits, environment variables, or secrets.',
};
const operationLabel: Record<Action, string> = {
  connect: 'Connect', disconnect: 'Disconnect', inbox: 'Read recent inbox headers', profile: 'Read profile', projects: 'List projects',
};
const isStatus = (value: unknown): value is ConnectionStatus => value === 'unconfigured' || value === 'connected' || value === 'disconnected';

async function connectionRequest(id: string, signal: AbortSignal, input?: object) {
  const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.any([signal, AbortSignal.timeout(19_000)]),
    headers: { 'X-Xyvora-Account': id, ...(input && { 'Content-Type': 'application/json' }) },
    ...(input && { method: 'POST', body: JSON.stringify({ ...input, approved: true }) }) });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new WorkspaceError(typeof result?.error === 'string' ? result.error : 'Could not reach app connections.', response.status);
  return result;
}

export function AppConnections({ accountId, canSignIn, initial, failed, onAccount, onInsert }: {
  accountId?: string; canSignIn: boolean; initial?: Provider; failed?: boolean; onAccount: () => void; onInsert: (result: string) => void;
}) {
  const [status, setStatus] = useState<Record<Provider, ConnectionStatus>>();
  const [active, setActive] = useState<Provider | undefined>(initial);
  const [approve, setApprove] = useState<Action>();
  const [result, setResult] = useState('');
  const [team, setTeam] = useState('');
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(failed && initial ? `Couldn’t connect ${PLUGINS[initial].name}. Review consent and try again.` : '');
  const work = useRef<AbortController | null>(null);
  useEffect(() => () => work.current?.abort(), []);
  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    void connectionRequest(accountId, controller.signal).then(({ connections }) => {
      if (!isStatus(connections?.gmail) || !isStatus(connections?.vercel)) throw new Error('Could not check connection status.');
      if (!controller.signal.aborted) setStatus(connections);
    }).catch((problem: unknown) => {
      if (controller.signal.aborted) return;
      if (problem instanceof WorkspaceError && (problem.status === 404 || problem.status === 503)) setStatus({ gmail: 'unconfigured', vercel: 'unconfigured' });
      else setError(problem instanceof Error ? problem.message : 'Could not check connection status.');
    });
    return () => controller.abort();
  }, [accountId, reload]);
  function choose(provider?: Provider) {
    setActive(provider); setApprove(undefined); setResult(''); setTeam(''); setNotice(''); setError('');
  }
  async function perform() {
    if (!accountId || !active || !approve || work.current) return;
    const selected = approve;
    const provider = active;
    if (selected === 'projects' && team.trim() && !VERCEL_TEAM_SLUG.test(team.trim())) { setError('Enter a valid team slug or leave it blank.'); return; }
    const controller = work.current = new AbortController();
    setPending(true); setError(''); setNotice(''); setResult('');
    try {
      const data = await connectionRequest(accountId, controller.signal, selected === 'connect' || selected === 'disconnect'
        ? { action: selected, provider } : { action: 'account', provider, operation: selected, ...(selected === 'projects' && team.trim() && { teamSlug: team.trim() }) });
      controller.signal.throwIfAborted();
      if (selected === 'connect') {
        const url = new URL(data.url), allowed = new URL(WORKSPACE_AUTH_PATHS[provider]);
        if (url.origin !== allowed.origin || url.pathname !== allowed.pathname || url.username || url.password) throw new Error('Invalid provider consent page.');
        // Never navigate to provider data or arbitrary links returned by a tool.
        window.location.assign(url.href);
        return;
      }
      if (selected === 'disconnect') {
        if (data.disconnected !== true) throw new Error('Disconnect could not be confirmed.');
        setStatus((current) => current && { ...current, [provider]: 'disconnected' });
        setNotice(data.revoked === true ? `${PLUGINS[provider].name} disconnected.` : 'Disconnected here. To remove the grant at the provider, review permissions there.');
      } else {
        const text = JSON.stringify(data, null, 2);
        if (!text || text.length > 7_500) throw new Error('The app returned more data than this view can display.');
        setResult(text);
      }
      setApprove(undefined);
    } catch (problem) {
      if (!controller.signal.aborted) {
        setError(problem instanceof Error ? problem.message : 'The app action could not be completed.');
        if (problem instanceof WorkspaceError && problem.status === 401) {
          setStatus((current) => current && { ...current, [provider]: 'disconnected' });
          setApprove(undefined);
        }
      }
    } finally { work.current = null; if (!controller.signal.aborted) setPending(false); }
  }
  const state = active && status?.[active];
  return <div className="connection-settings">
    <p className="settings-intro">Connect apps to bring selected data into a conversation. Xyvora asks before every read. Nothing is posted, sent, or deployed.</p>
    {!accountId ? <div className="settings-row"><div><strong>Sign in to manage app connections</strong><p>Connections belong to your current Xyvora session.</p></div>{canSignIn && <button type="button" className="secondary-button" onClick={onAccount}>Sign in</button>}</div>
      : !status ? <p role={error ? 'alert' : 'status'}>{error || 'Checking app connections…'} {error && <button type="button" className="text-button" onClick={() => { setError(''); setReload((n) => n + 1); }}>Retry</button>}</p>
        : !active ? <div className="connection-list">{apps.map((provider) => {
          const Icon = provider === 'gmail' ? Mail : Triangle;
          const state = status[provider];
          return <div key={provider} className="settings-row"><div className="connection-name"><span className="connection-icon"><Icon size={16} /></span><div><strong>{PLUGINS[provider].name}</strong><p>{state === 'connected' ? 'Connected to this session' : state === 'unconfigured' ? 'Not configured on this workspace' : 'Not connected'}</p></div></div>
            <button type="button" className="secondary-button" onClick={() => choose(provider)}>{state === 'unconfigured' ? 'Details' : state === 'connected' ? 'Manage' : 'Connect'}<ArrowUpRight size={13} /></button></div>;
        })}</div> : <section aria-label={`${PLUGINS[active].name} connection`}>
          <button type="button" className="text-button connection-back" disabled={pending} onClick={() => choose()}><ArrowLeft size={15} /> All connections</button>
          <div className="settings-row"><div><strong>{PLUGINS[active].name}</strong><p>{permissions[active]}</p></div><span className={`connection-state ${state ?? ''}`}>{state === 'connected' ? <><Check size={13} /> Connected</> : state === 'unconfigured' ? 'Not configured' : 'Not connected'}</span></div>
          {state === 'unconfigured' && <p className="settings-intro">This app needs a provider OAuth client registered for this workspace. Arena connections don’t grant access to Xyvora.</p>}
          {state === 'disconnected' && !approve && <button type="button" className="primary-button" onClick={() => setApprove('connect')}><Plug size={15} /> Connect {PLUGINS[active].name}</button>}
          {state === 'connected' && !approve && <div className="connection-actions">{(active === 'gmail' ? ['inbox', 'disconnect'] : ['profile', 'projects', 'disconnect'] as const).map((action) => <button key={action} type="button" className="secondary-button" onClick={() => { setApprove(action as Action); setError(''); setNotice(''); setResult(''); }}>{operationLabel[action as Action]}</button>)}</div>}
          {approve && <div className="confirm-box"><strong>{approve === 'connect' ? `Connect ${PLUGINS[active].name}?` : approve === 'disconnect' ? `Disconnect ${PLUGINS[active].name}?` : `${operationLabel[approve]}?`}</strong>
            <p>{approve === 'connect' ? 'You’ll review access at the provider first. Finish any unsent draft before leaving this page.' : approve === 'disconnect' ? 'Clear this browser’s connection and ask the provider to revoke access.' : 'Only the result below will be displayed. It is not sent to a model unless you explicitly add it and send a message.'}</p>
            {approve === 'projects' && <label className="field-label">Team slug (optional)<input value={team} maxLength={62} disabled={pending} className="plugin-input" onChange={(event) => setTeam(event.target.value)} /></label>}
            <div><button className="secondary-button" type="button" disabled={pending} onClick={() => { setApprove(undefined); setError(''); }}>Cancel</button>
              <button className={approve === 'disconnect' ? 'danger-button' : 'primary-button'} type="button" disabled={pending} onClick={() => void perform()}>{pending ? 'Working…' : approve === 'connect' ? `Continue to ${PLUGINS[active].name}` : approve === 'disconnect' ? 'Confirm disconnect' : 'Approve this read'}</button></div>
          </div>}
          {error && <p className="plugin-error" role="alert">{error}</p>}{notice && <p className="form-hint" role="status">{notice}</p>}
          {result && <div className="connection-result"><pre tabIndex={0}>{result}</pre><button type="button" className="secondary-button" onClick={() => onInsert(result)}>Add result to chat draft</button></div>}
        </section>}
    <div className="dialog-note"><ShieldCheck size={16} /> OAuth 2.0 · Read-only permissions · Connections expire after at most one hour and aren’t synced to other devices.</div>
  </div>;
}
