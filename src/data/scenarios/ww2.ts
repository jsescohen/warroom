import type { ScenarioDef } from '../../core/scenario';

/**
 * World War 2 — 1 September 1939.
 * Geometry comes from the 1938 historical basemap; `assignOwner` applies the changes between
 * the map's date and the scenario start (Bohemia-Moravia, Slovakia, Albania, occupied China...).
 */
export const ww2: ScenarioDef = {
  id: 'ww2',
  era: 'ww2',
  name: 'World War II',
  subtitle: '1 September 1939 — The Invasion of Poland',
  startDate: '1939-09-01',
  theme: 'sepia',
  map: '/maps/world_1938.json',
  advisor: {
    title: 'Chief of the General Staff',
    style: 'a blunt 1939 staff general: clipped sentences, military terms (divisions, fronts, logistics), addresses the leader as "Sir", no modern references',
    reportName: 'Staff briefing',
  },
  time: { tickHours: 6, turnHours: 24, turnName: 'Day', secondsPerTurn: 15, skipMaxTurns: 14, showHours: true },
  context:
    'September 1939. Germany has annexed Austria and Czechia and invades Poland. Britain and France guarantee Poland. ' +
    'Germany and the USSR have just signed a secret non-aggression pact. Italy is allied to Germany (Pact of Steel). ' +
    'Japan is at war with China and eyes Southeast Asia. The USA is isolationist but wary.',
  unitTypes: [
    { id: 'infantry', name: 'Infantry Army', short: 'Army', attack: 3, defense: 4, speed: 15 },
    { id: 'armor', name: 'Armored Corps', short: 'Armored Corps', attack: 6, defense: 3, speed: 30 },
    { id: 'artillery', name: 'Artillery Corps', short: 'Artillery Corps', attack: 5, defense: 2.5, speed: 13 },
    { id: 'air', name: 'Air Fleet', short: 'Air Fleet', attack: 4.5, defense: 1.5, speed: 90, strike: { kind: 'air', range: 70, power: 0.8, cooldownHours: 72 } },
  ],
  nations: [
    { id: 'GER', name: 'German Reich', shortName: 'Germany', color: '#5d6a74', quality: 1.3, naval: 0.25, aggression: 0.9, polities: ['Germany'], capital: 'Berlin', major: true, playable: true,
      leader: {name: 'Adolf Hitler', title: 'Führer and Reich Chancellor', traits: ['aggressive','opportunistic','distrustful','impatient'], goals: ['destroy Poland quickly','avoid a two-front war until ready','overturn Versailles'], grudges: ['France and Britain for Versailles'], speechStyle: 'bombastic and domineering, speaks of destiny, strength and the Reich; menacing toward the weak'}, military: 2.4, units: ['infantry', 'armor', 'infantry', 'artillery', 'armor', 'air'] },
    { id: 'ITA', name: 'Kingdom of Italy', shortName: 'Italy', color: '#5e9a5a', quality: 0.85, naval: 0.35, aggression: 0.6, subjects: ['Italy'], polities: ['Libya', 'Albania'], capital: 'Rome', major: true, playable: true,
      leader: {name: 'Benito Mussolini', title: 'Duce of Fascist Italy', traits: ['vain','opportunistic','theatrical'], goals: ['a Mediterranean empire','gains in the Balkans and Africa','join the winning side'], grudges: ['France over Nice, Corsica and Tunisia'], speechStyle: 'theatrical and grandiose, invokes ancient Rome, flatters the strong'}, military: 1.5, units: ['infantry', 'infantry', 'armor'] },
    { id: 'JPN', name: 'Empire of Japan', shortName: 'Japan', color: '#d9b04a', quality: 1.1, naval: 0.7, aggression: 0.85, subjects: ['Empire of Japan'], capital: 'Tokyo', major: true, playable: true,
      leader: {name: 'Prince Fumimaro Konoe', title: 'Envoy of the Imperial Government', traits: ['formal','proud','calculating'], goals: ['victory in China','secure resources in Southeast Asia','keep the Soviets at bay'], grudges: ['Western embargoes and condescension'], speechStyle: 'formal and courteous on the surface, indirect, speaks for the Emperor’s government'}, military: 2.0, units: ['infantry', 'infantry', 'armor', 'air'] },
    {
      id: 'GBR', name: 'United Kingdom', shortName: 'Britain', color: '#c2475b', quality: 1.05, naval: 1, aggression: 0.2, capital: 'London', major: true, playable: true,
      leader: {name: 'Neville Chamberlain', title: 'Prime Minister of the United Kingdom', traits: ['cautious','principled','weary of war'], goals: ['contain Germany','protect the Empire','keep the United States friendly'], grudges: ['Hitler broke the Munich agreement'], speechStyle: 'measured, formal British parliamentary English, understated'}, military: 0.8, units: ['infantry', 'armor', 'air'],
      subjects: ['United Kingdom', 'United Kingdom of Great Britain and Ireland'],
      polities: [
        'India', 'Sudan', 'Ceylon', 'Malawi', 'Jamaica', 'Belize', 'Guyana', 'Bahamas', 'Trinidad', 'Barbados', 'Gambia, The',
        'Antigua and Barbuda', 'Dominica', 'Grenada', 'Montserrat', 'Anguilla', 'Saint Kitts and Nevis', 'Saint Lucia',
        'Saint Vincent and the Grenadines', 'Turks and Caicos Islands', 'Fiji', 'Tonga', 'Brunei', 'Dominion of Newfoundland',
        'Israel', 'Jordan', 'Kuwait', 'Niue',
      ],
    },
    {
      id: 'FRA', name: 'French Republic', shortName: 'France', color: '#4a78c2', naval: 0.45, aggression: 0.15, subjects: ['France'], capital: 'Paris', major: true, playable: true,
      leader: {name: 'Édouard Daladier', title: 'President of the Council of France', traits: ['defensive','anxious','loyal to Britain'], goals: ['hold the Maginot Line','keep Britain committed','avoid another Verdun'], grudges: ['Germany since 1870','Italy’s claims on French land'], speechStyle: 'proud, eloquent French diplomacy, occasional French phrases'}, military: 1.0, units: ['infantry', 'infantry', 'artillery', 'armor'],
      polities: ['French Guiana', 'French Somaliland', 'Guadeloupe', 'Martinique', 'Tunisia', 'Togo', 'Laos', 'Cambodia', 'Cochin China', 'Wallis and Futuna Islands', 'Saint Barthelemy', 'Saint Martin'],
    },
    { id: 'SOV', name: 'Soviet Union', shortName: 'USSR', color: '#8e2f2f', quality: 0.9, naval: 0.2, aggression: 0.65, subjects: ['USSR'], capital: 'Moscow', major: true, playable: true,
      leader: {name: 'Joseph Stalin', title: 'General Secretary of the Soviet Union', traits: ['cunning','suspicious','patient','ruthless'], goals: ['a buffer zone in the west','regain the Baltic, eastern Poland, Bessarabia and Karelia','let the capitalists bleed each other'], grudges: ['Western powers excluded the USSR at Munich','Poland for 1920'], speechStyle: 'terse, dry, quietly threatening, speaks of the interests of the Soviet people'}, military: 1.6, units: ['infantry', 'infantry', 'armor', 'artillery'] },
    { id: 'USA', name: 'United States', shortName: 'USA', color: '#4c9ea0', quality: 1, naval: 0.8, aggression: 0.1, subjects: ['United States'], polities: ['Puerto Rico', 'American Samoa', 'United States Virgin Islands'], capital: 'Washington, D.C.', major: true, playable: true,
      leader: {name: 'Franklin D. Roosevelt', title: 'President of the United States', traits: ['pragmatic','charming','cautious about public opinion'], goals: ['keep America out of war for now','support the democracies','check Japan in the Pacific'], grudges: ['Japanese aggression in China'], speechStyle: 'warm, folksy but firm American statesman'}, military: 0.6, units: ['infantry', 'armor', 'air'] },
    { id: 'CHN', name: 'Republic of China', shortName: 'China', color: '#cf8a4f', quality: 0.8, aggression: 0.2, polities: ['Chinese warlords'], capital: 'Chongqing', major: true, playable: true,
      leader: {name: 'Chiang Kai-shek', title: 'Generalissimo of the Republic of China', traits: ['stubborn','proud','anti-communist'], goals: ['survive the Japanese invasion','win foreign aid','keep the communists in check'], grudges: ['Japan for the invasion of China'], speechStyle: 'stern, dignified, appeals to justice and Chinese sovereignty'}, military: 1.4, units: ['infantry'] },
    { id: 'POL', name: 'Republic of Poland', shortName: 'Poland', color: '#b48fcf', quality: 0.85, aggression: 0.1, polities: ['Poland'], capital: 'Warsaw', playable: true,
      leader: {name: 'Edward Rydz-Śmigły', title: 'Marshal of Poland', traits: ['brave','proud','defiant'], goals: ['defend Polish independence','hold until Britain and France strike'], grudges: ['Germany','the Soviet Union'], speechStyle: 'defiant and patriotic, military bearing'}, military: 1.1, units: ['infantry', 'infantry', 'artillery'] },
    { id: 'CAN', name: 'Dominion of Canada', shortName: 'Canada', color: '#d27b86', naval: 0.3, polities: ['Canada'], capital: 'Ottawa', playable: true },
    { id: 'AUS', name: 'Commonwealth of Australia', shortName: 'Australia', color: '#d99a7e', naval: 0.3, polities: ['Australia'], capital: 'Canberra', playable: true },
    { id: 'NZL', name: 'New Zealand', color: '#e0a3ac', polities: ['New Zealand', 'Samoa'], capital: 'Wellington' },
    { id: 'SAF', name: 'Union of South Africa', shortName: 'South Africa', color: '#b8706a', polities: ['Union of South Africa', 'Walbis Bay'], capital: 'Pretoria' },
    { id: 'ESP', name: 'Spanish State', shortName: 'Spain', color: '#c9a86b', subjects: ['Spain'], capital: 'Madrid', playable: true },
    { id: 'POR', name: 'Portugal', color: '#6e9e7e', subjects: ['Portugal'], polities: ['Guinea-Bissau'], capital: 'Lisbon' },
    { id: 'NED', name: 'Netherlands', color: '#e08a3c', naval: 0.3, subjects: ['Netherlands'], polities: ['Suriname', 'Netherlands Antilles'], capital: 'The Hague' },
    { id: 'BEL', name: 'Belgium', color: '#bfae3e', subjects: ['Belgium'], polities: ['Burundi'], capital: 'Brussels' },
    { id: 'TUR', name: 'Republic of Turkey', shortName: 'Turkey', color: '#9e6b54', polities: ['Turkey'], capital: 'Ankara', playable: true },
    { id: 'ROM', name: 'Kingdom of Romania', shortName: 'Romania', color: '#d1c46a', polities: ['Romania'], capital: 'Bucharest' },
    { id: 'HUN', name: 'Kingdom of Hungary', shortName: 'Hungary', color: '#8aa65e', aggression: 0.35, polities: ['Hungary'], capital: 'Budapest' },
    { id: 'YUG', name: 'Kingdom of Yugoslavia', shortName: 'Yugoslavia', color: '#6b86a8', polities: ['Yugoslavia'], capital: 'Belgrade' },
    { id: 'GRE', name: 'Kingdom of Greece', shortName: 'Greece', color: '#7fb6d9', polities: ['Greece'], capital: 'Athens' },
    { id: 'BUL', name: 'Kingdom of Bulgaria', shortName: 'Bulgaria', color: '#7e9a6a', aggression: 0.3, polities: ['Bulgaria'], capital: 'Sofia' },
    { id: 'SWE', name: 'Sweden', color: '#7fa6c9', polities: ['Sweden'], capital: 'Stockholm' },
    { id: 'NOR', name: 'Norway', color: '#a36464', polities: ['Norway'], capital: 'Oslo' },
    { id: 'DEN', name: 'Denmark', color: '#b5655a', polities: ['Denmark'], capital: 'København' },
    { id: 'FIN', name: 'Finland', color: '#9ab0d0', polities: ['Finland'], capital: 'Helsinki' },
    { id: 'SVK', name: 'Slovak Republic', shortName: 'Slovakia', color: '#8d9fb5' },
    { id: 'MON', name: "Mongolian People's Republic", shortName: 'Mongolia', color: '#a8755a', polities: ['Mongolia'], capital: 'Ulaanbaatar' },
    { id: 'SIA', name: 'Kingdom of Siam', shortName: 'Siam', color: '#6aa8c9', polities: ['Siam'], capital: 'Bangkok' },
    { id: 'BRA', name: 'Brazil', color: '#6fae5e', polities: ['Brazil'], capital: 'Rio de Janeiro' },
    { id: 'ARG', name: 'Argentina', color: '#8fc0d8', polities: ['Argentina'], capital: 'Buenos Aires' },
    { id: 'MEX', name: 'Mexico', color: '#4f8a5c', polities: ['Mexico'], capital: 'Mexico City' },
    { id: 'IRN', name: 'Imperial Iran', shortName: 'Iran', color: '#78a07a', polities: ['Iran'], capital: 'Tehran' },
    { id: 'SAU', name: 'Saudi Arabia', color: '#a9b56a', polities: ['Saudi Arabia', 'Hejaz', 'Hail', "Emirate of Bin Shal'an"], capital: 'Riyadh' },
    { id: 'EGY', name: 'Kingdom of Egypt', shortName: 'Egypt', color: '#c9b27a', polities: ['Egypt'], capital: 'Cairo' },
    { id: 'IRL', name: 'Ireland', color: '#77b07a', polities: ['Ireland'], capital: 'Dublin' },
  ],
  minorNames: {
    Xinjiang: 'Xinjiang Clique',
    Tibet: 'Tibet',
  },
  assignOwner(p, owner) {
    // March 1939: Germany occupies Bohemia-Moravia; Slovakia becomes a German client; Hungary takes Carpatho-Ukraine.
    if (p.polity === 'Czechoslovakia') {
      if (p.lon < 17.3) return 'GER';
      return p.lon > 22 ? 'HUN' : 'SVK';
    }
    if (p.polity === 'Lithuania' && p.name === 'Klaipėda') return 'GER';
    // Japanese-occupied eastern China by late 1939.
    if (owner === 'CHN' && ((p.lat >= 29.5 && p.lat <= 42 && p.lon >= 112.5) || (p.lat < 24 && p.lon > 112.8))) return 'JPN';
    return undefined;
  },
  wars: [
    { attackers: ['GER'], defenders: ['POL'] },
    { attackers: ['JPN'], defenders: ['CHN'] },
  ],
  treaties: [
    { type: 'alliance', parties: ['GBR', 'FRA', 'POL'] },
    { type: 'alliance', parties: ['GER', 'ITA'] },
    { type: 'alliance', parties: ['GBR', 'CAN', 'AUS', 'NZL', 'SAF'] },
    { type: 'non-aggression', parties: ['GER', 'SOV'] },
    { type: 'alliance', parties: ['GER', 'SVK'] },
  ],
  relations: [
    ['GER', 'POL', -90], ['GER', 'GBR', -45], ['GER', 'FRA', -50], ['GER', 'ITA', 60], ['GER', 'SOV', 10],
    ['GER', 'JPN', 40], ['GER', 'USA', -20], ['GER', 'HUN', 35], ['GER', 'SVK', 60], ['GER', 'ROM', 5],
    ['JPN', 'CHN', -95], ['JPN', 'USA', -35], ['JPN', 'SOV', -45], ['JPN', 'GBR', -25],
    ['GBR', 'FRA', 75], ['GBR', 'USA', 50], ['GBR', 'POL', 55], ['FRA', 'POL', 55], ['GBR', 'ITA', -20], ['FRA', 'ITA', -35],
    ['SOV', 'POL', -50], ['SOV', 'FIN', -40], ['SOV', 'GBR', -20], ['SOV', 'MON', 70], ['SOV', 'ROM', -30],
    ['USA', 'CHN', 30], ['USA', 'CAN', 70], ['HUN', 'ROM', -50], ['ITA', 'GRE', -30], ['ITA', 'YUG', -25],
  ],
  scripted: [
    {
      date: '1939-09-03',
      actions: ['GBR', 'FRA', 'AUS', 'NZL'].map((n) => war(n, 'GER')),
    },
    { date: '1939-09-06', actions: [war('SAF', 'GER')] },
    { date: '1939-09-10', actions: [war('CAN', 'GER')] },
    { date: '1939-09-17', text: 'Soviet forces cross the Polish border under the secret protocol.', actions: [war('SOV', 'POL')] },
    { date: '1939-11-30', text: 'The Winter War begins.', actions: [war('SOV', 'FIN')] },
    { date: '1940-04-09', text: 'Operation Weserübung: Germany strikes north.', actions: [war('GER', 'DEN'), war('GER', 'NOR')] },
    { date: '1940-05-10', text: 'Fall Gelb: the offensive in the West begins.', actions: [war('GER', 'NED'), war('GER', 'BEL'), war('GER', 'm_luxembourg')] },
    { date: '1940-06-10', actions: [war('ITA', 'FRA'), war('ITA', 'GBR')] },
  ],
  victory: { conquestPercent: 60 },
  // occupying a province takes a couple of days once its defenders are beaten
  combat: { captureDays: 2 },
};

function war(attacker: string, defender: string) {
  return { type: 'declareWar' as const, attacker, defender };
}
