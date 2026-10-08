import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { allied, atWar, friendly, getRelation } from '../core/queries';
import type { GameState, NationId } from '../core/types';
import { lighten, mix, type Theme } from '../ui/themes';
import type { World } from '../core/world';
import { ArmyLayer } from './ArmyLayer';
import { Camera } from './camera';
import { provinceContains, type MapData, type ProvinceGeo } from './mapData';

/** How provinces are coloured: by owner, by their feelings towards the player, or by alignment. */
export type MapMode = 'political' | 'relations' | 'alliances';

/** Alliances mode colours (also used by the legend). */
export const ALIGNMENT_COLORS = { you: '#3d7fd6', ally: '#3fa86b', friend: '#9cc9a6', enemy: '#d0453a', neutral: '#8f8f8a' } as const;

/** hover/select/command carry a province id; army carries an army id. */
type MapEvent = 'hover' | 'select' | 'army' | 'command';

/** Drag-an-army-to-order gesture; the HUD decides what dragging and dropping mean. */
export interface ArmyDragHooks {
  canDrag(army: string): boolean;
  /** Called continuously while dragging: province under the cursor (or null) and the cursor in world space. */
  move(army: string, province: string | null, world: [number, number]): void;
  drop(army: string, province: string | null): void;
}
/** Shift held: add to / remove from the current group of armies. */
export interface PickMods { shift: boolean }
type Handler = (id: string | null, mods: PickMods) => void;

/** Screen pixel widths for lines; converted to world units on redraw so they stay crisp. */
const LINE = { nation: 1.7, province: 0.8, coast: 1.1, shore: 7, hover: 2, select: 2.6 };

/**
 * Renders the map with PixiJS. Read-only with respect to game state: call `setState` whenever
 * the state changes and it updates colors, borders and labels. User input is reported through
 * `on('hover' | 'select')`; it never modifies the game directly.
 */
export class MapRenderer {
  readonly camera: Camera;
  private app = new Application();
  private world = new Container();
  private fills = new Container();
  private provinceGfx: Graphics[] = [];
  private shadow = new Graphics();
  private shore = new Graphics();
  private land = new Graphics();
  private graticule = new Graphics();
  private provinceBorders = new Graphics();
  private nationBorders = new Graphics();
  private coast = new Graphics();
  private overlay = new Graphics();
  private capitalLayer = new Container();
  private nationLabelLayer = new Container();
  private provinceLabelLayer = new Container();

  private state: GameState | null = null;
  private owners: NationId[] = [];
  private hovered: number | null = null;
  private selected: number | null = null;
  private handlers: Record<MapEvent, Set<Handler>> = { hover: new Set(), select: new Set(), army: new Set(), command: new Set() };
  private armies!: ArmyLayer;
  private opts = { provinceLabels: true, reduceMotion: false, edgeScroll: true };
  /** Set by the HUD to enable dragging armies to give orders. */
  armyDrag: ArmyDragHooks | null = null;
  private draggingArmy: string | null = null;
  private pointerAt: { x: number; y: number } | null = null;
  private hitGrid = new Map<number, number[]>();
  private readonly HIT_CELL = 32;
  private linesBuiltAtZoom = 0;
  private lineRebuildTimer: number | undefined;
  private provinceLabels = new Map<number, Container>();
  private nationLabels: { text: Text; worldSize: number; x: number; y: number }[] = [];
  private nationLabelZoom = 0;
  private dirtyOverlay = true;
  private lastView: [number, number, number] = [0, 0, 0];
  /** Render only when something changed: keeps the GPU free (e.g. for a local LLM) while idle. */
  private needsRender = true;

  private constructor(private el: HTMLElement, private map: MapData, private theme: Theme, private sim: World) {
    this.camera = new Camera(map.width, map.height);
  }

  static async create(el: HTMLElement, map: MapData, theme: Theme, sim: World): Promise<MapRenderer> {
    const r = new MapRenderer(el, map, theme, sim);
    await r.init();
    return r;
  }

