import type { Point } from './geometry';

/** Row-major 3x3 projective transform. */
export type Matrix3 = [number, number, number, number, number, number, number, number, number];

export const IDENTITY: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Solves a dense linear system by Gaussian elimination with partial pivoting.
 * `a` is n x n row-major and is mutated; `b` is the right-hand side.
 */
function solveLinearSystem(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return null;

    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot], a[col]];
      [b[col], b[pivot]] = [b[pivot], b[col]];
    }

    const diag = a[col][col];
    for (let row = col + 1; row < n; row++) {
      const factor = a[row][col] / diag;
      if (factor === 0) continue;
      for (let k = col; k < n; k++) a[row][k] -= factor * a[col][k];
      b[row] -= factor * b[col];
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = b[row];
    for (let k = row + 1; k < n; k++) sum -= a[row][k] * x[k];
    x[row] = sum / a[row][row];
  }
  return x;
}

/**
 * Finds the projective transform H mapping each `src[i]` onto `dst[i]`.
 *
 * With h8 fixed at 1, each correspondence contributes two rows to an 8x8
 * system:
 *   h0*x + h1*y + h2 - h6*x*u - h7*y*u = u
 *   h3*x + h4*y + h5 - h6*x*v - h7*y*v = v
 *
 * Throws when the points are degenerate (three collinear, or duplicated),
 * since no unique transform exists in that case.
 */
export function solveHomography(src: Point[], dst: Point[]): Matrix3 {
  if (src.length !== 4 || dst.length !== 4) {
    throw new Error('solveHomography requires exactly 4 source and 4 destination points');
  }

  const a: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    a.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }

  const h = solveLinearSystem(a, b);
  if (!h || h.some((value) => !Number.isFinite(value))) {
    throw new Error('Degenerate point configuration: no unique homography exists');
  }

  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Maps a point through H, dividing out the projective component. */
export function applyHomography(h: Matrix3, p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  if (Math.abs(w) < 1e-12) return { x: NaN, y: NaN };
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

/** Scales H so its last entry is 1, making two transforms comparable. */
export function normalizeMatrix(h: Matrix3): Matrix3 {
  if (Math.abs(h[8]) < 1e-12) return h;
  return h.map((value) => value / h[8]) as Matrix3;
}
