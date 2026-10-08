import { describe, expect, it } from 'vitest';
import { stateHash } from '../../shared/multiplayer/protocol';
import type { Command } from './actions';
import { fresh, world } from './fixture.test-util';
import { GameStore } from './store';

/** Two players' browsers: each its own copy of the game, fed the same stream. */
const twoCopies = () => {
  const a = new GameStore(fresh(), world), b = new GameStore(fresh(), world);
  const sent: Command[] = [];
  a.viewAs = 'GER'; b.viewAs = 'FRA';
  a.remote = (c) => sent.push(c); b.remote = (c) => sent.push(c);
  const stream = (cmd: Command) => { a.applyRemote(cmd); b.applyRemote(cmd); };
  return { a, b, sent, stream };
};

describe('multiplayer', () => {
  it('both copies stay identical, and each player sees the game as their own nation', () => {
    const { a, b, sent, stream } = twoCopies();
    stream({ actor: 'system', action: { type: 'setPlayers', nations: ['GER', 'FRA'], difficulty: 'normal', economy: 'simple' } });
    expect(a.shared.humans).toEqual(['FRA', 'GER']);
    expect(a.state.playerNation).toBe('GER');
    expect(b.state.playerNation).toBe('FRA');
    // an order goes to the server, not into the game, until it comes back in the stream
    const army = Object.values(a.state.armies).find((x) => x.owner === 'GER')!;
    expect(a.dispatch({ type: 'stopArmy', army: army.id }, 'GER').ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(a.dispatch({ type: 'tick' }, 'system').ok).toBe(false);
    for (let i = 0; i < 40; i++) stream(i === 3 ? sent[0] : { actor: 'system', action: { type: 'tick' } });
    expect(stateHash(a.shared)).toBe(stateHash(b.shared));
    expect(a.shared.clock.hours).toBe(39 * a.shared.clock.tickHours);
  });

  it('the AI never commands a player’s nation', () => {
    const { a, stream } = twoCopies();
    stream({ actor: 'system', action: { type: 'setPlayers', nations: ['GER', 'FRA'] } });
    const before = Object.values(a.shared.armies).filter((x) => x.owner === 'FRA').map((x) => x.id + x.location).sort();
    for (let i = 0; i < 4 * 20; i++) stream({ actor: 'system', action: { type: 'tick' } });
    const after = Object.values(a.shared.armies).filter((x) => x.owner === 'FRA' && !x.path.length).map((x) => x.id + x.location).sort();
    // French armies only move if a player orders them (none did): every one is where it was
    expect(after.filter((x) => before.includes(x)).length).toBe(before.length);
  });

  it('orders wait for the shared stream (dispatchSync)', async () => {
    const { a, sent } = twoCopies();
    a.applyRemote({ actor: 'system', action: { type: 'setPlayers', nations: ['GER'] } });
    const p = a.dispatchSync({ type: 'chat', with: 'ITA', text: 'Hello' }, 'GER');
    expect(a.shared.diplomacy.chats).toEqual({});
    a.applyRemote(JSON.parse(JSON.stringify(sent[0])));
    await expect(p).resolves.toEqual({ ok: true });
    expect(Object.values(a.shared.diplomacy.chats)[0][0].text).toBe('Hello');
  });
});
