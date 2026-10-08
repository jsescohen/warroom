/**
 * Pangea: today's countries on the supercontinent.
 *
 * Every piece of land is assigned to a tectonic plate and moved rigidly (a rotation of the sphere)
 * back to roughly where it sat ~200 million years ago, with Africa fixed: South America nests into
 * the Gulf of Guinea, North America lies against Morocco and Mauritania, Madagascar against East
 * Africa, India against Madagascar, Antarctica below southern Africa and Australia against
 * Antarctica. The whole supercontinent is then turned so it lies along the equator (the map
 * projection stretches the poles).
 *
 *   tsx scripts/pangea.ts prep     data-src/world_2010.geojson + places -> data-src/pangea*.geojson
 *   tsx scripts/pangea.ts post     public/maps/pangea.json: present-day lon/lat (for resources) and
 *                                   land links between countries that now touch
 *   tsx scripts/pangea.ts preview  scratch SVG of the moved coastlines (for tuning)
 */
import fs from 'node:fs';
import { Delaunay } from 'd3-delaunay';

type V3 = [number, number, number];
type M3 = [V3, V3, V3];
type LL = [number, number];

const RAD = Math.PI / 180;
const toV = ([lon, lat]: LL): V3 => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
const toLL = ([x, y, z]: V3): LL => [Math.atan2(y, x) / RAD, Math.atan2(z, Math.hypot(x, y)) / RAD];
const mul = (m: M3, v: V3): V3 => [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
const mm = (a: M3, b: M3): M3 => [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j])) as M3;
const I3: M3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/** Rotation that best carries the source points onto the targets (Horn's quaternion method). */
function fit(pairs: [LL, LL][]): M3 {
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const [a, b] of pairs) {
    const p = toV(a), q = toV(b);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S[i][j] += p[i] * q[j];
  }
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
  const N = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  const [w, x, y, z] = topEigenvector(N);
  return [
    [w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z],
  ];
}
/** Eigenvector of the largest eigenvalue of a symmetric 4x4 matrix (shifted power iteration). */
function topEigenvector(A: number[][]): number[] {
  const shift = A.reduce((s, r) => s + r.reduce((t, v) => t + Math.abs(v), 0), 0);
  let v = [1, 0.1, 0.2, 0.3];
  for (let k = 0; k < 5000; k++) {
    const w = A.map((r, i) => r.reduce((s, x, j) => s + x * v[j], 0) + shift * v[i]);
    const l = Math.hypot(...w);
    v = w.map((x) => x / l);
  }
  return v;
}

// ---- plates -------------------------------------------------------------------------------------

export type Plate = 'AFR' | 'SAM' | 'NAM' | 'EUR' | 'MAD' | 'IND' | 'ANT' | 'AUS';
export const PLATES: Plate[] = ['AFR', 'SAM', 'NAM', 'EUR', 'MAD', 'IND', 'ANT', 'AUS'];

/** Countries that sit wholly on one plate where geography alone is ambiguous. */
const COUNTRY_PLATE: Record<string, Plate> = {
  India: 'IND', Pakistan: 'IND', Nepal: 'IND', Bhutan: 'IND', Bangladesh: 'IND', 'Sri Lanka': 'IND',
  'Saudi Arabia': 'AFR', Yemen: 'AFR', Oman: 'AFR', 'United Arab Emirates': 'AFR', Qatar: 'AFR', Kuwait: 'AFR', Iraq: 'AFR',
  Syria: 'AFR', Jordan: 'AFR', Israel: 'AFR', Lebanon: 'AFR', Egypt: 'AFR', Libya: 'AFR', Tunisia: 'AFR', Algeria: 'AFR', Morocco: 'AFR', 'Western Sahara': 'AFR',
  Iran: 'EUR', Turkey: 'EUR', Cyprus: 'EUR', 'Turkish Cypriot-administered area': 'EUR', Malta: 'EUR', Spain: 'EUR', Portugal: 'EUR', Italy: 'EUR', Greece: 'EUR', Iceland: 'EUR',
  Afghanistan: 'EUR', China: 'EUR', Burma: 'EUR', Madagascar: 'MAD', Antarctica: 'ANT',
  // places use other spellings
  Myanmar: 'EUR', 'Northern Cyprus': 'EUR',
};

