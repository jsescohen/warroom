import type { Action } from './actions';
import { militaryPower, willingness } from './diplomacy';
import { findPath, garrisonMax, garrisonOf, garrisonPower, isFleet, seaPower } from './military';
import { allied, atWar, friendly, getRelation } from './queries';
import type { GameState, NationId, ProvinceId } from './types';
import { treatyName } from './war';
import type { World } from './world';

/**
 * Pure game-side half of the AI Assessor: decides which orders are "major" and computes a
 * deterministic staff estimate. The estimate is shown instantly, used as facts in the LLM
 * prompt, and is the fallback whenever the AI is slow or unavailable.
 */

export type AssessorMode = 'major' | 'all' | 'off';
export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Extreme';

export type MajorKind =
  | 'declareWar' | 'attackCapital' | 'navalInvasion' | 'newFront' | 'attack'
  | 'breakTreaty' | 'demandTerritory' | 'jointWar';

export interface MajorAction {
  kind: MajorKind;
  action: Action;
  actor: NationId;
  target: NationId;
  /** First enemy province on the route, for attacks. */
  province?: ProvinceId;
  /** Short human description: "Declare war on France", "Naval invasion of Kent". */
  label: string;
}

export interface Estimate {
  successChance: number; // 0..100
  /** What the chance means ("Chance of success", "Chance they comply"); null hides it. */
  chanceLabel: string | null;
  risk: RiskLevel;
  ourPower: number;
  theirPower: number;
  /** Nations not yet at war with us that would likely fight us after this. */
  likelyEnemies: NationId[];
  brokenTreaties: { type: string; with: NationId[] }[];
  relationHits: { nation: NationId; delta: number }[];
  notes: string[];
}

const KIND_LABEL: Record<MajorKind, string> = {
  declareWar: 'Declaration of war',
  attackCapital: 'Assault on a capital',
  navalInvasion: 'Naval invasion',
  newFront: 'New offensive',
  attack: 'Attack order',
  breakTreaty: 'Breaking a treaty',
  demandTerritory: 'Ultimatum',
  jointWar: 'Joint war',
};
export const kindLabel = (k: MajorKind) => KIND_LABEL[k];

/** Returns the major action an order represents, or null if it can go through without review. */
export function classifyMajor(s: GameState, world: World, action: Action, actor: NationId, mode: AssessorMode): MajorAction | null {
  const name = (id: ProvinceId) => world.provinces[id]?.name ?? id;
  if (action.type === 'declareWar') {
    return { kind: 'declareWar', action, actor, target: action.defender, label: `Declare war on ${s.nations[action.defender].name}` };
  }
  const nation = (id: NationId) => s.nations[id]?.shortName ?? id;
  if (action.type === 'cancelTreaty') {
    const t = s.treaties.find((x) => x.id === action.treaty);
    if (!t) return null;
    const others = t.parties.filter((p) => p !== actor);
    return { kind: 'breakTreaty', action, actor, target: others[0], label: `Break the ${treatyName(t.type)} with ${others.map(nation).join(', ')}` };
  }
  if (action.type === 'propose' && action.terms.type === 'demand') {
    const t = action.terms;
    return { kind: 'demandTerritory', action, actor, target: t.to, label: `Demand that ${nation(t.to)} cede ${(t.take ?? []).map(name).join(', ')}` };
  }
  if (action.type === 'propose' && action.terms.type === 'joint-war' && action.terms.target) {
    const t = action.terms;
    return { kind: 'jointWar', action, actor, target: t.target!, label: `Propose a joint war on ${nation(t.target!)} to ${nation(t.to)}` };
  }
  if (action.type === 'respond' && action.accept) {
    const p = s.proposals.find((x) => x.id === action.proposal);
    if (p?.type === 'joint-war' && p.target && !atWar(s, actor, p.target))
      return { kind: 'jointWar', action, actor, target: p.target, label: `Join ${nation(p.from)} in a war on ${nation(p.target)}` };
    return null;
  }
  if (action.type !== 'moveArmy' || mode === 'off') return null;
  const army = s.armies[action.army];
  if (!army || isFleet(world, army.unitType)) return null; // fleets sail freely: no staff estimate
  const route = findPath(s, world, army.owner, army.unitType, army.location, action.to);
  if (!route) return null;
  // first enemy province on the route is what is being attacked
  let prev = army.location;
  for (const p of route.path) {
    const owner = s.provinces[p].owner;
    const sea = world.provinces[prev].links.find((l) => l.to === p)?.sea ?? false;
    prev = p;
    if (!atWar(s, actor, owner)) continue;
    const base = { action, actor, target: owner, province: p };
    if (s.nations[owner]?.capital === p) return { ...base, kind: 'attackCapital', label: `Assault on ${name(p)}, capital of ${s.nations[owner].shortName}` };
    if (sea) return { ...base, kind: 'navalInvasion', label: `Naval invasion of ${name(p)} (${s.nations[owner].shortName})` };
    const presence = Object.values(s.armies).some((a) => a.owner === actor && s.provinces[a.location].owner === owner);
    if (!presence) return { ...base, kind: 'newFront', label: `Open an offensive against ${s.nations[owner].shortName} at ${name(p)}` };
    if (mode === 'all') return { ...base, kind: 'attack', label: `Attack ${name(p)} (${s.nations[owner].shortName})` };
    return null;
  }
  return null;
}

