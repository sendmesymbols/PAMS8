# Edit Engine Progress

## Goal
Add interactive move / rotate / scale / reshape to drawn military symbols in both 2D (MapView) and 3D (SceneView).

---

## Architecture Decisions

| Operation | Symbol Type | Mechanism |
|-----------|------------|-----------|
| Move | Point + Poly/Polygon | SketchViewModel `tool: "move"` / `"transform"` |
| Scale | Point | `scalePointSymbol()` — updates `drawEssentials.SIZE`, caller regenerates PictureMarkerSymbol |
| Scale | Poly/Polygon | SketchViewModel `tool: "transform"` → sync CTRL_PTS via affine math |
| Rotate | Poly/Polygon only | SketchViewModel `tool: "transform"` → sync CTRL_PTS via affine math |
| Reshape | Poly/Polygon only | Custom CTRL_PTS drag handles (rewrite of old ControlPointsEditor — Dojo version is incompatible) |

**CTRL_PTS sync strategy:** After SketchViewModel transforms the rendered geometry, compute the 2D similarity transform (translate + rotate + uniform scale) by comparing old vs new geometry centroid and first-vertex vector. Apply the same transform to every CTRL_PT and BASE_LN_PTS entry.

**Entry point:** Right-click on graphic → ContextMenuManager → `SymbolEngine.modifySymbol(graphic)` or `SymbolEngine.activateReshape(graphic)`.

**NOT reused:** `MS/Support/ControlPointsEditor.ts` — still uses Dojo/ESRI 3.x APIs, incompatible with ArcGIS 4.x.

---

## Files Changed

### `MS/Engines/EditEngine.ts` — **WRITTEN** (was empty)
Full implementation. Key methods:
- `activate(graphic)` — dispatches to point or poly edit via SketchViewModel
- `activateEditControlPoints(graphic)` — shows CTRL_PTS drag handles, redraws live via `SCOPE.createSymbol()`
- `scalePointSymbol(graphic, factor)` — updates SIZE, emits "scalePointSymbol"
- `deactivate()` — cleans up SketchViewModel, handles, pointer events
- `_syncCtrlPts()` — applies affine transform to CTRL_PTS after SketchViewModel operation
- `_setupHandleDrag()` — pointer-down/move/up handlers for reshape
- `_deAnnotate()` / `_reAnnotate()` — hide/restore labels around edit session
- Emits `"changeInSymbol"` and `"scalePointSymbol"` events

### `MS/Engines/SymbolEngine.ts` — **UPDATED**
- Imports `EditEngine`
- Creates `_editEngine` in constructor
- `onViewChanged()` deactivates old engine, creates new one for new view
- `modifySymbol()` stub → `this._editEngine.activate(graphic)`
- Added public: `activateEditControlPoints()`, `scalePointSymbol()`, `deactivateEdit()`, `editEngine` getter
- Added "Edit Control Points" + "Deactivate Control Points" to the right-click context menu

---

## Known Errors / Issues to Fix

### 0. ~~`AnnotationEngine` import resolves to `.js` (AMD module)~~ — **FIXED**
`EditEngine.ts` line 11 imported `"./AnnotationEngine"` without extension. Vite's default
`resolve.extensions` puts `.js` before `.ts`, so the old Dojo `define()`-based
`AnnotationEngine.js` was loaded, which has no `export default`.
**Fix applied:** Changed to `import AnnotationEngine from "./AnnotationEngine.ts"` (explicit `.ts`).

### 1. `SketchViewModel.update()` options type
`{ tool: "transform" }` is cast as `any` to bypass TS type mismatch. Verify the correct
ArcGIS 4.x `UpdateOptions` type import and remove the cast.
```typescript
// Current (workaround):
this._sketchVM.update([graphic], { tool: "transform" } as any);
// Fix: import correct options type or confirm API signature
```

### 2. `createSymbol()` is private on symbol classes (e.g. Ambush.ts)
`_redrawFromCtrlPts()` calls `scope.createSymbol(de)` via dynamic dispatch (`as any`).
This works at runtime but should be formalised:
- Either make `createSymbol()` `public` on all symbol classes, OR
- Define an `IEditableSymbol` interface with a `createSymbol(de: DrawEssentials): Geometry` method
  and have all tactical symbols implement it.

