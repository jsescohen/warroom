import { randomBytes } from 'node:crypto';
import { MemoryRoomStore, type RoomStore, type SavedRoom } from './persist';
import { HASH_EVERY, MAX_PLAYERS, type ClientMsg, type RoomInfo, type RoomPlayer, type RoomSettings, type ServerMsg, type StreamCommand } from '../../shared/multiplayer/protocol';

/**
 * Multiplayer rooms. The server only keeps the clock and orders the stream of commands; every
 * player's browser runs the game itself (see shared/multiplayer/protocol.ts). Rooms live in
 * memory: a server restart (a deploy) ends the games in progress.
 */

/** One open connection of a signed-in player. */
export interface Conn {
  userId: string;
  username: string;
  /** Admins may list every room and watch any game. */
  admin?: boolean;
  /** Watching a game (admin), not playing in it. */
  watching?: boolean;
  send(msg: ServerMsg): void;
  /** Loaded the game and receiving the stream (false while waiting for a snapshot). */
  ready?: boolean;
  room?: Room | null;
}

interface Member {
  username: string;
  nation: string | null;
  conns: Set<Conn>;
  joinedAt: number;
}

/** Real seconds per tick at speed 1, per scenario (see TimeConfig). */
export type TickSeconds = (scenarioId: string) => number | null;

const STREAM_KEEP = 20_000;
const SNAPSHOT_EVERY_TICKS = 150;
const IDLE_LOBBY_MS = 15 * 60_000;
const IDLE_GAME_MS = 6 * 3600_000;
/** Actions a player's browser may send on behalf of an AI leader they are talking to. */
const AI_VOICE = new Set(['chat', 'respond', 'propose', 'remember', 'adjustRelation', 'noteContact']);
/** Actions only the server issues. */
const SERVER_ONLY = new Set(['tick', 'setPlayers', 'transferProvince', 'chooseNation']);

export class Room {
  id = randomBytes(6).toString('hex');
  code = makeCode();
  createdAt = Date.now();
  /** Admins watching the game (they receive the stream but are not players). */
  watchers = new Set<Conn>();
  /** Called when the room should be written to the database. */
  onChange: (() => void) | null = null;
  status: RoomInfo['status'] = 'lobby';
  members = new Map<string, Member>();
  hostId: string;
  seq = 0;
  ticks = 0;
  /** Stream entries after the stored snapshot (or since the start). */
  stream: { seq: number; cmd: StreamCommand }[] = [];
  snapshot: { seq: number; state: unknown } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private nextReq = 1;
  /** Snapshot requests waiting for the host: who gets the result. */
  private waiting = new Map<number, Set<Conn>>();
  private hashes = new Map<number, Map<string, string>>();
  lastActivity = Date.now();

  constructor(public settings: RoomSettings, host: Conn, private tickSeconds: number) {
    this.hostId = host.userId;
  }

  info(): RoomInfo {
    const players: RoomPlayer[] = [...this.members].map(([userId, m]) => ({
      userId, username: m.username, nation: m.nation, connected: m.conns.size > 0, host: userId === this.hostId,
    }));
    return { ...this.settings, id: this.id, code: this.code, status: this.status, players, createdAt: this.createdAt };
  }

  get humans(): string[] {
    return [...this.members.values()].map((m) => m.nation).filter((n): n is string => !!n).sort();
  }

  private conns(): Conn[] {
    return [...[...this.members.values()].flatMap((m) => [...m.conns]), ...this.watchers];
  }

  // ---- saving --------------------------------------------------------------------------------

  toSaved(): SavedRoom {
    return {
      id: this.id, code: this.code, createdAt: this.createdAt, settings: this.settings, status: this.status, hostId: this.hostId,
      members: [...this.members].map(([userId, m]) => ({ userId, username: m.username, nation: m.nation })),
      seq: this.seq, ticks: this.ticks, snapshot: this.snapshot, stream: this.stream,
    };
  }

