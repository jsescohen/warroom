import { gatePage } from './console';
import { h } from './dom';

export const BETA_LABEL = 'Beta';

/**
 * Asks the server whether this browser has unlocked the beta. The server enforces it (AI calls
 * and map files are refused without the unlock cookie); this screen is just the way in.
 * Resolves once the game may start.
 */
export async function ensureBetaAccess(root: HTMLElement): Promise<void> {
  let status: { required: boolean; unlocked: boolean };
  try {
    const res = await fetch('/api/beta/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    status = await res.json();
  } catch {
    // the web dev server can run without the API; a deployed game cannot
    if (import.meta.env.DEV) return;
    status = { required: true, unlocked: false };
  }
  if (!status.required || status.unlocked) return;
  return new Promise<void>((resolve) => showGate(root, resolve));
}

function showGate(root: HTMLElement, done: () => void) {
  const input = h('input', {
    class: 'beta-input', type: 'text', placeholder: 'Beta tester code', autocomplete: 'off', spellcheck: 'false', maxlength: '64',
    'aria-label': 'Beta tester code',
  }) as HTMLInputElement;
  const error = h('p', { class: 'beta-error', role: 'alert' });
  const submit = h('button', { class: 'main-btn primary', type: 'submit' }, h('span', { class: 'main-btn-label' }, 'Enter')) as HTMLButtonElement;

  const form = h('form', { class: 'beta-form' }, input, submit, error) as HTMLFormElement;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const code = input.value.trim();
    if (!code) return input.focus();
    submit.disabled = true;
    error.textContent = '';
    try {
      const res = await fetch('/api/beta/unlock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok) { root.replaceChildren(); return done(); }
      error.textContent = body.error ?? `Something went wrong (HTTP ${res.status}).`;
    } catch {
      error.textContent = 'The game server could not be reached. Try again in a moment.';
    }
    submit.disabled = false;
    input.select();
  };

  root.replaceChildren(gatePage('Tester access', 'Enter your tester code to play.', [form], 'No code? Ask the developer for an invite.'));
  input.focus();
}