  private boxHandlers = new Set<(ids: string[]) => void>();
  private armyHoverHandlers = new Set<(id: string | null) => void>();
  private hoveredArmy: string | null = null;
  /** The army counter under the pointer (or null). */
  onArmyHover(h: (id: string | null) => void) {
    this.armyHoverHandlers.add(h);
    return () => this.armyHoverHandlers.delete(h);
  }
  /** Shift+drag on the map: armies inside the box. */
  onBox(h: (ids: string[]) => void) {
    this.boxHandlers.add(h);
    return () => this.boxHandlers.delete(h);
  }

  on(ev: MapEvent, h: Handler) {
    this.handlers[ev].add(h);
    return () => this.handlers[ev].delete(h);
  }

  private async init() {
    await this.app.init({
      resizeTo: this.el,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      backgroundAlpha: 0,
    });
    this.el.appendChild(this.app.canvas);
    this.app.stage.addChild(this.world);
    this.world.addChild(
      this.graticule, this.shore, this.shadow, this.land, this.fills, this.provinceBorders, this.coast, this.nationBorders,
      this.overlay, this.capitalLayer, this.nationLabelLayer, this.provinceLabelLayer,
    );
    this.armies = new ArmyLayer(this.sim, this.theme, this.camera);
    this.world.addChild(this.armies.container);

    this.buildGraticule();
    this.buildLand();
    this.buildProvinces();
    this.buildHitGrid();
    this.bindInput();

    this.camera.resize(this.app.screen.width, this.app.screen.height);
    this.app.renderer.on('resize', (w: number, h: number) => this.camera.resize(w, h));
    this.app.ticker.remove(this.app.render, this.app);
    this.app.ticker.add((t) => this.tick(t.deltaMS / 1000));
    this.app.renderer.on('resize', () => (this.needsRender = true));
  }

  destroy() {
    window.clearTimeout(this.lineRebuildTimer);
    this.app.destroy(true, { children: true });
  }

  // ---- state ----------------------------------------------------------------------------------

  setState(state: GameState) {
    const prev = this.state;
    this.state = state;
    if (!prev || prev.armies !== state.armies || prev.battles !== state.battles || prev.wars !== state.wars || prev.provinces !== state.provinces)
      this.armies.setState(state);
    const ownersChanged = !prev || prev.provinces !== state.provinces || prev.nations !== state.nations;
    // relations and alliances views change with diplomacy, not just with borders
    if (!ownersChanged && this.mapMode !== 'political' && (prev.relations !== state.relations || prev.wars !== state.wars || prev.treaties !== state.treaties)) {
      this.map.provinces.forEach((_, i) => this.applyTint(i));
      this.needsRender = true;
    }
    if (!ownersChanged) return;
    this.owners = this.map.provinces.map((p) => state.provinces[p.id]?.owner ?? '');
    this.map.provinces.forEach((_, i) => this.applyTint(i));
    this.buildLines();
    this.buildNationLabels();
    this.buildCapitals();
    this.dirtyOverlay = true;
    this.needsRender = true;
  }

  private mapMode: MapMode = 'political';

  /** Recolours every province for a map mode. */
  setMapMode(mode: MapMode) {
    if (mode === this.mapMode) return;
    this.mapMode = mode;
    this.map.provinces.forEach((_, i) => this.applyTint(i));
    this.needsRender = true;
  }

  setSelection(id: string | null) {
    const idx = id ? this.map.byId.get(id)?.index ?? null : null;
    if (idx === this.selected) return;
    this.selected = idx;
    this.dirtyOverlay = true;
    this.needsRender = true;
  }

  /** Display preferences from the settings screen. */
  setOptions(o: Partial<{ provinceLabels: boolean; reduceMotion: boolean; edgeScroll: boolean }>) {
    this.opts = { ...this.opts, ...o };
    this.camera.instant = this.opts.reduceMotion;
    this.armies.reduceMotion = this.opts.reduceMotion;
    this.nationLabelZoom = 0; // force a label refresh
    this.needsRender = true;
  }

