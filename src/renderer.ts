import type { View } from './camera.ts';
import { expandRect } from './geometry.ts';
import type { Shape } from './model.ts';
import type { Scene } from './scene.ts';
import { strokeOrigin, strokePath } from './strokePath.ts';

export const PAPER = '#f7f6f2';
const GRID_DOT = '#8a8678';
const GRID_MIN_PX = 18; // smallest on-screen grid spacing

type OverlayDrawer = (ctx: CanvasRenderingContext2D, dpr: number) => void;

/**
 * Two stacked canvases: `main` holds the finished drawing and is only
 * repainted when the view or drawing changes; `overlay` holds live feedback
 * (the stroke being drawn, the eraser cursor) and is cheap to repaint.
 */
export class Renderer {
  dpr = 1;
  showGrid = true;
  private mainDirty = true;
  private overlayDirty = true;
  private frame = 0;
  private overlayDrawers: OverlayDrawer[] = [];
  private mainCtx: CanvasRenderingContext2D;
  private overlayCtx: CanvasRenderingContext2D;

  constructor(
    private main: HTMLCanvasElement,
    private overlay: HTMLCanvasElement,
    private view: View,
    private scene: Scene,
  ) {
    this.mainCtx = main.getContext('2d', { alpha: false })!;
    this.overlayCtx = overlay.getContext('2d')!;
    view.onChange(() => this.invalidate());
    scene.onChange(() => this.requestMain());
  }

  addOverlay(fn: OverlayDrawer): void {
    this.overlayDrawers.push(fn);
  }

  resize(cssW: number, cssH: number): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (const c of [this.main, this.overlay]) {
      c.width = Math.round(cssW * this.dpr);
      c.height = Math.round(cssH * this.dpr);
      c.style.width = cssW + 'px';
      c.style.height = cssH + 'px';
    }
    this.view.resize(cssW, cssH);
    this.invalidate();
  }

  invalidate(): void {
    this.mainDirty = true;
    this.overlayDirty = true;
    this.schedule();
  }

  requestMain(): void {
    this.mainDirty = true;
    this.schedule();
  }

  requestOverlay(): void {
    this.overlayDirty = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.mainDirty) {
        this.mainDirty = false;
        this.paint(this.mainCtx, this.view, this.dpr, this.showGrid);
      }
      if (this.overlayDirty) {
        this.overlayDirty = false;
        const ctx = this.overlayCtx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
        for (const fn of this.overlayDrawers) {
          ctx.save();
          fn(ctx, this.dpr);
          ctx.restore();
        }
      }
    });
  }

  /** Paint background, grid and all visible shapes for `view`. */
  paint(ctx: CanvasRenderingContext2D, view: View, dpr: number, grid: boolean): void {
    const w = view.width * dpr, h = view.height * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, w, h);
    if (grid) drawGrid(ctx, view, dpr);
    // A little margin so strokes just off-screen still get their edges drawn.
    const visible = expandRect(view.visibleRect(), 2 / view.zoom);
    const minWorld = 0.35 / view.zoom; // shapes smaller than this are invisible
    for (const s of this.scene.all()) {
      const b = this.scene.boundsOf(s);
      if (b.maxX < visible.minX || b.minX > visible.maxX || b.maxY < visible.minY || b.minY > visible.maxY) continue;
      if (b.maxX - b.minX < minWorld && b.maxY - b.minY < minWorld) continue;
      drawShape(ctx, s, view, dpr);
    }
    ctx.globalAlpha = 1;
  }
}

export function drawShape(ctx: CanvasRenderingContext2D, s: Shape, view: View, dpr: number): void {
  const o = strokeOrigin(s);
  const k = dpr * view.zoom;
  ctx.setTransform(k, 0, 0, k, (o.x - view.x) * k, (o.y - view.y) * k);
  ctx.globalAlpha = s.opacity;
  ctx.fillStyle = s.color;
  ctx.fill(strokePath(s));
}

/** Dot grid that adapts to the zoom level (powers of 10, fading between). */
function drawGrid(ctx: CanvasRenderingContext2D, view: View, dpr: number): void {
  const z = view.zoom;
  const exp = Math.ceil(Math.log10(GRID_MIN_PX / z));
  const minor = Math.pow(10, exp);
  // 0 when minor spacing just reached GRID_MIN_PX on screen, ->1 as it grows 10x
  const t = Math.min(1, Math.max(0, Math.log10((minor * z) / GRID_MIN_PX)));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = GRID_DOT;
  dots(ctx, view, dpr, minor * 10, 0.55, 1.6);
  dots(ctx, view, dpr, minor, 0.45 * t, 1.2, minor * 10);
  ctx.globalAlpha = 1;
}

function dots(
  ctx: CanvasRenderingContext2D,
  view: View,
  dpr: number,
  step: number,
  alpha: number,
  sizeCss: number,
  skipMultipleOf?: number,
): void {
  if (alpha < 0.02) return;
  const r = view.visibleRect();
  const x0 = Math.floor(r.minX / step), x1 = Math.ceil(r.maxX / step);
  const y0 = Math.floor(r.minY / step), y1 = Math.ceil(r.maxY / step);
  if ((x1 - x0) * (y1 - y0) > 40000) return;
  const ratio = skipMultipleOf ? Math.round(skipMultipleOf / step) : 0;
  const size = sizeCss * dpr;
  ctx.globalAlpha = alpha;
  for (let i = x0; i <= x1; i++) {
    const sx = (i * step - view.x) * view.zoom * dpr;
    for (let j = y0; j <= y1; j++) {
      if (ratio && i % ratio === 0 && j % ratio === 0) continue;
      const sy = (j * step - view.y) * view.zoom * dpr;
      ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
    }
  }
}
