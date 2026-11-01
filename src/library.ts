// Keeps the open drawing saved: autosaves shortly after every change and
// stores a backup copy every 2 minutes while you're drawing.

import { BACKUP_INTERVAL_MS } from './backupPolicy.ts';
import type { View } from './camera.ts';
import type { History } from './history.ts';
import { isValidShape, newId, type DrawingFile, type Shape } from './model.ts';
import type { Scene } from './scene.ts';
import { saveSettings, type Settings } from './settings.ts';
import type { BackupInfo, DrawingInfo, Storage } from './storage.ts';

const AUTOSAVE_DELAY_MS = 800;
const CAMERA_SAVE_DELAY_MS = 2000;

export interface LibraryStatus {
  lastSaved: number | null;
  lastBackup: number | null;
  error: string | null;
}

export class Library {
  current!: DrawingInfo;
  status: LibraryStatus = { lastSaved: null, lastBackup: null, error: null };
  private savedRevision = -1;
  private backedUpRevision = -1;
  private saveTimer = 0;
  private cameraTimer = 0;
  private cameraDirty = false;
  private loading = false;
  private listeners: (() => void)[] = [];

  constructor(
    private storage: Storage,
    private scene: Scene,
    private view: View,
    private history: History,
    private settings: Settings,
  ) {
    scene.onChange(() => {
      if (this.loading) return;
      clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => void this.saveNow(), AUTOSAVE_DELAY_MS);
    });
    view.onChange(() => {
      if (this.loading) return;
      this.cameraDirty = true;
      clearTimeout(this.cameraTimer);
      this.cameraTimer = window.setTimeout(() => void this.saveNow(), CAMERA_SAVE_DELAY_MS);
    });
    window.setInterval(() => void this.backupNow(), BACKUP_INTERVAL_MS);
    // iPadOS may close a backgrounded web app at any time: save right away.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.saveNow();
    });
    window.addEventListener('pagehide', () => void this.saveNow());
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  async init(): Promise<void> {
    const id = this.settings.lastDrawingId;
    if (id && (await this.storage.loadDrawing(id))) {
      await this.open(id);
      return;
    }
    const list = await this.storage.listDrawings();
    if (list.length) await this.open(list[0].id);
    else await this.create();
  }

  async saveNow(): Promise<void> {
    clearTimeout(this.saveTimer);
    clearTimeout(this.cameraTimer);
    if (!this.current) return;
    const shapesChanged = this.scene.revision !== this.savedRevision;
    if (!shapesChanged && !this.cameraDirty) return;
    const revision = this.scene.revision;
    const info: DrawingInfo = {
      ...this.current,
      camera: this.view.get(),
      count: this.scene.size,
      updated: shapesChanged ? Date.now() : this.current.updated,
    };
    try {
      await this.storage.saveDrawing(info, shapesChanged ? this.scene.all() : undefined);
      this.current = info;
      this.savedRevision = revision;
      this.cameraDirty = false;
      this.status.lastSaved = Date.now();
      this.status.error = null;
    } catch (err) {
      this.status.error = 'Saving failed: ' + String(err);
    }
    this.changed();
  }

  /** Store a backup copy, if anything changed since the last one. */
  async backupNow(force = false): Promise<void> {
    if (!this.current || this.scene.size === 0) return;
    if (!force && this.scene.revision === this.backedUpRevision) return;
    const revision = this.scene.revision;
    try {
      await this.storage.addBackup(
        {
          drawingId: this.current.id,
          time: Date.now(),
          name: this.current.name,
          count: this.scene.size,
          camera: this.view.get(),
        },
        this.scene.all(),
      );
      this.backedUpRevision = revision;
      this.status.lastBackup = Date.now();
      this.status.error = null;
    } catch (err) {
      this.status.error = 'Backup failed: ' + String(err);
    }
    this.changed();
  }

  async open(id: string): Promise<void> {
    await this.saveNow();
    const data = await this.storage.loadDrawing(id);
    if (!data) return;
    this.loading = true;
    this.current = data.info;
    this.scene.load(data.shapes);
    this.history.clear();
    this.view.set(data.info.camera);
    this.loading = false;
    this.savedRevision = this.scene.revision;
    this.backedUpRevision = this.scene.revision;
    this.cameraDirty = false;
    this.status.lastBackup = (await this.storage.listBackups(id))[0]?.time ?? null;
    this.settings.lastDrawingId = id;
    saveSettings(this.settings);
    this.changed();
  }

  async create(name?: string, shapes: Shape[] = [], camera = { x: 0, y: 0, zoom: 1 }): Promise<void> {
    const list = await this.storage.listDrawings();
    const now = Date.now();
    const info: DrawingInfo = {
      id: newId(),
      name: name || `Sketch ${list.length + 1}`,
      created: now,
      updated: now,
      count: shapes.length,
      camera,
    };
    await this.storage.saveDrawing(info, shapes);
    await this.open(info.id);
    if (!shapes.length) {
      // Put the world origin in the middle of the screen for a fresh drawing.
      this.view.set({ x: -this.view.width / 2, y: -this.view.height / 2, zoom: 1 });
    }
  }

  async rename(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (id === this.current.id) {
      this.current = { ...this.current, name: trimmed };
      await this.storage.saveDrawing(this.current);
    } else {
      const d = await this.storage.loadDrawing(id);
      if (d) await this.storage.saveDrawing({ ...d.info, name: trimmed });
    }
    this.changed();
  }

  async remove(id: string): Promise<void> {
    await this.storage.deleteDrawing(id);
    if (id === this.current.id) {
      this.savedRevision = this.scene.revision; // nothing left to save
      this.cameraDirty = false;
      const list = await this.storage.listDrawings();
      if (list.length) await this.open(list[0].id);
      else await this.create();
    }
    this.changed();
  }

  listDrawings(): Promise<DrawingInfo[]> {
    return this.storage.listDrawings();
  }

  listBackups(): Promise<BackupInfo[]> {
    return this.storage.listBackups(this.current.id);
  }

  /** Bring back a backup. This is undoable, and the current state is backed up first. */
  async restoreBackup(key: number): Promise<void> {
    await this.backupNow();
    const shapes = await this.storage.loadBackupShapes(key);
    this.history.commit({ added: shapes, removed: [...this.scene.all()] });
  }

  toFile(): DrawingFile {
    return {
      app: 'sketchpad',
      version: 1,
      name: this.current.name,
      camera: this.view.get(),
      shapes: [...this.scene.all()],
    };
  }

  /** Import a drawing file as a new drawing. Throws if the file isn't valid. */
  async importFile(text: string, fallbackName: string): Promise<void> {
    const data = JSON.parse(text) as Partial<DrawingFile>;
    if (data.app !== 'sketchpad' || !Array.isArray(data.shapes)) {
      throw new Error('This is not a Sketchpad drawing file.');
    }
    const shapes = data.shapes.filter(isValidShape);
    const cam = data.camera;
    const camera =
      cam && [cam.x, cam.y, cam.zoom].every((n) => typeof n === 'number' && Number.isFinite(n)) && cam.zoom > 0
        ? cam
        : { x: 0, y: 0, zoom: 1 };
    await this.create(data.name || fallbackName, shapes, camera);
  }
}
