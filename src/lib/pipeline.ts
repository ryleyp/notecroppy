import { applyFilter, rotateRaster, type FilterMode } from './filters';
import { scaleQuad, type Quad } from './geometry';
import type { Raster } from './raster';
import { warpQuadToRect } from './warp';

export interface EditSettings {
  quad: Quad;
  /** Clockwise quarter turns applied after flattening. */
  rotation: number;
  filter: FilterMode;
}

/**
 * Crop, straighten, rotate, then colour-correct.
 *
 * Order matters: the perspective warp has to happen on the original pixels, and
 * the filter has to run last so its histogram is measured on the paper alone
 * rather than on whatever surface surrounded it.
 */
export function runPipeline(source: Raster, settings: EditSettings): Raster {
  const flattened = warpQuadToRect(source, settings.quad);
  const rotated = rotateRaster(flattened, settings.rotation);
  return applyFilter(rotated, settings.filter);
}

/**
 * The same pipeline at full resolution. The quad was placed on the downscaled
 * editor copy, so it is scaled back up before warping.
 */
export function runPipelineAtFullResolution(
  full: Raster,
  settings: EditSettings,
  previewToFullScale: number,
): Raster {
  return runPipeline(full, { ...settings, quad: scaleQuad(settings.quad, previewToFullScale) });
}
