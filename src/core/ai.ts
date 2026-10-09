import type { Command } from './actions';
import { ACCEPT_LEAN, militaryPower, validateTerms, willingness } from './diplomacy';
import { addRelation, getRel } from './events';
import { accessOf, armyCount, BUILDINGS, budgetOf, difficultyMult, eraHasAir, isAirUnit, producedBy, manpowerCap, recruitCost, recruitError, recruitSite, inTraining, supportedArmies, upkeepOf, basicUnit, buildError, developError, marketQuote, materialsOf, usedBy } from './economy';
import { launchError } from './weapons';
import { healthOf, MAX_LABS, nationHealth, neighboursOf, nextTrial, pactPartners, worldSickShare } from './pandemic';
import { BASE_STRENGTH, fleetPower, fleetsByProvince, garrisonPower, homePort, isFleet, seaDenied, strikeError } from './military';
import { allied, atWar, cobelligerents, friendly } from './queries';
import { nextRandom } from './rng';
import { humansOf, isHuman, type Army, type BuildingId, type GameState, type NationId, type ProposalTerms, type ProvinceId } from './types';
import type { World } from './world';

/**
 * Autonomous nation AI. Runs inside the pure tick and acts only through validated actions
 * (moveArmy, declareWar, propose/respond) as each nation's own actor, so it is deterministic,
 * replayable and identical on a future multiplayer server. No LLM calls: the model is kept for
 * talking to the player.
 */

type Apply = (s: GameState, cmd: Command) => GameState;

/** Days of grace at the start before the AI starts wars of its own (scripted history plays out first). */
const OPENING_DAYS = 14;
/** Minimum days between AI-initiated declarations of war, worldwide. */
const WAR_COOLDOWN_DAYS = 10;
/** Armies further than this (map units) are not considered for a task. */
const MAX_TASK_DIST = 380;
/** Days a nation regroups after forcing an enemy to capitulate, before a new offensive. */
const REGROUP_DAYS = 120;

export function aiTick(state: GameState, world: World, apply: Apply): GameState {
  const ticksPerDay = Math.max(1, Math.round(24 / state.clock.tickHours));
  const slot = Math.floor((state.clock.hours % 24) / state.clock.tickHours);
  const day = Math.floor(state.clock.hours / 24);
  const ids = Object.keys(state.nations).filter((n) => state.nations[n].alive && !isHuman(state, n)).sort();
  let s = state;
  ids.forEach((n, i) => {
    if (i % ticksPerDay !== slot || !s.nations[n]?.alive) return;
    s = planArmies(s, world, n, apply, day);
    s = planFleets(s, world, n, apply, day);
    s = planStrikes(s, world, n, apply);
    if ((day + i) % 7 === 0) s = strategize(s, world, n, apply, day);
    if ((day + i) % 7 === 3) s = planEconomy(s, world, n, apply, day);
    if (s.disease && (day + i) % 3 === 0) s = planHealth(s, world, n, apply, day + i);
  });
  if (slot === 0 && day > 0 && day % 30 === 0) s = driftRelations(s);
  return s;
}

// ---- helpers ------------------------------------------------------------------------------------

function rand(s: GameState): [number, GameState] {
  const [v, rng] = nextRandom(s.rng);
  return [v, { ...s, rng }];
}

const dist = (world: World, a: ProvinceId, b: ProvinceId) => {
  const p = world.provinces[a].label, q = world.provinces[b].label;
  return Math.hypot(p[0] - q[0], p[1] - q[1]);
};

const armyPower = (s: GameState, world: World, a: Army, defending: boolean) => {
  const u = world.unitTypes[a.unitType];
  return a.strength * (s.nations[a.owner]?.quality ?? 1) * (defending ? u?.defense ?? 3 : u?.attack ?? 3);
};

const order = (s: GameState, apply: Apply, a: Army, to: ProvinceId) =>
  a.location === to && !a.path.length ? s : apply(s, { action: { type: 'moveArmy', army: a.id, to }, actor: a.owner });

// ---- military -----------------------------------------------------------------------------------

