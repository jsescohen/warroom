import type { ResourceDef, UnitTypeDef } from './scenario';
import type { ProvinceId } from './types';

/**
 * Static context the rules need but that never changes during a game: the movement graph
 * (land adjacency + sea lanes, with distances) and unit stats. Built once from the map and the
 * scenario; a multiplayer server builds the same thing, so simulation stays deterministic.
 */
export interface Link {
  to: ProvinceId;
  dist: number;
  sea: boolean;
}

export interface WorldProvince {
  id: ProvinceId;
  name: string;
  label: [number, number];
  area: number;
  coastal: boolean;
  /** Population of the province's main city (0 when it has none): how much the province counts. */
  pop: number;
  /** Natural resource the province produces (see ResourceDef), if any. */
  resource?: string;
  links: Link[];
}

export interface World {
  provinces: Record<ProvinceId, WorldProvince>;
  /** Province ids in a stable order (iteration order for the simulation). */
  order: ProvinceId[];
  unitTypes: Record<string, UnitTypeDef>;
  /** The era's resources by id. */
  resources: Record<string, ResourceDef>;
  /** Materials each unit type costs to raise. */
  unitCosts: Record<string, Record<string, number>>;
  /** Materials to develop a province one level. */
  developCost: Record<string, number>;
  /** Missiles, nukes and air defence (null in eras without them). */
  weapons: WeaponsConfig | null;
  /** Fraction of land speed when moving over a sea lane. */
  seaSpeed: number;
}

export interface WorldProvinceInput {
  id: ProvinceId;
  name: string;
  label: [number, number];
  area: number;
  coastal: boolean;
  pop?: number;
  /** [lon, lat], used to place resources. */
  lonlat?: [number, number];
  neighbors: ProvinceId[];
}

const SEA_LINK_MAX = 85; // max label-to-label distance for an ordinary sea lane (map units)
const SEA_LINKS_PER_PROVINCE = 2;
const SHORTCUT_MIN_HOPS = 5; // same-landmass lanes only when the land route is this many hops or longer
const ISLAND_LINK_MAX = 420; // remote islands get one lane to the nearest other landmass within this

