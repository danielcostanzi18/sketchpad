// Small preferences remembered on this device (tool, color, sizes...).

export type ToolName = 'pen' | 'eraser';
export type EraserMode = 'partial' | 'stroke';

export interface Settings {
  tool: ToolName;
  color: string;
  /** Pen diameter in screen pixels. */
  penSize: number;
  penOpacity: number;
  /** Eraser diameter in screen pixels. */
  eraserSize: number;
  eraserMode: EraserMode;
  fingerDraws: boolean;
  showGrid: boolean;
  recentColors: string[];
  lastDrawingId: string | null;
}

const KEY = 'sketchpad.settings.v1';

export const DEFAULTS: Settings = {
  tool: 'pen',
  color: '#1f1f1f',
  penSize: 3,
  penOpacity: 1,
  eraserSize: 20,
  eraserMode: 'partial',
  fingerDraws: false,
  showGrid: true,
  recentColors: [],
  lastDrawingId: null,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable: use defaults */
  }
  return { ...DEFAULTS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
