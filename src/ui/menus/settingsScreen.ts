import { audio } from '../../audio/audio';
import { getAiInfo, pingAi } from '../../ai/llmClient';
import { clearSaves } from '../../game/saves';
import { fill, h } from '../dom';
import { confirmDialog } from '../modal';
import { getSettings, resetSettings, updateSettings, type Settings } from '../settings';
import { openPanel, row, segmented, slider, toggle } from './shell';

type Tab = 'gameplay' | 'audio' | 'display' | 'ai' | 'data';
const TABS: [Tab, string][] = [['gameplay', 'Gameplay'], ['audio', 'Audio'], ['display', 'Display'], ['ai', 'AI'], ['data', 'Data']];

/** The full settings screen (main menu and in-game). Changes apply and save immediately. */
export function openSettings(start: Tab = 'gameplay') {
  const panel = openPanel('Settings', { wide: true });
  const tabs = h('nav', { class: 'menu-tabs', role: 'tablist' });
  const content = h('div', { class: 'menu-tab-content' });
  fill(panel.body, tabs, content);
  let tab = start;
  const set = (patch: Partial<Settings>) => updateSettings(patch);

  const render = () => {
    fill(tabs, ...TABS.map(([id, label]) =>
      h('button', { class: id === tab ? 'active' : '', role: 'tab', 'aria-selected': String(id === tab), onclick: () => { tab = id; render(); } }, label)));
    const s = getSettings();
    switch (tab) {
      case 'gameplay':
        return fill(content,
          row('Auto-pause', 'When the game stops by itself on important events.', segmented(s.autoPause, [['off', 'Off'], ['mine', 'My nation'], ['all', 'All events']], (v) => set({ autoPause: v }))),
          row('AI advisor', 'Which orders the Assessor reviews before you commit.', segmented(s.advisor, [['off', 'Off'], ['major', 'Major'], ['all', 'All attacks']], (v) => set({ advisor: v }))),
          row('Dialogs pause the game', 'The advisor and diplomacy windows stop the clock while open.', toggle(s.dialogsPause, (v) => set({ dialogsPause: v }), 'Dialogs pause the game')),
          row('AI leaders write first', 'Foreign leaders may send you offers, warnings and ultimatums.', toggle(s.aiMessages, (v) => set({ aiMessages: v }), 'AI leaders write first')),
          row('Autosave', 'Saves to the "Autosave" slot as in-game time passes, and when you leave a game.', segmented(s.autosave, [['off', 'Off'], ['weekly', 'Weekly'], ['monthly', 'Monthly']], (v) => set({ autosave: v }))),
          row('Edge scrolling', 'Dragging an army near the edge of the screen scrolls the map.', toggle(s.edgeScroll, (v) => set({ edgeScroll: v }), 'Edge scrolling')),
        );
      case 'audio':
        return fill(content,
          row('Mute all', null, toggle(s.muted, (v) => set({ muted: v }), 'Mute all')),
          row('Master volume', null, slider(s.masterVolume, (v) => set({ masterVolume: v }))),
          row('Sound effects', 'Orders, battles, war horns, fanfares, messages.', slider(s.sfxVolume, (v) => { set({ sfxVolume: v }); audio.play('select', { minGapMs: 150 }); })),
          row('Interface sounds', 'Soft clicks on buttons and menus.', toggle(s.uiSounds, (v) => set({ uiSounds: v }), 'Interface sounds')),
          row('Music', 'Gentle generative ambience in the style of each era.', toggle(s.music, (v) => set({ music: v }), 'Music')),
          row('Music volume', null, slider(s.musicVolume, (v) => set({ musicVolume: v }))),
          h('div', { class: 'setting-actions' },
            ...(['order', 'war', 'battle', 'capture', 'message', 'signed'] as const).map((n) =>
              h('button', { class: 'btn', onclick: () => audio.play(n, { minGapMs: 0 }) }, `▶ ${n === 'signed' ? 'treaty' : n}`))),
        );
      case 'display':
        return fill(content,
          row('Interface size', 'Scales panels, menus and text.', segmented(s.uiScale, [[0.85, 'Small'], [1, 'Normal'], [1.15, 'Large'], [1.3, 'Huge']], (v) => set({ uiScale: v }))),
          row('Province names', 'City and region names on the map when zoomed in.', toggle(s.provinceLabels, (v) => set({ provinceLabels: v }), 'Province names')),
          row('Reduce motion', 'Instant camera moves, no pulsing markers or sliding toasts.', toggle(s.reduceMotion, (v) => set({ reduceMotion: v }), 'Reduce motion')),
        );
      case 'ai': {
        const status = h('div', { class: 'ai-box' }, h('p', { class: 'dim' }, 'Checking the AI server…'));
        void getAiInfo().then((info) => {
          if (!status.isConnected) return;
          if ('error' in info) fill(status, h('p', { class: 'danger-text' }, `Offline — ${info.error}`), h('p', { class: 'dim' }, 'Start the server with npm run dev. Without it the game still plays; leaders and the advisor fall back to simple built-in replies.'));
          else {
            const result = h('p', { class: 'dim' }, '');
            fill(status,
              h('dl', { class: 'kv' }, h('dt', null, 'Provider'), h('dd', null, info.provider), h('dt', null, 'Model'), h('dd', null, info.model), h('dt', null, 'Queue'), h('dd', null, `${info.queueLength} waiting`)),
              h('div', { class: 'setting-actions' }, h('button', { class: 'btn', onclick: async () => {
                result.textContent = 'Testing…';
                const r = await pingAi();
                result.textContent = r.valid ? `✓ ${r.data.message}` : `✗ ${'error' in r ? r.error : 'invalid reply'}`;
              } }, 'Test connection')),
              result,
            );
          }
        });
        return fill(content, status,
          h('p', { class: 'setting-hint' }, 'The AI provider (Ollama, Gemini, Groq, OpenRouter or Anthropic), model and keys are set in the .env file next to the game. The server reads it on start.'),
        );
      }
      case 'data':
        return fill(content,
          row('Delete all saved games', 'Removes every save, including the autosave. Exported files are not affected.', h('button', { class: 'btn danger', onclick: async () => {
            if (await confirmDialog({ title: 'Delete all saves?', body: [h('p', null, 'This cannot be undone.')], confirmLabel: 'Delete everything', danger: true })) {
              await clearSaves();
              audio.play('close');
            }
          } }, 'Delete saves')),
          row('Reset settings', 'Restores every option on these pages to its default.', h('button', { class: 'btn', onclick: () => { resetSettings(); render(); } }, 'Reset')),
        );
    }
  };
  render();
  return panel.closed;
}
