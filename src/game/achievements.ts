import { ACHIEVEMENTS, achievementById, type AchievementDef } from '../../shared/accounts/achievements';
import { apiFetch, cloudSaves } from '../auth/account';
import type { ScenarioDef } from '../core/scenario';
import type { GameStore } from '../core/store';
import type { GameEvent, GameState, NationId } from '../core/types';

/**
 * Watches the game for achievements. Unlocked ones are kept on the account (signed in) or in this
 * browser (signed out); a newly unlocked one is announced once.
 */

const LOCAL_KEY = 'warroom.achievements';
const DAY = 24;

export function localAchievements(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}'); } catch { return {}; }
}

/** Ids of achievements the state shows the player has earned (pure, for tests too). */
export function earned(s: GameState, scenarioId: string, newEvents: GameEvent[]): string[] {
  const p = s.playerNation;
  if (!p) return [];
  const out: string[] = [];
  const me = s.nations[p];
  const held = Object.values(s.provinces).filter((x) => x.owner === p && x.core !== p).length;
  if (held >= 10) out.push('conqueror');
  if (held >= 50) out.push('warlord');
  const treaties = (type: string) => new Set(s.treaties.filter((t) => t.type === type && t.parties.includes(p)).flatMap((t) => t.parties).filter((n) => n !== p));
  if (treaties('alliance').size >= 1) out.push('diplomat');
  if (treaties('alliance').size >= 3) out.push('web');
  if (treaties('peace').size >= 1) out.push('peacemaker');
  if (me?.alive && s.wars.some((w) => (w.attackers.includes(p) || w.defenders.includes(p)) && s.clock.hours - w.startedAt >= 365 * DAY)) out.push('survivor');
  if (s.winner === p) {
    out.push(`win-${scenarioId}`);
    if (me && !me.major) out.push('underdog');
    if (s.rules.difficulty === 'hard') out.push('iron-will');
  }
  for (const e of newEvents) {
    const n = e.nations ?? [];
    if (e.kind === 'battle-end' && n.includes(p)) out.push('first-blood');
    if (e.kind === 'capital' && n[1] === p) out.push('decapitation');
    if (e.kind === 'army-destroyed' && e.text.includes(' sunk off ') && n[0] !== p) out.push('admiral');
    if (e.kind === 'strike' && n[0] === p) out.push('long-arm');
    if (e.kind === 'capitulation' && n[1] === p) {
      out.push('surrender');
      const loser: NationId = n[0];
      if (s.events.some((w) => w.kind === 'war' && w.nations?.includes(loser) && w.nations.includes(p) && w.at >= e.at - 30 * DAY)) out.push('blitz');
    }
  }
  return out.filter((id) => achievementById.has(id));
}

export class AchievementTracker {
  private have: Record<string, number> = localAchievements();
  private lastEvent: number;
  private pending = new Set<string>();
  private syncing = false;

  constructor(private store: GameStore, private scenario: ScenarioDef, private announce: (a: AchievementDef) => void) {
    this.lastEvent = store.state.events.at(-1)?.id ?? -1;
    if (store.readOnly) return; // spectating: nothing is earned
    if (cloudSaves()) {
      void apiFetch('/api/me/profile').then((r) => (r.ok ? r.json() : null)).then((p) => {
        if (p?.achievements) this.have = { ...this.have, ...p.achievements };
        this.check(this.store.state, []);
      }).catch(() => undefined);
    }
    store.subscribe((s, prev) => {
      if (s.events === prev.events && s.treaties === prev.treaties && s.winner === prev.winner && s.provinces === prev.provinces) return;
      const fresh = s.events.filter((e) => e.id > this.lastEvent);
      this.lastEvent = s.events.at(-1)?.id ?? this.lastEvent;
      this.check(s, fresh);
    });
  }

  private check(s: GameState, fresh: GameEvent[]) {
    for (const id of earned(s, this.scenario.id, fresh)) {
      if (this.have[id] || this.pending.has(id)) continue;
      this.have[id] = Date.now();
      this.pending.add(id);
      this.announce(achievementById.get(id)!);
    }
    if (this.pending.size) void this.sync();
  }

  private async sync() {
    if (this.syncing) return;
    this.syncing = true;
    const ids = [...this.pending];
    try {
      if (cloudSaves()) {
        const r = await apiFetch('/api/achievements', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      }
      const local = localAchievements();
      for (const id of ids) local[id] ??= this.have[id];
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(local)); } catch { /* private mode */ }
      ids.forEach((id) => this.pending.delete(id));
    } catch {
      /* try again with the next unlock */
    }
    this.syncing = false;
  }
}

export { ACHIEVEMENTS };
