import { BrainCircuit, Check, Layers3, Sparkles, WandSparkles, Zap } from 'lucide-react';
import { HOSTED_PROVIDERS, isModelChoice } from '../../shared/hosted-models.ts';
import type { HostedModel, ModelChoice } from '../../shared/hosted-models.ts';
import { MODE_IDS, MODES } from '../../shared/modes.ts';
import type { ReplyMode } from '../../shared/modes.ts';
import { Dialog } from './Dialog.tsx';

export const MODE_ICONS = { normal: Sparkles, instant: Zap, thinker: BrainCircuit, pro: Layers3, creative: WandSparkles };
const tints = { normal: 'violet', instant: 'peach', thinker: 'sky', pro: 'mint', creative: 'peach' };

export function ModeDialog({ mode, onPick, onClose, hostedModels, model, onModel }: { mode: ReplyMode; hostedModels?: HostedModel[]; model: ModelChoice; onModel: (model: ModelChoice) => void; onPick: (mode: ReplyMode) => void; onClose: () => void }) {
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
    {!!hostedModels?.length && <section className="settings-section hosted-model-settings"><h3>Text model</h3>
      <label className="field-label">Choose a model<select className="plugin-input" value={model} onChange={(event) => { if (isModelChoice(event.target.value)) onModel(event.target.value); }}>
        <option value="xyvora">Xyvora · site model</option><option value="auto">Auto · allow hosted models</option>
        {hostedModels.map(({ provider, model: name }) => <option key={provider} value={provider}>{HOSTED_PROVIDERS[provider]} · {name}</option>)}
      </select></label>
      <p className="form-hint">Hosted models receive the context shown in the composer. Auto can use a hosted model for Thinker, Pro, or Creative, and retry with Xyvora if no text has arrived. These options generate text, not tool actions.</p>
    </section>}
  </Dialog>;
}
