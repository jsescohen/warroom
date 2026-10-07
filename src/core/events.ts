import { relationKey, type GameEvent, type GameState, type Memory, type NationId } from './types';

/** Shared low-level state helpers: event log, relations, leader memory. All pure. */

const MAX_EVENTS = 300;

export function logEvent(state: GameState, kind: string, text: string, opts: { nations?: NationId[]; important?: boolean } = {}): GameState {
  const ev: GameEvent = { id: state.nextId, at: state.clock.hours, kind, text, ...opts };
  const events = state.events.length >= MAX_EVENTS ? [...state.events.slice(-MAX_EVENTS + 1), ev] : [...state.events, ev];
  return { ...state, events, nextId: state.nextId + 1 };
}

export type LogFn = (state: GameState, ev: Omit<GameEvent, 'id' | 'at'>) => GameState;
export const log: LogFn = (s, ev) => logEvent(s, ev.kind, ev.text, { nations: ev.nations, important: ev.important });

// ---- relations ----------------------------------------------------------------------------------

export const getRel = (s: GameState, a: NationId, b: NationId) => s.relations[relationKey(a, b)] ?? 0;

export function setRelation(s: GameState, a: NationId, b: NationId, v: number): GameState {
  return { ...s, relations: { ...s.relations, [relationKey(a, b)]: Math.max(-100, Math.min(100, Math.round(v))) } };
}

export const addRelation = (s: GameState, a: NationId, b: NationId, delta: number) => setRelation(s, a, b, getRel(s, a, b) + delta);

// ---- memory -------------------------------------------------------------------------------------

const MAX_NOTES = 5;
const MAX_GRIEVANCES = 5;
const EMPTY: Memory = { notes: [], grievances: [] };

export const memoryOf = (s: GameState, holder: NationId, about: NationId): Memory => s.diplomacy.memories[holder]?.[about] ?? EMPTY;

function setMemory(s: GameState, holder: NationId, about: NationId, m: Memory): GameState {
  return {
    ...s,
    diplomacy: { ...s.diplomacy, memories: { ...s.diplomacy.memories, [holder]: { ...s.diplomacy.memories[holder], [about]: m } } },
  };
}

/** Something `holder` will hold against `about` (recorded by the game, not the AI). */
export function addGrievance(s: GameState, holder: NationId, about: NationId, text: string): GameState {
  const m = memoryOf(s, holder, about);
  return setMemory(s, holder, about, { ...m, grievances: [...m.grievances, text].slice(-MAX_GRIEVANCES) });
}

/** A note the AI leader chose to remember. */
export function addNote(s: GameState, holder: NationId, about: NationId, text: string): GameState {
  const note = text.trim().slice(0, 160);
  if (!note) return s;
  const m = memoryOf(s, holder, about);
  if (m.notes.includes(note)) return s;
  return setMemory(s, holder, about, { ...m, notes: [...m.notes, note].slice(-MAX_NOTES) });
}