  setArmySelection(ids: string | string[] | null) {
    this.armies.setSelected(ids);
  }

  /** Strike range ring around a fleet; null hides it. */
  setStrikeRange(army: string | null, radius = 0) {
    this.armies.setRange(army, radius);
    this.needsRender = true;
  }

  /** Dashed preview of a move order; null clears it. */
  setMovePreview(points: [number, number][] | null, ok = true) {
    this.armies.setPreview(points, ok);
  }

  focusOn(id: string, zoom?: number) {
    const p = this.map.byId.get(id);
    if (!p) return;
    const fitZoom = Math.min(this.camera.viewW, this.camera.viewH) / (Math.sqrt(p.area) * 8);
    this.camera.flyTo(p.label[0], p.label[1], zoom ?? Math.max(this.camera.zoom, fitZoom));
  }

  private nationColor(i: number): number {
    const s = this.state;
    const n = s?.nations[this.owners[i]];
    if (!s || !n) return 0x999999;
    const p = s.playerNation;
    const paper = (c: string) => mix(c, this.theme.map.paper, this.theme.map.paperMix * 0.6);
    if (this.mapMode === 'relations' && p) {
      if (n.id === p) return paper(ALIGNMENT_COLORS.you);
      const r = getRelation(s, p, n.id); // -100 … 100: red … grey … green
      return r >= 0 ? mix('#8f8f8a', '#3fa86b', r / 100) : mix('#8f8f8a', '#d0453a', -r / 100);
    }
    if (this.mapMode === 'alliances' && p) {
      const c = n.id === p ? ALIGNMENT_COLORS.you : atWar(s, p, n.id) ? ALIGNMENT_COLORS.enemy : allied(s, p, n.id) ? ALIGNMENT_COLORS.ally
        : friendly(s, p, n.id) ? ALIGNMENT_COLORS.friend : ALIGNMENT_COLORS.neutral;
      return paper(c);
    }
    return mix(n.color, this.theme.map.paper, this.theme.map.paperMix);
  }

  private applyTint(i: number) {
    const base = this.nationColor(i);
    this.provinceGfx[i].tint = i === this.hovered ? lighten(base, 0.22) : base;
  }

  // ---- static geometry --------------------------------------------------------------------------

  private buildProvinces() {
    const sh = this.shadow;
    for (const p of this.map.provinces) {
      const g = new Graphics();
      for (const poly of p.polygons) {
        // A hairline stroke in the fill color closes tiny gaps between source polities.
        g.poly(poly[0]).fill(0xffffff).stroke({ width: 0.5, color: 0xffffff, join: 'round' });
        for (let h = 1; h < poly.length; h++) g.poly(poly[h]).cut();
        sh.poly(poly[0]);
      }
      this.fills.addChild(g);
      this.provinceGfx.push(g);
    }
    sh.fill({ color: this.theme.map.landShadow, alpha: this.theme.map.landShadowAlpha });
  }

  /** Unclaimed land under the provinces (ancient maps have plenty). */
  private buildLand() {
    const g = this.land;
    for (const poly of this.map.land) {
      g.poly(poly[0]);
      this.shadow.poly(poly[0]);
    }
    g.fill({ color: this.theme.map.unclaimed, alpha: 0.95 }).stroke({ width: 0.6, color: this.theme.map.coast, alpha: 0.45, join: 'round' });
  }

  private buildGraticule() {
    const g = this.graticule;
    const W = this.map.width, H = this.map.height;
    const R = W / (2 * Math.PI);
    const millerY = (lat: number) => -R * 1.25 * Math.log(Math.tan(Math.PI / 4 + (0.4 * lat * Math.PI) / 180));
    const yTop = millerY(84);
    for (let lon = -180; lon <= 180; lon += 15) g.moveTo(((lon + 180) / 360) * W, 0).lineTo(((lon + 180) / 360) * W, H);
    for (let lat = -45; lat <= 75; lat += 15) {
      const y = millerY(lat) - yTop;
      g.moveTo(0, y).lineTo(W, y);
    }
    g.stroke({ width: 0.6, color: this.theme.map.graticule, alpha: this.theme.map.graticuleAlpha });
  }

