import fs from 'node:fs';
import { ww2 } from '../data/scenarios/ww2';
import { buildWorldFromMap, parseMap, provinceMeta } from '../map/mapData';
import { createInitialState } from './state';

/** Shared WW2 test fixture: real map, static world, fresh starting state. */
export const map = parseMap('ww2', JSON.parse(fs.readFileSync('public/maps/world_1938.json', 'utf8')));
export const world = buildWorldFromMap(map, ww2.unitTypes, 'ww2');
export const fresh = () => createInitialState(ww2, map.id, map.provinces.map((p) => ({ ...provinceMeta(p), pop: p.pop })), world);
export const byName = (name: string) => map.provinces.find((p) => p.name === name)!;
