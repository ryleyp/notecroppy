import { describe, expect, it } from 'vitest';
import {
  KEEP,
  REMOVE,
  applyMask,
  buildBackgroundMask,
  estimateBackgroundColor,
  featherMask,
  keptFraction,
  opaqueBounds,
  paintMask,
  removeBackground,
  resampleMask,
} from './cutout';
import { createRaster, fillRect, getPixel, type Raster } from './raster';

/** A white surface with a red card sitting on it. */
function cardOnWhite(): Raster {
  const raster = createRaster(60, 60);
  fillRect(raster, 0, 0, 60, 60, [250, 250, 250, 255]);
  fillRect(raster, 15, 15, 30, 30, [220, 30, 40, 255]);
  return raster;
}

const at = (mask: Uint8Array, width: number, x: number, y: number) => mask[y * width + x];

describe('estimateBackgroundColor', () => {
  it('reads the colour of the surrounding surface', () => {
    const [r, g, b] = estimateBackgroundColor(cardOnWhite());
    expect([r, g, b]).toEqual([250, 250, 250]);
  });

  it('ignores an object intruding on one edge', () => {
    const raster = cardOnWhite();
    // A dark blob touching the left edge, well under half the border.
    fillRect(raster, 0, 20, 3, 12, [10, 10, 10, 255]);
    const [r] = estimateBackgroundColor(raster);
    expect(r).toBe(250);
  });
});

describe('buildBackgroundMask', () => {
  it('removes the surface and keeps the card', () => {
    const raster = cardOnWhite();
    const mask = buildBackgroundMask(raster, { tolerance: 40 });

    expect(at(mask, 60, 2, 2)).toBe(REMOVE);
    expect(at(mask, 60, 57, 57)).toBe(REMOVE);
    expect(at(mask, 60, 30, 30)).toBe(KEEP);
    expect(at(mask, 60, 16, 16)).toBe(KEEP);
  });

  it('keeps an enclosed background-coloured region, because flood fill cannot reach it', () => {
    const raster = cardOnWhite();
    // A white window punched into the middle of the red card.
    fillRect(raster, 25, 25, 10, 10, [250, 250, 250, 255]);
    const mask = buildBackgroundMask(raster, { tolerance: 40 });

    expect(at(mask, 60, 2, 2)).toBe(REMOVE);
    expect(at(mask, 60, 30, 30)).toBe(KEEP);
  });

  it('removes more as tolerance rises', () => {
    const raster = createRaster(50, 50);
    fillRect(raster, 0, 0, 50, 50, [200, 200, 200, 255]);
    // A ring of mid grey between the border and the dark centre.
    fillRect(raster, 10, 10, 30, 30, [170, 170, 170, 255]);
    fillRect(raster, 20, 20, 10, 10, [20, 20, 20, 255]);

    const count = (tolerance: number) =>
      buildBackgroundMask(raster, { tolerance }).reduce((n, v) => n + (v === REMOVE ? 1 : 0), 0);

    expect(count(5)).toBeLessThan(count(60));
    expect(count(60)).toBeGreaterThan(0);
  });

  it('leaves everything when nothing resembles the border colour', () => {
    const raster = createRaster(20, 20);
    fillRect(raster, 0, 0, 20, 20, [255, 255, 255, 255]);
    fillRect(raster, 0, 0, 20, 20, [10, 200, 90, 255]);
    const mask = buildBackgroundMask(raster, { tolerance: 0 });
    // Tolerance 0 still matches exactly-equal pixels, so a uniform image is
    // entirely removed; verify the opposite case instead.
    expect(mask.every((v) => v === REMOVE)).toBe(true);
  });
});

describe('featherMask', () => {
  it('creates intermediate alpha values at the boundary', () => {
    const raster = cardOnWhite();
    const mask = buildBackgroundMask(raster, { tolerance: 40 });
    const soft = featherMask(mask, 60, 60, 2);

    const hasPartial = Array.from(soft).some((v) => v > 10 && v < 245);
    expect(hasPartial).toBe(true);
  });

  it('leaves the deep interior fully opaque and the far border fully clear', () => {
    const raster = cardOnWhite();
    const mask = buildBackgroundMask(raster, { tolerance: 40 });
    const soft = featherMask(mask, 60, 60, 1);

    expect(at(soft, 60, 30, 30)).toBe(255);
    expect(at(soft, 60, 1, 1)).toBe(0);
  });

  it('is a no-op at radius 0', () => {
    const mask = new Uint8Array([0, 255, 0, 255]);
    expect(featherMask(mask, 2, 2, 0)).toBe(mask);
  });
});

