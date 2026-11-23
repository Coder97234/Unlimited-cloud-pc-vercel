import { useEffect, useState } from 'react';
import type { Project } from '../../shared/projects.ts';
import { listProjects, projectChangeKey } from './projects.ts';

export function useProjects(accountId: string | undefined) {
  const [projects, setProjects] = useState<Project[] | undefined>();
  const [error, setError] = useState('');
  const [request, setRequest] = useState(0);
  const refresh = () => setRequest((value) => value + 1);
  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    let loading = false;
    const load = async () => {
      if (loading || controller.signal.aborted) return;
      loading = true; setError('');
      try {
        const next = await listProjects(accountId, controller.signal);
        if (!controller.signal.aborted) setProjects(next);
      } catch (problem) {
        if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : 'Could not load projects.');
      } finally { loading = false; }
    };
    const storage = (event: StorageEvent) => { if (event.key === projectChangeKey(accountId)) void load(); };
    const visibility = () => { if (!document.hidden) void load(); };
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', visibility);
    void load();
    return () => { controller.abort(); window.removeEventListener('storage', storage); document.removeEventListener('visibilitychange', visibility); };
  }, [accountId, request]);
  return { projects, error, refresh, setProjects };
}
