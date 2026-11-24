import { ArrowLeft, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { EFFORTS, EFFORT_IDS } from '../../shared/experience.ts';
import type { Effort, ModelTier, RankedModel } from '../../shared/experience.ts';
import { useLabels } from '../lib/labels.ts';
import { MODE_IDS, MODES } from '../../shared/modes.ts';
import type { ReplyMode } from '../../shared/modes.ts';

const styles = {
  normal: 'Balanced for everyday chat and writing.',
  instant: 'Short, direct answers with less previous context.',
  thinker: 'Compare options and explain the reasoning.',
  pro: 'Technical help with examples and concrete steps.',
  creative: 'Brainstorm, tell stories, and explore ideas.',
} satisfies Record<ReplyMode, string>;

const effortDetails = {
  low: 'Respond directly. No extra reasoning where supported.',
  medium: 'A balanced budget for everyday requests.',
  high: 'More room to check assumptions and refine the answer.',
  extra: 'An extended budget for harder, multi-step work.',
  max: 'The largest budget for difficult questions.',
} satisfies Record<Effort, string>;
const itemsIn = (panel: HTMLElement) => Array.from(panel.querySelectorAll<HTMLButtonElement>('[role="menuitem"], [role="menuitemradio"]'));

// A native popover can sit above the scrollable welcome and conversation panes
// without clipping. Prefer the screenshot-style placement above the trigger;
// on a short viewport use whichever side has room and scroll the options.
function place(panel: HTMLElement, trigger: HTMLElement) {
  const rect = trigger.getBoundingClientRect();
  const viewport = window.visualViewport;
  const margin = 12, gap = 6;
  const minX = (viewport?.offsetLeft ?? 0) + margin;
  const maxX = minX + (viewport?.width ?? document.documentElement.clientWidth) - 2 * margin;
  const minY = (viewport?.offsetTop ?? 0) + margin;
  const maxY = minY + (viewport?.height ?? window.innerHeight) - 2 * margin;
  const width = Math.min(394, maxX - minX);
  const roomAbove = rect.top - minY - gap;
  const roomBelow = maxY - rect.bottom - gap;
  panel.style.width = `${width}px`;
  const upward = panel.scrollHeight + 2 <= roomAbove || roomAbove >= roomBelow;
  panel.style.maxHeight = `${Math.max(0, upward ? roomAbove : roomBelow)}px`;
  panel.style.left = `${Math.max(minX, Math.min(rect.right - width, maxX - width))}px`;
  panel.style.top = `${upward ? rect.top - gap - panel.offsetHeight : rect.bottom + gap}px`;
  panel.dataset.positioned = '';
}

export function ReplyMenu({ mode, model, needsModelChoice, models, effort, sample, disabled, onMode, onModel, onEffort, onReturnToPrompt }: {
  mode: ReplyMode; model: RankedModel; needsModelChoice: boolean; models: RankedModel[]; effort: Effort; sample: boolean; disabled: boolean;
  onMode: (mode: ReplyMode) => void; onModel: (model: ModelTier) => void; onEffort: (effort: Effort) => void; onReturnToPrompt: () => void;
}) {
  const t = useLabels();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'styles' | 'models' | 'effort'>('models');
  const initialFocus = useRef<'selected' | 'first' | 'last' | 'effort' | 'styles'>('selected');
  const current = model.name;

  useLayoutEffect(() => {
    const popup = panel.current, anchor = trigger.current;
    if (!open || !popup || !anchor) return;
    if (disabled) { popup.hidePopover(); return; }
    place(popup, anchor);
    const buttons = itemsIn(popup);
    const target = initialFocus.current === 'first' ? buttons[0] : initialFocus.current === 'last' ? buttons.at(-1)
      : (initialFocus.current === 'effort' || initialFocus.current === 'styles') ? popup.querySelector<HTMLButtonElement>(`[data-submenu="${initialFocus.current}"]`)
        : popup.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? buttons[0];
    initialFocus.current = 'selected';
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest' });
  }, [open, view, disabled]);

  useEffect(() => {
    const popup = panel.current, anchor = trigger.current;
    if (!open || !popup || !anchor) return;
    const viewport = window.visualViewport;
    const reposition = (event: Event) => {
      if (event.target === popup || !popup.matches(':popover-open')) return;
      place(popup, anchor);
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    viewport?.addEventListener('resize', reposition);
    viewport?.addEventListener('scroll', reposition);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      viewport?.removeEventListener('resize', reposition);
      viewport?.removeEventListener('scroll', reposition);
    };
  }, [open]);

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    const popup = event.currentTarget;
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
      popup.hidePopover(); trigger.current?.focus({ preventScroll: true });
      return;
    }
    const buttons = itemsIn(popup);
    const index = buttons.findIndex((button) => button === document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : event.key === 'ArrowDown' ? (index + 1) % buttons.length
        : event.key === 'ArrowUp' ? (index < 0 ? buttons.length - 1 : (index - 1 + buttons.length) % buttons.length) : -1;
    if (next < 0 || !buttons[next]) return;
    event.preventDefault(); buttons[next].focus();
  }
  function select(pick: () => void) {
    panel.current?.hidePopover(); pick(); onReturnToPrompt();
  }

  return <div className="reply-selector">
    <button ref={trigger} type="button" className="reply-trigger" title={`${current} · ${t('effort')}: ${EFFORTS[effort].label}`}
      aria-label={`${t('model')}: ${current} · ${t('effort')}: ${EFFORTS[effort].label}`} aria-haspopup="menu" aria-expanded={open} aria-controls={id} popoverTarget={id} disabled={disabled}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        if (panel.current?.matches(':popover-open')) return;
        initialFocus.current = event.key === 'ArrowDown' ? 'first' : 'last';
        event.currentTarget.click();
      }}>
      <span className="reply-model">{current}</span><span className="reply-model-short" aria-hidden="true">{current}</span><span className="reply-mode">{EFFORTS[effort].label}</span><ChevronDown size={13} />
    </button>
    <div ref={panel} id={id} popover="auto" role="menu" aria-label={view === 'models' ? t('model') : view === 'effort' ? t('effort') : t('replyStyle')} className="reply-menu"
      onToggle={(event) => {
        const popup = event.currentTarget;
        const shown = popup.matches(':popover-open');
        setOpen(shown);
        if (!shown) { delete popup.dataset.positioned; setView('models'); }
      }}
      onBlur={(event) => {
        const target = event.relatedTarget;
        if (target instanceof Node && target !== trigger.current && !event.currentTarget.contains(target) && event.currentTarget.matches(':popover-open')) event.currentTarget.hidePopover();
      }}
      onKeyDown={keyboard}>
      {view === 'models' ? <>
        <div role="group" aria-label="Helio lineup">
          {models.map((option) => <button key={option.tier} type="button" role="menuitemradio" aria-checked={!needsModelChoice && option.tier === model.tier} aria-disabled={!option.available || undefined}
            tabIndex={-1} className="reply-option" onClick={() => { if (option.available) select(() => onModel(option.tier)); }}>
            <span><strong>{option.name}</strong><small>{sample && option.tier === 'quick' ? t('sample') : option.detail}</small></span>{!option.available ? <small className="model-unavailable">{t('unavailable')}</small> : !needsModelChoice && option.tier === model.tier ? <Check size={16} /> : null}
          </button>)}
        </div>
        <button type="button" role="menuitem" className="reply-menu-switch" tabIndex={-1} data-submenu="effort" onClick={() => setView('effort')}>
          <span>{t('effort')}</span><small>{EFFORTS[effort].label}</small><ChevronRight size={14} />
        </button>
        <button type="button" role="menuitem" className="reply-menu-switch" tabIndex={-1} data-submenu="styles" onClick={() => setView('styles')}>
          <span>{t('replyStyle')}</span><small>{MODES[mode].name}</small><ChevronRight size={14} />
        </button>
        <p className="reply-menu-note">All Helio models share the same workspace tools.</p>
      </> : <>
        <button type="button" role="menuitem" tabIndex={-1} className="reply-menu-back" onClick={() => { initialFocus.current = view; setView('models'); }}><ArrowLeft size={15} /> {t('model')}</button>
        <p className="reply-menu-label">{t(view === 'effort' ? 'effort' : 'replyStyle')}</p>
        {view === 'effort' ? <div role="group" aria-label="Effort levels">{EFFORT_IDS.map((item) => <button key={item} type="button" role="menuitemradio" aria-checked={item === effort}
          tabIndex={-1} className="reply-option" onClick={() => select(() => onEffort(item))}><span><strong>{EFFORTS[item].label}</strong><small>{effortDetails[item]}</small></span>{item === effort && <Check size={16} />}</button>)}</div>
          : <div role="group" aria-label="Reply styles">{MODE_IDS.map((item) => <button key={item} type="button" role="menuitemradio" aria-checked={item === mode}
            tabIndex={-1} className="reply-option" onClick={() => select(() => onMode(item))}><span><strong>{MODES[item].name}</strong><small>{styles[item]}</small></span>{item === mode && <Check size={16} />}</button>)}</div>}
        <p className="reply-menu-note">{view === 'effort' ? 'Higher effort allows more work, not a fixed delay.' : `The style doesn’t change your model or effort.`}</p>
      </>}
    </div>
  </div>;
}
