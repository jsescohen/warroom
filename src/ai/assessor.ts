import type { TaskResult } from '../../shared/ai/tasks';
import { kindLabel, type Estimate, type MajorAction } from '../core/assess';
import { allied, atWar, getRelation } from '../core/queries';
import type { ScenarioDef } from '../core/scenario';
import { formatDate } from '../core/time';
import type { GameState, NationId } from '../core/types';
import { runAiTask } from './llmClient';

export type AssessReport = TaskResult<'assess'>;

export interface AdvisorResult {
  report: AssessReport;
  /** 'ai' = model answered with valid JSON; 'unavailable' = fallback was used. */
  source: 'ai' | 'unavailable';
  model?: string;
  ms?: number;
  error?: string;
}

/** Compact prompt: only the facts the advisor needs. Kept small for local models / free tiers. */
export function buildAssessPrompt(scenario: ScenarioDef, s: GameState, m: MajorAction, est: Estimate) {
  const n = (id: NationId) => s.nations[id]?.shortName ?? id;
  const list = (ids: NationId[]) => (ids.length ? ids.map(n).join(', ') : 'none');
  const armies = (id: NationId) => Object.values(s.armies).filter((a) => a.owner === id).length;
  const others = (id: NationId) => Object.keys(s.nations).filter((o) => o !== id && s.nations[o].alive);
  const me = s.nations[m.actor];
  const target = s.nations[m.target];
  const rel = getRelation(s, m.actor, m.target);

  const powers = Object.values(s.nations)
    .filter((x) => x.alive && x.major && x.id !== m.actor && x.id !== m.target)
    .map((x) => `${x.shortName} ${fmtRel(getRelation(s, m.actor, x.id))}${atWar(s, m.actor, x.id) ? ' (at war)' : ''}`)
    .join(', ');

  const system =
    `You are the ${scenario.advisor.title} advising the leader of ${me.name}. ` +
    `Speak as ${scenario.advisor.style}. Give an honest, concise judgement of the proposed action; ` +
    `you may disagree with the staff numbers if the situation warrants. Reply with ONLY one JSON object.`;

  const prompt = [
    `SETTING: ${scenario.context}`,
    `DATE: ${formatDate(s.clock)}`,
    `US: ${me.name}. At war with: ${list(others(m.actor).filter((o) => atWar(s, m.actor, o)))}. Allies: ${list(others(m.actor).filter((o) => allied(s, m.actor, o)))}. Armies: ${armies(m.actor)}.`,
    `PROPOSED ACTION (${kindLabel(m.kind)}): ${m.label}.`,
    `TARGET: ${target.name}. Armies: ${armies(m.target)}. Allies: ${list(others(m.target).filter((o) => allied(s, m.target, o)))}. Relation with us: ${fmtRel(rel)}.`,
    `STAFF ESTIMATE: ${est.chanceLabel ? `${est.chanceLabel.toLowerCase()} ${est.successChance}%, ` : ''}risk ${est.risk}, our power ${est.ourPower} vs theirs ${est.theirPower}. ` +
      `Likely to join the enemy: ${list(est.likelyEnemies)}. ` +
      `Treaties broken: ${est.brokenTreaties.length ? est.brokenTreaties.map((t) => `${t.type} with ${list(t.with)}`).join('; ') : 'none'}. ` +
      est.notes.join(' '),
    `OTHER POWERS (relation with us): ${powers || 'none'}.`,
    '',
    'Return JSON exactly in this shape:',
    '{"summary":"2-3 sentences, in character","consequences":["up to 4 short points: diplomatic reactions and military effects"],' +
      '"militaryRisk":"one sentence","successChance":0-100,"likelyEnemies":["nation names"],"risk":"Low|Medium|High|Extreme","advice":"one sentence"}',
  ].join('\n');
  return { system, prompt };
}

const fmtRel = (v: number) => (v > 0 ? `+${v}` : String(v));

const cache = new Map<string, Promise<AdvisorResult>>();

/** Asks the configured LLM for an in-character assessment. Never throws. Cached per action per day. */
export function requestAssessment(scenario: ScenarioDef, s: GameState, m: MajorAction, est: Estimate): Promise<AdvisorResult> {
  const day = Math.floor(s.clock.hours / 24);
  const key = `${m.kind}|${m.actor}|${m.target}|${m.province ?? ''}|${day}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { system, prompt } = buildAssessPrompt(scenario, s, m, est);
  const p = runAiTask({ task: 'assess', system, prompt, priority: 'player', actor: m.actor }).then((r): AdvisorResult => {
    if (r.valid) return { report: r.data, source: 'ai', model: 'model' in r ? r.model : undefined, ms: 'ms' in r ? r.ms : undefined };
    cache.delete(key); // don't cache failures
    return { report: r.data, source: 'unavailable', error: 'error' in r ? r.error : 'The model did not return a usable report.' };
  });
  cache.set(key, p);
  if (cache.size > 30) cache.delete(cache.keys().next().value!);
  return p;
}
