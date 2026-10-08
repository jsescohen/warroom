import { feature } from 'topojson-client';
import type { ProvinceMeta, UnitTypeDef } from '../core/scenario';
import { apiFetch } from '../auth/account';
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
  /** Touches the sea: has a coastline border segment on the real coast (not a lake shore or a gap inland). */
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

/**
 * Downloads a map (1–3 MB of JSON, compressed on the wire), reporting progress (0..1, or -1 when
 * the size is unknown), and gives up after a while instead of hanging.
 */
export async function loadMap(url: string, onProgress?: (fraction: number) => void, timeoutMs = 45_000): Promise<MapData> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await apiFetch(url, { signal: ac.signal });
    if (res.status === 401 || res.status === 403) throw new Error('The server did not let this browser load the map: sign out and in again.');
    if (!res.ok) throw new Error(`The map could not be loaded (HTTP ${res.status}).`);
    // raw (decompressed) size is unknown when the server compresses; count what arrives
    const total = Number(res.headers.get('x-raw-length') ?? 0);
    let text: string;
    if (res.body && onProgress) {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        onProgress(total ? Math.min(1, got / total) : -1);
      }
      text = new TextDecoder().decode(concat(chunks, got));
    } else text = await res.text();
    return parseMap(url, JSON.parse(text) as MapFile);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('The map is taking too long to download. Check your connection and try again.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
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
  const seaShore = file.land?.length ? seaShoreTest(file.land) : () => true;
  for (const b of file.borders) if (b.b < 0 && !provinces[b.a].coastal && seaShore(b.c)) provinces[b.a].coastal = true;
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

/**
 * Province edges without a neighbour are coast, lake shore, or a gap between territories in the
 * source data. Only the first is sea: real coastlines run along the edge of the land outline, or
 * lie outside it altogether (small islands the coarse outline leaves out). Edges deep inside the
 * land are lakes (Lake Constance, the Great Lakes) or data gaps, where no fleet can sail.
 */
function seaShoreTest(land: number[][][]): (coords: number[]) => boolean {
  const CELL = 3; // map units: how close to the land outline counts as the coast
  const grid = new Set<number>();
  const key = (cx: number, cy: number) => cx * 100_003 + cy;
  for (const poly of land) for (const ring of poly) for (let i = 0; i < ring.length; i += 2) grid.add(key(Math.floor(ring[i] / CELL), Math.floor(ring[i + 1] / CELL)));
  const nearOutline = (x: number, y: number) => {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (grid.has(key(cx + dx, cy + dy))) return true;
    return false;
  };
  const boxes = land.map((poly) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const r = poly[0];
    for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); }
    return [x0, y0, x1, y1];
  });
  const onLand = (x: number, y: number) => land.some((poly, k) => {
    const [x0, y0, x1, y1] = boxes[k];
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    let inside = false;
    for (const ring of poly) for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const yi = ring[i + 1], yj = ring[j + 1];
      if ((yi > y) !== (yj > y) && x < ((ring[j] - ring[i]) * (y - yi)) / (yj - yi) + ring[i]) inside = !inside;
    }
    return inside;
  });
  return (coords) => {
    for (let i = 0; i < coords.length; i += 2) if (nearOutline(coords[i], coords[i + 1])) return true;
    const m = Math.floor(coords.length / 4) * 2; // a vertex mid-way along the edge
    return !onLand(coords[m], coords[m + 1]);
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
