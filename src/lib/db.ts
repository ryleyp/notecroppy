import type { ExportFormat } from './exporters';

const DB_NAME = 'notecroppy';
const DB_VERSION = 1;
const STORE = 'items';

export interface LibraryItem {
  id: string;
  name: string;
  createdAt: number;
  format: ExportFormat;
  width: number;
  height: number;
  /** The finished export, kept so it can be re-shared without redoing the work. */
  blob: Blob;
  /** Small PNG for the library grid. */
  thumbnail: Blob;
}

let connection: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (connection) return connection;

  connection = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser has no IndexedDB, so the library is unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the library'));
  });

  return connection;
}

function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = run(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Library request failed'));
      }),
  );
}

export async function putItem(item: LibraryItem): Promise<void> {
  await transact('readwrite', (store) => store.put(item));
}

export async function listItems(): Promise<LibraryItem[]> {
  const items = await transact<LibraryItem[]>('readonly', (store) => store.getAll());
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteItem(id: string): Promise<void> {
  await transact('readwrite', (store) => store.delete(id));
}

export async function clearItems(): Promise<void> {
  await transact('readwrite', (store) => store.clear());
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