/** Plate of a point by geography (present-day lon/lat). */
export function plateAt(lon: number, lat: number): Plate {
  if (lat < -60) return 'ANT';
  if (lon >= 42.5 && lon <= 51 && lat >= -26.5 && lat <= -11.5) return 'MAD';
  if (lon <= -150 && lat < 0) return 'AUS'; // Samoa, Tonga, Niue, Wallis...
  if (lon >= 160 && lat < 0) return 'AUS'; // Fiji, Vanuatu...
  if ((lon > 110 && lat < -9.5) || (lon >= 129.5 && lon <= 156 && lat >= -12 && lat <= -0.5)) return 'AUS';
  if (lon >= -25 && lon <= -12 && lat >= 62 && lat <= 67.5) return 'EUR'; // Iceland
  if (lon >= -75 && lon <= -10 && lat >= 58) return 'NAM'; // Greenland
  if (lon > 170 && lat > 50) return 'NAM'; // Aleutians
  if (lon > -120 && lon < -30 && lat < 12.7 && !(lon < -77.2 && lat > 7.0)) return 'SAM';
  if (lon >= -112 && lon <= -105 && lat <= -20 && lat >= -30) return 'SAM'; // Rapa Nui
  if (lon < -30) return 'NAM';
  if (lon >= -26 && lon <= 52 && lat >= -40 && lat <= 37.5 && !(lat > 35.95 && lon < 12)) return 'AFR';
  return 'EUR';
}

const plateOf = (country: string | null | undefined, lon: number, lat: number): Plate =>
  (country && COUNTRY_PLATE[country]) || plateAt(lon, lat);

/** Where each plate goes, with Africa fixed: present-day point -> its Pangea position. */
const ANCHORS: Record<Exclude<Plate, 'AFR' | 'AUS'>, [LL, LL][]> = {
  SAM: [
    [[-34.9, -8.05], [7.2, 2.4]], // Recife into the Gulf of Guinea (Cameroon)
    [[-38.5, -3.7], [1.6, 4.4]], // Fortaleza against Ghana
    [[-52.3, 4.9], [-9.8, 4.6]], // Cayenne against Liberia
    [[-43.2, -22.9], [10.6, -8.2]], // Rio de Janeiro against Angola
    [[-56.2, -34.9], [14.6, -26.5]], // Montevideo against Namibia
  ],
  NAM: [
    [[-80.2, 25.8], [-20.2, 13.0]], // Miami against Senegal
    [[-75.5, 35.2], [-19.0, 21.5]], // Cape Hatteras against Mauritania
    [[-74.0, 40.7], [-16.6, 26.5]], // New York against Western Sahara
    [[-63.6, 44.6], [-12.8, 31.8]], // Halifax against Morocco
    [[-52.7, 47.6], [-12.2, 38.5]], // Newfoundland against Portugal
  ],
  EUR: [
    [[-9.1, 38.7], [-8.6, 39.4]],
    [[5.3, 60.4], [3.0, 60.8]],
    [[37.6, 55.7], [36.0, 55.0]],
    [[116.4, 39.9], [114.0, 38.0]],
  ],
  MAD: [
    [[49.3, -12.3], [46.8, 0.2]], // north tip against Somalia
    [[45.0, -25.6], [41.8, -12.8]], // south tip against Mozambique
    [[49.4, -18.1], [48.6, -6.2]],
  ],
  IND: [
    [[72.8, 19.0], [52.2, -2.8]], // Mumbai against Madagascar's east coast
    [[77.5, 8.1], [52.6, -14.2]], // Kanyakumari
    [[67.0, 24.9], [50.8, 3.8]], // Karachi
  ],
  ANT: [
    [[10.0, -70.5], [31.8, -35.2]], // Dronning Maud Land against Natal
    [[35.0, -69.5], [42.0, -27.0]],
    [[-57.0, -63.3], [-1.0, -47.0]], // Antarctic Peninsula towards Patagonia
  ],
};
/** Australia against Antarctica (present-day positions), then carried along with Antarctica. */
const AUS_TO_ANT: [LL, LL][] = [
  [[115.1, -34.4], [104.0, -64.5]], // Cape Leeuwin
  [[131.0, -31.5], [128.0, -66.5]], // Great Australian Bight
  [[146.8, -43.6], [158.0, -69.0]], // Tasmania
];

const plateRot: Record<Plate, M3> = { AFR: I3 } as Record<Plate, M3>;
for (const p of Object.keys(ANCHORS) as (keyof typeof ANCHORS)[]) plateRot[p] = fit(ANCHORS[p]);
// without Antarctica (no nation lives there) Australia lies straight against India and Madagascar
plateRot.AUS = fit([
  [[130.8, -12.5], [66.5, -9.0]], // Darwin
  [[115.9, -32.0], [57.5, -27.5]], // Perth
  [[153.0, -27.5], [86.0, -22.0]], // Brisbane
]);
void AUS_TO_ANT;

// ---- moving geometry ----------------------------------------------------------------------------

type Ring = LL[];
type Poly = Ring[];
interface Feature { type: 'Feature'; properties: Record<string, unknown>; geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: any } }

const polys = (g: Feature['geometry']): Poly[] => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
const centroid = (r: Ring): LL => {
  let x = 0, y = 0, z = 0;
  for (const p of r) { const v = toV(p); x += v[0]; y += v[1]; z += v[2]; }
  return toLL([x, y, z]);
};

