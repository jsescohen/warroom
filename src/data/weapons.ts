import type { EraId } from '../core/types';
import type { WeaponsConfig } from '../core/world';

/**
 * Missiles, nuclear weapons and air defence per era (eras without them have none). Ranges are in
 * map units (about 6.7 km each on the world maps, about 1.1 km on the map of the United States).
 * `from` is the date a weapon first becomes available.
 */
export const ERA_WEAPONS: Partial<Record<EraId, WeaponsConfig>> = {
  ww2: {
    missile: { name: 'V-2 rocket', cost: 20, materials: { steel: 2, oil: 1 }, range: 50, damage: 2.2, from: '1944-06-01' },
    nuke: { name: 'Atomic bomb', cost: 400, materials: { uranium: 15, steel: 6 }, range: 230, from: '1945-01-01' },
    airDefense: { name: 'Flak batteries', materials: { steel: 2 }, missileIntercept: 0.1, nukeIntercept: 0.1, strikeReduction: 0.35, radius: 60 },
  },
  modern: {
    missile: { name: 'Cruise missile', cost: 22, materials: { steel: 1, electronics: 2 }, range: 230, damage: 3.5 },
    nuke: { name: 'Nuclear warhead', cost: 450, materials: { uranium: 15, electronics: 4, steel: 4 }, range: 1600 },
    airDefense: { name: 'Air defence (Iron Dome, SAM)', materials: { steel: 2, electronics: 2 }, missileIntercept: 0.65, nukeIntercept: 0.2, strikeReduction: 0.5, radius: 90 },
  },
  usa: {
    missile: { name: 'Cruise missile', cost: 22, materials: { steel: 1, electronics: 2 }, range: 450, damage: 3.5 },
    nuke: null,
    airDefense: { name: 'Air defence (Patriot, NASAMS)', materials: { steel: 2, electronics: 2 }, missileIntercept: 0.65, nukeIntercept: 0, strikeReduction: 0.5, radius: 150 },
  },
};

export const weaponsOf = (era: EraId): WeaponsConfig | null => ERA_WEAPONS[era] ?? null;
