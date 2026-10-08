import { USERNAME_RULES } from '../../../shared/accounts/username';
import { audio } from '../../audio/audio';
import { usernameForm } from '../accessGate';
import { openPanel } from './shell';
import { cloudSaves, currentUser, signOut } from '../../auth/account';
import { listSaves, type SaveMeta } from '../../game/saves';
import { h } from '../dom';
import { timeAgo, openLoadScreen } from './loadScreen';
import { openHowToPlay } from './howToPlay';
import { openSettings } from './settingsScreen';

export interface MainMenuActions {
  newGame(): void;
  load(id: string): void;
  admin(): void;
}

/** Title screen: Continue, New game, Load game, How to play, Settings. */
async function changeUsername() {
  const panel = openPanel('Change username');
  const { form, done } = usernameForm(currentUser()?.username ?? '', 'Save');
  panel.body.append(h('p', { class: 'setting-hint' }, `Other players see this name (${USERNAME_RULES}).`), form);
  const saved = await Promise.race([done.then(() => true), panel.closed.then(() => false)]);
  panel.close();
  if (saved) location.reload();
}

/** Who is signed in (accounts mode): picture, name, where saves go, sign out. */
function accountBar() {
  const me = currentUser();
  if (!me) return null;
  return h('div', { class: 'account-bar' },
    me.avatar ? h('img', { class: 'avatar', src: me.avatar, alt: '', referrerpolicy: 'no-referrer' }) : h('span', { class: 'avatar' }, me.name.slice(0, 1).toUpperCase()),
    h('span', null, h('strong', null, me.username ?? me.name), me.admin ? h('span', { class: 'chip' }, 'Admin') : null,
      h('span', { class: 'dim' }, cloudSaves() ? ' · saves in your account' : '')),
    h('button', { class: 'btn', title: 'Change your username', onclick: () => void changeUsername() }, 'Rename'),
    h('button', { class: 'btn', onclick: () => void signOut() }, 'Sign out'),
  );
}

export async function showMainMenu(root: HTMLElement, actions: MainMenuActions) {
  document.documentElement.dataset.theme = 'sepia';
  document.title = 'Warroom Beta';
  let latest: SaveMeta | undefined;
  try {
    latest = (await listSaves())[0];
  } catch {
    /* saves unavailable: no Continue */
  }
  const button = (label: string, sub: string | null, onclick: () => void, primary = false) =>
    h('button', { class: `main-btn${primary ? ' primary' : ''}`, onclick: () => { audio.play('click'); onclick(); } },
      h('span', { class: 'main-btn-label' }, label), sub ? h('span', { class: 'main-btn-sub' }, sub) : null);

  root.replaceChildren(h('div', { class: 'main-menu' },
    h('div', { class: 'main-bg' }),
    h('div', { class: 'main-center' },
      h('h1', { class: 'main-title' }, 'Warroom'),
      h('span', { class: 'beta-badge' }, 'Beta'),
      h('p', { class: 'main-tagline' }, 'Grand strategy across 3,500 years. Every leader remembers.'),
      h('nav', { class: 'main-buttons' },
        latest ? button('Continue', `${latest.nation ?? latest.scenarioName} · ${latest.gameDate} · ${timeAgo(latest.savedAt)}`, () => actions.load(latest!.id), true) : null,
        button('New game', 'Choose an era and a nation', actions.newGame, !latest),
        button('Load game', null, () => void openLoadScreen(actions.load)),
        button('How to play', 'Armies, taking land, fleets, diplomacy, controls', () => void openHowToPlay()),
        button('Settings', 'Gameplay, sound, display, AI', () => void openSettings()),
        currentUser()?.admin ? button('Admin panel', 'Approve players, view their saves', actions.admin) : null,
      ),
      accountBar(),
      h('p', { class: 'main-foot' }, 'Bronze Age · Rome · Late Antiquity · Renaissance · 1914 · 1939 · Today · Divided States'),
    ),
  ));
}
