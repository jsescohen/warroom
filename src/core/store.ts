import { reduce, validate, type Action, type Actor, type Command } from './actions';
import type { GameState, NationId } from './types';
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

  /** Spectating: only the simulation itself may act (time runs, nobody gives orders). */
  readOnly = false;

  /**
   * Multiplayer: orders go to the server instead of being applied here; they come back in the
   * shared stream (applyRemote) in the same order for every player.
   */
  remote: ((cmd: Command) => void) | null = null;
  /**
   * Multiplayer: the nation this browser plays. The shared game has no single player; the UI is
   * shown a view of it as if this nation were the player.
   */
  viewAs: NationId | null = null;
  private views = new WeakMap<GameState, GameState>();

  constructor(private _state: GameState, readonly world: World) {}

  /** The game as this player sees it (in multiplayer: with themselves as the player). */
  get state(): GameState {
    return this.view(this._state);
  }

  /** The shared game itself (multiplayer: what is hashed and sent as snapshots). */
  get shared(): GameState {
    return this._state;
  }

  private view(s: GameState): GameState {
    if (!this.viewAs) return s;
    let v = this.views.get(s);
    if (!v) { v = { ...s, playerNation: this.viewAs }; this.views.set(s, v); }
    return v;
  }

  setViewAs(nation: NationId | null) {
    if (nation === this.viewAs) return;
    const prev = this.state;
    this.viewAs = nation;
    this.views = new WeakMap();
    this.listeners.forEach((l) => l(this.state, prev, null));
  }

  dispatch(action: Action, actor: Actor): { ok: true } | { ok: false; error: string } {
    const cmd: Command = { action, actor };
    if (this.readOnly && actor !== 'system') return { ok: false, error: 'You are spectating: this game is read-only.' };
    if (this.remote) {
      // the clock belongs to the server; orders are checked here and applied when they come back
      if (actor === 'system') return { ok: false, error: 'The server keeps the time in online games.' };
      const error = validate(this.state, cmd, this.world);
      if (error) return { ok: false, error };
      this.remote(cmd);
      return { ok: true };
    }
    const error = validate(this._state, cmd, this.world);
    if (error) return { ok: false, error };
    const prev = this._state;
    this._state = reduce(prev, cmd, this.world);
    if (this._state !== prev && !this.batchDepth) this.emit(prev, cmd);
    return { ok: true };
  }

  /** Online orders sent and not yet back from the server, by their JSON. */
  private inFlight = new Map<string, ((r: { ok: true } | { ok: false; error: string }) => void)[]>();

  /**
   * Like dispatch, but resolves once the order has really been applied: at once offline; online,
   * when it comes back in the shared stream (code that reads the result needs to wait for it).
   */
  dispatchSync(action: Action, actor: Actor): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!this.remote) return Promise.resolve(this.dispatch(action, actor));
    const key = JSON.stringify({ actor, action });
    return new Promise((resolve) => {
      const list = this.inFlight.get(key) ?? [];
      let done = false;
      const finish = (r: { ok: true } | { ok: false; error: string }) => { if (!done) { done = true; resolve(r); } };
      list.push(finish);
      this.inFlight.set(key, list);
      const r = this.dispatch(action, actor);
      if (!r.ok) { this.inFlight.delete(key); return finish(r); }
      setTimeout(() => finish({ ok: false, error: 'The server did not answer in time.' }), 10_000);
    });
  }

  /** Multiplayer: applies the next command of the shared stream (invalid ones change nothing, for everyone). */
  applyRemote(cmd: Command) {
    const key = this.inFlight.size ? JSON.stringify({ actor: cmd.actor, action: cmd.action }) : '';
    const waiter = key ? this.inFlight.get(key)?.shift() : undefined;
    if (key && !this.inFlight.get(key)?.length) this.inFlight.delete(key);
    const error = validate(this._state, cmd, this.world);
    if (error) { waiter?.({ ok: false, error }); return; }
    const prev = this._state;
    this._state = reduce(prev, cmd, this.world);
    if (this._state !== prev && !this.batchDepth) this.emit(prev, cmd);
    waiter?.({ ok: true });
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
    const s = this.view(this._state), p = this.view(prev);
    this.listeners.forEach((l) => l(s, p, cmd));
  }
}
