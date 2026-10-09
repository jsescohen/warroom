import { applyAgreement, PROPOSAL_DAYS, ULTIMATUM_GRACE_HOURS, validateTerms } from './diplomacy';
import { addGrievance, addNote, addRelation, log, logEvent } from './events';
import { applyStrike, armyName, canEnter, findPath, isFleet, setOwner, strikeError } from './military';
import { simulateTick } from './sim';
import { applyArm, applyLaunch, armError, launchError, type WeaponKind } from './weapons';
import { formatShortDate } from './time';
import { applyBuild, applyDevelop, applyMarket, applyRecruit, buildError, developError, initStocks, marketError, recruitError } from './economy';
import { DIFFICULTIES, relationKey, type BuildingId, type Difficulty, type EconomyMode, type ArmyId, type ChatLine, type GameState, type NationId, type ProposalTerms, type ProvinceId } from './types';
import { declareWar, leaveTreaty, sideOf } from './war';
import type { World } from './world';

export { logEvent } from './events';

/**
 * Every change to GameState goes through an Action. Actions are plain JSON so they can be
 * logged, replayed, or sent to a server for multiplayer later.
 */
export type Action =
  | { type: 'chooseNation'; nation: NationId; difficulty?: Difficulty; capitalFalls?: boolean; economy?: EconomyMode }
  /** Multiplayer (from the server): the nations led by people, and the room's rules. */
  | { type: 'setPlayers'; nations: NationId[]; difficulty?: Difficulty; capitalFalls?: boolean; economy?: EconomyMode }
  /** Buy a new unit at a barracks (land) or airfield (air). */
  | { type: 'recruit'; province: ProvinceId; unitType: string }
  | { type: 'build'; province: ProvinceId; building: BuildingId }
  /** Develop a province one level (money and materials). */
  | { type: 'develop'; province: ProvinceId }
  /** World market: buy (amount > 0) or sell (amount < 0) a resource. */
  | { type: 'market'; resource: string; amount: number }
  /** Build a missile or nuclear weapon into the arsenal. */
  | { type: 'arm'; weapon: WeaponKind }
  /** Fire one at a province. */
  | { type: 'launch'; weapon: WeaponKind; target: ProvinceId }
  | { type: 'tick' }
  | { type: 'declareWar'; attacker: NationId; defender: NationId }
  | { type: 'moveArmy'; army: ArmyId; to: ProvinceId }
  | { type: 'stopArmy'; army: ArmyId }
  | { type: 'splitArmy'; army: ArmyId }
  | { type: 'mergeArmies'; army: ArmyId }
  /** A fleet with carrier aircraft or missiles strikes a province within range. */
  | { type: 'strike'; army: ArmyId; target: ProvinceId }
  | { type: 'transferProvince'; province: ProvinceId; to: NationId }
  // diplomacy
  | { type: 'propose'; terms: ProposalTerms }
  | { type: 'respond'; proposal: string; accept: boolean }
  | { type: 'cancelTreaty'; treaty: string }
  | { type: 'chat'; with: NationId; text: string; proposal?: string }
  | { type: 'adjustRelation'; with: NationId; delta: number }
  | { type: 'remember'; about: NationId; note: string }
  | { type: 'noteContact' }
  /** The player has read a conversation up to a message. */
  | { type: 'markRead'; with: NationId; upTo: number };

/** Who issued an action: a nation (player or AI) or the simulation itself. */
export type Actor = NationId | 'system';

export interface Command {
  action: Action;
  actor: Actor;
}

/** Relation change one conversation turn may cause. */
export const MAX_CHAT_RELATION = 8;
const MAX_CHAT_LINES = 40;

/** Idle armies in the same province with the same owner and unit type: these can merge. */
export const mergeable = (s: GameState, army: ArmyId) => {
  const a = s.armies[army];
  return Object.values(s.armies).filter(
    (b) => b.id !== a.id && b.owner === a.owner && b.unitType === a.unitType && b.location === a.location && b.progress === 0 && !b.path.length,
  );
};

/**
 * Hours until armies may merge in a province: newly taken land needs time to organise (ten days,
 * or four turns in eras counted in weeks).
 */
export function mergeCooldown(s: GameState, province: ProvinceId): number {
  const taken = s.provinces[province]?.takenAt;
  if (taken === undefined) return 0;
  return Math.max(0, taken + Math.max(240, 4 * s.clock.turnHours) - s.clock.hours);
}

