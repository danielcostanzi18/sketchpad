import { radiusAt } from './geometry.ts';
import type { StrokeShape } from './model.ts';

/** The subset of Path2D / CanvasRenderingContext2D we draw into. */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean): void;
  closePath(): void;
}

/**
 * Appends the ink outline for points [from, n) of a stroke.
 *
 * A pressure-sensitive stroke is drawn as a chain of circles (one per point,
 * sized by pressure) joined by the "belt" shape tangent to each pair of
 * neighbouring circles. All pieces share the same winding direction, so a
 * single non-zero fill merges them into one smooth shape with no seams.
 *
 * Coordinates are made relative to (ox, oy) so that strokes stay precise
 * when zoomed in very far from the world origin.
 */
export function appendStroke(
  sink: PathSink,
  pts: ArrayLike<number>,
  width: number,
  ox: number,
  oy: number,
  from = 0,
): void {
  const n = pts.length / 3;
  for (let i = from; i < n; i++) {
    const x = pts[i * 3] - ox;
    const y = pts[i * 3 + 1] - oy;
    const r = radiusAt(width, pts[i * 3 + 2]);
    sink.moveTo(x + r, y);
    sink.arc(x, y, r, 0, Math.PI * 2, false);
    sink.closePath();
    if (i > 0) {
      const px = pts[(i - 1) * 3] - ox;
      const py = pts[(i - 1) * 3 + 1] - oy;
      const pr = radiusAt(width, pts[(i - 1) * 3 + 2]);
      appendBelt(sink, px, py, pr, x, y, r);
    }
  }
}

/** Quad tangent to two circles (the straight part between them). */
export function appendBelt(
  sink: PathSink,
  x1: number, y1: number, r1: number,
  x2: number, y2: number, r2: number,
): void {
  const dx = x2 - x1, dy = y2 - y1;
  const d = Math.hypot(dx, dy);
  if (d <= Math.abs(r1 - r2) || d === 0) return; // one circle contains the other
  const theta = Math.atan2(dy, dx);
  const alpha = Math.acos((r1 - r2) / d);
  const a = theta + alpha, b = theta - alpha;
  const q = [
    x1 + r1 * Math.cos(a), y1 + r1 * Math.sin(a),
    x2 + r2 * Math.cos(a), y2 + r2 * Math.sin(a),
    x2 + r2 * Math.cos(b), y2 + r2 * Math.sin(b),
    x1 + r1 * Math.cos(b), y1 + r1 * Math.sin(b),
  ];
  // Same winding as the circles (positive shoelace area in screen coords).
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += q[i * 2] * q[j * 2 + 1] - q[j * 2] * q[i * 2 + 1];
  }
  if (area >= 0) {
    sink.moveTo(q[0], q[1]);
    for (let i = 1; i < 4; i++) sink.lineTo(q[i * 2], q[i * 2 + 1]);
  } else {
    sink.moveTo(q[6], q[7]);
    for (let i = 2; i >= 0; i--) sink.lineTo(q[i * 2], q[i * 2 + 1]);
  }
  sink.closePath();
}

/** Origin used for a stroke's local coordinates: its first point. */
export function strokeOrigin(s: StrokeShape): { x: number; y: number } {
  return { x: s.points[0], y: s.points[1] };
}

const pathCache = new WeakMap<StrokeShape, Path2D>();

/** Cached Path2D for a finished stroke (shapes are never mutated). */
export function strokePath(s: StrokeShape): Path2D {
  let p = pathCache.get(s);
  if (!p) {
    p = new Path2D();
    const o = strokeOrigin(s);
    appendStroke(p, s.points, s.width, o.x, o.y);
    pathCache.set(s, p);
  }
  return p;
}
