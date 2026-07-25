# Multi-Point / Curved / Elbow Arrows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SlideEditor's single-drag 2-point Arrow tool with click-chain multi-point placement, three render styles (Sharp/Curved/Elbow) selectable per-arrow, and a draggable per-segment "bow" handle to insert bends after creation.

**Architecture:** `OverlayFabric.ts` gains pure SVG-path builders per arrow type plus a generalized `makeArrowGroup(points[], ..., arrowType)`; `SlideEditor.ts` replaces the Arrow tool's mousedown/mousemove/mouseup drag flow with a click-chain state machine and adds custom fabric `Control`s for bow handles; `SlideEditorUI.ts` adds a 3-button type selector to the properties panel.

**Tech Stack:** TypeScript, fabric.js 4.5 (CDN global `window.fabric`, never imported), Vite. No automated test framework exists in this repo.

## Global Constraints

- fabric.js is a CDN global — access only via `(window as any).fabric`, never `import`. (existing pattern, `OverlayFabric.ts:9`)
- No unit/integration test runner is configured in this project (confirmed via `package.json` — only `vite`/`tsc` scripts). Verification for every task is: (a) `tsc` scoped to touched files, and (b) a manual walkthrough on the dev server the user runs themselves (`npm run dev`) — never start the dev server yourself.
- Per standing user preference, do not run `git commit` as part of any step below — the user commits manually or asks explicitly. Each task ends with a plain checkpoint, not a commit step.
- `SlideOverlay.arrowType` is optional; absent = `'sharp'`. Every task must keep existing saved briefings (2-point arrows, no `arrowType`) rendering identically to today unless a task explicitly changes that arrow.
- Files touched, exclusively: `MS/Engines/Briefing/BriefingTypes.ts`, `MS/Engines/Briefing/OverlayFabric.ts`, `MS/Engines/Briefing/SlideEditor.ts`, `MS/Engines/Briefing/SlideEditorUI.ts`.

---

### Task 1: Data model — `arrowType` field

**Files:**
- Modify: `MS/Engines/Briefing/BriefingTypes.ts:73-84`

**Interfaces:**
- Produces: `SlideOverlay.arrowType?: 'sharp' | 'curved' | 'elbow'`

- [ ] **Step 1: Add the field and update the `points` doc comment**

Replace:
```ts
  /** line/arrow: [start, end]; freehand: sampled polyline. Normalized. */
  points?: Array<{ x: number; y: number }>;
```
with:
```ts
  /** line: [start, end]; arrow: 2+ points (bend points in between); freehand: sampled polyline. Normalized. */
  points?: Array<{ x: number; y: number }>;
```
and immediately after the `strokeDash` field (currently `strokeDash?: 'dashed' | 'dotted';`) add:
```ts
  /** arrow only. Absent = 'sharp' (today's straight 2-point look). */
  arrowType?: 'sharp' | 'curved' | 'elbow';
```

- [ ] **Step 2: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit MS/Engines/Briefing/BriefingTypes.ts` (per this repo's tsc-baseline note, `npx tsc` is a stub — use the binary directly)
Expected: no new errors referencing `BriefingTypes.ts`.

- [ ] **Checkpoint:** field exists, no compile errors. Do not commit.

---

### Task 2: Pure arrow path-builder functions (`OverlayFabric.ts`)

**Files:**
- Modify: `MS/Engines/Briefing/OverlayFabric.ts` (add new exports; nothing wired up to drawing yet)

**Interfaces:**
- Produces: `export type ArrowType = 'sharp' | 'curved' | 'elbow'`; `export function buildArrowPath(points: Array<{x,y}>, arrowType: ArrowType): { d: string; endAngleRad: number }`

- [ ] **Step 1: Add the builders**

Insert after the `dashProps` function (after line 77, before `export interface ShapeStyle`):
```ts
export type ArrowType = 'sharp' | 'curved' | 'elbow';

const ELBOW_FILLET_PX = 12;

function pathN(v: number): number {
  return Number(v.toFixed(2));
}

export function buildSharpArrowPath(
  points: Array<{ x: number; y: number }>,
): { d: string; endAngleRad: number } {
  if (points.length < 2) return { d: '', endAngleRad: 0 };
  let d = `M ${pathN(points[0].x)} ${pathN(points[0].y)}`;
  for (let i = 1; i < points.length; i++) d += ` L ${pathN(points[i].x)} ${pathN(points[i].y)}`;
  const p2 = points[points.length - 1];
  const p1 = points[points.length - 2];
  return { d, endAngleRad: Math.atan2(p2.y - p1.y, p2.x - p1.x) };
}

