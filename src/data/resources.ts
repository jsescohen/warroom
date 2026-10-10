import type { ResourceDef } from '../core/scenario';
import type { EraId } from '../core/types';

/**
 * Natural resources per era, at their historical deposits: oil at Baku, Ploiești and Maracaibo,
 * steel in the Ruhr and the Donbas, silver at Potosí… Each deposit is [lon, lat, radius in
 * degrees]: the provinces whose centre lies within the radius hold it (the nearest province does
 * when none does). Provinces produce a little of their resource by themselves and four times as
 * much with the matching building (mine, farm or factory, see `extract`).
 *
 * `units` lists the unit types that use the resource up every month in the detailed economy; what
 * units cost to raise is in ERA_UNIT_COSTS below. `price` is the base price on the world market.
 */

type D = [number, number, number];

// ---- the ancient world -------------------------------------------------------------------------
const HORSES_OLD: D[] = [
  [40, 48, 6], [33, 47, 4], // Pontic and Caspian steppe
  [22, 40.5, 2], // Thessaly and Thrace
  [36, 39, 2.5], // Cappadocia
  [49, 35, 3], // Media (Iranian plateau)
  [44, 25, 3], // Najd
  [-4, 40, 2.5], // Iberian meseta
  [8, 35.5, 2], // Numidia
  [72, 41, 2], // Ferghana, the "heavenly horses"
  [108, 46, 5], // Mongolian steppe
  [0, 46.5, 2], // Gaul
];
const IRON_OLD: D[] = [
  [14, 47, 1.5], // Noricum
  [10.7, 43, 1.2], // Elba and Etruria
  [-6.5, 37.7, 1.5], // Rio Tinto
  [35, 37.8, 2], // Taurus mountains
  [48.5, 32.5, 2], // Zagros
  [116, 37, 3], // Hebei and Shandong
  [86, 23, 2.5], // Bihar
  [7, 50.5, 1.5], // the Siegerland and Ardennes
  [-4, 48.2, 1.5], // Armorica
];
const COPPER_OLD: D[] = [
  [33.5, 35.1, 1.2], // Cyprus
  [35, 29.8, 1.2], // Timna and Sinai
  [-6.5, 37.7, 1.5], // Rio Tinto
  [-5, 50.3, 1.2], // Cornish tin
  [36, 38, 2], // Anatolia
  [56, 24, 2], // Magan (Oman)
  [75.8, 28, 1.5], // Khetri
];
const GRAIN_OLD: D[] = [
  [31.2, 29.5, 2.5], [32.6, 25.5, 1.5], // Nile valley and delta
  [45, 32.5, 2.5], // Mesopotamia
  [14, 37.5, 1.3], // Sicily
  [10, 36.5, 1.5], // Africa (Carthage)
  [34, 45, 1.5], // Crimea and the Bosporan kingdom
  [14.5, 41, 1], // Campania
  [114, 35, 3], // Yellow River plain
  [83, 26, 3], // Ganges plain
  [22.3, 39.5, 1], // Thessaly
];

// ---- 1500 ---------------------------------------------------------------------------------------
const HORSES_1500: D[] = [[20, 47, 2.5], [40, 48, 6], [33, 39, 3], [-4, 40, 2.5], [24, 52, 3], [49, 35, 3], [108, 46, 5], [44, 25, 3]];
const IRON_1500: D[] = [[14, 47, 1.5], [7.5, 51, 1.5], [15, 59.8, 1.5], [-2.8, 43.2, 1], [116, 37, 3], [86, 23, 2.5], [59, 57, 2.5], [-2, 52.5, 1.5]];
const SALTPETRE: D[] = [[85.5, 25.5, 2.5], [51, 34, 2], [113, 35, 3], [20, 50, 2]];
const SPICES: D[] = [[127.5, -1, 3], [129.9, -4.5, 1], [76, 10.5, 2], [80.7, 7.5, 1.2], [39.2, -6.2, 1], [102, 1, 2]];
const SUGAR: D[] = [[-16.5, 28.5, 1.5], [-17, 32.7, 0.6], [6.6, 0.3, 0.6], [-71, 19, 2], [-35.8, -8, 2], [-77.5, 18.2, 1], [-79.5, 21.8, 2]];
const SILVER: D[] = [[-65.7, -19.6, 1.5], [-102.6, 22.8, 1.5], [-101.3, 21, 1], [14, 50, 1.2], [13, 50.6, 1], [11.7, 47.3, 0.7], [-7, 38.6, 1]];

