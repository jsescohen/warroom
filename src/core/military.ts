import { atWar, friendly, getRelation, provincesOf } from './queries';
import { nextRandom } from './rng';
import type { UnitTypeDef } from './scenario';
import { aiEdge, type Army, type ArmyId, type GameEvent, type GameState, type Nation, type NationId, type ProvinceId, type ProvinceState } from './types';
import type { Link, World } from './world';

// ---- tuning -----------------------------------------------------------------------------------
const DAMAGE_PER_DAY = 0.12; // fraction of (strength x attack) inflicted per day of battle
const CAPITAL_DEFENSE = 1.25;
const CAPTURE_PER_DAY = 1.0; // an unopposed full-strength army takes about a day to capture a province
const REINFORCE_PER_DAY = 0.03;
const MOBILIZE_EVERY_DAYS = 30;
const FLEET_BUILD_EVERY_DAYS = 60;
export const BASE_STRENGTH = 10;
/** A fleeing government relocates at least this far (map units, ~600 km in Europe). */
const CAPITAL_FLIGHT_DIST = 90;
const possessive = (name: string) => (name.endsWith('s') ? `${name}'` : `${name}'s`);
/** Armies landing from the sea attack at this fraction of their strength for AMPHIBIOUS_HOURS. */
const AMPHIBIOUS_PENALTY = 0.6;
const AMPHIBIOUS_HOURS = 48;
/** Province garrisons: defence value per strength point, and regrowth per day (fraction of full). */
const GARRISON_DEFENSE = 2.5;
const GARRISON_REGEN_PER_DAY = 0.1;
/** Shore bombardment damage per day per strength point and bombard factor (weaker than a battle line). */
const BOMBARD_PER_DAY = 0.06;
/** Troops crossing a sea the enemy controls lose this fraction of their strength per day. */
const CONVOY_LOSS_PER_DAY = 0.3;
/** Enemy fleets control a sea area when they are this much stronger than ours there. */
const SEA_CONTROL_EDGE = 1.2;
/** Fleets this many map units out count half towards sea control of a province (see seaPower). */
const SEA_REACH = 90;

// ---- naming -------------------------------------------------------------------------------------
const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
export const armyName = (n: number, unit: UnitTypeDef | undefined) => `${ordinal(n)} ${unit?.short ?? 'Army'}`;

// ---- unit classes -------------------------------------------------------------------------------

export const isFleet = (world: World, unitType: string) => world.unitTypes[unitType]?.domain === 'sea';
export const isFleetArmy = (world: World, a: Army) => isFleet(world, a.unitType);
/** The era's fleet types, in scenario order. */
export const seaUnitTypes = (world: World) => Object.values(world.unitTypes).filter((u) => u.domain === 'sea').map((u) => u.id);
const counterKey = (n: NationId, fleet: boolean) => (fleet ? `${n}:fleet` : n);

/**
 * Province count for army size: the homeland counts fully, distant colonies at a quarter
 * (otherwise colonial empires would field enormous home armies).
 */
export function effectiveSize(s: GameState, world: World, n: NationId, owned: ProvinceId[]): number {
  const cap = s.nations[n]?.capital;
  const at = cap ? world.provinces[cap]?.label : undefined;
  if (!at) return owned.length;
  return owned.reduce((x, p) => {
    const q = world.provinces[p].label;
    return x + (Math.hypot(q[0] - at[0], q[1] - at[1]) <= HOMELAND_RADIUS ? 1 : 0.25);
  }, 0);
}
const HOMELAND_RADIUS = 200;

/** Target number of field armies for a nation of this size. */
export const armyCap = (provinceCount: number, military: number) =>
  Math.max(1, Math.min(30, Math.round(military * (2 + Math.sqrt(provinceCount)))));

/** Target number of fleets: about six for a first-rate naval power, none without a coast. */
export function fleetCap(s: GameState, world: World, n: NationId): number {
  const nation = s.nations[n];
  if (!nation?.alive || !seaUnitTypes(world).length || !homePort(s, world, n)) return 0;
  return Math.round(Math.min(1, nation.naval) * 6);
}

/** Where a nation's fleets are based: the capital if on the coast, else the nearest coastal province. */
export function homePort(s: GameState, world: World, n: NationId): ProvinceId | null {
  const cap = s.nations[n]?.capital;
  if (!cap) return null;
  if (world.provinces[cap]?.coastal) return cap;
  const at = world.provinces[cap].label;
  let best: ProvinceId | null = null, bestD = Infinity;
  for (const id of world.order) {
    if (s.provinces[id]?.owner !== n || !world.provinces[id].coastal) continue;
    const q = world.provinces[id].label;
    const d = Math.hypot(q[0] - at[0], q[1] - at[1]);
    if (d < bestD) { best = id; bestD = d; }
  }
  return best;
}

// ---- garrisons ----------------------------------------------------------------------------------

/**
 * Every province has defenders of its own (militia, fortresses, local troops): about a third of an
 * army in the homeland, a tenth in occupied land, more at the capital. They must be beaten before
 * a province can be taken, and slowly recover when no enemy is present.
 */
