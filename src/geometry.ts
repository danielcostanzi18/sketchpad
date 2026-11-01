import type { Shape, StrokeShape } from './model.ts';

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Ink radius at a given pencil pressure (0..1) for a stroke of `width`. */
export function radiusAt(width: number, pressure: number): number {
  const p = Math.min(1, Math.max(0, pressure));
  return (width / 2) * (0.35 + 1.3 * p);
}

export function maxRadius(s: StrokeShape): number {
  let maxP = 0;
  for (let i = 2; i < s.points.length; i += 3) maxP = Math.max(maxP, s.points[i]);
  return radiusAt(s.width, maxP);
}

export function shapeBounds(s: Shape): Rect {
  const pts = s.points;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], y = pts[i + 1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const r = maxRadius(s);
  return { minX: minX - r, minY: minY - r, maxX: maxX + r, maxY: maxY + r };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b };
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function expandRect(r: Rect, d: number): Rect {
  return { minX: r.minX - d, minY: r.minY - d, maxX: r.maxX + d, maxY: r.maxY + d };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