/** The final turn: lays the supercontinent along the equator, centred on the map. */
function globalTurn(points: V3[]): M3 {
  let c: V3 = [0, 0, 0];
  for (const p of points) c = [c[0] + p[0], c[1] + p[1], c[2] + p[2]];
  const len = Math.hypot(...c);
  c = [c[0] / len, c[1] / len, c[2] / len];
  // long axis: principal direction of the points around the centre
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of points) {
    const d = p[0] * c[0] + p[1] * c[1] + p[2] * c[2];
    const t: V3 = [p[0] - d * c[0], p[1] - d * c[1], p[2] - d * c[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += t[i] * t[j];
  }
  let a: V3 = [1, 0.3, 0.2];
  for (let k = 0; k < 100; k++) {
    let b = mul(C as M3, a);
    const d = b[0] * c[0] + b[1] * c[1] + b[2] * c[2];
    b = [b[0] - d * c[0], b[1] - d * c[1], b[2] - d * c[2]];
    const l = Math.hypot(...b);
    a = [b[0] / l, b[1] / l, b[2] / l];
  }
  // new basis: x = centre, y = long axis (east), z = completes it (north)
  const zN: V3 = [c[1] * a[2] - c[2] * a[1], c[2] * a[0] - c[0] * a[2], c[0] * a[1] - c[1] * a[0]];
  return [c, a, zN];
}

function moved(f: Feature, name: string | null): { plate: Plate; poly: Poly }[] {
  return polys(f.geometry).map((poly) => {
    const outer = poly[0].filter(([, lat]) => lat > -89.9); // drop the pole seam of Antarctica
    const [lon, lat] = centroid(outer);
    const plate = plateOf(name, lon, lat);
    const R = plateRot[plate];
    const rings = poly.map((r, i) => (i === 0 ? outer : r).map((p) => toLL(mul(R, toV(p)))));
    return { plate, poly: rings };
  });
}

const PREP_OUT = 'data-src/pangea.geojson';
const PLACES_OUT = 'data-src/pangea_places.geojson';
const TURN_OUT = 'data-src/pangea_turn.json';

// ---- a new supercontinent -----------------------------------------------------------------------
//
// The moved continents only give the layout. The land itself is generated: a fractal coastline
// grown around the layout fills the old oceans between the continents (one supercontinent with its
// own bays, peninsulas and inland seas), and every country grows over it from seed points where it
// sits in the layout, at a pace set by its real size. Neighbours stay neighbours; shapes are new.

const STEP = 0.5; // grid cell, degrees
const LON0 = -180, LAT0 = -72;
const GW = Math.round(360 / STEP), GH = Math.round(144 / STEP);
const cellLL = (i: number): LL => [LON0 + ((i % GW) + 0.5) * STEP, LAT0 + (Math.floor(i / GW) + 0.5) * STEP];
const cellAt = (lon: number, lat: number) => {
  const x = Math.floor((lon - LON0) / STEP), y = Math.floor((lat - LAT0) / STEP);
  return x < 0 || y < 0 || x >= GW || y >= GH ? -1 : y * GW + x;
};

/** Deterministic smooth noise in roughly -1..1 (value noise, several octaves). */
function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  const u = s(xf), v = s(yf);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
function fbm(lon: number, lat: number, seed: number, scale = 12, octaves = 5): number {
  let f = 0, amp = 1, norm = 0, freq = 1 / scale;
  for (let o = 0; o < octaves; o++) {
    f += valueNoise(lon * freq, lat * freq, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return f / norm;
}

/** Fills a polygon (lon/lat rings, even-odd) into the grid, calling `set` for each cell inside. */
function fillPoly(poly: Ring[], set: (i: number) => void) {
  let y0 = Infinity, y1 = -Infinity;
  for (const r of poly) for (const [, lat] of r) { y0 = Math.min(y0, lat); y1 = Math.max(y1, lat); }
  const r0 = Math.max(0, Math.floor((y0 - LAT0) / STEP)), r1 = Math.min(GH - 1, Math.floor((y1 - LAT0) / STEP));
  for (let row = r0; row <= r1; row++) {
    const lat = LAT0 + (row + 0.5) * STEP;
    const xs: number[] = [];
    for (const r of poly) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [ax, ay] = r[i], [bx, by] = r[j];
      if (ay > lat !== by > lat && Math.abs(ax - bx) < 180) xs.push(ax + ((lat - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - LON0) / STEP - 0.5)), c1 = Math.min(GW - 1, Math.floor((xs[k + 1] - LON0) / STEP - 0.5));
      for (let c = c0; c <= c1; c++) set(row * GW + c);
    }
  }
}

interface Country { key: string; props: Record<string, unknown>; parts: Poly[]; area: number }

/** Spherical-ish area of present-day polygons (km^2), for sizing countries. */
const polyKm2 = (p: Poly): number => {
  const ringA = (r: Ring) => {
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]) * Math.cos(((r[j][1] + r[i][1]) / 2) * RAD);
    return Math.abs(a / 2) * 111.32 * 110.57;
  };
  return Math.max(0, ringA(p[0]) - p.slice(1).reduce((s, r) => s + ringA(r), 0));
};