export function garrisonMax(s: GameState, p: ProvinceId): number {
  const ps = s.provinces[p];
  const n = ps && s.nations[ps.owner];
  if (!n?.alive) return 0;
  const home = ps.core === ps.owner ? 2 : 0.7;
  return Math.round((home * Math.sqrt(Math.max(0.3, n.military)) + (n.capital === p ? 5 : 0)) * 10) / 10;
}
export const garrisonOf = (s: GameState, p: ProvinceId) => s.provinces[p]?.garrison ?? garrisonMax(s, p);
/** Garrison strength as defensive power (comparable to armyPower of a defending army). */
export const garrisonPower = (s: GameState, p: ProvinceId) => {
  const owner = s.provinces[p]?.owner;
  return garrisonOf(s, p) * (s.nations[owner]?.quality ?? 1) * GARRISON_DEFENSE * (s.rules.homeDefense ?? 1.2) * (s.nations[owner]?.capital === p ? CAPITAL_DEFENSE : 1);
};

// ---- sea control --------------------------------------------------------------------------------

export const fleetPower = (s: GameState, world: World, a: Army) => a.strength * (s.nations[a.owner]?.quality ?? 1) * (world.unitTypes[a.unitType]?.attack ?? 3);

/** Fleets on station (not under way), grouped by province. */
export function fleetsByProvince(s: GameState, world: World): Map<ProvinceId, Army[]> {
  const m = new Map<ProvinceId, Army[]>();
  for (const a of Object.values(s.armies)) {
    if (a.progress > 0 || !isFleet(world, a.unitType)) continue;
    if (!m.has(a.location)) m.set(a.location, []);
    m.get(a.location)!.push(a);
  }
  return m;
}

/** Naval power friendly and hostile to `n` around a province: fleets there count fully, nearby ones half. */
export function seaPower(s: GameState, world: World, n: NationId, p: ProvinceId, fleets = fleetsByProvince(s, world)) {
  let own = 0, enemy = 0;
  const at = world.provinces[p].label;
  for (const [q, list] of fleets) {
    let w = 1;
    if (q !== p) {
      const l = world.provinces[q].label;
      const d = Math.hypot(l[0] - at[0], l[1] - at[1]);
      if (d > SEA_REACH) continue;
      w = 0.5;
    }
    for (const f of list) {
      if (friendly(s, n, f.owner)) own += fleetPower(s, world, f) * w;
      else if (atWar(s, n, f.owner)) enemy += fleetPower(s, world, f) * w;
    }
  }
  return { own, enemy };
}

/** True when enemy fleets control the waters off a province: troops cannot cross there. */
export function seaDenied(s: GameState, world: World, n: NationId, p: ProvinceId, fleets?: Map<ProvinceId, Army[]>): boolean {
  const { own, enemy } = seaPower(s, world, n, p, fleets);
  return enemy > 0 && enemy > own * SEA_CONTROL_EDGE;
}

// ---- movement queries -------------------------------------------------------------------------

/**
 * Armies may enter their own and friendly provinces, and enemy provinces (to attack them).
 * Fleets sail off any coast: the sea belongs to nobody.
 */
export function canEnter(s: GameState, nation: NationId, province: ProvinceId, world?: World, unitType?: string): boolean {
  const owner = s.provinces[province]?.owner;
  if (!owner) return false;
  if (world && unitType && isFleet(world, unitType)) return !!world.provinces[province]?.coastal;
  return friendly(s, nation, owner) || atWar(s, nation, owner);
}

export function linkHours(world: World, unitType: string, link: Link): number {
  const speed = world.unitTypes[unitType]?.speed ?? 20; // map units per day
  const fleet = isFleet(world, unitType);
  return (link.dist / (speed * (link.sea && !fleet ? world.seaSpeed : 1))) * 24;
}

/** Fleets follow sea lanes, and the coast between neighbouring coastal provinces. */
const fleetLink = (world: World, from: ProvinceId, l: Link) => l.sea || (world.provinces[from].coastal && world.provinces[l.to].coastal);

export interface PathResult {
  path: ProvinceId[];
  hours: number;
}

/**
 * Fastest route (Dijkstra). Enemy provinces on the way add an estimate of the capture time;
 * armies avoid crossing seas the enemy controls. Fleets keep to the water.
 */
export function findPath(s: GameState, world: World, owner: NationId, unitType: string, from: ProvinceId, to: ProvinceId,
  opts: { ignoreSeaControl?: boolean } = {}): PathResult | null {
  if (from === to) return { path: [], hours: 0 };
  if (!world.provinces[to] || !canEnter(s, owner, to, world, unitType)) return null;
  const fleet = isFleet(world, unitType);
  const fleets = fleet || opts.ignoreSeaControl ? undefined : fleetsByProvince(s, world);
  const denied = new Map<ProvinceId, boolean>();
  const blocked = (p: ProvinceId) => {
    if (!fleets?.size) return false;
    if (!denied.has(p)) denied.set(p, seaDenied(s, world, owner, p, fleets));
    return denied.get(p)!;
  };
  const dist = new Map<ProvinceId, number>([[from, 0]]);
  const prev = new Map<ProvinceId, ProvinceId>();
  const heap = new MinHeap();
  heap.push(0, from);
  const captureHours = (24 / CAPTURE_PER_DAY) * (s.rules.captureDays ?? 1);
  while (heap.size) {
    const [d, id] = heap.pop()!;
    if (id === to) break;
    if (d > (dist.get(id) ?? Infinity)) continue;
    // cannot route *through* an enemy province without stopping to take it
    const extra = !fleet && id !== from && atWar(s, owner, s.provinces[id].owner) ? captureHours : 0;
    for (const l of world.provinces[id].links) {
      if (!canEnter(s, owner, l.to, world, unitType)) continue;
      if (fleet ? !fleetLink(world, id, l) : l.sea && (blocked(id) || blocked(l.to))) continue;
      const nd = d + extra + linkHours(world, unitType, l);
      if (nd < (dist.get(l.to) ?? Infinity)) {
        dist.set(l.to, nd);
        prev.set(l.to, id);
        heap.push(nd, l.to);
      }
    }
  }
  if (!dist.has(to)) return null;
  const path: ProvinceId[] = [];
  for (let c: ProvinceId | undefined = to; c && c !== from; c = prev.get(c)) path.unshift(c);
  const enemyStops = fleet ? 0 : path.filter((p) => atWar(s, owner, s.provinces[p].owner)).length;
  return { path, hours: Math.round(dist.get(to)! + enemyStops * captureHours) };
}

