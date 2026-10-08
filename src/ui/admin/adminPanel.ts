import { apiFetch, currentUser } from '../../auth/account';
import { mp } from '../../net/mpClient';
import { getScenario } from '../../data/scenarios';
import type { RoomInfo } from '../../../shared/multiplayer/protocol';
import { scenarios } from '../../data/scenarios';
import type { SaveMeta } from '../../game/saves';
import { consoleScreen } from '../console';
import { fill, h } from '../dom';
import { timeAgo } from '../menus/loadScreen';
import { formatPlaytime } from '../menus/profile';

interface AdminUser {
  id: string;
  email: string;
  username: string | null;
  name: string;
  avatar: string | null;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  lastSeen: number;
  admin: boolean;
  saves: number;
}

type Tab = 'pending' | 'approved' | 'rejected' | 'feedback' | 'errors' | 'stats' | 'games';

interface FeedbackItem { id: string; username: string | null; category: string; text: string; context: Record<string, unknown>; hasSave: boolean; status: 'new' | 'done'; createdAt: number }
interface ErrorItem { key: string; message: string; stack: string; context: Record<string, unknown>; count: number; firstAt: number; lastAt: number; lastUser: string | null }
interface StatsItem { playtimeS: number; games: number; victories: number; defeats: number; eras: Record<string, { games: number; playtimeS: number; victories: number }>; lastPlayed: number; lastEra: string | null }

const eraName = (id: string) => scenarios.find((s) => s.id === id)?.name ?? id;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

/**
 * Admin panel (?admin): let players into the beta, revoke access, and open anyone's saved games
 * read-only. Live multiplayer games will be listed under "Games" once they exist.
 */
