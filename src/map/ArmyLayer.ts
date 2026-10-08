import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { isFleet } from '../core/military';
import { atWar } from '../core/queries';
import type { Army, ArmyId, GameState } from '../core/types';
import type { World } from '../core/world';
import type { Theme } from '../ui/themes';
import { hexToNum } from '../ui/themes';
import type { Camera } from './camera';
import { drawUnitSymbol } from './unitIcons';

/** Counter size in screen pixels. */
const W = 42, H = 20, GAP = 4;

interface Marker {
  root: Container;
  body: Graphics;
  text: Text;
  shown: number; // rounded strength currently rendered
  key: string; // visual state key (color/selection/battle) to avoid redrawing
  x: number; // displayed world position (eased toward target)
  y: number;
  tx: number;
  ty: number;
  ox: number; // stacking offset in screen px
  oy: number;
}

/**
 * Army counters, movement paths, battle and siege markers. Counters are counter-scaled so they
 * stay a constant, crisp size; positions ease toward the simulated position for smooth motion.
 */
export class ArmyLayer {
  readonly container = new Container();
  private paths = new Graphics();
  private overlay = new Graphics();
  private markersLayer = new Container();
  private markers = new Map<ArmyId, Marker>();
  private state: GameState | null = null;
  private selected = new Set<ArmyId>();
  private preview: { points: [number, number][]; ok: boolean } | null = null;
  /** Strike range ring around a fleet choosing a target. */
  private range: { army: ArmyId; radius: number } | null = null;
  private time = 0;
  /** Reduced motion: no marker easing or pulsing. */
  reduceMotion = false;
  private lastPulse = 0;
  /** Something changed that needs paths/overlay redrawn. */
  private dirty = true;

  constructor(private world: World, private theme: Theme, private camera: Camera) {
    this.container.addChild(this.paths, this.overlay, this.markersLayer);
  }

  setState(state: GameState) {
    this.state = state;
    this.dirty = true;
    const seen = new Set<ArmyId>();
    // stack idle armies per province: troops above the province centre, fleets below it
    const stacks = new Map<string, Army[]>();
    const stackKey = (a: Army) => `${a.location}|${isFleet(this.world, a.unitType) ? 's' : 'l'}`;
    for (const a of Object.values(state.armies)) {
      if (a.progress > 0) continue;
      const k = stackKey(a);
      if (!stacks.has(k)) stacks.set(k, []);
      stacks.get(k)!.push(a);
    }
    for (const list of stacks.values()) list.sort((a, b) => (a.owner === b.owner ? (a.id < b.id ? -1 : 1) : a.owner < b.owner ? -1 : 1));

    for (const a of Object.values(state.armies)) {
      seen.add(a.id);
      let m = this.markers.get(a.id);
      const [tx, ty] = this.armyWorldPos(a);
      if (!m) m = this.createMarker(a, tx, ty);
      m.tx = tx;
      m.ty = ty;
      if (a.progress > 0) {
        m.ox = 0;
        m.oy = 0;
      } else {
        const list = stacks.get(stackKey(a))!;
        const i = list.indexOf(a), n = list.length;
        const perRow = 3;
        const row = Math.floor(i / perRow), col = i % perRow, inRow = Math.min(perRow, n - row * perRow);
        m.ox = (col - (inRow - 1) / 2) * (W + GAP);
        m.oy = isFleet(this.world, a.unitType) ? 17 + row * (H + GAP) : -(17 + row * (H + GAP));
      }
      this.styleMarker(m, a);
    }
    for (const [id, m] of this.markers) {
      if (seen.has(id)) continue;
      m.root.destroy({ children: true });
      this.markers.delete(id);
    }
  }

  /** One army, several (a group order), or none. */
  setSelected(ids: ArmyId | ArmyId[] | null) {
    this.selected = new Set(ids === null ? [] : Array.isArray(ids) ? ids : [ids]);
    this.dirty = true;
    if (this.state) this.setState(this.state);
  }

