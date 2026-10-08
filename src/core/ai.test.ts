import { describe, expect, it } from 'vitest';
import { reduce, validate, type Action } from './actions';
import { aiTick } from './ai';
import { fresh, world } from './fixture.test-util';
import { atWar, provincesOf } from './state';
import type { GameState } from './types';

const tick = (s: GameState, n: number) => {
  for (let i = 0; i < n; i++) s = reduce(s, { action: { type: 'tick' }, actor: 'system' }, world);
  return s;
};
const act = (s: GameState, action: Action, actor: string) => reduce(s, { action, actor }, world);

describe('nation AI', () => {
  const day30 = tick(fresh(), 4 * 30);

  it('conducts the invasion of Poland on its own', { timeout: 60_000 }, () => {
    expect(provincesOf(day30, 'POL').length).toBeLessThan(provincesOf(fresh(), 'POL').length * 0.7);
    // Warsaw itself, garrisoned and defended at home, holds out a little longer
    const day45 = tick(day30, 4 * 15);
    expect(day45.provinces[fresh().nations.POL.capital!].owner).not.toBe('POL');
  });

  it('is deterministic', { timeout: 60_000 }, () => {
    expect(JSON.stringify(tick(fresh(), 4 * 30))).toBe(JSON.stringify(day30));
  });

  it('never commands the player’s armies', () => {
    let s = act(fresh(), { type: 'chooseNation', nation: 'POL' }, 'POL');
    const before = Object.values(s.armies).filter((a) => a.owner === 'POL').map((a) => a.id + a.location).sort();
    // run the AI directly for a full week of slots, without moving the clock's military phase
    for (let h = 0; h < 24 * 7; h += 6) s = aiTick({ ...s, clock: { ...s.clock, hours: h } }, world, (st, cmd) => {
      if (cmd.actor === 'POL') throw new Error(`AI acted for the player: ${cmd.action.type}`);
      return validate(st, cmd, world) ? st : reduce(st, cmd, world);
    });
    const after = Object.values(s.armies).filter((a) => a.owner === 'POL').map((a) => a.id + a.location).sort();
    expect(after).toEqual(before);
    expect(Object.values(s.armies).some((a) => a.owner === 'GER' && a.path.length)).toBe(true);
  });

  it('honours historical alliances without dragging allies into unrelated wars', () => {
    const s = tick(fresh(), 4 * 20);
    expect(atWar(s, 'GBR', 'GER')).toBe(true);
    // the USSR invaded Poland (which may have capitulated since) in a war of its own
    expect(s.events.some((e) => e.kind === 'war' && e.nations?.[0] === 'SOV' && e.nations?.[1] === 'POL')).toBe(true);
    expect(atWar(s, 'GBR', 'SOV')).toBe(false);
  });

  it('waits out the opening before starting wars of its own', () => {
    const s = tick(fresh(), 4 * 12);
    const aiWars = s.events.filter((e) => e.kind === 'war' && e.at > 0 && !['GBR', 'FRA', 'AUS', 'NZL', 'SAF', 'CAN'].includes(e.nations![0]));
    expect(aiWars).toHaveLength(0);
  });
});
