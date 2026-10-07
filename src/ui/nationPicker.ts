import { audio } from '../audio/audio';
import { leaderOf } from '../ai/diplomacyPrompt';
import { provincesOf } from '../core/queries';
import type { ScenarioDef } from '../core/scenario';
import type { GameStore } from '../core/store';
import type { MapRenderer } from '../map/MapRenderer';
import { fill, h, swatch } from './dom';

/**
 * "Choose your nation" overlay shown at the start of a new game: the era's playable powers with
 * their leader and strength. Picking one previews it on the map; any other nation can still be
 * chosen by clicking it on the map.
 */
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
      h('p', { class: 'setting-hint' }, 'Or click any nation on the map and choose "Lead" in its panel.'),
      h('div', { class: 'pick-list' }, ...rows),
    );
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
    this.store.dispatch({ type: 'chooseNation', nation: id }, id);
    this.renderer.setSelection(null);
    audio.play('capture');
  }
}
