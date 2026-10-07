import { atWar, friendly, getRelation, provincesOf } from './queries';
import { nextRandom } from './rng';
import type { UnitTypeDef } from './scenario';
import type { Army, ArmyId, GameEvent, GameState, Nation, NationId, ProvinceId } from './types';
import type { Link, World } from './world';

// ---- tuning -----------------------------------------------------------------------------------
const DAMAGE_PER_DAY = 0.12; // fraction of (strength x attack) inflicted per day of battle
const CAPITAL_DEFENSE = 1.25;
const CAPTURE_PER_DAY = 1.0; // an unopposed full-strength army takes about a day to capture a province
const REINFORCE_PER_DAY = 0.03;
const MOBILIZE_EVERY_DAYS = 30;
export const BASE_STRENGTH = 10;
/** A fleeing government relocates at least this far (map units, ~600 km in Europe). */
const CAPITAL_FLIGHT_DIST = 90;
const possessive = (name: string) => (name.endsWith('s') ? `${name}'` : `${name}'s`);
/** Armies landing from the sea attack at this fraction of their strength for AMPHIBIOUS_HOURS. */
const AMPHIBIOUS_PENALTY = 0.6;
const AMPHIBIOUS_HOURS = 48;

// ---- naming -------------------------------------------------------------------------------------
const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
export const armyName = (n: number, unit: UnitTypeDef | undefined) => `${ordinal(n)} ${unit?.short ?? 'Army'}`;

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

/** Target number of armies for a nation of this size. */
export const armyCap = (provinceCount: number, military: number) =>
  Math.max(1, Math.min(18, Math.round(military * (2 + Math.sqrt(provinceCount) * 0.6))));

// ---- movement queries -------------------------------------------------------------------------

/** Armies may enter their own and friendly provinces, and enemy provinces (to attack them). */
export function canEnter(s: GameState, nation: NationId, province: ProvinceId): boolean {
  const owner = s.provinces[province]?.owner;
  if (!owner) return false;
  return friendly(s, nation, owner) || atWar(s, nation, owner);
}

export function linkHours(world: World, unitType: string, link: Link): number {
  const speed = world.unitTypes[unitType]?.speed ?? 20; // map units per day
  return (link.dist / (speed * (link.sea ? world.seaSpeed : 1))) * 24;
}

export interface PathResult {
  path: ProvinceId[];
  hours: number;
}