// ---- the industrial age -------------------------------------------------------------------------
const STEEL: D[] = [
  [7.2, 51.5, 1], // Ruhr
  [6.3, 49.2, 1], // Saar and Lorraine
  [18.8, 50.2, 1], // Upper Silesia
  [18.3, 49.8, 0.7], // Ostrava
  [5.6, 50.6, 0.7], // Liège
  [-2, 52.5, 1.5], [-3.5, 51.6, 1], [-4.2, 55.9, 1], // Midlands, South Wales, Clydeside
  [38.5, 48.2, 1.5], // Donbas
  [33.4, 47.9, 1], // Krivoy Rog
  [59, 53.4, 1.2], [60.6, 56.8, 1.2], // Magnitogorsk, Sverdlovsk
  [87, 54.5, 1.5], // Kuzbass
  [20.2, 67.9, 1.5], // Kiruna
  [-80, 40.4, 1.2], [-87.5, 41.6, 1.2], [-92.5, 47.5, 1.5], // Pittsburgh, Chicago-Gary, Mesabi
  [130.8, 33.9, 1], // Yawata
  [123, 41.1, 1.2], // Anshan
  [-2.9, 43.2, 0.8], // Bilbao
  [86.2, 22.8, 1.2], // Jamshedpur
  [-43.5, -19.6, 1.5], // Minas Gerais
  [151.7, -32.9, 1], // Newcastle
  [8.9, 44.4, 0.8], [12.6, 42.6, 0.8], // Genoa, Terni
  [28, -26, 1.5], // the Witwatersrand
  [29.8, -19, 1], // Zimbabwe (Kwekwe)
  [7.8, 36.9, 0.8], // Annaba
  [-12.2, 21, 1.5], // Mauritania (Zouérat iron)
  [-10.5, 7.5, 1], // Liberia (Nimba)
];
const COAL: D[] = [[7.2, 51.5, 1], [-2, 53, 2], [-3.5, 51.6, 1], [3.8, 50.4, 1], [18.8, 50.2, 1], [38.5, 48.2, 1.5], [-77.5, 40.5, 2], [-81.5, 38, 1.5], [87, 54.5, 1.5], [112.5, 37.8, 2], [131, 33.7, 1]];
const OIL_1914: D[] = [
  [49.8, 40.4, 1.5], [45.7, 43.3, 1], [39.8, 44.6, 1], // Baku, Grozny, Maikop
  [26, 45, 1.2], // Ploiești
  [22.6, 49.5, 1], // Galicia
  [-98.5, 35.5, 2], [-95.5, 30, 1.5], // Oklahoma, Gulf coast
  [-119, 35.3, 1.2], // California
  [-97.9, 22.2, 1.2], // Tampico
  [49.3, 32, 1.5], // Masjed Soleyman
  [104, -3, 2], [117, -1.3, 1.5], // Sumatra, Borneo
  [94.9, 20.4, 1], // Yenangyaung
];
const OIL_1939: D[] = [
  ...OIL_1914,
  [-71.5, 10.5, 1.5], // Maracaibo
  [44.4, 35.5, 1], // Kirkuk
  [50.2, 26.1, 0.8], // Dhahran and Bahrain
  [-61.4, 10.4, 0.6], // Trinidad
  [114.5, 4.5, 1], // Brunei and Sarawak
  [-114, 50.6, 1], // Turner Valley
  [-67.5, -45.9, 1], // Comodoro Rivadavia
];
const OIL_MODERN: D[] = [
  ...OIL_1939,
  [49.5, 25.5, 2.5], // Ghawar and the eastern province
  [47.8, 29.2, 1], // Kuwait
  [53.5, 24, 1.5], // Abu Dhabi
  [51.3, 25.3, 0.8], // Qatar
  [47.2, 30.8, 1.2], // Basra
  [73, 61.5, 4], // West Siberia
  [53, 54, 2.5], // Volga-Urals
  [53, 45, 3], // Kazakhstan (Tengiz, Kashagan)
  [6.5, 5, 1.5], // Niger delta
  [12.5, -5.5, 1], // Cabinda
  [19.5, 29.5, 2.5], // Sirte basin
  [6.5, 30, 2.5], // Hassi Messaoud
  [-64.5, 8.5, 1.5], // Orinoco belt
  [-102.5, 31.8, 1.5], // Permian basin
  [-103, 48, 1], // Bakken
  [-149, 70, 1.5], // North Slope
  [-112, 57, 2], // Alberta oil sands
  [-92.5, 19, 1], // Campeche
  [-41, -22.5, 1], // Campos and Santos
  [-2, 57.5, 1], [5.7, 58.9, 1], // North Sea (Aberdeen, Stavanger)
  [125, 46.5, 1.2], // Daqing
  [56, 20, 2], // Oman
  [-72.5, 6, 1.5], // Colombia
  [29, 10, 1.5], // Sudan (Heglig, Unity)
  [9, -1, 1], [8.7, 3.7, 0.7], [12, -4.7, 0.8], // Gabon, Equatorial Guinea, Congo
  [33, 28.5, 1], // Gulf of Suez
  [16.5, 9, 1.2], // Chad (Doba)
  [9.5, 32, 1.2], // southern Tunisia
  [16, 40.4, 0.7], // Basilicata
  [-2.5, 4.9, 0.8], // Ghana offshore
  [13.5, -9, 1], // Angola (Kwanza)
  [44.5, 15.5, 1], // Yemen
];
const RUBBER: D[] = [[102, 3.8, 2.5], [101, 1, 2], [110, -7, 2], [80.6, 7.2, 1.2], [106.5, 11.5, 1.5], [-10, 6.5, 1], [23, 0.5, 2.5], [-60, -3.5, 3]];
const FOOD: D[] = [
  [33, 49, 3], [39.5, 45.5, 1.5], // Ukraine, Kuban
  [-97, 40, 4], [-90, 41.5, 2.5], // Great Plains, Corn Belt
  [-106, 51, 3], // Canadian prairies
  [-61, -34.5, 3], // Pampas
  [145, -34, 3], // Murray-Darling
  [74.5, 30.5, 2], // Punjab
  [31, 30, 2], // Nile delta
  [20.5, 46.8, 1.3], // Hungarian plain
  [2.5, 49, 1.3], // Paris basin
  [26, 44.4, 1.2], // Wallachia
  [116, 34, 3], // North China plain
  [-54, -14, 3], // Mato Grosso
  [10.5, 45, 1.3], [15.5, 41.3, 1], // Po valley, Apulia
  [-4.5, 37.8, 1.5], // Andalusia
  [-7, 33, 1.5], [3, 36.3, 1.2], [10, 36.3, 1], // Morocco, the Mitidja, Tunisia
  [33, 14.5, 1.5], // Gezira
  [39, 9, 2], [36.5, -0.5, 1.5], [32.5, 1, 1.2], // Ethiopian highlands, Kenya, Uganda
  [8, 11.5, 2], [-5, 6.5, 1.5], [-1.5, 6.5, 1], // northern Nigeria, Ivory Coast, Ghana
  [-5, 14, 1.5], [-15.5, 14.5, 1], // inner Niger delta, Senegal
  [35, -6, 1.5], [31, -17.5, 1.2], [27, -28.5, 1.5], [34, -14, 1], // Tanzania, Zimbabwe, the Highveld, Malawi
  [33, 38.5, 2], // Anatolia
  [100.5, 15.5, 1.5], [105.7, 10, 1], [110, -7.3, 1.5], [90, 24, 1.2], // Chao Phraya, Mekong, Java, Bengal
  [-101, 20.5, 1.5], [19.5, 52.5, 1.5], [121, 15.5, 1], // the Bajío, Poland, Luzon
];
const URANIUM_1939: D[] = [[26.6, -11.1, 1], [-117.7, 66.1, 1.5], [12.9, 50.4, 0.6], [-108.5, 38, 1.5]];
const URANIUM_MODERN: D[] = [
  [68, 45, 3], // Kazakhstan
  [-106, 58, 2], // Athabasca
  [132.5, -12.7, 1], [136.9, -30.4, 1], // Ranger, Olympic Dam
  [7.3, 18.7, 1], // Arlit
  [15, -22.5, 1], // Rössing and Husab
  [118.5, 50.3, 1], // Krasnokamensk
  [64.5, 41, 1.5], // Uzbekistan
  [33.5, 48.3, 0.8], // Zhovti Vody
  [-108, 43, 2], // Wyoming
  [-79, 46.5, 2], // Elliot Lake
  [26.7, -27, 1], // South Africa
];
const ELECTRONICS: D[] = [
  [121, 24.5, 1.3], // Taiwan
  [127.5, 36.5, 1.5], // South Korea
  [138, 35.5, 2.5], // Japan
  [114, 22.7, 1.2], [121.4, 31.2, 1.2], // Shenzhen, Shanghai
  [-122, 37.4, 1], [-97.7, 30.3, 1], [-71.1, 42.4, 0.8], [-122.3, 47.6, 0.8], // Silicon Valley, Austin, Boston, Seattle
  [5.5, 51.4, 0.8], [13.7, 51, 0.8], // Eindhoven, Dresden
  [34.8, 32.1, 0.7], // Israel
  [100.3, 5.4, 0.8], [103.8, 1.35, 0.5], // Penang, Singapore
  [77.6, 13, 1], // Bangalore
  [-6.3, 53.3, 0.7], // Dublin
  [9.2, 45.5, 0.7], [11.6, 48.1, 0.7], [2.3, 48.8, 0.6], // Milan, Munich, Paris
  [-99.1, 19.4, 0.7], [-46.6, -23.5, 0.8], // Mexico City, São Paulo
];
const RARE: D[] = [[109.9, 41.8, 1.5], [115, 25.5, 2], [97.5, 26, 1.5], [-115.5, 35.5, 1], [122.6, -28.9, 1], [33, 67.6, 1], [-46.9, -19.6, 1], [-46, 61, 1], [76.4, 9, 0.8],
  [27, -11, 1.5], [28, -12.8, 1], // Katanga cobalt, the Copperbelt
  [27.5, -25, 1], [47, -20.5, 1.2], [39, -16, 1.2], [33, -8, 1], // Bushveld, Madagascar, Mozambique, Tanzania
  [-6.9, 32.9, 1], [-13, 10.5, 1], [29.5, -3, 0.8], [-1.8, 6.2, 0.6], // Moroccan phosphates, Guinea bauxite, Burundi and Rwanda, Ghana
  [-69, -23, 1.5], [-67, -20.5, 1.2], // Atacama and Bolivian lithium
];

