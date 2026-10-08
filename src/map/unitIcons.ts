import type { Graphics } from 'pixi.js';

/**
 * Unit pictograms drawn as vectors inside a w x h box centred at (cx, cy): a helmet for infantry,
 * a tank, a cannon, a plane… readable at counter size. Era-specific unit ids map onto a handful
 * of families.
 */
export type UnitSymbol = 'infantry' | 'shield' | 'armor' | 'artillery' | 'cavalry' | 'chariot' | 'archer' | 'air' | 'drone' | 'naval' | 'carrier' | 'generic';

const FAMILY: Record<string, UnitSymbol> = {
  infantry: 'infantry', militia: 'infantry', guard: 'infantry', arquebusiers: 'infantry',
  spearmen: 'shield', legion: 'shield', pikemen: 'shield', auxilia: 'shield', comitatenses: 'shield', foederati: 'shield',
  armor: 'armor', tanks: 'armor', mech: 'armor',
  artillery: 'artillery', siege: 'artillery', cannon: 'artillery',
  archers: 'archer',
  chariots: 'chariot',
  cavalry: 'cavalry', knights: 'cavalry', 'horse-archers': 'cavalry',
  air: 'air', aircraft: 'air',
  drones: 'drone',
  navy: 'naval', fleet: 'naval', galleys: 'naval', triremes: 'naval', dromons: 'naval', carracks: 'naval',
  dreadnoughts: 'naval', battleships: 'naval', destroyers: 'naval', carriers: 'carrier',
};

export const symbolOf = (unitType: string): UnitSymbol => FAMILY[unitType] ?? 'generic';

/** Plain-language names of the symbols (for tooltips and the rules screen). */
export const SYMBOL_NAMES: Record<UnitSymbol, string> = {
  infantry: 'helmet: infantry', shield: 'shield: foot soldiers', armor: 'tank: armour', artillery: 'cannon: artillery',
  cavalry: 'horseshoe: cavalry', chariot: 'wheel: chariots', archer: 'bow: archers', air: 'plane: air force', drone: 'quadcopter: drones',
  naval: 'anchor: fleet', carrier: 'deck: carrier', generic: 'troops',
};

export function drawUnitSymbol(g: Graphics, unitType: string, cx: number, cy: number, w: number, h: number, color: number) {
  // work in a 16 x 12 design box, scaled into w x h
  const sx = w / 16, sy = h / 12;
  const X = (x: number) => cx + (x - 8) * sx, Y = (y: number) => cy + (y - 6) * sy;
  const poly = (pts: number[]) => g.poly(pts.map((v, i) => (i % 2 ? Y(v) : X(v)))).fill(color);
  const line = (pts: number[], width = 1.4) => {
    g.moveTo(X(pts[0]), Y(pts[1]));
    for (let i = 2; i < pts.length; i += 2) g.lineTo(X(pts[i]), Y(pts[i + 1]));
    g.stroke({ width, color, cap: 'round', join: 'round' });
  };
  const s = Math.min(sx, sy);
  switch (symbolOf(unitType)) {
    case 'infantry': // helmet with brim
      g.ellipse(X(8), Y(6.5), 5.2 * sx, 4.2 * sy).fill(color);
      g.rect(X(1.5), Y(6.6), 13 * sx, 4.2 * sy).cut(); // flatten the bottom
      poly([1, 7, 15, 7, 15, 8.4, 1, 8.4]);
      break;
    case 'shield': // round-topped shield with a boss
      poly([3.5, 1.5, 12.5, 1.5, 12.5, 7, 8, 11, 3.5, 7]);
      g.circle(X(8), Y(5.5), 1.4 * s).cut();
      break;
    case 'armor': // tank: tracks, hull, turret, gun
      g.roundRect(X(1), Y(7.5), 14 * sx, 3.2 * sy, 1.6 * s).fill(color);
      poly([2.5, 7.5, 13.5, 7.5, 12, 5, 4, 5]);
      g.roundRect(X(5.5), Y(2.8), 5 * sx, 2.6 * sy, 1 * s).fill(color);
      line([10.5, 3.9, 15, 3.9], 1.3);
      break;
    case 'artillery': // cannon barrel on a wheel
      line([2, 9, 13.5, 3.5], 2.4);
      g.circle(X(6), Y(8.6), 2.4 * s).stroke({ width: 1.3, color });
      g.circle(X(6), Y(8.6), 0.6 * s).fill(color);
      break;
    case 'cavalry': // horseshoe
      g.arc(X(8), Y(5.5), 4.6 * s, Math.PI * 0.95, Math.PI * 2.05, false).stroke({ width: 2.4, color, cap: 'butt' });
      line([3.4, 5.6, 3.4, 10.5], 2.4);
      line([12.6, 5.6, 12.6, 10.5], 2.4);
      break;
    case 'chariot': // spoked wheel
      g.circle(X(8), Y(6), 4.8 * s).stroke({ width: 1.4, color });
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 4;
        line([8 - Math.cos(a) * 4.6, 6 - Math.sin(a) * 4.6 * (sx / sy), 8 + Math.cos(a) * 4.6, 6 + Math.sin(a) * 4.6 * (sx / sy)], 1);
      }
      g.circle(X(8), Y(6), 1.1 * s).fill(color);
      break;
    case 'archer': // bow, string and arrow
      g.arc(X(5), Y(6), 5.2 * s, -Math.PI / 2.4, Math.PI / 2.4, false).stroke({ width: 1.5, color });
      line([6.8, 1.2, 6.8, 10.8], 0.8);
      line([3, 6, 14.5, 6], 1.2);
      poly([14.8, 6, 12.2, 4.4, 12.2, 7.6]);
      break;
    case 'air': // plane seen from above
      poly([8, 0.6, 9, 3, 9, 4.6, 15.4, 7, 15.4, 8.2, 9, 7, 8.8, 9.6, 11, 11, 11, 11.6, 8, 10.8, 5, 11.6, 5, 11, 7.2, 9.6, 7, 7, 0.6, 8.2, 0.6, 7, 7, 4.6, 7, 3]);
      break;
    case 'drone': // quadcopter
      line([3.4, 2.4, 12.6, 9.6], 1.3);
      line([12.6, 2.4, 3.4, 9.6], 1.3);
      for (const [x, y] of [[3.4, 2.4], [12.6, 2.4], [3.4, 9.6], [12.6, 9.6]]) g.circle(X(x), Y(y), 2.1 * s).stroke({ width: 1.1, color });
      g.rect(X(6.8), Y(4.9), 2.4 * sx, 2.2 * sy).fill(color);
      break;
    case 'naval': // anchor
      line([8, 2, 8, 10.5], 1.6);
      line([5.5, 3.6, 10.5, 3.6], 1.4);
      g.arc(X(8), Y(6.6), 4.2 * s, Math.PI * 0.15, Math.PI * 0.85, false).stroke({ width: 1.6, color, cap: 'round' });
      g.circle(X(8), Y(1.6), 1 * s).stroke({ width: 1, color });
      break;
    case 'carrier': // flat deck with island
      poly([0.8, 7, 15.2, 7, 13.6, 10, 2.4, 10]);
      g.rect(X(10), Y(3.6), 2.2 * sx, 3.4 * sy).fill(color);
      break;
    default:
      g.circle(cx, cy, 2 * s).fill(color);
  }
}
