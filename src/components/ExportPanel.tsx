import { useState } from 'react';
import { RasterView } from './RasterView';
import { exportJpg, exportPdf, exportPng, type ExportResult } from '../lib/exporters';
import { newId, putItem } from '../lib/db';
import { PAGE_SIZES, findPageSize } from '../lib/pageSizes';
import { canShareFiles, downloadResult, shareResult } from '../lib/share';
import { rasterToCanvas } from '../lib/imageLoad';
import type { Raster } from '../lib/raster';

type Choice = 'pdf' | 'png' | 'jpg';

interface ExportPanelProps {
  preview: Raster;
  hasCutout: boolean;
  buildFinal: () => Raster;
  onBack: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}

const THUMB_MAX = 240;

async function makeThumbnail(raster: Raster, flattenOntoWhite: boolean): Promise<Blob> {
  const scale = Math.min(1, THUMB_MAX / Math.max(raster.width, raster.height));
  const width = Math.max(1, Math.round(raster.width * scale));
  const height = Math.max(1, Math.round(raster.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not get a 2D canvas context');
  // A JPG thumbnail must not advertise transparency the file cannot hold.
  if (flattenOntoWhite) {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(rasterToCanvas(raster), 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not build a thumbnail'))),
      'image/png',
    );
  });
}

export function ExportPanel({
  preview,
  hasCutout,
  buildFinal,
  onBack,
  onDone,
  onError,
}: ExportPanelProps) {
  const [choice, setChoice] = useState<Choice>(hasCutout ? 'png' : 'pdf');
  const [pageSizeId, setPageSizeId] = useState(PAGE_SIZES[0].id);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const shareable = canShareFiles();

  const produce = async (): Promise<ExportResult> => {
    const final = buildFinal();
    if (choice === 'pdf') {
      return exportPdf(
        final,
        { pageSize: findPageSize(pageSizeId), whiteBackground: !hasCutout },
        'notecroppy',
      );
    }
    if (choice === 'jpg') return exportJpg(final, 'notecroppy');
    return exportPng(final, hasCutout ? 'notecroppy-sticker' : 'notecroppy');
  };

  const saveToLibrary = async (result: ExportResult) => {
    try {
      await putItem({
        id: newId(),
        name: result.filename,
        createdAt: Date.now(),
        format: result.format,
        width: result.width,
        height: result.height,
        blob: result.blob,
        thumbnail: await makeThumbnail(preview, result.format === 'jpg'),
      });
    } catch {
      // A full or unavailable IndexedDB should not lose the user their export.
      setStatus('Saved to your device, but could not add it to the library.');
    }
  };

  const run = async (mode: 'share' | 'download') => {
    setWorking(true);
    setStatus(null);
    try {
      const result = await produce();
      await saveToLibrary(result);

      if (mode === 'share') {
        const outcome = await shareResult(result);
        if (outcome === 'shared') setStatus('Sent to the share sheet.');
        else if (outcome === 'cancelled') setStatus('Share cancelled — it is in your library.');
        else setStatus(`Saved ${result.filename}.`);
      } else {
        downloadResult(result);
        setStatus(`Saved ${result.filename}.`);
      }
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Export failed');
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="stage">
      <div className="preview-frame preview-frame--small">
        <RasterView raster={preview} className="preview-canvas" checkered={hasCutout} />
      </div>

      <div className="controls">
        <div className="control-row">
          <span className="control-label">Format</span>
          <div className="segmented">
            <button
              type="button"
              className={choice === 'pdf' ? 'seg seg--on' : 'seg'}
              onClick={() => setChoice('pdf')}
            >
              PDF
            </button>
            <button
              type="button"
              className={choice === 'png' ? 'seg seg--on' : 'seg'}
              onClick={() => setChoice('png')}
            >
              PNG
            </button>
            <button
              type="button"
              className={choice === 'jpg' ? 'seg seg--on' : 'seg'}
              onClick={() => setChoice('jpg')}
            >
              JPG
            </button>
          </div>
        </div>

        <p className="hint hint--tight">
          {choice === 'pdf' && 'Import into GoodNotes as notebook paper.'}
          {choice === 'png' &&
            (hasCutout
              ? 'Transparent sticker — drop it onto any page.'
              : 'Lossless image with a solid background.')}
          {choice === 'jpg' && 'Smallest file. Transparency is flattened onto white.'}
        </p>

        {choice === 'pdf' && (
          <div className="page-sizes">
            {PAGE_SIZES.map((size) => (
              <button
                key={size.id}
                type="button"
                className={pageSizeId === size.id ? 'card card--on' : 'card'}
                onClick={() => setPageSizeId(size.id)}
              >
                <strong>{size.label}</strong>
                <span>{size.hint}</span>
              </button>
            ))}
          </div>
        )}

        {choice === 'jpg' && hasCutout && (
          <p className="hint hint--warn">
            JPG cannot store transparency, so the cut-out background comes back as white. Choose
            PNG for a sticker.
          </p>
        )}
      </div>

      {status && <p className="hint hint--ok">{status}</p>}

      <div className="toolbar toolbar--stack">
        {shareable && (
          <button
            className="primary large"
            type="button"
            disabled={working}
            onClick={() => void run('share')}
          >
            {working ? 'Working…' : 'Share to GoodNotes'}
          </button>
        )}
        <button
          className={shareable ? 'ghost wide' : 'primary large'}
          type="button"
          disabled={working}
          onClick={() => void run('download')}
        >
          {working ? 'Working…' : 'Download'}
        </button>
        <div className="toolbar">
          <button className="ghost" type="button" onClick={onBack} disabled={working}>
            Back
          </button>
          <button className="ghost" type="button" onClick={onDone} disabled={working}>
            Start another
          </button>
        </div>
      </div>
    </section>
  );
}
