import { addGrievance, addRelation, getRel, logEvent, setRelation } from './events';
import { allied, cobelligerents } from './queries';
import { formatShortDate } from './time';
import { isHuman, type GameState, type NationId, type Treaty } from './types';
import type { World } from './world';

/** War and treaty-breaking rules shared by actions and diplomacy. Pure. */

export function sideOf(state: GameState, a: NationId, b: NationId): 'enemies' | 'cobelligerents' | null {
  for (const w of state.wars) {
    const aAtt = w.attackers.includes(a), aDef = w.defenders.includes(a);
    const bAtt = w.attackers.includes(b), bDef = w.defenders.includes(b);
    if ((aAtt && bDef) || (aDef && bAtt)) return 'enemies';
    if ((aAtt && bAtt) || (aDef && bDef)) return 'cobelligerents';
  }
  return null;
}

export const treatyName = (t: Treaty['type']) =>
  ({ alliance: 'alliance', 'non-aggression': 'non-aggression pact', ceasefire: 'ceasefire', peace: 'peace treaty', trade: 'trade agreement' })[t];

/**
 * `nation` leaves a treaty. If it was a promise to another party (alliance, pact, ceasefire, peace),
 * every other party trusts it less and remembers the betrayal.
 */
export function leaveTreaty(state: GameState, nation: NationId, treaty: Treaty, reason: string): GameState {
  const name = (id: NationId) => state.nations[id]?.shortName ?? id;
  let s: GameState = {
    ...state,
    treaties: state.treaties.flatMap((t) => {
      if (t.id !== treaty.id) return [t];
      const parties = t.parties.filter((p) => p !== nation);
      return parties.length >= 2 ? [{ ...t, parties }] : [];
    }),
  };
  const others = treaty.parties.filter((p) => p !== nation);
  for (const p of others) {
    s = addRelation(s, nation, p, -30);
    s = addGrievance(s, p, nation, `${formatShortDate(s.clock)}: broke its ${treatyName(treaty.type)} with us${reason ? ` (${reason})` : ''}.`);
  }
  return logEvent(s, 'treaty-broken', `${name(nation)} tears up its ${treatyName(treaty.type)} with ${others.map(name).join(', ')}.`, {
    nations: treaty.parties,
    important: treaty.parties.some((p) => isHuman(s, p)),
  });
}

export function declareWar(state: GameState, attacker: NationId, defender: NationId): GameState {
  const name = (id: NationId) => state.nations[id].shortName;
  let s = state;

  // Treaties binding the two nations are broken by the attacker.
  for (const t of s.treaties.filter((t) => t.parties.includes(attacker) && t.parties.includes(defender))) {
    s = leaveTreaty(s, attacker, t, `to attack ${name(defender)}`);
  }

  // Join an existing war only to fight alongside an ally or co-belligerent already in it;
  // otherwise this is a separate war against the defender alone.
  const isFriend = (x: NationId) => x !== attacker && (allied(s, attacker, x) || cobelligerents(s, attacker, x));
  const idx = s.wars.findIndex((w) =>
    (w.attackers.includes(defender) && w.defenders.some(isFriend)) || (w.defenders.includes(defender) && w.attackers.some(isFriend)));
  if (idx >= 0) {
    const w = s.wars[idx];
    const joined = w.attackers.includes(defender) ? { ...w, defenders: [...w.defenders, attacker] } : { ...w, attackers: [...w.attackers, attacker] };
    s = { ...s, wars: s.wars.map((x, i) => (i === idx ? joined : x)) };
  } else {
    s = { ...s, wars: [...s.wars, { id: `w${s.nextId}`, attackers: [attacker], defenders: [defender], startedAt: s.clock.hours }], nextId: s.nextId + 1 };
  }

  s = setRelation(s, attacker, defender, Math.min(getRel(s, attacker, defender) - 40, -50));
  s = addGrievance(s, defender, attacker, `${formatShortDate(s.clock)}: declared war on us.`);
  const defenderAllies = s.treaties.filter((t) => t.type === 'alliance' && t.parties.includes(defender)).flatMap((t) => t.parties);
  for (const ally of new Set(defenderAllies)) if (ally !== defender && ally !== attacker) s = addRelation(s, attacker, ally, -15);

  const important = isHuman(s, attacker) || isHuman(s, defender) || (!!s.nations[attacker]?.major && !!s.nations[defender]?.major);
  return logEvent(s, 'war', `${name(attacker)} declares war on ${name(defender)}!`, { nations: [attacker, defender], important });
}

/**
 * `a` and `b` stop fighting each other. In coalition wars the member whose side is larger leaves
 * (the coalition partner makes a separate peace); a war with an empty side ends.
 * Armies left in the other's territory withdraw home.
 */
export function makePeace(state: GameState, world: World, a: NationId, b: NationId): GameState {
  const wars = state.wars
    .map((w) => {
      const aAtt = w.attackers.includes(a), bAtt = w.attackers.includes(b);
      const opposite = (aAtt && w.defenders.includes(b)) || (bAtt && w.defenders.includes(a));
      if (!opposite) return w;
      const sideA = aAtt ? w.attackers : w.defenders;
      const sideB = bAtt ? w.attackers : w.defenders;
      const leaver = sideA.length > sideB.length ? a : b;
      return { ...w, attackers: w.attackers.filter((n) => n !== leaver), defenders: w.defenders.filter((n) => n !== leaver) };
    })
    .filter((w) => w.attackers.length && w.defenders.length);
  let s: GameState = { ...state, wars };
  s = withdrawArmies(s, world, a, b);
  s = withdrawArmies(s, world, b, a);
  return s;
}

/** Armies of `nation` standing in `other`'s territory march to the nearest friendly province. */
export function withdrawArmies(s: GameState, world: World, nation: NationId, other: NationId): GameState {
  const armies = { ...s.armies };
  for (const a of Object.values(armies)) {
    if (a.owner !== nation) continue;
    const here = s.provinces[a.location].owner;
    const onPath = a.path.some((p) => s.provinces[p].owner === other);
    if (here !== other && !onPath) continue;
    if (here !== other) { armies[a.id] = { ...a, path: [], progress: 0 }; continue; }
    // BFS to the nearest province owned by the nation
    const seen = new Set([a.location]);
    let frontier = [a.location];
    let home: string | null = null;
    while (frontier.length && !home) {
      const next: string[] = [];
      for (const p of frontier) for (const l of world.provinces[p].links) {
        if (seen.has(l.to)) continue;
        seen.add(l.to);
        if (s.provinces[l.to].owner === nation) { home = l.to; break; }
        next.push(l.to);
      }
      frontier = next;
    }
    home ??= s.nations[nation]?.capital ?? null;
    if (home) armies[a.id] = { ...a, location: home, path: [], progress: 0 };
  }
  return { ...s, armies };
}
