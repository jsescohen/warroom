import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomSettings, ServerMsg } from '../../shared/multiplayer/protocol';
import type { SavedRoom } from './persist';
import { Room, Rooms, cleanSettings, type Conn } from './rooms';

const settings = (o: Partial<RoomSettings> = {}): RoomSettings => ({
  name: 'Test', scenarioId: 'ww2', visibility: 'public', maxPlayers: 4, speed: 1, difficulty: 'normal', economy: 'simple', capitalFalls: false, ...o,
});

function conn(userId: string, admin = false): Conn & { got: ServerMsg[]; last: (t: ServerMsg['t']) => ServerMsg | undefined } {
  const got: ServerMsg[] = [];
  return { userId, username: userId, admin, room: null, got, send: (m) => got.push(m), last: (t) => [...got].reverse().find((m) => m.t === t) };
}

afterEach(() => vi.useRealTimers());

describe('multiplayer rooms', () => {
  it('validates room settings', () => {
    expect(cleanSettings(settings())).not.toBeNull();
    expect(cleanSettings({ ...settings(), maxPlayers: 40 })).toBeNull();
    expect(cleanSettings({ ...settings(), speed: 4 as never })).toBeNull();
    expect(cleanSettings({ ...settings(), maxPlayers: 16 })).not.toBeNull();
  });

  it('creates, joins by code, picks nations, starts and streams in one order to everyone', () => {
    vi.useFakeTimers();
    const rooms = new Rooms(() => 0.75);
    const a = conn('alice'), b = conn('bob');
    rooms.handle(a, { t: 'create', settings: settings() });
    const room = a.room!;
    expect(room).toBeTruthy();
    rooms.handle(b, { t: 'join', code: room.code.toLowerCase() });
    expect(room.members.size).toBe(2);
    rooms.handle(a, { t: 'pick', nation: 'GER' });
    rooms.handle(b, { t: 'pick', nation: 'GER' });
    expect(b.last('error')).toMatchObject({ error: /Another player/ });
    rooms.handle(b, { t: 'pick', nation: 'FRA' });
    rooms.handle(b, { t: 'start' });
    expect(b.last('error')).toMatchObject({ error: /Only the host/ });
    rooms.handle(a, { t: 'start' });
    expect(a.last('begin')).toBeTruthy();
    // first the players, then the clock and orders, the same for both
    rooms.handle(b, { t: 'cmd', cmd: { actor: 'FRA', action: { type: 'stopArmy', army: 'a1' } } });
    vi.advanceTimersByTime(800);
    const streamOf = (c: ReturnType<typeof conn>) => c.got.filter((m) => m.t === 's').map((m) => (m as { seq: number; cmd: { action: { type: string } } }).cmd.action.type);
    expect(streamOf(a)).toEqual(['setPlayers', 'stopArmy', 'tick']);
    expect(streamOf(b)).toEqual(streamOf(a));
    // nobody commands someone else's nation, and the clock is the server's
    rooms.handle(b, { t: 'cmd', cmd: { actor: 'GER', action: { type: 'stopArmy', army: 'a1' } } });
    expect(b.last('error')).toMatchObject({ error: /own nation/ });
    rooms.handle(b, { t: 'cmd', cmd: { actor: 'FRA', action: { type: 'tick' } } });
    expect(b.last('error')).toMatchObject({ error: /Not allowed/ });
    // an AI leader may answer through the player talking to it
    rooms.handle(b, { t: 'cmd', cmd: { actor: 'ITA', action: { type: 'chat', with: 'FRA', text: 'Ciao' } } });
    expect(streamOf(a).at(-1)).toBe('chat');
    room.dispose();
    rooms.dispose();
  });

  it('a player joining mid-game gets the host’s snapshot and the stream after it', () => {
    vi.useFakeTimers();
    const rooms = new Rooms(() => 0.75);
    const a = conn('alice'), c = conn('carol');
    rooms.handle(a, { t: 'create', settings: settings() });
    rooms.handle(a, { t: 'pick', nation: 'GER' });
    rooms.handle(a, { t: 'start' });
    vi.advanceTimersByTime(800 * 3);
    const room = a.room!;
    rooms.handle(c, { t: 'join', code: room.code });
    const ask = a.last('snap?') as { req: number };
    expect(ask).toBeTruthy();
    rooms.handle(a, { t: 'snapshot', req: ask.req, seq: 2, state: { fake: true } });
    expect(c.last('load')).toMatchObject({ seq: 2, state: { fake: true } });
    const after = c.got.filter((m) => m.t === 's').map((m) => (m as { seq: number }).seq);
    expect(after[0]).toBe(3);
    // a copy that drifted is replaced from the host
    rooms.handle(c, { t: 'pick', nation: 'POL' });
    rooms.handle(a, { t: 'hash', seq: 10, hash: 'aaa' });
    rooms.handle(c, { t: 'hash', seq: 10, hash: 'bbb' });
    expect(a.got.filter((m) => m.t === 'snap?').length).toBe(2);
    room.dispose();
    rooms.dispose();
  });

  it('private rooms stay off the public list; admins see every room and can watch', () => {
    const rooms = new Rooms(() => 0.75);
    const a = conn('alice'), admin = conn('boss', true), d = conn('dave');
    rooms.handle(a, { t: 'create', settings: settings({ visibility: 'private' }) });
    rooms.handle(d, { t: 'list' });
    expect((d.last('rooms') as { rooms: unknown[] }).rooms).toHaveLength(0);
    rooms.handle(d, { t: 'adminRooms' });
    expect(d.last('error')).toMatchObject({ error: /Admins only/ });
    rooms.handle(admin, { t: 'adminRooms' });
    expect((admin.last('rooms') as { rooms: unknown[] }).rooms).toHaveLength(1);
    rooms.handle(admin, { t: 'watch', roomId: a.room!.id });
    expect(admin.room).toBe(a.room);
    expect(a.room!.members.has('boss')).toBe(false);
    a.room!.dispose();
    rooms.dispose();
  });

  it('a running game survives a restart (saved and restored)', async () => {
    vi.useFakeTimers();
    let saved: SavedRoom | null = null;
    const store = { load: async () => (saved ? [saved] : []), save: async (r: SavedRoom) => { saved = r; }, remove: async () => {} };
    const rooms = new Rooms(() => 0.75, store);
    const a = conn('alice');
    rooms.handle(a, { t: 'create', settings: settings() });
    rooms.handle(a, { t: 'pick', nation: 'GER' });
    rooms.handle(a, { t: 'start' });
    rooms.handle(a, { t: 'snapshot', req: 0, seq: 1, state: { kept: 1 } });
    await vi.advanceTimersByTimeAsync(2500);
    expect(saved).not.toBeNull();
    a.room!.dispose();
    rooms.dispose();
    // the server restarts: the room comes back, and the first player to return gets the game
    const again = new Rooms(() => 0.75, store);
    expect(await again.restore()).toBe(1);
    const back = conn('alice');
    again.handle(back, { t: 'join', code: saved!.code });
    expect(back.last('begin')).toBeTruthy();
    expect(back.last('load')).toMatchObject({ seq: 1, state: { kept: 1 } });
    back.room!.dispose();
    again.dispose();
  });

  it('a room is never fuller than its cap', () => {
    const r = new Room(settings({ maxPlayers: 2 }), conn('h'), 1);
    expect(r.join(conn('h'))).toBeNull();
    expect(r.join(conn('x'))).toBeNull();
    expect(r.join(conn('y'))).toMatch(/full/);
    r.dispose();
  });
});
