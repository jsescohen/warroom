import { reduce, validate, type Action, type Actor, type Command } from './actions';
import type { GameState } from './types';
import type { World } from './world';

export type Listener = (state: GameState, prev: GameState, cmd: Command | null) => void;

/**
 * Holds the single source of truth and is the only place commands are applied.
 * For multiplayer, a networked store would forward commands to the server here and apply
 * the authoritative results instead of reducing locally.
 */
export class GameStore {
  private listeners = new Set<Listener>();
  private batchDepth = 0;
  private batchStart: GameState | null = null;

  constructor(private _state: GameState, readonly world: World) {}

  get state(): GameState {
    return this._state;
  }

  dispatch(action: Action, actor: Actor): { ok: true } | { ok: false; error: string } {
    const cmd: Command = { action, actor };
    const error = validate(this._state, cmd, this.world);
    if (error) return { ok: false, error };
    const prev = this._state;
    this._state = reduce(prev, cmd, this.world);
    if (this._state !== prev && !this.batchDepth) this.emit(prev, cmd);
    return { ok: true };
  }

  /** Runs several dispatches and notifies listeners once at the end (e.g. Skip). */
  batch<T>(fn: () => T): T {
    if (this.batchDepth++ === 0) this.batchStart = this._state;
    try {
      return fn();
    } finally {
      if (--this.batchDepth === 0) {
        const prev = this.batchStart!;
        this.batchStart = null;
        if (prev !== this._state) this.emit(prev, null);
      }
    }
  }

  /** Replace the whole state (loading a save, receiving a server snapshot). */
  replace(state: GameState) {
    const prev = this._state;
    this._state = state;
    this.emit(prev, null);
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit(prev: GameState, cmd: Command | null) {
    this.listeners.forEach((l) => l(this._state, prev, cmd));
  }
}
