import { segmented, toggle } from './menus/shell';
import { getSettings, newGameRules, updateSettings } from './settings';
import { audio } from '../audio/audio';
import { leaderOf } from '../ai/diplomacyPrompt';
import { provincesOf } from '../core/queries';
import type { ScenarioDef } from '../core/scenario';
import type { GameStore } from '../core/store';
import type { MapRenderer } from '../map/MapRenderer';
import { fill, h, swatch } from './dom';
import { outbreakSites, SEVERITIES, SEVERITY } from '../core/pandemic';
import type { Severity } from '../core/types';

/** Pandemic era: the disease the player sets up (kept for the next game this session). */
const plague = { name: '', severity: 'serious' as Severity, where: 'abroad' as 'abroad' | 'anywhere' | 'home' };
const WHERE_HINT = {
  abroad: 'It breaks out in a big city somewhere else in the world: you have a little time to prepare.',
  anywhere: 'It breaks out in any big city in the world, maybe yours.',
  home: 'It breaks out in one of your own big cities. The world will blame you.',
};

/**
 * "Choose your nation" overlay shown at the start of a new game: the era's playable powers with
 * their leader and strength. Picking one previews it on the map; any other nation can still be
 * chosen by clicking it on the map.
 */
export const DIFFICULTY_HINT = {
  easy: 'Easy: AI nations field smaller, weaker armies and rarely start wars.',
  normal: 'Normal: the AI plays by the same rules as you.',
  hard: 'Hard: AI armies are larger and fight harder, and the AI picks fights sooner, with you too.',
};

export const ECONOMY_HINT = {
  simple: 'Simple: provinces earn money, you buy troops at barracks, resources make units cheaper.',
  detailed: 'Detailed: as simple, plus resource stockpiles that armies use up. Run out and those units fight weaker.',
};

/**
 * The disease set up in the picker, for a chooseNation order (pandemic era; nothing otherwise).
 * Where it breaks out is a random big city, as chosen.
 */
export function diseaseChoice(store: GameStore, scenario: ScenarioDef, nation: string) {
  if (!scenario.pandemic) return {};
  const s = store.state;
  const sites = outbreakSites(store.world);
  const home = sites.filter((p) => s.provinces[p]?.owner === nation);
  const pool = plague.where === 'home' ? (home.length ? home : [s.nations[nation]?.capital ?? ''].filter(Boolean))
    : plague.where === 'abroad' ? sites.filter((p) => s.provinces[p]?.owner !== nation) : sites;
  return { disease: { name: plague.name.trim() || undefined, severity: plague.severity, origin: pool[Math.floor(Math.random() * pool.length)] } };
}

export class NationPicker {
  readonly el = h('section', { class: 'nation-picker panel' });
  private previewed: string | null = null;
  private collapsed = false;

  constructor(private store: GameStore, private scenario: ScenarioDef, private renderer: MapRenderer) {
    store.subscribe((s, prev) => { if (s.playerNation !== prev.playerNation) this.render(); });
    this.render();
  }

