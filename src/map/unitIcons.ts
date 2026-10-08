import type { Graphics } from 'pixi.js';

/**
 * Small NATO-style unit symbols drawn as vectors inside a w x h frame centred at (cx, cy).
 * Era-specific unit ids map onto a handful of symbol families.
 */
type Symbol = 'infantry' | 'armor' | 'artillery' | 'air' | 'cavalry' | 'missile' | 'naval' | 'carrier' | 'generic';

const FAMILY: Record<string, Symbol> = {
  infantry: 'infantry', spearmen: 'infantry', legion: 'infantry', pikemen: 'infantry', militia: 'infantry', guard: 'infantry',
  auxilia: 'infantry', comitatenses: 'infantry', foederati: 'infantry', arquebusiers: 'infantry',
  armor: 'armor', tanks: 'armor', mech: 'armor',
  artillery: 'artillery', archers: 'artillery', siege: 'artillery', cannon: 'artillery',
  air: 'air', drones: 'air', aircraft: 'air',
  cavalry: 'cavalry', chariots: 'cavalry', knights: 'cavalry', 'horse-archers': 'cavalry',
  missiles: 'missile', missile: 'missile',
  navy: 'naval', fleet: 'naval', galleys: 'naval', triremes: 'naval', dromons: 'naval', carracks: 'naval',
  dreadnoughts: 'naval', battleships: 'naval', destroyers: 'naval', carriers: 'carrier',
};

export function drawUnitSymbol(g: Graphics, unitType: string, cx: number, cy: number, w: number, h: number, color: number) {
  const x0 = cx - w / 2, y0 = cy - h / 2, x1 = cx + w / 2, y1 = cy + h / 2;
  g.rect(x0, y0, w, h).stroke({ width: 1.2, color });
  const line = { width: 1.2, color, cap: 'round' as const };
  switch (FAMILY[unitType] ?? 'generic') {
    case 'infantry':
      g.moveTo(x0, y0).lineTo(x1, y1).moveTo(x1, y0).lineTo(x0, y1).stroke(line);
      break;
    case 'armor':
      g.ellipse(cx, cy, w * 0.32, h * 0.26).stroke(line);
      break;
    case 'artillery':
      g.circle(cx, cy, Math.min(w, h) * 0.18).fill(color);
      break;
    case 'air':
      g.ellipse(cx - w * 0.17, cy, w * 0.15, h * 0.2).stroke(line);
      g.ellipse(cx + w * 0.17, cy, w * 0.15, h * 0.2).stroke(line);
      break;
    case 'cavalry':
      g.moveTo(x0, y1).lineTo(x1, y0).stroke(line);
      break;
    case 'missile':
      g.moveTo(cx, y1 - 1).lineTo(cx, y0 + 1).moveTo(cx - 2.5, y0 + 3.5).lineTo(cx, y0 + 1).lineTo(cx + 2.5, y0 + 3.5).stroke(line);
      break;
    case 'naval':
      g.moveTo(cx, y0 + 1.5).lineTo(cx, y1 - 1.5).moveTo(cx - 3, y1 - 3).quadraticCurveTo(cx, y1, cx + 3, y1 - 3).stroke(line);
      break;
    case 'carrier':
      // flight deck with the island, over the anchor
      g.moveTo(x0 + 1.5, cy - 1).lineTo(x1 - 1.5, cy - 1).moveTo(cx + 2, cy - 1).lineTo(cx + 2, y0 + 1.5).stroke(line);
      g.moveTo(cx - 3, y1 - 3).quadraticCurveTo(cx, y1, cx + 3, y1 - 3).stroke(line);
      break;
    default:
      g.circle(cx, cy, 1.6).fill(color);
  }
}
