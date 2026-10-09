import { exp } from './detmath';
import { armyCap, BASE_STRENGTH, effectiveSize, homelandOf, isFleet, provinceWeight, raiseUnitOfType } from './military';
import { roll } from './world';
import { basePop, POP_FLOOR, popRatio } from './population';
import { healthIncome, healthUse, researchCost } from './pandemic';
import { atWar, provincesOf } from './queries';
import { humansOf, isHuman, type Army, type BuildingId, type GameEvent, type GameState, type NationId, type Project, type ProvinceId, type Treaty } from './types';
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

export interface BuildingDef { name: string; cost: number; text: string; /** days to build */ days: number }
export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  barracks: { name: 'Barracks', cost: 25, days: 14, text: 'Recruits land armies here.' },
  airfield: { name: 'Airfield', cost: 30, days: 21, text: 'Recruits air units here.' },
  fort: { name: 'Fortress', cost: 20, days: 20, text: 'The province garrison is half as strong again.' },
  mine: { name: 'Mine', cost: 20, days: 20, text: `Extracts the province's resource: ${PRODUCE_EXTRACTED} a month instead of ${PRODUCE_BASE}.` },
  farm: { name: 'Farm', cost: 15, days: 10, text: `Works the province's land: ${PRODUCE_EXTRACTED} of its resource a month instead of ${PRODUCE_BASE}.` },
  factory: { name: 'Factory', cost: 30, days: 30, text: `Manufactures the province's resource: ${PRODUCE_EXTRACTED} a month instead of ${PRODUCE_BASE}.` },
  airdefense: { name: 'Air defence', cost: 40, days: 14, text: 'Shoots down missiles and blunts air strikes on this province and its neighbours.' },
  hospital: { name: 'Hospital', cost: 30, days: 14, text: 'Treats the sick: less than half as many of them die here.' },
  lab: { name: 'Research lab', cost: 40, days: 30, text: 'Works on the cure: each lab speeds up research (it uses a lab reagent a month).' },
};

/** Materials for the pandemic era's buildings. */
const HEALTH_MATERIALS: Partial<Record<BuildingId, Record<string, number>>> = {
  hospital: { medicine: 2, gear: 2 },
  lab: { reagents: 3 },
};
/** A province whose main city weighs this much is a big city (barracks from the start). */
const BIG_CITY_WEIGHT = 0.8;
/** Every barracks musters a basic unit for free this often, while the nation has manpower to spare. */
export const MUSTER_DAYS = 30;
/** Strength the mustered troops start at (they fill up at rest). */
const MUSTER_STRENGTH = 0.6;

/** Days to train a basic army (stronger units take longer, good sites less: see recruitSite). */
export const TRAIN_DAYS = 12;
/** Days to develop a province to a level: 20, 30, 40. */
export const developDays = (level: number) => 10 + 10 * level;

export const projectsOf = (s: GameState, n: NationId, p?: ProvinceId) => (s.projects ?? []).filter((x) => x.nation === n && (!p || x.province === p));
/** Armies a nation has in training. */
export const inTraining = (s: GameState, n: NationId) => (s.projects ?? []).filter((x) => x.nation === n && x.kind === 'recruit').length;

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
  if (!r || !ps || ps.siege || ps.quarantine || (ps.falloutUntil ?? 0) > s.clock.hours) return 0;
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

/**
 * How each of a nation's stockpiles changes in a month: production, plus trade agreements coming
 * in, minus those going out, minus what the armies use (detailed economy).
 */
