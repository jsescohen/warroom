import { audio } from '../../audio/audio';
import { fill, h } from '../dom';

export interface PanelHandle {
  el: HTMLElement;
  body: HTMLElement;
  close(): void;
  closed: Promise<void>;
}

/**
 * Generic modal panel used by the menus (settings, load, in-game menu). Escape or a backdrop click
 * closes it. Content is rendered by the caller into `body`.
 */
export function openPanel(title: string, opts: { wide?: boolean; eyebrow?: string; onClose?: () => void } = {}): PanelHandle {
  const body = h('div', { class: 'menu-body' });
  let done!: () => void;
  const closed = new Promise<void>((r) => (done = r));
  const close = () => {
    if (!backdrop.isConnected) return;
    window.removeEventListener('keydown', onKey, true);
    backdrop.classList.add('leaving');
    setTimeout(() => backdrop.remove(), 150);
    audio.play('close');
    opts.onClose?.();
    done();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); }
  };
  const panel = h('div', { class: `menu-panel panel${opts.wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'menu-head' },
      h('div', null, opts.eyebrow ? h('div', { class: 'eyebrow' }, opts.eyebrow) : null, h('h2', null, title)),
      h('button', { class: 'menu-x', title: 'Close (Esc)', onclick: close }, '✕')),
    body,
  );
  const backdrop = h('div', { class: 'modal-backdrop', onclick: (e: Event) => { if (e.target === backdrop) close(); } }, panel);
  document.body.append(backdrop);
  window.addEventListener('keydown', onKey, true);
  audio.play('open');
  return { el: panel, body, close, closed };
}

// ---- form controls ------------------------------------------------------------------------------

export function segmented<T extends string | number>(value: T, options: [T, string][], onChange: (v: T) => void): HTMLElement {
  const el = h('div', { class: 'segmented', role: 'radiogroup' });
  const render = (v: T) => fill(el, ...options.map(([val, label]) =>
    h('button', { class: val === v ? 'active' : '', role: 'radio', 'aria-checked': String(val === v), onclick: () => { render(val); onChange(val); } }, label)));
  render(value);
  return el;
}

export function toggle(value: boolean, onChange: (v: boolean) => void, label = ''): HTMLElement {
  const input = h('input', { type: 'checkbox', class: 'switch-input', 'aria-label': label }) as HTMLInputElement;
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'switch' }, input, h('span', { class: 'switch-track' }, h('span', { class: 'switch-thumb' })));
}

export function slider(value: number, onChange: (v: number) => void, opts: { min?: number; max?: number; step?: number; format?: (v: number) => string } = {}): HTMLElement {
  const { min = 0, max = 1, step = 0.05, format = (v) => `${Math.round(v * 100)}%` } = opts;
  const out = h('span', { class: 'slider-value' }, format(value));
  const input = h('input', { type: 'range', min, max, step, value, class: 'slider' }) as HTMLInputElement;
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = format(v);
    onChange(v);
  });
  return h('div', { class: 'slider-row' }, input, out);
}

/** A labelled settings row: title + optional hint on the left, control on the right. */
export function row(title: string, hint: string | null, control: HTMLElement): HTMLElement {
  return h('div', { class: 'setting-row' },
    h('div', { class: 'setting-text' }, h('div', { class: 'setting-title' }, title), hint ? h('div', { class: 'setting-hint' }, hint) : null),
    h('div', { class: 'setting-control' }, control),
  );
}
