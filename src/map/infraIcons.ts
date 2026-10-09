import { Container, Graphics, Text, TextStyle } from 'pixi.js';

/**
 * Buildings and work under way, drawn on the map: small pictograms on a dark disc (an oil derrick,
 * a pickaxe, wheat, a factory, a tent, a plane, a tower, a radar dish, a cross, a flask), a ring that fills up while
 * something is being built or trained (with the days left), and the province's output ("+4 oil").
 * Drawn in screen pixels: the container is scaled 1/zoom by the renderer.
 */

export type InfraIcon = 'oil' | 'mine' | 'farm' | 'factory' | 'barracks' | 'airfield' | 'fort' | 'airdefense' | 'hospital' | 'lab' | 'develop' | 'train';

export interface InfraItem {
  province: string;
  icons: InfraIcon[];
  /** "+4 oil" (own provinces). */
  output?: string;
  /** Work under way (own provinces). */
  project?: { icon: InfraIcon; fraction: number; left: string; more: number };
  own: boolean;
}

const R = 8;
const INK = 0xffffff;

function glyph(g: Graphics, icon: InfraIcon, x: number, y: number) {
  const line = (pts: number[], w = 1.5) => {
    g.moveTo(x + pts[0], y + pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(x + pts[i], y + pts[i + 1]);
    g.stroke({ width: w, color: INK, cap: 'round', join: 'round' });
  };
  switch (icon) {
    case 'oil': // derrick: a tapering tower with cross-braces
      line([-4, 5, 0, -5, 4, 5]);
      line([-2.4, 1, 2.4, 1], 1.2);
      line([-3.2, 3, 3.2, 3], 1.2);
      g.rect(x - 5, y + 5, 10, 1.4).fill(INK);
      break;
    case 'mine': // pickaxe
      g.moveTo(x - 5, y - 2).quadraticCurveTo(x, y - 6, x + 5, y - 2).stroke({ width: 1.6, color: INK, cap: 'round' });
      line([0, -4, 0, 5.5], 1.6);
      break;
    case 'farm': // wheat
      line([0, 5.5, 0, -5], 1.3);
      for (const [dx, dy] of [[-2, -3], [2, -2], [-2, 0], [2, 1], [-2, 3]]) g.ellipse(x + dx, y + dy, 1.6, 1).fill(INK);
      break;
    case 'factory': // building with a chimney and smoke
      g.poly([x - 5, y + 5, x - 5, y - 1, x - 2, y + 1, x - 2, y - 1, x + 1, y + 1, x + 1, y - 4, x + 3.5, y - 4, x + 3.5, y + 5]).fill(INK);
      g.circle(x + 4, y - 6, 1.2).fill({ color: INK, alpha: 0.7 });
      break;
    case 'barracks': // tent with a flag
      g.poly([x - 5.5, y + 5, x, y - 2, x + 5.5, y + 5]).fill(INK);
      line([0, -2, 0, -6], 1.1);
      g.poly([x, y - 6, x + 3.5, y - 5, x, y - 4]).fill(INK);
      break;
    case 'airfield': // a small plane
      line([0, -5.5, 0, 5], 1.6);
      line([-5.5, 0, 5.5, 0], 1.6);
      line([-2.5, 4.5, 2.5, 4.5], 1.3);
      break;
    case 'fort': // crenellated tower
      g.poly([x - 4, y + 5, x - 4, y - 5, x - 2.4, y - 5, x - 2.4, y - 3, x - 0.8, y - 3, x - 0.8, y - 5, x + 0.8, y - 5, x + 0.8, y - 3, x + 2.4, y - 3, x + 2.4, y - 5, x + 4, y - 5, x + 4, y + 5]).fill(INK);
      break;
    case 'airdefense': // radar dish on a stand
      g.moveTo(x - 5, y - 3).quadraticCurveTo(x - 1, y + 3, x + 5, y - 3).stroke({ width: 1.6, color: INK, cap: 'round' });
      line([0, 0, 0, 5], 1.4);
      line([-3, 5, 3, 5], 1.4);
      line([0, 0, 2, -4], 1.1);
      break;
    case 'hospital': // a cross
      g.rect(x - 1.6, y - 5, 3.2, 10).fill(INK);
      g.rect(x - 5, y - 1.6, 10, 3.2).fill(INK);
      break;
    case 'lab': // a flask
      g.poly([x - 1.6, y - 5.5, x + 1.6, y - 5.5, x + 1.6, y - 1.5, x + 5, y + 5, x - 5, y + 5, x - 1.6, y - 1.5]).fill(INK);
      g.rect(x - 2.6, y - 6, 5.2, 1.2).fill(INK);
      break;
    case 'develop': // houses
      g.poly([x - 5, y + 5, x - 5, y, x - 2.5, y - 2.5, x, y, x, y + 5]).fill(INK);
      g.poly([x + 0.8, y + 5, x + 0.8, y - 2, x + 3, y - 4.5, x + 5.2, y - 2, x + 5.2, y + 5]).fill(INK);
      break;
    case 'train': // helmet
      g.ellipse(x, y + 0.5, 4.8, 4).fill(INK);
      g.rect(x - 5.5, y + 0.5, 11, 1.6).fill(INK);
      g.rect(x - 6, y + 2.1, 12, 4).fill({ color: 0x000000, alpha: 0 });
      break;
  }
}

const textStyle = new TextStyle({ fontFamily: 'Barlow, sans-serif', fontSize: 11, fontWeight: '600', fill: 0xffffff, stroke: { color: 0x101010, width: 3 } });

/** One province's markers. */
export function buildInfra(item: InfraItem, accent: number): Container {
  const c = new Container();
  const g = new Graphics();
  c.addChild(g);
  const all: InfraIcon[] = [...(item.project ? [item.project.icon] : []), ...item.icons.filter((i) => i !== item.project?.icon)].slice(0, 5);
  const step = R * 2 + 3;
  const x0 = -((all.length - 1) * step) / 2;
  all.forEach((icon, i) => {
    const x = x0 + i * step;
    const building = !!item.project && i === 0;
    g.circle(x, 0, R).fill({ color: 0x1b1b1b, alpha: building ? 0.6 : 0.82 });
    if (building) {
      // the ring fills as the work progresses
      g.circle(x, 0, R + 1.5).stroke({ width: 2.5, color: 0xffffff, alpha: 0.18 });
      const f = Math.max(0.03, Math.min(1, item.project!.fraction));
      g.arc(x, 0, R + 1.5, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2).stroke({ width: 2.5, color: accent });
    } else g.circle(x, 0, R).stroke({ width: 1, color: item.own ? accent : 0xffffff, alpha: item.own ? 0.9 : 0.35 });
    glyph(g, icon, x, 0);
    g.alpha = 1;
  });
  const labels: string[] = [];
  if (item.project) labels.push(`${item.project.left}${item.project.more ? ` (+${item.project.more})` : ''}`);
  if (item.output) labels.push(item.output);
  if (labels.length) {
    const t = new Text({ text: labels.join('  ·  '), style: textStyle, resolution: Math.min(window.devicePixelRatio || 1, 2) * 1.5 });
    t.anchor.set(0.5, 0);
    t.position.set(0, R + 4);
    c.addChild(t);
  }
  return c;
}
