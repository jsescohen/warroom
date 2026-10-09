import { addGrievance, addRelation, getRel, logEvent, log } from './events';
import { accessOf, needsOf, producedBy, usedBy } from './economy';
import { setOwner } from './military';
import { healthOf, nationHealth, pactPartners, worldSickShare } from './pandemic';
import { allied, atWar, friendly, provincesOf } from './queries';
import { formatShortDate } from './time';
import { isHuman, lastRead, relationKey, type AgreementType, type GameState, type NationId, type Proposal, type ProposalTerms, type ProvinceId, type Treaty } from './types';
import { declareWar, makePeace } from './war';
import type { World } from './world';

/** Diplomacy rules: what can be agreed, what it does, and how willing a leader is. All pure. */

export const PROPOSAL_DAYS = 7;
export const NAP_DAYS = 180;
export const CEASEFIRE_DAYS = 30;
export const PEACE_TRUCE_DAYS = 365;

export const AGREEMENT_LABEL: Record<AgreementType, string> = {
  alliance: 'Alliance',
  'non-aggression': 'Non-aggression pact',
  ceasefire: 'Ceasefire',
  peace: 'Peace treaty',
  territory: 'Territory exchange',
  'joint-war': 'Joint war',
  demand: 'Ultimatum',
  trade: 'Trade agreement',
  research: 'Research pact',
};

/** Most research pacts a nation keeps at once. */
export const MAX_PACTS = 5;

/** Most money a trade agreement can move each month. */
export const MAX_TRADE_GOLD = 30;

const treatyBetween = (s: GameState, a: NationId, b: NationId, type: Treaty['type']) =>
  s.treaties.find((t) => t.type === type && t.parties.includes(a) && t.parties.includes(b));

/** Provinces of `owner` that touch `other` by land or a short sea lane, excluding the capital. */
export function borderProvinces(s: GameState, world: World, owner: NationId, other: NationId): ProvinceId[] {
  return Object.keys(s.provinces).filter((p) =>
    s.provinces[p].owner === owner && s.nations[owner]?.capital !== p &&
    world.provinces[p].links.some((l) => s.provinces[l.to].owner === other));
}

