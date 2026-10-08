import { leaderOf } from '../ai/diplomacyPrompt';
import type { Action } from '../core/actions';
import { AGREEMENT_LABEL, borderProvinces, describeTerms, MAX_TRADE_GOLD, validateTerms } from '../core/diplomacy';
import { producedBy } from '../core/economy';
import { allied, atWar, getRelation } from '../core/queries';
import type { ScenarioDef } from '../core/scenario';
import type { GameStore } from '../core/store';
import { formatDate, formatShortDate } from '../core/time';
import { relationKey, type AgreementType, type GameState, type NationId, type Proposal, type ProposalTerms } from '../core/types';
import { treatyName } from '../core/war';
import type { Diplomat } from '../game/diplomat';
import { fill, h, swatch } from './dom';
import { relationLabel } from './sidePanel';

export interface DiplomacyHooks {
  /** Runs the Assessor for major actions; resolves true if the player goes ahead. */
  confirm(action: Action): Promise<boolean>;
  toast(text: string, kind: 'info' | 'alert'): void;
  onOpenChange(open: boolean): void;
  onUnreadChange(total: number): void;
}

type ComposeType = 'message' | AgreementType;

const COMPOSE_OPTIONS: [ComposeType, string][] = [
  ['message', 'Message only'],
  ['alliance', 'Propose alliance'],
  ['non-aggression', 'Propose non-aggression pact'],
  ['ceasefire', 'Propose ceasefire'],
  ['peace', 'Propose peace'],
  ['territory', 'Propose territory exchange'],
  ['joint-war', 'Propose joint war'],
  ['trade', 'Propose trade agreement'],
  ['demand', 'Issue ultimatum (demand land)'],
];

/** Diplomacy window: nation list + in-character chat with each leader + formal agreements. */
export class DiplomacyWindow {
  readonly el = h('div', { class: 'diplo-backdrop', style: 'display:none' });
  private panel = h('div', { class: 'diplo panel', role: 'dialog', 'aria-label': 'Diplomacy' });
  private list = h('div', { class: 'diplo-list' });
  private search = h('input', { class: 'diplo-search', type: 'search', placeholder: 'Search nations…' });
  private header = h('div', { class: 'diplo-header' });
  private transcript = h('div', { class: 'diplo-transcript' });
  private typing = h('div', { class: 'diplo-typing loading-dots', style: 'display:none' });
  /** A failed reply, per nation: shown under the conversation with an "Ask again" button. */
  private failed = new Map<NationId, string>();
  private retryBox = h('div', { class: 'diplo-retry', style: 'display:none' });
  private composeType = h('select', { class: 'diplo-select' });
  private composeExtra = h('div', { class: 'diplo-extra' });
  private input = h('textarea', { class: 'diplo-input', rows: 2, placeholder: 'Write a message…', maxlength: 600 });
  private sendBtn = h('button', { class: 'btn primary' }, 'Send');
  private current: NationId | null = null;
  private pickGive = new Set<string>();
  private pickTake = new Set<string>();
  private pickTarget = '';
  /** Trade: resource you supply, resource you get, money you pay each month (negative: you are paid). */
  private pickTrade = { sell: '', buy: '', gold: 0 };
  private waitStart = 0;

