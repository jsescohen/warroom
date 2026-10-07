import { mergeable } from '../core/actions';
import { findPath } from '../core/military';
import { allied, armiesIn, atWar, enemiesOf, friendly, getRelation, provincesOf } from '../core/queries';
import type { Army, GameState, NationId } from '../core/types';
import type { World } from '../core/world';
import type { MapData } from '../map/mapData';
import { fill, h, swatch } from './dom';

export function relationLabel(v: number): { text: string; color: string } {
  if (v >= 50) return { text: 'Friendly', color: 'var(--ok)' };
  if (v >= 10) return { text: 'Cordial', color: 'var(--ok)' };
  if (v > -10) return { text: 'Neutral', color: 'var(--text-dim)' };
  if (v > -50) return { text: 'Hostile', color: 'var(--danger)' };
  return { text: 'Bitter enemy', color: 'var(--danger)' };
}

export function formatDuration(hours: number): string {
  if (hours < 24) return `${Math.max(1, Math.round(hours))} h`;
  const d = Math.round((hours / 24) * 2) / 2;
  return `${d} day${d === 1 ? '' : 's'}`;
}

export type Selection = { kind: 'province'; id: string } | { kind: 'army'; id: string } | null;

export interface PanelActions {
  chooseNation(nation: NationId): void;
  declareWar(target: NationId): void;
  selectArmy(id: string): void;
  armyOrder(type: 'stopArmy' | 'splitArmy' | 'mergeArmies', army: string): void;
  focus(provinceId: string): void;
  diplomacy(nation: NationId): void;
}

/**
 * Right-hand panel. Info is re-rendered on every state change; the action buttons are only
 * rebuilt when the set of available actions changes, so clicks are never lost mid-tick.
 */
export class SidePanel {
  readonly el = h('aside', { class: 'side panel' });
  private info = h('div', { class: 'side-info' });
  private actions = h('div', { class: 'side-actions' });
  private actionsKey = '';

  constructor(private map: MapData, private world: World, private act: PanelActions) {
    this.el.append(this.info, this.actions);
  }

  render(s: GameState, sel: Selection) {
    if (sel?.kind === 'army' && s.armies[sel.id]) this.renderArmy(s, s.armies[sel.id]);
    else if (sel?.kind === 'province') this.renderProvince(s, sel.id);
    else {
      fill(this.info, 
        h('h3', null, 'Command'),
        h('p', { class: 'empty' }, s.playerNation
          ? 'Click one of your army counters, then click a province to send it there. Right-click also orders a move.'
          : 'Click a province to inspect it and choose the nation you will lead. Scroll to zoom, drag to pan.'),
      );
      this.setActions('none', []);
    }
  }

  // ---- army -------------------------------------------------------------------------------------

  private renderArmy(s: GameState, a: Army) {
    const owner = s.nations[a.owner];
    const unit = this.world.unitTypes[a.unitType];
    const name = (id: string) => this.map.byId.get(id)?.name ?? id;
    const mine = a.owner === s.playerNation;
    const frac = a.strength / a.maxStrength;

    let status: string;
    const siege = s.provinces[a.location].siege;
    if (s.battles[a.location] !== undefined && a.progress === 0) {
      const days = Math.floor((s.clock.hours - s.battles[a.location]) / 24) + 1;
      status = `In battle at ${name(a.location)} (day ${days})`;
    } else if (siege?.by === a.owner && a.progress === 0) {
      status = `Capturing ${name(a.location)} — ${Math.round(siege.progress * 100)}%`;
    } else if (a.path.length) {
      const dest = a.path[a.path.length - 1];
      const eta = findPath(s, this.world, a.owner, a.unitType, a.location, dest);
      status = `Marching to ${name(dest)}${eta ? ` — about ${formatDuration(eta.hours)}` : ''}`;
    } else status = `Holding at ${name(a.location)}`;

    fill(this.info, 
      h('div', null, h('div', { class: 'eyebrow' }, mine ? 'Your army' : 'Army'), h('h2', null, a.name)),
      h('dl', { class: 'kv' },
        h('dt', null, 'Nation'), h('dd', null, swatch(owner.color), owner.name),
        h('dt', null, 'Type'), h('dd', null, unit?.name ?? a.unitType),
        h('dt', null, 'Strength'), h('dd', null,
          h('span', { class: 'bar' }, h('span', { style: `width:${Math.round(frac * 100)}%;background:${frac > 0.6 ? 'var(--ok)' : frac > 0.3 ? 'var(--accent)' : 'var(--danger)'}` })),
          `${a.strength.toFixed(1)} / ${a.maxStrength.toFixed(0)}`),
        unit ? h('dt', null, 'Attack · Def') : null, unit ? h('dd', null, `${unit.attack} · ${unit.defense}  ·  speed ${unit.speed}`) : null,
        h('dt', null, 'Status'), h('dd', null, status),
      ),
      mine ? h('p', { class: 'hint' }, 'Click a province to move. Enemy provinces are attacked and captured on arrival.') : null,
    );

    if (!mine) return this.setActions(`army-other|${a.location}`, [this.focusBtn(a.location)]);
    const canMerge = mergeable(s, a.id).length > 0;
    const moving = a.path.length > 0;
    const key = `army|${a.id}|${moving}|${canMerge}|${a.strength >= 2}`;
    this.setActions(key, [
      moving ? h('button', { class: 'btn', onclick: () => this.act.armyOrder('stopArmy', a.id) }, 'Halt') : null,
      a.strength >= 2 ? h('button', { class: 'btn', title: 'Split into two armies of half strength', onclick: () => this.act.armyOrder('splitArmy', a.id) }, 'Split') : null,
      canMerge ? h('button', { class: 'btn', title: 'Merge idle armies of the same type here', onclick: () => this.act.armyOrder('mergeArmies', a.id) }, 'Merge') : null,
      this.focusBtn(a.location),
    ]);
  }

