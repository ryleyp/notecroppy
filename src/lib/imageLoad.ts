import type { Raster } from './raster';

/** Longest edge of the copy the editor draws and manipulates interactively. */
export const EDIT_MAX_DIMENSION = 1600;

export interface LoadedImage {
  /** Full-resolution pixels, used for the final export. */
  full: Raster;
  /** Downscaled copy for the editor, capped at EDIT_MAX_DIMENSION. */
  preview: Raster;
  /** Multiply a preview coordinate by this to reach full resolution. */
  scale: number;
}

function rasterFromCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): Raster {
  const context = (canvas as HTMLCanvasElement).getContext('2d', {
    willReadFrequently: true,
  }) as CanvasRenderingContext2D | null;
  if (!context) throw new Error('Could not get a 2D canvas context');
  const { width, height } = canvas;
  const imageData = context.getImageData(0, 0, width, height);
  return { data: imageData.data, width, height };
}

export function rasterToCanvas(raster: Raster): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = raster.width;
  canvas.height = raster.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not get a 2D canvas context');
  const imageData = new ImageData(
    new Uint8ClampedArray(raster.data),
    raster.width,
    raster.height,
  );
  context.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Decodes a picked file into pixels.
 *
 * `imageOrientation: 'from-image'` is the important part: iPhone photos carry
 * an EXIF rotation flag rather than storing rotated pixels, and without this
 * a portrait photo decodes sideways, which throws off the corner positions and
 * every export downstream.
 */
async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Safari has historically rejected the options bag; fall through.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Could not decode that image'));
      image.src = url;
    });
    return image;
  } finally {
    // Revoking after load is safe; the decoded bitmap no longer needs the URL.
    URL.revokeObjectURL(url);
  }
}

function drawToRaster(
  source: ImageBitmap | HTMLImageElement,
  width: number,
  height: number,
): Raster {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not get a 2D canvas context');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, width, height);
  return rasterFromCanvas(canvas);
}

export async function loadImageFile(file: Blob): Promise<LoadedImage> {
  const source = await decode(file);
  const naturalWidth = 'width' in source ? source.width : 0;
  const naturalHeight = 'height' in source ? source.height : 0;
  if (!naturalWidth || !naturalHeight) throw new Error('That image appears to be empty');

  const full = drawToRaster(source, naturalWidth, naturalHeight);

  const scale = Math.min(1, EDIT_MAX_DIMENSION / Math.max(naturalWidth, naturalHeight));
  const preview =
    scale === 1
      ? full
      : drawToRaster(
          source,
          Math.max(1, Math.round(naturalWidth * scale)),
          Math.max(1, Math.round(naturalHeight * scale)),
        );

  if ('close' in source && typeof source.close === 'function') source.close();

  return { full, preview, scale: scale === 0 ? 1 : 1 / scale };
}