const SQUEEZE_OUT = 'data-src/pangea_layout.json';

function prep() {
  const src = JSON.parse(fs.readFileSync('data-src/world_2010.geojson', 'utf8')) as { features: Feature[] };
  // 1) countries in their Pangea layout
  const countries = new Map<string, Country>();
  const movedParts: { c: Country; poly: Poly }[] = [];
  for (const f of src.features) {
    let name = (f.properties.NAME as string | null) || null;
    if (!name) continue; // nameless islets and Antarctica (no nation): the new land covers the islets anyway
    const key = `${name}|${f.properties.SUBJECTO ?? ''}`;
    if (!countries.has(key)) countries.set(key, { key, props: f.properties, parts: [], area: 0 });
    const c = countries.get(key)!;
    for (const p of polys(f.geometry)) c.area += polyKm2(p);
    for (const m of moved(f, name)) { c.parts.push(m.poly); movedParts.push({ c, poly: m.poly }); }
  }
  let G = globalTurn(movedParts.flatMap((p) => p.poly[0].filter((_, i) => i % 4 === 0).map((ll) => toV(ll))));
  // keep the north up: Paris must end up north of Cape Town (else turn the map half round)
  if (toLL(mul(G, toV([2.35, 48.85])))[1] < toLL(mul(G, toV([18.4, -33.9])))[1]) G = mm([[1, 0, 0], [0, -1, 0], [0, 0, -1]], G);
  let lat0 = 90, lat1 = -90, lon0 = 180, lon1 = -180;
  const turned = movedParts.map((m) => ({ c: m.c, poly: m.poly.map((r) => r.map((p) => toLL(mul(G, toV(p))))) }));
  for (const t of turned) for (const [lon, lat] of t.poly[0]) { lat0 = Math.min(lat0, lat); lat1 = Math.max(lat1, lat); lon0 = Math.min(lon0, lon); lon1 = Math.max(lon1, lon); }
  // fill the map: up to 290 degrees wide and 112 tall, centred
  // (wider than tall: the map is wide; the shapes are new anyway, so stretching costs nothing)
  const sy = Math.min(112 / (lat1 - lat0), 290 / (lon1 - lon0) / 1.6), sx = Math.min(sy * 1.6, 290 / (lon1 - lon0));
  const cx = (lon0 + lon1) / 2, cy = (lat0 + lat1) / 2;
  const layout = (ll: LL): LL => { const t = toLL(mul(G, toV(ll))); return [(t[0] - cx) * sx, (t[1] - cy) * sy]; };
  const placed = turned.map((t) => ({ c: t.c, poly: t.poly.map((r) => r.map(([lon, lat]) => [(lon - cx) * sx, (lat - cy) * sy] as LL)) }));
  fs.writeFileSync(SQUEEZE_OUT, JSON.stringify({ G, cx, cy, sx, sy }));

  // 2) the layout on the grid: which country is where
  const keys = [...countries.keys()];
  const idx = new Map(keys.map((k, i) => [k, i]));
  const layoutOwner = new Int32Array(GW * GH).fill(-1);
  for (const p of placed) fillPoly(p.poly, (i) => { layoutOwner[i] = idx.get(p.c.key)!; });

  // 3) new land: everything near the layout, with a fractal edge
  /** Distance (in cells) from every cell to the nearest cell where `inSet` holds (chamfer). */
  const distTo = (inSet: (i: number) => boolean) => {
    const dist = new Float32Array(GW * GH).fill(1e9);
    for (let i = 0; i < dist.length; i++) if (inSet(i)) dist[i] = 0;
    const pass = (from: number, to: number, step: number, offs: [number, number, number][]) => {
      for (let i = from; i !== to; i += step) {
        const x = i % GW, y = Math.floor(i / GW);
        for (const [dx, dy, w] of offs) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
          const v = dist[ny * GW + nx] + w;
          if (v < dist[i]) dist[i] = v;
        }
      }
    };
    pass(0, GW * GH, 1, [[-1, 0, 1], [0, -1, 1], [-1, -1, 1.414], [1, -1, 1.414]]);
    pass(GW * GH - 1, -1, -1, [[1, 0, 1], [0, 1, 1], [1, 1, 1.414], [-1, 1, 1.414]]);
    return dist;
  };
  // closing: grow by R, then shrink by R: seas narrower than 2R fill in, outer coasts stay put
  const R = 7 / STEP;
  const grown = distTo((i) => layoutOwner[i] >= 0);
  const outside = distTo((i) => grown[i] > R);
  const land = new Uint8Array(GW * GH);
  for (let i = 0; i < land.length; i++) {
    const [lon, lat] = cellLL(i);
    // depth inside the closed shape (degrees), pushed in and out by the noise: a new coastline
    const depth = (outside[i] - R) * STEP;
    const n = fbm(lon, lat, 7, 10) * 4.5 + fbm(lon, lat, 31, 3, 3) * 1.5;
    if (depth + n > 0) land[i] = 1;
  }
  // inland seas: a few low spots far inside become water
  for (let i = 0; i < land.length; i++) {
    if (!land[i]) continue;
    const [lon, lat] = cellLL(i);
    if (fbm(lon, lat, 101, 6, 4) < -0.48) land[i] = 0;
  }
  // keep land masses of a decent size (drop specks), fill tiny lakes
  const comp = (want: number, minSize: number, fill: number) => {
    const seen = new Uint8Array(land.length);
    for (let i = 0; i < land.length; i++) {
      if (seen[i] || land[i] !== want) continue;
      const stack = [i], cells: number[] = [];
      seen[i] = 1;
      while (stack.length) {
        const c = stack.pop()!;
        cells.push(c);
        const x = c % GW, y = Math.floor(c / GW);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
          const n = ny * GW + nx;
          if (!seen[n] && land[n] === want) { seen[n] = 1; stack.push(n); }
        }
      }
      if (cells.length < minSize) for (const c of cells) land[c] = fill;
    }
  };
  comp(1, 30, 0); // islands under ~90,000 km^2 sink
  comp(0, 40, 1); // lakes under ~120,000 km^2 fill

  // 4) seeds: each country gets points spread over its layout territory, about one per 900,000 km^2
  const AREA_PER_SEED = 900_000;
  const cellsOf: number[][] = keys.map(() => []);
  for (let i = 0; i < layoutOwner.length; i++) if (layoutOwner[i] >= 0) cellsOf[layoutOwner[i]].push(i);
  type Seed = { c: number; cell: number; w: number };
  const seeds: Seed[] = [];
  const nearestLand = (cell: number) => {
    if (land[cell]) return cell;
    const x0 = cell % GW, y0 = Math.floor(cell / GW);
    for (let r = 1; r < 40; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
      if (land[y * GW + x]) return y * GW + x;
    }
    return -1;
  };
  keys.forEach((k, ci) => {
    const c = countries.get(k)!;
    if (c.area < 1500) return; // micro-states and specks
    let cells = cellsOf[ci];
    if (!cells.length) {
      // too small to fill a cell: its centre
      const p = placed.find((q) => q.c === c);
      if (!p) return;
      const cell = cellAt(...centroid(p.poly[0]));
      cells = cell >= 0 ? [cell] : [];
    }
    if (!cells.length) return;
    const n = Math.max(1, Math.min(30, Math.round(c.area / AREA_PER_SEED)));
    // farthest-point sampling over the country's layout cells (deterministic)
    const pick: number[] = [cells[Math.floor(cells.length / 2)]];
    const dd = cells.map(() => Infinity);
    while (pick.length < n) {
      const last = pick[pick.length - 1];
      const lx = last % GW, ly = Math.floor(last / GW);
      let best = 0;
      for (let j = 0; j < cells.length; j++) {
        const x = cells[j] % GW, y = Math.floor(cells[j] / GW);
        dd[j] = Math.min(dd[j], (x - lx) ** 2 + (y - ly) ** 2);
        if (dd[j] > dd[best]) best = j;
      }
      pick.push(cells[best]);
    }
    // small countries grow a little more than their real size (they need room for a few provinces)
    const w = Math.pow(Math.min(1, c.area / n / AREA_PER_SEED), 0.33);
    for (const cell of pick) {
      const l = nearestLand(cell);
      if (l >= 0) seeds.push({ c: ci, cell: l, w: Math.max(0.06, w) });
    }
  });

  // 5) countries grow over the land (weighted, noisy shortest paths: borders wander naturally)
  const owner = new Int32Array(GW * GH).fill(-1);
  const cost = new Float64Array(GW * GH).fill(Infinity);
  const heap = new Heap();
  for (const s of seeds) if (0 < cost[s.cell]) { cost[s.cell] = 0; owner[s.cell] = s.c; heap.push(0, s.cell, s.w); }
  while (heap.size) {
    const [d, i, w] = heap.pop()!;
    if (d > cost[i]) continue;
    const x = i % GW, y = Math.floor(i / GW);
    for (const [dx, dy, len] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const n = ny * GW + nx;
      if (!land[n]) continue;
      const [lon, lat] = cellLL(n);
      const rough = 1 + 0.9 * (fbm(lon, lat, 55, 4, 3) + 1) / 2;
      const nd = d + (len * rough) / w;
      if (nd < cost[n]) { cost[n] = nd; owner[n] = owner[i]; heap.push(nd, n, w); }
    }
  }

  // unclaimed land is sea; specks of land left alone in the sea sink
  for (let i = 0; i < land.length; i++) land[i] = owner[i] >= 0 ? 1 : 0;
  comp(1, 12, 0);
  for (let i = 0; i < land.length; i++) if (!land[i]) owner[i] = -1;

  // 6) outlines: jittered points on the land cells make irregular borders and coasts
  const pts: number[] = [];
  const ptCell: number[] = [];
  for (let i = 0; i < owner.length; i++) {
    const [lon, lat] = cellLL(i);
    pts.push(lon + (hash2(i, 1, 9) - 0.5) * STEP * 0.8, lat + (hash2(i, 2, 9) - 0.5) * STEP * 0.8);
    ptCell.push(i);
  }
  const delaunay = new Delaunay(Float64Array.from(pts));
  const vor = delaunay.voronoi([LON0, LAT0, LON0 + 360, LAT0 + GH * STEP]);
  const ringsByCountry = keys.map(() => [] as Ring[]);
  // boundary edges of each country: cell edges whose other side is another country or the sea
  const edges = keys.map(() => new Map<string, [LL, LL]>());
  const kOf = (p: number[]) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
  for (let k = 0; k < ptCell.length; k++) {
    const ci = owner[ptCell[k]];
    if (ci < 0) continue; // sea
    const poly = vor.cellPolygon(k);
    if (!poly) continue;
    const m = edges[ci];
    for (let e = 0; e + 1 < poly.length; e++) {
      const a = poly[e], b = poly[e + 1];
      const fwdK = `${kOf(a)}>${kOf(b)}`, revK = `${kOf(b)}>${kOf(a)}`;
      if (m.has(revK)) m.delete(revK); // shared with a cell of the same country: interior
      else m.set(fwdK, [[a[0], a[1]], [b[0], b[1]]]);
    }
  }
  // smooth every border and coast: each boundary point moves towards its two neighbours along the
  // line (junctions of three or more borders stay put), computed once per point so the two
  // countries on either side of a border get exactly the same curve
  const pos = new Map<string, LL>();
  const adj = new Map<string, Set<string>>();
  for (const m of edges) for (const [, [a, b]] of m) {
    const ka = kOf(a), kb = kOf(b);
    pos.set(ka, a); pos.set(kb, b);
    if (!adj.has(ka)) adj.set(ka, new Set());
    if (!adj.has(kb)) adj.set(kb, new Set());
    adj.get(ka)!.add(kb); adj.get(kb)!.add(ka);
  }
  // Taubin smoothing: a smoothing step, then a slightly larger step back (plain smoothing shrinks
  // closed loops, so a small country ringed by a neighbour would shrink away from its cities)
  for (let it = 0; it < 12; it++) {
    const f = it % 2 === 0 ? 0.5 : -0.53;
    const nextPos = new Map<string, LL>();
    for (const [k, p] of pos) {
      const nb = adj.get(k)!;
      if (nb.size !== 2) { nextPos.set(k, p); continue; }
      const [n1, n2] = [...nb].map((x) => pos.get(x)!);
      nextPos.set(k, [p[0] + f * ((n1[0] + n2[0]) / 2 - p[0]), p[1] + f * ((n1[1] + n2[1]) / 2 - p[1])]);
    }
    for (const [k, p] of nextPos) pos.set(k, p);
  }
  edges.forEach((m, ci) => {
    const next = new Map<string, [LL, LL]>();
    for (const [, e] of m) next.set(kOf(e[0]), e);
    const used = new Set<string>();
    for (const [startK, e0] of next) {
      if (used.has(startK)) continue;
      const ring: Ring = [];
      let k = startK, e = e0;
      while (e && !used.has(k)) {
        used.add(k);
        ring.push(pos.get(k) ?? e[0]);
        k = kOf(e[1]);
        e = next.get(k)!;
      }
      if (ring.length >= 3) ringsByCountry[ci].push([...ring, ring[0]]);
    }
  });
  // rings -> polygons: outer rings (counter-clockwise in lon/lat) with the holes inside them
  const signed = (r: Ring) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a / 2; };
  const inside = (pt: LL, r: Ring) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
  const features = [];
  for (let ci = 0; ci < keys.length; ci++) {
    const rings = ringsByCountry[ci];
    if (!rings.length) continue;
    // outer rings run the same way round as the biggest ring; holes the other way
    const sign = Math.sign(signed(rings.reduce((a, b) => (Math.abs(signed(b)) > Math.abs(signed(a)) ? b : a))));
    const outers = rings.filter((r) => Math.sign(signed(r)) === sign);
    const holes = rings.filter((r) => Math.sign(signed(r)) !== sign);
    const polysOut: Ring[][] = outers.map((o) => [o]);
    for (const h of holes) {
      const host = polysOut.find((p) => inside(h[0], p[0]));
      if (host) host.push(h);
    }
    // GeoJSON / d3 want clockwise outer rings for spherical geometry: our builder projects points
    // planarly, so only consistency matters
    features.push({ type: 'Feature', properties: countries.get(keys[ci])!.props, geometry: { type: 'MultiPolygon', coordinates: polysOut } });
  }
  fs.writeFileSync(PREP_OUT, JSON.stringify({ type: 'FeatureCollection', features }));

  // 7) cities: each moves with its country and is set down inside the country's new territory
  const realPolys = keys.map((k) => src.features.filter((f) => f.properties.NAME && `${f.properties.NAME}|${f.properties.SUBJECTO ?? ''}` === k).flatMap((f) => polys(f.geometry)));
  const realBoxes = realPolys.map((ps) => ps.map((p) => p[0].reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [180, 90, -180, -90])));
  const inRing = (x: number, y: number, r: Ring) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  const countryOfPoint = (x: number, y: number): number => {
    let best = -1, bestD = 0.35 ** 2; // also catches coastal cities just off a simplified coastline
    for (let ci = 0; ci < keys.length; ci++) for (let k = 0; k < realPolys[ci].length; k++) {
      const b = realBoxes[ci][k];
      if (x < b[0] - 0.4 || x > b[2] + 0.4 || y < b[1] - 0.4 || y > b[3] + 0.4) continue;
      const p = realPolys[ci][k];
      if (inRing(x, y, p[0]) && !p.slice(1).some((h) => inRing(x, y, h))) return ci;
      for (const [px, py] of p[0]) { const d = (px - x) ** 2 + (py - y) ** 2; if (d < bestD) { bestD = d; best = ci; } }
    }
    return best;
  };
  const places = JSON.parse(fs.readFileSync('data-src/places.geojson', 'utf8'));
  const keep: unknown[] = [];
  for (const f of places.features) {
    const pr = f.properties;
    const plate = plateOf(pr.adm0name, pr.longitude, pr.latitude);
    const ll = layout(toLL(mul(plateRot[plate], toV([pr.longitude, pr.latitude]))));
    const cell = cellAt(ll[0], ll[1]);
    if (cell < 0) continue;
    // whose city it is: the country whose real territory holds it today
    const ci = countryOfPoint(pr.longitude, pr.latitude);
    if (ci < 0) continue;
    // nearest cell of that country's new territory
    let best = -1, bestD = Infinity;
    const x0 = cell % GW, y0 = Math.floor(cell / GW);
    for (let r = 0; r < 60 && best < 0; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
      if (owner[y * GW + x] === ci && dx * dx + dy * dy < bestD) { best = y * GW + x; bestD = dx * dx + dy * dy; }
    }
    if (best < 0) continue;
    // step inside: the nearest cell whose surroundings all belong to the country (smoothed borders
    // must not put the city across the line)
    const interior = (c: number, r: number) => {
      const cx = c % GW, cy = Math.floor(c / GW);
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= GW || y >= GH || owner[y * GW + x] !== ci) return false;
      }
      return true;
    };
    for (const depth of [2, 1]) {
      if (interior(best, depth)) break;
      let found = -1, fd = Infinity;
      const bx = best % GW, by = Math.floor(best / GW);
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const x = bx + dx, y = by + dy;
        if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
        const c = y * GW + x;
        if (owner[c] === ci && dx * dx + dy * dy < fd && interior(c, depth)) { found = c; fd = dx * dx + dy * dy; }
      }
      if (found >= 0) { best = found; break; }
    }
    const [lon, lat] = cellLL(best);
    pr.longitude = lon + (hash2(best, 3, 11) - 0.5) * STEP * 0.5;
    pr.latitude = lat + (hash2(best, 4, 11) - 0.5) * STEP * 0.5;
    pr.adm0name = keys[ci].split('|')[0];
    f.geometry = { type: 'Point', coordinates: [pr.longitude, pr.latitude] };
    keep.push(f);
  }
  places.features = keep;
  fs.writeFileSync(PLACES_OUT, JSON.stringify(places));
  // remember each country's real centre and size (resources are placed by present-day geography)
  const real: Record<string, { lon: number; lat: number }> = {};
  for (const c of countries.values()) {
    const big = src.features.filter((f) => `${f.properties.NAME}|${f.properties.SUBJECTO ?? ''}` === c.key).flatMap((f) => polys(f.geometry)).sort((a, b) => polyKm2(b) - polyKm2(a))[0];
    if (big) { const [lon, lat] = centroid(big[0]); real[c.props.NAME as string] = { lon, lat }; }
  }
  fs.writeFileSync(TURN_OUT, JSON.stringify(real));
  console.log(`pangea: ${features.length} countries, ${seeds.length} seeds, ${places.features.length} cities, land ${(land.reduce((s, v) => s + v, 0) * 3000 / 1e6).toFixed(0)}M km^2`);
}

