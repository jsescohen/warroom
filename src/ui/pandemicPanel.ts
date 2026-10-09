import { budgetOf } from '../core/economy';
import {
  COLLAPSE_DAYS, CURE, FUNDING, formatShare, fundingOf, healthOf, healthUse, LOCKDOWN, lockdownOf, MAX_AID, nationHealth, neighboursOf,
  nextTrial, OVERRUN, pactPartners, pooledRate, researchRate, SEVERITY, WIN_IMMUNE, worldDeaths, worldSickShare,
} from '../core/pandemic';
import { formatPop } from '../core/population';
import type { GameStore } from '../core/store';
import { formatShortDate } from '../core/time';
import type { Action } from '../core/actions';
import type { NationId } from '../core/types';
import { fill, h, swatch } from './dom';
import { openPanel, segmented, toggle } from './menus/shell';

export interface PandemicHooks {
  toast(text: string): void;
  diplomacy(nation: NationId): void;
}

/**
 * The pandemic window (the outbreak counter in the top bar, or P): your outbreak in numbers, the
 * measures (lockdown, borders, research funding), the race for a cure, sharing the cure and
 * sending help, and the hardest-hit nations you know of.
 */
export function openPandemic(store: GameStore, hooks: PandemicHooks, opts: { target?: NationId; intro?: boolean } = {}) {
  const d0 = store.state.disease;
  const panel = openPanel(d0 ? d0.name : 'Pandemic', { wide: true, eyebrow: d0 ? `${SEVERITY[d0.severity].label} pandemic · ${formatShortDate(store.state.clock)}` : '' });
  let target: NationId | '' = opts.target ?? '';
  let what = 'money';
  let amount = 10;
  let shareTo: NationId | '' = opts.target ?? '';
  let intro = !!opts.intro;
  let key = '';

  const act = (action: Action) => {
    const me = store.state.playerNation;
    if (!me) return;
    const r = store.dispatch(action, me);
    if (!r.ok) hooks.toast(r.error);
    key = '';
    render();
  };

  const render = () => {
    const s = store.state;
    const world = store.world;
    const me = s.playerNation;
    const d = s.disease;
    if (!d) return fill(panel.body, h('p', null, 'There is no pandemic in this era.'));
    if (!me || !s.nations[me]) return fill(panel.body, h('p', null, 'Choose your nation first.'));
    // redraw once a day or after an order, and never under an open dropdown
    const k = `${Math.floor(s.clock.hours / 24)}|${JSON.stringify(s.nations[me].health ?? {})}|${s.nations[me].treasury}|${s.treaties.length}|${target}|${what}|${amount}|${shareTo}|${intro}`;
    if (k === key) return;
    if (panel.body.contains(document.activeElement) && document.activeElement?.tagName === 'SELECT') return;
    key = k;

    const h0 = healthOf(s, me);
    const mine = nationHealth(s, world, me);
    const sev = SEVERITY[d.severity];
    const name = (n: NationId) => s.nations[n]?.shortName ?? n;
    const pct = (v: number) => formatShare(v);
    const lock = lockdownOf(s, me);
    const funding = fundingOf(s, me);
    const b = budgetOf(s, world, me);
    const use = healthUse(s, world, me);
    const stock = s.nations[me].stock ?? {};
    const resName = (r: string) => world.resources[r]?.name.toLowerCase() ?? r;

    // ---- the numbers
    const overrunDays = h0.overrun ?? 0;
    const status = d.fallen?.includes(me)
      ? h('p', { class: 'danger-text' }, 'Your health system has collapsed.')
      : overrunDays > 0
        ? h('p', { class: 'danger-text' }, `Hospitals overwhelmed for ${overrunDays} day${overrunDays === 1 ? '' : 's'}: if half your people are still in overwhelmed provinces after ${COLLAPSE_DAYS} days, the health system collapses and you lose.`)
        : mine.overrunShare > 0
          ? h('p', { class: 'warn-text' }, `${pct(mine.overrunShare)} of your people live where hospitals are overwhelmed (${Math.round(OVERRUN * 100)}% sick). Above half, you have ${COLLAPSE_DAYS} days to bring it down.`)
          : null;

    // ---- measures
    const lockBill = use.food ? ` Uses ${use.food} food and ${use.gear ?? 0} protective gear a month (you have ${Math.floor(stock.food ?? 0)} and ${Math.floor(stock.gear ?? 0)}).` : '';
    const near = neighboursOf(s, world, me);

    // ---- research
    const research = h0.research ?? 0;
    const rate = pooledRate(s, world, me);
    const own = researchRate(s, world, me);
    const partners = pactPartners(s, me);
    const trial = nextTrial(s, me);
    const labs = Object.values(s.provinces).filter((p) => p.owner === me && p.build?.includes('lab')).length;
    const daysLeft = rate > 0 ? Math.ceil((CURE - research) / rate) : Infinity;
    const cured = Object.values(s.nations).filter((n) => n.alive && n.health?.cure);

    // ---- the world, as far as you can see it
    const others = Object.values(s.nations).filter((n) => n.alive && n.id !== me)
      .map((n) => {
        const nh = nationHealth(s, world, n.id);
        const visible = partners.includes(n.id) || s.treaties.some((t) => t.type === 'alliance' && t.parties.includes(me) && t.parties.includes(n.id)) || nh.sickShare >= 0.005;
        return { n, nh, visible };
      })
      .filter((x) => x.visible && x.nh.sickShare > 0)
      .sort((a, b2) => b2.nh.sickShare - a.nh.sickShare || (a.n.id < b2.n.id ? -1 : 1))
      .slice(0, 10);

    const nations = Object.values(s.nations).filter((n) => n.alive && n.id !== me).sort((a, b2) => a.shortName.localeCompare(b2.shortName));
    const pick = (value: string, onChange: (v: string) => void, opts2: [string, string][], label: string) => {
      const sel = h('select', { class: 'diplo-select', 'aria-label': label }, ...opts2.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
      sel.value = value;
      sel.addEventListener('change', () => { onChange(sel.value); key = ''; render(); });
      return sel;
    };
    const aidErr = target ? null : 'Pick a nation';
    const giveOpts: [string, string][] = [['money', `Money (you have ${Math.floor(s.nations[me].treasury ?? 0)})`], ...Object.values(world.resources).map((r) => [r.id, `${r.name} (you have ${Math.floor(stock[r.id] ?? 0)})`] as [string, string])];

    fill(panel.body,
      intro ? h('div', { class: 'plague-intro' },
        h('p', null, h('strong', null, `${d.name} has broken out in ${world.provinces[d.origin]?.name ?? 'a distant city'}.`), ` ${sev.text} There are no wars now: the enemy is the virus.`),
        h('ul', null,
          h('li', null, 'Keep it out: close your borders, put guard troops on the border, lock down when cases appear, quarantine the worst provinces.'),
          h('li', null, `Survive it: if half your people live where hospitals are overwhelmed for ${COLLAPSE_DAYS} days, your health system collapses and you lose. Hospitals cut deaths.`),
          h('li', null, 'Cure it: labs research a cure, faster in a research pact (propose one in Diplomacy). Trials need rare plant compounds, lab reagents and medicines.'),
          h('li', null, `Win: have the cure and ${Math.round(WIN_IMMUNE * 100)}% of your people immune with the outbreak over at home, or outlast the disease.`)),
        h('button', { class: 'btn primary', onclick: () => { intro = false; key = ''; render(); } }, 'Understood')) : null,

      h('div', { class: 'econ-head' },
        h('div', null, h('div', { class: 'eyebrow' }, 'Sick now'), h('div', { class: `econ-big ${mine.sickShare >= OVERRUN ? 'danger-text' : mine.sickShare > 0.005 ? 'warn-text' : ''}` }, mine.sick ? formatPop(mine.sick) : '0'), h('div', { class: 'dim small' }, pct(mine.sickShare))),
        h('div', null, h('div', { class: 'eyebrow' }, 'Immune'), h('div', { class: 'econ-big' }, pct(mine.immuneShare)), h('div', { class: 'dim small' }, 'recovered or vaccinated')),
        h('div', null, h('div', { class: 'eyebrow' }, 'Deaths'), h('div', { class: `econ-big ${(h0.deaths ?? 0) > 0 ? 'danger-text' : ''}` }, formatPop(h0.deaths ?? 0)), h('div', { class: 'dim small' }, `world: ${formatPop(worldDeaths(s))}`)),
        h('div', null, h('div', { class: 'eyebrow' }, 'Cure'), h('div', { class: `econ-big ${h0.cure ? 'ok-text' : ''}` }, h0.cure ? 'Found' : `${Math.floor(research)}%`), h('div', { class: 'dim small' }, h0.cure ? 'vaccinating' : `${cured.length} nation${cured.length === 1 ? ' has' : 's have'} it`)),
      ),
      status,
      h('p', { class: 'setting-hint' }, `${mine.infected} of your ${mine.provinces} provinces have cases. The world: ${pct(worldSickShare(s, world))} sick. You see every case in your land, your allies' and your research partners'; elsewhere only outbreaks big enough to make the news.`),

      h('h3', null, 'Measures'),
      h('div', { class: 'picker-difficulty' }, h('span', null, 'Lockdown'),
        segmented(lock, LOCKDOWN.map((l, i) => [i, l.label] as [number, string]), (v) => act({ type: 'setHealth', lockdown: v }))),
      h('p', { class: 'setting-hint' }, `${LOCKDOWN[lock].text}${lockBill} Masks need protective gear in stock; a lockdown without food breaks down.`),
      h('div', { class: 'picker-difficulty' }, h('span', null, 'Close the borders'),
        toggle(!!h0.borders, (v) => act({ type: 'setHealth', borders: v }), 'Close the borders')),
      h('p', { class: 'setting-hint' }, `Ninety percent fewer travellers by land, sea and air; guard troops standing in a border province stop most of the rest. ${near.length ? `Your neighbours (${near.slice(0, 6).map(name).join(', ')}${near.length > 6 ? '…' : ''}) will resent it.` : ''}`),
      h('div', { class: 'picker-difficulty' }, h('span', null, 'Research funding'),
        segmented(funding, FUNDING.map((f, i) => [i, f.label] as [number, string]), (v) => act({ type: 'setHealth', funding: v }))),
      h('p', { class: 'setting-hint' }, `Costs ${b.health ?? 0} a month. Quarantine a province from its panel: nothing goes in or out, and it works for no one.`),

      h('h3', null, 'The race for a cure'),
      h0.cure
        ? h('p', { class: 'ok-text' }, `You have the cure. ${pct(mine.immuneShare)} of your people are immune; vaccination ${(stock.medicine ?? 0) >= 1 ? `uses ${use.medicine ?? 0} medicines a month` : 'has slowed: you are out of medicines'}.`)
        : h('div', null,
          h('div', { class: 'cure-bar' }, h('span', { style: `width:${Math.min(100, research)}%` }), ...[35, 70].map((at) => h('i', { style: `left:${at}%` }))),
          h('p', { class: 'setting-hint' }, `${rate.toFixed(2)} a day (${own.toFixed(2)} from your ${labs} lab${labs === 1 ? '' : 's'}${partners.length ? `, the rest from ${partners.map(name).join(', ')}` : ''}): ${Number.isFinite(daysLeft) ? `about ${daysLeft} days to go` : 'no progress'}${trial ? `, not counting the trials` : ''}. Build labs in big provinces; each uses a lab reagent a month.`),
          trial ? h('p', { class: research >= trial.at ? 'warn-text' : 'setting-hint' },
            `${trial.name} at ${trial.at}% need `, ...Object.entries(trial.needs).flatMap(([r, q], i) => [i ? ' and ' : '', h('span', { class: (stock[r] ?? 0) >= q ? 'ok-text' : 'danger-text' }, `${q} ${resName(r)} (you have ${Math.floor(stock[r] ?? 0)})`)]),
            research >= trial.at ? ': research waits until you have them. Buy them in the Treasury or trade for them.' : '.') : null,
          h('p', { class: 'setting-hint' }, partners.length ? `Research pacts pool all your work, and partners share their trials and the cure.` : 'No research pact yet: propose one in Diplomacy. Partners pool their research and share the cure.')),

      h('h3', null, 'Help another nation'),
      h('div', { class: 'aid-row' },
        pick(target, (v) => { target = v; }, [['', 'Choose a nation…'], ...nations.map((n) => [n.id, n.shortName] as [string, string])], 'Nation'),
        pick(what, (v) => { what = v; }, giveOpts, 'What to send'),
        h('div', { class: 'mk-qty' }, ...[5, 10, 25].map((v) => h('button', { class: `btn small${amount === v ? ' primary' : ''}`, onclick: () => { amount = v; key = ''; render(); } }, String(v)))),
        h('button', { class: 'btn', disabled: !!aidErr, title: aidErr ?? 'Send it now: they will remember', onclick: () => target && act({ type: 'sendAid', to: target, what, amount: Math.min(MAX_AID, amount) }) }, 'Send')),
      h('p', { class: 'setting-hint' }, 'Gifts win friends, more so when they are in trouble. A friend is likelier to join a research pact and to share its cure.'),
      h0.cure ? h('div', { class: 'aid-row' },
        pick(shareTo, (v) => { shareTo = v; }, [['', 'Share the cure with…'], ...nations.filter((n) => !n.health?.cure).map((n) => [n.id, n.shortName] as [string, string])], 'Share the cure with'),
        h('button', { class: 'btn primary', disabled: !shareTo, onclick: () => shareTo && act({ type: 'shareCure', to: shareTo }) }, 'Share the cure')) : null,

      h('h3', null, 'Hardest hit (that you know of)'),
      others.length
        ? h('table', { class: 'data-table' }, h('tbody', null, ...others.map(({ n, nh }) => h('tr', null,
          h('td', null, swatch(n.color), ' ', n.shortName, partners.includes(n.id) ? h('span', { class: 'chip' }, 'Partner') : null),
          h('td', { class: `num ${nh.sickShare >= OVERRUN ? 'danger-text' : ''}` }, `${pct(nh.sickShare)} sick`),
          h('td', { class: 'num dim' }, `${formatPop(n.health?.deaths ?? 0)} dead`),
          h('td', null, n.health?.cure ? h('span', { class: 'ok-text' }, 'Has the cure') : d.fallen?.includes(n.id) ? h('span', { class: 'danger-text' }, 'Collapsed') : ''),
          h('td', null, h('button', { class: 'btn small', onclick: () => { panel.close(); hooks.diplomacy(n.id); } }, 'Talk'))))))
        : h('p', { class: 'empty' }, 'No outbreaks abroad that you know of.'),
    );
  };
  render();
  const unsub = store.subscribe(() => render());
  void panel.closed.then(unsub);
  return panel.closed;
}