  /** Path preview for a pending move order (world points, starting at the army). */
  setPreview(points: [number, number][] | null, ok = true) {
    this.preview = points ? { points, ok } : null;
    this.dirty = true;
  }

  /** Shows the strike range of a fleet (map units), or hides it. */
  setRange(army: ArmyId | null, radius = 0) {
    this.range = army ? { army, radius } : null;
    this.dirty = true;
  }

  /** Visible counters whose centre lies inside a screen rectangle. */
  inScreenRect(x0: number, y0: number, x1: number, y1: number): ArmyId[] {
    const [ax, bx] = x0 < x1 ? [x0, x1] : [x1, x0], [ay, by] = y0 < y1 ? [y0, y1] : [y1, y0];
    const out: ArmyId[] = [];
    for (const [id, m] of this.markers) {
      if (!m.root.visible) continue;
      const [px, py] = this.camera.worldToScreen(m.x, m.y);
      const cx = px + m.ox, cy = py + m.oy;
      if (cx >= ax && cx <= bx && cy >= ay && cy <= by) out.push(id);
    }
    return out;
  }

  /** Army under a screen point, preferring the player's own armies. */
  pick(sx: number, sy: number): ArmyId | null {
    let best: ArmyId | null = null;
    for (const [id, m] of this.markers) {
      if (!m.root.visible) continue;
      const [px, py] = this.camera.worldToScreen(m.x, m.y);
      if (Math.abs(sx - (px + m.ox)) <= W / 2 && Math.abs(sy - (py + m.oy)) <= H / 2) {
        if (!best || this.state?.armies[id]?.owner === this.state?.playerNation) best = id;
      }
    }
    return best;
  }

  /** Advances marker easing and redraws what changed. Returns true if a new frame is needed. */
  update(dt: number, cameraChanged: boolean): boolean {
    const s = this.state;
    if (!s) return false;
    this.time += dt;
    const z = this.camera.zoom, inv = 1 / z;
    const k = this.reduceMotion ? 1 : 1 - Math.exp(-dt * 8);
    const player = s.playerNation;
    let animating = false;
    for (const [id, m] of this.markers) {
      const a = s.armies[id];
      if (!a) continue;
      if (Math.abs(m.tx - m.x) * z > 0.15 || Math.abs(m.ty - m.y) * z > 0.15) {
        m.x += (m.tx - m.x) * k;
        m.y += (m.ty - m.y) * k;
        animating = true;
      } else {
        m.x = m.tx;
        m.y = m.ty;
      }
      const mine = a.owner === player;
      const hostile = !!player && atWar(s, player, a.owner);
      m.root.visible = z >= 0.9 || mine || (z >= 0.45 && hostile) || this.selected.has(id);
      m.root.position.set(m.x + m.ox * inv, m.y + m.oy * inv);
      m.root.scale.set(inv);
    }
    // battle markers pulse: redraw them at ~20 fps rather than every frame
    const pulsing = !this.reduceMotion && Object.keys(s.battles).length > 0 && this.time - this.lastPulse > 0.05;
    const redraw = this.dirty || cameraChanged || animating;
    if (redraw) this.drawPaths(z);
    if (redraw || pulsing) {
      this.drawOverlay(z);
      this.lastPulse = this.time;
    }
    this.dirty = false;
    return redraw || pulsing;
  }

  // ---- internals ----------------------------------------------------------------------------------

  private armyWorldPos(a: Army): [number, number] {
    const from = this.world.provinces[a.location].label;
    if (a.progress <= 0 || !a.path.length) return [from[0], from[1]];
    const to = this.world.provinces[a.path[0]].label;
    return [from[0] + (to[0] - from[0]) * a.progress, from[1] + (to[1] - from[1]) * a.progress];
  }

