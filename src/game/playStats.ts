import { apiFetch, cloudSaves } from '../auth/account';
import type { ScenarioDef } from '../core/scenario';
import type { GameStore } from '../core/store';

/**
 * Play statistics for the account (signed-in players): games started per era and nation, time
 * played, victories and defeats. Shown on the player's profile and in the admin panel.
 */

const HEARTBEAT_S = 60;
/** No input for this long and the minutes stop counting (the tab left open overnight). */
const IDLE_MS = 5 * 60_000;

export function trackPlayStats(store: GameStore, scenario: ScenarioDef) {
  if (!cloudSaves() || store.readOnly) return;
  const send = (body: Record<string, unknown>) =>
    void apiFetch('/api/stats', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenarioId: scenario.id, ...body }), keepalive: true }).catch(() => undefined);

  store.subscribe((s, prev) => {
    const p = s.playerNation;
    if (p && !prev.playerNation) send({ type: 'start', nation: s.nations[p]?.name });
    if (!p) return;
    if (s.winner === p && prev.winner !== p) send({ type: 'end', result: 'victory' });
    if (!s.nations[p]?.alive && prev.nations[p]?.alive) send({ type: 'end', result: 'defeat' });
  });

  let lastInput = Date.now();
  for (const ev of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(ev, () => (lastInput = Date.now()), { passive: true });
  window.setInterval(() => {
    if (document.hidden || !store.state.playerNation || Date.now() - lastInput > IDLE_MS) return;
    send({ type: 'time', seconds: HEARTBEAT_S });
  }, HEARTBEAT_S * 1000);
}
