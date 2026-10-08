import { audio } from '../../audio/audio';
import { currentUser } from '../../auth/account';
import { getScenario, scenarios } from '../../data/scenarios';
import { mp } from '../../net/mpClient';
import { MAX_PLAYERS, type RoomInfo, type RoomSettings } from '../../../shared/multiplayer/protocol';
import { consoleScreen } from '../console';
import { fill, h } from '../dom';

export interface MultiplayerActions {
  menu(): void;
  /** The game starts (or is already running): open it. */
  enter(room: RoomInfo): void;
}

const ERA = (id: string) => getScenario(id)?.name ?? id;
const SPEED_LABEL: Record<number, string> = { 1: 'Normal pace', 2: 'Fast (2×)', 4: 'Very fast (4×)' };

/**
 * Multiplayer: public rooms anyone can join, private rooms joined with a code or an invite link
 * (?room=CODE), and the room itself (who leads which nation, the host starts the game).
 */
export function showMultiplayer(root: HTMLElement, actions: MultiplayerActions) {
  const client = mp();
  const body = h('div', { class: 'mp-body' });
  const status = h('div', { class: 'mp-status' });
  const error = h('p', { class: 'beta-error', role: 'alert' });
  let rooms: RoomInfo[] = [];
  let creating = false;
  let entered = false;
  const offs: (() => void)[] = [];

  root.replaceChildren(consoleScreen({ page: 'mp', title: 'Warroom Beta — Multiplayer', right: h('button', { class: 'cx-link', onclick: () => { cleanup(); actions.menu(); } }, '← Main menu') },
    h('main', { class: 'cx-page' },
      h('header', { class: 'cx-page-head' },
        h('div', { class: 'cx-kicker' }, h('span', { class: 'cx-dot' }), 'Online'),
        h('h1', null, 'Multiplayer'),
        h('p', null, 'Play against other people on the same map. The clock runs steadily; nations nobody picks are led by the AI.'),
        status,
      ),
      error,
      body,
    ),
  ));

  const cleanup = () => { offs.splice(0).forEach((f) => f()); clearInterval(poll); };
  const enter = (room: RoomInfo) => {
    if (entered) return;
    entered = true;
    cleanup();
    actions.enter(room);
  };
  const showError = (e: string) => { error.textContent = e; audio.play('error'); };

  // ---- the room I am in ----------------------------------------------------------------------
  const renderRoom = (room: RoomInfo) => {
    const sc = getScenario(room.scenarioId);
    const me = room.players.find((p) => p.userId === client.userId);
    const host = !!me?.host;
    const taken = new Map(room.players.filter((p) => p.nation && p.userId !== client.userId).map((p) => [p.nation!, p.username]));
    const nations = [...(sc?.nations ?? [])].sort((a, b) => Number(!!b.major) - Number(!!a.major) || (a.shortName ?? a.name).localeCompare(b.shortName ?? b.name));
    const pick = h('select', { class: 'mp-select', 'aria-label': 'Your nation' },
      h('option', { value: '' }, 'Choose your nation…'),
      ...nations.map((n) => h('option', { value: n.id, disabled: taken.has(n.id) },
        `${n.shortName ?? n.name}${n.major ? ' ★' : ''}${taken.has(n.id) ? ` — ${taken.get(n.id)}` : ''}`)),
    ) as HTMLSelectElement;
    pick.value = me?.nation ?? '';
    pick.disabled = room.status !== 'lobby' && !!me?.nation;
    pick.addEventListener('change', () => client.pick(pick.value || null));
    const invite = `${location.origin}/?room=${room.code}`;
    const copy = h('button', { class: 'btn', onclick: async () => {
      try { await navigator.clipboard.writeText(invite); copy.textContent = 'Copied!'; } catch { window.prompt('Copy this invite link', invite); }
    } }, 'Copy invite link');
    const running = room.status !== 'lobby';
    fill(body,
      h('section', { class: 'cx-card mp-room' },
        h('div', { class: 'mp-room-head' },
          h('div', null,
            h('div', { class: 'cx-kicker' }, `${room.visibility === 'public' ? 'Public' : 'Private'} room · ${ERA(room.scenarioId)}`),
            h('h2', null, room.name)),
          h('div', { class: 'mp-code', title: 'Friends join with this code' }, h('span', null, 'Code'), h('strong', null, room.code)),
        ),
        h('div', { class: 'mp-rules' },
          h('span', null, SPEED_LABEL[room.speed]), h('span', null, `AI: ${room.difficulty}`), h('span', null, `Economy: ${room.economy}`),
          room.capitalFalls ? h('span', null, 'Capital falls = nation falls') : null,
          h('span', null, `${room.players.length} / ${room.maxPlayers} players`),
          h('span', null, running ? (room.status === 'paused' ? 'Paused' : 'In progress') : 'Waiting to start')),
        h('ul', { class: 'mp-players' }, ...room.players.map((p) => h('li', null,
          h('i', { class: `mp-dot${p.connected ? ' on' : ''}`, title: p.connected ? 'Online' : 'Away' }),
          h('strong', null, p.username), p.host ? h('span', { class: 'chip' }, 'Host') : null,
          h('span', { class: 'dim' }, p.nation ? sc?.nations.find((n) => n.id === p.nation)?.shortName ?? sc?.nations.find((n) => n.id === p.nation)?.name ?? p.nation : 'choosing…')))),
        h('label', { class: 'mp-field' }, h('span', null, 'Your nation'), pick),
        h('div', { class: 'mp-actions' },
          !running && host ? h('button', { class: 'btn primary', disabled: !me?.nation, title: me?.nation ? 'Everyone in the room starts playing' : 'Choose your nation first', onclick: () => client.start() }, 'Start game') : null,
          !running && !host ? h('span', { class: 'dim' }, 'Waiting for the host to start the game…') : null,
          running ? h('button', { class: 'btn primary', disabled: !me?.nation, title: me?.nation ? '' : 'Choose your nation first', onclick: () => enter(room) }, 'Enter game') : null,
          copy,
          h('button', { class: 'btn', onclick: () => { client.leave(); } }, 'Leave room'),
        ),
        room.visibility === 'private' ? h('p', { class: 'dim small' }, 'Private: only people with the code or the invite link can join.') : null,
      ),
    );
  };

  // ---- rooms list and creating one -----------------------------------------------------------
  // built once and kept: the list refreshes on its own, so typing in the forms is never lost
  let lobby: HTMLElement | null = null;
  const listBox = h('div', { class: 'mp-list' });
  const formBox = h('div');
  const renderList = () => fill(listBox, rooms.length
      ? h('ul', { class: 'mp-rooms' }, ...rooms.map((r) => h('li', null,
          h('div', null, h('strong', null, r.name), h('span', { class: 'dim' }, `${ERA(r.scenarioId)} · ${SPEED_LABEL[r.speed]} · AI ${r.difficulty}`)),
          h('span', { class: 'mp-count' }, `${r.players.length}/${r.maxPlayers}`),
          h('span', { class: 'dim' }, r.status === 'lobby' ? 'Waiting' : 'In progress'),
          h('button', { class: 'btn', onclick: () => client.join(r.id) }, 'Join'))))
      : h('p', { class: 'empty' }, 'No public rooms right now. Create one!'));
  const renderLobby = () => {
    renderList();
    fill(formBox, creating ? createForm(currentUser()?.username ?? 'My') : null);
    if (lobby && lobby.parentElement === body) return;
    const code = h('input', { class: 'mp-input', placeholder: 'ABCDEF', maxlength: '6', 'aria-label': 'Room code' }) as HTMLInputElement;
    code.addEventListener('input', () => { code.value = code.value.toUpperCase().replace(/[^A-Z]/g, ''); });
    const joinCode = () => { if (code.value.length >= 6) client.join(code.value); };
    code.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinCode(); });
    lobby = h('div', { class: 'mp-grid' },
      h('section', { class: 'cx-card' },
        h('h2', null, 'Public rooms'),
        listBox,
        h('div', { class: 'mp-actions' },
          h('button', { class: 'btn primary', onclick: () => { creating = true; fill(formBox, createForm(currentUser()?.username ?? 'My')); formBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } }, 'Create a room'),
          h('button', { class: 'btn', onclick: () => client.list() }, 'Refresh')),
      ),
      h('section', { class: 'cx-card' },
        h('h2', null, 'Join with a code'),
        h('p', null, 'A friend made a private room? Enter its six-letter code, or open their invite link.'),
        h('div', { class: 'mp-actions' }, code, h('button', { class: 'btn primary', onclick: joinCode }, 'Join')),
        formBox,
      ),
    );
    fill(body, lobby);
  };

  const createForm = (username: string) => {
    const name = h('input', { class: 'mp-input wide', value: `${username}'s game`, maxlength: '40', 'aria-label': 'Room name' }) as HTMLInputElement;
    const sel = (label: string, opts: [string, string][], value: string) => {
      const s = h('select', { class: 'mp-select', 'aria-label': label }, ...opts.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
      s.value = value;
      return { el: h('label', { class: 'mp-field' }, h('span', null, label), s), get: () => s.value };
    };
    const era = sel('Era', scenarios.map((s) => [s.id, s.name]), 'ww2');
    const vis = sel('Who can join', [['public', 'Anyone (public)'], ['private', 'Friends with the code (private)']], 'public');
    const max = sel('Players', Array.from({ length: MAX_PLAYERS - 1 }, (_, i) => [String(i + 2), `Up to ${i + 2}`]), '6');
    const speed = sel('Pace', [['1', SPEED_LABEL[1]], ['2', SPEED_LABEL[2]], ['4', SPEED_LABEL[4]]], '1');
    const diff = sel('AI nations', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']], 'normal');
    const econ = sel('Economy', [['simple', 'Simple'], ['detailed', 'Detailed']], 'simple');
    const cap = h('input', { type: 'checkbox' }) as HTMLInputElement;
    return h('div', { class: 'mp-create' },
      h('h3', null, 'New room'),
      h('label', { class: 'mp-field' }, h('span', null, 'Name'), name),
      era.el, vis.el, max.el, speed.el, diff.el, econ.el,
      h('label', { class: 'mp-field check' }, cap, h('span', null, 'Capital falls = nation falls')),
      h('div', { class: 'mp-actions' },
        h('button', { class: 'btn primary', onclick: () => {
          const settings: RoomSettings = {
            name: name.value.trim() || `${username}'s game`, scenarioId: era.get(), visibility: vis.get() as RoomSettings['visibility'],
            maxPlayers: Number(max.get()), speed: Number(speed.get()) as RoomSettings['speed'], difficulty: diff.get() as RoomSettings['difficulty'],
            economy: econ.get() as RoomSettings['economy'], capitalFalls: cap.checked,
          };
          creating = false;
          client.create(settings);
        } }, 'Create room'),
        h('button', { class: 'btn', onclick: () => { creating = false; fill(formBox); } }, 'Cancel')),
    );
  };

  const render = () => {
    status.textContent = client.online ? '● Connected' : 'Connecting to the server…';
    status.classList.toggle('on', client.online);
    if (client.room) { lobby = null; creating = false; renderRoom(client.room); }
    else renderLobby();
  };

  offs.push(client.on('status', () => {
    status.textContent = client.online ? '● Connected' : 'Connecting to the server…';
    status.classList.toggle('on', client.online);
    if (client.online && !client.room) client.list();
  }));
  offs.push(client.on('rooms', (r) => { rooms = r; if (!client.room) renderList(); }));
  offs.push(client.on('room', () => { error.textContent = ''; render(); }));
  offs.push(client.on('error', showError));
  offs.push(client.on('begin', (room) => { if (room.players.some((p) => p.userId === client.userId && p.nation)) enter(room); }));
  const poll = window.setInterval(() => { if (client.online && !client.room) client.list(); }, 6000);

  // an invite link: ?room=CODE
  const invited = new URLSearchParams(location.search).get('room');
  if (invited && client.room?.code !== invited) client.join(invited);
  if (client.online) client.list();
  render();
}
