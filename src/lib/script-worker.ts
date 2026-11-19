import { executeScript } from './sandbox-engine.ts';

self.onmessage = async (event: MessageEvent<{ code: string; input: string }>) => {
  try { self.postMessage(await executeScript(event.data.code, event.data.input)); }
  catch { self.postMessage({ ok: false, output: 'Could not open the isolated JavaScript engine.' }); }
};
