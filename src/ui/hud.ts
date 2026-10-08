import { getAiInfo, pingAi } from '../ai/llmClient';
import { validate, type Action } from '../core/actions';
import { classifyMajor, type AssessorMode } from '../core/assess';
import { canEnter, findPath, garrisonMax, garrisonOf, isFleet, strikeError } from '../core/military';
import { atWar, friendly } from '../core/queries';
import type { ScenarioDef } from '../core/scenario';
import type { GameStore } from '../core/store';
import { formatDate, formatShortDate, turnNumber } from '../core/time';
import type { Army, GameState, NationId } from '../core/types';
import { audio } from '../audio/audio';
import { newImportant, SPEEDS, type GameLoop, type Speed } from '../game/loop';
import type { GameSession } from '../game/session';
import { openGameMenu } from './menus/gameMenu';
import { openLedger } from './ledger';
import { NewsTicker } from './newsTicker';
import { openFeedback } from './menus/feedback';
import { openHowToPlay } from './menus/howToPlay';
import { openSettings } from './menus/settingsScreen';
import type { MapData } from '../map/mapData';
import { openEconomy } from './economyPanel';
import type { OnlineHud } from '../net/onlineGame';
import { budgetOf } from '../core/economy';
import { ALIGNMENT_COLORS, type MapMode, type MapRenderer } from '../map/MapRenderer';
import { SYMBOL_NAMES, symbolOf } from '../map/unitIcons';
import { fill, h, swatch } from './dom';
import { leaderOf } from '../ai/diplomacyPrompt';
import { DiplomacyDirector } from '../game/diplomacyDirector';
import { Diplomat } from '../game/diplomat';
import { assessAction } from './assessorDialog';
import { getSettings, newGameRules, onSettingsChange } from './settings';
import { DiplomacyWindow } from './diplomacyWindow';
import { formatDuration, SidePanel, type Selection } from './sidePanel';

/** The in-game HUD: top bar, side panel, event log, zoom controls, hover tip, toasts, input. */
export class Hud {
  private selection: Selection = null;
  private topbar = h('header', { class: 'topbar panel' });
  private side: SidePanel;
  private log = h('section', { class: 'log panel' });
  private tip = h('div', { class: 'hover-tip panel', style: 'display:none' });
  private aiStatus = h('div', { class: 'ai-status' });
  private playerEl = h('div', { class: 'player' });
  private treasuryEl = h('button', { class: 'btn treasury-btn', title: 'Treasury: income, upkeep, resources and trade (T)' });
  private treasuryKey = '';
  private speedEl = h('div', { class: 'time-controls' });
  private dateEl = h('div', { class: 'date' });
  private toasts = h('div', { class: 'toasts' });
  private mouse = { x: 0, y: 0 };
  private hovered: string | null = null;
  private diplo: DiplomacyWindow;
  private diploBtn = h('button', { class: 'btn diplo-btn', title: 'Diplomacy (D)' }, 'Diplomacy');
  /** Phones: Diplomacy and Ledger sit in a small bar at the bottom (the top bar has no room). */
  private mobileDiplo = h('button', { class: 'btn diplo-btn' }, 'Diplomacy');
  private mobileBar = h('div', { class: 'mobile-bar' });
  private speedBeforeDiplomacy: Speed = 0;
  private mapMode: MapMode = 'political';
  private hoveredArmy: string | null = null;
  private renderModes = () => {};

  /** Unit choosing a target for its strike (the next province clicked). */
  private targeting: string | null = null;