  /** Borders are classified from current ownership and stroked at a constant pixel width. */
  private buildLines() {
    const z = this.camera.zoom;
    this.linesBuiltAtZoom = z;
    const m = this.theme.map;
    const pb = this.provinceBorders.clear();
    const nb = this.nationBorders.clear();
    const coast = this.coast.clear();
    const shore = this.shore.clear();
    for (const seg of this.map.borders) {
      const c = seg.coords;
      const target = seg.b < 0 ? coast : this.owners[seg.a] !== this.owners[seg.b] ? nb : pb;
      target.moveTo(c[0], c[1]);
      for (let i = 2; i < c.length; i += 2) target.lineTo(c[i], c[i + 1]);
      if (seg.b < 0) {
        shore.moveTo(c[0], c[1]);
        for (let i = 2; i < c.length; i += 2) shore.lineTo(c[i], c[i + 1]);
      }
    }
    const w = (px: number) => px / z;
    shore.stroke({ width: w(LINE.shore), color: m.shore, alpha: m.shoreAlpha, join: 'round', cap: 'round' });
    pb.stroke({ width: w(LINE.province), color: m.provinceBorder, alpha: m.provinceBorderAlpha, join: 'round', cap: 'round' });
    coast.stroke({ width: w(LINE.coast), color: m.coast, alpha: 0.75, join: 'round', cap: 'round' });
    nb.stroke({ width: w(LINE.nation), color: m.nationBorder, alpha: 0.85, join: 'round', cap: 'round' });
    this.shadow.position.set(w(1.2), w(1.8));
    this.dirtyOverlay = true;
    this.needsRender = true;
  }

  private drawOverlay() {
    this.dirtyOverlay = false;
    const g = this.overlay.clear();
    const z = this.camera.zoom;
    const outline = (i: number, px: number, color: number, alpha: number) => {
      for (const poly of this.map.provinces[i].polygons) for (const r of poly) g.poly(r);
      g.stroke({ width: px / z, color, alpha, join: 'round' });
    };
    if (this.hovered !== null && this.hovered !== this.selected) outline(this.hovered, LINE.hover, this.theme.map.hover, 0.9);
    if (this.selected !== null) {
      for (const poly of this.map.provinces[this.selected].polygons) for (const r of poly) g.poly(r);
      g.fill({ color: this.theme.map.selection, alpha: 0.18 });
      outline(this.selected, LINE.select + 2, 0x000000, 0.35);
      outline(this.selected, LINE.select, this.theme.map.selection, 1);
    }
  }

  // ---- labels -----------------------------------------------------------------------------------

