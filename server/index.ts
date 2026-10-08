import compression from 'compression';
import express from 'express';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DevVerifier, SupabaseVerifier } from './accounts/auth';
import { betaRouter } from './accounts/betaRoutes';
import { Accounts } from './accounts/routes';
import { MemoryStore, PgStore } from './accounts/store';
import { betaRequired, requireBeta, statusHandler, unlockHandler } from './beta';
import type { NextFunction, Request, Response } from 'express';
import { tasks, type AiInfo, type AiRequest, type TaskId } from '../shared/ai/tasks';
import { config } from './config';
import { attachMultiplayer } from './multiplayer/socket';
import { PgRoomStore } from './multiplayer/persist';
import { getScenario } from '../src/data/scenarios';
import { QueueRejected } from './llm/queue';
import { LLMService, TimeoutError } from './llm/service';
import { ProviderError } from './llm/types';

const app = express();
// maps are ~2 MB of JSON: gzip makes them about a quarter of that
app.use(compression());
// a saved game is ~120 KB of JSON (more late in a long game)
app.use('/api/saves', express.json({ limit: '4mb' }));
app.use('/api/feedback', express.json({ limit: '4mb' })); // may carry the tester's game
app.use(express.json({ limit: '200kb' }));
// behind a hosting proxy: trust X-Forwarded-For / -Proto for rate limits and secure cookies
if (config.production) app.set('trust proxy', 1);

