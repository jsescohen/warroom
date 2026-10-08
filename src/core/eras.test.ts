import { resourcesOf } from '../data/resources';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scenarios } from '../data/scenarios';
import { applyProvinceNames, buildWorldFromMap, parseMap, provinceMeta } from '../map/mapData';
import { reduce } from './actions';
import { createInitialState } from './state';

describe.each(scenarios.map((s) => [s.id, s] as const))('era %s', (_, sc) => {
  const map = applyProvinceNames(parseMap(sc.id, JSON.parse(fs.readFileSync('public' + sc.map, 'utf8'))), sc.provinceNames);
  const world = buildWorldFromMap(map, sc.unitTypes, resourcesOf(sc.era));
  const start = createInitialState(sc, map.id, map.provinces.map((p) => ({ ...provinceMeta(p), pop: p.pop })), world);

  it('gives every province to a living nation with a capital', () => {
    for (const p of map.provinces) {
      const owner = start.nations[start.provinces[p.id].owner];
      expect(owner?.alive).toBe(true);
      expect(owner.capital).not.toBeNull();
    }
  });

  it('includes every great power of the era', () => {
    for (const n of sc.nations.filter((x) => x.major)) expect(start.nations[n.id], n.id).toBeDefined();
  });

  it('only uses defined unit types', () => {
    for (const a of Object.values(start.armies)) expect(world.unitTypes[a.unitType], a.unitType).toBeDefined();
  });

  it('runs ten days of AI without errors', { timeout: 60_000 }, () => {
    let s = start;
    for (let i = 0; i < 10 * (24 / sc.time.tickHours); i++) s = reduce(s, { action: { type: 'tick' }, actor: 'system' }, world);
    expect(s.clock.hours).toBe(240);
    expect(JSON.parse(JSON.stringify(s)).clock.hours).toBe(240);
  });
});
