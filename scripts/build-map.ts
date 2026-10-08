/**
 * Offline map builder.
 *
 * Takes a historical GeoJSON (one feature per polity, e.g. aourednik/historical-basemaps)
 * and produces a TopoJSON of game provinces:
 *   - projects everything with a Miller projection into a flat world space (WORLD_W units wide)
 *   - splits each polity into provinces with a Voronoi diagram seeded by its largest cities
 *     (Natural Earth populated places), so provinces carry real names
 *   - stores per-province metadata (polity, subject, label point, lon/lat, neighbors)
 *
 * The output is scenario-agnostic: scenarios decide province ownership from `polity`/`subject`/lon/lat.
 *
 * Usage: tsx scripts/build-map.ts --in data-src/world_1938.geojson --out public/maps/world_1938.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { geoAlbersUsa, geoPath, type GeoProjection } from 'd3-geo';
import { geoMiller } from 'd3-geo-projection';
import { Delaunay } from 'd3-delaunay';
import polygonClipping from 'polygon-clipping';
import polylabel from 'polylabel';
import { topology } from 'topojson-server';
import { neighbors } from 'topojson-client';

type Pt = [number, number];
type Ring = Pt[];
type Poly = Ring[]; // [outer, ...holes]
type MultiPoly = Poly[];

const args = Object.fromEntries(
  process.argv.slice(2).reduce<string[][]>((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
const IN = args.in ?? 'data-src/world_1938.geojson';
const OUT = args.out ?? 'public/maps/world_1938.json';
const PLACES = args.places ?? 'data-src/places.geojson';
/** 'miller' (world maps) or 'albersUsa' (USA mode, fitted to the data). */
const PROJECTION = args.projection ?? 'miller';
/** Optional Natural Earth land file drawn under the provinces (unclaimed land in ancient maps). */
const LAND = args.land;
const NAME_FIELD = args['name-field'] ?? 'NAME';
const SUBJECT_FIELD = args['subject-field'] ?? 'SUBJECTO';
const SHORT_FIELD = args['short-field'] ?? 'ABBREVN';
/**
 * Ancient maps leave much land outside any polity. With --tribes, that land (Natural Earth land minus
 * every polity, plus big unnamed features) becomes polities named "Tribes" with unique subjects
 * ("Tribes#3"); scenarios name them by region.
 */
const TRIBES = args.tribes === 'true';
/** Roughen straight borders between polities: for coarse ancient source maps, not for modern borders that really are straight. */
const NATURAL_BORDERS = (args['natural-borders'] ?? (TRIBES ? 'true' : 'false')) === 'true';

// ---- tuning -----------------------------------------------------------------------------------
const WORLD_W = 4096;
const LAT_TOP = 84;
const LAT_BOTTOM = -58;
const DENSITY = Number(args.density ?? 0.27); // provinces = DENSITY * area^EXP
const EXP = 0.45;
const MAX_PROVINCES_PER_POLITY = Number(args['max-per-polity'] ?? 90);
/** Unnamed fragments bigger than this are unclaimed land, not attached to a neighbour. */
const ORPHAN_MAX_AREA = Number(args['orphan-max-area'] ?? 400);
const SIGNIFICANT_PART_AREA = 25; // units^2 (~2,500 km^2 at equator); smaller parts attach to neighbours
const ATTACH_MAX_DIST = 140; // tiny islands further than this from any seed become their own province

// ---- projection -------------------------------------------------------------------------------
const srcRaw = JSON.parse(fs.readFileSync(IN, 'utf8'));
let projection: GeoProjection;
let yTop: number;
let WORLD_H: number;
if (PROJECTION === 'albersUsa') {
  const pad = 40;
  projection = geoAlbersUsa().fitWidth(WORLD_W - pad * 2, srcRaw) as unknown as GeoProjection;
  const [[x0, y0], [, y1]] = geoPath(projection).bounds(srcRaw);
  projection.translate([projection.translate()[0] - x0 + pad, projection.translate()[1]]);
  yTop = y0 - pad;
  WORLD_H = y1 - y0 + pad * 2;
} else {
  projection = geoMiller().scale(WORLD_W / (2 * Math.PI)).translate([WORLD_W / 2, 0]);
  yTop = projection([0, LAT_TOP])![1];
  WORLD_H = projection([0, LAT_BOTTOM])![1] - yTop;
}
/** Projected point, or null if outside the projection (Albers USA only covers the US). */
const projectOrNull = (lon: number, lat: number): Pt | null => {
  const p = projection([lon, Math.max(-85, Math.min(85, lat))]);
  return p ? [p[0], p[1] - yTop] : null;
};
const project = (lon: number, lat: number): Pt => projectOrNull(lon, lat) ?? [NaN, NaN];
const unproject = (x: number, y: number): Pt => projection.invert!([x, y + yTop]) ?? [0, 0];