// ---- the United States (a map of the states) ------------------------------------------------------
const US_OIL: D[] = [[-102.5, 31.8, 2], [-97.5, 35.5, 1.5], [-95, 29.5, 1.5], [-103, 48, 1.5], [-119, 35.3, 1.2], [-149, 70, 3], [-91.5, 30.5, 1.5], [-106, 42.5, 1.5]];
const US_TECH: D[] = [[-122, 37.4, 1.5], [-122.3, 47.6, 1], [-71.1, 42.4, 1], [-97.7, 30.3, 1], [-78.8, 35.8, 1], [-111.9, 33.4, 1], [-74, 40.7, 0.8]];
const US_STEEL: D[] = [[-80, 40.4, 1.5], [-87.5, 41.6, 1.5], [-92.5, 47.5, 1.5], [-81.7, 41.5, 1], [-86.8, 33.5, 1]];
const US_FOOD: D[] = [[-97, 40, 4], [-90, 41.5, 3], [-100, 46, 2.5], [-120.5, 37, 1.5]];
const US_URANIUM: D[] = [[-108, 43, 2], [-108.5, 38, 1.5], [-107.8, 35.4, 1.2], [-110, 37.5, 1.2]];

// ---- the pandemic: what fights a disease ------------------------------------------------------------
/** Rainforests and other rich ecosystems, where new medicines are found. */
const COMPOUNDS: D[] = [[-62, -4, 5], [-71, -8, 3], [-77, -1, 1.5], [-42, -20, 1.5], [-84, 10, 1.5], [22, -1, 4], [12, 4, 1.5], [11.5, -0.5, 1.5], [47, -19, 2.5],
  [114, 1, 2.5], [101, 0, 2], [143, -5, 2.5], [101, 24, 1.5], [75.5, 12, 1.5], [145.5, -17, 1.5]];
