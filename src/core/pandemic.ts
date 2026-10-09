import { addGrievance, addRelation, logEvent } from './events';
import { formatPop, popOf } from './population';
import { nextRandom } from './rng';
import { formatShortDate } from './time';
import { humansOf, isHuman, type DiseaseState, type GameState, type HealthState, type NationId, type ProvinceId, type Severity } from './types';
import type { World } from './world';

/**
 * The pandemic era. A new disease breaks out in one province and spreads: within a province by
 * contact (a simple SIR model: sick people infect the healthy, then recover or die), between
 * provinces over land borders and sea lanes, and by air between the big cities. Each day a
 * healthy province near sick ones may catch it (a seeded roll, so every client agrees).
 *
 * Nations fight it with lockdowns (slower spread, less money), closed borders (fewer travellers,
 * angry neighbours; guard troops on a border catch most of the rest), quarantined provinces,
 * hospitals (fewer deaths) and labs (faster research). Research towards a cure is pooled between
 * the members of a research pact, and needs rare materials for its trials. The cure vaccinates a
 * nation's people; it can be shared. A nation whose hospitals are overwhelmed for two weeks
 * collapses: for a player, that is the defeat. All pure.
 */

export interface SeverityDef { label: string; text: string; beta: number; gamma: number; lethality: number }
export const SEVERITY: Record<Severity, SeverityDef> = {
  mild: { label: 'Mild', text: 'Spreads like a bad flu. Few of the sick die.', beta: 0.24, gamma: 0.1, lethality: 0.004 },
  serious: { label: 'Serious', text: 'Spreads fast; one in seventy of the sick die without a hospital.', beta: 0.32, gamma: 0.09, lethality: 0.015 },
  deadly: { label: 'Deadly', text: 'Spreads very fast and kills one in twenty of the sick. Only the hardest measures hold it.', beta: 0.42, gamma: 0.08, lethality: 0.05 },
};
export const SEVERITIES: Severity[] = ['mild', 'serious', 'deadly'];

export interface LockdownDef { label: string; text: string; spread: number; travel: number; income: number; /** food a month per 10 provinces */ food: number }
export const LOCKDOWN: LockdownDef[] = [
  { label: 'Open', text: 'Life as normal.', spread: 1, travel: 1, income: 1, food: 0 },
  { label: 'Partial', text: 'Masks, distancing, events cancelled: spread 40% slower, 15% less money.', spread: 0.6, travel: 0.5, income: 0.85, food: 1 },
  { label: 'Full lockdown', text: 'Everyone stays home: spread 70% slower, a third less money, and people need food delivered.', spread: 0.32, travel: 0.2, income: 0.65, food: 2 },
];

export interface FundingDef { label: string; mult: number; /** share of the land taxes spent every month */ cost: number }
export const FUNDING: FundingDef[] = [
  { label: 'Low', mult: 0.4, cost: 0 },
  { label: 'Normal', mult: 1, cost: 0.1 },
  { label: 'High', mult: 1.6, cost: 0.25 },
];

/** A province with this share of its people sick has overwhelmed hospitals (more die). */
export const OVERRUN = 0.12;
/** The health system collapses when this share of the people live in overwhelmed provinces… */
export const COLLAPSE_SHARE = 0.5;
/** …for this many days in a row. */
export const COLLAPSE_DAYS = 14;
/** Research points for a cure. */
export const CURE = 100;
/** Research stops at each trial until its materials are in stock. */
export const TRIALS: { at: number; name: string; needs: Record<string, number> }[] = [
  { at: 35, name: 'Lab trials', needs: { compounds: 6, reagents: 4 } },
  { at: 70, name: 'Human trials', needs: { compounds: 10, medicine: 8 } },
];
/** A player wins once vaccinated (or recovered) people make up this share, with the outbreak over at home. */
export const WIN_IMMUNE = 0.6;
/** Days after the first cure before cheap generic versions reach every nation. */
export const GENERIC_DAYS = 120;
/** Most labs that count towards research. */
export const MAX_LABS = 8;

const SEED = 0.001;
const EXTINCT = 0.00002;
/** How easily nearby sickness starts a new outbreak. */
const SEED_K = 30;
const W_HOME = 0.08;
const W_ABROAD = 0.04;
const W_SEA = 0.02;
const AIR = 0.6;
/** Provinces whose main city has this many people have an airport. */
export const BIG_CITY = 1_000_000;
const CLOSED = 0.1;
const GUARDED = 0.4;
const QUARANTINE_TRAVEL = 0.1;
const QUARANTINE_SPREAD = 0.6;
const MASKS = 0.85;
const HOSPITAL_DEATHS = 0.45;
const VACCINATE = 0.012;
const VACCINATE_SHORT = 0.004;

