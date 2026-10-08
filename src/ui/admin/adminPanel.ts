import { apiFetch, currentUser } from '../../auth/account';
import { scenarios } from '../../data/scenarios';
import type { SaveMeta } from '../../game/saves';
import { fill, h } from '../dom';
import { timeAgo } from '../menus/loadScreen';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  lastSeen: number;
  admin: boolean;
  saves: number;
}

type Tab = 'pending' | 'approved' | 'rejected' | 'games';

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
export async function showAdminPanel(root: HTMLElement, actions: { menu(): void; spectate(user: string, save: string): void }) {
  document.documentElement.dataset.theme = 'sepia';
  document.title = 'Warroom Beta — Admin';
  if (!currentUser()?.admin) {
    root.replaceChildren(h('div', { class: 'loading' }, h('div', null, 'Admins only.', h('div', null, h('button', { class: 'btn', onclick: actions.menu }, 'Main menu')))));
    return;
  }
  let users: AdminUser[] = [];
  let tab: Tab = 'pending';
  const open = new Set<string>(); // users whose saves are expanded
  const savesOf = new Map<string, SaveMeta[] | string>();
  const tabs = h('nav', { class: 'menu-tabs', role: 'tablist' });
  const list = h('div', { class: 'admin-list' });
  const status = h('p', { class: 'setting-hint', role: 'status' });

  const load = async () => {
    try {
      users = await api<AdminUser[]>('/api/admin/users');
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
      status.textContent = `${u.name} (${u.email}) is now ${next === 'approved' ? 'allowed to play' : next === 'rejected' ? 'blocked' : 'waiting'}.`;
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
          h('div', { class: 'save-name' }, u.name, u.admin ? h('span', { class: 'chip' }, 'Admin') : null),
          h('div', { class: 'save-sub' }, u.email),
          h('div', { class: 'save-sub dim' }, `Joined ${timeAgo(u.createdAt)} · last seen ${timeAgo(u.lastSeen)} · ${u.saves} save${u.saves === 1 ? '' : 's'}`),
        ),
      ),
      h('div', { class: 'save-actions' },
        u.status !== 'approved' ? h('button', { class: 'btn primary', onclick: () => void setStatus(u, 'approved') }, 'Let in') : null,
        u.status === 'pending' ? h('button', { class: 'btn danger', onclick: () => void setStatus(u, 'rejected') }, 'Decline') : null,
        u.status === 'approved' && !u.admin ? h('button', { class: 'btn danger', title: 'They can no longer play; their saves are kept', onclick: () => void setStatus(u, 'rejected') }, 'Block') : null,
        u.saves ? h('button', { class: 'btn', onclick: () => void toggleSaves(u) }, open.has(u.id) ? 'Hide saves' : 'Saves') : null,
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

  const render = () => {
    const count = (st: AdminUser['status']) => users.filter((u) => u.status === st).length;
    const labels: [Tab, string][] = [
      ['pending', `Waiting (${count('pending')})`], ['approved', `Players (${count('approved')})`], ['rejected', `Blocked (${count('rejected')})`], ['games', 'Live games'],
    ];
    fill(tabs, ...labels.map(([id, label]) => h('button', { class: id === tab ? 'active' : '', role: 'tab', 'aria-selected': String(id === tab), onclick: () => { tab = id; render(); } }, label)));
    if (tab === 'games') {
      fill(list, h('p', { class: 'dim' }, 'Live multiplayer games will appear here, ready to spectate, once multiplayer is added. For now you can open any player’s saved games from the Players tab.'));
      return;
    }
    const shown = users.filter((u) => u.status === tab);
    const empty = { pending: 'Nobody is waiting. New sign-ins show up here.', approved: 'No players yet.', rejected: 'Nobody is blocked.' }[tab];
    fill(list, ...(shown.length ? shown.map(userRow) : [h('p', { class: 'dim' }, empty)]));
  };

  root.replaceChildren(h('div', { class: 'admin-screen' },
    h('header', { class: 'admin-head' },
      h('button', { class: 'btn', onclick: actions.menu }, '← Main menu'),
      h('div', null, h('div', { class: 'eyebrow' }, 'Warroom Beta'), h('h1', null, 'Admin panel')),
      h('button', { class: 'btn', title: 'Reload the list', onclick: () => void load() }, 'Refresh'),
    ),
    h('section', { class: 'panel admin-body' }, tabs, status, list),
  ));
  await load();
  if (!users.some((u) => u.status === 'pending')) { tab = 'approved'; render(); }
}
