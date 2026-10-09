import { CHANGELOG, LATEST_VERSION } from '../../data/changelog';
import { fill, h } from '../dom';
import { openPanel } from './shell';

const SEEN_KEY = 'warroom.seenVersion';

/** "What's new": the release notes, the newest first (older ones folded). */
export function openWhatsNew() {
  const panel = openPanel("What's new", { wide: true, eyebrow: `Version ${LATEST_VERSION}` });
  const body = h('div', { class: 'whatsnew' });
  fill(panel.body, body);
  fill(body, ...CHANGELOG.map((r, i) => h('details', { class: 'wn-release', open: i === 0 },
    h('summary', null, h('strong', null, r.title), h('span', { class: 'dim' }, ` · ${r.version} · ${r.date}`)),
    h('dl', { class: 'howto-list' }, ...r.items.flatMap((it) => [h('dt', null, it.title), h('dd', null, it.how)])),
  )));
  try { localStorage.setItem(SEEN_KEY, LATEST_VERSION); } catch { /* storage blocked */ }
  return panel.closed;
}

/** Shows the release notes once after an update (not on a player's very first visit). */
export function whatsNewOnce(firstVisit: boolean) {
  let seen: string | null = null;
  try { seen = localStorage.getItem(SEEN_KEY); } catch { return; }
  if (seen === LATEST_VERSION) return;
  if (firstVisit && !seen) {
    try { localStorage.setItem(SEEN_KEY, LATEST_VERSION); } catch { /* storage blocked */ }
    return;
  }
  void openWhatsNew();
}
