export interface Point {
  x: number;
  y: number;
}

/**
 * The four corners of the paper in the source photo, always stored in this
 * order. Keeping the order fixed everywhere is what lets the warp know which
 * way is "up" on the finished page.
 */
export interface Quad {
  tl: Point;
  tr: Point;
  br: Point;
  bl: Point;
}

export const QUAD_KEYS = ['tl', 'tr', 'br', 'bl'] as const;
export type QuadKey = (typeof QUAD_KEYS)[number];

export function quadToArray(q: Quad): Point[] {
  return [q.tl, q.tr, q.br, q.bl];
}

export function arrayToQuad(p: Point[]): Quad {
  return { tl: p[0], tr: p[1], br: p[2], bl: p[3] };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function clampPoint(p: Point, width: number, height: number): Point {
  return {
    x: Math.min(Math.max(p.x, 0), width),
    y: Math.min(Math.max(p.y, 0), height),
  };
}

/**
 * A quad drawn at an angle has two different lengths for each opposing pair of
 * sides. Taking the longer of each pair means the flattened page keeps the
 * detail from the edge that was closest to the camera rather than squashing to
 * the foreshortened one.
 */
export function outputSizeForQuad(q: Quad): { width: number; height: number } {
  const width = Math.max(distance(q.tl, q.tr), distance(q.bl, q.br));
  const height = Math.max(distance(q.tl, q.bl), distance(q.tr, q.br));
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

/** Signed area via the shoelace formula; negative means counter-clockwise. */
export function signedArea(q: Quad): number {
  const p = quadToArray(q);
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = p[i];
    const b = p[(i + 1) % 4];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function quadArea(q: Quad): number {
  return Math.abs(signedArea(q));
}

/**
 * A quad is only warpable if it is convex and non-degenerate. Dragging one
 * corner past its neighbours produces a bow-tie, which would make the warp
 * fold back on itself, so the editor uses this to refuse the move.
 */
export function isConvex(q: Quad): boolean {
  const p = quadToArray(q);
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = p[i];
    const b = p[(i + 1) % 4];
    const c = p[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}

/** A rectangle inset from the image edge, used as the fallback crop. */
export function insetQuad(width: number, height: number, fraction = 0.06): Quad {
  const dx = width * fraction;
  const dy = height * fraction;
  return {
    tl: { x: dx, y: dy },
    tr: { x: width - dx, y: dy },
    br: { x: width - dx, y: height - dy },
    bl: { x: dx, y: height - dy },
  };
}

export function scaleQuad(q: Quad, factor: number): Quad {
  return arrayToQuad(quadToArray(q).map((p) => ({ x: p.x * factor, y: p.y * factor })));
}

/**
 * Reorders four arbitrary points into tl/tr/br/bl. Sorting by angle around the
 * centroid gives a consistent ring; the top-left is then whichever point has
 * the smallest x+y.
 */
export function orderCorners(points: Point[]): Quad {
  if (points.length !== 4) throw new Error('orderCorners expects exactly 4 points');
  const cx = points.reduce((s, p) => s + p.x, 0) / 4;
  const cy = points.reduce((s, p) => s + p.y, 0) / 4;
  const ring = [...points].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
  let startIndex = 0;
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const score = ring[i].x + ring[i].y;
    if (score < best) {
      best = score;
      startIndex = i;
    }
  }
  return arrayToQuad([0, 1, 2, 3].map((i) => ring[(startIndex + i) % 4]));
}

/** Intersection of the lines through a1a2 and b1b2, or null if parallel. */
export function lineIntersection(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const d1x = a2.x - a1.x;
  const d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x;
  const d2y = b2.y - b1.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denom;
  return { x: a1.x + t * d1x, y: a1.y + t * d1y };
}