  /** A room from the database: nobody is connected yet, the clock waits for the first player. */
  static fromSaved(s: SavedRoom, tickSeconds: number): Room {
    const r = new Room(s.settings, { userId: s.hostId, username: '', send: () => {} }, tickSeconds);
    r.id = s.id; r.code = s.code; r.createdAt = s.createdAt; r.status = s.status;
    r.seq = s.seq; r.ticks = s.ticks; r.snapshot = s.snapshot; r.stream = s.stream;
    for (const m of s.members) r.members.set(m.userId, { username: m.username, nation: m.nation, conns: new Set(), joinedAt: s.createdAt });
    return r;
  }

  private changed() {
    if (this.status !== 'lobby') this.onChange?.();
  }

  // ---- watching (admin) ----------------------------------------------------------------------

  watch(c: Conn) {
    this.watchers.add(c);
    c.room = this;
    c.watching = true;
    c.ready = false;
    c.send({ t: 'room', room: this.info() });
    if (this.status === 'lobby') return;
    c.send({ t: 'begin', room: this.info() });
    this.sendState(c);
  }

  broadcastRoom() {
    const room = this.info();
    for (const c of this.conns()) c.send({ t: 'room', room });
  }

  // ---- membership --------------------------------------------------------------------------

  /** Adds a connection; returns an error when the room is full. */
  join(c: Conn): string | null {
    if (c.watching) { this.watchers.delete(c); c.watching = false; }
    let m = this.members.get(c.userId);
    if (!m) {
      if (this.members.size >= this.settings.maxPlayers) return 'This room is full';
      m = { username: c.username, nation: null, conns: new Set(), joinedAt: Date.now() };
      this.members.set(c.userId, m);
    }
    m.conns.add(c);
    c.room = this;
    c.ready = false;
    if (!this.connected(this.hostId)) this.hostId = c.userId;
    this.lastActivity = Date.now();
    this.broadcastRoom();
    if (this.status !== 'lobby') {
      c.send({ t: 'begin', room: this.info() });
      this.sendState(c);
      this.resume();
    }
    return null;
  }

  /** A connection closed (the player may come back). */
  drop(c: Conn) {
    if (c.watching) { this.watchers.delete(c); c.room = null; return; }
    const m = this.members.get(c.userId);
    m?.conns.delete(c);
    c.room = null;
    for (const set of this.waiting.values()) set.delete(c);
    if (m && !m.conns.size && this.status === 'lobby') this.members.delete(c.userId);
    if (!this.connected(this.hostId)) {
      const next = [...this.members.keys()].find((id) => this.connected(id));
      if (next) this.hostId = next;
    }
    if (!this.anyoneConnected()) this.stopClock();
    this.lastActivity = Date.now();
    this.broadcastRoom();
  }

  /** The player leaves the room for good (their nation goes back to the AI). */
  leave(c: Conn) {
    if (c.watching) return this.drop(c);
    const m = this.members.get(c.userId);
    if (!m) return;
    for (const conn of m.conns) conn.room = null;
    this.members.delete(c.userId);
    if (this.status !== 'lobby' && m.nation) this.streamPlayers();
    if (this.hostId === c.userId) {
      const next = [...this.members.keys()].find((id) => this.connected(id)) ?? [...this.members.keys()][0];
      if (next) this.hostId = next;
    }
    if (!this.anyoneConnected()) this.stopClock();
    this.broadcastRoom();
    this.changed();
  }

  connected = (userId: string) => (this.members.get(userId)?.conns.size ?? 0) > 0;
  anyoneConnected = () => [...this.members.values()].some((m) => m.conns.size > 0);

  // ---- lobby -------------------------------------------------------------------------------

