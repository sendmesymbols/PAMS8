# Final Review Fix Report — Multi-point/Curved/Elbow Arrows (SlideEditor)

Date: 2026-07-25
Files touched:
- `D:\Projects\PAMS8\MS\Engines\Briefing\SlideEditor.ts`
- `D:\Projects\PAMS8\MS\Engines\Briefing\SlideEditorUI.ts`

All 7 findings from the final whole-branch code review are fixed in this pass. No other code in either file was touched.

---

## Fix 1 (Critical) — reopen/bend state leaks across editor close/reload

**`close()`** — `D:\Projects\PAMS8\MS\Engines\Briefing\SlideEditor.ts:308-317`

```ts
    this._index = -1;
    this._drawing = null;
    this._lassoPts = null;
    this._erasing = false;
    this._arrowChain = null;
    this._arrowPreview = null;
    this._arrowReopenedObj = null;
    this._bendDrag = null;
    this._bendPreview = null;
    this._undo = [];
    this._redo = [];
    this._tool = 'select';
```

**`_loadSlide()`** — `D:\Projects\PAMS8\MS\Engines\Briefing\SlideEditor.ts:235-244`

```ts
      this._fc = null;
      this._laser = null;
      this._drawing = null;
      this._lassoPts = null;
      this._erasing = false;
      this._arrowChain = null;
      this._arrowPreview = null;
      this._arrowReopenedObj = null;
      this._bendDrag = null;
      this._bendPreview = null;
      // _fc is about to be null for the whole await below ...
```

Both are plain field resets (no `_clearArrowChain()` call), exactly as prescribed — the canvas is already disposed/nulled at these points so there's nothing to visually restore first.

## Fix 2 (Critical) — undo/redo during a reopen resurrects the arrow

**`_restore()`** — `D:\Projects\PAMS8\MS\Engines\Briefing\SlideEditor.ts:1386-1401`

```ts
    if (this._bendDrag) {
      if (this._bendPreview) {
        this._fc.remove(this._bendPreview);
        this._bendPreview = null;
      }
      this._bendDrag = null;
    }
    if (this._arrowChain) {
      if (this._arrowPreview) {
        this._fc.remove(this._arrowPreview);
        this._arrowPreview = null;
      }
      this._arrowChain = null;
      this._arrowReopenedObj = null;
    }
    this._fc.discardActiveObject();
    (this._fc.getObjects() as any[]).slice().forEach((o) => this._fc.remove(o));
```

Note this deliberately does NOT call `_clearArrowChain()` — the undo/redo snapshot about to be rebuilt is authoritative, so `_arrowReopenedObj` is discarded (nulled), not resurrected onto the canvas.

## Fix 3 (Important) — rebuilding a scaled arrow shrinks its stroke/arrowhead

**`_rebuildArrow()`** — `D:\Projects\PAMS8\MS\Engines\Briefing\SlideEditor.ts:1122-1139`

```ts
  /** Replaces an arrow group with a freshly-built one from an absolute-coordinate point list, preserving style/id. */
  private _rebuildArrow(obj: any, absPoints: Array<{ x: number; y: number }>): any {
    const arrowType: ArrowType = obj.data?.arrowType ?? 'sharp';
    const pathChild = obj.getObjects()[0];
    const avgScale = ((obj.scaleX ?? 1) + (obj.scaleY ?? 1)) / 2;
    const idx = this._fc.getObjects().indexOf(obj);
    this._fc.remove(obj);
    const rebuilt = makeArrowGroup(
      absPoints,
      pathChild.stroke,
      pathChild.strokeWidth * avgScale,
      { opacity: obj.opacity, data: { id: obj.data.id } },
      obj.data.strokeDash,
      arrowType,
    );
    this._attachArrowControls(rebuilt);
    this._fc.add(rebuilt);
    if (idx >= 0) this._fc.moveTo(rebuilt, idx);
    this._commit();
    return rebuilt;
  }
```

**`_onArrowReopen()`** — `D:\Projects\PAMS8\MS\Engines\Briefing\SlideEditor.ts:990-994`

