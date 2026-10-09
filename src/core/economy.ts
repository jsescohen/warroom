import { armyCap, BASE_STRENGTH, effectiveSize, homelandOf, isFleet, provinceWeight, raiseUnitOfType } from './military';
import { basePop, POP_FLOOR, popRatio } from './population';
import { atWar, provincesOf } from './queries';
import { humansOf, isHuman, type Army, type BuildingId, type GameEvent, type GameState, type NationId, type ProvinceId, type Treaty } from './types';
import type { World } from './world';

/**
 * The economy: provinces earn money every month, armies cost upkeep, and new troops are bought
 * at barracks (land units) and airfields (air units) with money and materials. Every nation keeps
 * stockpiles of the era's resources: provinces holding a resource produce a little of it, and
 * much more with a mine, farm or factory on it; trade agreements and the world market move it
 * between nations. Provinces can be developed (three levels) for more money, people and defence.
 * The detailed economy adds monthly consumption by the armies and shortages. All pure.
 */

export const ECONOMY_EVERY_DAYS = 30;
/** Price of a basic army; other units cost more by their fighting value. */
const RECRUIT_BASE = 8;
/** Monthly upkeep of a basic full-size army. */
const UPKEEP_BASE = 1;
/** Monthly income per army the nation's size and industry support (some is left to spend). */
const INCOME_PER_ARMY = 1.35;
/** New troops start at this share of full strength and fill up while they train. */
export const RECRUIT_STRENGTH = 0.4;
/** Nations can field this many times their supported army count, no more (manpower). */
const MANPOWER = 1.3;
/** A resource province produces this much a month by itself, and EXTRACTED with its building. */
export const PRODUCE_BASE = 1;
export const PRODUCE_EXTRACTED = 4;
/** Storage per resource: what is produced beyond it is sold on the market at the end of the month. */
export const STOCK_CAP = 80;
/** Detailed economy: what a full-size army that needs a resource uses each month. */
const STOCK_USE = 0.5;
/** What a trade agreement carries each month (from the supplier's stock). */
const TRADE_FLOW = 3;
/** Civilians regrow by this share of their peacetime number each month. */
const POP_REGROWTH = 0.02;
/** Province development: money for levels 1, 2, 3 (materials: world.developCost times the level). */
export const DEVELOP_GOLD = [0, 20, 35, 55];
export const MAX_LEVEL = 3;

export interface BuildingDef { name: string; cost: number; text: string }
export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  barracks: { name: 'Barracks', cost: 25, text: 'Recruits land armies here.' },
  airfield: { name: 'Airfield', cost: 30, text: 'Recruits air units here.' },
  fort: { name: 'Fortress', cost: 20, text: 'The province garrison is half as strong again.' },
  mine: { name: 'Mine', cost: 20, text: `Extracts the province's resource: ${PRODUCE_EXTRACTED} a month instead of ${PRODUCE_BASE}.` },
  farm: { name: 'Farm', cost: 15, text: `Works the province's land: ${PRODUCE_EXTRACTED} of its resource a month instead of ${PRODUCE_BASE}.` },
  factory: { name: 'Factory', cost: 30, text: `Manufactures the province's resource: ${PRODUCE_EXTRACTED} a month instead of ${PRODUCE_BASE}.` },
  airdefense: { name: 'Air defence', cost: 40, text: 'Shoots down missiles and blunts air strikes on this province and its neighbours.' },
};

/** The building name for a resource (a mine of oil is an oil well; a farm of horses a stud). */
export function extractName(world: World, p: ProvinceId): string {
  const r = world.resources[world.provinces[p]?.resource ?? ''];
  if (!r) return '';
  if (r.id === 'oil') return 'Oil wells';
  if (r.id === 'horses') return 'Stud farm';
  if (r.extract === 'farm' && ['spices', 'sugar', 'rubber'].includes(r.id)) return 'Plantation';
  return BUILDINGS[r.extract].name;
}

type Logger = (s: GameState, ev: Omit<GameEvent, 'id' | 'at'>) => GameState;

