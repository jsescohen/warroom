/**
 * Multiplayer protocol (JSON over one WebSocket at /ws).
 *
 * The server never simulates: it keeps the clock and puts every order into one numbered stream
 * that all players receive in the same order. Each browser applies the stream to its own copy of
 * the game (the simulation is deterministic), so every copy stays the same. Now and then the
 * copies are compared by hash; a copy that drifted (floating-point differences between browsers)
 * is replaced by a snapshot from the room's host.
 */

export type Visibility = 'public' | 'private';
export type RoomStatus = 'lobby' | 'running' | 'paused';

export interface RoomSettings {
  name: string;
  scenarioId: string;
  visibility: Visibility;
  /** Human players allowed (unclaimed nations stay with the AI). */
  maxPlayers: number;
  /** Game speed: 1, 2 or 3 times the era's normal pace. */
  speed: 1 | 2 | 3;
  difficulty: 'easy' | 'normal' | 'hard';
  economy: 'simple' | 'detailed';
  capitalFalls: boolean;
}

export interface RoomPlayer {
  userId: string;
  username: string;
  nation: string | null;
  connected: boolean;
  host: boolean;
}

export interface RoomInfo extends RoomSettings {
  id: string;
  /** Six letters to join a private room. */
  code: string;
  status: RoomStatus;
  players: RoomPlayer[];
  createdAt: number;
}

/** One entry of the ordered stream: a game action from a nation, or the clock ('system'). */
export interface StreamCommand {
  actor: string;
  action: { type: string; [k: string]: unknown };
}

export type ClientMsg =
  | { t: 'auth'; token: string }
  | { t: 'list' }
  | { t: 'create'; settings: RoomSettings }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'pick'; nation: string | null }
  | { t: 'start' }
  | { t: 'pause'; paused: boolean }
  | { t: 'cmd'; cmd: StreamCommand }
  /** Answer to a snapshot request: the game as it stood after stream entry `seq`. */
  | { t: 'snapshot'; req: number; seq: number; state: unknown }
  /** Fingerprint of the game after stream entry `seq` (to catch copies that drifted apart). */
  | { t: 'hash'; seq: number; hash: string }
  /** Admin: every room (private ones too), and watching one read-only. */
  | { t: 'adminRooms' }
  | { t: 'watch'; roomId: string };

export type ServerMsg =
  | { t: 'hello'; userId: string; username: string }
  | { t: 'error'; error: string }
  | { t: 'rooms'; rooms: RoomInfo[] }
  | { t: 'room'; room: RoomInfo | null }
  /** The game begins: everyone builds the starting state themselves; the stream follows. */
  | { t: 'begin'; room: RoomInfo }
  /** Load this game state (joining a game in progress, or after drifting); the stream continues after `seq`. */
  | { t: 'load'; seq: number; state: unknown }
  /** The ordered stream: apply in order. */
  | { t: 's'; seq: number; cmd: StreamCommand }
  /** Please send a snapshot (you are the host). */
  | { t: 'snap?'; req: number };

/** Ticks between game fingerprints. */
export const HASH_EVERY = 40;
/** Most messages a player may send per second. */
export const MAX_MSGS_PER_SEC = 25;
export const MAX_PLAYERS = 16;

/** Fingerprint of a game state (FNV-1a over its JSON). */
export function stateHash(state: unknown): string {
  const s = JSON.stringify(state);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16) + ':' + s.length;
}
