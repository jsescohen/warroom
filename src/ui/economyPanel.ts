import { armyCount, budgetOf, importsOf, manpowerCap, marketError, marketPrice, marketQuote, producedBy, SELL_SHARE, STOCK_CAP, tradeRoutes, usedBy } from '../core/economy';
import { basePop, formatPop, nationPop } from '../core/population';
import type { GameStore } from '../core/store';
import { formatShortDate } from '../core/time';
import { armError, MAX_ARSENAL, weaponAvailable, weaponDef } from '../core/weapons';
import { fill, h, swatch } from './dom';
import { openPanel } from './menus/shell';
import { billText } from './sidePanel';

/**
 * The treasury (click the money in the top bar, or T): where the money comes from and goes,
 * stockpiles with the world market, weapons, and trade routes. Recruiting, building and developing
 * are done in each province's panel.
 */
export function openEconomy(store: GameStore, hooks: { focus(province: string): void; toast?(text: string): void }) {
  const panel = openPanel('Treasury', { wide: true, eyebrow: formatShortDate(store.state.clock) });
  let qty = 5;
  const act = (action: Parameters<GameStore['dispatch']>[0]) => {
    const me = store.state.playerNation;
    if (!me) return;
    const r = store.dispatch(action, me);
    if (!r.ok) hooks.toast?.(r.error);
    // online, the change arrives with the next stream message (render runs on every state change)
    render();
  };
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
    const used = usedBy(world, n.units);
    const detailed = s.rules.economy === 'detailed';

    // ---- stockpiles and the market
    const qtyBtn = (v: number) => h('button', { class: `btn small${qty === v ? ' primary' : ''}`, onclick: () => { qty = v; render(); } }, String(v));
    const resRows = Object.values(world.resources).map((r) => {
      const have = n.stock?.[r.id] ?? 0;
      const made = produced.get(r.id) ?? 0;
      const via = imported.filter(([x]) => x === r.id).map(([, from]) => s.nations[from]?.shortName ?? from);
      const short = n.short?.includes(r.id);
      const buyErr = marketError(s, world, me, r.id, qty);
      const sellErr = marketError(s, world, me, r.id, -qty);
      const units = Object.entries(world.unitCosts).filter(([, bill]) => bill[r.id]).map(([u]) => world.unitTypes[u]?.name).filter(Boolean);
      return h('tr', null,
        h('td', { title: units.length ? `Used to raise: ${units.join(', ')}` : 'Sold for money' }, swatch(r.color), ' ', r.name, used.has(r.id) ? h('span', { class: 'dim small' }, ' · your army uses it') : null),
        h('td', { class: `num${short ? ' danger-text' : have < 5 && used.has(r.id) ? ' warn-text' : ''}` }, `${Math.floor(have)} / ${STOCK_CAP}${short ? ' (out)' : ''}`),
        h('td', { class: 'num' }, made ? `+${made}` : '—', via.length ? h('div', { class: 'dim small' }, `from ${via.join(', ')}`) : null),
        h('td', { class: 'num' }, marketPrice(s, world, r.id).toFixed(1),
          qty > 1 ? h('div', { class: 'dim small' }, `${qty} for ${marketQuote(s, world, r.id, qty)}`) : null),
        h('td', { class: 'mk-actions' },
          h('button', { class: 'btn small', disabled: !!buyErr, title: buyErr ?? `Buy ${qty} for ${marketQuote(s, world, r.id, qty)}`, onclick: () => act({ type: 'market', resource: r.id, amount: qty }) }, `Buy ${qty} · ${marketQuote(s, world, r.id, qty)}`),
          h('button', { class: 'btn small', disabled: !!sellErr, title: sellErr ?? `Sell ${qty} for ${marketQuote(s, world, r.id, -qty)}`, onclick: () => act({ type: 'market', resource: r.id, amount: -qty }) }, `Sell ${qty} · ${marketQuote(s, world, r.id, -qty)}`)),
      );
    });

    // ---- weapons
    const weapons = (['missile', 'nuke'] as const).map((w) => {
      const def = weaponDef(world, w);
      if (!def) return null;
      const err = armError(s, world, me, w);
      const have = n.arsenal?.[w] ?? 0;
      return h('tr', null,
        h('td', null, w === 'nuke' ? '☢ ' : '', def.name),
        h('td', { class: 'num' }, `${have} / ${MAX_ARSENAL[w]}`),
        h('td', null, `${def.cost} + ${billText(world, def.materials)}`),
        h('td', null, weaponAvailable(s, world, w)
          ? h('button', { class: `btn small${w === 'nuke' ? ' danger' : ''}`, disabled: !!err, title: err ?? 'Build one into the arsenal', onclick: () => act({ type: 'arm', weapon: w }) }, 'Build')
          : h('span', { class: 'dim small' }, `from ${def.from}`)),
      );
    }).filter(Boolean);

    const routes = tradeRoutes(s, me).map((t) => {
      const other = t.parties.find((p) => p !== me)!;
      const first = t.parties[0] === me;
      const give = first ? t.trade?.sell : t.trade?.buy;
      const get = first ? t.trade?.buy : t.trade?.sell;
      const gold = (t.trade?.gold ?? 0) * (first ? -1 : 1);
      const name = (r?: string) => (r ? world.resources[r]?.name ?? r : null);
      const parts = [get ? `you get ${name(get)}` : '', give ? `you give ${name(give)}` : '', gold ? `${gold > 0 ? 'you receive' : 'you pay'} ${Math.abs(gold)}/month` : ''].filter(Boolean);
      return h('li', null, swatch(s.nations[other]?.color ?? '#888'), h('span', null, `${s.nations[other]?.shortName ?? other}: ${parts.join(', ')}`),
        h('button', { class: 'btn small', title: 'End this trade agreement', onclick: () => act({ type: 'cancelTreaty', treaty: t.id }) }, 'End'));
    });
    const buildings = Object.keys(s.provinces).filter((p) => s.provinces[p].owner === me && (s.provinces[p].build?.length || s.provinces[p].level));
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
        b.trade ? row('Trade agreement payments', sign(b.trade), b.trade < 0 ? 'danger-text' : '') : null,
        row('Army upkeep', sign(-b.upkeep), 'danger-text'),
        row('Net every month', sign(b.net), b.net < 0 ? 'danger-text' : 'ok-text'),
      )),
      h('p', { class: 'setting-hint' }, `Money and goods come in at the start of each month. Develop provinces for more taxes and people.${lost > 0 ? ` War has cost your provinces ${formatPop(lost)} people.` : ''}`),

      h('div', { class: 'mk-head' }, h('h3', null, 'Stockpiles and the world market'), h('div', { class: 'mk-qty' }, h('span', { class: 'dim small' }, 'Amount'), qtyBtn(1), qtyBtn(5), qtyBtn(20))),
      h('table', { class: 'data-table market' },
        h('thead', null, h('tr', null, h('th', null, 'Resource'), h('th', { class: 'num' }, 'Stock'), h('th', { class: 'num' }, 'Made / month'), h('th', { class: 'num' }, 'Price each'), h('th', null, ''))),
        h('tbody', null, ...resRows)),
      h('p', { class: 'setting-hint' }, `Units, weapons and developing provinces cost materials. A province with a resource makes 1 a month, 4 with its mine, farm or factory (build it in the province). Prices rise as everyone buys and fall as they sell; selling pays ${Math.round(SELL_SHARE * 100)}% of the price. Storage holds ${STOCK_CAP}: the surplus is sold at the end of the month.${detailed ? ' Detailed economy: armies also use up their resources every month; run out and those units fight at three quarters strength.' : ''}`),

      weapons.length ? h('h3', null, 'Weapons') : null,
      weapons.length ? h('table', { class: 'data-table' }, h('thead', null, h('tr', null, h('th', null, 'Weapon'), h('th', { class: 'num' }, 'Arsenal'), h('th', null, 'Cost'), h('th', null, ''))), h('tbody', null, ...weapons)) : null,
      weapons.length ? h('p', { class: 'setting-hint' }, 'Launch them from an enemy province’s panel. Air defence (a building) shoots some down and blunts air strikes on its province and the land around it.') : null,

      h('h3', null, 'Trade agreements'),
      routes.length ? h('ul', { class: 'forces' }, ...routes) : h('p', { class: 'empty' }, 'No trade agreements. Propose one in Diplomacy: each carries 3 a month.'),
      buildings.length ? h('h3', null, 'Developed land and buildings') : null,
      buildings.length ? h('ul', { class: 'forces' }, ...buildings.map((p) => h('li', { onclick: () => { hooks.focus(p); panel.close(); }, title: 'Show on the map' },
        h('span', null, world.provinces[p]?.name ?? p), h('span', { class: 'dim' }, [s.provinces[p].level ? `level ${s.provinces[p].level}` : '', ...(s.provinces[p].build ?? [])].filter(Boolean).join(', '))))) : null,
    );
  };
  render();
  const unsub = store.subscribe(() => render());
  void panel.closed.then(unsub);
  return panel.closed;
}
