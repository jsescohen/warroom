import { fill, h } from '../dom';
import { openPanel } from './shell';

type Section = { id: string; label: string; intro?: string; items: [string, string][] };

/** Short, player-facing rules. Keep in step with src/core (military, ai, diplomacy). */
const SECTIONS: Section[] = [
  {
    id: 'start', label: 'Basics',
    intro: 'Lead one nation through an era of history. Conquer, make friends, or both: every other nation is run by an AI that remembers what you do.',
    items: [
      ['Pick an era and a nation', 'Click a country on the map, then "Lead …". Great powers are easiest to start with.'],
      ['Win', 'Control half of all provinces (55% in World War I, 60% in World War II). If your nation falls, the game is lost.'],
      ['Time', 'The game starts paused. Space pauses and resumes, 1 · 2 · 3 set the speed, ⏭ (N) skips ahead to the next important event.'],
      ['Auto-pause', 'By default the game stops when something important happens to you. Change it in Settings → Gameplay.'],
      ['Save', 'Ctrl+S, or the ☰ menu. The game also autosaves. Saves stay in this browser; export them from Load game to keep a copy.'],
    ],
  },
  {
    id: 'armies', label: 'Armies',
    items: [
      ['Move', 'Drag one of your counters to a province, or click it and then click (or right-click) the destination. The dashed line shows the route and how long it takes.'],
      ['Counters', 'The number is the army’s strength (10 when full); the bar underneath is its health. Hover a counter to see exactly what it is.'],
      ['Symbols', 'Helmet: infantry · shield: ancient foot soldiers · tank: armour · cannon: artillery · horseshoe: cavalry · wheel: chariots · bow: archers · plane: air force · quadcopter: drones.'],
      ['Types', 'Each era has its own troops. Fast attackers (armour, cavalry, chariots) hit hard; infantry and pikes hold ground; artillery is slow but powerful.'],
      ['Battles', 'Enemy armies in the same province fight by themselves until one side is gone or leaves. Defending your own land gives a bonus, a capital even more.'],
      ['Healing', 'Damaged armies recover slowly in your own or allied land, away from fighting.'],
      ['New armies', 'Every 30 days a new army is raised at your capital, up to a limit that grows with the size of your homeland.'],
      ['Split & merge', 'Split an army in two halves to cover more ground; merge idle armies of the same type standing together.'],
    ],
  },
  {
    id: 'land', label: 'Taking land',
    items: [
      ['Garrisons', 'Every province has its own defenders (see "Garrison" in the province panel). Your army must beat them first: the province panel and the army’s status show how much is left.'],
      ['Occupation', 'Once the garrison is beaten, a circle fills on the province: when it is full, the province is yours. Bigger armies take it faster.'],
      ['Moving on', 'An army cannot march past an enemy province without taking it first.'],
      ['Capitals', 'Capitals are strongly garrisoned. If yours falls, the government flees to another city and fights on.'],
      ['Surrender', 'A nation capitulates when it holds a quarter of its land or less, or 40% with enemy troops inside its capital. What it still holds goes to the winner.'],
      ['New land', 'A province you just took has no garrison of its own yet; it builds one up over time if no enemy is there.'],
    ],
  },
  {
    id: 'sea', label: 'Water & air',
    items: [
      ['Crossing water', 'Armies cross seas and straits along sea lanes (the routes the dashed line follows over water). It is slower than marching over land.'],
      ['Landings', 'Troops coming ashore in enemy land fight at a disadvantage for two days, so land where the enemy is weak.'],
      ['Air strikes (WW2, today)', 'Air units and drones can strike: select one, press "Air strike…" or "Drone strike…", then click a target inside the orange ring. Esc cancels. They then need time to rearm.'],
      ['What strikes do', 'A strike damages every enemy unit in the target province (and wears down its garrison). Use them before an attack, or to break an enemy offensive.'],
      ['Older eras', 'Before the 20th century there are no air units: wars are won on the ground.'],
    ],
  },
  {
    id: 'diplomacy', label: 'Diplomacy',
    items: [
      ['Talk', 'Press Diplomacy (D) or "Talk to …" on a country. Write anything; leaders answer in character and remember the conversation.'],
      ['Deals', 'Propose alliances, non-aggression pacts, ceasefires, peace, land swaps or joint wars. Nothing is agreed until the other side formally accepts the offer card.'],
      ['Relations', 'War, broken treaties and ultimatums are remembered for a long time. Friendly nations accept more; enemies may refuse even to talk.'],
      ['Declaring war', 'Use "Declare war" on a country, or just drag an army onto it: you will be asked to confirm. Breaking a treaty to do it angers the nation you betray.'],
      ['The advisor', 'Before big decisions your advisor estimates the odds and the risks. Choose how often in Settings → Gameplay.'],
    ],
  },
  {
    id: 'keys', label: 'Controls',
    items: [
      ['Mouse', 'Drag the map to pan, scroll to zoom. Click a province or counter to inspect it.'],
      ['Space', 'Pause / resume'],
      ['1 · 2 · 3', 'Game speed'],
      ['N', 'Skip to the next important event'],
      ['D', 'Diplomacy'],
      ['H or ?', 'This screen'],
      ['Esc', 'Cancel a strike, clear the selection, or open the menu'],
      ['Ctrl+S', 'Quick save'],
    ],
  },
];

/** "How to play": the rules in short, one tab per topic. */
export function openHowToPlay(start = 'start') {
  const panel = openPanel('How to play', { wide: true });
  const tabs = h('nav', { class: 'menu-tabs', role: 'tablist' });
  const content = h('div', { class: 'menu-tab-content howto' });
  fill(panel.body, tabs, content);
  let tab = start;
  const render = () => {
    fill(tabs, ...SECTIONS.map((sec) =>
      h('button', { class: sec.id === tab ? 'active' : '', role: 'tab', 'aria-selected': String(sec.id === tab), onclick: () => { tab = sec.id; render(); } }, sec.label)));
    const sec = SECTIONS.find((x) => x.id === tab) ?? SECTIONS[0];
    fill(content,
      sec.intro ? h('p', { class: 'howto-intro' }, sec.intro) : null,
      h('dl', { class: 'howto-list' }, ...sec.items.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
    );
    content.scrollTop = 0;
  };
  render();
  return panel.closed;
}