// ---- ownership ----------------------------------------------------------------------------------

/**
 * Changes a province's owner and handles the consequences: capital relocation, nation collapse
 * (armies disbanded, removed from wars and treaties) and expelling armies that may not stay.
 * A newly taken province starts with an empty garrison that regrows over time.
 */
export function setOwner(s: GameState, province: ProvinceId, to: NationId, log: (s: GameState, ev: Omit<GameEvent, 'id' | 'at'>) => GameState, world?: World): GameState {
  const from = s.provinces[province].owner;
  if (from === to) return s;
  const provinces: Record<ProvinceId, ProvinceState> = { ...s.provinces, [province]: { owner: to, core: s.provinces[province].core, garrison: 0 } };
  let next: GameState = { ...s, provinces };
  const loser = s.nations[from];
  const remaining = Object.keys(provinces).filter((id) => provinces[id].owner === from);

  if (!remaining.length) {
    next = {
      ...next,
      nations: { ...next.nations, [from]: { ...loser, alive: false, capital: null } },
      armies: Object.fromEntries(Object.entries(next.armies).filter(([, a]) => a.owner !== from)),
      wars: next.wars
        .map((w) => ({ ...w, attackers: w.attackers.filter((n) => n !== from), defenders: w.defenders.filter((n) => n !== from) }))
        .filter((w) => w.attackers.length && w.defenders.length),
      treaties: next.treaties.map((t) => ({ ...t, parties: t.parties.filter((n) => n !== from) })).filter((t) => t.parties.length >= 2),
    };
    next = log(next, { kind: 'annexed', text: `${loser.name} has fallen to ${s.nations[to].name}.`, nations: [from, to], important: true });
  } else if (loser.capital === province) {
    // the government flees well away from the front: the nearest province at a safe distance,
    // or the farthest one it still holds
    const at = world?.provinces[province]?.label;
    let newCap = remaining[0];
    if (at) {
      const d = (p: ProvinceId) => Math.hypot(world!.provinces[p].label[0] - at[0], world!.provinces[p].label[1] - at[1]);
      const byDist = [...remaining].sort((a, b) => d(a) - d(b) || (a < b ? -1 : 1));
      newCap = byDist.find((p) => d(p) >= CAPITAL_FLIGHT_DIST) ?? byDist[byDist.length - 1];
    }
    next = { ...next, nations: { ...next.nations, [from]: { ...loser, capital: newCap } } };
    next = log(next, { kind: 'capital', text: `${s.nations[to].shortName} takes ${possessive(loser.shortName)} capital! The government flees.`, nations: [from, to], important: true });
  }

  // Armies of nations neither friendly nor at war with the new owner cannot stay: send them home.
  // Fleets stay at sea.
  const armies = { ...next.armies };
  for (const a of Object.values(armies)) {
    if (a.location !== province || friendly(next, a.owner, to) || atWar(next, a.owner, to)) continue;
    if (world && isFleet(world, a.unitType)) continue;
    const home = next.nations[a.owner]?.capital;
    if (home) armies[a.id] = { ...a, location: home, path: [], progress: 0 };
    else delete armies[a.id];
  }
  return { ...next, armies };
}

// ---- simulation ---------------------------------------------------------------------------------

type Logger = (s: GameState, ev: Omit<GameEvent, 'id' | 'at'>) => GameState;