let llm: LLMService | null = null;
let llmError = '';
try {
  llm = new LLMService();
} catch (e) {
  llmError = (e as Error).message;
  console.error(`[llm] ${llmError}`);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// ---- who may play ------------------------------------------------------------------------------
// accounts (Supabase sign-in + admin approval) when configured; otherwise the beta code, if any;
// otherwise open (local development)
const acc = config.accounts;
const accountsOn = !!(acc.supabaseUrl && acc.supabaseAnonKey) || acc.dev;
let accounts: Accounts | null = null;
let store: MemoryStore | PgStore | null = null;
if (accountsOn) {
  if (config.production && !acc.databaseUrl) console.error('[accounts] DATABASE_URL is not set: accounts and saves will be lost on every restart!');
  store = acc.databaseUrl ? new PgStore(acc.databaseUrl) : new MemoryStore();
  store!.ready().catch((e) => console.error(`[accounts] database: ${(e as Error).message}`));
  const verifier = acc.supabaseUrl && acc.supabaseAnonKey ? new SupabaseVerifier(acc.supabaseUrl, acc.supabaseAnonKey) : new DevVerifier();
  accounts = new Accounts({ store, verifier, admins: acc.admins });
  if (!acc.admins.length) console.warn('[accounts] ADMIN_EMAILS is empty: nobody can approve accounts.');
}
const mode = accounts ? 'accounts' : betaRequired() ? 'beta' : 'open';

app.get('/api/access', (_req, res) => {
  res.json(accounts
    ? { mode, supabaseUrl: acc.supabaseUrl || null, supabaseAnonKey: acc.supabaseAnonKey || null, providers: acc.providers, dev: acc.dev && !acc.supabaseUrl }
    : { mode });
});
const requireAccess = (req: Request, res: Response, next: NextFunction) => (accounts ? accounts.requirePlayer(req, res, next) : requireBeta(req, res, next));
app.get('/api/beta/status', statusHandler);
app.post('/api/beta/unlock', unlockHandler);
if (accounts) app.use(accounts.router(), betaRouter(accounts, store!.extras));
app.use('/api/ai', requireAccess);

app.get('/api/ai/info', (_req, res) => {
  if (!llm) return res.status(503).json({ error: llmError });
  const info: AiInfo = { provider: llm.provider.id, model: llm.provider.model, queueLength: llm.queue.length };
  res.json(info);
});

const MAX_PROMPT = 12_000;

app.post('/api/ai/task', async (req, res) => {
  if (!llm) return res.status(503).json({ error: llmError });
  const body = req.body as Partial<AiRequest>;
  if (!body.task || !(body.task in tasks)) return res.status(400).json({ error: 'Unknown task' });
  if (typeof body.system !== 'string' || typeof body.prompt !== 'string') return res.status(400).json({ error: 'system and prompt are required' });
  if (body.system.length + body.prompt.length > MAX_PROMPT) return res.status(413).json({ error: 'Prompt too long' });
  try {
    const out = await llm.runTask({
      task: body.task as TaskId,
      system: body.system,
      prompt: body.prompt,
      priority: body.priority === 'ai' ? 'ai' : 'player',
      actor: typeof body.actor === 'string' ? body.actor : undefined,
    });
    res.json(out);
  } catch (e) {
    if (e instanceof QueueRejected) return res.status(429).json({ error: e.reason, retryInMs: e.retryInMs });
    if (e instanceof TimeoutError) return res.status(504).json({ error: e.message });
    const status = e instanceof ProviderError ? 502 : 500;
    const msg = (e as Error).name === 'AbortError' ? 'The AI provider timed out' : (e as Error).message;
    console.error(`[llm] ${body.task}: ${msg}`);
    res.status(status).json({ error: msg });
  }
});

// Production: this server also serves the built game (npm run build -> dist/). The maps are only
// served to browsers that unlocked the beta, so the game cannot be played without a code.
const dist = fileURLToPath(new URL('../dist', import.meta.url));
if (config.production && existsSync(dist)) {
  app.use('/maps', requireAccess);
  // maps were compressed at build time (scripts/compress-maps.ts): send the ready-made file
  app.use('/maps', (req, res, next) => {
    if (req.method !== 'GET' || !req.path.endsWith('.json') || req.path.includes('..')) return next();
    const file = path.join(dist, 'maps', req.path);
    const accept = String(req.headers['accept-encoding'] ?? '');
    const enc = /br/.test(accept) && existsSync(`${file}.br`) ? 'br' : /gzip/.test(accept) && existsSync(`${file}.gz`) ? 'gzip' : null;
    if (!enc || !existsSync(file)) return next();
    const packed = `${file}.${enc === 'br' ? 'br' : 'gz'}`;
    const stat = statSync(packed);
    const etag = `"${enc}-${stat.size}-${Math.round(stat.mtimeMs)}"`;
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Encoding', enc);
    res.setHeader('Content-Length', String(stat.size));
    // the loading bar needs the real size, which a compressed response hides
    res.setHeader('x-raw-length', String(statSync(file).size));
    createReadStream(packed).pipe(res);
  });
  app.use(express.static(dist, {
    index: 'index.html',
    // the page and the service worker are checked on every visit (so updates arrive at once);
    // game code under /assets/ is named by its content and never changes
    setHeaders: (res, file, stat) => {
      if (file.endsWith('.json')) res.setHeader('x-raw-length', String(stat.size));
      if (/[\/]assets[\/]/.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else if (file.endsWith('.html') || file.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
      else if (file.endsWith('.json')) res.setHeader('Cache-Control', 'private, no-cache');
      else res.setHeader('Cache-Control', 'public, max-age=86400');
    },
  }));
  app.get('/{*path}', (_req, res) => res.sendFile('index.html', { root: dist, headers: { 'Cache-Control': 'no-cache' } }));
}

const httpServer = app.listen(config.port, () => {
  console.log(`[server] http://localhost:${config.port}  multiplayer=${accounts ? 'on' : 'off (needs accounts)'}  access=${mode}${accounts ? `(${acc.databaseUrl ? 'postgres' : 'memory'}${acc.dev && !acc.supabaseUrl ? ', dev sign-in' : ''})` : ''}  ai=${llm ? `${llm.provider.id}/${llm.provider.model}` : `unavailable (${llmError})`}`);
});

// ---- multiplayer --------------------------------------------------------------------------------
// players sign in with the same token as the API (approved accounts with a username only)
if (accounts) {
  const a = accounts;
  attachMultiplayer(httpServer, async (token) => {
    const c = await a.callerFromToken(token);
    if (!c) return { error: 'Sign in to play online.' };
    if (c.profile.status !== 'approved') return { error: 'Your account is waiting for approval.' };
    if (!c.profile.username) return { error: 'Choose a username first.' };
    return { userId: c.profile.id, username: c.profile.username, admin: c.admin };
  }, (scenarioId) => {
    const t = getScenario(scenarioId)?.time;
    return t ? (t.secondsPerTurn * t.tickHours) / t.turnHours : null;
  }, store instanceof PgStore ? new PgRoomStore(store.db) : undefined);
}
