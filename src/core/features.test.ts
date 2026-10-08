import { describe, expect, it } from 'vitest';
import { earned } from '../game/achievements';
import { headline } from '../ui/newsTicker';
import { reduce, validate, type Action } from './actions';
import { fresh, world } from './fixture.test-util';
import { aiEdge, type GameState } from './types';

const act = (s: GameState, action: Action, actor: string) => reduce(s, { action, actor }, world);
const tick = (s: GameState, n: number) => {
  for (let i = 0; i < n; i++) s = reduce(s, { action: { type: 'tick' }, actor: 'system' }, world);
  return s;
};

describe('difficulty', () => {
  it('is chosen with the nation and only strengthens or weakens the AI', () => {
    expect(validate(fresh(), { action: { type: 'chooseNation', nation: 'FRA', difficulty: 'brutal' as never }, actor: 'FRA' }, world)).toMatch(/difficulty/);
    const hard = act(fresh(), { type: 'chooseNation', nation: 'FRA', difficulty: 'hard' }, 'FRA');
    expect(hard.rules.difficulty).toBe('hard');
    expect(aiEdge(hard, 'GER')).toBeGreaterThan(1);
    expect(aiEdge(hard, 'FRA')).toBe(1);
    const easy = act(fresh(), { type: 'chooseNation', nation: 'FRA', difficulty: 'easy' }, 'FRA');
    expect(aiEdge(easy, 'GER')).toBeLessThan(1);
    expect(act(fresh(), { type: 'chooseNation', nation: 'FRA' }, 'FRA').rules.difficulty).toBe('normal');
  });
});

describe('history', () => {
  it('records the great powers and the player every week', () => {
    let s = act(fresh(), { type: 'chooseNation', nation: 'POL' }, 'POL');
    s = tick(s, 4 * 15);
    expect(s.history!.t).toHaveLength(2);
    expect(Object.keys(s.history!.nations)).toEqual(expect.arrayContaining(['POL', 'GER', 'GBR']));
    const ger = s.history!.nations.GER;
    expect(ger.p.every((v) => v > 0) && ger.a.every((v) => v > 0)).toBe(true);
  });
});

describe('achievements', () => {
  it('reads achievements from the state and new events', () => {
    let s = act(fresh(), { type: 'chooseNation', nation: 'GER' }, 'GER');
    expect(earned(s, 'ww2', [])).toEqual([]);
    const ev = (kind: string, nations: string[], text = '') => ({ id: 9999, at: s.clock.hours, kind, text, nations });
    expect(earned(s, 'ww2', [ev('battle-end', ['GER'])])).toContain('first-blood');
    expect(earned(s, 'ww2', [ev('capital', ['POL', 'GER'])])).toContain('decapitation');
    expect(earned(s, 'ww2', [ev('capital', ['GER', 'POL'])])).not.toContain('decapitation');
    expect(earned(s, 'ww2', [ev('agreement', ['GER', 'JPN'], 'Alliance signed between Germany and Japan.')])).toContain('diplomat');
    s = { ...s, winner: 'GER', rules: { ...s.rules, difficulty: 'hard' } };
    expect(earned(s, 'ww2', [])).toEqual(expect.arrayContaining(['win-ww2', 'iron-will']));
    expect(earned(s, 'ww2', [])).not.toContain('underdog'); // Germany is a great power
  });
});

describe('news ticker', () => {
  it('writes headlines in the era’s voice, skipping minor news', () => {
    const s = fresh();
    const war = { id: 1, at: 0, kind: 'war', text: '', nations: ['GER', 'POL'] };
    expect(headline(s, war, false)).toBe('Germany declares war on Poland');
    expect(headline(s, war, true)).toBe('Germany marches against Poland');
    expect(headline(s, { ...war, kind: 'capture' }, false)).toBeNull();
    const minors = Object.values(s.nations).filter((n) => !n.major).slice(0, 2).map((n) => n.id);
    expect(headline(s, { ...war, nations: minors }, false)).toBeNull();
  });
});