export const healthOf = (s: GameState, n: NationId): HealthState => s.nations[n]?.health ?? {};
export const lockdownOf = (s: GameState, n: NationId) => healthOf(s, n).lockdown ?? 0;
export const fundingOf = (s: GameState, n: NationId) => healthOf(s, n).funding ?? 1;

/** Nations in a research pact with `n`. */
export const pactPartners = (s: GameState, n: NationId): NationId[] =>
  s.treaties.filter((t) => t.type === 'research' && t.parties.includes(n)).flatMap((t) => t.parties.filter((p) => p !== n && s.nations[p]?.alive));

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

// ---- queries --------------------------------------------------------------------------------------

export interface NationHealth {
  pop: number;
  sick: number;
  immune: number;
  /** Share of the people sick / immune. */
  sickShare: number;
  immuneShare: number;
  /** Share of the people in overwhelmed provinces. */
  overrunShare: number;
  infected: number;
  provinces: number;
}

interface Tally { pop: number; sick: number; immune: number; over: number; infected: number; provinces: number; labs: number; sealed: number }
interface HealthIndex { nations: Map<NationId, Tally>; world: { pop: number; sick: number }; neighbours: Map<NationId, Set<NationId>> }

/** Every nation's outbreak, counted in one pass over the provinces (once per province table). */
const indexCache = new WeakMap<object, HealthIndex>();
function healthIndex(s: GameState, world: World): HealthIndex {
  let idx = indexCache.get(s.provinces);
  if (idx) return idx;
  idx = { nations: new Map(), world: { pop: 0, sick: 0 }, neighbours: new Map() };
  for (const p of world.order) {
    const ps = s.provinces[p];
    if (!ps) continue;
    let t = idx.nations.get(ps.owner);
    if (!t) idx.nations.set(ps.owner, (t = { pop: 0, sick: 0, immune: 0, over: 0, infected: 0, provinces: 0, labs: 0, sealed: 0 }));
    const pp = popOf(s, world, p);
    const sick = ps.sick ?? 0;
    t.provinces++;
    t.pop += pp;
    t.sick += sick * pp;
    t.immune += (ps.immune ?? 0) * pp;
    if (sick >= OVERRUN) t.over += pp;
    if (sick) t.infected++;
    if (ps.quarantine) t.sealed += pp;
    else if (ps.build?.includes('lab')) t.labs++;
    idx.world.pop += pp;
    idx.world.sick += sick * pp;
    let near = idx.neighbours.get(ps.owner);
    if (!near) idx.neighbours.set(ps.owner, (near = new Set()));
    for (const l of world.provinces[p].links) {
      const o = s.provinces[l.to]?.owner;
      if (o && o !== ps.owner) near.add(o);
    }
  }
  indexCache.set(s.provinces, idx);
  return idx;
}

const EMPTY_TALLY: Tally = { pop: 0, sick: 0, immune: 0, over: 0, infected: 0, provinces: 0, labs: 0, sealed: 0 };

/** A nation's outbreak in numbers. */
export function nationHealth(s: GameState, world: World, n: NationId): NationHealth {
  const t = healthIndex(s, world).nations.get(n) ?? EMPTY_TALLY;
  const d = Math.max(1, t.pop);
  return { pop: t.pop, sick: t.sick, immune: t.immune, sickShare: t.sick / d, immuneShare: t.immune / d, overrunShare: t.over / d, infected: t.infected, provinces: t.provinces };
}

/** Share of the whole world sick right now. */
export function worldSickShare(s: GameState, world: World): number {
  const w = healthIndex(s, world).world;
  return w.sick / Math.max(1, w.pop);
}

/** People killed by the disease worldwide. */
export const worldDeaths = (s: GameState) => Object.values(s.nations).reduce((x, n) => x + (n.health?.deaths ?? 0), 0);

/**
 * What a nation knows of a province's outbreak: everything in its own land and its pact partners'
 * and allies', elsewhere only outbreaks big enough to make the news (1% sick). Null: no known cases.
 */
export function knownSick(s: GameState, viewer: NationId | null, p: ProvinceId): number | null {
  const ps = s.provinces[p];
  const v = ps?.sick ?? 0;
  if (!v) return null;
  if (!viewer || ps.owner === viewer || v >= 0.01) return v;
  const shared = s.treaties.some((t) => (t.type === 'research' || t.type === 'alliance') && t.parties.includes(viewer) && t.parties.includes(ps.owner));
  return shared ? v : null;
}

