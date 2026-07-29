import { useEffect, useRef } from 'react';
import type { Raster } from '../lib/raster';

interface RasterViewProps {
  raster: Raster;
  className?: string;
  /** Shows a checkerboard behind the image so transparency is visible. */
  checkered?: boolean;
  onPointerDown?: (x: number, y: number, event: React.PointerEvent) => void;
  onPointerMove?: (x: number, y: number, event: React.PointerEvent) => void;
  onPointerUp?: (event: React.PointerEvent) => void;
}

/**
 * Draws a raster to a canvas at its natural pixel size, letting CSS scale it
 * down for display. Pointer callbacks report positions in raster coordinates so
 * brush strokes land where they look like they should.
 */
export function RasterView({
  raster,
  className,
  checkered,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: RasterViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = raster.width;
    canvas.height = raster.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, raster.width, raster.height);
    context.putImageData(
      new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height),
      0,
      0,
    );
  }, [raster]);

  const toRaster = (event: React.PointerEvent): [number, number] => {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) / rect.width) * raster.width,
      ((event.clientY - rect.top) / rect.height) * raster.height,
    ];
  };

  return (
    <canvas
      ref={canvasRef}
      className={[className, checkered ? 'checkered' : ''].filter(Boolean).join(' ')}
      onPointerDown={
        onPointerDown
          ? (event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              const [x, y] = toRaster(event);
              onPointerDown(x, y, event);
            }
          : undefined
      }
      onPointerMove={
        onPointerMove
          ? (event) => {
              const [x, y] = toRaster(event);
              onPointerMove(x, y, event);
            }
          : undefined
      }
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}