  private createMarker(a: Army, x: number, y: number): Marker {
    const root = new Container();
    const body = new Graphics();
    const text = new Text({
      text: '',
      resolution: Math.min(window.devicePixelRatio || 1, 2) * 1.25,
      style: new TextStyle({ fontFamily: this.theme.labelFont, fontSize: 12, fontWeight: '600', fill: '#ffffff', stroke: { color: '#000000', width: 2.5, join: 'round' } }),
    });
    text.anchor.set(0.5);
    text.position.set(9, 0);
    root.addChild(body, text);
    this.markersLayer.addChild(root);
    const m: Marker = { root, body, text, shown: -1, key: '', x, y, tx: x, ty: y, ox: 0, oy: 0 };
    this.markers.set(a.id, m);
    return m;
  }

  private styleMarker(m: Marker, a: Army) {
    const s = this.state!;
    const shown = Math.round(a.strength);
    if (shown !== m.shown) {
      m.text.text = String(shown);
      m.shown = shown;
    }
    const player = s.playerNation;
    const inBattle = s.battles[a.location] !== undefined && a.progress === 0;
    const rel = a.owner === player ? 'own' : player && atWar(s, player, a.owner) ? 'enemy' : 'other';
    const health = Math.round((a.strength / a.maxStrength) * 10);
    const key = `${a.owner}|${this.selected.has(a.id)}|${inBattle}|${rel}|${health}|${a.unitType}`;
    if (key === m.key) return;
    m.key = key;
    const color = hexToNum(s.nations[a.owner]?.color ?? '#888888');
    const g = m.body.clear();
    const selected = this.selected.has(a.id);
    if (selected) g.roundRect(-W / 2 - 3, -H / 2 - 3, W + 6, H + 6, 6).fill({ color: this.theme.map.selection, alpha: 0.95 });
    const edge = rel === 'enemy' ? 0xc0392b : rel === 'own' ? 0xf4ecd8 : 0x1b1b1b;
    // fleets are pill-shaped so they read as ships at a glance
    const radius = isFleet(this.world, a.unitType) ? H / 2 : 4;
    g.roundRect(-W / 2, -H / 2, W, H, radius).fill(color).stroke({ width: rel === 'other' ? 1.2 : 1.8, color: edge });
    // darker strip behind the symbol for contrast
    g.roundRect(-W / 2 + 2, -H / 2 + 2, 18, H - 4, 2).fill({ color: 0x000000, alpha: 0.28 });
    drawUnitSymbol(g, a.unitType, -W / 2 + 11, -0.5, 15, 11, 0xffffff);
    // strength bar
    const frac = Math.max(0, Math.min(1, a.strength / a.maxStrength));
    g.rect(-W / 2 + 2, H / 2 - 3, (W - 4) * frac, 2).fill(frac > 0.6 ? 0x9ccf6a : frac > 0.3 ? 0xe2b64a : 0xe0533d);
    if (inBattle && this.engaged(a)) g.roundRect(-W / 2 - 1.5, -H / 2 - 1.5, W + 3, H + 3, 5).stroke({ width: 1.5, color: 0xff4a3a });
  }

  /** In a battle of its own kind (troops against troops, ships against ships). */
  private engaged(a: Army) {
    const s = this.state!;
    const sea = isFleet(this.world, a.unitType);
    return Object.values(s.armies).some((b) => b.location === a.location && b.progress === 0 && isFleet(this.world, b.unitType) === sea && atWar(s, a.owner, b.owner));
  }

  private drawPaths(z: number) {
    const g = this.paths.clear();
    const s = this.state!;
    const player = s.playerNation;
    const w = (px: number) => px / z;
    for (const a of Object.values(s.armies)) {
      if (!a.path.length || (a.owner !== player && !this.selected.has(a.id))) continue;
      const m = this.markers.get(a.id);
      if (!m) continue;
      const pts: [number, number][] = [[m.x, m.y], ...a.path.map((p) => this.world.provinces[p].label)];
      const sel = this.selected.has(a.id);
      dashed(g, pts, w(sel ? 7 : 5), w(4));
      g.stroke({ width: w(sel ? 2.4 : 1.6), color: sel ? this.theme.map.selection : 0xffffff, alpha: sel ? 0.95 : 0.7, cap: 'round' });
      arrowHead(g, pts, w(sel ? 9 : 7));
      g.fill({ color: sel ? this.theme.map.selection : 0xffffff, alpha: sel ? 0.95 : 0.7 });
    }
    if (this.preview && this.preview.points.length > 1) {
      const color = this.preview.ok ? 0xffffff : 0xff5a4a;
      dashed(g, this.preview.points, w(6), w(5));
      g.stroke({ width: w(2), color, alpha: 0.9, cap: 'round' });
      if (this.preview.ok) {
        arrowHead(g, this.preview.points, w(9));
        g.fill({ color, alpha: 0.9 });
      }
    }
  }

