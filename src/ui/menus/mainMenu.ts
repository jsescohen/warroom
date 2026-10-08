import { audio } from '../../audio/audio';
import { listSaves, type SaveMeta } from '../../game/saves';
import { h } from '../dom';
import { timeAgo, openLoadScreen } from './loadScreen';
import { openHowToPlay } from './howToPlay';
import { openSettings } from './settingsScreen';

export interface MainMenuActions {
  newGame(): void;
  load(id: string): void;
}

/** Title screen: Continue, New game, Load game, How to play, Settings. */
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
      ),
      h('p', { class: 'main-foot' }, 'Bronze Age · Rome · Late Antiquity · Renaissance · 1914 · 1939 · Today · Divided States'),
    ),
  ));
}
