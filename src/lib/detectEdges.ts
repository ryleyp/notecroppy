import { insetQuad, lineIntersection, type Point, type Quad } from './geometry';
import { toGrayscale, type Raster } from './raster';

export interface DetectionResult {
  quad: Quad;
  /** 0-1. Below `CONFIDENCE_FLOOR` the quad is just the inset fallback. */
  confidence: number;
  detected: boolean;
}

export const CONFIDENCE_FLOOR = 0.18;

function boxBlur(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  const horizontal = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const window = radius * 2 + 1;

  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) {
      sum += src[y * width + Math.min(Math.max(x, 0), width - 1)];
    }
    for (let x = 0; x < width; x++) {
      horizontal[y * width + x] = sum / window;
      const outgoing = src[y * width + Math.min(Math.max(x - radius, 0), width - 1)];
      const incoming = src[y * width + Math.min(Math.max(x + radius + 1, 0), width - 1)];
      sum += incoming - outgoing;
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) {
      sum += horizontal[Math.min(Math.max(y, 0), height - 1) * width + x];
    }
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / window;
      const outgoing = horizontal[Math.min(Math.max(y - radius, 0), height - 1) * width + x];
      const incoming = horizontal[Math.min(Math.max(y + radius + 1, 0), height - 1) * width + x];
      sum += incoming - outgoing;
    }
  }

  return out;
}

interface Gradients {
  horizontal: Float32Array;
  vertical: Float32Array;
  width: number;
  height: number;
}

/**
 * Sobel gradients, kept as separate horizontal and vertical components. A
 * page's top and bottom edges show up in the vertical component and its sides
 * in the horizontal one, so scoring each side against the matching component
 * ignores clutter running the wrong way.
 */
function sobel(gray: Float32Array, width: number, height: number): Gradients {
  const horizontal = new Float32Array(gray.length);
  const vertical = new Float32Array(gray.length);

  const at = (x: number, y: number) =>
    gray[Math.min(Math.max(y, 0), height - 1) * width + Math.min(Math.max(x, 0), width - 1)];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx =
        -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) +
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
      const gy =
        -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) +
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      horizontal[y * width + x] = Math.abs(gx);
      vertical[y * width + x] = Math.abs(gy);
    }
  }

  return { horizontal, vertical, width, height };
}

type Side = 'top' | 'bottom' | 'left' | 'right';

interface Candidate {
  a: Point;
  b: Point;
  score: number;
}

/**
 * Searches for the strongest straight edge belonging to one side of the page.
 *
 * The line is parameterised by its offset from the image border plus a small
 * tilt, which covers a page that is slightly rotated in frame. Each candidate
 * scores the mean gradient along its length, so a long clean edge beats a short
 * bright smudge.
 */
function findEdgeLine(gradients: Gradients, side: Side): Candidate {
  const { width, height } = gradients;
  const vertical = side === 'top' || side === 'bottom';
  const field = vertical ? gradients.vertical : gradients.horizontal;

  const span = vertical ? width : height;
  const depth = vertical ? height : width;
  // Only look in the outer 45% from the relevant border; the page edge will not
  // be past the middle of the frame in a normal photo.
  const limit = Math.floor(depth * 0.45);

  const samples = Math.min(span, 96);
  const tilts = [-0.10, -0.06, -0.03, -0.015, 0, 0.015, 0.03, 0.06, 0.10];

  let best: Candidate = { a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, score: -1 };

  for (let offset = 2; offset < limit; offset++) {
    const base = side === 'top' || side === 'left' ? offset : depth - 1 - offset;

    for (const tilt of tilts) {
      let sum = 0;
      let counted = 0;

      for (let s = 0; s < samples; s++) {
        const t = (s + 0.5) / samples;
        const along = t * (span - 1);
        const across = base + (t - 0.5) * span * tilt;
        if (across < 1 || across > depth - 2) {
          counted = 0;
          break;
        }
        const x = vertical ? along : across;
        const y = vertical ? across : along;
        sum += field[Math.round(y) * width + Math.round(x)];
        counted++;
      }

      if (counted === 0) continue;
      const score = sum / counted;
      if (score > best.score) {
        const acrossStart = base - 0.5 * span * tilt;
        const acrossEnd = base + 0.5 * span * tilt;
        best = {
          score,
          a: vertical ? { x: 0, y: acrossStart } : { x: acrossStart, y: 0 },
          b: vertical ? { x: span - 1, y: acrossEnd } : { x: acrossEnd, y: span - 1 },
        };
      }
    }
  }

  return best;
}

export interface DetectOptions {
  /** Longest edge of the analysis copy. Detection does not need full res. */
  workingSize?: number;
}

/**
 * Estimates where the sheet of paper sits in the photo.
 *
 * This is deliberately a simple detector: it finds one dominant straight edge
 * per side and intersects them. It does well on a page that roughly fills the
 * frame against a contrasting background, and poorly on a busy background, a
 * heavily rotated page, or paper whose colour is close to the surface under it.
 * When it is unsure it reports low confidence and the caller falls back to an
 * inset rectangle for the user to drag.
 */
export function detectDocumentQuad(raster: Raster, options: DetectOptions = {}): DetectionResult {
  const { width, height } = raster;
  const fallback: DetectionResult = {
    quad: insetQuad(width, height),
    confidence: 0,
    detected: false,
  };

  if (width < 32 || height < 32) return fallback;

  const workingSize = options.workingSize ?? 320;
  const scale = Math.min(1, workingSize / Math.max(width, height));
  const w = Math.max(16, Math.round(width * scale));
  const h = Math.max(16, Math.round(height * scale));

  // Nearest-neighbour downscale: detection only cares about strong structure.
  const small = new Float32Array(w * h);
  const gray = toGrayscale(raster);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor((y / h) * height));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.floor((x / w) * width));
      small[y * w + x] = gray[sy * width + sx];
    }
  }

  const blurred = boxBlur(small, w, h, 2);
  const gradients = sobel(blurred, w, h);

  const top = findEdgeLine(gradients, 'top');
  const bottom = findEdgeLine(gradients, 'bottom');
  const left = findEdgeLine(gradients, 'left');
  const right = findEdgeLine(gradients, 'right');

  const tl = lineIntersection(top.a, top.b, left.a, left.b);
  const tr = lineIntersection(top.a, top.b, right.a, right.b);
  const br = lineIntersection(bottom.a, bottom.b, right.a, right.b);
  const bl = lineIntersection(bottom.a, bottom.b, left.a, left.b);
  if (!tl || !tr || !br || !bl) return fallback;

  const inverse = 1 / scale;
  const quad: Quad = {
    tl: { x: tl.x * inverse, y: tl.y * inverse },
    tr: { x: tr.x * inverse, y: tr.y * inverse },
    br: { x: br.x * inverse, y: br.y * inverse },
    bl: { x: bl.x * inverse, y: bl.y * inverse },
  };

  for (const p of [quad.tl, quad.tr, quad.br, quad.bl]) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return fallback;
    if (p.x < -width * 0.1 || p.x > width * 1.1) return fallback;
    if (p.y < -height * 0.1 || p.y > height * 1.1) return fallback;
  }

  // Normalise the mean edge strength into a rough 0-1 confidence. Sobel output
  // on 0-255 luma saturates well below 255 for real photographed paper edges,
  // so 160 is treated as "certain".
  const meanScore = (top.score + bottom.score + left.score + right.score) / 4;
  const confidence = Math.max(0, Math.min(1, meanScore / 160));

  if (confidence < CONFIDENCE_FLOOR) return { ...fallback, confidence };

  return { quad, confidence, detected: true };
}
