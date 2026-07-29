import type { ExportResult } from './exporters';

/**
 * Whether the browser can hand a file to the OS share sheet. On iOS this is
 * the route into GoodNotes and Files; everywhere else the download fallback
 * takes over.
 */
export function canShareFiles(): boolean {
  if (typeof navigator === 'undefined' || !navigator.canShare || !navigator.share) return false;
  try {
    const probe = new File(['probe'], 'probe.txt', { type: 'text/plain' });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

export function downloadResult(result: ExportResult): void {
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = result.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give Safari a moment to start the download before the URL disappears.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

/**
 * Offers the file to the share sheet, falling back to a plain download.
 *
 * `navigator.share` must be called synchronously from the user's tap on iOS, so
 * callers should not await anything between the tap and this function.
 */
export async function shareResult(result: ExportResult): Promise<ShareOutcome> {
  if (canShareFiles()) {
    const file = new File([result.blob], result.filename, { type: result.blob.type });
    try {
      await navigator.share({ files: [file], title: result.filename });
      return 'shared';
    } catch (error) {
      // AbortError means the user dismissed the sheet; anything else is a real
      // failure and should still get the file to them.
      if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
    }
  }

  downloadResult(result);
  return 'downloaded';
}
