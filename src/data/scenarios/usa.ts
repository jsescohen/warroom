import type { NationDef, ScenarioDef } from '../../core/scenario';
import { DAILY } from './common';

/** [name, id, capital, bloc, military, aggression] — capital is a city name that may exist as a province. */
const STATES: [string, string, string, string, number, number][] = [
  ['Alabama', 'AL', 'Montgomery', 'south', 0.9, 0.25], ['Alaska', 'AK', 'Juneau', 'pacific', 0.6, 0.15], ['Arizona', 'AZ', 'Phoenix', 'mountain', 1.0, 0.25],
  ['Arkansas', 'AR', 'Little Rock', 'south', 0.8, 0.2], ['California', 'CA', 'Sacramento', 'pacific', 1.6, 0.35], ['Colorado', 'CO', 'Denver', 'mountain', 1.0, 0.2],
  ['Connecticut', 'CT', 'Hartford', 'newengland', 0.7, 0.1], ['Delaware', 'DE', 'Dover', 'midatlantic', 0.5, 0.1], ['District of Columbia', 'DC', 'Washington, D.C.', 'midatlantic', 0.6, 0.05],
  ['Florida', 'FL', 'Tallahassee', 'south', 1.4, 0.4], ['Georgia', 'GA', 'Atlanta', 'south', 1.1, 0.3], ['Hawaii', 'HI', 'Honolulu', 'pacific', 0.6, 0.1],
  ['Idaho', 'ID', 'Boise', 'mountain', 0.7, 0.25], ['Illinois', 'IL', 'Springfield', 'midwest', 1.2, 0.2], ['Indiana', 'IN', 'Indianapolis', 'midwest', 1.0, 0.2],
  ['Iowa', 'IA', 'Des Moines', 'plains', 0.8, 0.15], ['Kansas', 'KS', 'Topeka', 'plains', 0.8, 0.2], ['Kentucky', 'KY', 'Frankfort', 'south', 0.9, 0.25],
  ['Louisiana', 'LA', 'Baton Rouge', 'south', 0.9, 0.25], ['Maine', 'ME', 'Augusta', 'newengland', 0.6, 0.1], ['Maryland', 'MD', 'Annapolis', 'midatlantic', 0.9, 0.15],
  ['Massachusetts', 'MA', 'Boston', 'newengland', 1.0, 0.15], ['Michigan', 'MI', 'Lansing', 'midwest', 1.1, 0.2], ['Minnesota', 'MN', 'Saint Paul', 'midwest', 1.0, 0.15],
  ['Mississippi', 'MS', 'Jackson', 'south', 0.8, 0.25], ['Missouri', 'MO', 'Jefferson City', 'plains', 1.0, 0.25], ['Montana', 'MT', 'Helena', 'mountain', 0.7, 0.25],
  ['Nebraska', 'NE', 'Lincoln', 'plains', 0.7, 0.2], ['Nevada', 'NV', 'Carson City', 'mountain', 0.8, 0.25], ['New Hampshire', 'NH', 'Concord', 'newengland', 0.6, 0.15],
  ['New Jersey', 'NJ', 'Trenton', 'midatlantic', 1.0, 0.15], ['New Mexico', 'NM', 'Santa Fe', 'mountain', 0.8, 0.2], ['New York', 'NY', 'Albany', 'midatlantic', 1.4, 0.25],
  ['North Carolina', 'NC', 'Raleigh', 'south', 1.1, 0.25], ['North Dakota', 'ND', 'Bismarck', 'plains', 0.6, 0.2], ['Ohio', 'OH', 'Columbus', 'midwest', 1.2, 0.25],
  ['Oklahoma', 'OK', 'Oklahoma City', 'plains', 0.9, 0.3], ['Oregon', 'OR', 'Salem', 'pacific', 0.9, 0.15], ['Pennsylvania', 'PA', 'Harrisburg', 'midatlantic', 1.2, 0.25],
  ['Rhode Island', 'RI', 'Providence', 'newengland', 0.5, 0.1], ['South Carolina', 'SC', 'Columbia', 'south', 0.9, 0.3], ['South Dakota', 'SD', 'Pierre', 'plains', 0.6, 0.2],
  ['Tennessee', 'TN', 'Nashville', 'south', 1.0, 0.3], ['Texas', 'TX', 'Austin', 'texas', 1.7, 0.6], ['Utah', 'UT', 'Salt Lake City', 'mountain', 0.8, 0.2],
  ['Vermont', 'VT', 'Montpelier', 'newengland', 0.5, 0.1], ['Virginia', 'VA', 'Richmond', 'midatlantic', 1.1, 0.25], ['Washington', 'WA', 'Olympia', 'pacific', 1.1, 0.2],
  ['West Virginia', 'WV', 'Charleston', 'south', 0.7, 0.25], ['Wisconsin', 'WI', 'Madison', 'midwest', 1.0, 0.15], ['Wyoming', 'WY', 'Cheyenne', 'mountain', 0.6, 0.25],
];