function planArmies(state: GameState, world: World, n: NationId, apply: Apply, day: number): GameState {
  let s = state;
  const mine = Object.values(s.armies).filter((a) => a.owner === n && !isFleet(world, a.unitType)).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!mine.length) return s;
  const enemies = Object.keys(s.nations).filter((e) => s.nations[e].alive && atWar(s, n, e));
  if (!enemies.length) return peacetimePosture(s, world, n, mine, apply, day);

  const enemySet = new Set(enemies);
  const isEnemy = (o: NationId) => enemySet.has(o);
  const owner = (p: ProvinceId) => s.provinces[p].owner;
  // alignments do not change while orders are given: look them up once
  const friends = new Set(Object.keys(s.nations).filter((x) => friendly(s, n, x)));
  // enemy power standing in / next to each province
  const enemyAt = new Map<ProvinceId, number>();
  for (const a of Object.values(s.armies)) if (isEnemy(a.owner) && !isFleet(world, a.unitType)) enemyAt.set(a.location, (enemyAt.get(a.location) ?? 0) + armyPower(s, world, a, false));
  const enemyDefAt = new Map<ProvinceId, number>();
  for (const a of Object.values(s.armies)) if (isEnemy(a.owner) && !isFleet(world, a.unitType)) enemyDefAt.set(a.location, (enemyDefAt.get(a.location) ?? 0) + armyPower(s, world, a, true));
  const ownAt = new Map<ProvinceId, number>();
  for (const a of mine) ownAt.set(a.location, (ownAt.get(a.location) ?? 0) + armyPower(s, world, a, true));
  const threatMemo = new Map<ProvinceId, number>();
  const threatTo = (p: ProvinceId) => {
    let t = threatMemo.get(p);
    if (t === undefined) threatMemo.set(p, (t = (enemyAt.get(p) ?? 0) + world.provinces[p].links.reduce((x, l) => x + (enemyAt.get(l.to) ?? 0) * 0.7, 0)));
    return t;
  };

  const used = new Set<string>();
  const inBattle = (a: Army) => s.battles[a.location] !== undefined && a.progress === 0;
  const homeSide = (p: ProvinceId) => friends.has(owner(p));
  // available: standing still on friendly soil, not fighting, not busy capturing
  // the capital always keeps its garrison (one army in five): these armies are never sent away
  const capitalId = s.nations[n].capital;
  const garrisonSize = Math.max(1, Math.floor(mine.length / 5));
  const garrison = new Set(mine.filter((a) => a.location === capitalId && a.progress === 0).slice(0, garrisonSize).map((a) => a.id));
  const available = () => mine.filter((a) => !used.has(a.id) && !garrison.has(a.id) && s.armies[a.id] && !a.path.length && a.progress === 0 && !inBattle(a) && homeSide(a.location));

  // 1) badly mauled armies fall back to the nearest safe own province
  for (const a of mine) {
    if (a.strength >= a.maxStrength * 0.3 || inBattle(a) || a.path.length) continue;
    const front = threatTo(a.location) > 0 || isEnemy(owner(a.location));
    if (!front) continue;
    const safe = Object.keys(s.provinces).filter((p) => owner(p) === n && threatTo(p) === 0)
      .sort((x, y) => dist(world, a.location, x) - dist(world, a.location, y))[0];
    if (safe) { s = order(s, apply, a, safe); used.add(a.id); }
  }

  // 2) defence: provinces where the enemy is stronger than we are, capital first
  const capital = s.nations[n].capital;
  // an ally of a player also guards that player's threatened provinces within reach
  const humanAllies = new Set(humansOf(s).filter((h) => h !== n && allied(s, n, h)));
  const playersAlly = humanAllies.size > 0;
  const near = (p: ProvinceId) => mine.some((a) => dist(world, a.location, p) <= MAX_TASK_DIST * 0.6);
  const needs = Object.keys(s.provinces)
    .filter((p) => owner(p) === n || (playersAlly && humanAllies.has(owner(p)) && near(p)))
    // covered = our garrison plus most of our armies next door (they can step in); only real gaps draw reinforcements
    .map((p) => {
      // troops at home fight with the home-ground bonus, alongside the local garrison
      const cover = ((ownAt.get(p) ?? 0) * (s.rules.homeDefense ?? 1.2) + garrisonPower(s, p)) + world.provinces[p].links.reduce((x, l) => x + (ownAt.get(l.to) ?? 0) * 0.6, 0);
      return { p, need: threatTo(p) * 1.1 * (p === capital ? 2 : 1) - cover };
    })
    .filter((x) => x.need > 0)
    .sort((a, b) => b.need - a.need || (a.p < b.p ? -1 : 1))
    .slice(0, 2);
  for (const { p, need } of needs) {
    let covered = 0;
    for (const a of available().sort((x, y) => dist(world, x.location, p) - dist(world, y.location, p))) {
      if (covered >= need || dist(world, a.location, p) > MAX_TASK_DIST) break;
      if (threatTo(a.location) > (ownAt.get(a.location) ?? 0) && a.location !== p) continue; // don't strip another front
      s = order(s, apply, a, p);
      used.add(a.id);
      covered += armyPower(s, world, a, true);
    }
  }

  // 3) offence: enemy provinces we can reach, best value for the defence they put up
  // enemy provinces next to ours; across the sea only for enemies we cannot reach by land
  const byLand = new Set<ProvinceId>();
  const bySea = new Set<ProvinceId>();
  const minePos = new Set(mine.map((a) => a.location));
  for (const p of Object.keys(s.provinces)) {
    if (!homeSide(p) && !minePos.has(p)) continue;
    for (const l of world.provinces[p].links) if (isEnemy(owner(l.to))) (l.sea ? bySea : byLand).add(l.to);
  }
  const landEnemies = new Set([...byLand].map(owner));
  // landings only where the enemy does not control the sea
  const fleets = fleetsByProvince(s, world);
  const seaOnly = new Set([...bySea].filter((t) => !byLand.has(t) && !landEnemies.has(owner(t)) && !seaDenied(s, world, n, t, fleets)));
  // cautious nations stay on the defensive against an enemy as strong as they are (the 1939
  // "Phoney War"): they retake their own lost land, but invade only with a clear overall edge
  const cautious = s.nations[n].aggression < 0.3;
  const ourPower = cautious ? militaryPower(s, world, n) : 0;
  const powerOf = new Map<NationId, number>();
  const outclassed = (o: NationId) => {
    if (!powerOf.has(o)) powerOf.set(o, militaryPower(s, world, o));
    return ourPower < powerOf.get(o)! * 1.5;
  };
  // only targets some free army of ours can actually reach (not a far-off colonial border next to an ally)
  const free = available();
  const nearest = new Map<ProvinceId, number>();
  const nearestFree = (t: ProvinceId) => {
    if (!nearest.has(t)) {
      const adj = (a: Army) => world.provinces[a.location].links.some((l) => l.to === t);
      nearest.set(t, free.filter((a) => threatTo(a.location) === 0 || adj(a)).reduce((m, a) => Math.min(m, dist(world, a.location, t)), Infinity));
    }
    return nearest.get(t)!;
  };
  const inReach = (t: ProvinceId) => nearestFree(t) <= MAX_TASK_DIST;
  const shares = new Map<NationId, number>();
  const coreShare = (o: NationId) => {
    if (!shares.has(o)) {
      let total = 0, held = 0;
      for (const ps of Object.values(s.provinces)) if (ps.core === o) { total++; if (ps.owner === o) held++; }
      shares.set(o, total ? held / total : 1);
    }
    return shares.get(o)!;
  };
  // caution is set aside for the player's enemies when we are the player's ally: an ally that agreed
  // to help actually fights (AI-only alliances keep their caution, as in the 1939 "Phoney War")
  const bold = (o: NationId) => [...humanAllies].some((h) => atWar(s, h, o));
  const candidates = [...byLand, ...seaOnly].filter((t) => inReach(t) && (!cautious || s.provinces[t].core === n || bold(owner(t)) || !outclassed(owner(t))));
  // one front at a time: while an enemy is collapsing (holding under 90% of its land), finish it
  // before opening an offensive against a fresh one (retaking our own land is always allowed)
  const collapsing = new Set(enemies.filter((e) => coreShare(e) < 0.9));
  // after forcing a surrender, regroup for a season before opening a new offensive
  const regrouping = s.events.some((e) => e.kind === 'capitulation' && e.nations?.[1] === n && s.clock.hours - e.at < REGROUP_DAYS * 24);
  const reachable = new Set(regrouping ? candidates.filter((t) => s.provinces[t].core === n) : collapsing.size ? candidates.filter((t) => collapsing.has(owner(t)) || s.provinces[t].core === n) : candidates);
  const targets = [...reachable]
    .map((t) => {
      const defense = ((enemyDefAt.get(t) ?? 0) + garrisonPower(s, t)) * 1.2;
      const support = world.provinces[t].links.reduce((x, l) => x + (enemyAt.get(l.to) ?? 0) * 0.8, 0); // neighbours reinforce
      // capitals and our own lost provinces (above all our old capital) are worth the most
      const lost = s.provinces[t].core === n;
      // finish off a beaten enemy before opening new fronts: the less of its own land it holds, the more it is worth
      const value = 1 + (s.nations[owner(t)]?.capital === t ? 4 : 0) + (lost ? 3 : 0) + Math.sqrt(world.provinces[t].area) / 20 + 4 * (1 - coreShare(owner(t)));
      // nearby objectives first: a far-off one ties up armies on the march for weeks
      return { t, defense: defense + support, score: value / (1 + (defense + support) / 30) / (1 + nearestFree(t) / 150) };
    })
    .sort((a, b) => b.score - a.score || (a.t < b.t ? -1 : 1))
    .slice(0, 3);
  for (const { t, defense } of targets) {
    // armies holding a threatened front stay unless the target is right next to them
    const adjacent = (a: Army) => world.provinces[a.location].links.some((l) => l.to === t);
    const pool = available().filter((a) => dist(world, a.location, t) <= MAX_TASK_DIST && (threatTo(a.location) === 0 || adjacent(a)))
      .sort((x, y) => dist(world, x.location, t) - dist(world, y.location, t));
    const total = pool.reduce((x, a) => x + armyPower(s, world, a, false), 0);
    // doctrine: cautious nations only attack with a big local edge; landings need far more
    const doctrine = 1.3 + (1 - s.nations[n].aggression) * 1.2;
    const margin = seaOnly.has(t) ? doctrine * 1.7 : doctrine;
    const need = defense * margin + (seaOnly.has(t) ? 15 : 0);
    if (!pool.length || total < need) continue; // not enough to win here: wait
    // strike together: attack only with the force already assembled next to the target; until it
    // is strong enough, the rest marches to the assembly point (arriving one by one, they would be
    // beaten one by one)
    const ready = pool.filter(adjacent);
    const readyPower = ready.reduce((x, a) => x + armyPower(s, world, a, false), 0);
    // with an overwhelming edge, latecomers are reinforcements rather than lambs: go at once
    const overwhelming = total >= need * 2;
    if (readyPower >= need || overwhelming) {
      let committed = 0;
      for (const a of overwhelming ? pool : ready) {
        if (committed >= defense * margin * 1.1 + 5) break; // commit enough to win, not a token force
        const before = s;
        s = order(s, apply, a, t);
        if (s !== before) { used.add(a.id); committed += armyPower(s, world, a, false); }
      }
      continue;
    }
    const staging = world.provinces[t].links
      .filter((l) => homeSide(l.to) && (seaOnly.has(t) ? l.sea : !l.sea) && threatTo(l.to) <= (ownAt.get(l.to) ?? 0) + readyPower)
      .map((l) => l.to)
      .sort((x, y) => (ownAt.get(y) ?? 0) - (ownAt.get(x) ?? 0) || dist(world, pool[0].location, x) - dist(world, pool[0].location, y) || (x < y ? -1 : 1))[0];
    if (!staging) continue;
    let gathered = readyPower;
    for (const a of ready) used.add(a.id); // hold position at the assembly point
    for (const a of pool) {
      if (gathered >= need * 1.1 + 5) break;
      if (adjacent(a)) continue;
      const before = s;
      s = order(s, apply, a, staging);
      if (s !== before) { used.add(a.id); gathered += armyPower(s, world, a, false); }
    }
  }
  return s;
}

