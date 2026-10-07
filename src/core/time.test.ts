import { fresh, world } from './fixture.test-util';
import { describe, expect, it } from 'vitest';
import { reduce, validate, type Action } from './actions';
import { atWar, getRelation } from './state';
import { GameStore } from './store';
import { formatDate, hoursUntil, turnNumber } from './time';
import type { GameState } from './types';

const tick = (s: GameState) => reduce(s, { action: { type: 'tick' }, actor: 'system' }, world);
const runUntil = (s: GameState, date: string) => {
  while (s.clock.hours < hoursUntil(s.clock.startDate, date)) s = tick(s);
  return s;
};

describe('clock', () => {
  it('advances by tickHours and counts turns', () => {
    let s = fresh();
    for (let i = 0; i < 4; i++) s = tick(s);
    expect(s.clock.hours).toBe(24);
    expect(turnNumber(s.clock)).toBe(2);
    expect(formatDate(s.clock)).toBe('2 September 1939');
  });

  it('only the system may tick', () => {
    expect(validate(fresh(), { action: { type: 'tick' }, actor: 'GER' }, world)).not.toBeNull();
  });
});

describe('scheduled history', () => {
  it('Britain and France declare war on 3 September and join the Polish war', () => {
    const s = runUntil(fresh(), '1939-09-03');
    expect(atWar(s, 'GBR', 'GER')).toBe(true);
    expect(atWar(s, 'FRA', 'GER')).toBe(true);
    const war = s.wars.find((w) => w.defenders.includes('POL'))!;
    expect(war.defenders).toEqual(expect.arrayContaining(['POL', 'GBR', 'FRA']));
    expect(s.events.filter((e) => e.kind === 'war').length).toBeGreaterThanOrEqual(2);
    expect(s.scheduled.every((e) => e.at > s.clock.hours)).toBe(true);
  });

  it('never acts on the player’s behalf', () => {
    let s = reduce(fresh(), { action: { type: 'chooseNation', nation: 'GBR' }, actor: 'GBR' }, world);
    s = runUntil(s, '1939-09-04');
    expect(atWar(s, 'GBR', 'GER')).toBe(false);
    expect(atWar(s, 'FRA', 'GER')).toBe(true);
  });

  it('the Soviet–German pact is broken only if the USSR attacks Germany', () => {
    const s = runUntil(fresh(), '1939-09-18');
    expect(atWar(s, 'SOV', 'POL')).toBe(true);
    expect(s.treaties.some((t) => t.type === 'non-aggression' && t.parties.includes('SOV'))).toBe(true);
  });
});

describe('declareWar', () => {
  const war = (attacker: string, defender: string): Action => ({ type: 'declareWar', attacker, defender });

  it('breaks treaties and sours relations with the betrayed', () => {
    const s0 = fresh();
    const s = reduce(s0, { action: war('SOV', 'GER'), actor: 'SOV' }, world);
    expect(s.treaties.some((t) => t.type === 'non-aggression' && t.parties.includes('SOV') && t.parties.includes('GER'))).toBe(false);
    expect(getRelation(s, 'SOV', 'GER')).toBeLessThanOrEqual(-50);
    expect(s.events.some((e) => e.kind === 'treaty-broken')).toBe(true);
  });

  it('rejects war on someone you already fight, or fight alongside', () => {
    const s = fresh();
    expect(validate(s, { action: war('GER', 'POL'), actor: 'GER' }, world)).toMatch(/Already/);
    const s2 = reduce(s, { action: war('GBR', 'GER'), actor: 'GBR' }, world);
    expect(validate(s2, { action: war('GBR', 'POL'), actor: 'GBR' }, world)).toMatch(/alongside/);
  });

  it('cannot be declared for another nation', () => {
    expect(validate(fresh(), { action: war('ITA', 'FRA'), actor: 'GER' }, world)).not.toBeNull();
  });
});

describe('store.batch', () => {
  it('notifies once for many ticks', () => {
    const store = new GameStore(fresh(), world);
    let calls = 0;
    store.subscribe(() => calls++);
    store.batch(() => { for (let i = 0; i < 10; i++) store.dispatch({ type: 'tick' }, 'system'); });
    expect(calls).toBe(1);
    expect(store.state.clock.hours).toBe(60);
  });
});
