import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tasks } from '../../shared/ai/tasks';
import { buildDiplomacyPrompt } from '../ai/diplomacyPrompt';
import { ww2 } from '../data/scenarios/ww2';
import { reduce, validate, type Action } from './actions';
import { classifyMajor, estimate } from './assess';
import { borderProvinces, decideAcceptance, pickInitiative, validateTerms, willingness } from './diplomacy';
import { memoryOf } from './events';
import { byName, fresh, world } from './fixture.test-util';
import { atWar, getRelation, provincesOf } from './state';
import { GameStore } from './store';
import type { GameState, ProposalTerms } from './types';

const act = (s: GameState, action: Action, actor: string) => {
  const err = validate(s, { action, actor }, world);
  if (err) throw new Error(err);
  return reduce(s, { action, actor }, world);
};
const tick = (s: GameState, n: number) => {
  for (let i = 0; i < n; i++) s = reduce(s, { action: { type: 'tick' }, actor: 'system' }, world);
  return s;
};
const lastProposal = (s: GameState) => s.proposals[s.proposals.length - 1];
const propose = (s: GameState, t: ProposalTerms) => act(s, { type: 'propose', terms: t }, t.from);
const answer = (s: GameState, accept: boolean) => act(s, { type: 'respond', proposal: lastProposal(s).id, accept }, lastProposal(s).to);

describe('agreements', () => {
  it('a pact only exists once the recipient accepts', () => {
    let s = propose(fresh(), { type: 'non-aggression', from: 'FRA', to: 'ITA' });
    expect(s.treaties.some((t) => t.type === 'non-aggression' && t.parties.includes('FRA') && t.parties.includes('ITA'))).toBe(false);
    s = answer(s, true);
    expect(s.treaties.some((t) => t.type === 'non-aggression' && t.parties.includes('FRA') && t.parties.includes('ITA'))).toBe(true);
    expect(lastProposal(s).status).toBe('accepted');
  });

  it('only the recipient may answer, and only once', () => {
    const s = propose(fresh(), { type: 'alliance', from: 'USA', to: 'GBR' });
    const id = lastProposal(s).id;
    expect(validate(s, { action: { type: 'respond', proposal: id, accept: true }, actor: 'USA' }, world)).not.toBeNull();
    const s2 = answer(s, false);
    expect(validate(s2, { action: { type: 'respond', proposal: id, accept: true }, actor: 'GBR' }, world)).toMatch(/rejected/);
  });

  it('rejects impossible terms', () => {
    const s = fresh();
    expect(validateTerms(s, { type: 'alliance', from: 'GER', to: 'POL' })).toMatch(/war/);
    expect(validateTerms(s, { type: 'demand', from: 'GER', to: 'FRA', take: [byName('Paris').id] })).toMatch(/capital/);
    expect(validateTerms(s, { type: 'peace', from: 'GER', to: 'FRA' })).toMatch(/not at war/);
  });

  it('a ceasefire ends the fighting, withdraws armies, and the war resumes when it lapses', () => {
    let s = fresh();
    // put a German army inside Poland first
    const polish = Object.keys(s.provinces).find((p) => s.provinces[p].owner === 'POL' && s.nations.POL.capital !== p)!;
    const ger = Object.values(s.armies).find((a) => a.owner === 'GER')!;
    s = { ...s, armies: { ...s.armies, [ger.id]: { ...ger, location: polish } } };
    s = answer(propose(s, { type: 'ceasefire', from: 'POL', to: 'GER' }), true);
    expect(atWar(s, 'GER', 'POL')).toBe(false);
    expect(s.provinces[s.armies[ger.id].location].owner).toBe('GER');
    s = tick(s, 4 * 31);
    expect(atWar(s, 'GER', 'POL')).toBe(true);
    expect(s.events.some((e) => e.kind === 'ceasefire-ended')).toBe(true);
  });

  it('peace can move provinces', () => {
    let s = fresh();
    const border = borderProvinces(s, world, 'POL', 'GER');
    s = answer(propose(s, { type: 'peace', from: 'GER', to: 'POL', take: [border[0]] }), true);
    expect(s.provinces[border[0]].owner).toBe('GER');
    expect(s.treaties.some((t) => t.type === 'peace')).toBe(true);
  });

  it('a rejected ultimatum from an AI nation leads to war three days later', () => {
    let s = fresh();
    const take = borderProvinces(s, world, 'ROM', 'HUN').slice(0, 1);
    s = answer(propose(s, { type: 'demand', from: 'HUN', to: 'ROM', take }), false);
    expect(memoryOf(s, 'ROM', 'HUN').grievances.join(' ')).toMatch(/ultimatum/);
    s = tick(s, 4 * 3 + 1);
    expect(atWar(s, 'HUN', 'ROM')).toBe(true);
  });

  it('a joint war puts both partners at war with the target', () => {
    let s = fresh();
    s = answer(propose(s, { type: 'joint-war', from: 'HUN', to: 'BUL', target: 'ROM' }), true);
    expect(atWar(s, 'HUN', 'ROM') && atWar(s, 'BUL', 'ROM')).toBe(true);
  });

  it('breaking a treaty is remembered as a betrayal', () => {
    let s = fresh();
    const pact = s.treaties.find((t) => t.type === 'non-aggression' && t.parties.includes('SOV'))!;
    const before = getRelation(s, 'SOV', 'GER');
    s = act(s, { type: 'cancelTreaty', treaty: pact.id }, 'SOV');
    expect(getRelation(s, 'SOV', 'GER')).toBe(before - 30);
    expect(memoryOf(s, 'GER', 'SOV').grievances[0]).toMatch(/broke/);
  });
});

