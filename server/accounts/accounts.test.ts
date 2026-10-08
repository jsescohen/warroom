import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DevVerifier } from './auth';
import { Accounts } from './routes';
import { MemoryStore } from './store';

let base = '';
let close: () => void;
beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  const accounts = new Accounts({ store: new MemoryStore(), verifier: new DevVerifier(), admins: ['boss@war.test'] });
  app.use(accounts.router());
  app.get('/api/ai/info', accounts.requirePlayer, (_req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
afterAll(() => close());

const call = async (path: string, as?: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  if (as) headers.set('authorization', `Bearer dev:${as}`);
  if (init.body) headers.set('content-type', 'application/json');
  const res = await fetch(base + path, { ...init, headers });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const named = async (email: string, username: string) => {
  await call('/api/me', email);
  return call('/api/me/username', email, { method: 'PUT', body: JSON.stringify({ username }) });
};
const save = (id: string) => ({ id, name: 'Test', scenarioId: 'ww2', savedAt: Date.now(), format: 1, state: { version: 1 } });

describe('accounts', () => {
  it('turns away anyone not signed in', async () => {
    expect((await call('/api/me')).status).toBe(401);
    expect((await call('/api/ai/info')).status).toBe(401);
    expect((await call('/api/saves')).status).toBe(401);
  });

  it('lets new players in only once the admin approves them', async () => {
    const me = await call('/api/me', 'newbie@war.test');
    expect(me.body).toMatchObject({ email: 'newbie@war.test', status: 'pending', admin: false, username: null });
    await named('newbie@war.test', 'Newbie');
    expect((await call('/api/ai/info', 'newbie@war.test')).status).toBe(403);
    expect((await call('/api/admin/users', 'newbie@war.test')).status).toBe(403);

    // the admin is let in automatically and sees the request
    expect((await call('/api/me', 'boss@war.test')).body).toMatchObject({ status: 'approved', admin: true });
    await named('boss@war.test', 'Boss');
    const users = (await call('/api/admin/users', 'boss@war.test')).body as { id: string; email: string; status: string }[];
    const newbie = users.find((u) => u.email === 'newbie@war.test')!;
    expect(newbie.status).toBe('pending');
    expect((await call(`/api/admin/users/${newbie.id}/status`, 'boss@war.test', { method: 'POST', body: JSON.stringify({ status: 'approved' }) })).status).toBe(200);
    expect((await call('/api/ai/info', 'newbie@war.test')).status).toBe(200);

    // blocking takes effect at once; the admin cannot be blocked
    await call(`/api/admin/users/${newbie.id}/status`, 'boss@war.test', { method: 'POST', body: JSON.stringify({ status: 'rejected' }) });
    expect((await call('/api/ai/info', 'newbie@war.test')).status).toBe(403);
    const boss = users.find((u) => u.email === 'boss@war.test')!;
    expect((await call(`/api/admin/users/${boss.id}/status`, 'boss@war.test', { method: 'POST', body: JSON.stringify({ status: 'rejected' }) })).status).toBe(400);
  });

  it('keeps each player’s saves in their account, readable by the admin', async () => {
    await named('pat@war.test', 'Pat');
    const users = (await call('/api/admin/users', 'boss@war.test')).body as { id: string; email: string }[];
    const pat = users.find((u) => u.email === 'pat@war.test')!;
    await call(`/api/admin/users/${pat.id}/status`, 'boss@war.test', { method: 'POST', body: JSON.stringify({ status: 'approved' }) });

    expect((await call('/api/saves/s1', 'pat@war.test', { method: 'PUT', body: JSON.stringify(save('s1')) })).status).toBe(200);
    expect((await call('/api/saves/s2', 'pat@war.test', { method: 'PUT', body: JSON.stringify(save('wrong-id')) })).status).toBe(400);
    const list = (await call('/api/saves', 'pat@war.test')).body as { id: string; state?: unknown }[];
    expect(list.map((m) => m.id)).toEqual(['s1']);
    expect(list[0].state).toBeUndefined(); // the list is metadata only
    expect((await call('/api/saves/s1', 'pat@war.test')).body).toMatchObject({ id: 's1', state: { version: 1 } });
    // another player cannot see them; the admin can
    expect((await call('/api/saves', 'boss@war.test')).body).toEqual([]);
    expect((await call(`/api/admin/users/${pat.id}/saves/s1`, 'boss@war.test')).body).toMatchObject({ id: 's1' });
    expect((await call('/api/saves/s1', 'pat@war.test', { method: 'DELETE' })).status).toBe(200);
    expect((await call('/api/saves/s1', 'pat@war.test')).status).toBe(404);
  });
  it('gives every player a unique, valid username before they can play', async () => {
    await call('/api/me', 'sam@war.test');
    const users = (await call('/api/admin/users', 'boss@war.test')).body as { id: string; email: string }[];
    const sam = users.find((u) => u.email === 'sam@war.test')!;
    await call('/api/admin/users/' + sam.id + '/status', 'boss@war.test', { method: 'POST', body: JSON.stringify({ status: 'approved' }) });
    expect((await call('/api/ai/info', 'sam@war.test')).body).toMatchObject({ error: 'Choose a username first.' });
    expect((await named('sam@war.test', 'x')).status).toBe(400);
    expect((await named('sam@war.test', 'admin')).status).toBe(400);
    expect((await named('sam@war.test', 'pAt')).status).toBe(409); // taken, ignoring case
    expect((await named('sam@war.test', 'Sam_1939')).body).toMatchObject({ username: 'Sam_1939' });
    expect((await call('/api/ai/info', 'sam@war.test')).status).toBe(200);
    // the admin can rename an account
    const renamed = await call('/api/admin/users/' + sam.id + '/username', 'boss@war.test', { method: 'POST', body: JSON.stringify({ username: 'Samuel' }) });
    expect(renamed.body).toMatchObject({ username: 'Samuel' });
    expect((await call('/api/admin/users/' + sam.id + '/username', 'sam@war.test', { method: 'POST', body: JSON.stringify({ username: 'Hacker' }) })).status).toBe(403);
  });
});
