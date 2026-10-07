import { pickInitiative } from '../core/diplomacy';
import type { GameStore } from '../core/store';
import type { NationId } from '../core/types';
import type { Diplomat } from './diplomat';

/**
 * Lets AI leaders write to the player first. Once per in-game day it asks the rules which leader
 * (if any) wants to make contact, and when an AI declares war on the player that leader sends a
 * message. The LLM only writes the words; triggers and terms are deterministic.
 */
export class DiplomacyDirector {
  private lastDay = -1;
  private handledWarEvents = new Set<number>();
  private running = false;

  constructor(private store: GameStore, private diplomat: Diplomat, private enabled: () => boolean, private onContact: (from: NationId) => void) {
    // events from before the director existed (scenario setup) never trigger messages
    for (const e of store.state.events) this.handledWarEvents.add(e.id);
    store.subscribe((s, prev) => {
      if (s.clock.hours === prev.clock.hours) return;
      const day = Math.floor(s.clock.hours / 24);
      if (day !== this.lastDay) {
        this.lastDay = day;
        void this.check();
      }
    });
  }

  private async check() {
    if (this.running || !this.enabled()) return;
    const s = this.store.state;
    const player = s.playerNation;
    if (!player) return;
    this.running = true;
    try {
      // 1) someone just declared war on the player: they send their declaration
      const war = s.events.find((e) => e.kind === 'war' && !this.handledWarEvents.has(e.id) && e.nations?.[1] === player);
      for (const e of s.events) if (e.kind === 'war') this.handledWarEvents.add(e.id);
      if (war?.nations?.[0]) {
        const from = war.nations[0];
        const ok = await this.diplomat.initiate({ from, kind: 'war-message', purpose: 'You have ALREADY declared war on them and the fighting has begun. Announce it and give your reasons. Make no demands and offer no terms.' });
        if (ok) this.onContact(from);
        return;
      }
      // 2) otherwise maybe one proactive contact
      const init = pickInitiative(s, this.store.world);
      if (!init) return;
      if (await this.diplomat.initiate(init)) this.onContact(init.from);
    } finally {
      this.running = false;
    }
  }
}
