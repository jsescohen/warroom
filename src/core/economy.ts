import { armyCap, BASE_STRENGTH, effectiveSize, homelandOf, isFleet, raiseUnitOfType } from './military';
import { basePop, POP_FLOOR } from './population';
import { atWar, provincesOf } from './queries';
import type { Army, BuildingId, GameEvent, GameState, NationId, ProvinceId, Treaty } from './types';
import type { World } from './world';

/**
 * The economy: provinces earn money every month, armies cost upkeep, and new troops are bought
 * at barracks (land units) and airfields (air units). Resources make some units cheaper to raise
 * (simple economy) or keep them supplied (detailed economy, with stockpiles). All pure.
 */

export const ECONOMY_EVERY_DAYS = 30;
/** Price of a basic army; other units cost more by their fighting value. */
const RECRUIT_BASE = 8;
/** Monthly upkeep of a basic full-size army. */
const UPKEEP_BASE = 1;
/** Monthly income per army the nation's size and industry support (some is left to spend). */
const INCOME_PER_ARMY = 1.35;
/** Resources from colonies (not connected to the capital by land) bring in this share of their value. */
const COLONY_RESOURCE = 0.5;
/** Without a unit's resource it costs this much more to raise (and a quarter more to keep). */
const MISSING_COST = 1.5;
const MISSING_UPKEEP = 1.25;
/** New troops start at this share of full strength and fill up while they train. */
export const RECRUIT_STRENGTH = 0.4;
/** Nations can field this many times their supported army count, no more (manpower). */
const MANPOWER = 1.3;
/** Detailed economy: production per province and month, consumption per full army, stock cap. */
const STOCK_PER_PROVINCE = 2;
const STOCK_USE = 0.5;
const STOCK_RECRUIT = 3;
const STOCK_CAP = 60;
/** Detailed economy: what a trade route carries each month. */
const TRADE_FLOW = 2;
/** Civilians regrow by this share of their peacetime number each month. */
const POP_REGROWTH = 0.02;

export const BUILDINGS: Record<BuildingId, { name: string; cost: number; text: string }> = {
  barracks: { name: 'Barracks', cost: 25, text: 'Recruits land armies here.' },
  airfield: { name: 'Airfield', cost: 30, text: 'Recruits air units here.' },
  fort: { name: 'Fortress', cost: 20, text: 'The province garrison is half as strong again.' },
};

type Logger = (s: GameState, ev: Omit<GameEvent, 'id' | 'at'>) => GameState;

/** AI nations play with more (hard) or less (easy) money and manpower than the player. */
export function difficultyMult(s: GameState, n: NationId): number {
  if (n === s.playerNation) return 1;
  const d = s.rules.difficulty ?? 'normal';
  return d === 'easy' ? 0.8 : d === 'hard' ? 1.25 : 1;
}

export const isAirUnit = (world: World, unitType: string) => !!world.unitTypes[unitType]?.strike;
export const eraHasAir = (world: World) => Object.values(world.unitTypes).some((u) => u.strike);
/** Land and air unit types a nation can recruit in this era. */
export const recruitableTypes = (world: World) => Object.values(world.unitTypes).filter((u) => u.domain !== 'sea').map((u) => u.id);

/** How expensive a unit type is compared with the era's basic army. */
export function unitFactor(world: World, unitType: string): number {
  const u = world.unitTypes[unitType];
  const base = Object.values(world.unitTypes).find((x) => x.domain !== 'sea');
  if (!u || !base) return 1;
  return Math.sqrt((u.attack + u.defense) / (base.attack + base.defense)) * (u.strike ? 1.25 : 1);
}

// ---- resources ----------------------------------------------------------------------------------

/** Resource production of every nation, indexed once per province table (it changes rarely). */
const productionCache = new WeakMap<object, Map<NationId, Map<string, number>>>();
const NONE = new Map<string, number>();

/** Resources a nation produces itself (owns a province holding them). Do not mutate the result. */
export function producedBy(s: GameState, world: World, n: NationId): Map<string, number> {
  let index = productionCache.get(s.provinces);
  if (!index) {
    index = new Map();
    for (const [p, ps] of Object.entries(s.provinces)) {
      const r = world.provinces[p]?.resource;
      if (!r) continue;
      let m = index.get(ps.owner);
      if (!m) index.set(ps.owner, (m = new Map()));
      m.set(r, (m.get(r) ?? 0) + 1);
    }
    productionCache.set(s.provinces, index);
  }
  return index.get(n) ?? NONE;
}

