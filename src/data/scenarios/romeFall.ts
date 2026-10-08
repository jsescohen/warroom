import type { ScenarioDef } from '../../core/scenario';
import { CLASSICAL_NAMES, war, WEEKLY } from './common';

export const romeFall: ScenarioDef = {
  id: 'rome-fall',
  era: 'rome-fall',
  name: 'Fall of the Roman Empire',
  subtitle: '400 AD — The barbarians at the gates',
  startDate: '400-01-01',
  theme: 'marble',
  map: '/maps/world_400.json',
  context:
    '400 AD. The Roman Empire is split between the boy-emperors Honorius in the West and Arcadius in the East; the general ' +
    'Stilicho holds the West together with barbarian federates. Alaric\'s Visigoths are restless in the Balkans, the Huns ' +
    'dominate the steppe and push the Germanic peoples west, and Sasanian Persia faces Rome in the east.',
  advisor: {
    title: 'Magister Militum',
    style: 'a late-Roman general: weary and pragmatic, speaks of barbarian federates, taxes, the limes, court intrigue and plague; addresses the ruler as "Augustus"',
    reportName: 'Report of the Magister Militum',
  },
  time: WEEKLY,
  unitTypes: [
    { id: 'comitatenses', name: 'Field Army', short: 'Legion', attack: 3.5, defense: 4, speed: 5 },
    { id: 'foederati', name: 'Federate Warriors', short: 'Warband', attack: 3.5, defense: 2.5, speed: 5 },
    { id: 'cavalry', name: 'Heavy Cavalry', short: 'Cataphracts', attack: 4.5, defense: 2.5, speed: 9 },
    { id: 'horse-archers', name: 'Horse Archers', short: 'Horde', attack: 4.5, defense: 2, speed: 11 },
    { id: 'dromons', name: 'Dromon Squadron', short: 'Fleet', attack: 3, defense: 3, speed: 14, domain: 'sea' },
  ],
  nations: [
    {
      id: 'WRE', name: 'Western Roman Empire', shortName: 'West Rome', color: '#a8323e', quality: 0.95, polities: ['Western Roman Empire'], capital: 'Roma', major: true, playable: true,
      military: 1.4, aggression: 0.2, naval: 0.5, units: ['comitatenses', 'foederati', 'cavalry'],
      leader: { name: 'Honorius', title: 'Augustus of the West (with Stilicho, Magister Militum)', traits: ['weak', 'suspicious', 'court-bound'], goals: ['hold Italy', 'keep the Rhine', 'survive court plots'], grudges: ['Alaric', 'the Eastern court'], speechStyle: 'imperial Latin formality, anxious beneath the grandeur' },
    },
    {
      id: 'ERE', name: 'Eastern Roman Empire', shortName: 'East Rome', color: '#7a3fa0', quality: 1.05, polities: ['Eastern Roman Empire'], capital: 'Constantinopolis', major: true, playable: true,
      military: 1.6, aggression: 0.25, naval: 0.6, units: ['comitatenses', 'cavalry', 'foederati'],
      leader: { name: 'Arcadius', title: 'Augustus of the East', traits: ['pious', 'cautious', 'wealthy'], goals: ['buy peace with gold', 'push the Goths westward', 'keep Persia quiet'], speechStyle: 'Greek court ceremony, pious and evasive' },
    },
    {
      id: 'PER', name: 'Sasanian Persia', shortName: 'Persia', color: '#5b7f3a', quality: 1.05, polities: ['Persia'], subjects: ['Persi'], capital: 'Ctesiphon', major: true, playable: true,
      military: 1.6, aggression: 0.35, units: ['cavalry', 'horse-archers', 'foederati'],
      leader: { name: 'Yazdegerd I', title: 'King of Kings of Iran and Aniran', traits: ['tolerant', 'shrewd', 'peace-minded'], goals: ['keep peace with Rome', 'tame the nobles and the Huns'], speechStyle: 'magnificent Persian court style, speaks of Ahura Mazda and the King of Kings' },
    },
    {
      id: 'HUN', name: 'Hunnic Empire', shortName: 'Huns', color: '#6f5f45', quality: 1.15, subjects: ['Hunnic Empire'], major: true, playable: true,
      military: 1.7, aggression: 0.85, units: ['horse-archers', 'horse-archers', 'foederati'],
      leader: { name: 'Uldin', title: 'King of the Huns', traits: ['ruthless', 'boastful', 'opportunistic'], goals: ['plunder Rome', 'subjugate the Goths'], speechStyle: 'boastful steppe conqueror, threatens and bargains for gold' },
    },
    {
      id: 'VIS', name: 'Visigoths', color: '#c08a3a', polities: ['Visigoths'], major: true, playable: true,
      military: 1.9, aggression: 0.85, units: ['foederati', 'foederati', 'cavalry'],
      leader: { name: 'Alaric I', title: 'King of the Visigoths', traits: ['ambitious', 'proud', 'disciplined'], goals: ['win land and Roman titles for his people', 'take Italy if refused'], grudges: ['Roman broken promises', 'Stilicho'], speechStyle: 'proud Gothic king, Arian Christian, demands land and gold' },
    },
    { id: 'FRK', name: 'Franks', color: '#3f6fb0', polities: ['Franks'], playable: true, military: 1.0, aggression: 0.5, units: ['foederati'] },
    { id: 'BRG', name: 'Burgundians', color: '#8fae5a', polities: ['Burgundians'], military: 0.8, aggression: 0.4, units: ['foederati'] },
    {
      id: 'JIN', name: 'Eastern Jin', shortName: 'Jin', color: '#c9a23a', polities: ['Jin'], major: true, playable: true, military: 1.4, aggression: 0.3,
      leader: { name: 'Emperor An of Jin', title: 'Emperor of Jin', traits: ['powerless', 'dominated by generals'], goals: ['survive', 'reclaim the north'], speechStyle: 'courtly Chinese formality' },
    },
    {
      id: 'GUP', name: 'Gupta Empire', shortName: 'Gupta', color: '#e08a3c', polities: ['Gupta Empire'], major: true, playable: true, military: 1.5, aggression: 0.4,
      leader: { name: 'Chandragupta II', title: 'Maharajadhiraja of the Guptas', traits: ['cultured', 'confident'], goals: ['dominate northern India', 'patronise the arts'], speechStyle: 'lofty Sanskrit court style' },
    },
  ],
  minorNames: { Ruanruan: 'Rouran Khaganate' },
  tribeNames: { germania: 'Germanic tribes', britain: 'Picts and Scots', scandinavia: 'Norse tribes', sarmatia: 'Slavic tribes', baltic: 'Balts', 'north-africa': 'Moorish tribes', 'central-asia': 'Hephthalites', arabia: 'Arab tribes', japan: 'Yamato' },
  provinceNames: { ...CLASSICAL_NAMES, Istanbul: 'Constantinopolis' },
  scripted: [
    { date: '401-11-18', text: 'Alaric leads the Visigoths over the Julian Alps into Italy.', important: true, actions: [war('VIS', 'WRE')] },
  ],
  treaties: [{ type: 'alliance', parties: ['WRE', 'ERE'] }],
  relations: [['WRE', 'VIS', -45], ['ERE', 'VIS', -20], ['ERE', 'PER', 5], ['HUN', 'ERE', -25], ['HUN', 'WRE', -10], ['WRE', 'FRK', 10], ['WRE', 'ERE', 30]],
  victory: { conquestPercent: 50 },
};
