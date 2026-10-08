import { describe, expect, it } from 'vitest';
import { reduce, validate, type Action } from './actions';
import { budgetOf, initEconomy, manpowerCap, recruitCost, armyCount } from './economy';
import { byName, fresh, world } from './fixture.test-util';
import { setOwner } from './military';
import { basePop, popOf } from './population';
import type { GameState } from './types';

const act = (s: GameState, action: Action, actor: string) => reduce(s, { action, actor }, world);
const tick = (s: GameState, n: number) => {
  for (let i = 0; i < n; i++) s = reduce(s, { action: { type: 'tick' }, actor: 'system' }, world);
  return s;
};
const id = (name: string) => byName(name).id;
const rich = (s: GameState, n: string, treasury = 500): GameState => ({ ...s, nations: { ...s.nations, [n]: { ...s.nations[n], treasury } } });

describe('economy', () => {
  it('starts every nation with money and barracks at its capital', () => {
    const s = fresh();
    for (const n of Object.values(s.nations).filter((x) => x.alive)) {
      expect(n.treasury).toBeGreaterThan(0);
      expect(s.provinces[n.capital!].build).toContain('barracks');
    }
    expect(s.provinces[id('Berlin')].build).toContain('airfield');
    expect(Object.values(world.provinces).some((p) => p.resource === 'oil')).toBe(true);
  });

  it('recruits at a barracks for money; troops start under strength', () => {
    let s = rich(act(fresh(), { type: 'chooseNation', nation: 'FRA' }, 'FRA'), 'FRA');
    const paris = id('Paris');
    const before = armyCount(s, world, 'FRA');
    const cost = recruitCost(s, world, 'FRA', 'infantry');
    s = act(s, { type: 'recruit', province: paris, unitType: 'infantry' }, 'FRA');
    expect(armyCount(s, world, 'FRA')).toBe(before + 1);
    expect(s.nations.FRA.treasury).toBe(500 - cost);
    const recruit = s.armies[`a${s.nextId - 1}`];
    expect(recruit.strength).toBeLessThan(recruit.maxStrength);
    // no barracks, no airfield, no money: refused
    const lyon = Object.keys(s.provinces).find((p) => s.provinces[p].owner === 'FRA' && !s.provinces[p].build)!;
    expect(validate(s, { action: { type: 'recruit', province: lyon, unitType: 'infantry' }, actor: 'FRA' }, world)).toMatch(/barracks/);
    expect(validate(s, { action: { type: 'recruit', province: paris, unitType: 'infantry' }, actor: 'GER' }, world)).toMatch(/own provinces/);
    const broke = rich(s, 'FRA', 1);
    expect(validate(broke, { action: { type: 'recruit', province: paris, unitType: 'infantry' }, actor: 'FRA' }, world)).toMatch(/treasury/);
  });

  it('units without their resource cost more', () => {
    const s = fresh();
    // France has no oil of its own in 1939: tanks cost half as much again
    expect(recruitCost(s, world, 'FRA', 'armor')).toBeGreaterThan(recruitCost(s, world, 'SOV', 'armor'));
  });

  it('builds for money and caps armies at the manpower limit', () => {
    let s = rich(act(fresh(), { type: 'chooseNation', nation: 'FRA' }, 'FRA'), 'FRA');
    const lyon = Object.keys(s.provinces).find((p) => s.provinces[p].owner === 'FRA' && !s.provinces[p].build)!;
    s = act(s, { type: 'build', province: lyon, building: 'barracks' }, 'FRA');
    expect(s.provinces[lyon].build).toEqual(['barracks']);
    expect(validate(s, { action: { type: 'build', province: lyon, building: 'barracks' }, actor: 'FRA' }, world)).toMatch(/already/);
    s = rich(s, 'FRA', 1e6);
    const cap = manpowerCap(s, world, 'FRA');
    while (armyCount(s, world, 'FRA') < cap) s = act(s, { type: 'recruit', province: lyon, unitType: 'infantry' }, 'FRA');
    expect(validate(s, { action: { type: 'recruit', province: lyon, unitType: 'infantry' }, actor: 'FRA' }, world)).toMatch(/manpower/);
  });

  it('settles income and upkeep every month', () => {
    let s = act(fresh(), { type: 'chooseNation', nation: 'SWE' }, 'SWE');
    const before = s.nations.SWE.treasury!;
    const net = budgetOf(s, world, 'SWE').net;
    s = tick(s, 4 * 30);
    expect(s.nations.SWE.treasury).toBeCloseTo(before + net, 0);
  });

  it('brings saves from before the economy up to date', () => {
    const s = fresh();
    const old: GameState = {
      ...s,
      nations: Object.fromEntries(Object.entries(s.nations).map(([k, n]) => { const { treasury: _, ...rest } = n; return [k, rest]; })),
      provinces: Object.fromEntries(Object.entries(s.provinces).map(([k, p]) => { const { build: _, ...rest } = p; return [k, rest]; })),
    };
    const fixed = initEconomy(old, world);
    expect(fixed.nations.GER.treasury).toBeGreaterThan(0);
    expect(fixed.provinces[id('Berlin')].build).toContain('barracks');
  });
});

