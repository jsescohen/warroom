import { describe, expect, it } from 'vitest';
import { reduce, validate, type Action } from './actions';
import { byName, map } from './fixture.test-util';
import { ww2 } from '../data/scenarios/ww2';
import type { UnitTypeDef } from './scenario';
import { createInitialState } from './state';
import { buildWorldFromMap, provinceMeta } from '../map/mapData';
import { findPath, garrisonMax, garrisonOf, homePort, isFleet, seaDenied, strikeError } from './military';
import { scenarios } from '../data/scenarios';
import type { Army, GameState } from './types';

// The fleet engine is kept (fleets may return); these test units exercise it.
const FLEETS: UnitTypeDef[] = [
  { id: 'battleships', name: 'Battle Fleet', short: 'Fleet', attack: 5, defense: 5, speed: 80, domain: 'sea', bombard: 2 },
  { id: 'carriers', name: 'Carrier Task Force', short: 'Task Force', attack: 4, defense: 3, speed: 90, domain: 'sea', strike: { kind: 'air', range: 70, power: 1.5, cooldownHours: 48 } },
];
const navalWW2 = { ...ww2, unitTypes: [...ww2.unitTypes, ...FLEETS], nations: ww2.nations.map((n) => (['GER', 'ITA', 'SOV', 'FRA'].includes(n.id) ? { ...n, fleets: ['battleships'] } : n)) };
const world = buildWorldFromMap(map, navalWW2.unitTypes);
const fresh = () => createInitialState(navalWW2, map.id, map.provinces.map((p) => ({ ...provinceMeta(p), pop: p.pop })), world);

const act = (s: GameState, action: Action, actor: string) => {
  const err = validate(s, { action, actor }, world);
  if (err) throw new Error(err);
  return reduce(s, { action, actor }, world);
};
const tick = (s: GameState, n = 1) => {
  for (let i = 0; i < n; i++) s = reduce(s, { action: { type: 'tick' }, actor: 'system' }, world);
  return s;
};
const fleetsOf = (s: GameState, n: string) => Object.values(s.armies).filter((a) => a.owner === n && isFleet(world, a.unitType));
/** A quiet world: only the units we place ourselves. */
const empty = (s: GameState): GameState => ({ ...s, armies: {}, scheduled: [] });
const place = (s: GameState, a: Partial<Army> & Pick<Army, 'id' | 'owner' | 'location' | 'unitType'>): GameState =>
  ({ ...s, armies: { ...s.armies, [a.id]: { name: a.id, strength: 10, maxStrength: 10, path: [], progress: 0, ...a } } });

describe('garrisons', () => {
  it('must be beaten before a province can be taken, and regrow for the new owner', () => {
    let s = empty(fresh()); // Germany and Poland are at war on day one
    const target = byName('Warsaw').id;
    expect(garrisonOf(s, target)).toBeGreaterThan(5); // the capital is well defended
    s = place(s, { id: 'x1', owner: 'GER', location: target, unitType: 'infantry' });
    s = place(s, { id: 'x2', owner: 'GER', location: target, unitType: 'armor' });
    s = tick(s);
    expect(s.provinces[target].owner).toBe('POL');
    expect(s.provinces[target].siege?.progress).toBe(0); // still fighting the garrison
    expect(garrisonOf(s, target)).toBeLessThan(garrisonMax(s, target));
    expect(s.armies.x1.strength).toBeLessThan(10); // and it fights back
    for (let i = 0; i < 60 && s.provinces[target].owner === 'POL'; i++) s = tick(s);
    expect(s.provinces[target].owner).toBe('GER');
    expect(garrisonOf(s, target)).toBeLessThan(1);
    s = { ...s, armies: {} };
    s = tick(s, 4 * 3);
    expect(garrisonOf(s, target)).toBeGreaterThan(0);
  });
});

