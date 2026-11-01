import { eraseFromStroke, strokeHit } from '../erase.ts';
import { newId, type Shape } from '../model.ts';
import type { Sample, Tool, ToolContext } from './tool.ts';

/**
 * Eraser. "partial" cuts away only the ink under it (splitting strokes);
 * "stroke" deletes any stroke it touches.
 * A whole drag is a single undo step.
 */
export class EraserTool implements Tool {
  private active = false;
  private cursor: Sample | null = null;
  private lastWorld: { x: number; y: number } | null = null;
  /** Shapes that existed before this drag and were removed by it. */
  private removedOriginals = new Map<string, Shape>();
  /** Pieces created during this drag that still exist. */
  private created = new Map<string, Shape>();

  constructor(private ctx: ToolContext) {}

  private radiusWorld(): number {
    return this.ctx.settings.eraserSize / 2 / this.ctx.view.zoom;
  }

  down(s: Sample): void {
    this.active = true;
    this.removedOriginals.clear();
    this.created.clear();
    this.cursor = s;
    const w = this.ctx.view.toWorld(s.x, s.y);
    this.lastWorld = w;
    this.eraseAt(w.x, w.y);
    this.ctx.renderer.requestOverlay();
  }

  move(samples: Sample[]): void {
    if (!this.active) return;
    const r = this.radiusWorld();
    for (const s of samples) {
      this.cursor = s;
      const w = this.ctx.view.toWorld(s.x, s.y);
      // Fill in the gap since the last sample so fast swipes don't skip ink.
      const from = this.lastWorld ?? w;
      const steps = Math.max(1, Math.ceil(Math.hypot(w.x - from.x, w.y - from.y) / (r / 2)));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        this.eraseAt(from.x + (w.x - from.x) * t, from.y + (w.y - from.y) * t);
      }
      this.lastWorld = w;
    }
    this.ctx.renderer.requestOverlay();
  }

  private eraseAt(x: number, y: number): void {
    const { scene, settings } = this.ctx;
    const r = this.radiusWorld();
    const area = { minX: x - r, minY: y - r, maxX: x + r, maxY: y + r };
    const add: Shape[] = [];
    const remove: string[] = [];
    for (const s of scene.query(area)) {
      if (settings.eraserMode === 'stroke') {
        if (!strokeHit(s, x, y, r)) continue;
        this.forget(s);
        remove.push(s.id);
        continue;
      }
      const pieces = eraseFromStroke(s, x, y, r);
      if (!pieces) continue;
      this.forget(s);
      remove.push(s.id);
      for (const pts of pieces) {
        const piece: Shape = { ...s, id: newId(), points: pts };
        this.created.set(piece.id, piece);
        add.push(piece);
      }
    }
    scene.apply(add, remove);
  }

  /** Track a shape that is about to be removed. */
  private forget(s: Shape): void {
    if (this.created.has(s.id)) this.created.delete(s.id);
    else this.removedOriginals.set(s.id, s);
  }

  up(): void {
    if (!this.active) return;
    this.active = false;
    this.lastWorld = null;
    this.cursor = null;
    this.ctx.history.record({
      added: [...this.created.values()],
      removed: [...this.removedOriginals.values()],
    });
    this.removedOriginals.clear();
    this.created.clear();
    this.ctx.renderer.requestOverlay();
  }

  cancel(): void {
    this.up();
  }

  hover(s: Sample | null): void {
    if (this.active) return;
    this.cursor = s;
    this.ctx.renderer.requestOverlay();
  }

  drawOverlay(ctx: CanvasRenderingContext2D, dpr: number): void {
    if (!this.cursor) return;
    const r = (this.ctx.settings.eraserSize / 2) * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.arc(this.cursor.x * dpr, this.cursor.y * dpr, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fill();
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = 'rgba(40,40,40,0.7)';
    ctx.stroke();
  }
}
