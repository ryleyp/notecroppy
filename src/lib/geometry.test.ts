import { describe, expect, it } from 'vitest';
import {
  arrayToQuad,
  insetQuad,
  isConvex,
  lineIntersection,
  orderCorners,
  outputSizeForQuad,
  quadArea,
  quadToArray,
  type Quad,
} from './geometry';

const SQUARE: Quad = {
  tl: { x: 0, y: 0 },
  tr: { x: 10, y: 0 },
  br: { x: 10, y: 10 },
  bl: { x: 0, y: 10 },
};

describe('outputSizeForQuad', () => {
  it('matches the rectangle for an axis-aligned quad', () => {
    expect(outputSizeForQuad(SQUARE)).toEqual({ width: 10, height: 10 });
  });

  it('takes the longer of each opposing pair so detail is not squashed', () => {
    // A trapezoid whose bottom edge is much longer than its top.
    const trapezoid: Quad = {
      tl: { x: 20, y: 0 },
      tr: { x: 80, y: 0 },
      br: { x: 100, y: 50 },
      bl: { x: 0, y: 50 },
    };
    expect(outputSizeForQuad(trapezoid).width).toBe(100);
  });

  it('never returns a zero dimension', () => {
    const collapsed: Quad = {
      tl: { x: 1, y: 1 },
      tr: { x: 1, y: 1 },
      br: { x: 1, y: 1 },
      bl: { x: 1, y: 1 },
    };
    const size = outputSizeForQuad(collapsed);
    expect(size.width).toBeGreaterThanOrEqual(1);
    expect(size.height).toBeGreaterThanOrEqual(1);
  });
});

describe('quadArea', () => {
  it('computes the area of a square', () => {
    expect(quadArea(SQUARE)).toBe(100);
  });

  it('is orientation independent', () => {
    const reversed = arrayToQuad(quadToArray(SQUARE).reverse());
    expect(quadArea(reversed)).toBe(100);
  });
});

describe('isConvex', () => {
  it('accepts a rectangle', () => {
    expect(isConvex(SQUARE)).toBe(true);
  });

  it('accepts a perspective trapezoid', () => {
    expect(
      isConvex({
        tl: { x: 30, y: 0 },
        tr: { x: 70, y: 5 },
        br: { x: 95, y: 60 },
        bl: { x: 5, y: 55 },
      }),
    ).toBe(true);
  });

  it('rejects a bow-tie, which is what dragging a corner past its neighbour makes', () => {
    expect(
      isConvex({
        tl: { x: 0, y: 0 },
        tr: { x: 10, y: 10 },
        br: { x: 10, y: 0 },
        bl: { x: 0, y: 10 },
      }),
    ).toBe(false);
  });

  it('rejects a fully collapsed quad', () => {
    expect(
      isConvex({
        tl: { x: 5, y: 5 },
        tr: { x: 5, y: 5 },
        br: { x: 5, y: 5 },
        bl: { x: 5, y: 5 },
      }),
    ).toBe(false);
  });
});

describe('orderCorners', () => {
  it('sorts shuffled points into tl, tr, br, bl', () => {
    const shuffled = [
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(orderCorners(shuffled)).toEqual(SQUARE);
  });

  it('is idempotent', () => {
    const once = orderCorners(quadToArray(SQUARE));
    expect(orderCorners(quadToArray(once))).toEqual(once);
  });

  it('handles a rotated quad', () => {
    const diamond = [
      { x: 50, y: 0 },
      { x: 100, y: 50 },
      { x: 50, y: 100 },
      { x: 0, y: 50 },
    ];
    const ordered = orderCorners(diamond);
    expect(isConvex(ordered)).toBe(true);
    expect(quadArea(ordered)).toBeCloseTo(5000, 6);
  });

  it('throws when not given four points', () => {
    expect(() => orderCorners([{ x: 0, y: 0 }])).toThrow(/exactly 4/);
  });
});

describe('insetQuad', () => {
  it('sits inside the image bounds', () => {
    const quad = insetQuad(100, 200, 0.1);
    expect(quad.tl).toEqual({ x: 10, y: 20 });
    expect(quad.br).toEqual({ x: 90, y: 180 });
  });
});

describe('lineIntersection', () => {
  it('finds the crossing point of two perpendicular lines', () => {
    const p = lineIntersection({ x: 0, y: 5 }, { x: 10, y: 5 }, { x: 3, y: 0 }, { x: 3, y: 10 });
    expect(p).toEqual({ x: 3, y: 5 });
  });

  it('extends beyond the given segments', () => {
    const p = lineIntersection({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 10 }, { x: 1, y: 10 });
    expect(p?.x).toBeCloseTo(10, 6);
    expect(p?.y).toBeCloseTo(10, 6);
  });

  it('returns null for parallel lines', () => {
    expect(
      lineIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 }),
    ).toBeNull();
  });
});
