import type { TimeConfig } from '../core/scenario';
import type { GameStore } from '../core/store';
import type { GameEvent, GameState } from '../core/types';

export type Speed = 0 | 1 | 2 | 4;
/** When the game pauses itself: never, on important events involving the player, or on any important event. */
export type AutoPause = 'off' | 'mine' | 'all';
export const SPEEDS: Speed[] = [1, 2, 4];

export interface SkipResult {
  turns: number;
  /** The important event that stopped the skip, if any. */
  event?: GameEvent;
}

/**
 * Drives the simulation in real time. Speed is session/UI state, not game state: the loop just
 * dispatches `tick` actions through the store, so a multiplayer server could own this instead.
 */
export class GameLoop {
  private _speed: Speed = 0;
  private lastSpeed: Speed = 1;
  private acc = 0;
  private last = 0;
  private raf = 0;
  private listeners = new Set<(speed: Speed, reason?: string) => void>();
  /** When to pause automatically on important events (a player setting). */
  autoPause: AutoPause = 'mine';

  constructor(private store: GameStore, private time: TimeConfig) {
    this.raf = requestAnimationFrame(this.frame);
  }

  get speed(): Speed {
    return this._speed;
  }

  /** Real seconds between ticks at 1x. */
  private get tickInterval() {
    return (this.time.secondsPerTurn * this.time.tickHours) / this.time.turnHours;
  }

  setSpeed(s: Speed, reason?: string) {
    if (s === this._speed) return;
    if (s > 0) this.lastSpeed = s;
    this._speed = s;
    this.acc = 0;
    this.listeners.forEach((l) => l(s, reason));
  }

  togglePause() {
    this.setSpeed(this._speed ? 0 : this.lastSpeed);
  }

  onSpeedChange(fn: (speed: Speed, reason?: string) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Fast-forwards to the next important event, at most `skipMaxTurns` turns. */
  skip(): SkipResult {
    const maxTicks = Math.round((this.time.skipMaxTurns * this.time.turnHours) / this.time.tickHours);
    const start = this.store.state.clock.hours;
    let event: GameEvent | undefined;
    this.store.batch(() => {
      for (let i = 0; i < maxTicks && !event; i++) {
        const before = this.store.state;
        this.store.dispatch({ type: 'tick' }, 'system');
        event = newImportant(before, this.store.state)[0];
      }
    });
    this.acc = 0;
    return { turns: (this.store.state.clock.hours - start) / this.time.turnHours, event };
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.listeners.clear();
  }

  private frame = (t: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.last ? Math.min((t - this.last) / 1000, 0.25) : 0;
    this.last = t;
    if (!this._speed) return;
    this.acc += dt * this._speed;
    const interval = this.tickInterval;
    if (this.acc < interval) return;

    const before = this.store.state;
    this.store.batch(() => {
      for (let n = 0; this.acc >= interval && n < 8; n++) {
        this.acc -= interval;
        this.store.dispatch({ type: 'tick' }, 'system');
      }
    });
    this.acc = Math.min(this.acc, interval);

    const player = this.store.state.playerNation;
    if (this.autoPause !== 'off' && player) {
      const mode = this.autoPause;
      const hit = newImportant(before, this.store.state).find((e) => mode === 'all' || e.nations?.includes(player));
      if (hit) this.setSpeed(0, hit.text);
    }
  };
}

/** Important events that appeared between two states. */
export function newImportant(prev: GameState, next: GameState): GameEvent[] {
  if (prev.events === next.events) return [];
  const lastId = prev.events.at(-1)?.id ?? -1;
  return next.events.filter((e) => e.id > lastId && e.important);
}
