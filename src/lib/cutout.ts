import { cloneRaster, type Raster } from './raster';

export const KEEP = 255;
export const REMOVE = 0;

export interface CutoutOptions {
  /** Colour distance, 0-160. Higher removes more of the surrounding surface. */
  tolerance?: number;
  /** Alpha softening radius in pixels. 0 gives a hard, aliased edge. */
  feather?: number;
}

/** Squared Euclidean RGB distance, avoiding a sqrt in the inner loop. */
function distanceSquared(
  data: Uint8ClampedArray,
  i: number,
  r: number,
  g: number,
  b: number,
): number {
  const dr = data[i] - r;
  const dg = data[i + 1] - g;
  const db = data[i + 2] - b;
  return dr * dr + dg * dg + db * db;
}

/**
 * The dominant colour around the outside of the image, taken as the median of
 * the border pixels. A median rather than a mean so that a stray dark object
 * touching one edge does not drag the reference away from the real surface.
 */
export function estimateBackgroundColor(raster: Raster): [number, number, number] {
  const { data, width, height } = raster;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];

  const push = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    rs.push(data[i]);
    gs.push(data[i + 1]);
    bs.push(data[i + 2]);
  };

  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    push(0, y);
    push(width - 1, y);
  }

  const median = (values: number[]) => {
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] ?? 0;
  };

  return [median(rs), median(gs), median(bs)];
}

/**
 * Flood fills inward from every border pixel, marking everything that stays
 * within `tolerance` of the background colour for removal.
 *
 * Connectivity matters here: a white area *inside* the stationery design is
 * never reached from the border, so it survives even though it matches the
 * background colour.
 *
 * Returns a mask where KEEP means foreground.
 */
export function buildBackgroundMask(raster: Raster, options: CutoutOptions = {}): Uint8Array {
  const { data, width, height } = raster;
  const tolerance = options.tolerance ?? 40;
  const threshold = tolerance * tolerance * 3;

  const [br, bg, bb] = estimateBackgroundColor(raster);
  const mask = new Uint8Array(width * height).fill(KEEP);

  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const consider = (x: number, y: number) => {
    const p = y * width + x;
    if (mask[p] === REMOVE) return;
    if (distanceSquared(data, p * 4, br, bg, bb) > threshold) return;
    mask[p] = REMOVE;
    queue[tail++] = p;
  };

  for (let x = 0; x < width; x++) {
    consider(x, 0);
    consider(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    consider(0, y);
    consider(width - 1, y);
  }

  while (head < tail) {
    const p = queue[head++];
    const x = p % width;
    const y = (p / width) | 0;
    if (x > 0) consider(x - 1, y);
    if (x < width - 1) consider(x + 1, y);
    if (y > 0) consider(x, y - 1);
    if (y < height - 1) consider(x, y + 1);
  }

  return mask;
}

/**
 * Separable box blur over the mask, run twice to approximate a Gaussian. This
 * is what turns the hard 0/255 boundary into an anti-aliased alpha ramp so the
 * sticker does not have a jagged staircase edge.
 */
export function featherMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return mask;

  let current = Float32Array.from(mask);
  const window = radius * 2 + 1;

  for (let pass = 0; pass < 2; pass++) {
    const horizontal = new Float32Array(current.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) {
          sum += current[y * width + Math.min(Math.max(x + k, 0), width - 1)];
        }
        horizontal[y * width + x] = sum / window;
      }
    }
    const vertical = new Float32Array(current.length);
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) {
          sum += horizontal[Math.min(Math.max(y + k, 0), height - 1) * width + x];
        }
        vertical[y * width + x] = sum / window;
      }
    }
    current = vertical;
  }

  const out = new Uint8Array(current.length);
  for (let i = 0; i < current.length; i++) {
    out[i] = Math.round(Math.min(255, Math.max(0, current[i])));
  }
  return out;
}

/** Writes the mask into the alpha channel of a copy of `raster`. */
export function applyMask(raster: Raster, mask: Uint8Array): Raster {
  const out = cloneRaster(raster);
  for (let p = 0; p < mask.length; p++) {
    // Multiply so an already-transparent source pixel cannot become opaque.
    out.data[p * 4 + 3] = Math.round((out.data[p * 4 + 3] * mask[p]) / 255);
  }
  return out;
}

/** Convenience: mask, feather and apply in one call. */
export function removeBackground(raster: Raster, options: CutoutOptions = {}): Raster {
  const mask = buildBackgroundMask(raster, options);
  const feathered = featherMask(mask, raster.width, raster.height, options.feather ?? 1);
  return applyMask(raster, feathered);
}

export type BrushMode = 'erase' | 'restore';

/**
 * Paints a soft circular dab into the mask for manual touch-ups, since no
 * automatic threshold gets every stationery edge right.
 */
export function paintMask(
  mask: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  mode: BrushMode,
): void {
  const target = mode === 'erase' ? REMOVE : KEEP;
  const r = Math.max(1, radius);
  const minX = Math.max(0, Math.floor(cx - r));
  const maxX = Math.min(width - 1, Math.ceil(cx + r));
  const minY = Math.max(0, Math.floor(cy - r));
  const maxY = Math.min(height - 1, Math.ceil(cy + r));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > r) continue;
      // Soft falloff over the outer 30% of the brush.
      const strength = d < r * 0.7 ? 1 : 1 - (d - r * 0.7) / (r * 0.3);
      const p = y * width + x;
      mask[p] = Math.round(mask[p] + (target - mask[p]) * strength);
    }
  }
}

/**
 * Proportion of the image the mask keeps, 0-1.
 *
 * A very low value means the flood fill escaped into the subject — which is
 * what happens when the crop is tight to the paper, leaving no background for
 * it to start from.
 */
export function keptFraction(mask: Uint8Array, threshold = 8): number {
  if (mask.length === 0) return 0;
  let kept = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] > threshold) kept++;
  return kept / mask.length;
}

/**
 * Bilinearly resamples a mask to a new size.
 *
 * The cutout is tuned on the downscaled editor copy, but the export runs at
 * full resolution, so the mask — including any brush touch-ups, which exist
 * only as painted pixels — has to be carried up to match.
 */
export function resampleMask(
  mask: Uint8Array,
  width: number,
  height: number,
  outWidth: number,
  outHeight: number,
): Uint8Array {
  if (width === outWidth && height === outHeight) return mask;

  const out = new Uint8Array(outWidth * outHeight);
  const xRatio = width / outWidth;
  const yRatio = height / outHeight;

  for (let y = 0; y < outHeight; y++) {
    const sy = Math.min(height - 1, Math.max(0, (y + 0.5) * yRatio - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(y0 + 1, height - 1);
    const fy = sy - y0;

    for (let x = 0; x < outWidth; x++) {
      const sx = Math.min(width - 1, Math.max(0, (x + 0.5) * xRatio - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(x0 + 1, width - 1);
      const fx = sx - x0;

      const top = mask[y0 * width + x0] * (1 - fx) + mask[y0 * width + x1] * fx;
      const bottom = mask[y1 * width + x0] * (1 - fx) + mask[y1 * width + x1] * fx;
      out[y * outWidth + x] = Math.round(top * (1 - fy) + bottom * fy);
    }
  }

  return out;
}

/** Bounding box of the kept region, used to trim empty space off a sticker. */
export function opaqueBounds(
  mask: Uint8Array,
  width: number,
  height: number,
  threshold = 8,
): { x: number; y: number; width: number; height: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] <= threshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
