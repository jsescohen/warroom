import type { NationDef, ScenarioDef } from '../../core/scenario';
import { DAILY } from './common';
import { modern } from './modern';

/**
 * Pandemic: today's world, and a new disease. There are no wars: the enemy is the virus. Nations
 * close borders, lock down, build hospitals and labs, and race (alone or in research pacts) for a
 * cure made from medicines, lab reagents and rare plant compounds. See core/pandemic.ts.
 */
const inCrisis = (n: NationDef): NationDef => ({
  ...n,
  units: ['guard'],
  naval: 0,
  aggression: 0,
  leader: n.leader && {
    ...n.leader,
    goals: ['keep the disease out of the country', 'find a cure', ...n.leader.goals.slice(0, 1)],
    speechStyle: `${n.leader.speechStyle}; now leading the country through a deadly new pandemic, speaks of infection numbers, hospitals, borders, lockdowns, vaccines and research, and is wary of being blamed or of others hiding their outbreaks`,
  },
});

export const pandemic: ScenarioDef = {
  id: 'pandemic',
  era: 'pandemic',
  name: 'Pandemic',
  subtitle: '2026 — A new virus',
  startDate: '2026-03-01',
  theme: 'tactical',
  map: '/maps/world_2010.json',
  context:
    'The present day (2026), and a new virus has just broken out. It spreads across borders, along sea lanes and by air between ' +
    'the great cities. There are no wars: every nation fights the disease, with lockdowns, closed borders, quarantines, hospitals ' +
    'and labs. A cure needs research and rare materials (medicines, lab reagents, rare plant compounds); nations that pool their ' +
    'research in pacts find it far sooner, so old rivals may have to work together. Nations distrust those who hide outbreaks, ' +
    'close their borders on neighbours, or hoard the cure.',
  advisor: {
    title: 'Chief Medical Officer',
    style: 'a national chief medical officer briefing the head of government: calm and scientific, cites case numbers, hospital capacity, reproduction rates, trials and supply chains; addresses the head of government formally',
    reportName: 'Public health briefing',
  },
  time: DAILY,
  unitTypes: [
    { id: 'guard', name: 'National Guard', short: 'Guard', attack: 2, defense: 4, speed: 30 },
  ],
  nations: modern.nations.map(inCrisis),
  minorNames: modern.minorNames,
  treaties: modern.treaties,
  relations: modern.relations,
  victory: { conquestPercent: 101 },
  combat: { homeDefense: 1.5 },
  aiWarAppetite: 0,
  pandemic: { name: 'Hydra virus' },
};