// ---- fleets -------------------------------------------------------------------------------------

/** Fleets this far (map units) from a task are not sent to it. */
const FLEET_REACH = 500;

/**
 * Daily fleet orders: strike if able, repair when battered, hunt weaker enemy squadrons, else
 * sail off the coasts where our armies fight (shelling the enemy, keeping the sea open), and in
 * peacetime return to the home port.
 */
function planFleets(state: GameState, world: World, n: NationId, apply: Apply, day: number): GameState {
  let s = state;
  const mine = Object.values(s.armies).filter((a) => a.owner === n && isFleet(world, a.unitType)).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!mine.length) return s;
  const port = homePort(s, world, n);
  const enemies = Object.keys(s.nations).filter((e) => s.nations[e].alive && atWar(s, n, e));
  if (!enemies.length) {
    if (day % 7 !== 0 || !port) return s;
    for (const f of mine) if (!f.path.length && f.progress === 0 && dist(world, f.location, port) > 120) s = order(s, apply, f, port);
    return s;
  }
  const isEnemy = (o: NationId) => enemies.includes(o);
  const enemyFleetAt = new Map<ProvinceId, number>();
  for (const a of Object.values(s.armies)) {
    if (!isEnemy(a.owner) || a.progress > 0 || !isFleet(world, a.unitType)) continue;
    enemyFleetAt.set(a.location, (enemyFleetAt.get(a.location) ?? 0) + fleetPower(s, world, a));
  }
  // coasts where our troops are fighting or besieging, or that they are about to cross from
  const fronts = new Set<ProvinceId>();
  for (const a of Object.values(s.armies)) {
    if (a.owner !== n || isFleet(world, a.unitType) || !world.provinces[a.location].coastal) continue;
    if (s.battles[a.location] !== undefined || isEnemy(s.provinces[a.location].owner)) fronts.add(a.location);
    else if (a.path.length && world.provinces[a.location].links.some((l) => l.sea && l.to === a.path[0])) fronts.add(a.location);
  }

  for (const f of mine) {
    if (!s.armies[f.id]) continue;
    s = aiStrike(s, world, s.armies[f.id], apply, isEnemy);
    const cur = s.armies[f.id];
    if (cur.path.length || cur.progress > 0 || s.battles[cur.location] !== undefined) continue;
    const power = fleetPower(s, world, cur);
    // battered: back to port to refit
    if (cur.strength < cur.maxStrength * 0.4) {
      if (port && !friendly(s, n, s.provinces[cur.location].owner)) s = order(s, apply, cur, port);
      continue;
    }
    // hunt an enemy squadron we can beat
    const prey = [...enemyFleetAt].filter(([p, pw]) => dist(world, cur.location, p) <= FLEET_REACH && power > pw * 1.3)
      .sort((a, b) => dist(world, cur.location, a[0]) - dist(world, cur.location, b[0]) || (a[0] < b[0] ? -1 : 1))[0];
    if (prey) { s = order(s, apply, cur, prey[0]); continue; }
    // support the army: the nearest front coast the enemy does not hold at sea
    const front = [...fronts].filter((p) => dist(world, cur.location, p) <= FLEET_REACH && (enemyFleetAt.get(p) ?? 0) < power)
      .sort((a, b) => dist(world, cur.location, a) - dist(world, cur.location, b) || (a < b ? -1 : 1))[0];
    if (front) { s = order(s, apply, cur, front); continue; }
    if (port && (enemyFleetAt.get(cur.location) ?? 0) > power) s = order(s, apply, cur, port);
  }
  return s;
}

