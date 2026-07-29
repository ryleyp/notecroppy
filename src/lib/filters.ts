import { cloneRaster, luminance, type Raster } from './raster';

export type FilterMode = 'original' | 'enhance' | 'grayscale' | 'bw';

export const FILTER_LABELS: Record<FilterMode, string> = {
  original: 'Original',
  enhance: 'Brighten',
  grayscale: 'Greyscale',
  bw: 'Black & white',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The value below which `fraction` of the samples fall, computed from a 256-bin
 * histogram. Used to find a white point that ignores specular highlights.
 */
function percentile(histogram: Uint32Array, total: number, fraction: number): number {
  let seen = 0;
  const target = total * fraction;
  for (let v = 0; v < 256; v++) {
    seen += histogram[v];
    if (seen >= target) return v;
  }
  return 255;
}

/** Widest gain a single channel may take, to stop noise exploding. */
const MAX_GAIN = 4;
/** Below this spread a channel is treated as flat and only gets brightened. */
const FLAT_RANGE = 16;

/**
 * Per-channel white balance: stretches each channel so its bright end lands on
 * white, which neutralises the yellow cast of indoor light and makes
 * photographed paper actually read as paper.
 *
 * The white point is the 97th percentile rather than the true maximum, so a
 * single blown-out reflection cannot flatten the whole correction.
 *
 * Note this deliberately forces the lightest tone in the frame to white. That
 * is right for a sheet of notepaper and wrong for saturated coloured
 * stationery, which comes out washed out — hence `original` staying on the
 * filter bar as the choice for pretty paper.
 */
export function autoEnhance(raster: Raster, strength = 1): Raster {
  const out = cloneRaster(raster);
  const { data } = out;
  const pixels = raster.width * raster.height;

  const histograms = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  for (let i = 0; i < data.length; i += 4) {
    histograms[0][data[i]]++;
    histograms[1][data[i + 1]]++;
    histograms[2][data[i + 2]]++;
  }

  const scales = histograms.map((histogram) => {
    const white = percentile(histogram, pixels, 0.97);
    const black = percentile(histogram, pixels, 0.02);
    const range = white - black;

    // An evenly-coloured crop — a plain sticky note fills the whole frame with
    // one tone — has no range to stretch. Pulling the black point up in that
    // case would drive every pixel to zero, so only apply brightening.
    if (range < FLAT_RANGE) {
      return { black: 0, scale: clamp(255 / Math.max(white, 1), 1, MAX_GAIN) };
    }
    return { black, scale: clamp(255 / range, 0.5, MAX_GAIN) };
  });

  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const { black, scale } = scales[c];
      const stretched = (data[i + c] - black) * scale;
      const value = data[i + c] + (stretched - data[i + c]) * strength;
      // Gentle S-curve to recover contrast lost to the flat lighting of a
      // phone photo taken indoors.
      const n = Math.min(1, Math.max(0, value / 255));
      const curved = n < 0.5 ? 2 * n * n : 1 - 2 * (1 - n) * (1 - n);
      data[i + c] = Math.round((n + (curved - n) * 0.35 * strength) * 255);
    }
  }

  return out;
}

export function toGrayscaleRaster(raster: Raster): Raster {
  const out = cloneRaster(raster);
  const { data } = out;
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.round(luminance(data[i], data[i + 1], data[i + 2]));
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }
  return out;
}

/**
 * Otsu's method: picks the threshold that best separates the luminance
 * histogram into two clusters, which adapts to how bright the photo happens to
 * be instead of hardcoding a midpoint.
 */
export function otsuThreshold(raster: Raster): number {
  const histogram = new Uint32Array(256);
  const { data } = raster;
  for (let i = 0; i < data.length; i += 4) {
    histogram[Math.round(luminance(data[i], data[i + 1], data[i + 2]))]++;
  }

  const total = raster.width * raster.height;
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * histogram[v];

  let sumBackground = 0;
  let weightBackground = 0;
  let best = 0;
  let bestVariance = -1;

  for (let v = 0; v < 256; v++) {
    weightBackground += histogram[v];
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += v * histogram[v];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const variance =
      weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;

    if (variance > bestVariance) {
      bestVariance = variance;
      best = v;
    }
  }

  return best;
}

export function toBlackAndWhite(raster: Raster, threshold?: number): Raster {
  const cut = threshold ?? otsuThreshold(raster);
  const out = cloneRaster(raster);
  const { data } = out;
  for (let i = 0; i < data.length; i += 4) {
    const v = luminance(data[i], data[i + 1], data[i + 2]) > cut ? 255 : 0;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }
  return out;
}

export function applyFilter(raster: Raster, mode: FilterMode): Raster {
  switch (mode) {
    case 'enhance':
      return autoEnhance(raster);
    case 'grayscale':
      return toGrayscaleRaster(raster);
    case 'bw':
      return toBlackAndWhite(raster);
    case 'original':
      return cloneRaster(raster);
  }
}

/** Rotates by a multiple of 90 degrees, normalising negative turns. */
export function rotateRaster(raster: Raster, quarterTurns: number): Raster {
  const turns = ((quarterTurns % 4) + 4) % 4;
  if (turns === 0) return cloneRaster(raster);

  const { data, width, height } = raster;
  const swapped = turns % 2 === 1;
  const outWidth = swapped ? height : width;
  const outHeight = swapped ? width : height;
  const out = new Uint8ClampedArray(data.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let nx: number;
      let ny: number;
      if (turns === 1) {
        nx = height - 1 - y;
        ny = x;
      } else if (turns === 2) {
        nx = width - 1 - x;
        ny = height - 1 - y;
      } else {
        nx = y;
        ny = width - 1 - x;
      }
      const from = (y * width + x) * 4;
      const to = (ny * outWidth + nx) * 4;
      out[to] = data[from];
      out[to + 1] = data[from + 1];
      out[to + 2] = data[from + 2];
      out[to + 3] = data[from + 3];
    }
  }

  return { data: out, width: outWidth, height: outHeight };
}