/** Pharmaceutical industry. */
const MEDICINE: D[] = [[7.6, 47.6, 1], [-74.5, 40.5, 1], [78.5, 17.4, 1], [72.6, 23, 1], [-8.5, 51.9, 1], [8.7, 50.1, 1], [121.5, 31.2, 1], [135.5, 34.7, 1], [0.1, 52.2, 0.8],
  [4.4, 50.8, 0.8], [12.5, 55.7, 0.8], [-66.5, 18.2, 0.8], [-46.6, -23.5, 1], [126.7, 37.5, 0.8], [34.8, 32.1, 0.6], [103.8, 1.35, 0.6]];
/** Research labs and biotech. */
const REAGENTS: D[] = [[-71.1, 42.4, 1], [-117.2, 32.9, 1], [-122.3, 37.6, 1], [4.5, 52.2, 0.8], [8.5, 49.5, 0.8], [114, 22.5, 1], [139.7, 35.7, 1], [18, 59.3, 1], [4.8, 45.8, 0.8],
  [83, 55, 1.5], [37.6, 55.75, 1], [73.9, 18.5, 1], [-82.4, 23.1, 0.8], [-79.4, 43.7, 1], [116.4, 39.9, 1]];
/** Masks, gowns and gloves: the textile and plastics industry. */
const GEAR: D[] = [[113.3, 23.1, 1.5], [101.7, 3.1, 1], [106.7, 10.8, 1], [90.4, 23.8, 1], [100.5, 13.75, 1], [74.5, 32.5, 1], [29, 41, 1], [-100.3, 25.7, 1], [-87.6, 41.9, 1],
  [7.2, 51.5, 0.8], [9.2, 45.5, 0.8], [106.8, -6.2, 1], [77.3, 11.1, 1], [120.2, 30.3, 1]];

