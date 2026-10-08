import type { Command } from './actions';
import { ACCEPT_LEAN, militaryPower, validateTerms, willingness } from './diplomacy';
import { addRelation, getRel } from './events';
import { fleetPower, fleetsByProvince, garrisonPower, homePort, isFleet, seaDenied, strikeError } from './military';
import { allied, atWar, cobelligerents, friendly } from './queries';
import { nextRandom } from './rng';
import type { Army, GameState, NationId, ProvinceId } from './types';
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

export function aiTick(state: GameState, world: World, apply: Apply): GameState {
  const ticksPerDay = Math.max(1, Math.round(24 / state.clock.tickHours));
  const slot = Math.floor((state.clock.hours % 24) / state.clock.tickHours);
  const day = Math.floor(state.clock.hours / 24);
  const ids = Object.keys(state.nations).filter((n) => state.nations[n].alive && n !== state.playerNation).sort();
  let s = state;
  ids.forEach((n, i) => {
    if (i % ticksPerDay !== slot || !s.nations[n]?.alive) return;
    s = planArmies(s, world, n, apply, day);
    s = planFleets(s, world, n, apply, day);
    if ((day + i) % 7 === 0) s = strategize(s, world, n, apply, day);
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
  const needs = Object.keys(s.provinces)
    .filter((p) => owner(p) === n)
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
  const reachable = new Set([...byLand, ...seaOnly].filter((t) => inReach(t) && (!cautious || s.provinces[t].core === n || !outclassed(owner(t)))));
  const targets = [...reachable]
    .map((t) => {
      const defense = ((enemyDefAt.get(t) ?? 0) + garrisonPower(s, t)) * 1.2;
      const support = world.provinces[t].links.reduce((x, l) => x + (enemyAt.get(l.to) ?? 0) * 0.8, 0); // neighbours reinforce
      // capitals and our own lost provinces (above all our old capital) are worth the most
      const lost = s.provinces[t].core === n;
      const value = 1 + (s.nations[owner(t)]?.capital === t ? 4 : 0) + (lost ? 3 : 0) + Math.sqrt(world.provinces[t].area) / 20;
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

/** Carriers and missile ships hit the strongest enemy force in range, preferring the battle lines. */
function aiStrike(s: GameState, world: World, f: Army, apply: Apply, isEnemy: (o: NationId) => boolean): GameState {
  const strike = world.unitTypes[f.unitType]?.strike;
  if (!strike || f.progress > 0 || (f.readyAt ?? 0) > s.clock.hours) return s;
  const value = new Map<ProvinceId, number>();
  for (const a of Object.values(s.armies)) {
    if (!isEnemy(a.owner) || a.progress > 0 || dist(world, f.location, a.location) > strike.range) continue;
    const engaged = s.battles[a.location] !== undefined ? 2 : 1;
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
  const player = s.playerNation;
  let r: number;

  // 1) honour alliances: join an ally that is defending against an aggressor (if not busy elsewhere)
  const busy = alive.some((x) => atWar(s, n, x));
  for (const w of busy ? [] : s.wars) {
    const allyDefending = w.defenders.find((d) => d !== n && allied(s, n, d));
    if (!allyDefending || w.attackers.includes(n) || w.defenders.includes(n)) continue;
    const aggressor = w.attackers[0];
    if (!aggressor || friendly(s, n, aggressor)) continue;
    // only answer a call to arms against an aggressor we actually border
    const borders = Object.keys(s.provinces).some((p) => s.provinces[p].owner === n &&
      world.provinces[p].links.some((l) => s.provinces[l.to].owner === aggressor));
    if (!borders) continue;
    [r, s] = rand(s);
    const chance = getRel(s, n, aggressor) < 0 ? 0.55 : 0.2;
    if (r < chance) s = apply(s, { action: { type: 'declareWar', attacker: n, defender: aggressor }, actor: n });
    break;
  }

  // 2) make peace with AI enemies when both sides want it (the player negotiates in person)
  for (const e of alive) {
    if (e === player || !atWar(s, n, e)) continue;
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
      if (m === player || allied(s, n, m) || atWar(s, n, m) || cobelligerents(s, n, m)) continue;
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
    const needed = c === player ? 2.2 : 1.6; // the AI picks on the player only with a clear edge
    if (ratio < needed) continue;
    const score = (ratio - needed) * 10 - rel / 5 - (bound ? 15 : 0) - (s.nations[c].major ? 5 : 0);
    if (!best || score > best.score) best = { target: c, score };
  }
  if (!best) return s;
  [r, s] = rand(s);
  if (r < me.aggression * 0.3 * (s.rules.warAppetite ?? 1)) {
    const before = s;
    s = apply(s, { action: { type: 'declareWar', attacker: n, defender: best.target }, actor: n });
    if (s !== before) s = { ...s, ai: { ...s.ai, lastWarAt: s.clock.hours } };
  }
  return s;
}

/** Two AI nations agree on terms: propose and accept in one go. */
function sign(s: GameState, apply: Apply, terms: { type: 'peace' | 'alliance'; from: NationId; to: NationId }): GameState {
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
