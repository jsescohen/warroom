# Warroom

Browser grand-strategy game about diplomacy and conquest across eight eras.
TypeScript + Vite + PixiJS, with a small Express server that proxies every AI call.

## Run

```bash
npm install
cp .env.example .env      # pick an AI provider (default: local Ollama)
npm run dev               # web on :5173, API on :8787
```

`npm test` runs unit tests; `npm run typecheck` checks types.

## AI providers

Set `LLM_PROVIDER` in `.env` to `ollama` (default), `gemini`, `groq`, `openrouter` or `anthropic`, plus that
provider's key/model. Keys stay on the server. The top bar shows the active provider; **Test** sends a round-trip.

Every AI call goes through `server/llm/service.ts`:
- each task (`shared/ai/tasks.ts`) has a zod schema; replies are parsed leniently (`server/llm/json.ts`) and validated
- invalid reply → one retry with a "return ONLY valid JSON" reminder → otherwise the task's safe fallback
- the server logs every call: `[llm] diplomacy ITA [player] ok (queue 0.0s + model 3.5s)`; timeouts are not retried
  (retrying an overloaded model only doubles the load)
- **Ollama on a laptop GPU:** `OLLAMA_NUM_CTX` (default 4096) keeps the model small in VRAM. Ollama's own default
  context can be 16k+, which on an 8 GB GPU shared with games/other apps spills into system RAM and drops generation
  from ~60 to ~2 tokens/s. The map also renders only when something changes, to leave the GPU to the model.
- `server/llm/queue.ts`: player requests jump ahead of AI-nation requests, min gap between calls, per-nation
  cooldown, AI requests dropped when the queue is busy, and a pause on HTTP 429

## Menus, saves, settings, sound

- **Main menu** (`/`): Continue (latest save), New game (era → nation picker), Load game, Settings. Screens are URLs:
  `?new`, `?era=<id>`, `?load=<saveId>`.
- **Saves** (`src/game/saves.ts`): IndexedDB slots + an autosave slot (weekly/monthly in-game, and when leaving to the
  menu). In game: **Esc** or **☰** → Save / Save as / Load / Settings / Main menu; **Ctrl+S** quick-saves. Saves can be
  exported to / imported from `.warroom.json` files. A save is the GameState (~120 KB); map and world are rebuilt on load.
- **Settings** (**⚙**, `src/ui/settings.ts`, saved in localStorage): *Gameplay* — auto-pause, AI advisor, whether dialogs
  pause, whether AI leaders write first, autosave, edge scrolling; *Audio* — mute, master/effects/music volume, UI sounds,
  music; *Display* — interface size, province names, reduce motion; *AI* — provider status/test; *Data* — delete saves, reset.
- **Sound** (`src/audio/audio.ts`): every effect and the music is synthesised with the Web Audio API — no audio files.
  Effects for clicks, selecting/ordering armies, war horns, battles, captures and capitals, losses, treaty seals,
  messages, alerts, saving, victory and defeat (synth variants in the modern eras); gentle generative ambient music in
  each era's scale.
- **Era themes** (`src/ui/themes.ts` + `styles.css`): parchment (Bronze Age), marble (Rome), ornate (Renaissance), sepia
  (World Wars), tactical (Modern, USA) — each with its own fonts, panels and map palette.
- **Victory / defeat** screens with stats when you reach the conquest goal or your nation falls.

## Time

The clock lives in `GameState` (`clock.hours`, plus per-era `tickHours`/`turnHours`). Each `tick` action runs
`simulateTick` (`src/core/sim.ts`), which advances the clock and fires scheduled historical events (skipped when
the player would be the actor). `src/game/loop.ts` dispatches ticks in real time at pause/1×/2×/4×; **Skip** fast-forwards
to the next important event (max `skipMaxTurns`).

