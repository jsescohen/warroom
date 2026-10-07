/**
 * 2D camera: screen = world * zoom + offset. Handles smooth zoom toward a cursor anchor,
 * drag panning with inertia, fly-to animations, and keeping the world in view.
 */
export class Camera {
  zoom = 1;
  ox = 0;
  oy = 0;
  minZoom = 0.2;
  maxZoom = 48;
  viewW = 1;
  viewH = 1;

  private targetZoom = 1;
  /** Reduced motion: jump straight to targets instead of easing. */
  instant = false;
  private anchor: { sx: number; sy: number; wx: number; wy: number } | null = null;
  private fly: { wx: number; wy: number } | null = null;
  private vx = 0;
  private vy = 0;
  private dragging = false;

  constructor(public worldW: number, public worldH: number) {}

  resize(w: number, h: number) {
    const first = this.viewW === 1;
    this.viewW = w;
    this.viewH = h;
    this.minZoom = Math.min(w / this.worldW, h / this.worldH) * 0.95;
    if (first) this.fit();
    this.clamp();
  }

  fit() {
    this.zoom = this.targetZoom = Math.max(this.minZoom, this.viewH / this.worldH);
    this.ox = (this.viewW - this.worldW * this.zoom) / 2;
    this.oy = (this.viewH - this.worldH * this.zoom) / 2;
    this.clamp();
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.ox) / this.zoom, (sy - this.oy) / this.zoom];
  }

  worldToScreen(wx: number, wy: number): [number, number] {
    return [wx * this.zoom + this.ox, wy * this.zoom + this.oy];
  }

  /** Visible world rectangle [x0, y0, x1, y1]. */
  viewRect(): [number, number, number, number] {
    const [x0, y0] = this.screenToWorld(0, 0);
    const [x1, y1] = this.screenToWorld(this.viewW, this.viewH);
    return [x0, y0, x1, y1];
  }

  zoomAt(sx: number, sy: number, factor: number) {
    this.fly = null;
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.anchor = { sx, sy, wx, wy };
    this.targetZoom = clamp(this.targetZoom * factor, this.minZoom, this.maxZoom);
  }

  flyTo(wx: number, wy: number, zoom = this.targetZoom) {
    this.anchor = null;
    this.fly = { wx, wy };
    this.targetZoom = clamp(zoom, this.minZoom, this.maxZoom);
  }

  beginDrag() {
    this.dragging = true;
    this.fly = null;
    this.anchor = null;
    this.vx = this.vy = 0;
  }

  dragBy(dx: number, dy: number, dt: number) {
    this.ox += dx;
    this.oy += dy;
    if (dt > 0) {
      // exponential moving average of velocity, px per second
      this.vx = this.vx * 0.6 + (dx / dt) * 0.4;
      this.vy = this.vy * 0.6 + (dy / dt) * 0.4;
    }
    this.clamp();
  }

  endDrag() {
    this.dragging = false;
  }

  /** Advances animations. Returns true if the view changed. */
  update(dt: number): boolean {
    const z0 = this.zoom, x0 = this.ox, y0 = this.oy;
    const k = this.instant ? 1 : 1 - Math.exp(-dt * 14);

    if (Math.abs(this.targetZoom - this.zoom) > this.zoom * 1e-4) {
      this.zoom += (this.targetZoom - this.zoom) * k;
    } else this.zoom = this.targetZoom;

    if (this.anchor) {
      this.ox = this.anchor.sx - this.anchor.wx * this.zoom;
      this.oy = this.anchor.sy - this.anchor.wy * this.zoom;
      if (this.zoom === this.targetZoom) this.anchor = null;
    } else if (this.fly) {
      const [cx, cy] = this.screenToWorld(this.viewW / 2, this.viewH / 2);
      const nx = cx + (this.fly.wx - cx) * k;
      const ny = cy + (this.fly.wy - cy) * k;
      this.ox = this.viewW / 2 - nx * this.zoom;
      this.oy = this.viewH / 2 - ny * this.zoom;
      if (Math.hypot(this.fly.wx - nx, this.fly.wy - ny) * this.zoom < 0.5 && this.zoom === this.targetZoom) this.fly = null;
    } else if (!this.dragging && !this.instant && (Math.abs(this.vx) > 5 || Math.abs(this.vy) > 5)) {
      this.ox += this.vx * dt;
      this.oy += this.vy * dt;
      const decay = Math.exp(-dt * 5);
      this.vx *= decay;
      this.vy *= decay;
    } else if (!this.dragging) this.vx = this.vy = 0;

    this.clamp();
    return z0 !== this.zoom || x0 !== this.ox || y0 !== this.oy;
  }

  /** True while any animation (zoom, fly, inertia) is running. */
  get animating() {
    return this.zoom !== this.targetZoom || !!this.fly || Math.abs(this.vx) > 5 || Math.abs(this.vy) > 5;
  }

  private clamp() {
    const w = this.worldW * this.zoom, h = this.worldH * this.zoom;
    const margin = 0.15;
    if (w <= this.viewW) this.ox = (this.viewW - w) / 2;
    else this.ox = clamp(this.ox, this.viewW * (1 - margin) - w, this.viewW * margin);
    if (h <= this.viewH) this.oy = (this.viewH - h) / 2;
    else this.oy = clamp(this.oy, this.viewH * (1 - margin) - h, this.viewH * margin);
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
