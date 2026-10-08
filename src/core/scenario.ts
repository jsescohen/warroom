import type { Action } from './actions';
import type { EraId, NationId, ThemeId, TreatyType } from './types';

/** Static facts about a province coming from the map file; used to decide starting owners. */
export interface ProvinceMeta {
  id: string;
  name: string;
  polity: string;
  subject: string;
  lon: number;
  lat: number;
}

export interface UnitTypeDef {
  id: string;
  name: string;
  /** Used in army names: "3rd Panzer". */
  short: string;
  attack: number;
  defense: number;
  speed: number; // map units per in-game day
  /** 'sea' units are fleets: they sail along coasts and sea lanes, fight other fleets and guard the sea for landings. */
  domain?: 'land' | 'sea';
  /** Fleets only: guns that shell enemy troops on the coast the fleet lies off (damage multiplier). */
  bombard?: number;
  /** Fleets only: carrier aircraft or missiles that hit a province within range, then reload. */
  strike?: StrikeDef;
}

/** A natural resource of an era (see data/resources.ts). */
export interface ResourceDef {
  id: string;
  name: string;
  /** Map colour in the resources map mode. */
  color: string;
  /** Unit types that need it: without it they cost half as much again (or, with stockpiles, cannot be supplied). */
  units?: string[];
  /** Money a province holding it adds each month. */
  value: number;
  /** [lonMin, lonMax, latMin, latMax, chance]: where it is found. */
  regions: [number, number, number, number, number][];
}

export interface StrikeDef {
  kind: 'air' | 'missile';
  /** Map units from the fleet's position (about 6.7 km each). */
  range: number;
  /** Strength points destroyed by a full-strength fleet's strike. */
  power: number;
  cooldownHours: number;
}

/** The voice of the AI Assessor for this era. */
export interface AdvisorPersona {
  /** e.g. "Chief of the General Staff", "Senator", "Director of Intelligence". */
  title: string;
  /** How they speak, in one line, for the prompt. */
  style: string;
  /** Short label for the report heading, e.g. "Staff briefing", "Report to the Senate". */
  reportName: string;
}

export interface LeaderPersona {
  name: string;
  title: string;
  traits: string[];
  goals: string[];
  grudges?: string[];
  speechStyle: string;
}

export interface NationDef {
  id: NationId;
  name: string;
  shortName?: string;
  color: string;
  /** Source polities (map `polity` names) that start under this nation. */
  polities?: string[];
  /** Source subjects (colonial owner names) whose polities start under this nation. */
  subjects?: string[];
  /** Name of the capital province (matches a province name in the map). */
  capital?: string;
  major?: boolean;
  playable?: boolean;
  /** Army size multiplier, default 0.8 (majors usually 1–2). */
  military?: number;
  /** AI appetite for wars of expansion, 0..1. Default 0.4 for majors, 0.15 otherwise. */
  aggression?: number;
  /** Naval power 0..1: sets the size of the nation's fleet (about 6 fleets at 1). Default 0.1. */
  naval?: number;
  /** Combat quality multiplier, default 1 (e.g. 1.3 for 1939 Germany's doctrine). */
  quality?: number;
  /** Unit types raised, cycled in order. Default: the scenario's first unit type. */
  units?: string[];
  /** Fleet types built, cycled in order. Default: all of the era's fleet types. Fleet count follows `naval`. */
  fleets?: string[];
  leader?: LeaderPersona;
}

export interface TimeConfig {
  /** In-game hours per simulation tick. */
  tickHours: number;
  /** In-game hours per turn (shown as "Day 12", "Week 3"...). */
  turnHours: number;
  turnName: string;
  /** Real seconds one turn takes at 1x speed. */
  secondsPerTurn: number;
  /** Skip fast-forwards until an important event, but never further than this many turns. */
  skipMaxTurns: number;
  /** Show the hour of day in the date display. */
  showHours: boolean;
}

export interface ScriptedEvent {
  date: string; // ISO, same format as startDate
  text?: string;
  important?: boolean;
  actions: Action[];
}

export interface ScenarioDef {
  id: string;
  era: EraId;
  name: string;
  subtitle: string;
  startDate: string;
  theme: ThemeId;
  /** URL of the generated map (see scripts/build-map.ts). */
  map: string;
  /** Historical context given to the AI assessor / leaders. Keep it short. */
  context: string;
  advisor: AdvisorPersona;
  time: TimeConfig;
  /** Historical events that fire on their date unless the player is the one who would act. */
  scripted?: ScriptedEvent[];
  unitTypes: UnitTypeDef[];
  nations: NationDef[];
  /** Renames for auto-generated minor nations, keyed by source subject name. */
  minorNames?: Record<string, string>;
  /** Era names for tribal zones (see core/regions.ts), e.g. { germania: 'Germanic tribes' }. */
  tribeNames?: Record<string, string>;
  /** Period names for provinces, keyed by the map's (modern) name: { Paris: 'Lutetia' }. */
  provinceNames?: Record<string, string>;
  /** Final say on starting ownership (e.g. 1938 map → 1939 borders). Return undefined to keep default. */
  assignOwner?: (p: ProvinceMeta, defaultOwner: NationId) => NationId | undefined;
  wars?: { attackers: NationId[]; defenders: NationId[] }[];
  treaties?: { type: TreatyType; parties: NationId[] }[];
  /** Starting relation overrides: [a, b, score]. */
  relations?: [NationId, NationId, number][];
  victory: { conquestPercent: number };
  /** Combat tuning per era. homeDefense defaults to 1.2. */
  combat?: { homeDefense?: number; captureDays?: number };
  /** Multiplier on the AI's appetite for wars of expansion (modern states rarely start them). Default 1. */
  aiWarAppetite?: number;
}