// ---- the eras ------------------------------------------------------------------------------------
const horses = (deposits: D[], units: string[]): ResourceDef => ({ id: 'horses', name: 'Horses', color: '#b07a45', extract: 'farm', price: 4, units, deposits });
const grain = (deposits: D[]): ResourceDef => ({ id: 'grain', name: 'Grain', color: '#d8c15a', extract: 'farm', price: 2, deposits });
const iron = (deposits: D[], units: string[] = []): ResourceDef => ({ id: 'iron', name: 'Iron', color: '#7d8590', extract: 'mine', price: 4, units, deposits });
const oil = (deposits: D[], units: string[]): ResourceDef => ({ id: 'oil', name: 'Oil', color: '#1f1f1f', extract: 'mine', price: 6, units, deposits });
const steel = (deposits: D[], units: string[] = []): ResourceDef => ({ id: 'steel', name: 'Steel', color: '#7d8590', extract: 'mine', price: 5, units, deposits });
const food = (deposits: D[]): ResourceDef => ({ id: 'food', name: 'Food', color: '#d8c15a', extract: 'farm', price: 2, deposits });
const uranium = (deposits: D[]): ResourceDef => ({ id: 'uranium', name: 'Uranium', color: '#7ad04a', extract: 'mine', price: 18, deposits });
const electronics = (deposits: D[], units: string[]): ResourceDef => ({ id: 'electronics', name: 'Electronics', color: '#3f8fd2', extract: 'factory', price: 8, units, deposits });