  pick(c: Conn, nation: string | null): string | null {
    const m = this.members.get(c.userId);
    if (!m) return 'You are not in this room';
    if (nation && [...this.members].some(([id, o]) => id !== c.userId && o.nation === nation)) return 'Another player leads that nation';
    if (this.status !== 'lobby' && m.nation && nation !== m.nation) return 'You already lead a nation in this game';
    m.nation = nation;
    if (this.status !== 'lobby') this.streamPlayers();
    this.broadcastRoom();
    this.changed();
    return null;
  }

  start(c: Conn): string | null {
    if (c.userId !== this.hostId) return 'Only the host can start the game';
    if (this.status !== 'lobby') return 'The game has already started';
    if (!this.members.get(c.userId)?.nation) return 'Choose your nation first';
    this.status = 'running';
    for (const conn of this.conns()) { conn.ready = true; conn.send({ t: 'begin', room: this.info() }); }
    this.streamPlayers();
    this.startClock();
    this.broadcastRoom();
    this.changed();
    return null;
  }

  pause(c: Conn, paused: boolean): string | null {
    if (c.userId !== this.hostId) return 'Only the host can pause';
    if (this.settings.visibility === 'public') return 'Public games cannot be paused';
    if (this.status === 'lobby') return 'The game has not started';
    this.status = paused ? 'paused' : 'running';
    if (paused) this.stopClock(); else this.startClock();
    this.broadcastRoom();
    this.changed();
    return null;
  }

  // ---- the stream --------------------------------------------------------------------------

  /** Puts a command into the ordered stream and sends it to everyone who has the game loaded. */
  push(cmd: StreamCommand) {
    const seq = ++this.seq;
    this.stream.push({ seq, cmd });
    if (this.stream.length > STREAM_KEEP) this.stream.splice(0, this.stream.length - STREAM_KEEP);
    for (const c of this.conns()) if (c.ready) c.send({ t: 's', seq, cmd });
  }

  private streamPlayers() {
    const s = this.settings;
    this.push({ actor: 'system', action: { type: 'setPlayers', nations: this.humans, difficulty: s.difficulty, economy: s.economy, capitalFalls: s.capitalFalls } });
  }

  /** A command from a player: only for their own nation (or an AI leader they are talking to). */
  command(c: Conn, cmd: StreamCommand): string | null {
    if (this.status === 'lobby') return 'The game has not started';
    const m = this.members.get(c.userId);
    if (!m?.nation) return 'Choose a nation first';
    const type = cmd?.action?.type;
    if (typeof type !== 'string' || SERVER_ONLY.has(type) || cmd.actor === 'system') return 'Not allowed';
    const own = cmd.actor === m.nation;
    const aiVoice = !this.humans.includes(cmd.actor) && AI_VOICE.has(type);
    if (!own && !aiVoice) return 'You can only command your own nation';
    this.lastActivity = Date.now();
    this.push(cmd);
    return null;
  }

  private startClock() {
    if (this.timer || this.status !== 'running') return;
    this.timer = setInterval(() => this.tick(), Math.max(120, (this.tickSeconds * 1000) / this.settings.speed));
  }
  private stopClock() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  private resume() {
    if (this.status === 'running') this.startClock();
  }
  dispose() {
    this.stopClock();
  }

  tick() {
    if (!this.anyoneConnected()) return this.stopClock();
    this.ticks++;
    this.push({ actor: 'system', action: { type: 'tick' } });
    if (this.ticks % SNAPSHOT_EVERY_TICKS === 0) this.requestSnapshot(null);
  }

  // ---- snapshots and drift -----------------------------------------------------------------

  private host(): Conn | undefined {
    return [...(this.members.get(this.hostId)?.conns ?? [])].find((c) => c.ready);
  }

  /** Asks the host for the current game, for `forConn` (a joining or drifted player) or to keep. */
  private requestSnapshot(forConn: Conn | null) {
    const host = this.host();
    if (!host) return false;
    const req = this.nextReq++;
    this.waiting.set(req, new Set(forConn ? [forConn] : []));
    host.send({ t: 'snap?', req });
    return true;
  }

