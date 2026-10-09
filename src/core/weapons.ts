import { addGrievance, addRelation } from './events';
import { applyCivilianLosses, basePop } from './population';
import { atWar } from './queries';
import { nextRandom } from './rng';
import { hoursUntil, formatShortDate } from './time';
import { isHuman, type GameEvent, type GameState, type NationId, type ProvinceId } from './types';
import type { WeaponDef, World } from './world';

/**
 * Missiles and nuclear weapons: built with money and materials into a nation's arsenal, then
 * launched at a province within range. Air defence (a building) may shoot them down. A nuclear
 * strike destroys every army in the province, kills most of its people, poisons it for a year,
 * and turns the whole world against whoever used it. All pure.
 */

export type WeaponKind = 'missile' | 'nuke';
type Logger = (s: GameState, ev: Omit<GameEvent, 'id' | 'at'>) => GameState;

export const MAX_ARSENAL: Record<WeaponKind, number> = { missile: 20, nuke: 5 };
/** Days between two nuclear weapons built by the same nation. */
export const NUKE_BUILD_DAYS = 60;
/** How long a nuclear strike poisons a province. */
const FALLOUT_DAYS = 365;

export const weaponDef = (world: World, w: WeaponKind): WeaponDef | null => (w === 'missile' ? world.weapons?.missile : world.weapons?.nuke) ?? null;

/** The weapon exists in this era and its date has come. */
export function weaponAvailable(s: GameState, world: World, w: WeaponKind): boolean {
  const def = weaponDef(world, w);
  if (!def) return false;
  return !def.from || s.clock.hours >= hoursUntil(s.clock.startDate, def.from);
}

export function armError(s: GameState, world: World, n: NationId, w: WeaponKind): string | null {
  const nation = s.nations[n];
  const def = weaponDef(world, w);
  if (!nation?.alive) return 'Unknown nation';
  if (!def) return 'Not in this era';
  if (!weaponAvailable(s, world, w)) return `Not before ${def.from}`;
  if ((nation.arsenal?.[w] ?? 0) >= MAX_ARSENAL[w]) return `The arsenal holds ${MAX_ARSENAL[w]} at most`;
  if (w === 'nuke' && nation.nukeBuiltAt !== undefined && s.clock.hours - nation.nukeBuiltAt < NUKE_BUILD_DAYS * 24)
    return `The next warhead is ready in ${Math.ceil((nation.nukeBuiltAt + NUKE_BUILD_DAYS * 24 - s.clock.hours) / 24)} days`;
  if ((nation.treasury ?? 0) < def.cost) return `Costs ${def.cost}: the treasury holds ${Math.floor(nation.treasury ?? 0)}`;
  const stock = nation.stock ?? {};
  const short = Object.entries(def.materials).filter(([r, q]) => (stock[r] ?? 0) < q);
  if (short.length) return `Needs ${short.map(([r, q]) => `${q} ${world.resources[r]?.name.toLowerCase() ?? r} (you have ${Math.floor(stock[r] ?? 0)})`).join(' and ')}`;
  return null;
}

export function applyArm(s: GameState, world: World, n: NationId, w: WeaponKind): GameState {
  const def = weaponDef(world, w)!;
  const nation = s.nations[n];
  const stock = { ...(nation.stock ?? {}) };
  for (const [r, q] of Object.entries(def.materials)) stock[r] = (stock[r] ?? 0) - q;
  return {
    ...s,
    nations: {
      ...s.nations,
      [n]: {
        ...nation, stock, treasury: (nation.treasury ?? 0) - def.cost,
        arsenal: { ...nation.arsenal, [w]: (nation.arsenal?.[w] ?? 0) + 1 },
        ...(w === 'nuke' ? { nukeBuiltAt: s.clock.hours } : {}),
      },
    },
  };
}

const dist = (world: World, a: ProvinceId, b: ProvinceId) => {
  const p = world.provinces[a]?.label, q = world.provinces[b]?.label;
  return p && q ? Math.hypot(p[0] - q[0], p[1] - q[1]) : Infinity;
};

/** Distance from the nearest province the nation holds. */
export function launchDistance(s: GameState, world: World, n: NationId, target: ProvinceId): number {
  let best = Infinity;
  for (const [p, ps] of Object.entries(s.provinces)) if (ps.owner === n) best = Math.min(best, dist(world, p, target));
  return best;
}

export function launchError(s: GameState, world: World, n: NationId, w: WeaponKind, target: ProvinceId): string | null {
  const nation = s.nations[n];
  const def = weaponDef(world, w);
  const ps = s.provinces[target];
  if (!nation?.alive || !def) return 'Not in this era';
  if (!ps) return 'Unknown province';
  if (!(nation.arsenal?.[w] ?? 0)) return `No ${def.name.toLowerCase()} in the arsenal: build one first (Treasury)`;
  const enemyThere = Object.values(s.armies).some((a) => a.location === target && atWar(s, n, a.owner));
  if (ps.owner === n && !enemyThere) return 'That is your own province';
  if (!atWar(s, n, ps.owner) && !enemyThere) return `You are not at war with ${s.nations[ps.owner]?.shortName ?? 'them'}`;
  if (launchDistance(s, world, n, target) > def.range) return 'Out of range';
  return null;
}

