import { ArrowDownToLine, ArrowLeft, ArrowUpRight, Code2, GitBranch, Image, Link2, Mail, Play, Server, ShieldCheck, Terminal, Triangle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { IMAGE_SIZES } from '../../shared/media.ts';
import type { RepoWorkbenchDraft } from '../../shared/repositories.ts';
import type { TextAttachment } from '../../shared/models.ts';
import { PLUGINS, PUBLIC_API_EXAMPLE, publicApiTarget, VERCEL_TEAM_SLUG, WORKSPACE_AUTH_PATHS } from '../../shared/workspace-tools.ts';
import type { ConnectionStatus, PluginId, PluginIntent, Provider, WorkspaceStatus } from '../../shared/workspace-tools.ts';
import { ART_STYLES, renderLocalArt } from '../lib/local-image.ts';
import type { ArtStyle } from '../lib/local-image.ts';
import { runScript } from '../lib/run-script.ts';
import type { ScriptOutput } from '../lib/sandbox-engine.ts';
import { approveTool, getWorkspace, WorkspaceError } from '../lib/workspace-api.ts';
import { Dialog } from './Dialog.tsx';
import { RepositoryWorkbench } from './RepositoryWorkbench.tsx';

const icons = { script: Code2, image: Image, repo: GitBranch, api: Server, gmail: Mail, vercel: Triangle };
const tints = { script: 'violet', image: 'peach', repo: 'mint', api: 'sky', gmail: 'peach', vercel: 'mint' };
const labels = { script: 'On this device', image: 'On this device', repo: 'Public · patch export', api: 'Public · GET only', gmail: 'Read-only', vercel: 'Read-only' };
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
    <p className="plugin-notice"><ShieldCheck size={17} /> Public GitHub metadata and releases or npm package metadata. No keys, custom headers, redirects, or write requests.</p>
    <label className="field-label">API endpoint<input data-dialog-focus className="plugin-input plugin-url" type="url" autoCapitalize="none" spellCheck={false}
      value={target} maxLength={360} onChange={(event) => setTarget(event.target.value)} disabled={task.busy} /></label>
    {spec ? <div className="request-preview"><span>GET</span><code>{spec.endpoint}</code></div>
      : <p className="form-hint">Use <code>https://api.github.com/repos/owner/repository</code> with optional <code>/releases/latest</code>, or <code>https://registry.npmjs.org/react/latest</code>.</p>}
    <p className="form-hint">Approval sends the GET request above without your chat or attached files.</p>
    <RunButton task={task} label="Approve & send GET" disabled={!spec} onRun={() => void task.begin(async (signal) => {
      setOutput('');
      const result = await approveTool<{ data: unknown }>({ action: 'api', method: 'GET', target: target.trim() }, signal);
      signal.throwIfAborted(); setOutput(JSON.stringify(result.data, null, 2));
    })} />
    <ErrorNotice message={task.error} />
    {output && <Output content={output} label="API response" onInsert={onInsert} />}
  </div>;
}

const sizeLabels = { '1024x1024': 'Square · 1024 × 1024', '1536x1024': 'Landscape · 1536 × 1024', '1024x1536': 'Portrait · 1024 × 1536' };
type StudioMode = 'local' | 'hosted' | 'vision';

function ImageStudio({ initial, status, onChoosePhoto }: { initial?: string; status?: WorkspaceStatus; onChoosePhoto: () => void }) {
  const [prompt, setPrompt] = useState((initial || 'A violet sky with a mint aurora').slice(0, 1_200));
  const [caption, setCaption] = useState('');
  const [style, setStyle] = useState<ArtStyle>(() => /mountain|hill|landscape|ridge/i.test(initial ?? '') ? 'Terrain' : /planet|orbit|space/i.test(initial ?? '') ? 'Orbit' : 'Aurora');
  const [selection, setSelection] = useState<StudioMode>();
  const [size, setSize] = useState<typeof IMAGE_SIZES[number]>(IMAGE_SIZES[0]);
  const [code, setCode] = useState('');
  const [image, setImage] = useState<{ url: string; local: boolean; dimensions: string }>();
  const mode = selection ?? (initial && status?.hostedImages ? 'hosted' : 'local');
  const hosted = status?.hostedImages === true;
  const task = useOperation();
  const switchTo = (tab: StudioMode) => { setSelection(tab); setCode(''); };
  useEffect(() => () => { if (image) URL.revokeObjectURL(image.url); }, [image]);
  return <div className="plugin-fields">
    <div className="studio-tabs" aria-label="Image Studio tools">
      <button type="button" aria-pressed={mode === 'local'} disabled={task.busy} onClick={() => switchTo('local')}>Local graphics</button>
      {hosted && <button type="button" aria-pressed={mode === 'hosted'} disabled={task.busy} onClick={() => switchTo('hosted')}>AI images</button>}
      {status?.hostedVision && <button type="button" aria-pressed={mode === 'vision'} disabled={task.busy} onClick={() => switchTo('vision')}>Analyze image</button>}
    </div>
    {mode === 'vision' ? <>
      <p className="plugin-notice"><ShieldCheck size={17} /> Ask about a photo, diagram, or screenshot. Review and approve before its resized image and question go to OpenAI.</p>
      <p className="form-hint">One JPEG, PNG, or WebP up to 8 MB. Your image is not saved in chat. A studio access code is required.</p>
      <div className="plugin-run-row"><button type="button" className="plugin-primary" disabled={!status?.hostedVision} onClick={onChoosePhoto}><Image size={16} /> Attach image to chat</button></div>
    </> : <>
      {mode === 'local' ? <p className="plugin-notice"><ShieldCheck size={17} /> A 4K poster generator. Your words set the colors and pattern for abstract art, not a rendered scene. Nothing is uploaded.</p>
        : <p className="plugin-notice"><ShieldCheck size={17} /> Approval sends only this prompt and image size to OpenAI and can use the owner’s image credits.</p>}
      <label className="field-label">{mode === 'local' ? 'Describe a mood or color palette' : 'Image prompt'}<textarea data-dialog-focus className="plugin-input" value={prompt}
        onChange={(event) => setPrompt(event.target.value)} maxLength={1_200} rows={3} disabled={task.busy} /></label>
      {mode === 'local' ? <div className="studio-options">
        <label className="field-label">Style<select className="plugin-input" value={style} onChange={(event) => setStyle(event.target.value as ArtStyle)} disabled={task.busy}>
          {ART_STYLES.map((style) => <option key={style}>{style}</option>)}
        </select></label>
        <label className="field-label">Caption <span className="optional">optional</span><input className="plugin-input" value={caption} onChange={(event) => setCaption(event.target.value)}
          maxLength={88} placeholder="Add a title" disabled={task.busy} /></label>
      </div> : hosted && <div className="studio-options hosted-options">
        <label className="field-label">Image shape<select className="plugin-input" value={size} disabled={task.busy} onChange={(event) => setSize(event.target.value as typeof size)}>
          {IMAGE_SIZES.map((value) => <option key={value} value={value}>{sizeLabels[value]}</option>)}
        </select></label>
        <label className="field-label">Studio access code<input className="plugin-input" type="password" autoComplete="off" value={code}
          onChange={(event) => setCode(event.target.value)} maxLength={180} disabled={task.busy} /></label>
      </div>}
      <RunButton task={task} label={mode === 'local' ? 'Generate 4K PNG' : 'Approve & generate'} disabled={!prompt.trim() || (mode === 'hosted' && (!hosted || !code.trim()))}
        onRun={() => void task.begin(async (signal) => {
          setSelection(mode); setImage(undefined);
          let blob: Blob;
          if (mode === 'local') blob = await renderLocalArt(prompt, style, caption);
          else {
            try {
              const result = await approveTool<{ image: string; size: string }>({ action: 'image', prompt, size, accessCode: code.trim() }, signal);
              if (typeof result.image !== 'string' || result.size !== size) throw new Error('The provider did not return an image at the requested size.');
              blob = new Blob([Uint8Array.from(atob(result.image), (letter) => letter.charCodeAt(0))], { type: 'image/jpeg' });
            } finally { if (!signal.aborted) setCode(''); }
          }
          signal.throwIfAborted();
          setImage({ url: URL.createObjectURL(blob), local: mode === 'local', dimensions: mode === 'local' ? '3840 × 2160' : size.replace('x', ' × ') });
        })} />
      <ErrorNotice message={task.error} />
      {image && <figure className="studio-result"><img src={image.url} alt={image.local ? 'Your generated Xyvora graphic' : 'Your generated AI image'} />
        <figcaption><span>{image.local ? '4K' : 'AI image'} · {image.dimensions}</span>
          <a className="secondary-button" download={`xyvora-studio.${image.local ? 'png' : 'jpg'}`} href={image.url}><ArrowDownToLine size={16} /> Download</a></figcaption>
      </figure>}
    </>}
  </div>;
}

function AccountPanel({ provider, status, change }: { provider: Provider; status?: ConnectionStatus; change: (status: ConnectionStatus) => void }) {
  const task = useOperation();
  const [output, setOutput] = useState('');
  const [notice, setNotice] = useState('');
  const [team, setTeam] = useState('');
  const slug = team.trim();
  const validTeam = !slug || VERCEL_TEAM_SLUG.test(slug);
  const name = PLUGINS[provider].name;
  const invoke = (operation: string) => void task.begin(async (signal) => {
    setOutput(''); setNotice('');
    try {
      const data = await approveTool<unknown>({ action: 'account', provider, operation, ...(operation === 'projects' && slug && { teamSlug: slug }) }, signal);
      signal.throwIfAborted(); setOutput(JSON.stringify(data, null, 2));
    } catch (error) {
      if (!signal.aborted && error instanceof WorkspaceError && error.status === 401) change('disconnected');
      throw error;
    }
  });
  return <div className="plugin-fields">
    <p className="plugin-notice"><ShieldCheck size={17} /> {PLUGINS[provider].summary} Results aren’t sent to the assistant or saved in chat. Connections expire within an hour.</p>
    <div className="account-status"><span className={`connection-dot${status === 'connected' ? ' connected' : ''}`} />
      {status === 'connected' ? 'Connected on this browser' : status === 'disconnected' ? 'Not connected' : 'Checking connection…'}</div>
    {status === 'disconnected' && <><p className="form-hint">You’ll leave Xyvora to approve the connection. Finish any unsent draft first.</p><div className="plugin-run-row"><button className="plugin-primary" type="button" disabled={task.busy} onClick={() => void task.begin(async (signal) => {
      const { url } = await approveTool<{ url: string }>({ action: 'connect', provider }, signal);
      const auth = new URL(url);
      if (auth.origin + auth.pathname !== WORKSPACE_AUTH_PATHS[provider] || auth.username || auth.password || auth.hash) throw new Error('The provider did not return a valid authorization page.');
      signal.throwIfAborted(); window.location.assign(auth.href);
    })}><Link2 size={17} /> {task.busy ? 'Opening provider…' : `Connect ${name}`}</button></div></>}
    {status === 'connected' && <>
      {provider === 'vercel' && <p className="form-hint">Project listing also needs read-only Projects permission. Profile access works without that grant.</p>}
      <RunButton task={task} label={provider === 'gmail' ? 'Approve & read inbox headers' : 'Approve & read profile'} onRun={() => invoke(provider === 'gmail' ? 'inbox' : 'profile')} />
      {provider === 'vercel' && <label className="field-label">Team slug (optional)<input className="plugin-input" value={team}
        aria-describedby="vercel-team-hint" aria-invalid={!validTeam} onChange={({ target }) => setTeam(target.value)} maxLength={62} spellCheck={false} autoCapitalize="none" disabled={task.busy} /></label>}
      {provider === 'vercel' && <p className="form-hint" id="vercel-team-hint">{validTeam ? 'Leave blank for your default scope, or use the team slug from its Vercel dashboard URL.' : 'Use the team’s slug, not its full URL.'}</p>}
      <div className="plugin-run-row">
        {provider === 'vercel' && <button className="secondary-button" type="button" disabled={task.busy || !validTeam} onClick={() => invoke('projects')}>Approve & read projects</button>}
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

export function PluginsDialog({ intent, textInput, onInsert, onChoosePhoto, repoDraft, onRepoFile, onClose }: { intent?: PluginIntent; textInput?: string; onInsert: (text: string) => void; onChoosePhoto: () => void; repoDraft?: RepoWorkbenchDraft; onRepoFile: (attachment: TextAttachment, draft: RepoWorkbenchDraft) => void; onClose: () => void }) {
  const [selected, setId] = useState(intent?.id);
  const [status, setStatus] = useState<WorkspaceStatus>();
  const [error, setError] = useState('');
  const enabled = (key: PluginId) => key !== 'gmail' && key !== 'vercel' || ['connected', 'disconnected'].includes(status?.connections[key] ?? '');
  const id = selected && enabled(selected) ? selected : undefined;
  const [check, setCheck] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    getWorkspace(controller.signal).then((value) => { if (!controller.signal.aborted) setStatus(value); }).catch((error: Error) => {
      if (!controller.signal.aborted) setError(error.message);
    });
    return () => controller.abort();
  }, [check]);
  return <Dialog title={id ? PLUGINS[id].name : 'Plugins'} subtitle={id ? PLUGINS[id].summary : 'Work with files, create graphics, run a script, or explore public APIs.'} className="plugins-dialog" onClose={onClose}>
    {id && <button type="button" className="plugin-back" onClick={() => setId(undefined)}><ArrowLeft size={16} /> All plugins</button>}
    {error && (!id || id === 'image') && <div className="plugin-status-error"><p className="form-hint" role="status">Couldn’t check connected tools. Local and public tools are still available.</p>
      <button type="button" className="secondary-button" onClick={() => { setError(''); setCheck((value) => value + 1); }}>Retry plugin status</button></div>}
    {!id && <>
      <p className="plugin-notice"><ShieldCheck size={17} /> Built-in chat tools run on request. Plugins review scripts and external calls with you first.</p>
      <div className="plugin-grid">
        {all.filter(enabled).map((key) => {
          const Icon = icons[key];
          const connection = key === 'gmail' || key === 'vercel' ? status?.connections[key] : undefined;
          return <button type="button" className="plugin-card" key={key} onClick={() => setId(key)}>
            <span className={`plugin-icon tint-${tints[key]}`}><Icon size={20} /></span><ArrowUpRight size={15} className="plugin-arrow" />
            <strong>{PLUGINS[key].name}</strong><span className="plugin-card-text">{PLUGINS[key].summary}</span>
            <span className="plugin-label">{key === 'image' && (status?.hostedImages || status?.hostedVision) ? 'Local + hosted' : connection === 'connected' ? 'Connected · read-only' : labels[key]}</span>
          </button>;
        })}
      </div>
    </>}
    {id === 'script' && <ScriptLab initial={intent?.id === id ? intent.input ?? '' : undefined} textInput={textInput} onInsert={onInsert} />}
    {id === 'repo' && <RepositoryWorkbench initial={intent?.id === id ? intent.input : undefined} workingCopy={repoDraft} onAttach={onRepoFile} />}
    {id === 'api' && <ApiExplorer initial={intent?.id === id ? intent.input : undefined} onInsert={onInsert} />}
    {id === 'image' && <ImageStudio initial={intent?.id === id ? intent.input : undefined} status={status} onChoosePhoto={onChoosePhoto} />}
    {(id === 'gmail' || id === 'vercel') && <AccountPanel key={id} provider={id} status={status?.connections[id]}
      change={(connection) => setStatus((value) => value ? { ...value, connections: { ...value.connections, [id]: connection } } : value)} />}
  </Dialog>;
}
