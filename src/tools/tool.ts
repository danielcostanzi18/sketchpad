import type { View } from '../camera.ts';
import type { History } from '../history.ts';
import type { Renderer } from '../renderer.ts';
import type { Scene } from '../scene.ts';
import type { Settings } from '../settings.ts';

/** One input position, in screen (CSS) pixels. */
export interface Sample {
  x: number;
  y: number;
  /** 0..1; for fingers and mice this is a constant. */
  pressure: number;
  type: 'pen' | 'touch' | 'mouse';
}

export interface ToolContext {
  view: View;
  scene: Scene;
  history: History;
  renderer: Renderer;
  settings: Settings;
}

export interface Tool {
  down(s: Sample): void;
  move(samples: Sample[]): void;
  up(): void;
  /** Abort the current gesture (e.g. a second finger started a pinch). */
  cancel(): void;
  /** Apple Pencil hovering above the screen (or mouse moving), not drawing. */
  hover?(s: Sample | null): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, dpr: number): void;
}