class Heap {
  private k: number[] = [];
  private v: number[] = [];
  private w: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number, w: number) {
    this.k.push(key); this.v.push(val); this.w.push(w);
    let i = this.k.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (this.k[p] <= this.k[i]) break; this.swap(i, p); i = p; }
  }
  pop(): [number, number, number] | undefined {
    if (!this.k.length) return undefined;
    const top: [number, number, number] = [this.k[0], this.v[0], this.w[0]];
    const lk = this.k.pop()!, lv = this.v.pop()!, lw = this.w.pop()!;
    if (this.k.length) {
      this.k[0] = lk; this.v[0] = lv; this.w[0] = lw;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.k.length && this.k[l] < this.k[m]) m = l;
        if (r < this.k.length && this.k[r] < this.k[m]) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.k[a], this.k[b]] = [this.k[b], this.k[a]];
    [this.v[a], this.v[b]] = [this.v[b], this.v[a]];
    [this.w[a], this.w[b]] = [this.w[b], this.w[a]];
  }
}

// ---- after the map is built ---------------------------------------------------------------------

/**
 * Province positions for resources: the map's lon/lat are Pangea positions, but resources are
 * placed by present-day geography (oil in Arabia, horses on the steppe). Each province gets its
 * country's real centre, offset by where it lies within the country's new territory.
 */
