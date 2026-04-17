※ recap: Implementing new features for the PAMS8 military symbol library. Features 0 (shortcut keys), 1 (undo/redo), 2
(multi-select), and 3 (copy/paste) are done and building cleanly. Next: Feature 5 — Save/Load Symbol Configurations.
(disable recaps in /config)
Make sure workflows are never overlaped to save from unexpcted bugs, before startig and operation, we need to close the other workflow.

# New Features — PAMS8 Symbol Engine

## Global Requirements
- [ ] All features controllable via `MS/settings.json` (enabled by default) — **NOT STARTED**
- [x] All features work in both 3D and 2D view — **DONE** (EditEngine + MeasurementEngine work in both views)
- [x] All features accessible via right-click context menu — **DONE** (ContextMenuManager in place)
- [ ] All context menu items show shortcut key hints — **NOT STARTED**
- [x] All features coded inside `MS/`, entry point `MS/Engines/SymbolEngine.ts` — **DONE**

---

## Feature 0 — Context Menu Polish + Shortcut Keys `[ DONE ]`

### 0.1 Rename existing menu items ✓
- [x] "Modify Symbol" → **"Move, Scale, Rotate"** — visible only when NOT already modifying
- [x] **"Disable Move, Scale, Rotate"** — visible only when modify is active; calls `deactivateEdit()`
- [x] "Edit Control Points" — visible only when NOT in control-point mode
- [x] "Deactivate Control Points" — visible only when in control-point mode

### 0.2 Shortcut keys ✓
Shortcut hints rendered right-aligned in every menu item. Global `keydown` listener in
`SymbolEngine._setupKeyboardShortcuts()` — enabled via `Settings.json features.shortcuts`.

| Action | Shortcut |
|--------|----------|
| Move, Scale, Rotate | `M` |
| Disable Move, Scale, Rotate | `Esc` |
| Edit Control Points | `E` |
| Deactivate Control Points | `Esc` |
| Remove | `Del` |
| Center On | `C` |
| Show Details | `I` |
| Undo | `Ctrl+Z` _(reserved — Feature 1)_ |
| Redo | `Ctrl+Y` / `Ctrl+Shift+Z` _(reserved — Feature 1)_ |
| Copy | `Ctrl+C` _(reserved — Feature 3)_ |
| Paste | `Ctrl+V` _(reserved — Feature 3)_ |

**Files changed:** `MS/Engines/EditEngine.ts`, `MS/Engines/SymbolEngine.ts`,
`MS/Managers/ContextMenuManager.ts`, `MS/Data/Settings.json`

---

## Feature 1 — Undo / Redo Stack `[ DONE ]`

Command-pattern implementation — each entry has a `label`, `undo()`, and `redo()` closure.

**Push points:** `drawSymEnd` (Add), `removeGraphic` (Remove), EditEngine `changeInSymbol` (Move/Scale/Rotate/Reshape).
**Labels:** "Add Symbol", "Remove Symbol", "Move, Scale, Rotate", "Edit Control Points"
**Public API:** `undo()`, `redo()`, `undoCount`, `redoCount`, `nextUndoLabel`, `nextRedoLabel`
**Keyboard:** `Ctrl+Z` → undo, `Ctrl+Y` / `Ctrl+Shift+Z` → redo
**Context menu:** "Undo \<label\>" / "Redo \<label\>" (greyed out when stack is empty) — in "History" group
**Settings:** respects `features.shortcuts` flag; undo/redo always work regardless (shortcuts flag only hides menu items)
**View switch:** `_wireEditEngineUndo()` re-called in `onViewChanged()` for new EditEngine instance
**Files:** `MS/Engines/SymbolEngine.ts` (UndoEntry interface, stacks, all methods)

---

## Feature 2 — Multi-Select + Batch Operations `[ DONE ]`
_(No settings.json toggle — must-have)_

**SelectionEngine** (`MS/Engines/SelectionEngine.ts`) — dedicated class, wired into SymbolEngine.

- [x] **Left-click** a symbol → select it (clears others); **Shift+click** → toggle in/out of selection
- [x] **Click empty ground** → clear selection
- [x] **Blue highlight** overlay on every selected graphic (point = circle outline, line = dashed, polygon = fill + outline)
- [x] **Move Selected** — proxy bounding-box drag via SketchViewModel; delta applied to all selected graphics + CTRL_PTS/BASE_LN_PTS; undoable
- [x] **Delete Selected** — removes all, one compound undo entry (`Delete N Symbols`)
- [x] **Distribute Horizontal** — equal X spacing along a horizontal line at mean Y
- [x] **Distribute Vertical** — equal Y spacing along a vertical line at mean X
- [x] **Arrange Square** — grid layout centred on collective centroid
- [x] **Arrange Triangle** — 1-2-3-... row formation
- [x] **Arrange Inverted Triangle** — ...-3-2-1 row formation
- [x] All align/arrange operations are undoable
- [x] **Del** key batch-deletes when count > 1; otherwise removes the right-clicked graphic
- [x] All batch operations visible in context menu only when `selectionEngine.count > 1`
- [x] `selectionEngine.onViewChanged()` called in `SymbolEngine.onViewChanged()` — 2D/3D safe
- [x] `SymbolEngine.selectionEngine` public getter for host app access

**Files:** `MS/Engines/SelectionEngine.ts` (new), `MS/Engines/SymbolEngine.ts`, `MS/Managers/GraphicsLayerManager.ts` (added `SELECTION_HIGHLIGHT` layer name), `MS/Managers/ContextMenuManager.ts` (label function signature extended)

