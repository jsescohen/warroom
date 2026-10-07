import type { ScenarioDef } from '../core/scenario';
import { formatDate } from '../core/time';
import type { GameState } from '../core/types';

/**
 * Saved games. A save is the GameState plus a little metadata; the map and world are rebuilt
 * from the scenario on load. Stored in IndexedDB (a save is ~120 KB, too big to keep many in
 * localStorage) and exportable as a .json file.
 */

export const SAVE_FORMAT = 1;
export const AUTOSAVE_ID = 'autosave';

export interface SaveMeta {
  id: string;
  name: string;
  scenarioId: string;
  scenarioName: string;
  nation: string | null;
  gameDate: string;
  savedAt: number; // ms since epoch
  auto: boolean;
}

export interface SaveRecord extends SaveMeta {
  format: number;
  provinceCount: number;
  state: GameState;
}

// ---- pure helpers (tested) ----------------------------------------------------------------------

export function makeSave(state: GameState, scenario: ScenarioDef, opts: { id?: string; name?: string; auto?: boolean; now?: number } = {}): SaveRecord {
  const nation = state.playerNation ? state.nations[state.playerNation]?.name ?? null : null;
  const gameDate = formatDate(state.clock);
  return {
    format: SAVE_FORMAT,
    id: opts.id ?? `s${(opts.now ?? Date.now()).toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: opts.name?.trim() || `${nation ?? scenario.name} — ${gameDate}`,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    nation,
    gameDate,
    savedAt: opts.now ?? Date.now(),
    auto: !!opts.auto,
    provinceCount: Object.keys(state.provinces).length,
    state,
  };
}

/** Returns why a record cannot be loaded, or null if it looks sound. */
export function validateSave(rec: unknown, knownScenarios: string[]): string | null {
  if (!rec || typeof rec !== 'object') return 'Not a Warroom save file.';
  const r = rec as Partial<SaveRecord>;
  if (r.format !== SAVE_FORMAT) return `Unsupported save format (${String(r.format)}).`;
  if (!r.scenarioId || !knownScenarios.includes(r.scenarioId)) return `Unknown era "${String(r.scenarioId)}".`;
  const s = r.state as Partial<GameState> | undefined;
  if (!s || s.version !== 1 || !s.provinces || !s.nations || !s.clock || !s.armies) return 'The saved game data is damaged.';
  if (Object.keys(s.provinces).length !== r.provinceCount) return 'The saved game data is damaged.';
  return null;
}

export const metaOf = ({ id, name, scenarioId, scenarioName, nation, gameDate, savedAt, auto }: SaveRecord): SaveMeta =>
  ({ id, name, scenarioId, scenarioName, nation, gameDate, savedAt, auto });

// ---- IndexedDB storage --------------------------------------------------------------------------

const DB = 'warroom';
const STORE = 'saves';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Cannot open the save database'));
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Save database error'));
    });
  } finally {
    db.close();
  }
}

export const putSave = (rec: SaveRecord) => tx('readwrite', (s) => s.put(rec)).then(() => metaOf(rec));
export const getSave = (id: string) => tx<SaveRecord | undefined>('readonly', (s) => s.get(id));
export const deleteSave = (id: string) => tx('readwrite', (s) => s.delete(id)).then(() => undefined);
export const clearSaves = () => tx('readwrite', (s) => s.clear()).then(() => undefined);

/** All saves, newest first (metadata only). */
export async function listSaves(): Promise<SaveMeta[]> {
  const all = await tx<SaveRecord[]>('readonly', (s) => s.getAll());
  return all.map(metaOf).sort((a, b) => b.savedAt - a.savedAt);
}

// ---- files --------------------------------------------------------------------------------------

/** Offers a save as a .json download. */
export function exportSave(rec: SaveRecord) {
  const blob = new Blob([JSON.stringify(rec)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${rec.name.replace(/[^\w\- ]+/g, '').trim() || 'warroom'}.warroom.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Reads a save file chosen by the player, validates it and stores it as a new save. */
export async function importSave(file: File, knownScenarios: string[]): Promise<SaveMeta> {
  let rec: unknown;
  try {
    rec = JSON.parse(await file.text());
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const err = validateSave(rec, knownScenarios);
  if (err) throw new Error(err);
  const r = rec as SaveRecord;
  return putSave({ ...r, id: `s${Date.now().toString(36)}`, auto: false });
}