```ts
    const pathChild = obj.getObjects()[0];
    const avgScale = ((obj.scaleX ?? 1) + (obj.scaleY ?? 1)) / 2;
    const d = this._defaults;
    d.stroke = parseColor(pathChild?.stroke)?.hex ?? d.stroke;
    d.strokeWidthPx = Math.max(1, Math.round((pathChild?.strokeWidth ?? d.strokeWidthPx) * avgScale));
```

Both now multiply the local (unscaled) `strokeWidth` by the group's `avgScale`, mirroring `OverlayFabric.ts`'s `fabricToOverlay` convention (`(strokeSrc.strokeWidth ?? 2) * avgScale / H`).

## Fix 4 (Important) — z-order preservation

Folded into the Fix 3 edit above: `idx = this._fc.getObjects().indexOf(obj)` is captured before `remove(obj)`, and `if (idx >= 0) this._fc.moveTo(rebuilt, idx);` reinserts the rebuilt group at its original stacking position instead of leaving it appended (and thus bumped to front) after `add()`.

## Fix 5 (Important) — elbow arrows should not get bow handles

**`_attachArrowControls()`** — `D:\Projects\PAMS8\MS\Engines\Briefing\SlideEditor.ts:1024-1025`

```ts
  private _attachArrowControls(grp: any): void {
    if (grp.data?.arrowType === 'elbow') return;
    const fabric = (window as any).fabric;
```

Single added line; rest of the method (Sharp/Curved path) untouched.

## Fix 6 (Minor) — stale tool tooltip

**`SlideEditorUI.ts:114`**

```ts
  { tool: 'arrow', letter: 'a', num: '5', title: 'Arrow — click points, double-click or Enter to finish' },
```

## Fix 7 (Minor) — stale doc-comment plan-artifact

**`SlideEditor.ts:1122`** (doc comment immediately above `_rebuildArrow`) — the trailing "Reused by Task 6." was dropped; see Fix 3 code block above for the current text.

---

## tsc Verification

Command run from repo root:

```
node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit 2>&1
```

Result: exit code 2 (pre-existing baseline behavior — project has known errors elsewhere), **954** total `error TS` lines — matches the documented pre-existing baseline exactly. Filtering the output for `SlideEditor` (covers both `SlideEditor.ts` and `SlideEditorUI.ts`) returns **zero matches** — no errors in either touched file, and no new errors were introduced anywhere else (count unchanged: 954 → 954).

```
grep -c "error TS" tsc_out.txt        → 954
grep "SlideEditor" tsc_out.txt        → (no matches)
```

## Manual Traces

### Fix 1 / Fix 2 — teardown completeness

Grepped the whole file for every assignment of the five fields to null (`_arrowChain`, `_arrowPreview`, `_arrowReopenedObj`, `_bendDrag`, `_bendPreview`). Confirmed exactly three "full" teardown sites now null all five:

1. `_loadSlide()` — lines 240-244 (new)
2. `close()` — lines 313-317 (new)
3. `_restore()` — lines 1396-1399 (new, plus pre-existing `_bendDrag`/`_bendPreview` reset at 1389-1391)

