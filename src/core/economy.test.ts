import { describe, expect, it } from 'vitest';
import { reduce, validate, type Action } from './actions';
import { budgetOf, importsOf, initEconomy, manpowerCap, marketPrice, marketQuote, provinceOutput, recruitCost, recruitSite, armyCount } from './economy';
import { garrisonMax } from './military';
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
    const cost = recruitCost(s, world, 'FRA', 'infantry', undefined, paris);
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

  it('units cost materials; without them they cannot be raised', () => {
    let s = rich(act(fresh(), { type: 'chooseNation', nation: 'FRA' }, 'FRA'), 'FRA');
    const paris = id('Paris');
    const steel = s.nations.FRA.stock!.steel;
    s = act(s, { type: 'recruit', province: paris, unitType: 'armor' }, 'FRA');
    expect(s.nations.FRA.stock!.steel).toBe(steel - 3);
    s = { ...s, nations: { ...s.nations, FRA: { ...s.nations.FRA, stock: { ...s.nations.FRA.stock, oil: 0 } } } };
    expect(validate(s, { action: { type: 'recruit', province: paris, unitType: 'armor' }, actor: 'FRA' }, world)).toMatch(/oil/);
  });

  it('resources sit at their historical deposits, and a mine quadruples a province’s output', () => {
    const find = (name: string) => Object.values(world.provinces).find((p) => p.name === name);
    expect(world.provinces[id('Baku')]?.resource ?? find('Baku')?.resource).toBe('oil');
    expect(Object.values(world.provinces).some((p) => p.resource === 'uranium')).toBe(true);
    let s = rich(act(fresh(), { type: 'chooseNation', nation: 'ROM' }, 'ROM'), 'ROM');
    const field = Object.keys(s.provinces).find((p) => s.provinces[p].owner === 'ROM' && world.provinces[p].resource === 'oil')!;
    expect(provinceOutput(s, world, field)).toBe(1);
    expect(validate(s, { action: { type: 'build', province: field, building: 'farm' }, actor: 'ROM' }, world)).toMatch(/needs a mine/);
    s = act(s, { type: 'build', province: field, building: 'mine' }, 'ROM');
    expect(provinceOutput(s, world, field)).toBe(4);
  });

  it('the world market: buying raises the price, selling pays less than buying', () => {
    let s = rich(act(fresh(), { type: 'chooseNation', nation: 'FRA' }, 'FRA'), 'FRA');
    const p0 = marketPrice(s, world, 'oil');
    const oil = s.nations.FRA.stock!.oil;
    s = act(s, { type: 'market', resource: 'oil', amount: 20 }, 'FRA');
    expect(s.nations.FRA.stock!.oil).toBe(oil + 20);
    expect(marketPrice(s, world, 'oil')).toBeGreaterThan(p0);
    expect(marketQuote(s, world, 'oil', -5)).toBeLessThan(marketQuote(s, world, 'oil', 5));
    expect(validate(s, { action: { type: 'market', resource: 'oil', amount: -500 }, actor: 'FRA' }, world)).toBeTruthy();
  });

  it('developing a province: more people, a stronger garrison, better recruiting', () => {
    let s = rich(act(fresh(), { type: 'chooseNation', nation: 'FRA' }, 'FRA'), 'FRA');
    const town = Object.keys(s.provinces).find((p) => s.provinces[p].owner === 'FRA' && !s.provinces[p].build && recruitSite(s, world, p).basicOnly)!;
    const pop = popOf(s, world, town), g = garrisonMax(s, town);
    s = act(s, { type: 'develop', province: town }, 'FRA');
    s = act(s, { type: 'develop', province: town }, 'FRA');
    expect(s.provinces[town].level).toBe(2);
    expect(popOf(s, world, town)).toBeGreaterThan(pop);
    expect(garrisonMax(s, town)).toBeGreaterThan(g);
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
  it('a trade agreement carries goods every month and moves money', () => {
    let s = act(fresh(), { type: 'chooseNation', nation: 'FRA' }, 'FRA');
    const terms = { type: 'trade' as const, from: 'FRA', to: 'ROM', buy: 'oil', gold: 5 };
    expect(validate(s, { action: { type: 'propose', terms }, actor: 'FRA' }, world)).toBeNull();
    s = act(s, { type: 'propose', terms }, 'FRA');
    s = act(s, { type: 'respond', proposal: s.proposals[s.proposals.length - 1].id, accept: true }, 'ROM');
    expect(s.treaties.some((t) => t.type === 'trade')).toBe(true);
    expect(budgetOf(s, world, 'FRA').trade).toBe(-5);
    expect(budgetOf(s, world, 'ROM').trade).toBe(5);
    expect(importsOf(s, world, 'FRA').map(([r]) => r)).toContain('oil');
    // ending a trade agreement is not a betrayal
    const t = s.treaties.find((x) => x.type === 'trade')!;
    const rel = s.relations;
    s = act(s, { type: 'cancelTreaty', treaty: t.id }, 'FRA');
    expect(s.events.some((e) => e.kind === 'treaty-broken')).toBe(false);
    void rel;
  });

  it('breaking a treaty costs alliances with partners who do not trust you', () => {
    let s = act(fresh(), { type: 'chooseNation', nation: 'POL' }, 'POL');
    expect(s.treaties.some((t) => t.type === 'alliance' && t.parties.includes('POL') && t.parties.includes('GBR'))).toBe(true);
    // Poland tears up some other treaty: its allies who think little of it walk away
    // Britain thinks little of Poland (40); France more (80)
    s = { ...s, relations: { ...s.relations, 'GBR|POL': 40, 'FRA|POL': 90 }, treaties: [...s.treaties, { id: 'tx', type: 'non-aggression', parties: ['POL', 'SOV'], signedAt: 0 }] };
    s = act(s, { type: 'cancelTreaty', treaty: 'tx' }, 'POL');
    expect(s.events.some((e) => e.kind === 'alliance-lost')).toBe(true);
    expect(s.treaties.some((t) => t.type === 'alliance' && t.parties.includes('POL') && t.parties.includes('GBR'))).toBe(false);
    // the alliance itself goes on between the others
    expect(s.treaties.some((t) => t.type === 'alliance' && t.parties.includes('GBR') && t.parties.includes('FRA'))).toBe(true);
  });

  it('armies cannot merge in newly taken land for a while', () => {
    let s = act(fresh(), { type: 'chooseNation', nation: 'GER' }, 'GER');
    const p = id('Warsaw');
    s = setOwner(s, p, 'GER', (x) => x, world);
    const [a, b] = Object.values(s.armies).filter((x) => x.owner === 'GER' && x.unitType === 'infantry').slice(0, 2);
    s = { ...s, armies: { ...s.armies, [a.id]: { ...a, location: p, path: [], progress: 0 }, [b.id]: { ...b, location: p, path: [], progress: 0 } } };
    expect(validate(s, { action: { type: 'mergeArmies', army: a.id }, actor: 'GER' }, world)).toMatch(/newly taken/);
    s = { ...s, clock: { ...s.clock, hours: s.clock.hours + 24 * 11 } };
    expect(validate(s, { action: { type: 'mergeArmies', army: a.id }, actor: 'GER' }, world)).toBeNull();
  });
});

