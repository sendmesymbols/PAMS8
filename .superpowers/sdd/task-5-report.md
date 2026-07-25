# Task 5 Report — Bow-handle: drag a segment midpoint to insert a bend

## Status: DONE_WITH_CONCERNS

Steps 1-3 were applied exactly as specified in the brief, plus the pre-authorized
`type ArrowType` import fix, plus two small consistency fixes to close a gap the
task's own self-review question asked me to check for. tsc is clean. However, my
manual trace (as instructed, since I have no browser) surfaced a real,
source-verified bug in the brief's own Step-1 code: a live mouse-drag on a bow
handle will fire the insert logic many times per gesture, not once, and — because
of how fabric.js 4.5.0's transform lifecycle actually works — this leaves a trail
of orphaned duplicate arrow objects on the canvas after every drag. I did not
attempt to fix this myself (see "Concern 1" below for why and for a suggested
remedy); I'm escalating it per the task's explicit instruction to flag rather than
guess on Control-API subtleties.

---

## 1. What I changed

All edits in `MS/Engines/Briefing/SlideEditor.ts`.

### 1a. Import — added `type ArrowType` (pre-authorized deviation from the literal brief)

`SlideEditor.ts:22-34`, the existing `OverlayFabric` import block:

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

Confirmed via `Grep` before editing that `ArrowType` was not already imported anywhere
in the file, and that `tsconfig.json` has `noUnusedLocals`/`noUnusedParameters`/`strict`
all `true` (`tsconfig.build.json` extends it) — so this import is both necessary
(used by `_rebuildArrow`, see 1d) and safe (it is used, so it won't itself trip
`noUnusedLocals`).

### 1b. Step 2 — `_initCanvas` overlay-load loop

`SlideEditor.ts:456-464`, replaced the old 4-line loop body with the brief's exact
replacement:

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

### 1c. Step 3 — `_onArrowFinish` one-line addition

`SlideEditor.ts:939`, immediately before `this._fc.add(finalObj);` (line 940):

```ts
    this._attachArrowControls(finalObj);
    this._fc.add(finalObj);
```

### 1d. Step 1 — three new methods

