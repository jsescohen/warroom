import './ui/styles.css';
import { audio } from './audio/audio';
import type { ScenarioDef } from './core/scenario';
import { createInitialState } from './core/state';
import { GameStore } from './core/store';
import type { GameState } from './core/types';
import { getScenario, scenarios } from './data/scenarios';
import { GameLoop } from './game/loop';
import { apiFetch } from './auth/account';
import { getSave, validateSave, type SaveRecord } from './game/saves';
import { GameSession } from './game/session';
import { applyProvinceNames, buildWorldFromMap, loadMap, provinceMeta } from './map/mapData';
import { MapRenderer } from './map/MapRenderer';
import { h } from './ui/dom';
import { EndScreen } from './ui/endScreen';
import { showEraSelect } from './ui/eraSelect';
import { Hud } from './ui/hud';
import { showAdminPanel } from './ui/admin/adminPanel';
import { showMainMenu } from './ui/menus/mainMenu';
import { NationPicker } from './ui/nationPicker';
import { ensureAccess } from './ui/accessGate';
import { applyDisplaySettings, onSettingsChange } from './ui/settings';
import { applyTheme, getTheme, themeFontsReady } from './ui/themes';

/**
 * Screens are addressed by URL so every transition is a clean page load:
 *   /            main menu
 *   ?new         era selection
 *   ?era=<id>    new game in that era
 *   ?load=<id>   continue a saved game
 *   ?admin       admin panel (admins only)
 *   ?spectate=<save>&user=<id>   open a player's save read-only (admins only)
 */
const go = {
  menu: () => (location.href = location.pathname),
  newGame: () => (location.search = '?new'),
  era: (id: string) => (location.search = `?era=${encodeURIComponent(id)}`),
  load: (id: string) => (location.search = `?load=${encodeURIComponent(id)}`),
  admin: () => (location.search = '?admin'),
  spectate: (user: string, save: string) => (location.search = `?spectate=${encodeURIComponent(save)}&user=${encodeURIComponent(user)}`),
};

async function boot() {
  applyDisplaySettings();
  onSettingsChange((s) => applyDisplaySettings(s));
  if (import.meta.env.DEV) Object.assign(window, { audio });
  const root = document.getElementById('app')!;
  // closed beta: nothing else loads until this browser has entered a tester code
  await ensureAccess(root);
  const q = new URLSearchParams(location.search);

  // a click anywhere on a button gives soft UI feedback (if enabled)
  document.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button')) audio.play('click');
  });

  if (q.has('load')) return loadGame(root, q.get('load')!);
  if (q.has('spectate')) return spectate(root, q.get('user') ?? '', q.get('spectate')!);
  if (q.has('admin')) return showAdminPanel(root, { menu: go.menu, spectate: go.spectate });
  const scenario = getScenario(q.get('era') ?? '');
  if (scenario) return startGame(root, scenario, null, null);
  if (q.has('new')) return showEraSelect(root, (sc) => go.era(sc.id), go.menu);
  return showMainMenu(root, { newGame: go.newGame, load: go.load, admin: go.admin });
}

async function loadGame(root: HTMLElement, id: string) {
  const fail = (msg: string) =>
    root.replaceChildren(h('div', { class: 'loading' }, h('div', null, msg, h('div', null, h('button', { class: 'btn', onclick: go.menu }, 'Main menu')))));
  let rec;
  try {
    rec = await getSave(id);
  } catch (e) {
    return fail(`Could not open saves: ${(e as Error).message}`);
  }
  if (!rec) return fail('That save no longer exists.');
  const err = validateSave(rec, scenarios.map((s) => s.id));
  if (err) return fail(err);
  return startGame(root, getScenario(rec.scenarioId)!, rec.state, rec.id);
}

/** Admins: open a player's saved game read-only. Time can run; nothing is saved or ordered. */
async function spectate(root: HTMLElement, user: string, id: string) {
  const fail = (msg: string) =>
    root.replaceChildren(h('div', { class: 'loading' }, h('div', null, msg, h('div', null, h('button', { class: 'btn', onclick: go.admin }, 'Admin panel')))));
  const res = await apiFetch(`/api/admin/users/${encodeURIComponent(user)}/saves/${encodeURIComponent(id)}`);
  if (!res.ok) return fail((await res.json().catch(() => null))?.error ?? `Could not open that save (HTTP ${res.status}).`);
  const rec = (await res.json()) as SaveRecord;
  const err = validateSave(rec, scenarios.map((s) => s.id));
  if (err) return fail(err);
  return startGame(root, getScenario(rec.scenarioId)!, rec.state, null, true);
}

async function startGame(root: HTMLElement, scenario: ScenarioDef, saved: GameState | null, saveId: string | null, readOnly = false) {
  const theme = getTheme(scenario.theme);
  applyTheme(theme);
  audio.setTheme(scenario.theme);
  document.title = `${scenario.name} — Warroom Beta`;

  const stage = h('div', { class: 'map-stage' });
  const loading = h('div', { class: 'loading era-loading' },
    h('div', null, h('div', { class: 'eyebrow' }, saved ? 'Loading saved game' : 'New game'), h('h2', null, scenario.name), h('p', { class: 'dim' }, scenario.subtitle)));
  root.append(stage, loading);

  // Labels are rasterised by Pixi, so make sure the era's web fonts are ready first.
  const [rawMap] = await Promise.all([loadMap(scenario.map), themeFontsReady(theme)]);
  const map = applyProvinceNames(rawMap, scenario.provinceNames);
  const world = buildWorldFromMap(map, scenario.unitTypes);

  if (saved && Object.keys(saved.provinces).some((id) => !map.byId.has(id))) {
    loading.replaceChildren(h('div', null, 'This save was made with a different version of the map and cannot be loaded.', h('div', null, h('button', { class: 'btn', onclick: go.menu }, 'Main menu'))));
    return;
  }
  const state = saved ?? createInitialState(scenario, map.id, map.provinces.map((p) => ({ ...provinceMeta(p), pop: p.pop })), world);
  const store = new GameStore(state, world);
  store.readOnly = readOnly;

  const renderer = await MapRenderer.create(stage, map, theme, world);
  renderer.setState(store.state);
  store.subscribe((s) => renderer.setState(s));

  const loop = new GameLoop(store, scenario.time);
  let hud: Hud | null = null;
  const session = new GameSession(store, scenario, saveId, (text) => hud?.notify(text));
  hud = new Hud(root, store, map, scenario, renderer, loop, session, go.load);
  if (!store.state.playerNation) root.append(new NationPicker(store, scenario, renderer).el);
  new EndScreen(store, () => void session.quitToMenu(), go.newGame);
  loading.remove();

  // Open on the player's capital, or the first great power's.
  const focusNation = store.state.playerNation ?? scenario.nations.find((n) => n.major && store.state.nations[n.id]?.capital)?.id;
  const cap = focusNation ? map.byId.get(store.state.nations[focusNation]?.capital ?? '') : null;
  if (cap) renderer.camera.flyTo(cap.label[0], cap.label[1] + 30, scenario.id === 'usa' ? 1.2 : 2.2);

  if (import.meta.env.DEV) Object.assign(window, { store, renderer, map, loop, world, session });
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('app')!.append(h('div', { class: 'loading' }, `Failed to start: ${(e as Error).message}`));
});
