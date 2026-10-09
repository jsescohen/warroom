import type { Command } from '../core/actions';
import type { GameStore } from '../core/store';
import type { GameState } from '../core/types';
import type { GameLoop, Speed } from '../game/loop';
import { HASH_EVERY, stateHash, type RoomInfo } from '../../shared/multiplayer/protocol';
import type { MpClient } from './mpClient';

/** What the HUD shows and offers in an online game. */
export interface OnlineHud {
  label(): string;
  canPause(): boolean;
  paused(): boolean;
  togglePause(): void;
  onChange(fn: () => void): () => void;
  /** Choose this player's nation (once, on the map). */
  pick(nation: string): void;
  /** Nations other players lead, with their names. */
  taken(): Map<string, string>;
}

/**
 * Runs a game online: the store sends orders to the server and applies the shared stream; the
 * loop shows the room's pace (the server keeps the time). Answers the server's snapshot requests
 * and sends a fingerprint of the game every HASH_EVERY ticks so drifted copies get repaired.
 */
export function attachOnline(store: GameStore, loop: GameLoop, client: MpClient, notify: (text: string) => void): OnlineHud {
  loop.online = true;
  let seq = 0;
  const me = () => client.me()?.nation ?? null;
  const speedOf = (room: RoomInfo | null): Speed => (room?.status === 'running' ? room.speed : 0);
  const watching = store.readOnly;
  if (!watching) {
    store.setViewAs(me());
    store.remote = (cmd: Command) => client.send({ t: 'cmd', cmd: cmd as never });
  }
  loop.setOnlineSpeed(speedOf(client.room));

  const changed = new Set<() => void>();
  let wasPaused = client.room?.status === 'paused';
  client.on('room', (room) => {
    if (!room) return;
    if (!watching) store.setViewAs(me());
    const paused = room.status === 'paused';
    loop.setOnlineSpeed(speedOf(room), paused && !wasPaused ? 'The host paused the game.' : undefined);
    if (!paused && wasPaused) notify('The game continues.');
    wasPaused = paused;
    changed.forEach((f) => f());
  });
  client.on('status', (online) => {
    if (!online) notify('Connection lost: reconnecting…');
    changed.forEach((f) => f());
  });
  client.on('load', (s, state) => {
    seq = s;
    store.replace(state as GameState);
  });
  client.on('stream', (s, cmd) => {
    if (s <= seq) return; // already in the snapshot we loaded
    seq = s;
    store.applyRemote(cmd as unknown as Command);
    if (cmd.action.type === 'tick') {
      const c = store.shared.clock;
      if (!watching && Math.round(c.hours / c.tickHours) % HASH_EVERY === 0) client.send({ t: 'hash', seq, hash: stateHash(store.shared) });
    }
  });
  client.on('snapshotRequest', (req) => client.send({ t: 'snapshot', req, seq, state: store.shared }));
  client.on('error', (e) => notify(e));
  client.flushBacklog();

  return {
    label: () => {
      const room = client.room;
      if (!client.online) return 'Reconnecting…';
      if (!room) return 'Online';
      const on = room.players.filter((p) => p.connected).length;
      return `${watching ? 'Watching' : 'Online'} · ${on} player${on === 1 ? '' : 's'}${room.status === 'paused' ? ' · paused' : ` · ${room.speed}×`}`;
    },
    canPause: () => !watching && !!client.room && client.room.visibility === 'private' && client.me()?.host === true,
    paused: () => client.room?.status === 'paused',
    togglePause: () => client.pause(client.room?.status !== 'paused'),
    onChange: (fn) => { changed.add(fn); return () => changed.delete(fn); },
    pick: (nation) => client.pick(nation),
    taken: () => new Map((client.room?.players ?? []).filter((p) => p.nation && p.userId !== client.userId).map((p) => [p.nation!, p.username])),
  };
}
