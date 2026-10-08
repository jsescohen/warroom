import type pg from 'pg';
import type { RoomSettings, RoomStatus, StreamCommand } from '../../shared/multiplayer/protocol';

/** A running room as kept in the database, so games survive a server restart (every deploy). */
export interface SavedRoom {
  id: string;
  code: string;
  createdAt: number;
  settings: RoomSettings;
  status: RoomStatus;
  hostId: string;
  members: { userId: string; username: string; nation: string | null }[];
  seq: number;
  ticks: number;
  snapshot: { seq: number; state: unknown } | null;
  stream: { seq: number; cmd: StreamCommand }[];
}

export interface RoomStore {
  load(): Promise<SavedRoom[]>;
  save(room: SavedRoom): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Without a database: rooms end with the server. */
export class MemoryRoomStore implements RoomStore {
  async load() { return []; }
  async save() {}
  async remove() {}
}

const SCHEMA = `create table if not exists warroom_rooms (
  id text primary key,
  data text not null,
  updated_at bigint not null
)`;

export class PgRoomStore implements RoomStore {
  private init: Promise<unknown> | null = null;
  constructor(private pool: pg.Pool) {}
  private ready() {
    return (this.init ??= this.pool.query(SCHEMA));
  }
  async load(): Promise<SavedRoom[]> {
    await this.ready();
    // games nobody touched for two days are not brought back
    await this.pool.query('delete from warroom_rooms where updated_at < $1', [Date.now() - 2 * 86400_000]);
    const r = await this.pool.query<{ data: string }>('select data from warroom_rooms');
    return r.rows.flatMap((row) => { try { return [JSON.parse(row.data) as SavedRoom]; } catch { return []; } });
  }
  async save(room: SavedRoom) {
    await this.ready();
    await this.pool.query(
      'insert into warroom_rooms (id, data, updated_at) values ($1, $2, $3) on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at',
      [room.id, JSON.stringify(room), Date.now()],
    );
  }
  async remove(id: string) {
    await this.ready();
    await this.pool.query('delete from warroom_rooms where id = $1', [id]);
  }
}
