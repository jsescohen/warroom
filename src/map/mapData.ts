import { feature } from 'topojson-client';
import type { ProvinceMeta, UnitTypeDef } from '../core/scenario';
import { buildWorld, type World } from '../core/world';

/** Static, read-only map geometry. Never stored in GameState. */
export interface ProvinceGeo {
  id: string;
  index: number;
  name: string;
  polity: string;
  subject: string;
  city: boolean;
  pop: number;
  area: number;
  label: [number, number];
  lonlat: [number, number];
  neighbors: string[];
  /** Touches the sea (has at least one coastline border segment). */
  coastal: boolean;
  /** Polygons → rings → flat [x0, y0, x1, y1, ...]; ring 0 is the outer ring. */
  polygons: number[][][];
  bbox: [number, number, number, number];
}

/** A border segment between province indices a and b (b = -1 for coastline). */
export interface BorderSeg {
  a: number;
  b: number;
  coords: number[];
}

export interface MapData {
  id: string;
  width: number;
  height: number;
  provinces: ProvinceGeo[];
  byId: Map<string, ProvinceGeo>;
  borders: BorderSeg[];
  /** Background land (polygons of flat rings): shows land outside any province. */
  land: number[][][];
}

interface MapFile {
  meta: { width: number; height: number; source: string };
  topology: any;
  borders: { a: number; b: number; c: number[] }[];
  land?: number[][][];
}

export async function loadMap(url: string): Promise<MapData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load map ${url}: ${res.status}`);
  return parseMap(url, (await res.json()) as MapFile);
}

export function parseMap(id: string, file: MapFile): MapData {
  const fc = feature(file.topology, file.topology.objects.provinces) as unknown as {
    features: { id: string; properties: any; geometry: { type: string; coordinates: number[][][][] | number[][][] } }[];
  };
  const provinces: ProvinceGeo[] = fc.features.map((f, index) => {
    const coords = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const polygons = coords.map((poly) =>
      poly.map((ring) => {
        const flat: number[] = [];
        for (const [x, y] of ring) {
          flat.push(x, y);
          if (x < x0) x0 = x;
          if (y < y0) y0 = y;
          if (x > x1) x1 = x;
          if (y > y1) y1 = y;
        }
        return flat;
      }),
    );
    const p = f.properties;
    return {
      id: String(f.id), index, name: p.name, polity: p.polity, subject: p.subject, city: p.city, pop: p.pop,
      area: p.area, label: p.label, lonlat: p.lonlat, neighbors: p.neighbors, coastal: false, polygons, bbox: [x0, y0, x1, y1],
    };
  });
  for (const b of file.borders) if (b.b < 0) provinces[b.a].coastal = true;
  return {
    id,
    width: file.meta.width,
    height: file.meta.height,
    provinces,
    byId: new Map(provinces.map((p) => [p.id, p])),
    borders: file.borders.map((b) => ({ a: b.a, b: b.b, coords: b.c })),
    land: file.land ?? [],
  };
}

/** Static simulation context for a scenario on this map. */
export const buildWorldFromMap = (map: MapData, unitTypes: UnitTypeDef[]): World =>
  buildWorld(map.provinces.map((p) => ({ id: p.id, name: p.name, label: p.label, area: p.area, coastal: p.coastal, neighbors: p.neighbors })), unitTypes);

/** Renames provinces to their period names (Paris → Lutetia). Returns the same map, mutated. */
export function applyProvinceNames(map: MapData, names: Record<string, string> | undefined): MapData {
  if (!names) return map;
  for (const p of map.provinces) {
    const era = names[p.name];
    if (era) p.name = era;
  }
  return map;
}

export const provinceMeta = (p: ProvinceGeo): ProvinceMeta => ({
  id: p.id, name: p.name, polity: p.polity, subject: p.subject, lon: p.lonlat[0], lat: p.lonlat[1],
});

/** Point-in-province test on flat rings (even-odd rule handles holes). */
export function provinceContains(p: ProvinceGeo, x: number, y: number): boolean {
  if (x < p.bbox[0] || x > p.bbox[2] || y < p.bbox[1] || y > p.bbox[3]) return false;
  let inside = false;
  for (const poly of p.polygons)
    for (const r of poly)
      for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
        const yi = r[i + 1], yj = r[j + 1];
        if (yi > y !== yj > y && x < ((r[j] - r[i]) * (y - yi)) / (yj - yi) + r[i]) inside = !inside;
      }
  return inside;
}
