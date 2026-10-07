type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | undefined> & { class?: string };

/** Tiny hyperscript helper: h('div', { class: 'x', onclick: fn }, 'text', child). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export const swatch = (color: string) => h('span', { class: 'swatch', style: `background:${color}` });

/** replaceChildren that skips null/undefined/false entries. */
export const fill = (el: Element, ...nodes: (Node | string | null | undefined | false)[]) =>
  el.replaceChildren(...nodes.filter((n): n is Node | string => n !== null && n !== undefined && n !== false));
