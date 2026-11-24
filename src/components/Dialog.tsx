import { X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { useLabels } from '../lib/labels.ts';
import type { ReactNode } from 'react';

export function Dialog({ title, subtitle, onClose, children, className }: {
  title: string; subtitle?: string; className?: string; onClose: () => void; children: ReactNode;
}) {
  const t = useLabels();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (!element.open) element.showModal();
    return () => { if (element.open) element.close(); };
  }, []);
  useEffect(() => {
    const element = ref.current;
    (element?.querySelector<HTMLElement>('[data-dialog-focus]') ?? element?.querySelector<HTMLElement>('h2'))?.focus();
  }, [title]);
  return <dialog ref={ref} className={`dialog${className ? ` ${className}` : ''}`} aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dialog-panel">
      <header className="dialog-header">
        <div><h2 id={titleId} tabIndex={-1}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={t('close')}><X size={19} /></button>
      </header>
      {children}
    </section>
  </dialog>;
}
