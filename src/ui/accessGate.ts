import { initAccess, loadMe, signIn, signOut, type Me } from '../auth/account';
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

function waitingScreen(root: HTMLElement, me: Me): Promise<void> {
  const rejected = me.status === 'rejected';
  return screen(root,
    rejected ? 'Not approved' : 'Waiting for approval',
    rejected
      ? `The admin has not let ${me.email} into the beta.`
      : `You are signed in as ${me.email}. Your request is on the admin’s list: once you are let in, press "Check again".`,
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
      ),
    ));
  });
}
