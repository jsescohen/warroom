import { createHash } from 'node:crypto';
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { achievementById } from '../../shared/accounts/achievements';
import type { ExtrasStore, Feedback, PlayerStats } from './extras';
import type { Accounts, Caller } from './routes';

/**
 * Beta tooling endpoints: testers send feedback (optionally with their game attached), browsers
 * report errors, the game records play time and results, and achievements are kept per account.
 * The admin reads all of it in the admin panel.
 */

const CATEGORIES: Feedback['category'][] = ['bug', 'idea', 'balance', 'other'];
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const json = JSON.stringify(v);
  return json.length > 4000 ? { truncated: json.slice(0, 4000) } : (v as Record<string, unknown>);
};

/** At most `max` calls per address per window. */
function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; until: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip ?? 'unknown', now = Date.now();
    const h = hits.get(ip);
    if (!h || h.until < now) hits.set(ip, { n: 1, until: now + windowMs });
    else if (++h.n > max) return res.status(429).json({ error: 'Too many reports, slow down.' });
    if (hits.size > 5000) hits.clear();
    next();
  };
}

export function betaRouter(accounts: Accounts, extras: ExtrasStore): Router {
  const r = express.Router();
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
  const caller = (res: Response) => res.locals.caller as Caller;

  // ---- feedback -------------------------------------------------------------------------------
  r.post('/api/feedback', rateLimit(20, 60 * 60_000), accounts.requirePlayer, wrap(async (req, res) => {
    const b = req.body as { category?: string; text?: unknown; context?: unknown; save?: unknown };
    const text = str(b.text, 4000).trim();
    if (text.length < 3) return res.status(400).json({ error: 'Write a few words first.' });
    const category = CATEGORIES.includes(b.category as Feedback['category']) ? (b.category as Feedback['category']) : 'other';
    const save = b.save && typeof b.save === 'object' ? JSON.stringify(b.save) : null;
    if (save && save.length > 3_500_000) return res.status(413).json({ error: 'The attached game is too large.' });
    const { profile } = caller(res);
    const f = await extras.addFeedback({ userId: profile.id, username: profile.username, category, text, context: obj(b.context), createdAt: Date.now() }, save);
    res.json(f);
  }));

  // ---- error reports (anyone, even before signing in) --------------------------------------------
  r.post('/api/errors', rateLimit(30, 10 * 60_000), wrap(async (req, res) => {
    const b = req.body as { message?: unknown; stack?: unknown; context?: unknown };
    const message = str(b.message, 500).trim();
    if (!message) return res.status(400).json({ error: 'No message.' });
    const stack = str(b.stack, 4000);
    // group the same error from everyone: message + the first line of the stack that points at code
    const where = stack.split('\n').find((l) => /\.(js|ts)(\?|:)/.test(l))?.replace(/\?[^:)]*/, '').replace(/https?:\/\/[^/]+/, '').trim() ?? '';
    const key = createHash('sha1').update(`${message}|${where}`).digest('hex').slice(0, 16);
    const c = await accounts.caller(req).catch(() => null);
    await extras.recordError({ key, message, stack, context: obj(b.context), lastUser: c?.profile.username ?? c?.profile.email ?? null });
    res.json({ ok: true });
  }));

  // ---- play statistics ----------------------------------------------------------------------
  r.post('/api/stats', rateLimit(240, 60 * 60_000), accounts.requirePlayer, wrap(async (req, res) => {
    const b = req.body as { type?: string; scenarioId?: unknown; nation?: unknown; seconds?: unknown; result?: unknown };
    const era = str(b.scenarioId, 40);
    if (!era) return res.status(400).json({ error: 'Which era?' });
    const user = caller(res).profile.id;
    const s: PlayerStats = await extras.getStats(user);
    const e = (s.eras[era] ??= { games: 0, playtimeS: 0, victories: 0 });
    if (b.type === 'start') {
      s.games++;
      e.games++;
      const nation = str(b.nation, 80);
      if (nation) s.nations[nation] = (s.nations[nation] ?? 0) + 1;
    } else if (b.type === 'time') {
      const sec = Math.max(0, Math.min(120, Number(b.seconds) || 0)); // a heartbeat covers at most two minutes
      s.playtimeS += sec;
      e.playtimeS += sec;
    } else if (b.type === 'end') {
      if (b.result === 'victory') { s.victories++; e.victories++; } else if (b.result === 'defeat') s.defeats++;
    } else return res.status(400).json({ error: 'Unknown stats event.' });
    s.lastPlayed = Date.now();
    s.lastEra = era;
    await extras.putStats(user, s);
    res.json({ ok: true });
  }));

  // ---- the player's own profile: stats and achievements -------------------------------------------
  r.get('/api/me/profile', accounts.requirePlayer, wrap(async (_req, res) => {
    const user = caller(res).profile.id;
    const [stats, achievements] = await Promise.all([extras.getStats(user), extras.achievements(user)]);
    res.json({ stats, achievements });
  }));
  r.post('/api/achievements', rateLimit(120, 60 * 60_000), accounts.requirePlayer, wrap(async (req, res) => {
    const ids = (Array.isArray((req.body as { ids?: unknown }).ids) ? (req.body as { ids: unknown[] }).ids : []).filter((x): x is string => typeof x === 'string' && achievementById.has(x)).slice(0, 40);
    const user = caller(res).profile.id;
    const fresh: string[] = [];
    for (const id of ids) if (await extras.unlock(user, id)) fresh.push(id);
    res.json({ unlocked: fresh });
  }));

  // ---- admin ------------------------------------------------------------------------------------
  r.get('/api/admin/feedback', accounts.requireAdmin, wrap(async (_req, res) => res.json(await extras.listFeedback())));
  r.post('/api/admin/feedback/:id/status', accounts.requireAdmin, wrap(async (req, res) => {
    const status = (req.body as { status?: string })?.status === 'done' ? 'done' : 'new';
    res.json({ ok: await extras.setFeedbackStatus(String(req.params.id), status) });
  }));
  r.delete('/api/admin/feedback/:id', accounts.requireAdmin, wrap(async (req, res) => {
    await extras.deleteFeedback(String(req.params.id));
    res.json({ ok: true });
  }));
  r.get('/api/admin/feedback/:id/save', accounts.requireAdmin, wrap(async (req, res) => {
    const save = await extras.feedbackSave(String(req.params.id));
    if (!save) return res.status(404).json({ error: 'No game attached.' });
    res.type('application/json').send(save);
  }));
  r.get('/api/admin/errors', accounts.requireAdmin, wrap(async (_req, res) => res.json(await extras.listErrors())));
  r.delete('/api/admin/errors/:key', accounts.requireAdmin, wrap(async (req, res) => {
    await extras.deleteError(String(req.params.key));
    res.json({ ok: true });
  }));
  r.get('/api/admin/stats', accounts.requireAdmin, wrap(async (_req, res) => res.json(await extras.allStats())));
  return r;
}