// ---- geometry helpers -------------------------------------------------------------------------
const ringArea = (r: Ring) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(a / 2);
};
const polyArea = (p: Poly) => ringArea(p[0]) - p.slice(1).reduce((s, h) => s + ringArea(h), 0);
const mpArea = (mp: MultiPoly) => mp.reduce((s, p) => s + polyArea(p), 0);
const pointInRing = (pt: Pt, r: Ring) => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const pointInPoly = (pt: Pt, p: Poly) => pointInRing(pt, p[0]) && !p.slice(1).some((h) => pointInRing(pt, h));
const bbox = (rings: Ring[]) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
};
const dist2 = (a: Pt, b: Pt) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

// ---- natural province borders --------------------------------------------------------------------
// Voronoi cells meet along straight lines, which look blocky where provinces are big (deserts,
// steppe, tribal lands). Each cell edge is replaced by a wiggly line made by midpoint displacement.
// The wiggle depends only on the edge's two end points (in a fixed order), so the two cells that
// share an edge get exactly the same line and no gaps or overlaps appear.
const ROUGH_MIN = 2.6; // stop subdividing below this length (map units)
const ROUGH_SKIP = 6; // edges shorter than this stay straight
const ROUGH_AMP = 0.18; // displacement as a share of the segment length

function hash01(a: Pt, b: Pt): number {
  const s = `${a[0].toFixed(3)},${a[1].toFixed(3)},${b[0].toFixed(3)},${b[1].toFixed(3)}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}
function jagged(a: Pt, b: Pt, out: Pt[]) {
  const len = Math.sqrt(dist2(a, b));
  if (len < ROUGH_MIN) return;
  const r = hash01(a, b) - 0.5;
  const mid: Pt = [(a[0] + b[0]) / 2 - ((b[1] - a[1]) / len) * r * 2 * ROUGH_AMP * len, (a[1] + b[1]) / 2 + ((b[0] - a[0]) / len) * r * 2 * ROUGH_AMP * len];
  jagged(a, mid, out);
  out.push(mid);
  jagged(mid, b, out);
}
/** The points strictly between a and b along the wiggly version of the edge. */
function roughEdge(a: Pt, b: Pt): Pt[] {
  if (dist2(a, b) < ROUGH_SKIP ** 2) return []; // short edges are not noticeable: keep files small
  const forward = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]);
  const [p, q] = forward ? [a, b] : [b, a];
  const out: Pt[] = [];
  jagged(p, q, out);
  return forward ? out : out.reverse();
}
function roughCell(cell: Pt[]): Pt[] {
  const ring = cell.length > 1 && cell[0][0] === cell[cell.length - 1][0] && cell[0][1] === cell[cell.length - 1][1] ? cell.slice(0, -1) : cell;
  const out: Pt[] = [];
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    out.push(a, ...roughEdge(a, b));
  });
  out.push(out[0]);
  return out;
}
const labelPoint = (p: Poly): Pt => {
  const l = polylabel(p as number[][][], 0.5);
  return [l[0], l[1]];
};
const round2 = (v: number) => Math.round(v * 100) / 100;

function cleanRing(r: Ring): Ring | null {
  const out: Ring = [];
  for (const pt of r) {
    if (!Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) continue;
    const q: Pt = [round2(pt[0]), round2(pt[1])];
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out.length >= 3 ? out : null;
}

// ---- load sources -----------------------------------------------------------------------------
interface SrcFeature {
  properties: Record<string, string | null>;
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: any };
}
const src = srcRaw as { features: SrcFeature[] };
const placesSrc = JSON.parse(fs.readFileSync(PLACES, 'utf8')) as {
  features: { properties: { name: string; pop_max: number; featurecla: string; longitude: number; latitude: number } }[];
};
const places = placesSrc.features
  .map((f) => ({
    name: f.properties.name?.replace(/\s+/g, ' ').trim(),
    pop: f.properties.pop_max ?? 0,
    capital: /Admin-0 capital/.test(f.properties.featurecla ?? ''),
    pt: project(f.properties.longitude, f.properties.latitude),
  }))
  .filter((p) => p.name && Number.isFinite(p.pt[0]));

function projectGeometry(g: SrcFeature['geometry']): MultiPoly {
  const polys: number[][][][] = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const out: MultiPoly = [];
  for (const poly of polys) {
    const rings = poly.map((r) => cleanRing(r.map(([lon, lat]) => project(lon, lat)))).filter(Boolean) as Ring[];
    if (rings.length && ringArea(rings[0]) > 0.01) out.push(rings);
  }
  return out;
}

// Group features into polities. Unnamed fragments (small islands) join the nearest named polity.
interface Polity { key: string; name: string; short: string; subject: string; geom: MultiPoly }
const polities = new Map<string, Polity>();
const orphans: MultiPoly[] = [];
for (const f of src.features) {
  const geom = projectGeometry(f.geometry);
  if (!geom.length) continue;
  const bb = bbox(geom.map((p) => p[0]));
  if (bb.y0 > WORLD_H - 1) continue; // fully south of the map (Antarctica)
  const NAME = f.properties[NAME_FIELD] ?? null;
  const ABBREVN = f.properties[SHORT_FIELD] ?? null;
  const SUBJECTO = f.properties[SUBJECT_FIELD] ?? null;
  if (!NAME) { orphans.push(geom); continue; }
  const subject = SUBJECTO ?? NAME;
  const key = `${NAME}|${subject}`;
  const existing = polities.get(key);
  if (existing) existing.geom.push(...geom);
  else polities.set(key, { key, name: NAME, short: ABBREVN ?? NAME, subject, geom });
}
const polityList = [...polities.values()];
/** True if a city lies inside no polity at all: only such cities (ports on coarse coastlines) may snap to a coast. */
const seaCache = new Map<object, boolean>();
const atSea = (c: { pt: Pt }) => {
  let v = seaCache.get(c);
  if (v === undefined) {
    v = !polityList.some((p) => p.geom.some((poly) => {
      const bb = bbox([poly[0]]);
      return c.pt[0] >= bb.x0 && c.pt[0] <= bb.x1 && c.pt[1] >= bb.y0 && c.pt[1] <= bb.y1 && pointInPoly(c.pt, poly);
    }));
    seaCache.set(c, v);
  }
  return v;
};
let unclaimed = 0;
const tribalParts: Poly[] = [];
for (const geom of orphans) {
  // big unnamed areas (e.g. lands outside any state in ancient maps) stay unclaimed, or become tribes
  if (mpArea(geom) > ORPHAN_MAX_AREA) {
    unclaimed++;
    if (TRIBES) tribalParts.push(...geom);
    continue;
  }
  const c = labelPoint(geom[0]);
  let best: Polity | null = null;
  let bestD = Infinity;
  for (const p of polityList) for (const poly of p.geom) for (const [x, y] of poly[0]) {
    const d = dist2(c, [x, y]);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (best && bestD < 300 ** 2) best.geom.push(...geom);
}

// ---- province generation ----------------------------------------------------------------------
interface Province { name: string; polity: string; subject: string; seed: Pt; city: boolean; pop: number; geom: MultiPoly }
const provinces: Province[] = [];

/** Cities this close (map units) to a coastline count as inside it: coarse coastlines leave ports in the sea. */
const COAST_SNAP = 2.5;
function distToRing(pt: Pt, r: Ring): number {
  let best = Infinity;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [ax, ay] = r[j], [bx, by] = r[i];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((pt[0] - ax) * dx + (pt[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(pt[0] - (ax + t * dx), pt[1] - (ay + t * dy)));
  }
  return best;
}

const COMPASS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];

/** Name for a province without a city: "North Libya", or "Central Libya" near the polity's middle. */
function regionName(pt: Pt, polity: Polity, center: Pt, spacing: number) {
  if (dist2(pt, center) < 1) return polity.short;
  if (dist2(pt, center) < (spacing * 0.6) ** 2) return polity.short === polity.name ? `Central ${polity.short}` : polity.short;
  const ang = Math.atan2(pt[1] - center[1], pt[0] - center[0]);
  return `${COMPASS[(Math.round((-ang / (Math.PI * 2)) * 8) + 8) % 8]} ${polity.short}`;
}

function pickSeeds(part: Poly, k: number, polity: Polity, polityCenter: Pt) {
  const area = polyArea(part);
  const spacing = 0.75 * Math.sqrt(area / k);
  const bb = bbox([part[0]]);
  const cities = places
    .filter((c) => c.pt[0] >= bb.x0 - COAST_SNAP && c.pt[0] <= bb.x1 + COAST_SNAP && c.pt[1] >= bb.y0 - COAST_SNAP && c.pt[1] <= bb.y1 + COAST_SNAP &&
      (pointInPoly(c.pt, part) || (atSea(c) && distToRing(c.pt, part[0]) < COAST_SNAP)))
    .sort((a, b) => Number(b.capital) - Number(a.capital) || b.pop - a.pop);

  const seeds: { pt: Pt; name: string; city: boolean; pop: number }[] = [];
  const farEnough = (pt: Pt, d: number) => seeds.every((s) => dist2(s.pt, pt) >= d * d);
  for (const c of cities) {
    if (seeds.length >= k) break;
    if (farEnough(c.pt, spacing)) seeds.push({ pt: c.pt, name: c.name, city: true, pop: c.pop });
  }
  if (!seeds.length && k === 1) {
    const pt = labelPoint(part);
    seeds.push({ pt, name: regionName(pt, polity, polityCenter, spacing), city: false, pop: 0 });
  }
  // Fill remaining seeds with farthest-point sampling over a grid of interior candidates.
  if (seeds.length < k) {
    const step = Math.max(0.5, Math.sqrt(area / k) / 4);
    const cand: Pt[] = [];
    for (let x = bb.x0 + step / 2; x < bb.x1; x += step)
      for (let y = bb.y0 + step / 2; y < bb.y1; y += step) if (pointInPoly([x, y], part)) cand.push([x, y]);
    if (!cand.length) cand.push(labelPoint(part));
    while (seeds.length < k && cand.length) {
      let bestI = 0, bestD = -1;
      for (let i = 0; i < cand.length; i++) {
        let d = Infinity;
        for (const s of seeds) d = Math.min(d, dist2(s.pt, cand[i]));
        if (d > bestD) { bestD = d; bestI = i; }
      }
      const pt = cand.splice(bestI, 1)[0];
      if (seeds.length && bestD < (spacing * 0.5) ** 2) break;
      // Snap to a nearby smaller city if there is one, so the province still gets a real name.
      const near = cities.find((c) => dist2(c.pt, pt) < (spacing * 0.45) ** 2 && farEnough(c.pt, spacing * 0.6));
      if (near) seeds.push({ pt: near.pt, name: near.name, city: true, pop: near.pop });
      else seeds.push({ pt, name: regionName(pt, polity, polityCenter, spacing), city: false, pop: 0 });
    }
  }
  return seeds;
}

/** Projected area corrected for Miller's high-latitude inflation (~true area, in equator units^2). */
const trueArea = (p: Poly) => {
  if (PROJECTION !== 'miller') return polyArea(p);
  const lat = (unproject(...labelPoint(p))[1] * Math.PI) / 180;
  return polyArea(p) * Math.cos(lat) * Math.cos(0.8 * lat);
};

// Old source maps draw borders between polities as long straight lines. Roughen the edges two
// polities share vertex for vertex (both sides get the same wiggle; coasts are never shared, so
// they stay as they are).
if (NATURAL_BORDERS) {
  const owners = new Map<string, Set<number>>();
  const key = (p: Pt) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
  const all: Poly[][] = [...polityList.map((p) => p.geom), ...tribalParts.map((p) => [p])];
  all.forEach((mp, i) => { for (const poly of mp) for (const ring of poly) for (const pt of ring) {
    let s = owners.get(key(pt));
    if (!s) owners.set(key(pt), (s = new Set()));
    s.add(i);
  } });
  const shared = (a: Pt, b: Pt) => {
    const sa = owners.get(key(a)), sb = owners.get(key(b));
    if (!sa || !sb || sa.size < 2 || sb.size < 2) return false;
    let common = 0;
    for (const x of sa) if (sb.has(x)) common++;
    return common >= 2; // both ends belong to the same two (or more) polities
  };
  let roughened = 0;
  const roughRing = (ring: Ring): Ring => {
    const out: Pt[] = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i], b = ring[i + 1];
      out.push(a);
      if (shared(a, b)) { const mid = roughEdge(a, b); if (mid.length) roughened++; out.push(...mid); }
    }
    out.push(ring[ring.length - 1]);
    return out;
  };
  for (const p of polityList) p.geom = p.geom.map((poly) => poly.map(roughRing));
  for (let i = 0; i < tribalParts.length; i++) tribalParts[i] = tribalParts[i].map(roughRing);
  console.log(`natural borders: ${roughened} shared polity edges roughened`);
}

if (TRIBES && LAND) {
  const started = Date.now();
  const landSrc = JSON.parse(fs.readFileSync(LAND, 'utf8')) as { features: SrcFeature[] };
  const landPolys: Poly[] = [];
  for (const lf of landSrc.features) for (const p of projectGeometry(lf.geometry)) if (bbox([p[0]]).y0 < WORLD_H - 1 && polyArea(p) > 4) landPolys.push(p);
  const claimed = [...polityList.flatMap((p) => p.geom), ...tribalParts].map((p) => ({ p, bb: bbox([p[0]]) }));
  const round1 = (mp: Poly[]) => mp.map((p) => p.map((r) => r.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as Pt)));
  const perimeter = (r: Ring) => r.reduce((x, p, i) => x + Math.sqrt(dist2(p, r[(i + 1) % r.length])), 0);
  let failed = 0;
  const found: Poly[] = [];
  for (const land of landPolys) {
    const lb = bbox([land[0]]);
    const cands = claimed.filter(({ bb }) => bb.x0 <= lb.x1 && bb.x1 >= lb.x0 && bb.y0 <= lb.y1 && bb.y1 >= lb.y0).map((c) => c.p);
    let free: MultiPoly | null = null;
    for (const attempt of [0, 1]) {
      try {
        const subj = attempt ? round1([land]) : [land];
        const clip = attempt ? round1(cands) : cands;
        free = (cands.length ? polygonClipping.difference(subj as any, ...(clip.map((c) => [c]) as any)) : [land]) as MultiPoly;
        break;
      } catch { /* retry with rounded coordinates */ }
    }
    if (!free) { failed++; continue; }
    for (const raw of free) {
      const p = raw.map(cleanRing).filter(Boolean) as Ring[];
      if (!p.length) continue;
      // keep real territories, drop slivers where the two datasets' coastlines disagree
      if (trueArea(p) < 60 || polyArea(p) / perimeter(p[0]) < 2.2) continue;
      found.push(p);
    }
  }
  tribalParts.push(...found);
  tribalParts.forEach((p, k) => {
    polityList.push({ key: `Tribes#${k}`, name: 'Tribes', short: 'Tribes', subject: `Tribes#${k}`, geom: [p] });
  });
  console.log(`tribal lands: ${tribalParts.length} regions (${found.length} from uncovered land, ${failed} land polygons skipped) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

let failures = 0;
for (const polity of polityList) {
  const total = polity.geom.reduce((s, p) => s + trueArea(p), 0);
  const parts = [...polity.geom].sort((a, b) => trueArea(b) - trueArea(a));
  const significant = parts.filter((p, i) => i === 0 || trueArea(p) >= SIGNIFICANT_PART_AREA);
  const tiny = parts.filter((p) => !significant.includes(p));
  const nTotal = Math.min(MAX_PROVINCES_PER_POLITY, Math.max(1, Math.round(DENSITY * total ** EXP)));
  const polityCenter = labelPoint(parts[0]);
  const first = provinces.length;

  for (const part of significant) {
    const k = Math.max(1, Math.round((nTotal * trueArea(part)) / total));
    const seeds = pickSeeds(part, k, polity, polityCenter);
    const bb = bbox([part[0]]);
    const pad = 10;
    const cells: (Pt[] | null)[] = seeds.length === 1
      ? [[[bb.x0 - pad, bb.y0 - pad], [bb.x1 + pad, bb.y0 - pad], [bb.x1 + pad, bb.y1 + pad], [bb.x0 - pad, bb.y1 + pad]]]
      : (() => {
          const v = Delaunay.from(seeds.map((s) => s.pt)).voronoi([bb.x0 - pad, bb.y0 - pad, bb.x1 + pad, bb.y1 + pad]);
          return seeds.map((_, i) => {
            const cell = v.cellPolygon(i) as Pt[] | null;
            return cell ? roughCell(cell) : null;
          });
        })();
    seeds.forEach((s, i) => {
      const cell = cells[i];
      if (!cell) return;
      let geom: MultiPoly;
      try {
        geom = seeds.length === 1 ? [part] : (polygonClipping.intersection(part as any, [cell] as any) as MultiPoly);
      } catch {
        failures++;
        return;
      }
      geom = geom.map((p) => p.map(cleanRing).filter(Boolean) as Ring[]).filter((p) => p.length && polyArea(p) > 0.05);
      if (!geom.length) return;
      provinces.push({ name: s.name, polity: polity.name, subject: polity.subject, seed: s.pt, city: s.city, pop: s.pop, geom });
    });
  }

  // Tiny parts (small islands) join the closest province of the same polity, or found their own.
  for (const part of tiny) {
    const c = labelPoint(part);
    let best = -1, bestD = Infinity;
    for (let i = first; i < provinces.length; i++) {
      const d = dist2(provinces[i].seed, c);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0 && bestD < ATTACH_MAX_DIST ** 2) provinces[best].geom.push(part);
    else {
      const city = places.find((p) => dist2(p.pt, c) < 4);
      provinces.push({
        name: city?.name ?? `${polity.short} Isles`, polity: polity.name, subject: polity.subject,
        seed: c, city: !!city, pop: city?.pop ?? 0, geom: [part],
      });
    }
  }
}

const roman = (n: number) =>
  [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']].reduce<[string, number]>(
    ([out, rest], [v, r]) => { while (rest >= (v as number)) { out += r; rest -= v as number; } return [out, rest]; },
    ['', n],
  )[0];

// De-duplicate names inside a polity ("North Libya", "North Libya II").
const seen = new Map<string, number>();
for (const p of provinces) {
  const k = `${p.polity}|${p.name}`;
  const n = (seen.get(k) ?? 0) + 1;
  seen.set(k, n);
  if (n > 1) p.name = `${p.name} ${roman(n)}`;
}

// ---- topology ---------------------------------------------------------------------------------
const fc = {
  type: 'FeatureCollection' as const,
  features: provinces.map((p, i) => {
    const largest = [...p.geom].sort((a, b) => polyArea(b) - polyArea(a))[0];
    const anchor = p.city && pointInPoly(p.seed, largest) ? p.seed : labelPoint(largest);
    const ll = unproject(anchor[0], anchor[1]);
    return {
      type: 'Feature' as const,
      id: `p${i}`,
      properties: {
        name: p.name,
        polity: p.polity,
        subject: p.subject,
        city: p.city,
        pop: p.pop,
        area: round2(mpArea(p.geom)),
        label: [round2(anchor[0]), round2(anchor[1])],
        lonlat: [round2(ll[0]), round2(ll[1])],
      },
      geometry: { type: 'MultiPolygon' as const, coordinates: p.geom },
    };
  }),
};

const topo = topology({ provinces: fc } as any, 1e5) as any;
const geoms = topo.objects.provinces.geometries;

// Boundary sample grid: lets us find "what's on the other side" of a border even where the
// source data's polities don't share exact vertices.
const CELL = 1, EPS2 = 0.8 ** 2;
const grid = new Map<string, { i: number; pt: Pt }[]>();
provinces.forEach((p, i) => {
  for (const poly of p.geom) for (const r of poly) for (let a = 0; a < r.length; a++) {
    const s = r[a], e = r[(a + 1) % r.length];
    const n = Math.max(1, Math.ceil(Math.sqrt(dist2(s, e)) / 0.75));
    for (let t = 0; t < n; t++) {
      const pt: Pt = [s[0] + ((e[0] - s[0]) * t) / n, s[1] + ((e[1] - s[1]) * t) / n];
      const k = `${Math.floor(pt[0] / CELL)},${Math.floor(pt[1] / CELL)}`;
      let c = grid.get(k);
      if (!c) grid.set(k, (c = []));
      c.push({ i, pt });
    }
  }
});
/** Provinces (other than `self`) whose boundary passes within EPS of `pt`, nearest first. */
function nearbyOthers(pt: Pt, self: number): number[] {
  const gx = Math.floor(pt[0] / CELL), gy = Math.floor(pt[1] / CELL);
  const best = new Map<number, number>();
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
    for (const o of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
      if (o.i === self) continue;
      const d = dist2(o.pt, pt);
      if (d < EPS2 && d < (best.get(o.i) ?? Infinity)) best.set(o.i, d);
    }
  return [...best.entries()].sort((a, b) => a[1] - b[1]).map(([i]) => i);
}

// ---- adjacency: shared arcs + boundary proximity ----------------------------------------------
const nbSets = neighbors(geoms).map((n) => new Set(n));
provinces.forEach((p, i) => {
  const hits = new Map<number, number>();
  for (const poly of p.geom) for (const r of poly) for (const pt of r)
    for (const j of nearbyOthers(pt, i)) hits.set(j, (hits.get(j) ?? 0) + 1);
  for (const [j, n] of hits) if (n >= 2) { nbSets[i].add(j); nbSets[j].add(i); }
});
const nb = nbSets.map((s) => [...s].sort((a, b) => a - b));
geoms.forEach((g: any, i: number) => (g.properties.neighbors = nb[i].map((j) => geoms[j].id)));

// ---- border segments --------------------------------------------------------------------------
// Each topology arc is decoded and tagged with the provinces on both sides (b = -1 for coast).
// Arcs used by a single province are split wherever the "other side" changes along their length.
const { scale, translate } = topo.transform;
const decoded: Pt[][] = topo.arcs.map((arc: number[][]) => {
  let x = 0, y = 0;
  return arc.map(([dx, dy]) => {
    x += dx; y += dy;
    return [round2(x * scale[0] + translate[0]), round2(y * scale[1] + translate[1])] as Pt;
  });
});
const arcUsers: number[][] = decoded.map(() => []);
geoms.forEach((g: any, i: number) => {
  const walk = (a: any): void => (Array.isArray(a) ? a.forEach(walk) : void arcUsers[a < 0 ? ~a : a].push(i));
  walk(g.arcs);
});
const borders: { a: number; b: number; c: number[] }[] = [];
decoded.forEach((pts, k) => {
  const users = [...new Set(arcUsers[k])];
  if (!users.length) return;
  if (users.length >= 2) { borders.push({ a: users[0], b: users[1], c: pts.flat() }); return; }
  const a = users[0];
  // classify each segment by the province across it
  const side = pts.slice(1).map((p, s) => nearbyOthers([(p[0] + pts[s][0]) / 2, (p[1] + pts[s][1]) / 2], a)[0] ?? -1);
  // smooth out single-segment blips
  for (let s = 1; s < side.length - 1; s++) if (side[s - 1] === side[s + 1] && side[s] !== side[s - 1]) side[s] = side[s - 1];
  let start = 0;
  for (let s = 1; s <= side.length; s++) {
    if (s < side.length && side[s] === side[start]) continue;
    const b = side[start];
    // a gap-border is reported from both provinces; keep one copy (the coast case always kept)
    if (b === -1 || a < b) borders.push({ a, b, c: pts.slice(start, s + 1).flat() });
    start = s;
  }
});

topo.meta = { width: round2(WORLD_W), height: round2(WORLD_H), projection: PROJECTION, latTop: LAT_TOP, latBottom: LAT_BOTTOM, source: path.basename(IN) };

// Background land (flat rings), lightly decimated: shows unclaimed land under the provinces.
let land: number[][][] = [];
if (LAND) {
  const lf = JSON.parse(fs.readFileSync(LAND, 'utf8')) as { features: SrcFeature[] };
  for (const f of lf.features) for (const poly of projectGeometry(f.geometry)) {
    if (bbox([poly[0]]).y0 > WORLD_H - 1 || polyArea(poly) < 3) continue;
    land.push(poly.map((r) => {
      const flat: number[] = [];
      let last: Pt | null = null;
      for (const p of r) if (!last || dist2(p, last) > 0.6) { flat.push(Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10); last = p; }
      return flat;
    }).filter((r) => r.length >= 6));
  }
  land = land.filter((p) => p.length);
}
const out = { meta: topo.meta, topology: topo, borders, land };

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
const isolated = nb.filter((n) => n.length === 0).length;
console.log(
  `polities=${polityList.length} unclaimed=${unclaimed} land=${land.length} provinces=${provinces.length} isolated=${isolated} clipFailures=${failures} borders=${borders.length} ` +
  `size=${(fs.statSync(OUT).size / 1024).toFixed(0)}KB world=${WORLD_W}x${WORLD_H.toFixed(0)} -> ${OUT}`,
);