  private drawOverlay(z: number) {
    const g = this.overlay.clear();
    const s = this.state!;
    const px = (v: number) => v / z;
    const pulse = this.reduceMotion ? 1 : 0.55 + 0.45 * Math.sin(this.time * 5);
    for (const province of Object.keys(s.battles)) {
      const [x, y] = this.world.provinces[province].label;
      const cy = y;
      const r = px(9);
      g.circle(x, cy, r * 1.25).fill({ color: 0x8e1b12, alpha: 0.85 * pulse + 0.15 });
      // crossed swords
      g.moveTo(x - r * 0.65, cy - r * 0.65).lineTo(x + r * 0.65, cy + r * 0.65)
        .moveTo(x + r * 0.65, cy - r * 0.65).lineTo(x - r * 0.65, cy + r * 0.65)
        .stroke({ width: px(2), color: 0xffffff, cap: 'round' });
      g.moveTo(x - r * 0.75, cy + r * 0.3).lineTo(x - r * 0.3, cy + r * 0.75)
        .moveTo(x + r * 0.75, cy + r * 0.3).lineTo(x + r * 0.3, cy + r * 0.75)
        .stroke({ width: px(1.6), color: 0xffffff, cap: 'round' });
    }
    if (this.range) {
      const m = this.markers.get(this.range.army);
      if (m) {
        g.circle(m.x, m.y, this.range.radius).fill({ color: 0xff7a3a, alpha: 0.08 }).stroke({ width: px(1.5), color: 0xff7a3a, alpha: 0.85 });
      }
    }
    for (const [province, p] of Object.entries(s.provinces)) {
      if (!p.siege) continue;
      const [x, y] = this.world.provinces[province].label;
      const cy = y;
      const r = px(8);
      const color = hexToNum(s.nations[p.siege.by]?.color ?? '#ffffff');
      g.circle(x, cy, r + px(2)).fill({ color: 0x000000, alpha: 0.45 });
      g.moveTo(x, cy).arc(x, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.siege.progress).lineTo(x, cy).fill({ color, alpha: 0.95 });
      g.circle(x, cy, r).stroke({ width: px(1.2), color: 0xffffff, alpha: 0.9 });
    }
  }
}

/** Adds a dashed polyline to the graphics path (stroke afterwards). */
function dashed(g: Graphics, pts: [number, number][], dash: number, gap: number) {
  let on = true, left = dash;
  for (let i = 1; i < pts.length; i++) {
    let [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    let segLen = Math.hypot(x1 - x0, y1 - y0);
    const ux = (x1 - x0) / (segLen || 1), uy = (y1 - y0) / (segLen || 1);
    while (segLen > 0) {
      const step = Math.min(left, segLen);
      const nx = x0 + ux * step, ny = y0 + uy * step;
      if (on) g.moveTo(x0, y0).lineTo(nx, ny);
      x0 = nx; y0 = ny; segLen -= step; left -= step;
      if (left <= 0) { on = !on; left = on ? dash : gap; }
    }
  }
}

function arrowHead(g: Graphics, pts: [number, number][], size: number) {
  const [x1, y1] = pts[pts.length - 1];
  const [x0, y0] = pts[pts.length - 2];
  const a = Math.atan2(y1 - y0, x1 - x0);
  g.poly([
    x1, y1,
    x1 - Math.cos(a - 0.45) * size, y1 - Math.sin(a - 0.45) * size,
    x1 - Math.cos(a + 0.45) * size, y1 - Math.sin(a + 0.45) * size,
  ]);
}
