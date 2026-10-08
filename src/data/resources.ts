import type { ResourceDef } from '../core/scenario';
import type { EraId } from '../core/types';

/**
 * Natural resources per era. Each province holds at most one, placed by geography (oil around the
 * Gulf, horses on the steppe) with a deterministic roll, so every game of an era has the same map.
 * Strategic resources (`units`) are needed by some unit types; luxuries only bring money.
 * Regions are [lonMin, lonMax, latMin, latMax] with the chance a province there holds the resource.
 */

type R = [number, number, number, number, number];

const HORSES: R[] = [[20, 125, 40, 55, 0.3], [34, 50, 25, 37, 0.3], [26, 45, 36, 42, 0.25], [-10, 3, 36, 44, 0.2], [-2, 12, 30, 37, 0.2], [44, 62, 28, 40, 0.25]];
const IRON_OLD: R[] = [[-10, 25, 40, 56, 0.18], [26, 45, 36, 42, 0.2], [100, 122, 28, 42, 0.15], [44, 62, 28, 40, 0.12], [66, 90, 15, 30, 0.1]];
const GRAIN_OLD: R[] = [[29, 33, 22, 31, 0.5], [40, 48, 30, 37, 0.35], [12, 16, 36, 39, 0.4], [28, 40, 44, 48, 0.25], [105, 120, 32, 40, 0.25], [74, 90, 22, 30, 0.2]];

const OIL_1900: R[] = [[44, 60, 24, 35, 0.45], [44, 54, 38, 45, 0.5], [23, 28, 44, 46, 0.5], [-106, -94, 26, 37, 0.45], [-121, -117, 33, 36, 0.4], [-73, -60, 6, 12, 0.5], [95, 120, -6, 6, 0.3], [-100, -92, 17, 23, 0.35]];
const OIL_MODERN: R[] = [...OIL_1900, [3, 25, 26, 32, 0.3], [3, 9, 4, 7, 0.35], [60, 80, 55, 66, 0.2], [-120, -110, 50, 58, 0.3], [50, 70, 40, 50, 0.2], [-104, -96, 46, 49, 0.3]];
const STEEL: R[] = [[5, 20, 47, 55, 0.3], [-5, 2, 51, 56, 0.3], [2, 8, 47, 51, 0.3], [33, 42, 46, 50, 0.4], [55, 62, 52, 60, 0.35], [-90, -73, 38, 44, 0.35], [120, 128, 38, 46, 0.3], [14, 24, 63, 69, 0.4], [129, 142, 31, 40, 0.12], [80, 88, 20, 25, 0.2], [16, 20, 49, 52, 0.4], [113, 152, -38, -20, 0.08]];
const RUBBER: R[] = [[95, 120, -8, 15, 0.35], [-70, -45, -10, 2, 0.2], [12, 30, -6, 4, 0.2], [79, 82, 6, 10, 0.5]];
const FOOD: R[] = [[28, 50, 45, 55, 0.25], [-104, -85, 36, 49, 0.25], [-66, -57, -40, -28, 0.35], [-115, -97, 49, 54, 0.3], [74, 90, 22, 30, 0.2], [29, 33, 22, 31, 0.35], [140, 150, -38, -30, 0.25]];
const COAL: R[] = [[5, 20, 47, 55, 0.25], [-5, 2, 51, 57, 0.35], [33, 42, 46, 50, 0.3], [-90, -75, 36, 42, 0.3], [105, 120, 34, 42, 0.2], [16, 20, 49, 52, 0.4]];
const TECH: R[] = [[-125, -70, 30, 48, 0.08], [-5, 20, 43, 56, 0.08], [126, 142, 31, 40, 0.25], [118, 122, 21, 32, 0.15], [126, 130, 34, 38, 0.3], [100, 125, 20, 42, 0.1]];
const RARE: R[] = [[100, 120, 35, 45, 0.25], [-120, -114, 34, 37, 0.3], [113, 152, -38, -20, 0.08], [12, 30, -12, 4, 0.12]];
const SPICES: R[] = [[95, 135, -10, 8, 0.4], [72, 80, 8, 16, 0.35], [79, 82, 6, 10, 0.5], [38, 44, -8, -4, 0.4]];
const SUGAR: R[] = [[-86, -59, 10, 27, 0.4], [-45, -34, -15, -5, 0.35], [-18, -13, 27, 33, 0.4]];
const SILVER: R[] = [[-105, -98, 18, 25, 0.35], [-70, -64, -22, -17, 0.45], [12, 15, 49, 51, 0.3]];
const SALTPETRE: R[] = [[75, 90, 20, 30, 0.2], [-5, 25, 40, 55, 0.08], [100, 120, 25, 40, 0.1], [-72, -68, -25, -18, 0.3]];

