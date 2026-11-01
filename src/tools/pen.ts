import { newId, type StrokeShape } from '../model.ts';
import { appendStroke } from '../strokePath.ts';
import type { Sample, Tool, ToolContext } from './tool.ts';

const SMOOTHING = 0.35; // 0 = raw input, closer to 1 = smoother but laggier
const MIN_STEP_PX = 0.6; // ignore movements smaller than this (screen px)

/** Freehand pressure-sensitive pen. */
export class PenTool implements Tool {
  private points: number[] = [];
  private live: Path2D | null = null;
  private width = 1;
  private color = '#000';
  private opacity = 1;
  private sx = 0; // smoothed position, world units
  private sy = 0;
  private sp = 0.5;
  private last: Sample | null = null;

  constructor(private ctx: ToolContext) {}

  private pressureOf(s: Sample): number {
    if (s.type !== 'pen') return 0.5;
    // Pencil pressure is 0..1; at touch-down it can briefly read 0.
    return s.pressure > 0 ? s.pressure : 0.3;
  }

  down(s: Sample): void {
    const { view, settings } = this.ctx;
    const w = view.toWorld(s.x, s.y);
    this.width = settings.penSize / view.zoom;
    this.color = settings.color;
    this.opacity = settings.penOpacity;
    this.sx = w.x;
    this.sy = w.y;
    this.sp = this.pressureOf(s);
    this.points = [w.x, w.y, this.sp];
    this.live = new Path2D();
    appendStroke(this.live, this.points, this.width, this.points[0], this.points[1], 0);
    this.last = s;
    this.ctx.renderer.requestOverlay();
  }

  move(samples: Sample[]): void {
    if (!this.live) return;
    const { view } = this.ctx;
    const minStep = MIN_STEP_PX / view.zoom;
    const before = this.points.length / 3;
    for (const s of samples) {
      this.last = s;
      const w = view.toWorld(s.x, s.y);
      this.sx += (w.x - this.sx) * (1 - SMOOTHING);
      this.sy += (w.y - this.sy) * (1 - SMOOTHING);
      this.sp += (this.pressureOf(s) - this.sp) * 0.5;
      const n = this.points.length;
      if (Math.hypot(this.sx - this.points[n - 3], this.sy - this.points[n - 2]) < minStep) continue;
      this.points.push(this.sx, this.sy, this.sp);
    }
    this.appendLive(before);
  }

  private appendLive(from: number): void {
    if (!this.live || this.points.length / 3 <= from) return;
    appendStroke(this.live, this.points, this.width, this.points[0], this.points[1], from);
    this.ctx.renderer.requestOverlay();
  }

  up(): void {
    if (!this.live) return;
    // Catch up with the pen's real final position (smoothing lags behind).
    if (this.last) {
      const w = this.ctx.view.toWorld(this.last.x, this.last.y);
      const n = this.points.length;
      if (Math.hypot(w.x - this.points[n - 3], w.y - this.points[n - 2]) > 1e-9) {
        this.points.push(w.x, w.y, this.sp);
      }
    }
    const shape: StrokeShape = {
      id: newId(),
      kind: 'stroke',
      z: this.ctx.scene.nextZ(),
      color: this.color,
      width: this.width,
      opacity: this.opacity,
      points: this.points,
    };
    this.ctx.history.commit({ added: [shape], removed: [] });
    this.reset();
  }

  cancel(): void {
    this.reset();
  }

  private reset(): void {
    this.live = null;
    this.points = [];
    this.last = null;
    this.ctx.renderer.requestOverlay();
  }

  drawOverlay(ctx: CanvasRenderingContext2D, dpr: number): void {
    if (!this.live) return;
    const { view } = this.ctx;
    const k = dpr * view.zoom;
    ctx.setTransform(k, 0, 0, k, (this.points[0] - view.x) * k, (this.points[1] - view.y) * k);
    ctx.globalAlpha = this.opacity;
    ctx.fillStyle = this.color;
    ctx.fill(this.live);
  }
}