export const tradeRoutes = (s: GameState, n?: NationId) => s.treaties.filter((t) => t.type === 'trade' && (!n || t.parties.includes(n)));

/** Resources a nation gets through trade: [resource, supplier]. Only while the supplier still produces it. */
export function importsOf(s: GameState, world: World, n: NationId, produced?: (x: NationId) => Map<string, number>): [string, NationId][] {
  const prod = produced ?? ((x: NationId) => producedBy(s, world, x));
  const out: [string, NationId][] = [];
  for (const t of tradeRoutes(s, n)) {
    const [a, b] = t.parties;
    const r = n === b ? t.trade?.sell : t.trade?.buy;
    const from = n === b ? a : b;
    if (r && prod(from).has(r)) out.push([r, from]);
  }
  return out;
}

/** Every resource a nation can use: its own and its imports. */
export function accessOf(s: GameState, world: World, n: NationId): Set<string> {
  return new Set([...producedBy(s, world, n).keys(), ...importsOf(s, world, n).map(([r]) => r)]);
}

/** Resources a unit type needs. */
export const needsOf = (world: World, unitType: string) => Object.values(world.resources).filter((r) => r.units?.includes(unitType)).map((r) => r.id);

/** Needed resources the nation lacks for this unit (simple economy: no access; detailed: not enough in stock). */
export function missingFor(s: GameState, world: World, n: NationId, unitType: string, access = accessOf(s, world, n)): string[] {
  const detailed = s.rules.economy === 'detailed';
  return needsOf(world, unitType).filter((r) => (detailed ? (s.nations[n]?.stock?.[r] ?? 0) < STOCK_RECRUIT : !access.has(r)));
}

// ---- money --------------------------------------------------------------------------------------

export function recruitCost(s: GameState, world: World, n: NationId, unitType: string, access?: Set<string>): number {
  const missing = s.rules.economy === 'detailed' ? 0 : missingFor(s, world, n, unitType, access).length;
  return Math.round(RECRUIT_BASE * unitFactor(world, unitType) * (missing ? MISSING_COST : 1));
}

export function upkeepOf(s: GameState, world: World, a: Army, access?: Set<string>): number {
  if (isFleet(world, a.unitType)) return 0;
  const missing = s.rules.economy === 'detailed' ? 0 : missingFor(s, world, a.owner, a.unitType, access).length;
  return UPKEEP_BASE * unitFactor(world, a.unitType) * (a.maxStrength / BASE_STRENGTH) * (missing ? MISSING_UPKEEP : 1);
}

/** Armies the nation's land and people support (the old army cap, before difficulty). */
export const supportedArmies = (s: GameState, world: World, n: NationId) =>
  armyCap(effectiveSize(s, world, n, provincesOf(s, n)), s.nations[n]?.military ?? 1);

/** Most armies (land and air) a nation can field. */
export const manpowerCap = (s: GameState, world: World, n: NationId) =>
  Math.max(2, Math.round(supportedArmies(s, world, n) * difficultyMult(s, n) * MANPOWER));

export interface Budget {
  /** Taxes from land and people. */
  land: number;
  /** Money from resources sold on the world market. */
  resources: number;
  /** Trade route payments (negative: paid out). */
  trade: number;
  upkeep: number;
  /** Net change per month. */
  net: number;
}

export function budgetOf(s: GameState, world: World, n: NationId): Budget {
  const access = accessOf(s, world, n);
  const land = supportedArmies(s, world, n) * INCOME_PER_ARMY * UPKEEP_BASE * difficultyMult(s, n);
  let resources = 0;
  const home = s.nations[n]?.capital ? homelandOf(s, world, n) : null;
  for (const [p, ps] of Object.entries(s.provinces)) {
    const r = ps.owner === n ? world.provinces[p]?.resource : undefined;
    if (r) resources += (world.resources[r]?.value ?? 0) * (!home || home.has(p) ? 1 : COLONY_RESOURCE);
  }
  let trade = 0;
  for (const t of tradeRoutes(s, n)) {
    const g = t.trade?.gold ?? 0;
    trade += t.parties[0] === n ? -g : g;
  }
  let upkeep = 0;
  for (const a of Object.values(s.armies)) if (a.owner === n) upkeep += upkeepOf(s, world, a, access);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return { land: r1(land), resources: r1(resources), trade: r1(trade), upkeep: r1(upkeep), net: r1(land + resources + trade - upkeep) };
}

