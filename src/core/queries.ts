import { relationKey, type GameState, type NationId, type ProvinceId } from './types';

/** Read-only helpers over GameState. No imports from rule modules, so anything can use them. */

export const getRelation = (s: GameState, a: NationId, b: NationId) => s.relations[relationKey(a, b)] ?? 0;

export const provincesOf = (s: GameState, nation: NationId): ProvinceId[] =>
  Object.keys(s.provinces).filter((id) => s.provinces[id].owner === nation);

export const atWar = (s: GameState, a: NationId, b: NationId) =>
  a !== b &&
  s.wars.some((w) => (w.attackers.includes(a) && w.defenders.includes(b)) || (w.attackers.includes(b) && w.defenders.includes(a)));

export const allied = (s: GameState, a: NationId, b: NationId) =>
  s.treaties.some((t) => t.type === 'alliance' && t.parties.includes(a) && t.parties.includes(b));

export const cobelligerents = (s: GameState, a: NationId, b: NationId) =>
  s.wars.some((w) => (w.attackers.includes(a) && w.attackers.includes(b)) || (w.defenders.includes(a) && w.defenders.includes(b)));

/** Same nation, allied, or fighting on the same side. Friendly armies may pass and stack. */
export const friendly = (s: GameState, a: NationId, b: NationId) => a === b || allied(s, a, b) || cobelligerents(s, a, b);

export const enemiesOf = (s: GameState, nation: NationId): NationId[] =>
  Object.keys(s.nations).filter((n) => s.nations[n].alive && atWar(s, nation, n));

export const armiesIn = (s: GameState, province: ProvinceId) =>
  Object.values(s.armies).filter((a) => a.location === province && a.progress === 0);
