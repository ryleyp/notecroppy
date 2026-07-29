import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CropEditor } from './components/CropEditor';
import { RasterView } from './components/RasterView';
import { LibraryScreen } from './components/LibraryScreen';
import { ExportPanel } from './components/ExportPanel';
import {
  applyMask,
  buildBackgroundMask,
  featherMask,
  keptFraction,
  paintMask,
  resampleMask,
  type BrushMode,
} from './lib/cutout';
import { FILTER_LABELS, type FilterMode } from './lib/filters';
import { insetQuad, type Quad } from './lib/geometry';
import { detectDocumentQuad } from './lib/detectEdges';
import { loadImageFile, type LoadedImage } from './lib/imageLoad';
import { runPipeline, runPipelineAtFullResolution, type EditSettings } from './lib/pipeline';
import type { Raster } from './lib/raster';

type Step = 'capture' | 'crop' | 'refine' | 'export' | 'library';

const FILTER_ORDER: FilterMode[] = ['original', 'enhance', 'grayscale', 'bw'];

export default function App() {
  const [step, setStep] = useState<Step>('capture');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [loaded, setLoaded] = useState<LoadedImage | null>(null);
  const [quad, setQuad] = useState<Quad | null>(null);
  const [detectionNote, setDetectionNote] = useState<string | null>(null);

  const [rotation, setRotation] = useState(0);
  const [filter, setFilter] = useState<FilterMode>('original');

  const [warped, setWarped] = useState<Raster | null>(null);
  const [cutoutOn, setCutoutOn] = useState(false);
  const [tolerance, setTolerance] = useState(40);
  const [feather, setFeather] = useState(1);
  const [mask, setMask] = useState<Uint8Array | null>(null);
  const [brush, setBrush] = useState<BrushMode>('erase');
  const [brushSize, setBrushSize] = useState(24);
  const painting = useRef(false);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  const settings: EditSettings | null = useMemo(
    () => (quad ? { quad, rotation, filter } : null),
    [quad, rotation, filter],
  );

  const reset = () => {
    setLoaded(null);
    setQuad(null);
    setWarped(null);
    setMask(null);
    setRotation(0);
    setFilter('original');
    setCutoutOn(false);
    setTolerance(40);
    setFeather(1);
    setDetectionNote(null);
    setError(null);
    setStep('capture');
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy('Reading your photo…');
    try {
      const image = await loadImageFile(file);
      const detection = detectDocumentQuad(image.preview);
      setLoaded(image);
      setQuad(detection.quad);
      setDetectionNote(
        detection.detected
          ? 'Found the edges — nudge any corner that looks off.'
          : 'Could not find the edges confidently. Drag the corners onto the paper.',
      );
      setRotation(0);
      setFilter('original');
      setStep('crop');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open that photo');
    } finally {
      setBusy(null);
      // Allow re-picking the same file.
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (libraryInputRef.current) libraryInputRef.current.value = '';
    }
  };

  // Flatten once, on leaving the crop step; the warp is too slow to run on
  // every corner drag.
  const goToRefine = () => {
    if (!loaded || !settings) return;
    setBusy('Flattening…');
    // Yield so the overlay paints before the synchronous warp blocks the thread.
    // setTimeout rather than requestAnimationFrame: rAF is suspended while the
    // tab is in the background, which would leave this stuck on "Flattening…"
    // if the phone locked or the user switched apps at the wrong moment.
    setTimeout(() => {
      try {
        setWarped(runPipeline(loaded.preview, settings));
        setMask(null);
        setCutoutOn(false);
        setStep('refine');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not flatten that crop');
      } finally {
        setBusy(null);
      }
    }, 16);
  };

  // Re-run the cheap part of the pipeline when rotation or filter changes.
  useEffect(() => {
    if (step !== 'refine' && step !== 'export') return;
    if (!loaded || !quad) return;
    setWarped(runPipeline(loaded.preview, { quad, rotation, filter }));
    setMask(null);
    // Deliberately excludes `step` so switching to export does not recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotation, filter, loaded, quad]);

  // Rebuild the mask whenever the source or tolerance changes. This discards
  // brush work, which is why the UI warns before the slider moves.
  useEffect(() => {
    if (!cutoutOn || !warped) {
      setMask(null);
      return;
    }
    setMask(buildBackgroundMask(warped, { tolerance }));
  }, [cutoutOn, warped, tolerance]);

  /**
   * When the crop hugs the paper there is no surrounding surface for the flood
   * fill to start from, so it begins on the paper and erases the lot. Detecting
   * that is far kinder than handing back a blank canvas.
   */
  const cutoutAteEverything = useMemo(
    () => Boolean(cutoutOn && mask && keptFraction(mask) < 0.12),
    [cutoutOn, mask],
  );

  const displayed = useMemo(() => {
    if (!warped) return null;
    if (!cutoutOn || !mask) return warped;
    return applyMask(warped, featherMask(mask, warped.width, warped.height, feather));
  }, [warped, cutoutOn, mask, feather]);

  const paint = useCallback(
    (x: number, y: number) => {
      if (!painting.current || !mask || !warped) return;
      const next = new Uint8Array(mask);
      paintMask(next, warped.width, warped.height, x, y, brushSize, brush);
      setMask(next);
    },
    [mask, warped, brush, brushSize],
  );

  /** Rebuilds everything at full resolution for export. */
  const buildFinal = useCallback((): Raster => {
    if (!loaded || !settings) throw new Error('Nothing to export');
    const full = runPipelineAtFullResolution(loaded.full, settings, loaded.scale);
    if (!cutoutOn || !mask || !warped) return full;

    const upscaled = resampleMask(mask, warped.width, warped.height, full.width, full.height);
    const scaleRatio = full.width / Math.max(1, warped.width);
    const softened = featherMask(
      upscaled,
      full.width,
      full.height,
      Math.max(1, Math.round(feather * scaleRatio)),
    );
    return applyMask(full, softened);
  }, [loaded, settings, cutoutOn, mask, warped, feather]);

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={reset} type="button">
          <span className="brand-mark" aria-hidden="true" />
          notecroppy
        </button>
        {step !== 'library' ? (
          <button className="ghost" type="button" onClick={() => setStep('library')}>
            Library
          </button>
        ) : (
          <button className="ghost" type="button" onClick={() => setStep('capture')}>
            Close
          </button>
        )}
      </header>

      {error && (
        <div className="banner banner--error" role="alert">
          {error}
        </div>
      )}

      <main className="main">
        {step === 'capture' && (
          <section className="capture">
            <div className="capture-art" aria-hidden="true">
              <div className="capture-paper capture-paper--back" />
              <div className="capture-paper capture-paper--mid" />
              <div className="capture-paper capture-paper--front" />
            </div>
            <h1>Turn paper into digital stationery</h1>
            <p className="lede">
              Photograph a notepad or sticky note, straighten it, and send it to GoodNotes as
              notebook paper or a sticker. Everything happens on your device — no photo ever
              leaves it.
            </p>
            <div className="capture-actions">
              <button
                className="primary large"
                type="button"
                onClick={() => cameraInputRef.current?.click()}
              >
                Take a photo
              </button>
              <button
                className="ghost wide"
                type="button"
                onClick={() => libraryInputRef.current?.click()}
              >
                Choose from Photos
              </button>
            </div>
            {/* Two inputs, not one: the `capture` attribute is what steers iOS
                straight into the camera, skipping the Photo Library option in
                the picker sheet — it has to be absent for a library pick. */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(event) => void handleFile(event.target.files?.[0])}
            />
            <input
              ref={libraryInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => void handleFile(event.target.files?.[0])}
            />
          </section>
        )}

        {step === 'crop' && loaded && quad && (
          <section className="stage">
            <p className="hint">{detectionNote}</p>
            <CropEditor image={loaded.preview} quad={quad} onChange={setQuad} />
            <div className="toolbar">
              <button className="ghost" type="button" onClick={reset}>
                Retake
              </button>
              <button
                className="ghost"
                type="button"
                onClick={() =>
                  setQuad(insetQuad(loaded.preview.width, loaded.preview.height, 0.02))
                }
              >
                Reset corners
              </button>
              <button className="primary" type="button" onClick={goToRefine}>
                Flatten
              </button>
            </div>
          </section>
        )}

        {step === 'refine' && displayed && warped && (
          <section className="stage">
            <div className="preview-frame">
              <RasterView
                raster={displayed}
                className="preview-canvas"
                checkered={cutoutOn}
                onPointerDown={
                  cutoutOn && mask
                    ? (x, y) => {
                        painting.current = true;
                        paint(x, y);
                      }
                    : undefined
                }
                onPointerMove={cutoutOn && mask ? (x, y) => paint(x, y) : undefined}
                onPointerUp={() => {
                  painting.current = false;
                }}
              />
            </div>

            <div className="controls">
              <div className="control-row">
                <span className="control-label">Look</span>
                <div className="segmented">
                  {FILTER_ORDER.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={filter === mode ? 'seg seg--on' : 'seg'}
                      onClick={() => setFilter(mode)}
                    >
                      {FILTER_LABELS[mode]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="control-row">
                <span className="control-label">Rotate</span>
                <div className="segmented">
                  <button type="button" className="seg" onClick={() => setRotation((r) => r - 1)}>
                    ↺ Left
                  </button>
                  <button type="button" className="seg" onClick={() => setRotation((r) => r + 1)}>
                    ↻ Right
                  </button>
                </div>
              </div>

              <div className="control-row">
                <span className="control-label">Cut out background</span>
                <button
                  type="button"
                  className={cutoutOn ? 'toggle toggle--on' : 'toggle'}
                  onClick={() => setCutoutOn((on) => !on)}
                  aria-pressed={cutoutOn}
                >
                  <span className="toggle-knob" />
                </button>
              </div>

              {cutoutOn && (
                <div className="cutout-controls">
                  <label className="slider">
                    <span>
                      Tolerance <em>{tolerance}</em>
                    </span>
                    <input
                      type="range"
                      min={2}
                      max={120}
                      value={tolerance}
                      onChange={(event) => setTolerance(Number(event.target.value))}
                    />
                  </label>
                  <label className="slider">
                    <span>
                      Edge softness <em>{feather}</em>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={6}
                      value={feather}
                      onChange={(event) => setFeather(Number(event.target.value))}
                    />
                  </label>
                  <div className="control-row">
                    <span className="control-label">Brush</span>
                    <div className="segmented">
                      <button
                        type="button"
                        className={brush === 'erase' ? 'seg seg--on' : 'seg'}
                        onClick={() => setBrush('erase')}
                      >
                        Erase
                      </button>
                      <button
                        type="button"
                        className={brush === 'restore' ? 'seg seg--on' : 'seg'}
                        onClick={() => setBrush('restore')}
                      >
                        Restore
                      </button>
                    </div>
                  </div>
                  <label className="slider">
                    <span>
                      Brush size <em>{brushSize}</em>
                    </span>
                    <input
                      type="range"
                      min={6}
                      max={80}
                      value={brushSize}
                      onChange={(event) => setBrushSize(Number(event.target.value))}
                    />
                  </label>
                  {cutoutAteEverything ? (
                    <p className="hint hint--warn">
                      That removed nearly everything. Cutting out needs some background around
                      the paper to work from — go Back and pull the corners out past the edges of
                      the stationery, so the desk around it is included in the crop.
                    </p>
                  ) : (
                    <p className="hint hint--tight">
                      Draw on the image to tidy the edges. Moving Tolerance starts the cut-out
                      over.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="toolbar">
              <button className="ghost" type="button" onClick={() => setStep('crop')}>
                Back
              </button>
              <button className="primary" type="button" onClick={() => setStep('export')}>
                Export
              </button>
            </div>
          </section>
        )}

        {step === 'export' && displayed && (
          <ExportPanel
            preview={displayed}
            hasCutout={cutoutOn}
            buildFinal={buildFinal}
            onBack={() => setStep('refine')}
            onDone={reset}
            onError={setError}
          />
        )}

        {step === 'library' && <LibraryScreen onError={setError} />}
      </main>

      {busy && (
        <div className="busy" role="status">
          <div className="spinner" aria-hidden="true" />
          <span>{busy}</span>
        </div>
      )}
    </div>
  );
}
