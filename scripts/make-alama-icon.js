/**
 * make-alama-icon.js
 * ------------------
 * Rasterises the Alama mark into public/alama-icon.png (512x512) for use as
 * the Electron window icon. No external image libraries are used — the PNG is
 * written straight from zlib (Node built-in).
 *
 * Run:  node scripts/make-alama-icon.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const W = 512;
const H = 512;
const NAVY = [0x0e, 0x1a, 0x45];
const AMBER = [0xf5, 0x9e, 0x0b];

const buf = Buffer.alloc(W * H * 4, 0); // transparent

function setPx(x, y, r, g, b, a = 255) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
  buf[i + 3] = a;
}

function blendPx(x, y, r, g, b, a) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  const alpha = a / 255;
  buf[i] = Math.round(buf[i] * (1 - alpha) + r * alpha);
  buf[i + 1] = Math.round(buf[i + 1] * (1 - alpha) + g * alpha);
  buf[i + 2] = Math.round(buf[i + 2] * (1 - alpha) + b * alpha);
  buf[i + 3] = 255;
}

// ---- geometry -------------------------------------------------------------

// Point-in-rounded-rect.
function inRoundedRect(px, py, x, y, w, h, r) {
  if (px < x || px >= x + w || py < y || py >= y + h) return false;
  const corners = [
    [x + r, y + r],
    [x + w - r, y + r],
    [x + r, y + h - r],
    [x + w - r, y + h - r],
  ];
  for (const [cx, cy] of corners) {
    if (px < cx && py < cy) return (px - cx) ** 2 + (py - cy) ** 2 <= r ** 2;
    if (px >= cx && py < cy) return py >= y + r;
    if (px < cx && py >= cy) return px >= x + r;
    if (px >= cx && py >= cy) return true;
  }
  return true;
}

// Distance from point to line segment.
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function drawLine(x1, y1, x2, y2, width, color) {
  const half = width / 2;
  for (let py = y1 - half - 2; py <= y2 + half + 2; py++) {
    for (let px = x1 - half - 2; px <= x2 + half + 2; px++) {
      const d = distToSegment(px, py, x1, y1, x2, y2);
      if (d <= half) {
        const alpha = d <= half - 1 ? 255 : Math.round(255 * (half - d + 1));
        blendPx(px, py, ...color, alpha);
      }
    }
  }
  // round caps
  for (let py = y1 - half; py <= y1 + half; py++) {
    for (let px = x1 - half; px <= x1 + half; px++) {
      if (Math.hypot(px - x1, py - y1) <= half) {
        blendPx(px, py, ...color, 255);
      }
    }
  }
  for (let py = y2 - half; py <= y2 + half; py++) {
    for (let px = x2 - half; px <= x2 + half; px++) {
      if (Math.hypot(px - x2, py - y2) <= half) {
        blendPx(px, py, ...color, 255);
      }
    }
  }
}

function drawCircle(cx, cy, r, color) {
  for (let py = cy - r; py <= cy + r; py++) {
    for (let px = cx - r; px <= cx + r; px++) {
      if (Math.hypot(px - cx, py - cy) <= r) {
        blendPx(px, py, ...color, 255);
      }
    }
  }
}

// ---- paint ----------------------------------------------------------------

const S = 16; // 32px design -> 512px

// Navy rounded-square app-icon background.
for (let py = 0; py < H; py++) {
  for (let px = 0; px < W; px++) {
    if (inRoundedRect(px, py, 0, 0, W, H, 90)) setPx(px, py, ...NAVY);
  }
}

// Amber "A" mark (scaled from the SVG design).
drawLine(13 * S, 24 * S, 16 * S, 7 * S, 42, AMBER);   // left leg
drawLine(16 * S, 7 * S, 19 * S, 24 * S, 42, AMBER);   // right leg
drawLine(13.8 * S, 15.4 * S, 18.2 * S, 15.4 * S, 42, AMBER); // crossbar
drawCircle(16 * S, 27.5 * S, 24, AMBER);              // seal dot

// ---- PNG encode -----------------------------------------------------------

function crc32(buf) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // RGBA
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

// Scanlines: one filter byte (0 = none) per row, then RGBA pixels.
const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  const rowStart = y * (1 + W * 4);
  raw[rowStart] = 0;
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    raw.writeUInt8(buf[i], rowStart + 1 + x * 4);
    raw.writeUInt8(buf[i + 1], rowStart + 2 + x * 4);
    raw.writeUInt8(buf[i + 2], rowStart + 3 + x * 4);
    raw.writeUInt8(buf[i + 3], rowStart + 4 + x * 4);
  }
}

const idat = zlib.deflateRawSync(raw);

const png = Buffer.concat([
  pngSig,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'public', 'alama-icon.png');
fs.writeFileSync(out, png);
console.log(`Wrote ${out} (${png.length} bytes)`);