const ANCIENT: ResourceDef[] = [
  horses(HORSES_OLD, ['chariots', 'cavalry', 'horse-archers']),
  iron(IRON_OLD, ['legion', 'comitatenses']),
  grain(GRAIN_OLD),
];

export const ERA_RESOURCES: Record<EraId, ResourceDef[]> = {
  bronze: [
    horses(HORSES_OLD, ['chariots']),
    { id: 'copper', name: 'Copper and tin', color: '#c27a4a', extract: 'mine', price: 4, deposits: COPPER_OLD },
    grain(GRAIN_OLD),
  ],
  'rome-rise': ANCIENT,
  'rome-fall': ANCIENT,
  renaissance: [
    horses(HORSES_1500, ['knights']),
    iron(IRON_1500),
    { id: 'saltpetre', name: 'Saltpetre', color: '#c9c9c9', extract: 'mine', price: 5, units: ['arquebusiers', 'cannon'], deposits: SALTPETRE },
    { id: 'silver', name: 'Silver', color: '#a9b8c8', extract: 'mine', price: 7, deposits: SILVER },
    { id: 'spices', name: 'Spices', color: '#c0553a', extract: 'farm', price: 7, deposits: SPICES },
    { id: 'sugar', name: 'Sugar', color: '#e8dccb', extract: 'farm', price: 5, deposits: SUGAR },
    grain(GRAIN_OLD),
  ],
  ww1: [
    steel(STEEL, ['artillery']),
    { id: 'coal', name: 'Coal', color: '#3b3b3b', extract: 'mine', price: 3, deposits: COAL },
    oil(OIL_1914, []),
    horses(HORSES_1500, ['cavalry']),
    food(FOOD),
    { id: 'rubber', name: 'Rubber', color: '#5a7d3c', extract: 'farm', price: 4, deposits: RUBBER },
  ],
  ww2: [
    oil(OIL_1939, ['armor', 'air']),
    steel(STEEL, ['artillery']),
    { id: 'rubber', name: 'Rubber', color: '#5a7d3c', extract: 'farm', price: 5, deposits: RUBBER },
    uranium(URANIUM_1939),
    food(FOOD),
  ],
  modern: [
    oil(OIL_MODERN, ['armor', 'air']),
    steel(STEEL),
    electronics(ELECTRONICS, ['drones']),
    { id: 'rare', name: 'Rare earths', color: '#9b6bc4', extract: 'mine', price: 10, deposits: RARE },
    uranium(URANIUM_MODERN),
    food(FOOD),
  ],
  usa: [
    oil(US_OIL, ['armor', 'air']),
    electronics(US_TECH, ['drones']),
    steel(US_STEEL),
    uranium(US_URANIUM),
    food(US_FOOD),
  ],
  // Pangea: by each country's present-day lands (scripts/pangea.ts keeps those positions)
  pangea: [
    horses(HORSES_OLD, ['cavalry']),
    iron([...IRON_OLD, ...STEEL.filter((_, i) => i % 2 === 0)], ['swordsmen']),
    grain([...GRAIN_OLD, ...FOOD]),
    { id: 'spices', name: 'Spices', color: '#c0553a', extract: 'farm', price: 7, deposits: SPICES },
  ],
  // the pandemic: no oil or steel, but the materials of medicine
  pandemic: [
    { id: 'compounds', name: 'Rare plant compounds', color: '#3f9a4a', extract: 'farm', price: 9, deposits: COMPOUNDS },
    { id: 'medicine', name: 'Medicines', color: '#d0453a', extract: 'factory', price: 7, deposits: MEDICINE },
    { id: 'reagents', name: 'Lab reagents', color: '#3f8fd2', extract: 'factory', price: 8, deposits: REAGENTS },
    { id: 'gear', name: 'Protective gear', color: '#e0c060', extract: 'factory', price: 4, units: ['guard'], deposits: GEAR },
    food(FOOD),
  ],
};

