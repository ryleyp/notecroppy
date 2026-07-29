import { describe, expect, it } from 'vitest';
import { warpQuadToRect, inverseWarpMatrix } from './warp';
import { applyHomography } from './homography';
import { createRaster, fillRect, getPixel, type Raster } from './raster';
import type { Quad } from './geometry';

/** A red field with a white rectangle at a known location. */
function fixture(): Raster {
  const raster = createRaster(200, 200);
  fillRect(raster, 0, 0, 200, 200, [255, 0, 0, 255]);
  fillRect(raster, 50, 40, 100, 120, [255, 255, 255, 255]);
  return raster;
}

const RECT_QUAD: Quad = {
  tl: { x: 50, y: 40 },
  tr: { x: 150, y: 40 },
  br: { x: 150, y: 160 },
  bl: { x: 50, y: 160 },
};

describe('inverseWarpMatrix', () => {
  it('maps the output rectangle corners onto the source quad corners', () => {
    const quad: Quad = {
      tl: { x: 20, y: 10 },
      tr: { x: 180, y: 35 },
      br: { x: 160, y: 190 },
      bl: { x: 5, y: 165 },
    };
    const h = inverseWarpMatrix(quad, 400, 300);

    const checks: Array<[{ x: number; y: number }, { x: number; y: number }]> = [
      [{ x: 0, y: 0 }, quad.tl],
      [{ x: 400, y: 0 }, quad.tr],
      [{ x: 400, y: 300 }, quad.br],
      [{ x: 0, y: 300 }, quad.bl],
    ];

    for (const [dst, expected] of checks) {
      const got = applyHomography(h, dst);
      expect(got.x).toBeCloseTo(expected.x, 6);
      expect(got.y).toBeCloseTo(expected.y, 6);
    }
  });
});

describe('warpQuadToRect', () => {
  it('extracts an axis-aligned rectangle at its natural size', () => {
    const out = warpQuadToRect(fixture(), RECT_QUAD);
    expect(out.width).toBe(100);
    expect(out.height).toBe(120);
  });

  it('yields only the white region when the quad matches it', () => {
    const out = warpQuadToRect(fixture(), RECT_QUAD);
    // Sample well inside to stay clear of edge interpolation.
    for (const [x, y] of [
      [10, 10],
      [50, 60],
      [90, 110],
    ]) {
      const [r, g, b, a] = getPixel(out, x, y);
      expect([r, g, b, a]).toEqual([255, 255, 255, 255]);
    }
  });

  it('honours explicit output dimensions', () => {
    const out = warpQuadToRect(fixture(), RECT_QUAD, { width: 300, height: 90 });
    expect(out.width).toBe(300);
    expect(out.height).toBe(90);
    const [r, g, b] = getPixel(out, 150, 45);
    expect([r, g, b]).toEqual([255, 255, 255]);
  });

  it('de-skews a rotated rectangle back to upright', () => {
    // Draw a white parallelogram leaning to the right, then warp it back.
    const raster = createRaster(240, 240);
    fillRect(raster, 0, 0, 240, 240, [0, 0, 0, 255]);
    const shear = 40;
    for (let y = 20; y < 200; y++) {
      const offset = Math.round((shear * (y - 20)) / 180);
      fillRect(raster, 40 + offset, y, 120, 1, [255, 255, 255, 255]);
    }

    const quad: Quad = {
      tl: { x: 40, y: 20 },
      tr: { x: 160, y: 20 },
      br: { x: 200, y: 200 },
      bl: { x: 80, y: 200 },
    };

    const out = warpQuadToRect(raster, quad);
    // The interior of the flattened result should be uniformly white.
    let whiteCount = 0;
    let sampled = 0;
    for (let y = 6; y < out.height - 6; y += 4) {
      for (let x = 6; x < out.width - 6; x += 4) {
        const [r] = getPixel(out, x, y);
        sampled++;
        if (r > 200) whiteCount++;
      }
    }
    expect(sampled).toBeGreaterThan(50);
    expect(whiteCount / sampled).toBeGreaterThan(0.95);
  });

  it('clamps sampling at the border instead of producing transparent pixels', () => {
    const raster = createRaster(50, 50);
    fillRect(raster, 0, 0, 50, 50, [12, 34, 56, 255]);
    // A quad that extends beyond the image on every side.
    const out = warpQuadToRect(raster, {
      tl: { x: -20, y: -20 },
      tr: { x: 70, y: -20 },
      br: { x: 70, y: 70 },
      bl: { x: -20, y: 70 },
    });
    for (let i = 3; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(255);
    }
  });

  it('never returns a zero-sized raster for a collapsed quad', () => {
    const out = warpQuadToRect(fixture(), {
      tl: { x: 10, y: 10 },
      tr: { x: 10.2, y: 10 },
      br: { x: 10.2, y: 10.2 },
      bl: { x: 10, y: 10.2 },
    });
    expect(out.width).toBeGreaterThanOrEqual(1);
    expect(out.height).toBeGreaterThanOrEqual(1);
  });
});