describe('willingness', () => {
  it('a nation that is being crushed is readier for peace than its attacker', () => {
    let s = fresh();
    s = { ...s, armies: Object.fromEntries(Object.entries(s.armies).filter(([, a]) => a.owner !== 'POL')) };
    const polWants = willingness(s, world, { type: 'peace', from: 'GER', to: 'POL' }).score;
    const gerWants = willingness(s, world, { type: 'peace', from: 'POL', to: 'GER' }).score;
    expect(polWants).toBeGreaterThan(gerWants);
  });

  it('weak nations’ demands are laughed off', () => {
    const s = fresh();
    const take = borderProvinces(s, world, 'GER', 'm_luxembourg').slice(0, 1);
    if (take.length) expect(willingness(s, world, { type: 'demand', from: 'm_luxembourg', to: 'GER', take }).score).toBeLessThan(-25);
  });

  it('the AI cannot accept below the floor, but may always refuse', () => {
    expect(decideAcceptance({ score: -60, reasons: [] }, true)).toBe(false);
    expect(decideAcceptance({ score: 80, reasons: [] }, false)).toBe(false);
    expect(decideAcceptance({ score: 30, reasons: [] }, null)).toBe(true);
  });
});

describe('assessor coverage', () => {
  it('breaking a treaty, ultimatums and joint wars are major', () => {
    const s = fresh();
    const pact = s.treaties.find((t) => t.type === 'non-aggression' && t.parties.includes('GER'))!;
    expect(classifyMajor(s, world, { type: 'cancelTreaty', treaty: pact.id }, 'GER', 'major')?.kind).toBe('breakTreaty');
    const take = borderProvinces(s, world, 'POL', 'SOV').slice(0, 1);
    const m = classifyMajor(s, world, { type: 'propose', terms: { type: 'demand', from: 'SOV', to: 'POL', take } }, 'SOV', 'major')!;
    expect(m.kind).toBe('demandTerritory');
    expect(estimate(s, world, m).chanceLabel).toBe('Chance they comply');
    expect(classifyMajor(s, world, { type: 'propose', terms: { type: 'joint-war', from: 'ITA', to: 'GER', target: 'FRA' } }, 'ITA', 'major')?.kind).toBe('jointWar');
  });
});

