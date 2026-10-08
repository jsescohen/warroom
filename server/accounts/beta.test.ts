import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DevVerifier } from './auth';
import { betaRouter } from './betaRoutes';
import { Accounts } from './routes';
import { MemoryStore } from './store';

let base = '';
let close: () => void;
beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  const store = new MemoryStore();
  const accounts = new Accounts({ store, verifier: new DevVerifier(), admins: ['boss@war.test'] });
  app.use(accounts.router(), betaRouter(accounts, store.extras));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
  // one approved player with a username, and the admin
  for (const [email, name] of [['boss@war.test', 'Boss'], ['ana@war.test', 'Ana']]) {
    await call('/api/me', email);
    await call('/api/me/username', email, { method: 'PUT', body: JSON.stringify({ username: name }) });
  }
  const users = (await call('/api/admin/users', 'boss@war.test')).body as { id: string; email: string }[];
  await call(`/api/admin/users/${users.find((u) => u.email === 'ana@war.test')!.id}/status`, 'boss@war.test', { method: 'POST', body: JSON.stringify({ status: 'approved' }) });
});
afterAll(() => close());

async function call(path: string, as?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (as) headers.set('authorization', `Bearer dev:${as}`);
  if (init.body) headers.set('content-type', 'application/json');
  const res = await fetch(base + path, { ...init, headers });
  const text = await res.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

describe('beta tooling', () => {
  it('delivers feedback with the attached game to the admin', async () => {
    expect((await call('/api/feedback', undefined, { method: 'POST', body: JSON.stringify({ text: 'hi' }) })).status).toBe(401);
    const sent = await call('/api/feedback', 'ana@war.test', { method: 'POST', body: JSON.stringify({ category: 'bug', text: 'My army vanished at Warsaw', context: { scenarioId: 'ww2' }, save: { id: 'x', state: { version: 1 } } }) });
    expect(sent.body).toMatchObject({ category: 'bug', username: 'Ana', hasSave: true, status: 'new' });
    const list = (await call('/api/admin/feedback', 'boss@war.test')).body as { id: string; text: string }[];
    expect(list[0].text).toBe('My army vanished at Warsaw');
    expect((await call(`/api/admin/feedback/${list[0].id}/save`, 'boss@war.test')).body).toMatchObject({ id: 'x' });
    expect((await call('/api/admin/feedback', 'ana@war.test')).status).toBe(403);
    await call(`/api/admin/feedback/${list[0].id}/status`, 'boss@war.test', { method: 'POST', body: JSON.stringify({ status: 'done' }) });
    expect(((await call('/api/admin/feedback', 'boss@war.test')).body as { status: string }[])[0].status).toBe('done');
  });

  it('groups the same error from different players', async () => {
    const err = { message: 'TypeError: x is undefined', stack: 'TypeError: x is undefined\n    at draw (https://site/assets/index-abc.js:1:200)' };
    await call('/api/errors', undefined, { method: 'POST', body: JSON.stringify(err) });
    await call('/api/errors', 'ana@war.test', { method: 'POST', body: JSON.stringify(err) });
    const errors = (await call('/api/admin/errors', 'boss@war.test')).body as { count: number; lastUser: string }[];
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ count: 2, lastUser: 'Ana' });
  });

  it('adds up play time and results, and keeps achievements', async () => {
    await call('/api/stats', 'ana@war.test', { method: 'POST', body: JSON.stringify({ type: 'start', scenarioId: 'ww2', nation: 'France' }) });
    await call('/api/stats', 'ana@war.test', { method: 'POST', body: JSON.stringify({ type: 'time', scenarioId: 'ww2', seconds: 60 }) });
    await call('/api/stats', 'ana@war.test', { method: 'POST', body: JSON.stringify({ type: 'time', scenarioId: 'ww2', seconds: 99999 }) }); // capped
    await call('/api/stats', 'ana@war.test', { method: 'POST', body: JSON.stringify({ type: 'end', scenarioId: 'ww2', result: 'victory' }) });
    const unlocked = await call('/api/achievements', 'ana@war.test', { method: 'POST', body: JSON.stringify({ ids: ['first-blood', 'made-up', 'win-ww2'] }) });
    expect(unlocked.body).toEqual({ unlocked: ['first-blood', 'win-ww2'] });
    expect((await call('/api/achievements', 'ana@war.test', { method: 'POST', body: JSON.stringify({ ids: ['first-blood'] }) })).body).toEqual({ unlocked: [] });
    const profile = (await call('/api/me/profile', 'ana@war.test')).body as { stats: Record<string, unknown>; achievements: Record<string, number> };
    expect(profile.stats).toMatchObject({ games: 1, playtimeS: 180, victories: 1, nations: { France: 1 }, eras: { ww2: { games: 1, playtimeS: 180, victories: 1 } } });
    expect(Object.keys(profile.achievements).sort()).toEqual(['first-blood', 'win-ww2']);
  });
});
