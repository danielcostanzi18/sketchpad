import type { Shape } from './model.ts';
import { intersects, shapeBounds, unionRect, type Rect } from './geometry.ts';

/** All shapes of the open drawing, kept sorted by z (bottom to top). */
export class Scene {
  private shapes: Shape[] = [];
  private byId = new Map<string, Shape>();
  private bounds = new WeakMap<Shape, Rect>();
  private listeners: (() => void)[] = [];
  /** Increments on every change; used to know when to autosave/backup. */
  revision = 0;

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private changed(): void {
    this.revision++;
    for (const fn of this.listeners) fn();
  }

  all(): readonly Shape[] {
    return this.shapes;
  }

  get(id: string): Shape | undefined {
    return this.byId.get(id);
  }

  get size(): number {
    return this.shapes.length;
  }

  boundsOf(s: Shape): Rect {
    let b = this.bounds.get(s);
    if (!b) {
      b = shapeBounds(s);
      this.bounds.set(s, b);
    }
    return b;
  }

  nextZ(): number {
    return this.shapes.length ? this.shapes[this.shapes.length - 1].z + 1 : 0;
  }

  /** Replace everything (opening a drawing, restoring a backup). */
  load(shapes: Shape[]): void {
    this.shapes = [...shapes].sort((a, b) => a.z - b.z);
    this.byId = new Map(this.shapes.map((s) => [s.id, s]));
    this.changed();
  }

  /** Add and remove shapes in one change. */
  apply(add: readonly Shape[], removeIds: readonly string[]): void {
    if (!add.length && !removeIds.length) return;
    if (removeIds.length) {
      const gone = new Set(removeIds);
      this.shapes = this.shapes.filter((s) => !gone.has(s.id));
      for (const id of removeIds) this.byId.delete(id);
    }
    for (const s of add) {
      if (this.byId.has(s.id)) continue;
      this.byId.set(s.id, s);
      this.insertSorted(s);
    }
    this.changed();
  }

  private insertSorted(s: Shape): void {
    const arr = this.shapes;
    if (!arr.length || arr[arr.length - 1].z <= s.z) {
      arr.push(s);
      return;
    }
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].z <= s.z) lo = mid + 1;
      else hi = mid;
    }
    arr.splice(lo, 0, s);
  }

  /** Shapes whose bounds overlap `r`, bottom to top. */
  query(r: Rect): Shape[] {
    return this.shapes.filter((s) => intersects(this.boundsOf(s), r));
  }

  /** Bounding box of the whole drawing, or null if empty. */
  extent(): Rect | null {
    let r: Rect | null = null;
    for (const s of this.shapes) r = unionRect(r, this.boundsOf(s));
    return r;
  }
}