/** AI nations play with more (hard) or less (easy) money and manpower than the player. */
export function difficultyMult(s: GameState, n: NationId): number {
  if (isHuman(s, n)) return 1;
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

/** A province's monthly output of its resource (0 without one, while besieged or poisoned). */
export function provinceOutput(s: GameState, world: World, p: ProvinceId): number {
  const r = world.resources[world.provinces[p]?.resource ?? ''];
  const ps = s.provinces[p];
  if (!r || !ps || ps.siege || (ps.falloutUntil ?? 0) > s.clock.hours) return 0;
  return ps.build?.includes(r.extract) ? PRODUCE_EXTRACTED : PRODUCE_BASE;
}

/** Monthly production of every nation, indexed once per province table (it changes rarely). */
const productionCache = new WeakMap<object, Map<NationId, Map<string, number>>>();
const NONE = new Map<string, number>();

/** What a nation produces each month, per resource. Do not mutate the result. */
export function producedBy(s: GameState, world: World, n: NationId): Map<string, number> {
  let index = productionCache.get(s.provinces);
  if (!index) {
    index = new Map();
    for (const [p, ps] of Object.entries(s.provinces)) {
      const r = world.provinces[p]?.resource;
      if (!r) continue;
      const out = provinceOutput(s, world, p);
      if (!out) continue;
      let m = index.get(ps.owner);
      if (!m) index.set(ps.owner, (m = new Map()));
      m.set(r, (m.get(r) ?? 0) + out);
    }
    productionCache.set(s.provinces, index);
  }
  return index.get(n) ?? NONE;
}

export const tradeRoutes = (s: GameState, n?: NationId) => s.treaties.filter((t) => t.type === 'trade' && (!n || t.parties.includes(n)));

/** Resources a nation gets through trade: [resource, supplier], while the supplier still produces it. */
export function importsOf(s: GameState, world: World, n: NationId): [string, NationId][] {
  const out: [string, NationId][] = [];
  for (const t of tradeRoutes(s, n)) {
    const [a, b] = t.parties;
    const r = n === b ? t.trade?.sell : t.trade?.buy;
    const from = n === b ? a : b;
    if (r && producedBy(s, world, from).has(r)) out.push([r, from]);
  }
  return out;
}

/** Resources a nation produces or imports. */
export function accessOf(s: GameState, world: World, n: NationId): Set<string> {
  return new Set([...producedBy(s, world, n).keys(), ...importsOf(s, world, n).map(([r]) => r)]);
}

/** Resources a unit type uses up every month (detailed economy). */
export const needsOf = (world: World, unitType: string) => Object.values(world.resources).filter((r) => r.units?.includes(unitType)).map((r) => r.id);
/** Materials a unit type costs to raise. */
export const materialsOf = (world: World, unitType: string): Record<string, number> => world.unitCosts[unitType] ?? {};
/** Resources a nation's armies are built from (its unit list). */
export const usedBy = (world: World, units: string[]) => new Set(units.flatMap((u) => Object.keys(materialsOf(world, u))));

/** Materials the nation does not have enough of for this bill: "3 steel (you have 1)". */
export function shortfall(s: GameState, world: World, n: NationId, bill: Record<string, number>): string | null {
  const stock = s.nations[n]?.stock ?? {};
  const short = Object.entries(bill).filter(([r, q]) => (stock[r] ?? 0) < q);
  if (!short.length) return null;
  return short.map(([r, q]) => `${q} ${world.resources[r]?.name.toLowerCase() ?? r} (you have ${Math.floor(stock[r] ?? 0)})`).join(' and ');
}

const pay = (stock: Record<string, number> | undefined, bill: Record<string, number>) => {
  const out = { ...(stock ?? {}) };
  for (const [r, q] of Object.entries(bill)) out[r] = Math.round(((out[r] ?? 0) - q) * 10) / 10;
  return out;
};

// ---- the world market ---------------------------------------------------------------------------

/** Buying pushes a price up and selling pulls it down; the push fades by this much each month. */
const MARKET_DECAY = 0.6;
/** How much buying it takes to move a price by a factor of e (the market is the whole world). */
const MARKET_DEPTH = 160;
/** Sellers get this share of the price (merchants take the rest). */
export const SELL_SHARE = 0.8;
export const MAX_DEAL = 40;

/** Current market price of a resource. */
export function marketPrice(s: GameState, world: World, r: string, shift = 0): number {
  const base = world.resources[r]?.price ?? 1;
  const pressure = (s.market?.[r] ?? 0) + shift;
  return Math.round(Math.max(0.35, Math.min(3, Math.exp(pressure / MARKET_DEPTH))) * base * 100) / 100;
}

/** Money for buying (amount > 0) or selling (amount < 0) on the market; what you pay or get. */
export function marketQuote(s: GameState, world: World, r: string, amount: number): number {
  const avg = marketPrice(s, world, r, amount / 2);
  return Math.round(Math.abs(amount) * avg * (amount > 0 ? 1 : SELL_SHARE) * 10) / 10;
}

export function marketError(s: GameState, world: World, n: NationId, r: string, amount: number): string | null {
  const nation = s.nations[n];
  if (!nation?.alive) return 'Unknown nation';
  if (!world.resources[r]) return 'Nothing like that is traded';
  if (!Number.isInteger(amount) || !amount || Math.abs(amount) > MAX_DEAL) return `Trade between 1 and ${MAX_DEAL} at a time`;
  if (amount > 0) {
    const cost = marketQuote(s, world, r, amount);
    if ((nation.treasury ?? 0) < cost) return `Costs ${cost}: the treasury holds ${Math.floor(nation.treasury ?? 0)}`;
    if ((nation.stock?.[r] ?? 0) + amount > STOCK_CAP) return `Your storage holds ${STOCK_CAP} at most`;
  } else if ((nation.stock?.[r] ?? 0) < -amount) return `You have only ${Math.floor(nation.stock?.[r] ?? 0)} to sell`;
  return null;
}

export function applyMarket(s: GameState, world: World, n: NationId, r: string, amount: number): GameState {
  const nation = s.nations[n];
  const money = marketQuote(s, world, r, amount);
  return {
    ...s,
    market: { ...s.market, [r]: (s.market?.[r] ?? 0) + amount },
    nations: { ...s.nations, [n]: { ...nation, treasury: Math.round(((nation.treasury ?? 0) + (amount > 0 ? -money : money)) * 10) / 10, stock: pay(nation.stock, { [r]: -amount }) } },
  };
}

// ---- money --------------------------------------------------------------------------------------

/** The era's basic troops (its first land unit): the only kind small provinces can raise. */
export const basicUnit = (world: World) => Object.values(world.unitTypes).find((u) => u.domain !== 'sea' && !u.strike)?.id ?? '';

export interface RecruitSite {
  /** Share of full strength new troops start at (they train up to full). */
  start: number;
  /** Multiplier on the price. */
  cost: number;
  /** Only basic troops can be raised here. */
  basicOnly: boolean;
  label: string;
}

/**
 * How well a province raises troops: the capital best (trained cadres, depots, money), big or
 * developed cities well, towns normally; small places can only raise basic infantry.
 */
export function recruitSite(s: GameState, world: World, p: ProvinceId): RecruitSite {
  const ps = s.provinces[p];
  if (ps && s.nations[ps.owner]?.capital === p) return { start: 0.7, cost: 0.85, basicOnly: false, label: 'Capital: troops start at 70% strength and cost 15% less' };
  const w = provinceWeight(world, p) * popRatio(s, world, p) + 0.12 * (ps?.level ?? 0);
  if (w >= 0.8) return { start: 0.55, cost: 0.95, basicOnly: false, label: 'Big city: troops start at 55% strength and cost 5% less' };
  if (w >= 0.6) return { start: RECRUIT_STRENGTH, cost: 1, basicOnly: false, label: `Town: troops start at ${RECRUIT_STRENGTH * 100}% strength` };
  return { start: RECRUIT_STRENGTH, cost: 1, basicOnly: true, label: 'Small province: basic troops only (develop it to raise others)' };
}

export function recruitCost(s: GameState, world: World, _n: NationId, unitType: string, _access?: unknown, p?: ProvinceId): number {
  const site = p ? recruitSite(s, world, p).cost : 1;
  return Math.round(RECRUIT_BASE * unitFactor(world, unitType) * site);
}

export function upkeepOf(_s: GameState, world: World, a: Army): number {
  if (isFleet(world, a.unitType)) return 0;
  return UPKEEP_BASE * unitFactor(world, a.unitType) * (a.maxStrength / BASE_STRENGTH);
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
  /** Trade agreement payments (negative: paid out). */
  trade: number;
  upkeep: number;
  /** Net change per month (before market sales). */
  net: number;
}

export function budgetOf(s: GameState, world: World, n: NationId): Budget {
  const land = supportedArmies(s, world, n) * INCOME_PER_ARMY * UPKEEP_BASE * difficultyMult(s, n);
  let trade = 0;
  for (const t of tradeRoutes(s, n)) {
    const g = t.trade?.gold ?? 0;
    trade += t.parties[0] === n ? -g : g;
  }
  let upkeep = 0;
  for (const a of Object.values(s.armies)) if (a.owner === n) upkeep += upkeepOf(s, world, a);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return { land: r1(land), trade: r1(trade), upkeep: r1(upkeep), net: r1(land + trade - upkeep) };
}

export const armyCount = (s: GameState, world: World, n: NationId) =>
  Object.values(s.armies).filter((a) => a.owner === n && !isFleet(world, a.unitType)).length;

// ---- recruiting, building, developing ------------------------------------------------------------

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
  if ((s.provinces[p].falloutUntil ?? 0) > s.clock.hours) return 'Nobody can be raised in a poisoned province';
  if (!u.strike && unitType !== basicUnit(world) && recruitSite(s, world, p).basicOnly) return `This small province can only raise ${world.unitTypes[basicUnit(world)]?.name ?? 'basic troops'}`;
  if (armyCount(s, world, n) >= manpowerCap(s, world, n)) return `No manpower left: ${armyCount(s, world, n)} of ${manpowerCap(s, world, n)} armies raised. Take more land to raise more.`;
  const lack = shortfall(s, world, n, materialsOf(world, unitType));
  if (lack) return `Needs ${lack}: build a mine or farm, trade, or buy on the market`;
  const cost = recruitCost(s, world, n, unitType, undefined, p);
  if ((nation.treasury ?? 0) < cost) return `Costs ${cost}: the treasury holds ${Math.floor(nation.treasury ?? 0)}`;
  return null;
}

