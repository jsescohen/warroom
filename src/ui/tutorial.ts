import { audio } from '../audio/audio';
import { isFleet, seaUnitTypes } from '../core/military';
import type { GameStore } from '../core/store';
import type { GameLoop } from '../game/loop';
import { h } from './dom';
import { updateSettings } from './settings';
import type { Selection } from './sidePanel';

interface Step {
  title: string;
  text: string;
  /** The step completes by itself when this becomes true; otherwise it has a "Next" button. */
  done?: () => boolean;
}

/**
 * The first-game walkthrough: a small card that teaches by doing (select an army, order it, start
 * the clock…), moving on as soon as the player has done each thing. Skippable at any point; it does
 * not come back by itself after the first game (How to play or Settings → Gameplay can bring it back).
 */
export class Tutorial {
  private el = h('aside', { class: 'tutorial panel', role: 'dialog', 'aria-label': 'Tutorial' });
  private steps: Step[];
  private i = 0;
  private moved = false;
  private ran = false;

  constructor(private store: GameStore, loop: GameLoop, private selection: () => Selection) {
    const s = store.state;
    const p = s.playerNation!;
    const world = store.world;
    const hasFleets = seaUnitTypes(world).length > 0 && Object.values(s.armies).some((a) => a.owner === p && isFleet(world, a.unitType));
    const own = (id: string) => s.provinces[id]?.owner === p;
    this.steps = [
      { title: `You lead ${s.nations[p].name}`, text: 'The clock is paused, so take your time. This short walkthrough shows the basics; skip it whenever you like.' },
      { title: 'Select an army', text: 'Click one of your army counters: the small boxes in your colour on the map. Zoom with the mouse wheel, drag to move around.',
        done: () => { const sel = this.selection(); return sel?.kind === 'army' && this.store.state.armies[sel.id]?.owner === p; } },
      { title: 'Give it an order', text: 'Click a province, or drag the counter onto one. The dashed line shows the route and how long it takes. Try one of your own provinces first.',
        done: () => this.moved },
      { title: 'Start the clock', text: 'Press Space, or 1× at the top right. Watch your army march. Space pauses again; 2× and 3× go faster.',
        done: () => this.ran },
      { title: 'Look around', text: 'Click another nation’s province to see who owns it, its garrison and its armies. Press M to switch the map to relations or alliances.',
        done: () => { const sel = this.selection(); return sel?.kind === 'province' && !own(sel.id); } },
      { title: 'Talk to leaders', text: 'Diplomacy (D) opens a chat with any leader: make friends, sign alliances, demand land, or threaten. They remember what you say.' },
      { title: 'Money and materials', text: 'The ◈ in the top bar is your treasury (T): monthly income, stockpiles of resources, and the world market where you buy and sell them.' },
      { title: 'New troops', text: 'Select your capital: with its barracks you recruit armies there for money and materials. Provinces with a resource can get a mine or farm, and any province can be developed.' },
      ...(hasFleets ? [{ title: 'Fleets', text: 'The rounded counters under your ports are fleets. They sail along coasts, fight enemy fleets and keep the sea open so your troops can cross.' }] : []),
      { title: 'You are ready', text: 'Attacking a province means beating its garrison first. Ctrl+S saves, H opens How to play, L the ledger, ✎ sends feedback. Good luck!' },
    ];
    // shown by itself only once, ever: even if this game is left half-way through it
    updateSettings({ tutorialDone: true });
    store.subscribe((_s, _prev, cmd) => {
      if (cmd?.action.type === 'moveArmy' && cmd.actor === p) this.moved = true;
      this.check();
    });
    loop.onSpeedChange((speed) => { if (speed > 0) this.ran = true; this.check(); });
    document.body.append(this.el);
    this.render();
  }

  /** Called by the HUD when the selection changes. */
  check() {
    const step = this.steps[this.i];
    if (step?.done?.()) this.next();
  }

  private next() {
    audio.play('select');
    this.i++;
    if (this.i >= this.steps.length) return this.finish();
    this.render();
    this.check(); // the next step may already be done
  }

  private finish() {
    updateSettings({ tutorialDone: true });
    this.el.remove();
    this.steps = [];
  }

  private render() {
    const step = this.steps[this.i];
    const last = this.i === this.steps.length - 1;
    this.el.replaceChildren(
      h('div', { class: 'tutorial-head' },
        h('span', { class: 'eyebrow' }, `Tutorial · ${this.i + 1} / ${this.steps.length}`),
        h('button', { class: 'tutorial-skip', title: 'End the tutorial (it will not come back)', onclick: () => this.finish() }, 'Skip')),
      h('h3', null, step.title),
      h('p', null, step.text),
      step.done
        ? h('p', { class: 'tutorial-waiting' }, 'Waiting for you to do it…')
        : h('button', { class: 'btn primary', onclick: () => (last ? this.finish() : this.next()) }, last ? 'Start playing' : 'Next'),
      h('div', { class: 'tutorial-progress' }, h('i', { style: `width:${((this.i + 1) / this.steps.length) * 100}%` })),
    );
  }
}