Inserted immediately after `_onArrowFinish` and before `_clearArrowChain`,
verbatim from the brief. (Line numbers below are as of this initial pass, before
the coordinator-directed addendum further down this report inserted two more
methods and shifted everything after `_attachArrowControls` down by ~36 lines —
see the addendum's section for current, post-fix line numbers.)

- `_attachArrowControls(grp: any): void` — `SlideEditor.ts:948-985` (post-addendum: 956-993)
- `_insertArrowBend(obj: any, segmentIndex: number, canvasX: number, canvasY: number): void` — `SlideEditor.ts:988-1002` (post-addendum: 1040-1054)
- `_rebuildArrow(obj: any, absPoints: Array<{x:number;y:number}>): any` — `SlideEditor.ts:1005-1021` (post-addendum: 1057-1073)

No logic was altered from the brief's code block; I only added one-line JSDoc
comments above each method.

### 1e. Two additional consistency fixes (beyond the brief's literal 3 steps — see rationale below)

While answering the self-review question "is there any code path where an arrow
exists on canvas without its bow-handle controls," I grepped every call site of
`overlayToFabric` in the file (there are exactly 3) and every `_fc.add(` call site
(11 total). Two of the three `overlayToFabric` call sites were **not** covered by
the brief's Steps 1-3, and both add fabricated arrow objects straight to the
canvas with no controls attached:

- **`_addOverlays`** (at the time of this fix: `SlideEditor.ts:1160-1171`, the
  shared helper behind both `_paste()` at line 1152 and `_duplicateSelection()`
  at line 1156; post-addendum, after the two new fields/methods added earlier in
  the file shifted things down, this is now at `SlideEditor.ts:1212-1224`,
  `_paste()`/`_duplicateSelection()` at 1204/1208). Fixed by adding one line
  (now `SlideEditor.ts:1220`):
  ```ts
      if (obj.data?.kind === 'arrow') this._attachArrowControls(obj);
      this._fc.add(obj);
  ```
- **`_restore`** (at the time of this fix: `SlideEditor.ts:1253-1271`, the shared
  helper behind both undo and redo — both branches of the undo/redo handler call
  it; post-addendum now at `SlideEditor.ts:1305-1323`). This one is more severe:
  `_restore` wipes and rebuilds the *entire* canvas from a JSON snapshot on every
  undo/redo, so without this fix, **any** undo or redo — even one unrelated to an
  arrow — would silently strip bow-handle controls from every arrow on the
  slide. Fixed at (now) `SlideEditor.ts:1316-1319`:
  ```ts
      if (obj) {
        if (obj.data?.kind === 'arrow') this._attachArrowControls(obj);
        this._fc.add(obj);
      }
  ```

I read the full 7-task plan (`docs/superpowers/plans/2026-07-25-curved-arrows.md`)
to confirm neither Task 6 nor Task 7 touches `_addOverlays` or `_restore` — these
are gaps across the *entire* plan, not something deferred to a later task. Both
fixes are mechanical applications of the exact one-line pattern the brief itself
established at the other 3 sites (no new design, no change to `_rebuildArrow`'s
signature/behavior, so zero risk to Task 6/7's stated dependency on it). I judged
this in-scope to just fix, unlike Concern 1 below, which requires an actual design
decision I didn't think was mine to make unilaterally.

---

## 2. tsc check

Per the outer task's project-specific constraint (overriding the brief's own
narrower single-file Step-4 command), I ran the real project config and filtered
for this file:

```
node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit 2>&1 | grep -n "SlideEditor.ts"
```

**Result: no output** — zero lines mention `SlideEditor.ts`, i.e. zero errors, new
or pre-existing, in this file.

Sanity checks performed:
- `tsc -p tsconfig.build.json --listFilesOnly` confirms `MS/Engines/Briefing/SlideEditor.ts`
  is genuinely part of the compiled set (not silently excluded).
- Total baseline error count across the whole project: 954 `error TS` lines,
  identical before and after all 5 of my edits (ran the full check once after
  Steps 1-3 + the `ArrowType` import, and again after the two additional
  `_addOverlays`/`_restore` fixes — both runs produced byte-identical output via
  `diff`). So my changes added zero new errors anywhere in the project, and
  removed zero pre-existing ones (as expected).
- Grepping the log for `Briefing` (the directory name) returns zero matches at
  all — no file under `MS/Engines/Briefing/` has any tsc error, pre-existing or
  new.

---

## 3. Manual trace

### 3a. Single actionHandler invocation (the case the task asked me to trace)

Setup: user draws a 3-point Sharp arrow via click-chain at canvas points `P0, P1,
P2`. `_onArrowFinish` builds it via `makeArrowGroup([P0,P1,P2], ...)`, which stores
`data.localPoints = [L0, L1, L2]` (each `Li = Pi - center`), then
`_attachArrowControls` runs with `pts.length === 3`, creating exactly 2 controls:
`bow0` (segmentIndex 0, midpoint of `L0,L1`) and `bow1` (segmentIndex 1, midpoint
of `L1,L2`) — matching "two segments, two bow handles."

User drags **`bow0`** (the first handle, between old point 0 and old point 1) to
some point `Q`. Tracing one invocation of the control's `actionHandler`:

1. `actionHandler(_eventData, transform, x=Q.x, y=Q.y)` fires with
   `transform.target = finalObj` (the group) → calls
   `this._insertArrowBend(finalObj, 0, Q.x, Q.y)`.
2. Inside `_insertArrowBend`: guard passes (`kind === 'arrow'`,
   `0 < 3-1`). `m = finalObj.calcTransformMatrix()` (identity-ish, nothing has
   moved the group yet). `absPoints = [L0,L1,L2].map(transformPoint(_, m))` round-trips
   back to `[P0, P1, P2]`.
3. `absPoints.splice(0 + 1, 0, {x:Q.x, y:Q.y})` → **`absPoints` becomes
   `[P0, Q, P1, P2]`** — i.e. **old point 0, NEW point (at the drag location),
   old point 1, old point 2**. (Note: the task prompt's own hint text said "old
   point 0, old point 1, NEW point, old point 2" — that ordering is actually what
   dragging the *second* handle, `bow1`/`segmentIndex=1`, would produce
   [`splice(2,0,...)`→`[P0,P1,NEW,P2]`]. For `bow0`/`segmentIndex=0` specifically,
   the new point lands at array index 1, directly between old point 0 and old
   point 1 — i.e. exactly "wherever segment 0's midpoint sits," which is between
   the first two original points, not the last two. This is a minor
   discrepancy in the task prompt's illustrative wording, not in the code.)
4. `_rebuildArrow(finalObj, [P0,Q,P1,P2])`:
   - `arrowType = finalObj.data.arrowType` (e.g. `'sharp'`) — preserved.
   - `pathChild = finalObj.getObjects()[0]` — the `fabric.Path` body (confirmed
     index 0 is always the path: `makeArrowGroup` constructs
     `new fabric.Group([path, tri], ...)`, so children order is fixed at
     creation and `getObjects()` returns `_objects` in that order).
     `pathChild.stroke`/`pathChild.strokeWidth` are the arrow's current stroke
     color/width — preserved, and I confirmed (see `SlideEditor.ts:1314-1338`,
     the properties-panel `'stroke'`/`'strokeWidthPx'` cases) that live style
     edits from the panel *also* mutate this exact child (`ch.set({stroke:...})`,
     `line.set({strokeWidth:...})`), so this reads live-current style, not just
     creation-time style.
   - `this._fc.remove(finalObj)` removes the original.
   - `makeArrowGroup([P0,Q,P1,P2], pathChild.stroke, pathChild.strokeWidth, {opacity: finalObj.opacity, data:{id: finalObj.data.id}}, finalObj.data.strokeDash, arrowType)`
     builds the replacement. Inside `makeArrowGroup` (`OverlayFabric.ts:284-292`),
     `data.id` uses `extra?.data?.id ?? overlayUuid()` — since we passed
     `data.id = finalObj.data.id`, the **same id** is kept (not a fresh uuid).
     `opacity` is preserved via the `{...extra}` spread onto the group's own
     fabric options. `strokeDash`/`arrowType` are written straight into the new
     `data` object from the arguments we passed through. **All of
     id/opacity/stroke/strokeWidth/strokeDash/arrowType are preserved.**
   - `_attachArrowControls(rebuilt)` — now attaches **3** bow handles (one more
     segment: `P0-Q`, `Q-P1`, `P1-P2`), matching "the arrow now has one more
     segment and its own new bow handle on each side of the inserted point."
   - `_fc.add(rebuilt)`, `_commit()`.
5. Back in `_insertArrowBend`: `setActiveObject(rebuilt)`, `requestRenderAll()`.

**End state after one invocation: exactly one arrow object, 4 points
`[P0, Q, P1, P2]`, same id/opacity/stroke/strokeWidth/strokeDash/arrowType, 3 bow
handles, selected.** This matches the brief's intent exactly — for a single call.

### 3b. What actually happens over a real drag gesture (see Concern 1)

A real mouse drag fires many `mousemove` events, not one, and I found this
matters a great deal here — see below.

---

## 4. Self-review

- **Does `_attachArrowControls` get called in all 3 required places?** Yes:
  fresh draw (`_onArrowFinish:939`, now line 947 post-addendum), loaded-from-slide
  (`_initCanvas:459`, now line 461 post-addendum), and every rebuild
  (`_rebuildArrow:1017`, now line 1069 post-addendum — so edited arrows keep
  working after a bend-insert, arrow-type change, or reopen-to-append — Tasks
  6/7 both funnel through `_rebuildArrow`). Beyond those 3, I also found and
  closed 2 more sites the plan as a whole never covered — see section 1e.

- **Does `_rebuildArrow` preserve id/opacity/stroke/strokeWidth/strokeDash/arrowType?**
  Yes — traced precisely against `makeArrowGroup`'s actual source in section 3a
  above; all six are carried through correctly.

- **Is there any code path where an arrow exists without controls?** There
  *were* two (`_addOverlays` behind paste/duplicate, and `_restore` behind
  undo/redo) — both are now fixed (section 1e). I re-grepped all 3
  `overlayToFabric` call sites and all `_fc.add(` call sites in the file (11 at
  the time of this check; the addendum below adds a 12th, `_dragArrowBend`'s
  `this._fc.add(this._bendPreview)`) to confirm no others remain; the other
  `_fc.add` sites are all for non-arrow kinds
  (text/rect/ellipse/line/freehand/highlight/callout) or transient,
  non-persisted preview paths (the click-chain arrow preview and, per the
  addendum, the bend-drag preview) — both preview kinds correctly have no
  `data.kind` at all and are removed before any real, persisted object takes
  their place.

---

## Concern 1 (headline, unresolved): a live bow-handle drag will leave orphaned duplicate arrows on the canvas

This is the reason for `DONE_WITH_CONCERNS` rather than `DONE`. I want to be
explicit that **this bug is in the brief's own Step-1 code, applied verbatim** —
I did not introduce it by deviating from the brief, and I did not attempt to fix
it myself (rationale at the end of this section).

**The mechanism**, verified by downloading and reading fabric.js 4.5.0's actual
source from `github.com/fabricjs/fabric.js` at tag `v4.5.0` (not from memory —
I fetched `src/canvas.class.js`, `src/mixins/canvas_events.mixin.js`, and
`src/mixins/collection.mixin.js` directly and read the relevant functions):

1. `actionHandler` fires on **every** `mousemove` during a drag, not once.
   `canvas.class.js` `__onMouseMove` → `_transformObject(e)` → `_performTransformAction`
   → `actionHandler(e, transform, x, y)`, on each tick, for as long as
   `this._currentTransform` is set.
2. `transform.target` is captured **once**, at mousedown, inside
   `_setupCurrentTransform` (`canvas.class.js:627-676`):
   `transform = { target: target, action, actionHandler, ... }; this._currentTransform = transform;`.
   Every subsequent tick reuses this same object (`_transformObject`:
   `transform = this._currentTransform;`) — `target` is never re-derived from
   `getActiveObject()` or anything else. Calling `this._fc.setActiveObject(rebuilt)`
   from inside our own `actionHandler` (as `_insertArrowBend` does) has **no
   effect** on what `transform.target` will be on the next tick of the *same*
   gesture — it stays pinned to the original object.
3. `fabric.Canvas.prototype.remove` (`collection.mixin.js:62-79`) does
   `index = objects.indexOf(arguments[i]); if (index !== -1) { splice... }` — i.e.
   removing an object that isn't present is a **silent no-op**, no error.
   `.add()` (`collection.mixin.js:20-29`) unconditionally pushes with no dedup.

**Consequence:** on tick 1 of a drag, `_insertArrowBend(originalObj, i, x1, y1)`
correctly removes `originalObj` and adds `rebuilt_1`. On tick 2,
`transform.target` is *still* `originalObj` (per point 2 above) — so
`_insertArrowBend(originalObj, i, x2, y2)` recomputes `absPoints` from
`originalObj`'s **unchanged, pre-drag** `data.localPoints` (that object was never
mutated, only read from) plus the new mouse position, and `_rebuildArrow` calls
`this._fc.remove(originalObj)` — a no-op, since it's already gone — then adds
`rebuilt_2`. **`rebuilt_1` is never removed.** This repeats every tick: tick *N*
adds `rebuilt_N` without ever removing `rebuilt_(N-1)`. A real human drag
comfortably fires dozens of mousemove events, so a single bow-handle drag would
leave dozens of orphaned duplicate arrow-group objects scattered along the drag
path, permanently on the canvas and persisted into `slide.overlays` on the next
save (each `_rebuildArrow` call also calls `_commit()`, so every one of these
gets snapshotted onto the undo stack too). Worse, every one of these duplicates
shares the **same `data.id`** (since `id: obj.data.id` always reads from the
pinned original), so the saved slide would end up with multiple overlay entries
claiming the same id.

I additionally checked whether this could throw/crash at mouseup (it does not —
`__onMouseUp` operates on `this._target`/`transform.target`'s own JS properties,
which remain structurally valid even though the object is detached from the
canvas's `_objects` array; no exception, just silent duplication) and whether the
built-in resize/rotate controls have the same problem (they don't — their
actionHandlers mutate the *same* pinned target's properties in place, e.g.
`target.set({scaleX, angle})`, rather than destroying and replacing it, which is
exactly why fabric's "target pinned for the whole gesture" contract works fine
for them but not for a destroy-and-rebuild strategy).

**Why I didn't fix it myself:** unlike the `_addOverlays`/`_restore` gaps (a
mechanical one-line application of an already-established pattern), a correct
fix here requires an actual design decision — e.g. tracking "the current live
replacement" across ticks via an expando property on the gesture-stable pinned
object (`obj.__bowLiveObj`), pinning the pre-drag base geometry separately so
each tick re-derives from the *original* geometry rather than compounding
inserts, and probably debouncing `_commit()` to fire once at mouseup rather than
on every tick to avoid flooding the 50-entry undo stack. That's new mechanism
not specified anywhere in the brief, and `_rebuildArrow`/`_attachArrowControls`
are explicitly reused as-is by Tasks 6 and 7 (confirmed by reading the full plan
— though neither of those two reuses is drag-driven, so neither is affected by
this specific bug; it's isolated to Task 5's own Control-wiring). Given the
task's explicit instruction to escalate rather than guess on Control-API
subtleties, I'm reporting this in full rather than shipping an unreviewed
redesign of the drag-handling strategy.

**Suggested remedy direction** (not applied): in `_insertArrowBend`, stash the
pre-drag `localPoints` and the most-recently-added replacement on the pinned
`obj` (e.g. `obj.__bowBase ??= obj.data.localPoints; const toRemove = obj.__bowLive ?? obj; ... obj.__bowLive = rebuilt;`)
so every tick removes the *actual* current canvas object instead of the
already-gone original, while still computing the live point each tick from the
fixed pre-drag base (not from an increasingly-mutated chain). Pair with
debouncing the `_commit()` inside `_rebuildArrow` (or splitting a cheap
"live preview" path from a single final commit on `mouse:up`) so a drag doesn't
flood the undo stack. This would need to be verified live in a browser before
trusting it — I have not tested it.

---

## Other notes

- `fabric.Control`, `fabric.Object.prototype.controls`, `fabric.util.transformPoint`,
  and `calcTransformMatrix` are all used with correct signatures per the real
  fabric.js 4.5.0 source (verified, not assumed): `transformPoint(p, t, ignoreOffset)`
  takes a `fabric.Point` + 6-element matrix and applies translation by default
  (correct — both call sites want absolute canvas coordinates, not
  rotation/scale-only deltas); `calcTransformMatrix()` returns exactly that
  6-element array format, including parent-group transforms. The `let i` loop
  variable in `_attachArrowControls` is correctly captured per-iteration by each
  control's closures (no classic `var`-in-loop bug).
- I have no browser in this environment, so the interactive/visual behavior
  (handle rendering, cursor, actual drag feel) is otherwise unverified beyond
  the source-level trace above, as flagged upfront.
- No git commands were run; all edits are uncommitted in the working tree.

---

## ADDENDUM — Coordinator-directed fix for Concern 1 (non-destructive drag + finalize-on-`object:modified`)

The coordinator reviewed the Concern-1 writeup above, agreed with the diagnosis,
and supplied an exact design + code to apply in place of the per-tick destructive
rebuild: keep the pinned `transform.target` completely untouched for the whole
drag; show a cheap, throwaway preview path per tick (mirroring the existing
`_updateArrowPreview`/`_arrowPreview` pattern already proven in this file); do the
one real `_rebuildArrow` swap exactly once, at drag end, off the `object:modified`
event. Before applying, I independently re-verified the load-bearing claim (that
`object:modified` fires generically at the end of any control-driven transform,
regardless of which actionHandler ran) against the actual fabric.js 4.5.0 source,
since that claim is what makes the whole design work. I did not just apply this
on trust.

### Verifying the `object:modified` claim

Continuing from the same fabric.js 4.5.0 source tree fetched for Concern 1:

- `canvas_events.mixin.js:965`: `_fire: fabric.controlsUtils.fireEvent,` — so every
  `this._fire(eventName, options)` call in the canvas transform lifecycle
  resolves to `fabric.controlsUtils.fireEvent`.
- `src/controls.actions.js:31-38` (downloaded and read directly):
  ```
  function fireEvent(eventName, options) {
    var target = options.transform.target, canvas = target.canvas, ...
    canvas && canvas.fire('object:' + eventName, canvasOptions);
    target.fire(eventName, options);
  }
  ```
  This dual-fires the canvas-level `object:modified` event **and** the target's
  own `modified` event from a single call — confirming our
  `this._fc.on('object:modified', ...)` listener is the right hook.
- `canvas.class.js:549-576` (`_finalizeCurrentTransform`, called unconditionally
  from `__onMouseUp` whenever `this._currentTransform` is set):
  ```
  if (transform.actionPerformed || (this.stateful && target.hasStateChanged())) {
    ...
    this._fire('modified', options);
  }
  ```
  Since our control's `actionHandler` always `return true`s on every tick it
  runs, and `_performTransformAction` does
  `transform.actionPerformed = transform.actionPerformed || actionPerformed;`
  (a sticky OR onto the one `_currentTransform` object that persists for the
  whole gesture — confirmed in Concern 1's research), `transform.actionPerformed`
  becomes `true` after the *first* tick and stays `true`. So at mouseup,
  regardless of which specific action/control was used, `object:modified` fires
  **exactly once** per gesture. This confirms the coordinator's claim precisely.

### A refinement I found while verifying: the zero-movement click case is even safer than assumed

The coordinator's message asked me to confirm that a bow-handle click with no
drag movement falls through to the harmless `_commit()` branch. Tracing one
level deeper: `_setupCurrentTransform` (`canvas.class.js:627-666`) builds the
`transform` object with no `actionPerformed` key at all, so it starts
`undefined`. If zero `mousemove` ticks occur between mousedown and mouseup,
`_performTransformAction` (and therefore our `actionHandler`) never runs even
once, so `transform.actionPerformed` stays falsy at mouseup. The OR-fallback
`this.stateful && target.hasStateChanged()` also does not save it: `stateful`
defaults to `false` (`static_canvas.class.js:100`: `stateful: false,`), and
`_initCanvas`'s `new fabric.Canvas(canvasEl, { preserveObjectStacking: true,
selection: true, backgroundColor: '#1a2129' })` never overrides it. So a true
zero-movement click likely doesn't fire `object:modified` **at all** — meaning
neither branch of our listener runs, `_commit()` is never called, and nothing
happens. That's actually the more precise/correct outcome (there is nothing to
commit — no bend was ever previewed or inserted), and it's strictly safer than
the "falls through to a no-op `_commit()`" framing: either fabric fires the event
and we no-op via `_commit()`'s existing dedup guard (`_commit()` at
`SlideEditor.ts:1268-1277`: `if (snap === this._undo[this._undo.length-1]) return;`
on line 1275), or it doesn't fire at all and we do nothing — both paths are
harmless.

### Changes applied (all in `MS/Engines/Briefing/SlideEditor.ts`)

1. **New fields**, next to `_arrowChain`/`_arrowPreview`/`_arrowLastClickAt`
   (`SlideEditor.ts:113-114`):
   ```ts
     private _bendDrag: { obj: any; segmentIndex: number; lastPoint: { x: number; y: number } } | null = null;
     private _bendPreview: any = null;
   ```
2. **`_attachArrowControls`'s `actionHandler`** (`SlideEditor.ts:973-976`) now calls
   `this._dragArrowBend(transform.target, i, x, y)` instead of
   `_insertArrowBend` directly. Nothing else in the method changed.
3. **New method `_dragArrowBend`** (`SlideEditor.ts:1002-1025`) — the non-destructive
   per-tick handler: records `{obj, segmentIndex, lastPoint}` on `this._bendDrag`
   every tick, computes the speculative absolute point list from the (never
   mutated) pinned `obj`'s original `data.localPoints` plus the live cursor
   position, and swaps a dashed preview `fabric.Path` in/out via
   `this._bendPreview` — the same object-churn pattern `_updateArrowPreview`
   already uses safely in this file (`SlideEditor.ts:901-919`), because it keys
   off our own tracked field, not off fabric's pinned `transform.target`.
4. **New method `_finalizeArrowBend`** (`SlideEditor.ts:1028-1037`) — clears
   `_bendDrag`/removes the last preview, then calls the untouched
   `_insertArrowBend` exactly once with the drag's last recorded point.
5. **`_insertArrowBend`** — left byte-for-byte as originally written (confirmed
   by re-reading it post-edit); it is now only ever invoked once per gesture,
   from `_finalizeArrowBend`.
6. **`object:modified` listener in `_initCanvas`** (`SlideEditor.ts:475-481`):
   ```ts
       this._fc.on('object:modified', () => {
         if (this._bendDrag) {
           this._finalizeArrowBend();
           return;
         }
         this._commit();
       });
   ```

### tsc re-check

Same command as before:
```
node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit 2>&1 | grep -n "SlideEditor.ts"
```
**Result: no output** — zero errors in `SlideEditor.ts`. Total project-wide
`error TS` count: 954, identical to every prior run (confirmed via `grep -c`),
so this change added zero new errors and removed zero pre-existing ones anywhere
in the project.

### Multi-tick retrace (drag bow0 through Q1, Q2, Q3, mouseup at Q3)

Setup: 3-point Sharp arrow `finalObj`, points `P0,P1,P2`, `data.localPoints = [L0,L1,L2]`
(never mutated during any of this), bow0 = segmentIndex 0.

- **Mousedown on bow0**: fabric's `_setupCurrentTransform` sets
  `_currentTransform = {target: finalObj, actionHandler: <bow0's>, actionPerformed: undefined, ...}`.
  This `target` reference never changes for the rest of the gesture.

- **Tick 1 (move to Q1)**: `actionHandler` → `_dragArrowBend(finalObj, 0, Q1.x, Q1.y)`.
  `_bendDrag = {obj:finalObj, segmentIndex:0, lastPoint:Q1}`. Recomputes
  `absPoints` from `finalObj`'s untouched `[L0,L1,L2]` → `[P0,P1,P2]` → splices
  in `Q1` at index 1 → `[P0,Q1,P1,P2]` → builds `d1` → `_bendPreview` is null,
  so no removal; creates `preview_1`, adds it. **Canvas: `finalObj` (untouched,
  original 2 bow handles still rendered at their original, pre-drag midpoint
  positions since `finalObj.data.localPoints` hasn't changed) + `preview_1`.**

- **Tick 2 (move to Q2)**: `transform.target` is *still* `finalObj` (confirmed:
  fabric never re-derives this mid-gesture). `_dragArrowBend(finalObj, 0, Q2.x, Q2.y)`
  overwrites `_bendDrag` with `{...lastPoint:Q2}`; recomputes `absPoints` again
  from `finalObj`'s **same original** `[L0,L1,L2]` (not from `preview_1`'s
  geometry — so ticks don't compound on each other, each is an independent "what
  if I dropped here" snapshot) → `[P0,Q2,P1,P2]` → builds `d2`. This time
  `this._bendPreview` is `preview_1`, so **`preview_1` is removed first**, then
  `preview_2` is created and added. **Canvas: `finalObj` (still untouched) +
  `preview_2` only — no accumulation, unlike the old bug.**

- **Tick 3 (move to Q3)**: identical — removes `preview_2`, adds `preview_3`
  (from `[P0,Q3,P1,P2]`). `_bendDrag.lastPoint = Q3`.

- **Mouseup at Q3**: fabric does not run one more `_transformObject` tick at
  mouseup itself (confirmed from `__onMouseUp`'s source — it calls
  `_finalizeCurrentTransform(e)` directly). `_finalizeCurrentTransform` sees
  `transform.actionPerformed === true` (sticky since tick 1) and fires
  `object:modified` exactly once. Our listener sees `this._bendDrag` truthy
  (`{obj:finalObj, segmentIndex:0, lastPoint:Q3}`) and calls
  `_finalizeArrowBend()`:
  - `drag = this._bendDrag` (captures the Q3 state); `this._bendDrag = null`
    immediately (no leakage to any later, unrelated `object:modified`).
  - Removes `preview_3`, clears `_bendPreview`.
  - `this._insertArrowBend(finalObj, 0, Q3.x, Q3.y)` — the untouched original
    method, now running for the **first and only time** this gesture:
    recomputes `absPoints = [P0,Q3,P1,P2]` from `finalObj`'s still-original
    `[L0,L1,L2]`, calls `_rebuildArrow(finalObj, [P0,Q3,P1,P2])`, which **now
    correctly removes `finalObj`** (this is the *first* time anything has
    removed it all gesture — no stale no-op), builds `rebuilt` with the same
    id/opacity/stroke/strokeWidth/strokeDash/arrowType (same preservation logic
    verified in section 3a above, unchanged), attaches 3 fresh bow handles to
    it, adds it, and calls `_commit()` **exactly once**.

**End state: one arrow object (`rebuilt`), 4 points `[P0,Q3,P1,P2]`, all style/id
fields preserved, 3 bow handles, selected. Exactly one new undo-stack entry for
the whole gesture.** No duplicates, no orphans, no shared-id collisions — the bug
from Concern 1 is fixed.

### Other observations

- A minor, non-bug UX side-effect of this design: because `finalObj` itself is
  never mutated during the drag, its own bow-handle glyphs (rendered via
  `positionHandler`, which reads `obj.data.localPoints`) stay visually fixed at
  their pre-drag segment-midpoint positions for the whole gesture — only the
  separate dashed preview path shows the live "if dropped here" shape. The
  actively-grabbed handle glyph itself does not visually track the cursor the
  way a built-in fabric corner control does. This matches the coordinator's
  stated design (a cheap preview, not a live-updating handle) and is not a
  defect, just worth flagging since it's a slightly different feel from
  dragging a normal resize handle. Unverified visually, as I still have no
  browser.
- Re-grepped `_fc.add(`/`overlayToFabric(` call sites after this round of edits
  or the paste/duplicate/undo-redo fixes: unaffected/unchanged by this addendum
  (this fix only touches the drag-gesture path, not any load/paste/restore path).
- No git commands were run for this addendum either; all edits remain
  uncommitted.

## Updated Status: DONE

With this fix applied and independently source-verified, I no longer have an
open, unresolved correctness concern. The only remaining caveat (stated
up-front in the original task constraints, not new) is that I have no browser in
this environment, so the actual interactive feel (cursor, handle rendering, real
mouse timing) is unverified beyond this source-level trace.

---

## ADDENDUM 2 — Review finding: mid-drag keyboard actions (Delete / Ctrl+Z) leak `_bendDrag`/`_bendPreview`

Review came back Approved overall, with one Important finding: `_bendDrag`/
`_bendPreview` are app-level fields, entirely independent of fabric's own
`_currentTransform` gesture-tracking. If the user fires a keyboard action —
Delete/Backspace (`_deleteSelection`) or Ctrl+Z/Ctrl+Y (`_restore`, via
`_undoRedo`) — while a bow-handle drag is still physically in progress (mouse
button still down), neither method knew to clear `_bendDrag`/`_bendPreview`.
Fabric's own transform state is untouched by deleting/replacing canvas objects,
so the in-flight gesture still reaches its own mouseup later and still fires
`object:modified` there (same mechanism verified in Addendum 1) — at which point
the stale `_bendDrag` (still pointing at the just-deleted/just-undone arrow
instance) would drive `_finalizeArrowBend` → `_insertArrowBend` on an object
that's no longer meant to exist.

### Confirming the failure mode by tracing it (before applying the fix)

**Delete mid-drag:** `_deleteSelection` (pre-fix) removed the active object(s)
and called `_commit()`, but the dragged arrow object itself (`obj`) is a plain
JS object — deleting it from the canvas's `_objects` array doesn't null out its
own properties. So when the eventual mouseup fires `object:modified` with the
old `_bendDrag` still set, `_insertArrowBend(obj, ...)`'s only guard is
`obj.data?.kind !== 'arrow'` — still `'arrow'`, since that's an own-property,
unaffected by canvas removal — so it proceeds straight to
`_rebuildArrow(obj, absPoints)`, which builds a **brand new arrow group from
`obj`'s stroke/opacity/id/etc. and calls `this._fc.add(rebuilt)`** — literally
resurrecting the just-deleted arrow back onto the canvas the moment the mouse
button is released, silently undoing the user's delete. Confirmed as real, not
hypothetical.

**Ctrl+Z mid-drag:** `_restore` (pre-fix) wipes and rebuilds the *entire*
canvas from a JSON snapshot, replacing `obj` with a structurally different
instance (possibly sharing an id, but not the same object). The stale
`_bendDrag.obj` still refers to the *old*, pre-undo instance. At the eventual
mouseup, the same `_insertArrowBend(oldObj, ...)` → `_rebuildArrow` path runs,
`this._fc.remove(oldObj)` no-ops (it's not the object on canvas anymore), and
`this._fc.add(rebuilt)` **adds a duplicate arrow — built from stale, pre-undo
geometry — alongside whatever the undo target legitimately restored**,
corrupting the post-undo state. Also confirmed as real.

Both traces confirm the reviewer's diagnosis precisely. (The reviewer also
floated a second possible symptom — `_bendDrag` staying permanently set and
later hijacking an unrelated future `object:modified` event. My trace shows the
*current* gesture's own mouseup does still consume/clear `_bendDrag` via
`_finalizeArrowBend`, just with the bad resurrection/duplication side effect
above, rather than leaving it stuck forever — but this doesn't change what fix
is needed: clearing `_bendDrag`/`_bendPreview` defensively at the top of both
methods removes the root cause either way, regardless of which exact downstream
symptom fabric's internals would otherwise produce.)

### Fix applied (exactly as specified)

**`_deleteSelection`** (`SlideEditor.ts:379-395`), inserted right after
`if (!objs.length) return;` (now line 381):
```ts
    if (this._bendDrag) {
      if (this._bendPreview) {
        this._fc.remove(this._bendPreview);
        this._bendPreview = null;
      }
      this._bendDrag = null;
    }
```
Now at `SlideEditor.ts:382-388`.

**`_restore`** (`SlideEditor.ts:1317-1339`), inserted right after the
`try { overlays = JSON.parse(json); } catch { return; }` block, before
`this._fc.discardActiveObject();`:
```ts
    if (this._bendDrag) {
      if (this._bendPreview) {
        this._fc.remove(this._bendPreview);
        this._bendPreview = null;
      }
      this._bendDrag = null;
    }
```
Now at `SlideEditor.ts:1324-1330`. Nothing else in either method was touched.

### Minor nits also applied (optional, took both — cheap and safe)

1. In `_dragArrowBend`, moved `this._bendDrag = {...}` to *after* the
   `segmentIndex + 1 >= lp.length` guard (was before it). Zero behavioral
   change: `segmentIndex` is fixed per-control and `lp.length` can't change
   mid-gesture (the pinned object is never mutated), so the guard's outcome is
   constant for the whole gesture — either every tick sets `_bendDrag` or none
   do; moving the assignment doesn't change which.
2. Normalized `_dragArrowBend`'s `absPoints` to plain `{x, y}` objects (was a
   mix of `fabric.Point` instances from `.map()` and a plain literal from
   `.splice()`), matching `_insertArrowBend`'s existing style. Purely
   cosmetic — `buildArrowPath` only reads `.x`/`.y`, so both a `fabric.Point`
   and a plain object satisfy it identically.

### tsc re-check

Same command:
```
node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit 2>&1 | grep -n "SlideEditor.ts"
```
**Result: no output** — zero errors in `SlideEditor.ts`. Total project-wide
`error TS` count: still 954, unchanged.

### Retrace: mid-drag Delete

Setup: 3-point arrow `obj` selected, user drags bow0, tick 1 fires at Q1 →
`_bendDrag = {obj, segmentIndex:0, lastPoint:Q1}`, `_bendPreview = preview_1`
(added to canvas). Mouse button still held down.

User presses Delete. `_deleteSelection()`: `objs = [obj]` (the arrow is the
active object — that's *why* its bow controls were interactive). Not empty, so
we proceed. New guard: `this._bendDrag` truthy → removes `preview_1`, nulls
`_bendPreview`, nulls `_bendDrag`. Then `objs.forEach(remove)` removes `obj`
itself. `discardActiveObject()`, `requestRenderAll()`, `_syncPanelContext()`,
`_commit()` — pushes the "arrow deleted" state as a genuine new undo entry.
**Canvas right now: empty of both `obj` and `preview_1`; `_bendDrag`/
`_bendPreview` both `null`.**

User releases the mouse. Fabric's own `_currentTransform` (untouched by any of
the above — it's independent app state) still fires `_finalizeCurrentTransform`
→ `object:modified` (since `transform.actionPerformed` was set `true` on tick
1 and is sticky). Our listener: `this._bendDrag` is now `null` → falls through
to `this._commit()`. `_commit()`'s existing dedup guard
(`if (snap === this._undo[this._undo.length-1]) return;`) compares the current
(unchanged-since-the-delete) canvas snapshot against the entry `_deleteSelection`
just pushed — identical → no-ops, no spurious extra undo entry.

**End state: the arrow is actually gone. No resurrection, no duplicate, no
orphaned preview, exactly one undo entry (the deletion).** Fixed.

### Retrace: mid-drag Ctrl+Z

Same setup through tick 1 (`_bendDrag` set, `preview_1` on canvas, mouse still
down, assume enough undo history exists).

User presses Ctrl+Z → `_undoRedo(false)` → `this._redo.push(this._undo.pop()!);
this._restore(this._undo[this._undo.length - 1]);`. Inside `_restore`: JSON
parses fine → new guard: `this._bendDrag` truthy → removes `preview_1`, nulls
both fields. Then the pre-existing body runs unchanged: `discardActiveObject()`,
blanket-removes every current canvas object (including `obj`, the mid-drag
arrow), rebuilds fresh objects from the undo-target `overlays` (attaching bow
controls to any arrow-kind ones via the existing Task-5 fix), `requestRenderAll()`,
`_syncPanelContext()`. **Canvas right now: exactly the undo-target state, no
trace of the interrupted drag; `_bendDrag`/`_bendPreview` both `null`.**

User releases the mouse. Same fabric mechanism fires `object:modified` against
the stale, now-orphaned `obj` reference held by fabric's own (untouched)
`_currentTransform`. Our listener: `this._bendDrag` is `null` → falls through to
`_commit()`. Since `_undoRedo` just set the current top of `_undo` to exactly
the JSON that was restored, and nothing has changed the canvas since, the
snapshot matches → dedup guard no-ops, no spurious undo entry, no disruption to
the `_undo`/`_redo` stacks.

**End state: canvas correctly reflects the undo target, no resurrection of the
interrupted bend, no duplicate/stale geometry.** Fixed.

### Self-review

- Both fixes are purely defensive early-clears, applied verbatim from the
  reviewer's provided code (I did not need to deviate) — no new design
  decisions, no change to `_rebuildArrow`/`_insertArrowBend`/`_dragArrowBend`/
  `_finalizeArrowBend`'s own logic.
- Confirmed `_bendPreview` can never itself be one of the objects
  `_deleteSelection` operates on (it's created with
  `selectable: false, evented: false`, so it's never in `getActiveObjects()`),
  and in `_restore` it would have been swept up anyway by the blanket-removal
  loop a few lines later — the explicit early removal is not redundant-harmful,
  just makes the intent explicit and ensures it's gone even if some future edit
  changes the blanket-removal logic.
- Did not find any third method that reads/needs to clear `_bendDrag`/
  `_bendPreview` — re-grepped the whole file for both field names; the only
  reads/writes are in `_dragArrowBend`, `_finalizeArrowBend`, and now
  `_deleteSelection`/`_restore`.
- Tool-switching mid-drag (`_setTool`) was separately checked by the reviewer
  and confirmed not to need a change (the in-flight fabric transform is
  independent of the app's tool state and still fires `object:modified`
  normally at its own mouseup) — I did not re-verify this independently since
  it wasn't asked of me, but it's consistent with everything I traced above
  (fabric's `_currentTransform` lifecycle doesn't care what the app's `_tool`
  field is).
- Still no browser available; this remains a source-level trace, not a live
  interactive test.

## Updated Status: DONE (mid-drag interrupt fix applied and traced)

---

## ADDENDUM 3 — Unrequested `styleSelectionControls()` found and removed; provenance investigation

The re-reviewer found a function `styleSelectionControls()` (plus a
`let _controlsStyled = false;` flag) in `OverlayFabric.ts`, and a matching
import + one call to it in `SlideEditor.ts`'s `_initCanvas`. It globally mutated
`fabric.Object.prototype`'s corner/border/rotate-handle styling. This was never
part of the Task 5 brief, never asked for in either of the coordinator's two fix
rounds, and I never mentioned it in any of my three status replies or in this
report's first three sections. The coordinator asked me to remove it and to
explain how it got there. I removed it; the explanation below is an honest
accounting of what I can and cannot establish about its origin.

### What was removed

1. `OverlayFabric.ts`: deleted `let _controlsStyled = false;` and the entire
   `styleSelectionControls()` function (had been sitting between `withAlpha`
   and `dashProps`), collapsing the surrounding blank lines back to the single
   blank line that separates every other function pair in this file. Confirmed
   post-removal that `dashProps` is back at line 69 — exactly where it was in
   the very first `Grep` I ever ran against this file, before I made any edits
   at all (see below).
2. `SlideEditor.ts`: removed `styleSelectionControls,` from the `OverlayFabric`
   import list, and removed the `styleSelectionControls();` call from
   `_initCanvas` (was immediately after `if (!ui?.stageWrap) return;`, before
   `ui.stageWrap.innerHTML = '';`).
3. Re-grepped `MS/` for `styleSelectionControls` and `_controlsStyled`: zero
   remaining matches anywhere in the project.
4. Re-ran `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit`:
   zero lines matching `SlideEditor.ts` or `OverlayFabric.ts`; total project-wide
   `error TS` count still 954, unchanged. `git diff --stat HEAD -- MS/Engines/Briefing/OverlayFabric.ts`
   now shows 260 insertions/25 deletions, down from 296/25 before this
   removal — a reduction of exactly 36 lines, matching the size of the removed
   block precisely (35 code lines + 1 blank line).

### Investigating how it got there

I want to give a precise, honest accounting rather than either denying
responsibility reflexively or inventing a plausible-sounding story I can't
actually back up. Here is exactly what I can and cannot establish:

**What I'm confident of, and why:**

1. **I never issued an `Edit` or `Write` tool call with `OverlayFabric.ts` as
   the target, anywhere in this conversation.** Every one of my interactions
   with that file was read-only (`Read` or `Grep`), used to understand
   `makeArrowGroup`, `ArrowType`, `buildArrowPath`, and `overlayToFabric` so I
   could write correct code in `SlideEditor.ts` (the only file Task 5's brief
   asked me to touch). I reviewed my own tool-call sequence across all three
   rounds (the original Task 5 work, the first coordinator fix, and the second
   coordinator fix) and found no Edit/Write against this file in any of them.
2. **The function did not exist anywhere in the file as of my very first
   inspection of it**, before I made any edits to anything. Early in my
   original Task 5 work I ran
   `Grep pattern="ArrowType|makeArrowGroup|localPoints|strokeDash|data\.id|export (type|interface|function|const)"`
   against the whole file. That pattern includes `export function`, so it
   would have caught `export function styleSelectionControls(): void {` at
   whatever line it lived on, if it existed anywhere in the file at that
   point. It did not appear in the results.
3. **Stronger, mechanical proof beyond recollection:** my very first `Edit`
   call in this entire session targeted `SlideEditor.ts`'s `OverlayFabric`
   import block, with an `old_string` listing exactly
   `buildArrowPath, dashProps, fabricToOverlay, isBoxKind, makeArrowGroup,
   makeShapeObject, overlayToFabric, overlayUuid, parseColor, withAlpha` —
   *no* `styleSelectionControls`. `Edit` requires an exact match of
   `old_string` or the call fails outright. That call succeeded. This proves,
   mechanically (not just by memory), that `styleSelectionControls,` was
   **not** present in that import list at that exact moment. I never edited
   that import block again afterward — every subsequent change I made to
   `SlideEditor.ts` targeted other regions of the file entirely (the
   `_initCanvas` loop, `_onArrowFinish`, the new methods, `_addOverlays`,
   `_restore`, the new fields, the `object:modified` listener). So the import
   line and the `_initCanvas` call must have appeared after that point, via
   something other than one of my own tool calls.

**What I checked but couldn't turn into a definitive answer:**

I also pulled file timestamps (`ls -la --time-style=full-iso` and `stat`) to
see if they'd help pin down *when* this happened:
- `OverlayFabric.ts` — Modify: `2026-07-25 17:02:07`
- `SlideEditor.ts` — Modify: `2026-07-25 17:03:29` (82 seconds later)
- `BriefingTypes.ts` (a file from Tasks 1-4's prior work that I never touched
  at all this session) — Modify: `2026-07-25 15:45:47`, over an hour earlier.

`OverlayFabric.ts`'s modify time being so close to `SlideEditor.ts`'s (which I
was actively editing throughout this session) is circumstantial and worth
noting, but I want to be upfront that I don't think this timestamp evidence is
actually conclusive: `stat` also reported `Birth` == `Modify` to the millisecond
for *both* files — including `SlideEditor.ts`, which I know for a fact I edited
many separate times over a long conversation (fields, actionHandler, two new
methods, the listener, two defensive-clear blocks, two nits — at least eight
separate `Edit` calls spanning all three rounds of this task). A file I
incrementally edited that many times should not show an identical birth/modify
instant if birth time were being tracked meaningfully in this environment. Since
it does, that tells me this filesystem/environment isn't preserving true
creation time (it's just mirroring modify time), which means I can't use the
`OverlayFabric.ts` birth/modify match to conclude anything like "it was fully
rewritten by an external process at 17:02" — that same signature shows up for a
file I definitely edited piecemeal myself.

**Honest bottom line:** based on reviewing my own actions, I did not add this
function or wire it up — the evidence above (especially the exact-match
`Edit` proof) is as close to mechanical certainty as I can get without an
external audit log. But I also cannot positively identify what *did* introduce
it. I have no tool in this session that records filesystem writes from outside
my own tool calls, so I can't rule out some other process or agent with write
access to this repository having touched the file during the session window.
If the coordinator has visibility into other sessions/agents/tooling touching
this workspace concurrently, that's likely the only way to get a definitive
answer beyond what I've laid out here — I'd rather say that plainly than guess.

### Self-review

- Confirmed via `Grep` across all of `MS/` (not just the two files) that no
  other reference to `styleSelectionControls`/`_controlsStyled` exists anywhere
  in the codebase.
- Confirmed the `OverlayFabric.ts` removal restored the exact original
  structure (single blank line, `dashProps` back at its original line 69 as
  seen in my first-ever grep of the file) rather than leaving a double blank
  line or any other artifact.
- tsc clean on both affected files, project-wide error count unchanged (954).
- No git commands beyond read-only `status`/`diff`/`stash list`/`reflog` were
  run during this investigation; nothing was committed, staged, or reset.

---

## ADDENDUM 4 — `styleSelectionControls()` re-added, scoped with a paired restore on close

The coordinator confirmed with the user that `styleSelectionControls()` was
added intentionally (by the user or a separate tool/session of theirs) and
should be kept — but scoped so its prototype-level mutation doesn't leak into
the *other* `fabric.Canvas` in this app (`index.html`'s `#fabricCanvas`, used
elsewhere for freehand/overlay drawing per this project's CLAUDE.md) once the
Briefing editor closes. Design: snapshot the previous `fabric.Object.prototype`
values before applying the Excalidraw-style overrides, and restore them when
the editor closes.

### Changes applied

**`OverlayFabric.ts`** — re-added at the same location (right after `withAlpha`,
before `dashProps`), now at `OverlayFabric.ts:65-132`:
- `let _controlsStyled = false;` / `let _savedControlsState: Record<string, any> | null = null;` (lines 65-66)
- `styleSelectionControls()` (lines 68-113, doc comment + body) — same overrides
  as before, but now snapshots the 10 touched properties (9 scalar props +
  `controls.mtr.render`) into `_savedControlsState` before overwriting them.
- `restoreSelectionControls()` (lines 115-132) — new. Guards on
  `!_controlsStyled || !_savedControlsState`, otherwise writes all 10 saved
  values back onto `fabric.Object.prototype` and resets both module-level
  fields so a later `styleSelectionControls()` call re-snapshots cleanly
  rather than becoming a permanent no-op.

**`SlideEditor.ts`**:
1. Import list (`SlideEditor.ts:22-35`): re-added `styleSelectionControls,` and
   also added `restoreSelectionControls,` (both placed alphabetically, matching
   this list's existing convention — `restoreSelectionControls` sorts before
   `styleSelectionControls`, both before `withAlpha`).
2. `_initCanvas` (`SlideEditor.ts:419`): re-added
   `styleSelectionControls();` at the same spot as before — immediately after
   `if (!ui?.stageWrap) return;`, before `ui.stageWrap.innerHTML = '';`.
3. `close(save: boolean)` (`SlideEditor.ts:278-308`): added
   `restoreSelectionControls();` at `SlideEditor.ts:293`, immediately after
   `this._laser?.dispose(); this._laser = null;` and before the
   `try { this._fc?.dispose?.(); } catch {}` block, exactly as specified.

### tsc re-check

```
node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit 2>&1 | grep -nE "SlideEditor.ts|OverlayFabric.ts"
```
**Result: no output** — zero errors in either file. Total project-wide
`error TS` count: still 954, unchanged.

### Trace: open → close, single cycle

1. `open(host, index)` (`SlideEditor.ts:154`): `this._buildStage(slide);`
   (synchronous, sets `this._stage`) then `await this._loadSlide(index);`.
2. Inside `_loadSlide`, after two `await` points (`host.prepareBackground`,
   `this._loadImage`), `this._initCanvas(...)` runs, which calls
   `styleSelectionControls()` first thing. `_controlsStyled` is `false` (fresh
   page/first open) → guard passes → snapshots the current
   `fabric.Object.prototype` values (fabric's own built-in defaults, assuming
   nothing else has touched them yet) into `_savedControlsState`, sets
   `_controlsStyled = true`, applies the Excalidraw-style overrides.
3. User works in the editor. Note: since `fabric.Object.prototype` is shared,
   any object on the *other* `#fabricCanvas` rendered/interacted with **while**
   the Briefing editor happens to be open would in fact pick up the Excalidraw
   styling too. That's an inherent, acknowledged limitation of a
   prototype-level approach with no cheap per-canvas default in fabric.js —
   the coordinator's fix scopes the leak to "only while the Briefing editor is
   open," not "permanently for the rest of the page's lifetime," which is
   exactly what was asked for. It does not (and wasn't asked to) prevent the
   leak while both happen to be open at the same time.
4. `close(save)` (`SlideEditor.ts:278`): passes the `if (!this._stage) return;`
   guard (stage is set), runs its cleanup, reaches
   `restoreSelectionControls()` at line 293. `_controlsStyled` is `true`,
   `_savedControlsState` is non-null → guard passes → writes all 10 saved
   values back onto the prototype, resets `_controlsStyled = false` and
   `_savedControlsState = null`.

**End state: `fabric.Object.prototype` is back to exactly what it was before
this editor session touched it.** Confirmed correct.

### Trace: second open/close cycle (does it re-apply and re-snapshot, or silently no-op?)

Cycle 2's `open()` → eventually `_initCanvas` → `styleSelectionControls()`:
`_controlsStyled` was reset to `false` by cycle 1's `restoreSelectionControls()`
→ the guard (`if (_controlsStyled) return;`) does **not** short-circuit → the
function runs fully again: fresh snapshot into `_savedControlsState` (capturing
whatever the prototype's values are *at that moment* — normally identical to
before, since cycle 1 just restored them, but correctly capturing anything else
that may have changed them in between), then re-applies the overrides. Cycle
2's `close()` → `restoreSelectionControls()` runs again, correctly restoring
and resetting. **Confirmed: this is not a permanent one-shot — it correctly
re-arms every open/close cycle**, which is exactly what the coordinator asked
me to verify.

### The corner case the coordinator asked me to check: does `close()`'s top guard protect `restoreSelectionControls` from running when `styleSelectionControls` never did?

I traced this rather than assuming, and found a real path worth documenting
explicitly (not just a hypothetical): `close()`'s only early-return guard is
`if (!this._stage) return;` (`SlideEditor.ts:279`) — but `this._stage` is set
by `_buildStage(slide)` (`SlideEditor.ts:166`) as the *very first* thing
`open()` does, **before** the `await this._loadSlide(index)` call that
eventually reaches `_initCanvas`/`styleSelectionControls()` (there are two
`await` points inside `_loadSlide` before it gets there: `host.prepareBackground`
and `this._loadImage`). So if the user closes the editor while a slide is
still loading — after `_buildStage` has run but before `_initCanvas` ever
does — `this._stage` is already truthy, and `close()` will **not** stop at its
top guard; it will proceed all the way through to `restoreSelectionControls()`
even though `styleSelectionControls()` was never called this cycle.

This is exactly the scenario worth checking, and it's handled correctly: in
that scenario, `_controlsStyled` is still `false` (nothing in this cycle set it
`true`, since `_initCanvas` never ran) — as long as it wasn't left stuck `true`
from some earlier cycle, which I also confirmed can't happen: `close()` has
no other early-return or throw path between its top guard and the
`restoreSelectionControls()` call (`_saveCurrent()` wraps its own body in a
try/catch internally, so it can't throw out of `close()`; everything else in
between is unconditional property clearing), so *any* `close()` call that gets
past the top guard is guaranteed to reach `restoreSelectionControls()` and
correctly toggle `_controlsStyled` back to `false` if it was `true`. That means
`_controlsStyled` can only be `true` at the start of a given `open()` cycle if
that cycle's own `_initCanvas` already ran and set it — never a stale leftover
from a previous cycle. So `restoreSelectionControls()`'s own guard
(`if (!_controlsStyled || !_savedControlsState) return;`) correctly no-ops in
the "closed while loading" scenario, and the prototype is left completely
untouched by this cycle, as it should be.

The one caveat outside this fix's scope (not something the coordinator asked
me to solve, noting it for completeness): if the page/app is torn down without
ever routing through `SlideEditor.close()` at all (e.g. the whole tab/document
unloading while the editor is open), the restore obviously never runs — but at
that point the entire JS environment including `#fabricCanvas` is also going
away, so there's nothing left to leak into.

### Self-review

- Confirmed both new module-level fields (`_controlsStyled`,
  `_savedControlsState`) are private to `OverlayFabric.ts` (not exported) —
  the only way to affect them from outside is through the two exported
  functions, so there's no risk of some other file reaching in and
  desynchronizing the pair.
- Confirmed `restoreSelectionControls` restores all 10 properties that
  `styleSelectionControls` touches — cross-checked the two property lists
  field-by-field (`cornerStyle`, `cornerColor`, `cornerStrokeColor`,
  `cornerSize`, `transparentCorners`, `borderColor`, `borderScaleFactor`,
  `padding`, `rotatingPointOffset`, `controls.mtr.render`) — no property is
  set by one function and missed by the other.
- Re-grepped `MS/` for `styleSelectionControls`/`restoreSelectionControls`/
  `_controlsStyled`: 13 matches total, all expected — the two function
  definitions and their internal guard/flag references in `OverlayFabric.ts`,
  plus exactly the import (2 lines) and the two call sites (`_initCanvas` and
  `close`) in `SlideEditor.ts`. No stray or duplicate references anywhere else
  in `MS/`.
- Still no browser available — this is a source-level trace of the open/close
  control flow, not a live interactive test of the actual visual restyle or of
  `#fabricCanvas` in `index.html`.
- No git commands were run; all edits remain uncommitted.

## Updated Status: DONE (styleSelectionControls re-added, scoped to editor open/close lifetime)
