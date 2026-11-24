import { XYVORA_NAME, XYVORA_SITE, XYVORA_URL } from '../../shared/models.ts';
import { WORKSPACE_PLUGINS_ENABLED } from '../../shared/workspace-tools.ts';
import { ABOUT_PATH, SCHOOLS_PATH, TEAM_LINK_LABEL, TEAM_NAME, XYVORA_SLOGAN } from '../../shared/site.ts';
import { Dialog } from './Dialog.tsx';

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return <Dialog title="Keyboard shortcuts" subtitle="Use Cmd on Mac or Ctrl on Windows, Chromebook, and Linux." onClose={onClose}>
    <dl className="shortcut-list">
      <div><dt>Search workspace</dt><dd><kbd>Cmd / Ctrl</kbd> + <kbd>K</kbd></dd></div>
      <div><dt>New chat</dt><dd><kbd>Cmd / Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>N</kbd></dd></div>
      {WORKSPACE_PLUGINS_ENABLED && <div><dt>Open Plugins</dt><dd><kbd>Cmd / Ctrl</kbd> + <kbd>/</kbd></dd></div>}
      <div><dt>Show keyboard shortcuts</dt><dd><kbd>?</kbd></dd></div>
      <div><dt>Rename a focused chat</dt><dd><kbd>F2</kbd></dd></div>
      <div><dt>Send a message</dt><dd><kbd>Enter</kbd></dd></div>
      <div><dt>New line in a message</dt><dd><kbd>Shift</kbd> + <kbd>Enter</kbd></dd></div>
    </dl>
    <p className="form-hint">If your browser reserves the new-chat shortcut, use the sidebar’s New chat button or Cmd / Ctrl + Shift + O.</p>
  </Dialog>;
}

export function AboutDialog({ onClose }: { onClose: () => void }) {
  return <Dialog title={`About ${XYVORA_NAME}`} subtitle={XYVORA_SLOGAN} onClose={onClose}>
    <div className="about-content">
      <p><strong>{XYVORA_NAME}</strong> is the assistant at <a href={XYVORA_URL} target="_blank" rel="noopener noreferrer">{XYVORA_SITE}</a>. Choose a model for your task and adjust Effort separately. A reply style changes how the answer is presented. Earlier chats and comparisons remain in your history.</p>
      <p>Built by the <strong>{TEAM_NAME}</strong>. <a href={ABOUT_PATH}>{TEAM_LINK_LABEL}</a> · <a href={SCHOOLS_PATH}>Information for schools</a></p>
      <p><strong>Built-in tools:</strong> Ask for math, conversions, time, or help with a file. Type <code>/tools</code> for commands.</p>
      <p><strong>Web search:</strong> When configured, Xyvora looks up current information and verifiable facts with SearXNG. Use <code>/search</code> for a specific lookup. The source cards link to the original pages and identify search snippets.</p>
      <p className="brand-downloads"><strong>Brand artwork:</strong> <a href="/brand/xyvora-orbit.svg" download>Orbit SVG</a> · <a href="/brand/xyvora-lockup-4k.webp" download>4K light logo</a> · <a href="/brand/xyvora-lockup-dark-4k.webp" download>4K dark logo</a></p>
      <p><strong>Time and date:</strong> Ask for the time, today’s date, or the time in a city such as Tokyo. Type <code>/time Tokyo</code> for example. The live clock uses your device’s time zone unless you ask for another.</p>
      <p><strong>Privacy:</strong> Guest history stays in this browser; signed-in history syncs to your account. Temporary chats aren’t saved; their prompts may still be sent for a reply. Built-in tools run on device and aren’t included in later chat context. If signed in, the result can be saved in cloud history. Other replies can send the prompt, recent chat context, attachments, enabled memory notes, and time zone to the server. Temporary chats and This message only never send memory.{WORKSPACE_PLUGINS_ENABLED && ' Hosted image tools send only approved inputs to OpenAI.'} When web search runs, only the selected query is sent to the workspace’s SearXNG service. You can turn automatic search off in settings. Avoid including private information in a lookup.</p>
    </div>
  </Dialog>;
}