  constructor(
    root: HTMLElement,
    private store: GameStore,
    private map: MapData,
    private scenario: ScenarioDef,
    private renderer: MapRenderer,
    private loop: GameLoop,
    private session: GameSession,
    private onLoadGame: (id: string) => void,
  ) {
    this.side = new SidePanel(map, store.world, {
      chooseNation: (nation) => this.dispatch({ type: 'chooseNation', nation, ...newGameRules() }, nation),
      declareWar: (target) => void this.declareWar(target),
      selectArmy: (id) => this.select({ kind: 'army', id }),
      armyOrder: (type, army) => this.dispatch({ type, army } as Action),
      strike: (army) => this.startStrike(army),
      groupOrder: (type, ids) => {
        if (type === 'clear') return this.select(null);
        this.store.batch(() => {
          if (type === 'stop') for (const id of ids) this.store.dispatch({ type: 'stopArmy', army: id }, this.state.playerNation!);
          // merge: one merge per place and type (each merge takes in its idle neighbours)
          if (type === 'merge') {
            const done = new Set<string>();
            for (const id of ids) {
              const a = this.state.armies[id];
              if (!a || done.has(`${a.location}|${a.unitType}`)) continue;
              done.add(`${a.location}|${a.unitType}`);
              this.store.dispatch({ type: 'mergeArmies', army: id }, this.state.playerNation!);
            }
          }
        });
        audio.play('order');
      },
      focus: (id) => renderer.focusOn(id),
      diplomacy: (nation) => this.diplo.open(nation),
      recruit: (province, unitType) => { if (this.dispatch({ type: 'recruit', province, unitType })) audio.play('order'); },
      build: (province, building) => { if (this.dispatch({ type: 'build', province, building })) audio.play('order'); },
    });
    const modes = h('div', { class: 'map-modes panel', role: 'radiogroup', 'aria-label': 'Map mode' });
    const renderModes = () => fill(modes,
      ...([['political', 'Nations', 'Political map: who owns what'], ['relations', 'Relations', 'How each nation feels about you: green friendly, red hostile'], ['alliances', 'Alliances', 'You, allies, friends, enemies and neutrals'], ['resources', 'Resources', 'Where oil, steel, horses and other resources are found']] as [MapMode, string, string][])
        .map(([m, label, title]) => h('button', { class: m === this.mapMode ? 'active' : '', title: `${title} (M)`, onclick: () => this.setMapMode(m) }, label)),
      this.mapMode === 'alliances' ? h('div', { class: 'map-legend' }, ...([['you', 'You'], ['ally', 'Allies'], ['friend', 'Treaties'], ['enemy', 'At war'], ['neutral', 'Neutral']] as [keyof typeof ALIGNMENT_COLORS, string][])
        .map(([k, l]) => h('span', null, h('i', { style: `background:${ALIGNMENT_COLORS[k]}` }), l))) : null,
      this.mapMode === 'relations' ? h('div', { class: 'map-legend gradient' }, h('span', null, 'Hostile'), h('i', null), h('span', null, 'Friendly')) : null,
      this.mapMode === 'resources' ? h('div', { class: 'map-legend' }, ...Object.values(store.world.resources)
        .map((r) => h('span', null, h('i', { style: `background:${r.color}` }), r.name))) : null,
    );
    renderer.setResourceColors(map.provinces.map((p) => store.world.resources[store.world.provinces[p.id]?.resource ?? '']?.color ?? null));
    this.renderModes = renderModes;
    renderModes();
    const zoom = h('div', { class: 'zoom-controls panel' },
      h('button', { title: 'Zoom in', onclick: () => this.zoomBy(1.6) }, '+'),
      h('button', { title: 'Zoom out', onclick: () => this.zoomBy(1 / 1.6) }, '−'),
      h('button', { title: 'Show whole map', onclick: () => renderer.camera.flyTo(map.width / 2, map.height / 2, renderer.camera.minZoom) }, '⤢'),
    );
    this.treasuryEl.addEventListener('click', () => this.openTreasury());
    const spectating = store.readOnly;
    if (spectating) this.diploBtn.style.display = 'none';
    this.topbar.append(
      h('div', null, h('div', { class: 'title' }, scenario.name, h('span', { class: 'beta-badge small' }, spectating ? 'Spectating' : 'Beta')), h('div', { class: 'subtitle' }, scenario.subtitle)),
      this.playerEl,
      this.treasuryEl,
      this.aiStatus,
      this.diploBtn,
      h('button', { class: 'btn diplo-btn', title: 'Ledger: the great powers compared, with graphs (L)', onclick: () => void this.withPause(() => openLedger(store), true) }, 'Ledger'),
      ...(spectating ? [] : [h('button', { class: 'btn icon-btn', title: 'Send feedback: a bug or an idea, straight to the admin', 'aria-label': 'Send feedback', onclick: () => void this.withPause(() => openFeedback({ store, scenario }), true) }, '✎')]),
      h('button', { class: 'btn icon-btn', title: 'How to play (H)', 'aria-label': 'How to play', onclick: () => void this.withPause(() => openHowToPlay(), true) }, '?'),
      h('button', { class: 'btn icon-btn', title: 'Settings', 'aria-label': 'Settings', onclick: () => void this.openSettingsPaused() }, '⚙'),
      h('button', { class: 'btn icon-btn', title: 'Menu (Esc): save, load, settings, main menu', 'aria-label': 'Menu', onclick: () => void this.openMenu() }, '☰'),
      h('div', { class: 'spacer' }),
      this.speedEl,
      this.dateEl,
    );
    loop.autoPause = getSettings().autoPause;
    renderer.setOptions({ provinceLabels: getSettings().provinceLabels, reduceMotion: getSettings().reduceMotion, edgeScroll: getSettings().edgeScroll });
    onSettingsChange((st) => {
      loop.autoPause = st.autoPause;
      renderer.setOptions({ provinceLabels: st.provinceLabels, reduceMotion: st.reduceMotion, edgeScroll: st.edgeScroll });
    });

    const diplomat = new Diplomat(store, scenario);
    this.diplo = new DiplomacyWindow(store, scenario, diplomat, {
      confirm: (action) => this.confirmMajor(action),
      toast: (text, kind) => this.toast(text, kind),
      onOpenChange: (open) => {
        audio.play(open ? 'open' : 'close');
        if (!getSettings().dialogsPause) return;
        if (open) { this.speedBeforeDiplomacy = loop.speed; loop.setSpeed(0); }
        else if (this.speedBeforeDiplomacy) loop.setSpeed(this.speedBeforeDiplomacy);
      },
      onUnreadChange: (n) => {
        for (const b of [this.diploBtn, this.mobileDiplo]) {
          b.dataset.badge = n ? String(n) : '';
          b.classList.toggle('has-badge', n > 0);
        }
      },
    });
    this.diploBtn.addEventListener('click', () => this.diplo.open());
    this.mobileDiplo.addEventListener('click', () => this.diplo.open());
    this.mobileBar.append(...(store.readOnly ? [] : [this.mobileDiplo]),
      h('button', { class: 'btn diplo-btn', onclick: () => void this.withPause(() => openLedger(store), true) }, 'Ledger'));
    if (!spectating) new DiplomacyDirector(store, diplomat, () => getSettings().aiMessages, (from) => {
      audio.play('message');
      const s = this.state;
      const leader = leaderOf(scenario, s, from).name.replace(/^the /, 'The ');
      const hostile = !!s.playerNation && (s.wars.some((w) => [w.attackers, w.defenders].some((side) => side.includes(from)) && [w.attackers, w.defenders].some((side) => side.includes(s.playerNation!))));
      this.toast(`✉ Message from ${leader} (${s.nations[from].shortName}). Click to read.`, hostile ? 'alert' : 'info', () => this.diplo.open(from));
    });
    const news = new NewsTicker(store, scenario);
    root.append(this.topbar, this.mobileBar, this.side.el, this.log, news.el, modes, zoom, this.tip, this.toasts, this.diplo.el);

    renderer.on('select', (id) => {
      if (this.targeting) { if (id) this.fireStrike(id); return; }
      const group = this.ownSelectedArmies();
      if (group.length && id) void this.orderGroup(group, id);
      else this.select(id ? { kind: 'province', id } : null);
    });
    renderer.on('army', (id, mods) => {
      if (!id) return this.select(null);
      const mine = this.state.armies[id]?.owner === this.state.playerNation;
      if (mods.shift && mine) {
        // shift+click: add to or remove from the group
        const ids = this.ownSelectedArmies().map((a) => a.id);
        const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
        this.selectArmies(next);
      } else this.select({ kind: 'army', id });
      audio.play('select');
    });
    // shift+drag a box: select every army of yours inside it
    renderer.onBox((ids) => {
      const mine = ids.filter((id) => this.state.armies[id]?.owner === this.state.playerNation);
      if (!mine.length) return;
      this.selectArmies(mine);
      audio.play('select');
    });
    // Drag one of your counters: the route follows the cursor, releasing gives the order.
    renderer.armyDrag = {
      canDrag: (id) => !store.readOnly && !!this.state.playerNation && this.state.armies[id]?.owner === this.state.playerNation,
      move: (id, province, at) => {
        const inGroup = this.selection?.kind === 'armies' && this.selection.ids.includes(id);
        if (!inGroup && (this.selection?.kind !== 'army' || this.selection.id !== id)) { this.select({ kind: 'army', id }); audio.play('pickup'); }
        this.hovered = province;
        if (province) this.renderTip();
        else {
          const a = this.state.armies[id];
          this.tip.style.display = 'none';
          if (a) this.renderer.setMovePreview([this.armyPos(a), at], true);
        }
      },
      drop: (id, province) => {
        this.renderer.setMovePreview(null);
        const a = this.state.armies[id];
        if (!a || !province) return;
        const group = this.ownSelectedArmies();
        // dragging one counter of a group moves the whole group
        if (group.length > 1 && group.some((g) => g.id === id)) void this.orderGroup(group, province);
        else void this.orderMove(a, province);
      },
    };
    renderer.on('command', (id) => {
      if (this.targeting) { if (id) this.fireStrike(id); return; }
      const group = this.ownSelectedArmies();
      if (group.length && id) void this.orderGroup(group, id);
    });
    renderer.onArmyHover((id) => {
      this.hoveredArmy = id;
      this.renderTip();
    });
    renderer.on('hover', (id) => {
      this.hovered = id;
      this.renderTip();
    });
    root.addEventListener('pointermove', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
      this.tip.style.left = `${e.clientX}px`;
      this.tip.style.top = `${e.clientY}px`;
    });
    store.subscribe((s, prev) => {
      if (s.clock !== prev.clock) this.renderClock();
      if (s.events !== prev.events) {
        this.renderLog();
        this.playEventSounds(prev, s);
        for (const e of newImportant(prev, s).slice(-3)) this.toast(e.text, e.nations?.includes(s.playerNation ?? '') ? 'alert' : 'info');
      }
      if (s.playerNation !== prev.playerNation) this.renderPlayer();
      if (s.nations !== prev.nations || s.clock !== prev.clock || s.playerNation !== prev.playerNation) this.renderTreasury();
      if (this.selection?.kind === 'army' && !s.armies[this.selection.id]) this.select(null);
      else if (this.selection?.kind === 'armies' && this.selection.ids.some((id) => !s.armies[id])) this.selectArmies(this.selection.ids.filter((id) => s.armies[id]));
      else this.side.render(s, this.selection);
      if (s.armies !== prev.armies && this.hovered) this.renderTip();
    });
    // Auto-pause needs no toast of its own: the event that caused it is already shown in red.
    loop.onSpeedChange((speed) => {
      this.renderSpeed();
      this.renderClock();
      audio.play(speed ? 'resume' : 'pause', { minGapMs: 120 });
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.render();
    void this.checkAi();
  }

  private get state(): GameState {
    return this.store.state;
  }

  render() {
    this.renderPlayer();
    this.renderTreasury();
    this.renderSpeed();
    this.renderClock();
    this.side.render(this.state, this.selection);
    this.renderLog();
  }

  // ---- selection & orders -------------------------------------------------------------------------

  /** Told whenever the selection changes (the tutorial listens). */
  onSelectionChange: (() => void) | null = null;
  get currentSelection(): Selection {
    return this.selection;
  }

  private select(sel: Selection) {
    if (this.targeting && !(sel?.kind === 'army' && sel.id === this.targeting)) this.endStrike();
    this.selection = sel;
    this.renderer.setSelection(sel?.kind === 'province' ? sel.id : null);
    this.renderer.setArmySelection(sel?.kind === 'army' ? sel.id : sel?.kind === 'armies' ? sel.ids : null);
    this.renderer.setMovePreview(null);
    this.side.render(this.state, sel);
    this.renderTip();
    this.onSelectionChange?.();
  }

  private setMapMode(m: MapMode) {
    if (m !== 'political' && m !== 'resources' && !this.state.playerNation) return this.toast('Choose your nation first: these maps are drawn from its point of view.', 'info');
    this.mapMode = m;
    this.renderer.setMapMode(m);
    this.renderModes();
    audio.play('click');
  }

  // ---- strikes ------------------------------------------------------------------------------------

  private startStrike(army: string) {
    const a = this.state.armies[army];
    const strike = a && this.store.world.unitTypes[a.unitType]?.strike;
    if (!a || !strike) return;
    if (this.selection?.kind !== 'army' || this.selection.id !== army) this.select({ kind: 'army', id: army });
    this.targeting = army;
    this.renderer.setStrikeRange(army, strike.range);
    document.body.classList.add('targeting');
    this.toast(`Choose a target for the ${strike.kind === 'air' ? 'air' : 'drone'} strike inside the ring. Esc cancels.`, 'info');
  }

  private endStrike() {
    this.targeting = null;
    this.renderer.setStrikeRange(null);
    document.body.classList.remove('targeting');
  }

  private fireStrike(target: string) {
    const army = this.targeting!;
    const err = validate(this.state, { action: { type: 'strike', army, target }, actor: this.state.playerNation ?? 'system' }, this.store.world);
    if (err) { this.toast(err, 'alert'); audio.play('error'); return; }
    this.endStrike();
    if (this.dispatch({ type: 'strike', army, target })) audio.play('strike');
    this.renderTip();
  }

  /** Selects a group (or one army, or nothing) from a list of army ids. */
  private selectArmies(ids: string[]) {
    if (!ids.length) this.select(null);
    else if (ids.length === 1) this.select({ kind: 'army', id: ids[0] });
    else this.select({ kind: 'armies', ids });
  }

  /** The player's selected armies: the group, the single army, or none. */
  private ownSelectedArmies(): Army[] {
    const sel = this.selection;
    const ids = sel?.kind === 'armies' ? sel.ids : sel?.kind === 'army' ? [sel.id] : [];
    return ids.map((id) => this.state.armies[id]).filter((a): a is Army => !!a && a.owner === this.state.playerNation);
  }

  /** One order for several armies: one advisor check, then each army finds its own route. */
  private async orderGroup(armies: Army[], to: string) {
    if (armies.length === 1) return this.orderMove(armies[0], to);
    const s = this.state, world = this.store.world, player = s.playerNation!;
    this.renderer.setMovePreview(null);
    const owner = s.provinces[to]?.owner;
    const land = armies.filter((a) => !isFleet(world, a.unitType));
    if (land.length && owner && !canEnter(s, player, to)) {
      if (friendly(s, player, owner)) return this.toast(`${s.nations[owner].shortName} is a friend: you have no right to fight there.`, 'alert');
      const war: Action = { type: 'declareWar', attacker: player, defender: owner };
      const invalid = validate(s, { action: war, actor: player }, world);
      if (invalid) return this.toast(invalid, 'alert');
      const base = classifyMajor(s, world, war, player, this.assessorMode)!;
      const major = { ...base, label: `Declare war on ${s.nations[owner].name} and attack ${this.map.byId.get(to)?.name ?? 'them'} with ${armies.length} armies` };
      if (!(await this.withPause(() => assessAction({ ...this.assessCtx(), major, confirmLabel: 'Declare war & attack' })))) return;
      this.dispatch(war);
    } else {
      const first = land[0] ?? armies[0];
      const major = classifyMajor(s, world, { type: 'moveArmy', army: first.id, to }, player, this.assessorMode);
      if (major && !(await this.withPause(() => assessAction({ ...this.assessCtx(), major: { ...major, label: `${major.label} (${armies.length} armies)` }, confirmLabel: 'Give the order' })))) return;
    }
    let ok = 0;
    const failed: string[] = [];
    this.store.batch(() => {
      for (const a of armies) {
        if (!this.state.armies[a.id]) continue;
        const r = this.store.dispatch({ type: 'moveArmy', army: a.id, to }, player);
        if (r.ok) ok++; else failed.push(a.name);
      }
    });
    if (ok) audio.play('order');
    if (failed.length) this.toast(`${ok} on the way; ${failed.length} cannot get there (${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}).`, 'alert');
  }

  private async orderMove(army: Army, to: string) {
    if (army.location === to && army.progress === 0) {
      if (army.path.length) this.dispatch({ type: 'stopArmy', army: army.id });
      return;
    }
    const action: Action = { type: 'moveArmy', army: army.id, to };
    this.renderer.setMovePreview(null);
    const s = this.state;
    const owner = s.provinces[to]?.owner;
    if (isFleet(this.store.world, army.unitType)) {
      if (!canEnter(s, army.owner, to, this.store.world, army.unitType)) return this.toast('Fleets can only sail to coastal provinces.', 'alert');
      return this.dispatch(action);
    }
    if (owner && !canEnter(s, army.owner, to)) {
      if (friendly(s, army.owner, owner)) return this.toast(`${s.nations[owner].shortName} is a friend: you have no right to fight there.`, 'alert');
      return this.declareAndAttack(army, to);
    }
    const major = classifyMajor(this.state, this.store.world, action, army.owner, this.assessorMode);
    if (!major) return this.dispatch(action);
    if (await this.withPause(() => assessAction({ ...this.assessCtx(), major, confirmLabel: 'Give the order' }))) this.dispatch(action);
  }

  /** Order into a neutral country: one Assessor dialog covers declaring war and the attack. */
  private async declareAndAttack(army: Army, to: string) {
    const s = this.state;
    const player = s.playerNation!;
    const target = s.provinces[to].owner;
    const war: Action = { type: 'declareWar', attacker: player, defender: target };
    const invalid = validate(s, { action: war, actor: player }, this.store.world);
    if (invalid) return this.toast(invalid, 'alert');
    const base = classifyMajor(s, this.store.world, war, player, this.assessorMode)!;
    const major = { ...base, label: `Declare war on ${s.nations[target].name} and attack ${this.map.byId.get(to)?.name ?? 'them'}` };
    if (!(await this.withPause(() => assessAction({ ...this.assessCtx(), major, confirmLabel: 'Declare war & attack' })))) return;
    this.dispatch(war);
    const r = this.store.dispatch({ type: 'moveArmy', army: army.id, to }, player);
    if (!r.ok) this.toast(`War declared, but the army cannot get there: ${r.error}`, 'alert');
    else audio.play('order');
  }

  private async openMenu() {
    await this.withPause(() => openGameMenu(this.session, this.onLoadGame), true);
  }

  private async openSettingsPaused() {
    await this.withPause(() => openSettings(), true);
  }

  /** Sounds for what just happened, from the player's point of view. */
  private playEventSounds(prev: GameState, s: GameState) {
    const player = s.playerNation;
    if (!player || prev.events === s.events) return;
    const lastId = prev.events.at(-1)?.id ?? -1;
    for (const e of s.events.filter((x) => x.id > lastId)) {
      const mine = !!e.nations?.includes(player);
      const won = e.nations?.[0] === player;
      switch (e.kind) {
        case 'war': if (mine || e.important) audio.play('war'); break;
        case 'battle': if (mine) audio.play('battle', { minGapMs: 1500 }); break;
        case 'capture': audio.play(won ? 'capture' : 'loss', { minGapMs: 600 }); break;
        case 'capital': case 'capitulation': case 'annexed':
          if (mine) audio.play(e.nations?.[1] === player || won ? 'capital' : 'loss'); break;
        case 'army-destroyed': if (mine) audio.play('loss', { minGapMs: 1000 }); break;
        case 'agreement': if (mine) audio.play('signed'); break;
        case 'treaty-broken': case 'ceasefire-ended': if (mine) audio.play('alert'); break;
        case 'mobilize': audio.play('order', { minGapMs: 2000 }); break;
        case 'strike': if (!won) audio.play('strike', { minGapMs: 800 }); break; // our own strikes play when ordered
        case 'blockade': audio.play('alert'); break;
      }
    }
  }

  /** Assessor gate for any player action: resolves true if it may go ahead. */
  private async confirmMajor(action: Action): Promise<boolean> {
    const player = this.state.playerNation;
    if (!player) return false;
    const major = classifyMajor(this.state, this.store.world, action, player, this.assessorMode);
    if (!major) return true;
    const labels: Partial<Record<string, string>> = { breakTreaty: 'Break the treaty', demandTerritory: 'Send the ultimatum', jointWar: 'Agree to war' };
    return this.withPause(() => assessAction({ ...this.assessCtx(), major, confirmLabel: labels[major.kind] ?? 'Proceed' }));
  }

  /** Nation of the selected province, if it is not the player's. */
  private selectedNation(): NationId | null {
    const sel = this.selection;
    if (sel?.kind !== 'province') return null;
    const owner = this.state.provinces[sel.id]?.owner;
    return owner && owner !== this.state.playerNation ? owner : null;
  }

  private assessCtx() {
    return { scenario: this.scenario, state: this.state, world: this.store.world, mode: this.assessorMode };
  }

  /** Pauses the game while a dialog is open, then restores the previous speed. */
  private async withPause<T>(fn: () => Promise<T>, always = false): Promise<T> {
    if (!always && !getSettings().dialogsPause) return fn();
    const speed = this.loop.speed;
    this.loop.setSpeed(0);
    try {
      return await fn();
    } finally {
      if (speed) this.loop.setSpeed(speed);
    }
  }

  private dispatch(action: Action, actor: NationId | null = this.state.playerNation) {
    if (!actor) return;
    const r = this.store.dispatch(action, actor);
    if (!r.ok) { this.toast(r.error, 'alert'); audio.play('error'); }
    else if (action.type === 'moveArmy') audio.play('order');
    return r.ok;
  }

  private async declareWar(target: NationId) {
    const s = this.state;
    const player = s.playerNation;
    if (!player) return;
    const action: Action = { type: 'declareWar', attacker: player, defender: target };
    const invalid = validate(s, { action, actor: player }, this.store.world);
    if (invalid) return this.toast(invalid, 'alert');
    const major = classifyMajor(s, this.store.world, action, player, this.assessorMode)!;
    if (await this.withPause(() => assessAction({ ...this.assessCtx(), major, confirmLabel: 'Declare war' }))) this.dispatch(action);
  }

  // ---- assessor mode --------------------------------------------------------------------------------

  private get assessorMode(): AssessorMode {
    return getSettings().advisor;
  }

  // ---- top bar ------------------------------------------------------------------------------------

  private zoomBy(f: number) {
    const c = this.renderer.camera;
    c.zoomAt(c.viewW / 2, c.viewH / 2, f);
  }

  private openTreasury() {
    if (!this.state.playerNation) return;
    void this.withPause(() => openEconomy(this.store, { focus: (p) => { this.renderer.focusOn(p); this.select({ kind: 'province', id: p }); } }), true);
  }

  /** Money in the top bar: refreshed daily (the budget is not free to compute). */
  private renderTreasury() {
    const s = this.state;
    const me = s.playerNation ? s.nations[s.playerNation] : null;
    this.treasuryEl.style.display = me ? '' : 'none';
    if (!me) return;
    const key = `${Math.floor(s.clock.hours / 24)}|${Math.floor(me.treasury ?? 0)}`;
    if (key === this.treasuryKey) return;
    this.treasuryKey = key;
    const net = budgetOf(s, this.store.world, me.id).net;
    this.treasuryEl.replaceChildren(h('span', { class: 'coin' }, '◈'), String(Math.floor(me.treasury ?? 0)),
      h('span', { class: net < 0 ? 'danger-text' : 'ok-text' }, ` ${net >= 0 ? '+' : '−'}${Math.abs(Math.round(net))}`));
  }

  private renderPlayer() {
    const s = this.state;
    const player = s.playerNation ? s.nations[s.playerNation] : null;
    this.playerEl.replaceChildren(
      ...(player ? [swatch(player.color), player.name] : [h('span', { class: 'subtitle' }, 'Select a province to choose your nation')]),
    );
  }

  private online: OnlineHud | null = null;

  /** Online game: the room's state replaces the speed buttons (the host of a private room may pause). */
  setOnline(o: OnlineHud) {
    this.online = o;
    document.body.classList.add('online-game');
    o.onChange(() => { this.renderSpeed(); this.renderClock(); });
    this.renderSpeed();
    this.renderClock();
  }

  private renderSpeed() {
    const o = this.online;
    if (o) {
      fill(this.speedEl,
        h('span', { class: 'online-pill', title: 'Online game: the server keeps the time' }, h('i', { class: 'mp-dot on' }), o.label()),
        o.canPause() ? h('button', { title: o.paused() ? 'Resume the game for everyone' : 'Pause the game for everyone', onclick: () => o.togglePause() }, o.paused() ? '▶' : '❚❚') : null,
      );
      return;
    }
    const speed = this.loop.speed;
    const btn = (label: string, title: string, active: boolean, onclick: () => void) =>
      h('button', { class: active ? 'active' : '', title, onclick }, label);
    this.speedEl.replaceChildren(
      btn('❚❚', 'Pause (Space)', speed === 0, () => this.loop.setSpeed(0)),
      ...SPEEDS.map((sp, i) => btn(`${sp}×`, `Speed ${sp}× (${i + 1})`, speed === sp, () => this.loop.setSpeed(sp))),
      btn('⏭', `Skip to the next important event, up to ${this.scenario.time.skipMaxTurns} ${this.scenario.time.turnName.toLowerCase()}s (N)`, false, () => this.skip()),
    );
  }

  private renderClock() {
    const c = this.state.clock;
    const t = this.scenario.time;
    this.dateEl.classList.toggle('paused', this.loop.speed === 0);
    this.dateEl.replaceChildren(
      h('span', { class: 'date-main' }, formatDate(c, { time: t.showHours })),
      h('span', { class: 'date-turn' }, this.loop.speed === 0 ? 'Paused' : `${t.turnName} ${turnNumber(c)}`),
    );
  }

  private skip() {
    const r = this.loop.skip();
    if (!r.event) {
      const n = Math.round(r.turns);
      this.toast(`${n} ${this.scenario.time.turnName.toLowerCase()}${n === 1 ? '' : 's'} pass quietly.`, 'info');
    }
  }

  private onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
    if (document.querySelector('.modal-backdrop')) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); void this.session.save(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); this.loop.togglePause(); }
    else if (e.key === '1' || e.key === '2' || e.key === '3') this.loop.setSpeed(SPEEDS[Number(e.key) - 1] as Speed);
    else if (e.key === 'n' || e.key === 'N') this.skip();
    else if (e.key === 'Escape') { if (this.targeting) this.endStrike(); else if (this.selection) this.select(null); else void this.openMenu(); }
    else if (e.key === 'd' || e.key === 'D') { e.preventDefault(); this.diplo.open(this.selectedNation() ?? undefined); }
    else if (e.key === 'l' || e.key === 'L') void this.withPause(() => openLedger(this.store), true);
    else if (e.key === 't' || e.key === 'T') this.openTreasury();
    else if (e.key === 'm' || e.key === 'M') this.setMapMode(this.mapMode === 'political' ? 'relations' : this.mapMode === 'relations' ? 'alliances' : this.mapMode === 'alliances' ? 'resources' : 'political');
    else if (e.key === 'h' || e.key === 'H' || e.key === '?') void this.withPause(() => openHowToPlay(), true);
  }

  /** An achievement was unlocked. */
  celebrate(name: string, description: string) {
    audio.play('capital');
    const el = h('div', { class: 'toast panel achievement' }, h('span', { class: 'ach-mark' }, '★'), h('div', null, h('strong', null, `Achievement: ${name}`), h('span', null, description)));
    this.toasts.prepend(el);
    setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 400); }, 6000);
  }

  /** Short message for other components (e.g. "Game saved"). */
  notify(text: string) {
    this.toast(text, 'info');
  }

  private toast(text: string, kind: 'info' | 'alert', onClick?: () => void) {
    const el = h('div', { class: `toast panel ${kind}${onClick ? ' clickable' : ''}` }, text);
    if (onClick) el.addEventListener('click', () => { el.remove(); onClick(); });
    this.toasts.prepend(el);
    while (this.toasts.children.length > 4) this.toasts.lastElementChild!.remove();
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 400);
    }, kind === 'alert' ? 7000 : 4500);
  }

  // ---- log & hover --------------------------------------------------------------------------------

  private renderLog() {
    const items = this.state.events.slice(-40).reverse()
      .map((e) => h('li', { class: e.important ? 'important' : '' }, h('time', null, formatShortDate({ ...this.state.clock, hours: e.at })), e.text));
    this.log.replaceChildren(h('h3', null, 'Dispatches'), h('ol', null, ...items));
  }

  /** Hover tooltip; with one of your armies selected it previews the route and ETA. */
  private renderTip() {
    // a counter under the pointer: what it is
    const ha = this.hoveredArmy ? this.state.armies[this.hoveredArmy] : null;
    if (ha && !this.targeting) {
      const s = this.state, unit = this.store.world.unitTypes[ha.unitType];
      const owner = s.nations[ha.owner];
      this.tip.replaceChildren(swatch(owner.color), h('strong', null, ha.name), h('span', { class: 'dim' }, owner.shortName),
        h('span', { class: 'tip-line' }, `${unit?.name ?? ha.unitType} (${SYMBOL_NAMES[symbolOf(ha.unitType)]})`),
        h('span', { class: 'tip-line dim' }, `Strength ${ha.strength.toFixed(1)} / ${ha.maxStrength.toFixed(0)}${unit ? ` · attack ${unit.attack} · defence ${unit.defense}` : ''}${unit?.strike ? ' · can strike' : ''}`));
      this.tip.style.display = 'flex';
      this.tip.style.left = `${this.mouse.x}px`;
      this.tip.style.top = `${this.mouse.y}px`;
      return;
    }
    const id = this.hovered;
    if (!id) {
      this.tip.style.display = 'none';
      this.renderer.setMovePreview(null);
      return;
    }
    const s = this.state;
    const geo = this.map.byId.get(id)!;
    const owner = s.nations[s.provinces[id].owner];
    const parts: (Node | string)[] = [swatch(owner.color), h('strong', null, geo.name), h('span', { class: 'dim' }, owner.shortName)];

    // what is going on here: battle, siege, a weakened garrison
    const prov = s.provinces[id];
    const garrison = garrisonOf(s, id), full = garrisonMax(s, id);
    const line = (text: string, cls = 'dim') => parts.push(h('span', { class: `tip-line ${cls}` }, text));
    if (owner.capital === id) parts.push(h('span', { class: 'dim' }, '★ capital'));
    if (s.battles[id] !== undefined) line('⚔ Battle in progress', 'danger-text');
    if (prov.siege) {
      const by = s.nations[prov.siege.by]?.shortName ?? '?';
      line(garrison > 0.05 && prov.siege.progress === 0
        ? `${by} is fighting the garrison: ${garrison.toFixed(1)} of ${full.toFixed(1)} left`
        : `${by} is occupying it: ${Math.round(prov.siege.progress * 100)}%`, 'danger-text');
    } else if (garrison < full - 0.05) line(garrison < 0.05 ? 'No garrison yet (rebuilding)' : `Garrison ${garrison.toFixed(1)} of ${full.toFixed(1)} (rebuilding)`);

    const army = this.ownSelectedArmies()[0] ?? null;
    if (this.targeting && army?.id === this.targeting) {
      const err = strikeError(s, this.store.world, army.id, id);
      const foes = Object.values(s.armies).filter((x) => x.location === id && x.progress === 0 && atWar(s, army.owner, x.owner));
      parts.push(h('span', { class: `tip-line ${err ? 'danger-text' : 'ok-text'}` }, err ?? `Strike here: ${foes.length ? `${foes.length} enemy unit${foes.length === 1 ? '' : 's'}` : 'the garrison'}`));
      this.renderer.setMovePreview(null);
    } else if (army && !(army.location === id && army.progress === 0)) {
      const start = this.armyPos(army);
      const world = this.store.world;
      const fleet = isFleet(world, army.unitType);
      if (fleet && !canEnter(s, army.owner, id, world, army.unitType)) {
        parts.push(h('span', { class: 'tip-line danger-text' }, 'Fleets can only sail to coastal provinces'));
        this.renderer.setMovePreview([start, geo.label], false);
      } else if (!fleet && !canEnter(s, army.owner, id)) {
        parts.push(h('span', { class: 'tip-line danger-text' }, friendly(s, army.owner, owner.id) ? `No access: ${owner.shortName} is a friend` : `Declare war on ${owner.shortName} & attack`));
        this.renderer.setMovePreview([start, geo.label], false);
      } else {
        const route = findPath(s, world, army.owner, army.unitType, army.location, id);
        if (!route) {
          const bySea = !fleet && findPath(s, world, army.owner, army.unitType, army.location, id, { ignoreSeaControl: true });
          parts.push(h('span', { class: 'tip-line danger-text' }, bySea
            ? 'No route: enemy fleets control the sea on the way. Win the sea with your fleet first.'
            : fleet ? 'No sea route' : 'No route: blocked by neutral or friendly land'));
          this.renderer.setMovePreview([start, geo.label], false);
        } else {
          const enemy = !fleet && s.provinces[id].owner !== army.owner && !friendly(s, army.owner, s.provinces[id].owner);
          parts.push(h('span', { class: `tip-line ${enemy ? 'danger-text' : 'ok-text'}` }, `${enemy ? 'Attack' : fleet ? 'Sail' : 'Move'} · ${formatDuration(route.hours)}`
            + (enemy && garrison > 0.05 ? ` · garrison ${garrison.toFixed(1)} to beat first` : '')));
          this.renderer.setMovePreview([start, ...route.path.map((p) => world.provinces[p].label)], true);
        }
      }
    } else this.renderer.setMovePreview(null);
    const group = this.ownSelectedArmies();
    if (group.length > 1 && !this.targeting) parts.push(h('span', { class: 'tip-line dim' }, `Order for all ${group.length} selected armies`));

    this.tip.replaceChildren(...parts);
    this.tip.style.display = 'flex';
    this.tip.style.left = `${this.mouse.x}px`;
    this.tip.style.top = `${this.mouse.y}px`;
  }

  private armyPos(a: Army): [number, number] {
    const w = this.store.world;
    const from = w.provinces[a.location].label;
    if (!a.progress || !a.path.length) return [from[0], from[1]];
    const to = w.provinces[a.path[0]].label;
    return [from[0] + (to[0] - from[0]) * a.progress, from[1] + (to[1] - from[1]) * a.progress];
  }

  private async checkAi() {
    const dot = h('span', { class: 'dot' });
    const label = h('span', null, 'AI: checking…');
    const test = h('button', { class: 'btn', title: 'Send a test request to the AI provider' }, 'Test');
    this.aiStatus.replaceChildren(dot, label, test);
    const info = await getAiInfo();
    if ('error' in info) {
      dot.className = 'dot err';
      label.textContent = `AI offline — ${info.error}`;
      label.title = info.error;
    } else {
      dot.className = 'dot';
      label.textContent = `AI: ${info.provider} · ${info.model}`;
    }
    test.addEventListener('click', async () => {
      test.setAttribute('disabled', '');
      label.textContent = 'AI: testing…';
      const r = await pingAi();
      test.removeAttribute('disabled');
      dot.className = r.valid ? 'dot ok' : 'dot err';
      label.textContent = r.valid ? `AI ✓ “${r.data.message}”` : `AI ✗ ${'error' in r ? r.error : 'invalid JSON (fallback used)'}`;
    });
  }
}
