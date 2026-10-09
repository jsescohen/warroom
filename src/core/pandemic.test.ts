import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pandemic } from '../data/scenarios/pandemic';
import { buildWorldFromMap, parseMap, provinceMeta } from '../map/mapData';
import { reduce, validate, type Action } from './actions';
import { budgetOf } from './economy';
import { getRel } from './events';
import { COLLAPSE_DAYS, CURE, nationHealth, outbreakSites, pactPartners, pooledRate, researchRate, TRIALS, worldSickShare } from './pandemic';
import { createInitialState } from './state';
import type { GameState } from './types';

const map = parseMap('pandemic', JSON.parse(fs.readFileSync('public/maps/world_2010.json', 'utf8')));
const world = buildWorldFromMap(map, pandemic.unitTypes, 'pandemic');
const fresh = () => createInitialState(pandemic, map.id, map.provinces.map((p) => ({ ...provinceMeta(p), pop: p.pop })), world, 11);
const act = (s: GameState, action: Action, actor: string) => {
  const err = validate(s, { action, actor }, world);
  if (err) throw new Error(err);
  return reduce(s, { action, actor }, world);
};
const days = (s: GameState, n: number) => {
  for (let i = 0; i < n * (24 / s.clock.tickHours); i++) s = reduce(s, { action: { type: 'tick' }, actor: 'system' }, world);
  return s;
};
const homeSite = (s: GameState, n: string) => outbreakSites(world).find((p) => s.provinces[p].owner === n)!;

