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
