/**
 * @fileType lib
 * @domain kody
 * @pattern indexeddb-blob-store
 * @ai-summary Browser-only IndexedDB store for chat attachment blobs.
 *
 * Chat messages live in localStorage (text only). Attachment binaries are
 * too big for localStorage (5 MB origin cap), so they live here keyed by
 * an opaque id. ChatMessage carries an `attachments: AttachmentRef[]`
 * with just the id + metadata; the blob is loaded lazily for previews
 * and for re-sending in a multimodal request.
 */

const DB_NAME = "kody-attachments";
const DB_VERSION = 1;
const STORE = "attachments";

export interface AttachmentRef {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface AttachmentRecord extends AttachmentRef {
  blob: Blob;
  createdAt: string;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function generateId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isBrowser()) {
      reject(new Error("IndexedDB unavailable (server-side)"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB open failed"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result: T;
    let resolved = false;
    Promise.resolve(fn(store))
      .then((r) => {
        if (r && typeof r === "object" && "onsuccess" in r) {
          const req = r as IDBRequest<T>;
          req.onsuccess = () => {
            result = req.result;
            resolved = true;
          };
          req.onerror = () => reject(req.error ?? new Error("IDB op failed"));
        } else {
          result = r as T;
          resolved = true;
        }
      })
      .catch(reject);
    tx.oncomplete = () => {
      if (resolved) resolve(result);
      else reject(new Error("IDB tx completed without result"));
      db.close();
    };
    tx.onerror = () => reject(tx.error ?? new Error("IDB tx failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IDB tx aborted"));
  });
}

export async function putAttachment(data: {
  name: string;
  mimeType: string;
  size: number;
  blob: Blob;
}): Promise<AttachmentRef> {
  const ref: AttachmentRef = {
    id: generateId(),
    name: data.name,
    mimeType: data.mimeType,
    size: data.size,
  };
  const record: AttachmentRecord = {
    ...ref,
    blob: data.blob,
    createdAt: new Date().toISOString(),
  };
  await withStore("readwrite", (store) => store.put(record));
  return ref;
}

export async function getAttachment(
  id: string,
): Promise<AttachmentRecord | null> {
  try {
    const rec = await withStore<AttachmentRecord | undefined>(
      "readonly",
      (store) => store.get(id),
    );
    return rec ?? null;
  } catch {
    return null;
  }
}

export async function getAttachmentDataUrl(id: string): Promise<string | null> {
  const rec = await getAttachment(id);
  if (!rec) return null;
  return blobToDataUrl(rec.blob);
}

export async function deleteAttachment(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
}

/**
 * Drop every attachment whose id is not in `keepIds`.
 *
 * Records younger than `minAgeMs` (default 5 min) are kept regardless,
 * because the typical caller runs this on mount and the session-store
 * hydration is async — blobs uploaded just before a reload would
 * otherwise be deleted before the message that references them lands
 * in the keep-set.
 */
export async function purgeOrphans(
  keepIds: Set<string>,
  options: { minAgeMs?: number } = {},
): Promise<void> {
  if (!isBrowser()) return;
  const minAgeMs = options.minAgeMs ?? 5 * 60 * 1000;
  const cutoff = Date.now() - minAgeMs;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      const rec = cursor.value as AttachmentRecord;
      if (!keepIds.has(rec.id)) {
        const createdMs = rec.createdAt ? Date.parse(rec.createdAt) : 0;
        if (!Number.isFinite(createdMs) || createdMs < cutoff) {
          cursor.delete();
        }
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error ?? new Error("IDB cursor failed"));
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error ?? new Error("IDB purge tx failed"));
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}