describe('initiatives & prompt', () => {
  it('a friendly co-belligerent offers an alliance', () => {
    let s = act(fresh(), { type: 'chooseNation', nation: 'SOV' }, 'SOV');
    s = act(s, { type: 'declareWar', attacker: 'SOV', defender: 'JPN' }, 'SOV');
    s = { ...s, relations: { ...s.relations, ['CHN|SOV']: 40 } };
    const init = pickInitiative(s, world);
    expect(init).not.toBeNull();
    expect(init!.from).toBe('CHN');
    expect(init!.terms?.type).toBe('alliance');
  });

  it('the leader prompt stays small and includes memory and inclination', () => {
    let s = act(fresh(), { type: 'chooseNation', nation: 'FRA' }, 'FRA');
    s = act(s, { type: 'chat', with: 'ITA', text: 'Let us keep the peace in the Mediterranean.' }, 'FRA');
    s = propose(s, { type: 'non-aggression', from: 'FRA', to: 'ITA' });
    const p = lastProposal(s);
    const { system, prompt } = buildDiplomacyPrompt({ scenario: ww2, state: s, world, ai: 'ITA', other: 'FRA', pending: { proposal: p, willingness: willingness(s, world, p) } });
    expect(system).toContain('Benito Mussolini');
    expect(prompt).toContain('YOUR INCLINATION');
    expect(prompt).toContain('Them: Let us keep the peace');
    expect(system.length + prompt.length).toBeLessThan(4200);
  });

  it('the diplomacy schema copes with sloppy output', () => {
    const r = tasks.diplomacy.schema.safeParse({ reply: 'Very well.', relationChange: '+15', accepted: 'Yes, we accept', agreementType: 'Non Aggression Pact', terms: 'none' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.relationChange).toBe(10);
      expect(r.data.accepted).toBe(true);
      expect(r.data.agreementType).toBe('non-aggression');
      expect(r.data.agreementProposed).toBe(false);
    }
  });
});

// ---- the diplomat, with the LLM stubbed -------------------------------------------------------
const llm = vi.hoisted(() => ({ reply: {} as Record<string, unknown> }));
vi.mock('../ai/llmClient', () => ({
  runAiTask: async () => ({ valid: true, data: tasks.diplomacy.schema.parse(llm.reply), provider: 'stub', model: 'stub', attempts: 1, ms: 1 }),
}));

describe('Diplomat', () => {
  let store: GameStore;
  beforeEach(async () => {
    store = new GameStore(fresh(), world);
    store.dispatch({ type: 'chooseNation', nation: 'POL' }, 'POL');
  });

  it('the game overrules an AI that agrees to something its nation never would', async () => {
    const { Diplomat } = await import('../game/diplomat');
    const take = borderProvinces(store.state, world, 'GER', 'POL').slice(0, 2);
    store.dispatch({ type: 'propose', terms: { type: 'peace', from: 'POL', to: 'GER', take } }, 'POL');
    llm.reply = { reply: 'Fine, take them.', relationChange: 0, accepted: true, agreementProposed: false, agreementType: 'none', terms: {}, memory: '' };
    await new Diplomat(store, ww2).talk('GER', 'Give us Silesia and we will stop.');
    expect(lastProposal(store.state).status).toBe('rejected');
    expect(take.every((p) => store.state.provinces[p].owner === 'GER')).toBe(true);
    const chat = Object.values(store.state.diplomacy.chats)[0];
    expect(chat.at(-1)!.text).toBe('Fine, take them.');
  });

  it('turns an AI counter-offer into a real proposal card', async () => {
    const { Diplomat } = await import('../game/diplomat');
    const theirs = borderProvinces(store.state, world, 'POL', 'GER').slice(0, 1).map((p) => world.provinces[p].name);
    llm.reply = { reply: 'Cede this and live.', relationChange: -3, accepted: null, agreementProposed: true, agreementType: 'peace', terms: { take: theirs }, memory: 'The Poles beg.' };
    await new Diplomat(store, ww2).talk('GER', 'We want peace.');
    const p = lastProposal(store.state);
    expect(p.from).toBe('GER');
    expect(p.type).toBe('peace');
    expect(p.take?.map((id) => world.provinces[id].name)).toEqual(theirs);
    expect(memoryOf(store.state, 'GER', 'POL').notes).toContain('The Poles beg.');
    expect(Object.values(store.state.diplomacy.chats)[0].at(-1)!.proposalId).toBe(p.id);
    expect(provincesOf(store.state, 'POL').length).toBeGreaterThan(0);
  });
});
