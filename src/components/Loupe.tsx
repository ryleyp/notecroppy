import { useEffect, useRef } from 'react';
import type { Point } from '../lib/geometry';

export const LOUPE_SIZE = 116;
const ZOOM = 3;

interface LoupeProps {
  /** The image being cropped, already rendered to a canvas. */
  source: HTMLCanvasElement | null;
  /** Corner position in source-image coordinates. */
  focus: Point;
  /** Display CSS pixels per source pixel, i.e. how shrunk the photo already is. */
  displayScale: number;
  /** Where the loupe sits within the editor, in CSS pixels. */
  left: number;
  top: number;
}

/**
 * A magnified window onto the area under the dragged corner.
 *
 * Without this the fingertip covers the exact edge being aligned, which is the
 * whole reason iOS shows one while you drag a scan's corners.
 */
export function Loupe({ source, focus, displayScale, left, top }: LoupeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = LOUPE_SIZE * dpr;
    canvas.height = LOUPE_SIZE * dpr;

    const context = canvas.getContext('2d');
    if (!context) return;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);

    context.fillStyle = '#000';
    context.fillRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);

    // ZOOM is relative to what the user already sees, not to raw source pixels.
    // A 12MP photo shown 340px wide is shrunk ~0.1x, so magnifying the source
    // directly would land at roughly 30x and show nothing but colour mush.
    const span = LOUPE_SIZE / (ZOOM * Math.max(displayScale, 0.001));
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      source,
      focus.x - span / 2,
      focus.y - span / 2,
      span,
      span,
      0,
      0,
      LOUPE_SIZE,
      LOUPE_SIZE,
    );

    // Crosshair marking the exact corner position.
    context.strokeStyle = 'rgba(255,255,255,0.9)';
    context.lineWidth = 1;
    const mid = LOUPE_SIZE / 2;
    context.beginPath();
    context.moveTo(mid, mid - 12);
    context.lineTo(mid, mid + 12);
    context.moveTo(mid - 12, mid);
    context.lineTo(mid + 12, mid);
    context.stroke();

    context.strokeStyle = 'rgba(255,90,120,0.95)';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(mid, mid, 6, 0, Math.PI * 2);
    context.stroke();
  }, [source, focus.x, focus.y, displayScale]);

  return (
    <canvas
      ref={canvasRef}
      className="loupe"
      style={{ left, top, width: LOUPE_SIZE, height: LOUPE_SIZE }}
      aria-hidden="true"
    />
  );
}
