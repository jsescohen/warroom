import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { MAX_MSGS_PER_SEC, type ClientMsg, type ServerMsg } from '../../shared/multiplayer/protocol';
import type { RoomStore } from './persist';
import { Rooms, type Conn, type TickSeconds } from './rooms';

/** Who a sign-in token belongs to (approved players with a username only), or why not. */
export type Identify = (token: string) => Promise<{ userId: string; username: string; admin?: boolean } | { error: string }>;

/** Snapshots carry a whole game: allow them to be large. */
const MAX_PAYLOAD = 16 * 1024 * 1024;

/** Multiplayer over WebSockets at /ws: sign in with the first message, then talk to the rooms. */
export function attachMultiplayer(server: Server, identify: Identify, tickSeconds: TickSeconds, store?: RoomStore): Rooms {
  const rooms = new Rooms(tickSeconds, store);
  rooms.restore().then((n) => { if (n) console.log(`[mp] restored ${n} game${n === 1 ? '' : 's'}`); }).catch((e) => console.error('[mp] restore:', (e as Error).message));
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_PAYLOAD });

  wss.on('connection', (ws: WebSocket) => {
    let conn: Conn | null = null;
    let window = Date.now(), count = 0;
    const send = (msg: ServerMsg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };
    // connections that never sign in are closed
    const authTimer = setTimeout(() => { if (!conn) ws.close(4001, 'sign in first'); }, 15_000);
    // keep the connection alive through proxies (and notice dead ones)
    let alive = true;
    ws.on('pong', () => { alive = true; });
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 25_000);

    ws.on('message', async (data, isBinary) => {
      if (isBinary) return;
      const now = Date.now();
      if (now - window > 1000) { window = now; count = 0; }
      if (++count > MAX_MSGS_PER_SEC) return send({ t: 'error', error: 'Too many messages: slow down.' });
      let msg: ClientMsg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return send({ t: 'error', error: 'Unreadable message' });
      }
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
      if (!conn) {
        if (msg.t !== 'auth' || typeof msg.token !== 'string') return send({ t: 'error', error: 'Sign in first' });
        const who = await identify(msg.token).catch(() => ({ error: 'Could not check your sign-in' }));
        if ('error' in who) { send({ t: 'error', error: who.error }); return ws.close(4003, 'not allowed'); }
        clearTimeout(authTimer);
        conn = { userId: who.userId, username: who.username, admin: !!who.admin, send, room: null };
        return send({ t: 'hello', userId: who.userId, username: who.username });
      }
      try {
        rooms.handle(conn, msg);
      } catch (e) {
        console.error('[mp]', e);
        send({ t: 'error', error: 'Something went wrong on the server' });
      }
    });
    ws.on('close', () => {
      clearTimeout(authTimer);
      clearInterval(ping);
      if (conn) rooms.drop(conn);
    });
    ws.on('error', () => ws.terminate());
  });
  return rooms;
}
