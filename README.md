# Sketchpad

An infinite-canvas sketching app for iPad and Apple Pencil. It runs in Safari
and can be added to the Home Screen to work like a regular app, offline too.

**Open it:** https://danielcostanzi18.github.io/sketchpad/ — then in Safari tap
Share → **Add to Home Screen**.

## Using it

- **Apple Pencil** draws (pressure-sensitive). **One finger** pans, **two fingers** pinch to zoom.
- **Two-finger tap** = undo, **three-finger tap** = redo.
- Tap the pen or eraser again to change color, size, opacity, or eraser mode
  ("Cut ink" removes just what you rub over; "Whole strokes" deletes strokes it touches).
- ☰ menu: drawings, backups, export/import, settings.

## Saving and backups

- Every change is saved automatically within a second.
- While you draw, a backup copy is stored every 2 minutes. The last 20 are kept,
  plus one per day for a month. Restore any of them from the menu (restoring is undoable).
- Everything lives in the app's storage on the iPad. Use **Save drawing to Files**
  now and then for a copy outside the app (e.g. iCloud Drive).

## How it's built

Plain TypeScript and the HTML Canvas, no framework.

| File | Job |
| --- | --- |
| `src/model.ts` | The drawing data: shapes stored in world coordinates |
| `src/camera.ts` | Pan & zoom (screen ↔ world conversion) |
| `src/scene.ts` | The shapes of the open drawing, in stacking order |
| `src/renderer.ts` | Paints what's visible; dot grid that adapts to zoom |
| `src/strokePath.ts` | Turns pencil points + pressure into a smooth ink outline |
| `src/input.ts` | Pencil / finger / mouse handling and gestures |
| `src/tools/` | Pen and eraser |
| `src/erase.ts` | Cutting strokes under the eraser |
| `src/history.ts` | Undo / redo |
| `src/storage.ts`, `src/library.ts` | IndexedDB saving, autosave, backups, import/export |
| `src/ui.ts` | Toolbar, popovers, menu |
| `public/` | HTML, CSS, icons, manifest, service worker (offline) |

## Development

```sh
npm install
npm run dev        # local server at http://localhost:5173
npm test           # unit tests
npm run typecheck
npm run build      # production build into dist/
```

Pushing to `main` builds and publishes the app to GitHub Pages
(`.github/workflows/deploy.yml`).

## Roadmap

1. ✅ Core: infinite canvas, Pencil drawing, eraser, undo, autosave and backups
2. Geometric mode: lines, circles, arcs, AutoCAD-style snaps
3. Images: import, move, resize, rotate, transparency
