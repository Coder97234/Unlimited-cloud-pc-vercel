import { Check, GitBranch, ListTree, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { Turn } from '../lib/history.ts';
import { Dialog } from './Dialog.tsx';

export function ContextDialog({ isolated, onPick, onClose }: {
  isolated: boolean; onPick: (isolated: boolean) => void; onClose: () => void;
}) {
  return <Dialog title="Message context" subtitle="Choose what earlier messages Xyvora can use when you send." onClose={onClose}>
    <div className="mode-list">
      <button type="button" className="mode-option" aria-pressed={!isolated} data-dialog-focus={!isolated || undefined} onClick={() => onPick(false)}>
        <span className="plugin-icon tint-violet"><ListTree size={17} /></span>
        <span><strong>Recent chat</strong><small>Use eligible recent exchanges, within the reply mode’s history limit.</small></span>
        {!isolated && <Check size={17} className="mode-check" />}
      </button>
      <button type="button" className="mode-option" aria-pressed={isolated} data-dialog-focus={isolated || undefined} onClick={() => onPick(true)}>
        <span className="plugin-icon tint-mint"><ShieldCheck size={17} /></span>
        <span><strong>This message only</strong><small>Leave out earlier exchanges and saved memory. Don’t use this exchange in later replies.</small></span>
        {isolated && <Check size={17} className="mode-check" />}
      </button>
    </div>
    <div className="dialog-note"><ShieldCheck size={16} /><span>Your prompt and attachments can still be sent for a reply. This setting doesn’t delete history or change what Web search and approved plugins share.</span></div>
  </Dialog>;
}

export function BranchDialog({ turn, editing, hasDraft, onStart, onClose }: {
  turn: Turn; editing: boolean; hasDraft: boolean;
  onStart: (carryAttachment: boolean) => void; onClose: () => void;
}) {
  const [carry, setCarry] = useState(false);
  return <Dialog title={editing ? 'Edit in a new branch' : 'Branch from this reply'}
    subtitle={editing ? 'Keep the earlier turns and rewrite this prompt. The original conversation stays as it is.'
      : 'Continue in a separate chat, with a copy up through this reply. The original conversation stays as it is.'} onClose={onClose}>
    <blockquote className="branch-quote">{turn.prompt.length > 200 ? `${turn.prompt.slice(0, 199)}…` : turn.prompt}</blockquote>
    {editing && turn.attachment && <label className="branch-file-choice"><input type="checkbox" checked={carry} onChange={({ target }) => setCarry(target.checked)} />
      <span>Keep the saved attachment text <strong>{turn.attachment.name}</strong> in the new draft.</span>
    </label>}
    {editing && turn.imageName && <p className="branch-disclosure">Image bytes are not saved. Attach the image again if you want to ask about it.</p>}
    {hasDraft && <p className="branch-disclosure">Starting a branch replaces your unsent draft and attachments.</p>}
    <div className="dialog-note"><GitBranch size={16} /><span>Nothing is sent until you press Send. Use Message context if you don’t want earlier exchanges included. The branch is saved after its first message.</span></div>
    <div className="dialog-actions">
      <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
      <button type="button" className="branch-start" onClick={() => onStart(carry)}>{editing ? 'Open edited draft' : 'Open branch'}</button>
    </div>
  </Dialog>;
}