export function applyRecruit(s: GameState, world: World, n: NationId, p: ProvinceId, unitType: string): GameState {
  const cost = recruitCost(s, world, n, unitType, undefined, p);
  const nation = s.nations[n];
  const next: GameState = { ...s, nations: { ...s.nations, [n]: { ...nation, treasury: (nation.treasury ?? 0) - cost, stock: pay(nation.stock, materialsOf(world, unitType)) } } };
  return raiseUnitOfType(next, world, n, p, unitType, BASE_STRENGTH * recruitSite(s, world, p).start, BASE_STRENGTH);
}

/** Materials a building needs besides money (air defence, in the eras that have it). */
export function buildingMaterials(world: World, b: BuildingId): Record<string, number> {
  if (b !== 'airdefense') return {};
  return world.weapons?.airDefense.materials ?? {};
}

/** Why the nation cannot put up this building here, or null. */
export function buildError(s: GameState, world: World, n: NationId, p: ProvinceId, b: BuildingId): string | null {
  const def = BUILDINGS[b];
  if (!def) return 'Unknown building';
  if (s.nations[n]?.alive !== true) return 'Unknown nation';
  if (s.provinces[p]?.owner !== n) return 'You can only build in your own provinces';
  if (b === 'airfield' && !eraHasAir(world)) return 'There are no aircraft in this era';
  if (b === 'airdefense' && !world.weapons) return 'There is no air defence in this era';
  if (b === 'mine' || b === 'farm' || b === 'factory') {
    const r = world.resources[world.provinces[p]?.resource ?? ''];
    if (!r) return 'There is nothing here to extract';
    if (r.extract !== b) return `${r.name} needs a ${BUILDINGS[r.extract].name.toLowerCase()}, not a ${def.name.toLowerCase()}`;
  }
  if (s.provinces[p].build?.includes(b)) return `There is already a ${def.name.toLowerCase()} here`;
  if (hostileHere(s, world, n, p)) return 'The enemy is in this province';
  if ((s.nations[n].treasury ?? 0) < def.cost) return `Costs ${def.cost}: the treasury holds ${Math.floor(s.nations[n].treasury ?? 0)}`;
  const lack = shortfall(s, world, n, buildingMaterials(world, b));
  if (lack) return `Needs ${lack}`;
  return null;
}

