import type { NationId } from '../../core/types';

/** A declaration of war, for scenario scripts. */
export const war = (attacker: NationId, defender: NationId) => ({ type: 'declareWar' as const, attacker, defender });

/** Week-based calendar used by the pre-modern eras. */
export const WEEKLY = { tickHours: 24, turnHours: 168, turnName: 'Week', secondsPerTurn: 13, skipMaxTurns: 8, showHours: false };
/** Day-based calendar used by the modern eras. */
export const DAILY = { tickHours: 6, turnHours: 24, turnName: 'Day', secondsPerTurn: 10, skipMaxTurns: 14, showHours: true };

/** Classical place names shared by the two Roman scenarios. */
export const CLASSICAL_NAMES: Record<string, string> = {
  Paris: 'Lutetia', London: 'Londinium', Madrid: 'Toletum', Seville: 'Hispalis', Barcelona: 'Barcino', Lisbon: 'Olisipo',
  Valencia: 'Valentia', Zaragoza: 'Caesaraugusta', 'A Coruña': 'Brigantium', Lyon: 'Lugdunum', Marseille: 'Massilia',
  Bordeaux: 'Burdigala', Toulouse: 'Tolosa', Nantes: 'Condevicnum', Lille: 'Belgica', Reims: 'Durocortorum', Rome: 'Roma',
  Milan: 'Mediolanum', Naples: 'Neapolis', Turin: 'Augusta Taurinorum', Bari: 'Barium', Palermo: 'Panormus', Venice: 'Aquileia',
  Athens: 'Athenae', Thessaloniki: 'Thessalonica', Ankara: 'Ancyra', İzmir: 'Smyrna', Bursa: 'Prusa', Antalya: 'Attalia',
  Adana: 'Tarsus', Konya: 'Iconium', Trabzon: 'Trapezus', Samsun: 'Amisus', Alexandria: 'Alexandria', Cairo: 'Memphis',
  Luxor: 'Thebae', Jerusalem: 'Hierosolyma', 'Tel Aviv': 'Caesarea', Damascus: 'Damascus', Aleppo: 'Beroea',
  Antakya: 'Antiochia', Beirut: 'Berytus', Amman: 'Philadelphia', Baghdad: 'Ctesiphon', Mosul: 'Nineveh', Basra: 'Charax',
  Tehran: 'Rhagae', Isfahan: 'Aspadana', Shiraz: 'Persepolis', Mashhad: 'Tus', Tabriz: 'Ganzak', Vienna: 'Vindobona',
  Budapest: 'Aquincum', Belgrade: 'Singidunum', Sofia: 'Serdica', Cologne: 'Colonia Agrippina', Trier: 'Augusta Treverorum',
  Mainz: 'Mogontiacum', Strasbourg: 'Argentoratum', Tunis: 'Carthago', Tripoli: 'Oea', Algiers: 'Icosium', Split: 'Salona',
  Zagreb: 'Siscia', 'Cluj-Napoca': 'Napoca', Yerevan: 'Artaxata', Tbilisi: 'Mtskheta', Xian: "Chang'an", Beijing: 'Ji',
  Nanjing: 'Jianye', Guangzhou: 'Panyu', Hanoi: 'Jiaozhi', 'New Delhi': 'Indraprastha', Patna: 'Pataliputra', Khartoum: 'Meroë',
  Kabul: 'Kapisa', York: 'Eboracum', Birmingham: 'Viroconium',
};
