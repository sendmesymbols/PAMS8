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