/** One tick of military simulation: movement → combat → capture → reinforcement/mobilization. */
export function militaryTick(state: GameState, world: World, log: Logger): GameState {
  let rng = state.rng;
  const rand = () => {
    const [v, n] = nextRandom(rng);
    rng = n;
    return v;
  };
  const tickDays = state.clock.tickHours / 24;
  let s = state;
  const armies: Record<ArmyId, Army> = { ...s.armies };
  const ids = Object.keys(armies).sort();
  const player = s.playerNation;
  const fleet = (id: ArmyId) => isFleet(world, armies[id].unitType);

  const hostilePresent = (province: ProvinceId, nation: NationId, sea: boolean) =>
    ids.some((id) => armies[id] && armies[id].location === province && armies[id].progress === 0 && fleet(id) === sea && atWar(s, nation, armies[id].owner));

  // 1. movement
  const fleetsNow = fleetsByProvince(s, world);
  const deniedCache = new Map<string, boolean>();
  const denied = (n: NationId, p: ProvinceId) => {
    const k = `${n}|${p}`;
    if (!deniedCache.has(k)) deniedCache.set(k, seaDenied(s, world, n, p, fleetsNow));
    return deniedCache.get(k)!;
  };
  for (const id of ids) {
    const a = armies[id];
    if (!a.path.length) continue;
    const sea = fleet(id);
    const here = a.location, next = a.path[0];
    const nextFriendly = friendly(s, a.owner, s.provinces[next]?.owner ?? '');
    if (a.progress === 0 && !sea) {
      // must capture an enemy province before pushing on, and can only fall back out of a battle
      if (!nextFriendly && (atWar(s, a.owner, s.provinces[here].owner) || hostilePresent(here, a.owner, false))) continue;
    }
    const link = world.provinces[here].links.find((l) => l.to === next);
    if (!link || !canEnter(s, a.owner, next, world, a.unitType)) {
      armies[id] = { ...a, path: [], progress: 0 };
      continue;
    }
    // troops can only put to sea where the enemy does not rule the waves, and suffer if caught at sea
    if (link.sea && !sea && (denied(a.owner, here) || denied(a.owner, next))) {
      if (a.progress === 0) {
        armies[id] = { ...a, path: [] };
        if (a.owner === player) s = log(s, { kind: 'blockade', text: `${a.name} cannot sail from ${provinceName(world, here)}: enemy fleets control the sea.`, nations: [a.owner], important: true });
        continue;
      }
      const strength = a.strength - a.maxStrength * CONVOY_LOSS_PER_DAY * tickDays;
      if (strength < 0.5) {
        delete armies[id];
        if (a.owner === player) s = log(s, { kind: 'army-destroyed', text: `${a.name} was lost at sea to enemy fleets.`, nations: [a.owner], important: true });
        continue;
      }
      armies[id] = { ...a, strength };
    }
    const cur = armies[id];
    const progress = cur.progress + state.clock.tickHours / linkHours(world, cur.unitType, link);
    if (progress < 1) { armies[id] = { ...cur, progress }; continue; }
    // landing from the sea into hostile territory: the troops fight at a disadvantage for a while
    const landing = !sea && link.sea && !nextFriendly;
    armies[id] = { ...cur, location: next, path: cur.path.slice(1), progress: 0, landedUntil: landing ? s.clock.hours + AMPHIBIOUS_HOURS : cur.landedUntil };
  }

  // 2. combat: hostile units in the same province fight (armies with armies, fleets with fleets);
  // garrisons fight invaders; fleets give gunfire support to their own troops fighting ashore.
  // Damage is applied simultaneously.
  const byProvince = new Map<ProvinceId, ArmyId[]>();
  for (const id of ids) {
    const a = armies[id];
    if (!a || a.progress > 0) continue;
    if (!byProvince.has(a.location)) byProvince.set(a.location, []);
    byProvince.get(a.location)!.push(id);
  }
  const battles = { ...s.battles };
  const damage = new Map<ArmyId, number>();
  const garrisonLoss = new Map<ProvinceId, number>();
  const fought = new Set<ProvinceId>();
  const garrisonAt = new Map<ProvinceId, number>();
  for (const [province, here] of [...byProvince.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    const owner = s.provinces[province].owner;
    const g = garrisonOf(s, province);
    garrisonAt.set(province, g);
    const invaders = here.filter((id) => !fleet(id) && atWar(s, armies[id].owner, owner));
    const hit = (out: number, targets: ArmyId[], garrison: number) => {
      const total = targets.reduce((sum, t) => sum + armies[t].strength, 0) + garrison;
      if (total <= 0) return;
      for (const t of targets) damage.set(t, (damage.get(t) ?? 0) + (out * armies[t].strength) / total);
      if (garrison > 0) garrisonLoss.set(province, (garrisonLoss.get(province) ?? 0) + (out * garrison) / total);
    };
    let any = false;
    for (const id of here) {
      const a = armies[id];
      const sea = fleet(id);
      const unit = world.unitTypes[a.unitType];
      const quality = (s.nations[a.owner]?.quality ?? 1) * aiEdge(s, a.owner);
      const targets = here.filter((t) => fleet(t) === sea && atWar(s, a.owner, armies[t].owner));
      const vsGarrison = !sea && g > 0 && atWar(s, a.owner, owner);
      if (targets.length || vsGarrison) {
        if (targets.length) any = true;
        const defending = !sea && friendly(s, a.owner, owner);
        const bonus = defending ? (s.rules.homeDefense ?? 1.2) * (s.nations[owner]?.capital === province ? CAPITAL_DEFENSE : 1) : 1;
        const landed = !sea && !defending && (a.landedUntil ?? -1) > s.clock.hours ? AMPHIBIOUS_PENALTY : 1;
        const out = a.strength * quality * (defending ? unit?.defense ?? 3 : unit?.attack ?? 3) * bonus * landed * DAMAGE_PER_DAY * tickDays * (0.85 + rand() * 0.3);
        hit(out, targets, vsGarrison ? g : 0);
      } else if (sea && unit?.bombard && here.some((t) => !fleet(t) && friendly(s, a.owner, armies[t].owner))) {
        // naval gunfire support: only where our own troops are fighting ashore (a landing, a coastal battle or siege)
        const ashore = here.filter((t) => !fleet(t) && atWar(s, a.owner, armies[t].owner));
        const garrison = atWar(s, a.owner, owner) ? g : 0;
        if (ashore.length || garrison > 0) hit(a.strength * quality * unit.bombard * BOMBARD_PER_DAY * tickDays * (0.85 + rand() * 0.3), ashore, garrison);
      }
    }
    // the garrison fights back against the invaders (fleets are out of its reach)
    if (g > 0 && invaders.length) {
      const q = (s.nations[owner]?.quality ?? 1) * aiEdge(s, owner);
      const bonus = (s.rules.homeDefense ?? 1.2) * (s.nations[owner]?.capital === province ? CAPITAL_DEFENSE : 1);
      hit(g * q * GARRISON_DEFENSE * bonus * DAMAGE_PER_DAY * tickDays * (0.85 + rand() * 0.3), invaders, 0);
    }
    if (any) {
      fought.add(province);
      if (battles[province] === undefined) {
        battles[province] = s.clock.hours;
        const sides = [...new Set(here.map((id) => armies[id].owner))];
        if (player && sides.includes(player)) {
          const naval = here.every((id) => fleet(id) || !here.some((t) => atWar(s, armies[id].owner, armies[t].owner) && !fleet(t)));
          const foes = sides.filter((n) => atWar(s, player, n)).map((n) => s.nations[n].shortName).join(', ');
          const where = naval ? `Naval battle off ${provinceName(world, province)}` : `Battle of ${provinceName(world, province)}`;
          s = log(s, { kind: 'battle', text: `${where} begins against ${foes}.`, nations: sides, important: true });
        }
      }
    }
  }
  for (const [id, d] of damage) {
    const a = armies[id];
    const strength = a.strength - d;
    if (strength < 0.5) {
      delete armies[id];
      if (a.owner === player || ids.some((o) => armies[o]?.owner === player && armies[o].location === a.location))
        s = log(s, { kind: 'army-destroyed', text: `${s.nations[a.owner].shortName} ${a.name} ${fleet0(world, a) ? 'sunk off' : 'destroyed at'} ${provinceName(world, a.location)}.`, nations: [a.owner], important: a.owner === player });
    } else armies[id] = { ...a, strength };
  }
  // battles that ended this tick
  const sameDomainHostile = (here: ArmyId[]) =>
    here.some((x) => here.some((y) => isFleet(world, armies[x].unitType) === isFleet(world, armies[y].unitType) && atWar(s, armies[x].owner, armies[y].owner)));
  for (const province of Object.keys(battles)) {
    if (fought.has(province)) {
      const here = (byProvince.get(province) ?? []).filter((id) => armies[id]);
      if (sameDomainHostile(here)) continue;
      const victors = [...new Set(here.map((id) => armies[id].owner))];
      if (player && (victors.includes(player) || s.provinces[province].owner === player || victors.length === 0)) {
        const name = provinceName(world, province);
        const text = victors.length ? `${victors.map((n) => s.nations[n].shortName).join(' & ')} win the Battle of ${name}.` : `The Battle of ${name} ends with both sides spent.`;
        s = log(s, { kind: 'battle-end', text, nations: victors, important: false });
      }
    }
    delete battles[province];
  }

  // province updates are batched into one copy of the province table (it has ~2,000 entries)
  let patch: Record<ProvinceId, ProvinceState> | null = null;
  const prov = (id: ProvinceId) => (patch ?? s.provinces)[id];
  const setProv = (id: ProvinceId, v: ProvinceState) => { (patch ??= { ...s.provinces })[id] = v; };
  const flush = () => { if (patch) { s = { ...s, provinces: patch }; patch = null; } };

  // garrison losses
  s = { ...s, armies, battles, rng };
  for (const [p, loss] of garrisonLoss) {
    const g = Math.max(0, (garrisonAt.get(p) ?? 0) - loss);
    setProv(p, { ...prov(p), garrison: Math.round(g * 100) / 100 });
  }

  // 3. capture: an army alone in an enemy province, once its garrison is beaten, takes it over time
  for (const [province, all] of byProvince) {
    const present = all.filter((id) => s.armies[id] && !isFleet(world, s.armies[id].unitType));
    const p = prov(province);
    const owner = p.owner;
    const besiegers = present.filter((id) => atWar(s, s.armies[id].owner, owner));
    const contested = present.some((x) => present.some((y) => atWar(s, s.armies[x].owner, s.armies[y].owner)));
    if (!besiegers.length || contested) {
      if (p.siege && !besiegers.length) setProv(province, withoutSiege(p));
      continue;
    }
    const lead = besiegers.reduce((a, b) => (s.armies[b].strength > s.armies[a].strength ? b : a));
    const by = s.armies[lead].owner;
    if ((p.garrison ?? garrisonMax(s, province)) > 0.05) {
      // still fighting the garrison: show the siege, but no progress yet
      if (p.siege?.by !== by) setProv(province, { ...p, siege: { by, progress: 0 } });
      continue;
    }
    const power = besiegers.filter((id) => s.armies[id].owner === by).reduce((sum, id) => sum + s.armies[id].strength, 0);
    const base = p.siege?.by === by ? p.siege.progress : 0;
    const progress = base + (CAPTURE_PER_DAY / (s.rules.captureDays ?? 1)) * tickDays * Math.min(1, power / 6);
    if (progress < 1) {
      setProv(province, { ...p, siege: { by, progress } });
      continue;
    }
    const wasCapital = s.nations[owner]?.capital === province;
    flush();
    s = setOwner(s, province, by, log, world);
    if (!wasCapital && (by === player || owner === player))
      s = log(s, { kind: 'capture', text: `${s.nations[by].shortName} captures ${provinceName(world, province)} from ${s.nations[owner].shortName}.`, nations: [by, owner], important: owner === player });
  }

  // sieges with nobody left besieging lapse; garrisons regrow where no invader stands
  const landAt = new Map<ProvinceId, NationId[]>();
  for (const a of Object.values(s.armies)) {
    if (a.progress > 0 || isFleet(world, a.unitType)) continue;
    if (!landAt.has(a.location)) landAt.set(a.location, []);
    landAt.get(a.location)!.push(a.owner);
  }
  for (const id of Object.keys(s.provinces)) {
    const p = prov(id);
    if (p.siege && !(landAt.get(id) ?? []).includes(p.siege.by)) setProv(id, withoutSiege(p));
    if (p.garrison !== undefined && !(landAt.get(id) ?? []).some((o) => atWar(s, o, p.owner))) {
      const max = garrisonMax(s, id);
      const g = p.garrison + max * GARRISON_REGEN_PER_DAY * tickDays;
      const { garrison: _, ...rest } = prov(id);
      setProv(id, g >= max ? rest : { ...rest, garrison: Math.round(g * 100) / 100 });
    }
  }
  flush();

  // 4. reinforcement in friendly territory (fleets: off a friendly coast), away from battle
  // (a sea battle off the coast does not stop the troops ashore from refitting, and vice versa)
  const reinforced = { ...s.armies };
  const engaged = new Set<string>();
  for (const list of byProvince.values()) {
    const here = list.filter((id) => s.armies[id]);
    for (const x of here) if (here.some((y) => isFleet(world, s.armies[x].unitType) === isFleet(world, s.armies[y].unitType) && atWar(s, s.armies[x].owner, s.armies[y].owner))) engaged.add(x);
  }
  for (const a of Object.values(reinforced)) {
    if (a.strength >= a.maxStrength || a.progress > 0 || engaged.has(a.id)) continue;
    if (!friendly(s, a.owner, s.provinces[a.location].owner)) continue;
    reinforced[a.id] = { ...a, strength: Math.min(a.maxStrength, a.strength + a.maxStrength * REINFORCE_PER_DAY * tickDays) };
  }
  s = { ...s, armies: reinforced };

  // 5. mobilization: periodically raise a new army at the capital (and launch a fleet at the home port)
  const day = s.clock.hours / 24;
  if (s.clock.hours % 24 === 0 && day > 0 && day % MOBILIZE_EVERY_DAYS === 0) {
    for (const n of Object.values(s.nations).sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (!n.alive || !n.capital) continue;
      const count = Object.values(s.armies).filter((a) => a.owner === n.id && !isFleet(world, a.unitType)).length;
      // difficulty: AI nations keep a smaller (easy) or larger (hard) army than the player could
      const d = n.id === player ? 'normal' : s.rules.difficulty ?? 'normal';
      const cap = Math.round(armyCap(effectiveSize(s, world, n.id, provincesOf(s, n.id)), n.military) * (d === 'easy' ? 0.8 : d === 'hard' ? 1.25 : 1));
      if (count >= cap) continue;
      s = raiseArmy(s, world, n, n.capital);
      if (n.id === player) s = log(s, { kind: 'mobilize', text: `A new army is raised at ${provinceName(world, n.capital)}.`, nations: [n.id] });
    }
  }
  if (s.clock.hours % 24 === 0 && day > 0 && day % FLEET_BUILD_EVERY_DAYS === 0) {
    for (const n of Object.values(s.nations).sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const port = n.alive ? homePort(s, world, n.id) : null;
      if (!port) continue;
      const count = Object.values(s.armies).filter((a) => a.owner === n.id && isFleet(world, a.unitType)).length;
      if (count >= fleetCap(s, world, n.id)) continue;
      s = raiseFleet(s, world, n, port);
      if (n.id === player) s = log(s, { kind: 'mobilize', text: `A new fleet is launched at ${provinceName(world, port)}.`, nations: [n.id] });
    }
  }

  // 6. capitulation (checked daily)
  if (s.clock.hours % 24 === 0) s = capitulations(s, world, log);

  // 7. victory / defeat
  if (player && !s.winner) {
    const total = Object.keys(s.provinces).length;
    const share = (provincesOf(s, player).length / total) * 100;
    if (share >= s.rules.victoryPercent) {
      s = { ...s, winner: player };
      s = log(s, { kind: 'victory', text: `Victory! ${s.nations[player].name} controls ${share.toFixed(0)}% of the world.`, nations: [player], important: true });
    } else if (!s.nations[player].alive && !s.events.some((e) => e.kind === 'defeat')) {
      s = log(s, { kind: 'defeat', text: `Defeat. ${s.nations[player].name} has been conquered.`, nations: [player], important: true });
    }
  }
  return s;
}

const fleet0 = (world: World, a: Army) => isFleet(world, a.unitType);
const withoutSiege = (p: ProvinceState): ProvinceState => {
  const { siege: _, ...rest } = p;
  return rest;
};

// ---- strikes ------------------------------------------------------------------------------------

/** Why a fleet cannot strike a province right now, or null if it can. */
export function strikeError(s: GameState, world: World, fleetId: ArmyId, target: ProvinceId): string | null {
  const a = s.armies[fleetId];
  if (!a) return 'That fleet no longer exists';
  const strike = world.unitTypes[a.unitType]?.strike;
  if (!strike) return 'This unit cannot strike: air units can';
  if (!world.provinces[target]) return 'Unknown province';
  if (a.progress > 0) return 'Units on the move cannot strike: halt first';
  if ((a.readyAt ?? 0) > s.clock.hours) return `${strike.kind === 'air' ? 'Aircraft are rearming' : 'Drones are rearming'}: ready in ${Math.ceil((a.readyAt! - s.clock.hours))} h`;
  const from = world.provinces[a.location].label, to = world.provinces[target].label;
  if (Math.hypot(from[0] - to[0], from[1] - to[1]) > strike.range) return 'Out of range';
  if (!strikeTargets(s, a.owner, target).length && !(atWar(s, a.owner, s.provinces[target].owner) && garrisonOf(s, target) > 0.05))
    return 'No enemy forces there';
  return null;
}

const strikeTargets = (s: GameState, n: NationId, p: ProvinceId) =>
  Object.values(s.armies).filter((x) => x.location === p && x.progress === 0 && atWar(s, n, x.owner)).sort((a, b) => (a.id < b.id ? -1 : 1));

/** Carrier aircraft or missiles hit every enemy unit in a province (and its garrison). Pure; assumes valid. */
export function applyStrike(state: GameState, world: World, fleetId: ArmyId, target: ProvinceId, log: Logger): GameState {
  const a = state.armies[fleetId];
  const strike = world.unitTypes[a.unitType]!.strike!;
  const [r, rng] = nextRandom(state.rng);
  let s: GameState = { ...state, rng };
  const total = strike.power * (a.strength / a.maxStrength) * (s.nations[a.owner]?.quality ?? 1) * (0.8 + r * 0.4);
  const units = strikeTargets(s, a.owner, target);
  const garrison = atWar(s, a.owner, s.provinces[target].owner) ? garrisonOf(s, target) : 0;
  const pool = units.reduce((x, u) => x + u.strength, 0) + garrison;
  const armies = { ...s.armies, [a.id]: { ...a, readyAt: s.clock.hours + strike.cooldownHours } };
  const lost: string[] = [];
  for (const u of units) {
    const strength = u.strength - (total * u.strength) / pool;
    if (strength < 0.5) { delete armies[u.id]; lost.push(u.name); } else armies[u.id] = { ...u, strength };
  }
  s = { ...s, armies };
  if (garrison > 0) {
    const g = Math.max(0, garrison - (total * garrison) / pool);
    s = { ...s, provinces: { ...s.provinces, [target]: { ...s.provinces[target], garrison: Math.round(g * 100) / 100 } } };
  }
  const victims = [...new Set([...units.map((u) => u.owner), s.provinces[target].owner])].filter((n) => atWar(s, a.owner, n));
  const player = s.playerNation;
  if (player && (a.owner === player || victims.includes(player))) {
    const what = strike.kind === 'air' ? 'Air strike' : 'Drone strike';
    const sunk = lost.length ? ` ${lost.join(', ')} destroyed.` : '';
    s = log(s, { kind: 'strike', text: `${what} by ${s.nations[a.owner].shortName} on ${provinceName(world, target)}: ${total.toFixed(1)} strength lost.${sunk}`, nations: [a.owner, ...victims], important: victims.includes(player) });
  }
  return s;
}

// ---- raising forces -----------------------------------------------------------------------------

function raiseUnit(s: GameState, world: World, n: Nation, location: ProvinceId, unitType: string, counter: string, strength: number): GameState {
  const no = (s.armyCounters[counter] ?? 0) + 1;
  const id = `a${s.nextId}`;
  const army: Army = { id, name: armyName(no, world.unitTypes[unitType]), owner: n.id, location, strength, maxStrength: strength, unitType, path: [], progress: 0 };
  return { ...s, armies: { ...s.armies, [id]: army }, armyCounters: { ...s.armyCounters, [counter]: no }, nextId: s.nextId + 1 };
}

/** Adds a new army for a nation at a province (pure). */
export function raiseArmy(s: GameState, world: World, n: Nation, location: ProvinceId, strength = BASE_STRENGTH): GameState {
  const no = (s.armyCounters[n.id] ?? 0) + 1;
  const land = n.units.filter((u) => !isFleet(world, u));
  const units = land.length ? land : Object.keys(world.unitTypes).filter((u) => !isFleet(world, u)).slice(0, 1);
  return raiseUnit(s, world, n, location, units[(no - 1) % units.length], counterKey(n.id, false), strength);
}

/** Adds a new fleet for a nation at a coastal province (pure). */
export function raiseFleet(s: GameState, world: World, n: Nation, port: ProvinceId, strength = BASE_STRENGTH): GameState {
  const key = counterKey(n.id, true);
  const no = (s.armyCounters[key] ?? 0) + 1;
  const own = (n.fleets ?? []).filter((u) => isFleet(world, u));
  const types = own.length ? own : seaUnitTypes(world);
  if (!types.length) return s;
  return raiseUnit(s, world, n, port, types[(no - 1) % types.length], key, strength);
}

/**
 * Starting deployment: capital first, then the provinces facing the most hostile neighbours;
 * fleets at the home port and the nearest other harbours. Deterministic (no RNG).
 */
export function deployStartingArmies(s: GameState, world: World): GameState {
  const byNation = new Map<NationId, ProvinceId[]>();
  for (const id of world.order) {
    const o = s.provinces[id]?.owner;
    if (!o) continue;
    if (!byNation.has(o)) byNation.set(o, []);
    byNation.get(o)!.push(id);
  }
  for (const n of Object.values(s.nations).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const owned = byNation.get(n.id) ?? [];
    if (!owned.length) continue;
    const count = armyCap(effectiveSize(s, world, n.id, owned), n.military);
    const threat = (p: ProvinceId) => {
      let t = 0;
      for (const l of world.provinces[p].links) {
        const o = s.provinces[l.to].owner;
        if (o === n.id) continue;
        if (atWar(s, n.id, o)) t = Math.max(t, 300);
        else if (!friendly(s, n.id, o)) t = Math.max(t, (100 - getRelation(s, n.id, o)) * (l.sea ? 0.3 : 1));
      }
      return t;
    };
    const capAt = world.provinces[n.capital ?? owned[0]].label;
    const d = (p: ProvinceId) => Math.hypot(world.provinces[p].label[0] - capAt[0], world.provinces[p].label[1] - capAt[1]);
    const homeland = (p: ProvinceId) => d(p) <= HOMELAND_RADIUS;
    const ranked = owned
      .filter((p) => p !== n.capital)
      // borders at home matter far more than colonial frontiers
      .map((p) => ({ p, t: threat(p) * (homeland(p) ? 1 : 0.25) }))
      .sort((a, b) => b.t - a.t || (a.p < b.p ? -1 : 1))
      .map((x) => x.p);
    // the capital keeps a garrison of one army in five; the rest face the most hostile borders
    const capital = n.capital ?? owned[0];
    const garrison = Math.max(1, Math.floor(count / 5));
    const spots = [...Array(garrison).fill(capital), ...ranked];
    for (let i = 0; i < count; i++) s = raiseArmy(s, world, n, spots[i % spots.length]);

    // fleets: spread over the three harbours nearest the capital
    const fleets = fleetCap(s, world, n.id);
    if (!fleets) continue;
    const ports = owned.filter((p) => world.provinces[p].coastal).sort((a, b) => d(a) - d(b) || (a < b ? -1 : 1)).slice(0, 3);
    for (let i = 0; i < fleets; i++) s = raiseFleet(s, world, s.nations[n.id], ports[i % ports.length]);
  }
  return s;
}

const provinceName = (world: World, id: ProvinceId) => world.provinces[id]?.name ?? id;

// ---- tiny binary heap ---------------------------------------------------------------------------
class MinHeap {
  private k: number[] = [];
  private v: string[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, val: string) {
    this.k.push(key);
    this.v.push(val);
    let i = this.k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= this.k[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): [number, string] | undefined {
    if (!this.k.length) return undefined;
    const top: [number, string] = [this.k[0], this.v[0]];
    const lk = this.k.pop()!, lv = this.v.pop()!;
    if (this.k.length) {
      this.k[0] = lk;
      this.v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.k.length && this.k[l] < this.k[m]) m = l;
        if (r < this.k.length && this.k[r] < this.k[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.k[a], this.k[b]] = [this.k[b], this.k[a]];
    [this.v[a], this.v[b]] = [this.v[b], this.v[a]];
  }
}

/**
 * A beaten nation surrenders instead of holding a rump capital forever: at war, holding 40% or
 * less of its own land with the enemy in its capital (or 25% or less outright). Colonies weigh a
 * quarter. Its remaining provinces pass to the enemy holding most of its land.
 */
function capitulations(state: GameState, world: World, log: Logger): GameState {
  let s = state;
  const belligerents = new Set(s.wars.flatMap((w) => [...w.attackers, ...w.defenders]));
  for (const n of Object.keys(s.nations).sort()) {
    const nation = s.nations[n];
    if (!nation?.alive || !nation.capital || !belligerents.has(n)) continue;
    const enemies = Object.keys(s.nations).filter((e) => s.nations[e].alive && atWar(s, n, e));
    if (!enemies.length) continue;
    const capAt = world.provinces[nation.capital].label;
    const weight = (p: ProvinceId) => {
      const q = world.provinces[p].label;
      return Math.hypot(q[0] - capAt[0], q[1] - capAt[1]) <= HOMELAND_RADIUS ? 1 : 0.25;
    };
    let total = 0, held = 0;
    const takenBy = new Map<NationId, number>();
    for (const [p, ps] of Object.entries(s.provinces)) {
      if (ps.core !== n) continue;
      const w = weight(p);
      total += w;
      if (ps.owner === n) held += w;
      else if (enemies.includes(ps.owner)) takenBy.set(ps.owner, (takenBy.get(ps.owner) ?? 0) + w);
    }
    if (!total || !takenBy.size) continue;
    const share = held / total;
    // the capital under siege (enemy troops inside it), not merely an enemy at the gates
    const capitalThreatened = Object.values(s.armies).some((a) => enemies.includes(a.owner) && !isFleet(world, a.unitType) && a.location === nation.capital && a.progress === 0);
    if (!(share <= 0.25 || (share <= 0.4 && capitalThreatened))) continue;
    const victor = [...takenBy.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
    s = log(s, { kind: 'capitulation', text: `${nation.name} capitulates to ${s.nations[victor].name}.`, nations: [n, victor], important: true });
    // the capitulation message replaces the usual "has fallen" notice
    const quiet: Logger = (st, ev) => (ev.kind === 'annexed' ? st : log(st, ev));
    for (const p of Object.keys(s.provinces).filter((id) => s.provinces[id].owner === n)) s = setOwner(s, p, victor, quiet, world);
  }
  return s;
}
