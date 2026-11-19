import { ArrowDownToLine, ArrowLeft, ArrowUpRight, Code2, Image, Link2, Mail, Play, Server, ShieldCheck, Terminal, Triangle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PLUGINS, PUBLIC_API_EXAMPLE, publicApiTarget } from '../../shared/workspace-tools.ts';
import type { ConnectionStatus, PluginId, PluginIntent, Provider, WorkspaceStatus } from '../../shared/workspace-tools.ts';
import { ART_STYLES, renderLocalArt } from '../lib/local-image.ts';
import type { ArtStyle } from '../lib/local-image.ts';
import { runScript } from '../lib/run-script.ts';
import type { ScriptOutput } from '../lib/sandbox-engine.ts';
import { approveTool, getWorkspace } from '../lib/workspace-api.ts';
import { Dialog } from './Dialog.tsx';

const icons = { script: Code2, image: Image, api: Server, gmail: Mail, vercel: Triangle };
const tints = { script: 'violet', image: 'peach', api: 'sky', gmail: 'peach', vercel: 'mint' };
const labels = { script: 'On this device', image: 'On this device', api: 'Public · GET only', gmail: 'Read-only', vercel: 'Read-only' };
const setupLinks = { gmail: 'https://myaccount.google.com/connections', vercel: 'https://vercel.com/account/settings/authentication' };
const all = Object.keys(PLUGINS) as PluginId[];

function useOperation() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef<AbortController | null>(null);
  useEffect(() => () => { ref.current?.abort(); ref.current = null; }, []);
  async function begin(task: (signal: AbortSignal) => Promise<void>) {
    if (ref.current) return;
    const controller = new AbortController();
    ref.current = controller;
    setBusy(true); setError('');
    try { await task(controller.signal); }
    catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'The tool could not complete.'); }
    finally { if (ref.current === controller) { ref.current = null; setBusy(false); } }
  }
  return { busy, error, begin, cancel: () => ref.current?.abort() };
}

type Operation = ReturnType<typeof useOperation>;
function RunButton({ task, label, onRun, disabled = false }: { task: Operation; label: string; onRun: () => void; disabled?: boolean }) {
  return <div className="plugin-run-row">
    <button type="button" className="plugin-primary" onClick={onRun} disabled={disabled || task.busy}>
      <Play size={16} /> {task.busy ? 'Working…' : label}
    </button>
    {task.busy && <button type="button" className="secondary-button" onClick={task.cancel}>Cancel</button>}
  </div>;
}

function Output({ content, label = 'Result', failed = false, onInsert }: { content: string; label?: string; failed?: boolean; onInsert?: (value: string) => void }) {
  return <div className={`plugin-output${failed ? ' plugin-output-error' : ''}`} aria-label={label}>
    <div className="plugin-output-title"><Terminal size={15} /><strong>{label}</strong>
      {onInsert && <button type="button" className="text-button" onClick={() => onInsert(content)}>Put in draft</button>}
    </div><pre tabIndex={0}>{content}</pre>
  </div>;
}
function ErrorNotice({ message }: { message: string }) { return message ? <p className="plugin-error" role="alert">{message}</p> : null; }

function ScriptLab({ initial, textInput, onInsert }: { initial?: string; textInput?: string; onInsert: (value: string) => void }) {
  const [code, setCode] = useState(initial ?? 'const items = [12, 19, 7, 33];\nconst total = items.reduce((sum, n) => sum + n, 0);\nconsole.log({ count: items.length, total });');
  const [include, setInclude] = useState(false);
  const [output, setOutput] = useState<ScriptOutput>();
  const task = useOperation();
  return <div className="plugin-fields">
    <p className="plugin-notice"><ShieldCheck size={17} /> Runs in a separate JavaScript engine with a time and memory limit. No terminal, packages, internet, or account credentials.</p>
    <label className="field-label">JavaScript<textarea data-dialog-focus className="plugin-input plugin-code" spellCheck={false} value={code} maxLength={8_000}
      onChange={(event) => setCode(event.target.value)} rows={6} disabled={task.busy} /></label>
    {textInput && <label className="check-label"><input type="checkbox" checked={include} onChange={(event) => setInclude(event.target.checked)} disabled={task.busy} /> Make attached text available as <code>input</code></label>}
    <RunButton task={task} label="Run JavaScript" disabled={!code.trim()} onRun={() => void task.begin(async (signal) => {
      setOutput(undefined);
      const result = await runScript(code, include ? textInput ?? '' : '', signal);
      signal.throwIfAborted(); setOutput(result);
    })} />
    <ErrorNotice message={task.error} />
    {output && <Output content={output.output} failed={!output.ok} label={output.ok ? 'Output' : 'Script stopped'} onInsert={output.ok ? onInsert : undefined} />}
  </div>;
}