/** Research points a nation adds each day (its own, before pact partners). */
export function researchRate(s: GameState, world: World, n: NationId): number {
  const nation = s.nations[n];
  if (!nation?.alive) return 0;
  const labs = healthIndex(s, world).nations.get(n)?.labs ?? 0;
  const reagents = (nation.stock?.reagents ?? 0) >= 1;
  const base = nation.major ? 0.07 : 0.02;
  const fallen = s.disease?.fallen?.includes(n) ? 0.5 : 1;
  return (base + 0.05 * Math.min(labs, MAX_LABS) * (reagents ? 1 : 0.4)) * FUNDING[fundingOf(s, n)].mult * fallen;
}

/** Research points a day with the pact partners' work pooled in. */
export const pooledRate = (s: GameState, world: World, n: NationId) => researchRate(s, world, n) + pactPartners(s, n).reduce((x, p) => x + researchRate(s, world, p), 0);

/** The next trial a nation's research waits on, if any. */
export function nextTrial(s: GameState, n: NationId) {
  const h = healthOf(s, n);
  if (h.cure) return null;
  return TRIALS[h.trials ?? 0] ?? null;
}

/** Multiplier on a nation's taxes: lockdown, the sick who cannot work, quarantined provinces. */
export function healthIncome(s: GameState, world: World, n: NationId): number {
  if (!s.disease) return 1;
  const t = healthIndex(s, world).nations.get(n) ?? EMPTY_TALLY;
  const d = Math.max(1, t.pop);
  return Math.max(0.3, LOCKDOWN[lockdownOf(s, n)].income * (1 - 1.2 * (t.sick / d)) * (1 - 0.8 * (t.sealed / d)));
}

/** Money spent on research each month, from the land taxes. */
export const researchCost = (s: GameState, n: NationId, land: number) => (s.disease ? Math.round(FUNDING[fundingOf(s, n)].cost * land * 10) / 10 : 0);

/** What the fight against the disease uses up every month: food for a lockdown, masks, vaccines, lab reagents. */
export function healthUse(s: GameState, world: World, n: NationId): Record<string, number> {
  if (!s.disease) return {};
  const { provinces, labs } = healthIndex(s, world).nations.get(n) ?? EMPTY_TALLY;
  const lock = lockdownOf(s, n);
  const out: Record<string, number> = {};
  if (lock) {
    out.food = Math.ceil((provinces * LOCKDOWN[lock].food) / 10);
    out.gear = Math.ceil(provinces / 15);
  }
  if (healthOf(s, n).cure) out.medicine = Math.ceil(provinces / 10);
  if (labs) out.reagents = Math.min(labs, MAX_LABS);
  return out;
}

// ---- setup --------------------------------------------------------------------------------------

/** Big cities where a disease can break out (sorted, for a stable pick). */
export const outbreakSites = (world: World): ProvinceId[] => world.order.filter((p) => world.provinces[p].pop >= BIG_CITY).sort();

/**
 * The disease of a new pandemic game, and the starting hospitals (every capital) and labs (the
 * great powers' capitals). The outbreak is announced on the first day (see pandemicTick).
 */
export function initDisease(state: GameState, world: World, name: string): GameState {
  const sites = outbreakSites(world);
  const [v, rng] = nextRandom(state.rng);
  const origin = sites[Math.floor(v * sites.length)] ?? world.order[0];
  const provinces = { ...state.provinces };
  for (const n of Object.values(state.nations)) {
    if (!n.alive || !n.capital) continue;
    const ps = provinces[n.capital];
    const add = n.major ? ['hospital', 'lab'] as const : ['hospital'] as const;
    provinces[n.capital] = { ...ps, build: [...(ps.build ?? []), ...add.filter((b) => !ps.build?.includes(b))] };
  }
  provinces[origin] = { ...provinces[origin], sick: SEED * 4 };
  return { ...state, rng, provinces, disease: { name, severity: 'serious', origin } };
}

/** The player's own disease, chosen with the nation (before the first day). */
export function customizeDisease(s: GameState, opts: { name?: string; severity?: Severity; origin?: ProvinceId }): GameState {
  const d = s.disease;
  if (!d) return s;
  const next: DiseaseState = {
    ...d,
    name: opts.name?.trim().slice(0, 40) || d.name,
    severity: opts.severity ?? d.severity,
    origin: opts.origin && s.provinces[opts.origin] ? opts.origin : d.origin,
  };
  if (next.origin === d.origin) return { ...s, disease: next };
  const provinces = { ...s.provinces };
  const { sick: _, ...old } = provinces[d.origin];
  provinces[d.origin] = old;
  provinces[next.origin] = { ...provinces[next.origin], sick: SEED * 4 };
  return { ...s, provinces, disease: next };
}

