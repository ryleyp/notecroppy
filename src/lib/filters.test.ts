import { describe, expect, it } from 'vitest';
import {
  applyFilter,
  autoEnhance,
  otsuThreshold,
  rotateRaster,
  toBlackAndWhite,
  toGrayscaleRaster,
} from './filters';
import { createRaster, fillRect, getPixel, luminance } from './raster';

describe('autoEnhance', () => {
  it('lifts a dull, yellow-cast photo toward white', () => {
    const raster = createRaster(20, 20);
    // Paper photographed under warm indoor light: dim and blue-starved.
    fillRect(raster, 0, 0, 20, 20, [200, 190, 150, 255]);
    const out = autoEnhance(raster);
    const [r, g, b] = getPixel(out, 10, 10);
    expect(Math.min(r, g, b)).toBeGreaterThan(200);
    // The channels should end up far closer together than they started.
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(200 - 150);
  });

  it('keeps dark ink dark while brightening the page', () => {
    const raster = createRaster(40, 40);
    fillRect(raster, 0, 0, 40, 40, [190, 185, 160, 255]);
    fillRect(raster, 10, 10, 8, 8, [40, 38, 35, 255]);
    const out = autoEnhance(raster);

    const page = luminance(...(getPixel(out, 35, 35).slice(0, 3) as [number, number, number]));
    const ink = luminance(...(getPixel(out, 13, 13).slice(0, 3) as [number, number, number]));
    expect(page).toBeGreaterThan(200);
    expect(ink).toBeLessThan(90);
  });

  it('brightens a flat single-tone crop instead of crushing it to black', () => {
    // A plain sticky note fills the frame with one colour, leaving no range to
    // stretch. This regressed once already: the black-point subtraction drove
    // every pixel to zero.
    const raster = createRaster(16, 16);
    fillRect(raster, 0, 0, 16, 16, [180, 180, 175, 255]);
    const [r, g, b] = getPixel(autoEnhance(raster), 8, 8);
    expect(Math.min(r, g, b)).toBeGreaterThan(180);
  });

  it('does not blow up gain on a very dark flat crop', () => {
    const raster = createRaster(16, 16);
    fillRect(raster, 0, 0, 16, 16, [8, 8, 8, 255]);
    const [r, g, b] = getPixel(autoEnhance(raster), 8, 8);
    // Capped at MAX_GAIN, so near-black stays dark rather than becoming noise.
    expect(Math.max(r, g, b)).toBeLessThan(90);
  });

  it('preserves the alpha channel', () => {
    const raster = createRaster(8, 8);
    fillRect(raster, 0, 0, 8, 8, [120, 130, 140, 128]);
    expect(getPixel(autoEnhance(raster), 4, 4)[3]).toBe(128);
  });

  it('does not mutate its input', () => {
    const raster = createRaster(8, 8);
    fillRect(raster, 0, 0, 8, 8, [100, 100, 100, 255]);
    const before = Array.from(raster.data);
    autoEnhance(raster);
    expect(Array.from(raster.data)).toEqual(before);
  });
});

describe('toGrayscaleRaster', () => {
  it('gives all three channels the same value', () => {
    const raster = createRaster(4, 4);
    fillRect(raster, 0, 0, 4, 4, [255, 0, 0, 255]);
    const [r, g, b] = getPixel(toGrayscaleRaster(raster), 2, 2);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('weights green above red above blue', () => {
    const make = (colour: [number, number, number, number]) => {
      const raster = createRaster(2, 2);
      fillRect(raster, 0, 0, 2, 2, colour);
      return getPixel(toGrayscaleRaster(raster), 1, 1)[0];
    };
    const red = make([255, 0, 0, 255]);
    const green = make([0, 255, 0, 255]);
    const blue = make([0, 0, 255, 255]);
    expect(green).toBeGreaterThan(red);
    expect(red).toBeGreaterThan(blue);
  });
});

describe('otsuThreshold', () => {
  it('separates two well-separated clusters', () => {
    const raster = createRaster(20, 20);
    fillRect(raster, 0, 0, 20, 20, [230, 230, 230, 255]);
    fillRect(raster, 0, 0, 20, 8, [30, 30, 30, 255]);
    const threshold = otsuThreshold(raster);
    // Class 0 is [0..t], so the dark cluster may sit exactly on the threshold.
    expect(threshold).toBeGreaterThanOrEqual(30);
    expect(threshold).toBeLessThan(230);
  });

  it('picks a cut that classifies both clusters correctly', () => {
    const raster = createRaster(20, 20);
    fillRect(raster, 0, 0, 20, 20, [200, 200, 200, 255]);
    fillRect(raster, 0, 0, 20, 9, [70, 70, 70, 255]);
    const out = toBlackAndWhite(raster, otsuThreshold(raster));
    expect(getPixel(out, 10, 2)[0]).toBe(0);
    expect(getPixel(out, 10, 15)[0]).toBe(255);
  });
});

describe('toBlackAndWhite', () => {
  it('produces only pure black and pure white', () => {
    const raster = createRaster(16, 16);
    fillRect(raster, 0, 0, 16, 16, [200, 200, 200, 255]);
    fillRect(raster, 0, 0, 16, 6, [60, 60, 60, 255]);
    const out = toBlackAndWhite(raster);
    for (let i = 0; i < out.data.length; i += 4) {
      expect([0, 255]).toContain(out.data[i]);
    }
  });

  it('respects an explicit threshold', () => {
    const raster = createRaster(4, 4);
    fillRect(raster, 0, 0, 4, 4, [100, 100, 100, 255]);
    expect(getPixel(toBlackAndWhite(raster, 50), 2, 2)[0]).toBe(255);
    expect(getPixel(toBlackAndWhite(raster, 150), 2, 2)[0]).toBe(0);
  });
});

describe('rotateRaster', () => {
  it('swaps dimensions on a quarter turn', () => {
    const raster = createRaster(10, 4);
    const out = rotateRaster(raster, 1);
    expect(out.width).toBe(4);
    expect(out.height).toBe(10);
  });

  it('moves the top-left pixel to the top-right on a clockwise turn', () => {
    const raster = createRaster(3, 3);
    fillRect(raster, 0, 0, 3, 3, [0, 0, 0, 255]);
    fillRect(raster, 0, 0, 1, 1, [255, 0, 0, 255]);
    const out = rotateRaster(raster, 1);
    expect(getPixel(out, 2, 0)).toEqual([255, 0, 0, 255]);
  });

  it('returns to the original after four turns', () => {
    const raster = createRaster(5, 3);
    for (let i = 0; i < raster.data.length; i++) raster.data[i] = (i * 7) % 256;
    const out = rotateRaster(raster, 4);
    expect(out.width).toBe(5);
    expect(Array.from(out.data)).toEqual(Array.from(raster.data));
  });

  it('normalises negative turns', () => {
    const raster = createRaster(6, 2);
    const negative = rotateRaster(raster, -1);
    const positive = rotateRaster(raster, 3);
    expect(negative.width).toBe(positive.width);
    expect(negative.height).toBe(positive.height);
  });
});

describe('applyFilter', () => {
  it('copies rather than aliases on original', () => {
    const raster = createRaster(4, 4);
    fillRect(raster, 0, 0, 4, 4, [1, 2, 3, 255]);
    const out = applyFilter(raster, 'original');
    expect(out.data).not.toBe(raster.data);
    expect(Array.from(out.data)).toEqual(Array.from(raster.data));
  });
});