export function applyBuild(s: GameState, world: World, n: NationId, p: ProvinceId, b: BuildingId): GameState {
  const nation = s.nations[n];
  const ps = s.provinces[p];
  return {
    ...s,
    nations: { ...s.nations, [n]: { ...nation, treasury: (nation.treasury ?? 0) - BUILDINGS[b].cost, stock: pay(nation.stock, buildingMaterials(world, b)) } },
    provinces: { ...s.provinces, [p]: { ...ps, build: [...(ps.build ?? []), b] } },
  };
}

/** Money and materials to develop a province to its next level. */
export function developCost(s: GameState, world: World, p: ProvinceId): { gold: number; materials: Record<string, number> } {
  const next = (s.provinces[p]?.level ?? 0) + 1;
  return { gold: DEVELOP_GOLD[Math.min(MAX_LEVEL, next)] ?? 0, materials: Object.fromEntries(Object.entries(world.developCost).map(([r, q]) => [r, q * next])) };
}

export function developError(s: GameState, world: World, n: NationId, p: ProvinceId): string | null {
  const ps = s.provinces[p];
  if (!s.nations[n]?.alive) return 'Unknown nation';
  if (ps?.owner !== n) return 'You can only develop your own provinces';
  if ((ps.level ?? 0) >= MAX_LEVEL) return 'Fully developed';
  if (hostileHere(s, world, n, p) || ps.siege) return 'Not while the enemy is here';
  if ((ps.falloutUntil ?? 0) > s.clock.hours) return 'Nobody can build in a poisoned province';
  const { gold, materials } = developCost(s, world, p);
  if ((s.nations[n].treasury ?? 0) < gold) return `Costs ${gold}: the treasury holds ${Math.floor(s.nations[n].treasury ?? 0)}`;
  const lack = shortfall(s, world, n, materials);
  return lack ? `Needs ${lack}` : null;
}