/** Deterministic 0..1 roll for a province and a key. */
export function roll(id: string, key: string): number {
  let h = 2166136261;
  const s = `${id}:${key}`;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * Puts the era's resources on the map: every province whose centre lies within a deposit's radius
 * holds it; a deposit no province centre reaches goes to the nearest province. One resource per
 * province (the first listed wins).
 */
export function placeResources(input: { id: ProvinceId; lonlat?: [number, number] }[], resources: ResourceDef[]): Map<ProvinceId, string> {
  const out = new Map<ProvinceId, string>();
  const located = input.filter((p) => p.lonlat);
  const d = (p: { lonlat?: [number, number] }, lon: number, lat: number) => {
    const [x, y] = p.lonlat!;
    const dx = (((x - lon + 540) % 360) - 180) * Math.cos(((y + lat) / 2) * (Math.PI / 180));
    return Math.hypot(dx, y - lat);
  };
  for (const r of resources) {
    for (const [lon, lat, radius] of r.deposits) {
      const inside = located.filter((p) => d(p, lon, lat) <= radius);
      const hits = inside.length ? inside : located.filter((p) => d(p, lon, lat) <= radius * 2.5).sort((a, b) => d(a, lon, lat) - d(b, lon, lat)).slice(0, 1);
      for (const p of hits) if (!out.has(p.id)) out.set(p.id, r.id);
    }
  }
  return out;
}

/** Missiles, nuclear weapons and air defence of an era (null in eras without them). */
export interface WeaponDef {
  name: string;
  /** Money to build one. */
  cost: number;
  materials: Record<string, number>;
  /** Map units from the nearest province of the launching nation. */
  range: number;
  /** ISO date it first becomes available (default: from the start). */
  from?: string;
}
export interface WeaponsConfig {
  missile: (WeaponDef & { damage: number }) | null;
  nuke: WeaponDef | null;
  airDefense: { name: string; materials: Record<string, number>; missileIntercept: number; nukeIntercept: number; strikeReduction: number; radius: number };
}

/** What raising units and developing provinces costs in materials (per era), and its weapons. */
export interface WorldEconomy {
  unitCosts: Record<string, Record<string, number>>;
  developCost: Record<string, number>;
  weapons?: WeaponsConfig | null;
}

export function buildWorld(input: WorldProvinceInput[], unitTypes: UnitTypeDef[], seaSpeed = 0.5, resources: ResourceDef[] = [], economy: WorldEconomy = { unitCosts: {}, developCost: {} }): World {
  const placed = placeResources(input, resources);
  const provinces: Record<ProvinceId, WorldProvince> = {};
  const byId = new Map(input.map((p) => [p.id, p]));
  const dist = (a: WorldProvinceInput, b: WorldProvinceInput) => Math.hypot(a.label[0] - b.label[0], a.label[1] - b.label[1]);
  for (const p of input) {
    provinces[p.id] = {
      id: p.id, name: p.name, label: p.label, area: p.area, coastal: p.coastal, pop: p.pop ?? 0, resource: placed.get(p.id),
      links: p.neighbors.filter((n) => byId.has(n)).map((n) => ({ to: n, dist: round1(dist(p, byId.get(n)!)), sea: false })),
    };
  }
  const addSea = (a: ProvinceId, b: ProvinceId) => {
    if (a === b || provinces[a].links.some((l) => l.to === b)) return;
    const d = round1(dist(byId.get(a)!, byId.get(b)!));
    provinces[a].links.push({ to: b, dist: d, sea: true });
    provinces[b].links.push({ to: a, dist: d, sea: true });
  };

  // Land components (continents / islands).
  const comp = new Map<ProvinceId, number>();
  let nComp = 0;
  for (const p of input) {
    if (comp.has(p.id)) continue;
    const stack = [p.id];
    comp.set(p.id, nComp);
    while (stack.length) for (const n of byId.get(stack.pop()!)!.neighbors) if (byId.has(n) && !comp.has(n)) { comp.set(n, nComp); stack.push(n); }
    nComp++;
  }

  const coastal = input.filter((p) => p.coastal);
  const hopsWithin = (from: ProvinceId, to: ProvinceId, max: number) => {
    let frontier = [from];
    const seen = new Set(frontier);
    for (let d = 1; d <= max; d++) {
      const next: ProvinceId[] = [];
      for (const f of frontier) for (const n of byId.get(f)!.neighbors) {
        if (n === to) return true;
        if (!seen.has(n) && byId.has(n)) { seen.add(n); next.push(n); }
      }
      frontier = next;
    }
    return false;
  };

  // 1) Short sea lanes to other landmasses, or shortcuts across bays/straits on the same one.
  for (const p of coastal) {
    const cands = coastal
      .filter((q) => q.id !== p.id && !p.neighbors.includes(q.id))
      .map((q) => ({ q, d: dist(p, q) }))
      .filter((c) => c.d <= SEA_LINK_MAX)
      .sort((a, b) => a.d - b.d || (a.q.id < b.q.id ? -1 : 1));
    let added = 0;
    for (const { q } of cands) {
      if (added >= SEA_LINKS_PER_PROVINCE) break;
      if (comp.get(p.id) === comp.get(q.id) && hopsWithin(p.id, q.id, SHORTCUT_MIN_HOPS - 1)) continue;
      addSea(p.id, q.id);
      added++;
    }
  }

  // 2) Make sure every landmass is reachable: link each isolated group to its nearest neighbour group.
  for (let guard = 0; guard < 200; guard++) {
    const group = new Map<ProvinceId, number>();
    let g = 0;
    for (const p of input) {
      if (group.has(p.id)) continue;
      const stack = [p.id];
      group.set(p.id, g);
      while (stack.length) for (const l of provinces[stack.pop()!].links) if (!group.has(l.to)) { group.set(l.to, g); stack.push(l.to); }
      g++;
    }
    if (g <= 1) break;
    // the largest group is the "mainland"; connect the first other group that can be connected
    const sizes = new Array(g).fill(0);
    for (const v of group.values()) sizes[v]++;
    const main = sizes.indexOf(Math.max(...sizes));
    let linked = false;
    for (let k = 0; k < g && !linked; k++) {
      if (k === main) continue;
      let best: [WorldProvinceInput, WorldProvinceInput, number] | null = null;
      for (const p of input) {
        if (group.get(p.id) !== k) continue;
        for (const q of coastal) {
          if (group.get(q.id) === k) continue;
          const d = dist(p, q);
          if (d <= ISLAND_LINK_MAX && (!best || d < best[2])) best = [p, q, d];
        }
      }
      if (best) { addSea(best[0].id, best[1].id); linked = true; }
    }
    if (!linked) break; // remaining groups are too remote (e.g. far Pacific islands)
  }

  for (const p of Object.values(provinces)) p.links.sort((a, b) => (a.to < b.to ? -1 : 1));
  return {
    provinces,
    order: input.map((p) => p.id),
    unitTypes: Object.fromEntries(unitTypes.map((u) => [u.id, u])),
    resources: Object.fromEntries(resources.map((r) => [r.id, r])),
    unitCosts: economy.unitCosts,
    developCost: economy.developCost,
    weapons: economy.weapons ?? null,
    seaSpeed,
  };
}

const round1 = (v: number) => Math.round(v * 10) / 10;
