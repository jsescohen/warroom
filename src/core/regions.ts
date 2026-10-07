/**
 * Coarse world zones used to split tribal land (land outside any polity in ancient maps) into
 * separate peoples. First matching box wins, so specific zones come before broad ones.
 * Scenarios can rename zones per era (scenario.tribeNames).
 */
export interface Zone {
  id: string;
  name: string;
  /** [lonMin, lonMax, latMin, latMax] */
  box: [number, number, number, number];
}

export const ZONES: Zone[] = [
  { id: 'arctic', name: 'Arctic peoples', box: [-180, 180, 66, 90] },
  { id: 'britain', name: 'Celtic Britons', box: [-11, 2, 49.5, 61] },
  { id: 'scandinavia', name: 'Norse tribes', box: [4, 32, 55, 66] },
  { id: 'iberia', name: 'Iberian tribes', box: [-10, 3.5, 36, 44] },
  { id: 'gaul', name: 'Gallic tribes', box: [-5, 8, 42, 51] },
  { id: 'germania', name: 'Germanic tribes', box: [2, 20, 46, 55.5] },
  { id: 'baltic', name: 'Baltic tribes', box: [20, 32, 53, 60] },
  { id: 'balkans', name: 'Thracian and Illyrian tribes', box: [13, 30, 39, 46] },
  { id: 'caucasus', name: 'Caucasian tribes', box: [37, 50, 38, 44] },
  { id: 'sarmatia', name: 'Sarmatians', box: [20, 60, 44, 60] },
  { id: 'north-africa', name: 'Berber tribes', box: [-17, 35, 27, 37] },
  { id: 'sahara', name: 'Saharan nomads', box: [-17, 35, 15, 27] },
  { id: 'arabia', name: 'Arab tribes', box: [34, 60, 12, 32] },
  { id: 'central-asia', name: 'Central Asian nomads', box: [50, 80, 35, 55] },
  { id: 'siberia', name: 'Siberian peoples', box: [60, 180, 50, 66] },
  { id: 'tibet', name: 'Tibetan tribes', box: [75, 100, 27, 40] },
  { id: 'mongolia', name: 'Steppe nomads', box: [80, 125, 40, 52] },
  { id: 'japan', name: 'Japanese clans', box: [128, 146, 30, 46] },
  { id: 'manchuria', name: 'Manchurian tribes', box: [120, 142, 38, 52] },
  { id: 'india', name: 'Indian tribes', box: [66, 92, 6, 35] },
  { id: 'south-china', name: 'Yue tribes', box: [100, 122, 18, 30] },
  { id: 'southeast-asia', name: 'Southeast Asian chiefdoms', box: [92, 110, 5, 27] },
  { id: 'philippines', name: 'Island chiefdoms', box: [116, 127, 5, 20] },
  { id: 'madagascar', name: 'Malagasy peoples', box: [43, 51, -26, -11] },
  { id: 'insular-asia', name: 'Island chiefdoms', box: [95, 150, -11, 5] },
  { id: 'east-africa', name: 'East African peoples', box: [28, 52, -12, 15] },
  { id: 'west-africa', name: 'West African peoples', box: [-18, 15, 0, 15] },
  { id: 'central-africa', name: 'Central African peoples', box: [8, 30, -12, 8] },
  { id: 'southern-africa', name: 'Southern African peoples', box: [10, 41, -35, -12] },
  { id: 'australia', name: 'Aboriginal peoples', box: [110, 155, -45, -10] },
  { id: 'caribbean', name: 'Caribbean peoples', box: [-86, -59, 10, 27] },
  { id: 'mesoamerica', name: 'Mesoamerican peoples', box: [-118, -77, 7, 30] },
  { id: 'north-america-east', name: 'Eastern Woodlands peoples', box: [-100, -50, 24, 66] },
  { id: 'north-america-west', name: 'Western North American peoples', box: [-170, -100, 30, 66] },
  { id: 'andes', name: 'Andean peoples', box: [-82, -63, -40, 12] },
  { id: 'amazon', name: 'Amazonian peoples', box: [-63, -34, -20, 12] },
  { id: 'southern-cone', name: 'Pampas peoples', box: [-75, -50, -56, -20] },
  { id: 'oceania', name: 'Pacific islanders', box: [150, 180, -50, 30] },
];

export function zoneOf(lon: number, lat: number): Zone {
  for (const z of ZONES) {
    const [x0, x1, y0, y1] = z.box;
    if (lon >= x0 && lon <= x1 && lat >= y0 && lat <= y1) return z;
  }
  if (lon < -140) return ZONES.find((z) => z.id === 'oceania')!;
  return { id: 'wilds', name: 'Free peoples', box: [-180, 180, -90, 90] };
}