---

## Feature 3 — Copy / Paste Symbols `[ DONE ]`

```typescript
copySymbol(graphic: Graphic): void           // stores deep-cloned graphic + layer ID
pasteSymbol(targetPoint: Point): Graphic     // offsets geometry centroid to targetPoint, adds to layer
```

- `Ctrl+C` copies last right-clicked symbol to internal clipboard.
- `Ctrl+V` enters paste mode — next map click places the copy; Escape cancels.
- Context menu: **Copy Symbol `Ctrl+C`** (always shown), **Paste Symbol `Ctrl+V`** (visible only when clipboard is non-empty).
- Paste pushes an undo entry ("Paste Symbol") — undoable.
- Annotation re-created on paste; destroyed on undo.
- `hasClipboard` getter for host app UI state.
- `Settings.json features.copyPaste` controls visibility (enabled by default).
- **Files:** `MS/Engines/SymbolEngine.ts`, `MS/Data/Settings.json`

---

## Feature 5 — Save / Load Symbol Configurations `[ NOT STARTED ]`

```typescript
saveSymbolToJSON(graphic: Graphic): object
loadSymbolFromJSON(data: object): Graphic
exportLayerToJSON(): object[]          // all graphics across all layers
importLayerFromJSON(data: object[]): void
```

- Serialises `drawEssentials`, `AMPLIFIER`, geometry, layer ID, graphicType.
- "Save to File" triggers a browser download of a `.json` file.
- "Load from File" opens a file picker.
- Context menu items: **Save Symbol** / **Save All Symbols** / **Load Symbols**.

---

## Feature 6 — Export Symbols `[ NOT STARTED ]`

```typescript
exportToSVG(graphic: Graphic): string
exportToPNG(graphic: Graphic, scale?: number): Promise<Blob>
exportToGeoJSON(): object              // full layer export with all attributes
```

- Context menu: **Export → SVG / PNG / GeoJSON**.
- SVG export for reports/briefings.
- PNG export with configurable scale.
- GeoJSON export includes all amplifier attributes as `properties`.

---

## Feature 7 — Symbol Templates `[ NOT STARTED ]`

```typescript
saveAsTemplate(name: string, drawEssentials: DrawEssentials, amplifier: Amplifier): void
loadTemplate(name: string): { drawEssentials: DrawEssentials; amplifier: Amplifier }
listTemplates(): string[]
deleteTemplate(name: string): void
```

- Templates persisted to `localStorage` (key: `pams8_templates`).
- Example: template "Phase Line Alpha" with `TEXT_AMPLIFIER = "PL ALPHA"`.
- Context menu: **Save as Template…** / **Apply Template →** (sub-menu of saved templates).

---

## Feature 10 — Snapping `[ NOT STARTED ]`

Snap to:
- Other symbol centres
- Symbol corners / control points
- Grid (configurable interval in metres)

- Visual snap indicator (crosshair or highlight ring) shown during draw/edit.
- Configurable snap distance in `MS/settings.json`.
- Toggle: context menu **Enable Snapping** / **Disable Snapping**.
- Shortcut: `S` to toggle snapping on/off.

---

## Implementation Order (Recommended)

1. **Feature 0** — Quick win; polish that makes every other feature feel finished.
2. **Feature 1** — Undo/Redo. Foundational; needs to be in place before multi-edit or batch ops.
3. **Feature 3** — Copy/Paste. Small, high-value.
4. **Feature 2** — Multi-Select + Batch. Builds on move/scale/delete already in EditEngine.
5. **Feature 5** — Save/Load. Enables project persistence.
6. **Feature 7** — Templates. Builds on Save/Load JSON.
7. **Feature 6** — Export. Mostly standalone; depends on symbol rendering being stable.
8. **Feature 10** — Snapping. Most complex geometry work; leave for last.

---

## Completed Features (Prior Work)

| Feature | File | Notes |
|---------|------|-------|
| EditEngine (Move/Scale/Rotate/Reshape) | `MS/Engines/EditEngine.ts` | SketchViewModel-based; works in 2D + 3D |
| Edit Control Points (CTRL_PTS drag handles) | `MS/Engines/EditEngine.ts` | Live redraw via `createSymbol()` |
| MeasurementEngine | `MS/Engines/MeasurementEngine.ts` | Length/area/perimeter; linked to context menu |
| ContextMenuManager | `MS/Managers/ContextMenuManager.ts` | Right-click on any graphic; measurement section built-in |
| AnnotationEngine | `MS/Engines/AnnotationEngine.ts` | Labels hidden during edit, restored on complete |
| 2D view support | All engines | Confirmed working in MapView |



0 — Shortcut Keys                │ ✅ Done            │
├──────────────────────────────────┼────────────────────┤
│ 1 — Undo / Redo                  │ ✅ Done            │
├──────────────────────────────────┼────────────────────┤
│ 2 — Multi-Select + Batch         │ ✅ Done            │
├──────────────────────────────────┼────────────────────┤
│ 3 — Copy / Paste                 │ ✅ Done            │
├──────────────────────────────────┼────────────────────┤
│ 5 — Save / Load                  │ ✅ Done (just now) │
├──────────────────────────────────┼────────────────────┤
│ 7 — Templates                    │ ✅ Done (just now) │
├──────────────────────────────────┼────────────────────┤
│ 6 — Export (SVG / PNG / GeoJSON) │ ❌ Not started     │
├──────────────────────────────────┼────────────────────┤
│ 10 — Snapping                    │ ❌ Not started