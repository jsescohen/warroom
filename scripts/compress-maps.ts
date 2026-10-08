import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * After `vite build`: stores every map in dist/maps (and older map versions in its subfolders)
 * pre-compressed with brotli and gzip, so the server sends a ready-made small file instead of
 * compressing ~3.5 MB of JSON on every request (slow on a small free-tier CPU).
 */
const root = path.resolve('dist/maps');
if (!fs.existsSync(root)) {
  console.error('dist/maps not found: run vite build first');
  process.exit(1);
}
const files: string[] = [];
const walk = (dir: string) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.json')) files.push(p);
  }
};
walk(root);
let raw = 0, br = 0;
for (const f of files) {
  const data = fs.readFileSync(f);
  const b = zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } });
  fs.writeFileSync(`${f}.br`, b);
  fs.writeFileSync(`${f}.gz`, zlib.gzipSync(data, { level: 9 }));
  raw += data.length;
  br += b.length;
}
console.log(`compressed ${files.length} maps: ${(raw / 1e6).toFixed(1)} MB -> ${(br / 1e6).toFixed(1)} MB (brotli)`);
