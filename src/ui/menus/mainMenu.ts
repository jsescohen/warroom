import { audio } from '../../audio/audio';
import { cloudSaves, currentUser, signOut } from '../../auth/account';
import { scenarios } from '../../data/scenarios';
import { listSaves, type SaveMeta } from '../../game/saves';
import { consoleScreen, menuItem } from '../console';
import { h } from '../dom';
import { openFeedback } from './feedback';
import { openHowToPlay } from './howToPlay';
import { openProfile } from './profile';
import { openLoadScreen, timeAgo } from './loadScreen';
import { openSettings } from './settingsScreen';

export interface MainMenuActions {
  newGame(): void;
  load(id: string): void;
  admin(): void;
}

/** Who is signed in (accounts mode): picture, username, rename, sign out. */
function accountBar() {
  const me = currentUser();
  if (!me) return null;
  return h('div', { class: 'cx-account' },
    me.avatar ? h('img', { class: 'avatar', src: me.avatar, alt: '', referrerpolicy: 'no-referrer' }) : h('span', { class: 'avatar' }, (me.username ?? me.name).slice(0, 1).toUpperCase()),
    h('div', { class: 'cx-account-name' },
      h('strong', null, me.username ?? me.name),
      h('span', null, me.admin ? 'Admin' : 'Player', cloudSaves() ? ' · cloud saves' : '')),
    h('button', { class: 'cx-link', title: 'Your stats, achievements and username', onclick: () => void openProfile() }, 'Profile'),
    h('button', { class: 'cx-link', onclick: () => void signOut() }, 'Sign out'),
  );
}

/** Title screen: Continue, New game, Load game, How to play, Settings (and Admin). */
export async function showMainMenu(root: HTMLElement, actions: MainMenuActions) {
  let latest: SaveMeta | undefined;
  try {
    latest = (await listSaves())[0];
  } catch {
    /* saves unavailable: no Continue */
  }
  const items: [string, string | null, () => void][] = [];
  if (latest) items.push(['Continue', `${latest.nation ?? latest.scenarioName} · ${latest.gameDate} · ${timeAgo(latest.savedAt)}`, () => actions.load(latest!.id)]);
  items.push(['New game', 'Choose an era and a nation', actions.newGame]);
  items.push(['Load game', 'Your saved campaigns', () => void openLoadScreen(actions.load)]);
  items.push(['How to play', 'Armies, economy, diplomacy', () => void openHowToPlay()]);
  items.push(['Settings', 'Gameplay, sound, display', () => void openSettings()]);
  if (currentUser()) items.push(['Profile', 'Your stats and achievements', () => void openProfile()]);
  if (currentUser()) items.push(['Feedback', 'Report a bug or suggest an idea', () => void openFeedback()]);
  if (currentUser()?.admin) items.push(['Admin', 'Players and their saves', actions.admin]);

  root.replaceChildren(consoleScreen({ page: 'home', title: 'Warroom Beta', right: accountBar() },
    h('main', { class: 'cx-home-main' },
      h('div', { class: 'cx-kicker' }, h('span', { class: 'cx-dot' }), 'Grand strategy · 3,500 years · 8 eras'),
      h('h1', { class: 'cx-wordmark' }, 'Warroom'),
      h('p', { class: 'cx-lede' }, 'Lead one nation through history. Every other nation is run by an AI leader who remembers what you did.'),
      h('nav', { class: 'cx-menu', 'aria-label': 'Main menu' },
        ...items.map(([label, sub, go], i) => menuItem(i + 1, label, sub, () => { audio.play('click'); go(); }, i === 0))),
    ),
    h('footer', { class: 'cx-foot' },
      h('div', { class: 'cx-eras' }, ...scenarios.map((s) => h('span', null, s.name))),
      h('div', { class: 'cx-legal' }, h('a', { href: '/privacy.html' }, 'Privacy'), h('a', { href: '/terms.html' }, 'Terms')),
    ),
  ));
}
