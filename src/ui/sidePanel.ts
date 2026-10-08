import { mergeable } from '../core/actions';
import { findPath, garrisonMax, garrisonOf, isFleet } from '../core/military';
import { allied, armiesIn, atWar, enemiesOf, friendly, getRelation, provincesOf } from '../core/queries';
import { BUILDINGS, budgetOf, buildError, needsOf, recruitableTypes, recruitCost, recruitError } from '../core/economy';
import { basePop, formatPop, nationPop, popOf } from '../core/population';
import type { Army, BuildingId, GameState, NationId } from '../core/types';
import type { World } from '../core/world';
import type { MapData } from '../map/mapData';
import { fill, h, swatch } from './dom';

/** A touch screen without a mouse (phones, tablets). */
export const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

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

export type Selection = { kind: 'province'; id: string } | { kind: 'army'; id: string } | { kind: 'armies'; ids: string[] } | null;

export interface PanelActions {
  chooseNation(nation: NationId): void;
  declareWar(target: NationId): void;
  selectArmy(id: string): void;
  armyOrder(type: 'stopArmy' | 'splitArmy' | 'mergeArmies', army: string): void;
  /** Start choosing a target for a unit's strike (air units, drones). */
  strike(army: string): void;
  /** Orders for a selected group: halt all, merge where possible, or clear the selection. */
  groupOrder(type: 'stop' | 'merge' | 'clear', ids: string[]): void;
  focus(provinceId: string): void;
  diplomacy(nation: NationId): void;
  recruit(province: string, unitType: string): void;
  build(province: string, building: BuildingId): void;
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
    const close = h('button', { class: 'side-close', title: 'Close', 'aria-label': 'Close', onclick: () => this.act.groupOrder('clear', []) }, '✕');
    this.el.append(close, this.info, this.actions);
  }

  render(s: GameState, sel: Selection) {
    // nothing selected: on phones the panel (a bottom sheet) hides
    this.el.classList.toggle('idle', !sel);
    if (sel?.kind === 'armies') this.renderGroup(s, sel.ids.map((id) => s.armies[id]).filter((a): a is Army => !!a));
    else if (sel?.kind === 'army' && s.armies[sel.id]) this.renderArmy(s, s.armies[sel.id]);
    else if (sel?.kind === 'province') this.renderProvince(s, sel.id);
    else {
      fill(this.info, 
        h('h3', null, 'Command'),
        h('p', { class: 'empty' }, s.playerNation
          ? 'Click one of your army counters, then click a province to send it there. Right-click also orders a move.'
          : `Click a province to inspect it and choose the nation you will lead. ${TOUCH ? 'Pinch to zoom, drag to pan.' : 'Scroll to zoom, drag to pan.'}`),
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
    const fleet = isFleet(this.world, a.unitType);
    const engaged = a.progress === 0 && Object.values(s.armies).some((b) => b.location === a.location && b.progress === 0 &&
      isFleet(this.world, b.unitType) === fleet && atWar(s, a.owner, b.owner));

    let status: string;
    const siege = s.provinces[a.location].siege;
    if (engaged && s.battles[a.location] !== undefined) {
      const days = Math.floor((s.clock.hours - s.battles[a.location]) / 24) + 1;
      status = fleet ? `Naval battle off ${name(a.location)} (day ${days})` : `In battle at ${name(a.location)} (day ${days})`;
    } else if (!fleet && siege?.by === a.owner && a.progress === 0) {
      status = siege.progress > 0 || garrisonOf(s, a.location) <= 0.05
        ? `Capturing ${name(a.location)} — ${Math.round(siege.progress * 100)}%`
        : `Fighting the garrison of ${name(a.location)} (${garrisonOf(s, a.location).toFixed(1)} left)`;
    } else if (a.path.length) {
      const dest = a.path[a.path.length - 1];
      const eta = findPath(s, this.world, a.owner, a.unitType, a.location, dest);
      status = `${fleet ? 'Sailing' : 'Marching'} to ${name(dest)}${eta ? ` — about ${formatDuration(eta.hours)}` : ''}`;
    } else status = fleet ? `On station off ${name(a.location)}` : `Holding at ${name(a.location)}`;
    const strike = unit?.strike;
    const ready = !strike || (a.readyAt ?? 0) <= s.clock.hours;
    const abilities = fleet
      ? [unit?.bombard ? 'shells enemy troops on this coast' : null,
         strike ? `${strike.kind === 'air' ? 'carrier air strikes' : 'missile strikes'} up to ${Math.round(strike.range * 6.7)} km` : null,
         'escorts landings and blockades enemy crossings'].filter(Boolean).join('; ')
      : null;

    fill(this.info, 
      h('div', null, h('div', { class: 'eyebrow' }, `${mine ? 'Your ' : ''}${fleet ? 'fleet' : 'army'}`.replace(/^./, (c) => c.toUpperCase())), h('h2', null, a.name)),
      h('dl', { class: 'kv' },
        h('dt', null, 'Nation'), h('dd', null, swatch(owner.color), owner.name),
        h('dt', null, 'Type'), h('dd', null, unit?.name ?? a.unitType),
        h('dt', null, 'Strength'), h('dd', null,
          h('span', { class: 'bar' }, h('span', { style: `width:${Math.round(frac * 100)}%;background:${frac > 0.6 ? 'var(--ok)' : frac > 0.3 ? 'var(--accent)' : 'var(--danger)'}` })),
          `${a.strength.toFixed(1)} / ${a.maxStrength.toFixed(0)}`),
        unit ? h('dt', null, 'Attack · Def') : null, unit ? h('dd', null, `${unit.attack} · ${unit.defense}  ·  speed ${unit.speed}`) : null,
        h('dt', null, 'Status'), h('dd', null, status),
        abilities ? h('dt', null, 'Role') : null, abilities ? h('dd', null, abilities) : null,
        strike ? h('dt', null, strike.kind === 'air' ? 'Air strike' : 'Drone strike') : null,
        strike ? h('dd', null, ready ? h('span', { class: 'ok-text' }, 'Ready') : `${strike.kind === 'air' ? 'Rearming' : 'Reloading'} — ${formatDuration((a.readyAt ?? 0) - s.clock.hours)}`) : null,
      ),
      mine ? h('p', { class: 'hint' }, fleet
        ? 'Click a coastal province to sail there. Fleets fight enemy fleets they meet and keep the sea open for your troops.'
        : 'Click a province to move. Enemy provinces are attacked: beat the local garrison, then the province is taken.') : null,
    );

    if (!mine) return this.setActions(`army-other|${a.location}`, [this.focusBtn(a.location)]);
    const canMerge = mergeable(s, a.id).length > 0;
    const moving = a.path.length > 0;
    const key = `army|${a.id}|${moving}|${canMerge}|${a.strength >= 2}|${ready}`;
    this.setActions(key, [
      strike ? h('button', { class: 'btn danger', disabled: !ready || a.progress > 0, title: 'Choose a target within range (Esc cancels)', onclick: () => this.act.strike(a.id) },
        strike.kind === 'air' ? 'Air strike…' : 'Drone strike…') : null,
      moving ? h('button', { class: 'btn', title: 'Stop and hold where it is (it finishes the stretch it is on)', onclick: () => this.act.armyOrder('stopArmy', a.id) }, 'Halt') : null,
      a.strength >= 2 ? h('button', { class: 'btn', title: 'Split into two armies of half strength', onclick: () => this.act.armyOrder('splitArmy', a.id) }, 'Split') : null,
      canMerge ? h('button', { class: 'btn', title: 'Merge idle armies of the same type here', onclick: () => this.act.armyOrder('mergeArmies', a.id) }, 'Merge') : null,
      this.focusBtn(a.location),
    ]);
  }

  // ---- group --------------------------------------------------------------------------------------

  private renderGroup(s: GameState, armies: Army[]) {
    const fleets = armies.filter((a) => isFleet(this.world, a.unitType)).length;
    const strength = armies.reduce((x, a) => x + a.strength, 0);
    const name = (id: string) => this.map.byId.get(id)?.name ?? id;
    const moving = armies.filter((a) => a.path.length).length;
    const canMerge = armies.some((a) => mergeable(s, a.id).length > 0);
    fill(this.info,
      h('div', null, h('div', { class: 'eyebrow' }, 'Your forces'), h('h2', null, `${armies.length} selected`)),
      h('dl', { class: 'kv' },
        h('dt', null, 'Armies'), h('dd', null, String(armies.length - fleets)),
        fleets ? h('dt', null, 'Fleets') : null, fleets ? h('dd', null, String(fleets)) : null,
        h('dt', null, 'Strength'), h('dd', null, strength.toFixed(0)),
        h('dt', null, 'Moving'), h('dd', null, String(moving)),
      ),
      h('ul', { class: 'forces' }, ...armies.map((a) =>
        h('li', { onclick: () => this.act.selectArmy(a.id), title: 'Select only this one' },
          swatch(s.nations[a.owner].color), h('span', null, a.name), h('span', { class: 'dim' }, name(a.location)), h('strong', null, a.strength.toFixed(0))))),
      h('p', { class: 'hint' }, 'Click a province to send them all there (each takes its own route). Shift+click a counter to add or remove it; Shift+drag on the map to box-select.'),
    );
    const ids = armies.map((a) => a.id);
    this.setActions(`group|${ids.join(',')}|${moving > 0}|${canMerge}`, [
      moving ? h('button', { class: 'btn', onclick: () => this.act.groupOrder('stop', ids) }, 'Halt all') : null,
      canMerge ? h('button', { class: 'btn', title: 'Merge armies of the same type standing together', onclick: () => this.act.groupOrder('merge', ids) }, 'Merge') : null,
      h('button', { class: 'btn', onclick: () => this.act.groupOrder('clear', ids) }, 'Deselect'),
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
    const g = garrisonOf(s, id), gMax = garrisonMax(s, id);
    provRows.push(['Garrison', h('span', { class: g < gMax * 0.5 ? 'danger-text' : '' }, `${g.toFixed(1)} / ${gMax.toFixed(1)}${g < gMax - 0.05 ? ' (recovering)' : ''}`)]);
    const pop = popOf(s, this.world, id), base = basePop(s, this.world, id);
    provRows.push(['Population', pop < base * 0.995 ? h('span', { class: 'danger-text', title: 'Civilians killed or fled in the fighting; they slowly return in peacetime' }, `${formatPop(pop)} (−${Math.round((1 - pop / base) * 100)}% from war)`) : formatPop(pop)]);
    const res = this.world.resources[this.world.provinces[id]?.resource ?? ''];
    if (res) provRows.push(['Resource', h('span', { title: res.units?.length ? `Needed by: ${res.units.filter((u) => this.world.unitTypes[u]).map((u) => this.world.unitTypes[u].name).join(', ')}` : 'Sold for money' }, swatch(res.color), `${res.name} (+${res.value}/month)`)]);
    if (prov.build?.length) provRows.push(['Buildings', prov.build.map((b) => BUILDINGS[b].name).join(', ')]);
    if (prov.siege) provRows.push(['Under siege', `${s.nations[prov.siege.by].shortName} — ${prov.siege.progress > 0 || g <= 0.05 ? `${Math.round(prov.siege.progress * 100)}%` : 'fighting the garrison'}`]);

    const here = armiesIn(s, id);
    const forces = here.length
      ? h('ul', { class: 'forces' }, ...here.map((a) =>
          h('li', { onclick: () => this.act.selectArmy(a.id), title: 'Select army' },
            swatch(s.nations[a.owner].color), h('span', null, a.name), h('span', { class: 'dim' }, s.nations[a.owner].shortName),
            h('strong', null, a.strength.toFixed(0)))))
      : null;

    const nationRows: [string, ...(Node | string)[]][] = [['Territory', `${owned.length} provinces (${share}%)`]];
    if (owner.capital) nationRows.push(['Capital', this.map.byId.get(owner.capital)?.name ?? '—']);
    const forcesOf = Object.values(s.armies).filter((a) => a.owner === owner.id);
    const fleets = forcesOf.filter((a) => isFleet(this.world, a.unitType)).length;
    nationRows.push(['Armies', String(forcesOf.length - fleets)]);
    nationRows.push(['Population', formatPop(nationPop(s, this.world, owner.id))]);
    if ((owner.civDeaths ?? 0) > 0) nationRows.push(['Civilian deaths', h('span', { class: 'danger-text' }, formatPop(owner.civDeaths!))]);
    if (owner.id === player || !player) {
      const b = budgetOf(s, this.world, owner.id);
      nationRows.push(['Treasury', `${Math.floor(owner.treasury ?? 0)} (${b.net >= 0 ? '+' : ''}${b.net}/month)`]);
    }
    if (fleets) nationRows.push(['Fleets', String(fleets)]);
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
    // recruiting and building in your own provinces
    const econ: { label: string; err: string | null; title: string; run: () => void }[] = [];
    if (player && owner.id === player) {
      for (const u of recruitableTypes(this.world)) {
        const def = this.world.unitTypes[u];
        const needs = needsOf(this.world, u).map((r) => this.world.resources[r]?.name ?? r);
        const where = def.strike ? 'airfield' : 'barracks';
        if (!prov.build?.includes(where)) continue;
        econ.push({ label: `${def.name} · ${recruitCost(s, this.world, player, u)}`, err: recruitError(s, this.world, player, id, u),
          title: `Recruit a new ${def.name.toLowerCase()} here (attack ${def.attack}, defence ${def.defense}). It starts at ${Math.round(40)}% strength and trains up.${needs.length ? ` Needs ${needs.join(' and ')}: without it, it costs more.` : ''}`,
          run: () => this.act.recruit(id, u) });
      }
      for (const b of Object.keys(BUILDINGS) as BuildingId[]) {
        if (prov.build?.includes(b)) continue;
        const err = buildError(s, this.world, player, id, b);
        if (err && /no aircraft/.test(err)) continue;
        econ.push({ label: `Build ${BUILDINGS[b].name.toLowerCase()} · ${BUILDINGS[b].cost}`, err, title: BUILDINGS[b].text, run: () => this.act.build(id, b) });
      }
    }
    const key = `prov|${id}|${!!player}|${canDeclare}|${owner.id}|${econ.map((e) => `${e.label}:${e.err ?? ''}`).join(',')}`;
    this.setActions(key, [
      ...(econ.length ? [h('div', { class: 'side-subhead' }, 'Recruit and build')] : []),
      ...econ.map((e) => h('button', { class: 'btn econ-btn', disabled: !!e.err, title: e.err ?? e.title, onclick: e.run }, e.label)),
      !player ? h('button', { class: 'btn primary', title: 'Play as this nation for the rest of the game', onclick: () => this.act.chooseNation(owner.id) }, `Lead ${owner.shortName}`) : null,
      player && player !== owner.id ? h('button', { class: 'btn', title: 'Open a conversation with their leader: talk, propose deals (D)', onclick: () => this.act.diplomacy(owner.id) }, `Talk to ${owner.shortName}`) : null,
      canDeclare ? h('button', { class: 'btn danger', title: 'Start a war: their allies may join them, and any treaty with them is broken', onclick: () => this.act.declareWar(owner.id) }, `Declare war on ${owner.shortName}`) : null,
      this.focusBtn(id),
    ]);
  }

  private focusBtn(provinceId: string) {
    return h('button', { class: 'btn', title: 'Move the map to this province', onclick: () => this.act.focus(provinceId) }, 'Center on map');
  }

  private setActions(key: string, nodes: (HTMLElement | null)[]) {
    if (key === this.actionsKey) return;
    this.actionsKey = key;
    this.actions.replaceChildren(...nodes.filter((n): n is HTMLElement => n !== null));
  }
}

