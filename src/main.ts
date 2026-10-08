import './ui/styles.css';
import './ui/console.css';
import { audio } from './audio/audio';
import type { ScenarioDef } from './core/scenario';
import { createInitialState } from './core/state';
import { initEconomy } from './core/economy';
import { GameStore } from './core/store';
import type { GameState } from './core/types';
import { getScenario, scenarios } from './data/scenarios';
import { GameLoop } from './game/loop';
import { apiFetch } from './auth/account';
import { getSave, validateSave, type SaveRecord } from './game/saves';
import { AchievementTracker } from './game/achievements';
import { installErrorReports, reportError, setErrorContext } from './game/errorReports';
import { trackPlayStats } from './game/playStats';
import { GameSession } from './game/session';
import { formatDate } from './core/time';
import { applyProvinceNames, buildWorldFromMap, loadMap, provinceMeta, type MapData } from './map/mapData';
import { resourcesOf } from './data/resources';
import type { World } from './core/world';
import { MapRenderer } from './map/MapRenderer';
import { h } from './ui/dom';
import { EndScreen } from './ui/endScreen';
import { showEraSelect } from './ui/eraSelect';
import { Hud } from './ui/hud';
import { showAdminPanel } from './ui/admin/adminPanel';
import { showMainMenu } from './ui/menus/mainMenu';
import { NationPicker } from './ui/nationPicker';
import { ensureAccess } from './ui/accessGate';
import { applyDisplaySettings, getSettings, onSettingsChange } from './ui/settings';
import { Tutorial } from './ui/tutorial';
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
  installErrorReports();
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
  if (q.has('feedback')) return spectate(root, null, q.get('feedback')!);
  if (q.has('admin')) return showAdminPanel(root, { menu: go.menu, spectate: go.spectate, spectateFeedback: (id) => (location.search = `?feedback=${encodeURIComponent(id)}`) });
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
async function spectate(root: HTMLElement, user: string | null, id: string) {
  const fail = (msg: string) =>
    root.replaceChildren(h('div', { class: 'loading' }, h('div', null, msg, h('div', null, h('button', { class: 'btn', onclick: go.admin }, 'Admin panel')))));
  // a player's save, or the game a tester attached to their feedback
  const res = await apiFetch(user === null ? `/api/admin/feedback/${encodeURIComponent(id)}/save` : `/api/admin/users/${encodeURIComponent(user)}/saves/${encodeURIComponent(id)}`);
  if (!res.ok) return fail((await res.json().catch(() => null))?.error ?? `Could not open that save (HTTP ${res.status}).`);
  const rec = (await res.json()) as SaveRecord;
  const err = validateSave(rec, scenarios.map((s) => s.id));
  if (err) return fail(err);
  return startGame(root, getScenario(rec.scenarioId)!, rec.state, null, true);
}

/** Older map versions kept in public/maps/<version>/ so games saved on them still load (newest first). */
const LEGACY_MAPS = ['legacy-1'];

/**
 * Brings an older save up to date with the current rules: fleets were removed from every era, and
 * games from before the economy get treasuries and barracks.
 */
function migrateSave(s: GameState, world: World): GameState {
  const armies = Object.fromEntries(Object.entries(s.armies).filter(([, a]) => world.unitTypes[a.unitType]));
  const fixed = Object.keys(armies).length === Object.keys(s.armies).length ? s : { ...s, armies };
  return initEconomy(fixed, world);
}

async function startGame(root: HTMLElement, scenario: ScenarioDef, saved: GameState | null, saveId: string | null, readOnly = false) {
  const theme = getTheme(scenario.theme);
  applyTheme(theme);
  audio.setTheme(scenario.theme);
  document.title = `${scenario.name} — Warroom Beta`;

  const stage = h('div', { class: 'map-stage' });
  const bar = h('i');
  const barLabel = h('span', null, 'Loading the map…');
  const loading = h('div', { class: 'loading era-loading' },
    h('div', null, h('div', { class: 'eyebrow' }, saved ? 'Loading saved game' : 'New game'), h('h2', null, scenario.name), h('p', { class: 'dim' }, scenario.subtitle),
      h('div', { class: 'load-bar' }, bar), barLabel));
  root.append(stage, loading);

  // Labels are rasterised by Pixi, so make sure the era's web fonts are ready first.
  // A save keeps the map it was made on: games from before a map rebuild load the older map.
  const progress = (f: number) => {
    bar.style.width = f < 0 ? '60%' : `${Math.round(f * 100)}%`;
    bar.classList.toggle('indeterminate', f < 0);
  };
  const fits = (m: MapData) => !!saved && Object.keys(saved.provinces).length === m.provinces.length && Object.keys(saved.provinces).every((id) => m.byId.has(id));
  let rawMap: MapData;
  try {
    const savedOnLegacy = saved && LEGACY_MAPS.some((v) => saved.mapId.includes(`/${v}/`));
    [rawMap] = await Promise.all([loadMap(savedOnLegacy ? saved!.mapId : scenario.map, progress), themeFontsReady(theme)]);
    if (saved && !fits(rawMap)) {
      for (const v of LEGACY_MAPS) {
        const older = await loadMap(scenario.map.replace('/maps/', `/maps/${v}/`), progress).catch(() => null);
        if (older && fits(older)) { rawMap = older; break; }
      }
    }
  } catch (e) {
    reportError(e, 'map-load');
    barLabel.textContent = (e as Error).message;
    loading.firstElementChild!.append(h('div', { class: 'load-actions' }, h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Try again'), h('button', { class: 'btn', onclick: go.menu }, 'Main menu')));
    return;
  }
  barLabel.textContent = 'Building the world…';
  const map = applyProvinceNames(rawMap, scenario.provinceNames);
  const world = buildWorldFromMap(map, scenario.unitTypes, resourcesOf(scenario.era));

  if (saved && !fits(map)) {
    loading.replaceChildren(h('div', null, 'This save was made with a map this version of the game no longer has, so it cannot be loaded.', h('div', null, h('button', { class: 'btn', onclick: go.menu }, 'Main menu'))));
    return;
  }
  const state = saved ? migrateSave({ ...saved, mapId: rawMap.id }, world) : createInitialState(scenario, map.id, map.provinces.map((p) => ({ ...provinceMeta(p), pop: p.pop })), world);
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
  setErrorContext(() => ({ scenarioId: scenario.id, date: formatDate(store.state.clock), nation: store.state.playerNation, spectating: readOnly }));
  trackPlayStats(store, scenario);
  new AchievementTracker(store, scenario, (a) => hud?.celebrate(a.name, a.description));
  // first new game: the walkthrough starts once a nation is chosen
  if (!readOnly && !saved && !getSettings().tutorialDone) {
    const startTutorial = () => {
      const t = new Tutorial(store, loop, () => hud!.currentSelection);
      hud!.onSelectionChange = () => t.check();
    };
    if (store.state.playerNation) startTutorial();
    else { const off = store.subscribe((s) => { if (s.playerNation) { off(); startTutorial(); } }); }
  }
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
