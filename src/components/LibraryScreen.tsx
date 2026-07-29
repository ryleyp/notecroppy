import { useCallback, useEffect, useState } from 'react';
import { clearItems, deleteItem, listItems, type LibraryItem } from '../lib/db';
import { downloadResult, shareResult } from '../lib/share';

interface LibraryScreenProps {
  onError: (message: string) => void;
}

function ThumbnailImage({
  blob,
  alt,
  transparent,
}: {
  blob: Blob;
  alt: string;
  transparent: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  const className = transparent ? 'thumb checkered' : 'thumb';
  return url ? <img src={url} alt={alt} className={className} /> : <div className="thumb" />;
}

export function LibraryScreen({ onError }: LibraryScreenProps) {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const refresh = useCallback(() => {
    listItems()
      .then(setItems)
      .catch((cause: unknown) => {
        setItems([]);
        onError(cause instanceof Error ? cause.message : 'Could not read the library');
      });
  }, [onError]);

  useEffect(() => refresh(), [refresh]);

  const asResult = (item: LibraryItem) => ({
    blob: item.blob,
    filename: item.name,
    format: item.format,
    width: item.width,
    height: item.height,
  });

  if (!items) return <p className="hint">Loading…</p>;

  if (items.length === 0) {
    return (
      <section className="stage">
        <p className="empty">
          Nothing saved yet. Anything you export lands here so you can send it again later.
        </p>
      </section>
    );
  }

  return (
    <section className="stage">
      <div className="library">
        {items.map((item) => (
          <article className="library-item" key={item.id}>
            <ThumbnailImage
              blob={item.thumbnail}
              alt={item.name}
              transparent={item.format !== 'jpg'}
            />
            <div className="library-meta">
              <strong>{item.format.toUpperCase()}</strong>
              <span>
                {item.width} × {item.height}
              </span>
              <span className="muted">{new Date(item.createdAt).toLocaleDateString()}</span>
            </div>
            <div className="library-actions">
              <button
                className="ghost small"
                type="button"
                onClick={() => void shareResult(asResult(item))}
              >
                Share
              </button>
              <button
                className="ghost small"
                type="button"
                onClick={() => downloadResult(asResult(item))}
              >
                Save
              </button>
              <button
                className="ghost small danger"
                type="button"
                onClick={() => void deleteItem(item.id).then(refresh)}
              >
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="toolbar">
        {confirmingClear ? (
          <>
            <button className="ghost" type="button" onClick={() => setConfirmingClear(false)}>
              Keep them
            </button>
            <button
              className="primary danger"
              type="button"
              onClick={() => {
                void clearItems().then(() => {
                  setConfirmingClear(false);
                  refresh();
                });
              }}
            >
              Delete all {items.length}
            </button>
          </>
        ) : (
          <button className="ghost danger" type="button" onClick={() => setConfirmingClear(true)}>
            Clear library
          </button>
        )}
      </div>
    </section>
  );
}
