import type { View } from './camera.ts';
import type { Settings } from './settings.ts';
import type { Sample, Tool } from './tools/tool.ts';

interface Callbacks {
  tool(): Tool;
  undo(): void;
  redo(): void;
  /** Called on the first real interaction (used to request persistent storage). */
  interacted(): void;
}

interface TouchGesture {
  start: number;
  maxFingers: number;
  moved: boolean;
  /** Where each finger started, to detect taps. */
  origin: Map<number, { x: number; y: number }>;
  lastCentroid: { x: number; y: number } | null;
  lastSpread: number;
  lastCount: number;
}

const TAP_MS = 300;
const TAP_SLOP_PX = 12;
const FINGER_DRAW_GRACE_MS = 250;

/**
 * Turns raw pointer events into drawing and navigation:
 *  - Apple Pencil (and mouse) draw with the current tool
 *  - one finger pans, two fingers pinch-zoom and pan
 *  - two-finger tap = undo, three-finger tap = redo
 *  - touches are ignored while the Pencil is down (palm rejection)
 */
export class Input {
  private drawing: { id: number; type: Sample['type']; start: number } | null = null;
  private touches = new Map<number, { x: number; y: number }>();
  private gesture: TouchGesture | null = null;
  private mousePan: { x: number; y: number } | null = null;
  private spaceDown = false;
  private didInteract = false;

