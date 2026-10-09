import type { GameState, NationId, ProvinceId } from './types';
import type { World } from './world';

/**
 * Province populations. The map knows each province's main city; the people of a province are
 * that city plus its countryside, scaled to the era (the world of 1500 had a twentieth of today's
 * people). Wars kill civilians: a province's current population is kept in its state only while
 * it differs from the peacetime figure.
 */

/** Population multiplier for the year a scenario starts. */
export function eraScale(s: GameState): number {
  const y = parseInt(s.clock.startDate, 10);
  return y < -1000 ? 0.04 : y < 0 ? 0.08 : y < 600 ? 0.1 : y < 1700 ? 0.2 : y < 1920 ? 0.5 : y < 1960 ? 0.6 : 1.1;
}

/** Peacetime population of a province. */
export const basePop = (s: GameState, world: World, p: ProvinceId) =>
  Math.round(((world.provinces[p]?.pop ?? 0) * 1.4 + 40_000) * eraScale(s) * (1 + 0.25 * (s.provinces[p]?.level ?? 0)));

export const popOf = (s: GameState, world: World, p: ProvinceId) => s.provinces[p]?.pop ?? basePop(s, world, p);

/** Current population as a share of the peacetime one (0.5..1). */
export function popRatio(s: GameState, world: World, p: ProvinceId): number {
  const v = s.provinces[p]?.pop;
  return v === undefined ? 1 : Math.max(0, Math.min(1, v / Math.max(1, basePop(s, world, p))));
}

/** War never empties a province entirely: losses stop at half its people. */
export const POP_FLOOR = 0.5;

export function nationPop(s: GameState, world: World, n: NationId): number {
  let total = 0;
  for (const [p, ps] of Object.entries(s.provinces)) if (ps.owner === n) total += popOf(s, world, p);
  return total;
}

export function formatPop(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}k`;
  return `${Math.round(v)}`;
}

/**
 * Civilians killed by war: each province loses the given share of its current people (never below
 * POP_FLOOR of its peacetime number). The dead are counted against the nation the province
 * belongs to at heart (its core). Pure.
 */
export function applyCivilianLosses(s: GameState, world: World, losses: Map<ProvinceId, number>): GameState {
  if (!losses.size) return s;
  const provinces = { ...s.provinces };
  const dead = new Map<NationId, number>();
  for (const [p, frac] of losses) {
    const ps = provinces[p];
    if (!ps || frac <= 0) continue;
    const base = basePop(s, world, p);
    const now = ps.pop ?? base;
    const next = Math.max(base * POP_FLOOR, now * (1 - frac));
    if (next >= now) continue;
    provinces[p] = { ...ps, pop: Math.round(next) };
    const who = ps.core ?? ps.owner;
    dead.set(who, (dead.get(who) ?? 0) + (now - next));
  }
  if (!dead.size) return { ...s, provinces };
  const nations = { ...s.nations };
  for (const [n, d] of dead) if (nations[n]) nations[n] = { ...nations[n], civDeaths: Math.round((nations[n].civDeaths ?? 0) + d) };
  return { ...s, provinces, nations };
}
