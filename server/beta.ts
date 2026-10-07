import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config';

/**
 * Beta access. When BETA_CODES is set, players must enter one of the codes once; the server then
 * sets an httpOnly cookie holding a signature of that code (never the code itself). Without the
 * cookie the AI endpoints and the map files are refused, so the game cannot be played or the AI
 * used by someone who only knows the URL. Removing a code from BETA_CODES revokes its testers.
 */
const COOKIE = 'wr_beta';
const YEAR_S = 365 * 24 * 3600;

const sign = (code: string) => createHmac('sha256', config.beta.secret).update(code).digest('base64url');
const validTokens = () => new Set(config.beta.codes.map(sign));

export const betaRequired = () => config.beta.codes.length > 0;

function cookieToken(req: Request): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function isUnlocked(req: Request): boolean {
  if (!betaRequired()) return true;
  const t = cookieToken(req);
  return !!t && validTokens().has(t);
}

/** Constant-time comparison against every configured code. */
function matchCode(input: string): string | null {
  const a = Buffer.from(input.trim().toUpperCase());
  let hit: string | null = null;
  for (const code of config.beta.codes) {
    const b = Buffer.from(code);
    if (a.length === b.length && timingSafeEqual(a, b)) hit = code;
  }
  return hit;
}

// at most 8 wrong guesses per address every 15 minutes
const attempts = new Map<string, { n: number; until: number }>();
const WINDOW_MS = 15 * 60_000, MAX_FAILS = 8;

export function unlockHandler(req: Request, res: Response) {
  if (!betaRequired()) return res.json({ ok: true });
  const ip = req.ip ?? 'unknown';
  const now = Date.now();
  const rec = attempts.get(ip);
  if (rec && rec.until > now && rec.n >= MAX_FAILS) {
    return res.status(429).json({ error: `Too many attempts. Try again in ${Math.ceil((rec.until - now) / 60_000)} min.` });
  }
  const code = typeof req.body?.code === 'string' ? matchCode(req.body.code.slice(0, 64)) : null;
  if (!code) {
    const cur = rec && rec.until > now ? rec : { n: 0, until: now + WINDOW_MS };
    attempts.set(ip, { ...cur, n: cur.n + 1 });
    return res.status(403).json({ error: 'That code is not valid.' });
  }
  attempts.delete(ip);
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(sign(code))}; Path=/; Max-Age=${YEAR_S}; HttpOnly; SameSite=Lax${secure}`);
  res.json({ ok: true });
}

export function statusHandler(req: Request, res: Response) {
  res.json({ required: betaRequired(), unlocked: isUnlocked(req) });
}

/** Middleware: refuse the request unless this browser has unlocked the beta. */
export function requireBeta(req: Request, res: Response, next: NextFunction) {
  if (isUnlocked(req)) return next();
  res.status(401).json({ error: 'Beta access code required.' });
}