/** Returns why the terms are impossible right now, or null if they are valid. */
export function validateTerms(s: GameState, t: ProposalTerms): string | null {
  const name = (id: NationId) => s.nations[id]?.shortName ?? id;
  if (!s.nations[t.from]?.alive || !s.nations[t.to]?.alive) return 'Unknown nation';
  if (t.from === t.to) return 'A nation cannot negotiate with itself';
  const war = atWar(s, t.from, t.to);
  const owns = (ids: ProvinceId[] | undefined, n: NationId) => (ids ?? []).every((p) => s.provinces[p]?.owner === n);
  const noCapital = (ids: ProvinceId[] | undefined) => !(ids ?? []).some((p) => s.nations[s.provinces[p]?.owner]?.capital === p);
  if (s.disease && (t.type === 'joint-war' || t.type === 'demand')) return 'There are no wars in a pandemic: the enemy is the virus';
  switch (t.type) {
    case 'research':
      if (!s.disease) return 'Research pacts are for fighting a pandemic';
      if (treatyBetween(s, t.from, t.to, 'research')) return 'Already in a research pact';
      if (pactPartners(s, t.from).length >= MAX_PACTS) return `${name(t.from)} is already in ${MAX_PACTS} research pacts`;
      if (pactPartners(s, t.to).length >= MAX_PACTS) return `${name(t.to)} is already in ${MAX_PACTS} research pacts`;
      return null;
    case 'alliance':
      if (war) return `You are at war with ${name(t.to)}`;
      if (allied(s, t.from, t.to)) return 'Already allied';
      return null;
    case 'non-aggression':
      if (war) return `You are at war with ${name(t.to)}: propose a ceasefire or peace`;
      if (treatyBetween(s, t.from, t.to, 'non-aggression')) return 'A pact is already in force';
      return null;
    case 'ceasefire':
      return war ? null : `You are not at war with ${name(t.to)}`;
    case 'peace':
      if (!war) return `You are not at war with ${name(t.to)}`;
      if (!owns(t.give, t.from) || !owns(t.take, t.to)) return 'Those provinces have changed hands';
      if (!noCapital(t.give) || !noCapital(t.take)) return 'Capitals cannot be traded';
      return null;
    case 'territory':
      if (war) return 'Territory can only be traded in peacetime (use a peace treaty instead)';
      if (!(t.give?.length || t.take?.length)) return 'Pick at least one province';
      if (!owns(t.give, t.from) || !owns(t.take, t.to)) return 'Those provinces have changed hands';
      if (!noCapital(t.give) || !noCapital(t.take)) return 'Capitals cannot be traded';
      return null;
    case 'demand':
      if (war) return 'You are already at war';
      if (!t.take?.length) return 'Name the provinces you demand';
      if (!owns(t.take, t.to)) return 'Those provinces have changed hands';
      if (!noCapital(t.take)) return 'You cannot demand a capital';
      return null;
    case 'trade': {
      if (war) return `You are at war with ${name(t.to)}`;
      const g = t.gold ?? 0;
      if (!t.sell && !t.buy) return 'Pick a resource to sell or to buy';
      if (!Number.isFinite(g) || Math.abs(g) > MAX_TRADE_GOLD) return `Payments are limited to ${MAX_TRADE_GOLD} a month`;
      if (t.sell && t.sell === t.buy) return 'Pick two different resources';
      const dup = s.treaties.some((x) => x.type === 'trade' && x.parties.includes(t.from) && x.parties.includes(t.to) &&
        ((t.sell && (x.parties[0] === t.from ? x.trade?.sell : x.trade?.buy) === t.sell) || (t.buy && (x.parties[0] === t.from ? x.trade?.buy : x.trade?.sell) === t.buy)));
      return dup ? 'You already trade that resource with them' : null;
    }
    case 'joint-war':
      if (!t.target || !s.nations[t.target]?.alive) return 'Pick a common enemy';
      if (t.target === t.from || t.target === t.to) return 'Pick a third nation';
      if (war) return `You are at war with ${name(t.to)}`;
      if (atWar(s, t.from, t.target) && atWar(s, t.to, t.target)) return `You are both already at war with ${name(t.target)}`;
      return null;
  }
}

export function describeTerms(s: GameState, world: World, t: ProposalTerms): string {
  const n = (id: NationId) => s.nations[id]?.shortName ?? id;
  const ps = (ids?: ProvinceId[]) => (ids ?? []).map((p) => world.provinces[p]?.name ?? p).join(', ');
  switch (t.type) {
    case 'alliance': return `${n(t.from)} and ${n(t.to)} form an alliance.`;
    case 'non-aggression': return `${n(t.from)} and ${n(t.to)} pledge not to attack each other for ${NAP_DAYS} days.`;
    case 'ceasefire': return `${n(t.from)} and ${n(t.to)} stop fighting for ${CEASEFIRE_DAYS} days. Armies withdraw.`;
    case 'peace': {
      const parts = [`${n(t.from)} and ${n(t.to)} make peace`];
      if (t.give?.length) parts.push(`${n(t.to)} receives ${ps(t.give)}`);
      if (t.take?.length) parts.push(`${n(t.from)} receives ${ps(t.take)}`);
      return `${parts.join('; ')}. Truce for ${PEACE_TRUCE_DAYS} days.`;
    }
    case 'territory':
      return [t.give?.length ? `${n(t.from)} cedes ${ps(t.give)}` : '', t.take?.length ? `${n(t.to)} cedes ${ps(t.take)}` : '']
        .filter(Boolean).join('; ') + '.';
    case 'demand': return `${n(t.from)} demands that ${n(t.to)} cede ${ps(t.take)}.`;
    case 'joint-war': return `${n(t.from)} and ${n(t.to)} go to war together against ${n(t.target!)}.`;
    case 'research': return `${n(t.from)} and ${n(t.to)} pool their research on a cure and share what they know of their outbreaks. Lasts until either side ends it.`;
    case 'trade': {
      const r = (id?: string) => world.resources[id ?? '']?.name ?? id;
      const parts = [t.sell ? `${n(t.from)} supplies ${r(t.sell)}` : '', t.buy ? `${n(t.to)} supplies ${r(t.buy)}` : ''];
      const g = t.gold ?? 0;
      if (g > 0) parts.push(`${n(t.from)} pays ${g} a month`);
      if (g < 0) parts.push(`${n(t.to)} pays ${-g} a month`);
      return `${parts.filter(Boolean).join('; ')}. Lasts until either side ends it.`;
    }
  }
}

