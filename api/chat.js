// Vercel loads this plain ESM entrypoint. The build bundles our TypeScript
// imports separately from the browser, leaving the native backend external.
export { default } from '../build/chat.mjs';
