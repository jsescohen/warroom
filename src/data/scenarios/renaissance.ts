import type { ScenarioDef } from '../../core/scenario';
import { war, WEEKLY } from './common';

const courtly = 'Renaissance court diplomacy: florid, formal, invokes God, honour, dynasty and fortune';

export const renaissance: ScenarioDef = {
  id: 'renaissance',
  era: 'renaissance',
  name: 'The Renaissance',
  subtitle: '1500 — Princes, popes and the new world',
  startDate: '1500-01-01',
  theme: 'ornate',
  map: '/maps/world_1500.json',
  context:
    '1500. France and Spain fight over Italy, where Venice, the Pope and the city-states play every side. The Ottoman Empire ' +
    'is at war with Venice; Muscovy under Ivan III presses Lithuania; Portugal has just reached India by sea and Castile the ' +
    'Americas. Ming China and the Aztec and Inca empires stand at their height. Armies of pikes, knights, arquebuses and cannon.',
  advisor: {
    title: 'Chancellor',
    style: 'a shrewd Renaissance chancellor in the manner of Machiavelli: elegant, cynical, cites fortune and virtù, alliances of convenience and the cost of mercenaries; addresses the ruler as "Your Majesty"',
    reportName: 'Memorandum of the Chancellor',
  },
  time: WEEKLY,
  unitTypes: [
    { id: 'pikemen', name: 'Pike Square', short: 'Tercio', attack: 3, defense: 4.5, speed: 5 },
    { id: 'arquebusiers', name: 'Arquebusiers', short: 'Company', attack: 4, defense: 3, speed: 5 },
    { id: 'knights', name: 'Gendarmes', short: 'Lances', attack: 5, defense: 2.5, speed: 8 },
    { id: 'cannon', name: 'Artillery Train', short: 'Battery', attack: 6, defense: 1.5, speed: 3 },
    // broadside cannon: the first ships that can shell a coast
    { id: 'carracks', name: 'Carrack Squadron', short: 'Squadron', attack: 4, defense: 4, speed: 20, domain: 'sea', bombard: 1 },
  ],
  nations: [
    {
      id: 'FRA', name: 'Kingdom of France', shortName: 'France', color: '#3f6fb0', quality: 1.05, polities: ['France'], capital: 'Paris', major: true, playable: true,
      military: 1.6, aggression: 0.6, naval: 0.4, units: ['pikemen', 'knights', 'cannon', 'arquebusiers'],
      leader: { name: 'Louis XII', title: 'King of France', traits: ['ambitious', 'chivalrous', 'popular'], goals: ['hold Milan', 'claim Naples', 'humble Spain in Italy'], grudges: ['Ferdinand of Aragon'], speechStyle: courtly },
    },
    {
      id: 'ENG', name: 'Kingdom of England', shortName: 'England', color: '#c2475b', polities: ['England'], capital: 'London', major: true, playable: true,
      military: 1.0, aggression: 0.3, naval: 0.7, units: ['pikemen', 'arquebusiers', 'knights'],
      leader: { name: 'Henry VII', title: 'King of England', traits: ['frugal', 'cautious', 'dynastic'], goals: ['secure the Tudor throne', 'fill the treasury', 'marry well'], grudges: ['Scottish raids'], speechStyle: `${courtly}; dry, careful and money-minded` },
    },
    {
      id: 'SPA', name: 'Crowns of Castile and Aragon', shortName: 'Spain', color: '#d8b45a', quality: 1.1, polities: ['Castille', 'Aragón'], capital: 'Madrid', major: true, playable: true,
      military: 1.5, aggression: 0.5, naval: 0.7, units: ['pikemen', 'arquebusiers', 'knights'],
      leader: { name: 'Isabella I and Ferdinand II', title: 'The Catholic Monarchs', traits: ['devout', 'shrewd', 'expansionist'], goals: ['Naples', 'the Indies', 'contain France'], grudges: ['France in Italy'], speechStyle: `${courtly}; devout and calculating` },
    },
    { id: 'POR', name: 'Kingdom of Portugal', shortName: 'Portugal', color: '#6e9e7e', polities: ['Portugal'], playable: true, military: 0.8, aggression: 0.3, naval: 0.9,
      leader: { name: 'Manuel I', title: 'King of Portugal', traits: ['fortunate', 'seafaring'], goals: ['the spice trade', 'forts in Africa and India'], speechStyle: courtly } },
    {
      id: 'HRE', name: 'Holy Roman Empire', shortName: 'Empire', color: '#5d6a74', polities: ['Holy Roman Empire'], capital: 'Vienna', major: true, playable: true,
      military: 1.6, aggression: 0.4, units: ['pikemen', 'knights', 'cannon'],
      leader: { name: 'Maximilian I', title: 'King of the Romans, Archduke of Austria', traits: ['grand', 'chronically short of money', 'dynastic'], goals: ['Habsburg marriages', 'Burgundy', 'keep the French out of Italy'], speechStyle: `${courtly}; grandiloquent, the "last knight"` },
    },
    { id: 'VEN', name: 'Republic of Venice', shortName: 'Venice', color: '#8f3f6a', polities: ['Venice'], capital: 'Venice', major: true, playable: true, military: 1.0, aggression: 0.35, naval: 0.9,
      leader: { name: 'Agostino Barbarigo', title: 'Doge of Venice', traits: ['mercantile', 'devious', 'proud'], goals: ['protect the trade empire', 'hold the Stato da Mar'], grudges: ['the Turk'], speechStyle: `${courtly}; mercantile and devious` } },
    { id: 'PAP', name: 'Papal States', color: '#d9c98f', polities: ['Papal States'], capital: 'Rome', playable: true, military: 0.8, aggression: 0.4,
      leader: { name: 'Alexander VI', title: 'Pope, Bishop of Rome', traits: ['worldly', 'nepotistic', 'ruthless'], goals: ['a state for Cesare Borgia', 'play France against Spain'], speechStyle: `${courtly}; pious language over ruthless ambition` } },
    {
      id: 'OTT', name: 'Ottoman Empire', shortName: 'Ottomans', color: '#5e9a5a', quality: 1.15, subjects: ['Ottoman Empire'], capital: 'Constantinople', major: true, playable: true,
      military: 1.9, aggression: 0.7, naval: 0.6, units: ['arquebusiers', 'knights', 'cannon'],
      leader: { name: 'Bayezid II', title: 'Sultan of the Ottomans', traits: ['pious', 'deliberate', 'builder'], goals: ['take Venetian ports', 'secure the Danube', 'watch the Safavids'], grudges: ['Venice', 'the Mamluks'], speechStyle: 'Ottoman imperial style, invokes God, the House of Osman and the gazis' },
    },
    { id: 'MOS', name: 'Grand Duchy of Moscow', shortName: 'Muscovy', color: '#8e2f2f', polities: ['Grand Duchy of Moscow'], capital: 'Moscow', major: true, playable: true,
      military: 1.4, aggression: 0.6, units: ['pikemen', 'knights'],
      leader: { name: 'Ivan III', title: 'Grand Prince of all Rus', traits: ['patient', 'ruthless', 'gatherer of lands'], goals: ['gather the Russian lands', 'take Lithuanian territory'], grudges: ['Lithuania', 'the Tatars'], speechStyle: 'Muscovite majesty, speaks of the Third Rome and the Orthodox faith' } },
    { id: 'PLL', name: 'Poland-Lithuania', color: '#b48fcf', polities: ['Poland-Lithuania'], major: true, playable: true, military: 1.3, aggression: 0.3,
      leader: { name: 'John I Albert', title: 'King of Poland', traits: ['restless', 'unlucky'], goals: ['hold Lithuania against Moscow', 'check the Turks'], speechStyle: courtly } },
    { id: 'HUN', name: 'Kingdom of Hungary', shortName: 'Hungary', color: '#8aa65e', polities: ['Imperial Hungary'], military: 1.0, aggression: 0.25 },
    { id: 'MAM', name: 'Mamluk Sultanate', shortName: 'Mamluks', color: '#c9b27a', polities: ['Mamluke Sultanate'], capital: 'Cairo', major: true, playable: true, military: 1.3, aggression: 0.3, units: ['knights', 'arquebusiers'],
      leader: { name: 'al-Ashraf Janbalat', title: 'Sultan of Egypt and Syria', traits: ['insecure', 'proud'], goals: ['survive the emirs', 'hold Syria against the Ottomans'], speechStyle: 'Mamluk court style, proud and wary' } },
    { id: 'KAL', name: 'Kalmar Union', color: '#7fa6c9', polities: ['Kalmar Union', 'Denmark-Norway'], military: 0.9, aggression: 0.2, naval: 0.5 },
    { id: 'SCO', name: 'Kingdom of Scotland', shortName: 'Scotland', color: '#5f8fd6', polities: ['Scotland'], military: 0.7, aggression: 0.35,
      leader: { name: 'James IV', title: 'King of Scots', traits: ['energetic', 'chivalrous'], goals: ['an independent Scotland', 'the Auld Alliance with France'], speechStyle: courtly } },
    { id: 'MIN', name: 'Ming Empire', shortName: 'Ming', color: '#c9a23a', polities: ['Ming Chinese Empire'], capital: 'Beijing', major: true, playable: true, military: 2.0, aggression: 0.2, naval: 0.4,
      leader: { name: 'Hongzhi Emperor', title: 'Son of Heaven, Emperor of the Great Ming', traits: ['frugal', 'benevolent', 'conservative'], goals: ['order within the realm', 'keep the Mongols beyond the wall'], speechStyle: 'Confucian imperial edict style' } },
    { id: 'INC', name: 'Inca Empire', shortName: 'Inca', color: '#d08a4e', quality: 0.75, polities: ['Inca Empire'], major: true, playable: true, military: 1.4, aggression: 0.5,
      leader: { name: 'Huayna Capac', title: 'Sapa Inca', traits: ['conqueror', 'proud'], goals: ['extend Tawantinsuyu north', 'honour Inti'], speechStyle: 'solemn, speaks as son of the Sun' } },
    { id: 'AZT', name: 'Aztec Empire', shortName: 'Mexica', color: '#4f8a5c', quality: 0.75, polities: ['Aztec Empire'], major: true, playable: true, military: 1.3, aggression: 0.6,
      leader: { name: 'Ahuitzotl', title: 'Huey Tlatoani of Tenochtitlan', traits: ['warlike', 'ruthless'], goals: ['captives and tribute', 'conquest to the south'], speechStyle: 'fierce and ceremonious, speaks of Huitzilopochtli' } },
  ],
  minorNames: { 'Emirate of the White Sheep Turks': 'Aq Qoyunlu', 'Wattasid Caliphate': 'Wattasid Morocco' },
  tribeNames: { 'north-america-east': 'Eastern Woodlands nations', 'north-america-west': 'Western nations', siberia: 'Siberian peoples', 'central-africa': 'Kongo and neighbours' },
  provinceNames: { Istanbul: 'Constantinople', İzmir: 'Smyrna', Mumbai: 'Bombay', 'Mexico City': 'Tenochtitlan', Cusco: 'Cuzco' },
  wars: [{ attackers: ['OTT'], defenders: ['VEN'] }],
  scripted: [{ date: '1500-05-01', text: 'Muscovy invades the Grand Duchy of Lithuania.', important: true, actions: [war('MOS', 'PLL')] }],
  treaties: [
    { type: 'alliance', parties: ['FRA', 'VEN'] },
    { type: 'alliance', parties: ['SPA', 'HRE'] },
    { type: 'alliance', parties: ['SPA', 'ENG'] },
    { type: 'alliance', parties: ['FRA', 'SCO'] },
  ],
  relations: [['FRA', 'SPA', -40], ['FRA', 'HRE', -30], ['OTT', 'VEN', -70], ['OTT', 'MAM', -30], ['MOS', 'PLL', -50], ['ENG', 'SCO', -30], ['FRA', 'PAP', 10], ['VEN', 'PAP', -10], ['OTT', 'HUN', -40]],
  victory: { conquestPercent: 50 },
};
