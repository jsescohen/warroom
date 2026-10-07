import type { ProvinceMeta, ScenarioDef } from './scenario';
import { deployStartingArmies } from './military';
import { zoneOf } from './regions';
import { hoursUntil } from './time';
import type { World } from './world';
import { relationKey, type GameState, type Nation, type NationId, type ProvinceId, type ProvinceState } from './types';

export interface ProvinceSeed extends ProvinceMeta {
  pop: number;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Stable, muted color for auto-generated minor nations. */
export function minorColor(key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  const hue = ((h >>> 0) % 360) / 360;
  const sat = 0.22 + (((h >>> 9) % 100) / 100) * 0.18;
  const lig = 0.56 + (((h >>> 17) % 100) / 100) * 0.12;
  const f = (n: number) => {
    const k = (n + hue * 12) % 12;
    const a = sat * Math.min(lig, 1 - lig);
    return Math.round((lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Builds the starting GameState for a scenario. Pure: same inputs → same state. */
export function createInitialState(scenario: ScenarioDef, mapId: string, provinces: ProvinceSeed[], world: World, seed = 1939): GameState {
  const defaultUnits = [scenario.unitTypes[0]?.id].filter(Boolean) as string[];
  const byPolity = new Map<string, NationId>();
  const bySubject = new Map<string, NationId>();
  for (const n of scenario.nations) {
    n.polities?.forEach((p) => byPolity.set(p, n.id));
    n.subjects?.forEach((s) => bySubject.set(s, n.id));
  }

  const nations: Record<NationId, Nation> = {};
  for (const n of scenario.nations) {
    nations[n.id] = {
      id: n.id, name: n.name, shortName: n.shortName ?? n.name, color: n.color,
      capital: null, major: !!n.major, alive: true,
      military: n.military ?? (n.major ? 1.2 : 0.8), units: n.units ?? defaultUnits,
      aggression: n.aggression ?? (n.major ? 0.4 : 0.15),
      naval: n.naval ?? 0.1,
      quality: n.quality ?? 1,
    };
  }

  const owners: Record<ProvinceId, ProvinceState> = {};
  for (const p of provinces) {
    let owner = byPolity.get(p.polity) ?? bySubject.get(p.subject);
    if (!owner && p.polity === 'Tribes') {
      // land outside any polity: one people per geographic zone
      const zone = zoneOf(p.lon, p.lat);
      owner = `t_${zone.id.replace(/-/g, '_')}`;
      if (!nations[owner]) {
        const name = scenario.tribeNames?.[zone.id] ?? zone.name;
        nations[owner] = {
          id: owner, name, shortName: name, color: minorColor(`tribe:${zone.id}`), capital: null, major: false, alive: true,
          military: 0.5, units: defaultUnits, aggression: 0.1, naval: 0, quality: 0.8,
        };
      }
    }
    if (!owner) {
      owner = `m_${slug(p.subject)}`;
      if (!nations[owner]) {
        const name = scenario.minorNames?.[p.subject] ?? p.subject;
        nations[owner] = {
          id: owner, name, shortName: name, color: minorColor(p.subject), capital: null, major: false, alive: true,
          military: 0.6, units: defaultUnits, aggression: 0.1, naval: 0.05, quality: 0.9,
        };
      }
    }
    owner = scenario.assignOwner?.(p, owner) ?? owner;
    owners[p.id] = { owner, core: owner };
  }

  // Capitals: named province if present, otherwise the nation's most populous province.
  const owned = new Map<NationId, ProvinceSeed[]>();
  for (const p of provinces) {
    const o = owners[p.id].owner;
    if (!owned.has(o)) owned.set(o, []);
    owned.get(o)!.push(p);
  }
  for (const nation of Object.values(nations)) {
    const list = owned.get(nation.id) ?? [];
    if (!list.length) { nation.alive = false; continue; }
    const wanted = scenario.nations.find((n) => n.id === nation.id)?.capital;
    const cap = list.find((p) => p.name === wanted) ?? [...list].sort((a, b) => b.pop - a.pop)[0];
    nation.capital = cap.id;
  }
  // Drop defined nations that own nothing at the start (keeps the state lean).
  for (const id of Object.keys(nations)) if (!nations[id].alive) delete nations[id];

  const relations: Record<string, number> = {};
  for (const [a, b, v] of scenario.relations ?? []) if (nations[a] && nations[b]) relations[relationKey(a, b)] = v;

  let nextId = 1;
  const wars = (scenario.wars ?? []).map((w) => ({ id: `w${nextId++}`, attackers: w.attackers, defenders: w.defenders, startedAt: 0 }));
  const treaties = (scenario.treaties ?? []).map((t) => ({ id: `t${nextId++}`, type: t.type, parties: t.parties.filter((n) => nations[n]), signedAt: 0 }));

  const state: GameState = {
    version: 1,
    scenarioId: scenario.id,
    mapId,
    clock: { startDate: scenario.startDate, hours: 0, tickHours: scenario.time.tickHours, turnHours: scenario.time.turnHours },
    playerNation: null,
    nations,
    provinces: owners,
    relations,
    wars,
    treaties,
    armies: {},
    events: [{ id: 0, at: 0, kind: 'start', text: scenario.subtitle }],
    scheduled: (scenario.scripted ?? [])
      .map((e, i) => ({ id: `s${i}`, at: hoursUntil(scenario.startDate, e.date), text: e.text, important: e.important, actions: e.actions }))
      .sort((a, b) => a.at - b.at),
    nextId,
    battles: {},
    proposals: [],
    diplomacy: { chats: {}, memories: {}, lastContact: {} },
    ai: { lastWarAt: -1e9 },
    rng: seed >>> 0,
    armyCounters: {},
    rules: { victoryPercent: scenario.victory.conquestPercent, homeDefense: scenario.combat?.homeDefense ?? 1.2, warAppetite: scenario.aiWarAppetite ?? 1, captureDays: scenario.combat?.captureDays ?? 1 },
    winner: null,
  };
  return deployStartingArmies(state, world);
}

export { allied, armiesIn, atWar, cobelligerents, enemiesOf, friendly, getRelation, provincesOf } from './queries';

