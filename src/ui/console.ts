import { h } from './dom';

type Child = Node | string | null | undefined | false;

/**
 * The frame of every screen outside a game (menu, era select, sign-in, admin): the neutral
 * "console" theme, a dotted world map behind everything, and a slim top bar with the wordmark.
 * In-game panels keep their era's theme.
 */
export function consoleScreen(opts: { page: string; title: string; right?: Child }, ...content: Child[]): HTMLElement {
  document.documentElement.dataset.theme = 'console';
  document.title = opts.title;
  return h('div', { class: `cx-screen cx-on-${opts.page}` },
    h('div', { class: 'cx-map', 'aria-hidden': 'true' }),
    h('header', { class: 'cx-top' },
      h('a', { class: 'cx-brand', href: '/', title: 'Main menu' }, h('img', { class: 'cx-mark', src: '/logo.svg', alt: '' }), 'Warroom', h('span', { class: 'cx-tag' }, 'Beta')),
      opts.right ?? null,
    ),
    ...content,
  );
}

/** A big list item: index number, label, and a detail line that shows on the right. */
export function menuItem(index: number, label: string, sub: string | null, onclick: () => void, primary = false): HTMLElement {
  return h('button', { class: `cx-item${primary ? ' primary' : ''}`, onclick },
    h('span', { class: 'cx-num' }, String(index).padStart(2, '0')),
    h('span', { class: 'cx-label' }, label),
    sub ? h('span', { class: 'cx-sub' }, sub) : null,
  );
}

/** The sign-in / waiting card on the console background (also used by the tester-code gate). */
export function gatePage(title: string, text: string, items: HTMLElement[], foot?: string): HTMLElement {
  return consoleScreen({ page: 'gate', title: `Warroom Beta — ${title}` },
    h('main', { class: 'cx-gate' },
      h('div', { class: 'cx-kicker' }, h('span', { class: 'cx-dot' }), 'Closed beta'),
      h('h1', { class: 'cx-wordmark small' }, 'Warroom'),
      h('section', { class: 'cx-card' },
        h('h2', null, title),
        h('p', null, text),
        h('div', { class: 'main-buttons' }, ...items),
      ),
      h('p', { class: 'cx-legal' }, foot ? h('span', null, foot) : null, h('a', { href: '/privacy.html' }, 'Privacy'), h('a', { href: '/terms.html' }, 'Terms')),
    ),
  );
}
