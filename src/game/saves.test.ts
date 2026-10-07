import { describe, expect, it } from 'vitest';
import { reduce } from '../core/actions';
import { fresh, world } from '../core/fixture.test-util';
import type { GameState } from '../core/types';
import { scenarios } from '../data/scenarios';
import { ww2 } from '../data/scenarios/ww2';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../ui/settings';
import { makeSave, metaOf, validateSave } from './saves';

const tick = (s: GameState, n: number) => {
  for (let i = 0; i < n; i++) s = reduce(s, { action: { type: 'tick' }, actor: 'system' }, world);
  return s;
};
const ids = scenarios.map((s) => s.id);

describe('saves', () => {
  it('a saved game resumes exactly where it left off', () => {
    let s = reduce(fresh(), { action: { type: 'chooseNation', nation: 'GER' }, actor: 'GER' }, world);
    s = tick(s, 4 * 10);
    const rec = makeSave(s, ww2, { now: 1_700_000_000_000 });
    // round-trip through JSON, as IndexedDB / file export would
    const loaded = JSON.parse(JSON.stringify(rec));
    expect(validateSave(loaded, ids)).toBeNull();
    // continuing from the loaded state gives the same future as never having saved
    expect(JSON.stringify(tick(loaded.state, 4 * 10))).toBe(JSON.stringify(tick(s, 4 * 10)));
  });

  it('names saves after the nation and date by default', () => {
    const s = reduce(fresh(), { action: { type: 'chooseNation', nation: 'FRA' }, actor: 'FRA' }, world);
    const rec = makeSave(s, ww2);
    expect(rec.name).toBe('French Republic — 1 September 1939');
    expect(metaOf(rec)).not.toHaveProperty('state');
  });

  it('rejects files that are not saves, damaged, or from unknown eras', () => {
    const good = makeSave(fresh(), ww2);
    expect(validateSave('hello', ids)).toMatch(/Not a Warroom/);
    expect(validateSave({ ...good, format: 99 }, ids)).toMatch(/format/);
    expect(validateSave({ ...good, scenarioId: 'mars' }, ids)).toMatch(/Unknown era/);
    expect(validateSave({ ...good, provinceCount: 3 }, ids)).toMatch(/damaged/);
    expect(validateSave({ ...good, state: { ...good.state, clock: undefined } }, ids)).toMatch(/damaged/);
  });
});

describe('settings', () => {
  it('fills in defaults and rejects bad values', () => {
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
    const s = sanitizeSettings({ autoPause: 'sometimes' as never, masterVolume: 7, uiScale: Number.NaN, music: 'yes' as never, advisor: 'all' });
    expect(s.autoPause).toBe('mine');
    expect(s.masterVolume).toBe(1);
    expect(s.uiScale).toBe(1);
    expect(s.music).toBe(true);
    expect(s.advisor).toBe('all');
  });
});
