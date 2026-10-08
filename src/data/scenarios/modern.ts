import type { LeaderPersona, NationDef, ScenarioDef } from '../../core/scenario';
import { DAILY } from './common';

/**
 * Present-day leaders are represented by their office, not by name: no role-playing of living
 * politicians, and no guessing who holds office.
 */
const office = (title: string, traits: string[], goals: string[], speechStyle: string, grudges?: string[]): LeaderPersona =>
  ({ name: `The ${title}`, title, traits, goals, grudges, speechStyle });

const n = (id: string, name: string, color: string, extra: Partial<NationDef> = {}): NationDef => ({ id, name, color, polities: [name], playable: true, ...extra });

export const modern: ScenarioDef = {
  id: 'modern',
  era: 'modern',
  name: 'The Modern World',
  subtitle: 'The present day — A multipolar world',
  startDate: '2026-01-01',
  theme: 'tactical',
  map: '/maps/world_2010.json',
  context:
    'The present day (mid-2020s). Russia\'s war against Ukraine continues; NATO has expanded to Finland and Sweden. The United ' +
    'States and China compete for influence across the Pacific, with Taiwan a flashpoint. India and Pakistan, the two Koreas, ' +
    'and Israel and Iran remain locked in rivalry. Drones, missiles and air power dominate. Nuclear weapons are not modelled.',
  advisor: {
    title: 'Director of National Intelligence',
    style: 'a modern intelligence briefing: crisp and analytic, cites satellite imagery, sanctions, escalation ladders, markets and allied consultations; addresses the head of government formally',
    reportName: 'Intelligence assessment',
  },
  time: DAILY,
  unitTypes: [
    { id: 'infantry', name: 'Mechanized Brigade', short: 'Brigade', attack: 4, defense: 5, speed: 30 },
    { id: 'armor', name: 'Armored Brigade', short: 'Armored Brigade', attack: 7, defense: 4, speed: 40 },
    { id: 'air', name: 'Air Wing', short: 'Air Wing', attack: 6, defense: 2, speed: 180 },
    { id: 'drones', name: 'Drone Group', short: 'Drone Group', attack: 5, defense: 1.5, speed: 90 },
    { id: 'destroyers', name: 'Destroyer Squadron', short: 'Destroyer Squadron', attack: 5, defense: 5, speed: 100, domain: 'sea', bombard: 1, strike: { kind: 'missile', range: 200, power: 1.5, cooldownHours: 72 } },
    { id: 'carriers', name: 'Carrier Strike Group', short: 'Strike Group', attack: 5, defense: 4, speed: 100, domain: 'sea', strike: { kind: 'air', range: 150, power: 2.5, cooldownHours: 24 } },
  ],
  nations: [
    n('USA', 'United States', '#3b6fa8', { quality: 1.3,
      shortName: 'USA', capital: 'Washington, D.C.', major: true, military: 2.2, aggression: 0.2, naval: 1.0, units: ['infantry', 'armor', 'air', 'drones'],
      leader: office('President of the United States', ['assertive', 'alliance-minded'], ['contain China', 'support Ukraine', 'protect allies'], 'confident American statesmanship, speaks of allies, deterrence and the rules-based order'),
    }),
    n('RUS', 'Russia', '#8e2f2f', { quality: 0.95,
      capital: 'Moscow', major: true, military: 2.0, aggression: 0.55, naval: 0.5, units: ['infantry', 'armor', 'drones', 'air'],
      leader: office('President of Russia', ['revanchist', 'distrustful', 'patient'], ['win in Ukraine', 'divide NATO', 'a sphere of influence'], 'cold, legalistic and menacing, speaks of security guarantees and Western hypocrisy', ['NATO expansion']),
    }),
    n('CHN', 'China', '#c8553d', { quality: 1.05,
      capital: 'Beijing', major: true, military: 2.2, aggression: 0.35, naval: 0.75, units: ['infantry', 'armor', 'drones', 'air'],
      leader: office('President of the People\'s Republic of China', ['patient', 'strategic', 'nationalist'], ['reunification with Taiwan', 'regional primacy', 'economic security'], 'measured Party language, speaks of sovereignty, win-win cooperation and red lines', ['the century of humiliation']),
    }),
    n('IND', 'India', '#e08a3c', { capital: 'New Delhi', major: true, military: 1.7, aggression: 0.25, naval: 0.4,
      leader: office('Prime Minister of India', ['proud', 'non-aligned'], ['strategic autonomy', 'secure the borders with China and Pakistan'], 'confident non-aligned diplomacy', ['Pakistan-backed terrorism']) }),
    n('GBR', 'United Kingdom', '#c2475b', { quality: 1.15, shortName: 'UK', capital: 'London', major: true, military: 1.1, aggression: 0.15, naval: 0.65,
      leader: office('Prime Minister of the United Kingdom', ['pragmatic', 'Atlanticist'], ['support Ukraine', 'keep NATO strong'], 'understated British diplomacy') }),
    n('FRA', 'France', '#4a78c2', { quality: 1.1, capital: 'Paris', major: true, military: 1.2, aggression: 0.15, naval: 0.5,
      leader: office('President of France', ['proud', 'independent-minded'], ['European strategic autonomy', 'influence in Africa'], 'eloquent French diplomacy') }),
    n('GER', 'Germany', '#5d6a74', { quality: 1.05, capital: 'Berlin', major: true, military: 1.1, aggression: 0.1, naval: 0.2,
      leader: office('Chancellor of Germany', ['cautious', 'consensus-seeking'], ['European unity', 'energy security'], 'careful, consensus-minded German politics') }),
    n('JPN', 'Japan', '#e7b3b3', { quality: 1.1, capital: 'Tokyo', major: true, military: 1.1, aggression: 0.1, naval: 0.6,
      leader: office('Prime Minister of Japan', ['cautious', 'resolute'], ['deter China and North Korea', 'the US alliance'], 'polite, careful Japanese diplomacy') }),
    n('BRA', 'Brazil', '#4f9a5a', { capital: 'Brasília', major: true, military: 1.0, aggression: 0.1,
      leader: office('President of Brazil', ['independent', 'regional leader'], ['Global South leadership', 'Amazon sovereignty'], 'warm Latin American diplomacy') }),
    n('TUR', 'Turkey', '#b3463f', { quality: 1, capital: 'Ankara', major: true, military: 1.3, aggression: 0.15, naval: 0.35,
      leader: office('President of Turkey', ['assertive', 'transactional'], ['regional power', 'leverage between East and West'], 'assertive, transactional diplomacy') }),
    n('IRN', 'Iran', '#4f8a6a', { quality: 0.85, capital: 'Tehran', major: true, military: 1.2, aggression: 0.25,
      leader: office('Supreme Leader of Iran', ['defiant', 'ideological'], ['regime survival', 'the axis of resistance'], 'defiant revolutionary rhetoric', ['the United States', 'Israel']) }),
    n('ISR', 'Israel', '#6a8fc9', { quality: 1.25, capital: 'Jerusalem', military: 1.3, aggression: 0.35,
      leader: office('Prime Minister of Israel', ['security-obsessed', 'hawkish'], ['stop Iran', 'secure the borders'], 'blunt security-first rhetoric', ['Iran']) }),
    n('PAK', 'Pakistan', '#2f7a4f', { capital: 'Islamabad', military: 1.2, aggression: 0.3,
      leader: office('Prime Minister of Pakistan', ['wary', 'military-backed'], ['Kashmir', 'balance against India'], 'formal South Asian diplomacy', ['India']) }),
    n('UKR', 'Ukraine', '#5b8fd9', { quality: 1.05, capital: 'Kyiv', military: 2.4, aggression: 0.15,
      leader: office('President of Ukraine', ['defiant', 'determined'], ['expel Russian forces', 'join the EU and NATO'], 'defiant wartime leadership', ['Russia']) }),
    n('KOR', 'Korea, Republic of', '#7aa0c9', { quality: 1.1, shortName: 'South Korea', capital: 'Seoul', military: 1.2, aggression: 0.1, naval: 0.4,
      leader: office('President of South Korea', ['cautious'], ['deter the North', 'the US alliance'], 'careful diplomacy') }),
    n('PRK', "Korea, Democratic People's Republic of", '#7a3a3a', { quality: 0.75, shortName: 'North Korea', capital: 'Pyongyang', military: 1.3, aggression: 0.45,
      leader: office('Supreme Leader of North Korea', ['paranoid', 'belligerent'], ['regime survival', 'reunification on its terms'], 'bombastic state-media rhetoric', ['the United States', 'South Korea']) }),
    n('TWN', 'Taiwan', '#5aa0a0', { capital: 'Taipei', military: 0.9, aggression: 0.05, naval: 0.3,
      leader: office('President of Taiwan', ['cautious', 'resolute'], ['preserve self-rule', 'deter invasion'], 'careful, democratic diplomacy') }),
    n('SAU', 'Saudi Arabia', '#a9b56a', { capital: 'Riyadh', military: 1.0, aggression: 0.2,
      leader: office('Crown Prince of Saudi Arabia', ['ambitious', 'modernising'], ['contain Iran', 'diversify the economy'], 'confident Gulf diplomacy', ['Iran']) }),
    n('POL', 'Poland', '#d96e8a', { capital: 'Warsaw', military: 1.1, aggression: 0.1 }),
    n('ITA', 'Italy', '#6aa86a', { capital: 'Rome', military: 0.9, aggression: 0.1, naval: 0.4 }),
    n('ESP', 'Spain', '#d8b45a', { capital: 'Madrid', military: 0.8, aggression: 0.05, naval: 0.3 }),
    n('CAN', 'Canada', '#d27b86', { capital: 'Ottawa', military: 0.8, aggression: 0.05 }),
    n('AUS', 'Australia', '#d99a7e', { capital: 'Canberra', military: 0.8, aggression: 0.05, naval: 0.4 }),
    n('NED', 'Netherlands', '#e08a3c', { capital: 'The Hague', military: 0.6, aggression: 0.05 }),
    n('NOR', 'Norway', '#a36464', { capital: 'Oslo', military: 0.6, aggression: 0.05 }),
    n('DEN', 'Denmark', '#b5655a', { capital: 'København', military: 0.5, aggression: 0.05 }),
    n('FIN', 'Finland', '#9ab0d0', { capital: 'Helsinki', military: 0.8, aggression: 0.05 }),
    n('SWE', 'Sweden', '#7fa6c9', { capital: 'Stockholm', military: 0.7, aggression: 0.05 }),
    n('ROU', 'Romania', '#d1c46a', { capital: 'Bucharest', military: 0.6, aggression: 0.05 }),
    n('GRC', 'Greece', '#7fb6d9', { capital: 'Athens', military: 0.6, aggression: 0.05 }),
    n('BLR', 'Byelarus', '#8a9a6a', { shortName: 'Belarus', capital: 'Minsk', military: 0.6, aggression: 0.1 }),
    n('EGY', 'Egypt', '#c9b27a', { capital: 'Cairo', military: 1.0, aggression: 0.1 }),
    n('IDN', 'Indonesia', '#b07a5a', { capital: 'Jakarta', military: 1.0, aggression: 0.05, naval: 0.3 }),
    n('MEX', 'Mexico', '#4f8a5c', { capital: 'Mexico City', military: 0.8, aggression: 0.05 }),
  ],
  assignOwner(p, owner) {
    // Russian-occupied Ukraine: Crimea and much of the Donbas and the south-east
    if (owner === 'UKR' && (p.lat < 46.2 || (p.lon > 36.6 && p.lat < 48.8) || (p.lon > 38.2 && p.lat < 49.6))) return 'RUS';
    return undefined;
  },
  wars: [{ attackers: ['RUS'], defenders: ['UKR'] }],
  treaties: [
    { type: 'alliance', parties: ['USA', 'CAN', 'GBR', 'FRA', 'GER', 'ITA', 'ESP', 'POL', 'TUR', 'NED', 'NOR', 'DEN', 'FIN', 'SWE', 'ROU', 'GRC'] },
    { type: 'alliance', parties: ['USA', 'JPN'] },
    { type: 'alliance', parties: ['USA', 'KOR'] },
    { type: 'alliance', parties: ['USA', 'AUS'] },
    { type: 'alliance', parties: ['RUS', 'BLR'] },
    { type: 'alliance', parties: ['CHN', 'PRK'] },
  ],
  relations: [
    ['USA', 'CHN', -30], ['USA', 'RUS', -60], ['RUS', 'UKR', -95], ['CHN', 'TWN', -60], ['USA', 'TWN', 50], ['IND', 'PAK', -65], ['IND', 'CHN', -30],
    ['ISR', 'IRN', -85], ['SAU', 'IRN', -40], ['KOR', 'PRK', -70], ['JPN', 'CHN', -25], ['USA', 'IRN', -70], ['CHN', 'RUS', 45], ['RUS', 'IRN', 35],
    ['RUS', 'PRK', 40], ['USA', 'ISR', 60], ['USA', 'UKR', 55], ['POL', 'RUS', -60], ['FIN', 'RUS', -50], ['TUR', 'GRC', -10], ['USA', 'PRK', -80],
  ],
  victory: { conquestPercent: 50 },
  combat: { homeDefense: 1.5 },
  aiWarAppetite: 0.25,
};
