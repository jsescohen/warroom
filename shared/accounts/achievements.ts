/**
 * Achievements: names and descriptions shared by the game (which checks them, see
 * src/game/achievements.ts) and the server (which only stores ids from this list).
 */
export interface AchievementDef {
  id: string;
  name: string;
  description: string;
}

const ERAS: [string, string][] = [
  ['bronze', 'The Bronze Age'], ['rome-rise', 'Rise of Rome'], ['rome-fall', 'Fall of Rome'], ['renaissance', 'The Renaissance'],
  ['ww1', 'World War I'], ['ww2', 'World War II'], ['modern', 'The Modern World'], ['usa', 'Divided States'],
];

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-blood', name: 'First blood', description: 'Win a battle.' },
  { id: 'conqueror', name: 'Conqueror', description: 'Capture 10 provinces in one game.' },
  { id: 'warlord', name: 'Warlord', description: 'Capture 50 provinces in one game.' },
  { id: 'decapitation', name: 'Decapitation', description: 'Take an enemy capital.' },
  { id: 'surrender', name: 'Unconditional surrender', description: 'Make a nation capitulate.' },
  { id: 'blitz', name: 'Lightning war', description: 'Make a nation capitulate within 30 days of going to war with it.' },
  { id: 'admiral', name: 'Admiral', description: 'Sink an enemy fleet.' },
  { id: 'long-arm', name: 'Long arm', description: 'Launch an air or missile strike.' },
  { id: 'diplomat', name: 'Diplomat', description: 'Sign an alliance.' },
  { id: 'web', name: 'Web of alliances', description: 'Have three allies at the same time.' },
  { id: 'peacemaker', name: 'Peacemaker', description: 'Sign a peace treaty.' },
  { id: 'survivor', name: 'Survivor', description: 'Stay at war for a whole year and live.' },
  { id: 'underdog', name: 'Underdog', description: 'Win a game as a nation that is not a great power.' },
  { id: 'iron-will', name: 'Iron will', description: 'Win a game on Hard.' },
  ...ERAS.map(([id, name]) => ({ id: `win-${id}`, name: `Victor: ${name}`, description: `Win a game in ${name}.` })),
];

export const achievementById = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
