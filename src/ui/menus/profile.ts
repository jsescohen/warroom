import { ACHIEVEMENTS } from '../../../shared/accounts/achievements';
import { USERNAME_RULES } from '../../../shared/accounts/username';
import { apiFetch, cloudSaves, currentUser, signOut } from '../../auth/account';
import { scenarios } from '../../data/scenarios';
import { localAchievements } from '../../game/achievements';
import { usernameForm } from '../accessGate';
import { fill, h } from '../dom';
import { openPanel } from './shell';

interface Stats {
  playtimeS: number; games: number; victories: number; defeats: number;
  eras: Record<string, { games: number; playtimeS: number; victories: number }>;
  nations: Record<string, number>; lastPlayed: number;
}

export const formatPlaytime = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(s < 36000 ? 1 : 0)} h`);
const eraName = (id: string) => scenarios.find((s) => s.id === id)?.name ?? id;

type Tab = 'stats' | 'achievements' | 'account';

/** The player's own page: play statistics, achievements, and account settings (username). */
export async function openProfile(start: Tab = 'stats') {
  const me = currentUser();
  const panel = openPanel(me?.username ?? 'Profile', { wide: true, eyebrow: 'Profile' });
  const tabs = h('nav', { class: 'menu-tabs', role: 'tablist' });
  const content = h('div', { class: 'menu-tab-content' });
  fill(panel.body, tabs, content);

  let stats: Stats | null = null;
  let unlocked: Record<string, number> = localAchievements();
  if (cloudSaves()) {
    try {
      const r = await apiFetch('/api/me/profile');
      if (r.ok) {
        const p = await r.json();
        stats = p.stats;
        unlocked = { ...unlocked, ...p.achievements };
      }
    } catch { /* offline: show what this browser knows */ }
  }

  let tab: Tab = start;
  const render = () => {
    const labels: [Tab, string][] = [['stats', 'Stats'], ['achievements', `Achievements ${Object.keys(unlocked).length}/${ACHIEVEMENTS.length}`], ['account', 'Account']];
    fill(tabs, ...labels.map(([id, label]) => h('button', { class: id === tab ? 'active' : '', role: 'tab', onclick: () => { tab = id; render(); } }, label)));
    if (tab === 'stats') {
      if (!stats) return fill(content, h('p', { class: 'dim' }, cloudSaves() ? 'No games recorded yet: start one!' : 'Sign in to keep statistics on your account.'));
      const s = stats;
      const favourite = Object.entries(s.nations).sort((a, b) => b[1] - a[1])[0];
      const tiles: [string, string][] = [
        ['Time played', formatPlaytime(s.playtimeS)], ['Games', String(s.games)], ['Victories', String(s.victories)], ['Defeats', String(s.defeats)],
        ['Favourite nation', favourite ? `${favourite[0]} (${favourite[1]})` : '—'],
      ];
      const eras = Object.entries(s.eras).sort((a, b) => b[1].playtimeS - a[1].playtimeS);
      return fill(content,
        h('div', { class: 'stat-tiles' }, ...tiles.map(([k, v]) => h('div', { class: 'stat-tile' }, h('span', null, k), h('strong', null, v)))),
        eras.length ? h('table', { class: 'data-table' },
          h('thead', null, h('tr', null, h('th', null, 'Era'), h('th', null, 'Games'), h('th', null, 'Time'), h('th', null, 'Victories'))),
          h('tbody', null, ...eras.map(([id, e]) => h('tr', null, h('td', null, eraName(id)), h('td', null, String(e.games)), h('td', null, formatPlaytime(e.playtimeS)), h('td', null, String(e.victories)))))) : null,
      );
    }
    if (tab === 'achievements') {
      return fill(content, h('div', { class: 'ach-grid' }, ...ACHIEVEMENTS.map((a) => {
        const at = unlocked[a.id];
        return h('div', { class: `ach${at ? ' got' : ''}` },
          h('span', { class: 'ach-mark', 'aria-hidden': 'true' }, at ? '★' : '☆'),
          h('div', null, h('strong', null, a.name), h('span', null, a.description), at ? h('em', null, new Date(at).toLocaleDateString()) : null));
      })));
    }
    // account
    if (!me) return fill(content, h('p', { class: 'dim' }, 'You are not signed in.'));
    const { form, done } = usernameForm(me.username ?? '', 'Save username');
    void done.then(() => location.reload());
    fill(content,
      h('dl', { class: 'kv' }, h('dt', null, 'Username'), h('dd', null, me.username ?? '—'), h('dt', null, 'Signed in as'), h('dd', null, me.email), h('dt', null, 'Role'), h('dd', null, me.admin ? 'Admin' : 'Player'), h('dt', null, 'Saves'), h('dd', null, cloudSaves() ? 'In your account (any device)' : 'In this browser')),
      h('div', { class: 'setting-title', style: 'margin-top:12px' }, 'Change username'),
      h('p', { class: 'setting-hint' }, `Other players see this name (${USERNAME_RULES}).`),
      form,
      h('div', { class: 'setting-actions' }, h('button', { class: 'btn danger', onclick: () => void signOut() }, 'Sign out')),
    );
  };
  render();
  return panel.closed;
}
