import { armyCount, budgetOf, importsOf, manpowerCap, needsOf, producedBy, tradeRoutes } from '../core/economy';
import { basePop, formatPop, nationPop } from '../core/population';
import type { GameStore } from '../core/store';
import { formatShortDate } from '../core/time';
import { fill, h, swatch } from './dom';
import { openPanel } from './menus/shell';

/**
 * The treasury (click the money in the top bar): where the money comes from and goes, manpower,
 * resources and trade routes. Recruiting and building are done in each province's panel.
 */
export function openEconomy(store: GameStore, hooks: { focus(province: string): void }) {
  const panel = openPanel('Treasury', { eyebrow: formatShortDate(store.state.clock) });
  const render = () => {
    const s = store.state;
    const world = store.world;
    const me = s.playerNation;
    if (!me || !s.nations[me]) return fill(panel.body, h('p', null, 'Choose your nation first.'));
    const n = s.nations[me];
    const b = budgetOf(s, world, me);
    const sign = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;
    const row = (k: string, v: string, cls = '') => h('tr', null, h('td', null, k), h('td', { class: `num ${cls}` }, v));
    const produced = producedBy(s, world, me);
    const imported = importsOf(s, world, me);
    const needed = new Set(Object.values(s.armies).filter((a) => a.owner === me).flatMap((a) => needsOf(world, a.unitType)));
    const detailed = s.rules.economy === 'detailed';
    const resRows = Object.values(world.resources).map((r) => {
      const own = produced.get(r.id) ?? 0;
      const via = imported.filter(([x]) => x === r.id).map(([, from]) => s.nations[from]?.shortName ?? from);
      const has = own > 0 || via.length > 0;
      const short = n.short?.includes(r.id);
      const users = (r.units ?? []).filter((u) => world.unitTypes[u]).map((u) => world.unitTypes[u].name);
      const status = own ? `${own} province${own === 1 ? '' : 's'}` : via.length ? `Imported from ${via.join(', ')}` : users.length ? 'Missing' : '—';
      return h('tr', null,
        h('td', null, swatch(r.color), ' ', r.name),
        h('td', { class: !has && needed.has(r.id) ? 'danger-text' : '' }, status),
        detailed ? h('td', { class: `num${short ? ' danger-text' : ''}` }, `${Math.round(n.stock?.[r.id] ?? 0)}${short ? ' (out)' : ''}`) : null,
        h('td', { class: 'dim' }, users.length ? `Needed by ${users.join(', ')}` : `Sells for ${r.value}/month a province`),
      );
    });
    const routes = tradeRoutes(s, me).map((t) => {
      const other = t.parties.find((p) => p !== me)!;
      const first = t.parties[0] === me;
      const give = first ? t.trade?.sell : t.trade?.buy;
      const get = first ? t.trade?.buy : t.trade?.sell;
      const gold = (t.trade?.gold ?? 0) * (first ? -1 : 1);
      const name = (r?: string) => (r ? world.resources[r]?.name ?? r : null);
      const parts = [get ? `you get ${name(get)}` : '', give ? `you give ${name(give)}` : '', gold ? `${gold > 0 ? 'you receive' : 'you pay'} ${Math.abs(gold)}/month` : ''].filter(Boolean);
      return h('li', null, swatch(s.nations[other]?.color ?? '#888'), h('span', null, `${s.nations[other]?.shortName ?? other}: ${parts.join(', ')}`),
        h('button', { class: 'btn small', title: 'End this trade agreement (they will not like it)', onclick: () => { store.dispatch({ type: 'cancelTreaty', treaty: t.id }, me); render(); } }, 'End'));
    });
    const barracks = Object.keys(s.provinces).filter((p) => s.provinces[p].owner === me && s.provinces[p].build?.length);
    const lost = Object.keys(s.provinces).filter((p) => s.provinces[p].owner === me).reduce((x, p) => x + Math.max(0, basePop(s, world, p) - (s.provinces[p].pop ?? basePop(s, world, p))), 0);
    fill(panel.body,
      h('div', { class: 'econ-head' },
        h('div', null, h('div', { class: 'eyebrow' }, 'Treasury'), h('div', { class: 'econ-big' }, String(Math.floor(n.treasury ?? 0)))),
        h('div', null, h('div', { class: 'eyebrow' }, 'Per month'), h('div', { class: `econ-big ${b.net < 0 ? 'danger-text' : 'ok-text'}` }, sign(b.net))),
        h('div', null, h('div', { class: 'eyebrow' }, 'Armies'), h('div', { class: 'econ-big' }, `${armyCount(s, world, me)} / ${manpowerCap(s, world, me)}`)),
        h('div', null, h('div', { class: 'eyebrow' }, 'Population'), h('div', { class: 'econ-big' }, formatPop(nationPop(s, world, me)))),
      ),
      b.net < 0 ? h('p', { class: 'danger-text' }, 'You spend more than you earn. When the treasury runs dry, unpaid troops desert.') : null,
      h('table', { class: 'data-table' }, h('tbody', null,
        row('Taxes from land and people', sign(b.land)),
        row('Resources sold', sign(b.resources)),
        b.trade ? row('Trade payments', sign(b.trade), b.trade < 0 ? 'danger-text' : '') : null,
        row('Army upkeep', sign(-b.upkeep), 'danger-text'),
        row('Net every month', sign(b.net), b.net < 0 ? 'danger-text' : 'ok-text'),
      )),
      h('p', { class: 'setting-hint' }, `Money is paid at the start of each month. Recruit troops in a province with barracks (or an airfield for aircraft): select it on the map. Manpower grows with the land and people you hold.${lost > 0 ? ` War has cost your provinces ${formatPop(lost)} people.` : ''}`),
      h('h3', null, 'Resources'),
      h('table', { class: 'data-table' },
        h('thead', null, h('tr', null, h('th', null, 'Resource'), h('th', null, 'Source'), detailed ? h('th', { class: 'num' }, 'Stock') : null, h('th', null, ''))),
        h('tbody', null, ...resRows)),
      h('p', { class: 'setting-hint' }, detailed
        ? 'Each province with a resource adds 2 to the stock every month; armies that need it use it up, and recruiting takes 3. Run out and those units fight at three quarters strength and cannot refit.'
        : 'Units that need a resource you lack cost half as much again to recruit and a quarter more to keep. Buy it from another nation with a trade agreement (Diplomacy).'),
      h('h3', null, 'Trade routes'),
      routes.length ? h('ul', { class: 'forces' }, ...routes) : h('p', { class: 'empty' }, 'No trade agreements. Propose one in Diplomacy.'),
      barracks.length ? h('h3', null, 'Military buildings') : null,
      barracks.length ? h('ul', { class: 'forces' }, ...barracks.map((p) => h('li', { onclick: () => { hooks.focus(p); panel.close(); }, title: 'Show on the map' },
        h('span', null, world.provinces[p]?.name ?? p), h('span', { class: 'dim' }, s.provinces[p].build!.join(', '))))) : null,
    );
  };
  render();
  const unsub = store.subscribe((s, prev) => { if (s.clock !== prev.clock && s.clock.hours % 24 === 0) render(); });
  void panel.closed.then(unsub);
  return panel.closed;
}
