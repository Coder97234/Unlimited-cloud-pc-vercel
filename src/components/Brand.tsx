import { BrainCircuit, Feather, Orbit, Wind } from 'lucide-react';
import type { SavedModelId } from '../lib/history.ts';

export function Mark({ className = '' }: { className?: string }) {
  return <span className={`xy-mark ${className}`} aria-hidden="true">
    <svg viewBox="0 0 48 48" fill="none">
      <path d="M9 8c7.8 0 11.7 3.2 15 10.6C27.3 11.2 31.2 8 39 8c0 7.8-3.2 11.7-10.6 16C35.8 28.3 39 32.2 39 40c-7.8 0-11.7-3.2-15-10.6C20.7 36.8 16.8 40 9 40c0-7.8 3.2-11.7 10.6-16C12.2 19.7 9 15.8 9 8Z" fill="currentColor" />
      <circle cx="41" cy="7" r="2.7" fill="#eee4ff" />
    </svg>
  </span>;
}

export function HeroMark() {
  return <div className="hero-mark" aria-hidden="true">
    <svg className="hero-orbits" viewBox="0 0 174 122" fill="none">
      <ellipse cx="87" cy="61" rx="77" ry="30" transform="rotate(-19 87 61)" />
      <ellipse cx="87" cy="61" rx="77" ry="30" transform="rotate(22 87 61)" />
      <circle cx="31" cy="43" r="3" className="orbit-dot" />
      <circle cx="144" cy="81" r="2.5" className="orbit-dot" />
      <path d="M130 25v14m-7-7h14M46 96v8m-4-4h8" className="orbit-spark" />
    </svg>
    <Mark className="hero-logo" />
  </div>;
}

const MODEL_ICONS = { 'qwen-lite': Orbit, smollm: Feather, qwen: Orbit, 'gpt-oss': BrainCircuit, mistral: Wind };
const MODEL_TINT = { 'qwen-lite': 'violet', smollm: 'sky', qwen: 'violet', 'gpt-oss': 'mint', mistral: 'peach' };
export function ModelIcon({ id, size = 17, className = '' }: { id: SavedModelId; size?: number; className?: string }) {
  const Icon = MODEL_ICONS[id];
  return <span className={`model-icon tint-${MODEL_TINT[id]} ${className}`} aria-hidden="true"><Icon size={size} strokeWidth={1.9} /></span>;
}
