/**
 * A plain RGBA pixel buffer. `ImageData` satisfies this structurally, which
 * keeps every image-processing function in this project testable in Node
 * without a DOM.
 */
export interface Raster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function createRaster(width: number, height: number): Raster {
  return { data: new Uint8ClampedArray(width * height * 4), width, height };
}

export function cloneRaster(raster: Raster): Raster {
  return {
    data: new Uint8ClampedArray(raster.data),
    width: raster.width,
    height: raster.height,
  };
}

/** Fills a rectangle with a solid colour; used mostly to build test fixtures. */
export function fillRect(
  raster: Raster,
  x0: number,
  y0: number,
  w: number,
  h: number,
  [r, g, b, a]: [number, number, number, number],
): void {
  for (let y = Math.max(0, y0); y < Math.min(raster.height, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(raster.width, x0 + w); x++) {
      const i = (y * raster.width + x) * 4;
      raster.data[i] = r;
      raster.data[i + 1] = g;
      raster.data[i + 2] = b;
      raster.data[i + 3] = a;
    }
  }
}

export function getPixel(raster: Raster, x: number, y: number): [number, number, number, number] {
  const i = (y * raster.width + x) * 4;
  return [raster.data[i], raster.data[i + 1], raster.data[i + 2], raster.data[i + 3]];
}

/** Rec. 709 luma, which tracks perceived brightness better than a flat mean. */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function toGrayscale(raster: Raster): Float32Array {
  const { data, width, height } = raster;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    out[p] = luminance(data[i], data[i + 1], data[i + 2]);
  }
  return out;
}