export const armyCount = (s: GameState, world: World, n: NationId) =>
  Object.values(s.armies).filter((a) => a.owner === n && !isFleet(world, a.unitType)).length;

// ---- recruiting and building --------------------------------------------------------------------

const hostileHere = (s: GameState, world: World, n: NationId, p: ProvinceId) =>
  Object.values(s.armies).some((a) => a.location === p && !isFleet(world, a.unitType) && atWar(s, n, a.owner));

/** Why the nation cannot recruit this unit here, or null. */
export function recruitError(s: GameState, world: World, n: NationId, p: ProvinceId, unitType: string): string | null {
  const nation = s.nations[n];
  const u = world.unitTypes[unitType];
  if (!nation?.alive) return 'Unknown nation';
  if (!u || u.domain === 'sea') return 'Unknown unit type';
  if (s.provinces[p]?.owner !== n) return 'You can only recruit in your own provinces';
  const need: BuildingId = u.strike ? 'airfield' : 'barracks';
  if (!s.provinces[p].build?.includes(need)) return `Needs ${need === 'airfield' ? 'an airfield' : 'barracks'} in this province`;
  if (hostileHere(s, world, n, p)) return 'The enemy is in this province';
  if (armyCount(s, world, n) >= manpowerCap(s, world, n)) return `No manpower left: ${armyCount(s, world, n)} of ${manpowerCap(s, world, n)} armies raised. Take more land to raise more.`;
  if (s.rules.economy === 'detailed') {
    const missing = missingFor(s, world, n, unitType);
    if (missing.length) return `Needs ${STOCK_RECRUIT} ${missing.map((r) => world.resources[r]?.name ?? r).join(' and ')} in stock`;
  }
  const cost = recruitCost(s, world, n, unitType);
  if ((nation.treasury ?? 0) < cost) return `Costs ${cost}: the treasury holds ${Math.floor(nation.treasury ?? 0)}`;
  return null;
}

export function applyRecruit(s: GameState, world: World, n: NationId, p: ProvinceId, unitType: string): GameState {
  const cost = recruitCost(s, world, n, unitType);
  const nation = s.nations[n];
  let stock = nation.stock;
  if (s.rules.economy === 'detailed') {
    stock = { ...stock };
    for (const r of needsOf(world, unitType)) stock[r] = (stock[r] ?? 0) - STOCK_RECRUIT;
  }
  const next: GameState = { ...s, nations: { ...s.nations, [n]: { ...nation, treasury: (nation.treasury ?? 0) - cost, ...(stock ? { stock } : {}) } } };
  return raiseUnitOfType(next, world, n, p, unitType, BASE_STRENGTH * RECRUIT_STRENGTH, BASE_STRENGTH);
}

/** Why the nation cannot put up this building here, or null. */
export function buildError(s: GameState, world: World, n: NationId, p: ProvinceId, b: BuildingId): string | null {
  const def = BUILDINGS[b];
  if (!def) return 'Unknown building';
  if (s.provinces[p]?.owner !== n) return 'You can only build in your own provinces';
  if (b === 'airfield' && !eraHasAir(world)) return 'There are no aircraft in this era';
  if (s.nations[n]?.alive !== true) return 'Unknown nation';
  if (s.provinces[p].build?.includes(b)) return `There is already a ${def.name.toLowerCase()} here`;
  if (hostileHere(s, world, n, p)) return 'The enemy is in this province';
  if ((s.nations[n].treasury ?? 0) < def.cost) return `Costs ${def.cost}: the treasury holds ${Math.floor(s.nations[n].treasury ?? 0)}`;
  return null;
}

