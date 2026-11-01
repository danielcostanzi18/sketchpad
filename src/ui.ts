import type { View } from './camera.ts';
import type { History } from './history.ts';
import { icons } from './icons.ts';
import type { Library } from './library.ts';
import { PAPER, type Renderer } from './renderer.ts';
import type { Scene } from './scene.ts';
import { saveSettings, type Settings, type ToolName } from './settings.ts';
import { BACKUP_INTERVAL_MS } from './backupPolicy.ts';

const SWATCHES = [
  '#1f1f1f', '#6b6b6b', '#ffffff', '#e5484d', '#f76b15', '#ffc53d',
  '#30a46c', '#12a594', '#0090ff', '#3e63dd', '#8e4ec6', '#a0623a',
];

interface UIDeps {
  view: View;
  scene: Scene;
  history: History;
  renderer: Renderer;
  settings: Settings;
  library: Library | null;
  setTool(t: ToolName): void;
}

const $ = <T extends HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

function el(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Logarithmic slider mapping 0..100 <-> min..max. */
const logToSize = (v: number, min: number, max: number) => min * Math.pow(max / min, v / 100);
const sizeToLog = (s: number, min: number, max: number) => (100 * Math.log(s / min)) / Math.log(max / min);

function timeLabel(t: number): string {
  const diff = Date.now() - t;
  if (diff < 45_000) return 'just now';
  if (diff < 60 * 60_000) return `${Math.round(diff / 60_000)} min ago`;
  const d = new Date(t);
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (new Date().toDateString() === d.toDateString()) return `today ${hm}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${hm}`;
}

function zoomLabel(z: number): string {
  const pct = z * 100;
  if (pct >= 10000) return `${Math.round(pct / 1000)}k%`;
  if (pct >= 10) return `${Math.round(pct)}%`;
  if (pct >= 1) return `${pct.toFixed(1)}%`;
  return `${pct.toPrecision(2)}%`;
}

/** Hand a file to the user: the iPad share sheet ("Save to Files") or a download. */
export async function saveFile(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      // otherwise fall back to a download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function dataUrlToBlob(url: string): Blob {
  const [head, b64] = url.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'sketch';
}

export class UI {
  private toolbar: HTMLElement;
  private penPop: HTMLElement;
  private eraserPop: HTMLElement;
  private sheet: HTMLElement;
  private toastEl: HTMLElement;
  private toastTimer = 0;

  constructor(private root: HTMLElement, private d: UIDeps) {
    this.toolbar = el(`
      <div class="bar toolbar" role="toolbar">
        <button class="btn" data-act="menu" aria-label="Menu">${icons.menu}</button>
        <span class="sep"></span>
        <button class="btn tool" data-tool="pen" aria-label="Pen">${icons.pen}</button>
        <button class="btn tool" data-tool="eraser" aria-label="Eraser">${icons.eraser}</button>
        <button class="btn color" data-act="color" aria-label="Color and size"><span class="dot"></span></button>
        <span class="sep"></span>
        <button class="btn" data-act="undo" aria-label="Undo">${icons.undo}</button>
        <button class="btn" data-act="redo" aria-label="Redo">${icons.redo}</button>
      </div>`);
    const title = el(`<button class="title" aria-label="Rename drawing"><span class="name"></span><span class="status"></span></button>`);
    const zoomBar = el(`
      <div class="bar zoombar">
        <button class="btn" data-act="fit" aria-label="Fit drawing on screen">${icons.fit}</button>
        <button class="zoom" data-act="zoom100" aria-label="Reset zoom to 100%"></button>
      </div>`);
    this.penPop = el(`
      <div class="pop" hidden>
        <div class="swatches">${SWATCHES.map((c) => `<button class="sw" data-color="${c}" style="--c:${c}" aria-label="${c}"></button>`).join('')}
          <label class="sw custom" aria-label="Custom color"><input type="color"></label>
        </div>
        <div class="recent"></div>
        <label class="row"><span>Size</span><input type="range" min="0" max="100" step="0.5" data-k="penSize"><output></output></label>
        <label class="row"><span>Opacity</span><input type="range" min="10" max="100" step="1" data-k="penOpacity"><output></output></label>
        <canvas class="preview" width="560" height="80"></canvas>
      </div>`);
    this.eraserPop = el(`
      <div class="pop" hidden>
        <div class="seg">
          <button data-mode="partial">Cut ink</button>
          <button data-mode="stroke">Whole strokes</button>
        </div>
        <label class="row"><span>Size</span><input type="range" min="0" max="100" step="0.5" data-k="eraserSize"><output></output></label>
      </div>`);
    this.sheet = el(`<aside class="sheet" hidden><div class="sheet-body"></div></aside>`);
    this.toastEl = el(`<div class="toast" role="status" hidden></div>`);
    root.append(this.toolbar, title, zoomBar, this.penPop, this.eraserPop, this.sheet, this.toastEl);

    this.toolbar.addEventListener('click', (e) => this.onToolbar(e));
    zoomBar.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest('button')?.dataset.act;
      if (act === 'fit') this.fit();
      if (act === 'zoom100') d.view.setZoomCentered(1);
    });
    title.addEventListener('click', () => void this.renameCurrent());
    this.wirePenPop();
    this.wireEraserPop();
    this.sheet.addEventListener('click', (e) => {
      if (e.target === this.sheet) this.closeSheet();
    });
    // Tapping the canvas closes popovers.
    root.querySelector('#stage')?.addEventListener('pointerdown', () => this.closePops(), true);

    d.view.onChange(() => this.updateZoom());
    d.history.onChange(() => this.updateUndo());
    d.library?.onChange(() => this.updateTitle());
    setInterval(() => this.updateTitle(), 30_000);
    this.refresh();
  }

  refresh(): void {
    this.updateTools();
    this.updateUndo();
    this.updateZoom();
    this.updateTitle();
  }

  toast(msg: string, ms = 2200): void {
    this.toastEl.textContent = msg;
    this.toastEl.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toastEl.hidden = true), ms);
  }

  // ----- toolbar -----

  private onToolbar(e: Event): void {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    const tool = btn.dataset.tool as ToolName | undefined;
    if (tool) {
      if (this.d.settings.tool === tool) this.togglePop(tool === 'pen' ? this.penPop : this.eraserPop, btn);
      else {
        this.closePops();
        this.d.setTool(tool);
        this.updateTools();
      }
      return;
    }
    switch (btn.dataset.act) {
      case 'menu':
        this.closePops();
        void this.openSheet();
        break;
      case 'color':
        if (this.d.settings.tool !== 'pen') {
          this.d.setTool('pen');
          this.updateTools();
        }
        this.togglePop(this.penPop, btn);
        break;
      case 'undo':
        this.d.history.undo();
        break;
      case 'redo':
        this.d.history.redo();
        break;
    }
  }

  private updateTools(): void {
    const s = this.d.settings;
    this.toolbar.querySelectorAll<HTMLButtonElement>('.tool').forEach((b) => {
      b.classList.toggle('active', b.dataset.tool === s.tool);
    });
    const dot = $(this.toolbar, '.dot');
    dot.style.background = s.color;
    const px = Math.max(4, Math.min(22, 4 + Math.sqrt(s.penSize) * 3));
    dot.style.width = dot.style.height = px + 'px';
  }

  private updateUndo(): void {
    $<HTMLButtonElement>(this.toolbar, '[data-act=undo]').disabled = !this.d.history.canUndo;
    $<HTMLButtonElement>(this.toolbar, '[data-act=redo]').disabled = !this.d.history.canRedo;
  }

  private updateZoom(): void {
    const z = $(this.root, '.zoom');
    if (z) z.textContent = zoomLabel(this.d.view.zoom);
  }

  private updateTitle(): void {
    const lib = this.d.library;
    const name = $(this.root, '.title .name');
    const status = $(this.root, '.title .status');
    if (!lib?.current) {
      name.textContent = 'Sketchpad';
      status.textContent = lib ? '' : 'not saving';
      return;
    }
    name.textContent = lib.current.name;
    const st = lib.status;
    status.textContent = st.error
      ? '⚠︎ ' + st.error
      : st.lastBackup
        ? `backed up ${timeLabel(st.lastBackup)}`
        : st.lastSaved
          ? 'saved'
          : '';
    status.classList.toggle('error', !!st.error);
  }

  private fit(): void {
    const ext = this.d.scene.extent();
    if (ext) this.d.view.fit(ext, 60);
    else this.d.view.set({ x: -this.d.view.width / 2, y: -this.d.view.height / 2, zoom: 1 });
  }

  // ----- popovers -----

  private togglePop(pop: HTMLElement, anchor: HTMLElement): void {
    const open = pop.hidden;
    this.closePops();
    if (!open) return;
    pop.hidden = false;
    this.syncPops();
    const a = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const left = Math.max(12, Math.min(window.innerWidth - w - 12, a.left + a.width / 2 - w / 2));
    pop.style.left = left + 'px';
    pop.style.top = a.bottom + 10 + 'px';
  }

  private closePops(): void {
    this.penPop.hidden = true;
    this.eraserPop.hidden = true;
  }

  private wirePenPop(): void {
    const s = this.d.settings;
    this.penPop.addEventListener('click', (e) => {
      const sw = (e.target as HTMLElement).closest<HTMLElement>('[data-color]');
      if (sw?.dataset.color) this.setColor(sw.dataset.color);
    });
    const custom = $<HTMLInputElement>(this.penPop, 'input[type=color]');
    custom.addEventListener('input', () => this.setColor(custom.value, false));
    custom.addEventListener('change', () => this.setColor(custom.value, true));
    const size = $<HTMLInputElement>(this.penPop, '[data-k=penSize]');
    size.addEventListener('input', () => {
      s.penSize = Math.round(logToSize(+size.value, 0.5, 80) * 10) / 10;
      this.persist();
    });
    const op = $<HTMLInputElement>(this.penPop, '[data-k=penOpacity]');
    op.addEventListener('input', () => {
      s.penOpacity = +op.value / 100;
      this.persist();
    });
  }

  private wireEraserPop(): void {
    const s = this.d.settings;
    this.eraserPop.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-mode]');
      if (!b) return;
      s.eraserMode = b.dataset.mode as Settings['eraserMode'];
      this.persist();
    });
    const size = $<HTMLInputElement>(this.eraserPop, '[data-k=eraserSize]');
    size.addEventListener('input', () => {
      s.eraserSize = Math.round(logToSize(+size.value, 4, 160));
      this.persist();
    });
  }

  private setColor(c: string, remember = true): void {
    const s = this.d.settings;
    s.color = c;
    if (remember && !SWATCHES.includes(c)) {
      s.recentColors = [c, ...s.recentColors.filter((x) => x !== c)].slice(0, 6);
    }
    this.persist();
  }

  private persist(): void {
    saveSettings(this.d.settings);
    this.updateTools();
    this.syncPops();
  }

  private syncPops(): void {
    const s = this.d.settings;
    this.penPop.querySelectorAll<HTMLElement>('[data-color]').forEach((b) => {
      b.classList.toggle('on', b.dataset.color === s.color);
    });
    $<HTMLInputElement>(this.penPop, 'input[type=color]').value = s.color;
    const recent = $(this.penPop, '.recent');
    recent.innerHTML = s.recentColors
      .map((c) => `<button class="sw small${c === s.color ? ' on' : ''}" data-color="${esc(c)}" style="--c:${esc(c)}" aria-label="${esc(c)}"></button>`)
      .join('');
    recent.hidden = !s.recentColors.length;
    const size = $<HTMLInputElement>(this.penPop, '[data-k=penSize]');
    size.value = String(sizeToLog(s.penSize, 0.5, 80));
    (size.nextElementSibling as HTMLOutputElement).value = `${s.penSize} px`;
    const op = $<HTMLInputElement>(this.penPop, '[data-k=penOpacity]');
    op.value = String(Math.round(s.penOpacity * 100));
    (op.nextElementSibling as HTMLOutputElement).value = `${Math.round(s.penOpacity * 100)}%`;
    this.drawPreview();

    this.eraserPop.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => {
      b.classList.toggle('on', b.dataset.mode === s.eraserMode);
    });
    const es = $<HTMLInputElement>(this.eraserPop, '[data-k=eraserSize]');
    es.value = String(sizeToLog(s.eraserSize, 4, 160));
    (es.nextElementSibling as HTMLOutputElement).value = `${s.eraserSize} px`;
  }

  /** A sample squiggle showing the current pen. */
  private drawPreview(): void {
    const c = $<HTMLCanvasElement>(this.penPop, '.preview');
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const s = this.d.settings;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.beginPath();
    for (let x = 30; x <= c.width - 30; x += 4) {
      const y = c.height / 2 + Math.sin((x / c.width) * Math.PI * 2) * 18;
      if (x === 30) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.globalAlpha = s.penOpacity;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = Math.min(60, s.penSize * 2); // canvas is drawn at 2x
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ----- menu sheet -----

  private closeSheet(): void {
    this.sheet.hidden = true;
  }

  private async openSheet(): Promise<void> {
    this.sheet.hidden = false;
    await this.renderSheet();
  }

  private async renderSheet(): Promise<void> {
    const body = $(this.sheet, '.sheet-body');
    const lib = this.d.library;
    const s = this.d.settings;
    const drawings = lib ? await lib.listDrawings() : [];
    const backups = lib ? await lib.listBackups() : [];
    const cur = lib?.current;
    body.innerHTML = `
      <header class="sheet-head">
        <h2>Sketchpad</h2>
        <button class="btn" data-act="close" aria-label="Close">${icons.close}</button>
      </header>
      ${lib ? '' : `<p class="warn">Saving isn't available in this browser mode, so your drawing will be lost when you close the page. Use "Save drawing to Files".</p>`}
      <section>
        <div class="sec-head"><h3>Drawings</h3><button class="pill" data-act="new">${icons.plus} New</button></div>
        <ul class="list">
          ${drawings
            .map(
              (dw) => `
            <li class="${dw.id === cur?.id ? 'current' : ''}">
              <button class="item" data-open="${dw.id}">
                <strong>${esc(dw.name)}</strong>
                <small>${timeLabel(dw.updated)} · ${dw.count} stroke${dw.count === 1 ? '' : 's'}</small>
              </button>
              <button class="link" data-rename="${dw.id}">Rename</button>
              <button class="link danger" data-delete="${dw.id}">Delete</button>
            </li>`,
            )
            .join('')}
        </ul>
      </section>
      ${
        lib && cur
          ? `<section>
        <div class="sec-head"><h3>Backups of “${esc(cur.name)}”</h3><button class="pill" data-act="backup">Back up now</button></div>
        <p class="hint">Saved automatically every ${BACKUP_INTERVAL_MS / 60000} minutes while you draw. The last 20 are kept, plus one per day for a month.</p>
        <ul class="list compact">
          ${
            backups.length
              ? backups
                  .map(
                    (b) => `
            <li><span class="item static"><strong>${timeLabel(b.time)}</strong><small>${b.count} stroke${b.count === 1 ? '' : 's'}</small></span>
            <button class="link" data-restore="${b.key}">Restore</button></li>`,
                  )
                  .join('')
              : `<li class="empty">No backups yet.</li>`
          }
        </ul>
      </section>`
          : ''
      }
      <section>
        <h3>Files</h3>
        <div class="grid-btns">
          <button class="pill" data-act="export">Save drawing to Files</button>
          <button class="pill" data-act="import">Open drawing file…</button>
          <button class="pill" data-act="png">Save view as image</button>
        </div>
        <p class="hint">Drawings live inside this app on your iPad. Saving a copy to Files (or iCloud Drive) now and then keeps them safe even if Safari's data is cleared.</p>
        <input type="file" accept=".json,application/json" hidden>
      </section>
      <section>
        <h3>Settings</h3>
        <label class="toggle"><input type="checkbox" data-set="fingerDraws" ${s.fingerDraws ? 'checked' : ''}><span>Draw with finger</span><small>Off: fingers only move and zoom</small></label>
        <label class="toggle"><input type="checkbox" data-set="showGrid" ${s.showGrid ? 'checked' : ''}><span>Dot grid</span></label>
      </section>
      <section>
        <h3>Gestures</h3>
        <ul class="help">
          <li><b>Apple Pencil</b> draws</li>
          <li><b>One finger</b> moves around</li>
          <li><b>Two fingers</b> pinch to zoom</li>
          <li><b>Two-finger tap</b> undo · <b>three-finger tap</b> redo</li>
          <li>Tap the selected tool again for its options</li>
        </ul>
      </section>`;
    body.onclick = (e) => void this.onSheetClick(e);
    body.onchange = (e) => this.onSheetChange(e);
  }

  private async onSheetClick(e: Event): Promise<void> {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t) return;
    const lib = this.d.library;
    const ds = t.dataset;
    if (ds.act === 'close') return this.closeSheet();
    if (ds.act === 'export') return this.exportDrawing();
    if (ds.act === 'png') return this.exportPng();
    if (ds.act === 'import') {
      $<HTMLInputElement>(this.sheet, 'input[type=file]').click();
      return;
    }
    if (!lib) return;
    try {
      if (ds.act === 'new') {
        await lib.create();
        this.closeSheet();
        this.toast('New drawing');
      } else if (ds.act === 'backup') {
        await lib.backupNow(true);
        this.toast('Backed up');
        await this.renderSheet();
      } else if (ds.open) {
        await lib.open(ds.open);
        this.closeSheet();
      } else if (ds.rename) {
        const list = await lib.listDrawings();
        const cur = list.find((x) => x.id === ds.rename);
        const name = prompt('Name this drawing', cur?.name ?? '');
        if (name) await lib.rename(ds.rename, name);
        await this.renderSheet();
      } else if (ds.delete) {
        const list = await lib.listDrawings();
        const dw = list.find((x) => x.id === ds.delete);
        if (dw && confirm(`Delete “${dw.name}” and all its backups? This can't be undone.`)) {
          await lib.remove(ds.delete);
          this.toast('Deleted');
          await this.renderSheet();
        }
      } else if (ds.restore) {
        if (confirm('Restore this backup? Your current version is backed up first, and you can undo this.')) {
          await lib.restoreBackup(+ds.restore);
          this.closeSheet();
          this.toast('Backup restored — tap undo to go back');
        }
      }
    } catch (err) {
      this.toast('Something went wrong: ' + String(err), 4000);
    }
  }

  private onSheetChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (input.type === 'file') {
      const file = input.files?.[0];
      input.value = '';
      if (file) void this.importDrawing(file);
      return;
    }
    const key = input.dataset.set as 'fingerDraws' | 'showGrid' | undefined;
    if (!key) return;
    this.d.settings[key] = input.checked;
    saveSettings(this.d.settings);
    if (key === 'showGrid') {
      this.d.renderer.showGrid = input.checked;
      this.d.renderer.requestMain();
    }
  }

  private async renameCurrent(): Promise<void> {
    const lib = this.d.library;
    if (!lib?.current) return;
    const name = prompt('Name this drawing', lib.current.name);
    if (name) await lib.rename(lib.current.id, name);
  }

  private exportDrawing(): void {
    const lib = this.d.library;
    const data = lib
      ? lib.toFile()
      : { app: 'sketchpad', version: 1, name: 'Sketch', camera: this.d.view.get(), shapes: this.d.scene.all() };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', 'h');
    void saveFile(blob, `${safeName(data.name)} ${stamp}.sketchpad.json`);
  }

  private exportPng(): void {
    const { view, renderer } = this.d;
    const scale = 2;
    const c = document.createElement('canvas');
    c.width = Math.round(view.width * scale);
    c.height = Math.round(view.height * scale);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    renderer.paint(ctx, view, scale, false);
    // Synchronous on purpose: the iPad share sheet must open right after the tap.
    const blob = dataUrlToBlob(c.toDataURL('image/png'));
    void saveFile(blob, `${safeName(this.d.library?.current.name ?? 'sketch')}.png`);
  }

  private async importDrawing(file: File): Promise<void> {
    const lib = this.d.library;
    if (!lib) return this.toast("Can't import: saving isn't available here.");
    try {
      await lib.importFile(await file.text(), file.name.replace(/\.sketchpad\.json$|\.json$/i, ''));
      this.closeSheet();
      this.toast('Drawing imported');
    } catch (err) {
      this.toast((err as Error).message || 'Could not open that file', 4000);
    }
  }
}
