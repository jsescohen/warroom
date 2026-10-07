import { h } from './dom';

export interface ConfirmOptions {
  title: string;
  eyebrow?: string;
  body: (Node | string)[];
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  wide?: boolean;
}

/**
 * Modal confirm dialog. Resolves true on confirm, false on cancel/Escape/backdrop click.
 * Body nodes stay live, so callers can fill them in asynchronously (the Assessor does).
 */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const close = (v: boolean) => {
      window.removeEventListener('keydown', onKey, true);
      backdrop.classList.add('leaving');
      setTimeout(() => backdrop.remove(), 150);
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(false); }
    };
    const confirm = h('button', { class: `btn ${opts.danger ? 'danger' : 'primary'}`, onclick: () => close(true) }, opts.confirmLabel);
    const dialog = h('div', { class: `modal panel${opts.wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true' },
      opts.eyebrow ? h('div', { class: 'eyebrow' }, opts.eyebrow) : null,
      h('h2', null, opts.title),
      h('div', { class: 'modal-body' }, ...opts.body.filter(Boolean)),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', onclick: () => close(false) }, opts.cancelLabel ?? 'Cancel'),
        confirm,
      ),
    );
    const backdrop = h('div', { class: 'modal-backdrop', onclick: (e: Event) => { if (e.target === backdrop) close(false); } }, dialog);
    document.body.append(backdrop);
    window.addEventListener('keydown', onKey, true);
    confirm.focus();
  });
}
