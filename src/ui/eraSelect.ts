import type { ScenarioDef } from '../core/scenario';
import { formatDate } from '../core/time';
import { scenarios } from '../data/scenarios';
import { h } from './dom';

/** Card art per theme: layered gradients evoking the era (polished further in step 8). */
const ART: Record<ScenarioDef['theme'], string> = {
  parchment: 'radial-gradient(circle at 70% 30%, #f3d58a 0 18%, transparent 19%), linear-gradient(160deg, #c9a15b, #7a4f22 70%, #3d2810)',
  marble: 'radial-gradient(circle at 30% 20%, rgba(255,255,255,.7), transparent 45%), linear-gradient(150deg, #f1ece2, #c9b98f 60%, #8a6d3b)',
  ornate: 'radial-gradient(circle at 75% 25%, #e8c66a 0 10%, transparent 11%), linear-gradient(150deg, #7a1d2e, #3d0f1a 65%, #1b0a10)',
  sepia: 'repeating-linear-gradient(90deg, rgba(0,0,0,.06) 0 2px, transparent 2px 9px), linear-gradient(160deg, #b9a77f, #6b6447 60%, #2f2c1f)',
  tactical: 'repeating-linear-gradient(0deg, rgba(90,200,220,.08) 0 1px, transparent 1px 22px), repeating-linear-gradient(90deg, rgba(90,200,220,.08) 0 1px, transparent 1px 22px), linear-gradient(160deg, #1f3440, #0d171d 70%)',
};

/** Era selection screen: one card per scenario. */
export function showEraSelect(root: HTMLElement, onPick: (s: ScenarioDef) => void, onBack?: () => void) {
  document.documentElement.dataset.theme = 'sepia';
  document.title = 'Warroom Beta — Choose an era';
  const cards = scenarios.map((sc) => {
    const year = formatDate({ startDate: sc.startDate, hours: 0, tickHours: 24, turnHours: 24 }).replace(/^\d+ \w+ /, '');
    const majors = sc.nations.filter((n) => n.major).slice(0, 5).map((n) => n.shortName ?? n.name).join(' · ');
    return h('button', { class: `era-card theme-${sc.theme}`, onclick: () => onPick(sc) },
      h('div', { class: 'era-art', style: `background:${ART[sc.theme]}` }, h('span', { class: 'era-year' }, year)),
      h('div', { class: 'era-body' },
        h('h2', null, sc.name),
        h('div', { class: 'era-sub' }, sc.subtitle.replace(/^[^—]*—\s*/, '')),
        h('p', null, sc.context.split('. ').slice(0, 2).join('. ').replace(/\.?$/, '.')),
        h('div', { class: 'era-powers' }, majors),
      ),
    );
  });
  root.replaceChildren(h('div', { class: 'era-screen' },
    h('header', { class: 'era-head' },
      onBack ? h('button', { class: 'btn', onclick: onBack }, '← Main menu') : null,
      h('h1', null, 'Choose an era'), h('p', null, 'Every other nation is led by an AI that remembers what you do.')),
    h('div', { class: 'era-grid' }, ...cards),
  ));
}
