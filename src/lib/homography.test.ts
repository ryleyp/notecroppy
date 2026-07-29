import { describe, expect, it } from 'vitest';
import { applyHomography, normalizeMatrix, solveHomography, IDENTITY } from './homography';
import type { Point } from './geometry';

const UNIT_SQUARE: Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

function expectPointClose(actual: Point, expected: Point, precision = 8) {
  expect(actual.x).toBeCloseTo(expected.x, precision);
  expect(actual.y).toBeCloseTo(expected.y, precision);
}

describe('solveHomography', () => {
  it('returns the identity when source and destination match', () => {
    const h = normalizeMatrix(solveHomography(UNIT_SQUARE, UNIT_SQUARE));
    h.forEach((value, i) => expect(value).toBeCloseTo(IDENTITY[i], 8));
  });

  it('recovers a pure translation', () => {
    const dst = UNIT_SQUARE.map((p) => ({ x: p.x + 7, y: p.y - 3 }));
    const h = solveHomography(UNIT_SQUARE, dst);
    expectPointClose(applyHomography(h, { x: 0.5, y: 0.5 }), { x: 7.5, y: -2.5 });
  });

  it('recovers a pure scale', () => {
    const dst = UNIT_SQUARE.map((p) => ({ x: p.x * 100, y: p.y * 40 }));
    const h = solveHomography(UNIT_SQUARE, dst);
    expectPointClose(applyHomography(h, { x: 0.25, y: 0.5 }), { x: 25, y: 20 });
  });

  it('recovers a 90 degree rotation', () => {
    // (x, y) -> (-y, x)
    const dst = UNIT_SQUARE.map((p) => ({ x: -p.y, y: p.x }));
    const h = solveHomography(UNIT_SQUARE, dst);
    expectPointClose(applyHomography(h, { x: 1, y: 0 }), { x: 0, y: 1 });
    expectPointClose(applyHomography(h, { x: 0.5, y: 0.25 }), { x: -0.25, y: 0.5 });
  });

  it('maps every corner exactly for a genuinely projective quad', () => {
    // A trapezoid: the kind of shape a page makes when photographed at an angle.
    const dst: Point[] = [
      { x: 120, y: 40 },
      { x: 880, y: 130 },
      { x: 760, y: 940 },
      { x: 200, y: 830 },
    ];
    const h = solveHomography(UNIT_SQUARE, dst);
    UNIT_SQUARE.forEach((src, i) => expectPointClose(applyHomography(h, src), dst[i], 6));
  });

  it('is a genuine perspective transform, not an affine one', () => {
    const dst: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 20 },
      { x: 100, y: 80 },
      { x: 0, y: 100 },
    ];
    const h = solveHomography(UNIT_SQUARE, dst);
    // Under an affine map the centre of the square lands on the mean of the
    // corners. A perspective map pulls it toward the compressed edge.
    const meanX = dst.reduce((s, p) => s + p.x, 0) / 4;
    const centre = applyHomography(h, { x: 0.5, y: 0.5 });
    expect(Math.abs(centre.x - meanX)).toBeGreaterThan(1);
  });

  it('inverts exactly: solving the reverse direction round-trips points', () => {
    const dst: Point[] = [
      { x: 33, y: 17 },
      { x: 640, y: 90 },
      { x: 590, y: 505 },
      { x: 80, y: 470 },
    ];
    const forward = solveHomography(UNIT_SQUARE, dst);
    const backward = solveHomography(dst, UNIT_SQUARE);

    for (const probe of [
      { x: 0.1, y: 0.9 },
      { x: 0.5, y: 0.5 },
      { x: 0.77, y: 0.2 },
    ]) {
      const there = applyHomography(forward, probe);
      const back = applyHomography(backward, there);
      expectPointClose(back, probe, 6);
    }
  });

  it('maps straight lines to straight lines', () => {
    const dst: Point[] = [
      { x: 10, y: 12 },
      { x: 400, y: 60 },
      { x: 380, y: 300 },
      { x: 30, y: 260 },
    ];
    const h = solveHomography(UNIT_SQUARE, dst);
    const a = applyHomography(h, { x: 0, y: 0.5 });
    const mid = applyHomography(h, { x: 0.5, y: 0.5 });
    const b = applyHomography(h, { x: 1, y: 0.5 });

    // Collinearity check via the cross product of the two segment vectors.
    const cross = (mid.x - a.x) * (b.y - a.y) - (mid.y - a.y) * (b.x - a.x);
    expect(Math.abs(cross)).toBeLessThan(1e-6);
  });

  it('throws when three points are collinear', () => {
    const degenerate: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 1 },
    ];
    expect(() => solveHomography(degenerate, UNIT_SQUARE)).toThrow(/[Dd]egenerate/);
  });

  it('throws when points are duplicated', () => {
    const degenerate: Point[] = [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 9, y: 1 },
      { x: 0, y: 7 },
    ];
    expect(() => solveHomography(degenerate, UNIT_SQUARE)).toThrow(/[Dd]egenerate/);
  });

  it('rejects the wrong number of points', () => {
    expect(() => solveHomography(UNIT_SQUARE.slice(0, 3), UNIT_SQUARE)).toThrow(/exactly 4/);
  });
});
