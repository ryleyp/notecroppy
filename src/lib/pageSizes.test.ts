import { describe, expect, it } from 'vitest';
import { FIT_DPI, findPageSize, layoutPage, PAGE_SIZES } from './pageSizes';

const a4 = findPageSize('a4');
const fit = findPageSize('fit');

describe('findPageSize', () => {
  it('falls back to the default for an unknown id', () => {
    expect(findPageSize('nope').id).toBe(PAGE_SIZES[0].id);
  });
});

describe('layoutPage', () => {
  it('sizes a fit-to-image page from the pixel dimensions at FIT_DPI', () => {
    const layout = layoutPage(FIT_DPI * 2, FIT_DPI * 3, fit);
    expect(layout.pageWidth).toBeCloseTo(144, 6); // 2 inches
    expect(layout.pageHeight).toBeCloseTo(216, 6); // 3 inches
  });

  it('leaves no margin on a fit-to-image page', () => {
    const layout = layoutPage(600, 900, fit);
    expect(layout.drawX).toBe(0);
    expect(layout.drawY).toBe(0);
    expect(layout.drawWidth).toBeCloseTo(layout.pageWidth, 6);
    expect(layout.drawHeight).toBeCloseTo(layout.pageHeight, 6);
  });

  it('keeps a fixed page portrait for a tall image', () => {
    const layout = layoutPage(600, 900, a4);
    expect(layout.orientation).toBe('portrait');
    expect(layout.pageWidth).toBeCloseTo(595.28, 2);
    expect(layout.pageHeight).toBeCloseTo(841.89, 2);
  });

  it('swaps a fixed page to landscape for a wide image', () => {
    const layout = layoutPage(900, 600, a4);
    expect(layout.orientation).toBe('landscape');
    expect(layout.pageWidth).toBeCloseTo(841.89, 2);
    expect(layout.pageHeight).toBeCloseTo(595.28, 2);
  });

  it('preserves the image aspect ratio when fitting', () => {
    const layout = layoutPage(1000, 500, a4);
    expect(layout.drawWidth / layout.drawHeight).toBeCloseTo(2, 6);
  });

  it('centres the image on the page', () => {
    const layout = layoutPage(400, 400, a4);
    expect(layout.drawX + layout.drawWidth / 2).toBeCloseTo(layout.pageWidth / 2, 6);
    expect(layout.drawY + layout.drawHeight / 2).toBeCloseTo(layout.pageHeight / 2, 6);
  });

  it('never draws outside the page once a margin is applied', () => {
    const margin = 36;
    const layout = layoutPage(2000, 1400, a4, margin);
    expect(layout.drawX).toBeGreaterThanOrEqual(margin - 1e-6);
    expect(layout.drawY).toBeGreaterThanOrEqual(margin - 1e-6);
    expect(layout.drawX + layout.drawWidth).toBeLessThanOrEqual(layout.pageWidth - margin + 1e-6);
    expect(layout.drawY + layout.drawHeight).toBeLessThanOrEqual(layout.pageHeight - margin + 1e-6);
  });

  it('handles a margin larger than the page without producing negative sizes', () => {
    const layout = layoutPage(500, 500, a4, 5000);
    expect(layout.drawWidth).toBeGreaterThan(0);
    expect(layout.drawHeight).toBeGreaterThan(0);
  });

  it('gives the iPad preset a 3:4 ratio', () => {
    const layout = layoutPage(600, 800, findPageSize('ipad'));
    expect(layout.pageWidth / layout.pageHeight).toBeCloseTo(0.75, 6);
  });
});