export function buildCurvedArrowPath(
  points: Array<{ x: number; y: number }>,
): { d: string; endAngleRad: number } {
  if (points.length < 2) return { d: '', endAngleRad: 0 };
  let d = `M ${pathN(points[0].x)} ${pathN(points[0].y)}`;
  let lastCp2 = points[0];
  let lastEnd = points[0];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? points[i + 1];
    const cp1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const cp2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C ${pathN(cp1.x)} ${pathN(cp1.y)} ${pathN(cp2.x)} ${pathN(cp2.y)} ${pathN(p2.x)} ${pathN(p2.y)}`;
    lastCp2 = cp2;
    lastEnd = p2;
  }
  return { d, endAngleRad: Math.atan2(lastEnd.y - lastCp2.y, lastEnd.x - lastCp2.x) };
}

export function buildElbowArrowPath(
  points: Array<{ x: number; y: number }>,
): { d: string; endAngleRad: number } {
  if (points.length < 2) return { d: '', endAngleRad: 0 };
  const ortho: Array<{ x: number; y: number }> = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (Math.abs(b.x - a.x) > 0.5 && Math.abs(b.y - a.y) > 0.5) {
      ortho.push({ x: b.x, y: a.y });
    }
    ortho.push(b);
  }
  let d = `M ${pathN(ortho[0].x)} ${pathN(ortho[0].y)}`;
  for (let i = 1; i < ortho.length - 1; i++) {
    const prev = ortho[i - 1];
    const cur = ortho[i];
    const next = ortho[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y) || 1;
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y) || 1;
    const r = Math.min(ELBOW_FILLET_PX, inLen / 2, outLen / 2);
    const inX = cur.x - ((cur.x - prev.x) / inLen) * r;
    const inY = cur.y - ((cur.y - prev.y) / inLen) * r;
    const outX = cur.x + ((next.x - cur.x) / outLen) * r;
    const outY = cur.y + ((next.y - cur.y) / outLen) * r;
    d += ` L ${pathN(inX)} ${pathN(inY)} Q ${pathN(cur.x)} ${pathN(cur.y)} ${pathN(outX)} ${pathN(outY)}`;
  }
  const last = ortho[ortho.length - 1];
  const secondLast = ortho[ortho.length - 2];
  d += ` L ${pathN(last.x)} ${pathN(last.y)}`;
  return { d, endAngleRad: Math.atan2(last.y - secondLast.y, last.x - secondLast.x) };
}

export function buildArrowPath(
  points: Array<{ x: number; y: number }>,
  arrowType: ArrowType,
): { d: string; endAngleRad: number } {
  if (arrowType === 'curved') return buildCurvedArrowPath(points);
  if (arrowType === 'elbow') return buildElbowArrowPath(points);
  return buildSharpArrowPath(points);
}

if (import.meta.env.DEV) {
  const sharp = buildSharpArrowPath([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  console.assert(sharp.d === 'M 0 0 L 10 0', `sharp path mismatch: ${sharp.d}`);
  console.assert(Math.abs(sharp.endAngleRad) < 1e-6, `sharp angle mismatch: ${sharp.endAngleRad}`);

  const curved = buildCurvedArrowPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }]);
  console.assert(curved.d.startsWith('M 0 0 C'), `curved path mismatch: ${curved.d}`);

  const elbow = buildElbowArrowPath([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
  console.assert(
    elbow.d === 'M 0 0 L 5 0 Q 10 0 10 5 L 10 10',
    `elbow path mismatch: ${elbow.d}`,
  );
}
```

- [ ] **Step 2: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit MS/Engines/Briefing/OverlayFabric.ts`
Expected: no new errors.

- [ ] **Step 3: Verify the smoke assertions in the browser**

Have the user run `npm run dev` (or confirm it's already running), open the Briefing editor on any slide (this loads `OverlayFabric.ts`), open the browser devtools console, and confirm there is **no** `Assertion failed` message. If one appears, the printed mismatch shows the actual `d` string — fix the builder before proceeding.

- [ ] **Step 4: Remove the smoke-test block**

Delete the `if (import.meta.env.DEV) { ... }` block added in Step 1 (the three builder functions and `buildArrowPath` stay).

- [ ] **Checkpoint:** three path builders + dispatcher exist and were verified once; smoke-test code removed. Do not commit.

---

### Task 3: Generalize `makeArrowGroup` / round-trip to N points + `arrowType`

**Files:**
- Modify: `MS/Engines/Briefing/OverlayFabric.ts:172-208` (`makeArrowGroup`), `:288-299` (`overlayToFabric` arrow case), `:395-422` (`fabricToOverlay` arrow branch)
- Modify: `MS/Engines/Briefing/SlideEditor.ts:723-737` (existing drag-arrow finalize — adapted minimally, still 2-point)

**Interfaces:**
- Consumes: `buildArrowPath`, `ArrowType` from Task 2
- Produces: `makeArrowGroup(points: Array<{x,y}>, stroke: string, strokeWidthPx: number, extra?: Record<string, any>, strokeDash?: 'dashed'|'dotted', arrowType?: ArrowType): any` (fabric.Group with `data.localPoints: Array<{x,y}>` of length N, `data.arrowType`)

- [ ] **Step 1: Replace `makeArrowGroup`**

Replace the whole existing function (`OverlayFabric.ts:172-208`) with:
```ts
export function makeArrowGroup(
  points: Array<{ x: number; y: number }>,
  stroke: string,
  strokeWidthPx: number,
  extra: Record<string, any> = {},
  strokeDash?: 'dashed' | 'dotted',
  arrowType: ArrowType = 'sharp',
): any {
  const fabric = (window as any).fabric;
  const { d, endAngleRad } = buildArrowPath(points, arrowType);
  const head = strokeWidthPx * 4 + 6;
  const angleDeg = (endAngleRad * 180) / Math.PI + 90;
  const last = points[points.length - 1];
  const path = new fabric.Path(d, {
    fill: '',
    stroke,
    strokeWidth: strokeWidthPx,
    ...dashProps(strokeDash, strokeWidthPx),
  });
  const tri = new fabric.Triangle({
    left: last.x,
    top: last.y,
    originX: 'center',
    originY: 'center',
    width: head,
    height: head,
    angle: angleDeg,
    fill: stroke,
  });
  const grp = new fabric.Group([path, tri], {
    ...extra,
    data: {
      id: extra?.data?.id ?? overlayUuid(),
      kind: 'arrow' as OverlayKind,
      strokeDash,
      arrowType,
    },
  });
  const c = grp.getCenterPoint();
  grp.data.localPoints = points.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
  return grp;
}
```

- [ ] **Step 2: Update `overlayToFabric`'s `'arrow'` case**

Replace (`OverlayFabric.ts:288-299`):
```ts
    case 'arrow': {
      const [p0, p1] = o.points ?? [];
      if (!p0 || !p1) return null;
      return makeArrowGroup(
        { x: p0.x * W, y: p0.y * H },
        { x: p1.x * W, y: p1.y * H },
        o.stroke ?? '#FF3B30',
        strokePx,
        common,
        o.strokeDash,
      );
    }
```
with:
```ts
    case 'arrow': {
      const pts = o.points ?? [];
      if (pts.length < 2) return null;
      return makeArrowGroup(
        pts.map((p) => ({ x: p.x * W, y: p.y * H })),
        o.stroke ?? '#FF3B30',
        strokePx,
        common,
        o.strokeDash,
        o.arrowType ?? 'sharp',
      );
    }
```

- [ ] **Step 3: Round-trip `arrowType` in `fabricToOverlay`**

In the `line | arrow | freehand | highlight` block, right after the existing line `if (obj.data.strokeDash) base.strokeDash = obj.data.strokeDash;` (`OverlayFabric.ts:422`), add:
```ts
  if (kind === 'arrow' && obj.data.arrowType && obj.data.arrowType !== 'sharp') {
    base.arrowType = obj.data.arrowType;
  }
```
(The existing `else if (kind === 'arrow') { const lp = obj.data.localPoints ?? []; pts = lp.map(...); strokeSrc = obj.getObjects?.()?.[0] ?? obj; }` branch already generalizes to any point-list length — no change needed there.)

- [ ] **Step 4: Adapt the still-drag-based Arrow tool call site**

In `SlideEditor.ts`, replace (`:723-737`):
```ts
    let finalObj: any = obj;
    if (t === 'arrow') {
      const p0 = { x: obj.x1, y: obj.y1 };
      const p1 = { x: obj.x2, y: obj.y2 };
      this._fc.remove(obj);
      const style = this._creationStyle();
      finalObj = makeArrowGroup(
        p0,
        p1,
        style.stroke,
        style.strokeWidth,
        { opacity: this._defaults.opacity },
        style.strokeDash,
      );
      this._fc.add(finalObj);
    } else if (SCALED_BOX_TOOLS.has(t)) {
```
with:
```ts
    let finalObj: any = obj;
    if (t === 'arrow') {
      const p0 = { x: obj.x1, y: obj.y1 };
      const p1 = { x: obj.x2, y: obj.y2 };
      this._fc.remove(obj);
      const style = this._creationStyle();
      finalObj = makeArrowGroup(
        [p0, p1],
        style.stroke,
        style.strokeWidth,
        { opacity: this._defaults.opacity },
        style.strokeDash,
      );
      this._fc.add(finalObj);
    } else if (SCALED_BOX_TOOLS.has(t)) {
```
(This is temporary scaffolding — Task 4 removes the whole drag flow for `t === 'arrow'` and this exact block goes away. It exists only so this task's regression check has something to exercise.)

- [ ] **Step 5: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit MS/Engines/Briefing/OverlayFabric.ts MS/Engines/Briefing/SlideEditor.ts`
Expected: no new errors.

- [ ] **Step 6: Manual regression check**

On the running dev server: open Briefing → edit a slide → select the Arrow tool (A) → drag out a 2-point arrow as before. Expected: identical look to before this task (straight line, triangle head). Save & close, reopen the slide editor: the arrow is still there, still straight. Open the slide in Present mode: arrow renders correctly.

- [ ] **Checkpoint:** N-point/`arrowType`-aware rendering plumbing in place; existing 2-point arrow behavior unchanged. Do not commit.

---

### Task 4: Click-chain multi-point drawing (replaces drag for the Arrow tool)

**Files:**
- Modify: `MS/Engines/Briefing/SlideEditor.ts` — imports, class fields, `_defaults`, `_onMouseDown`, `_onMouseMove`, `_onMouseUp`, `_setTool`, `_attachKeys`; new methods `_onArrowClick`, `_updateArrowPreview`, `_onArrowFinish`, `_clearArrowChain`
- Modify: `MS/Engines/Briefing/SlideEditorUI.ts` — `StyleDefaults` gains `arrowType`

**Interfaces:**
- Consumes: `buildArrowPath`, `makeArrowGroup`, `ArrowType` (Tasks 2-3)
- Produces: `SlideEditor._arrowChain`, `_onArrowFinish()`, `_clearArrowChain()` (both reused/extended by Tasks 5 & 7)

- [ ] **Step 1: `StyleDefaults` gains `arrowType`**

In `SlideEditorUI.ts`, add near the top:
```ts
import type { ArrowType } from './OverlayFabric';
```
In the `StyleDefaults` interface, add a field (anywhere, e.g. after `highlightWidthPx: number;`):
```ts
  /** Arrow tool only. */
  arrowType: ArrowType;
```

- [ ] **Step 2: Update `SlideEditor.ts` imports and fields**

Replace the `OverlayFabric` import block:
```ts
import {
  dashProps,
  fabricToOverlay,
  isBoxKind,
  makeArrowGroup,
  makeShapeObject,
  overlayToFabric,
  overlayUuid,
  parseColor,
  withAlpha,
} from './OverlayFabric';
```
with:
```ts
import {
  buildArrowPath,
  dashProps,
  fabricToOverlay,
  isBoxKind,
  makeArrowGroup,
  makeShapeObject,
  overlayToFabric,
  overlayUuid,
  parseColor,
  withAlpha,
  type ArrowType,
} from './OverlayFabric';
```
Add new private fields next to `_lassoPts`/`_erasing` (around line 107-109):
```ts
  private _arrowChain: Array<{ x: number; y: number }> | null = null;
  private _arrowPreview: any = null;
  private _arrowLastClickAt = 0;
```
Add `arrowType: 'sharp',` to the `_defaults` object literal (anywhere, e.g. after `highlightWidthPx: 20,`).

- [ ] **Step 3: Replace `_onMouseDown`**

Replace the whole method (`:537-640`) with:
```ts
  private _onMouseDown(opt: any): void {
    if (!this._fc) return;
    const t = this._tool;
    if (t === 'select' || t === 'freehand' || t === 'highlighter') return;
    const fabric = (window as any).fabric;
    const p = this._fc.getPointer(opt.e);
    const d = this._defaults;

    if (t === 'laser') {
      this._laser?.onDown(p.x, p.y);
      return;
    }
    if (t === 'eraser') {
      this._erasing = true;
      this._erasedAny = false;
      this._eraseAt(opt);
      return;
    }
    if (t === 'lasso') {
      this._lassoPts = [{ x: p.x, y: p.y }];
      return;
    }
    if (t === 'arrow') {
      this._onArrowClick(p);
      return;
    }

    if (t === 'text') {
      const tb = new fabric.Textbox('Text', {
        left: p.x,
        top: p.y,
        width: Math.min(240, this._W * 0.3),
        fontSize: d.fontSizePx,
        fontFamily: d.fontFamily,
        fontWeight: d.bold ? 'bold' : 'normal',
        fontStyle: d.italic ? 'italic' : 'normal',
        underline: d.underline,
        textAlign: d.align,
        fill: d.textColor,
        opacity: d.opacity,
        data: { id: overlayUuid(), kind: 'text' },
      });
      this._setTool('select');
      this._fc.add(tb);
      this._fc.setActiveObject(tb);
      tb.enterEditing();
      tb.selectAll();
      this._fc.requestRenderAll();
      return;
    }

    const style = this._creationStyle();
    const dash = dashProps(style.strokeDash, style.strokeWidth);
    let obj: any = null;
    if (t === 'rect' || t === 'triangle') {
      const Ctor = t === 'rect' ? fabric.Rect : fabric.Triangle;
      obj = new Ctor({
        left: p.x,
        top: p.y,
        width: 1,
        height: 1,
        fill: style.fill,
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        ...dash,
        strokeLineJoin: 'round',
        opacity: d.opacity,
        data: { id: overlayUuid(), kind: t, strokeDash: style.strokeDash },
      });
    } else if (t === 'ellipse') {
      obj = new fabric.Ellipse({
        left: p.x,
        top: p.y,
        rx: 1,
        ry: 1,
        fill: style.fill,
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        ...dash,
        opacity: d.opacity,
        data: { id: overlayUuid(), kind: 'ellipse', strokeDash: style.strokeDash },
      });
    } else if (SCALED_BOX_TOOLS.has(t)) {
      obj = makeShapeObject(
        t as 'diamond' | 'star' | 'callout',
        { left: p.x, top: p.y, width: SCALE_BASE, height: SCALE_BASE },
        style,
        { opacity: d.opacity },
      );
      obj.set({ scaleX: 0.02, scaleY: 0.02 });
    } else if (t === 'line') {
      obj = new fabric.Line([p.x, p.y, p.x, p.y], {
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        ...dash,
        opacity: d.opacity,
        data: { id: overlayUuid(), kind: 'line', strokeDash: style.strokeDash },
      });
    }
    if (obj) {
      obj.set({ selectable: false, evented: false });
      this._fc.add(obj);
      this._fc.discardActiveObject();
      this._drawing = { obj, startX: p.x, startY: p.y };
    }
  }
```

- [ ] **Step 4: Replace `_onMouseMove`**

Replace the whole method (`:642-690`) with:
```ts
  private _onMouseMove(opt: any): void {
    if (!this._fc) return;
    const t = this._tool;
    if (t === 'arrow') {
      if (this._arrowChain) this._updateArrowPreview(this._fc.getPointer(opt.e));
      return;
    }
    if (t === 'laser') {
      const p = this._fc.getPointer(opt.e);
      this._laser?.onMove(p.x, p.y);
      return;
    }
    if (t === 'eraser') {
      if (this._erasing) this._eraseAt(opt);
      return;
    }
    if (t === 'lasso') {
      if (this._lassoPts) {
        const p = this._fc.getPointer(opt.e);
        this._lassoPts.push({ x: p.x, y: p.y });
        this._drawLassoPreview();
      }
      return;
    }
    if (!this._drawing) return;
    const p = this._fc.getPointer(opt.e);
    const { obj, startX, startY } = this._drawing;
    if (t === 'rect' || t === 'triangle') {
      obj.set({
        left: Math.min(startX, p.x),
        top: Math.min(startY, p.y),
        width: Math.abs(p.x - startX),
        height: Math.abs(p.y - startY),
      });
    } else if (t === 'ellipse') {
      obj.set({
        left: Math.min(startX, p.x),
        top: Math.min(startY, p.y),
        rx: Math.abs(p.x - startX) / 2,
        ry: Math.abs(p.y - startY) / 2,
      });
    } else if (SCALED_BOX_TOOLS.has(t)) {
      obj.set({
        left: Math.min(startX, p.x),
        top: Math.min(startY, p.y),
        scaleX: Math.max(0.02, Math.abs(p.x - startX) / SCALE_BASE),
        scaleY: Math.max(0.02, Math.abs(p.y - startY) / SCALE_BASE),
      });
    } else {
      obj.set({ x2: p.x, y2: p.y });
    }
    this._fc.requestRenderAll();
  }
```

- [ ] **Step 5: Replace `_onMouseUp`**

Replace the whole method (`:692-766`) with:
```ts
  private _onMouseUp(opt: any): void {
    if (!this._fc) return;
    const t = this._tool;
    if (t === 'laser') {
      this._laser?.onUp();
      return;
    }
    if (t === 'eraser') {
      this._erasing = false;
      if (this._erasedAny) this._commit();
      this._erasedAny = false;
      return;
    }
    if (t === 'lasso') {
      this._finishLasso();
      return;
    }
    if (!this._drawing) return;
    const { obj, startX, startY } = this._drawing;
    this._drawing = null;

    const isLineKind = t === 'line';
    const degenerate = isLineKind
      ? Math.hypot((obj.x2 ?? 0) - (obj.x1 ?? 0), (obj.y2 ?? 0) - (obj.y1 ?? 0)) < 4
      : obj.getScaledWidth() < 4 && obj.getScaledHeight() < 4;
    if (degenerate) {
      this._fc.remove(obj);
      this._setTool('select');
      return;
    }

    let finalObj: any = obj;
    if (SCALED_BOX_TOOLS.has(t)) {
      const p = this._fc.getPointer(opt.e);
      this._fc.remove(obj);
      finalObj = makeShapeObject(
        t as 'diamond' | 'star' | 'callout',
        {
          left: Math.min(startX, p.x),
          top: Math.min(startY, p.y),
          width: Math.abs(p.x - startX),
          height: Math.abs(p.y - startY),
        },
        this._creationStyle(),
        { opacity: this._defaults.opacity },
      );
      this._fc.add(finalObj);
    } else {
      obj.set({ selectable: true, evented: true });
      obj.setCoords();
    }

    const wasCallout = t === 'callout';
    this._setTool('select');
    this._fc.setActiveObject(finalObj);
    this._fc.requestRenderAll();
    this._commit();
    if (wasCallout) this._addCalloutText(finalObj);
  }
```

- [ ] **Step 6: Add the click-chain methods**

Add these new private methods anywhere in the "Tools" section (e.g. right after `_onPathCreated`):
```ts
  private _onArrowClick(p: { x: number; y: number }): void {
    const now = Date.now();
    const isFinish =
      !!this._arrowChain &&
      now - this._arrowLastClickAt < 400 &&
      Math.hypot(
        p.x - this._arrowChain[this._arrowChain.length - 1].x,
        p.y - this._arrowChain[this._arrowChain.length - 1].y,
      ) < 6;
    this._arrowLastClickAt = now;
    if (isFinish) {
      this._onArrowFinish();
      return;
    }
    if (!this._arrowChain) this._arrowChain = [p];
    else this._arrowChain.push(p);
    this._updateArrowPreview(p);
  }

  private _updateArrowPreview(cursor: { x: number; y: number }): void {
    if (!this._fc || !this._arrowChain) return;
    const fabric = (window as any).fabric;
    const style = this._creationStyle();
    const pts = [...this._arrowChain, cursor];
    const { d } = buildArrowPath(pts, this._defaults.arrowType);
    if (this._arrowPreview) this._fc.remove(this._arrowPreview);
    this._arrowPreview = new fabric.Path(d, {
      fill: '',
      stroke: style.stroke,
      strokeWidth: style.strokeWidth,
      strokeDashArray: [6, 4],
      selectable: false,
      evented: false,
      opacity: 0.85,
    });
    this._fc.add(this._arrowPreview);
    this._fc.requestRenderAll();
  }

  private _onArrowFinish(): void {
    if (this._tool !== 'arrow' || !this._arrowChain) return;
    const pts = [...this._arrowChain];
    if (this._arrowPreview) {
      this._fc.remove(this._arrowPreview);
      this._arrowPreview = null;
    }
    this._arrowChain = null;
    if (pts.length >= 2) {
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 4) pts.pop();
    }
    if (pts.length < 2) {
      this._setTool('select');
      return;
    }
    const style = this._creationStyle();
    const finalObj = makeArrowGroup(
      pts,
      style.stroke,
      style.strokeWidth,
      { opacity: this._defaults.opacity },
      style.strokeDash,
      this._defaults.arrowType,
    );
    this._fc.add(finalObj);
    this._setTool('select');
    this._fc.setActiveObject(finalObj);
    this._fc.requestRenderAll();
    this._commit();
  }

  private _clearArrowChain(): void {
    if (this._arrowPreview) {
      this._fc?.remove(this._arrowPreview);
      this._arrowPreview = null;
    }
    this._arrowChain = null;
  }
```

- [ ] **Step 7: Clear an in-progress chain on tool switch, in `_setTool`**

At the top of `_setTool` (`:480-482`), replace:
```ts
  private _setTool(t: Tool): void {
    if (!this._fc) return;
    const prev = this._tool;
```
with:
```ts
  private _setTool(t: Tool): void {
    if (!this._fc) return;
    if (this._arrowChain && t !== 'arrow') {
      this._clearArrowChain();
    }
    const prev = this._tool;
```

- [ ] **Step 8: Escape-cancel and Enter-to-finish in `_attachKeys`**

In the Escape block (`:1252-1271`), replace:
```ts
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        if (editingText) {
          active.exitEditing();
          return;
        }
        if (this._tool !== 'select') {
```
with:
```ts
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        if (editingText) {
          active.exitEditing();
          return;
        }
        if (this._arrowChain) {
          this._clearArrowChain();
          this._fc?.requestRenderAll();
          this._setTool('select');
          return;
        }
        if (this._tool !== 'select') {
```
Immediately after `if (inInput || editingText) return;` (`:1274`), add:
```ts
      if (e.key === 'Enter' && this._arrowChain) {
        e.preventDefault();
        e.stopPropagation();
        this._onArrowFinish();
        return;
      }
```

- [ ] **Step 9: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit MS/Engines/Briefing/SlideEditor.ts MS/Engines/Briefing/SlideEditorUI.ts`
Expected: no new errors.

- [ ] **Step 10: Manual verification**

On the dev server: Arrow tool (A) → click 4 distinct points on the canvas (not a drag) → double-click to finish. Expected: a straight-segment (Sharp) multi-bend arrow with a triangle head at the last point, dashed preview visible while placing. Try again and press Escape mid-placement: the in-progress arrow disappears, tool reverts to Select. Try again and press Enter instead of double-clicking: same result as double-click. Save & reload the slide: the multi-point arrow persists correctly.

- [ ] **Checkpoint:** Arrow tool now places multi-point Sharp arrows via click-chain; Escape/Enter/double-click all work. Do not commit.

---

### Task 5: Bow-handle — drag a segment midpoint to insert a bend

**Files:**
- Modify: `MS/Engines/Briefing/SlideEditor.ts` — `_initCanvas` overlay-load loop, `_onArrowFinish`; new methods `_attachArrowControls`, `_insertArrowBend`, `_rebuildArrow`

**Interfaces:**
- Consumes: `_arrowChain`/`_onArrowFinish` (Task 4), `makeArrowGroup` (Task 3)
- Produces: `_attachArrowControls(grp)`, `_rebuildArrow(obj, absPoints): any` (reused by Task 6)

- [ ] **Step 1: Add the three new methods**

Add anywhere in the class (e.g. after `_onArrowFinish`):
```ts
  private _attachArrowControls(grp: any): void {
    const fabric = (window as any).fabric;
    const pts: Array<{ x: number; y: number }> = grp.data?.localPoints ?? [];
    const controls: Record<string, any> = { ...fabric.Object.prototype.controls };
    for (let i = 0; i < pts.length - 1; i++) {
      controls[`bow${i}`] = new fabric.Control({
        x: 0,
        y: 0,
        cursorStyle: 'crosshair',
        positionHandler: (_dim: any, finalMatrix: number[], obj: any) => {
          const lp: Array<{ x: number; y: number }> = obj.data?.localPoints ?? [];
          const a = lp[i];
          const b = lp[i + 1];
          if (!a || !b) return new fabric.Point(0, 0);
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          return fabric.util.transformPoint(new fabric.Point(mid.x, mid.y), finalMatrix);
        },
        actionHandler: (_eventData: any, transform: any, x: number, y: number) => {
          this._insertArrowBend(transform.target, i, x, y);
          return true;
        },
        actionName: 'insertArrowBend',
        render: (ctx: CanvasRenderingContext2D, left: number, top: number) => {
          ctx.save();
          ctx.fillStyle = '#2d6cdf';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(left, top, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        },
      });
    }
    grp.controls = controls;
    grp.setCoords();
  }

  private _insertArrowBend(obj: any, segmentIndex: number, canvasX: number, canvasY: number): void {
    if (!obj || obj.data?.kind !== 'arrow') return;
    const fabric = (window as any).fabric;
    const lp: Array<{ x: number; y: number }> = obj.data?.localPoints ?? [];
    if (segmentIndex < 0 || segmentIndex + 1 >= lp.length) return;
    const m = obj.calcTransformMatrix();
    const absPoints = lp.map((p) => {
      const abs = fabric.util.transformPoint(new fabric.Point(p.x, p.y), m);
      return { x: abs.x, y: abs.y };
    });
    absPoints.splice(segmentIndex + 1, 0, { x: canvasX, y: canvasY });
    const rebuilt = this._rebuildArrow(obj, absPoints);
    this._fc.setActiveObject(rebuilt);
    this._fc.requestRenderAll();
  }

  private _rebuildArrow(obj: any, absPoints: Array<{ x: number; y: number }>): any {
    const arrowType: ArrowType = obj.data?.arrowType ?? 'sharp';
    const pathChild = obj.getObjects()[0];
    this._fc.remove(obj);
    const rebuilt = makeArrowGroup(
      absPoints,
      pathChild.stroke,
      pathChild.strokeWidth,
      { opacity: obj.opacity, data: { id: obj.data.id } },
      obj.data.strokeDash,
      arrowType,
    );
    this._attachArrowControls(rebuilt);
    this._fc.add(rebuilt);
    this._commit();
    return rebuilt;
  }
```

- [ ] **Step 2: Attach controls to arrows loaded from a saved slide**

In `_initCanvas` (`:446-450`), replace:
```ts
    for (const o of slide.overlays ?? []) {
      const obj = overlayToFabric(o, this._W, this._H);
      if (obj) this._fc.add(obj);
      else EngineLogger.error(ENGINE_NAME, `Skipped invalid overlay entry (${o?.kind ?? '?'})`);
    }
```
with:
```ts
    for (const o of slide.overlays ?? []) {
      const obj = overlayToFabric(o, this._W, this._H);
      if (obj) {
        if (obj.data?.kind === 'arrow') this._attachArrowControls(obj);
        this._fc.add(obj);
      } else {
        EngineLogger.error(ENGINE_NAME, `Skipped invalid overlay entry (${o?.kind ?? '?'})`);
      }
    }
```

- [ ] **Step 3: Attach controls to freshly-drawn arrows**

In `_onArrowFinish`, add one line before `this._fc.add(finalObj);`:
```ts
    this._attachArrowControls(finalObj);
    this._fc.add(finalObj);
```

- [ ] **Step 4: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit MS/Engines/Briefing/SlideEditor.ts`
Expected: no new errors.

- [ ] **Step 5: Manual verification**

Draw a 3-point Sharp arrow. Switch to the Select tool, click the arrow. Expected: two small blue circular handles appear at each segment's midpoint (alongside the normal resize/rotate handles). Drag one sideways. Expected: a new bend point appears at the drag location; the arrow now has one more segment and its own new bow handle on each side of the inserted point. Save & reload the slide: the extra bend persists.

- [ ] **Checkpoint:** per-segment bow handles insert bends on Sharp arrows drawn via click-chain and on arrows loaded from a saved slide. Do not commit.

---

### Task 6: Arrow-type selector panel (Sharp / Curved / Elbow)

**Files:**
- Modify: `MS/Engines/Briefing/SlideEditorUI.ts` — `StyleProp`, `PanelContext['kind']`, `SECTIONS_BY_CONTEXT`, `ICONS`, `build()` template, `_wirePanel()`, `refreshPanelValues()`
- Modify: `MS/Engines/Briefing/SlideEditor.ts` — `_panelContextFor()`, `_syncControlsFromSelection()`, `_onStyleChanged()`; new method `_applyArrowTypeChange`

**Interfaces:**
- Consumes: `_rebuildArrow` (Task 5)

- [ ] **Step 1: `StyleProp` and `PanelContext['kind']`**

In `SlideEditorUI.ts`, add `| 'arrowType'` to the `StyleProp` union, and add `'arrow'` to the `PanelContext['kind']` union (`kind: 'none' | 'text' | 'box' | 'linework' | 'highlight' | 'mixed'` → add `| 'arrow'`).

- [ ] **Step 2: `SECTIONS_BY_CONTEXT`**

Add an entry:
```ts
  arrow: ['stroke', 'width', 'dash', 'arrowtype', 'opacity'],
```

- [ ] **Step 3: Icons**

Add to `ICONS`:
```ts
  arrowSharp: svg('<path d="M4.5 19.5L18.5 5.5M18.5 5.5h-6.2M18.5 5.5v6.2"/>'),
  arrowCurved: svg('<path d="M4.5 19.5C4.5 10 9 5 18.5 5.5M18.5 5.5h-6.2M18.5 5.5v6.2"/>'),
  arrowElbow: svg('<path d="M4.5 19.5V9.5h14V5.5M18.5 5.5h-6.2M18.5 5.5v6.2"/>'),
```

- [ ] **Step 4: Panel section markup**

In `build()`'s template string, add a new section right after the `data-sec="dash"` section (before `data-sec="text"`):
```html
          <div class="ms-sledit-sec" data-sec="arrowtype">
            <div class="ms-sledit-seclabel">Arrow type</div>
            <div class="ms-sledit-row">
              <button data-arrowtype="sharp" title="Sharp">${ICONS.arrowSharp}</button>
              <button data-arrowtype="curved" title="Curved">${ICONS.arrowCurved}</button>
              <button data-arrowtype="elbow" title="Elbow">${ICONS.arrowElbow}</button>
            </div>
          </div>
```

- [ ] **Step 5: Wire the click handler**

In `_wirePanel()`, extend the selector passed to `closest(...)` from:
```ts
      const el = (e.target as HTMLElement).closest(
        '[data-color],[data-width],[data-dash],[data-style],[data-align],[data-act]',
      ) as HTMLElement | null;
```
to:
```ts
      const el = (e.target as HTMLElement).closest(
        '[data-color],[data-width],[data-dash],[data-arrowtype],[data-style],[data-align],[data-act]',
      ) as HTMLElement | null;
```
and add a branch (e.g. right after the `else if (el.dataset.dash) { ... }` branch):
```ts
      } else if (el.dataset.arrowtype) {
        d().arrowType = el.dataset.arrowtype as StyleDefaults['arrowType'];
        this._host.onStyleChanged('arrowType');
```

- [ ] **Step 6: Reflect current value in `refreshPanelValues()`**

Add, anywhere in the method body:
```ts
    panel.querySelectorAll('[data-arrowtype]').forEach((el: any) => {
      el.classList.toggle('active', el.dataset.arrowtype === d.arrowType);
    });
```

- [ ] **Step 7: `_panelContextFor()` in `SlideEditor.ts`**

Replace the whole method (`:1162-1187`) with:
```ts
  private _panelContextFor(): PanelContext {
    const objs: any[] = this._fc?.getActiveObjects?.() ?? [];
    if (objs.length) {
      const kinds = new Set(objs.map((o) => o?.data?.kind).filter(Boolean));
      let kind: PanelContext['kind'] = 'mixed';
      if (kinds.size === 1) {
        const k = [...kinds][0] as string;
        kind =
          k === 'text'
            ? 'text'
            : isBoxKind(k)
              ? 'box'
              : k === 'highlight'
                ? 'highlight'
                : k === 'arrow'
                  ? 'arrow'
                  : 'linework';
      }
      return { kind, hasSelection: true };
    }
    if (BOX_TOOLS.has(this._tool)) return { kind: 'box', hasSelection: false };
    switch (this._tool) {
      case 'text':
        return { kind: 'text', hasSelection: false };
      case 'arrow':
        return { kind: 'arrow', hasSelection: false };
      case 'line':
      case 'freehand':
        return { kind: 'linework', hasSelection: false };
      case 'highlighter':
        return { kind: 'highlight', hasSelection: false };
      default:
        return { kind: 'none', hasSelection: false };
    }
  }
```

- [ ] **Step 8: Read `arrowType` back on selection, in `_syncControlsFromSelection()`**

Right after the existing line `d.strokeDash = obj.data.strokeDash ?? 'solid';` (inside the non-text `else` branch, `:1231`), add:
```ts
      if (kind === 'arrow') d.arrowType = (obj.data.arrowType ?? 'sharp') as ArrowType;
```

- [ ] **Step 9: Special-case `arrowType` in `_onStyleChanged`, add `_applyArrowTypeChange`**

Replace `_onStyleChanged` (`:1067-1075`) with:
```ts
  private _onStyleChanged(prop: StyleProp): void {
    const objs: any[] = this._fc?.getActiveObjects?.() ?? [];
    if (prop === 'arrowType') {
      const rebuilt = objs
        .filter((o) => o?.data?.kind === 'arrow')
        .map((o) => this._applyArrowTypeChange(o));
      if (rebuilt.length > 1) {
        const fabric = (window as any).fabric;
        this._fc.setActiveObject(new fabric.ActiveSelection(rebuilt, { canvas: this._fc }));
        this._fc.requestRenderAll();
      } else if (rebuilt.length === 1) {
        this._fc.setActiveObject(rebuilt[0]);
      }
      if (this._fc?.isDrawingMode) this._configureBrush();
      return;
    }
    for (const obj of objs) this._applyStyleTo(obj, prop);
    if (objs.length) {
      this._fc.requestRenderAll();
      this._commitDebounced();
    }
    if (this._fc?.isDrawingMode) this._configureBrush();
  }

  private _applyArrowTypeChange(obj: any): any {
    const fabric = (window as any).fabric;
    const lp: Array<{ x: number; y: number }> = obj.data?.localPoints ?? [];
    const m = obj.calcTransformMatrix();
    const absPoints = lp.map((p) => {
      const abs = fabric.util.transformPoint(new fabric.Point(p.x, p.y), m);
      return { x: abs.x, y: abs.y };
    });
    obj.data.arrowType = this._defaults.arrowType;
    return this._rebuildArrow(obj, absPoints);
  }
```

- [ ] **Step 10: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit MS/Engines/Briefing/SlideEditor.ts MS/Engines/Briefing/SlideEditorUI.ts`
Expected: no new errors.

- [ ] **Step 11: Manual verification**

Draw a multi-point arrow (Sharp by default). Select it; the properties panel now shows a "Arrow type" row with 3 buttons, Sharp highlighted. Click Curved: the arrow re-renders as a smooth curve through the same points, still selected, bow handles still present. Click Elbow: re-renders as an orthogonal connector with rounded corners. Draw a brand-new arrow while Elbow is active: it comes out elbowed immediately. Save & reload: the chosen type persists.

- [ ] **Checkpoint:** Sharp/Curved/Elbow selectable per-arrow via the panel; new arrows honor the last-chosen type. Do not commit.

---

### Task 7: Reopen an existing arrow to append more points

**Files:**
- Modify: `MS/Engines/Briefing/SlideEditor.ts` — `_setTool`, `_onArrowFinish`, `_clearArrowChain`; new field `_arrowReopenedObj`; new method `_onArrowReopen`

**Interfaces:**
- Consumes: `_arrowChain`/`_updateArrowPreview` (Task 4), `parseColor` (existing import)

- [ ] **Step 1: New field**

Add next to `_arrowChain` (from Task 4):
```ts
  private _arrowReopenedObj: any = null;
```

- [ ] **Step 2: `_onArrowReopen`**

Add as a new method:
```ts
  private _onArrowReopen(obj: any): void {
    const fabric = (window as any).fabric;
    const lp: Array<{ x: number; y: number }> = obj.data?.localPoints ?? [];
    if (lp.length < 2) return;
    const m = obj.calcTransformMatrix();
    const pts = lp.map((p) => {
      const abs = fabric.util.transformPoint(new fabric.Point(p.x, p.y), m);
      return { x: abs.x, y: abs.y };
    });
    const pathChild = obj.getObjects()[0];
    const d = this._defaults;
    d.stroke = parseColor(pathChild?.stroke)?.hex ?? d.stroke;
    d.strokeWidthPx = Math.max(1, Math.round(pathChild?.strokeWidth ?? d.strokeWidthPx));
    d.strokeDash = (obj.data?.strokeDash ?? 'solid') as StyleDefaults['strokeDash'];
    d.opacity = obj.opacity ?? 1;
    d.arrowType = (obj.data?.arrowType ?? 'sharp') as ArrowType;
    this._fc.discardActiveObject();
    this._fc.remove(obj);
    this._arrowReopenedObj = obj;
    this._arrowChain = pts;
    this._arrowLastClickAt = 0;
    this._updateArrowPreview(pts[pts.length - 1]);
    this._ui?.refreshPanelValues();
  }
```

- [ ] **Step 3: Trigger reopen from `_setTool`**

In `_setTool`, right after the existing `if (t === 'laser' && !this._laser) { this._laser = new LaserTrail(this._fc); }` line, add:
```ts
    if (t === 'arrow' && prev !== 'arrow') {
      const active = this._fc.getActiveObject();
      if (active?.data?.kind === 'arrow') this._onArrowReopen(active);
    }
```

- [ ] **Step 4: Restore-on-cancel in `_clearArrowChain`**

Replace the method (from Task 4) with:
```ts
  private _clearArrowChain(): void {
    if (this._arrowPreview) {
      this._fc?.remove(this._arrowPreview);
      this._arrowPreview = null;
    }
    if (this._arrowReopenedObj) {
      this._fc?.add(this._arrowReopenedObj);
      this._fc?.setActiveObject(this._arrowReopenedObj);
      this._arrowReopenedObj = null;
    }
    this._arrowChain = null;
  }
```

- [ ] **Step 5: Preserve identity and restore-on-degenerate in `_onArrowFinish`**

Replace the method (from Tasks 4/5) with:
```ts
  private _onArrowFinish(): void {
    if (this._tool !== 'arrow' || !this._arrowChain) return;
    const pts = [...this._arrowChain];
    const reopened = this._arrowReopenedObj;
    if (this._arrowPreview) {
      this._fc.remove(this._arrowPreview);
      this._arrowPreview = null;
    }
    this._arrowChain = null;
    this._arrowReopenedObj = null;
    if (pts.length >= 2) {
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 4) pts.pop();
    }
    if (pts.length < 2) {
      if (reopened) {
        this._fc.add(reopened);
        this._fc.setActiveObject(reopened);
      }
      this._setTool('select');
      return;
    }
    const style = this._creationStyle();
    const finalObj = makeArrowGroup(
      pts,
      style.stroke,
      style.strokeWidth,
      { opacity: this._defaults.opacity, data: reopened ? { id: reopened.data.id } : undefined },
      style.strokeDash,
      this._defaults.arrowType,
    );
    this._attachArrowControls(finalObj);
    this._fc.add(finalObj);
    this._setTool('select');
    this._fc.setActiveObject(finalObj);
    this._fc.requestRenderAll();
    this._commit();
  }
```

- [ ] **Step 6: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit MS/Engines/Briefing/SlideEditor.ts`
Expected: no new errors.

- [ ] **Step 7: Manual verification**

Draw a 2-point Elbow arrow. Select it (Select tool), then press the Arrow tool shortcut (A): the arrow disappears from the canvas and a live dashed preview follows the cursor from its last point. Click once to add a bend, double-click to finish. Expected: the arrow now has 3 points and the extra elbow segment, same id (drag it — the bow handles from Task 5 are present on the new segments too). Repeat but press Escape after re-arming instead of finishing: the original 2-point arrow reappears unchanged and is reselected.

- [ ] **Checkpoint:** existing arrows can be extended by re-arming the Arrow tool while selected; Escape restores the original on cancel. Do not commit.

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1), Sharp/Curved/Elbow rendering (Tasks 2-3), click-chain placement + Escape/Enter/double-click (Task 4), bow handles (Task 5), panel type selector (Task 6), reopen-to-append (Task 7). "Out of scope" items from the spec (binding, full A* elbow routing, arrowhead style picker, point deletion) are intentionally not tasked.
- **Type consistency checked:** `makeArrowGroup(points, stroke, strokeWidthPx, extra, strokeDash, arrowType)` signature is identical across Tasks 3, 5, 6, 7 call sites; `ArrowType` imported consistently in `SlideEditor.ts` and `SlideEditorUI.ts`; `_rebuildArrow`/`_attachArrowControls` signatures match between their Task 5 definition and Task 6/7 call sites.
- **No placeholders:** every step shows complete code.