**⚙ Settings** (top bar, saved per browser): *Auto-pause* — Off (time keeps running; events only show as messages),
My nation (default: pause when something important happens to you) or All events; and the *AI advisor* level
(Off / Major / All attacks). Dialogs always pause while open.

Keys: **Space** pause · **1/2/3** speed · **N** skip · **Esc** deselect.

## Military

Rules live in `src/core/military.ts` and run inside the tick, using a static `World` (`src/core/world.ts`: land
adjacency + generated sea lanes, distances, unit stats) that is passed to `reduce()` but never stored in the state.

- **Orders:** drag one of your army counters onto a province: the route and ETA follow the cursor and releasing gives
  the order (dragging near a screen edge scrolls the map). Clicking a counter then clicking/right-clicking a province
  also works. Dropping onto a country you are not at war with opens one Assessor dialog — *Declare war & attack* —
  that declares war and sends the army in a single step. Halt / Split / Merge from the side panel.
- **Movement:** Dijkstra over land + sea lanes (sea at half speed). An army must capture each enemy province it enters before moving on.
- **Battles:** hostile armies in the same province fight every tick (attack vs defense, +20% defending home soil,
  +25% more in a capital, ±15% seeded randomness — the RNG state is in `GameState`, so replays are identical).
- **Capture:** an unopposed army takes an enemy province in about a day; losing the capital moves it, losing everything annexes the nation.
- **Upkeep:** armies reinforce 3%/day in friendly land; every 30 days each nation raises a new army at its capital up to its cap.

## AI Assessor

Before a major action the game pauses and shows the Assessor dialog:

- **What counts as major** (`src/core/assess.ts` → `classifyMajor`): every declaration of war; with the advisor on
  *major* (default) also assaults on a capital, naval invasions and opening a new front against a nation; on
  *all attacks* every attack order. Toggle with the **Advisor** button in the top bar (saved in localStorage).
- **Staff estimate** (`estimate`, deterministic): success chance, power balance, who will likely join the enemy,
  treaties broken, relation penalties. Shown instantly and given to the model as facts.
- **Advisor report** (`src/ai/assessor.ts`, task `assess`): an in-character briefing from the era's advisor
  (`scenario.advisor`) with summary, consequences, military risk, odds, likely enemies, risk rating and advice. Prompts are
  ~1.5k characters; reports are cached per action per in-game day; if the model fails twice the dialog says so and the
  staff estimate stands.

## Diplomacy

Open with the **Diplomacy** button, **D**, or "Talk to …" on a province. Every other nation's leader is an AI persona
(`NationDef.leader` in the scenario; minor nations get a generic head of state).

- **Agreements** (`src/core/diplomacy.ts`): alliance, non-aggression pact (180 days), ceasefire (30 days, then fighting
  resumes unless peace is signed), peace (optionally moving provinces; 1-year truce), territory exchange, joint war,
  ultimatum. A proposal is a pending card; it only becomes a treaty when the recipient accepts (`respond` action).
  Breaking a treaty (✕ on the chip) costs −30 relations with every partner and is remembered.
- **Willingness** is computed by the game (relations, relative power, the war situation, common enemies, grievances,
  what is traded) and given to the leader as guidance. The leader decides in character, but can never accept terms below
  the floor (−25); persuasive chat moves relations (±8 per message), which moves willingness.
- **Leader replies** (`src/game/diplomat.ts`, task `diplomacy`): `{reply, relationChange, accepted, agreementProposed,
  agreementType, terms, memory}`. Counter-offers name provinces, which are matched to real ones and validated.
- **Memory**: per leader, up to 5 notes the AI chose to keep plus up to 5 grievances the game records (wars declared,
  treaties broken, ultimatums). Only this and the last 6 chat lines are sent with each request.
- **AI writes first** (`src/game/diplomacyDirector.ts`): declarations of war, peace feelers when losing, alliance offers
  against a shared enemy, non-aggression pacts, warnings and ultimatums — deterministic triggers with cooldowns
  (25 days per leader, 4 days overall); the LLM only writes the words. A refused AI ultimatum means war 3 days later.
