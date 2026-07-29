import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  QUAD_KEYS,
  clampPoint,
  isConvex,
  quadToArray,
  type Point,
  type Quad,
  type QuadKey,
} from '../lib/geometry';
import { rasterToCanvas } from '../lib/imageLoad';
import type { Raster } from '../lib/raster';
import { LOUPE_SIZE, Loupe } from './Loupe';

interface CropEditorProps {
  image: Raster;
  quad: Quad;
  onChange: (quad: Quad) => void;
}

const HANDLE_HIT_RADIUS = 34;

/**
 * The four-corner crop surface.
 *
 * Corner positions live in source-image coordinates so they stay valid when the
 * element is resized or the device is rotated; only rendering converts to CSS
 * pixels.
 */
export function CropEditor({ image, quad, onChange }: CropEditorProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState<QuadKey | null>(null);

  const canvas = useMemo(() => rasterToCanvas(image), [image]);

  // Fit the image inside the available space, preserving its aspect ratio.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const measure = () => {
      const rect = wrapper.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const scale = Math.min(rect.width / image.width, rect.height / image.height);
      setBox({ width: image.width * scale, height: image.height * scale });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [image.width, image.height]);

  const scale = box.width > 0 ? box.width / image.width : 1;
  const toDisplay = useCallback((p: Point) => ({ x: p.x * scale, y: p.y * scale }), [scale]);

  const surfaceRef = useRef<HTMLDivElement>(null);

  const pointToImage = useCallback(
    (event: PointerEvent | React.PointerEvent): Point => {
      const surface = surfaceRef.current;
      if (!surface) return { x: 0, y: 0 };
      const rect = surface.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) / scale,
        y: (event.clientY - rect.top) / scale,
      };
    },
    [scale],
  );

  const handlePointerDown = (event: React.PointerEvent) => {
    const p = pointToImage(event);
    let nearest: QuadKey | null = null;
    let nearestDistance = Infinity;

    for (const key of QUAD_KEYS) {
      const corner = quad[key];
      const d = Math.hypot((corner.x - p.x) * scale, (corner.y - p.y) * scale);
      if (d < nearestDistance) {
        nearestDistance = d;
        nearest = key;
      }
    }

    if (nearest && nearestDistance <= HANDLE_HIT_RADIUS) {
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(nearest);
    }
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!dragging) return;
    event.preventDefault();

    const next = {
      ...quad,
      [dragging]: clampPoint(pointToImage(event), image.width, image.height),
    } as Quad;

    // Refuse a move that folds the quad into a bow-tie; the warp would mirror
    // part of the page onto itself.
    if (!isConvex(next)) return;
    onChange(next);
  };

  const endDrag = (event: React.PointerEvent) => {
    if (!dragging) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(null);
  };

  const displayCorners = quadToArray(quad).map(toDisplay);
  const polygon = displayCorners.map((p) => `${p.x},${p.y}`).join(' ');

  // Keep the loupe clear of the finger: it sits opposite the corner's own
  // quadrant, so dragging the top-left corner shows it toward the bottom-right.
  const activeCorner = dragging ? toDisplay(quad[dragging]) : null;
  const loupePosition = activeCorner
    ? {
        left: Math.min(
          Math.max(activeCorner.x < box.width / 2 ? activeCorner.x + 28 : activeCorner.x - LOUPE_SIZE - 28, 4),
          Math.max(4, box.width - LOUPE_SIZE - 4),
        ),
        top: Math.min(
          Math.max(activeCorner.y < box.height / 2 ? activeCorner.y + 28 : activeCorner.y - LOUPE_SIZE - 28, 4),
          Math.max(4, box.height - LOUPE_SIZE - 4),
        ),
      }
    : null;

  return (
    <div className="crop-wrapper" ref={wrapperRef}>
      <div
        className="crop-surface"
        ref={surfaceRef}
        style={{ width: box.width, height: box.height }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <img
          className="crop-image"
          src={canvas.toDataURL()}
          alt="Photo being cropped"
          draggable={false}
        />

        <svg className="crop-overlay" viewBox={`0 0 ${box.width} ${box.height}`}>
          <defs>
            <mask id="crop-mask">
              <rect x="0" y="0" width={box.width} height={box.height} fill="white" />
              <polygon points={polygon} fill="black" />
            </mask>
          </defs>
          <rect
            x="0"
            y="0"
            width={box.width}
            height={box.height}
            fill="rgba(18,14,22,0.55)"
            mask="url(#crop-mask)"
          />
          <polygon points={polygon} className="crop-polygon" />
          {displayCorners.map((corner, index) => (
            <g key={QUAD_KEYS[index]}>
              <circle
                cx={corner.x}
                cy={corner.y}
                r={13}
                className={
                  dragging === QUAD_KEYS[index] ? 'crop-handle crop-handle--active' : 'crop-handle'
                }
              />
              <circle cx={corner.x} cy={corner.y} r={3.5} className="crop-handle-dot" />
            </g>
          ))}
        </svg>

        {dragging && loupePosition && (
          <Loupe
            source={canvas}
            focus={quad[dragging]}
            displayScale={scale}
            left={loupePosition.left}
            top={loupePosition.top}
          />
        )}
      </div>
    </div>
  );
}
