import { rasterToCanvas } from './imageLoad';
import { layoutPage, type PageSize } from './pageSizes';
import type { Raster } from './raster';

export type ExportFormat = 'pdf' | 'png' | 'png-cutout' | 'jpg';

export interface ExportResult {
  blob: Blob;
  filename: string;
  format: ExportFormat;
  width: number;
  height: number;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The browser could not encode that image'))),
      type,
      quality,
    );
  });
}

/** Flattens transparency onto white, which JPEG cannot represent. */
function flattenOntoWhite(raster: Raster): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = raster.width;
  canvas.height = raster.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not get a 2D canvas context');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, raster.width, raster.height);
  context.drawImage(rasterToCanvas(raster), 0, 0);
  return canvas;
}

export function timestampedName(base: string, extension: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${base}-${stamp}.${extension}`;
}

export async function exportPng(raster: Raster, name = 'notecroppy'): Promise<ExportResult> {
  const blob = await canvasToBlob(rasterToCanvas(raster), 'image/png');
  return {
    blob,
    filename: timestampedName(name, 'png'),
    format: 'png',
    width: raster.width,
    height: raster.height,
  };
}

export async function exportJpg(
  raster: Raster,
  name = 'notecroppy',
  quality = 0.92,
): Promise<ExportResult> {
  const blob = await canvasToBlob(flattenOntoWhite(raster), 'image/jpeg', quality);
  return {
    blob,
    filename: timestampedName(name, 'jpg'),
    format: 'jpg',
    width: raster.width,
    height: raster.height,
  };
}

export interface PdfOptions {
  pageSize: PageSize;
  marginPoints?: number;
  /** Paints the page white behind the image; off keeps a transparent page. */
  whiteBackground?: boolean;
}

/**
 * Lays the flattened image onto a PDF page for import as GoodNotes notebook
 * paper.
 *
 * The image is embedded as PNG so a transparent cutout stays transparent, and
 * at its full pixel resolution rather than the page's point size, which is what
 * keeps it sharp when GoodNotes scales the page up on a Retina display.
 */
export async function exportPdf(
  raster: Raster,
  options: PdfOptions,
  name = 'notecroppy',
): Promise<ExportResult> {
  const layout = layoutPage(
    raster.width,
    raster.height,
    options.pageSize,
    options.marginPoints ?? 0,
  );

  // Loaded on demand: jsPDF is the single largest dependency, and someone
  // exporting a PNG sticker should not pay for it on first load.
  const { jsPDF } = await import('jspdf');

  const pdf = new jsPDF({
    orientation: layout.orientation,
    unit: 'pt',
    format: [layout.pageWidth, layout.pageHeight],
    compress: true,
  });

  if (options.whiteBackground ?? true) {
    pdf.setFillColor(255, 255, 255);
    pdf.rect(0, 0, layout.pageWidth, layout.pageHeight, 'F');
  }

  const dataUrl = rasterToCanvas(raster).toDataURL('image/png');
  pdf.addImage(
    dataUrl,
    'PNG',
    layout.drawX,
    layout.drawY,
    layout.drawWidth,
    layout.drawHeight,
    undefined,
    'FAST',
  );

  return {
    blob: pdf.output('blob'),
    filename: timestampedName(name, 'pdf'),
    format: 'pdf',
    width: Math.round(layout.pageWidth),
    height: Math.round(layout.pageHeight),
  };
}
