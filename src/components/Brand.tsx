import type { Ref } from 'react';
import { ORBIT_ASSET } from '../../shared/site.ts';

export function Mascot({ className = '', motionRef }: {
  className?: string; motionRef?: Ref<HTMLSpanElement>;
}) {
  return <span className={`mascot ${className}`} aria-hidden="true">
    <span className="mascot-art" ref={motionRef}><img src={ORBIT_ASSET} alt="" width={96} height={96} draggable={false} /></span>
  </span>;
}

export function BrandLockup() {
  return <div className="hero-mark" aria-hidden="true">
    <span className="hero-orbit"><img src={ORBIT_ASSET} alt="" width={96} height={96} fetchPriority="high" draggable={false} /></span>
    <span className="hero-brand-name">Xyvora <span>AI</span></span>
  </div>;
}
