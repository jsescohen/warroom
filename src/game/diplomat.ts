import type { TaskResult } from '../../shared/ai/tasks';
import { buildDiplomacyPrompt, leaderOf } from '../ai/diplomacyPrompt';
import { runAiTask } from '../ai/llmClient';
import { MAX_CHAT_RELATION } from '../core/actions';
import { ACCEPT_FLOOR, decideAcceptance, militaryPower, validateTerms, willingness, type Initiative } from '../core/diplomacy';
import type { ScenarioDef } from '../core/scenario';
import type { GameStore } from '../core/store';
import type { AgreementType, GameState, NationId, ProposalTerms, ProvinceId } from '../core/types';

type DiploReply = TaskResult<'diplomacy'>;

/**
 * Runs conversations between the player and AI leaders. The LLM writes in character; the
 * game decides what is binding: acceptance is bounded by `willingness`, offers are validated,
 * and everything goes through store actions.
 */
export class Diplomat {
  private busy = new Set<NationId>();

  constructor(private store: GameStore, private scenario: ScenarioDef) {}

  isBusy(nation: NationId) {
    return this.busy.has(nation);
  }

  /** The player sends a message (optionally right after making a formal proposal). */
  async talk(ai: NationId, text: string): Promise<{ error?: string }> {
    const player = this.store.state.playerNation;
    if (!player || this.busy.has(ai)) return { error: 'Busy' };
    if (text.trim()) {
      const r = this.store.dispatch({ type: 'chat', with: ai, text }, player);
      if (!r.ok) return { error: r.error };
    }
    this.busy.add(ai);
    try {
      const s = this.store.state;
      const world = this.store.world;
      const proposal = [...s.proposals].reverse().find((p) => p.status === 'pending' && p.from === player && p.to === ai);
      const pending = proposal ? { proposal, willingness: willingness(s, world, proposal) } : undefined;
      const { system, prompt } = buildDiplomacyPrompt({ scenario: this.scenario, state: s, world, ai, other: player, pending });
      const res = await runAiTask({ task: 'diplomacy', system, prompt, priority: 'player', actor: ai });
      const data: DiploReply | null = res.valid ? res.data : null;

      if (data?.relationChange) this.as(ai, { type: 'adjustRelation', with: player, delta: clamp(data.relationChange, MAX_CHAT_RELATION) });
      if (data?.memory) this.as(ai, { type: 'remember', about: player, note: data.memory });

      let accepted: boolean | null = null;
      const still = proposal && this.store.state.proposals.find((p) => p.id === proposal.id && p.status === 'pending');
      if (still && pending) {
        // re-score with any relation change from this exchange: persuasion counts
        const w = willingness(this.store.state, world, still);
        accepted = decideAcceptance(w, data?.accepted);
        const r = this.as(ai, { type: 'respond', proposal: still.id, accept: accepted });
        if (!r) accepted = false;
      }

      let offerId: string | undefined;
      if (data?.agreementProposed && data.agreementType !== 'none' && !accepted) {
        const terms = this.termsFromAi(ai, player, data.agreementType, data.terms);
        if (terms && this.aiWouldOffer(terms)) offerId = this.propose(terms);
      }

      const leader = leaderOf(this.scenario, this.store.state, ai);
      // no AI reply: post nothing invented, except the formal answer to a proposal the game decided
      const reply = data?.reply || (still ? fallbackReply(leader.name, still.type, accepted) : null);
      if (reply) this.as(ai, { type: 'chat', with: player, text: reply, proposal: offerId });
      return res.valid ? {} : { error: friendlyAiError('error' in res ? res.error : 'unreadable reply') };
    } finally {
      this.busy.delete(ai);
    }
  }

  /** An AI leader contacts the player on its own initiative. */
  async initiate(init: Initiative): Promise<boolean> {
    const player = this.store.state.playerNation;
    if (!player || this.busy.has(init.from)) return false;
    this.busy.add(init.from);
    try {
      // cooldown first, so a failed AI call does not cause a retry storm
      this.as(init.from, { type: 'noteContact' });
      const s = this.store.state;
      const { system, prompt } = buildDiplomacyPrompt({ scenario: this.scenario, state: s, world: this.store.world, ai: init.from, other: player, initiative: init });
      const res = await runAiTask({ task: 'diplomacy', system, prompt, priority: 'ai', actor: init.from });
      if (!res.valid && 'skipped' in res && res.skipped && !init.terms && init.kind !== 'war-message') return false;
      let offerId: string | undefined;
      if (init.terms && validateTerms(this.store.state, init.terms) === null) offerId = this.propose(init.terms);
      const leader = leaderOf(this.scenario, this.store.state, init.from);
      const text = (res.valid && res.data.reply) || initiativeTemplate(init, leader.name, s);
      this.as(init.from, { type: 'chat', with: player, text, proposal: offerId });
      if (res.valid && res.data.memory) this.as(init.from, { type: 'remember', about: player, note: res.data.memory });
      return true;
    } finally {
      this.busy.delete(init.from);
    }
  }

