import { View } from './camera.ts';
import { History } from './history.ts';
import { Input } from './input.ts';
import { Library } from './library.ts';
import { Renderer } from './renderer.ts';
import { Scene } from './scene.ts';
import { loadSettings, saveSettings, type ToolName } from './settings.ts';
import { Storage, requestPersistence } from './storage.ts';
import { EraserTool } from './tools/eraser.ts';
import { PenTool } from './tools/pen.ts';
import type { Tool, ToolContext } from './tools/tool.ts';
import { UI } from './ui.ts';

async function start(): Promise<void> {
  const app = document.getElementById('app')!;
  const stage = document.getElementById('stage')!;
  const mainCanvas = document.getElementById('main') as HTMLCanvasElement;
  const overlayCanvas = document.getElementById('overlay') as HTMLCanvasElement;

  const settings = loadSettings();
  const view = new View();
  const scene = new Scene();
  const history = new History(scene);
  const renderer = new Renderer(mainCanvas, overlayCanvas, view, scene);
  renderer.showGrid = settings.showGrid;

  const ctx: ToolContext = { view, scene, history, renderer, settings };
  const tools: Record<ToolName, Tool> = { pen: new PenTool(ctx), eraser: new EraserTool(ctx) };
  const currentTool = () => tools[settings.tool] ?? tools.pen;
  renderer.addOverlay((c, dpr) => currentTool().drawOverlay?.(c, dpr));

  const resize = () => renderer.resize(stage.clientWidth, stage.clientHeight);
  new ResizeObserver(resize).observe(stage);
  resize();

  let library: Library | null = null;
  try {
    const storage = await Storage.open();
    library = new Library(storage, scene, view, history, settings);
    await library.init();
  } catch (err) {
    console.error('Storage unavailable', err);
    library = null;
    view.set({ x: -view.width / 2, y: -view.height / 2, zoom: 1 });
  }

  const ui = new UI(app, {
    view,
    scene,
    history,
    renderer,
    settings,
    library,
    setTool(t) {
      currentTool().hover?.(null);
      settings.tool = t;
      saveSettings(settings);
      renderer.requestOverlay();
    },
  });
  if (!library) ui.toast("Saving isn't available in this browser mode", 5000);

  new Input(stage, view, settings, {
    tool: currentTool,
    undo: () => history.undo(),
    redo: () => history.redo(),
    interacted: () => void requestPersistence(),
  });

  // Offline support (only on the real https site, not while developing).
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker failed', err));
  }
}

void start();
