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

