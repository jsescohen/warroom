import { provincesOf } from './queries';
import { isHuman, type GameState, type NationId } from './types';

/**
 * A weekly record of every great power's (and the player's) territory and military strength, for
 * the ledger's graphs and the end-of-game summary. Kept short: when it grows long, every other
 * sample is dropped, so a decade-long game still fits in a save.
 */
export interface History {
  /** Clock hours of each sample. */
  t: number[];
  /** Per nation: provinces held (p) and total army + fleet strength (a), one value per sample. */
  nations: Record<NationId, { p: number[]; a: number[] }>;
}

export const HISTORY_EVERY_HOURS = 24 * 7;
const MAX_SAMPLES = 160;

export function recordHistory(s: GameState): GameState {
  const prev = s.history ?? { t: [], nations: {} };
  const tracked = new Set(Object.keys(prev.nations));
  for (const n of Object.values(s.nations)) if (n.alive && (n.major || isHuman(s, n.id))) tracked.add(n.id);
  const strength = new Map<NationId, number>();
  for (const a of Object.values(s.armies)) strength.set(a.owner, (strength.get(a.owner) ?? 0) + a.strength);
  const len = prev.t.length;
  const nations: History['nations'] = {};
  for (const id of [...tracked].sort()) {
    const old = prev.nations[id] ?? { p: new Array(len).fill(0), a: new Array(len).fill(0) };
    const alive = s.nations[id]?.alive;
    nations[id] = {
      p: [...old.p, alive ? provincesOf(s, id).length : 0],
      a: [...old.a, alive ? Math.round(strength.get(id) ?? 0) : 0],
    };
  }
  let history: History = { t: [...prev.t, s.clock.hours], nations };
  if (history.t.length > MAX_SAMPLES) {
    const keep = (_: number, i: number) => i % 2 === 0 || i === history.t.length - 1;
    history = {
      t: history.t.filter(keep),
      nations: Object.fromEntries(Object.entries(history.nations).map(([id, v]) => [id, { p: v.p.filter(keep), a: v.a.filter(keep) }])),
    };
  }
  return { ...s, history };
}
