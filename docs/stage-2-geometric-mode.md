# Stage 2 — Geometric mode (design)

Precise lines, circles and arcs with AutoCAD-style snaps, exact input and grip editing.

## 1. Modes

A **Freehand | Geometric** switch in the toolbar.

| Mode | Tools |
| --- | --- |
| Freehand | Pen, Eraser (as in stage 1) |
| Geometric | Line, Circle, Arc, Select, Eraser, Snap (magnet), Angle lock |

Geometric shapes use the current color, size and opacity, drawn as crisp constant-width
lines (no pressure). Size is set in screen pixels at the zoom you draw at, like the pen.

## 2. Drawing with the Pencil

Each tool accepts points in two ways, detected automatically:

- **Drag** — press at the first point, drag, lift at the second (movement > 8 px while down).
- **Tap, tap** — tap each point, like clicking in AutoCAD. Pinch-zoom and pan are allowed
  between taps, so a shape can start and end at very different zoom levels.

A live preview follows the Pencil (or its hover position) between points.
Cancel the shape in progress with the **✕** chip that appears in the toolbar, or by switching tools.

### Tools

- **Line** — chains from the last endpoint, like AutoCAD `LINE`. Finish with **Done**,
  by tapping the last point again, or by tapping the start point (closes the shape).
  Each segment is its own line object.
- **Circle** — center, then a point on the circumference.
- **Arc** — two methods, switchable in the Arc tool's options (tap the tool again):
  - **3-point** (default): start, a point on the arc, end.
  - **Center, start, end**: center, start point (sets radius), end point (sets angle).
    Direction is counter-clockwise like AutoCAD; a **Flip** chip reverses it while drawing.

## 3. Exact input and units

- Each drawing has a **unit**: mm (default), cm, m, in or ft — changed in the menu under the drawing's settings.
- Internally 1 world unit = 1 mm, so changing the unit only changes how numbers are
  shown and typed (a 1500 mm line shows as 1.5 m). Nothing on the canvas moves.
- While drawing, a label near the Pencil shows **length and angle** (line), **radius** (circle)
  or **radius and sweep angle** (arc).
- **Tap the label** to type an exact value on a numeric keypad:
  - Line: length, then optionally the angle (otherwise the current direction is kept).
  - Circle: radius (or diameter with a ⌀ toggle).
  - Arc: radius and/or angle depending on the step.
- Angles are degrees, 0° pointing right, counter-clockwise positive (AutoCAD convention).
  On screen, y goes down, so angles are converted when shown.

## 4. Snaps

When the Pencil comes within **14 screen px** of a snap point, the point locks to it and the
marker plus a small name label appears. Priority when several are in range: the closest,
with ties broken in the order below.

| Snap | Marker | Applies to |
| --- | --- | --- |
| Endpoint | □ | line ends, arc ends, freehand stroke ends |
| Midpoint | △ | lines, arcs |
| Center | ○ | circles, arcs (also when hovering over the curve itself) |
| Quadrant | ◇ | circles, arcs (0°, 90°, 180°, 270° points that lie on the arc) |
| Intersection | ✕ | any pair of lines / circles / arcs |
| Perpendicular | ⊥ | from the previous point to a line / circle / arc |
| Tangent | ◯ with a line | from the previous point to a circle / arc |
| Nearest | ⧖ | closest point on any shape or freehand stroke (off by default) |

- **Magnet button**: tap toggles snapping on/off; tap again opens the snap settings
  (a checkbox per snap type, like AutoCAD's OSNAP dialog). Choices are remembered.
- **Angle lock (polar tracking)**: when the direction from the previous point is within 3°
  of a multiple of the increment (15° by default; 5°, 15°, 30°, 45°, 90° selectable), it locks
  to it and a dashed guide line appears. An object snap always wins over angle lock.
- **Pencil hover** (iPads that support it): markers appear before the tip touches the screen.
- Snapping only looks at shapes near the Pencil, so it stays fast in huge drawings.

## 5. Select tool and grips

- **Tap** a shape to select it; tap empty space to deselect. Shapes and freehand strokes can both be selected.
- A selected shape shows **grips** (small blue squares, like AutoCAD):
  - Line: both ends (move that end), midpoint (move the whole line).
  - Circle: center (move), four quadrants (change radius).
  - Arc: both ends, midpoint (change bulge/radius), center (move).
  - Freehand stroke: none for now; it can be moved and deleted.
- **Drag a grip** to edit, with snaps, angle lock and the length label (tap it for exact values).
- **Drag the shape itself** to move it (snaps apply to the grabbed point).
- A small bar above the selection: **Delete**, **Duplicate**.
- Every edit is one undo step.

## 6. Eraser on shapes

- **Whole strokes**: deletes any shape it touches.
- **Cut ink**: removes only the part under the eraser — a line becomes up to two lines,
  an arc up to two arcs, a circle becomes an arc.

## 7. Data model

New shape kinds next to `stroke` (all coordinates in world units = mm):

```ts
{ kind: 'line',   a: {x, y}, b: {x, y} }
{ kind: 'circle', c: {x, y}, r }
{ kind: 'arc',    c: {x, y}, r, start, sweep }   // radians; sweep > 0 = counter-clockwise
```

Each also has `id`, `z`, `color`, `width`, `opacity`. Drawings gain a `unit` field.
Old drawings and files keep working (missing `unit` means mm).

## 8. Implementation plan

1. Shape kinds, bounds, hit-testing, rendering, saving/loading; eraser support.
2. Mode switch and the Line / Circle / Arc tools with drag and tap-tap input, previews, Done/cancel.
3. Snap engine: candidate points per shape, intersections, perpendicular/tangent; markers; settings panel.
4. Angle lock with guide lines.
5. Length/angle label and numeric keypad; drawing unit setting.
6. Select tool: hit-testing, grips, move, delete, duplicate.
7. Tests for the geometry (intersections, tangents, arc from 3 points, cutting) and a browser run-through.
