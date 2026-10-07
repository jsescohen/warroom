import { AGREEMENT_LABEL, borderProvinces, describeTerms, militaryPower, type Initiative, type Willingness } from '../core/diplomacy';
import { memoryOf } from '../core/events';
import { allied, atWar, getRelation } from '../core/queries';
import type { LeaderPersona, ScenarioDef } from '../core/scenario';
import { formatDate } from '../core/time';
import { relationKey, type GameState, type NationId, type Proposal } from '../core/types';
import type { World } from '../core/world';

/** The leader of a nation: from the scenario, or a generic head of state for minor nations. */
export function leaderOf(scenario: ScenarioDef, s: GameState, nation: NationId): LeaderPersona {
  const def = scenario.nations.find((n) => n.id === nation)?.leader;
  if (def) return def;
  const n = s.nations[nation];
  return {
    name: `the Head of State of ${n?.name ?? nation}`,
    title: `Head of State of ${n?.name ?? nation}`,
    traits: ['cautious', 'protective of sovereignty'],
    goals: ['survive among the great powers', 'avoid unnecessary wars'],
    speechStyle: 'formal, careful diplomatic language of the era',
  };
}

const relWord = (v: number) => (v >= 50 ? 'friendly' : v >= 10 ? 'cordial' : v > -10 ? 'neutral' : v > -50 ? 'hostile' : 'bitter enemies');

export interface DiplomacyPromptInput {
  scenario: ScenarioDef;
  state: GameState;
  world: World;
  ai: NationId;
  other: NationId;
  /** The player's proposal waiting for this leader's answer, with the game's willingness score. */
  pending?: { proposal: Proposal; willingness: Willingness };
  /** Set when the AI leader writes first. */
  initiative?: Initiative;
}

/**
 * Compact prompt for a leader conversation. Only the facts the leader needs: standing, memory,
 * the last few lines of the chat, and what is on the table. Sized for small local models.
 */
export function buildDiplomacyPrompt(i: DiplomacyPromptInput) {
  const { scenario, state: s, world, ai, other } = i;
  const them = s.nations[other];
  const L = leaderOf(scenario, s, ai);
  const themLeader = leaderOf(scenario, s, other);
  const n = (id: NationId) => s.nations[id]?.shortName ?? id;
  const list = (ids: NationId[]) => (ids.length ? ids.map(n).join(', ') : 'none');
  const alive = Object.keys(s.nations).filter((x) => s.nations[x].alive);
  const standing = (id: NationId) =>
    `${s.nations[id].name}: ${Object.values(s.armies).filter((a) => a.owner === id).length} armies (power ${Math.round(militaryPower(s, world, id))}), ` +
    `at war with ${list(alive.filter((x) => atWar(s, id, x)))}, allies ${list(alive.filter((x) => x !== id && allied(s, id, x)))}.`;
  const rel = getRelation(s, ai, other);
  const treaties = s.treaties.filter((t) => t.parties.includes(ai) && t.parties.includes(other)).map((t) => t.type);
  const mem = memoryOf(s, ai, other);
  const provNames = (ids: string[]) => ids.slice(0, 8).map((p) => world.provinces[p].name).join(', ') || 'none';
  const chat = (s.diplomacy.chats[relationKey(ai, other)] ?? []).slice(-6)
    .map((l) => `${l.from === ai ? 'You' : 'Them'}: ${l.text.replace(/\s+/g, ' ').slice(0, 300)}`);

  const system =
    `You are ${L.name}, ${L.title}, in a historical strategy game (${scenario.name}). ` +
    `Stay in character: ${L.speechStyle}. Traits: ${L.traits.join(', ')}. Goals: ${L.goals.join('; ')}.` +
    (L.grudges?.length ? ` Grudges: ${L.grudges.join('; ')}.` : '') +
    ` You are negotiating with ${themLeader.name} of ${them.name}. Write 1-4 sentences of diplomacy. ` +
    `Focus on statecraft; no slurs or hateful propaganda. Agreements only happen through the JSON fields, never by words alone. ` +
    `Reply with ONLY one JSON object.`;

  const lines = [
    `SETTING: ${scenario.context}`,
    `DATE: ${formatDate(s.clock)}`,
    `YOU: ${standing(ai)}`,
    `THEM: ${standing(other)}`,
    `RELATIONS: ${rel} (${relWord(rel)}). Treaties between you: ${treaties.length ? treaties.join(', ') : 'none'}.${atWar(s, ai, other) ? ' You are AT WAR with them.' : ''}`,
    `YOUR MEMORY OF THEM: ${[...mem.grievances, ...mem.notes].join(' ') || 'nothing notable yet'}`,
    `BORDER PROVINCES - yours: ${provNames(borderProvinces(s, world, ai, other))}; theirs: ${provNames(borderProvinces(s, world, other, ai))}.`,
  ];
  if (i.pending) {
    const w = i.pending.willingness;
    const lean = w.score >= 20 ? 'lean towards accepting' : w.score >= -25 ? 'undecided' : 'must refuse';
    lines.push(
      `THEIR PROPOSAL: ${AGREEMENT_LABEL[i.pending.proposal.type]} - ${describeTerms(s, world, i.pending.proposal)}`,
      `YOUR INCLINATION: ${w.score} (${lean}). Because: ${w.reasons.slice(0, 4).join('; ') || 'no strong factors'}.`,
    );
  }
  if (i.initiative) {
    lines.push(`YOU ARE WRITING FIRST. Purpose: ${i.initiative.purpose}`);
    if (i.initiative.terms) lines.push(`YOUR OFFER (attached formally by the game): ${describeTerms(s, world, i.initiative.terms)}`);
  }
  lines.push('CONVERSATION (oldest first):', ...(chat.length ? chat : ['(no messages yet)']), '');
  lines.push(
    'Return JSON exactly in this shape:',
    '{"reply":"your message, in character","relationChange":-10 to 10 (how this exchange changes your opinion of them),' +
      '"accepted":true|false|null (your answer to THEIR PROPOSAL; null if none),' +
      '"agreementProposed":false,"agreementType":"none|alliance|non-aggression|ceasefire|peace|territory|joint-war|demand",' +
      '"terms":{"give":["your province names you would cede"],"take":["their province names you want"],"target":"nation name for a joint war"},' +
      '"memory":"one short sentence worth remembering about them, or empty"}',
    i.initiative
      ? 'Leave agreementProposed false: your offer is already attached.'
      : 'Only set agreementProposed true to make a NEW offer of your own. Use province names exactly as listed.',
  );
  return { system, prompt: lines.join('\n') };
}
