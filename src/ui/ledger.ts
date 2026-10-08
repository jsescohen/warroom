import type { GameStore } from '../core/store';
import { formatShortDate } from '../core/time';
import { allied, atWar, provincesOf } from '../core/queries';
import type { GameState, NationId } from '../core/types';
import { isFleet } from '../core/military';
import { legend, lineChart, type Series } from './charts';
import { fill, h, swatch } from './dom';
import { openPanel } from './menus/shell';

type Tab = 'powers' | 'territory' | 'military';

/** Territory and military strength over time, for the nations the history tracks. */
export function historySeries(s: GameState, metric: 'p' | 'a'): { series: Series[]; xLabels: [string, string] } {
  const hist = s.history;
  if (!hist || !hist.t.length) return { series: [], xLabels: ['', ''] };
  const player = s.playerNation;
  // the player and the (up to) eight largest powers by their latest value
  const ids = Object.keys(hist.nations).filter((id) => s.nations[id]);
  const last = (id: NationId) => hist.nations[id][metric].at(-1) ?? 0;
  const top = ids.filter((id) => id !== player).sort((a, b) => last(b) - last(a)).slice(0, 8);
  const pick = player && ids.includes(player) ? [player, ...top] : top;
  const series = pick.map((id) => ({ label: s.nations[id].shortName, color: s.nations[id].color, values: hist.nations[id][metric], bold: id === player }));
  const at = (hours: number) => formatShortDate({ ...s.clock, hours });
  return { series, xLabels: [at(hist.t[0]), at(hist.t.at(-1)!)] };
}

/** The ledger (L): the great powers side by side, and how they changed. */
export function openLedger(store: GameStore) {
  const panel = openPanel('Ledger', { wide: true, eyebrow: formatShortDate(store.state.clock) });
  const tabs = h('nav', { class: 'menu-tabs', role: 'tablist' });
  const content = h('div', { class: 'menu-tab-content' });
  fill(panel.body, tabs, content);
  let tab: Tab = 'powers';
  let sortBy: 'provinces' | 'strength' | 'armies' = 'provinces';

  const render = () => {
    const s = store.state;
    fill(tabs, ...([['powers', 'Great powers'], ['territory', 'Territory'], ['military', 'Military']] as [Tab, string][])
      .map(([id, label]) => h('button', { class: id === tab ? 'active' : '', role: 'tab', onclick: () => { tab = id; render(); } }, label)));
    if (tab !== 'powers') {
      const { series, xLabels } = historySeries(s, tab === 'territory' ? 'p' : 'a');
      return fill(content,
        h('p', { class: 'setting-hint' }, tab === 'territory' ? 'Provinces held, week by week.' : 'Total strength of armies and fleets, week by week.'),
        lineChart(series, xLabels, { title: tab === 'territory' ? 'Territory' : 'Military strength' }),
        legend(series),
      );
    }
    const world = store.world;
    const total = Object.keys(s.provinces).length;
    const rows = Object.values(s.nations).filter((n) => n.alive && (n.major || n.id === s.playerNation)).map((n) => {
      const units = Object.values(s.armies).filter((a) => a.owner === n.id);
      const fleets = units.filter((a) => isFleet(world, a.unitType)).length;
      return {
        n, provinces: provincesOf(s, n.id).length, armies: units.length - fleets, fleets,
        strength: Math.round(units.reduce((x, a) => x + a.strength, 0)),
        wars: Object.values(s.nations).filter((o) => o.alive && atWar(s, n.id, o.id)).map((o) => o.shortName),
        allies: Object.values(s.nations).filter((o) => o.alive && o.id !== n.id && allied(s, n.id, o.id)).length,
      };
    }).sort((a, b) => b[sortBy] - a[sortBy]);
    const th = (label: string, key?: typeof sortBy) =>
      h('th', { class: key ? 'num sortable' : '', title: key ? 'Sort' : '', onclick: key ? () => { sortBy = key; render(); } : undefined }, key === sortBy ? `${label} ▾` : label);
    fill(content, h('table', { class: 'data-table ledger' },
      h('thead', null, h('tr', null, th('Nation'), th('Provinces', 'provinces'), th('Share'), th('Armies', 'armies'), th('Fleets'), th('Strength', 'strength'), th('Allies'), th('At war with'))),
      h('tbody', null, ...rows.map((r) => h('tr', { class: r.n.id === s.playerNation ? 'me' : '' },
        h('td', null, swatch(r.n.color), ' ', r.n.shortName),
        h('td', { class: 'num' }, String(r.provinces)),
        h('td', { class: 'num' }, `${((r.provinces / total) * 100).toFixed(1)}%`),
        h('td', { class: 'num' }, String(r.armies)),
        h('td', { class: 'num' }, String(r.fleets)),
        h('td', { class: 'num' }, String(r.strength)),
        h('td', { class: 'num' }, String(r.allies)),
        h('td', { class: 'wars' }, r.wars.join(', ') || '—'),
      ))),
    ));
  };
  render();
  const unsub = store.subscribe((s, prev) => { if (s.clock !== prev.clock && s.clock.hours % 24 === 0) render(); });
  void panel.closed.then(unsub);
  return panel.closed;
}