/**
 * Materials each unit costs to raise, per era (basic troops need only food). Weapons and the
 * province upgrades have their own costs (see WEAPONS and DEVELOP_COST).
 */
export const ERA_UNIT_COSTS: Record<EraId, Record<string, Record<string, number>>> = {
  bronze: { spearmen: { grain: 1 }, archers: { grain: 1, copper: 1 }, chariots: { horses: 2, copper: 1 } },
  'rome-rise': { legion: { iron: 2, grain: 1 }, auxilia: { grain: 1 }, cavalry: { horses: 2, iron: 1 }, 'horse-archers': { horses: 2 }, spearmen: { grain: 1 } },
  'rome-fall': { comitatenses: { iron: 2, grain: 1 }, foederati: { grain: 1 }, cavalry: { horses: 2, iron: 1 }, 'horse-archers': { horses: 2 } },
  renaissance: { pikemen: { grain: 1 }, arquebusiers: { saltpetre: 1, iron: 1 }, knights: { horses: 2, iron: 1 }, cannon: { iron: 3, saltpetre: 2 } },
  ww1: { infantry: { food: 1 }, cavalry: { horses: 2, food: 1 }, artillery: { steel: 3, coal: 1 } },
  ww2: { infantry: { food: 1 }, armor: { steel: 3, oil: 2, rubber: 1 }, artillery: { steel: 3 }, air: { steel: 2, oil: 2, rubber: 1 } },
  modern: { infantry: { food: 1 }, armor: { steel: 3, oil: 2 }, air: { steel: 2, oil: 2, electronics: 2 }, drones: { electronics: 2, rare: 1 } },
  usa: { infantry: { food: 1 }, armor: { steel: 3, oil: 2 }, air: { steel: 2, oil: 2, electronics: 2 }, drones: { electronics: 2 } },
  pangea: { spearmen: { grain: 1 }, swordsmen: { iron: 2 }, archers: { grain: 1 }, cavalry: { horses: 2 } },
  pandemic: { guard: { food: 1, gear: 1 } },
};

/** Materials to develop a province one level, per era (plus money). */
export const DEVELOP_COST: Record<EraId, Record<string, number>> = {
  bronze: { grain: 3, copper: 1 },
  'rome-rise': { grain: 3, iron: 1 },
  'rome-fall': { grain: 3, iron: 1 },
  renaissance: { grain: 3, iron: 1 },
  ww1: { food: 3, steel: 2 },
  ww2: { food: 3, steel: 2 },
  modern: { food: 2, steel: 2, electronics: 1 },
  usa: { food: 2, steel: 2, electronics: 1 },
  pangea: { grain: 3, iron: 1 },
  pandemic: { food: 2, medicine: 1 },
};

export const resourcesOf = (era: EraId): ResourceDef[] => ERA_RESOURCES[era] ?? [];
export const unitCostsOf = (era: EraId) => ERA_UNIT_COSTS[era] ?? {};
