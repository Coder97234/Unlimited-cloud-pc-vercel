import { BrainCircuit, Feather, Orbit, Wind } from 'lucide-react';
import type { Ref } from 'react';
import type { SavedModelId } from '../lib/history.ts';

export function Mascot({ className = '', motionRef }: {
  className?: string; motionRef?: Ref<HTMLSpanElement>;
}) {
  return <span className={`mascot ${className}`} aria-hidden="true">
    <span className="mascot-art" ref={motionRef} />
  </span>;
}

export function BrandLockup({ dark }: { dark: boolean }) {
  return <div className="hero-mark">
    <img className="hero-lockup" src={dark ? '/brand/xyvora-lockup-dark.webp' : '/brand/xyvora-lockup.webp'}
      width={648} height={217} alt="Xyvora — Intelligent AI Solutions" fetchPriority="high" draggable={false} />
  </div>;
}

const MODEL_ICONS = { 'qwen-lite': Orbit, smollm: Feather, qwen: Orbit, 'gpt-oss': BrainCircuit, mistral: Wind };
const MODEL_TINT = { 'qwen-lite': 'violet', smollm: 'sky', qwen: 'violet', 'gpt-oss': 'mint', mistral: 'peach' };
export function ModelIcon({ id, size = 17, className = '' }: { id: SavedModelId; size?: number; className?: string }) {
  const Icon = MODEL_ICONS[id];
  return <span className={`model-icon tint-${MODEL_TINT[id]} ${className}`} aria-hidden="true"><Icon size={size} strokeWidth={1.9} /></span>;
}
