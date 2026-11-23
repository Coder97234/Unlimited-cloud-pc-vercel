// Use the prebundled Node handler so the deployment never depends on how
// Vercel's TypeScript loader rewrites relative imports.
// No matcher: static assets, direct pages, and APIs all cross the gate.
export const config = { runtime: 'nodejs' };
export { default } from './build/middleware.mjs';