  constructor(
    private el: HTMLElement,
    private view: View,
    private settings: Settings,
    private cb: Callbacks,
  ) {
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e));
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'touch' && !this.drawing) this.cb.tool().hover?.(null);
    });
    el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    // Stop iOS from scrolling, zooming the page or showing the magnifier.
    const stop = (e: Event) => e.preventDefault();
    el.addEventListener('touchstart', stop, { passive: false });
    el.addEventListener('touchmove', stop, { passive: false });
    el.addEventListener('contextmenu', stop);
    document.addEventListener('gesturestart', stop as EventListener);
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
  }

  private pos(e: PointerEvent): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private sample(e: PointerEvent): Sample {
    const p = this.pos(e);
    const type = e.pointerType === 'pen' ? 'pen' : e.pointerType === 'touch' ? 'touch' : 'mouse';
    return { x: p.x, y: p.y, pressure: e.pressure, type };
  }

  private interacted(): void {
    if (this.didInteract) return;
    this.didInteract = true;
    this.cb.interacted();
  }

  private startDrawing(e: PointerEvent): void {
    const s = this.sample(e);
    this.drawing = { id: e.pointerId, type: s.type, start: performance.now() };
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.cb.tool().down(s);
  }

  private onDown(e: PointerEvent): void {
    e.preventDefault();
    this.interacted();
    if (e.pointerType === 'pen') {
      if (this.drawing) return;
      if (this.gesture) this.gesture = null; // Pencil wins over a finger gesture
      this.startDrawing(e);
      return;
    }
    if (e.pointerType === 'mouse') {
      if (this.drawing) return;
      if (e.button === 0 && !this.spaceDown) this.startDrawing(e);
      else {
        this.mousePan = this.pos(e);
        this.el.setPointerCapture(e.pointerId);
      }
      return;
    }
    // Touch
    if (this.drawing?.type === 'pen') return; // palm resting while drawing
    this.touches.set(e.pointerId, this.pos(e));
    if (this.drawing?.type === 'touch') {
      // A second finger right after the first: it was a pinch, not a stroke.
      if (performance.now() - this.drawing.start < FINGER_DRAW_GRACE_MS) {
        this.cb.tool().cancel();
        this.drawing = null;
        this.beginGesture();
      }
      return;
    }
    if (this.settings.fingerDraws && this.touches.size === 1 && !this.gesture) {
      this.startDrawing(e);
      return;
    }
    if (!this.gesture) this.beginGesture();
    else {
      this.gesture.origin.set(e.pointerId, this.pos(e));
      this.gesture.maxFingers = Math.max(this.gesture.maxFingers, this.touches.size);
      this.gesture.lastCentroid = null; // re-baseline, avoids a jump
    }
  }

  private beginGesture(): void {
    this.gesture = {
      start: performance.now(),
      maxFingers: this.touches.size,
      moved: false,
      origin: new Map([...this.touches].map(([id, p]) => [id, { ...p }])),
      lastCentroid: null,
      lastSpread: 0,
      lastCount: 0,
    };
  }

  private onMove(e: PointerEvent): void {
    if (this.drawing && e.pointerId === this.drawing.id) {
      e.preventDefault();
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const list = events.length ? events : [e];
      this.cb.tool().move(list.map((ev) => this.sample(ev)));
      return;
    }
    if (e.pointerType === 'touch') {
      if (!this.touches.has(e.pointerId)) return;
      this.touches.set(e.pointerId, this.pos(e));
      if (this.gesture) this.updateGesture();
      return;
    }
    if (this.mousePan && e.pointerType === 'mouse') {
      const p = this.pos(e);
      this.view.panBy(p.x - this.mousePan.x, p.y - this.mousePan.y);
      this.mousePan = p;
      return;
    }
    if (!this.drawing) this.cb.tool().hover?.(this.sample(e));
  }

  private updateGesture(): void {
    const g = this.gesture!;
    const pts = [...this.touches.values()];
    if (!pts.length) return;
    const c = {
      x: pts.reduce((a, p) => a + p.x, 0) / pts.length,
      y: pts.reduce((a, p) => a + p.y, 0) / pts.length,
    };
    const spread = pts.reduce((a, p) => a + Math.hypot(p.x - c.x, p.y - c.y), 0) / pts.length;
    if (g.lastCentroid && g.lastCount === pts.length) {
      const factor = pts.length >= 2 && g.lastSpread > 0 && spread > 0 ? spread / g.lastSpread : 1;
      this.view.pinch(g.lastCentroid.x, g.lastCentroid.y, c.x, c.y, factor);
    }
    g.lastCentroid = c;
    g.lastSpread = spread;
    g.lastCount = pts.length;
    if (!g.moved) {
      for (const [id, p] of this.touches) {
        const o = g.origin.get(id);
        if (o && Math.hypot(p.x - o.x, p.y - o.y) > TAP_SLOP_PX) g.moved = true;
      }
    }
  }

  private onUp(e: PointerEvent): void {
    if (this.drawing && e.pointerId === this.drawing.id) {
      this.cb.tool().up();
      this.drawing = null;
      if (e.pointerType === 'touch') this.touches.delete(e.pointerId);
      return;
    }
    if (e.pointerType === 'mouse') {
      this.mousePan = null;
      return;
    }
    if (e.pointerType !== 'touch') return;
    this.touches.delete(e.pointerId);
    const g = this.gesture;
    if (!g) return;
    if (this.touches.size === 0) {
      const quick = performance.now() - g.start < TAP_MS;
      if (quick && !g.moved && e.type === 'pointerup') {
        if (g.maxFingers === 2) this.cb.undo();
        else if (g.maxFingers === 3) this.cb.redo();
      }
      this.gesture = null;
    } else {
      g.lastCentroid = null; // re-baseline with the remaining fingers
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const p = { x: e.clientX - this.el.getBoundingClientRect().left, y: e.clientY - this.el.getBoundingClientRect().top };
    const lineMode = e.deltaMode !== 0;
    const scale = lineMode ? 16 : 1;
    const dx = e.deltaX * scale, dy = e.deltaY * scale;
    // Trackpad pinch arrives as ctrl+wheel; a mouse wheel scrolls in big steps.
    const looksLikeMouseWheel = lineMode || (dx === 0 && Math.abs(dy) >= 50);
    if (e.ctrlKey || e.metaKey || looksLikeMouseWheel) {
      this.view.zoomAt(p.x, p.y, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.002)));
    } else {
      this.view.panBy(-dx, -dy);
    }
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if (e.code === 'Space') {
      this.spaceDown = down;
      e.preventDefault();
      return;
    }
    if (!down) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.cb.redo();
      else this.cb.undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.cb.redo();
    }
  }
}
