import { audio } from '../audio/audio';
import { provincesOf } from '../core/queries';
import type { GameStore } from '../core/store';
import { formatDate } from '../core/time';
import type { GameState } from '../core/types';
import { legend, lineChart } from './charts';
import { h } from './dom';
import { formatShare, pactPartners, worldDeaths } from '../core/pandemic';
import { formatPop } from '../core/population';
import { historySeries } from './ledger';

/**
 * Victory and defeat screens. Shown once when the player's nation wins (reaches the conquest goal)
 * or falls; after a victory the player may keep playing.
 */
export class EndScreen {
  private shown = new Set<'victory' | 'defeat'>();

  constructor(store: GameStore, private onMenu: () => void, private onNewGame: () => void) {
    store.subscribe((s, prev) => this.check(s, prev));
  }

  private check(s: GameState, prev: GameState) {
    const player = s.playerNation;
    if (!player) return;
    if (s.winner === player && prev.winner !== player && !this.shown.has('victory')) this.show('victory', s);
    else if (!s.nations[player]?.alive && prev.nations[player]?.alive && !this.shown.has('defeat')) this.show('defeat', s);
    // a pandemic is lost when the health system collapses
    else if (s.disease?.fallen?.includes(player) && !prev.disease?.fallen?.includes(player) && !this.shown.has('defeat')) this.show('defeat', s);
  }

  private show(kind: 'victory' | 'defeat', s: GameState) {
    this.shown.add(kind);
    audio.play(kind);
    const player = s.playerNation!;
    const nation = s.nations[player];
    const total = Object.keys(s.provinces).length;
    const held = provincesOf(s, player).length;
    const days = Math.floor(s.clock.hours / 24);
    const mine = (k: string) => s.events.filter((e) => e.kind === k && e.nations?.includes(player)).length;
    const d = s.disease;
    const hh = nation.health ?? {};
    const stats: [string, string][] = d ? [
      ['Date', formatDate(s.clock)],
      ['Days of the pandemic', String(days)],
      ['People lost to the disease', `${formatPop(hh.deaths ?? 0)} (world: ${formatPop(worldDeaths(s))})`],
      ['Most sick at once', formatShare(hh.peak ?? 0)],
      ['The cure', hh.cure ? (d.curedAt !== undefined ? `found on day ${Math.floor(d.curedAt / 24)}` : 'yes') : 'not found'],
      ['Research pacts', String(pactPartners(s, player).length)],
    ] : [
      ['Date', formatDate(s.clock)],
      ['Days in command', String(days)],
      ['Provinces held', `${held} of ${total} (${Math.round((held / total) * 100)}%)`],
      ['Wars', String(mine('war'))],
      ['Treaties signed', String(mine('agreement'))],
      ['Capitals taken', String(s.events.filter((e) => (e.kind === 'capital' || e.kind === 'capitulation') && e.nations?.[1] === player).length)],
    ];
    const close = () => el.remove();
    const el = h('div', { class: `end-screen ${kind}` },
      h('div', { class: 'end-card panel' },
        h('div', { class: 'eyebrow' }, nation.name),
        h('h1', null, kind === 'victory' ? (d ? 'Survived' : 'Victory') : (d ? 'Collapse' : 'Defeat')),
        h('p', null, d
          ? (kind === 'victory'
            ? `${nation.shortName} has come through ${d.name}. History will remember how you led your people through it.`
            : `${nation.shortName}'s hospitals were overwhelmed for too long: the health system has collapsed under ${d.name}.`)
          : kind === 'victory'
            ? `${nation.shortName} dominates the world. History will remember this reign.`
            : `${nation.shortName} has fallen. Its people now answer to foreign masters.`),
        h('dl', { class: 'kv end-stats' }, ...stats.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
        ...(() => {
          const { series, xLabels } = historySeries(s, 'p');
          return series.length && !d ? [h('div', { class: 'eyebrow' }, 'Territory over the game'), lineChart(series, xLabels, { height: 170, title: 'Territory' }), legend(series)] : [];
        })(),
        h('div', { class: 'modal-actions' },
          kind === 'victory' ? h('button', { class: 'btn', onclick: close }, 'Keep playing') : h('button', { class: 'btn', onclick: close }, 'Watch the world'),
          h('button', { class: 'btn', onclick: this.onNewGame }, 'New game'),
          h('button', { class: 'btn primary', onclick: this.onMenu }, 'Main menu'),
        ),
      ),
    );
    document.body.append(el);
  }
}
