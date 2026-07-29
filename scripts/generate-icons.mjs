/**
 * Renders the app icons.
 *
 * Uses a small hand-rolled PNG encoder on top of Node's built-in zlib so the
 * project does not need a native image dependency just to produce a handful of
 * static files. Run with `npm run icons`.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encodes an RGBA buffer as a PNG. */
function encodePng(rgba, width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // Each scanline is prefixed with its filter type; 0 means "none".
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a + (b - a) * Math.min(Math.max(t, 0), 1);

/** Signed distance to a rounded rectangle, negative inside. */
function roundedRectDistance(px, py, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(px - cx) - (halfW - radius);
  const dy = Math.abs(py - cy) - (halfH - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

/**
 * Paints one icon. `padding` is the fraction of the canvas left empty around
 * the artwork, which the maskable variant raises so nothing important is lost
 * when the platform crops it to a circle.
 */
function renderIcon(size, { padding = 0 } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const samples = 3;
  const inset = size * padding;
  const artSize = size - inset * 2;
  const centre = size / 2;

  const paperHalfW = artSize * 0.27;
  const paperHalfH = artSize * 0.33;
  const angle = (-8 * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;

          const backdrop = roundedRectDistance(
            px,
            py,
            centre,
            centre,
            artSize / 2,
            artSize / 2,
            artSize * 0.23,
          );
          if (backdrop > 0.5) continue;

          // Warm pink gradient running top-left to bottom-right.
          const t = (px + py) / (size * 2);
          let pr = mix(244, 202, t);
          let pg = mix(150, 82, t);
          let pb = mix(178, 122, t);
          let pa = 255;

          // The sheet of paper, rotated slightly for a hand-placed look.
          const rx = (px - centre) * cos - (py - centre) * sin;
          const ry = (px - centre) * sin + (py - centre) * cos;
          const paper = roundedRectDistance(rx, ry, 0, 0, paperHalfW, paperHalfH, artSize * 0.05);

          if (paper < 0) {
            const shade = mix(255, 242, (ry + paperHalfH) / (paperHalfH * 2));
            pr = shade;
            pg = shade;
            pb = mix(252, 236, (ry + paperHalfH) / (paperHalfH * 2));
          }

          // Crop brackets sitting just outside the paper.
          const bracketOuter = artSize * 0.4;
          const bracketThickness = artSize * 0.055;
          const armLength = artSize * 0.16;
          const ax = Math.abs(px - centre);
          const ay = Math.abs(py - centre);
          const nearCornerX = ax > bracketOuter - bracketThickness && ax < bracketOuter;
          const nearCornerY = ay > bracketOuter - bracketThickness && ay < bracketOuter;
          const withinArmX = ax < bracketOuter && ax > bracketOuter - armLength;
          const withinArmY = ay < bracketOuter && ay > bracketOuter - armLength;

          if ((nearCornerX && withinArmY) || (nearCornerY && withinArmX)) {
            pr = 255;
            pg = 255;
            pb = 255;
          }

          // Antialias the outer silhouette.
          if (backdrop > -0.5) pa = Math.round(255 * (0.5 - backdrop));

          r += pr * (pa / 255);
          g += pg * (pa / 255);
          b += pb * (pa / 255);
          a += pa;
        }
      }

      const total = samples * samples;
      const i = (y * size + x) * 4;
      const alpha = a / total;
      rgba[i] = alpha > 0 ? Math.round((r / total / (alpha / 255)) | 0) : 0;
      rgba[i + 1] = alpha > 0 ? Math.round((g / total / (alpha / 255)) | 0) : 0;
      rgba[i + 2] = alpha > 0 ? Math.round((b / total / (alpha / 255)) | 0) : 0;
      rgba[i + 3] = Math.round(alpha);
    }
  }

  return encodePng(rgba, size, size);
}

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { name: 'icon-32.png', size: 32 },
  { name: 'icon-180.png', size: 180 },
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'icon-maskable-512.png', size: 512, padding: 0.12 },
];

for (const target of targets) {
  writeFileSync(join(OUT_DIR, target.name), renderIcon(target.size, { padding: target.padding }));
  console.log(`wrote ${target.name} (${target.size}px)`);
}