/** Puts an accepted agreement into effect. Assumes validateTerms passed. */
export function applyAgreement(state: GameState, world: World, p: Proposal): GameState {
  const { from, to } = p;
  const days = (d: number) => state.clock.hours + d * 24;
  let s = state;
  const treaty = (type: Treaty['type'], expiresAt?: number) => {
    s = { ...s, treaties: [...s.treaties, { id: `t${s.nextId}`, type, parties: [from, to], signedAt: s.clock.hours, expiresAt }], nextId: s.nextId + 1 };
  };
  const transfer = (ids: ProvinceId[] | undefined, newOwner: NationId) => {
    for (const id of ids ?? []) s = setOwner(s, id, newOwner, log, world);
  };
  switch (p.type) {
    case 'alliance':
      treaty('alliance');
      s = addRelation(s, from, to, 15);
      break;
    case 'non-aggression':
      treaty('non-aggression', days(NAP_DAYS));
      s = addRelation(s, from, to, 10);
      break;
    case 'ceasefire':
      s = makePeace(s, world, from, to);
      treaty('ceasefire', days(CEASEFIRE_DAYS));
      s = addRelation(s, from, to, 10);
      break;
    case 'peace':
      s = makePeace(s, world, from, to);
      transfer(p.give, to);
      transfer(p.take, from);
      s = { ...s, treaties: s.treaties.filter((t) => !(t.type === 'ceasefire' && t.parties.includes(from) && t.parties.includes(to))) };
      treaty('peace', days(PEACE_TRUCE_DAYS));
      s = addRelation(s, from, to, 20);
      break;
    case 'territory':
      transfer(p.give, to);
      transfer(p.take, from);
      s = addRelation(s, from, to, 5);
      break;
    case 'demand':
      transfer(p.take, from);
      s = addRelation(s, from, to, -15);
      s = addGrievance(s, to, from, `${formatShortDate(s.clock)}: forced us to cede land.`);
      break;
    case 'trade':
      s = { ...s, treaties: [...s.treaties, { id: `t${s.nextId}`, type: 'trade', parties: [from, to], signedAt: s.clock.hours, trade: { sell: p.sell, buy: p.buy, gold: p.gold ?? 0 } }], nextId: s.nextId + 1 };
      s = addRelation(s, from, to, 5);
      break;
    case 'research':
      treaty('research');
      s = addRelation(s, from, to, 10);
      break;
    case 'joint-war':
      for (const n of [from, to]) if (!atWar(s, n, p.target!)) s = declareWar(s, n, p.target!);
      if (!treatyBetween(s, from, to, 'alliance')) treaty('alliance');
      s = addRelation(s, from, to, 15);
      break;
  }
  const name = (id: NationId) => s.nations[id]?.shortName ?? id;
  return logEvent(s, 'agreement', `${AGREEMENT_LABEL[p.type]} signed between ${name(from)} and ${name(to)}.`, {
    nations: [from, to],
    important: isHuman(s, from) || isHuman(s, to),
  });
}

