import type pg from 'pg';

/**
 * Beta tooling stored next to the accounts: feedback from testers (with an optional save of the
 * moment), error reports from browsers, play statistics and achievements per player.
 */

export interface Feedback {
  id: string;
  userId: string | null;
  username: string | null;
  category: 'bug' | 'idea' | 'balance' | 'other';
  text: string;
  /** Era, date, nation, page, browser… as the client sent it. */
  context: Record<string, unknown>;
  hasSave: boolean;
  status: 'new' | 'done';
  createdAt: number;
}

export interface ErrorReport {
  key: string;
  message: string;
  stack: string;
  context: Record<string, unknown>;
  count: number;
  firstAt: number;
  lastAt: number;
  lastUser: string | null;
}

export interface EraStats { games: number; playtimeS: number; victories: number }
export interface PlayerStats {
  playtimeS: number;
  games: number;
  victories: number;
  defeats: number;
  eras: Record<string, EraStats>;
  /** Nation name → games started with it. */
  nations: Record<string, number>;
  lastPlayed: number;
  lastEra: string | null;
}
export const emptyStats = (): PlayerStats => ({ playtimeS: 0, games: 0, victories: 0, defeats: 0, eras: {}, nations: {}, lastPlayed: 0, lastEra: null });

export interface ExtrasStore {
  addFeedback(f: Omit<Feedback, 'id' | 'hasSave' | 'status'>, save: string | null): Promise<Feedback>;
  listFeedback(): Promise<Feedback[]>;
  feedbackSave(id: string): Promise<string | null>;
  setFeedbackStatus(id: string, status: Feedback['status']): Promise<boolean>;
  deleteFeedback(id: string): Promise<void>;

  recordError(e: Omit<ErrorReport, 'count' | 'firstAt' | 'lastAt'>): Promise<void>;
  listErrors(): Promise<ErrorReport[]>;
  deleteError(key: string): Promise<void>;

  getStats(user: string): Promise<PlayerStats>;
  putStats(user: string, s: PlayerStats): Promise<void>;
  allStats(): Promise<Record<string, PlayerStats>>;

  achievements(user: string): Promise<Record<string, number>>;
  /** True if newly unlocked. */
  unlock(user: string, id: string): Promise<boolean>;
}

const MAX_FEEDBACK = 2000, MAX_ERRORS = 500;

// ---- memory -------------------------------------------------------------------------------------

export class MemoryExtras implements ExtrasStore {
  private feedback: (Feedback & { save: string | null })[] = [];
  private errors = new Map<string, ErrorReport>();
  private stats = new Map<string, PlayerStats>();
  private ach = new Map<string, Record<string, number>>();
  private n = 0;

  async addFeedback(f: Omit<Feedback, 'id' | 'hasSave' | 'status'>, save: string | null) {
    const rec = { ...f, id: `f${++this.n}`, hasSave: !!save, status: 'new' as const, save };
    this.feedback.unshift(rec);
    this.feedback.length = Math.min(this.feedback.length, MAX_FEEDBACK);
    const { save: _, ...pub } = rec;
    return pub;
  }
  async listFeedback() {
    return this.feedback.map(({ save: _, ...f }) => f);
  }
  async feedbackSave(id: string) {
    return this.feedback.find((f) => f.id === id)?.save ?? null;
  }
  async setFeedbackStatus(id: string, status: Feedback['status']) {
    const f = this.feedback.find((x) => x.id === id);
    if (f) f.status = status;
    return !!f;
  }
  async deleteFeedback(id: string) {
    this.feedback = this.feedback.filter((f) => f.id !== id);
  }
  async recordError(e: Omit<ErrorReport, 'count' | 'firstAt' | 'lastAt'>) {
    const now = Date.now();
    const old = this.errors.get(e.key);
    this.errors.set(e.key, old ? { ...old, context: e.context, lastUser: e.lastUser, count: old.count + 1, lastAt: now } : { ...e, count: 1, firstAt: now, lastAt: now });
    if (this.errors.size > MAX_ERRORS) this.errors.delete(this.errors.keys().next().value!);
  }
  async listErrors() {
    return [...this.errors.values()].sort((a, b) => b.lastAt - a.lastAt);
  }
  async deleteError(key: string) {
    this.errors.delete(key);
  }
  async getStats(user: string) {
    return this.stats.get(user) ?? emptyStats();
  }
  async putStats(user: string, s: PlayerStats) {
    this.stats.set(user, s);
  }
  async allStats() {
    return Object.fromEntries(this.stats);
  }
  async achievements(user: string) {
    return { ...(this.ach.get(user) ?? {}) };
  }
  async unlock(user: string, id: string) {
    const mine = this.ach.get(user) ?? {};
    if (mine[id]) return false;
    this.ach.set(user, { ...mine, [id]: Date.now() });
    return true;
  }
}

// ---- postgres -----------------------------------------------------------------------------------

export const EXTRAS_SCHEMA = `
create table if not exists warroom_feedback (
  id bigserial primary key,
  user_id text,
  username text,
  category text not null,
  text text not null,
  context jsonb not null default '{}',
  save text,
  status text not null default 'new',
  created_at bigint not null
);
create table if not exists warroom_errors (
  key text primary key,
  message text not null,
  stack text not null,
  context jsonb not null default '{}',
  count integer not null default 1,
  first_at bigint not null,
  last_at bigint not null,
  last_user text
);
create table if not exists warroom_stats (
  user_id text primary key,
  data jsonb not null,
  updated_at bigint not null
);
create table if not exists warroom_achievements (
  user_id text not null,
  id text not null,
  unlocked_at bigint not null,
  primary key (user_id, id)
);
`;