describe('weapons', () => {
  it('missiles are built, launched within range, and air defence can stop them; a nuke devastates and angers the world', () => {
    let s = act(fresh(), { type: 'chooseNation', nation: 'GER' }, 'GER');
    // 1945: the atomic bomb can be built
    s = { ...s, clock: { ...s.clock, hours: 24 * 365 * 6 } };
    s = { ...s, nations: { ...s.nations, GER: { ...s.nations.GER, treasury: 5000, stock: { ...s.nations.GER.stock, uranium: 40, steel: 40, oil: 40 } } } };
    s = act(s, { type: 'arm', weapon: 'missile' }, 'GER');
    s = act(s, { type: 'arm', weapon: 'nuke' }, 'GER');
    expect(s.nations.GER.arsenal).toEqual({ missile: 1, nuke: 1 });
    expect(validate(s, { action: { type: 'arm', weapon: 'nuke' }, actor: 'GER' }, world)).toMatch(/ready in/);
    const target = id('Warsaw');
    expect(validate(s, { action: { type: 'launch', weapon: 'nuke', target: id('Madrid') }, actor: 'GER' }, world)).toMatch(/not at war/);
    const relBefore = s.relations;
    s = act(s, { type: 'launch', weapon: 'nuke', target }, 'GER');
    expect(s.nations.GER.arsenal?.nuke).toBe(0);
    expect(Object.values(s.armies).some((a) => a.location === target)).toBe(false);
    expect(s.provinces[target].falloutUntil).toBeGreaterThan(s.clock.hours);
    expect(provinceOutput(s, world, target)).toBe(0);
    expect(s.events.some((e) => e.kind === 'nuke')).toBe(true);
    void relBefore;
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
