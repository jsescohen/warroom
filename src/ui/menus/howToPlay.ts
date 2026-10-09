import { fill, h } from '../dom';
import { openPanel } from './shell';
import { updateSettings } from '../settings';

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
      ['New armies', 'Armies are bought: select one of your provinces with barracks (or an airfield, for aircraft) and recruit. New troops start at 40% strength and train up. See the Economy tab.'],
      ['Split & merge', 'Split an army in two halves to cover more ground; merge idle armies of the same type standing together.'],
    ],
  },
  {
    id: 'land', label: 'Taking land',
    items: [
      ['Garrisons', 'Every province has its own defenders (see "Garrison" in the province panel). Your army must beat them first: the province panel and the army’s status show how much is left.'],
      ['Occupation', 'Once the garrison is beaten, a circle fills on the province: when it is full, the province is yours. Bigger armies take it faster.'],
      ['Moving on', 'An army cannot march past an enemy province without taking it first.'],
      ['Merging', 'Armies cannot merge in a province you have just taken: the new land needs ten days (four turns in the ancient eras) to organise.'],
      ['Capitals', 'Capitals are strongly garrisoned. If yours falls, the government flees to another city and fights on, unless the game was started with "Capital falls = nation falls": then the whole nation surrenders.'],
      ['Population', 'Big cities take longer to occupy than empty land. Sieges, battles and strikes kill civilians; a province that loses people earns less and slowly recovers in peacetime.'],
      ['Surrender', 'A nation capitulates when it holds a quarter of its land or less, or 40% with enemy troops inside its capital. What it still holds goes to the winner.'],
      ['New land', 'A province you just took has no garrison of its own yet; it builds one up over time if no enemy is there.'],
    ],
  },
  {
    id: 'economy', label: 'Economy',
    intro: 'Your land and people earn money every month; armies cost money and materials to raise, and money to keep. Click the treasury (◈) in the top bar, or press T, for your budget, stockpiles and the world market.',
    items: [
      ['Income', 'Paid at the start of each month: taxes from your land and people. Developed and populous provinces pay more; distant colonies less.'],
      ['Upkeep', 'Every army costs money each month, stronger units more. If the treasury runs dry, unpaid troops desert.'],
      ['Recruiting', 'Select a province with barracks (an airfield for aircraft) and pick a unit. The capital trains best (troops start at 70% strength, 15% cheaper), big cities well, towns at 40%; small provinces raise only basic troops until developed.'],
      ['Materials', 'Most units cost materials too: steel, oil and rubber for tanks, horses for cavalry, iron for legions… Basic infantry only needs food. The cost shows on each recruit button.'],
      ['Resources', 'Some provinces hold a resource, where it really was found (Resources map mode, M). By itself a province makes 1 a month; build its mine, oil wells, farm or factory to make 4.'],
      ['Stockpiles', 'Each resource is stored up to 80. What you make beyond that is sold on the world market at the end of the month.'],
      ['World market', 'Treasury → buy what you lack, sell what you have. Prices go up as everyone buys and down as they sell, then drift back. Selling pays 80% of the price.'],
      ['Trade agreements', 'In Diplomacy: another nation supplies a resource (3 a month), for money or a resource in return. They end if you go to war with each other.'],
      ['Developing land', 'Select a province and press Develop: three levels, each costing money and materials. More people and taxes, a stronger garrison, and better recruiting.'],
      ['Buildings', 'Barracks and airfields recruit; a fortress makes the garrison half as strong again; mines, farms and factories work resources; air defence protects against missiles and air strikes.'],
      ['Detailed economy', 'Chosen with your nation. Armies also use up their resources every month; run out, and those units fight at three quarters strength and cannot refit.'],
      ['The AI', 'Computer nations play by the same rules: they pay for every army, work their mines, trade, use the market and build weapons.'],
    ],
  },
  {
    id: 'weapons', label: 'Weapons',
    intro: 'In World War II (V-2 rockets from mid-1944, the atomic bomb from 1945) and in the present day.',
    items: [
      ['Building them', 'Treasury → Weapons: missiles and nuclear weapons cost money and materials (nuclear weapons need uranium, and take two months between each).'],
      ['Firing', 'Select an enemy province within range and press Launch. A missile damages every enemy unit there and its garrison.'],
      ['Nuclear weapons', 'Destroy every army in the province, kill most of its people, and poison it for a year: it makes and recruits nothing. Every nation in the world turns against whoever uses one.'],
      ['Air defence', 'A building (flak, Iron Dome, SAM). It covers its province and the land around it: it shoots down many missiles, a few nuclear weapons, and blunts air and drone strikes.'],
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
      ['Deals', 'Propose alliances, non-aggression pacts, ceasefires, peace, land swaps, joint wars or trade agreements. Nothing is agreed until the other side formally accepts the offer card.'],
      ['Trust', 'Break a treaty and your allies who think little of you (relations 50 or less) leave the alliance too. Ending a trade agreement is not a betrayal.'],
      ['Relations', 'War, broken treaties and ultimatums are remembered for a long time. Friendly nations accept more; enemies may refuse even to talk.'],
      ['Declaring war', 'Use "Declare war" on a country, or just drag an army onto it: you will be asked to confirm. Breaking a treaty to do it angers the nation you betray.'],
      ['The advisor', 'Before big decisions your advisor estimates the odds and the risks. Choose how often in Settings → Gameplay.'],
    ],
  },
  {
    id: 'online', label: 'Multiplayer',
    intro: 'Play against other people on the same map: Multiplayer on the main menu. Every nation nobody picks is led by the AI, as usual.',
    items: [
      ['Public rooms', 'Anyone signed in can see them and join, up to the room’s player limit (2 to 16). You can join a game that has already started.'],
      ['Private rooms', 'Only people with the six-letter code or the invite link can join. Use them to play with friends.'],
      ['Starting', 'Everyone picks a different nation in the room; the host starts the game.'],
      ['The clock', 'Time runs steadily for everyone at the room’s pace: there is no pausing or skipping, except that the host of a private room can pause for all.'],
      ['Other players', 'Nations led by people are marked “Player” in Diplomacy. Messages to them go straight to that person, and they answer your offers themselves.'],
      ['Leaving', 'Close the tab or go to the menu whenever you like: your nation waits for you, and you rejoin from Multiplayer. Leave the room to hand your nation back to the AI.'],
      ['Saving', 'Online games are kept on the server, not in your saves. A game nobody has played for two days ends.'],
    ],
  },
  {
    id: 'keys', label: 'Controls',
    items: [
      ['Mouse', 'Drag the map to pan, scroll to zoom. Click a province or counter to inspect it.'],
      ['Touch', 'Drag to pan, pinch to zoom. Tap a counter, then tap where it should go (or drag the counter there). Press and hold a counter to add it to a group. The ☰ button holds settings, help and saves.'],
      ['Space', 'Pause / resume'],
      ['1 · 2 · 3', 'Game speed (1× is 15 seconds a day in the modern eras)'],
      ['N', 'Skip to the next important event'],
      ['D', 'Diplomacy'],
      ['T', 'Treasury'],
      ['L', 'Ledger'],
      ['M', 'Next map mode (nations, relations, alliances, resources)'],
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
      sec.id === 'start' ? h('div', { class: 'howto-replay' },
        h('button', { class: 'btn', onclick: (e: Event) => { updateSettings({ tutorialDone: false }); (e.target as HTMLButtonElement).textContent = 'The tutorial will start in your next new game'; } }, 'Replay the tutorial'),
        h('span', { class: 'dim small' }, 'It shows by itself only in your very first game.')) : null,
    );
    content.scrollTop = 0;
  };
  render();
  return panel.closed;
}