const BLOC_STYLE: Record<string, string> = {
  pacific: 'progressive West Coast politics, tech and trade minded',
  mountain: 'independent-minded Western plain talk, land and water rights',
  south: 'Southern hospitality over hard bargaining, faith and self-reliance',
  midwest: 'practical Midwestern common sense, manufacturing and farming',
  plains: 'laconic Plains straight talk, agriculture and energy',
  newengland: 'learned New England town-meeting rhetoric',
  midatlantic: 'fast-talking East Coast power politics, finance and institutions',
  texas: 'big, proud Texan swagger, energy and independence',
};

/** Distinct, evenly spread hues for 51 states. */
const color = (i: number) => {
  const hue = (i * 137.508) % 360;
  const l = 0.5 + (i % 3) * 0.07, s = 0.42 + (i % 2) * 0.12;
  const f = (k: number) => {
    const t = (k + hue / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round((l - a * Math.max(-1, Math.min(t - 3, 9 - t, 1))) * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

const nations: NationDef[] = STATES.map(([name, id, capital, bloc, military, aggression], i) => ({
  id, name: name === 'District of Columbia' ? 'District of Columbia' : `State of ${name}`, shortName: name === 'District of Columbia' ? 'D.C.' : name,
  color: color(i), polities: [name], capital, playable: true, major: military >= 1.2, military, aggression, naval: bloc === 'pacific' ? 0.3 : 0.1,
  units: ['infantry', 'armor', 'drones', 'air'],
  leader: {
    name: `The Governor of ${name}`, title: `Governor of ${name}`, traits: aggression >= 0.35 ? ['ambitious', 'assertive'] : ['cautious', 'pragmatic'],
    goals: ['keep the state safe and solvent', 'secure water, power and trade routes'], speechStyle: `modern American politics; ${BLOC_STYLE[bloc]}`,
  },
}));

const blocs = [...new Set(STATES.map((s) => s[3]))]
  .map((b) => STATES.filter((s) => s[3] === b).map((s) => s[1]))
  .filter((members) => members.length >= 2);

export const usa: ScenarioDef = {
  id: 'usa',
  era: 'usa',
  name: 'Divided States',
  subtitle: 'The present day — Fifty states, fifty nations',
  startDate: '2026-01-01',
  theme: 'tactical',
  map: '/maps/usa.json',
  context:
    'An alternate present: the federal government has collapsed and the fifty states (and the District) act as sovereign ' +
    'nations with their National Guards. Regional blocs — the Pacific coast, New England, the Deep South, the Midwest, the ' +
    'Plains and the Mountain West — hold together for now; Texas goes its own way. Fiction: no real officials are portrayed.',
  advisor: {
    title: 'State Adjutant General',
    style: 'a modern American military briefing: crisp, plain-spoken, cites logistics, interstates, power grids and public opinion; addresses the governor as "Governor"',
    reportName: 'Adjutant General briefing',
  },
  time: DAILY,
  unitTypes: [
    { id: 'infantry', name: 'National Guard Brigade', short: 'Guard Brigade', attack: 3.5, defense: 5, speed: 30 },
    { id: 'armor', name: 'Armored Battalion', short: 'Armor', attack: 6.5, defense: 4, speed: 40 },
    { id: 'drones', name: 'Drone Squadron', short: 'Drones', attack: 5, defense: 1.5, speed: 90 },
    { id: 'air', name: 'Air National Guard Wing', short: 'Air Wing', attack: 6, defense: 2, speed: 160 },
    { id: 'destroyers', name: 'Coastal Squadron', short: 'Coastal Squadron', attack: 4, defense: 4, speed: 90, domain: 'sea', bombard: 1, strike: { kind: 'missile', range: 120, power: 1.2, cooldownHours: 72 } },
  ],
  nations,
  treaties: blocs.map((parties) => ({ type: 'alliance' as const, parties })),
  relations: [
    ['TX', 'CA', -30], ['TX', 'NM', -20], ['TX', 'OK', -10], ['CA', 'FL', -20], ['NY', 'FL', -10], ['DC', 'TX', -15],
  ],
  victory: { conquestPercent: 50 },
  aiWarAppetite: 0.5,
  combat: { homeDefense: 1.5 },
};
