/**
 * Tiny SVG line charts for the ledger and the end screen: no library, theme colours from CSS.
 */

export interface Series {
  label: string;
  color: string;
  values: number[];
  /** The player's line: drawn thicker, on top. */
  bold?: boolean;
}

const NS = 'http://www.w3.org/2000/svg';
const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text?: string) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
};

/** A rounded-up axis maximum with a readable step (1, 2, 5 × 10^n). */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)!;
}

/**
 * A line chart over shared x positions. `xLabels` are shown at the start and end (dates).
 * Series with no data (all zero) are left out.
 */
export function lineChart(series: Series[], xLabels: [string, string], opts: { height?: number; title?: string } = {}): SVGSVGElement {
  const W = 640, H = opts.height ?? 220, L = 44, R = 12, T = 14, B = 26;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': opts.title ?? 'Chart' });
  const shown = series.filter((s) => s.values.some((v) => v > 0)).sort((a, b) => Number(!!a.bold) - Number(!!b.bold));
  const n = Math.max(...shown.map((s) => s.values.length), 0);
  if (n < 2) {
    svg.append(el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'chart-empty' }, 'Graphs fill in as the weeks go by.'));
    return svg;
  }
  const max = niceMax(Math.max(...shown.flatMap((s) => s.values)));
  const x = (i: number) => L + (i / (n - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  for (let k = 0; k <= 4; k++) {
    const v = (max / 4) * k;
    svg.append(el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'chart-grid' }));
    svg.append(el('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'chart-axis' }, v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v))));
  }
  svg.append(el('text', { x: L, y: H - 6, class: 'chart-axis' }, xLabels[0]));
  svg.append(el('text', { x: W - R, y: H - 6, 'text-anchor': 'end', class: 'chart-axis' }, xLabels[1]));
  for (const s of shown) {
    const pts = s.values.map((v, i) => `${x(i + (n - s.values.length)).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const line = el('polyline', { points: pts, fill: 'none', stroke: s.color, 'stroke-width': s.bold ? 3 : 1.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: s.bold ? 1 : 0.85 });
    line.append(el('title', {}, s.label));
    svg.append(line);
  }
  return svg;
}

/** Colour chips naming each line. */
export function legend(series: Series[]): HTMLElement {
  const div = document.createElement('div');
  div.className = 'chart-legend';
  for (const s of series.filter((x) => x.values.some((v) => v > 0))) {
    const span = document.createElement('span');
    if (s.bold) span.className = 'bold';
    const i = document.createElement('i');
    i.style.background = s.color;
    span.append(i, s.label);
    div.append(span);
  }
  return div;
}