/** Air wings and drones (and any fleet with aircraft) strike when ready, at war. */
function planStrikes(state: GameState, world: World, n: NationId, apply: Apply): GameState {
  let s = state;
  const enemies = new Set(Object.keys(s.nations).filter((e) => s.nations[e].alive && atWar(s, n, e)));
  if (!enemies.size) return s;
  for (const a of Object.values(s.armies).filter((x) => x.owner === n && !isFleet(world, x.unitType) && world.unitTypes[x.unitType]?.strike).sort((x, y) => (x.id < y.id ? -1 : 1))) {
    if (s.armies[a.id]) s = aiStrike(s, world, s.armies[a.id], apply, (o) => enemies.has(o));
  }
  return s;
}

/** Strikers hit the strongest enemy force in range, preferring the battle lines. */
function aiStrike(s: GameState, world: World, f: Army, apply: Apply, isEnemy: (o: NationId) => boolean): GameState {
  const strike = world.unitTypes[f.unitType]?.strike;
  if (!strike || f.progress > 0 || (f.readyAt ?? 0) > s.clock.hours) return s;
  const value = new Map<ProvinceId, number>();
  for (const a of Object.values(s.armies)) {
    if (!isEnemy(a.owner) || a.progress > 0 || dist(world, f.location, a.location) > strike.range) continue;
    // only where the war is actually being fought: a battle, or enemy troops on our side's soil
    const fighting = s.battles[a.location] !== undefined;
    if (!fighting && !friendly(s, f.owner, s.provinces[a.location].owner)) continue;
    const engaged = fighting ? 2 : 1;
    value.set(a.location, (value.get(a.location) ?? 0) + a.strength * engaged);
  }
  const best = [...value].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  if (!best || best[1] < 3 || strikeError(s, world, f.id, best[0])) return s;
  return apply(s, { action: { type: 'strike', army: f.id, target: best[0] }, actor: f.owner });
}

/** In peacetime, once a week: keep a guard at the capital and line borders facing hostile neighbours. */
function peacetimePosture(state: GameState, world: World, n: NationId, mine: Army[], apply: Apply, day: number): GameState {
  if (day % 7 !== 0) return state;
  let s = state;
  const owner = (p: ProvinceId) => s.provinces[p].owner;
  const hostileBorder = Object.keys(s.provinces).filter((p) => owner(p) === n && world.provinces[p].links.some((l) => {
    const o = owner(l.to);
    return o !== n && !friendly(s, n, o) && getRel(s, n, o) <= -30;
  }));
  if (!hostileBorder.length) return s;
  const capital = s.nations[n].capital;
  const idle = mine.filter((a) => !a.path.length && a.progress === 0);
  const guard = idle.find((a) => a.location === capital);
  const movable = idle.filter((a) => a !== guard && !hostileBorder.includes(a.location));
  const uncovered = hostileBorder.filter((p) => !mine.some((a) => a.location === p));
  for (const p of uncovered) {
    const a = movable.filter((x) => dist(world, x.location, p) <= MAX_TASK_DIST)
      .sort((x, y) => dist(world, x.location, p) - dist(world, y.location, p))[0];
    if (!a) break;
    s = order(s, apply, a, p);
    movable.splice(movable.indexOf(a), 1);
  }
  return s;
}

// ---- strategy -----------------------------------------------------------------------------------

