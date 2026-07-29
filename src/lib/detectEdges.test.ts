import { describe, expect, it } from 'vitest';
import { detectDocumentQuad } from './detectEdges';
import { isConvex, quadArea } from './geometry';
import { createRaster, fillRect, type Raster } from './raster';

/** A light page on a dark surface, at a known rectangle. */
function pageOnDarkSurface(
  x: number,
  y: number,
  w: number,
  h: number,
  size = 400,
): Raster {
  const raster = createRaster(size, size);
  fillRect(raster, 0, 0, size, size, [40, 40, 45, 255]);
  fillRect(raster, x, y, w, h, [240, 238, 230, 255]);
  return raster;
}

describe('detectDocumentQuad', () => {
  it('finds a high-contrast page and reports it as detected', () => {
    const result = detectDocumentQuad(pageOnDarkSurface(60, 50, 280, 300));
    expect(result.detected).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.18);

    // Detection runs on a downscaled copy, so allow a few pixels of slack.
    expect(result.quad.tl.x).toBeCloseTo(60, -1);
    expect(result.quad.tl.y).toBeCloseTo(50, -1);
    expect(result.quad.br.x).toBeCloseTo(340, -1);
    expect(result.quad.br.y).toBeCloseTo(350, -1);
  });

  it('always returns a convex, usable quad', () => {
    const result = detectDocumentQuad(pageOnDarkSurface(40, 70, 300, 240));
    expect(isConvex(result.quad)).toBe(true);
    expect(quadArea(result.quad)).toBeGreaterThan(0);
  });

  it('falls back to an inset rectangle on a flat image with no edges', () => {
    const raster = createRaster(300, 300);
    fillRect(raster, 0, 0, 300, 300, [128, 128, 128, 255]);
    const result = detectDocumentQuad(raster);
    expect(result.detected).toBe(false);
    expect(result.quad.tl.x).toBeGreaterThan(0);
    expect(result.quad.br.x).toBeLessThan(300);
  });

  it('reports low confidence when the page barely contrasts with the surface', () => {
    const raster = createRaster(300, 300);
    fillRect(raster, 0, 0, 300, 300, [190, 190, 190, 255]);
    fillRect(raster, 50, 50, 200, 200, [196, 196, 196, 255]);
    const strong = detectDocumentQuad(pageOnDarkSurface(50, 50, 200, 200, 300));
    const weak = detectDocumentQuad(raster);
    expect(weak.confidence).toBeLessThan(strong.confidence);
  });

  it('returns the fallback for an image too small to analyse', () => {
    const raster = createRaster(8, 8);
    const result = detectDocumentQuad(raster);
    expect(result.detected).toBe(false);
    expect(isConvex(result.quad)).toBe(true);
  });

  it('keeps the detected quad inside the image bounds', () => {
    const result = detectDocumentQuad(pageOnDarkSurface(20, 20, 360, 360));
    for (const p of [result.quad.tl, result.quad.tr, result.quad.br, result.quad.bl]) {
      expect(p.x).toBeGreaterThan(-40);
      expect(p.x).toBeLessThan(440);
      expect(p.y).toBeGreaterThan(-40);
      expect(p.y).toBeLessThan(440);
    }
  });

  it('handles a non-square image without transposing the axes', () => {
    const raster = createRaster(480, 240);
    fillRect(raster, 0, 0, 480, 240, [30, 30, 30, 255]);
    fillRect(raster, 60, 40, 360, 160, [240, 240, 240, 255]);
    const result = detectDocumentQuad(raster);
    expect(result.detected).toBe(true);
    expect(result.quad.tl.x).toBeCloseTo(60, -1);
    expect(result.quad.tl.y).toBeCloseTo(40, -1);
  });
});
