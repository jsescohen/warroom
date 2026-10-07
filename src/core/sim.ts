import type { Command } from './actions';
import { aiTick } from './ai';
import { diplomacyTick } from './diplomacy';
import { militaryTick } from './military';
import type { GameEvent, GameState } from './types';
import type { World } from './world';

/** Applies a command if it is valid, otherwise returns the state unchanged. */
export type ApplyFn = (state: GameState, cmd: Command) => GameState;
export type LogFn = (state: GameState, ev: Omit<GameEvent, 'id' | 'at'>) => GameState;

/**
 * Advances the world by one tick (clock.tickHours). Pure: every client/server computes the same
 * result. Order: clock → scheduled history → nation AI orders → military (movement, battles,
 * captures) → diplomacy upkeep.
 */
export function simulateTick(state: GameState, world: World, apply: ApplyFn, log: LogFn): GameState {
  let s: GameState = { ...state, clock: { ...state.clock, hours: state.clock.hours + state.clock.tickHours } };
  s = fireScheduled(s, apply);
  s = aiTick(s, world, apply);
  s = militaryTick(s, world, log);
  s = diplomacyTick(s);
  return s;
}

function fireScheduled(state: GameState, apply: ApplyFn): GameState {
  const due = state.scheduled.filter((e) => e.at <= state.clock.hours);
  if (!due.length) return state;
  let s: GameState = { ...state, scheduled: state.scheduled.filter((e) => e.at > state.clock.hours) };
  for (const ev of due) {
    let applied = 0;
    for (const action of ev.actions) {
      const actor = action.type === 'declareWar' ? action.attacker : 'system';
      // Never act on the player's behalf: history only happens if the player lets it.
      if (actor === s.playerNation) continue;
      const next = apply(s, { action, actor });
      if (next !== s) applied++;
      s = next;
    }
    if (ev.text && (applied > 0 || ev.actions.length === 0)) {
      s = {
        ...s,
        events: [...s.events, { id: s.nextId, at: s.clock.hours, kind: 'history', text: ev.text, important: ev.important }],
        nextId: s.nextId + 1,
      };
    }
  }
  return s;
}
