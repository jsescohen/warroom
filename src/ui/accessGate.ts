import { USERNAME_RULES, usernameError } from '../../shared/accounts/username';
import { initAccess, loadMe, setUsername, signIn, signOut, type Me } from '../auth/account';
import { ensureBetaAccess } from './betaGate';
import { h } from './dom';

const PROVIDERS: Record<string, string> = { google: 'Google', discord: 'Discord', github: 'GitHub', twitch: 'Twitch' };

/**
 * Nothing else loads until the player may play: signed in and approved (accounts), the tester
 * code entered (beta), or nothing at all (open, local development). The server enforces this too.
 */
export async function ensureAccess(root: HTMLElement): Promise<void> {
  const access = await initAccess();
  if (access.mode === 'beta') return ensureBetaAccess(root);
  if (access.mode !== 'accounts') return;
  for (;;) {
    let me: Me | null;
    try {
      me = await loadMe();
    } catch (e) {
      await screen(root, 'Server unavailable', (e as Error).message, [button('Try again', () => location.reload(), true)]);
      continue;
    }
    if (!me) { await signInScreen(root, access.providers ?? [], !!access.dev); continue; }
    if (!me.username) { await usernameScreen(root, me); continue; }
    if (me.status === 'approved') { root.replaceChildren(); return; }
    await waitingScreen(root, me);
  }
}

function signInScreen(root: HTMLElement, providers: string[], dev: boolean): Promise<void> {
  const error = h('p', { class: 'beta-error', role: 'alert' });
  const go = async (p: string, email?: string) => {
    error.textContent = '';
    try { await signIn(p, email); } catch (e) { error.textContent = (e as Error).message; }
  };
  const buttons: HTMLElement[] = dev
    ? [devForm(go)]
    : providers.map((p) => button(`Sign in with ${PROVIDERS[p] ?? p}`, () => void go(p), true));
  return screen(root, 'Sign in to play', 'Warroom is in closed beta. Sign in, and the game’s admin will let you in.', [...buttons, error]);
}

function devForm(go: (provider: string, email: string) => void) {
  const input = h('input', { class: 'beta-input', type: 'email', placeholder: 'any@email.test', 'aria-label': 'Email (development sign-in)' }) as HTMLInputElement;
  const form = h('form', { class: 'beta-form' }, input, h('button', { class: 'main-btn primary', type: 'submit' }, h('span', { class: 'main-btn-label' }, 'Sign in (development)'))) as HTMLFormElement;
  form.onsubmit = (e) => { e.preventDefault(); if (input.value.includes('@')) go('dev', input.value); };
  return form;
}

/** First sign-in: the name other players will see (not the Google / Discord name). */
function usernameScreen(root: HTMLElement, me: Me): Promise<void> {
  const { form, done } = usernameForm(me.name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 20), 'Continue');
  const p = screen(root, 'Choose a username', `This is the name other players see (${USERNAME_RULES}). Your email stays private.`, [form]);
  return Promise.race([p, done]);
}

/** A username field with live checks; `done` resolves once the server accepted the name. */
export function usernameForm(initial: string, label: string) {
  const input = h('input', { class: 'beta-input username-input', type: 'text', value: initial, maxlength: '20', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Username' }) as HTMLInputElement;
  const error = h('p', { class: 'beta-error', role: 'alert' });
  const submit = h('button', { class: 'main-btn primary', type: 'submit' }, h('span', { class: 'main-btn-label' }, label)) as HTMLButtonElement;
  const form = h('form', { class: 'beta-form' }, input, submit, error) as HTMLFormElement;
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  input.addEventListener('input', () => { error.textContent = input.value ? usernameError(input.value) ?? '' : ''; });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = usernameError(input.value);
    if (err) { error.textContent = err; input.focus(); return; }
    submit.disabled = true;
    try {
      await setUsername(input.value.trim());
      resolve();
    } catch (x) {
      error.textContent = (x as Error).message;
      input.select();
    }
    submit.disabled = false;
  };
  setTimeout(() => input.focus(), 0);
  return { form, done };
}

function waitingScreen(root: HTMLElement, me: Me): Promise<void> {
  const rejected = me.status === 'rejected';
  return screen(root,
    rejected ? 'Not approved' : 'Waiting for approval',
    rejected
      ? `The admin has not let ${me.username} (${me.email}) into the beta.`
      : `You are signed in as ${me.username} (${me.email}). Your request is on the admin’s list: once you are let in, press "Check again".`,
    [
      rejected ? null : button('Check again', () => undefined, true, true),
      button('Sign out', () => void signOut()),
    ].filter((x): x is HTMLButtonElement => !!x),
  );
}

/** A big menu button; resolving ones close the screen (the gate then checks again). */
const button = (label: string, onclick: () => void, primary = false, resolves = false) =>
  h('button', { class: `main-btn${primary ? ' primary' : ''}`, 'data-resolve': resolves ? '1' : undefined, onclick }, h('span', { class: 'main-btn-label' }, label));

/** A title-screen style page; resolves when one of its resolving buttons is pressed. */
function screen(root: HTMLElement, title: string, text: string, items: HTMLElement[]): Promise<void> {
  document.documentElement.dataset.theme = 'sepia';
  document.title = `Warroom Beta — ${title}`;
  return new Promise((resolve) => {
    for (const el of items) if (el.dataset.resolve) el.addEventListener('click', () => resolve());
    root.replaceChildren(h('div', { class: 'main-menu' },
      h('div', { class: 'main-bg' }),
      h('div', { class: 'main-center' },
        h('h1', { class: 'main-title' }, 'Warroom'),
        h('span', { class: 'beta-badge' }, 'Beta'),
        h('h2', { class: 'gate-title' }, title),
        h('p', { class: 'main-tagline' }, text),
        h('div', { class: 'main-buttons' }, ...items),
        h('p', { class: 'main-foot' }, h('a', { href: '/privacy.html' }, 'Privacy'), ' · ', h('a', { href: '/terms.html' }, 'Terms')),
      ),
    ));
  });
}
