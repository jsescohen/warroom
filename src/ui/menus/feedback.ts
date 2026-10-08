import { audio } from '../../audio/audio';
import { apiFetch, getAccess } from '../../auth/account';
import type { ScenarioDef } from '../../core/scenario';
import type { GameStore } from '../../core/store';
import { formatDate } from '../../core/time';
import { makeSave } from '../../game/saves';
import { h } from '../dom';
import { openPanel, segmented } from './shell';

type Category = 'bug' | 'idea' | 'balance' | 'other';

/**
 * "Send feedback": a bug, an idea, a balance complaint… straight to the admin panel. In a game the
 * current game can be attached, so the admin can open exactly what the tester was looking at.
 */
export function openFeedback(game?: { store: GameStore; scenario: ScenarioDef }) {
  const panel = openPanel('Send feedback', { eyebrow: 'Beta' });
  if (getAccess().mode !== 'accounts') {
    panel.body.append(h('p', { class: 'setting-hint' }, 'Feedback needs sign-in, which is not set up on this server.'));
    return panel.closed;
  }
  let category: Category = 'bug';
  const text = h('textarea', { class: 'feedback-text', rows: '6', maxlength: '4000', placeholder: 'What happened, or what would make the game better? The more specific, the better.' }) as HTMLTextAreaElement;
  const attach = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  const status = h('p', { class: 'setting-hint', role: 'status' });
  const send = h('button', { class: 'btn primary' }, 'Send') as HTMLButtonElement;
  const inGame = !!game && !game.store.readOnly;

  send.onclick = async () => {
    if (text.value.trim().length < 3) { status.textContent = 'Write a few words first.'; text.focus(); return; }
    send.disabled = true;
    status.textContent = 'Sending…';
    const s = game?.store.state;
    const context = {
      page: location.pathname + location.search,
      browser: navigator.userAgent,
      screen: `${innerWidth}x${innerHeight}`,
      ...(game && s ? { scenarioId: game.scenario.id, era: game.scenario.name, date: formatDate(s.clock), nation: s.playerNation ? s.nations[s.playerNation]?.name : null, difficulty: s.rules.difficulty ?? 'normal' } : {}),
    };
    const save = inGame && attach.checked && s ? makeSave(s, game!.scenario, { name: `Feedback — ${formatDate(s.clock)}` }) : undefined;
    try {
      const r = await apiFetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ category, text: text.value.trim(), context, save }) });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error ?? `HTTP ${r.status}`);
      audio.play('save');
      panel.body.replaceChildren(h('p', null, 'Thanks! Your feedback is with the admin.'), h('div', { class: 'setting-actions' }, h('button', { class: 'btn primary', onclick: panel.close }, 'Close')));
    } catch (e) {
      status.textContent = `Could not send: ${(e as Error).message}`;
      send.disabled = false;
    }
  };

  panel.body.append(
    h('div', { class: 'setting-row' }, h('div', { class: 'setting-text' }, h('div', { class: 'setting-title' }, 'About')),
      h('div', { class: 'setting-control' }, segmented<Category>(category, [['bug', 'Bug'], ['idea', 'Idea'], ['balance', 'Balance'], ['other', 'Other']], (v) => (category = v)))),
    text,
    ...(inGame ? [h('label', { class: 'feedback-attach' }, attach, h('span', null, 'Attach this game (lets the admin open it exactly as it is now)'))] : []),
    h('div', { class: 'setting-actions' }, send, h('button', { class: 'btn', onclick: panel.close }, 'Cancel')),
    status,
  );
  setTimeout(() => text.focus(), 0);
  return panel.closed;
}
