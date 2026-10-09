/**
 * Release notes, newest first. The newest entry is shown once to every player after an update
 * (see ui/menus/whatsNew.ts); all of them are under "What's new" on the main menu. Each item says
 * what is new and how to use it.
 */
export interface Release {
  version: string;
  date: string;
  title: string;
  items: { title: string; how: string }[];
}

export const CHANGELOG: Release[] = [
  {
    version: '0.8.1',
    date: '2026-10-09',
    title: 'Fixes from your feedback',
    items: [
      { title: 'Honest odds', how: 'The chance of success before an attack now plays the battle out with the real rules: only the armies you order in count (not every army nearby), with the defenders’ home bonus, the garrison, landings from the sea and enemy help from next door. It also says how many days the province should take.' },
      { title: 'Why there is no route', how: 'When an army cannot get somewhere, the game now names the country in the way (or the stretch of sea enemy fleets control) and says what to do: ally with them, go around by sea, or declare war.' },
      { title: 'Barracks muster troops', how: 'Every barracks raises a basic unit for free once a month, up to your manpower. Capitals always have barracks (also after the government flees to a new one), and big cities start with them.' },
      { title: 'A bit faster', how: '1× is now 10 seconds a day in the modern eras (13 seconds a week in the ancient ones).' },
      { title: 'Multiplayer: your games', how: 'The Multiplayer screen lists every game you are in, with Rejoin. The host can start right away, and everyone chooses their nation on the map like a normal game.' },
      { title: 'Multiplayer: chat fixed', how: 'Messages from other players now show an unread badge and a notice, and reading a conversation no longer marks it read for the other player. Games no longer drift apart between phones and computers, and a player is never left frozen waiting for the host.' },
      { title: 'Sieges', how: 'An ally joining your siege no longer resets its progress.' },
    ],
  },
  {
    version: '0.8',
    date: '2026-10-09',
    title: 'Pandemic',
    items: [
      { title: 'A new era: Pandemic', how: 'New game → Pandemic. Today’s world, and a new virus breaks out. There are no wars: you win by keeping your people alive and finding a cure. Name your disease, pick how dangerous it is and where it starts when you choose your nation.' },
      { title: 'Fight it', how: 'Open the pandemic window with the ☣ counter at the top (or P): lockdowns, closing the borders, research funding, and help for other nations. Quarantine provinces and build hospitals and labs from a province’s panel. The Outbreak map shows where it is.' },
      { title: 'Race for a cure', how: 'Labs research the cure, much faster in research pacts (propose one in Diplomacy): even old rivals can work together. The trials need new resources, rare plant compounds, lab reagents and medicines, instead of oil and steel. Whoever finds the cure can share it.' },
      { title: 'Win or collapse', how: 'Come through with the cure and most of your people immune, or outlast the disease. If your hospitals stay overwhelmed for two weeks, your health system collapses. How to play has a new Pandemic page.' },
    ],
  },
  {
    version: '0.7.3',
    date: '2026-10-09',
    title: 'A little quicker',
    items: [
      { title: 'Game speed', how: 'Normal speed (1×) is now 12 seconds a day in the modern eras (16 seconds a week in the ancient ones), and 4× is back: the speeds are 1×, 2× and 4× (keys 1, 2, 3).' },
    ],
  },
  {
    version: '0.7.2',
    date: '2026-10-09',
    title: 'Building takes time, and you can see it',
    items: [
      { title: 'Work takes time', how: 'Buildings (10 to 30 days), developing a province (20 to 40 days) and training troops (about 12 days) now take time. Troops train fastest at the capital (60% of the time) and quicker in big cities, and come out at full strength. Troops in training count towards your manpower.' },
      { title: 'See it on the map', how: 'A ring fills around an icon on the province while the work goes on, with the days left. Zoom in to see everyone’s buildings: oil derricks, pickaxes for mines, wheat for farms, factories, barracks tents, airfields, fortresses and radar dishes, with what your own provinces make (“+4 oil”). Select a province to see them at any zoom.' },
      { title: 'In the province panel', how: '“Under way” lists what is being built or trained there, with a progress bar and the days left.' },
    ],
  },
  {
    version: '0.7.1',
    date: '2026-10-09',
    title: 'Your resources at a glance',
    items: [
      { title: 'Money and resources in the top bar', how: 'Click the money (◈) at the top: a list drops down with your money and every resource, how much you have and how much you gain or lose each month. A resource in red is one your army needs and is running out of. The button at the bottom opens the full Treasury and market (or press T).' },
    ],
  },
  {
    version: '0.7',
    date: '2026-10-09',
    title: 'Resources, the world market and weapons',
    items: [
      { title: 'Real resources, where they really were', how: 'Oil at Baku, Ploiești and Maracaibo; steel in the Ruhr and the Donbas; silver at Potosí; uranium in the Congo and Canada. Press M until the map shows Resources: every deposit has a marker, ringed white when it is being worked.' },
      { title: 'Mines, farms and factories', how: 'A province with a resource makes 1 a month. Select it and build its mine, oil wells, farm or factory to make 4 a month.' },
      { title: 'Troops cost materials', how: 'Tanks, artillery, aircraft, cavalry and legions need steel, oil, horses, iron… as well as money. The cost shows on each recruit button; the Treasury (T) shows your stockpiles.' },
      { title: 'The world market', how: 'Open the Treasury (T): buy what you lack and sell what you have. Prices rise when everyone buys and fall when everyone sells. A full storage (80) sells its surplus by itself at the end of the month.' },
      { title: 'Develop provinces', how: 'Select one of your provinces and press Develop (three levels, money and materials): more people and taxes, a stronger garrison, and better recruiting there.' },
      { title: 'Recruiting depends on the place', how: 'The capital trains troops best (70% strength, 15% cheaper), big cities well; small provinces raise only basic infantry until developed.' },
      { title: 'Missiles, nuclear weapons, air defence', how: 'In World War II (V-2 from mid-1944, the atomic bomb from 1945) and today: build them in the Treasury, fire them from an enemy province’s panel. Air defence, a building, shoots some down and blunts air strikes. A nuclear strike destroys everything in a province and turns the whole world against you.' },
      { title: 'Uranium', how: 'A new resource in World War II, today and the United States: nuclear weapons need it.' },
      { title: 'Trust', how: 'Break a treaty and your allies who think little of you (relations 50 or less) leave the alliance too. Ending a trade agreement is not a betrayal.' },
      { title: 'Slower, calmer clock', how: 'Normal speed is now 15 seconds per day in the modern eras (the ancient eras slowed down alike); the speeds are 1×, 2× and 3×.' },
      { title: 'Merging takes time in new land', how: 'Armies cannot merge in a province you have just taken (ten days, or four turns in the ancient eras).' },
      { title: 'The tutorial', how: 'It shows by itself only in your very first game. Replay it any time from How to play.' },
    ],
  },
  {
    version: '0.6',
    date: '2026-10-08',
    title: 'Multiplayer',
    items: [
      { title: 'Play online', how: 'Main menu → Multiplayer. Public rooms are listed for everyone (up to 16 players); private rooms are joined with their six-letter code or invite link.' },
      { title: 'Steady clock', how: 'Time runs for everyone at the room’s pace; only the host of a private room can pause.' },
      { title: 'Talk to players', how: 'Nations led by people are marked “Player” in Diplomacy: messages go straight to them.' },
    ],
  },
  {
    version: '0.5',
    date: '2026-10-08',
    title: 'Pangea',
    items: [{ title: 'A new era', how: 'Today’s nations on one supercontinent, fighting with spears, swords, bows and horses. New game → Pangea.' }],
  },
  {
    version: '0.4',
    date: '2026-10-08',
    title: 'Phones and tablets',
    items: [{ title: 'Play on your phone', how: 'Tap a counter, then where it should go; pinch to zoom; press and hold a counter to group it. Add the site to your home screen to play it like an app.' }],
  },
  {
    version: '0.3',
    date: '2026-10-08',
    title: 'The economy',
    items: [
      { title: 'Money and recruiting', how: 'Click the treasury (◈) for your budget. Armies are bought at barracks (aircraft at airfields) and cost upkeep every month.' },
      { title: 'Population', how: 'Sieges and battles kill civilians; populous provinces take longer to capture.' },
      { title: 'New game options', how: 'When you pick your nation: Simple or Detailed economy, and “Capital falls = nation falls”.' },
    ],
  },
];

export const LATEST_VERSION = CHANGELOG[0].version;