/** Air defence covering a province: the best one of its owner (or the owner's allies) within reach. */
export function airDefenseAt(s: GameState, world: World, target: ProvinceId, against: NationId): boolean {
  const ad = world.weapons?.airDefense;
  if (!ad) return false;
  for (const [p, ps] of Object.entries(s.provinces)) {
    if (!ps.build?.includes('airdefense') || !atWar(s, ps.owner, against)) continue;
    if (dist(world, p, target) <= ad.radius) return true;
  }
  return false;
}

export function applyLaunch(state: GameState, world: World, n: NationId, w: WeaponKind, target: ProvinceId, log: Logger): GameState {
  const def = weaponDef(world, w)!;
  const ad = world.weapons!.airDefense;
  const nation = state.nations[n];
  let s: GameState = { ...state, nations: { ...state.nations, [n]: { ...nation, arsenal: { ...nation.arsenal, [w]: (nation.arsenal?.[w] ?? 0) - 1 } } } };
  const owner = s.provinces[target].owner;
  const where = world.provinces[target]?.name ?? target;
  const who = s.nations[n].shortName;
  const [r1, rng1] = nextRandom(s.rng);
  const [r2, rng2] = nextRandom(rng1);
  s = { ...s, rng: rng2 };
  const victims = [...new Set([owner, ...Object.values(s.armies).filter((a) => a.location === target).map((a) => a.owner)])].filter((x) => x !== n);
  const important = isHuman(s, n) || victims.some((v) => isHuman(s, v));

  // shot down?
  if (airDefenseAt(s, world, target, n) && r1 < (w === 'nuke' ? ad.nukeIntercept : ad.missileIntercept)) {
    return log(s, { kind: 'intercept', text: `${ad.name} over ${where} shoots down a ${def.name.toLowerCase()} from ${who}.`, nations: [n, owner], important });
  }

  if (w === 'missile') {
    const power = ((def as WeaponDef & { damage: number }).damage ?? 3) * (0.8 + r2 * 0.4);
    const units = Object.values(s.armies).filter((a) => a.location === target && atWar(s, n, a.owner));
    const garrison = atWar(s, n, owner) ? (s.provinces[target].garrison ?? Infinity) : 0;
    const g = Number.isFinite(garrison) ? garrison : 3;
    const pool = units.reduce((x, a) => x + a.strength, 0) + g;
    const armies = { ...s.armies };
    const lost: string[] = [];
    for (const a of units) {
      const left = a.strength - (power * a.strength) / Math.max(pool, 1);
      if (left < 0.5) { delete armies[a.id]; lost.push(a.name); } else armies[a.id] = { ...a, strength: left };
    }
    s = { ...s, armies };
    if (g > 0 && atWar(s, n, owner)) s = { ...s, provinces: { ...s.provinces, [target]: { ...s.provinces[target], garrison: Math.max(0, Math.round((g - (power * g) / Math.max(pool, 1)) * 100) / 100) } } };
    s = applyCivilianLosses(s, world, new Map([[target, 0.015]]));
    return log(s, { kind: 'strike', text: `${def.name} from ${who} hits ${where}: ${power.toFixed(1)} strength lost.${lost.length ? ` ${lost.join(', ')} destroyed.` : ''}`, nations: [n, ...victims], important });
  }

  // a nuclear strike
  const armies = { ...s.armies };
  for (const a of Object.values(armies)) {
    if (a.location === target) delete armies[a.id];
    else if (world.provinces[target]?.links.some((l) => l.to === a.location)) armies[a.id] = { ...a, strength: Math.max(0.5, a.strength - a.maxStrength * 0.3) };
  }
  s = { ...s, armies, provinces: { ...s.provinces, [target]: { ...s.provinces[target], garrison: 0, falloutUntil: s.clock.hours + FALLOUT_DAYS * 24 } } };
  // most of the people die (beyond the usual floor of war losses)
  const base = basePop(s, world, target);
  const before = s.provinces[target].pop ?? base;
  const after = Math.round(Math.min(before, base) * 0.3);
  const core = s.provinces[target].core ?? owner;
  s = {
    ...s,
    provinces: { ...s.provinces, [target]: { ...s.provinces[target], pop: after } },
    nations: { ...s.nations, [core]: { ...s.nations[core], civDeaths: Math.round((s.nations[core]?.civDeaths ?? 0) + (before - after)) } },
  };
  // the world turns on the user
  for (const x of Object.keys(s.nations).sort()) {
    if (x === n || !s.nations[x].alive) continue;
    s = addRelation(s, x, n, x === owner ? -100 : -35);
    if (x === owner || s.nations[x].major) s = addGrievance(s, x, n, `${formatShortDate(s.clock)}: used a nuclear weapon on ${where}.`);
  }
  return log(s, { kind: 'nuke', text: `☢ ${who} has used a nuclear weapon on ${where}. The world is horrified.`, nations: [n, ...victims], important: true });
}