// ---- willingness --------------------------------------------------------------------------------

export interface Willingness {
  score: number; // -100..100; > 20 lean accept, < -25 the game refuses regardless of the AI
  reasons: string[];
}

export const ACCEPT_FLOOR = -25;
export const ACCEPT_LEAN = 20;

export function militaryPower(s: GameState, world: World, n: NationId) {
  const q = s.nations[n]?.quality ?? 1;
  return Object.values(s.armies).filter((a) => a.owner === n).reduce((x, a) => {
    const u = world.unitTypes[a.unitType];
    return x + a.strength * q * ((u?.attack ?? 3) + (u?.defense ?? 3)) / 2;
  }, 0);
}

/** How inclined `responder` is to accept the terms (deterministic; shown to the AI as guidance). */
export function willingness(s: GameState, world: World, t: ProposalTerms, responder: NationId = t.to): Willingness {
  const other = responder === t.to ? t.from : t.to;
  const rel = getRel(s, responder, other);
  const reasons: string[] = [];
  const ratio = (militaryPower(s, world, other) + 1) / (militaryPower(s, world, responder) + 1); // >1: they are stronger
  const name = (id: NationId) => s.nations[id]?.shortName ?? id;
  const enemiesOf = (n: NationId) => Object.keys(s.nations).filter((x) => s.nations[x].alive && atWar(s, n, x));
  const common = enemiesOf(responder).filter((e) => atWar(s, other, e));
  const grudges = s.diplomacy.memories[responder]?.[other]?.grievances.length ?? 0;
  let score = rel;
  const add = (v: number, why: string) => { if (v) { score += v; reasons.push(`${why} (${v > 0 ? '+' : ''}${Math.round(v)})`); } };
  add(-grudges * 8, `${grudges} grievance${grudges === 1 ? '' : 's'} against ${name(other)}`);

  const valueOf = (ids?: ProvinceId[]) => (ids ?? []).reduce((x, p) => x + 1 + Math.sqrt(world.provinces[p].area) / 15, 0);

  switch (t.type) {
    case 'alliance':
      add(-25, 'alliances are a serious commitment');
      add(common.length * 25, common.length ? `common enemy: ${common.map(name).join(', ')}` : '');
      if (enemiesOf(other).length && !common.length) add(-20, `would be dragged into ${name(other)}'s wars`);
      break;
    case 'non-aggression':
      add(20, 'pacts cost little');
      if (ratio > 1.5) add(15, `${name(other)} is stronger`);
      if (enemiesOf(responder).length) add(10, 'busy with other wars');
      break;
    case 'ceasefire':
    case 'peace': {
      const losing = 1 / ratio < 0.7; // our power vs theirs
      const winning = 1 / ratio > 1.5;
      const gainForUs = t.type === 'peace' ? (responder === t.to ? valueOf(t.give) - valueOf(t.take) : valueOf(t.take) - valueOf(t.give)) : 0;
      if (losing) add(45, 'we are losing this war');
      if (winning) add(gainForUs > 0 ? -10 : -35, gainForUs > 0 ? 'winning, but the terms reward us' : 'we are winning');
      const days = (s.clock.hours - (s.wars.find((w) => (w.attackers.includes(responder) || w.defenders.includes(responder)))?.startedAt ?? s.clock.hours)) / 24;
      add(Math.min(25, days / 6), 'war weariness');
      const cap = s.nations[responder]?.capital;
      if (cap && Object.values(s.armies).some((a) => a.location === cap && a.owner === other)) add(30, 'enemy troops at our capital');
      if (t.type === 'peace') {
        add(gainForUs * 12, gainForUs >= 0 ? 'gains territory' : 'must cede territory');
      } else add(10, 'a ceasefire buys time');
      score += 15 - rel * 0.6; // at war, relations are a poor guide: soften their weight
      break;
    }
    case 'territory': {
      const gain = responder === t.to ? valueOf(t.give) - valueOf(t.take) : valueOf(t.take) - valueOf(t.give);
      add(gain * 18, gain >= 0 ? 'the exchange favours us' : 'the exchange costs us land');
      add(-10, 'land is rarely traded');
      break;
    }
    case 'demand': {
      add(-40, 'national pride');
      add(Math.max(-40, Math.min(70, (ratio - 1) * 30)), ratio > 1 ? `${name(other)} could crush us` : `${name(other)} is weaker than us`);
      add(-valueOf(t.take) * 10, 'size of the demand');
      if (allied(s, responder, other)) add(-20, 'demanded by an ally');
      const friends = Object.keys(s.nations).filter((x) => x !== other && allied(s, responder, x));
      if (friends.length) add(-friends.length * 10, 'our allies would back us');
      break;
    }
    case 'trade': {
      // what each side gets: a resource it lacks is worth most when its troops need it
      const gets = responder === t.to ? t.sell : t.buy;
      const gives = responder === t.to ? t.buy : t.sell;
      const giver = responder === t.to ? t.from : t.to;
      const access = accessOf(s, world, responder);
      const needed = new Set([...Object.values(s.armies).filter((a) => a.owner === responder).flatMap((a) => needsOf(world, a.unitType)), ...usedBy(world, s.nations[responder]?.units ?? [])]);
      if (gets) {
        const real = producedBy(s, world, giver).has(gets);
        const v = !real ? 0 : access.has(gets) ? 2 : needed.has(gets) ? 35 : 12;
        add(v, real ? `we would get ${world.resources[gets]?.name ?? gets}` : `${name(giver)} has no ${world.resources[gets]?.name ?? gets} to sell`);
      }
      if (gives) {
        if (!producedBy(s, world, responder).has(gives)) add(-60, `we produce no ${world.resources[gives]?.name ?? gives}`);
        else add(-4, `we supply ${world.resources[gives]?.name ?? gives}`);
        // a producer has only so much to spare
        const buyers = s.treaties.filter((x) => x.type === 'trade' && x.parties.includes(responder) && (x.parties[0] === responder ? x.trade?.sell : x.trade?.buy) === gives).length;
        if (buyers >= 3) add(-40, `already supplying ${buyers} nations`);
      }
      const money = (responder === t.to ? 1 : -1) * (t.gold ?? 0);
      add(money * 3, money >= 0 ? 'payment' : 'we must pay');
      add(12, 'trade benefits both sides');
      break;
    }
    case 'research': {
      add(15, 'fighting the disease together');
      const crisis = Math.min(35, Math.round(worldSickShare(s, world) * 700));
      add(crisis, 'the pandemic is spreading');
      const ours = nationHealth(s, world, responder);
      add(Math.min(20, Math.round(ours.sickShare * 500)), 'our own outbreak');
      if (s.nations[other]?.major) add(10, `${name(other)} has great labs`);
      if (rel <= -50) add(-10, 'deep distrust');
      if (pactPartners(s, responder).length >= 3) add(-15, 'already in several pacts');
      break;
    }
    case 'joint-war': {
      const target = t.target!;
      add(-getRel(s, responder, target) * 0.6, `feelings toward ${name(target)}`);
      add(-30, 'war is costly');
      if (atWar(s, responder, target)) add(45, `already fighting ${name(target)}`);
      const targetRatio = (militaryPower(s, world, target) + 1) / (militaryPower(s, world, responder) + militaryPower(s, world, other) + 1);
      add((1 - targetRatio) * 20, targetRatio < 1 ? 'together we are stronger' : `${name(target)} is formidable`);
      if (friendly(s, responder, target)) add(-50, `bound to ${name(target)}`);
      break;
    }
  }
  return { score: Math.round(Math.max(-100, Math.min(100, score))), reasons: reasons.filter((r) => !r.startsWith(' (')) };
}

