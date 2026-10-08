import type { ScenarioDef } from '../core/scenario';
import { formatDate } from '../core/time';
import { scenarios } from '../data/scenarios';
import { consoleScreen } from './console';
import { h } from './dom';

/** Era selection: one tile per scenario, in historical order. */
export function showEraSelect(root: HTMLElement, onPick: (s: ScenarioDef) => void, onBack?: () => void) {
  const tiles = scenarios.map((sc, i) => {
    const year = formatDate({ startDate: sc.startDate, hours: 0, tickHours: 24, turnHours: 24 }).replace(/^\d+ \w+ /, '');
    const majors = sc.nations.filter((n) => n.major).slice(0, 5).map((n) => n.shortName ?? n.name);
    return h('button', { class: 'cx-era', onclick: () => onPick(sc) },
      h('div', { class: 'cx-era-top' }, h('span', null, year), h('span', null, `${String(i + 1).padStart(2, '0')} / ${String(scenarios.length).padStart(2, '0')}`)),
      h('h2', null, sc.name),
      h('div', { class: 'cx-era-sub' }, sc.subtitle.replace(/^[^—]*—\s*/, '')),
      h('p', null, sc.context.split('. ').slice(0, 2).join('. ').replace(/\.?$/, '.')),
      h('div', { class: 'cx-era-powers' }, ...majors.map((m) => h('span', null, m))),
      h('span', { class: 'cx-era-go', 'aria-hidden': 'true' }, 'Start →'),
    );
  });
  root.replaceChildren(consoleScreen({ page: 'eras', title: 'Warroom Beta — Choose an era', right: onBack ? h('button', { class: 'cx-link', onclick: onBack }, '← Main menu') : null },
    h('main', { class: 'cx-page' },
      h('header', { class: 'cx-page-head' },
        h('div', { class: 'cx-kicker' }, h('span', { class: 'cx-dot' }), 'New game · step 1 of 2'),
        h('h1', null, 'Choose an era'),
        h('p', null, 'Then pick the nation you will lead. Every other nation is led by an AI that remembers what you do.'),
      ),
      h('div', { class: 'cx-era-grid' }, ...tiles),
    ),
  ));
}
