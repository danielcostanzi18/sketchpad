import { radiusAt } from './geometry.ts';
import type { StrokeShape } from './model.ts';

/** Distance from point (px, py) to segment (ax, ay)-(bx, by). */
export function distToSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Does an eraser circle at (cx, cy) with radius r touch the stroke's ink? */
export function strokeHit(s: StrokeShape, cx: number, cy: number, r: number): boolean {
  const p = s.points;
  const n = p.length / 3;
  if (n === 1) return Math.hypot(p[0] - cx, p[1] - cy) <= r + radiusAt(s.width, p[2]);
  for (let i = 1; i < n; i++) {
    const a = (i - 1) * 3, b = i * 3;
    const ink = radiusAt(s.width, Math.max(p[a + 2], p[b + 2]));
    if (distToSegment(cx, cy, p[a], p[a + 1], p[b], p[b + 1]) <= r + ink) return true;
  }
  return false;
}

/**
 * Insert extra points so no segment is longer than `maxSpacing`.
 * If `near` is given, only segments within `near.reach` of (near.x, near.y)
 * are subdivided, so long strokes don't balloon in size.
 */
export function resample(
  points: readonly number[],
  maxSpacing: number,
  near?: { x: number; y: number; reach: number },
): number[] {
  const out: number[] = [points[0], points[1], points[2]];
  for (let i = 3; i < points.length; i += 3) {
    const ax = points[i - 3], ay = points[i - 2], ap = points[i - 1];
    const bx = points[i], by = points[i + 1], bp = points[i + 2];
    const len = Math.hypot(bx - ax, by - ay);
    // Parameter range [t0, t1] of this segment that needs extra points.
    let t0 = 0, t1 = 1;
    if (near && len > 0) {
      if (distToSegment(near.x, near.y, ax, ay, bx, by) > near.reach) t1 = -1; // not close
      else {
        const tc = ((near.x - ax) * (bx - ax) + (near.y - ay) * (by - ay)) / (len * len);
        const h = Math.abs((near.x - ax) * (by - ay) - (near.y - ay) * (bx - ax)) / len;
        const half = Math.sqrt(Math.max(0, near.reach * near.reach - h * h)) / len;
        t0 = Math.max(0, tc - half);
        t1 = Math.min(1, tc + half);
      }
    }
    if (t1 > t0 && len > maxSpacing) {
      const steps = Math.ceil(((t1 - t0) * len) / maxSpacing);
      for (let k = 0; k <= steps; k++) {
        const t = t0 + ((t1 - t0) * k) / steps;
        if (t <= 0 || t >= 1) continue;
        out.push(ax + (bx - ax) * t, ay + (by - ay) * t, ap + (bp - ap) * t);
      }
    }
    out.push(bx, by, bp);
  }
  return out;
}

/**
 * Cut the part of a stroke under an eraser circle.
 * Returns null if the stroke isn't touched, otherwise the point lists of the
 * remaining pieces (possibly none, if the stroke was erased completely).
 */
export function eraseFromStroke(
  s: StrokeShape,
  cx: number,
  cy: number,
  r: number,
): number[][] | null {
  if (!strokeHit(s, cx, cy, r)) return null;
  const spacing = Math.max(r / 2, 1e-9);
  const reach = r + radiusAt(s.width, 1) + spacing;
  const pts = resample(s.points, spacing, { x: cx, y: cy, reach });
  const n = pts.length / 3;
  if (n === 1) return [];
  const pieces: number[][] = [];
  let run: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = pts[i * 3], y = pts[i * 3 + 1], p = pts[i * 3 + 2];
    const erased = Math.hypot(x - cx, y - cy) <= r + radiusAt(s.width, p);
    if (erased) {
      if (run.length >= 6) pieces.push(run); // keep runs of 2+ points
      run = [];
    } else {
      run.push(x, y, p);
    }
  }
  if (run.length >= 6) pieces.push(run);
  return pieces;
}
