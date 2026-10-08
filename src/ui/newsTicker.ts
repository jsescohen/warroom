import type { ScenarioDef } from '../core/scenario';
import type { GameStore } from '../core/store';
import { formatShortDate } from '../core/time';
import type { GameEvent, GameState } from '../core/types';
import { h } from './dom';

/**
 * A newspaper-style ticker under the top bar: the big events of the world as headlines, in the
 * voice of the era (a royal scribe in the Bronze Age, a wire service today). No AI involved:
 * headlines are written from the game's own events.
 */

const PAPERS: Record<string, { name: string; ancient: boolean }> = {
  bronze: { name: 'The Royal Scribes', ancient: true },
  'rome-rise': { name: 'Acta Diurna', ancient: true },
  'rome-fall': { name: 'The Imperial Courier', ancient: true },
  renaissance: { name: 'The Gazette', ancient: false },
  ww1: { name: 'The Morning Dispatch', ancient: false },
  ww2: { name: 'The Evening Wire', ancient: false },
  modern: { name: 'Global Wire', ancient: false },
  usa: { name: 'Liberty Wire', ancient: false },
};

const MAX_HEADLINES = 6;

/** A headline for an event, or null if it is not news (pure, for tests). */
export function headline(s: GameState, e: GameEvent, ancient: boolean): string | null {
  const n = e.nations ?? [];
  const name = (id: string | undefined) => (id && s.nations[id]?.shortName) || 'Unknown';
  const majorOrPlayer = n.some((id) => s.nations[id]?.major || id === s.playerNation);
  switch (e.kind) {
    case 'war':
      if (!majorOrPlayer) return null;
      return ancient ? `${name(n[0])} marches against ${name(n[1])}` : `${name(n[0])} declares war on ${name(n[1])}`;
    case 'capital':
      return ancient ? `The seat of ${name(n[0])} falls to ${name(n[1])}` : `${name(n[0])}'s capital falls to ${name(n[1])}: government flees`;
    case 'capitulation':
      return `${name(n[0])} surrenders to ${name(n[1])}`;
    case 'annexed':
      return ancient ? `${name(n[0])} is no more: its lands pass to ${name(n[1])}` : `${name(n[0])} wiped from the map by ${name(n[1])}`;
    case 'agreement':
      return majorOrPlayer ? e.text.replace(/\.$/, '') : null;
    case 'treaty-broken':
      return majorOrPlayer ? `Treaty torn up: ${e.text.replace(/\.$/, '')}` : null;
    case 'history':
      return e.text.replace(/\.$/, '');
    case 'victory':
      return `${name(n[0])} stands supreme over the known world`;
    case 'defeat':
      return `${name(n[0])} has fallen`;
    default:
      return null;
  }
}

export class NewsTicker {
  readonly el = h('div', { class: 'news-ticker', 'aria-live': 'polite' });
  private items: { text: string; at: number }[] = [];
  private lastEvent: number;
  private paper: { name: string; ancient: boolean };

  constructor(private store: GameStore, scenario: ScenarioDef) {
    this.paper = PAPERS[scenario.id] ?? { name: 'The Wire', ancient: false };
    // start with the latest big events already in the log (a loaded game)
    const s = store.state;
    for (const e of s.events) this.add(s, e);
    this.lastEvent = s.events.at(-1)?.id ?? -1;
    store.subscribe((st, prev) => {
      if (st.events === prev.events) return;
      for (const e of st.events) if (e.id > this.lastEvent) this.add(st, e);
      this.lastEvent = st.events.at(-1)?.id ?? this.lastEvent;
      this.render();
    });
    this.render();
  }

  private add(s: GameState, e: GameEvent) {
    const text = headline(s, e, this.paper.ancient);
    if (!text) return;
    this.items = [{ text: text.toUpperCase(), at: e.at }, ...this.items].slice(0, MAX_HEADLINES);
  }

  private render() {
    if (!this.items.length) { this.el.style.display = 'none'; return; }
    this.el.style.display = '';
    const clock = this.store.state.clock;
    const track = h('div', { class: 'news-track' },
      ...this.items.flatMap((it, i) => [
        i ? h('span', { class: 'news-sep', 'aria-hidden': 'true' }, '◆') : null,
        h('span', { class: 'news-item' }, h('time', null, formatShortDate({ ...clock, hours: it.at })), it.text),
      ].filter((x): x is HTMLElement => !!x)),
    );
    // scroll speed independent of length: about 60 px per second
    track.style.animationDuration = `${Math.max(20, this.items.reduce((x, it) => x + it.text.length, 0) * 0.16)}s`;
    this.el.replaceChildren(h('span', { class: 'news-paper' }, this.paper.name), h('div', { class: 'news-window' }, track));
  }
}