  private render() {
    const s = this.store.state;
    if (s.playerNation) { this.el.remove(); return; }
    const playable = this.scenario.nations.filter((n) => n.playable && s.nations[n.id]?.alive);
    if (this.collapsed) {
      fill(this.el, h('button', { class: 'btn primary', onclick: () => { this.collapsed = false; this.render(); } }, 'Choose your nation…'));
      return;
    }
    const rows = playable.map((n) => {
      const nation = s.nations[n.id];
      const leader = leaderOf(this.scenario, s, n.id);
      const provinces = provincesOf(s, n.id).length;
      const armies = Object.values(s.armies).filter((a) => a.owner === n.id).length;
      const active = this.previewed === n.id;
      return h('div', { class: `pick-row${active ? ' active' : ''}` },
        h('button', { class: 'pick-main', onclick: () => this.preview(n.id) },
          swatch(nation.color),
          h('div', null,
            h('div', { class: 'pick-name' }, nation.name, n.major ? h('span', { class: 'chip' }, 'Great power') : null),
            h('div', { class: 'pick-sub' }, `${leader.name.replace(/^the /, 'The ')} · ${provinces} provinces · ${armies} armies`),
            active ? h('div', { class: 'pick-goals' }, `Goals: ${leader.goals.join('; ')}`) : null,
          ),
        ),
        active ? h('button', { class: 'btn primary', onclick: () => this.choose(n.id) }, `Lead ${nation.shortName}`) : null,
      );
    });
    fill(this.el,
      h('div', { class: 'picker-head' },
        h('div', null, h('div', { class: 'eyebrow' }, this.scenario.subtitle), h('h2', null, 'Choose your nation')),
        h('button', { class: 'menu-x', title: 'Hide this list and browse the map', onclick: () => { this.collapsed = true; this.render(); } }, '–')),
      h('div', { class: 'picker-difficulty' }, h('span', null, 'Difficulty'),
        segmented(getSettings().difficulty, [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']], (v) => { updateSettings({ difficulty: v }); this.render(); })),
      h('p', { class: 'setting-hint' }, DIFFICULTY_HINT[getSettings().difficulty]),
      h('div', { class: 'picker-difficulty' }, h('span', null, 'Economy'),
        segmented(getSettings().economy, [['simple', 'Simple'], ['detailed', 'Detailed']], (v) => { updateSettings({ economy: v }); this.render(); })),
      h('p', { class: 'setting-hint' }, ECONOMY_HINT[getSettings().economy]),
      this.scenario.pandemic ? null : h('div', { class: 'picker-difficulty' }, h('span', { title: 'When a nation loses its capital it surrenders at once, with all its land' }, 'Capital falls = nation falls'),
        toggle(getSettings().capitalFalls, (v) => { updateSettings({ capitalFalls: v }); }, 'Capital falls = nation falls')),
      ...(this.scenario.pandemic ? this.diseaseSetup() : []),
      h('p', { class: 'setting-hint' }, 'Click a nation below, or any nation on the map and choose "Lead" in its panel.'),
      h('div', { class: 'pick-list' }, ...rows),
    );
  }

  /** Pandemic era: name the disease, how dangerous it is, and where it breaks out. */
  private diseaseSetup(): HTMLElement[] {
    const name = h('input', { class: 'plague-name', type: 'text', maxlength: '40', placeholder: this.scenario.pandemic!.name, value: plague.name, 'aria-label': 'Name of the disease' }) as HTMLInputElement;
    name.addEventListener('input', () => { plague.name = name.value; });
    return [
      h('div', { class: 'picker-difficulty' }, h('span', null, 'The disease'), name),
      h('div', { class: 'picker-difficulty' }, h('span', null, 'Severity'),
        segmented(plague.severity, SEVERITIES.map((v) => [v, SEVERITY[v].label] as [Severity, string]), (v) => { plague.severity = v; this.render(); })),
      h('p', { class: 'setting-hint' }, SEVERITY[plague.severity].text),
      h('div', { class: 'picker-difficulty' }, h('span', null, 'Breaks out'),
        segmented(plague.where, [['abroad', 'Abroad'], ['anywhere', 'Anywhere'], ['home', 'At home']], (v) => { plague.where = v; this.render(); })),
      h('p', { class: 'setting-hint' }, WHERE_HINT[plague.where]),
    ];
  }

  private preview(id: string) {
    this.previewed = id;
    const cap = this.store.state.nations[id]?.capital;
    if (cap) {
      this.renderer.setSelection(cap);
      this.renderer.focusOn(cap, 2.2);
    }
    audio.play('select');
    this.render();
  }

  private choose(id: string) {
    this.store.dispatch({ type: 'chooseNation', nation: id, ...newGameRules(), ...diseaseChoice(this.store, this.scenario, id) }, id);
    this.renderer.setSelection(null);
    audio.play('capture');
  }
}