export function applyDevelop(s: GameState, world: World, n: NationId, p: ProvinceId): GameState {
  const { gold, materials } = developCost(s, world, p);
  const nation = s.nations[n];
  const ps = s.provinces[p];
  return {
    ...s,
    nations: { ...s.nations, [n]: { ...nation, treasury: (nation.treasury ?? 0) - gold, stock: pay(nation.stock, materials) } },
    provinces: { ...s.provinces, [p]: { ...ps, level: (ps.level ?? 0) + 1 } },
  };
}

// ---- setup --------------------------------------------------------------------------------------

/**
 * Gives every nation without one a treasury and its starting barracks (and airfields): the
 * capital, plus the most populous homeland provinces for a large army; and stockpiles. Also used
 * to bring saves from before the economy (or before stockpiles) up to date.
 */
export function initEconomy(state: GameState, world: World): GameState {
  const todo = Object.values(state.nations).filter((n) => n.alive && n.treasury === undefined);
  let s = state;
  if (todo.length) {
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
  }
  return initStocks(s, world);
}

/**
 * Starting stockpiles: half a year of what the nation produces, plus a reserve of whatever its
 * armies are built from (pre-war stockpiles), and a little of everything.
 */
export function initStocks(state: GameState, world: World): GameState {
  if (Object.values(state.nations).every((n) => !n.alive || n.stock)) return state;
  const nations = { ...state.nations };
  for (const n of Object.values(nations)) {
    if (!n.alive || n.stock) continue;
    const produced = producedBy(state, world, n.id);
    const used = usedBy(world, n.units);
    const stock: Record<string, number> = {};
    for (const r of Object.keys(world.resources)) {
      const v = 4 + (produced.get(r) ?? 0) * 6 + (used.has(r) ? 14 * Math.max(1, n.military) : 0);
      stock[r] = Math.min(STOCK_CAP, Math.round(v));
    }
    nations[n.id] = { ...n, stock };
  }
  return { ...state, nations };
}

// ---- monthly settlement -------------------------------------------------------------------------

