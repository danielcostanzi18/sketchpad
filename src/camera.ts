import type { Camera } from './model.ts';
import { clamp, type Rect } from './geometry.ts';

export const MIN_ZOOM = 1e-3;
export const MAX_ZOOM = 1e4;

/** Pan & zoom state. screen = (world - camera.xy) * zoom */
export class View {
  x = 0;
  y = 0;
  zoom = 1;
  /** Screen size in CSS pixels. */
  width = 1;
  height = 1;
  private listeners: (() => void)[] = [];

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  get(): Camera {
    return { x: this.x, y: this.y, zoom: this.zoom };
  }

  set(c: Camera): void {
    this.x = c.x;
    this.y = c.y;
    this.zoom = clamp(c.zoom, MIN_ZOOM, MAX_ZOOM);
    this.changed();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.changed();
  }

  toWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: this.x + sx / this.zoom, y: this.y + sy / this.zoom };
  }

  toScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx - this.x) * this.zoom, y: (wy - this.y) * this.zoom };
  }

  /** The world rectangle currently visible on screen. */
  visibleRect(): Rect {
    return {
      minX: this.x,
      minY: this.y,
      maxX: this.x + this.width / this.zoom,
      maxY: this.y + this.height / this.zoom,
    };
  }

  panBy(dsx: number, dsy: number): void {
    this.x -= dsx / this.zoom;
    this.y -= dsy / this.zoom;
    this.changed();
  }

  /** Zoom by `factor`, keeping the world point under screen (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const w = this.toWorld(sx, sy);
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    this.x = w.x - sx / this.zoom;
    this.y = w.y - sy / this.zoom;
    this.changed();
  }

  /**
   * Two-finger gesture: the world point that was under `from` (screen) ends
   * up under `to`, with zoom multiplied by `factor`.
   */
  pinch(fromX: number, fromY: number, toX: number, toY: number, factor: number): void {
    const w = this.toWorld(fromX, fromY);
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    this.x = w.x - toX / this.zoom;
    this.y = w.y - toY / this.zoom;
    this.changed();
  }

  /** Center the given world rect on screen with some margin. */
  fit(r: Rect, margin = 40): void {
    const w = Math.max(r.maxX - r.minX, 1e-6);
    const h = Math.max(r.maxY - r.minY, 1e-6);
    const zoom = clamp(
      Math.min((this.width - 2 * margin) / w, (this.height - 2 * margin) / h),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    this.zoom = zoom;
    this.x = (r.minX + r.maxX) / 2 - this.width / 2 / zoom;
    this.y = (r.minY + r.maxY) / 2 - this.height / 2 / zoom;
    this.changed();
  }

  /** Set an absolute zoom level, keeping the screen center fixed. */
  setZoomCentered(zoom: number): void {
    this.zoomAt(this.width / 2, this.height / 2, zoom / this.zoom);
  }
}