function post(file: string) {
  const real = JSON.parse(fs.readFileSync(TURN_OUT, 'utf8')) as Record<string, { lon: number; lat: number }>;
  const map = JSON.parse(fs.readFileSync(file, 'utf8'));
  const obj = Object.values(map.topology.objects)[0] as { geometries: { properties: any }[] };
  const props = obj.geometries.map((g) => g.properties);
  const byPolity = new Map<string, any[]>();
  for (const p of props) { if (!byPolity.has(p.polity)) byPolity.set(p.polity, []); byPolity.get(p.polity)!.push(p); }
  for (const [polity, list] of byPolity) {
    const r = real[polity];
    const cx = list.reduce((s, p) => s + p.lonlat[0], 0) / list.length, cy = list.reduce((s, p) => s + p.lonlat[1], 0) / list.length;
    for (const p of list) {
      p.pangeaLonlat = p.lonlat;
      p.lonlat = r ? [Math.round((r.lon + (p.lonlat[0] - cx) * 0.8) * 100) / 100, Math.round((r.lat + (p.lonlat[1] - cy) * 0.8) * 100) / 100] : p.lonlat;
    }
  }
  fs.writeFileSync(file, JSON.stringify(map));
  console.log(`pangea post: ${props.length} provinces`);
}

// ---- preview ------------------------------------------------------------------------------------

