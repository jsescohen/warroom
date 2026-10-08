/**
 * Builds the dotted world map behind the menus (public/ui/world-dots.svg) from the land outline
 * (data-src/land.geojson): one dot per grid cell whose centre is on land. Run: npm run map:menu
 */
import fs from 'node:fs';

type Ring = [number, number][];
const geo = JSON.parse(fs.readFileSync('data-src/land.geojson', 'utf8')) as { features: { geometry: { type: string; coordinates: unknown } }[] };
const polys: Ring[][] = [];
for (const f of geo.features) {
  const g = f.geometry;
  if (g.type === 'Polygon') polys.push(g.coordinates as Ring[]);
  else if (g.type === 'MultiPolygon') polys.push(...(g.coordinates as Ring[][]));
}
const boxes = polys.map((p) => {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  for (const [x, y] of p[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
});
const onLand = (x: number, y: number) => polys.some((p, k) => {
  const [x0, y0, x1, y1] = boxes[k];
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  let inside = false;
  for (const ring of p) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
});

const STEP = 1.8; // degrees between dots
const LAT_MAX = 78, LAT_MIN = -58; // skip most of Antarctica
const cols = Math.round(360 / STEP), rows = Math.round((LAT_MAX - LAT_MIN) / STEP);
let d = '';
let n = 0;
for (let r = 0; r < rows; r++) {
  const lat = LAT_MAX - (r + 0.5) * STEP;
  for (let c = 0; c < cols; c++) {
    const lon = -180 + (c + 0.5) * STEP;
    if (!onLand(lon, lat)) continue;
    d += `M${c} ${r}h0`;
    n++;
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.5 -0.5 ${cols} ${rows}" preserveAspectRatio="xMidYMid meet"><path d="${d}" stroke="#fff" stroke-width="0.5" stroke-linecap="round"/></svg>\n`;
fs.writeFileSync('public/ui/world-dots.svg', svg);
console.log(`${n} dots, ${cols}x${rows}, ${(svg.length / 1024).toFixed(0)} KB`);
