# J · Order of Battle (ORBAT) Integration — Implementation Guide

## Overview

The ORBAT features introduce a hierarchical tree data structure that binds individual map symbols into a command-and-control relationship. This allows for cascading updates (e.g., moving a brigade moves its battalions) and automated symbol styling based on ORBAT role.

---

## Architecture

- **New file**: `MS/Engines/OrbatEngine.ts` (singleton)
- **Data structure**: internal tree representation linking graphic IDs.
- **Feature flag**: `Settings.json → features.orbatEngine`
- **Integration**: `SymbolEngine` calls `OrbatEngine` on `onDrawEnd` (auto-parenting) and `SelectionEngine` integrates for subtree selection.

---

## J1 — Auto-Parenting by Echelon and Proximity

**What it does**: When a new symbol is drawn, `OrbatEngine` automatically attempts to assign it to a parent unit based on echelon rules and spatial proximity.

**Constraints**:
- **Echelon rule**: a symbol with echelon `E` can only be parented to a symbol with echelon `E+1` (e.g., Platoon (1) parents to Company (2)). Echelon is parsed from `drawEssentials.AMPLIFIER.SIDC`.
- **Proximity check**: find all existing graphics of echelon `E+1` within `Settings.json → orbatEngine.autoParentRadiusKm`. If exactly one is found, assign it as parent. If multiple, prompt user or leave unassigned.
- **Tree Storage**: `OrbatEngine._tree: Map<string, { parentId: string|null, childrenIds: string[] }>` where keys are graphic IDs.
- **Visual Cue**: when auto-parented, temporarily render a dotted blue line from the child to the parent (fades out after 2 seconds) on `"DrawingCueLayer"`.
- Emit `"orbat-tree-changed"` on document when parenting occurs.

---

## J2 — Subtree Selection & Movement

**What it does**: Double-clicking a parent unit selects it and all its descendents in the ORBAT tree. Moving the parent translates the entire subtree, maintaining relative spacing.

**Constraints**:
- **Selection**: hook into `SelectionEngine`. On double-click (or a specific UI button "Select Subtree"), `OrbatEngine.getSubtree(parentId)` recursively fetches all descendant graphic IDs. Add them all to `SelectionEngine._selectedGraphics`.
- **Relative Movement**: when `SelectionEngine` translates the group, all children move by the same delta `(dx, dy)`. This is handled naturally by `SelectionEngine` if all items are selected.
- **Formation Rotate**: if the parent is rotated, the children should ideally orbit the parent. `SelectionEngine`'s rotate handle should apply a transformation matrix relative to the parent's centroid.

---

## J3 — Command Relationship Lines (C2 Links)

**What it does**: Visualise the ORBAT tree on the map as a network of lines connecting parents to children.

**Constraints**:
- **Toggle**: activated via a HUD button (G3), not always on.
- **Rendering**: when enabled, `OrbatEngine.renderC2Links()` draws Polyline graphics on `"orbat-layer"`. Each line connects the centroid of a parent to the centroid of a child.
- **Style**: thin, dashed, black line `[0, 0, 0, 0.8]`.
- **Dynamic updating**: on `onDrawProgress` (if a unit is being moved) or `view.watch("extent")`, update the geometries of the C2 lines connected to the moving graphic.

---

## J4 — ORBAT Tree UI Panel

**What it does**: A collapsible tree-view UI component alongside the map showing the hierarchical ORBAT. Clicking a node pans the map to that symbol.

**Constraints**:
- **Component**: `MS/HUD/OrbatPanel.ts`. Subscribes to `"orbat-tree-changed"`.
- **Display**: standard nested list `<ul>` `<li>`. Each node shows the symbol's `UNIQUE_DESIG` and a small image of the symbol (generated via `SymbolEngine.getSymbolForSIDC`).
- **Interaction**:
  - Click node: select graphic via `SelectionEngine`.
  - Double-click node: `view.goTo(graphic)` (pan/zoom to symbol).
  - Drag-and-drop nodes in UI: re-parent symbols. Calls `OrbatEngine.setParent(childId, newParentId)`.

---

## J5 — Task Organisation Status

**What it does**: Roll up combat effectiveness or status (e.g., fuel/ammo levels) from children to parent. Parent symbol reflects aggregated status.

**Constraints**:
- **Status Data**: stored in `graphic.attributes.status = { ammo: %, fuel: %, personnel: % }`.
- **Aggregation**: `OrbatEngine.aggregateStatus(parentId)` recursively averages the percentages of all descendants.
- **Visualisation**: if aggregate status drops below a threshold (e.g., < 50%), add a red warning icon or change the `AnnotationEngine` label colour for the parent symbol.

---

## Settings.json Additions

```json
"features": { "orbatEngine": true },
"orbatEngine": {
  "autoParentRadiusKm": 10,
  "showC2LinksDefault": false
}
```

---

## Implementation Order

1. Implement `OrbatEngine.ts` core data structure (`_tree`) and `setParent()`.
2. Add J1 auto-parenting logic hooked to `onDrawEnd`.
3. Add J3 C2 line rendering on toggle.
4. Implement J2 subtree selection in `SelectionEngine`.
5. Build J4 ORBAT Panel UI component.
