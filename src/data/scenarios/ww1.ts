import type { ScenarioDef } from '../../core/scenario';
import { DAILY, war } from './common';

const edwardian = 'formal Edwardian-era diplomacy: honour, treaties, mobilisation and the balance of power';

export const ww1: ScenarioDef = {
  id: 'ww1',
  era: 'ww1',
  name: 'World War I',
  subtitle: '28 July 1914 — The guns of August',
  startDate: '1914-07-28',
  theme: 'sepia',
  map: '/maps/world_1914.json',
  context:
    'July 1914. A month after the assassination in Sarajevo, Austria-Hungary declares war on Serbia. Russia mobilises for ' +
    'Serbia; Germany is bound to Austria and plans to knock out France through Belgium; Britain guarantees Belgium. Machine ' +
    'guns and artillery favour the defender. Italy is a Triple Alliance member but undecided; the Ottomans lean to Germany.',
  advisor: {
    title: 'Chief of the General Staff',
    style: 'a 1914 general staff officer: confident in railway timetables, cavalry and the offensive spirit, speaks of mobilisation, fortresses and honour; addresses the leader as "Your Majesty" or "Prime Minister"',
    reportName: 'General Staff appreciation',
  },
  time: DAILY,
  unitTypes: [
    { id: 'infantry', name: 'Infantry Corps', short: 'Corps', attack: 3, defense: 5, speed: 4 },
    { id: 'cavalry', name: 'Cavalry Division', short: 'Cavalry', attack: 3, defense: 2, speed: 8 },
    { id: 'artillery', name: 'Heavy Artillery', short: 'Artillery', attack: 6, defense: 2.5, speed: 3 },
  ],
  nations: [
    {
      id: 'GER', name: 'German Empire', shortName: 'Germany', color: '#5d6a74', quality: 1.15, subjects: ['German Empire'], polities: ['German South-West Africa', 'Kamerun', 'Togo'], capital: 'Berlin',
      major: true, playable: true, military: 2.5, aggression: 0.7, naval: 0.55, units: ['infantry', 'infantry', 'artillery', 'cavalry'],
      leader: { name: 'Wilhelm II', title: 'German Emperor and King of Prussia', traits: ['impulsive', 'grandiose', 'insecure'], goals: ['support Austria', 'a quick victory in the west', 'a place in the sun'], grudges: ['British naval supremacy', 'encirclement by the Entente'], speechStyle: `${edwardian}; bombastic, theatrical, speaks of the Fatherland and shining armour` },
    },
    {
      id: 'AUH', name: 'Austro-Hungarian Empire', shortName: 'Austria-Hungary', color: '#e3c25b', quality: 0.9, polities: ['Austro-Hungarian Empire'], capital: 'Vienna',
      major: true, playable: true, military: 2.2, aggression: 0.55, naval: 0.3, units: ['infantry', 'infantry', 'cavalry', 'artillery'],
      leader: { name: 'Franz Joseph I', title: 'Emperor of Austria and Apostolic King of Hungary', traits: ['dutiful', 'old', 'fatalistic'], goals: ['punish Serbia', 'preserve the Dual Monarchy'], grudges: ['Serbia', 'Russian pan-Slavism'], speechStyle: `${edwardian}; austere Habsburg dignity` },
    },
    {
      id: 'FRA', name: 'French Republic', shortName: 'France', color: '#4a78c2', quality: 1, subjects: ['France'], capital: 'Paris', major: true, playable: true,
      military: 1.8, aggression: 0.2, naval: 0.5, units: ['infantry', 'infantry', 'artillery', 'cavalry'],
      leader: { name: 'Raymond Poincaré', title: 'President of the French Republic', traits: ['determined', 'patriotic', 'legalistic'], goals: ['honour the Russian alliance', 'recover Alsace-Lorraine'], grudges: ['Germany since 1871'], speechStyle: `${edwardian}; eloquent French republicanism` },
    },
    {
      id: 'GBR', name: 'United Kingdom', shortName: 'Britain', color: '#c2475b', quality: 1.05, subjects: ['United Kingdom of Great Britain and Ireland', 'United Kingdom'], capital: 'London',
      major: true, playable: true, military: 1.0, aggression: 0.2, naval: 1.0, units: ['infantry', 'artillery', 'cavalry'],
      leader: { name: 'H. H. Asquith', title: 'Prime Minister of the United Kingdom', traits: ['measured', 'liberal', 'reluctant'], goals: ['uphold Belgian neutrality', 'keep the naval balance', 'avoid war if honourable'], speechStyle: `${edwardian}; understated parliamentary English` },
    },
    {
      id: 'RUS', name: 'Russian Empire', shortName: 'Russia', color: '#8e2f2f', quality: 0.85, subjects: ['Russia'], capital: 'St. Petersburg', major: true, playable: true,
      military: 2.0, aggression: 0.45, naval: 0.3, units: ['infantry', 'infantry', 'cavalry', 'artillery'],
      leader: { name: 'Nicholas II', title: 'Emperor and Autocrat of All the Russias', traits: ['devout', 'indecisive', 'fatalistic'], goals: ['protect Serbia and the Slavs', 'the Straits'], grudges: ['Austria-Hungary', 'the 1905 humiliation'], speechStyle: `${edwardian}; pious autocracy, speaks of Holy Russia` },
    },
    {
      id: 'OTT', name: 'Ottoman Empire', shortName: 'Ottomans', color: '#5e9a5a', quality: 0.85, polities: ['Ottoman Empire'], capital: 'Constantinople', major: true, playable: true,
      military: 1.2, aggression: 0.35, naval: 0.2,
      leader: { name: 'Enver Pasha', title: 'Minister of War of the Ottoman Empire', traits: ['reckless', 'ambitious', 'pro-German'], goals: ['recover lost provinces', 'a pan-Turkic empire'], grudges: ['Russia', 'British seizure of Ottoman dreadnoughts'], speechStyle: `${edwardian}; fiery Young Turk nationalism` },
    },
    {
      id: 'ITA', name: 'Kingdom of Italy', shortName: 'Italy', color: '#3f9a8a', quality: 0.9, subjects: ['Italy'], capital: 'Rome', major: true, playable: true,
      military: 1.3, aggression: 0.3, naval: 0.4,
      leader: { name: 'Antonio Salandra', title: 'Prime Minister of Italy', traits: ['calculating', 'opportunistic'], goals: ['Trentino and Trieste', 'join the winning side at the right price'], grudges: ['Austria holds Italian lands'], speechStyle: `${edwardian}; speaks of "sacred egoism"` },
    },
    { id: 'SER', name: 'Kingdom of Serbia', shortName: 'Serbia', color: '#a36464', quality: 0.9, polities: ['Serbia'], capital: 'Belgrade', playable: true, military: 0.8, aggression: 0.2,
      leader: { name: 'Nikola Pašić', title: 'Prime Minister of Serbia', traits: ['stubborn', 'nationalist'], goals: ['survive', 'unite the South Slavs'], speechStyle: `${edwardian}; defiant small-nation patriotism` } },
    { id: 'BEL', name: 'Belgium', color: '#bfae3e', subjects: ['Belgium'], capital: 'Brussels', military: 0.9, aggression: 0.05,
      leader: { name: 'Albert I', title: 'King of the Belgians', traits: ['brave', 'principled'], goals: ['defend neutrality'], speechStyle: edwardian } },
    { id: 'USA', name: 'United States', shortName: 'USA', color: '#4c9ea0', polities: ['United States'], capital: 'Washington, D.C.', major: true, playable: true, military: 0.8, aggression: 0.1, naval: 0.8,
      leader: { name: 'Woodrow Wilson', title: 'President of the United States', traits: ['idealistic', 'neutral', 'moralistic'], goals: ['keep America out of the war', 'freedom of the seas'], speechStyle: `${edwardian}; high-minded American idealism` } },
    { id: 'JPN', name: 'Empire of Japan', shortName: 'Japan', color: '#d98a5a', polities: ['Empire of Japan'], capital: 'Tokyo', major: true, playable: true, military: 1.2, aggression: 0.4, naval: 0.7,
      leader: { name: 'Ōkuma Shigenobu', title: 'Prime Minister of Japan', traits: ['opportunistic', 'expansionist'], goals: ['seize German Pacific holdings', 'influence in China'], speechStyle: `${edwardian}; formal and opportunistic` } },
    { id: 'BUL', name: 'Kingdom of Bulgaria', shortName: 'Bulgaria', color: '#7e9a6a', polities: ['Bulgaria'], military: 0.9, aggression: 0.35 },
    { id: 'ROM', name: 'Kingdom of Romania', shortName: 'Romania', color: '#d1c46a', polities: ['Romania'], military: 0.9, aggression: 0.25 },
    { id: 'GRE', name: 'Kingdom of Greece', shortName: 'Greece', color: '#7fb6d9', polities: ['Greece'], military: 0.7, aggression: 0.15 },
  ],
  provinceNames: { Istanbul: 'Constantinople' },
  wars: [{ attackers: ['AUH'], defenders: ['SER'] }],
  scripted: [
    { date: '1914-08-01', actions: [war('GER', 'RUS')] },
    { date: '1914-08-03', actions: [war('GER', 'FRA')] },
    { date: '1914-08-04', text: 'German armies cross into neutral Belgium.', important: true, actions: [war('GER', 'BEL'), war('GBR', 'GER')] },
    { date: '1914-08-06', actions: [war('AUH', 'RUS')] },
    { date: '1914-08-12', actions: [war('GBR', 'AUH'), war('FRA', 'AUH')] },
    { date: '1914-08-23', actions: [war('JPN', 'GER')] },
    { date: '1914-11-02', text: 'The Ottoman Empire enters the war on the side of the Central Powers.', actions: [war('RUS', 'OTT')] },
    { date: '1914-11-05', actions: [war('GBR', 'OTT'), war('FRA', 'OTT')] },
    { date: '1915-05-23', text: 'Italy abandons the Triple Alliance.', important: true, actions: [war('ITA', 'AUH')] },
    { date: '1915-10-14', actions: [war('BUL', 'SER')] },
    { date: '1916-08-27', actions: [war('ROM', 'AUH')] },
    { date: '1917-04-06', text: 'The United States declares war on Germany.', important: true, actions: [war('USA', 'GER')] },
  ],
  treaties: [
    { type: 'alliance', parties: ['GER', 'AUH'] },
    // Italy's Triple Alliance membership was defensive and it stayed neutral in 1914
    { type: 'non-aggression', parties: ['ITA', 'GER'] },
    { type: 'non-aggression', parties: ['ITA', 'AUH'] },
    { type: 'alliance', parties: ['FRA', 'RUS'] },
    { type: 'alliance', parties: ['GBR', 'JPN'] },
    { type: 'non-aggression', parties: ['GBR', 'FRA'] },
  ],
  relations: [
    ['AUH', 'SER', -90], ['GER', 'FRA', -60], ['GER', 'RUS', -40], ['AUH', 'RUS', -60], ['GER', 'GBR', -30], ['GBR', 'FRA', 50], ['FRA', 'RUS', 60],
    ['RUS', 'SER', 60], ['GER', 'AUH', 70], ['GER', 'OTT', 30], ['RUS', 'OTT', -50], ['ITA', 'AUH', -20], ['GBR', 'BEL', 40],
  ],
  victory: { conquestPercent: 55 },
  combat: { homeDefense: 1.6, captureDays: 3 },
};