/** Returns an error message if the command is not allowed, otherwise null. */
export function validate(state: GameState, { action, actor }: Command, world: World): string | null {
  const ownArmy = (id: ArmyId) => {
    const a = state.armies[id];
    if (!a) return 'That army no longer exists';
    if (actor !== 'system' && actor !== a.owner) return 'You can only command your own armies';
    return null;
  };
  const isNation = (n: NationId) => !!state.nations[n]?.alive;
  switch (action.type) {
    case 'chooseNation':
      if (!isNation(action.nation)) return 'Unknown nation';
      if (state.playerNation) return 'Nation already chosen';
      if (action.difficulty && !DIFFICULTIES.includes(action.difficulty)) return 'Unknown difficulty';
      if (action.economy && action.economy !== 'simple' && action.economy !== 'detailed') return 'Unknown economy';
      return null;
    case 'setPlayers':
      if (actor !== 'system') return 'Only the server sets the players';
      return Array.isArray(action.nations) && action.nations.every((n) => typeof n === 'string') ? null : 'Bad player list';
    case 'recruit':
      return actor === 'system' ? 'Only a nation can recruit' : recruitError(state, world, actor, action.province, action.unitType);
    case 'build':
      return actor === 'system' ? 'Only a nation can build' : buildError(state, world, actor, action.province, action.building);
    case 'develop':
      return actor === 'system' ? 'Only a nation can develop land' : developError(state, world, actor, action.province);
    case 'market':
      return actor === 'system' ? 'Only a nation can trade' : marketError(state, world, actor, action.resource, action.amount);
    case 'arm':
      return actor === 'system' || (action.weapon !== 'missile' && action.weapon !== 'nuke') ? 'Not allowed' : armError(state, world, actor, action.weapon);
    case 'launch':
      return actor === 'system' || (action.weapon !== 'missile' && action.weapon !== 'nuke') ? 'Not allowed' : launchError(state, world, actor, action.weapon, action.target);
    case 'tick':
      return actor === 'system' ? null : 'Only the simulation advances time';
    case 'declareWar': {
      const { attacker, defender } = action;
      if (actor !== 'system' && actor !== attacker) return 'You can only declare war for your own nation';
      if (!isNation(attacker) || !isNation(defender)) return 'Unknown nation';
      if (attacker === defender) return 'A nation cannot declare war on itself';
      if (sideOf(state, attacker, defender) === 'enemies') return `Already at war with ${state.nations[defender].shortName}`;
      if (sideOf(state, attacker, defender) === 'cobelligerents') return `${state.nations[defender].shortName} is fighting alongside you`;
      return null;
    }
    case 'moveArmy': {
      const err = ownArmy(action.army);
      if (err) return err;
      const a = state.armies[action.army];
      const target = state.provinces[action.to];
      if (!target) return 'Unknown province';
      const fleet = isFleet(world, a.unitType);
      if (!canEnter(state, a.owner, action.to, world, a.unitType)) {
        if (fleet) return 'Fleets can only sail to coastal provinces';
        return `You are not at war with ${state.nations[target.owner].shortName}. Declare war first to invade.`;
      }
      if (!findPath(state, world, a.owner, a.unitType, a.location, action.to)) {
        return fleet ? 'No sea route to there' : 'No route: the way is blocked by neutral territory or by enemy fleets';
      }
      return null;
    }
    case 'stopArmy':
      return ownArmy(action.army);
    case 'strike':
      return ownArmy(action.army) ?? strikeError(state, world, action.army, action.target);
    case 'splitArmy': {
      const err = ownArmy(action.army);
      if (err) return err;
      return state.armies[action.army].strength < 2 ? 'Too weak to split' : null;
    }
    case 'mergeArmies': {
      const err = ownArmy(action.army);
      if (err) return err;
      const wait = mergeCooldown(state, state.armies[action.army].location);
      if (wait > 0) return `Troops cannot reorganise in newly taken land yet: ${wait >= 48 ? `${Math.ceil(wait / 24)} days` : `${Math.ceil(wait)} hours`} to go`;
      return mergeable(state, action.army).length ? null : 'No idle army of the same type here to merge with';
    }
    case 'transferProvince':
      if (actor !== 'system') return 'Only the simulation can transfer provinces directly';
      if (!state.provinces[action.province]) return 'Unknown province';
      if (!state.nations[action.to]) return 'Unknown nation';
      return null;

    case 'propose': {
      if (actor !== action.terms.from) return 'You can only propose on behalf of your own nation';
      const dup = state.proposals.some((p) => p.status === 'pending' && p.from === action.terms.from && p.to === action.terms.to);
      if (dup) return 'You already have an offer waiting for their answer';
      return validateTerms(state, action.terms);
    }
    case 'respond': {
      const p = state.proposals.find((x) => x.id === action.proposal);
      if (!p) return 'Unknown proposal';
      if (actor !== p.to) return 'Only the recipient can answer a proposal';
      if (p.status !== 'pending') return `This proposal is ${p.status}`;
      return action.accept ? validateTerms(state, p) : null;
    }
    case 'cancelTreaty': {
      const t = state.treaties.find((x) => x.id === action.treaty);
      if (!t) return 'Unknown treaty';
      return actor !== 'system' && t.parties.includes(actor) ? null : 'You are not a party to that treaty';
    }
    case 'chat':
      if (actor === 'system' || !isNation(actor) || !isNation(action.with) || actor === action.with) return 'Unknown nation';
      return action.text.trim() ? null : 'Empty message';
    case 'adjustRelation':
      if (actor === 'system' || !isNation(action.with) || actor === action.with) return 'Unknown nation';
      return Math.abs(action.delta) <= MAX_CHAT_RELATION ? null : 'Relation change too large';
    case 'remember':
      return actor !== 'system' && isNation(action.about) && action.note.trim() ? null : 'Nothing to remember';
    case 'noteContact':
      return actor !== 'system' && isNation(actor) ? null : 'Unknown nation';
    case 'markRead':
      return actor !== 'system' && state.nations[action.with] && Number.isFinite(action.upTo) ? null : 'Unknown conversation';
  }
}