// the USA scenario runs on a map of the states: regions are inside the US
const US_OIL: R[] = [[-106, -93, 26, 37, 0.6], [-104, -96, 46, 49, 0.5], [-121, -117, 33, 36, 0.4], [-170, -140, 58, 72, 0.6], [-94, -88, 28, 33, 0.5]];
const US_TECH: R[] = [[-123, -121, 36, 39, 0.8], [-123, -121, 46, 48, 0.6], [-72, -70, 42, 43, 0.6], [-98, -97, 30, 31, 0.5], [-80, -78, 35, 36, 0.5]];
const US_GRAIN: R[] = [[-104, -85, 37, 49, 0.4]];
const US_STEEL: R[] = [[-90, -75, 38, 44, 0.35], [-95, -87, 45, 48, 0.4]];

const ANCIENT: ResourceDef[] = [
  { id: 'horses', name: 'Horses', color: '#b07a45', units: ['chariots', 'cavalry', 'horse-archers'], value: 1, regions: HORSES },
  { id: 'iron', name: 'Iron', color: '#7d8590', units: ['legion', 'comitatenses'], value: 1, regions: IRON_OLD },
  { id: 'grain', name: 'Grain', color: '#d8c15a', value: 2, regions: GRAIN_OLD },
];

export const ERA_RESOURCES: Record<EraId, ResourceDef[]> = {
  bronze: [
    { id: 'horses', name: 'Horses', color: '#b07a45', units: ['chariots'], value: 1, regions: HORSES },
    { id: 'copper', name: 'Copper and tin', color: '#c27a4a', value: 2, regions: [[30, 36, 33, 37, 0.4], [26, 45, 36, 42, 0.2], [-10, 3, 36, 44, 0.15], [44, 62, 24, 30, 0.2]] },
    { id: 'grain', name: 'Grain', color: '#d8c15a', value: 2, regions: GRAIN_OLD },
  ],
  'rome-rise': ANCIENT,
  'rome-fall': ANCIENT,
  renaissance: [
    { id: 'horses', name: 'Horses', color: '#b07a45', units: ['knights'], value: 1, regions: HORSES },
    { id: 'saltpetre', name: 'Saltpetre', color: '#c9c9c9', units: ['arquebusiers', 'cannon'], value: 1, regions: SALTPETRE },
    { id: 'spices', name: 'Spices', color: '#c0553a', value: 3, regions: SPICES },
    { id: 'sugar', name: 'Sugar', color: '#e8dccb', value: 3, regions: SUGAR },
    { id: 'silver', name: 'Silver', color: '#a9b8c8', value: 3, regions: SILVER },
  ],
  ww1: [
    { id: 'steel', name: 'Steel', color: '#7d8590', units: ['artillery'], value: 1, regions: STEEL },
    { id: 'horses', name: 'Horses', color: '#b07a45', units: ['cavalry'], value: 1, regions: HORSES },
    { id: 'coal', name: 'Coal', color: '#3b3b3b', value: 2, regions: COAL },
    { id: 'oil', name: 'Oil', color: '#1f1f1f', value: 2, regions: OIL_1900 },
    { id: 'food', name: 'Food', color: '#d8c15a', value: 2, regions: FOOD },
  ],
  ww2: [
    { id: 'oil', name: 'Oil', color: '#1f1f1f', units: ['armor', 'air'], value: 2, regions: OIL_1900 },
    { id: 'steel', name: 'Steel', color: '#7d8590', units: ['artillery'], value: 1, regions: STEEL },
    { id: 'rubber', name: 'Rubber', color: '#5a7d3c', value: 2, regions: RUBBER },
    { id: 'food', name: 'Food', color: '#d8c15a', value: 2, regions: FOOD },
  ],
  modern: [
    { id: 'oil', name: 'Oil', color: '#1f1f1f', units: ['armor', 'air'], value: 2, regions: OIL_MODERN },
    { id: 'electronics', name: 'Electronics', color: '#3f8fd2', units: ['drones'], value: 3, regions: TECH },
    { id: 'rare', name: 'Rare earths', color: '#9b6bc4', value: 2, regions: RARE },
    { id: 'food', name: 'Food', color: '#d8c15a', value: 1, regions: FOOD },
  ],
  usa: [
    { id: 'oil', name: 'Oil', color: '#1f1f1f', units: ['armor', 'air'], value: 2, regions: US_OIL },
    { id: 'electronics', name: 'Electronics', color: '#3f8fd2', units: ['drones'], value: 3, regions: US_TECH },
    { id: 'steel', name: 'Steel', color: '#7d8590', value: 1, regions: US_STEEL },
    { id: 'food', name: 'Food', color: '#d8c15a', value: 1, regions: US_GRAIN },
  ],
};

export const resourcesOf = (era: EraId): ResourceDef[] => ERA_RESOURCES[era] ?? [];
