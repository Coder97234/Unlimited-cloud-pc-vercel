import type { Ref } from 'react';

export function Mascot({ className = '', motionRef }: {
  className?: string; motionRef?: Ref<HTMLSpanElement>;
}) {
  return <span className={`mascot ${className}`} aria-hidden="true">
    <span className="mascot-art" ref={motionRef} />
  </span>;
}

export function BrandLockup({ dark }: { dark: boolean }) {
  const stem = dark ? '/brand/xyvora-lockup-dark' : '/brand/xyvora-lockup';
  return <div className="hero-mark">
    <img className="hero-lockup" src={`${stem}.webp`} srcSet={`${stem}.webp 648w, ${stem}-hd.webp 1296w`} sizes="(max-width: 520px) 284px, 366px"
      width={648} height={217} alt="Xyvora — Intelligent AI Solutions" fetchPriority="high" draggable={false} />
  </div>;
}