function ApiExplorer({ initial, onInsert }: { initial?: string; onInsert: (value: string) => void }) {
  const [target, setTarget] = useState(initial || PUBLIC_API_EXAMPLE);
  const [output, setOutput] = useState('');
  const task = useOperation();
  const spec = publicApiTarget(target.trim());
  return <div className="plugin-fields">
    <p className="plugin-notice"><ShieldCheck size={17} /> Only public GitHub repository and latest-release endpoints. No keys, custom headers, redirects, or write requests.</p>
    <label className="field-label">API endpoint<input data-dialog-focus className="plugin-input plugin-url" type="url" autoCapitalize="none" spellCheck={false}
      value={target} maxLength={360} onChange={(event) => setTarget(event.target.value)} disabled={task.busy} /></label>
    {spec ? <div className="request-preview"><span>GET</span><code>{spec.endpoint}</code></div>
      : <p className="form-hint">Use <code>https://api.github.com/repos/owner/repository</code> or append <code>/releases/latest</code>.</p>}
    <p className="form-hint">Approval sends the request above to GitHub, without the chat or attached files.</p>
    <RunButton task={task} label="Approve & send GET" disabled={!spec} onRun={() => void task.begin(async (signal) => {
      setOutput('');
      const result = await approveTool<{ data: unknown }>({ action: 'api', method: 'GET', target: spec?.endpoint }, signal);
      signal.throwIfAborted(); setOutput(JSON.stringify(result.data, null, 2));
    })} />
    <ErrorNotice message={task.error} />
    {output && <Output content={output} label="API response" onInsert={onInsert} />}
  </div>;
}

function ImageStudio({ initial, hosted }: { initial?: string; hosted: boolean }) {
  const [prompt, setPrompt] = useState((initial || 'A violet sky with a mint aurora').slice(0, 1_200));
  const [caption, setCaption] = useState('');
  const [style, setStyle] = useState<ArtStyle>(() => /mountain|hill|landscape|ridge/i.test(initial ?? '') ? 'Terrain' : /planet|orbit|space/i.test(initial ?? '') ? 'Orbit' : 'Aurora');
  const [mode, setMode] = useState<'local' | 'hosted'>('local');
  const [code, setCode] = useState('');
  const [image, setImage] = useState<{ url: string; mode: typeof mode }>();
  const task = useOperation();
  useEffect(() => () => { if (image) URL.revokeObjectURL(image.url); }, [image]);
  return <div className="plugin-fields">
    <div className="studio-tabs" aria-label="Image generation method">
      <button type="button" aria-pressed={mode === 'local'} disabled={task.busy} onClick={() => setMode('local')}>Local graphics</button>
      <button type="button" aria-pressed={mode === 'hosted'} disabled={task.busy} onClick={() => setMode('hosted')}>AI images</button>
    </div>
    {mode === 'local' ? <p className="plugin-notice"><ShieldCheck size={17} /> A 4K poster generator. Your words set the colors and pattern for abstract art, not a rendered scene. Nothing is uploaded.</p>
      : <p className="plugin-notice"><ShieldCheck size={17} /> {hosted ? 'Approval sends only this prompt to OpenAI and can use the owner’s image credits.' : 'Hosted AI images need a provider and access code configured by the site owner. Local graphics work now.'}</p>}
    <label className="field-label">{mode === 'local' ? 'Describe a mood or color palette' : 'Image prompt'}<textarea data-dialog-focus className="plugin-input" value={prompt}
      onChange={(event) => setPrompt(event.target.value)} maxLength={1_200} rows={3} disabled={task.busy} /></label>
    {mode === 'local' ? <div className="studio-options">
      <label className="field-label">Style<select className="plugin-input" value={style} onChange={(event) => setStyle(event.target.value as ArtStyle)} disabled={task.busy}>
        {ART_STYLES.map((style) => <option key={style}>{style}</option>)}
      </select></label>
      <label className="field-label">Caption <span className="optional">optional</span><input className="plugin-input" value={caption} onChange={(event) => setCaption(event.target.value)}
        maxLength={88} placeholder="Add a title" disabled={task.busy} /></label>
    </div> : hosted && <label className="field-label">Studio access code<input className="plugin-input" type="password" autoComplete="off" value={code}
      onChange={(event) => setCode(event.target.value)} maxLength={180} disabled={task.busy} /></label>}
    <RunButton task={task} label={mode === 'local' ? 'Generate 4K PNG' : 'Approve & generate'} disabled={!prompt.trim() || (mode === 'hosted' && (!hosted || !code))}
      onRun={() => void task.begin(async (signal) => {
        setImage(undefined);
        let blob: Blob;
        if (mode === 'local') blob = await renderLocalArt(prompt, style, caption);
        else {
          try {
            const result = await approveTool<{ image: string }>({ action: 'image', prompt, accessCode: code }, signal);
            blob = new Blob([Uint8Array.from(atob(result.image), (letter) => letter.charCodeAt(0))], { type: 'image/jpeg' });
          } finally { setCode(''); }
        }
        signal.throwIfAborted(); setImage({ url: URL.createObjectURL(blob), mode });
      })} />
    <ErrorNotice message={task.error} />
    {image && <figure className="studio-result"><img src={image.url} alt={image.mode === 'local' ? 'Your generated Xyvora graphic' : 'Your generated AI image'} />
      <figcaption><span>{image.mode === 'local' ? '4K · 3840 × 2160' : 'AI image · 1024 × 1024'}</span>
        <a className="secondary-button" download={`xyvora-studio.${image.mode === 'local' ? 'png' : 'jpg'}`} href={image.url}><ArrowDownToLine size={16} /> Download</a></figcaption>
    </figure>}
  </div>;
}

function AccountPanel({ provider, status, change }: { provider: Provider; status?: ConnectionStatus; change: (status: ConnectionStatus) => void }) {
  const task = useOperation();
  const [output, setOutput] = useState('');
  const [notice, setNotice] = useState('');
  const name = PLUGINS[provider].name;
  const invoke = (operation: string) => void task.begin(async (signal) => {
    setOutput('');
    const data = await approveTool<unknown>({ action: 'account', provider, operation }, signal);
    signal.throwIfAborted(); setOutput(JSON.stringify(data, null, 2));
  });
  return <div className="plugin-fields">
    <p className="plugin-notice"><ShieldCheck size={17} /> {PLUGINS[provider].summary} Results aren’t sent to the assistant or saved in chat. Connections expire within an hour.</p>
    <div className="account-status"><span className={`connection-dot${status === 'connected' ? ' connected' : ''}`} />
      {status === 'connected' ? 'Connected on this browser' : status === 'disconnected' ? 'Not connected' : status === 'unconfigured' ? 'Connection not configured on this deployment' : 'Checking connection…'}</div>
    {status === 'unconfigured' && <p className="form-hint">The site owner needs to register a {name} OAuth app first. This requires separate consent; no account password or personal token is needed.</p>}
    {status === 'disconnected' && <><p className="form-hint">You’ll leave Xyvora to approve the connection. Finish any unsent draft first.</p><div className="plugin-run-row"><button className="plugin-primary" type="button" disabled={task.busy} onClick={() => void task.begin(async (signal) => {
      const { url } = await approveTool<{ url: string }>({ action: 'connect', provider }, signal);
      const auth = new URL(url);
      if (auth.origin !== (provider === 'gmail' ? 'https://accounts.google.com' : 'https://vercel.com')) throw new Error('The provider did not return a valid authorization page.');
      signal.throwIfAborted(); window.location.assign(auth.href);
    })}><Link2 size={17} /> {task.busy ? 'Opening provider…' : `Connect ${name}`}</button></div></>}
    {status === 'connected' && <>
      {provider === 'vercel' && <p className="form-hint">Project listing also needs read-only Projects permission. Profile access works without that grant.</p>}
      <RunButton task={task} label={provider === 'gmail' ? 'Approve & read inbox headers' : 'Approve & read profile'} onRun={() => invoke(provider === 'gmail' ? 'inbox' : 'profile')} />
      <div className="plugin-run-row">
        {provider === 'vercel' && <button className="secondary-button" type="button" disabled={task.busy} onClick={() => invoke('projects')}>Approve & read projects</button>}
        <button className="danger-button" type="button" disabled={task.busy} onClick={() => void task.begin(async (signal) => {
          const { revoked } = await approveTool<{ revoked: boolean }>({ action: 'disconnect', provider }, signal);
          signal.throwIfAborted(); setOutput(''); change('disconnected');
          setNotice(revoked ? 'Disconnected and revoked provider access.' : 'Disconnected here. To remove the grant at the provider, manage access there.');
        })}>Disconnect</button>
      </div>
    </>}
    {notice && <p className="form-hint" role="status">{notice}</p>}
    {status && status !== 'unconfigured' && <div className="plugin-run-row"><a className="text-button" href={setupLinks[provider]} target="_blank" rel="noopener noreferrer">Manage provider access <ArrowUpRight size={13} /></a></div>}
    <ErrorNotice message={task.error} />
    {output && <Output content={output} label={`${name} read-only result`} />}
  </div>;
}

export function PluginsDialog({ intent, textInput, onInsert, onClose }: { intent?: PluginIntent; textInput?: string; onInsert: (text: string) => void; onClose: () => void }) {
  const [id, setId] = useState(intent?.id);
  const [status, setStatus] = useState<WorkspaceStatus>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    getWorkspace(controller.signal).then((value) => { if (!controller.signal.aborted) setStatus(value); }).catch((error: Error) => {
      if (!controller.signal.aborted) setError(error.message);
    });
    return () => controller.abort();
  }, []);
  return <Dialog title={id ? PLUGINS[id].name : 'Plugins'} subtitle={id ? PLUGINS[id].summary : 'Work with files, make images, run a script, or connect your accounts.'} className="plugins-dialog" onClose={onClose}>
    {id && <button type="button" className="plugin-back" onClick={() => setId(undefined)}><ArrowLeft size={16} /> All plugins</button>}
    {error && id !== 'script' && id !== 'image' && <ErrorNotice message={error} />}
    {!id && <>
      <p className="plugin-notice"><ShieldCheck size={17} /> Built-in chat tools run on request. Plugins review scripts and external calls with you first.</p>
      <div className="plugin-grid">
        {all.map((key) => {
          const Icon = icons[key];
          const connection = key === 'gmail' || key === 'vercel' ? status?.connections[key] : undefined;
          return <button type="button" className="plugin-card" key={key} onClick={() => setId(key)}>
            <span className={`plugin-icon tint-${tints[key]}`}><Icon size={20} /></span><ArrowUpRight size={15} className="plugin-arrow" />
            <strong>{PLUGINS[key].name}</strong><span className="plugin-card-text">{PLUGINS[key].summary}</span>
            <span className="plugin-label">{connection === 'connected' ? 'Connected · read-only' : connection === 'unconfigured' ? 'Needs setup' : labels[key]}</span>
          </button>;
        })}
      </div>
    </>}
    {id === 'script' && <ScriptLab initial={intent?.id === id ? intent.input ?? '' : undefined} textInput={textInput} onInsert={onInsert} />}
    {id === 'api' && <ApiExplorer initial={intent?.id === id ? intent.input : undefined} onInsert={onInsert} />}
    {id === 'image' && <ImageStudio initial={intent?.id === id ? intent.input : undefined} hosted={status?.hostedImages === true} />}
    {(id === 'gmail' || id === 'vercel') && <AccountPanel key={id} provider={id} status={status?.connections[id]}
      change={(connection) => setStatus((value) => value ? { ...value, connections: { ...value.connections, [id]: connection } } : value)} />}
  </Dialog>;
}