  // ---- province ---------------------------------------------------------------------------------

  private renderProvince(s: GameState, id: string) {
    const geo = this.map.byId.get(id);
    if (!geo) return;
    const prov = s.provinces[id];
    const owner = s.nations[prov.owner];
    const owned = provincesOf(s, owner.id);
    const share = ((owned.length / this.map.provinces.length) * 100).toFixed(1);
    const player = s.playerNation;
    const names = (ids: NationId[]) => ids.filter((n) => s.nations[n]).map((n) => s.nations[n].shortName).join(', ');
    const enemies = enemiesOf(s, owner.id);
    const allies = Object.keys(s.nations).filter((n) => n !== owner.id && allied(s, owner.id, n));

    const kv = (rows: [string, ...(Node | string)[]][]) =>
      h('dl', { class: 'kv' }, ...rows.flatMap(([k, ...v]) => [h('dt', null, k), h('dd', null, ...v)]));
    const provRows: [string, ...(Node | string)[]][] = [['Controlled by', swatch(owner.color), owner.name]];
    if (geo.polity !== owner.name && geo.polity !== owner.shortName) provRows.push(['Region', geo.polity.replace('Chinese warlords', 'China')]);
    if (owner.capital === id) provRows.push(['Status', '★ National capital']);
    if (s.battles[id] !== undefined) provRows.push(['Battle', h('span', { class: 'danger-text' }, `Raging since ${formatDuration(s.clock.hours - s.battles[id])} ago`)]);
    if (prov.siege) provRows.push(['Under siege', `${s.nations[prov.siege.by].shortName} — ${Math.round(prov.siege.progress * 100)}%`]);

    const here = armiesIn(s, id);
    const forces = here.length
      ? h('ul', { class: 'forces' }, ...here.map((a) =>
          h('li', { onclick: () => this.act.selectArmy(a.id), title: 'Select army' },
            swatch(s.nations[a.owner].color), h('span', null, a.name), h('span', { class: 'dim' }, s.nations[a.owner].shortName),
            h('strong', null, a.strength.toFixed(0)))))
      : null;

    const nationRows: [string, ...(Node | string)[]][] = [['Territory', `${owned.length} provinces (${share}%)`]];
    if (owner.capital) nationRows.push(['Capital', this.map.byId.get(owner.capital)?.name ?? '—']);
    nationRows.push(['Armies', String(Object.values(s.armies).filter((a) => a.owner === owner.id).length)]);
    if (allies.length) nationRows.push(['Allies', names(allies)]);
    if (enemies.length) nationRows.push(['At war with', h('span', { class: 'danger-text' }, names(enemies))]);
    if (player && player !== owner.id) {
      const r = getRelation(s, player, owner.id);
      const rel = relationLabel(r);
      nationRows.push(['Relations', h('span', { class: 'relation', style: `color:${rel.color}` }, `${rel.text} (${r})`)]);
    }

    fill(this.info, 
      h('div', null, h('div', { class: 'eyebrow' }, 'Province'), h('h2', null, geo.name)),
      kv(provRows),
      forces ? h('div', null, h('div', { class: 'eyebrow' }, 'Forces present'), forces) : null,
      h('div', null, h('div', { class: 'eyebrow' }, owner.major ? 'Great Power' : 'Nation'), h('h3', null, owner.name)),
      kv(nationRows),
    );

    const canDeclare = !!player && player !== owner.id && !atWar(s, player, owner.id) && !(friendly(s, player, owner.id) && !allied(s, player, owner.id));
    const key = `prov|${id}|${!!player}|${canDeclare}|${owner.id}`;
    this.setActions(key, [
      !player ? h('button', { class: 'btn primary', onclick: () => this.act.chooseNation(owner.id) }, `Lead ${owner.shortName}`) : null,
      player && player !== owner.id ? h('button', { class: 'btn', onclick: () => this.act.diplomacy(owner.id) }, `Talk to ${owner.shortName}`) : null,
      canDeclare ? h('button', { class: 'btn danger', onclick: () => this.act.declareWar(owner.id) }, `Declare war on ${owner.shortName}`) : null,
      this.focusBtn(id),
    ]);
  }

  private focusBtn(provinceId: string) {
    return h('button', { class: 'btn', onclick: () => this.act.focus(provinceId) }, 'Center on map');
  }

  private setActions(key: string, nodes: (HTMLElement | null)[]) {
    if (key === this.actionsKey) return;
    this.actionsKey = key;
    this.actions.replaceChildren(...nodes.filter((n): n is HTMLElement => n !== null));
  }
}

