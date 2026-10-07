import type { AssessorMode } from '../core/assess';
import type { AutoPause } from '../game/loop';

/**
 * Player preferences (not game state): kept in localStorage per browser. Reads never throw, so the
 * game works with storage blocked (settings then last for the page only).
 */
export interface Settings {
  // gameplay
  autoPause: AutoPause;
  advisor: AssessorMode;
  /** AI leaders may write to the player first. */
  aiMessages: boolean;
  /** Advisor and diplomacy dialogs pause the game while open. */
  dialogsPause: boolean;
  /** Autosave every in-game week / month, or never. */
  autosave: 'off' | 'weekly' | 'monthly';
  /** Dragging an army near the screen edge scrolls the map. */
  edgeScroll: boolean;
  // audio
  muted: boolean;
  masterVolume: number; // 0..1
  sfxVolume: number;
  musicVolume: number;
  music: boolean;
  uiSounds: boolean;
  // display
  uiScale: number; // 0.85 .. 1.3
  provinceLabels: boolean;
  reduceMotion: boolean;
}

const KEY = 'warroom.settings';
export const DEFAULT_SETTINGS: Settings = {
  autoPause: 'mine', advisor: 'major', aiMessages: true, dialogsPause: true, autosave: 'monthly', edgeScroll: true,
  muted: false, masterVolume: 0.8, sfxVolume: 0.8, musicVolume: 0.35, music: true, uiSounds: true,
  uiScale: 1, provinceLabels: true, reduceMotion: false,
};

let current: Settings = load();
const listeners = new Set<(s: Settings, prev: Settings) => void>();

/** Fills gaps and rejects bad values so an old or hand-edited entry can never break the game. */
export function sanitizeSettings(raw: Partial<Settings>): Settings {
  const d = DEFAULT_SETTINGS;
  const pick = <T,>(v: unknown, ok: readonly T[], def: T): T => (ok.includes(v as T) ? (v as T) : def);
  const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
  const num = (v: unknown, def: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def);
  return {
    autoPause: pick(raw.autoPause, ['off', 'mine', 'all'] as const, d.autoPause),
    advisor: pick(raw.advisor, ['off', 'major', 'all'] as const, d.advisor),
    aiMessages: bool(raw.aiMessages, d.aiMessages),
    dialogsPause: bool(raw.dialogsPause, d.dialogsPause),
    autosave: pick(raw.autosave, ['off', 'weekly', 'monthly'] as const, d.autosave),
    edgeScroll: bool(raw.edgeScroll, d.edgeScroll),
    muted: bool(raw.muted, d.muted),
    masterVolume: num(raw.masterVolume, d.masterVolume, 0, 1),
    sfxVolume: num(raw.sfxVolume, d.sfxVolume, 0, 1),
    musicVolume: num(raw.musicVolume, d.musicVolume, 0, 1),
    music: bool(raw.music, d.music),
    uiSounds: bool(raw.uiSounds, d.uiSounds),
    uiScale: num(raw.uiScale, d.uiScale, 0.85, 1.3),
    provinceLabels: bool(raw.provinceLabels, d.provinceLabels),
    reduceMotion: bool(raw.reduceMotion, d.reduceMotion),
  };
}

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    // carry over the advisor choice saved by the older top-bar toggle
    const legacy = localStorage.getItem('warroom.assessor');
    if (!raw.advisor && (legacy === 'all' || legacy === 'off')) raw.advisor = legacy;
    return sanitizeSettings(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export const getSettings = (): Settings => current;

export function updateSettings(patch: Partial<Settings>) {
  const prev = current;
  current = sanitizeSettings({ ...current, ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l(current, prev));
}

export const resetSettings = () => updateSettings({ ...DEFAULT_SETTINGS });

export function onSettingsChange(fn: (s: Settings, prev: Settings) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Applies display settings that live in CSS (UI scale, reduced motion). */
export function applyDisplaySettings(s: Settings = current) {
  const root = document.documentElement;
  root.style.setProperty('--ui-scale', String(s.uiScale));
  root.classList.toggle('reduce-motion', s.reduceMotion);
}