export function economyTick(state: GameState, world: World, log: Logger): GameState {
  const day = state.clock.hours / 24;
  if (state.clock.hours % 24 !== 0 || day <= 0 || day % ECONOMY_EVERY_DAYS !== 0) return state;
  let s = state;
  const humans = humansOf(s);
  const detailed = s.rules.economy === 'detailed';
  const nations = { ...s.nations };
  const armies = { ...s.armies };
  const deserted: NationId[] = [];
  const sold = new Map<NationId, number>();

  // trade routes between nations now at war, or with a fallen party, are closed
  const dead = (t: Treaty) => t.parties.some((p) => !s.nations[p]?.alive) || atWar(s, t.parties[0], t.parties[1]);
  if (tradeRoutes(s).some(dead)) s = { ...s, treaties: s.treaties.filter((t) => t.type !== 'trade' || !dead(t)) };

  // 1) taxes, trade payments, upkeep
  for (const id of Object.keys(nations).sort()) {
    const n = nations[id];
    if (!n.alive) continue;
    const b = budgetOf(s, world, id);
    let treasury = (n.treasury ?? 0) + b.net;
    // an empty treasury cannot pay the troops: some desert
    if (treasury < 0) {
      for (const a of Object.values(armies)) if (a.owner === id) armies[a.id] = { ...a, strength: Math.max(0.6, a.strength - a.maxStrength * 0.1) };
      if (humans.includes(id)) deserted.push(id);
      treasury = Math.max(treasury, -50);
    }
    nations[id] = { ...n, treasury: Math.round(treasury * 10) / 10 };
  }

  // 2) production
  for (const id of Object.keys(nations).sort()) {
    const n = nations[id];
    if (!n.alive) continue;
    const stock = { ...(n.stock ?? {}) };
    for (const [r, q] of producedBy(s, world, id)) stock[r] = (stock[r] ?? 0) + q;
    nations[id] = { ...n, stock };
  }
  // 3) trade agreements carry goods from the supplier's stock
  for (const t of tradeRoutes(s)) {
    const [a, b] = t.parties;
    const flow = (from: NationId, to: NationId, r?: string) => {
      if (!r || !nations[from]?.alive || !nations[to]?.alive || !producedBy(s, world, from).has(r)) return;
      const have = nations[from].stock?.[r] ?? 0;
      const moved = Math.min(TRADE_FLOW, have);
      nations[from] = { ...nations[from], stock: { ...nations[from].stock, [r]: have - moved } };
      nations[to] = { ...nations[to], stock: { ...nations[to].stock, [r]: (nations[to].stock?.[r] ?? 0) + moved } };
    };
    flow(a, b, t.trade?.sell);
    flow(b, a, t.trade?.buy);
  }
  // 4) detailed economy: what the armies use, and shortages
  if (detailed) {
    const use = new Map<string, number>();
    for (const a of Object.values(armies)) for (const r of needsOf(world, a.unitType)) use.set(`${a.owner}|${r}`, (use.get(`${a.owner}|${r}`) ?? 0) + STOCK_USE * (a.maxStrength / BASE_STRENGTH));
    for (const id of Object.keys(nations).sort()) {
      const n = nations[id];
      if (!n.alive) continue;
      const stock = { ...(n.stock ?? {}) };
      const short: string[] = [];
      for (const r of Object.keys(world.resources)) {
        const need = use.get(`${id}|${r}`) ?? 0;
        if (!need) continue;
        const have = stock[r] ?? 0;
        if (need > have + 1e-9) short.push(r);
        stock[r] = Math.max(0, have - need);
      }
      nations[id] = { ...n, stock, short };
    }
  }
  // 5) storage is full: the rest goes to the market
  let market = { ...(s.market ?? {}) };
  for (const id of Object.keys(nations).sort()) {
    const n = nations[id];
    if (!n.alive || !n.stock) continue;
    const stock = { ...n.stock };
    let money = 0;
    for (const r of Object.keys(stock).sort()) {
      stock[r] = Math.round(stock[r] * 10) / 10;
      const extra = stock[r] - STOCK_CAP;
      if (extra <= 0) continue;
      const q = Math.ceil(extra);
      money += marketQuote({ ...s, market }, world, r, -q);
      market = { ...market, [r]: (market[r] ?? 0) - q };
      stock[r] = STOCK_CAP;
    }
    if (money) sold.set(id, money);
    nations[id] = { ...n, stock, treasury: Math.round(((n.treasury ?? 0) + money) * 10) / 10 };
  }
  // 6) prices drift back
  for (const r of Object.keys(market)) {
    const v = Math.round(market[r] * MARKET_DECAY * 10) / 10;
    if (Math.abs(v) < 0.5) delete market[r]; else market[r] = v;
  }

  s = { ...s, nations, armies, market };
  for (const h of deserted) s = log(s, { kind: 'economy', text: `${s.nations[h].shortName}: the treasury is empty and unpaid troops are deserting.`, nations: [h], important: true });
  for (const h of humans) if (sold.has(h)) s = log(s, { kind: 'economy', text: `${s.nations[h].shortName}'s storage was full: the surplus sold for ${Math.round(sold.get(h)!)}.`, nations: [h] });
  for (const h of detailed ? humans : []) {
    if (!s.nations[h]?.alive) continue;
    const fresh = (s.nations[h].short ?? []).filter((r) => !(state.nations[h]?.short ?? []).includes(r));
    if (fresh.length) s = log(s, { kind: 'economy', text: `${s.nations[h].shortName} is out of ${fresh.map((r) => world.resources[r]?.name ?? r).join(' and ')}: units that need it fight at three quarters strength and cannot refit.`, nations: [h], important: true });
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
