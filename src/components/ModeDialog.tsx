import { BrainCircuit, Check, Layers3, Sparkles, WandSparkles } from 'lucide-react';
import { MODE_IDS, MODES } from '../../shared/modes.ts';
import type { ReplyMode } from '../../shared/modes.ts';
import { Dialog } from './Dialog.tsx';

export const MODE_ICONS = { normal: Sparkles, thinker: BrainCircuit, pro: Layers3, creative: WandSparkles };
const tints = { normal: 'violet', thinker: 'sky', pro: 'mint', creative: 'peach' };

export function ModeDialog({ mode, onPick, onClose }: { mode: ReplyMode; onPick: (mode: ReplyMode) => void; onClose: () => void }) {
  return <Dialog title="Reply mode" subtitle="Choose how Xyvora answers your next message. Tools and permissions stay the same." onClose={onClose}>
    <div className="mode-list" aria-label="Choose a reply mode">
      {MODE_IDS.map((id) => {
        const Icon = MODE_ICONS[id];
        return <button type="button" key={id} className="mode-option" aria-pressed={mode === id} data-dialog-focus={mode === id || undefined} onClick={() => onPick(id)}>
          <span className={`plugin-icon tint-${tints[id]}`}><Icon size={19} /></span>
          <span><strong>{MODES[id].name}</strong><small>{MODES[id].description}</small></span>
          {mode === id && <Check size={17} className="mode-check" />}
        </button>;
      })}
    </div>
  </Dialog>;
}