/** Pure reducer: returns a new state, never mutates the input. Assumes the command is valid. */
export function reduce(state: GameState, cmd: Command, world: World): GameState {
  const { action, actor } = cmd;
  switch (action.type) {
    case 'chooseNation': {
      let s: GameState = {
        ...state, playerNation: action.nation,
        rules: { ...state.rules, difficulty: action.difficulty ?? 'normal', capitalFalls: !!action.capitalFalls, economy: action.economy ?? 'simple' },
      };
      if (s.rules.economy === 'detailed') s = initStocks(s, world);
      return logEvent(s, 'player', `You lead ${state.nations[action.nation].name}.`, {
        nations: [action.nation],
      });
    }

    case 'setPlayers': {
      const nations = [...new Set(action.nations.filter((n) => state.nations[n]))].sort();
      const before = new Set(state.humans ?? []);
      let s: GameState = {
        ...state,
        playerNation: null,
        humans: nations,
        rules: {
          ...state.rules,
          difficulty: action.difficulty ?? state.rules.difficulty ?? 'normal',
          capitalFalls: action.capitalFalls ?? state.rules.capitalFalls,
          economy: action.economy ?? state.rules.economy ?? 'simple',
        },
      };
      if (s.rules.economy === 'detailed') s = initStocks(s, world);
      for (const n of nations) if (!before.has(n)) s = logEvent(s, 'player', `${s.nations[n].name} is now led by a player.`, { nations: [n] });
      for (const n of before) if (!nations.includes(n) && s.nations[n]) s = logEvent(s, 'player', `${s.nations[n].name} is back in the hands of its AI leader.`, { nations: [n] });
      return s;
    }

    case 'recruit':
      return applyRecruit(state, world, actor, action.province, action.unitType);

    case 'build':
      return applyBuild(state, world, actor, action.province, action.building);

    case 'develop':
      return applyDevelop(state, world, actor, action.province);

    case 'market':
      return applyMarket(state, world, actor, action.resource, action.amount);

    case 'arm':
      return applyArm(state, world, actor, action.weapon);

    case 'launch':
      return applyLaunch(state, world, actor, action.weapon, action.target, log);

    case 'tick':
      return simulateTick(state, world, (s, c) => (validate(s, c, world) ? s : reduce(s, c, world)), log);

    case 'declareWar':
      return declareWar(state, action.attacker, action.defender);

    case 'moveArmy': {
      const a = state.armies[action.army];
      const route = findPath(state, world, a.owner, a.unitType, a.location, action.to)!;
      // keep momentum if the new route continues along the link the army is already on
      const progress = a.progress > 0 && route.path[0] === a.path[0] ? a.progress : 0;
      return { ...state, armies: { ...state.armies, [a.id]: { ...a, path: route.path, progress } } };
    }

    case 'strike':
      return applyStrike(state, world, action.army, action.target, log);

    case 'stopArmy': {
      const a = state.armies[action.army];
      return { ...state, armies: { ...state.armies, [a.id]: { ...a, path: [], progress: 0 } } };
    }

    case 'splitArmy': {
      const a = state.armies[action.army];
      const no = (state.armyCounters[a.owner] ?? 0) + 1;
      const id = `a${state.nextId}`;
      const half = a.strength / 2;
      const halfMax = a.maxStrength / 2;
      return {
        ...state,
        armies: {
          ...state.armies,
          [a.id]: { ...a, strength: half, maxStrength: halfMax },
          [id]: { ...a, id, name: armyName(no, world.unitTypes[a.unitType]), strength: half, maxStrength: halfMax, path: [], progress: 0 },
        },
        armyCounters: { ...state.armyCounters, [a.owner]: no },
        nextId: state.nextId + 1,
      };
    }

    case 'mergeArmies': {
      const a = state.armies[action.army];
      const others = mergeable(state, a.id);
      const armies = { ...state.armies };
      for (const o of others) delete armies[o.id];
      armies[a.id] = {
        ...a,
        strength: a.strength + others.reduce((sum, o) => sum + o.strength, 0),
        maxStrength: a.maxStrength + others.reduce((sum, o) => sum + o.maxStrength, 0),
      };
      return { ...state, armies };
    }

    case 'transferProvince':
      return setOwner(state, action.province, action.to, log, world);

    // ---- diplomacy ----------------------------------------------------------------------------
    case 'propose': {
      const t = action.terms;
      const id = `p${state.nextId}`;
      let s: GameState = {
        ...state,
        proposals: [
          ...state.proposals.slice(-59),
          { ...t, id, status: 'pending', createdAt: state.clock.hours, expiresAt: state.clock.hours + PROPOSAL_DAYS * 24 },
        ],
        nextId: state.nextId + 1,
      };
      if (t.type === 'demand') {
        s = addRelation(s, t.from, t.to, -10);
        s = addGrievance(s, t.to, t.from, `${formatShortDate(s.clock)}: issued us an ultimatum.`);
      }
      return s;
    }

    case 'respond': {
      const p = state.proposals.find((x) => x.id === action.proposal)!;
      let s: GameState = {
        ...state,
        proposals: state.proposals.map((x) => (x.id === p.id ? { ...x, status: action.accept ? 'accepted' : 'rejected' } : x)),
      };
      if (action.accept) return applyAgreement(s, world, { ...p, status: 'accepted' });
      if (p.type === 'demand') {
        // a rejected ultimatum is followed through (scheduled actions never act for the player)
        s = addRelation(s, p.from, p.to, -10);
        s = {
          ...s,
          scheduled: [...s.scheduled, {
            id: `u${p.id}`, at: s.clock.hours + ULTIMATUM_GRACE_HOURS,
            text: `${s.nations[p.from].shortName} makes good on its ultimatum.`, important: true,
            actions: [{ type: 'declareWar' as const, attacker: p.from, defender: p.to }],
          }].sort((a, b) => a.at - b.at),
        };
      }
      return s;
    }

    case 'cancelTreaty': {
      const t = state.treaties.find((x) => x.id === action.treaty)!;
      return leaveTreaty(state, actor, t, '');
    }

    case 'chat': {
      const key = relationKey(actor, action.with);
      const line: ChatLine = { id: state.nextId, from: actor, text: action.text.trim().slice(0, 1200), at: state.clock.hours, proposalId: action.proposal };
      const chats = { ...state.diplomacy.chats, [key]: [...(state.diplomacy.chats[key] ?? []), line].slice(-MAX_CHAT_LINES) };
      return { ...state, diplomacy: { ...state.diplomacy, chats }, nextId: state.nextId + 1 };
    }

    case 'adjustRelation':
      return addRelation(state, actor, action.with, Math.round(action.delta));

    case 'remember':
      return addNote(state, actor, action.about, action.note);

    case 'noteContact':
      return { ...state, diplomacy: { ...state.diplomacy, lastContact: { ...state.diplomacy.lastContact, [actor]: state.clock.hours } } };

    case 'markRead': {
      const key = relationKey(actor, action.with);
      if ((state.diplomacy.read?.[key] ?? -1) >= action.upTo) return state;
      return { ...state, diplomacy: { ...state.diplomacy, read: { ...state.diplomacy.read, [key]: action.upTo } } };
    }
  }
}