// ---- the daily spread -----------------------------------------------------------------------------

interface NationFactors { spread: number; travel: number; closed: boolean; cure: boolean; vaccinate: number }

function factorsOf(s: GameState): Map<NationId, NationFactors> {
  const out = new Map<NationId, NationFactors>();
  for (const n of Object.values(s.nations)) {
    const h = n.health ?? {};
    // a lockdown without food to deliver breaks down to the level below
    const lock = Math.max(0, (h.lockdown ?? 0) - ((h.lockdown ?? 0) > 0 && (n.stock?.food ?? 0) < 1 ? 1 : 0));
    const masks = (h.lockdown ?? 0) > 0 && (n.stock?.gear ?? 0) >= 1 ? MASKS : 1;
    out.set(n.id, {
      spread: LOCKDOWN[lock].spread * masks,
      travel: LOCKDOWN[lock].travel,
      closed: !!h.borders,
      cure: !!h.cure,
      vaccinate: (n.stock?.medicine ?? 0) >= 1 ? VACCINATE : VACCINATE_SHORT,
    });
  }
  return out;
}

const OPEN: NationFactors = { spread: 1, travel: 1, closed: false, cure: false, vaccinate: 0 };

type Logger = (s: GameState, ev: { kind: string; text: string; nations?: NationId[]; important?: boolean }) => GameState;