export function resourceFlow(s: GameState, world: World, n: NationId): Record<string, number> {
  const flow: Record<string, number> = {};
  for (const r of Object.keys(world.resources)) flow[r] = 0;
  for (const [r, q] of producedBy(s, world, n)) flow[r] += q;
  for (const t of tradeRoutes(s, n)) {
    const [a, b] = t.parties;
    const out = n === a ? t.trade?.sell : t.trade?.buy;
    const inn = n === a ? t.trade?.buy : t.trade?.sell;
    const other = n === a ? b : a;
    if (out && producedBy(s, world, n).has(out)) flow[out] -= TRADE_FLOW;
    if (inn && producedBy(s, world, other).has(inn)) flow[inn] += TRADE_FLOW;
  }
  if (s.rules.economy === 'detailed') {
    for (const a of Object.values(s.armies)) if (a.owner === n) for (const r of needsOf(world, a.unitType)) flow[r] -= STOCK_USE * (a.maxStrength / BASE_STRENGTH);
  }
  for (const [r, q] of Object.entries(healthUse(s, world, n))) if (r in flow) flow[r] -= q;
  for (const r of Object.keys(flow)) flow[r] = Math.round(flow[r] * 10) / 10;
  return flow;
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
  return Math.round(Math.max(0.35, Math.min(3, exp(pressure / MARKET_DEPTH))) * base * 100) / 100;
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
  /** Multiplier on the training time. */
  time: number;
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
  if (ps && s.nations[ps.owner]?.capital === p) return { time: 0.6, cost: 0.85, basicOnly: false, label: 'Capital: troops train fastest (60% of the time) and cost 15% less' };
  const w = provinceWeight(world, p) * popRatio(s, world, p) + 0.12 * (ps?.level ?? 0);
  if (w >= 0.8) return { time: 0.8, cost: 0.95, basicOnly: false, label: 'Big city: troops train faster (80% of the time) and cost 5% less' };
  if (w >= 0.6) return { time: 1, cost: 1, basicOnly: false, label: 'Town: troops train in the normal time' };
  return { time: 1, cost: 1, basicOnly: true, label: 'Small province: basic troops only (develop it to raise others)' };
}

/** Days a unit takes to train here. */
export function trainDays(s: GameState, world: World, p: ProvinceId, unitType: string): number {
  return Math.max(3, Math.round(TRAIN_DAYS * unitFactor(world, unitType) * recruitSite(s, world, p).time));
}

export function recruitCost(s: GameState, world: World, _n: NationId, unitType: string, _access?: unknown, p?: ProvinceId): number {
  const site = p ? recruitSite(s, world, p).cost : 1;
  return Math.round(RECRUIT_BASE * unitFactor(world, unitType) * site);
}

export function upkeepOf(s: GameState, world: World, a: Army): number {
  if (isFleet(world, a.unitType)) return 0;
  // a pandemic's guard troops cost little: the money goes to hospitals and labs
  return (s.disease ? 0.3 : 1) * UPKEEP_BASE * unitFactor(world, a.unitType) * (a.maxStrength / BASE_STRENGTH);
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
  /** Pandemic era: research funding. */
  health?: number;
  /** Net change per month (before market sales). */
  net: number;
}

export function budgetOf(s: GameState, world: World, n: NationId): Budget {
  const full = supportedArmies(s, world, n) * INCOME_PER_ARMY * UPKEEP_BASE * difficultyMult(s, n);
  // in a pandemic, lockdowns and the sick cut the taxes, and research costs a share of them
  const land = full * healthIncome(s, world, n);
  const health = researchCost(s, n, full);
  let trade = 0;
  for (const t of tradeRoutes(s, n)) {
    const g = t.trade?.gold ?? 0;
    trade += t.parties[0] === n ? -g : g;
  }
  let upkeep = 0;
  for (const a of Object.values(s.armies)) if (a.owner === n) upkeep += upkeepOf(s, world, a);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return { land: r1(land), trade: r1(trade), upkeep: r1(upkeep), ...(health ? { health: r1(health) } : {}), net: r1(land + trade - upkeep - health) };
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
  if (armyCount(s, world, n) + inTraining(s, n) >= manpowerCap(s, world, n)) return `No manpower left: ${armyCount(s, world, n) + inTraining(s, n)} of ${manpowerCap(s, world, n)} armies raised or in training. Take more land to raise more.`;
  const lack = shortfall(s, world, n, materialsOf(world, unitType));
  if (lack) return `Needs ${lack}: build a mine or farm, trade, or buy on the market`;
  const cost = recruitCost(s, world, n, unitType, undefined, p);
  if ((nation.treasury ?? 0) < cost) return `Costs ${cost}: the treasury holds ${Math.floor(nation.treasury ?? 0)}`;
  return null;
}

