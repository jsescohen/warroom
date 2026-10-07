import { audio } from '../audio/audio';
import type { ScenarioDef } from '../core/scenario';
import type { GameStore } from '../core/store';
import type { GameState } from '../core/types';
import { getSettings } from '../ui/settings';
import { AUTOSAVE_ID, getSave, makeSave, putSave } from './saves';

/**
 * The running game's relationship with its saves: which slot it came from, whether there are
 * unsaved changes, periodic autosave, and leaving to the main menu.
 */
export class GameSession {
  private savedState: GameState;
  private lastAutosaveDay: number;
  slotId: string | null;
  slotName: string | null = null;

  constructor(private store: GameStore, readonly scenario: ScenarioDef, slotId: string | null, private notify: (text: string) => void) {
    this.slotId = slotId && slotId !== AUTOSAVE_ID ? slotId : null;
    this.savedState = store.state;
    this.lastAutosaveDay = Math.floor(store.state.clock.hours / 24);
    if (this.slotId) void getSave(this.slotId).then((r) => { this.slotName = r?.name ?? null; });
    store.subscribe((s, prev) => {
      if (s.clock.hours !== prev.clock.hours) this.maybeAutosave(s);
    });
  }

  get dirty() {
    return this.store.state !== this.savedState;
  }

  /** Saves to the current slot (or a new one), optionally under a new name. */
  async save(name?: string, asNew = false): Promise<boolean> {
    try {
      const rec = makeSave(this.store.state, this.scenario, { id: asNew ? undefined : this.slotId ?? undefined, name: name ?? this.slotName ?? undefined });
      await putSave(rec);
      this.slotId = rec.id;
      this.slotName = rec.name;
      this.savedState = rec.state;
      audio.play('save');
      this.notify(`Game saved: ${rec.name}`);
      return true;
    } catch (e) {
      audio.play('error');
      this.notify(`Could not save: ${(e as Error).message}`);
      return false;
    }
  }

  async autosave(): Promise<void> {
    if (!this.store.state.playerNation) return;
    try {
      await putSave(makeSave(this.store.state, this.scenario, { id: AUTOSAVE_ID, name: `Autosave — ${this.scenario.name}`, auto: true }));
    } catch {
      /* autosave failures are silent */
    }
  }

  private maybeAutosave(s: GameState) {
    const every = getSettings().autosave === 'weekly' ? 7 : getSettings().autosave === 'monthly' ? 30 : 0;
    const day = Math.floor(s.clock.hours / 24);
    if (!every || day - this.lastAutosaveDay < every) return;
    this.lastAutosaveDay = day;
    void this.autosave();
  }

  /** Leaves to the main menu (autosaving first when enabled). */
  async quitToMenu() {
    if (getSettings().autosave !== 'off' && this.dirty) await this.autosave();
    location.href = location.pathname;
  }
}
