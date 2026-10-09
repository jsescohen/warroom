import { authToken } from '../auth/account';
import type { ClientMsg, RoomInfo, RoomSettings, ServerMsg, StreamCommand } from '../../shared/multiplayer/protocol';

const ROOM_KEY = 'warroom.room';

type Handlers = {
  hello: (m: { userId: string; username: string }) => void;
  rooms: (rooms: RoomInfo[]) => void;
  mine: (rooms: RoomInfo[]) => void;
  room: (room: RoomInfo | null) => void;
  begin: (room: RoomInfo) => void;
  load: (seq: number, state: unknown) => void;
  stream: (seq: number, cmd: StreamCommand) => void;
  snapshotRequest: (req: number) => void;
  error: (error: string) => void;
  status: (online: boolean) => void;
};

/**
 * The connection to the multiplayer server (one per page). Signs in with the account token,
 * reconnects after a dropped connection (rejoining the room it was in), and hands the game the
 * ordered stream. Stream messages that arrive before the game is ready are kept for it.
 */
export class MpClient {
  private ws: WebSocket | null = null;
  private handlers: { [K in keyof Handlers]: Set<Handlers[K]> } = {
    hello: new Set(), rooms: new Set(), mine: new Set(), room: new Set(), begin: new Set(), load: new Set(), stream: new Set(), snapshotRequest: new Set(), error: new Set(), status: new Set(),
  };
  private queue: ClientMsg[] = [];
  private retry = 0;
  private closed = false;
  /** Room to rejoin after a reconnect (kept across reloads of the tab). */
  roomCode: string | null = (() => { try { return sessionStorage.getItem(ROOM_KEY); } catch { return null; } })();
  userId: string | null = null;
  room: RoomInfo | null = null;
  online = false;
  /** Game messages received before anyone listened (the map is still loading). */
  private backlog: ServerMsg[] = [];

  connect() {
    this.closed = false;
    void this.open();
  }

  private async open() {
    const token = await authToken();
    if (!token) return this.emit('error', 'Sign in to play online.');
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify({ t: 'auth', token } satisfies ClientMsg));
    };
    ws.onmessage = (e) => {
      let msg: ServerMsg;
      try { msg = JSON.parse(String(e.data)); } catch { return; }
      this.receive(msg);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.setOnline(false);
      if (this.closed || e.code === 4003) return;
      // reconnect with a growing pause (the free server may be waking up)
      const wait = Math.min(15_000, 800 * 2 ** this.retry++);
      setTimeout(() => { if (!this.closed) void this.open(); }, wait);
    };
  }

  close() {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
  }

  private setOnline(v: boolean) {
    if (this.online === v) return;
    this.online = v;
    this.emit('status', v);
  }

  private receive(msg: ServerMsg) {
    switch (msg.t) {
      case 'hello':
        this.userId = msg.userId;
        this.setOnline(true);
        for (const m of this.queue.splice(0)) this.send(m);
        if (this.roomCode) this.send({ t: 'join', code: this.roomCode });
        return this.emit('hello', msg);
      case 'rooms': return this.emit('rooms', msg.rooms);
      case 'mine': return this.emit('mine', msg.rooms);
      case 'room':
        this.room = msg.room;
        this.remember(msg.room?.code ?? null);
        return this.emit('room', msg.room);
      case 'error': return this.emit('error', msg.error);
      case 'begin':
        this.room = msg.room;
        this.remember(msg.room.code);
        this.backlog = [];
        return this.emit('begin', msg.room);
      case 'load':
      case 's':
      case 'snap?':
        if (!this.handlers.stream.size) { this.backlog.push(msg); return; }
        return this.deliver(msg);
    }
  }

  private deliver(msg: ServerMsg) {
    if (msg.t === 'load') this.emit('load', msg.seq, msg.state);
    else if (msg.t === 's') this.emit('stream', msg.seq, msg.cmd);
    else if (msg.t === 'snap?') this.emit('snapshotRequest', msg.req);
  }

  /** The game is ready: replay what arrived while it loaded. */
  flushBacklog() {
    for (const m of this.backlog.splice(0)) this.deliver(m);
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN && (this.online || msg.t === 'auth')) this.ws.send(JSON.stringify(msg));
    else if (msg.t !== 'hash' && msg.t !== 'snapshot' && msg.t !== 'cmd') this.queue.push(msg);
  }

  list() { this.send({ t: 'list' }); this.send({ t: 'mine' }); }
  create(settings: RoomSettings) { this.send({ t: 'create', settings }); }
  join(code: string) { this.send({ t: 'join', code }); }
  leave() { this.remember(null); this.send({ t: 'leave' }); }

  private remember(code: string | null) {
    this.roomCode = code;
    try { if (code) sessionStorage.setItem(ROOM_KEY, code); else sessionStorage.removeItem(ROOM_KEY); } catch { /* storage blocked */ }
  }
  pick(nation: string | null) { this.send({ t: 'pick', nation }); }
  start() { this.send({ t: 'start' }); }
  pause(paused: boolean) { this.send({ t: 'pause', paused }); }
  /** Admin: every room, private ones too (answered with 'rooms'). */
  adminRooms() { this.send({ t: 'adminRooms' }); }
  /** Admin: watch a game read-only. */
  watch(roomId: string) { this.remember(null); this.send({ t: 'watch', roomId }); }

  on<K extends keyof Handlers>(k: K, fn: Handlers[K]): () => void {
    (this.handlers[k] as Set<Handlers[K]>).add(fn);
    return () => (this.handlers[k] as Set<Handlers[K]>).delete(fn);
  }

  private emit<K extends keyof Handlers>(k: K, ...args: Parameters<Handlers[K]>) {
    for (const fn of this.handlers[k]) (fn as (...a: Parameters<Handlers[K]>) => void)(...args);
  }

  /** My entry in the room. */
  me() {
    return this.room?.players.find((p) => p.userId === this.userId) ?? null;
  }
}

let client: MpClient | null = null;
/** The page's multiplayer connection (opened on first use). */
export function mp(): MpClient {
  if (!client) { client = new MpClient(); client.connect(); }
  return client;
}
