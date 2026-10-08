import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { usernameError } from '../../shared/accounts/username';
import type { Verifier } from './auth';
import { MAX_SAVES_PER_USER, type AccountStatus, type AccountStore, type Profile, type SaveMetaJson } from './store';

/**
 * Accounts: every player signs in; new accounts wait until the admin approves them. Admins are
 * the accounts whose email is listed in ADMIN_EMAILS (approved automatically). Approved players
 * keep their saves in the cloud; admins can review accounts and open anyone's saves read-only.
 */

export interface AccountsOptions {
  store: AccountStore;
  verifier: Verifier;
  admins: string[];
}

export interface Caller {
  profile: Profile;
  admin: boolean;
}

const bearer = (req: Request) => /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]?.trim();

export class Accounts {
  private touched = new Map<string, number>();
  constructor(private o: AccountsOptions) {}

  isAdminEmail = (email: string) => this.o.admins.includes(email.toLowerCase());

  /** The signed-in caller, creating their account on first sight. Null when not signed in. */
  async caller(req: Request): Promise<Caller | null> {
    const token = bearer(req);
    return token ? this.callerFromToken(token) : null;
  }

  /** As caller(), from a bare token (multiplayer connections sign in with their first message). */
  async callerFromToken(token: string): Promise<Caller | null> {
    const user = await this.o.verifier.verify(token);
    if (!user) return null;
    const admin = this.isAdminEmail(user.email);
    let profile = await this.o.store.getProfile(user.id);
    const now = Date.now();
    // create on first sign-in; refresh name, picture and "last seen" at most every few minutes
    if (!profile || now - (this.touched.get(user.id) ?? 0) > 5 * 60_000) {
      profile = await this.o.store.upsertProfile(user, admin ? 'approved' : 'pending');
      this.touched.set(user.id, now);
    }
    if (admin && profile.status !== 'approved') profile = (await this.o.store.setStatus(user.id, 'approved')) ?? profile;
    return { profile, admin };
  }

  /** Middleware: only approved players (and admins) get through. */
  requirePlayer = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const c = await this.caller(req);
      if (!c) return res.status(401).json({ error: 'Sign in to play.' });
      if (c.profile.status !== 'approved') return res.status(403).json({ error: 'Your account is waiting for approval.' });
      if (!c.profile.username) return res.status(403).json({ error: 'Choose a username first.' });
      res.locals.caller = c;
      next();
    } catch (e) {
      next(e);
    }
  };

  requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const c = await this.caller(req);
      if (!c?.admin) return res.status(c ? 403 : 401).json({ error: 'Admins only.' });
      res.locals.caller = c;
      next();
    } catch (e) {
      next(e);
    }
  };

  /** Validates and sets a username; returns an error message instead when it cannot. */
  private async rename(id: string, raw: unknown): Promise<Profile | string> {
    const username = typeof raw === 'string' ? raw.trim() : '';
    const err = usernameError(username);
    if (err) return err;
    const out = await this.o.store.setUsername(id, username);
    if (out === 'taken') return 'That username is taken.';
    return out ?? 'No such account.';
  }

  router(): Router {
    const r = express.Router();
    const { store } = this.o;
    const me = (res: Response) => (res.locals.caller as Caller).profile.id;
    const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

    // who am I, and may I play?
    r.get('/api/me', wrap(async (req, res) => {
      const c = await this.caller(req);
      if (!c) return res.status(401).json({ error: 'Not signed in.' });
      res.json({ ...publicProfile(c.profile), admin: c.admin });
    }));

    r.put('/api/me/username', wrap(async (req, res) => {
      const c = await this.caller(req);
      if (!c) return res.status(401).json({ error: 'Not signed in.' });
      const out = await this.rename(c.profile.id, (req.body as { username?: unknown })?.username);
      if (typeof out === 'string') return res.status(out.includes('taken') ? 409 : 400).json({ error: out });
      res.json({ ...publicProfile(out), admin: c.admin });
    }));

    // ---- cloud saves (the caller's own) -------------------------------------------------------
    r.get('/api/saves', this.requirePlayer, wrap(async (_req, res) => res.json(await store.listSaves(me(res)))));
    r.get('/api/saves/:id', this.requirePlayer, wrap(async (req, res) => {
      const s = await store.getSave(me(res), String(req.params.id));
      if (!s) return res.status(404).json({ error: 'That save no longer exists.' });
      res.type('application/json').send(s.data);
    }));
    r.put('/api/saves/:id', this.requirePlayer, wrap(async (req, res) => {
      const rec = req.body as { id?: unknown; savedAt?: unknown; state?: unknown } & Record<string, unknown>;
      if (!rec || rec.id !== req.params.id || typeof rec.savedAt !== 'number' || !rec.state) return res.status(400).json({ error: 'Not a save.' });
      const user = me(res);
      const existing = await store.listSaves(user);
      if (!existing.some((m) => m.id === rec.id) && existing.length >= MAX_SAVES_PER_USER) {
        return res.status(409).json({ error: `You have ${MAX_SAVES_PER_USER} saves already: delete an old one first.` });
      }
      const { state: _, ...meta } = rec;
      await store.putSave(user, { meta: meta as SaveMetaJson, data: JSON.stringify(rec) });
      res.json(meta);
    }));
    r.delete('/api/saves/:id', this.requirePlayer, wrap(async (req, res) => {
      await store.deleteSave(me(res), String(req.params.id));
      res.json({ ok: true });
    }));
    r.delete('/api/saves', this.requirePlayer, wrap(async (_req, res) => {
      await store.clearSaves(me(res));
      res.json({ ok: true });
    }));

    // ---- admin --------------------------------------------------------------------------------
    r.get('/api/admin/users', this.requireAdmin, wrap(async (_req, res) => {
      const [profiles, counts] = await Promise.all([store.listProfiles(), store.countSaves()]);
      res.json(profiles.map((p) => ({ ...publicProfile(p), admin: this.isAdminEmail(p.email), saves: counts[p.id] ?? 0 })));
    }));
    r.post('/api/admin/users/:id/status', this.requireAdmin, wrap(async (req, res) => {
      const status = (req.body as { status?: string })?.status as AccountStatus;
      if (!['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Unknown status.' });
      const target = await store.getProfile(String(req.params.id));
      if (!target) return res.status(404).json({ error: 'No such account.' });
      if (this.isAdminEmail(target.email)) return res.status(400).json({ error: 'Admin accounts are always approved.' });
      const p = await store.setStatus(target.id, status);
      res.json(publicProfile(p!));
    }));
    r.post('/api/admin/users/:id/username', this.requireAdmin, wrap(async (req, res) => {
      const out = await this.rename(String(req.params.id), (req.body as { username?: unknown })?.username);
      if (typeof out === 'string') return res.status(out.includes('taken') ? 409 : out === 'No such account.' ? 404 : 400).json({ error: out });
      res.json(publicProfile(out));
    }));
    r.get('/api/admin/users/:id/saves', this.requireAdmin, wrap(async (req, res) => res.json(await store.listSaves(String(req.params.id)))));
    r.get('/api/admin/users/:id/saves/:sid', this.requireAdmin, wrap(async (req, res) => {
      const s = await store.getSave(String(req.params.id), String(req.params.sid));
      if (!s) return res.status(404).json({ error: 'That save no longer exists.' });
      res.type('application/json').send(s.data);
    }));
    return r;
  }
}

const publicProfile = (p: Profile) => ({ id: p.id, email: p.email, username: p.username, name: p.name, avatar: p.avatar, status: p.status, createdAt: p.createdAt, lastSeen: p.lastSeen });