/** Starts a piece of work: it is paid now and done in `days`. */
function startProject(s: GameState, n: NationId, p: ProvinceId, kind: Project['kind'], what: string, days: number): GameState {
  const project: Project = { id: `w${s.nextId}`, nation: n, province: p, kind, what, startAt: s.clock.hours, doneAt: s.clock.hours + days * 24 };
  return { ...s, projects: [...(s.projects ?? []), project], nextId: s.nextId + 1 };
}

export function applyRecruit(s: GameState, world: World, n: NationId, p: ProvinceId, unitType: string): GameState {
  const cost = recruitCost(s, world, n, unitType, undefined, p);
  const nation = s.nations[n];
  const next: GameState = { ...s, nations: { ...s.nations, [n]: { ...nation, treasury: (nation.treasury ?? 0) - cost, stock: pay(nation.stock, materialsOf(world, unitType)) } } };
  return startProject(next, n, p, 'recruit', unitType, trainDays(s, world, p, unitType));
}

/** Materials a building needs besides money (air defence, in the eras that have it). */
export function buildingMaterials(world: World, b: BuildingId): Record<string, number> {
  if (HEALTH_MATERIALS[b]) return HEALTH_MATERIALS[b]!;
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
  if ((b === 'hospital' || b === 'lab') && !s.disease) return 'Only in a pandemic';
  if (s.disease && (b === 'fort' || b === 'airfield')) return 'No use in a pandemic';
  if (b === 'mine' || b === 'farm' || b === 'factory') {
    const r = world.resources[world.provinces[p]?.resource ?? ''];
    if (!r) return 'There is nothing here to extract';
    if (r.extract !== b) return `${r.name} needs a ${BUILDINGS[r.extract].name.toLowerCase()}, not a ${def.name.toLowerCase()}`;
  }
  if (s.provinces[p].build?.includes(b)) return `There is already a ${def.name.toLowerCase()} here`;
  if ((s.projects ?? []).some((x) => x.province === p && x.kind === 'build' && x.what === b)) return `A ${def.name.toLowerCase()} is already being built here`;
  if (hostileHere(s, world, n, p)) return 'The enemy is in this province';
  if ((s.nations[n].treasury ?? 0) < def.cost) return `Costs ${def.cost}: the treasury holds ${Math.floor(s.nations[n].treasury ?? 0)}`;
  const lack = shortfall(s, world, n, buildingMaterials(world, b));
  if (lack) return `Needs ${lack}`;
  return null;
}

export function applyBuild(s: GameState, world: World, n: NationId, p: ProvinceId, b: BuildingId): GameState {
  const nation = s.nations[n];
  const paid: GameState = { ...s, nations: { ...s.nations, [n]: { ...nation, treasury: (nation.treasury ?? 0) - BUILDINGS[b].cost, stock: pay(nation.stock, buildingMaterials(world, b)) } } };
  return startProject(paid, n, p, 'build', b, BUILDINGS[b].days);
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
  if ((s.projects ?? []).some((x) => x.province === p && x.kind === 'develop')) return 'Already being developed';
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
  const level = (s.provinces[p].level ?? 0) + 1;
  const paid: GameState = { ...s, nations: { ...s.nations, [n]: { ...nation, treasury: (nation.treasury ?? 0) - gold, stock: pay(nation.stock, materials) } } };
  return startProject(paid, n, p, 'develop', String(level), developDays(level));
}

/**
 * Finishes the work that is due: buildings stand, provinces reach their new level, troops leave
 * their barracks at full strength. Work in a province that changed hands is lost.
 */
