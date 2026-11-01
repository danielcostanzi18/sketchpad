// The drawing data. Everything on the canvas is a "shape" stored in world
// coordinates (independent of the current zoom), so it stays sharp at any scale.

export interface StrokeShape {
  id: string;
  kind: 'stroke';
  /** Stacking order: higher values are drawn on top. */
  z: number;
  color: string;
  /** Stroke diameter in world units at medium pencil pressure. */
  width: number;
  opacity: number;
  /** Flat list of [x, y, pressure, x, y, pressure, ...] in world units. */
  points: number[];
}

// Stage 2 and 3 will add 'line' | 'circle' | 'arc' | 'image' here.
export type Shape = StrokeShape;

export interface Camera {
  /** World coordinate shown at the top-left corner of the screen. */
  x: number;
  y: number;
  /** Screen pixels per world unit. */
  zoom: number;
}

export interface Drawing {
  id: string;
  name: string;
  created: number;
  updated: number;
  camera: Camera;
  shapes: Shape[];
}

export interface Backup {
  /** Auto-incremented by IndexedDB. */
  key?: number;
  drawingId: string;
  time: number;
  name: string;
  camera: Camera;
  shapes: Shape[];
}

/** File format used for "Export drawing" / "Import drawing". */
export interface DrawingFile {
  app: 'sketchpad';
  version: 1;
  name: string;
  camera: Camera;
  shapes: Shape[];
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function isValidShape(s: unknown): s is Shape {
  if (!s || typeof s !== 'object') return false;
  const o = s as Record<string, unknown>;
  return (
    o.kind === 'stroke' &&
    typeof o.id === 'string' &&
    typeof o.z === 'number' &&
    typeof o.color === 'string' &&
    typeof o.width === 'number' &&
    typeof o.opacity === 'number' &&
    Array.isArray(o.points) &&
    o.points.length >= 3 &&
    o.points.length % 3 === 0 &&
    o.points.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}
