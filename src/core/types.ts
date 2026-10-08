import type { Action } from './actions';
import type { History } from './history';

/**
 * Core game model. Everything in GameState is plain JSON (no classes, no functions, no Maps)
 * so it can be saved, sent over the network, and replayed. Static map geometry lives in
 * MapData (src/map/mapData.ts) and is never part of the state.
 */

export type NationId = string;
export type ProvinceId = string;
export type ArmyId = string;

export type EraId = 'bronze' | 'rome-rise' | 'rome-fall' | 'renaissance' | 'ww1' | 'ww2' | 'modern' | 'usa';

/** Look-and-feel family used by the UI theme for each era. */
export type ThemeId = 'parchment' | 'marble' | 'ornate' | 'sepia' | 'tactical';

export interface Nation {
  id: NationId;
  name: string;
  shortName: string;
  color: string; // '#rrggbb'
  capital: ProvinceId | null;
  major: boolean;
  alive: boolean;
  /** Army size multiplier (affects starting armies and mobilization cap). */
  military: number;
  /** Unit types this nation raises, cycled in order. */
  units: string[];
  /** AI personality 0..1: appetite for wars of expansion. */
  aggression: number;
  /** Naval power 0..1: how many fleets the nation keeps (see fleetCap). */
  naval: number;
  /** Fleet types built, cycled in order (default: every fleet type of the era). */
  fleets?: string[];
  /** Combat quality multiplier (doctrine, training, equipment of the era). 1 = average. */
  quality: number;
}

export interface ProvinceState {
  owner: NationId;
  /** Nation that held the province at the start: it will want it back. */
  core?: NationId;
  /** Capture in progress by an army with no opposition in the province. */
  siege?: { by: NationId; progress: number }; // progress 0..1
  /** Strength of the province's own defenders. Missing = at full strength (see garrisonMax). */
  garrison?: number;
}

export interface Army {
  id: ArmyId;
  name: string;
  owner: NationId;
  /** Province the army is in (or leaving, while progress > 0). */
  location: ProvinceId;
  strength: number;
  maxStrength: number;
  unitType: string;
  /** Remaining provinces to travel through; path[0] is the next stop. */
  path: ProvinceId[];
  /** 0..1 along the link from location to path[0]. */
  progress: number;
  /** Clock hour until which the army is still disembarking from a sea landing (weaker attack). */
  landedUntil?: number;
  /** Units with strikes (air wings, drones): clock hour when the next strike is ready. */
  readyAt?: number;
}

export interface War {
  id: string;
  attackers: NationId[];
  defenders: NationId[];
  startedAt: number; // clock hours
}

export type TreatyType = 'alliance' | 'non-aggression' | 'ceasefire' | 'peace';

export interface Treaty {
  id: string;
  type: TreatyType;
  parties: NationId[];
  signedAt: number;
  expiresAt?: number;
}

// ---- diplomacy ----------------------------------------------------------------------------------

export type AgreementType = 'alliance' | 'non-aggression' | 'ceasefire' | 'peace' | 'territory' | 'joint-war' | 'demand';

/** What is on the table. Provinces are always listed from the proposer's point of view. */
export interface ProposalTerms {
  type: AgreementType;
  from: NationId;
  to: NationId;
  /** Provinces the proposer hands to the recipient. */
  give?: ProvinceId[];
  /** Provinces the proposer receives from the recipient. */
  take?: ProvinceId[];
  /** Common enemy for a joint war. */
  target?: NationId;
}

export interface Proposal extends ProposalTerms {
  id: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired' | 'void';
  createdAt: number;
  expiresAt: number;
}

export interface ChatLine {
  id: number;
  from: NationId;
  text: string;
  at: number;
  /** Proposal shown as a card under this message. */
  proposalId?: string;
}

/** What one leader remembers about another. Kept short: it is sent with every AI request. */
export interface Memory {
  /** Notes the AI leader chose to remember from conversations. */
  notes: string[];
  /** Recorded by the game: wars declared, treaties broken, demands made. */
  grievances: string[];
}

export interface DiplomacyState {
  /** Conversation logs keyed by relationKey(a, b). */
  chats: Record<string, ChatLine[]>;
  /** memories[holder][about] */
  memories: Record<NationId, Record<NationId, Memory>>;
  /** Clock hour of the last contact a nation initiated (AI director cooldown). */
  lastContact: Record<NationId, number>;
  /** Last message read in each conversation, keyed by relationKey (so read messages stay read after a reload). */
  read?: Record<string, number>;
}

export interface GameEvent {
  id: number;
  at: number; // clock hours
  kind: string;
  text: string;
  nations?: NationId[];
  /** Important events show a toast, stop Skip, and can auto-pause the game. */
  important?: boolean;
}

/** A future event baked into the state at scenario start (e.g. historical declarations of war). */
export interface ScheduledEvent {
  id: string;
  at: number; // clock hours
  /** Optional headline logged when the event fires. */
  text?: string;
  important?: boolean;
  /** Applied as their natural actor; skipped if invalid or if that actor is the player. */
  actions: Action[];
}

export interface Clock {
  /** ISO date the scenario starts on, e.g. '1939-09-01'. */
  startDate: string;
  /** In-game hours elapsed since startDate. */
  hours: number;
  /** Hours advanced by one simulation tick. */
  tickHours: number;
  /** Hours in one "turn" (a day in WW2, a week in ancient eras). */
  turnHours: number;
}

export interface GameState {
  version: 1;
  scenarioId: string;
  mapId: string;
  clock: Clock;
  playerNation: NationId | null;
  nations: Record<NationId, Nation>;
  provinces: Record<ProvinceId, ProvinceState>;
  /** Relation score -100..100 keyed by relationKey(a, b). Missing = 0. */
  relations: Record<string, number>;
  wars: War[];
  treaties: Treaty[];
  armies: Record<ArmyId, Army>;
  /** Ongoing battles: province id -> clock hour the battle started. */
  battles: Record<ProvinceId, number>;
  events: GameEvent[];
  scheduled: ScheduledEvent[];
  proposals: Proposal[];
  diplomacy: DiplomacyState;
  /** Bookkeeping for the autonomous nation AI. */
  ai: { lastWarAt: number };
  nextId: number;
  /** Seeded RNG state (mulberry32) so battles are deterministic and replayable. */
  rng: number;
  /** Per-nation counter used to name new armies ("4th Army"). */
  armyCounters: Record<NationId, number>;
  rules: {
    victoryPercent: number;
    /** Defence multiplier on home soil: higher in trench and modern eras where defence dominates. */
    homeDefense: number;
    /** Multiplier on how often AI nations start wars of expansion. */
    warAppetite: number;
    /** Days an unopposed full-strength army needs to occupy a province. */
    captureDays: number;
    /** How hard the AI nations play (chosen with the nation). Missing = normal. */
    difficulty?: Difficulty;
  };
  /** Weekly territory and strength of the great powers, for the ledger (see core/history.ts). */
  history?: History;
  winner: NationId | null;
}

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];

/** Multiplier on an AI nation's fighting power: the player always fights at 1. */
export function aiEdge(s: GameState, nation: NationId): number {
  if (nation === s.playerNation) return 1;
  const d = s.rules.difficulty ?? 'normal';
  return d === 'easy' ? 0.85 : d === 'hard' ? 1.15 : 1;
}

export const relationKey = (a: NationId, b: NationId) => (a < b ? `${a}|${b}` : `${b}|${a}`);