/** One day of the pandemic: spread, recoveries, deaths, vaccination, research, and their news. */
export function pandemicTick(state: GameState, world: World, log: Logger): GameState {
  const d = state.disease;
  if (!d || state.clock.hours % 24 !== 0) return state;
  let s = state;
  const day = s.clock.hours / 24;
  const name = (n: NationId) => s.nations[n]?.shortName ?? n;
  const place = (p: ProvinceId) => world.provinces[p]?.name ?? p;
  if (day === 1) s = announce(s, world, log);

  const sev = SEVERITY[d.severity];
  const f = factorsOf(s);
  const guarded = new Set<ProvinceId>();
  for (const a of Object.values(s.armies)) if (a.progress === 0) guarded.add(`${a.owner}|${a.location}`);

  // the air: big cities share their sickness
  let airSick = 0, airPop = 0;
  for (const p of world.order) {
    if (world.provinces[p].pop < BIG_CITY) continue;
    const ps = s.provinces[p];
    const pp = popOf(s, world, p);
    airPop += pp;
    if (ps.sick) airSick += ps.sick * pp * (f.get(ps.owner) ?? OPEN).travel * (ps.quarantine ? QUARANTINE_TRAVEL : 1);
  }
  const air = airPop ? airSick / airPop : 0;

  const before = new Map<NationId, boolean>();
  for (const ps of Object.values(s.provinces)) if (ps.sick) before.set(ps.owner, true);

  let rng = s.rng;
  const provinces = { ...s.provinces };
  const deaths = new Map<NationId, number>();
  for (const p of world.order) {
    const ps = s.provinces[p];
    if (!ps) continue;
    const own = f.get(ps.owner) ?? OPEN;
    const I = ps.sick ?? 0;
    let R = ps.immune ?? 0;
    // vaccination: a share of those still at risk every day
    if (own.cure && 1 - I - R > 0.02) R = Math.min(1 - I, R + own.vaccinate * (1 - I - R));
    const S = Math.max(0, 1 - I - R);
    if (!I) {
      if (R !== (ps.immune ?? 0)) provinces[p] = { ...ps, immune: round6(R) };
      if (S < 0.05) continue;
      let pressure = 0;
      for (const l of world.provinces[p].links) {
        const q = s.provinces[l.to];
        if (!q?.sick) continue;
        const fq = f.get(q.owner) ?? OPEN;
        let w = l.sea ? W_SEA : q.owner === ps.owner ? W_HOME : W_ABROAD;
        w *= Math.min(own.travel, fq.travel);
        if (q.owner !== ps.owner) {
          if (own.closed) w *= CLOSED * (guarded.has(`${ps.owner}|${p}`) ? GUARDED : 1);
          if (fq.closed) w *= 0.5;
        }
        if (q.quarantine || ps.quarantine) w *= QUARANTINE_TRAVEL;
        pressure += w * q.sick;
      }
      if (world.provinces[p].pop >= BIG_CITY) pressure += AIR * air * own.travel * (own.closed ? CLOSED * 0.5 : 1) * (ps.quarantine ? QUARANTINE_TRAVEL : 1);
      if (pressure <= 0) continue;
      const [v, next] = nextRandom(rng);
      rng = next;
      if (v < Math.min(0.5, pressure * SEED_K * S)) provinces[p] = { ...(provinces[p] ?? ps), sick: SEED };
      continue;
    }
    const beta = sev.beta * own.spread * (ps.quarantine ? QUARANTINE_SPREAD : 1);
    const caught = beta * S * I;
    const out = sev.gamma * I;
    const lethality = sev.lethality * (ps.build?.includes('hospital') ? HOSPITAL_DEATHS : 1) * (I >= OVERRUN ? 1.6 : 1) * (own.cure ? 0.5 : 1);
    const died = out * lethality;
    let nI = I + caught - out;
    const nR = Math.min(1, R + out - died);
    if (nI < EXTINCT) nI = 0;
    const pp = popOf(s, world, p);
    const dead = died * pp;
    const { sick: _, ...rest } = ps;
    provinces[p] = { ...rest, ...(nI ? { sick: round6(nI) } : {}), immune: round6(Math.min(1 - nI, nR)), ...(dead >= 1 ? { pop: Math.round(pp - dead) } : {}) };
    if (dead > 0) deaths.set(ps.owner, (deaths.get(ps.owner) ?? 0) + dead);
  }
  s = { ...s, provinces, rng };

  // per nation: the dead, the peak, overwhelmed hospitals, first cases
  const nations = { ...s.nations };
  const firsts: NationId[] = [];
  const collapsed: NationId[] = [];
  const fallen = new Set(d.fallen ?? []);
  for (const id of Object.keys(nations).sort()) {
    const n = nations[id];
    if (!n.alive) continue;
    const nh = nationHealth(s, world, id);
    const h: HealthState = { ...(n.health ?? {}) };
    if (deaths.has(id)) h.deaths = Math.round((h.deaths ?? 0) + deaths.get(id)!);
    if (nh.sickShare > (h.peak ?? 0)) h.peak = round6(nh.sickShare);
    h.overrun = nh.overrunShare >= COLLAPSE_SHARE ? (h.overrun ?? 0) + 1 : 0;
    if (h.overrun >= COLLAPSE_DAYS && !fallen.has(id)) { fallen.add(id); collapsed.push(id); }
    if (nh.infected && !before.get(id)) firsts.push(id);
    nations[id] = { ...n, health: h };
  }
  s = { ...s, nations, disease: { ...d, ...(fallen.size ? { fallen: [...fallen] } : {}) } };

  const humans = humansOf(s);
  const near = (n: NationId) => humans.some((h) => h === n || neighboursOf(s, world, h).includes(n));
  for (const n of firsts) {
    if (!isHuman(s, n) && !s.nations[n].major && !near(n)) continue;
    const where = world.order.find((p) => s.provinces[p].owner === n && s.provinces[p].sick);
    s = log(s, { kind: 'outbreak', text: `${d.name} reaches ${name(n)}${where ? `: first cases in ${place(where)}` : ''}.`, nations: [n], important: isHuman(s, n) });
  }
  for (const n of collapsed) {
    s = log(s, { kind: isHuman(s, n) ? 'defeat' : 'collapse', text: isHuman(s, n)
      ? `Defeat. ${s.nations[n].name}'s hospitals have been overwhelmed for ${COLLAPSE_DAYS} days: the health system has collapsed.`
      : `${s.nations[n].name}'s health system collapses under ${d.name}.`, nations: [n], important: true });
  }

  s = researchTick(s, world, log);
  if (day > 0 && day % 30 === 0) s = useSupplies(s, world, log);

  // the end of the pandemic
  if (!s.disease!.overAt && day > 30 && !Object.values(s.provinces).some((ps) => ps.sick)) {
    s = { ...s, disease: { ...s.disease!, overAt: s.clock.hours } };
    s = log(s, { kind: 'pandemic-over', text: `${d.name} is gone: not one person is sick anywhere in the world.`, important: true });
  }
  return checkSurvivors(s, world, log);
}