function strategize(state: GameState, world: World, n: NationId, apply: Apply, day: number): GameState {
  let s = state;
  const me = s.nations[n];
  const alive = Object.keys(s.nations).filter((x) => s.nations[x].alive && x !== n).sort();
  const power = (x: NationId) => militaryPower(s, world, x);
  let r: number;

  // 1) honour alliances: join an ally that is defending against an aggressor (if not busy elsewhere).
  // The player's allies always consider the call, wherever they are; AI allies only against a neighbour.
  const busy = alive.some((x) => atWar(s, n, x));
  for (const w of s.wars) {
    const allyDefending = w.defenders.find((d) => d !== n && allied(s, n, d));
    if (!allyDefending || w.attackers.includes(n) || w.defenders.includes(n)) continue;
    const forPlayer = isHuman(s, allyDefending);
    if (busy && !forPlayer) continue;
    const aggressor = w.attackers[0];
    if (!aggressor || friendly(s, n, aggressor)) continue;
    const borders = Object.keys(s.provinces).some((p) => s.provinces[p].owner === n &&
      world.provinces[p].links.some((l) => s.provinces[l.to].owner === aggressor));
    if (!borders && !forPlayer) continue;
    [r, s] = rand(s);
    const chance = forPlayer ? 0.9 : getRel(s, n, aggressor) < 0 ? 0.55 : 0.2;
    if (r < chance) s = apply(s, { action: { type: 'declareWar', attacker: n, defender: aggressor }, actor: n });
    break;
  }

  // 2) make peace with AI enemies when both sides want it (the player negotiates in person)
  for (const e of alive) {
    if (isHuman(s, e) || !atWar(s, n, e)) continue;
    const terms = { type: 'peace' as const, from: n, to: e };
    if (validateTerms(s, terms)) continue;
    if (willingness(s, world, terms, n).score >= ACCEPT_LEAN && willingness(s, world, terms, e).score >= ACCEPT_LEAN) {
      s = sign(s, apply, terms);
      break;
    }
  }

  // 3) alliances against a shared enemy
  const enemiesOfMe = alive.filter((x) => atWar(s, n, x));
  if (enemiesOfMe.length) {
    for (const m of alive) {
      if (isHuman(s, m) || allied(s, n, m) || atWar(s, n, m) || cobelligerents(s, n, m)) continue;
      if (!enemiesOfMe.some((e) => atWar(s, m, e))) continue;
      const terms = { type: 'alliance' as const, from: n, to: m };
      if (validateTerms(s, terms)) continue;
      if (willingness(s, world, terms, m).score >= ACCEPT_LEAN && willingness(s, world, terms, n).score >= ACCEPT_LEAN) {
        s = sign(s, apply, terms);
        break;
      }
    }
  }

  // 4) wars of expansion
  if (day < OPENING_DAYS || (s.clock.hours - s.ai.lastWarAt) < WAR_COOLDOWN_DAYS * 24) return s;
  const wars = enemiesOfMe.length;
  if (me.aggression < 0.3 || wars > (me.aggression >= 0.7 ? 1 : 0)) return s;
  const myOwned = Object.keys(s.provinces).filter((p) => s.provinces[p].owner === n);
  const neighbours = new Set<NationId>();
  for (const p of myOwned) for (const l of world.provinces[p].links) {
    const o = s.provinces[l.to].owner;
    if (o !== n && (!l.sea || l.dist < 60)) neighbours.add(o);
  }
  const ourSide = power(n) + alive.filter((x) => allied(s, n, x)).reduce((x, a) => x + power(a) * 0.4, 0) - enemiesOfMe.reduce((x, e) => x + power(e) * 0.5, 0);
  let best: { target: NationId; score: number } | null = null;
  for (const c of [...neighbours].sort()) {
    if (!s.nations[c]?.alive || friendly(s, n, c) || atWar(s, n, c)) continue;
    const bound = s.treaties.some((t) => (t.type === 'non-aggression' || t.type === 'peace' || t.type === 'ceasefire') && t.parties.includes(n) && t.parties.includes(c));
    if (bound && me.aggression < 0.85) continue;
    const rel = getRel(s, n, c);
    if (rel > 10) continue;
    const theirSide = power(c) + alive.filter((x) => x !== n && allied(s, c, x)).reduce((x, a) => x + power(a) * 0.7, 0);
    const ratio = ourSide / (theirSide + 1);
    // the AI picks on the player only with a clear edge (less of one on hard)
    const d = s.rules.difficulty ?? 'normal';
    const needed = isHuman(s, c) ? (d === 'easy' ? 2.8 : d === 'hard' ? 1.7 : 2.2) : 1.6;
    if (ratio < needed) continue;
    const score = (ratio - needed) * 10 - rel / 5 - (bound ? 15 : 0) - (s.nations[c].major ? 5 : 0);
    if (!best || score > best.score) best = { target: c, score };
  }
  if (!best) return s;
  [r, s] = rand(s);
  const appetite = { easy: 0.6, normal: 1, hard: 1.4 }[s.rules.difficulty ?? 'normal'];
  if (r < me.aggression * 0.3 * (s.rules.warAppetite ?? 1) * appetite) {
    const before = s;
    s = apply(s, { action: { type: 'declareWar', attacker: n, defender: best.target }, actor: n });
    if (s !== before) s = { ...s, ai: { ...s.ai, lastWarAt: s.clock.hours } };
  }
  return s;
}

// ---- economy ------------------------------------------------------------------------------------

/**
 * Weekly: keep the army at the size the nation supports (the AI plays by the player's rules: it
 * pays for every unit, in money and materials), buying missing materials on the market; put mines,
 * farms and factories on its deposits; develop its best cities; build air defence and weapons and
 * use them; and buy resources its army is built from but it lacks.
 */
