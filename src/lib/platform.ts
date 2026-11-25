import type { DocumentData } from '../types';

export interface DesktopBridge {
  isDesktop: true;
  platform: string;
  openFile: () => Promise<{ path: string; content: string } | null>;
  readFile: (path: string) => Promise<string | null>;
  saveFile: (path: string | null, content: string, suggestedName: string) => Promise<string | null>;
  exportFile: (suggestedName: string, data: ArrayBuffer, ext: string) => Promise<string | null>;
  onMenu: (cb: (action: string) => void) => () => void;
  onOpenPath: (cb: (path: string) => void) => () => void;
  setTitle: (title: string, dirty: boolean) => void;
  confirmClose: (cb: () => boolean) => void;
  serverUrl?: () => Promise<string | null>;
  openExternal?: (url: string) => Promise<boolean>;
}

declare global {
  interface Window {
    figmyDesktop?: DesktopBridge;
    showOpenFilePicker?: (o?: unknown) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (o?: unknown) => Promise<FileSystemFileHandle>;
  }
}

export const desktop = typeof window !== 'undefined' ? window.figmyDesktop : undefined;
export const isDesktop = !!desktop;

export function parseDocument(text: string): DocumentData {
  const d = JSON.parse(text);
  // 'vectura' is the format id used before the app was renamed to Figmy
  if ((d?.format !== 'figmy' && d?.format !== 'vectura') || !Array.isArray(d.pages) || typeof d.nodes !== 'object') throw new Error('Not a Figmy file');
  d.format = 'figmy';
  d.comments ??= [];
  d.colorStyles ??= [];
  d.textStyles ??= [];
  d.effectStyles ??= [];
  d.variables ??= [];
  d.versions ??= [];
  return d as DocumentData;
}

export const serialize = (d: DocumentData) => JSON.stringify(d);

let webHandle: FileSystemFileHandle | null = null;
export const resetWebHandle = () => (webHandle = null);

export async function openDocumentFile(): Promise<{ doc: DocumentData; path: string | null } | null> {
  if (desktop) {
    const r = await desktop.openFile();
    return r ? { doc: parseDocument(r.content), path: r.path } : null;
  }
  if (window.showOpenFilePicker) {
    try {
      const [h] = await window.showOpenFilePicker({ types: [{ description: 'Figmy design', accept: { 'application/json': ['.figmy', '.vectura', '.json'] } }] });
      const f = await h.getFile();
      webHandle = h;
      return { doc: parseDocument(await f.text()), path: null };
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
      throw e;
    }
  }
  const file = await pickFile('.figmy,.vectura,.json');
  return file ? { doc: parseDocument(await file.text()), path: null } : null;
}

export async function saveDocumentFile(doc: DocumentData, path: string | null, saveAs = false): Promise<string | null | true> {
  const content = serialize(doc);
  const name = `${doc.name || 'Untitled'}.figmy`;
  if (desktop) return desktop.saveFile(saveAs ? null : path, content, name);
  if (window.showSaveFilePicker) {
    try {
      if (!webHandle || saveAs) webHandle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Figmy design', accept: { 'application/json': ['.figmy'] } }] });
      const w = await (webHandle as FileSystemFileHandle & { createWritable: () => Promise<FileSystemWritableFileStream> }).createWritable();
      await w.write(content);
      await w.close();
      return true;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
      throw e;
    }
  }
  download(new Blob([content], { type: 'application/json' }), name);
  return true;
}

export async function saveBlob(blob: Blob, name: string) {
  if (desktop) {
    const ext = name.split('.').pop() ?? '';
    await desktop.exportFile(name, await blob.arrayBuffer(), ext);
    return;
  }
  download(blob, name);
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function pickFile(accept: string, multiple = false): Promise<File | null> {
  return pickFiles(accept, multiple).then((f) => f[0] ?? null);
}
export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((res) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = accept;
    i.multiple = multiple;
    i.onchange = () => res([...(i.files ?? [])]);
    i.click();
  });
}

/* ---------- local file library (IndexedDB) ---------- */

export interface LibraryEntry {
  id: string;
  name: string;
  updatedAt: number;
  thumbnail?: string;
  path?: string | null;
}

const DB = 'figmy';
let dbPromise: Promise<IDBDatabase> | null = null;
function idb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('files');
      r.result.createObjectStore('meta');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => {
      dbPromise = null;
      rej(r.error);
    };
  });
  return dbPromise;
}
async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export async function libraryList(): Promise<LibraryEntry[]> {
  try {
    const all = (await tx<LibraryEntry[]>('meta', 'readonly', (s) => s.getAll() as IDBRequest<LibraryEntry[]>)) ?? [];
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}
export async function librarySave(id: string, doc: DocumentData, thumbnail?: string, path?: string | null) {
  try {
    await tx('files', 'readwrite', (s) => s.put(serialize(doc), id));
    await tx('meta', 'readwrite', (s) => s.put({ id, name: doc.name, updatedAt: Date.now(), thumbnail, path } satisfies LibraryEntry, id));
  } catch {
    /* storage might be unavailable (private mode) */
  }
}
export async function libraryLoad(id: string): Promise<DocumentData | null> {
  try {
    const t = await tx<string>('files', 'readonly', (s) => s.get(id) as IDBRequest<string>);
    return t ? parseDocument(t) : null;
  } catch {
    return null;
  }
}
export async function libraryDelete(id: string) {
  try {
    await tx('files', 'readwrite', (s) => s.delete(id));
    await tx('meta', 'readwrite', (s) => s.delete(id));
  } catch {
    /* ignore */
  }
}