export function projectsTick(state: GameState, world: World, log: Logger): GameState {
  const all = state.projects;
  if (!all?.length || !all.some((x) => x.doneAt <= state.clock.hours)) return state;
  let s: GameState = { ...state, projects: all.filter((x) => x.doneAt > state.clock.hours) };
  for (const x of all.filter((y) => y.doneAt <= state.clock.hours).sort((a, b) => a.doneAt - b.doneAt || (a.id < b.id ? -1 : 1))) {
    const ps = s.provinces[x.province];
    const where = world.provinces[x.province]?.name ?? x.province;
    const human = isHuman(s, x.nation);
    if (!ps || ps.owner !== x.nation || !s.nations[x.nation]?.alive) {
      if (human) s = log(s, { kind: 'project', text: `Work at ${where} was lost with the province.`, nations: [x.nation] });
      continue;
    }
    if (x.kind === 'build') {
      const b = x.what as BuildingId;
      if (!ps.build?.includes(b)) s = { ...s, provinces: { ...s.provinces, [x.province]: { ...ps, build: [...(ps.build ?? []), b] } } };
      if (human) {
        const r = world.resources[world.provinces[x.province]?.resource ?? ''];
        const name = r && r.extract === b ? extractName(world, x.province) : BUILDINGS[b].name;
        s = log(s, { kind: 'project', text: `${name} at ${where} ${r && r.extract === b ? `are working: ${PRODUCE_EXTRACTED} ${r.name.toLowerCase()} a month` : 'is ready'}.`, nations: [x.nation] });
      }
    } else if (x.kind === 'develop') {
      s = { ...s, provinces: { ...s.provinces, [x.province]: { ...ps, level: Math.max(ps.level ?? 0, Number(x.what)) } } };
      if (human) s = log(s, { kind: 'project', text: `${where} is developed to level ${x.what}.`, nations: [x.nation] });
    } else {
      // troops cannot muster where the enemy stands: they wait
      if (Object.values(s.armies).some((a) => a.location === x.province && atWar(s, x.nation, a.owner))) {
        s = { ...s, projects: [...(s.projects ?? []), { ...x, doneAt: s.clock.hours + 24 }] };
        continue;
      }
      const before = s.nextId;
      s = raiseUnitOfType(s, world, x.nation, x.province, x.what, BASE_STRENGTH, BASE_STRENGTH);
      if (human) s = log(s, { kind: 'mobilize', text: `${s.armies[`a${before}`]?.name ?? 'New troops'} ${s.armies[`a${before}`] ? 'is' : 'are'} ready at ${where}.`, nations: [x.nation] });
    }
  }
  return s;
}

/**
 * Barracks muster troops on their own: each raises a basic unit for free every MUSTER_DAYS (on its
 * own day of the month), up to the nation's manpower, unless the enemy stands there. Not in a pandemic.
 */
export function musterTick(state: GameState, world: World, log: Logger): GameState {
  if (state.disease || state.clock.hours % 24 !== 0) return state;
  const day = state.clock.hours / 24;
  if (day <= 0) return state;
  const unit = basicUnit(world);
  if (!unit) return state;
  let s = state;
  const raised = new Map<NationId, ProvinceId[]>();
  for (const p of world.order) {
    const ps = s.provinces[p];
    if (!ps?.build?.includes('barracks')) continue;
    if ((day + Math.floor(roll(p, 'muster') * MUSTER_DAYS)) % MUSTER_DAYS !== 0) continue;
    const n = ps.owner;
    if (!s.nations[n]?.alive || ps.siege || (ps.falloutUntil ?? 0) > s.clock.hours || hostileHere(s, world, n, p)) continue;
    if (armyCount(s, world, n) + inTraining(s, n) >= manpowerCap(s, world, n)) continue;
    s = raiseUnitOfType(s, world, n, p, unit, BASE_STRENGTH * MUSTER_STRENGTH, BASE_STRENGTH);
    raised.set(n, [...(raised.get(n) ?? []), p]);
  }
  for (const [n, ps] of raised) {
    if (!isHuman(s, n)) continue;
    const where = ps.map((p) => world.provinces[p]?.name ?? p).join(', ');
    s = log(s, { kind: 'mobilize', text: `New ${world.unitTypes[unit]?.name ?? 'troops'} muster at the barracks of ${where}.`, nations: [n] });
  }
  return s;
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
      // every big city of the homeland too
      for (const p of home) if (provinceWeight(world, p) >= BIG_CITY_WEIGHT) add(p, 'barracks');
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
  // every capital has barracks (saves from before, and capitals that moved)
  for (const n of Object.values(s.nations)) {
    const ps = n.alive && n.capital ? s.provinces[n.capital] : null;
    if (ps && !ps.build?.includes('barracks')) s = { ...s, provinces: { ...s.provinces, [n.capital!]: { ...ps, build: [...(ps.build ?? []), 'barracks'] } } };
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

  // civilians slowly return and recover (the dead of a pandemic do not)
  let patch: GameState['provinces'] | null = null;
  for (const [p, ps] of Object.entries(s.disease ? {} : s.provinces)) {
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