/** Fastest route (Dijkstra). Enemy provinces on the way add an estimate of the capture time. */
export function findPath(s: GameState, world: World, owner: NationId, unitType: string, from: ProvinceId, to: ProvinceId): PathResult | null {
  if (from === to) return { path: [], hours: 0 };
  if (!world.provinces[to] || !canEnter(s, owner, to)) return null;
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
    const extra = id !== from && atWar(s, owner, s.provinces[id].owner) ? captureHours : 0;
    for (const l of world.provinces[id].links) {
      if (!canEnter(s, owner, l.to)) continue;
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
  const enemyStops = path.filter((p) => atWar(s, owner, s.provinces[p].owner)).length;
  return { path, hours: Math.round(dist.get(to)! + enemyStops * captureHours) };
}

// ---- ownership ----------------------------------------------------------------------------------

/**
 * Changes a province's owner and handles the consequences: capital relocation, nation collapse
 * (armies disbanded, removed from wars and treaties) and expelling armies that may not stay.
 */
export function setOwner(s: GameState, province: ProvinceId, to: NationId, log: (s: GameState, ev: Omit<GameEvent, 'id' | 'at'>) => GameState, world?: World): GameState {
  const from = s.provinces[province].owner;
  if (from === to) return s;
  const provinces = { ...s.provinces, [province]: { owner: to, core: s.provinces[province].core } };
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
  const armies = { ...next.armies };
  for (const a of Object.values(armies)) {
    if (a.location !== province || friendly(next, a.owner, to) || atWar(next, a.owner, to)) continue;
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

  const hostilePresent = (province: ProvinceId, nation: NationId) =>
    ids.some((id) => armies[id] && armies[id].location === province && armies[id].progress === 0 && atWar(s, nation, armies[id].owner));

  // 1. movement
  for (const id of ids) {
    const a = armies[id];
    if (!a.path.length) continue;
    const here = a.location, next = a.path[0];
    const nextFriendly = friendly(s, a.owner, s.provinces[next]?.owner ?? '');
    if (a.progress === 0) {
      // must capture an enemy province before pushing on, and can only fall back out of a battle
      if (!nextFriendly && (atWar(s, a.owner, s.provinces[here].owner) || hostilePresent(here, a.owner))) continue;
    }
    const link = world.provinces[here].links.find((l) => l.to === next);
    if (!link || !canEnter(s, a.owner, next)) {
      armies[id] = { ...a, path: [], progress: 0 };
      continue;
    }
    const progress = a.progress + state.clock.tickHours / linkHours(world, a.unitType, link);
    if (progress < 1) { armies[id] = { ...a, progress }; continue; }
    // landing from the sea into hostile territory: the troops fight at a disadvantage for a while
    const landing = link.sea && !friendly(s, a.owner, s.provinces[next]?.owner ?? '');
    armies[id] = { ...a, location: next, path: a.path.slice(1), progress: 0, landedUntil: landing ? s.clock.hours + AMPHIBIOUS_HOURS : a.landedUntil };
  }

  // 2. combat: hostile armies in the same province fight; damage is applied simultaneously
  const byProvince = new Map<ProvinceId, ArmyId[]>();
  for (const id of ids) {
    const a = armies[id];
    if (!a || a.progress > 0) continue;
    if (!byProvince.has(a.location)) byProvince.set(a.location, []);
    byProvince.get(a.location)!.push(id);
  }
  const battles = { ...s.battles };
  const damage = new Map<ArmyId, number>();
  const fought = new Set<ProvinceId>();
  for (const [province, here] of [...byProvince.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    const owner = s.provinces[province].owner;
    let any = false;
    for (const id of here) {
      const a = armies[id];
      const targets = here.filter((t) => atWar(s, a.owner, armies[t].owner));
      if (!targets.length) continue;
      any = true;
      const unit = world.unitTypes[a.unitType];
      const defending = friendly(s, a.owner, owner);
      const bonus = defending ? (s.rules.homeDefense ?? 1.2) * (s.nations[owner]?.capital === province ? CAPITAL_DEFENSE : 1) : 1;
      // a landing is weaker still against a strong navy
      const landed = !defending && (a.landedUntil ?? -1) > s.clock.hours ? AMPHIBIOUS_PENALTY * (1 - 0.5 * (s.nations[owner]?.naval ?? 0)) : 1;
      const out = a.strength * (s.nations[a.owner]?.quality ?? 1) * (defending ? unit?.defense ?? 3 : unit?.attack ?? 3) * bonus * landed * DAMAGE_PER_DAY * tickDays * (0.85 + rand() * 0.3);
      const total = targets.reduce((sum, t) => sum + armies[t].strength, 0);
      for (const t of targets) damage.set(t, (damage.get(t) ?? 0) + (out * armies[t].strength) / total);
    }
    if (any) {
      fought.add(province);
      if (battles[province] === undefined) {
        battles[province] = s.clock.hours;
        const sides = [...new Set(here.map((id) => armies[id].owner))];
        if (player && sides.includes(player)) {
          const foes = sides.filter((n) => atWar(s, player, n)).map((n) => s.nations[n].shortName).join(', ');
          s = log(s, { kind: 'battle', text: `Battle of ${provinceName(world, province, s)} begins against ${foes}.`, nations: sides, important: true });
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
        s = log(s, { kind: 'army-destroyed', text: `${s.nations[a.owner].shortName} ${a.name} destroyed at ${provinceName(world, a.location, s)}.`, nations: [a.owner], important: a.owner === player });
    } else armies[id] = { ...a, strength };
  }
  // battles that ended this tick
  for (const province of Object.keys(battles)) {
    if (fought.has(province)) {
      const here = (byProvince.get(province) ?? []).filter((id) => armies[id]);
      const stillHostile = here.some((x) => here.some((y) => atWar(s, armies[x].owner, armies[y].owner)));
      if (stillHostile) continue;
      const victors = [...new Set(here.map((id) => armies[id].owner))];
      if (player && (victors.includes(player) || s.provinces[province].owner === player || victors.length === 0)) {
        const name = provinceName(world, province, s);
        const text = victors.length ? `${victors.map((n) => s.nations[n].shortName).join(' & ')} win the Battle of ${name}.` : `The Battle of ${name} ends with both sides spent.`;
        s = log(s, { kind: 'battle-end', text, nations: victors, important: false });
      }
    }
    delete battles[province];
  }

  s = { ...s, armies, battles, rng };

  // 3. capture: an army alone in an enemy province takes it over time
  for (const [province, here] of byProvince) {
    const present = here.filter((id) => s.armies[id]);
    const owner = s.provinces[province].owner;
    const prov = s.provinces[province];
    const besiegers = present.filter((id) => atWar(s, s.armies[id].owner, owner));
    const contested = present.some((x) => present.some((y) => atWar(s, s.armies[x].owner, s.armies[y].owner)));
    if (!besiegers.length || contested) {
      if (prov.siege && !besiegers.length) s = { ...s, provinces: { ...s.provinces, [province]: { owner, core: prov.core } } };
      continue;
    }
    const lead = besiegers.reduce((a, b) => (s.armies[b].strength > s.armies[a].strength ? b : a));
    const by = s.armies[lead].owner;
    const power = besiegers.filter((id) => s.armies[id].owner === by).reduce((sum, id) => sum + s.armies[id].strength, 0);
    const base = prov.siege?.by === by ? prov.siege.progress : 0;
    const progress = base + (CAPTURE_PER_DAY / (s.rules.captureDays ?? 1)) * tickDays * Math.min(1, power / 6);
    if (progress < 1) {
      s = { ...s, provinces: { ...s.provinces, [province]: { owner, core: prov.core, siege: { by, progress } } } };
      continue;
    }
    const wasCapital = s.nations[owner]?.capital === province;
    s = setOwner(s, province, by, log, world);
    if (!wasCapital && (by === player || owner === player))
      s = log(s, { kind: 'capture', text: `${s.nations[by].shortName} captures ${provinceName(world, province, s)} from ${s.nations[owner].shortName}.`, nations: [by, owner], important: owner === player });
  }

  // sieges with nobody left besieging lapse
  for (const [id, p] of Object.entries(s.provinces)) {
    if (!p.siege) continue;
    const still = Object.values(s.armies).some((a) => a.location === id && a.progress === 0 && a.owner === p.siege!.by);
    if (!still) s = { ...s, provinces: { ...s.provinces, [id]: { owner: p.owner, core: p.core } } };
  }

  // 4. reinforcement in friendly territory, away from battle
  const reinforced = { ...s.armies };
  for (const a of Object.values(reinforced)) {
    if (a.strength >= a.maxStrength || a.progress > 0 || s.battles[a.location] !== undefined) continue;
    if (!friendly(s, a.owner, s.provinces[a.location].owner)) continue;
    reinforced[a.id] = { ...a, strength: Math.min(a.maxStrength, a.strength + a.maxStrength * REINFORCE_PER_DAY * tickDays) };
  }
  s = { ...s, armies: reinforced };

  // 5. mobilization: periodically raise a new army at the capital if below the nation's cap
  const day = s.clock.hours / 24;
  if (s.clock.hours % 24 === 0 && day > 0 && day % MOBILIZE_EVERY_DAYS === 0) {
    for (const n of Object.values(s.nations).sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (!n.alive || !n.capital) continue;
      const count = Object.values(s.armies).filter((a) => a.owner === n.id).length;
      if (count >= armyCap(effectiveSize(s, world, n.id, provincesOf(s, n.id)), n.military)) continue;
      s = raiseArmy(s, world, n, n.capital);
      if (n.id === player) s = log(s, { kind: 'mobilize', text: `A new army is raised at ${provinceName(world, n.capital, s)}.`, nations: [n.id] });
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

/** Adds a new army for a nation at a province (pure). */
export function raiseArmy(s: GameState, world: World, n: Nation, location: ProvinceId, strength = BASE_STRENGTH): GameState {
  const no = (s.armyCounters[n.id] ?? 0) + 1;
  const units = n.units.length ? n.units : Object.keys(world.unitTypes).slice(0, 1);
  const unitType = units[(no - 1) % units.length];
  const id = `a${s.nextId}`;
  const army: Army = { id, name: armyName(no, world.unitTypes[unitType]), owner: n.id, location, strength, maxStrength: strength, unitType, path: [], progress: 0 };
  return { ...s, armies: { ...s.armies, [id]: army }, armyCounters: { ...s.armyCounters, [n.id]: no }, nextId: s.nextId + 1 };
}

/**
 * Starting deployment: capital first, then the provinces facing the most hostile neighbours.
 * Deterministic (no RNG).
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
    const homeland = (p: ProvinceId) => Math.hypot(world.provinces[p].label[0] - capAt[0], world.provinces[p].label[1] - capAt[1]) <= HOMELAND_RADIUS;
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
  }
  return s;
}

const provinceName = (world: World, id: ProvinceId, _s?: GameState) => world.provinces[id]?.name ?? id;

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
 * less of its own land with the enemy at its capital (or 25% or less outright). Colonies weigh a
 * quarter. Its remaining provinces pass to the enemy holding most of its land.
 */
function capitulations(state: GameState, world: World, log: Logger): GameState {
  let s = state;
  for (const n of Object.keys(s.nations).sort()) {
    const nation = s.nations[n];
    if (!nation?.alive || !nation.capital) continue;
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
    const capitalThreatened = Object.values(s.armies).some((a) => enemies.includes(a.owner) &&
      (a.location === nation.capital || world.provinces[nation.capital!].links.some((l) => l.to === a.location)));
    if (!(share <= 0.25 || (share <= 0.4 && capitalThreatened))) continue;
    const victor = [...takenBy.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
    s = log(s, { kind: 'capitulation', text: `${nation.name} capitulates to ${s.nations[victor].name}.`, nations: [n, victor], important: true });
    // the capitulation message replaces the usual "has fallen" notice
    const quiet: Logger = (st, ev) => (ev.kind === 'annexed' ? st : log(st, ev));
    for (const p of Object.keys(s.provinces).filter((id) => s.provinces[id].owner === n)) s = setOwner(s, p, victor, quiet, world);
  }
  return s;
}