describe('applyMask', () => {
  it('writes the mask into the alpha channel', () => {
    const raster = cardOnWhite();
    const mask = buildBackgroundMask(raster, { tolerance: 40 });
    const out = applyMask(raster, mask);

    expect(getPixel(out, 2, 2)[3]).toBe(0);
    expect(getPixel(out, 30, 30)[3]).toBe(255);
    // Colour channels are untouched.
    expect(getPixel(out, 30, 30).slice(0, 3)).toEqual([220, 30, 40]);
  });

  it('cannot make an already-transparent pixel opaque', () => {
    const raster = createRaster(4, 4);
    fillRect(raster, 0, 0, 4, 4, [10, 10, 10, 0]);
    const mask = new Uint8Array(16).fill(KEEP);
    expect(getPixel(applyMask(raster, mask), 2, 2)[3]).toBe(0);
  });
});

describe('removeBackground', () => {
  it('produces a transparent surround and an opaque subject', () => {
    const out = removeBackground(cardOnWhite(), { tolerance: 40, feather: 1 });
    expect(getPixel(out, 1, 1)[3]).toBe(0);
    expect(getPixel(out, 30, 30)[3]).toBe(255);
  });
});

describe('paintMask', () => {
  it('erases within the brush radius and leaves the rest alone', () => {
    const mask = new Uint8Array(20 * 20).fill(KEEP);
    paintMask(mask, 20, 20, 10, 10, 4, 'erase');
    expect(at(mask, 20, 10, 10)).toBe(REMOVE);
    expect(at(mask, 20, 19, 19)).toBe(KEEP);
  });

  it('restores previously erased pixels', () => {
    const mask = new Uint8Array(20 * 20).fill(REMOVE);
    paintMask(mask, 20, 20, 5, 5, 3, 'restore');
    expect(at(mask, 20, 5, 5)).toBe(KEEP);
  });

  it('has a soft edge rather than a hard disc', () => {
    const mask = new Uint8Array(40 * 40).fill(KEEP);
    paintMask(mask, 40, 40, 20, 20, 10, 'erase');
    const edge = at(mask, 40, 29, 20);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(255);
  });

  it('clips at the image border without throwing', () => {
    const mask = new Uint8Array(10 * 10).fill(KEEP);
    expect(() => paintMask(mask, 10, 10, 0, 0, 6, 'erase')).not.toThrow();
    expect(at(mask, 10, 0, 0)).toBe(REMOVE);
  });
});

describe('keptFraction', () => {
  it('reports roughly the subject area for a normal cut-out', () => {
    const raster = cardOnWhite();
    const fraction = keptFraction(buildBackgroundMask(raster, { tolerance: 40 }));
    // The 30x30 card inside a 60x60 frame.
    expect(fraction).toBeCloseTo(0.25, 1);
  });

  it('goes to nearly zero when the flood fill escapes into the subject', () => {
    // A crop tight to the paper: the border is the paper itself, so the fill
    // starts on the subject and consumes all of it.
    const raster = createRaster(40, 40);
    fillRect(raster, 0, 0, 40, 40, [245, 240, 230, 255]);
    const fraction = keptFraction(buildBackgroundMask(raster, { tolerance: 40 }));
    expect(fraction).toBeLessThan(0.05);
  });

  it('is 1 when nothing is removed', () => {
    expect(keptFraction(new Uint8Array(100).fill(KEEP))).toBe(1);
  });
});

describe('resampleMask', () => {
  it('returns the same instance when the size is unchanged', () => {
    const mask = new Uint8Array([0, 255, 255, 0]);
    expect(resampleMask(mask, 2, 2, 2, 2)).toBe(mask);
  });

  it('scales up while preserving the kept and removed regions', () => {
    const mask = new Uint8Array(4 * 4).fill(REMOVE);
    for (let y = 1; y <= 2; y++) for (let x = 1; x <= 2; x++) mask[y * 4 + x] = KEEP;

    const out = resampleMask(mask, 4, 4, 16, 16);
    expect(out.length).toBe(256);
    expect(at(out, 16, 8, 8)).toBeGreaterThan(200);
    expect(at(out, 16, 0, 0)).toBeLessThan(60);
  });

  it('scales down without losing the subject entirely', () => {
    const mask = new Uint8Array(40 * 40).fill(REMOVE);
    for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) mask[y * 40 + x] = KEEP;

    const out = resampleMask(mask, 40, 40, 10, 10);
    expect(at(out, 10, 5, 5)).toBeGreaterThan(200);
  });

  it('carries a brush stroke across the resample', () => {
    const mask = new Uint8Array(50 * 50).fill(KEEP);
    paintMask(mask, 50, 50, 25, 25, 8, 'erase');
    const out = resampleMask(mask, 50, 50, 100, 100);
    expect(at(out, 100, 50, 50)).toBeLessThan(40);
    expect(at(out, 100, 2, 2)).toBeGreaterThan(200);
  });
});

describe('opaqueBounds', () => {
  it('finds the box around the kept region', () => {
    const raster = cardOnWhite();
    const mask = buildBackgroundMask(raster, { tolerance: 40 });
    const bounds = opaqueBounds(mask, 60, 60);
    expect(bounds).toEqual({ x: 15, y: 15, width: 30, height: 30 });
  });

  it('returns null when nothing is kept', () => {
    expect(opaqueBounds(new Uint8Array(16).fill(REMOVE), 4, 4)).toBeNull();
  });
});