/** Day one: the news, and the world's blame for the nation where it started. */
function announce(state: GameState, world: World, log: Logger): GameState {
  const d = state.disease!;
  const origin = state.provinces[d.origin]?.owner;
  let s = log(state, { kind: 'outbreak', text: `A new disease, ${d.name} (${SEVERITY[d.severity].label.toLowerCase()}), has broken out in ${world.provinces[d.origin]?.name ?? d.origin}${origin ? `, ${state.nations[origin]?.name}` : ''}.`, nations: origin ? [origin] : [], important: true });
  if (!origin) return s;
  for (const n of Object.keys(s.nations).sort()) {
    if (n === origin || !s.nations[n].alive) continue;
    s = addRelation(s, n, origin, -8);
    s = addGrievance(s, n, origin, `${formatShortDate(s.clock)}: ${d.name} broke out in their country.`);
  }
  return s;
}

/** Research advances (pooled across pacts), trials use their materials, the cure is found and spreads. */
function researchTick(state: GameState, world: World, log: Logger): GameState {
  let s = state;
  const d = s.disease!;
  const ids = Object.keys(s.nations).filter((n) => s.nations[n].alive).sort();
  const own = new Map(ids.map((n) => [n, researchRate(s, world, n)]));
  const gains = new Map(ids.map((n) => [n, own.get(n)! + pactPartners(s, n).reduce((x, p) => x + (own.get(p) ?? 0), 0)]));
  for (const n of ids) {
    const nation = s.nations[n];
    const h: HealthState = { ...(nation.health ?? {}) };
    if (h.cure) continue;
    // pact partners share their results: trials passed, and the cure itself
    const partners = pactPartners(s, n);
    const shared = partners.find((p) => s.nations[p].health?.cure);
    if (shared) {
      h.cure = true;
      h.research = CURE;
      s = { ...s, nations: { ...s.nations, [n]: { ...nation, health: h } } };
      if (isHuman(s, n)) s = log(s, { kind: 'cure', text: `${s.nations[shared].shortName} shares the cure for ${d.name} with its research partners. Vaccination begins.`, nations: [n], important: true });
      continue;
    }
    const passed = Math.max(h.trials ?? 0, ...partners.map((p) => s.nations[p].health?.trials ?? 0));
    if (passed > (h.trials ?? 0)) h.trials = passed;
    let research = (h.research ?? 0) + gains.get(n)!;
    let stock = nation.stock;
    const trial = TRIALS[h.trials ?? 0];
    if (trial && research >= trial.at) {
      const have = Object.entries(trial.needs).every(([r, q]) => (stock?.[r] ?? 0) >= q);
      if (have) {
        stock = { ...stock };
        for (const [r, q] of Object.entries(trial.needs)) stock[r] = Math.round(((stock[r] ?? 0) - q) * 10) / 10;
        h.trials = (h.trials ?? 0) + 1;
        if (isHuman(s, n)) s = log(s, { kind: 'research', text: `${trial.name} begin: the cure for ${d.name} is ${trial.at}% of the way.`, nations: [n] });
      } else {
        if ((h.research ?? 0) < trial.at && isHuman(s, n)) {
          const need = Object.entries(trial.needs).map(([r, q]) => `${q} ${r === 'compounds' ? 'rare plant compounds' : r === 'reagents' ? 'lab reagents' : r === 'medicine' ? 'medicines' : r}`).join(' and ');
          s = log(s, { kind: 'research', text: `Research is waiting for ${trial.name.toLowerCase()}: they need ${need}.`, nations: [n], important: true });
        }
        research = trial.at;
      }
    }
    h.research = Math.round(Math.min(CURE, research) * 1000) / 1000;
    if (h.research >= CURE) {
      h.cure = true;
      const first = !s.disease!.curedAt;
      if (first) s = { ...s, disease: { ...s.disease!, curedAt: s.clock.hours } };
      s = log(s, { kind: 'cure', text: first ? `${s.nations[n].name} has found a cure for ${d.name}! Vaccination begins.` : `${s.nations[n].shortName} has its own cure for ${d.name}.`, nations: [n], important: first || isHuman(s, n) });
    }
    s = { ...s, nations: { ...s.nations, [n]: { ...s.nations[n], health: h, ...(stock !== nation.stock ? { stock } : {}) } } };
  }
  // generic versions: in time, the cure reaches everyone
  const cured = s.disease!.curedAt;
  if (cured !== undefined && s.clock.hours - cured === GENERIC_DAYS * 24) {
    const nations = { ...s.nations };
    for (const n of ids) if (!nations[n].health?.cure) nations[n] = { ...nations[n], health: { ...nations[n].health, cure: true } };
    s = log({ ...s, nations }, { kind: 'cure', text: `Cheap generic versions of the cure for ${d.name} reach every nation.`, important: true });
  }
  return s;
}

