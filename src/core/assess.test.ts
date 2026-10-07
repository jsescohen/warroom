import { describe, expect, it } from 'vitest';
import { tasks } from '../../shared/ai/tasks';
import { buildAssessPrompt } from '../ai/assessor';
import { ww2 } from '../data/scenarios/ww2';
import { reduce, type Action } from './actions';
import { classifyMajor, estimate } from './assess';
import { byName, fresh, world } from './fixture.test-util';
import type { GameState } from './types';

const war = (a: string, d: string): Action => ({ type: 'declareWar', attacker: a, defender: d });
const armyOf = (s: GameState, n: string) => Object.values(s.armies).find((a) => a.owner === n)!;
/** Put a nation's first army in a given province (test setup). */
const place = (s: GameState, n: string, province: string): [GameState, string] => {
  const a = armyOf(s, n);
  return [{ ...s, armies: { ...s.armies, [a.id]: { ...a, location: province, path: [], progress: 0 } } }, a.id];
};

describe('classifyMajor', () => {
  it('always reviews declarations of war', () => {
    expect(classifyMajor(fresh(), world, war('GER', 'FRA'), 'GER', 'off')?.kind).toBe('declareWar');
  });

  it('flags an assault on an enemy capital', () => {
    const [s, id] = place(fresh(), 'GER', byName('Poznań').id);
    const m = classifyMajor(s, world, { type: 'moveArmy', army: id, to: byName('Warsaw').id }, 'GER', 'major');
    expect(m?.kind).toBe('attackCapital');
    expect(m?.target).toBe('POL');
  });

  it('flags opening a new front, but not moves inside your own land', () => {
    let s = reduce(fresh(), { action: war('GER', 'FRA'), actor: 'GER' }, world);
    let id: string;
    [s, id] = place(s, 'GER', byName('Saarbrücken').id);
    const french = world.provinces[byName('Saarbrücken').id].links.find((l) => !l.sea && s.provinces[l.to].owner === 'FRA')!.to;
    expect(classifyMajor(s, world, { type: 'moveArmy', army: id, to: french }, 'GER', 'major')?.kind).toBe('newFront');
    expect(classifyMajor(s, world, { type: 'moveArmy', army: id, to: byName('Munich').id }, 'GER', 'major')).toBeNull();
  });

  it('respects the off and all modes for attacks', () => {
    let [s, id] = place(fresh(), 'GER', byName('Poznań').id);
    const to = byName('Warsaw').id;
    expect(classifyMajor(s, world, { type: 'moveArmy', army: id, to }, 'GER', 'off')).toBeNull();
    // with an army already inside Poland, a non-capital attack is only reviewed in 'all' mode
    const other = Object.values(s.armies).filter((a) => a.owner === 'GER')[1];
    s = { ...s, armies: { ...s.armies, [other.id]: { ...other, location: byName('Lublin').id } } };
    const lviv = byName('Lviv').id;
    [s, id] = [s, other.id];
    expect(classifyMajor(s, world, { type: 'moveArmy', army: id, to: lviv }, 'GER', 'major')).toBeNull();
    expect(classifyMajor(s, world, { type: 'moveArmy', army: id, to: lviv }, 'GER', 'all')?.kind).toBe('attack');
  });
});

describe('estimate', () => {
  it('Germany vs France brings Britain in and is risky', () => {
    const s = fresh();
    const e = estimate(s, world, classifyMajor(s, world, war('GER', 'FRA'), 'GER', 'major')!);
    expect(e.likelyEnemies).toContain('GBR');
    expect(['High', 'Extreme']).toContain(e.risk);
  });

  it('Poland attacking Germany is a long shot', () => {
    const s = fresh();
    const e = estimate(s, world, classifyMajor(s, world, war('ITA', 'GBR'), 'ITA', 'major')!);
    expect(e.successChance).toBeLessThan(60);
  });

  it('declaring war on a pact partner reports the broken treaty', () => {
    const s = fresh();
    const e = estimate(s, world, classifyMajor(s, world, war('SOV', 'GER'), 'SOV', 'major')!);
    expect(e.brokenTreaties.map((t) => t.type)).toContain('non-aggression');
  });

  it('a big local superiority gives good odds', () => {
    let s = fresh();
    // a German border province and the Polish province next to it
    const from = Object.keys(s.provinces).find((p) => s.provinces[p].owner === 'GER' &&
      world.provinces[p].links.some((l) => !l.sea && s.provinces[l.to].owner === 'POL'))!;
    const to = world.provinces[from].links.find((l) => !l.sea && s.provinces[l.to].owner === 'POL')!.to;
    const ger = Object.values(s.armies).filter((a) => a.owner === 'GER').slice(0, 6);
    s = { ...s, armies: { ...s.armies, ...Object.fromEntries(ger.map((a) => [a.id, { ...a, location: from }])) } };
    const m = classifyMajor(s, world, { type: 'moveArmy', army: ger[0].id, to }, 'GER', 'all')!;
    expect(m.province).toBe(to);
    expect(estimate(s, world, m).successChance).toBeGreaterThan(60);
  });
});

describe('assess prompt & schema', () => {
  it('keeps the prompt small and factual', () => {
    const s = fresh();
    const m = classifyMajor(s, world, war('GER', 'FRA'), 'GER', 'major')!;
    const { system, prompt } = buildAssessPrompt(ww2, s, m, estimate(s, world, m));
    expect(system.length + prompt.length).toBeLessThan(2600);
    expect(prompt).toContain('Declare war on French Republic');
    expect(prompt).toMatch(/STAFF ESTIMATE: chance of success \d+%/);
  });

  it('accepts sloppy model output', () => {
    const r = tasks.assess.schema.safeParse({
      summary: 'Sir, this is folly.',
      consequences: 'Britain will mobilise; Belgium closes its border',
      militaryRisk: 'Two-front war.',
      successChance: '35%',
      likelyEnemies: ['Britain'],
      risk: 'VERY HIGH',
      advice: 'Wait for spring.',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.risk).toBe('Extreme');
      expect(r.data.successChance).toBe(35);
      expect(r.data.consequences).toHaveLength(2);
    }
  });

  it('rejects output missing the essentials', () => {
    expect(tasks.assess.schema.safeParse({ summary: 'ok', risk: 'banana' }).success).toBe(false);
  });
});
