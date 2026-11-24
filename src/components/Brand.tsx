import type { Ref } from 'react';
import { ORBIT_ASSET } from '../../shared/site.ts';

export function Mascot({ className = '', motionRef }: {
  className?: string; motionRef?: Ref<HTMLSpanElement>;
}) {
  return <span className={`mascot ${className}`} aria-hidden="true">
    <span className="mascot-art" ref={motionRef}><img src={ORBIT_ASSET} alt="" width={96} height={96} draggable={false} /></span>
  </span>;
}

export function WelcomeMark({ motionRef }: { motionRef: Ref<HTMLSpanElement> }) {
  return <span className="hero-orbit" aria-hidden="true" ref={motionRef}>
    <img src={ORBIT_ASSET} alt="" width={96} height={96} fetchPriority="high" draggable={false} />
  </span>;
}