  // ---- helpers ------------------------------------------------------------------------------------

  private as(actor: NationId, action: Parameters<GameStore['dispatch']>[0]) {
    return this.store.dispatch(action, actor).ok;
  }

  private propose(terms: ProposalTerms): string | undefined {
    if (!this.as(terms.from, { type: 'propose', terms })) return undefined;
    return [...this.store.state.proposals].reverse().find((p) => p.from === terms.from && p.to === terms.to)?.id;
  }

  /** AI leaders only put forward offers their nation actually wants. */
  private aiWouldOffer(t: ProposalTerms): boolean {
    const s = this.store.state;
    if (validateTerms(s, t) !== null) return false;
    if (t.type === 'demand') return militaryPower(s, this.store.world, t.from) > militaryPower(s, this.store.world, t.to) * 1.3;
    return willingness(s, this.store.world, t, t.from).score >= ACCEPT_FLOOR;
  }

  /** Maps the AI's free-form terms (province / nation names) onto real ids. */
  private termsFromAi(ai: NationId, player: NationId, type: AgreementType, raw: DiploReply['terms']): ProposalTerms | null {
    const s = this.store.state;
    const world = this.store.world;
    const match = (names: string[], owner: NationId): ProvinceId[] => {
      const owned = Object.keys(s.provinces).filter((p) => s.provinces[p].owner === owner);
      const out: ProvinceId[] = [];
      for (const raw of names) {
        const q = norm(raw);
        const hit = owned.find((p) => norm(world.provinces[p].name) === q) ?? owned.find((p) => q.length > 3 && norm(world.provinces[p].name).includes(q));
        if (hit && !out.includes(hit)) out.push(hit);
      }
      return out;
    };
    const terms: ProposalTerms = { type, from: ai, to: player };
    if (type === 'territory' || type === 'peace' || type === 'demand') {
      terms.give = match(raw.give, ai);
      terms.take = match(raw.take, player);
      if ((type === 'territory' && !terms.give.length && !terms.take.length) || (type === 'demand' && !terms.take.length)) return null;
    }
    if (type === 'joint-war') {
      const q = norm(raw.target);
      const target = Object.values(s.nations).find((n) => n.alive && q && (norm(n.shortName) === q || norm(n.name).includes(q)));
      if (!target) return null;
      terms.target = target.id;
    }
    if (type === 'demand') delete terms.give;
    return terms;
  }
}

const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, Math.round(v)));
const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** What went wrong with an AI reply, in words a player understands. */
export function friendlyAiError(raw: string): string {
  if (/429|rate|busy|queue|cooldown|too many/i.test(raw)) return 'The AI service is busy right now (its free tier allows only so many messages a minute). Wait a few seconds and ask again.';
  if (/time|took too long|longer than|abort/i.test(raw)) return 'The AI took too long to answer. Ask again in a moment.';
  if (/fetch|network|failed to|unreachable|502|503|504/i.test(raw)) return 'The game server could not reach the AI service. Ask again in a moment.';
  return 'The leader’s reply came back garbled. Ask again.';
}

function fallbackReply(leader: string, proposalType: string | null, accepted: boolean | null): string {
  if (proposalType && accepted === true) return `${leader} has instructed the ministers to sign.`;
  if (proposalType && accepted === false) return `${leader} declines your proposal.`;
  return `${leader} acknowledges your message and will consider it.`;
}

function initiativeTemplate(init: Initiative, leader: string, s: GameState): string {
  const player = s.playerNation ? s.nations[s.playerNation]?.shortName : 'your nation';
  switch (init.kind) {
    case 'peace-feeler': return `${leader} proposes an end to the fighting between our nations.`;
    case 'offer': return `${leader} proposes closer ties with ${player}.`;
    case 'ultimatum': return `${leader} demands the cession of the territories named below. Refusal will have consequences.`;
    case 'warning': return `${leader} warns ${player} to respect our border.`;
    case 'war-message': return `${leader} informs you that a state of war now exists between our nations.`;
  }
}