### 3. `AMPLIFIER` type mismatch in `_reAnnotate()`
`DrawEssentials.AMPLIFIER` is typed as `string` but is set to an `Amplifier` object at runtime.
The guard `typeof de.AMPLIFIER === "string"` skips annotation if AMPLIFIER is still the default
empty string — which is correct. But the cast `as unknown as Amplifier` is a smell.
**Fix:** Change `DrawEssentials.AMPLIFIER` type to `string | Amplifier`.

### 4. Handle layer on view switch
`EditEngine._handleLayer` is created once in the constructor from `layerManager.getOrCreateLayer()`.
When `onViewChanged()` recreates the EditEngine, a fresh handle layer is created on the new view — correct.
But if `deactivate()` is not called before view switch, old handles may linger on the old view's layer.
`onViewChanged()` in SymbolEngine already calls `_editEngine.deactivate()` first — this is correct.
**Verify:** That `deactivate()` → `_clearHandles()` runs before the new EditEngine is created.

### 5. `pointer-down` async hitTest race condition (reshape)
`_setupHandleDrag` uses `async (evt) => { ... await view.hitTest(evt) }` on pointer-down.
If `hitTest` resolves after the user has already moved, `_isDraggingHandle` is set late and the
first few `pointer-move` events are skipped. In practice this is not noticeable (hitTest is fast),
but it could be hardened:
- Store a `_pendingDragEvent` on pointer-down and process it when hitTest resolves.

### 6. `view.toMap()` in 3D (SceneView)
`view.toMap({ x, y })` in SceneView can return `null` if the ray doesn't hit the ground.
Currently guarded with `if (!mapPt) return;` — this is correct.
**Verify in 3D:** That the handles remain draggable when the camera is oblique.

### 7. Right-click opens context menu during active edit
When edit mode is active and the user right-clicks again, the context menu re-opens.
This could trigger a second `activate()` call over the existing session.
`activate()` already calls `deactivate()` first — so it is safe — but it is jarring UX.
**Optional fix:** Disable the context menu while `_editEngine` has an active session.

---

## What Still Needs to be Done

- [ ] **Fix errors listed above** — especially #1 (SketchViewModel type), #2 (createSymbol visibility), #3 (AMPLIFIER type)
- [ ] **Test move** — point symbol (UEI/TacticalPoint): right-click → Modify → drag → annotation follows
- [ ] **Test transform** — tactical polyline (Ambush): right-click → Modify → rotate/scale handles → CTRL_PTS synced correctly after completion
- [ ] **Test reshape** — tactical polygon: right-click → Reshape → blue handle dots appear → drag one → symbol redraws live
- [ ] **Test 3D** — both move and transform in SceneView
- [ ] **Test annotation** — labels disappear during edit, reappear on complete/cancel
- [ ] **Test view switch** — draw symbol in 3D → switch to 2D → edit still works
- [ ] **IEditableSymbol interface** — formalise `createSymbol()` contract across all symbol classes in `MS/Symbols/`
- [ ] **Point symbol scale UI** — decide how to expose `scalePointSymbol()` to the user (slider, +/- buttons, scroll wheel while in edit mode, etc.)
- [ ] **Context menu "Reshape"** — currently only shows for `milSymbol` and `force` graphic types; tactical line/area symbols (in TACT layer) need to be included. Update `ContextMenuManager` target layer IDs and graphic types if needed.
- [ ] **Cancel shortcut** — wire Escape key to call `symbolEngine.deactivateEdit()` for ergonomics

---

## Key Files Reference

| File                                             | Role |
|--------------------------------------------------|------|
| `MS/Engines/EditEngine.ts`                       | Main edit implementation |
| `MS/Engines/SymbolEngine.ts`                     | Public API surface, wires to EditEngine |
| `MS/Engines/AnnotationEngine.ts`                 | `annotate()` / `deAnnotate()` — already correct API |
| `MS/Managers/GraphicsLayerManager.ts`            | Layer access |
| `MS/Managers/ContextMenuManager.ts`              | Right-click triggers edit actions |
| `MS/Support/DrawEssentials.ts`                   | CTRL_PTS, BASE_LN_PTS, AMPLIFIER, SCOPE live here |
| `MS/Symbols/Ambush.ts`, `MS/Symbols/FriendlyDirOfMainAttk.ts` | Example: how createSymbol() + CTRL_PTS work |
| `MS/Support/ControlPointsEditor.ts`              | Old Dojo version — reference only, do not use |


Can we have functionality of  adding a new control point when in "Edit Control point" mode? which should automatically reshape the symbol accordingly. People add it by clicking on any part of symbol?
Visualization change
Measurement Engine
Same in 2D view
