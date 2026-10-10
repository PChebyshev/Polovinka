// Генерирует PNG-иконки и OG-картинку без внешних библиотек: растр + zlib.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(out, { recursive: true });

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG = [0x1b, 0x14, 0x12];
const ACCENT = [0xe8, 0x87, 0x5f];
const SAND = [0xf2, 0xcc, 0x8f];

function mix(a, b, t) { return a.map((v, i) => Math.round(v + (b[i] - v) * t)); }
function heart(x, y) {
  // x,y в [-1.3,1.3]; классическая кривая сердца
  const yy = -y;
  const v = x * x + yy * yy - 1;
  return v * v * v - x * x * yy * yy * yy <= 0;
}

function drawIcon(size, { maskable = false, radius = 0.22 } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const r = size * radius;
  const pad = maskable ? 0.1 : 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    // скруглённый квадрат (для maskable — весь квадрат)
    let inside = true;
    if (!maskable) {
      const cx = Math.max(r - x, 0, x - (size - 1 - r));
      const cy = Math.max(r - y, 0, y - (size - 1 - r));
      inside = cx * cx + cy * cy <= r * r;
    }
    if (!inside) { buf[i + 3] = 0; continue; }
    const t = (x + y) / (2 * size);
    let col = mix(mix(BG, [0x3a, 0x24, 0x1e], t), [0x2a, 0x1b, 0x18], 0.3);
    // сердце в центре
    const s = size * (0.5 - pad) * 0.82;
    const hx = (x - size / 2) / s * 1.25;
    const hy = (y - size / 2 + size * 0.03) / s * 1.25;
    if (heart(hx, hy)) {
      const g = (hy + 1.3) / 2.6;
      col = mix(SAND, ACCENT, Math.min(1, Math.max(0, g)));
      // блик
      if (heart((hx + 0.45) / 0.35, (hy + 0.45) / 0.35)) col = mix(col, [0xff, 0xf3, 0xe6], 0.45);
    }
    buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2]; buf[i + 3] = 255;
  }
  return png(size, size, buf);
}

function drawOg(w, h) {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const t = (x / w) * 0.6 + (y / h) * 0.4;
    let col = mix(BG, [0x3a, 0x24, 0x1e], t);
    // два сердца: слева побольше, справа поменьше, слегка перекрываются
    const s1 = h * 0.33, s2 = h * 0.26;
    const h1 = heart(((x - w * 0.42) / s1) * 1.25, ((y - h * 0.5) / s1) * 1.25);
    const h2 = heart(((x - w * 0.6) / s2) * 1.25, ((y - h * 0.58) / s2) * 1.25);
    if (h1) col = mix(SAND, ACCENT, (y / h));
    if (h2) col = mix([0xe2, 0x6d, 0x8a], ACCENT, (y / h));
    buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2]; buf[i + 3] = 255;
  }
  return png(w, h, buf);
}

const files = {
  'icon-192.png': () => drawIcon(192),
  'icon-512.png': () => drawIcon(512),
  'icon-512-maskable.png': () => drawIcon(512, { maskable: true }),
  'apple-touch-icon.png': () => drawIcon(180, { radius: 0 }),
  'og-default.png': () => drawOg(1200, 630),
};
for (const [name, make] of Object.entries(files)) {
  const p = join(out, name);
  if (existsSync(p) && !process.argv.includes('--force')) continue;
  writeFileSync(p, make());
  console.log('иконка:', name);
}