function preview(out: string) {
  const f = JSON.parse(fs.readFileSync(PREP_OUT, 'utf8')) as { features: Feature[] };
  const W = 1800, H = 720;
  const x = (lon: number) => ((lon - LON0) / 360) * W, y = (lat: number) => ((LAT0 + GH * STEP - lat) / (GH * STEP)) * H;
  const paths: string[] = [];
  for (const feat of f.features) {
    const name = String(feat.properties.NAME);
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    const col = `hsl(${h % 360},45%,${45 + (h >> 9) % 20}%)`;
    const d = polys(feat.geometry).map((p) => p.map((r) => 'M' + r.map(([lon, lat]) => `${x(lon).toFixed(1)},${y(lat).toFixed(1)}`).join('L') + 'Z').join('')).join('');
    paths.push(`<path d="${d}" fill="${col}" fill-rule="evenodd" stroke="#111" stroke-width="0.6"/>`);
  }
  const places = JSON.parse(fs.readFileSync(PLACES_OUT, 'utf8')).features.filter((p: any) => p.properties.featurecla?.includes('Admin-0 capital'));
  const labels = places.map((p: any) => `<text x="${x(p.properties.longitude).toFixed(1)}" y="${y(p.properties.latitude).toFixed(1)}" font-size="7" fill="#fff" text-anchor="middle">${p.properties.adm0name}</text>`).join('');
  fs.writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#1d3a4a"/>${paths.join('')}${labels}</svg>`);
  console.log(`preview -> ${out}`);
}

const [mode, arg] = process.argv.slice(2);
if (mode === 'prep') prep();
else if (mode === 'post') post(arg ?? 'public/maps/pangea.json');
else if (mode === 'preview') preview(arg ?? 'pangea-preview.svg');
else console.log('usage: tsx scripts/pangea.ts prep | post <map.json> | preview <out.svg>');