- Breaking a treaty, issuing an ultimatum and joining a joint war go through the Assessor.

## Nation AI

Every nation except the player's is run by `src/core/ai.ts`, inside the pure tick, through the same validated actions
the player uses — deterministic (seeded RNG), replayable, multiplayer-ready, and free of LLM calls (the model is kept
for talking to the player).

- **Daily (staggered across the day's ticks):** pull back mauled armies; reinforce threatened provinces, capital first;
  attack the best-value enemy provinces only with a local edge set by doctrine (aggressive nations ~1.4×, cautious ones
  up to 2.5×); armies holding a threatened front stay put. In peacetime, line borders facing hostile neighbours weekly.
- **Weekly:** answer an ally's call to arms (if not already at war), make peace with AI enemies when both sides are
  willing, ally against shared enemies, and start wars of expansion against weaker neighbours (personality
  `aggression`, relative power incl. allies, treaties; 14-day opening grace, 10-day worldwide cooldown; the player is
  only targeted with a 2.2× edge).
- **Naval strength** (`naval` per nation) stands in for fleets: landings fight at 60% for 2 days, less against strong
  navies, and the AI only lands where it has no land route and a large edge.
- A nation joins an existing war only alongside an ally; otherwise its declaration starts a separate war.

## Eras

| Era | Start | Map | Notes |
| --- | --- | --- | --- |
| Bronze Age | 1500 BC | world_bc1500 + tribes | weekly turns, chariots/spearmen/archers |
| Rise of Rome | 27 BC | world_bc1 + tribes | Meroë's war on Rome scripted |
| Fall of Rome | 400 AD | world_400 + tribes | Alaric invades Italy in 401 |
| Renaissance | 1500 | world_1500 + tribes | Ottoman–Venetian and Muscovite–Lithuanian wars |
| World War I | 28 Jul 1914 | world_1914 | Aug 1914 declarations scripted; slow trench movement |
| World War II | 1 Sep 1939 | world_1938 | 1939–40 scripted |
| Modern | 2026 | world_2010 | leaders shown by office only; low AI war appetite |
| USA (Divided States) | 2026 | US states, Albers USA | fictional; 51 state-nations in regional blocs |

Each scenario file (`src/data/scenarios/`) sets nations, colors, leaders, unit types, advisor voice, calendar, period
province names (`provinceNames`), starting wars/treaties/relations, scripted events, and tuning: per-nation
`military`, `aggression`, `naval`, `quality`; per-era `combat.homeDefense`, `combat.captureDays`, `aiWarAppetite`.
Beaten nations **capitulate** (≤40% of their land with the enemy at the capital, or ≤25%); colonies weigh a quarter
in both army size and capitulation.

## Layout

| Path | What |
| --- | --- |
| `src/core/` | Game model. `GameState` is plain JSON; all changes are `Action`s applied by the pure `reduce()` via `GameStore.dispatch` (the multiplayer seam). |
| `src/data/scenarios/` | One file per era: nations, colors, capitals, starting wars/treaties/relations, unit types, AI context. |
| `src/map/` | Map loading, camera, PixiJS renderer (read-only view of state). |
| `src/ui/` | HUD and per-era themes. |
| `server/` | Express API + LLM providers. |
| `scripts/build-map.ts` | Offline map builder (see below). |

## Maps

Historical borders come from [aourednik/historical-basemaps](https://github.com/aourednik/historical-basemaps);
province seeds and names from Natural Earth populated places. `scripts/build-map.ts` projects a polity GeoJSON
(Miller), splits each polity into city-named provinces with a Voronoi diagram, computes adjacency, and tags every
border segment with the provinces on both sides so nation borders can be drawn from live ownership.

Sources go in `data-src/` (git-ignored): historical-basemaps `world_bc1500`, `world_bc1`, `world_400`, `world_1500`,
`world_1914`, `world_1938`, `world_2010`; Natural Earth `ne_10m_populated_places_simple` (as `places.geojson`) and
`ne_50m_land` (as `land.geojson`); PublicaMundi `us-states.json` (as `us_states.geojson`). Then:

```bash
npm run map:all
```

Builder options: `--projection albersUsa` (USA mode), `--density`, `--name-field/--subject-field`, `--land` (background
land layer) and `--tribes true`: land outside every polity becomes tribal territory, split at game start into peoples
by geographic zone (`src/core/regions.ts`, renamed per era via `scenario.tribeNames`).

## Build plan

1. ✅ Project setup, WW2 map rendering, zoom/pan (+ LLM service layer)
2. ✅ Game state + time system (speed / skip)
3. ✅ Armies, movement, invasion, battles
4. ✅ AI Assessor
5. ✅ AI Diplomacy chat + treaties
6. ✅ Autonomous AI nations
7. ✅ Remaining eras
8. ✅ Save/load, main menu, settings, sound, era themes

## Garrisons, navies and strikes

- **Garrisons** (`garrisonMax` in `src/core/military.ts`): every province has its own defenders, about a fifth of an army in
  the homeland, less in occupied land, more at the capital. Invaders must beat them before the occupation starts; they
  fight back, regrow when no enemy stands there, and start from zero after a province changes hands. Shown in the
  province panel. Field armies: about 1.4x the previous counts (`armyCap`).
- **Fleets** are units with `domain: 'sea'` (one or two types per era): they sail along coasts and sea lanes, may pass
  neutral shores, fight enemy fleets they meet, and never capture land. Fleet numbers follow each nation's `naval`
  value (about 6 at 1.0), rebuilt every 60 days at the home port. Lake shores and inland data gaps are not coast
  (`seaShoreTest` in `src/map/mapData.ts`).
- **Sea control**: troops cannot cross a sea lane where enemy fleets are 1.2x stronger than ours (counting fleets
  within ~600 km at half weight); convoys caught at sea take heavy losses. Replaces the old abstract naval penalty.
- **Era-gated firepower**: ancient galleys, triremes and dromons only fight and escort. From 1500, ships with
  `bombard` give gunfire support to their own troops fighting on that coast. WW2 carriers (~470 km) and modern carriers
  and missile destroyers have a `strike`: select the fleet, press *Air/Missile strike…*, click a target inside the ring
  (Esc cancels); it then rearms. The AI hunts weaker squadrons, supports its armies' coasts, strikes, and refits in port.
- **AI**: assembles next to a target before attacking (unless overwhelmingly stronger), ignores objectives no free army can
  reach, and cautious nations (aggression < 0.3) stay on the defensive unless 1.5x stronger (the 1939 Phoney War).

## Closed beta & deployment

- **Beta gate** (`server/beta.ts`, `src/ui/betaGate.ts`): set `BETA_CODES=CODE1,CODE2` in `.env`. Players enter a code once;
  the server sets an httpOnly cookie (a signature, not the code). Without it `/api/ai/*` and `/maps/*` return 401, so the
  URL alone is not enough to play. Wrong guesses are limited to 8 per IP per 15 min. Remove a code to revoke it.
- **Production**: `npm run build` then `npm start` — one Node process serves the built game from `dist/` and the API, on
  `PORT` (set by the host). Any Node host works (Render, Railway, Fly.io): build command `npm ci && npm run build`,
  start command `npm start`, env vars from `.env.example` (`LLM_PROVIDER` + its key, `BETA_CODES`, `BETA_SECRET`).
  A hosted server cannot reach Ollama on your PC — use Groq, Gemini, OpenRouter or Anthropic there.
- **Saves stay in each player's browser** (IndexedDB; settings in localStorage). Nothing is stored on the server.
