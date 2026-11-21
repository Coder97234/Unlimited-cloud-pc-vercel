import { Clock3, ListTodo, Play, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { JOB_API, MAX_JOB_PROMPT } from '../../shared/jobs.ts';
import type { BackgroundJob } from '../../shared/jobs.ts';
import { Dialog } from './Dialog.tsx';

export function TasksDialog({ accountId, available, onSignIn, onClose }: { accountId?: string; available: boolean; onSignIn: () => void; onClose: () => void }) {
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const live = useRef<AbortController | null>(null);
  const ready = available && !!accountId;
  async function api(signal: AbortSignal, payload?: object) {
    const response = await fetch(JOB_API, { signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]), cache: 'no-store',
      headers: { 'X-Xyvora-Account': accountId ?? '', ...(payload && { 'Content-Type': 'application/json' }) },
      ...(payload && { method: 'POST', body: JSON.stringify(payload) }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'Tasks are unavailable.');
    return data;
  }
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController(); live.current = controller;
    let pending = false;
    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try { const data = await api(controller.signal); if (!controller.signal.aborted) setJobs(data.jobs); }
      catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Could not load tasks.'); }
      finally { pending = false; }
    };
    void load(); const timer = setInterval(() => void load(), 5_000);
    document.addEventListener('visibilitychange', load);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', load); live.current = null; };
  }, [ready, accountId]);
  function action(data: object, clear = false) {
    const signal = live.current?.signal;
    if (!signal || busy) return;
    setBusy(true); setError('');
    void api(signal, data).then(async () => {
      if (!signal.aborted && clear) setPrompt('');
      const latest = await api(signal);
      if (!signal.aborted) setJobs(latest.jobs);
    }).catch((err: Error) => { if (!signal.aborted) setError(err.message); }).finally(() => { if (!signal.aborted) setBusy(false); });
  }
  return <Dialog title="Background tasks" subtitle="Start a text reply and come back for the result." onClose={onClose} className="plugins-dialog">
    {!ready ? <div className="plugin-fields"><p className="plugin-notice"><Clock3 size={16} /> {available ? 'Sign in to save your private task results.' : 'Background tasks are temporarily unavailable.'}</p>
      {available && <button className="plugin-primary" type="button" onClick={onSignIn}>Sign in</button>}</div> : <div className="plugin-fields">
      <p className="plugin-notice"><ListTodo size={17} /> One active text task per account. You can close this panel or tab. Tasks use only the prompt below and don’t take actions in other apps. Results are available for up to 30 days.</p>
      <form className="plugin-fields" onSubmit={(event) => { event.preventDefault(); action({ action: 'start', approved: true, prompt }, true); }}>
        <label className="field-label">Task prompt<textarea className="plugin-input" rows={3} value={prompt} maxLength={MAX_JOB_PROMPT} onChange={({ target }) => setPrompt(target.value)} placeholder="Outline a study plan for my history exam" /></label>
        <div className="plugin-run-row"><button className="plugin-primary" type="submit" disabled={busy || !prompt.trim() || jobs.some((job) => (job.state === 'queued' || job.state === 'running'))}><Play size={15} /> Start background reply</button></div>
      </form>
      {error && <p className="plugin-error" role="alert">{error}</p>}
      {jobs.length ? <ol className="job-list">{jobs.map((job) => <li key={job.id}>
        <div className="job-title"><strong>{job.prompt}</strong><span className="answer-tag">{(job.state === 'queued' || job.state === 'running') && <RefreshCw size={12} className="file-spinner" />} {job.state}</span></div>
        {job.result && <p className="job-result">{job.result}</p>}
        <button type="button" className="secondary-button small-button" disabled={busy} onClick={() => action({ id: job.id, action: (job.state === 'queued' || job.state === 'running') ? 'cancel' : 'delete' })}>
          {(job.state === 'queued' || job.state === 'running') ? 'Cancel task' : <><Trash2 size={13} /> Delete task</>}
        </button>
      </li>)}</ol> : <p className="form-hint">No saved tasks yet.</p>}
    </div>}
  </Dialog>;
}
