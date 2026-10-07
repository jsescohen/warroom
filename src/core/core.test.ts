import { byName, fresh, map, world } from './fixture.test-util';
import { describe, expect, it } from 'vitest';
import { reduce, validate } from './actions';
import { getRelation, provincesOf } from './state';
import { formatDate } from './time';


describe('WW2 initial state', () => {
  const s = fresh();

  it('is plain serializable JSON', () => {
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('assigns every province to an existing nation', () => {
    for (const p of map.provinces) expect(s.nations[s.provinces[p.id].owner]).toBeDefined();
  });

  it('applies 1939 border changes on top of the 1938 map', () => {
    expect(s.provinces[byName('Prague').id].owner).toBe('GER');
    expect(s.provinces[byName('Shanghai').id].owner).toBe('JPN');
    expect(s.provinces[byName('Chongqing').id].owner).toBe('CHN');
    expect(s.provinces[byName('Paris').id].owner).toBe('FRA');
  });

  it('sets named capitals', () => {
    expect(s.nations.GER.capital).toBe(byName('Berlin').id);
    expect(s.nations.GBR.capital).toBe(byName('London').id);
  });

  it('starts the right wars and relations', () => {
    expect(s.wars.some((w) => w.attackers.includes('GER') && w.defenders.includes('POL'))).toBe(true);
    expect(getRelation(s, 'POL', 'GER')).toBe(-90);
  });
});

describe('actions', () => {
  it('transferProvince is pure and moves the capital when needed', () => {
    const s = fresh();
    const warsaw = s.nations.POL.capital!;
    const cmd = { action: { type: 'transferProvince' as const, province: warsaw, to: 'GER' }, actor: 'system' as const };
    expect(validate(s, cmd, world)).toBeNull();
    const next = reduce(s, cmd, world);
    expect(s.provinces[warsaw].owner).toBe('POL'); // input untouched
    expect(next.provinces[warsaw].owner).toBe('GER');
    expect(next.nations.POL.capital).not.toBe(warsaw);
    expect(next.nations.POL.capital).not.toBeNull();
  });

  it('marks a nation dead when it loses its last province', () => {
    let s = fresh();
    for (const id of provincesOf(s, 'POL')) s = reduce(s, { action: { type: 'transferProvince', province: id, to: 'GER' }, actor: 'system' }, world);
    expect(s.nations.POL.alive).toBe(false);
    expect(s.events.at(-1)?.kind).toBe('annexed');
  });

  it('rejects direct transfers from non-system actors', () => {
    const s = fresh();
    expect(validate(s, { action: { type: 'transferProvince', province: s.nations.POL.capital!, to: 'GER' }, actor: 'GER' }, world)).toMatch(/simulation/);
  });

  it('lets the player choose a nation once', () => {
    let s = fresh();
    s = reduce(s, { action: { type: 'chooseNation', nation: 'FRA' }, actor: 'FRA' }, world);
    expect(s.playerNation).toBe('FRA');
    expect(validate(s, { action: { type: 'chooseNation', nation: 'GER' }, actor: 'GER' }, world)).not.toBeNull();
  });
});

describe('map data', () => {
  it('has symmetric adjacency', () => {
    for (const p of map.provinces) for (const n of p.neighbors) expect(map.byId.get(n)!.neighbors).toContain(p.id);
  });
  it('connects France and Germany by land', () => {
    const french = new Set(map.provinces.filter((p) => p.polity === 'France').map((p) => p.id));
    expect(map.provinces.some((p) => p.polity === 'Germany' && p.neighbors.some((n) => french.has(n)))).toBe(true);
  });
});

describe('time', () => {
  it('formats dates including BC', () => {
    expect(formatDate({ startDate: '1939-09-01', hours: 30, tickHours: 6, turnHours: 24 })).toBe('2 September 1939');
    expect(formatDate({ startDate: '-1499-03-01', hours: 0, tickHours: 168, turnHours: 168 })).toBe('1 March 1500 BC');
  });
});
