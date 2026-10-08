import type { ScenarioDef } from '../../core/scenario';
import { CLASSICAL_NAMES, war, WEEKLY } from './common';

export const romeRise: ScenarioDef = {
  id: 'rome-rise',
  era: 'rome-rise',
  name: 'Rise of the Roman Empire',
  subtitle: '27 BC — Augustus becomes Princeps',
  startDate: '-26-01-16',
  theme: 'marble',
  map: '/maps/world_bc1.json',
  context:
    '27 BC. Octavian, now Augustus, rules the Roman world after the civil wars; the legions guard the Rhine, Danube and ' +
    'Euphrates. Parthia is Rome\'s great rival in the east; Germanic tribes beyond the Rhine resist conquest; Meroë\'s queen ' +
    'Amanirenas eyes Roman Egypt; Han China faces the Xiongnu on the steppe.',
  advisor: {
    title: 'Senator and Consul',
    style: 'a Roman senator of the Augustan age: formal, Latin-flavoured rhetoric (by Jupiter, the Senate and People of Rome, the legions), pragmatic about glory, grain and money; addresses the ruler as "Princeps"',
    reportName: 'Counsel of the Senate',
  },
  time: WEEKLY,
  unitTypes: [
    { id: 'legion', name: 'Legion', short: 'Legion', attack: 4, defense: 4.5, speed: 5 },
    { id: 'auxilia', name: 'Auxilia', short: 'Auxilia', attack: 3, defense: 3, speed: 5 },
    { id: 'cavalry', name: 'Cavalry', short: 'Ala', attack: 3.5, defense: 2, speed: 9 },
    { id: 'horse-archers', name: 'Horse Archers', short: 'Horde', attack: 4, defense: 2, speed: 10 },
    { id: 'spearmen', name: 'Warband', short: 'Warband', attack: 3, defense: 2.5, speed: 5 },
    { id: 'triremes', name: 'Trireme Squadron', short: 'Classis', attack: 3, defense: 3, speed: 14, domain: 'sea' },
  ],
  nations: [
    {
      id: 'ROM', name: 'Roman Empire', shortName: 'Rome', color: '#a8323e', quality: 1.25, subjects: ['Roman Empire'], capital: 'Roma', major: true, playable: true,
      military: 2.1, aggression: 0.55, naval: 0.8, units: ['legion', 'legion', 'auxilia', 'cavalry'],
      leader: { name: 'Augustus', title: 'Imperator Caesar Augustus, Princeps of Rome', traits: ['patient', 'calculating', 'image-conscious'], goals: ['secure the frontiers', 'avenge Crassus against Parthia', 'push to the Elbe'], grudges: ['Parthia holds the standards lost at Carrhae'], speechStyle: 'measured, dignified Latin statesmanship; speaks of peace through strength and the dignity of Rome' },
    },
    {
      id: 'PAR', name: 'Parthian Empire', shortName: 'Parthia', color: '#5b7f3a', quality: 1.05, polities: ['Parthian Empire', 'Suren Kingdom'], capital: 'Ctesiphon', major: true, playable: true,
      military: 1.6, aggression: 0.4, naval: 0.1, units: ['horse-archers', 'cavalry', 'spearmen'],
      leader: { name: 'Phraates IV', title: 'King of Kings of Parthia', traits: ['ruthless', 'suspicious', 'proud'], goals: ['keep Armenia as a buffer', 'hold Mesopotamia against Rome'], grudges: ['Roman invasions under Crassus and Antony'], speechStyle: 'haughty Persian court style, speaks of the King of Kings and the Arsacid line' },
    },
    {
      id: 'HAN', name: 'Han Dynasty', shortName: 'Han', color: '#c9a23a', quality: 1.1, polities: ['Han'], capital: "Chang'an", major: true, playable: true,
      military: 2.0, aggression: 0.3, naval: 0.3, units: ['spearmen', 'cavalry', 'auxilia'],
      leader: { name: 'Emperor Cheng of Han', title: 'Son of Heaven, Emperor of the Han', traits: ['indulgent', 'court-dominated'], goals: ['keep the Xiongnu divided', 'preserve the Mandate of Heaven'], speechStyle: 'Confucian court language, speaks of Heaven, harmony and tribute' },
    },
    {
      id: 'XIO', name: 'Xiongnu', color: '#7a6a4f', polities: ['Xiongnu'], major: true, playable: true, military: 1.3, aggression: 0.6, units: ['horse-archers', 'cavalry'],
      leader: { name: 'Fuzhulei Ruodi', title: 'Chanyu of the Xiongnu', traits: ['restless', 'pragmatic'], goals: ['extract tribute from Han', 'rule the steppe'], speechStyle: 'blunt steppe warlord, speaks of horses, grass and tribute' },
    },
    {
      id: 'ARM', name: 'Kingdom of Armenia', shortName: 'Armenia', color: '#b0703a', polities: ['Armenia'], capital: 'Artaxata', playable: true, military: 0.8, aggression: 0.2,
      leader: { name: 'Artaxias II', title: 'King of Armenia', traits: ['wary', 'caught between empires'], goals: ['stay free of both Rome and Parthia'], speechStyle: 'careful, balancing Greek courtesy with Persian titles' },
    },
    {
      id: 'DAC', name: 'Dacia', color: '#5f7fa0', polities: ['Dacia'], playable: true, military: 0.9, aggression: 0.4, units: ['spearmen'],
      leader: { name: 'Cotiso', title: 'King of the Dacians', traits: ['bold', 'raider'], goals: ['raid across the Danube', 'keep Rome at bay'], speechStyle: 'proud mountain king, speaks of Zalmoxis and the Carpathians' },
    },
    {
      id: 'MER', name: 'Kingdom of Meroë', shortName: 'Meroë', color: '#8a5aa0', polities: ['Meroe'], capital: 'Meroë', playable: true, military: 1.0, aggression: 0.5, units: ['spearmen', 'auxilia'],
      leader: { name: 'Amanirenas', title: 'Kandake of Kush', traits: ['fearless', 'defiant', 'shrewd'], goals: ['drive Rome out of Lower Nubia', 'protect Kush'], grudges: ['Roman tribute demands'], speechStyle: 'commanding and defiant warrior queen' },
    },
    { id: 'SAK', name: 'Indo-Scythian Kingdom', shortName: 'Saka', color: '#a07a50', polities: ['Saka Kingdom'], military: 1.0, aggression: 0.4, units: ['horse-archers'] },
    { id: 'NAB', name: 'Nabataean Kingdom', shortName: 'Nabataea', color: '#c08f6a', polities: ['Nabatean Kingdom'], military: 0.6, aggression: 0.1 },
  ],
  tribeNames: { germania: 'Germanic tribes', britain: 'Britons', scandinavia: 'Norse tribes', sarmatia: 'Sarmatians', baltic: 'Balts', 'north-africa': 'Garamantes', 'central-asia': 'Saka nomads', arabia: 'Arab tribes', iberia: 'Cantabri', japan: 'Yayoi chiefdoms' },
  provinceNames: CLASSICAL_NAMES,
  scripted: [
    { date: '-24-01-01', text: 'Queen Amanirenas leads the armies of Meroë against Roman Egypt.', important: true, actions: [war('MER', 'ROM')] },
  ],
  treaties: [],
  relations: [['ROM', 'PAR', -40], ['HAN', 'XIO', -50], ['ROM', 'ARM', 10], ['PAR', 'ARM', -5], ['ROM', 'DAC', -30], ['ROM', 'MER', -25], ['ROM', 't_germania', -40]],
  victory: { conquestPercent: 50 },
};