/** Final say: the AI may refuse anything, but cannot accept terms its nation would never take. */
export function decideAcceptance(w: Willingness, aiSaysAccept: boolean | null | undefined): boolean {
  if (w.score < ACCEPT_FLOOR) return false;
  if (aiSaysAccept === true || aiSaysAccept === false) return aiSaysAccept;
  return w.score >= ACCEPT_LEAN;
}

// ---- AI-initiated contact -------------------------------------------------------------------------

export type InitiativeKind = 'offer' | 'warning' | 'ultimatum' | 'peace-feeler' | 'war-message';

export interface Initiative {
  from: NationId;
  kind: InitiativeKind;
  /** What the message should achieve, for the AI writer. */
  purpose: string;
  terms?: ProposalTerms;
}

const CONTACT_COOLDOWN_DAYS = 25;
/** A leader whose last letter got no reply waits this long before writing again. */
const UNANSWERED_DAYS = 90;
const GLOBAL_GAP_DAYS = 4;

/**
 * Picks at most one AI leader who wants to contact the player now. Deterministic.
 * (Declarations of war on the player are handled separately by the director.)
 */
export function pickInitiative(s: GameState, world: World): Initiative | null {
  const player = s.playerNation;
  if (!player || !s.nations[player]?.alive) return null;
  const now = s.clock.hours;
  const last = Object.values(s.diplomacy.lastContact);
  if (last.some((h) => now - h < GLOBAL_GAP_DAYS * 24)) return null;
  const myPower = militaryPower(s, world, player);
  const pending = (n: NationId) => s.proposals.some((p) => p.status === 'pending' && [p.from, p.to].includes(n) && [p.from, p.to].includes(player));

  const ids = Object.keys(s.nations).filter((n) => n !== player && s.nations[n].alive && !isHuman(s, n)).sort();
  const candidates: { score: number; init: Initiative }[] = [];
  for (const n of ids) {
    if (now - (s.diplomacy.lastContact[n] ?? -1e9) < CONTACT_COOLDOWN_DAYS * 24 || pending(n)) continue;
    // no letter after letter: wait until the last one was read, and for an answer a while longer
    const key = relationKey(n, player);
    const last = s.diplomacy.chats[key]?.at(-1);
    if (last && last.from === n && (last.id > lastRead(s, player, n) || now - last.at < UNANSWERED_DAYS * 24)) continue;
    const rel = getRel(s, n, player);
    const theirPower = militaryPower(s, world, n);
    const borders = borderProvinces(s, world, n, player).length > 0;
    const terms = (type: AgreementType, extra: Partial<ProposalTerms> = {}): ProposalTerms => ({ type, from: n, to: player, ...extra });

    // a pandemic: research pacts, calls for help, and the cure
    if (s.disease) {
      const name = s.disease.name;
      const pact = terms('research');
      if (!validateTerms(s, pact)) {
        const w = willingness(s, world, pact, n);
        if (w.score >= ACCEPT_LEAN) candidates.push({ score: w.score, init: { from: n, kind: 'offer', purpose: `${name} threatens every nation: propose a research pact to pool your work on a cure.`, terms: pact } });
      }
      const theirs = nationHealth(s, world, n);
      if (theirs.sickShare >= 0.03 && rel >= 10) candidates.push({ score: 15 + rel, init: { from: n, kind: 'offer', purpose: `Your country is being overwhelmed by ${name}: ask them for help (medicines, protective gear or money).` } });
      if (healthOf(s, player).cure && !healthOf(s, n).cure && rel >= -30) candidates.push({ score: 50 + rel, init: { from: n, kind: 'offer', purpose: `They have the cure for ${name} and you do not: ask them to share it with your people.` } });
      continue;
    }

    if (atWar(s, n, player)) {
      const w = willingness(s, world, terms('peace'), n);
      if (w.score > 35) candidates.push({ score: w.score, init: { from: n, kind: 'peace-feeler', purpose: 'You want out of this war: offer peace on the current lines.', terms: terms('peace') } });
      else if (w.score > 15) candidates.push({ score: w.score - 10, init: { from: n, kind: 'peace-feeler', purpose: 'Offer a temporary ceasefire to regroup.', terms: terms('ceasefire') } });
      continue;
    }
    const shared = Object.keys(s.nations).filter((e) => atWar(s, n, e) && atWar(s, player, e));
    if (shared.length && rel >= 15 && !allied(s, n, player)) {
      candidates.push({ score: 40 + rel, init: { from: n, kind: 'offer', purpose: `You share an enemy (${shared.map((e) => s.nations[e].shortName).join(', ')}): propose an alliance.`, terms: terms('alliance') } });
      continue;
    }
    if (borders && theirPower > myPower * 2 && rel <= -40 && provincesOf(s, player).length > 1) {
      const want = borderProvinces(s, world, player, n).slice(0, 2);
      if (want.length) {
        candidates.push({ score: 30 - rel, init: { from: n, kind: 'ultimatum', purpose: 'Issue an ultimatum: cede the named border provinces or face consequences.', terms: terms('demand', { take: want }) } });
        continue;
      }
    }
    if (borders && rel >= 5 && !s.treaties.some((t) => t.type === 'non-aggression' && t.parties.includes(n) && t.parties.includes(player)) && theirPower < myPower * 1.2) {
      candidates.push({ score: 10 + rel, init: { from: n, kind: 'offer', purpose: 'You are wary of this neighbour: propose a non-aggression pact.', terms: terms('non-aggression') } });
      continue;
    }
    if (borders && rel <= -50) candidates.push({ score: -rel - 20, init: { from: n, kind: 'warning', purpose: 'Send a stern warning about their conduct and your border.' } });
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0]?.init ?? null;
  return best && (!best.terms || validateTerms(s, best.terms) === null) ? best : null;
}

