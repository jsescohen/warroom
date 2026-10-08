import pg from 'pg';

/**
 * Accounts and cloud saves. Postgres in production (Supabase's free database, via DATABASE_URL);
 * an in-memory store for development and tests (lost on restart).
 */

export type AccountStatus = 'pending' | 'approved' | 'rejected';

export interface Profile {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  status: AccountStatus;
  createdAt: number;
  lastSeen: number;
}

/** Save metadata as the client defines it (src/game/saves.ts SaveMeta), stored as JSON. */
export type SaveMetaJson = { id: string; savedAt: number } & Record<string, unknown>;

export interface StoredSave {
  meta: SaveMetaJson;
  /** The full save record, as JSON text (~120 KB). */
  data: string;
}

export interface AccountStore {
  ready(): Promise<void>;
  getProfile(id: string): Promise<Profile | null>;
  /** Creates the profile on first sign-in (as pending), refreshes name/avatar/last seen after. */
  upsertProfile(p: Pick<Profile, 'id' | 'email' | 'name' | 'avatar'>, initial: AccountStatus): Promise<Profile>;
  listProfiles(): Promise<Profile[]>;
  setStatus(id: string, status: AccountStatus): Promise<Profile | null>;
  listSaves(user: string): Promise<SaveMetaJson[]>;
  getSave(user: string, id: string): Promise<StoredSave | null>;
  putSave(user: string, save: StoredSave): Promise<void>;
  deleteSave(user: string, id: string): Promise<void>;
  clearSaves(user: string): Promise<void>;
  countSaves(): Promise<Record<string, number>>;
}

/** Keeps a player's cloud saves bounded (manual saves + autosave). */
export const MAX_SAVES_PER_USER = 30;

// ---- memory -------------------------------------------------------------------------------------

export class MemoryStore implements AccountStore {
  private profiles = new Map<string, Profile>();
  private saves = new Map<string, Map<string, StoredSave>>();
  async ready() {}
  async getProfile(id: string) {
    return this.profiles.get(id) ?? null;
  }
  async upsertProfile(p: Pick<Profile, 'id' | 'email' | 'name' | 'avatar'>, initial: AccountStatus) {
    const now = Date.now();
    const old = this.profiles.get(p.id);
    const next: Profile = old ? { ...old, ...p, lastSeen: now } : { ...p, status: initial, createdAt: now, lastSeen: now };
    this.profiles.set(p.id, next);
    return next;
  }
  async listProfiles() {
    return [...this.profiles.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
  async setStatus(id: string, status: AccountStatus) {
    const p = this.profiles.get(id);
    if (!p) return null;
    const next = { ...p, status };
    this.profiles.set(id, next);
    return next;
  }
  private mine(user: string) {
    if (!this.saves.has(user)) this.saves.set(user, new Map());
    return this.saves.get(user)!;
  }
  async listSaves(user: string) {
    return [...this.mine(user).values()].map((s) => s.meta).sort((a, b) => b.savedAt - a.savedAt);
  }
  async getSave(user: string, id: string) {
    return this.mine(user).get(id) ?? null;
  }
  async putSave(user: string, save: StoredSave) {
    this.mine(user).set(save.meta.id, save);
  }
  async deleteSave(user: string, id: string) {
    this.mine(user).delete(id);
  }
  async clearSaves(user: string) {
    this.saves.delete(user);
  }
  async countSaves() {
    return Object.fromEntries([...this.saves].map(([u, m]) => [u, m.size]));
  }
}

// ---- postgres -----------------------------------------------------------------------------------

const SCHEMA = `
create table if not exists warroom_profiles (
  id text primary key,
  email text not null,
  name text not null,
  avatar text,
  status text not null default 'pending',
  created_at bigint not null,
  last_seen bigint not null
);
create table if not exists warroom_saves (
  user_id text not null references warroom_profiles(id) on delete cascade,
  id text not null,
  meta jsonb not null,
  data text not null,
  saved_at bigint not null,
  primary key (user_id, id)
);
`;

type ProfileRow = { id: string; email: string; name: string; avatar: string | null; status: AccountStatus; created_at: string; last_seen: string };
const toProfile = (r: ProfileRow): Profile => ({
  id: r.id, email: r.email, name: r.name, avatar: r.avatar, status: r.status, createdAt: Number(r.created_at), lastSeen: Number(r.last_seen),
});

export class PgStore implements AccountStore {
  private pool: pg.Pool;
  private init: Promise<void> | null = null;
  constructor(url: string) {
    // Supabase requires TLS; its pooler certificate is not in Node's default store
    this.pool = new pg.Pool({ connectionString: url, max: 4, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } });
  }
  ready() {
    return (this.init ??= this.pool.query(SCHEMA).then(() => undefined));
  }
  async getProfile(id: string) {
    await this.ready();
    const r = await this.pool.query<ProfileRow>('select * from warroom_profiles where id = $1', [id]);
    return r.rows[0] ? toProfile(r.rows[0]) : null;
  }
  async upsertProfile(p: Pick<Profile, 'id' | 'email' | 'name' | 'avatar'>, initial: AccountStatus) {
    await this.ready();
    const now = Date.now();
    const r = await this.pool.query<ProfileRow>(
      `insert into warroom_profiles (id, email, name, avatar, status, created_at, last_seen) values ($1, $2, $3, $4, $5, $6, $6)
       on conflict (id) do update set email = excluded.email, name = excluded.name, avatar = excluded.avatar, last_seen = excluded.last_seen
       returning *`,
      [p.id, p.email, p.name, p.avatar, initial, now],
    );
    return toProfile(r.rows[0]);
  }
  async listProfiles() {
    await this.ready();
    const r = await this.pool.query<ProfileRow>('select * from warroom_profiles order by created_at desc');
    return r.rows.map(toProfile);
  }
  async setStatus(id: string, status: AccountStatus) {
    await this.ready();
    const r = await this.pool.query<ProfileRow>('update warroom_profiles set status = $2 where id = $1 returning *', [id, status]);
    return r.rows[0] ? toProfile(r.rows[0]) : null;
  }
  async listSaves(user: string) {
    await this.ready();
    const r = await this.pool.query<{ meta: SaveMetaJson }>('select meta from warroom_saves where user_id = $1 order by saved_at desc', [user]);
    return r.rows.map((x) => x.meta);
  }
  async getSave(user: string, id: string) {
    await this.ready();
    const r = await this.pool.query<StoredSave>('select meta, data from warroom_saves where user_id = $1 and id = $2', [user, id]);
    return r.rows[0] ?? null;
  }
  async putSave(user: string, save: StoredSave) {
    await this.ready();
    await this.pool.query(
      `insert into warroom_saves (user_id, id, meta, data, saved_at) values ($1, $2, $3, $4, $5)
       on conflict (user_id, id) do update set meta = excluded.meta, data = excluded.data, saved_at = excluded.saved_at`,
      [user, save.meta.id, save.meta, save.data, save.meta.savedAt],
    );
  }
  async deleteSave(user: string, id: string) {
    await this.ready();
    await this.pool.query('delete from warroom_saves where user_id = $1 and id = $2', [user, id]);
  }
  async clearSaves(user: string) {
    await this.ready();
    await this.pool.query('delete from warroom_saves where user_id = $1', [user]);
  }
  async countSaves() {
    await this.ready();
    const r = await this.pool.query<{ user_id: string; n: string }>('select user_id, count(*) as n from warroom_saves group by user_id');
    return Object.fromEntries(r.rows.map((x) => [x.user_id, Number(x.n)]));
  }
}