  /** Gets a player's copy of the game going: from the host now, or from the last kept snapshot. */
  private sendState(c: Conn) {
    if (this.host() && this.host() !== c && this.requestSnapshot(c)) return;
    if (this.snapshot) return this.load(c, this.snapshot.seq, this.snapshot.state);
    // nobody to ask and nothing kept: start from the beginning of the stream (fresh games only)
    if (this.stream[0]?.seq === 1) { c.ready = true; for (const e of this.stream) c.send({ t: 's', seq: e.seq, cmd: e.cmd }); }
    else c.send({ t: 'error', error: 'This game could not be restored. Ask the other players to rejoin.' });
  }

  private load(c: Conn, seq: number, state: unknown) {
    c.send({ t: 'load', seq, state });
    for (const e of this.stream) if (e.seq > seq) c.send({ t: 's', seq: e.seq, cmd: e.cmd });
    c.ready = true;
  }

  snapshotFrom(c: Conn, req: number, seq: number, state: unknown) {
    if (c.userId !== this.hostId || typeof seq !== 'number' || seq > this.seq) return;
    const forConns = this.waiting.get(req);
    this.waiting.delete(req);
    this.snapshot = { seq, state };
    // keep only the stream after the snapshot
    this.stream = this.stream.filter((e) => e.seq > seq);
    for (const target of forConns ?? []) if (target.room === this) this.load(target, seq, state);
    this.changed();
  }

  /** Compares fingerprints with the host's: a copy that differs is replaced. */
  hashFrom(c: Conn, seq: number, hash: string) {
    if (typeof seq !== 'number' || typeof hash !== 'string') return;
    let at = this.hashes.get(seq);
    if (!at) { at = new Map(); this.hashes.set(seq, at); }
    at.set(c.userId, hash);
    const hostHash = at.get(this.hostId);
    if (hostHash) {
      for (const [userId, h] of at) {
        if (h === hostHash || userId === this.hostId) continue;
        for (const conn of this.members.get(userId)?.conns ?? []) { conn.ready = false; this.requestSnapshot(conn); }
        at.set(userId, hostHash); // asked once
      }
    }
    for (const k of this.hashes.keys()) if (k < seq - HASH_EVERY * 20) this.hashes.delete(k);
  }
}

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function makeCode(): string {
  const b = randomBytes(6);
  return [...b].map((x) => LETTERS[x % LETTERS.length]).join('');
}

/** All rooms, and the routing of client messages to them. */
export class Rooms {
  rooms = new Map<string, Room>();
  private sweeper: NodeJS.Timeout;
  private saving = new Map<string, NodeJS.Timeout>();

  constructor(private tickSeconds: TickSeconds, private store: RoomStore = new MemoryRoomStore()) {
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref?.();
  }

  /** Brings back the games that were running when the server stopped. */
  async restore() {
    for (const saved of await this.store.load()) {
      const secs = this.tickSeconds(saved.settings.scenarioId);
      if (!secs || this.rooms.has(saved.id)) continue;
      this.add(Room.fromSaved(saved, secs));
    }
    return this.rooms.size;
  }

  private add(r: Room) {
    r.onChange = () => this.saveSoon(r);
    this.rooms.set(r.id, r);
  }

  /** Writes a room to the database a moment later (several changes in a row make one write). */
  private saveSoon(r: Room) {
    if (this.saving.has(r.id)) return;
    this.saving.set(r.id, setTimeout(() => {
      this.saving.delete(r.id);
      if (this.rooms.get(r.id) === r) this.store.save(r.toSaved()).catch((e) => console.error('[mp] save room:', (e as Error).message));
    }, 2000));
  }