  constructor(private store: GameStore, private scenario: ScenarioDef, private diplomat: Diplomat, private hooks: DiplomacyHooks) {
    for (const [v, label] of COMPOSE_OPTIONS) this.composeType.append(h('option', { value: v }, label));
    const composer = h('div', { class: 'diplo-composer' },
      h('div', { class: 'diplo-compose-row' }, this.composeType, this.composeExtra),
      h('div', { class: 'diplo-compose-row' }, this.input, this.sendBtn),
    );
    const chat = h('section', { class: 'diplo-chat' }, this.header, this.transcript, this.typing, this.retryBox, composer);
    const side = h('aside', { class: 'diplo-side' },
      h('div', { class: 'diplo-side-head' }, h('h2', null, 'Diplomacy'), h('button', { class: 'diplo-close', title: 'Close (Esc)', onclick: () => this.close() }, '✕')),
      this.search, this.list);
    this.panel.append(side, chat);
    this.el.append(this.panel);
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.close(); }
      e.stopPropagation(); // keep game shortcuts (space, 1-3, N) out of the text box
    });
    this.search.addEventListener('input', () => this.renderList());
    this.composeType.addEventListener('change', () => { this.pickGive.clear(); this.pickTake.clear(); this.pickTarget = ''; this.pickTrade = { sell: '', buy: '', gold: 0 }; this.renderExtra(); });
    this.sendBtn.addEventListener('click', () => void this.send());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void this.send(); }
    });
    store.subscribe((s, prev) => {
      if (s.diplomacy !== prev.diplomacy || s.proposals !== prev.proposals || s.treaties !== prev.treaties || s.wars !== prev.wars || s.relations !== prev.relations) {
        if (this.isOpen) this.render();
        this.hooks.onUnreadChange(this.unreadTotal());
      }
    });
  }

  get isOpen() {
    return this.el.style.display !== 'none';
  }

  open(nation?: NationId) {
    const s = this.store.state;
    if (!s.playerNation) return this.hooks.toast('Choose your nation first.', 'info');
    if (nation && nation !== s.playerNation) this.current = nation;
    if (!this.current || !s.nations[this.current]?.alive) this.current = this.sortedNations()[0] ?? null;
    if (!this.isOpen) {
      this.el.style.display = '';
      this.hooks.onOpenChange(true);
    }
    this.composeType.value = 'message';
    this.renderExtra();
    this.render();
    this.input.focus();
  }

  close() {
    if (!this.isOpen) return;
    this.el.style.display = 'none';
    this.hooks.onOpenChange(false);
  }

  unreadTotal(): number {
    const s = this.store.state;
    const me = s.playerNation;
    if (!me) return 0;
    let n = 0;
    // only nations still in the list: a conquered nation's old letters can no longer be opened
    for (const other of Object.keys(s.nations)) if (s.nations[other].alive) n += this.unread(s, other);
    return n;
  }

  private unread(s: GameState, other: NationId): number {
    const me = s.playerNation!;
    const key = relationKey(me, other);
    const lines = s.diplomacy.chats[key];
    if (!lines) return 0;
    const seen = s.diplomacy.read?.[key] ?? -1;
    return lines.filter((l) => l.from === other && l.id > seen).length;
  }

  // ---- rendering ----------------------------------------------------------------------------------

  private render() {
    const s = this.store.state;
    if (this.current && this.isOpen) {
      const key = relationKey(s.playerNation!, this.current);
      const last = s.diplomacy.chats[key]?.at(-1);
      if (last && (s.diplomacy.read?.[key] ?? -1) < last.id && !this.store.readOnly) {
        this.store.dispatch({ type: 'markRead', with: this.current, upTo: last.id }, s.playerNation!);
        return; // the dispatch re-renders
      }
      this.hooks.onUnreadChange(this.unreadTotal());
    }
    this.renderList();
    this.renderHeader();
    this.renderTranscript();
    const busy = !!this.current && this.diplomat.isBusy(this.current);
    this.typing.style.display = busy ? '' : 'none';
    const fail = this.current && !busy ? this.failed.get(this.current) : undefined;
    this.retryBox.style.display = fail ? '' : 'none';
    if (fail && this.current) {
      const n = this.current;
      fill(this.retryBox, h('span', null, `No reply from ${leaderOf(this.scenario, s, n).name}. ${fail}`),
        h('button', { class: 'btn', onclick: () => void this.askAgain(n) }, 'Ask again'));
    }
    if (busy && this.current) {
      const secs = this.waitStart ? Math.floor((Date.now() - this.waitStart) / 1000) : 0;
      this.typing.textContent = `${leaderOf(this.scenario, s, this.current).name} is drafting a reply${secs >= 3 ? ` (${secs}s)` : ''}`;
    }
    this.sendBtn.toggleAttribute('disabled', busy);
  }

  private sortedNations(): NationId[] {
    const s = this.store.state;
    const me = s.playerNation!;
    const group = (n: NationId) => (atWar(s, me, n) ? 0 : allied(s, me, n) ? 1 : s.nations[n].major ? 2 : 3);
    return Object.keys(s.nations)
      .filter((n) => n !== me && s.nations[n].alive)
      .sort((a, b) => group(a) - group(b) || this.unread(s, b) - this.unread(s, a) || s.nations[a].shortName.localeCompare(s.nations[b].shortName));
  }

  private renderList() {
    const s = this.store.state;
    const me = s.playerNation!;
    const q = this.search.value.trim().toLowerCase();
    const titles = ['At war', 'Allies', 'Great powers', 'Other nations'];
    let lastGroup = -1;
    const rows: HTMLElement[] = [];
    for (const n of this.sortedNations()) {
      const nation = s.nations[n];
      if (q && !nation.name.toLowerCase().includes(q) && !nation.shortName.toLowerCase().includes(q)) continue;
      const g = atWar(s, me, n) ? 0 : allied(s, me, n) ? 1 : nation.major ? 2 : 3;
      if (g !== lastGroup) { rows.push(h('div', { class: 'diplo-group' }, titles[g])); lastGroup = g; }
      const rel = getRelation(s, me, n);
      const unread = this.unread(s, n);
      rows.push(h('button', { class: `diplo-nation${n === this.current ? ' active' : ''}`, onclick: () => { this.current = n; this.pickGive.clear(); this.pickTake.clear(); this.renderExtra(); this.render(); this.input.focus(); } },
        swatch(nation.color),
        h('span', { class: 'diplo-nation-name' }, nation.shortName),
        unread ? h('span', { class: 'badge' }, String(unread)) : null,
        h('span', { class: 'diplo-rel', style: `color:${relationLabel(rel).color}` }, rel > 0 ? `+${rel}` : String(rel)),
      ));
    }
    fill(this.list, ...rows);
  }

  private renderHeader() {
    const s = this.store.state;
    const me = s.playerNation!;
    const n = this.current;
    if (!n) return fill(this.header, h('p', { class: 'dim' }, 'No one to talk to.'));
    const nation = s.nations[n];
    const L = leaderOf(this.scenario, s, n);
    const rel = getRelation(s, me, n);
    const label = relationLabel(rel);
    const initials = L.name.replace(/^the /i, '').split(/\s+/).filter((w) => /^[A-ZÉ]/.test(w)).map((w) => w[0]).slice(0, 2).join('');
    const chips: (HTMLElement | null)[] = [
      atWar(s, me, n) ? h('span', { class: 'chip war' }, 'At war') : null,
      ...s.treaties.filter((t) => t.parties.includes(me) && t.parties.includes(n)).map((t) =>
        h('span', { class: `chip ${t.type}` },
          treatyName(t.type) + (t.expiresAt ? ` · until ${formatShortDate({ ...s.clock, hours: t.expiresAt })}` : ''),
          h('button', { class: 'chip-x', title: `Break the ${treatyName(t.type)}`, onclick: () => void this.act({ type: 'cancelTreaty', treaty: t.id }) }, '✕'))),
    ];
    fill(this.header,
      h('div', { class: 'diplo-avatar', style: `background:${nation.color}` }, initials || '?'),
      h('div', { class: 'diplo-who' },
        h('div', { class: 'diplo-leader' }, L.name.replace(/^the /, 'The ')),
        h('div', { class: 'dim' }, `${L.title}`),
        h('div', { class: 'diplo-chips' }, ...chips.filter((c): c is HTMLElement => !!c)),
      ),
      h('div', { class: 'diplo-relation' },
        h('div', { class: 'dim small' }, 'Relations'),
        h('div', { style: `color:${label.color};font-weight:700` }, `${label.text} (${rel > 0 ? '+' : ''}${rel})`),
        h('span', { class: 'rel-meter' }, h('span', { style: `left:${(rel + 100) / 2}%` })),
      ),
    );
  }

  private renderTranscript() {
    const s = this.store.state;
    const me = s.playerNation!;
    const n = this.current;
    if (!n) return fill(this.transcript);
    const lines = s.diplomacy.chats[relationKey(me, n)] ?? [];
    const L = leaderOf(this.scenario, s, n);
    const items: HTMLElement[] = [];
    if (!lines.length) items.push(h('p', { class: 'diplo-empty' }, `Open a channel to ${L.name.replace(/^the /, 'the ')}. Your words, actions and broken promises will be remembered.`));
    let lastDay = -1;
    for (const l of lines) {
      const day = Math.floor(l.at / 24);
      if (day !== lastDay) { items.push(h('div', { class: 'diplo-day' }, formatDate({ ...s.clock, hours: l.at }))); lastDay = day; }
      const mine = l.from === me;
      items.push(h('div', { class: `bubble ${mine ? 'mine' : 'theirs'}` },
        h('div', { class: 'bubble-who' }, mine ? 'You' : L.name.replace(/^the /, 'The ')),
        h('div', { class: 'bubble-text' }, l.text),
      ));
      const p = l.proposalId ? s.proposals.find((x) => x.id === l.proposalId) : null;
      if (p) items.push(this.card(p));
    }
    fill(this.transcript, ...items);
    this.transcript.scrollTop = this.transcript.scrollHeight;
  }

  /** Accept/reject card for a proposal. */
  private card(p: Proposal): HTMLElement {
    const s = this.store.state;
    const me = s.playerNation!;
    const incoming = p.to === me;
    const status: Record<Proposal['status'], string> = {
      pending: incoming ? 'Awaiting your decision' : 'Awaiting their answer',
      accepted: 'Signed', rejected: 'Rejected', expired: 'Expired', void: 'No longer possible',
    };
    const buttons = incoming && p.status === 'pending'
      ? h('div', { class: 'card-actions' },
          h('button', { class: 'btn', onclick: () => void this.act({ type: 'respond', proposal: p.id, accept: false }) }, 'Reject'),
          h('button', { class: `btn ${p.type === 'demand' || p.type === 'joint-war' ? 'danger' : 'primary'}`, onclick: () => void this.act({ type: 'respond', proposal: p.id, accept: true }) },
            p.type === 'demand' ? 'Cede the land' : 'Accept & sign'))
      : null;
    return h('div', { class: `deal-card ${p.status}` },
      h('div', { class: 'deal-head' }, h('span', { class: 'deal-type' }, AGREEMENT_LABEL[p.type]), h('span', { class: `deal-status ${p.status}` }, status[p.status])),
      h('div', { class: 'deal-terms' }, describeTerms(s, this.store.world, p)),
      p.status === 'pending' ? h('div', { class: 'dim small' }, `Expires ${formatShortDate({ ...s.clock, hours: p.expiresAt })}`) : null,
      buttons,
    );
  }

  // ---- composer -----------------------------------------------------------------------------------

  private renderExtra() {
    const s = this.store.state;
    const me = s.playerNation;
    const n = this.current;
    const type = this.composeType.value as ComposeType;
    if (!me || !n || type === 'message') return fill(this.composeExtra);
    const world = this.store.world;
    const chips = (ids: string[], set: Set<string>, label: string) =>
      h('div', { class: 'pick' }, h('div', { class: 'dim small' }, label),
        h('div', { class: 'pick-chips' }, ...(ids.length ? ids.slice(0, 14).map((id) => {
          const b = h('button', { class: `pick-chip${set.has(id) ? ' on' : ''}` }, world.provinces[id].name);
          b.addEventListener('click', () => { set.has(id) ? set.delete(id) : set.add(id); b.classList.toggle('on'); });
          return b;
        }) : [h('span', { class: 'dim small' }, 'No border provinces')])));
    const theirs = borderProvinces(s, world, n, me);
    const mine = borderProvinces(s, world, me, n);
    if (type === 'territory' || type === 'peace') fill(this.composeExtra, chips(theirs, this.pickTake, 'You receive'), chips(mine, this.pickGive, 'You cede'));
    else if (type === 'demand') fill(this.composeExtra, chips(theirs, this.pickTake, 'You demand'));
    else if (type === 'joint-war') {
      const sel = h('select', { class: 'diplo-select' }, h('option', { value: '' }, 'Against…'),
        ...Object.values(s.nations).filter((x) => x.alive && x.id !== me && x.id !== n).sort((a, b) => a.shortName.localeCompare(b.shortName))
          .map((x) => h('option', { value: x.id }, x.shortName)));
      sel.value = this.pickTarget;
      sel.addEventListener('change', () => { this.pickTarget = sel.value; });
      fill(this.composeExtra, sel);
    } else if (type === 'trade') {
      const res = (n2: string) => [...producedBy(s, world, n2).keys()].sort();
      const pick = (label: string, opts: string[], key: 'sell' | 'buy') => {
        const sel = h('select', { class: 'diplo-select', 'aria-label': label }, h('option', { value: '' }, `${label}: nothing`),
          ...opts.map((r) => h('option', { value: r }, `${label}: ${world.resources[r]?.name ?? r}`)));
        sel.value = this.pickTrade[key];
        sel.addEventListener('change', () => { this.pickTrade[key] = sel.value; });
        return sel;
      };
      const gold = h('input', { class: 'diplo-gold', type: 'number', min: String(-MAX_TRADE_GOLD), max: String(MAX_TRADE_GOLD), step: '1', value: String(this.pickTrade.gold),
        title: 'Money you pay them each month (a negative number: they pay you)' }) as HTMLInputElement;
      gold.addEventListener('input', () => { this.pickTrade.gold = Math.round(Number(gold.value) || 0); });
      fill(this.composeExtra, pick('You supply', res(me), 'sell'), pick('You get', res(n), 'buy'),
        h('label', { class: 'dim small diplo-gold-label' }, 'You pay / month ', gold));
    } else fill(this.composeExtra);
  }

  private async send() {
    const s = this.store.state;
    const me = s.playerNation;
    const n = this.current;
    if (!me || !n || this.diplomat.isBusy(n)) return;
    const type = this.composeType.value as ComposeType;
    let text = this.input.value.trim();
    let proposalId: string | undefined;

    if (type !== 'message') {
      const terms: ProposalTerms = { type, from: me, to: n };
      if (type === 'territory' || type === 'peace') { terms.give = [...this.pickGive]; terms.take = [...this.pickTake]; }
      if (type === 'demand') terms.take = [...this.pickTake];
      if (type === 'joint-war') terms.target = this.pickTarget;
      if (type === 'trade') {
        if (this.pickTrade.sell) terms.sell = this.pickTrade.sell;
        if (this.pickTrade.buy) terms.buy = this.pickTrade.buy;
        terms.gold = this.pickTrade.gold;
      }
      const err = validateTerms(s, terms);
      if (err) return this.hooks.toast(err, 'alert');
      const ok = await this.act({ type: 'propose', terms });
      if (!ok) return;
      proposalId = [...this.store.state.proposals].reverse().find((p) => p.from === me && p.to === n)?.id;
      if (!text) text = `We formally propose: ${describeTerms(this.store.state, this.store.world, terms)}`;
    }
    if (!text) return;

    this.input.value = '';
    this.composeType.value = 'message';
    this.renderExtra();
    // the player's line carries the proposal card
    if (proposalId) this.store.dispatch({ type: 'chat', with: n, text, proposal: proposalId }, me);
    await this.awaitReply(n, this.diplomat.talk(n, proposalId ? '' : text));
  }

  /** Asks the leader again for a reply to the conversation so far (after a failed one). */
  private async askAgain(n: NationId) {
    if (this.diplomat.isBusy(n)) return;
    await this.awaitReply(n, this.diplomat.talk(n, ''));
  }

  private async awaitReply(n: NationId, pending: Promise<{ error?: string }>) {
    this.failed.delete(n);
    this.waitStart = Date.now();
    this.render();
    const ticker = window.setInterval(() => this.isOpen && this.render(), 1000);
    const r = await pending.finally(() => window.clearInterval(ticker));
    this.waitStart = 0;
    if (r.error && r.error !== 'Busy') this.failed.set(n, r.error);
    this.render();
  }

  /** Dispatch a player action, running the Assessor first for major ones. */
  private async act(action: Action): Promise<boolean> {
    const me = this.store.state.playerNation;
    if (!me) return false;
    if (!(await this.hooks.confirm(action))) return false;
    const r = this.store.dispatch(action, me);
    if (!r.ok) this.hooks.toast(r.error, 'alert');
    return r.ok;
  }
}
