import type { Shape } from './model.ts';
import type { Scene } from './scene.ts';

/** One undoable action: shapes that appeared and shapes that disappeared. */
export interface Change {
  added: Shape[];
  removed: Shape[];
}

const LIMIT = 500;

export class History {
  private undoStack: Change[] = [];
  private redoStack: Change[] = [];
  private listeners: (() => void)[] = [];

  constructor(private scene: Scene) {}

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  /** Record a change that has already been applied to the scene. */
  record(change: Change): void {
    if (!change.added.length && !change.removed.length) return;
    this.undoStack.push(change);
    if (this.undoStack.length > LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.changed();
  }

  /** Apply a change to the scene and record it. */
  commit(change: Change): void {
    this.scene.apply(change.added, change.removed.map((s) => s.id));
    this.record(change);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const c = this.undoStack.pop();
    if (!c) return;
    this.scene.apply(c.removed, c.added.map((s) => s.id));
    this.redoStack.push(c);
    this.changed();
  }

  redo(): void {
    const c = this.redoStack.pop();
    if (!c) return;
    this.scene.apply(c.added, c.removed.map((s) => s.id));
    this.undoStack.push(c);
    this.changed();
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.changed();
  }
}
