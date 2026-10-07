import { requestAssessment } from '../ai/assessor';
import { estimate, kindLabel, type AssessorMode, type MajorAction, type RiskLevel } from '../core/assess';
import type { ScenarioDef } from '../core/scenario';
import type { GameState } from '../core/types';
import type { World } from '../core/world';
import { fill, h } from './dom';
import { confirmDialog } from './modal';

const riskBadge = (r: RiskLevel) => h('span', { class: `risk risk-${r.toLowerCase()}` }, r);

const meter = (pct: number) =>
  h('span', { class: 'meter' }, h('span', { style: `width:${pct}%;background:${pct >= 60 ? 'var(--ok)' : pct >= 35 ? 'var(--accent)' : 'var(--danger)'}` }));

/**
 * Shows the Assessor before a major action and resolves true if the player confirms.
 * The deterministic staff estimate appears immediately; the advisor's AI report fills in when ready.
 */
export async function assessAction(opts: {
  scenario: ScenarioDef;
  state: GameState;
  world: World;
  major: MajorAction;
  mode: AssessorMode;
  confirmLabel: string;
}): Promise<boolean> {
  const { scenario, state: s, world, major: m, mode } = opts;
  const est = estimate(s, world, m);
  const name = (id: string) => s.nations[id]?.shortName ?? id;
  const list = (ids: string[]) => (ids.length ? ids.map(name).join(', ') : 'None expected');

  const rows: [string, Node | string][] = [];
  if (est.chanceLabel) rows.push([est.chanceLabel, h('span', { class: 'meter-row' }, meter(est.successChance), h('strong', null, `${est.successChance}%`))]);
  rows.push(['Risk', riskBadge(est.risk)], ['Strength', `${est.ourPower} ours vs ${est.theirPower} theirs`]);
  if (m.kind === 'declareWar' || m.kind === 'jointWar' || m.kind === 'demandTerritory') rows.push(['May join the enemy', h('span', { class: est.likelyEnemies.length ? 'danger-text' : '' }, list(est.likelyEnemies))]);
  if (est.brokenTreaties.length) rows.push(['Treaties broken', h('span', { class: 'danger-text' }, est.brokenTreaties.map((t) => `${t.type} with ${list(t.with)}`).join('; '))]);
  if (est.relationHits.length) rows.push(['Relations', est.relationHits.map((r) => `${name(r.nation)} ${r.delta}`).join(', ')]);

  const staff = h('section', { class: 'assess-block' },
    h('div', { class: 'assess-heading' }, 'Staff estimate'),
    h('dl', { class: 'kv' }, ...rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
    est.notes.length ? h('ul', { class: 'assess-notes' }, ...est.notes.map((n) => h('li', null, n))) : null,
  );

  const advisorBody = h('div', { class: 'assess-advisor-body' });
  const advisor = h('section', { class: 'assess-block advisor' },
    h('div', { class: 'assess-heading' }, `${scenario.advisor.reportName} — ${scenario.advisor.title}`),
    advisorBody,
  );

  if (mode === 'off') {
    advisorBody.replaceChildren(h('p', { class: 'dim' }, 'The AI advisor is switched off. Showing the staff estimate only.'));
  } else {
    advisorBody.replaceChildren(h('p', { class: 'dim loading-dots' }, `The ${scenario.advisor.title} is preparing the ${scenario.advisor.reportName.toLowerCase()}`));
    void requestAssessment(scenario, s, m, est).then((r) => {
      if (!advisorBody.isConnected) return;
      if (r.source !== 'ai') {
        fill(advisorBody,
          h('p', { class: 'dim' }, 'The advisor could not be reached. Rely on the staff estimate.'),
          r.error ? h('p', { class: 'dim small' }, r.error) : null,
        );
        return;
      }
      const rep = r.report;
      fill(advisorBody,
        h('div', { class: 'advisor-verdict' }, riskBadge(rep.risk), h('span', null, `Odds: ${rep.successChance}%`)),
        h('blockquote', null, rep.summary),
        rep.consequences.length ? h('ul', { class: 'assess-notes' }, ...rep.consequences.map((c) => h('li', null, c))) : null,
        h('p', null, h('strong', null, 'Military risk: '), rep.militaryRisk),
        rep.likelyEnemies.length ? h('p', null, h('strong', null, 'Expect to face: '), rep.likelyEnemies.join(', ')) : null,
        h('p', { class: 'advice' }, h('strong', null, 'Advice: '), rep.advice),
        h('p', { class: 'dim small' }, `${r.model ?? 'AI'}${r.ms ? ` · ${(r.ms / 1000).toFixed(1)}s` : ''}`),
      );
    });
  }

  return confirmDialog({
    eyebrow: `Assessor · ${kindLabel(m.kind)}`,
    title: `${m.label}?`,
    body: [staff, advisor],
    confirmLabel: opts.confirmLabel,
    danger: est.risk === 'High' || est.risk === 'Extreme' || m.kind === 'declareWar',
    wide: true,
  });
}