  list(): ReturnType<Room['info']>[] {
    return [...this.rooms.values()]
      .filter((r) => r.settings.visibility === 'public' && r.members.size < r.settings.maxPlayers)
      .map((r) => r.info())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50);
  }

  byCode(code: string) {
    const c = code.trim().toUpperCase();
    return [...this.rooms.values()].find((r) => r.code === c || r.id === code);
  }

  handle(c: Conn, msg: ClientMsg) {
    const err = (e: string | null) => { if (e) c.send({ t: 'error', error: e }); };
    const room = c.room ?? null;
    switch (msg.t) {
      case 'list':
        return c.send({ t: 'rooms', rooms: this.list() });
      case 'create': {
        const settings = cleanSettings(msg.settings);
        const secs = settings && this.tickSeconds(settings.scenarioId);
        if (!settings || !secs) return err('Those room settings are not valid');
        if (room) room.leave(c);
        const r = new Room(settings, c, secs);
        this.add(r);
        return err(r.join(c));
      }
      case 'join': {
        const r = this.byCode(String(msg.code ?? ''));
        if (!r) return err('No room with that code');
        if (room && room !== r) room.leave(c);
        return err(r.join(c));
      }
      case 'leave':
        room?.leave(c);
        return c.send({ t: 'room', room: null });
      case 'pick':
        return err(room ? room.pick(c, typeof msg.nation === 'string' ? msg.nation : null) : 'You are not in a room');
      case 'start':
        return err(room ? room.start(c) : 'You are not in a room');
      case 'pause':
        return err(room ? room.pause(c, !!msg.paused) : 'You are not in a room');
      case 'cmd':
        return err(room ? room.command(c, msg.cmd) : 'You are not in a room');
      case 'snapshot':
        return room?.snapshotFrom(c, msg.req, msg.seq, msg.state);
      case 'hash':
        return room?.hashFrom(c, msg.seq, msg.hash);
      case 'adminRooms':
        if (!c.admin) return err('Admins only');
        return c.send({ t: 'rooms', rooms: [...this.rooms.values()].map((r) => r.info()).sort((a, b) => b.createdAt - a.createdAt) });
      case 'watch': {
        if (!c.admin) return err('Admins only');
        const r = this.rooms.get(String(msg.roomId));
        if (!r) return err('That game has ended');
        if (room) room.drop(c);
        return r.watch(c);
      }
    }
  }

  drop(c: Conn) {
    c.room?.drop(c);
  }

  private sweep() {
    const now = Date.now();
    for (const [id, r] of this.rooms) {
      const idle = now - r.lastActivity;
      if (r.anyoneConnected()) continue;
      if ((r.status === 'lobby' && idle > IDLE_LOBBY_MS) || idle > IDLE_GAME_MS || !r.members.size) {
        r.dispose();
        this.rooms.delete(id);
        this.store.remove(id).catch(() => undefined);
      }
    }
  }

  dispose() {
    clearInterval(this.sweeper);
    for (const r of this.rooms.values()) r.dispose();
  }
}

/** Validates room settings from a client. */
export function cleanSettings(s: unknown): RoomSettings | null {
  if (!s || typeof s !== 'object') return null;
  const o = s as Record<string, unknown>;
  const name = String(o.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const pick = <T,>(v: unknown, ok: readonly T[]) => (ok.includes(v as T) ? (v as T) : null);
  const visibility = pick(o.visibility, ['public', 'private'] as const);
  const speed = pick(o.speed, [1, 2, 4] as const);
  const difficulty = pick(o.difficulty, ['easy', 'normal', 'hard'] as const);
  const economy = pick(o.economy, ['simple', 'detailed'] as const);
  const maxPlayers = Math.round(Number(o.maxPlayers));
  if (!name || !visibility || !speed || !difficulty || !economy || typeof o.scenarioId !== 'string') return null;
  if (!(maxPlayers >= 2 && maxPlayers <= MAX_PLAYERS)) return null;
  return { name, scenarioId: o.scenarioId, visibility, maxPlayers, speed, difficulty, economy, capitalFalls: !!o.capitalFalls };
}