/** Once a month: the food a lockdown needs, masks, vaccines and lab reagents come out of stock. */
function useSupplies(state: GameState, world: World, log: Logger): GameState {
  let s = state;
  const short: [NationId, string[]][] = [];
  const nations = { ...s.nations };
  for (const n of Object.keys(nations).sort()) {
    const nation = nations[n];
    if (!nation.alive) continue;
    const use = healthUse(s, world, n);
    if (!Object.keys(use).length) continue;
    const stock = { ...(nation.stock ?? {}) };
    const out: string[] = [];
    for (const [r, q] of Object.entries(use)) {
      if ((stock[r] ?? 0) < q) out.push(r);
      stock[r] = Math.max(0, Math.round(((stock[r] ?? 0) - q) * 10) / 10);
    }
    nations[n] = { ...nation, stock };
    if (out.length && isHuman(s, n)) short.push([n, out]);
  }
  s = { ...s, nations };
  const what: Record<string, string> = { food: 'food (a lockdown without it breaks down)', gear: 'protective gear (masks slow the spread)', medicine: 'medicines (vaccination slows to a crawl)', reagents: 'lab reagents (labs work at 40%)' };
  for (const [n, out] of short) s = log(s, { kind: 'economy', text: `${s.nations[n].shortName} is running out of ${out.map((r) => what[r] ?? r).join(', ')}.`, nations: [n], important: true });
  return s;
}

/** A player comes through when the outbreak is over at home and most people are immune, or it ends everywhere. */
function checkSurvivors(state: GameState, world: World, log: Logger): GameState {
  let s = state;
  const d = s.disease!;
  for (const p of [...humansOf(s)].sort()) {
    if (s.winner || !s.nations[p]?.alive || d.fallen?.includes(p)) continue;
    const nh = nationHealth(s, world, p);
    const immune = healthOf(s, p).cure && nh.immuneShare >= WIN_IMMUNE && nh.sickShare < 0.002;
    if (!immune && !d.overAt) continue;
    s = { ...s, winner: p };
    s = log(s, { kind: 'victory', text: `Victory! ${s.nations[p].name} has come through ${d.name}. ${formatPop(healthOf(s, p).deaths ?? 0)} of its people died.`, nations: [p], important: true });
  }
  return s;
}

// ---- actions ------------------------------------------------------------------------------------

export interface HealthOrders { lockdown?: number; borders?: boolean; funding?: number }

export function healthError(s: GameState, n: NationId, o: HealthOrders): string | null {
  if (!s.disease) return 'There is no pandemic in this era';
  if (!s.nations[n]?.alive) return 'Unknown nation';
  if (o.lockdown !== undefined && ![0, 1, 2].includes(o.lockdown)) return 'Unknown lockdown level';
  if (o.funding !== undefined && ![0, 1, 2].includes(o.funding)) return 'Unknown funding level';
  if (o.borders !== undefined && typeof o.borders !== 'boolean') return 'Open or closed?';
  return null;
}

/** Nations that share a land border or a sea lane with `n`. */
export function neighboursOf(s: GameState, world: World, n: NationId): NationId[] {
  return [...(healthIndex(s, world).neighbours.get(n) ?? [])].filter((o) => s.nations[o]?.alive).sort();
}

export function applyHealth(state: GameState, world: World, n: NationId, o: HealthOrders): GameState {
  const h = healthOf(state, n);
  let s: GameState = {
    ...state,
    nations: { ...state.nations, [n]: { ...state.nations[n], health: {
      ...h,
      ...(o.lockdown !== undefined ? { lockdown: o.lockdown as 0 | 1 | 2 } : {}),
      ...(o.borders !== undefined ? { borders: o.borders } : {}),
      ...(o.funding !== undefined ? { funding: o.funding as 0 | 1 | 2 } : {}),
    } } },
  };
  if (o.borders !== undefined && o.borders !== !!h.borders) {
    // neighbours resent a closed border (and are glad to see it open)
    const near = neighboursOf(s, world, n);
    for (const x of near) s = addRelation(s, n, x, o.borders ? -6 : 3);
    const watchers = near.filter((x) => isHuman(s, x));
    if (isHuman(s, n) || watchers.length) {
      s = logEvent(s, 'borders', `${s.nations[n].shortName} ${o.borders ? 'closes' : 'reopens'} its borders.`, { nations: [n, ...watchers], important: watchers.length > 0 });
    }
  }
  return s;
}