type FeedbackRow = { id: string; user_id: string | null; username: string | null; category: Feedback['category']; text: string; context: Record<string, unknown>; has_save: boolean; status: Feedback['status']; created_at: string };
const toFeedback = (r: FeedbackRow): Feedback => ({
  id: String(r.id), userId: r.user_id, username: r.username, category: r.category, text: r.text, context: r.context ?? {}, hasSave: r.has_save, status: r.status, createdAt: Number(r.created_at),
});

export class PgExtras implements ExtrasStore {
  constructor(private pool: pg.Pool, private ready: () => Promise<void>) {}
  private async q<R extends pg.QueryResultRow>(sql: string, args: unknown[] = []) {
    await this.ready();
    return this.pool.query<R>(sql, args);
  }
  async addFeedback(f: Omit<Feedback, 'id' | 'hasSave' | 'status'>, save: string | null) {
    const r = await this.q<FeedbackRow>(
      `insert into warroom_feedback (user_id, username, category, text, context, save, created_at) values ($1, $2, $3, $4, $5, $6, $7)
       returning id, user_id, username, category, text, context, (save is not null) as has_save, status, created_at`,
      [f.userId, f.username, f.category, f.text, f.context, save, f.createdAt],
    );
    // keep the table bounded
    await this.q(`delete from warroom_feedback where id in (select id from warroom_feedback order by id desc offset ${MAX_FEEDBACK})`);
    return toFeedback(r.rows[0]);
  }
  async listFeedback() {
    const r = await this.q<FeedbackRow>('select id, user_id, username, category, text, context, (save is not null) as has_save, status, created_at from warroom_feedback order by id desc limit 500');
    return r.rows.map(toFeedback);
  }
  async feedbackSave(id: string) {
    if (!/^\d+$/.test(id)) return null;
    const r = await this.q<{ save: string | null }>('select save from warroom_feedback where id = $1', [id]);
    return r.rows[0]?.save ?? null;
  }
  async setFeedbackStatus(id: string, status: Feedback['status']) {
    if (!/^\d+$/.test(id)) return false;
    const r = await this.q('update warroom_feedback set status = $2 where id = $1', [id, status]);
    return (r.rowCount ?? 0) > 0;
  }
  async deleteFeedback(id: string) {
    if (/^\d+$/.test(id)) await this.q('delete from warroom_feedback where id = $1', [id]);
  }
  async recordError(e: Omit<ErrorReport, 'count' | 'firstAt' | 'lastAt'>) {
    const now = Date.now();
    await this.q(
      `insert into warroom_errors (key, message, stack, context, count, first_at, last_at, last_user) values ($1, $2, $3, $4, 1, $5, $5, $6)
       on conflict (key) do update set count = warroom_errors.count + 1, last_at = excluded.last_at, context = excluded.context, last_user = excluded.last_user`,
      [e.key, e.message, e.stack, e.context, now, e.lastUser],
    );
    await this.q(`delete from warroom_errors where key in (select key from warroom_errors order by last_at desc offset ${MAX_ERRORS})`);
  }
  async listErrors() {
    const r = await this.q<{ key: string; message: string; stack: string; context: Record<string, unknown>; count: number; first_at: string; last_at: string; last_user: string | null }>(
      'select * from warroom_errors order by last_at desc limit 200');
    return r.rows.map((x) => ({ key: x.key, message: x.message, stack: x.stack, context: x.context, count: x.count, firstAt: Number(x.first_at), lastAt: Number(x.last_at), lastUser: x.last_user }));
  }
  async deleteError(key: string) {
    await this.q('delete from warroom_errors where key = $1', [key]);
  }
  async getStats(user: string) {
    const r = await this.q<{ data: PlayerStats }>('select data from warroom_stats where user_id = $1', [user]);
    return { ...emptyStats(), ...(r.rows[0]?.data ?? {}) };
  }
  async putStats(user: string, s: PlayerStats) {
    await this.q(`insert into warroom_stats (user_id, data, updated_at) values ($1, $2, $3)
      on conflict (user_id) do update set data = excluded.data, updated_at = excluded.updated_at`, [user, s, Date.now()]);
  }
  async allStats() {
    const r = await this.q<{ user_id: string; data: PlayerStats }>('select user_id, data from warroom_stats');
    return Object.fromEntries(r.rows.map((x) => [x.user_id, { ...emptyStats(), ...x.data }]));
  }
  async achievements(user: string) {
    const r = await this.q<{ id: string; unlocked_at: string }>('select id, unlocked_at from warroom_achievements where user_id = $1', [user]);
    return Object.fromEntries(r.rows.map((x) => [x.id, Number(x.unlocked_at)]));
  }
  async unlock(user: string, id: string) {
    const r = await this.q('insert into warroom_achievements (user_id, id, unlocked_at) values ($1, $2, $3) on conflict do nothing', [user, id, Date.now()]);
    return (r.rowCount ?? 0) > 0;
  }
}
