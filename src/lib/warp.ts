import { outputSizeForQuad, quadToArray, type Quad } from './geometry';
import { applyHomography, solveHomography, type Matrix3 } from './homography';
import { createRaster, type Raster } from './raster';

/**
 * Samples `src` at fractional coordinates, blending the four surrounding
 * pixels. Coordinates outside the image clamp to the edge, so the border of a
 * warped page repeats its outermost pixels instead of going transparent.
 */
export function sampleBilinear(
  src: Raster,
  x: number,
  y: number,
  out: Uint8ClampedArray,
  outOffset: number,
): void {
  const { data, width, height } = src;

  const cx = Math.min(Math.max(x, 0), width - 1);
  const cy = Math.min(Math.max(y, 0), height - 1);

  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);

  const fx = cx - x0;
  const fy = cy - y0;

  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;

  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;

  for (let c = 0; c < 4; c++) {
    out[outOffset + c] =
      data[i00 + c] * w00 + data[i10 + c] * w10 + data[i01 + c] * w01 + data[i11 + c] * w11;
  }
}

/**
 * The transform taking destination-rectangle coordinates back to source-photo
 * coordinates. Warping is done by inverse mapping — walking every output pixel
 * and asking where it came from — because forward mapping would leave holes
 * wherever the source is stretched.
 */
export function inverseWarpMatrix(quad: Quad, outWidth: number, outHeight: number): Matrix3 {
  const destination = [
    { x: 0, y: 0 },
    { x: outWidth, y: 0 },
    { x: outWidth, y: outHeight },
    { x: 0, y: outHeight },
  ];
  return solveHomography(destination, quadToArray(quad));
}

export interface WarpOptions {
  /** Overrides the size derived from the quad's own edge lengths. */
  width?: number;
  height?: number;
}

/**
 * Flattens the region of `src` bounded by `quad` into an upright rectangle,
 * correcting the perspective of a photo taken at an angle.
 */
export function warpQuadToRect(src: Raster, quad: Quad, options: WarpOptions = {}): Raster {
  const derived = outputSizeForQuad(quad);
  const outWidth = Math.max(1, Math.round(options.width ?? derived.width));
  const outHeight = Math.max(1, Math.round(options.height ?? derived.height));

  const h = inverseWarpMatrix(quad, outWidth, outHeight);
  const out = createRaster(outWidth, outHeight);

  // Expanded from applyHomography so the per-pixel path avoids allocating a
  // point object for every one of the (often millions of) output pixels.
  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = h;

  for (let y = 0; y < outHeight; y++) {
    const py = y + 0.5;
    let numX = h0 * 0.5 + h1 * py + h2;
    let numY = h3 * 0.5 + h4 * py + h5;
    let denom = h6 * 0.5 + h7 * py + h8;

    for (let x = 0; x < outWidth; x++) {
      const w = denom === 0 ? 1e-12 : denom;
      sampleBilinear(src, numX / w, numY / w, out.data, (y * outWidth + x) * 4);
      numX += h0;
      numY += h3;
      denom += h6;
    }
  }

  return out;
}

/** Convenience wrapper for callers that only have a matrix and a point. */
export function projectPoint(h: Matrix3, x: number, y: number) {
  return applyHomography(h, { x, y });
}