export function applyBuild(s: GameState, _world: World, n: NationId, p: ProvinceId, b: BuildingId): GameState {
  const nation = s.nations[n];
  const ps = s.provinces[p];
  return {
    ...s,
    nations: { ...s.nations, [n]: { ...nation, treasury: (nation.treasury ?? 0) - BUILDINGS[b].cost } },
    provinces: { ...s.provinces, [p]: { ...ps, build: [...(ps.build ?? []), b] } },
  };
}

// ---- setup --------------------------------------------------------------------------------------

/**
 * Gives every nation without one a treasury and its starting barracks (and airfields): the
 * capital, plus the most populous homeland provinces for a large army. Also used to bring saves
 * from before the economy up to date.
 */
export function initEconomy(state: GameState, world: World): GameState {
  const todo = Object.values(state.nations).filter((n) => n.alive && n.treasury === undefined);
  if (!todo.length) return state;
  let s = state;
  const provinces = { ...s.provinces };
  const nations = { ...s.nations };
  const air = eraHasAir(world);
  for (const n of todo.sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!n.capital) { nations[n.id] = { ...n, treasury: 0 }; continue; }
    const home = [...homelandOf(s, world, n.id)].filter((p) => p !== n.capital)
      .sort((a, b) => (world.provinces[b].pop - world.provinces[a].pop) || (a < b ? -1 : 1));
    const cap = supportedArmies(s, world, n.id);
    const add = (p: ProvinceId, b: BuildingId) => {
      const ps = provinces[p];
      if (!ps.build?.includes(b)) provinces[p] = { ...ps, build: [...(ps.build ?? []), b] };
    };
    add(n.capital, 'barracks');
    for (const p of home.slice(0, Math.floor(cap / 8))) add(p, 'barracks');
    if (air && n.units.some((u) => isAirUnit(world, u))) {
      add(n.capital, 'airfield');
      for (const p of home.slice(0, Math.floor(cap / 16))) add(p, 'airfield');
    }
    nations[n.id] = { ...n, treasury: 0 };
  }
  s = { ...s, provinces, nations };
  // starting money: two months of income
  const funded = { ...s.nations };
  for (const n of todo) if (funded[n.id]?.alive) funded[n.id] = { ...funded[n.id], treasury: Math.max(10, Math.round(budgetOf(s, world, n.id).land * 2)) };
  s = { ...s, nations: funded };
  if (s.rules.economy === 'detailed') s = initStocks(s, world);
  return s;
}

/** Detailed economy: six months of what each nation's armies use, plus what it produces. */
export function initStocks(state: GameState, world: World): GameState {
  const nations = { ...state.nations };
  for (const n of Object.values(nations)) {
    if (!n.alive || n.stock) continue;
    const stock: Record<string, number> = {};
    for (const a of Object.values(state.armies)) if (a.owner === n.id) for (const r of needsOf(world, a.unitType)) stock[r] = (stock[r] ?? 0) + STOCK_USE * 6 * (a.maxStrength / BASE_STRENGTH);
    for (const [r, c] of producedBy(state, world, n.id)) stock[r] = (stock[r] ?? 0) + STOCK_PER_PROVINCE * 3 * c;
    for (const r of Object.keys(stock)) stock[r] = Math.min(STOCK_CAP, Math.round(stock[r]));
    nations[n.id] = { ...n, stock };
  }
  return { ...state, nations };
}

// ---- monthly settlement -------------------------------------------------------------------------