function planEconomy(state: GameState, world: World, n: NationId, apply: Apply, day: number): GameState {
  let s = state;
  const me = s.nations[n];
  if (!me?.alive || !me.capital) return s;
  const owned = Object.keys(s.provinces).filter((p) => s.provinces[p].owner === n);
  const enemies = Object.keys(s.nations).filter((e) => s.nations[e].alive && atWar(s, n, e));
  const front = owned.filter((p) => world.provinces[p].links.some((l) => enemies.includes(s.provinces[l.to].owner)));
  // a rich treasury raises extra armies, up to the nation's manpower
  const target = (me.treasury ?? 0) > 150 ? manpowerCap(s, world, n) : Math.round(supportedArmies(s, world, n) * difficultyMult(s, n));
  const toFront = (p: ProvinceId) => (front.length ? Math.min(...front.map((f) => dist(world, p, f))) : dist(world, p, me.capital!));
  const treasury = () => s.nations[n].treasury ?? 0;
  const run = (action: Parameters<Apply>[1]['action']) => {
    const before = s;
    s = apply(s, { action, actor: n });
    return s !== before;
  };
  /** Buys what a bill lacks on the market, if that leaves the money for the rest. */
  const buyFor = (bill: Record<string, number>, reserve: number) => {
    for (const [r, q] of Object.entries(bill)) {
      const lack = Math.ceil(q - (s.nations[n].stock?.[r] ?? 0));
      if (lack <= 0) continue;
      if (treasury() - marketQuote(s, world, r, lack) < reserve) return false;
      if (!run({ type: 'market', resource: r, amount: lack })) return false;
    }
    return true;
  };

  // 0) work an untapped deposit first: a mine or farm pays for itself within months
  {
    const used0 = usedBy(world, s.nations[n].units);
    const untapped = owned.filter((p) => {
      const r = world.resources[world.provinces[p].resource ?? ''];
      return r && !s.provinces[p].build?.includes(r.extract) && !s.provinces[p].siege;
    }).sort((x, y) => Number(used0.has(world.provinces[y].resource!)) - Number(used0.has(world.provinces[x].resource!)) || (x < y ? -1 : 1))[0];
    const r = untapped ? world.resources[world.provinces[untapped].resource!] : null;
    if (untapped && r && treasury() >= 25 && !buildError(s, world, n, untapped, r.extract)) run({ type: 'build', province: untapped, building: r.extract });
  }

  // a pandemic: no armies to raise or forts to build (see planHealth)
  if (s.disease) return s;

  // 1) recruit: up to two units a week while under strength and the money lasts
  for (let k = 0; k < 2 && armyCount(s, world, n) + inTraining(s, n) < target; k++) {
    const nation = s.nations[n];
    const b = budgetOf(s, world, n);
    const counter = s.armyCounters[n] ?? 0;
    const wanted = nation.units[counter % nation.units.length];
    const base = basicUnit(world);
    let placed = false;
    for (const unit of [...new Set([wanted, base])]) {
      const kind: BuildingId = isAirUnit(world, unit) ? 'airfield' : 'barracks';
      // near the front, but a good site (capital, big city) is worth a longer march
      const siteScore = (p: ProvinceId) => toFront(p) * (0.4 + recruitSite(s, world, p).time);
      const sites = owned.filter((p) => s.provinces[p].build?.includes(kind)).sort((x, y) => siteScore(x) - siteScore(y) || (x < y ? -1 : 1));
      // keep a running budget: the new unit's upkeep must be affordable, or the treasury must carry
      // the deficit for half a year
      const cost = recruitCost(s, world, n, unit);
      const net = b.net - upkeepOf(s, world, { owner: n, unitType: unit, maxStrength: BASE_STRENGTH } as Army);
      if (net < 0 && treasury() - cost < -net * 6) break;
      let site = sites.find((p) => !recruitError(s, world, n, p, unit));
      // short of materials: buy them, if the treasury can spare it
      if (!site && sites.some((p) => /^Needs \d/.test(recruitError(s, world, n, p, unit) ?? '')) && buyFor(materialsOf(world, unit), cost + 10))
        site = sites.find((p) => !recruitError(s, world, n, p, unit));
      if (!site) continue;
      placed = run({ type: 'recruit', province: site, unitType: unit });
      if (placed) break;
    }
    if (!placed) break;
  }

  // 2) build with what is left over (one thing a week, keeping a reserve for recruits)
  const nation = s.nations[n];
  const has = (b: BuildingId) => owned.filter((p) => s.provinces[p].build?.includes(b));
  const spare = treasury() - 30;
  const home = owned.filter((p) => s.provinces[p].core === n).sort((x, y) => world.provinces[y].pop - world.provinces[x].pop || (x < y ? -1 : 1));
  const lacks = (b: BuildingId) => (p: ProvinceId) => !s.provinces[p].build?.includes(b);
  const tryBuild = (p: ProvinceId | undefined, b: BuildingId) => !!p && spare >= BUILDINGS[b].cost && !buildError(s, world, n, p, b) && run({ type: 'build', province: p, building: b });
  // what the army is made of, and deposits not yet worked (those it needs first)
  const used = usedBy(world, nation.units);
  const deposit = owned.filter((p) => {
    const r = world.resources[world.provinces[p].resource ?? ''];
    return r && lacks(r.extract)(p) && !s.provinces[p].siege;
  }).sort((x, y) => Number(used.has(world.provinces[y].resource!)) - Number(used.has(world.provinces[x].resource!)) || (x < y ? -1 : 1))[0];
  const enemyStrikes = enemies.some((e) => s.nations[e].units.some((u) => isAirUnit(world, u)) || (s.nations[e].arsenal?.missile ?? 0) > 0);
  if (armyCount(s, world, n) >= target || spare > 80) {
    const extract = deposit ? world.resources[world.provinces[deposit].resource!].extract : null;
    if (has('barracks').length < 1 + Math.floor(target / 8)) tryBuild(home.find(lacks('barracks')), 'barracks');
    else if (deposit && extract && tryBuild(deposit, extract)) { /* a mine, farm or factory */ }
    else if (eraHasAir(world) && nation.units.some((u) => isAirUnit(world, u)) && has('airfield').length < 1 + Math.floor(target / 16)) tryBuild(home.find(lacks('airfield')), 'airfield');
    else if (world.weapons && enemyStrikes && !s.provinces[me.capital].build?.includes('airdefense') && spare > 60) tryBuild(me.capital, 'airdefense');
    else if (!s.provinces[me.capital].build?.includes('fort') && spare > 60) tryBuild(me.capital, 'fort');
    else if (spare > 100) {
      // develop the capital and the big cities, one level at a time
      const dev = [me.capital, ...home].find((p) => !developError(s, world, n, p));
      if (dev) run({ type: 'develop', province: dev });
      else if (has('fort').length < 4 && spare > 120) tryBuild([...front].sort((x, y) => world.provinces[y].pop - world.provinces[x].pop || (x < y ? -1 : 1)).find(lacks('fort')), 'fort');
    }
  }

  // 3) weapons: missiles at war; nuclear weapons only for aggressive great powers
  if (world.weapons && enemies.length) {
    if ((s.nations[n].arsenal?.missile ?? 0) < 4 && treasury() > 90) run({ type: 'arm', weapon: 'missile' });
    if (me.major && me.aggression >= 0.5 && (s.nations[n].arsenal?.nuke ?? 0) < 2 && treasury() > 700) run({ type: 'arm', weapon: 'nuke' });
    s = fireWeapons(s, world, n, apply, enemies);
  }

  // 4) once a month, buy a resource the army is built from but the nation neither has nor makes
  if (Math.floor(day / 7) % 4 === 0 && budgetOf(s, world, n).net > 6) {
    const produced = producedBy(s, world, n);
    const access = accessOf(s, world, n);
    const want = [...used].filter((r) => !produced.has(r) && !access.has(r) && (s.nations[n].stock?.[r] ?? 0) < 20).sort()[0];
    if (want) {
      const sellers = Object.keys(s.nations).filter((x) => x !== n && !isHuman(s, x) && s.nations[x].alive && !atWar(s, n, x) && getRel(s, n, x) >= -10 && producedBy(s, world, x).has(want)).sort();
      for (const x of sellers.slice(0, 6)) {
        const terms = { type: 'trade' as const, from: n, to: x, buy: want, gold: 4 };
        if (validateTerms(s, terms) || willingness(s, world, terms, x).score < ACCEPT_LEAN) continue;
        s = sign(s, apply, terms);
        break;
      }
    }
  }
  return s;
}

