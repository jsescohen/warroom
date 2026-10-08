import type { ScenarioDef } from '../../core/scenario';
import { WEEKLY } from './common';

const style = (s: string) => `${s}; speaks as a Bronze Age monarch, invoking the gods, omens, tribute and the honour of the royal house`;

export const bronze: ScenarioDef = {
  id: 'bronze',
  era: 'bronze',
  name: 'The Bronze Age',
  subtitle: 'c. 1500 BC — Empires of chariot and bronze',
  startDate: '-1499-03-01',
  theme: 'parchment',
  map: '/maps/world_bc1500.json',
  context:
    'Around 1500 BC. Egypt\'s New Kingdom under Thutmose I pushes south into Nubia and north into the Levant. The Hittites rule ' +
    'Anatolia; Kassite kings hold Babylon; Assyria is a rising city-state; Elam guards the Iranian plateau; Mycenaean Greeks raid ' +
    'and trade across the Aegean; the Shang rule the Yellow River. War is fought with chariots, spears and bows.',
  advisor: {
    title: 'Royal Vizier',
    style: 'a Bronze Age court vizier: reverent, invokes the gods and omens, speaks of tribute, chariots, granaries and city walls; addresses the ruler as "Great King"',
    reportName: 'Counsel of the Vizier',
  },
  time: WEEKLY,
  unitTypes: [
    { id: 'spearmen', name: 'Spearmen', short: 'Host', attack: 2.5, defense: 3.5, speed: 4 },
    { id: 'chariots', name: 'Chariotry', short: 'Chariot Host', attack: 4.5, defense: 2, speed: 7 },
    { id: 'archers', name: 'Archers', short: 'Bowmen', attack: 3.5, defense: 2.5, speed: 4 },
    { id: 'galleys', name: 'War Galleys', short: 'Galley Squadron', attack: 2, defense: 2, speed: 12, domain: 'sea' },
  ],
  nations: [
    {
      id: 'EGY', name: 'Kingdom of Egypt', shortName: 'Egypt', color: '#d6b35a', polities: ['Egypt'], capital: 'Thebes', major: true, playable: true,
      military: 1.5, aggression: 0.6, naval: 0.4, units: ['spearmen', 'archers', 'chariots'],
      leader: { name: 'Thutmose I', title: 'Pharaoh of Upper and Lower Egypt', traits: ['ambitious', 'pious', 'martial'], goals: ['subdue Kush', 'push the frontier to the Euphrates', 'glorify Amun'], grudges: ['the Hyksos invaders of old'], speechStyle: style('regal and divine, speaks of Ma\'at and Amun-Ra') },
    },
    {
      id: 'HAT', name: 'Hittite Kingdom', shortName: 'Hatti', color: '#9a5b3c', polities: ['Hittites'], capital: 'Hattusa', major: true, playable: true,
      military: 1.4, aggression: 0.55, naval: 0.1, units: ['chariots', 'spearmen', 'spearmen'],
      leader: { name: 'Telipinu', title: 'Great King of Hatti', traits: ['lawgiver', 'stern', 'cautious'], goals: ['end royal feuds', 'hold the Anatolian heartland', 'reclaim Syria'], grudges: ['Mitanni and the Hurrians'], speechStyle: style('formal and legalistic, cites oaths sworn before the thousand gods') },
    },
    {
      id: 'BAB', name: 'Kassite Babylonia', shortName: 'Babylon', color: '#4f7fb0', polities: ['Babylonia'], capital: 'Babylon', major: true, playable: true,
      military: 1.0, aggression: 0.3, naval: 0.1,
      leader: { name: 'Burna-Buriash I', title: 'King of Karduniash', traits: ['diplomatic', 'wealthy', 'wary'], goals: ['secure the river trade', 'contain Assyria'], grudges: ['the Hittite sack of Babylon'], speechStyle: style('courtly Akkadian diplomacy, calls fellow kings "my brother"') },
    },
    {
      id: 'ASY', name: 'Assyria', color: '#8a3b3b', polities: ['Assyria'], capital: 'Assur', major: true, playable: true,
      military: 1.0, aggression: 0.55, units: ['spearmen', 'chariots'],
      leader: { name: 'Puzur-Ashur III', title: 'Ishshiak of Ashur', traits: ['proud', 'hungry for land', 'tough'], goals: ['throw off foreign overlords', 'expand along the Tigris'], grudges: ['Babylonian arrogance'], speechStyle: style('blunt and martial, speaks for the god Ashur') },
    },
    {
      id: 'ELA', name: 'Elam', color: '#6f8f4f', polities: ['Elam'], major: true, playable: true, military: 0.9, aggression: 0.3,
      leader: { name: 'Kidinu', title: 'King of Anshan and Susa', traits: ['guarded', 'traditional'], goals: ['hold the highlands', 'profit from Mesopotamian quarrels'], speechStyle: style('terse and suspicious of lowlanders') },
    },
    {
      id: 'KUS', name: 'Kingdom of Kerma', shortName: 'Kush', color: '#7a5a8c', polities: ['Kush'], major: true, playable: true, military: 1.0, aggression: 0.3,
      units: ['archers', 'spearmen'],
      leader: { name: 'the Ruler of Kerma', title: 'King of Kush', traits: ['defiant', 'proud of its archers'], goals: ['keep Egypt north of the cataracts', 'control the gold routes'], grudges: ['Egyptian raids on Nubia'], speechStyle: style('defiant, speaks of the Bow-land and its gold') },
    },
    {
      id: 'MYC', name: 'Mycenaean Greeks', shortName: 'Achaeans', color: '#3f8fb0', polities: ['Greek city-states'], capital: 'Mycenae', major: true, playable: true,
      military: 0.9, aggression: 0.45, naval: 0.6,
      leader: { name: 'the Wanax of Mycenae', title: 'High King of the Achaeans', traits: ['bold', 'seafaring', 'boastful'], goals: ['seize Cretan trade', 'win plunder and glory'], speechStyle: style('heroic and boastful, speaks of ships, bronze and glory') },
    },
    {
      id: 'SHA', name: 'Shang Kingdom', shortName: 'Shang', color: '#c8553d', polities: ['Zhoa'], major: true, playable: true, military: 1.4, aggression: 0.5,
      units: ['spearmen', 'chariots', 'archers'],
      leader: { name: 'the King of Shang', title: 'Son of Di, King of Shang', traits: ['ritualistic', 'warlike'], goals: ['subdue the Fang peoples', 'please the ancestors'], speechStyle: style('speaks through oracle-bone omens and ancestral spirits') },
    },
    {
      id: 'VED', name: 'Vedic Tribes', shortName: 'Bharatas', color: '#e08a3c', polities: ['Vedic Aryans'], major: true, playable: true, military: 1.0, aggression: 0.45,
      units: ['chariots', 'archers'],
      leader: { name: 'Raja Sudas', title: 'Raja of the Bharatas', traits: ['proud', 'warlike'], goals: ['win the lands of the rivers', 'defeat rival tribes'], speechStyle: style('speaks in the manner of the Rigveda, invoking Indra') },
    },
  ],
  minorNames: { 'Kingdom of David and Solomon': 'Canaanite city-states', 'state societies and Aramaean kingdoms': 'Aramaean kingdoms', Sinic: 'Yangtze cultures' },
  tribeNames: { germania: 'Unetice cultures', britain: 'Wessex culture', scandinavia: 'Nordic Bronze Age', sarmatia: 'Srubna herders', 'central-asia': 'Andronovo herders' },
  provinceNames: {
    Luxor: 'Thebes', Cairo: 'Memphis', Aswan: 'Elephantine', Alexandria: 'Rhakotis', Ankara: 'Hattusa', Baghdad: 'Babylon',
    Mosul: 'Assur', Aleppo: 'Halab', Damascus: 'Dimashq', Beirut: 'Byblos', 'Tel Aviv': 'Jaffa', Jerusalem: 'Urusalim',
    Shiraz: 'Anshan', Ahvaz: 'Susa', Athens: 'Mycenae', Iraklio: 'Knossos', Zhengzhou: 'Ao', 'New Delhi': 'Hastinapura', Tehran: 'Rhagae',
  },
  wars: [{ attackers: ['EGY'], defenders: ['KUS'] }],
  relations: [['EGY', 'HAT', -30], ['HAT', 'BAB', -25], ['ASY', 'BAB', -30], ['EGY', 'KUS', -70], ['ELA', 'BAB', -20], ['MYC', 'HAT', -10]],
  victory: { conquestPercent: 50 },
};