export function quarantineError(s: GameState, n: NationId, p: ProvinceId): string | null {
  if (!s.disease) return 'There is no pandemic in this era';
  if (s.provinces[p]?.owner !== n) return 'You can only quarantine your own provinces';
  return null;
}

export function applyQuarantine(s: GameState, p: ProvinceId, on: boolean): GameState {
  const { quarantine: _, ...rest } = s.provinces[p];
  return { ...s, provinces: { ...s.provinces, [p]: on ? { ...rest, quarantine: true } : rest } };
}

export const MAX_AID = 50;

/** Gifts of money or supplies to another nation. */
export function aidError(s: GameState, world: World, n: NationId, to: NationId, what: string, amount: number): string | null {
  if (!s.disease) return 'There is no pandemic in this era';
  if (!s.nations[n]?.alive || !s.nations[to]?.alive || n === to) return 'Unknown nation';
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_AID) return `Send between 1 and ${MAX_AID}`;
  if (what === 'money') return (s.nations[n].treasury ?? 0) >= amount ? null : `The treasury holds only ${Math.floor(s.nations[n].treasury ?? 0)}`;
  if (!world.resources[what]) return 'Unknown supplies';
  return (s.nations[n].stock?.[what] ?? 0) >= amount ? null : `You have only ${Math.floor(s.nations[n].stock?.[what] ?? 0)}`;
}

export function applyAid(state: GameState, world: World, n: NationId, to: NationId, what: string, amount: number): GameState {
  const a = state.nations[n], b = state.nations[to];
  const value = what === 'money' ? amount : amount * (world.resources[what]?.price ?? 1);
  // thanks are bigger when they are in trouble
  const need = nationHealth(state, world, to).sickShare >= 0.02 ? 1.5 : 1;
  const nations = what === 'money'
    ? { ...state.nations, [n]: { ...a, treasury: Math.round(((a.treasury ?? 0) - amount) * 10) / 10 }, [to]: { ...b, treasury: Math.round(((b.treasury ?? 0) + amount) * 10) / 10 } }
    : { ...state.nations, [n]: { ...a, stock: { ...a.stock, [what]: (a.stock?.[what] ?? 0) - amount } }, [to]: { ...b, stock: { ...b.stock, [what]: (b.stock?.[what] ?? 0) + amount } } };
  let s = addRelation({ ...state, nations }, n, to, Math.max(2, Math.min(15, Math.round((value / 4) * need))));
  const label = what === 'money' ? `${amount} in money` : `${amount} ${world.resources[what]?.name.toLowerCase() ?? what}`;
  if (isHuman(s, n) || isHuman(s, to)) s = logEvent(s, 'aid', `${s.nations[n].shortName} sends ${label} to ${s.nations[to].shortName}.`, { nations: [n, to], important: isHuman(s, to) });
  return s;
}

export function shareCureError(s: GameState, n: NationId, to: NationId): string | null {
  if (!s.disease) return 'There is no pandemic in this era';
  if (!s.nations[n]?.alive || !s.nations[to]?.alive || n === to) return 'Unknown nation';
  if (!healthOf(s, n).cure) return 'You do not have the cure yet';
  if (healthOf(s, to).cure) return `${s.nations[to].shortName} already has it`;
  return null;
}

export function applyShareCure(state: GameState, n: NationId, to: NationId): GameState {
  let s: GameState = { ...state, nations: { ...state.nations, [to]: { ...state.nations[to], health: { ...healthOf(state, to), cure: true } } } };
  s = addRelation(s, n, to, 25);
  return logEvent(s, 'cure', `${s.nations[n].shortName} shares the cure for ${s.disease!.name} with ${s.nations[to].shortName}.`, { nations: [n, to], important: isHuman(s, n) || isHuman(s, to) });
}

// ---- display helpers ----------------------------------------------------------------------------

export function formatShare(v: number): string {
  if (v <= 0) return '0%';
  if (v < 0.001) return '<0.1%';
  return `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
}

/** Colour of a province by its outbreak: healthy grey-green, then yellow, orange, red; blue when immune. */
export function sickColor(sick: number | null, immune: number): string {
  if (sick === null || sick <= 0) return immune >= 0.5 ? '#5f8fbf' : immune >= 0.15 ? '#8aa6a0' : '#9aa596';
  if (sick < 0.002) return '#e0cf6a';
  if (sick < 0.02) return '#e0a040';
  if (sick < OVERRUN) return '#d9632f';
  return '#b3241c';
}

