import release from '@jitl/quickjs-wasmfile-release-sync';
import { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline } from 'quickjs-emscripten-core';

let instance: ReturnType<typeof newQuickJSWASMModuleFromVariant> | undefined;

export const MAX_SCRIPT = 8_000;
export type ScriptOutput = { ok: boolean; output: string };
const outputLimit = 6_000;

// QuickJS receives only strings. It has no Web APIs or connection to the page,
// OS, filesystem, network, or OAuth sessions. Don't add host import functions.
export async function executeScript(code: string, input = ''): Promise<ScriptOutput> {
  if (!code.trim() || code.length > MAX_SCRIPT || input.length > MAX_SCRIPT) return { ok: false, output: 'Use 1–8,000 characters of JavaScript and at most 8,000 characters of input.' };
  const engine = await (instance ??= newQuickJSWASMModuleFromVariant(release));
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(16 * 1024 * 1024);
  runtime.setMaxStackSize(256 * 1024);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + 550));
  const vm = runtime.newContext();
  let output = '';
  const append = (text: string) => { if (output.length < outputLimit) output += text.slice(0, outputLimit - output.length); };
  try {
    const log = vm.newFunction('write', (value) => {
      if (value && output.length < outputLimit && vm.typeof(value) === 'string') append(`${vm.getString(value)}\n`);
    });
    try { vm.setProp(vm.global, '__write', log); } finally { log.dispose(); }
    const text = vm.newString(input);
    try { vm.setProp(vm.global, 'input', text); } finally { text.dispose(); }
    const bootstrap = vm.evalCode(`
      (() => {
        const write = globalThis.__write;
        const format = (value) => typeof value === 'string' ? value : (() => {
          try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
        })();
        delete globalThis.__write;
        globalThis.print = (...values) => write(values.map(format).join(' '));
        globalThis.console = Object.freeze({ log: print, info: print, warn: print, error: print });
      })();`, 'sandbox-setup.js');
    if (bootstrap.error) { bootstrap.error.dispose(); return { ok: false, output: 'Could not initialize Script Lab.' }; }
    bootstrap.value.dispose();
    const result = vm.evalCode(code, 'script.js');
    if (result.error) {
      let message = 'Script could not finish.';
      try {
        const error = vm.dump(result.error) as { name?: unknown; message?: unknown } | undefined;
        if (typeof error?.message === 'string') message = error.message === 'interrupted' ? 'Stopped: the script reached its time limit.' : error.message.slice(0, 400);
        else if (typeof error === 'string') message = String(error).slice(0, 400);
      } finally { result.error.dispose(); }
      return { ok: false, output: `${output}${message}` };
    }
    try {
      if (vm.typeof(result.value) !== 'undefined' && output.length === 0) {
        const value = vm.dump(result.value);
        append(typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? String(value));
      }
    } finally { result.value.dispose(); }
    const textOutput = output.trimEnd() || 'Completed with no output. Use console.log() to print a result.';
    return { ok: true, output: textOutput + (output.length >= outputLimit ? '\n… output truncated' : '') };
  } catch {
    return { ok: false, output: `${output}\nThe script exceeded a limit or returned an unreadable result.`.trim() };
  } finally { vm.dispose(); runtime.dispose(); }
}