const unitPower = (s: GameState, world: World, nation: NationId) =>
  Object.values(s.armies)
    .filter((a) => a.owner === nation)
    .reduce((sum, a) => {
      const u = world.unitTypes[a.unitType];
      return sum + a.strength * (s.nations[nation]?.quality ?? 1) * ((u?.attack ?? 3) + (u?.defense ?? 3)) / 2;
    }, 0);

/** Deterministic staff estimate for a major action. */
export function estimate(s: GameState, world: World, m: MajorAction): Estimate {
  if (m.kind === 'breakTreaty') return breakTreatyEstimate(s, world, m);
  if (m.kind === 'demandTerritory') return demandEstimate(s, world, m);
  const notes: string[] = [];
  const target = s.nations[m.target];
  const brokenTreaties: Estimate['brokenTreaties'] = [];
  const relationHits: Estimate['relationHits'] = [];
  let likelyEnemies: NationId[] = [];
  let ours: number;
  let theirs: number;

  if (m.kind === 'declareWar' || m.kind === 'jointWar') {
    // who fights on the target's side: alliance partners, plus close friends who already dislike us
    const alive = Object.values(s.nations).filter((n) => n.alive && n.id !== m.actor && n.id !== m.target).map((n) => n.id);
    likelyEnemies = alive.filter((n) => !atWar(s, m.actor, n) && !friendly(s, m.actor, n) &&
      (allied(s, m.target, n) || (getRelation(s, m.target, n) >= 40 && getRelation(s, m.actor, n) <= -20)));
    for (const t of s.treaties.filter((t) => t.parties.includes(m.actor) && t.parties.includes(m.target))) {
      brokenTreaties.push({ type: t.type, with: t.parties.filter((p) => p !== m.actor) });
      for (const p of t.parties) if (p !== m.actor && p !== m.target) relationHits.push({ nation: p, delta: -30 });
    }
    relationHits.push({ nation: m.target, delta: Math.min(-40, -50 - getRelation(s, m.actor, m.target)) });
    for (const a of likelyEnemies) if (allied(s, m.target, a)) relationHits.push({ nation: a, delta: -15 });

    const partner = m.action.type === 'propose' ? m.action.terms.to : m.action.type === 'respond' ? s.proposals.find((p) => p.id === (m.action as { proposal: string }).proposal)?.from : undefined;
    const ourSide = [m.actor, ...Object.keys(s.nations).filter((n) => n !== m.actor && (allied(s, m.actor, n) || n === partner) && s.nations[n].alive)];
    if (partner) notes.push(`${s.nations[partner]?.shortName} fights alongside us.`);
    // allies only partly commit; nations already fighting us split their strength
    ours = unitPower(s, world, m.actor) + ourSide.slice(1).reduce((x, n) => x + unitPower(s, world, n) * 0.5, 0);
    theirs = unitPower(s, world, m.target) + likelyEnemies.reduce((x, n) => x + unitPower(s, world, n) * (allied(s, m.target, n) ? 0.7 : 0.35), 0);
    const existing = Object.keys(s.nations).filter((n) => atWar(s, m.actor, n));
    if (existing.length) {
      notes.push(`Already at war with ${existing.length} nation${existing.length > 1 ? 's' : ''}.`);
      ours *= 1 / (1 + existing.length * 0.25);
    }
    if (target.capital) {
      const garrison = Object.values(s.armies).filter((a) => a.location === target.capital && a.owner === m.target).length;
      notes.push(`${target.shortName}'s capital is held by ${garrison} arm${garrison === 1 ? 'y' : 'ies'}.`);
    }
    const border = Object.keys(s.provinces).some((p) => s.provinces[p].owner === m.actor &&
      world.provinces[p].links.some((l) => !l.sea && s.provinces[l.to].owner === m.target));
    notes.push(border ? 'We share a land border.' : 'No land border: any invasion must cross the sea or allied territory.');
    if (!border) ours *= 0.75;
  } else {
    // local battle: our forces converging vs defenders in and around the target province
    const p = m.province!;
    const near = new Set([p, ...world.provinces[p].links.map((l) => l.to)]);
    const army = s.armies[(m.action as { army: string }).army];
    const land = (a: { unitType: string }) => !isFleet(world, a.unitType);
    const ourArmies = Object.values(s.armies).filter((a) => land(a) && a.owner === m.actor && (a.id === army?.id || (near.has(a.location) && a.progress === 0)));
    const theirArmies = Object.values(s.armies).filter((a) => land(a) && atWar(s, m.actor, a.owner) && near.has(a.location));
    const pw = (list: typeof ourArmies, defending: boolean) => list.reduce((x, a) => {
      const u = world.unitTypes[a.unitType];
      const inPlace = a.location === p ? 1 : 0.5;
      return x + a.strength * (defending ? u?.defense ?? 3 : u?.attack ?? 3) * inPlace;
    }, 0);
    ours = pw(ourArmies, false);
    const garrison = garrisonPower(s, p);
    theirs = pw(theirArmies, true) * 1.2 * (s.nations[m.target]?.capital === p ? 1.25 : 1) + garrison;
    if (m.kind === 'navalInvasion') {
      ours *= 0.8;
      notes.push('Amphibious landing: troops arrive slowly over sea lanes.');
      const { own, enemy } = seaPower(s, world, m.actor, p);
      if (enemy > 0) notes.push(enemy > own * 1.2 ? 'Enemy fleets control these waters: the crossing will be blocked or the convoy sunk.' : 'Enemy fleets are near, but ours hold the sea.');
    }
    notes.push(`The local garrison is ${garrisonOf(s, p) >= garrisonMax(s, p) - 0.05 ? 'at full strength' : 'weakened'} (${garrisonOf(s, p).toFixed(1)}).`);
    notes.push(`${theirArmies.length} enemy arm${theirArmies.length === 1 ? 'y' : 'ies'} in or next to ${world.provinces[p].name}; ${ourArmies.length} of ours can join.`);
    if (theirs === 0) notes.push('The province appears undefended.');
  }

  const successChance = Math.round(Math.max(3, Math.min(97, 100 * ours ** 1.5 / (ours ** 1.5 + theirs ** 1.5 || 1))));
  const majorJoiners = likelyEnemies.filter((n) => s.nations[n].major).length;
  const score = ((100 - successChance) / 100) * 2.2 + likelyEnemies.length * 0.25 + majorJoiners * 0.8 + brokenTreaties.length * 0.8;
  const risk: RiskLevel = score < 0.9 ? 'Low' : score < 1.7 ? 'Medium' : score < 2.8 ? 'High' : 'Extreme';
  return { successChance, chanceLabel: 'Chance of success', risk, ourPower: Math.round(ours), theirPower: Math.round(theirs), likelyEnemies, brokenTreaties, relationHits, notes };
}

