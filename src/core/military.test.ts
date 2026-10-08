import { describe, expect, it } from 'vitest';
import { mergeable, reduce, validate, type Action } from './actions';
import { byName, fresh, world } from './fixture.test-util';
import { findPath } from './military';
import { armiesIn, atWar, provincesOf } from './state';
import type { GameState } from './types';

const act = (s: GameState, action: Action, actor: string) => {
  const err = validate(s, { action, actor }, world);
  if (err) throw new Error(err);
  return reduce(s, { action, actor }, world);
};
const tick = (s: GameState, n = 1) => {
  for (let i = 0; i < n; i++) s = reduce(s, { action: { type: 'tick' }, actor: 'system' }, world);
  return s;
};
const armiesOf = (s: GameState, n: string) => Object.values(s.armies).filter((a) => a.owner === n);
const reachable = (from: string) => {
  const seen = new Set([from]);
  const stack = [from];
  while (stack.length) for (const l of world.provinces[stack.pop()!].links) if (!seen.has(l.to)) { seen.add(l.to); stack.push(l.to); }
  return seen;
};

describe('world graph', () => {
  it('links Britain to the continent and Japan to Korea by sea', () => {
    const fromLondon = reachable(byName('London').id);
    expect(fromLondon.has(byName('Paris').id)).toBe(true);
    expect(reachable(byName('Tokyo').id).has(byName('Seoul').id)).toBe(true);
  });

  it('has symmetric links', () => {
    for (const p of Object.values(world.provinces)) for (const l of p.links) expect(world.provinces[l.to].links.some((b) => b.to === p.id)).toBe(true);
  });
});

describe('starting armies', () => {
  const s = fresh();
  it('every nation has at least one army and majors have more', () => {
    for (const n of Object.values(s.nations)) expect(armiesOf(s, n.id).length).toBeGreaterThan(0);
    expect(armiesOf(s, 'GER').length).toBeGreaterThan(armiesOf(s, 'POL').length);
  });
  it('a capital is garrisoned', () => {
    expect(armiesIn(s, s.nations.GER.capital!).some((a) => a.owner === 'GER')).toBe(true);
  });
});

describe('orders', () => {
  it('cannot march into a neutral country', () => {
    const s = fresh();
    const a = armiesOf(s, 'GER')[0];
    expect(validate(s, { action: { type: 'moveArmy', army: a.id, to: byName('Paris').id }, actor: 'GER' }, world)).toMatch(/not at war/);
  });

  it('cannot command another nation’s army', () => {
    const s = fresh();
    const a = armiesOf(s, 'POL')[0];
    expect(validate(s, { action: { type: 'stopArmy', army: a.id }, actor: 'GER' }, world)).not.toBeNull();
  });

  it('finds a route into Poland', () => {
    const s = fresh();
    const a = armiesOf(s, 'GER')[0];
    const r = findPath(s, world, 'GER', a.unitType, a.location, byName('Warsaw').id)!;
    expect(r.path.at(-1)).toBe(byName('Warsaw').id);
    expect(r.hours).toBeGreaterThan(0);
  });

  it('split then merge restores strength', () => {
    let s = fresh();
    const a = armiesOf(s, 'GER')[0];
    // armies of the same type already standing with it merge in as well
    const partners = mergeable(s, a.id).reduce((x, b) => x + b.strength, 0);
    s = act(s, { type: 'splitArmy', army: a.id }, 'GER');
    expect(armiesOf(s, 'GER').length).toBe(armiesOf(fresh(), 'GER').length + 1);
    s = act(s, { type: 'mergeArmies', army: a.id }, 'GER');
    expect(s.armies[a.id].strength).toBeCloseTo(a.strength + partners);
  });
});

describe('invasion', () => {
  it('German armies sent at Warsaw fight, capture provinces, and the game stays deterministic', { timeout: 60_000 }, () => {
    const run = () => {
      let s = act(fresh(), { type: 'chooseNation', nation: 'GER' }, 'GER'); // player-controlled, so the AI leaves these orders alone
      const warsaw = byName('Warsaw').id;
      for (const a of armiesOf(s, 'GER')) {
        if (validate(s, { action: { type: 'moveArmy', army: a.id, to: warsaw }, actor: 'GER' }, world) === null)
          s = act(s, { type: 'moveArmy', army: a.id, to: warsaw }, 'GER');
      }
      return tick(s, 4 * 40); // 40 days
    };
    const s = run();
    // Poland loses ground (an all-in eastern push also leaves the Rhine open to the Allied AI)
    expect(provincesOf(s, 'POL').length).toBeLessThan(provincesOf(fresh(), 'POL').length);
    expect(s.events.some((e) => e.kind === 'capital' || e.kind === 'annexed')).toBe(true);
    expect(JSON.stringify(run())).toBe(JSON.stringify(s));
  });

  it('a lone army takes an undefended enemy province', () => {
    let s = fresh();
    // clear the Polish army out of one border province, then walk in
    const target = Object.keys(s.provinces).find((p) =>
      s.provinces[p].owner === 'POL' && world.provinces[p].links.some((l) => s.provinces[l.to].owner === 'GER'))!;
    s = { ...s, armies: Object.fromEntries(Object.entries(s.armies).filter(([, a]) => a.owner !== 'POL')) };
    const from = world.provinces[target].links.find((l) => s.provinces[l.to].owner === 'GER')!.to;
    const a = armiesOf(s, 'GER')[0];
    s = { ...s, armies: { ...s.armies, [a.id]: { ...a, location: from, path: [], progress: 0 } } };
    s = act(s, { type: 'moveArmy', army: a.id, to: target }, 'GER');
    s = tick(s, 4 * 6);
    expect(s.provinces[target].owner).toBe('GER');
    expect(atWar(s, 'GER', 'POL')).toBe(true);
  });
});