describe('pandemic era', () => {
  it('starts with a disease in one big city, hospitals in every capital and labs at the great powers', () => {
    const s = fresh();
    expect(s.disease?.name).toBe('Hydra virus');
    expect(Object.values(s.provinces).filter((p) => p.sick).length).toBe(1);
    expect(s.provinces[s.disease!.origin].sick).toBeGreaterThan(0);
    expect(s.wars).toEqual([]);
    expect(s.provinces[s.nations.GER.capital!].build).toContain('hospital');
    expect(s.provinces[s.nations.GER.capital!].build).toContain('lab');
    expect(s.provinces[s.nations.m_bangladesh.capital!].build).not.toContain('lab');
  });

  it('has no wars: declarations and war pacts are refused', () => {
    const s = fresh();
    expect(validate(s, { action: { type: 'declareWar', attacker: 'RUS', defender: 'UKR' }, actor: 'RUS' }, world)).toMatch(/no wars/);
    expect(validate(s, { action: { type: 'propose', terms: { type: 'joint-war', from: 'RUS', to: 'CHN', target: 'USA' } }, actor: 'RUS' }, world)).toMatch(/no wars/);
  });

  it('lets the player set up the disease', () => {
    let s = fresh();
    const site = homeSite(s, 'GER');
    s = act(s, { type: 'chooseNation', nation: 'GER', disease: { name: 'Grey fever', severity: 'deadly', origin: site } }, 'GER');
    expect(s.disease).toMatchObject({ name: 'Grey fever', severity: 'deadly', origin: site });
    expect(Object.keys(s.provinces).filter((p) => s.provinces[p].sick)).toEqual([site]);
  });

  it('spreads across the world, the same way every time', { timeout: 120_000 }, () => {
    const a = days(fresh(), 30);
    const b = days(fresh(), 30);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const nations = new Set(Object.values(a.provinces).filter((p) => p.sick).map((p) => p.owner));
    expect(nations.size).toBeGreaterThan(3);
    expect(worldSickShare(a, world)).toBeGreaterThan(0);
    expect(a.events.some((e) => e.kind === 'outbreak' && /has broken out/.test(e.text))).toBe(true);
  });

  it('a lockdown slows the spread and costs money', { timeout: 120_000 }, () => {
    let s = fresh();
    s = act(s, { type: 'chooseNation', nation: 'GER', disease: { origin: homeSite(s, 'GER') } }, 'GER');
    const open = days(s, 25);
    const shut = days(act(s, { type: 'setHealth', lockdown: 2 }, 'GER'), 25);
    expect(nationHealth(shut, world, 'GER').sickShare).toBeLessThan(nationHealth(open, world, 'GER').sickShare / 2);
    expect(budgetOf(act(s, { type: 'setHealth', lockdown: 2 }, 'GER'), world, 'GER').land).toBeLessThan(budgetOf(s, world, 'GER').land);
  });

  it('closing the borders angers the neighbours', () => {
    let s = act(fresh(), { type: 'chooseNation', nation: 'GER' }, 'GER');
    const before = getRel(s, 'GER', 'FRA');
    s = act(s, { type: 'setHealth', borders: true }, 'GER');
    expect(s.nations.GER.health?.borders).toBe(true);
    expect(getRel(s, 'GER', 'FRA')).toBeLessThan(before);
  });

  it('collapses a nation whose hospitals are overwhelmed for two weeks', { timeout: 120_000 }, () => {
    let s = act(fresh(), { type: 'chooseNation', nation: 'GER' }, 'GER');
    const provinces = { ...s.provinces };
    for (const [p, ps] of Object.entries(provinces)) if (ps.owner === 'GER') provinces[p] = { ...ps, sick: 0.3 };
    s = days({ ...s, provinces }, COLLAPSE_DAYS + 1);
    expect(s.disease?.fallen).toContain('GER');
    expect(s.events.some((e) => e.kind === 'defeat' && e.nations?.includes('GER'))).toBe(true);
  });

  it('pools research in a pact, waits for trial materials, and shares the cure', () => {
    let s = act(fresh(), { type: 'chooseNation', nation: 'GER' }, 'GER');
    const alone = researchRate(s, world, 'GER');
    const p = act(s, { type: 'propose', terms: { type: 'research', from: 'GER', to: 'FRA' } }, 'GER');
    s = act(p, { type: 'respond', proposal: p.proposals.at(-1)!.id, accept: true }, 'FRA');
    expect(pactPartners(s, 'GER')).toEqual(['FRA']);
    expect(pooledRate(s, world, 'GER')).toBeGreaterThan(alone);
    // the first trial: research waits without the materials
    const trial = TRIALS[0];
    s = { ...s, nations: { ...s.nations, GER: { ...s.nations.GER, stock: { ...s.nations.GER.stock, compounds: 0 }, health: { research: trial.at - 0.01 } } } };
    s = days(s, 2);
    expect(s.nations.GER.health?.research).toBe(trial.at);
    expect(s.nations.GER.health?.trials ?? 0).toBe(0);
    // France finds the cure: its partner has it too
    s = { ...s, nations: { ...s.nations, FRA: { ...s.nations.FRA, health: { research: CURE - 0.001, trials: 2 } } } };
    s = days(s, 1);
    expect(s.nations.FRA.health?.cure).toBe(true);
    s = days(s, 1);
    expect(s.nations.GER.health?.cure).toBe(true);
    // and the cure can be given away
    const rel = getRel(s, 'GER', 'POL');
    s = act(s, { type: 'shareCure', to: 'POL' }, 'GER');
    expect(s.nations.POL.health?.cure).toBe(true);
    expect(getRel(s, 'GER', 'POL')).toBeGreaterThan(rel);
  });

  it('sends aid', () => {
    let s = act(fresh(), { type: 'chooseNation', nation: 'GER' }, 'GER');
    const money = s.nations.ITA.treasury ?? 0;
    s = act(s, { type: 'sendAid', to: 'ITA', what: 'money', amount: 5 }, 'GER');
    expect(s.nations.ITA.treasury).toBe(money + 5);
    expect(validate(s, { action: { type: 'sendAid', to: 'ITA', what: 'money', amount: 9999 }, actor: 'GER' }, world)).toBeTruthy();
  });

  it('quarantines a province', () => {
    let s = act(fresh(), { type: 'chooseNation', nation: 'GER' }, 'GER');
    const p = s.nations.GER.capital!;
    s = act(s, { type: 'quarantine', province: p, on: true }, 'GER');
    expect(s.provinces[p].quarantine).toBe(true);
    expect(validate(s, { action: { type: 'quarantine', province: s.nations.FRA.capital!, on: true }, actor: 'GER' }, world)).toMatch(/own/);
    s = act(s, { type: 'quarantine', province: p, on: false }, 'GER');
    expect(s.provinces[p].quarantine).toBeUndefined();
  });
});