/**
 * Missiles at the biggest enemy force within range (an offensive gathering, an army at the gates).
 * A nuclear weapon only in desperation: the capital is under attack or most of the homeland is lost.
 */
function fireWeapons(state: GameState, world: World, n: NationId, apply: Apply, enemies: NationId[]): GameState {
  let s = state;
  const isEnemy = new Set(enemies);
  const stacks = new Map<ProvinceId, number>();
  for (const a of Object.values(s.armies)) if (isEnemy.has(a.owner) && a.progress === 0) stacks.set(a.location, (stacks.get(a.location) ?? 0) + a.strength);
  const targets = [...stacks].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
  if ((s.nations[n].arsenal?.missile ?? 0) > 0) {
    const t = targets.find(([p, str]) => str >= 8 && !launchError(s, world, n, 'missile', p));
    if (t) s = apply(s, { action: { type: 'launch', weapon: 'missile', target: t[0] }, actor: n });
  }
  if ((s.nations[n].arsenal?.nuke ?? 0) > 0) {
    const cap = s.nations[n].capital;
    let total = 0, held = 0;
    for (const ps of Object.values(s.provinces)) if (ps.core === n) { total++; if (ps.owner === n) held++; }
    const nearCap = cap ? targets.filter(([p]) => p === cap || world.provinces[cap].links.some((l) => l.to === p)) : [];
    const desperate = nearCap.some(([, str]) => str >= 15) || (total > 0 && held / total < 0.5);
    if (desperate) {
      // never on its own capital; the biggest enemy force near the capital, else the biggest anywhere
      const t = [...nearCap, ...targets].find(([p, str]) => p !== cap && str >= 15 && !launchError(s, world, n, 'nuke', p));
      if (t) s = apply(s, { action: { type: 'launch', weapon: 'nuke', target: t[0] }, actor: n });
    }
  }
  return s;
}

/**
 * The pandemic: measures every few days (lockdown by the size of the outbreak, borders while the
 * neighbours are sick, funding by the treasury), and once a week labs and hospitals, materials for
 * the trials, research pacts with the willing, help for sick friends, and the cure for friends.
 */
