import type { NationDef, ScenarioDef } from '../../core/scenario';
import { WEEKLY } from './common';
import { modern } from './modern';

/**
 * Pangea: today's nations on one supercontinent, at war with spears, bows and horses.
 *
 * The map (scripts/pangea.ts) moves every country to where its land lay on Pangea, then grows a
 * new supercontinent over that layout: neighbours are new (the United States borders Morocco,
 * Brazil borders Nigeria) and every country has a new shape. The nations, leaders and rivalries
 * are those of the present day.
 */
const ARMY = ['spearmen', 'swordsmen', 'archers', 'cavalry'];

const onPangea = (n: NationDef): NationDef => ({
  ...n,
  units: n.major ? ARMY : ['spearmen', 'archers', 'spearmen', 'swordsmen'],
  naval: 0,
  quality: n.quality,
  leader: n.leader && {
    ...n.leader,
    speechStyle: `${n.leader.speechStyle}; rules a nation of the one supercontinent Pangea, where wars are fought with spears, swords, bows and horses and borders run against strange new neighbours`,
  },
});

export const pangea: ScenarioDef = {
  id: 'pangea',
  era: 'pangea',
  name: 'Pangea',
  subtitle: 'Year 1 — Today’s nations on one supercontinent',
  startDate: '0001-03-01',
  theme: 'parchment',
  map: '/maps/pangea.json',
  context:
    'An alternate world: the continents never drifted apart. Every present-day nation lies on one supercontinent, Pangea, ' +
    'with its familiar people, leaders and rivalries but strange new neighbours: the Americas press against West Africa and ' +
    'Europe, India against East Africa and Australia, and an inland sea fills the heart of the land. There is no gunpowder: ' +
    'armies march with spears, swords, bows and horses. Old alliances still stand, and every border is now a land border.',
  advisor: {
    title: 'High Chancellor',
    style: 'a chancellor of a nation on the supercontinent: shrewd and plain-spoken, speaks of marching distances, granaries, horses, iron and the new neighbours across every border; addresses the ruler by their office',
    reportName: 'Counsel of the Chancellor',
  },
  time: WEEKLY,
  unitTypes: [
    { id: 'spearmen', name: 'Spear Host', short: 'Spear Host', attack: 2.5, defense: 3.5, speed: 4 },
    { id: 'swordsmen', name: 'Sword Legion', short: 'Legion', attack: 4, defense: 4, speed: 4 },
    { id: 'archers', name: 'Archers', short: 'Bowmen', attack: 3.5, defense: 2.5, speed: 4 },
    { id: 'cavalry', name: 'Horse', short: 'Horse', attack: 4.5, defense: 2, speed: 8 },
  ],
  nations: modern.nations.map(onPangea),
  minorNames: modern.minorNames,
  wars: modern.wars,
  treaties: modern.treaties,
  relations: modern.relations,
  victory: { conquestPercent: 50 },
  combat: { homeDefense: 1.3 },
  aiWarAppetite: 0.8,
};