export function economyTick(state: GameState, world: World, log: Logger): GameState {
  const day = state.clock.hours / 24;
  if (state.clock.hours % 24 !== 0 || day <= 0 || day % ECONOMY_EVERY_DAYS !== 0) return state;
  let s = state;
  const player = s.playerNation;
  const detailed = s.rules.economy === 'detailed';
  const prodCache = new Map<NationId, Map<string, number>>();
  const produced = (n: NationId) => {
    if (!prodCache.has(n)) prodCache.set(n, producedBy(s, world, n));
    return prodCache.get(n)!;
  };
  const nations = { ...s.nations };
  const armies = { ...s.armies };
  let deserted = false;

  // trade routes between nations now at war, or with a fallen party, are closed
  const dead = (t: Treaty) => t.parties.some((p) => !s.nations[p]?.alive) || atWar(s, t.parties[0], t.parties[1]);
  if (tradeRoutes(s).some(dead)) s = { ...s, treaties: s.treaties.filter((t) => t.type !== 'trade' || !dead(t)) };

  for (const id of Object.keys(nations).sort()) {
    const n = nations[id];
    if (!n.alive) continue;
    const b = budgetOf(s, world, id);
    let treasury = (n.treasury ?? 0) + b.net;
    // an empty treasury cannot pay the troops: some desert
    if (treasury < 0) {
      for (const a of Object.values(armies)) if (a.owner === id) armies[a.id] = { ...a, strength: Math.max(0.6, a.strength - a.maxStrength * 0.1) };
      if (id === player) deserted = true;
      treasury = Math.max(treasury, -50);
    }
    nations[id] = { ...n, treasury: Math.round(treasury * 10) / 10 };
  }

  if (detailed) {
    // production, then trade routes, then what the armies use
    for (const id of Object.keys(nations).sort()) {
      const n = nations[id];
      if (!n.alive) continue;
      const stock = { ...(n.stock ?? {}) };
      for (const [r, c] of produced(id)) stock[r] = (stock[r] ?? 0) + STOCK_PER_PROVINCE * c;
      nations[id] = { ...n, stock };
    }
    for (const t of tradeRoutes(s)) {
      const [a, b] = t.parties;
      const flow = (from: NationId, to: NationId, r?: string) => {
        if (!r || !produced(from).has(r) || !nations[from]?.alive || !nations[to]?.alive) return;
        const have = nations[from].stock?.[r] ?? 0;
        const moved = Math.min(TRADE_FLOW, have);
        nations[from] = { ...nations[from], stock: { ...nations[from].stock, [r]: have - moved } };
        nations[to] = { ...nations[to], stock: { ...nations[to].stock, [r]: (nations[to].stock?.[r] ?? 0) + moved } };
      };
      flow(a, b, t.trade?.sell);
      flow(b, a, t.trade?.buy);
    }
    const use = new Map<string, number>();
    for (const a of Object.values(armies)) for (const r of needsOf(world, a.unitType)) use.set(`${a.owner}|${r}`, (use.get(`${a.owner}|${r}`) ?? 0) + STOCK_USE * (a.maxStrength / BASE_STRENGTH));
    for (const id of Object.keys(nations).sort()) {
      const n = nations[id];
      if (!n.alive) continue;
      const stock = { ...(n.stock ?? {}) };
      const short: string[] = [];
      for (const r of Object.keys(world.resources)) {
        const need = use.get(`${id}|${r}`) ?? 0;
        const have = stock[r] ?? 0;
        if (need > have + 1e-9) short.push(r);
        stock[r] = Math.round(Math.min(STOCK_CAP, Math.max(0, have - need)) * 10) / 10;
      }
      nations[id] = { ...n, stock, short };
    }
  }

  s = { ...s, nations, armies };
  if (deserted) s = log(s, { kind: 'economy', text: 'The treasury is empty: unpaid troops are deserting. Disband armies or find money.', nations: [player!], important: true });
  if (detailed && player && s.nations[player]?.alive) {
    const fresh = (s.nations[player].short ?? []).filter((r) => !(state.nations[player]?.short ?? []).includes(r));
    if (fresh.length) s = log(s, { kind: 'economy', text: `Out of ${fresh.map((r) => world.resources[r]?.name ?? r).join(' and ')}: units that need it fight at three quarters strength and cannot refit.`, nations: [player], important: true });
  }

  // civilians slowly return and recover
  let patch: GameState['provinces'] | null = null;
  for (const [p, ps] of Object.entries(s.provinces)) {
    if (ps.pop === undefined) continue;
    const base = basePop(s, world, p);
    const v = ps.pop + base * POP_REGROWTH;
    const { pop: _, ...rest } = ps;
    (patch ??= { ...s.provinces })[p] = v >= base ? rest : { ...ps, pop: Math.round(Math.max(base * POP_FLOOR, v)) };
  }
  if (patch) s = { ...s, provinces: patch };
  return s;
}

/** Supply factor of an army in the detailed economy: units whose resource ran out fight weaker. */
export const SHORTAGE_FACTOR = 0.75;
