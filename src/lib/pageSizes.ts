/** Page presets in PDF points (1pt = 1/72 inch). */
export interface PageSize {
  id: string;
  label: string;
  hint: string;
  /** null means "match the image's own aspect ratio". */
  points: { width: number; height: number } | null;
}

export const PAGE_SIZES: PageSize[] = [
  {
    id: 'fit',
    label: 'Fit to image',
    hint: 'Page matches the paper exactly, no margins',
    points: null,
  },
  {
    id: 'ipad',
    label: 'iPad 4:3',
    hint: 'Matches the standard GoodNotes portrait notebook',
    points: { width: 576, height: 768 },
  },
  {
    id: 'a4',
    label: 'A4',
    hint: '210 × 297 mm',
    points: { width: 595.28, height: 841.89 },
  },
  {
    id: 'letter',
    label: 'US Letter',
    hint: '8.5 × 11 in',
    points: { width: 612, height: 792 },
  },
];

export const DEFAULT_PAGE_SIZE = PAGE_SIZES[0];

export function findPageSize(id: string): PageSize {
  return PAGE_SIZES.find((size) => size.id === id) ?? DEFAULT_PAGE_SIZE;
}

/** Assumed print density when a "fit to image" page is sized from pixels. */
export const FIT_DPI = 150;

export interface PageLayout {
  pageWidth: number;
  pageHeight: number;
  drawX: number;
  drawY: number;
  drawWidth: number;
  drawHeight: number;
  orientation: 'portrait' | 'landscape';
}

/**
 * Works out where the flattened image sits on the PDF page.
 *
 * A fixed page preset swaps to landscape when the image is wider than tall, so
 * a landscape notepad does not end up letterboxed into a portrait page. The
 * image is then scaled to fit inside the margin and centred.
 */
export function layoutPage(
  imageWidth: number,
  imageHeight: number,
  size: PageSize,
  marginPoints = 0,
): PageLayout {
  const imageIsLandscape = imageWidth > imageHeight;

  if (!size.points) {
    const pageWidth = (imageWidth / FIT_DPI) * 72;
    const pageHeight = (imageHeight / FIT_DPI) * 72;
    return {
      pageWidth,
      pageHeight,
      drawX: 0,
      drawY: 0,
      drawWidth: pageWidth,
      drawHeight: pageHeight,
      orientation: imageIsLandscape ? 'landscape' : 'portrait',
    };
  }

  const pageWidth = imageIsLandscape ? size.points.height : size.points.width;
  const pageHeight = imageIsLandscape ? size.points.width : size.points.height;

  const availableWidth = Math.max(1, pageWidth - marginPoints * 2);
  const availableHeight = Math.max(1, pageHeight - marginPoints * 2);
  const scale = Math.min(availableWidth / imageWidth, availableHeight / imageHeight);

  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;

  return {
    pageWidth,
    pageHeight,
    drawX: (pageWidth - drawWidth) / 2,
    drawY: (pageHeight - drawHeight) / 2,
    drawWidth,
    drawHeight,
    orientation: imageIsLandscape ? 'landscape' : 'portrait',
  };
}