  /** One label per connected territory chunk of each nation (big enough to read). */
  private buildNationLabels() {
    if (!this.state) return;
    for (const l of this.nationLabels) l.text.destroy();
    this.nationLabels = [];
    const seen = new Uint8Array(this.map.provinces.length);
    const chunks = new Map<NationId, { members: number[]; area: number }[]>();
    for (let i = 0; i < this.map.provinces.length; i++) {
      if (seen[i]) continue;
      const owner = this.owners[i];
      const members: number[] = [];
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const j = stack.pop()!;
        members.push(j);
        for (const nid of this.map.provinces[j].neighbors) {
          const k = this.map.byId.get(nid)!.index;
          if (!seen[k] && this.owners[k] === owner) { seen[k] = 1; stack.push(k); }
        }
      }
      const area = members.reduce((s, j) => s + this.map.provinces[j].area, 0);
      if (!chunks.has(owner)) chunks.set(owner, []);
      chunks.get(owner)!.push({ members, area });
    }
    for (const [owner, list] of chunks) {
      const nation = this.state.nations[owner];
      if (!nation) continue;
      list.sort((a, b) => b.area - a.area);
      list.forEach((chunk, idx) => {
        // main chunk always; secondary chunks only if substantial (e.g. Alaska, colonies)
        if (idx > 0 && chunk.area < Math.max(400, list[0].area * 0.15)) return;
        const pos = this.chunkAnchor(chunk.members);
        const worldSize = Math.max(4, Math.min(70, Math.sqrt(chunk.area) * 0.16));
        const name = (nation.shortName || nation.name).toUpperCase();
        const text = new Text({
          text: name,
          style: new TextStyle({
            fontFamily: this.theme.labelFont, fontSize: 32, fontWeight: this.theme.labelWeight as TextStyle['fontWeight'], letterSpacing: this.theme.labelLetterSpacing,
            fill: this.theme.map.labelFill, stroke: { color: this.theme.map.labelStroke, width: 4, join: 'round' },
          }),
        });
        text.anchor.set(0.5);
        text.position.set(pos[0], pos[1]);
        // scale so the text's cap height ~ worldSize; long names shrink to fit the territory
        const span = Math.sqrt(chunk.area) * 1.1;
        const s = Math.min(worldSize / 32, span / Math.max(1, text.width));
        text.scale.set(s);
        this.nationLabelLayer.addChild(text);
        this.nationLabels.push({ text, worldSize: 32 * s, x: pos[0], y: pos[1] });
      });
    }
    this.nationLabelZoom = 0;
  }

  /** Area-weighted centroid of a chunk, snapped to the closest member's label point. */
  private chunkAnchor(members: number[]): [number, number] {
    let sx = 0, sy = 0, sa = 0;
    for (const j of members) {
      const p = this.map.provinces[j];
      sx += p.label[0] * p.area;
      sy += p.label[1] * p.area;
      sa += p.area;
    }
    const cx = sx / sa, cy = sy / sa;
    if (members.some((j) => provinceContains(this.map.provinces[j], cx, cy))) return [cx, cy];
    let best = members[0], bd = Infinity;
    for (const j of members) {
      const p = this.map.provinces[j];
      const d = (p.label[0] - cx) ** 2 + (p.label[1] - cy) ** 2;
      if (d < bd) { bd = d; best = j; }
    }
    return this.map.provinces[best].label;
  }

  private buildCapitals() {
    if (!this.state) return;
    this.capitalLayer.removeChildren().forEach((c) => c.destroy());
    for (const n of Object.values(this.state.nations)) {
      if (!n.capital) continue;
      const p = this.map.byId.get(n.capital);
      if (!p) continue;
      const g = new Graphics();
      star(g, 0, 0, 5, 2.2);
      g.fill(this.theme.map.capital).stroke({ width: 1.2, color: 0xffffff, alpha: 0.9 });
      g.position.set(p.label[0], p.label[1]);
      g.label = n.major ? 'capital-major' : 'capital';
      this.capitalLayer.addChild(g);
    }
  }

  private provinceLabel(i: number): Container {
    let c = this.provinceLabels.get(i);
    if (c) return c;
    const p = this.map.provinces[i];
    c = new Container();
    c.visible = false; // shown by updateLabels only if it wins the collision check
    const t = new Text({
      text: p.name,
      resolution: Math.min(window.devicePixelRatio || 1, 2) * 1.5,
      style: new TextStyle({
        fontFamily: this.theme.labelFont, fontSize: 11, fontWeight: this.theme.provinceLabelWeight as TextStyle['fontWeight'], letterSpacing: 0.3,
        fill: this.theme.map.provinceLabelFill, stroke: { color: this.theme.map.provinceLabelStroke, width: 3, join: 'round' },
      }),
    });
    t.anchor.set(0.5, p.city ? -0.25 : 0.5);
    c.addChild(t);
    if (p.city) {
      const dot = new Graphics().circle(0, 0, 2.2).fill(this.theme.map.provinceLabelFill).stroke({ width: 1, color: 0xffffff });
      c.addChild(dot);
    }
    c.position.set(p.label[0], p.label[1]);
    this.provinceLabelLayer.addChild(c);
    this.provinceLabels.set(i, c);
    return c;
  }

  /** Counter-scales labels so they stay crisp and a constant on-screen size; culls by zoom/viewport. */
  private updateLabels() {
    const z = this.camera.zoom;
    const [x0, y0, x1, y1] = this.camera.viewRect();
    const pad = 60 / z;

    // Nation labels scale with the map; re-raster when the zoom changes enough to stay sharp.
    const reRaster = this.nationLabelZoom === 0 || z / this.nationLabelZoom > 1.3 || z / this.nationLabelZoom < 0.77;
    if (reRaster) this.nationLabelZoom = z;
    const provinceMode = z > 3;
    for (const l of this.nationLabels) {
      const px = l.worldSize * z;
      const visible = px > 9 && l.x > x0 - pad * 4 && l.x < x1 + pad * 4 && l.y > y0 - pad * 4 && l.y < y1 + pad * 4;
      l.text.visible = visible;
      if (!visible) continue;
      // fade out big labels when zoomed in to provinces
      l.text.alpha = provinceMode ? Math.max(0, Math.min(0.85, 1.6 - px / 70)) : Math.min(0.92, (px - 9) / 6);
      if (reRaster) {
        const res = Math.max(0.5, Math.min(6, (px / 32) * (window.devicePixelRatio || 1) * 1.2));
        if (Math.abs(l.text.resolution - res) / res > 0.15) l.text.resolution = res;
      }
    }

    const inv = 1 / z;
    for (const c of this.capitalLayer.children) {
      c.scale.set(inv);
      c.visible = z > 0.6 || c.label === 'capital-major';
    }

    // Greedy collision: bigger labels claim screen space first, overlapping smaller ones hide.
    const placed: [number, number, number, number][] = [];
    const claim = (cx: number, cy: number, w: number, hgt: number, gap: number) => {
      const r: [number, number, number, number] = [cx - w / 2 - gap, cy - hgt / 2 - gap, cx + w / 2 + gap, cy + hgt / 2 + gap];
      if (placed.some((o) => r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1])) return false;
      placed.push(r);
      return true;
    };
    const visibleNations = this.nationLabels.filter((l) => l.text.visible).sort((a, b) => b.worldSize - a.worldSize);
    for (const l of visibleNations) {
      if (l.text.alpha < 0.3) continue; // faded labels don't block province names
      const [sx, sy] = this.camera.worldToScreen(l.x, l.y);
      if (!claim(sx, sy, l.text.width * z, l.text.height * z * 0.75, 2)) l.text.visible = false;
    }

    // Province labels: shown when the province is big enough on screen and there is room.
    for (const [, c] of this.provinceLabels) c.visible = false;
    if (z < 1.6 || !this.opts.provinceLabels) return;
    const candidates = this.map.provinces.filter((p) => {
      const [lx, ly] = p.label;
      if (lx < x0 - pad || lx > x1 + pad || ly < y0 - pad || ly > y1 + pad) return false;
      return Math.sqrt(p.area) * z >= (p.city ? 55 : 80);
    });
    candidates.sort((a, b) => Number(b.city) - Number(a.city) || b.pop - a.pop || b.area - a.area);
    for (const p of candidates) {
      const c = this.provinceLabel(p.index);
      const t = c.children[0] as Text;
      const [sx, sy] = this.camera.worldToScreen(p.label[0], p.label[1]);
      if (!claim(sx, sy + (p.city ? t.height * 0.75 : 0), t.width, t.height * 0.8, 3)) continue;
      c.visible = true;
      c.scale.set(inv);
    }
  }

  // ---- input ------------------------------------------------------------------------------------

  private buildHitGrid() {
    const C = this.HIT_CELL;
    const cols = Math.ceil(this.map.width / C);
    for (const p of this.map.provinces) {
      const [x0, y0, x1, y1] = p.bbox;
      for (let gx = Math.floor(x0 / C); gx <= Math.floor(x1 / C); gx++)
        for (let gy = Math.floor(y0 / C); gy <= Math.floor(y1 / C); gy++) {
          const k = gy * cols + gx;
          let list = this.hitGrid.get(k);
          if (!list) this.hitGrid.set(k, (list = []));
          list.push(p.index);
        }
    }
  }

  pick(sx: number, sy: number): ProvinceGeo | null {
    const [wx, wy] = this.camera.screenToWorld(sx, sy);
    const C = this.HIT_CELL;
    const list = this.hitGrid.get(Math.floor(wy / C) * Math.ceil(this.map.width / C) + Math.floor(wx / C));
    if (!list) return null;
    for (const i of list) if (provinceContains(this.map.provinces[i], wx, wy)) return this.map.provinces[i];
    return null;
  }

  private bindInput() {
    const canvas = this.app.canvas;
    const pointers = new Map<number, { x: number; y: number }>();
    let downAt: { x: number; y: number } | null = null;
    let moved = false;
    let lastMoveT = 0;
    let pinchDist = 0;
    const rel = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const { x, y } = rel(e);
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      this.camera.zoomAt(x, y, Math.exp(-delta * 0.0018));
    }, { passive: false });

    let button = 0;
    let shift = false;
    // shift+drag draws a selection box (a plain DOM rectangle over the canvas)
    let boxFrom: { x: number; y: number } | null = null;
    const boxEl = document.createElement('div');
    boxEl.className = 'select-box';
    canvas.parentElement?.append(boxEl);
    const drawBox = (to: { x: number; y: number } | null) => {
      if (!boxFrom || !to) { boxEl.style.display = 'none'; return; }
      Object.assign(boxEl.style, { display: 'block', left: `${Math.min(boxFrom.x, to.x)}px`, top: `${Math.min(boxFrom.y, to.y)}px`, width: `${Math.abs(to.x - boxFrom.x)}px`, height: `${Math.abs(to.y - boxFrom.y)}px` });
    };
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointers */ }
      if (pointers.size === 0) { button = e.button; shift = e.shiftKey; }
      pointers.set(e.pointerId, rel(e));
      if (pointers.size === 1) {
        downAt = rel(e);
        moved = false;
        lastMoveT = performance.now();
        if (e.button === 0 && e.shiftKey && !this.armies.pick(downAt.x, downAt.y)) { boxFrom = downAt; return; }
        // pressing on one of your own counters starts an order drag instead of panning
        const army = e.button === 0 ? this.armies.pick(downAt.x, downAt.y) : null;
        if (army && this.armyDrag?.canDrag(army)) this.draggingArmy = army;
        else this.camera.beginDrag();
      } else if (pointers.size === 2) {
        this.draggingArmy = null;
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        moved = true;
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      const p = rel(e);
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        const army = this.armies.pick(p.x, p.y);
        if (army !== this.hoveredArmy) { this.hoveredArmy = army; this.armyHoverHandlers.forEach((h) => h(army)); }
        this.setHover(this.pick(p.x, p.y)?.index ?? null);
        return;
      }
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) this.camera.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinchDist);
        pinchDist = d;
        return;
      }
      if (downAt && Math.hypot(p.x - downAt.x, p.y - downAt.y) > 5) moved = true;
      if (boxFrom) { if (moved) drawBox(p); return; }
      if (this.draggingArmy) {
        if (!moved) return;
        this.pointerAt = p;
        const hit = this.pick(p.x, p.y);
        this.setHover(hit?.index ?? null);
        this.armyDrag?.move(this.draggingArmy, hit?.id ?? null, this.camera.screenToWorld(p.x, p.y));
        canvas.style.cursor = 'crosshair';
        return;
      }
      if (moved) {
        const now = performance.now();
        this.camera.dragBy(p.x - prev.x, p.y - prev.y, (now - lastMoveT) / 1000);
        lastMoveT = now;
        canvas.style.cursor = 'grabbing';
      }
    });

    const up = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size > 0) return;
      this.camera.endDrag();
      canvas.style.cursor = '';
      if (boxFrom) {
        const from = boxFrom, to = rel(e);
        boxFrom = null;
        drawBox(null);
        if (moved) { const ids = this.armies.inScreenRect(from.x, from.y, to.x, to.y); this.boxHandlers.forEach((h) => h(ids)); downAt = null; return; }
      }
      const dragged = this.draggingArmy;
      this.draggingArmy = null;
      this.pointerAt = null;
      if (dragged && moved) {
        const { x, y } = rel(e);
        this.armyDrag?.drop(dragged, this.pick(x, y)?.id ?? null);
        downAt = null;
        return;
      }
      if (!moved) {
        const { x, y } = rel(e);
        const province = this.pick(x, y)?.id ?? null;
        const mods = { shift };
        if (button === 2) this.handlers.command.forEach((h) => h(province, mods));
        else {
          const army = this.armies.pick(x, y);
          if (army) this.handlers.army.forEach((h) => h(army, mods));
          else this.handlers.select.forEach((h) => h(province, mods));
        }
      }
      downAt = null;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', () => { if (!pointers.size) this.setHover(null); });
  }

  private setHover(i: number | null) {
    if (i === this.hovered) return;
    const prev = this.hovered;
    this.hovered = i;
    if (prev !== null) this.applyTint(prev);
    if (i !== null) this.applyTint(i);
    this.app.canvas.style.cursor = i !== null ? 'pointer' : '';
    this.dirtyOverlay = true;
    this.needsRender = true;
    const id = i === null ? null : this.map.provinces[i].id;
    this.handlers.hover.forEach((h) => h(id, { shift: false }));
  }

  // ---- frame ------------------------------------------------------------------------------------

  private tick(dt: number) {
    // while dragging an army near a screen edge, scroll the map so far-away targets are reachable
    if (this.draggingArmy && this.pointerAt && this.opts.edgeScroll) {
      const edge = 48, speed = 600 * Math.min(dt, 0.05);
      const { x, y } = this.pointerAt;
      const c = this.camera;
      const dx = x < edge ? speed : x > c.viewW - edge ? -speed : 0;
      const dy = y < edge ? speed : y > c.viewH - edge ? -speed : 0;
      if (dx || dy) {
        c.dragBy(dx, dy, 0);
        const hit = this.pick(x, y);
        this.armyDrag?.move(this.draggingArmy, hit?.id ?? null, c.screenToWorld(x, y));
      }
    }
    const moved = this.camera.update(Math.min(dt, 0.05));
    const c = this.camera;
    // also catch camera changes made outside the animation (e.g. resize, direct calls)
    const changed = moved || c.zoom !== this.lastView[0] || c.ox !== this.lastView[1] || c.oy !== this.lastView[2];
    this.lastView = [c.zoom, c.ox, c.oy];
    const z = this.camera.zoom;
    this.world.scale.set(z);
    this.world.position.set(this.camera.ox, this.camera.oy);

    if (changed || this.nationLabelZoom === 0) this.updateLabels();
    const armiesChanged = this.armies.update(Math.min(dt, 0.1), changed);

    // Rebuild constant-width lines once zooming settles (or immediately on big jumps).
    const ratio = z / (this.linesBuiltAtZoom || z);
    if (this.state && (ratio > 1.6 || ratio < 0.62)) this.buildLines();
    else if (this.state && changed && (ratio > 1.04 || ratio < 0.96)) {
      window.clearTimeout(this.lineRebuildTimer);
      this.lineRebuildTimer = window.setTimeout(() => this.buildLines(), 120);
    }
    if (this.dirtyOverlay || (changed && (this.hovered !== null || this.selected !== null))) this.drawOverlay();

    if (changed || armiesChanged || this.needsRender) {
      this.needsRender = false;
      this.app.render();
    }
  }
}

function star(g: Graphics, x: number, y: number, outer: number, inner: number) {
  const pts: number[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.poly(pts);
}