describe('fleets', () => {
  it('start in harbours of naval powers, never inland', () => {
    const s = fresh();
    expect(fleetsOf(s, 'GBR').length).toBeGreaterThanOrEqual(5);
    expect(fleetsOf(s, 'GER').every((f) => f.unitType === 'battleships')).toBe(true);
    for (const f of Object.values(s.armies).filter((a) => isFleet(world, a.unitType))) expect(world.provinces[f.location].coastal).toBe(true);
    expect(homePort(s, world, 'SWI')).toBeNull();
    expect(fleetsOf(s, 'SWI')).toHaveLength(0);
  });

  it('sail only to coasts, and freely past neutral shores', () => {
    const s = fresh();
    const f = fleetsOf(s, 'GBR')[0];
    expect(validate(s, { action: { type: 'moveArmy', army: f.id, to: byName('Warsaw').id }, actor: 'GBR' }, world)).toMatch(/coastal/);
    const lisbon = byName('Lisbon').id; // neutral Portugal
    expect(validate(s, { action: { type: 'moveArmy', army: f.id, to: lisbon }, actor: 'GBR' }, world)).toBeNull();
    const route = findPath(s, world, 'GBR', f.unitType, f.location, lisbon)!;
    expect(route.path.every((p) => world.provinces[p].coastal)).toBe(true);
  });

  it('fight enemy fleets they meet', () => {
    let s = act(empty(fresh()), { type: 'declareWar', attacker: 'GER', defender: 'GBR' }, 'GER');
    const sea = homePort(s, world, 'GBR')!;
    s = place(s, { id: 'f1', owner: 'GBR', location: sea, unitType: 'battleships' });
    s = place(s, { id: 'f2', owner: 'GER', location: sea, unitType: 'battleships' });
    s = tick(s, 4);
    expect(s.armies.f1.strength).toBeLessThan(10);
    expect(s.armies.f2.strength).toBeLessThan(10);
    expect(s.battles[sea]).toBeDefined();
    expect(s.provinces[sea].owner).toBe('GBR'); // fleets never capture land
  });

  it('control the sea: troops cannot cross where the enemy navy rules', () => {
    let s = act(empty(fresh()), { type: 'declareWar', attacker: 'GER', defender: 'GBR' }, 'GER');
    const london = byName('London').id;
    const from = Object.keys(s.provinces).find((p) => s.provinces[p].owner === 'GER' && world.provinces[p].coastal &&
      findPath(s, world, 'GER', 'infantry', p, london))!;
    expect(from).toBeTruthy();
    // a strong British fleet off both coasts closes the Channel
    for (const [i, at] of [from, london].entries()) {
      s = place(s, { id: `rn${i}`, owner: 'GBR', location: at, unitType: 'battleships', strength: 30, maxStrength: 30 });
    }
    expect(seaDenied(s, world, 'GER', london)).toBe(true);
    expect(findPath(s, world, 'GER', 'infantry', from, london)).toBeNull();
    // with a German fleet as strong at sea, the crossing opens again
    s = place(s, { id: 'km', owner: 'GER', location: from, unitType: 'battleships', strength: 40, maxStrength: 40 });
    s = place(s, { id: 'km2', owner: 'GER', location: london, unitType: 'battleships', strength: 40, maxStrength: 40 });
    expect(seaDenied(s, world, 'GER', london)).toBe(false);
  });

  it('battleships support their own troops fighting on the coast', () => {
    const battle = (withShips: boolean) => {
      let s = act(empty(fresh()), { type: 'declareWar', attacker: 'GER', defender: 'GBR' }, 'GER');
      const coast = homePort(s, world, 'GER')!;
      s = place(s, { id: 'inf', owner: 'GER', location: coast, unitType: 'infantry' });
      s = place(s, { id: 'tommies', owner: 'GBR', location: coast, unitType: 'infantry' });
      if (withShips) s = place(s, { id: 'bb', owner: 'GBR', location: coast, unitType: 'battleships' });
      return tick(s, 4);
    };
    const shelled = battle(true);
    expect(shelled.armies.inf.strength).toBeLessThan(battle(false).armies.inf.strength);
    expect(shelled.armies.bb.strength).toBe(10); // the troops cannot answer
    // with nobody of ours ashore, the guns stay silent
    let s = act(empty(fresh()), { type: 'declareWar', attacker: 'GER', defender: 'GBR' }, 'GER');
    const coast = homePort(s, world, 'GER')!;
    s = place(s, { id: 'inf', owner: 'GER', location: coast, unitType: 'infantry' });
    s = place(s, { id: 'bb', owner: 'GBR', location: coast, unitType: 'battleships' });
    expect(tick(s, 4).armies.inf.strength).toBe(10);
  });

  it('carrier strikes hit targets in range, then rearm', () => {
    let s = act(empty(fresh()), { type: 'declareWar', attacker: 'GER', defender: 'GBR' }, 'GER');
    const target = homePort(s, world, 'GER')!;
    s = place(s, { id: 'cv', owner: 'GBR', location: target, unitType: 'carriers' }); // off the German coast
    s = place(s, { id: 'pz', owner: 'GER', location: target, unitType: 'armor' });
    s = act(s, { type: 'strike', army: 'cv', target }, 'GBR');
    expect(s.armies.pz.strength).toBeLessThan(10);
    expect(strikeError(s, world, 'cv', target)).toMatch(/rearming/);
    s = { ...s, clock: { ...s.clock, hours: s.clock.hours + 48 } };
    expect(strikeError(s, world, 'cv', target)).toBeNull();
    expect(strikeError(s, world, 'cv', byName('Moscow').id)).toMatch(/range/);
    // battleships have no aircraft
    s = place(s, { id: 'bb', owner: 'GBR', location: target, unitType: 'battleships' });
    expect(strikeError(s, world, 'bb', target)).toMatch(/cannot strike/);
  });
});

describe('air strikes', () => {
  it('belong to the air units of the 20th and 21st centuries, and no era fields fleets', () => {
    for (const sc of scenarios) expect(sc.unitTypes.some((u) => u.domain === 'sea')).toBe(false);
    const strikers = (id: string) => scenarios.find((s) => s.id === id)!.unitTypes.filter((u) => u.strike).map((u) => u.id);
    for (const era of ['bronze', 'rome-rise', 'rome-fall', 'renaissance', 'ww1']) expect(strikers(era)).toEqual([]);
    expect(strikers('ww2')).toEqual(['air']);
    expect(strikers('modern').sort()).toEqual(['air', 'drones']);
  });
});
