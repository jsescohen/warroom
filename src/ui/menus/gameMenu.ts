import type { GameSession } from '../../game/session';
import { h } from '../dom';
import { openLoadScreen } from './loadScreen';
import { openPanel } from './shell';
import { openFeedback } from './feedback';
import { openHowToPlay } from './howToPlay';
import { openSettings } from './settingsScreen';

/** In-game menu (Esc / ☰): resume, save, load, how to play, settings, main menu. */
export function openGameMenu(session: GameSession, onLoad: (id: string) => void) {
  const panel = openPanel('Game menu', { eyebrow: session.scenario.name });
  const btn = (label: string, sub: string | null, onclick: () => void, cls = '') =>
    h('button', { class: `main-btn ${cls}`, onclick }, h('span', { class: 'main-btn-label' }, label), sub ? h('span', { class: 'main-btn-sub' }, sub) : null);
  panel.body.append(h('nav', { class: 'main-buttons' },
    btn('Resume', null, () => panel.close(), 'primary'),
    btn('Save', session.slotName ? `Overwrite "${session.slotName}" (Ctrl+S)` : 'Create a save (Ctrl+S)', async () => {
      if (await session.save()) panel.close();
    }),
    btn('Save as…', 'A new save slot with a name you choose', async () => {
      const name = window.prompt('Name this save', '')?.trim();
      if (name && (await session.save(name, true))) panel.close();
    }),
    btn('Load game', null, () => { panel.close(); void openLoadScreen(onLoad); }),
    btn('How to play', null, () => { panel.close(); void openHowToPlay(); }),
    btn('Send feedback', 'A bug, an idea, a balance problem: straight to the admin', () => { panel.close(); void openFeedback({ store: session.store, scenario: session.scenario }); }),
    btn('Settings', null, () => { panel.close(); void openSettings(); }),
    btn('Main menu', session.dirty ? 'Unsaved progress is kept in the autosave (if enabled)' : null, async () => {
      panel.close();
      await session.quitToMenu();
    }),
  ));
  return panel.closed;
}
