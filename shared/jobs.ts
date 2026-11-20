export type JobState = 'running' | 'finished' | 'error' | 'cancelled';
export type BackgroundJob = { id: string; prompt: string; state: JobState; result: string; created: number; updated: number };
export const MAX_JOB_PROMPT = 2_000;
export const JOB_API = '/api/chat?work=jobs';