Other sites that touch a subset are intentional, narrower operations, not teardown paths:
- `_deleteSelection()` (lines ~399-401) — only resets `_bendDrag`/`_bendPreview` because deleting the active selection can only be interrupted mid-bend-drag, not mid-arrow-chain (the arrow tool owns its own gesture and isn't a "selection").
- `_clearArrowChain()` (~lines 1147-1157) and `_finalizeArrowBend()` (~1096-1099) are the normal (non-teardown) per-gesture cleanup already reviewed/approved in earlier tasks.

No 4th teardown path exists that still misses these fields.

**Repro trace (Fix 1):** Select an arrow → press `A` (reopen) → `_onArrowReopen` sets `_arrowReopenedObj = obj`, `_arrowChain = pts`, removes `obj` from canvas. Click top-bar Cancel → `_onAction('cancel')` → `close(false)` → `save` is false so `_saveCurrent()` is skipped (as documented) → new code nulls `_arrowChain`/`_arrowReopenedObj`/`_bendDrag`/`_bendPreview` before `_stage`/`_fc` are torn down. Reopening the editor later calls `_buildStage` → `_loadSlide` → `_setTool('select')`; since `_arrowChain` is now `null` (not truthy), the `if (this._arrowChain && t !== 'arrow') this._clearArrowChain();` guard in `_setTool` does not fire, so no stale `_arrowReopenedObj` is re-added. Ghost duplicate eliminated.

**Repro trace (Fix 2):** Reopen an arrow (as above, `_arrowChain`/`_arrowReopenedObj` set, object removed from canvas but the last committed undo snapshot in `this._undo` still contains it). Press Ctrl+Z → `_undoRedo(false)` → `_restore(prevJson)`. New code now sees `this._arrowChain` truthy, removes any live `_arrowPreview`, and nulls `_arrowChain`/`_arrowReopenedObj` (WITHOUT calling `_clearArrowChain()`, so the reopened object is not re-added) before the canvas is cleared and rebuilt from `overlays` (which is the undo snapshot — already containing the original arrow once). Net result: exactly one copy of the arrow on canvas, tool state clean, no duplicate id and no defeated undo.

### Fix 3 / Fix 4 — scale-aware rebuild + z-order

Hand example: arrow group `obj` with `scaleX = 2`, `scaleY = 2`, `pathChild.strokeWidth = 3`, sitting at canvas index 1 of 3 objects (`[bg-decoration, ARROW, other-shape]`, `getObjects()` returns `[A, ARROW, B]` so `idx = 1`).

- `avgScale = (2 + 2) / 2 = 2`
- `this._fc.remove(obj)` → canvas objects now `[A, B]`
- `makeArrowGroup(..., pathChild.strokeWidth * avgScale, ...)` → `3 * 2 = 6` passed as the new (scale-1) group's stroke width — visually this matches the old scaled appearance (`3 * scaleY(2) = 6` was the old rendered width), and since the rebuilt group is unscaled (`scaleX = scaleY = 1`), baking `6` directly into its local `strokeWidth` reproduces the same rendered thickness. Arrowhead size (derived from stroke width inside `makeArrowGroup`/`buildArrowPath`) scales correspondingly.
- `this._fc.add(rebuilt)` → objects `[A, B, rebuilt]`
- `if (idx >= 0) this._fc.moveTo(rebuilt, idx)` → `idx = 1` → objects become `[A, rebuilt, B]`, restoring the original stacking position exactly.

`_onArrowReopen`'s parallel fix: same `avgScale` computed from the object about to be reopened, applied to the `strokeWidthPx` default seeded into the style panel, so the panel doesn't show/apply a shrunk width when editing resumes on a previously-scaled arrow.

### Fix 5 — elbow arrows excluded from bow handles

`_attachArrowControls(grp)`: first line `if (grp.data?.arrowType === 'elbow') return;` — for an elbow group this returns before `controls` is ever built or assigned, so `grp.controls` stays whatever fabric.Object's prototype default is (move/scale/rotate only, no custom `bow{i}` handles). For `sharp`/`curved` arrow types the condition is false, execution falls through unchanged to the existing loop that builds one `bow{i}` control per segment — behavior for those two types is untouched, confirmed by inspecting the unmodified remainder of the method (lines 1026-1060) which is identical to before.

### Fix 6 / Fix 7 — cosmetic

Both are literal string replacements confirmed by reading the file back; no runtime behavior change, so no trace beyond the tsc pass is applicable.

---

## Self-Review Findings / Concerns

- All five state fields (`_arrowChain`, `_arrowPreview`, `_arrowReopenedObj`, `_bendDrag`, `_bendPreview`) are now consistently nulled across all three teardown/rebuild paths (`close`, `_loadSlide`, `_restore`). Verified via grep there is no other place in the file that constructs a new `_fc`/tears down the stage without going through one of these three paths.
- `_fc.moveTo` is a standard fabric.js Canvas method (same API family as `bringToFront`/`sendToBack` already used elsewhere in this file's `_layerAction`), so no new third-party API surface was introduced.
- Confirmed `avgScale` computation is defensive against `undefined` scale fields via `?? 1`, matching the style already used in the rest of the file (e.g., `obj.opacity ?? 1` patterns nearby).
- No changes made outside the 7 listed fixes; diff is scoped to exactly the lines specified in the task brief (plus the two doc-comment/tooltip string edits).
- tsc confirms zero new errors; total error count unchanged at 954, and no errors attributed to either touched file.
- No git commands were run; all edits are uncommitted in the working tree as instructed.