// ---- per-tick upkeep ----------------------------------------------------------------------------

/** Expires proposals and treaties. A lapsed ceasefire without a peace treaty means war again. */
export function diplomacyTick(state: GameState): GameState {
  let s = state;
  const now = s.clock.hours;
  if (s.proposals.some((p) => p.status === 'pending')) {
    s = {
      ...s,
      proposals: s.proposals.map((p) => {
        if (p.status !== 'pending') return p;
        if (p.expiresAt <= now) return { ...p, status: 'expired' as const };
        return validateTerms(s, p) ? { ...p, status: 'void' as const } : p;
      }),
    };
  }
  const expired = s.treaties.filter((t) => t.expiresAt !== undefined && t.expiresAt <= now);
  if (!expired.length) return s;
  s = { ...s, treaties: s.treaties.filter((t) => !expired.includes(t)) };
  const name = (id: NationId) => s.nations[id]?.shortName ?? id;
  for (const t of expired) {
    const [a, b] = t.parties;
    const involvesPlayer = t.parties.some((p) => isHuman(s, p));
    if (t.type === 'ceasefire' && s.nations[a]?.alive && s.nations[b]?.alive && !treatyBetween(s, a, b, 'peace') && !atWar(s, a, b)) {
      s = logEvent(s, 'ceasefire-ended', `The ceasefire between ${name(a)} and ${name(b)} expires. Fighting resumes.`, { nations: t.parties, important: involvesPlayer });
      s = declareWar(s, a, b);
    } else {
      s = logEvent(s, 'treaty-expired', `The ${t.type === 'non-aggression' ? 'non-aggression pact' : t.type} between ${t.parties.map(name).join(' and ')} expires.`, { nations: t.parties, important: involvesPlayer });
    }
  }
  return s;
}

/** Hours after a rejected ultimatum before the demanding nation attacks. */
export const ULTIMATUM_GRACE_HOURS = 72;