describe('trade', () => {
  it('a trade agreement gives access to a resource and moves money every month', () => {
    let s = act(fresh(), { type: 'chooseNation', nation: 'FRA' }, 'FRA');
    const terms = { type: 'trade' as const, from: 'FRA', to: 'ROM', buy: 'oil', gold: 5 };
    expect(validate(s, { action: { type: 'propose', terms }, actor: 'FRA' }, world)).toBeNull();
    const cheaperBefore = recruitCost(s, world, 'FRA', 'armor');
    s = act(s, { type: 'propose', terms }, 'FRA');
    s = act(s, { type: 'respond', proposal: s.proposals[s.proposals.length - 1].id, accept: true }, 'ROM');
    expect(s.treaties.some((t) => t.type === 'trade')).toBe(true);
    expect(recruitCost(s, world, 'FRA', 'armor')).toBeLessThan(cheaperBefore);
    expect(budgetOf(s, world, 'FRA').trade).toBe(-5);
    expect(budgetOf(s, world, 'ROM').trade).toBe(5);
  });
});

describe('detailed economy', () => {
  it('stockpiles run out and units without supplies fight weaker', () => {
    let s = act(fresh(), { type: 'chooseNation', nation: 'FRA', economy: 'detailed' }, 'FRA');
    expect(s.rules.economy).toBe('detailed');
    expect(s.nations.GER.stock).toBeDefined();
    s = { ...s, nations: { ...s.nations, GER: { ...s.nations.GER, stock: { oil: 0 } } } };
    s = tick(s, 4 * 30);
    expect(s.nations.GER.short).toContain('oil');
  });
});

describe('population and the capital rule', () => {
  it('sieges kill civilians', () => {
    let s = act(fresh(), { type: 'chooseNation', nation: 'GER' }, 'GER');
    const warsaw = id('Warsaw');
    const start = popOf(s, world, warsaw);
    expect(start).toBe(basePop(s, world, warsaw));
    const army = Object.values(s.armies).find((a) => a.owner === 'GER')!;
    s = { ...s, armies: { ...s.armies, [army.id]: { ...army, location: warsaw, strength: 30, maxStrength: 30 } } };
    s = tick(s, 8);
    expect(popOf(s, world, warsaw)).toBeLessThan(start);
    expect(s.nations.POL.civDeaths).toBeGreaterThan(0);
  });

  it('with "capital falls", taking the capital takes the whole nation', () => {
    let s = act(fresh(), { type: 'chooseNation', nation: 'GER', capitalFalls: true }, 'GER');
    expect(s.rules.capitalFalls).toBe(true);
    const warsaw = id('Warsaw');
    // the siege is over: the next capture step hands Warsaw over
    s = { ...s, provinces: { ...s.provinces, [warsaw]: { ...s.provinces[warsaw], garrison: 0, siege: { by: 'GER', progress: 0.999 } } } };
    s = { ...s, armies: Object.fromEntries(Object.entries(s.armies).filter(([, a]) => a.location !== warsaw)) };
    const army = Object.values(s.armies).find((a) => a.owner === 'GER')!;
    s = { ...s, armies: { ...s.armies, [army.id]: { ...army, location: warsaw, path: [], progress: 0, strength: 30, maxStrength: 30 } } };
    s = tick(s, 1);
    expect(s.nations.POL.alive).toBe(false);
    expect(s.events.some((e) => e.kind === 'capitulation' && /falls with its capital/.test(e.text))).toBe(true);
    // the normal rule only moves the government
    const plain = setOwner(fresh(), warsaw, 'GER', (x) => x, world);
    expect(plain.nations.POL.alive).toBe(true);
  });
});
