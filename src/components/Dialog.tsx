import { X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

export function Dialog({ title, subtitle, onClose, children, className }: {
  title: string; subtitle?: string; className?: string; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (!element.open) element.showModal();
    element.querySelector<HTMLElement>('[data-dialog-focus]')?.focus();
    return () => { if (element.open) element.close(); };
  }, []);
  return <dialog ref={ref} className={`dialog${className ? ` ${className}` : ''}`} aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dialog-panel">
      <header className="dialog-header">
        <div><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button>
      </header>
      {children}
    </section>
  </dialog>;
}
