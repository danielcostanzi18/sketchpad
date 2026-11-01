import { test } from 'node:test';
import assert from 'node:assert/strict';
import { View } from '../src/camera.ts';
import { eraseFromStroke, resample, strokeHit } from '../src/erase.ts';
import { backupsToDelete, KEEP_RECENT } from '../src/backupPolicy.ts';
import { Scene } from '../src/scene.ts';
import { History } from '../src/history.ts';
import { appendBelt, type PathSink } from '../src/strokePath.ts';
import type { StrokeShape } from '../src/model.ts';

function stroke(points: number[], id = 's1', z = 0): StrokeShape {
  return { id, kind: 'stroke', z, color: '#000', width: 2, opacity: 1, points };
}

/** Straight horizontal stroke from x=0 to x=100 at y=0, a point every 1 unit. */
function line(id = 's1', z = 0): StrokeShape {
  const pts: number[] = [];
  for (let x = 0; x <= 100; x++) pts.push(x, 0, 0.5);
  return stroke(pts, id, z);
}

test('camera converts screen <-> world and zooms around a point', () => {
  const v = new View();
  v.resize(800, 600);
  v.set({ x: 100, y: 50, zoom: 2 });
  assert.deepEqual(v.toWorld(0, 0), { x: 100, y: 50 });
  assert.deepEqual(v.toWorld(200, 100), { x: 200, y: 100 });
  const before = v.toWorld(300, 200);
  v.zoomAt(300, 200, 3);
  const after = v.toWorld(300, 200);
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9);
  assert.equal(v.zoom, 6);
});

test('pinch keeps the point under the fingers', () => {
  const v = new View();
  v.resize(800, 600);
  const w = v.toWorld(100, 100);
  v.pinch(100, 100, 150, 120, 2);
  const s = v.toScreen(w.x, w.y);
  assert.ok(Math.abs(s.x - 150) < 1e-9 && Math.abs(s.y - 120) < 1e-9);
});

test('partial erase splits a stroke in two', () => {
  const pieces = eraseFromStroke(line(), 50, 0, 5);
  assert.ok(pieces);
  assert.equal(pieces.length, 2);
  const leftEnd = pieces[0][pieces[0].length - 3];
  const rightStart = pieces[1][0];
  assert.ok(leftEnd < 50 - 5 && rightStart > 50 + 5, `gap ${leftEnd}..${rightStart}`);
});

test('erasing far away leaves the stroke alone', () => {
  assert.equal(eraseFromStroke(line(), 50, 40, 5), null);
});

test('erasing a long sparse segment still cuts it (resampling)', () => {
  const s = stroke([0, 0, 0.5, 1000, 0, 0.5]);
  const pieces = eraseFromStroke(s, 500, 0, 4);
  assert.ok(pieces && pieces.length === 2);
  // and doesn't explode the point count far from the eraser
  const total = pieces.reduce((n, p) => n + p.length / 3, 0);
  assert.ok(total < 20, `too many points: ${total}`);
});

test('resample only subdivides near the given point', () => {
  const pts = [0, 0, 1, 100, 0, 1, 200, 0, 1];
  assert.equal(resample(pts, 1).length / 3, 201); // everywhere: one point per unit
  const out = resample(pts, 1, { x: 150, y: 0, reach: 2 });
  const xs = out.filter((_, i) => i % 3 === 0);
  assert.ok(xs.length < 10, `too many points: ${xs.length}`);
  assert.ok(xs.some((x) => Math.abs(x - 150) <= 0.5), 'has a point right under the eraser');
});

test('strokeHit uses the segments, not only the points', () => {
  const s = stroke([0, 0, 0.5, 100, 0, 0.5]);
  assert.ok(strokeHit(s, 50, 3, 2));
  assert.ok(!strokeHit(s, 50, 10, 2));
});

test('scene keeps shapes sorted by z and history undoes/redoes', () => {
  const scene = new Scene();
  const h = new History(scene);
  h.commit({ added: [line('a', 2)], removed: [] });
  h.commit({ added: [line('b', 1)], removed: [] });
  assert.deepEqual(scene.all().map((s) => s.id), ['b', 'a']);
  h.undo();
  assert.deepEqual(scene.all().map((s) => s.id), ['a']);
  h.redo();
  assert.equal(scene.size, 2);
  h.commit({ added: [], removed: [scene.get('a')!] });
  assert.deepEqual(scene.all().map((s) => s.id), ['b']);
  h.undo();
  assert.deepEqual(scene.all().map((s) => s.id), ['b', 'a']);
  assert.ok(!h.canRedo === false);
});

test('backup policy keeps recent ones and one per day', () => {
  const now = new Date(2026, 10, 1, 22, 0).getTime();
  const min = 60_000, day = 24 * 60 * min;
  const stamps = [];
  let key = 1;
  // 30 backups today, 2 minutes apart
  for (let i = 0; i < 30; i++) stamps.push({ key: key++, time: now - i * 2 * min });
  // 3 backups on each of the previous 3 days
  for (let d = 1; d <= 3; d++) for (let i = 0; i < 3; i++) stamps.push({ key: key++, time: now - d * day - i * min });
  // one very old backup
  stamps.push({ key: key++, time: now - 60 * day });
  const del = new Set(backupsToDelete(stamps, now));
  const kept = stamps.filter((s) => !del.has(s.key));
  assert.equal(kept.length, KEEP_RECENT + 3);
  assert.ok(del.has(key - 1), 'very old backup removed');
});

test('belt between two circles is wound like the circles', () => {
  const pts: number[] = [];
  const sink: PathSink = {
    moveTo: (x, y) => pts.push(x, y),
    lineTo: (x, y) => pts.push(x, y),
    arc: () => {},
    closePath: () => {},
  };
  appendBelt(sink, 0, 0, 1, 10, 0, 2);
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
  }
  assert.ok(area > 0);
});
