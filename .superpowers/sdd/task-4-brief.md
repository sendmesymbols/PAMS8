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

