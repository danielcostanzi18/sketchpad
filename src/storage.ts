// Saves drawings and backups in IndexedDB, the database built into the browser.
// Small "info" records (name, dates, counts) are kept apart from the heavy
// shape data so that listing drawings and backups stays fast.

import { backupsToDelete } from './backupPolicy.ts';
import type { Camera, Shape } from './model.ts';

export interface DrawingInfo {
  id: string;
  name: string;
  created: number;
  updated: number;
  count: number;
  camera: Camera;
}

export interface BackupInfo {
  key: number;
  drawingId: string;
  time: number;
  name: string;
  count: number;
  camera: Camera;
}

const DB_NAME = 'sketchpad';
const DB_VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

export class Storage {
  private constructor(private db: IDBDatabase) {}

  static async open(): Promise<Storage> {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      db.createObjectStore('drawings', { keyPath: 'id' });
      db.createObjectStore('drawingShapes');
      const b = db.createObjectStore('backups', { keyPath: 'key', autoIncrement: true });
      b.createIndex('drawingId', 'drawingId');
      db.createObjectStore('backupShapes');
    };
    return new Storage(await req(open));
  }

  async listDrawings(): Promise<DrawingInfo[]> {
    const tx = this.db.transaction('drawings');
    const all = await req(tx.objectStore('drawings').getAll() as IDBRequest<DrawingInfo[]>);
    return all.sort((a, b) => b.updated - a.updated);
  }

  async loadDrawing(id: string): Promise<{ info: DrawingInfo; shapes: Shape[] } | null> {
    const tx = this.db.transaction(['drawings', 'drawingShapes']);
    const [info, shapes] = await Promise.all([
      req(tx.objectStore('drawings').get(id) as IDBRequest<DrawingInfo | undefined>),
      req(tx.objectStore('drawingShapes').get(id) as IDBRequest<Shape[] | undefined>),
    ]);
    if (!info) return null;
    return { info, shapes: shapes ?? [] };
  }

  async saveDrawing(info: DrawingInfo, shapes?: readonly Shape[]): Promise<void> {
    const tx = this.db.transaction(['drawings', 'drawingShapes'], 'readwrite');
    tx.objectStore('drawings').put(info);
    if (shapes) tx.objectStore('drawingShapes').put(shapes, info.id);
    await done(tx);
  }

  async deleteDrawing(id: string): Promise<void> {
    const backups = await this.listBackups(id);
    const tx = this.db.transaction(['drawings', 'drawingShapes', 'backups', 'backupShapes'], 'readwrite');
    tx.objectStore('drawings').delete(id);
    tx.objectStore('drawingShapes').delete(id);
    for (const b of backups) {
      tx.objectStore('backups').delete(b.key);
      tx.objectStore('backupShapes').delete(b.key);
    }
    await done(tx);
  }

  async addBackup(b: Omit<BackupInfo, 'key'>, shapes: readonly Shape[]): Promise<void> {
    const tx = this.db.transaction(['backups', 'backupShapes'], 'readwrite');
    const add = tx.objectStore('backups').add(b);
    add.onsuccess = () => tx.objectStore('backupShapes').put(shapes, add.result);
    await done(tx);
    await this.pruneBackups(b.drawingId);
  }

  async listBackups(drawingId: string): Promise<BackupInfo[]> {
    const tx = this.db.transaction('backups');
    const index = tx.objectStore('backups').index('drawingId');
    const all = await req(index.getAll(drawingId) as IDBRequest<BackupInfo[]>);
    return all.sort((a, b) => b.time - a.time);
  }

  async loadBackupShapes(key: number): Promise<Shape[]> {
    const tx = this.db.transaction('backupShapes');
    return ((await req(tx.objectStore('backupShapes').get(key))) as Shape[] | undefined) ?? [];
  }

  private async pruneBackups(drawingId: string): Promise<void> {
    const list = await this.listBackups(drawingId);
    const del = backupsToDelete(list, Date.now());
    if (!del.length) return;
    const tx = this.db.transaction(['backups', 'backupShapes'], 'readwrite');
    for (const key of del) {
      tx.objectStore('backups').delete(key);
      tx.objectStore('backupShapes').delete(key);
    }
    await done(tx);
  }
}

/** Ask the browser not to clear our data when space runs low. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