function breakTreatyEstimate(s: GameState, world: World, m: MajorAction): Estimate {
  const t = s.treaties.find((x) => x.id === (m.action as { treaty: string }).treaty)!;
  const others = t.parties.filter((p) => p !== m.actor);
  const ours = militaryPower(s, world, m.actor);
  const theirs = others.reduce((x, n) => x + militaryPower(s, world, n), 0);
  const notes = [`${others.map((n) => s.nations[n].shortName).join(', ')} will remember this betrayal.`];
  if (t.type === 'non-aggression' || t.type === 'peace' || t.type === 'ceasefire') notes.push('Nothing will then stop them attacking you.');
  if (t.type === 'alliance') notes.push('You lose any help they would have given in your wars.');
  const score = 0.8 + (theirs > ours ? 0.9 : 0.2) + (t.type === 'alliance' ? 0.4 : 0) + (t.type === 'ceasefire' ? 0.6 : 0);
  return {
    successChance: 100, chanceLabel: null, risk: riskFrom(score), ourPower: Math.round(ours), theirPower: Math.round(theirs),
    likelyEnemies: [], brokenTreaties: [{ type: t.type, with: others }], relationHits: others.map((n) => ({ nation: n, delta: -30 })), notes,
  };
}

function demandEstimate(s: GameState, world: World, m: MajorAction): Estimate {
  const terms = (m.action as Extract<Action, { type: 'propose' }>).terms;
  const w = willingness(s, world, terms);
  const successChance = Math.round(Math.max(3, Math.min(97, 45 + w.score * 0.8)));
  const backers = Object.keys(s.nations).filter((n) => n !== m.actor && n !== terms.to && allied(s, terms.to, n) && !atWar(s, m.actor, n));
  const notes = [...w.reasons.slice(0, 3), 'Relations sour whatever the answer; if refused, only war can enforce it.'];
  const score = ((100 - successChance) / 100) * 1.8 + backers.length * 0.4 + 0.3;
  return {
    successChance, chanceLabel: 'Chance they comply', risk: riskFrom(score),
    ourPower: Math.round(militaryPower(s, world, m.actor)), theirPower: Math.round(militaryPower(s, world, terms.to)),
    likelyEnemies: backers, brokenTreaties: [], relationHits: [{ nation: terms.to, delta: -10 }], notes,
  };
}

const riskFrom = (score: number): RiskLevel => (score < 0.9 ? 'Low' : score < 1.7 ? 'Medium' : score < 2.8 ? 'High' : 'Extreme');