function planHealth(state: GameState, world: World, n: NationId, apply: Apply, tick: number): GameState {
  let s = state;
  const me = s.nations[n];
  if (!me?.alive || !me.capital) return s;
  const run = (action: Parameters<Apply>[1]['action']) => {
    const before = s;
    s = apply(s, { action, actor: n });
    return s !== before;
  };
  const h = healthOf(s, n);
  const mine = nationHealth(s, world, n);
  const world0 = worldSickShare(s, world);
  const near = neighboursOf(s, world, n);
  const nearSick = Math.max(0, ...near.map((x) => nationHealth(s, world, x).sickShare));
  const treasury = s.nations[n].treasury ?? 0;
  // leaders act late, and the people tire of a lockdown: they ease it as soon as the numbers fall
  let lockdown: number = h.lockdown ?? 0;
  if (mine.sickShare >= 0.03) lockdown = 2;
  else if (mine.sickShare >= 0.006) lockdown = Math.max(lockdown, 1);
  else if (mine.sickShare < 0.004 && lockdown === 2) lockdown = 1;
  else if (mine.sickShare < 0.001 && lockdown === 1) lockdown = 0;
  if (treasury < -20 && lockdown > 0) lockdown--;
  const borders = h.borders ? !(world0 < 0.0002 && nearSick < 0.0005) : mine.sickShare < 0.005 && (nearSick >= 0.01 || world0 >= 0.004);
  const net = budgetOf(s, world, n).net;
  const funding = net > 8 || treasury > 90 ? 2 : net < 0 && treasury < 10 ? 0 : 1;
  if (lockdown !== (h.lockdown ?? 0) || borders !== !!h.borders || funding !== (h.funding ?? 1)) run({ type: 'setHealth', lockdown, borders, funding });

  if (Math.floor(tick / 3) % 2 !== 0) return s; // the rest every six days
  const owned = Object.keys(s.provinces).filter((p) => s.provinces[p].owner === n)
    .sort((x, y) => world.provinces[y].pop - world.provinces[x].pop || (x < y ? -1 : 1));
  const buy = (r: string, q: number, reserve: number) => {
    const lack = Math.ceil(q - (s.nations[n].stock?.[r] ?? 0));
    return lack <= 0 || ((s.nations[n].treasury ?? 0) - marketQuote(s, world, r, lack) >= reserve && run({ type: 'market', resource: r, amount: Math.min(40, lack) }));
  };
  // 1) the trials' materials
  const trial = nextTrial(s, n);
  if (trial && (h.research ?? 0) >= trial.at - 5) for (const [r, q] of Object.entries(trial.needs)) if (!buy(r, q, 15)) break;
  // 2) labs (the great powers several), then hospitals where the sick are
  const labs = owned.filter((p) => s.provinces[p].build?.includes('lab')).length;
  const wantLabs = me.major ? Math.min(MAX_LABS, 3 + Math.floor(treasury / 150)) : treasury > 120 ? 2 : 1;
  const building = (b: BuildingId) => (s.projects ?? []).some((x) => x.nation === n && x.what === b);
  if (labs < wantLabs && !building('lab') && treasury > 45) {
    const site = owned.find((p) => !buildError(s, world, n, p, 'lab') || /^Needs d/.test(buildError(s, world, n, p, 'lab') ?? ''));
    if (site && buy('reagents', 3, 50)) run({ type: 'build', province: site, building: 'lab' });
  } else if (treasury > 55 && !building('hospital')) {
    const site = owned.filter((p) => (s.provinces[p].sick ?? 0) > 0 || nearSick > 0.002)
      .find((p) => !buildError(s, world, n, p, 'hospital') || /^Needs d/.test(buildError(s, world, n, p, 'hospital') ?? ''));
    if (site && buy('medicine', 2, 35) && buy('gear', 2, 35)) run({ type: 'build', province: site, building: 'hospital' });
  }
  // 3) supplies for the measures and the vaccines
  if (lockdown && (s.nations[n].stock?.food ?? 0) < 4) buy('food', 6, 20);
  if (lockdown && (s.nations[n].stock?.gear ?? 0) < 3) buy('gear', 4, 25);
  if (h.cure && (s.nations[n].stock?.medicine ?? 0) < 4) buy('medicine', 6, 20);
  // 4) a research pact with a willing nation (AI leaders sign among themselves)
  if (!h.cure && pactPartners(s, n).length < (me.major ? 4 : 2) && s.clock.hours >= 72) {
    const partners = new Set(pactPartners(s, n));
    const cands = Object.keys(s.nations).filter((x) => x !== n && !isHuman(s, x) && s.nations[x].alive && !partners.has(x))
      .sort((x, y) => Number(s.nations[y].major) - Number(s.nations[x].major) || getRel(s, n, y) - getRel(s, n, x) || (x < y ? -1 : 1));
    for (const x of cands.slice(0, 8)) {
      const terms = { type: 'research' as const, from: n, to: x };
      if (validateTerms(s, terms) || willingness(s, world, terms, n).score < ACCEPT_LEAN || willingness(s, world, terms, x).score < ACCEPT_LEAN) continue;
      s = sign(s, apply, terms);
      break;
    }
  }
  // 5) the cure, for pact partners, allies and friends (players must be good friends)
  if (h.cure) {
    const want = Object.keys(s.nations).filter((x) => x !== n && s.nations[x].alive && !healthOf(s, x).cure &&
      (allied(s, n, x) || getRel(s, n, x) >= (isHuman(s, x) ? 40 : 20)))
      .sort((x, y) => getRel(s, n, y) - getRel(s, n, x) || (x < y ? -1 : 1))[0];
    if (want) run({ type: 'shareCure', to: want });
  }
  // 6) a rich nation helps a sick ally or friend
  if ((s.nations[n].treasury ?? 0) > 160) {
    const sick = Object.keys(s.nations).filter((x) => x !== n && s.nations[x].alive && (allied(s, n, x) || getRel(s, n, x) >= 40) && nationHealth(s, world, x).sickShare >= 0.03).sort()[0];
    if (sick) run({ type: 'sendAid', to: sick, what: 'money', amount: 25 });
  }
  return s;
}

/** Two AI nations agree on terms: propose and accept in one go. */
function sign(s: GameState, apply: Apply, terms: ProposalTerms): GameState {
  const proposed = apply(s, { action: { type: 'propose', terms }, actor: terms.from });
  if (proposed === s) return s;
  const p = proposed.proposals[proposed.proposals.length - 1];
  return apply(proposed, { action: { type: 'respond', proposal: p.id, accept: true }, actor: terms.to });
}

/** Monthly: enemies grow more bitter, allies warmer, everyone else slowly drifts back to neutral. */
function driftRelations(state: GameState): GameState {
  let s = state;
  for (const key of Object.keys(state.relations).sort()) {
    const [a, b] = key.split('|');
    if (!s.nations[a]?.alive || !s.nations[b]?.alive) continue;
    const v = getRel(s, a, b);
    if (atWar(s, a, b)) s = addRelation(s, a, b, -2);
    else if (allied(s, a, b)) { if (v < 60) s = addRelation(s, a, b, 2); }
    else if (v !== 0) s = addRelation(s, a, b, v > 0 ? -1 : 1);
  }
  return s;
}