export async function showAdminPanel(root: HTMLElement, actions: { menu(): void; spectate(user: string, save: string): void; spectateFeedback(id: string): void }) {
  if (!currentUser()?.admin) {
    root.replaceChildren(h('div', { class: 'loading' }, h('div', null, 'Admins only.', h('div', null, h('button', { class: 'btn', onclick: actions.menu }, 'Main menu')))));
    return;
  }
  let users: AdminUser[] = [];
  let feedback: FeedbackItem[] = [];
  let errors: ErrorItem[] = [];
  let stats: Record<string, StatsItem> = {};
  const openError = new Set<string>();
  let tab: Tab = 'pending';
  const open = new Set<string>(); // users whose saves are expanded
  const savesOf = new Map<string, SaveMeta[] | string>();
  const tabs = h('nav', { class: 'menu-tabs', role: 'tablist' });
  const list = h('div', { class: 'admin-list' });
  const status = h('p', { class: 'setting-hint', role: 'status' });

  const load = async () => {
    try {
      [users, feedback, errors, stats] = await Promise.all([
        api<AdminUser[]>('/api/admin/users'),
        api<FeedbackItem[]>('/api/admin/feedback').catch(() => []),
        api<ErrorItem[]>('/api/admin/errors').catch(() => []),
        api<Record<string, StatsItem>>('/api/admin/stats').catch(() => ({})),
      ]);
      status.textContent = '';
    } catch (e) {
      status.textContent = `Could not load accounts: ${(e as Error).message}`;
    }
    render();
  };

  const setStatus = async (u: AdminUser, next: AdminUser['status']) => {
    try {
      await api(`/api/admin/users/${encodeURIComponent(u.id)}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: next }) });
      await load();
      status.textContent = `${u.username ?? u.name} (${u.email}) is now ${next === 'approved' ? 'allowed to play' : next === 'rejected' ? 'blocked' : 'waiting'}.`;
    } catch (e) {
      status.textContent = (e as Error).message;
    }
  };

  const rename = async (u: AdminUser) => {
    const username = window.prompt(`New username for ${u.email}`, u.username ?? '')?.trim();
    if (!username || username === u.username) return;
    try {
      await api(`/api/admin/users/${encodeURIComponent(u.id)}/username`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username }) });
      await load();
      status.textContent = `Renamed to ${username}.`;
    } catch (e) {
      status.textContent = (e as Error).message;
    }
  };

  const toggleSaves = async (u: AdminUser) => {
    if (open.has(u.id)) { open.delete(u.id); return render(); }
    open.add(u.id);
    render();
    try {
      savesOf.set(u.id, await api<SaveMeta[]>(`/api/admin/users/${encodeURIComponent(u.id)}/saves`));
    } catch (e) {
      savesOf.set(u.id, (e as Error).message);
    }
    render();
  };

  const userRow = (u: AdminUser) => {
    const saves = savesOf.get(u.id);
    return h('div', { class: 'admin-row' },
      h('div', { class: 'admin-user' },
        u.avatar ? h('img', { class: 'avatar', src: u.avatar, alt: '', referrerpolicy: 'no-referrer' }) : h('span', { class: 'avatar' }, u.name.slice(0, 1).toUpperCase()),
        h('div', null,
          h('div', { class: 'save-name' }, u.username ?? h('span', { class: 'dim' }, '(no username yet)'), u.admin ? h('span', { class: 'chip' }, 'Admin') : null),
          h('div', { class: 'save-sub' }, `${u.name} · ${u.email}`),
          h('div', { class: 'save-sub dim' }, `Joined ${timeAgo(u.createdAt)} · last seen ${timeAgo(u.lastSeen)} · ${u.saves} save${u.saves === 1 ? '' : 's'}`
            + (stats[u.id] ? ` · played ${formatPlaytime(stats[u.id].playtimeS)} · ${stats[u.id].games} game${stats[u.id].games === 1 ? '' : 's'}${stats[u.id].lastEra ? `, last ${eraName(stats[u.id].lastEra!)}` : ''}` : '')),
        ),
      ),
      h('div', { class: 'save-actions' },
        u.status !== 'approved' ? h('button', { class: 'btn primary', onclick: () => void setStatus(u, 'approved') }, 'Let in') : null,
        u.status === 'pending' ? h('button', { class: 'btn danger', onclick: () => void setStatus(u, 'rejected') }, 'Decline') : null,
        u.status === 'approved' && !u.admin ? h('button', { class: 'btn danger', title: 'They can no longer play; their saves are kept', onclick: () => void setStatus(u, 'rejected') }, 'Block') : null,
        u.saves ? h('button', { class: 'btn', onclick: () => void toggleSaves(u) }, open.has(u.id) ? 'Hide saves' : 'Saves') : null,
        h('button', { class: 'btn', title: 'Change their username (e.g. if it is offensive)', onclick: () => void rename(u) }, 'Rename'),
      ),
      open.has(u.id) ? h('div', { class: 'admin-saves' },
        saves === undefined ? h('p', { class: 'dim' }, 'Loading…')
          : typeof saves === 'string' ? h('p', { class: 'danger-text' }, saves)
          : saves.length ? h('div', { class: 'save-list' }, ...saves.map((m) => saveRow(u, m)))
          : h('p', { class: 'dim' }, 'No saves.'),
      ) : null,
    );
  };

  const saveRow = (u: AdminUser, m: SaveMeta) => {
    const theme = scenarios.find((s) => s.id === m.scenarioId)?.theme ?? 'sepia';
    return h('div', { class: `save-row theme-${theme}` },
      h('div', { class: 'save-main' },
        h('div', { class: 'save-name' }, m.auto ? h('span', { class: 'chip' }, 'Autosave') : null, m.name),
        h('div', { class: 'save-sub' }, `${m.scenarioName} · ${m.nation ?? 'no nation chosen'} · ${m.gameDate}`),
        h('div', { class: 'save-sub dim' }, `Saved ${timeAgo(m.savedAt)}`),
      ),
      h('div', { class: 'save-actions' }, h('button', { class: 'btn', title: 'Open this game read-only', onclick: () => actions.spectate(u.id, m.id) }, 'Spectate')),
    );
  };

  const setFeedback = async (f: FeedbackItem, action: 'done' | 'new' | 'delete') => {
    try {
      if (action === 'delete') await api(`/api/admin/feedback/${f.id}`, { method: 'DELETE' });
      else await api(`/api/admin/feedback/${f.id}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: action }) });
      await load();
    } catch (e) { status.textContent = (e as Error).message; }
  };
  const feedbackRow = (f: FeedbackItem) => {
    const c = f.context;
    const where = [c.era, c.date, c.nation, c.difficulty].filter(Boolean).join(' · ');
    return h('div', { class: `admin-row feedback ${f.status}` },
      h('div', null,
        h('div', { class: 'save-name' }, h('span', { class: `chip cat-${f.category}` }, f.category), f.username ?? 'someone', h('span', { class: 'dim' }, ` · ${timeAgo(f.createdAt)}`)),
        h('p', { class: 'feedback-body' }, f.text),
        h('div', { class: 'save-sub dim' }, where || String(c.page ?? ''), c.screen ? ` · screen ${c.screen}` : ''),
      ),
      h('div', { class: 'save-actions' },
        f.hasSave ? h('button', { class: 'btn', title: 'Open the game they attached, read-only', onclick: () => actions.spectateFeedback(f.id) }, 'Spectate') : null,
        f.status === 'new' ? h('button', { class: 'btn primary', onclick: () => void setFeedback(f, 'done') }, 'Done') : h('button', { class: 'btn', onclick: () => void setFeedback(f, 'new') }, 'Reopen'),
        h('button', { class: 'btn danger', onclick: () => void setFeedback(f, 'delete') }, 'Delete'),
      ),
    );
  };
  const errorRow = (e: ErrorItem) => h('div', { class: 'admin-row' },
    h('div', null,
      h('div', { class: 'save-name' }, h('span', { class: 'chip' }, `×${e.count}`), e.message),
      h('div', { class: 'save-sub dim' }, `Last ${timeAgo(e.lastAt)}${e.lastUser ? ` (${e.lastUser})` : ''} · first ${timeAgo(e.firstAt)}${e.context.scenarioId ? ` · ${eraName(String(e.context.scenarioId))}` : ''}`),
      openError.has(e.key) ? h('pre', { class: 'error-stack' }, `${e.stack}\n\n${JSON.stringify(e.context, null, 2)}`) : null,
    ),
    h('div', { class: 'save-actions' },
      h('button', { class: 'btn', onclick: () => { if (!openError.delete(e.key)) openError.add(e.key); render(); } }, openError.has(e.key) ? 'Hide' : 'Details'),
      h('button', { class: 'btn primary', title: 'Fixed: remove it (it comes back if it happens again)', onclick: async () => { await api(`/api/admin/errors/${e.key}`, { method: 'DELETE' }).catch(() => undefined); await load(); } }, 'Fixed'),
    ),
  );
  const statsView = () => {
    const all = Object.values(stats);
    const total = (k: 'playtimeS' | 'games' | 'victories' | 'defeats') => all.reduce((x, s) => x + (s[k] ?? 0), 0);
    const eras = new Map<string, { games: number; playtimeS: number; victories: number; players: number }>();
    for (const s of all) for (const [id, e] of Object.entries(s.eras ?? {})) {
      const t = eras.get(id) ?? { games: 0, playtimeS: 0, victories: 0, players: 0 };
      eras.set(id, { games: t.games + e.games, playtimeS: t.playtimeS + e.playtimeS, victories: t.victories + e.victories, players: t.players + 1 });
    }
    const week = Date.now() - 7 * 86_400_000;
    const tiles: [string, string][] = [
      ['Players who played', String(all.filter((s) => s.games > 0).length)], ['Active this week', String(all.filter((s) => s.lastPlayed > week).length)],
      ['Time played', formatPlaytime(total('playtimeS'))], ['Games started', String(total('games'))], ['Victories', String(total('victories'))], ['Defeats', String(total('defeats'))],
    ];
    return [
      h('div', { class: 'stat-tiles' }, ...tiles.map(([k, v]) => h('div', { class: 'stat-tile' }, h('span', null, k), h('strong', null, v)))),
      h('table', { class: 'data-table' },
        h('thead', null, h('tr', null, h('th', null, 'Era'), h('th', null, 'Players'), h('th', null, 'Games'), h('th', null, 'Time'), h('th', null, 'Victories'))),
        h('tbody', null, ...[...eras].sort((a, b) => b[1].playtimeS - a[1].playtimeS).map(([id, e]) =>
          h('tr', null, h('td', null, eraName(id)), h('td', null, String(e.players)), h('td', null, String(e.games)), h('td', null, formatPlaytime(e.playtimeS)), h('td', null, String(e.victories)))))),
    ];
  };

  let liveCleanup: (() => void) | null = null;
  const render = () => {
    liveCleanup?.();
    liveCleanup = null;
    const count = (st: AdminUser['status']) => users.filter((u) => u.status === st).length;
    const fresh = feedback.filter((f) => f.status === 'new').length;
    const labels: [Tab, string][] = [
      ['pending', `Waiting (${count('pending')})`], ['approved', `Players (${count('approved')})`], ['rejected', `Blocked (${count('rejected')})`],
      ['feedback', `Feedback (${fresh})`], ['errors', `Errors (${errors.length})`], ['stats', 'Stats'], ['games', 'Live games'],
    ];
    fill(tabs, ...labels.map(([id, label]) => h('button', { class: id === tab ? 'active' : '', role: 'tab', 'aria-selected': String(id === tab), onclick: () => { tab = id; render(); } }, label)));
    if (tab === 'feedback') {
      const sorted = [...feedback].sort((a, b) => (a.status === b.status ? b.createdAt - a.createdAt : a.status === 'new' ? -1 : 1));
      fill(list, ...(sorted.length ? sorted.map(feedbackRow) : [h('p', { class: 'dim' }, 'No feedback yet. Testers send it with the ✎ button in a game or from the main menu.')]));
      return;
    }
    if (tab === 'errors') {
      fill(list, ...(errors.length ? errors.map(errorRow) : [h('p', { class: 'dim' }, 'No errors reported. Errors in players’ browsers show up here automatically.')]));
      return;
    }
    if (tab === 'stats') { fill(list, ...statsView()); return; }
    if (tab === 'games') {
      const client = mp();
      const show = (rooms: RoomInfo[]) => {
        if (tab !== 'games') return;
        fill(list, ...(rooms.length ? rooms.map((r) => h('div', { class: 'admin-row' },
          h('div', null,
            h('strong', null, r.name),
            h('div', { class: 'dim' }, `${getScenario(r.scenarioId)?.name ?? r.scenarioId} · ${r.visibility} · code ${r.code} · ${r.status}`),
            h('div', { class: 'dim' }, r.players.map((p) => `${p.connected ? '●' : '○'} ${p.username}${p.nation ? ` (${p.nation})` : ''}`).join('  ') || 'nobody')),
          r.status === 'lobby' ? h('span', { class: 'dim' }, 'Not started') : h('button', { class: 'btn', onclick: () => (location.search = `?watch=${encodeURIComponent(r.id)}`) }, 'Watch live'),
        )) : [h('p', { class: 'dim' }, 'No multiplayer games right now.')]));
      };
      fill(list, h('p', { class: 'dim' }, client.online ? 'Loading games…' : 'Connecting to the game server…'));
      const offRooms = client.on('rooms', show);
      const offStatus = client.on('status', (on) => { if (on) client.adminRooms(); });
      liveCleanup = () => { offRooms(); offStatus(); };
      client.adminRooms();
      return;
    }
    const shown = users.filter((u) => u.status === tab);
    const empty = { pending: 'Nobody is waiting. New sign-ins show up here.', approved: 'No players yet.', rejected: 'Nobody is blocked.' }[tab];
    fill(list, ...(shown.length ? shown.map(userRow) : [h('p', { class: 'dim' }, empty)]));
  };

  root.replaceChildren(consoleScreen({ page: 'admin', title: 'Warroom Beta — Admin', right: h('button', { class: 'cx-link', onclick: actions.menu }, '← Main menu') },
    h('main', { class: 'cx-page' },
      h('header', { class: 'cx-page-head row' },
        h('div', null,
          h('div', { class: 'cx-kicker' }, h('span', { class: 'cx-dot' }), 'Admin'),
          h('h1', null, 'Admin panel'),
          h('p', null, 'Let players in, read their feedback and error reports, see how the beta is played, and open any game read-only.')),
        h('button', { class: 'btn', title: 'Reload the list', onclick: () => void load() }, 'Refresh'),
      ),
      h('section', { class: 'cx-panel' }, tabs, status, list),
    ),
  ));
  await load();
  if (!users.some((u) => u.status === 'pending')) { tab = 'approved'; render(); }
}
