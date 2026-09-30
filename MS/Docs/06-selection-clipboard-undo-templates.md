# 06 - Selection, Clipboard, Undo/Redo, Templates, Shortcuts

This document covers multi-symbol selection (`SelectionEngine`, `SelectionActionPanel`), the clipboard (`ClipboardEngine`), the undo/redo stack (`UndoRedoManager`), saved templates (`TemplateEngine`), the global keyboard shortcuts (`KeyboardShortcutManager`) and the context-menu hooks a host can use (`ContextMenuManager`).

Related documents: [02-symbol-engine-api.md](02-symbol-engine-api.md), [03-drawing-and-events.md](03-drawing-and-events.md), [04-support-classes.md](04-support-classes.md), [05-editing-morphix.md](05-editing-morphix.md), [07-import-export.md](07-import-export.md), [08-settings.md](08-settings.md).

## Contents

| Area | Reached through | Section |
| --- | --- | --- |
| Selection, lasso, filters, align, distribute, arrange | `symbolEngine.selectionEngine` | [SelectionEngine](#selectionengine) |
| Quick toolbar (bottom-centre) | Setting `features.selectionQuickToolbar` | [SelectionActionPanel](#selectionactionpanel) |
| Copy, paste, duplicate | `symbolEngine.copySymbol`, `pasteSymbol`, `duplicateSelection`, ... | [Clipboard](#clipboard) |
| Undo, redo, stack info | `symbolEngine.undo`, `redo`, `undoCount`, ... | [UndoRedoManager](#undoredomanager) |
| Saved templates | `TemplateEngine` (not wired into `SymbolEngine`) | [TemplateEngine](#templateengine) |
| Key bindings | Automatic; gated by settings | [Keyboard shortcuts](#keyboard-shortcuts) |
| Right-click menu extension | `symbolEngine.contextMenuManager` | [Context menu hooks](#context-menu-hooks) |

`SymbolEngine` keeps `ClipboardEngine`, `UndoRedoManager`, `SelectionActionPanel` and `KeyboardShortcutManager` as private members. Only `selectionEngine`, `editEngine` and `contextMenuManager` are public getters. The other engines are reached through the `SymbolEngine` methods documented here.

## SelectionEngine

`symbolEngine.selectionEngine` returns the `SelectionEngine`. It tracks a set of selected graphics keyed by `attributes.id`, draws a highlight for each, and offers batch operations. It listens on the symbol layers (`SYMBOL_LAYER_IDS`).

### Pointer gestures

| Gesture | Effect |
| --- | --- |
| Left-click a symbol | Replace the selection with that symbol |
| Shift + left-click a symbol | Toggle the symbol in or out of the selection |
| Left-click empty map | Clear the selection |
| Shift + left-click empty map | Nothing (selection kept) |
| Ctrl/Cmd + Shift + drag a symbol | Clone-drag: duplicates the symbol (or the whole selection if the symbol is part of it), selects the copies and drags them. One undo entry: `Clone and Move N Symbol(s)`. Right/middle buttons are ignored for selection clicks. |
| Pointer hover | Hover highlight (suppressed while drawing or clone-dragging) |

Clone-drag is skipped only if `features.copyPaste === false`. That key is not present in the shipped `Settings.json` (the clipboard flag there is `features.clipboard`), so in practice clone-drag is always available; this is a mismatch in the source.

### Event

```ts
const h = symbolEngine.selectionEngine.on('selectionChange', ({ selected }) => {
  console.log(selected.length, 'selected');
});
h.remove();
```

`on(type: string, listener: Function): { remove(): void }`

| Event | Payload | Emitted when |
| --- | --- | --- |
| `selectionChange` | `{ selected: Graphic[] }` | A symbol is selected or deselected, or the selection is cleared. Emitted once per changed symbol, so a bulk select fires it many times. `rebaseSelection` is silent by design. |

`SelectionEngine` listeners are not copied across a view switch automatically, but the `SelectionEngine` instance itself is kept (it is re-attached via `onViewChanged`), so a registration made on `symbolEngine.selectionEngine` survives.

### State

| Member | Type | Meaning |
| --- | --- | --- |
| `selectedGraphics` | `Graphic[]` (getter) | Snapshot array of the current selection |
| `count` | `number` (getter) | Number selected |
| `isLassoActive` | `boolean` (getter) | A lasso sketch is in progress |
| `isSelected(graphic)` | `boolean` | By `attributes.id` |
| `selectGraphic(graphic)` | `void` | Add to selection (no-op if already selected or no id) |
| `deselectGraphic(graphic)` | `void` | Remove from selection |
| `toggleGraphic(graphic)` | `void` | Toggle |
| `clearSelection()` | `void` | Clear everything, emits `selectionChange` with `[]` |
| `rebaseSelection(id: string, graphic: Graphic)` | `void` | Re-point an existing selected id at a replacement Graphic instance, silently. Used after `updateSymbol`. |
| `resolveLive(graphic)` | `{ graphic, layer } \| null` | Map a possibly-stale Graphic to the instance currently on the map (matches by `attributes.id`) and its layer |
| `findContainingLayer(graphic)` | `GraphicsLayer \| null` | Layer that currently holds the graphic |
| `getGraphicGeomType(graphic)` | `string \| null` | `drawEssentials.SYM_GEO_TYPE`, else derived from geometry: `'Point'`, `'Line'`, `'Area'` |

### Lasso

#### lassoSelect(opts?, onComplete?): void

Starts a polygon sketch. When the user finishes, every symbol on the selectable layers whose geometry intersects the polygon is selected.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `opts.freehand` | `boolean` | `false` | Freehand stroke (release to finish) instead of click-per-vertex (double-click to finish) |
| `opts.addToSelection` | `boolean` | `false` | Keep the current selection and add to it. Without it the selection is cleared first. |
| `opts.subtract` | `boolean` | `false` | Deselect the currently selected symbols inside the polygon instead of selecting. Uses a red sketch style. |
| `onComplete` | `(selected: Graphic[]) => void` | none | Called with the newly selected graphics, or, in subtract mode, the graphics that were removed from the selection. Not called if the sketch is cancelled. |

A new call cancels any lasso already running.

#### cancelLasso(): void

Cancels a running lasso and clears the temporary layer. Does not change the selection.

```ts
const se = symbolEngine.selectionEngine;
if (se.isLassoActive) se.cancelLasso();
else se.lassoSelect({}, (picked) => console.log(picked.length, 'selected'));
```

### Select by criteria

`SelectMode` (exported type) is `'replace' | 'add' | 'refine'`:

| Mode | Effect |
| --- | --- |
| `replace` | Clear the selection, then select all matches |
| `add` | Union: keep the selection and add matches |
| `refine` | Intersection: keep only currently selected symbols that match (no map scan) |

| Method | Signature | Matches |
| --- | --- | --- |
| `selectAll` | `(mode: SelectMode = 'replace')` | Every symbol with geometry |
| `invertSelection` | `()` | Deselect selected, select unselected |
| `selectPointSymbols` | `(mode = 'replace')` | `SYM_GEO_TYPE` `Point` or `FPoint` |
| `selectLineSymbols` | `(mode = 'replace')` | `Line` or `Polyline` |
| `selectAreaSymbols` | `(mode = 'replace')` | `Area` or `Polygon` |
| `selectOwnOnly` | `(mode = 'replace')` | Identity code `03` (Friend) or `02` (Assumed Friend) |
| `selectEnemy` | `(mode = 'replace')` | Identity code `06`, `05` or `07` |
| `selectByIdentity` | `(code: string, mode = 'replace')` | Exactly this two-character identity code. Empty code does nothing. |
| `selectByEchelon` | `(code: string, mode = 'replace')` | Exactly this two-character echelon code. Empty code does nothing. |
| `selectSimilarSameSIDC` | `(graphic: Graphic)` | Replace selection with every symbol sharing the graphic's symbol code (SIDC positions 10-16) |
| `selectSimilarSameEchelon` | `(graphic: Graphic)` | Replace selection with every symbol sharing the graphic's echelon (SIDC positions 8-10) |
| `selectWithinRadius` | `(center: Graphic, meters: number, mode = 'replace')` | Symbols intersecting a geodesic buffer of `meters` around the graphic's point / polygon centroid / extent centre. Does nothing if `meters` is not greater than 0. |
| `selectWithin` | `(graphic: Graphic, includeSelf = false)` | Symbols intersecting the given polyline or polygon (a polyline is treated as a polygon ring). Always replaces the selection. Points are ignored. |

Identity and echelon codes are read from the SIDC as substrings, not as parsed fields. The identity code is `SIDC[2..4]` (the context digit followed by the standard-identity digit) and the echelon code is `SIDC[8..10]`. Consequences:

- A code such as `03` means "real-world, friend". An exercise-context friend symbol has `13` and is not matched by `selectOwnOnly`.
- `getPresentIdentities()` labels only these codes: `01` Unknown, `02` Assumed Friend, `03` Friend, `04` Neutral, `05` Suspect, `06` Hostile, `07` Hostile (Red). Any other code is labelled `Identity <code>`.
- Echelon codes `11` Team/Crew, `12` Squad, `13` Section, `14` Platoon/Detachment, `15` Company/Battery/Troop, `16` Battalion/Squadron, `17` Regiment/Group, `18` Brigade, `21` Division, `22` Corps/MEF, `23` Army, `24` Army Group/Front, `25` Region/Theater, `26` Command are labelled; any other code is labelled `Echelon <code>`.

Discovery helpers for building filter UIs:

| Method | Returns |
| --- | --- |
| `hasIdentity(code: string)` | `boolean`, any drawn symbol has this identity code |
| `hasEchelon(code: string)` | `boolean` |
| `getPresentIdentities()` | `{ code: string; label: string; count: number }[]`, sorted by code |
| `getPresentEchelons()` | `{ code: string; label: string; count: number }[]`, sorted by code |

### Batch move and delete

#### moveSelected(onComplete?): void

Shows a dashed bounding-box proxy around the selection and lets the user drag it. On completion the same map-unit offset is applied to every selected symbol (geometry, `CTRL_PTS`, `BASE_LN_PTS`) and labels are refreshed. Does nothing if the selection is empty.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `onComplete` | `(r: { graphics: Graphic[]; dx: number; dy: number }) => void` | none | Called after the move. `moveSelected` itself records no undo entry, so push one here. |

```ts
const se = symbolEngine.selectionEngine;
se.moveSelected(({ graphics, dx, dy }) =>
  symbolEngine._pushUndo({
    label: `Move ${graphics.length} Symbols`,
    undo: () => se._applyDelta(graphics, -dx, -dy),
    redo: () => se._applyDelta(graphics, dx, dy),
  }),
);
```

`_applyDelta(graphics, dx, dy, refreshAnnotations = true)` is public but underscore-prefixed, and `_pushUndo` likewise. This is the pattern the built-in menu and `index.html` use; there is no non-underscore alternative.

`cancelMove(): void` cancels an in-progress `moveSelected`, keeping the selection.

#### deleteSelected(onEntry?): void

Removes every selected symbol and its labels, clears the selection, and reports one undo entry through `onEntry` (`{ label: 'Delete N Symbol(s)', undo, redo }`). If `onEntry` is omitted the deletion cannot be undone.

#### deleteGraphic(graphic, onEntry?): void

Deletes one symbol and its labels (clearing the selection); entry label `Delete Symbol`.

```ts
symbolEngine.selectionEngine.deleteSelected((entry) => symbolEngine._pushUndo(entry));
```

### Align, distribute, arrange

All of these need at least two selected symbols (they do nothing otherwise) and operate on symbol centroids or extents in map units. Each takes an optional `onEntry?: (e: { label: string; undo: () => void; redo: () => void }) => void`. If it is omitted, the change is applied but no undo entry is produced; pass `(e) => symbolEngine._pushUndo(e)` to make it undoable.

| Method | Effect | Undo label |
| --- | --- | --- |
| `alignHorizontal(onEntry?)` | Spread evenly along X between the outermost centroids, all on the average Y | `Align Horizontal` |
| `alignVertical(onEntry?)` | Spread evenly along Y, all on the average X | `Align Vertical` |
| `alignLeft(onEntry?)` | Left edges to the leftmost edge | `Align Left` |
| `alignRight(onEntry?)` | Right edges to the rightmost edge | `Align Right` |
| `alignTop(onEntry?)` | Top edges to the topmost edge | `Align Top` |
| `alignBottom(onEntry?)` | Bottom edges to the lowest edge | `Align Bottom` |
| `centerOnX(onEntry?)` | Centroids share the centre X of the group extent | `Center on X` |
| `centerOnY(onEntry?)` | Centroids share the centre Y | `Center on Y` |

Arrange methods place the symbols in a formation centred on their collective centroid. Signature for all: `(spacing?: number, onEntry?: (e) => void): void`.

| Method | Formation | Undo label |
| --- | --- | --- |
| `arrangeSquare` | Square grid | `Arrange Square` |
| `arrangeTriangle` | One at the front, widening to the rear | `Arrange Triangle` |
| `arrangeInvertedTriangle` | Wide front, narrowing to the rear | `Arrange Inverted Triangle` |
| `arrangeWedge` | V shape, one lead symbol, two arms trailing back | `Arrange Wedge` |
| `arrangeEchelonLeft` | Diagonal staircase trailing left and rear | `Arrange Echelon Left` |
| `arrangeEchelonRight` | Diagonal staircase trailing right and rear | `Arrange Echelon Right` |
| `arrangeColumn` | Single file north-south | `Arrange Column` |
| `arrangeLine` | Single file east-west | `Arrange Line` |
| `arrangeDiamond` | Perimeter of a rotated square | `Arrange Diamond` |
| `arrangeCircle` | Evenly around a circle | `Arrange Circle` |

`spacing` is in map units (the view's spatial-reference units, not metres in Web Mercator). When omitted, the mean nearest-neighbour distance of the current selection is used, or 60 screen pixels of map resolution if all centroids coincide.

### Selection context-menu items

`buildContextMenuItems(pushUndo, closeActiveWorkflow): ContextMenuItem[]` builds the Selection and Align/Arrange submenus (Lasso Select, Clear Selection, Select All, Invert Selection, Move Selected, Delete Selected, Select Similar, affiliation and echelon filters, within-radius). It is used internally by `SymbolEngine`.

### Other members

`activate(targetLayerIds: string[])`, `deactivate()`, `onViewChanged(newView)`, `setDrawing(drawing: boolean)`, `setAnnotationRefreshCallback(fn)` and `setCloneDragCallbacks(cb)` are called by `SymbolEngine` during construction and view switches. A host does not need them.

### Grouping

`SelectionEngine` and `SelectionActionPanel` have no group / ungroup operation. Selection is a transient set; there is no persistent group entity in the source.

## SelectionActionPanel

A floating toolbar at the bottom-centre of the map that appears whenever the selection is non-empty. It hides while a Move/Scale/Rotate or control-point session is active (the edit banner takes its place) and when the selection is empty.

| Aspect | Detail |
| --- | --- |
| Enable / disable | `features.selectionQuickToolbar` (default `true`). Toggling it at runtime enables or disables the panel. |
| Tabs | Transform, Align, Distribute, Arrange, Filter. |
| Adapts to | Selection shape: single point, single line/area, multiple points, multiple lines or multiple areas, or mixed. |
| Behaviour | Draggable, minimizable, placed beside the selected symbol until the user moves it. |
| Filter tab | Mode switch replace / add / refine (`SelectMode`), select all, invert, points, lines, areas, side and echelon dropdowns listing only codes present on the map, and a "within radius" input (metres, default 1000) measured from the first selected symbol. |
| Arrange tab | Ten icon buttons, one per `arrange*` method (Line, Column, Square, Triangle, Inverted triangle, Wedge, Echelon left, Echelon right, Diamond, Circle), called with automatic spacing. |

Every button calls an existing `SelectionEngine` / `SymbolEngine` method, so the panel adds no capability that is not available in code. `SelectionActionPanel` is constructed by `SymbolEngine`; its public members (`enable()`, `disable()`, `refresh()`, `rewireEditEngine()`) are not exposed through a `SymbolEngine` getter.

## Clipboard

`ClipboardEngine` is private inside `SymbolEngine`. Use the facade methods below. All of them are no-ops when `features.clipboard === false`, and switching that setting off also empties the clipboard. There is no cut operation: to move a symbol use copy, paste, then delete.

### copySymbol(graphic: Graphic): void

Stores a clone of the symbol in the internal clipboard. If `graphic` belongs to a multi-selection (more than one selected), the whole selection is copied; otherwise only that graphic. Each item remembers its layer.

Side effects: emits `symbolCopied`, and arms paste mode immediately, so the next map click pastes (see below). Press `Escape` to disarm.

### pasteSymbol(targetPoint: Point, expandDistance?: number, expandUnit?: string): Graphic | null

Pastes the clipboard around `targetPoint`.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `targetPoint` | `Point` | required | Where to place the paste. Its `z` (if any) overrides pasted point elevations. |
| `expandDistance` | `number` | `0` | Multi-item pastes only: positive spreads item centres away from the target, negative contracts them |
| `expandUnit` | `string` | `'meters'` | Unit for `expandDistance`. The dialog offers `meters`, `kilometers`, `miles`, `nautical-miles`. |

A single item is centred on `targetPoint`. Several items keep their relative layout with the collective centroid on `targetPoint`. Each pasted symbol gets a new `attributes.id`, its `CTRL_PTS`, `BASE_LN_PTS`, `GEOM` and `OPTIONS.GEOM` are shifted with it, and labels are recreated. Returns the first pasted graphic, or `null` if the clipboard is empty.

Side effects: one undo entry (`Paste Symbol` or `Paste N Symbols`); emits `symbolPasted`.

### duplicateSelection(): void

Duplicates the current selection in place, offset by 18 screen pixels right and down (based on the view resolution), without touching the clipboard. The copies become the new selection, so repeated calls stamp a row of duplicates. Does nothing if nothing is selected. Undo label `Duplicate N Symbol(s)`. Emits `symbolPasted`.

### hasClipboard: boolean

Getter. True when the clipboard holds items.

### Paste modes

| Method | Effect |
| --- | --- |
| `_activatePasteMode(): void` | Next map click pastes at the click point; a cursor hint reads "Click to Paste, or CTRL+SHIFT+V for more options". `Escape` cancels. Does nothing if the clipboard is empty. |
| `_activatePasteModeWithOffset(expandDistance: number, expandUnit: string): void` | Same, with an expand/contract distance applied. |
| `_showPasteOffsetDialog(): void` | Opens the "Paste Offset" dialog (element `#pasteOffsetDialog`) with modes Exact Location, Direction and Offset (distance, unit, one of eight compass bearings) and Pick Center Point, plus Expand/Contract. Does nothing (logs a warning) if the clipboard is empty. |

These three are public methods with an underscore prefix; they are the only way to arm paste from code.

### Events

Dispatched as bubbling, cancelable `CustomEvent`s on the view container (same mechanism as the other DOM events).

| Event | `detail` | Emitted when |
| --- | --- | --- |
| `symbolCopied` | `{ graphic: Graphic, count: number }` | After `copySymbol` |
| `symbolPasted` | `{ graphic: Graphic, graphics: Graphic[], count: number }` | After a paste or a duplicate. `graphic` is the first pasted symbol. |
| `pasteMode` | `{ active: boolean }` | Paste mode armed (`true`) or ended by a paste, `Escape`, cancel or view switch (`false`) |

```ts
symbolEngine.view.container.addEventListener('symbolPasted', (e) => {
  const { graphics } = (e as CustomEvent).detail;
  console.log('pasted', graphics.length);
});
```

Paste mode and any open clipboard listeners are cancelled on a 2D/3D view switch.

## UndoRedoManager

The undo/redo stacks are owned by `UndoRedoManager` (private in `SymbolEngine`). Entries are closures:

```ts
interface UndoEntry {
  label: string;
  undo: () => void;
  redo: () => void;
}
```

### SymbolEngine API

| Member | Signature | Meaning |
| --- | --- | --- |
| `undo()` | `(): void` | Pop and run the last entry, move it to the redo stack. No-op if empty. |
| `redo()` | `(): void` | Reverse of `undo`. |
| `undoCount` | `number` (getter) | Entries available to undo |
| `redoCount` | `number` (getter) | Entries available to redo |
| `nextUndoLabel` | `string \| null` (getter) | Label of the next undo, `null` if empty |
| `nextRedoLabel` | `string \| null` (getter) | Label of the next redo, `null` if empty |
| `_pushUndo(entry: UndoEntry)` | `void` | Push a custom entry and clear the redo stack. Public despite the underscore; `SelectionEngine` methods take entries through callbacks that end here. |
| `clearAllGraphics()` | `void` | Removes all graphics from every managed layer and clears both undo stacks |

`undo()` / `redo()` write a line to the Engine Log and the console. There is no undo/redo event; poll the counters or wrap the calls if the host needs to react.

### Limits and rules

- The undo stack holds at most 100 entries. When full, the oldest entry is dropped.
- Pushing a new entry clears the redo stack.
- There is no persistence: stacks live in memory and are cleared by `clearAllGraphics()`.
- A pre-edit snapshot (geometry, `CTRL_PTS`, `BASE_LN_PTS`) is taken by `modifySymbol` and `activateEditControlPoints`. The manager listens for `EditEngine`'s `changeInSymbol` and turns the first event after a snapshot into one entry (see [05](05-editing-morphix.md)).

### What is recorded

| Operation | Label |
| --- | --- |
| Drawing/placing a symbol | `Add <symbol name>` (or `Add Symbol`) |
| Remove (context menu, `Delete` key) | `Remove Symbol` |
| Delete selection | `Delete N Symbol(s)` / `Delete Symbol` |
| Details edit (`updateSymbol`, editor Save) | `Edit Symbol Details` |
| Move, Scale, Rotate | `Move, Scale, Rotate` |
| Edit Control Points | `Edit Control Points` (first change of a session only) |
| Move Selected (menu) | `Move N Symbols` |
| Align, arrange | Labels in the tables above, only when `onEntry` is supplied |
| Paste, duplicate | `Paste Symbol`, `Paste N Symbols`, `Duplicate N Symbol(s)` |
| Clone-drag | `Clone and Move N Symbol(s)` |

Not recorded: selection changes, settings changes, analysis overlays. Whether plan loads or imports push entries was not verified.

## TemplateEngine

`TemplateEngine` (`MS/Engines/TemplateEngine.ts`, default export) saves a symbol's style and amplifier data under a name and applies it to another symbol.

Important: `SymbolEngine` does not construct a `TemplateEngine` and exposes no getter for one. Nothing in the library or in `src/main.ts` instantiates it, and `features.templates` (a checkbox in the harness Settings panel) is not read by any code that creates it. A host that wants named templates must create its own instance. Because the shipped entry point is `MS/Engines/SymbolEngine.ts`, whether `TemplateEngine` is importable from the minified build depends on how the package is consumed; verify it against `dist/MS` before relying on it.

`MS/Data/Templates.json` is unrelated: it is a catalog of form-field definitions (Echelon, Enemy Post, Own Post, Weapon Type, ...), not saved templates.

### Constructor

`new TemplateEngine(getLayerManager: () => GraphicsLayerManager, textSize?: number, labelOptions?: any)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `getLayerManager` | `() => GraphicsLayerManager` | required | Called once at construction |
| `textSize` | `number` | `12` | Label text size used when re-annotating |
| `labelOptions` | `any` | `{}` | Label style used when re-annotating |

`updateOptions(textSize?: number, labelOptions?: any): void` changes those two later.

### Storage

Templates are stored in `localStorage` under the key `pams8_templates` as one JSON object keyed by template name. Reads that fail to parse return an empty store. Writes are not wrapped in try/catch in `saveAsTemplate`, `deleteTemplate`, `saveTemplateToFile` and `applyTemplateData`, so a full or blocked `localStorage` throws from those. In `loadTemplateFromFile` the write sits inside the file reader's try/catch, so a failure is logged (`Failed to load template file`) and `onNeedsInit` is not called.

Template payload (also the file format):

```json
{
  "pams8Version": "1.0",
  "type": "pams8-template",
  "name": "Blue platoon",
  "size": 40,
  "sidc": "10031000141211000000",
  "amplifier": { "UNIQUE_DESIG": "1 Plt" },
  "drawEssentials": { "SIZE": 40 }
}
```

`drawEssentials` in the payload excludes `AMPLIFIER`, `SCOPE`, `CTRL_PTS`, `BASE_LN_PTS` and `GEOM`, so a template never carries geometry. `size` is kept for backward compatibility with older records.

### Methods

| Method | Signature | Behaviour |
| --- | --- | --- |
| `saveAsTemplate` | `(name: string, graphic: Graphic): void` | Builds the payload from `graphic.attributes.drawEssentials` and stores it under `name`, overwriting an existing one |
| `applyTemplate` | `(name: string, graphic: Graphic): void` | Copies the stored draw fields (except geometry and amplifier) onto the graphic's `drawEssentials`, replaces its `AMPLIFIER`, and rebuilds its labels. Logs a warning and returns if the name is unknown or the graphic has no `drawEssentials`. It mutates data and labels in place; it does not re-render the symbol graphic itself, does not change the SIDC-driven look, and pushes no undo entry. |
| `listTemplates` | `(): string[]` | Names of stored templates |
| `deleteTemplate` | `(name: string): void` | Removes a stored template |
| `saveTemplateToFile` | `(graphic: Graphic): void` | Asks for a name with `window.prompt`, downloads `pams8_template_<name>_<timestamp>.json`, and also stores it in `localStorage`. Returns silently if the name is blank. |
| `loadTemplateFromFile` | `(onNeedsInit?: (de: DrawEssentials, amplifier: Amplifier, name: string) => void): void` | Opens a file picker for `.json`, stores the template if it has a `name`, then calls `onNeedsInit` with a fresh `DrawEssentials` and `Amplifier` built from the file (geometry stripped). Parse errors are logged. |
| `applyTemplateData` | `(data: any, onNeedsInit?: (de, amplifier, name) => void): void` | Same as above from an in-memory payload |

`onNeedsInit` is where the host starts placement, for example by calling `symbolEngine.initialize(de, amplifier)` (see [02-symbol-engine-api.md](02-symbol-engine-api.md)), which is what the library's own `_applyTemplateData` does.

Separately from `TemplateEngine`, the library already loads template files through `symbolEngine.loadFromFile()` and `SerializationEngine`: a JSON file whose `type` is `'pams8-template'` is routed to an internal handler that builds `DrawEssentials` and `Amplifier` from it and calls `initialize(de, amplifier)` for interactive placement. See [07-import-export.md](07-import-export.md).

## Keyboard shortcuts

`KeyboardShortcutManager` attaches one `keydown` listener to `document`. It is created by `SymbolEngine` only when `features.shortcuts !== false` at construction time. It is not exposed through a public getter.

### Default bindings

Shortcuts are ignored while focus is in an `input`, `textarea`, `select` or a contenteditable element, except `Ctrl+K`.

Target symbol for single-symbol keys: the last right-clicked graphic, or the single selected graphic if exactly one is selected. If neither exists, the key does nothing.

| Key | Action | Condition |
| --- | --- | --- |
| `Ctrl+K` / `Cmd+K` | Toggle the command palette | Works even inside inputs |
| `M` | Move, Scale, Rotate (`modifySymbol`) | A target symbol exists |
| `E` | Edit Control Points | A target symbol exists |
| `Escape` | Cancel a live stylus capture; else end an active edit session; else stop continuous creation mode | First matching case wins |
| `Enter` | Finish a live stylus capture | Only while a stylus capture is engaged |
| `Delete` | Delete the whole selection if more than one is selected; otherwise remove the target symbol | |
| `I` | Show details (fires `symbolDetailsRequested`) | A target symbol exists |
| `C` | Center the view on the target symbol | A target symbol exists |
| `L` | Start lasso select, or cancel an active lasso | Also closes any active edit/draw workflow when starting |
| `Alt+L` | Start subtract lasso, or cancel an active lasso | |
| `Ctrl+Z` / `Cmd+Z` | Undo | |
| `Ctrl+Y` / `Cmd+Y`, `Ctrl+Shift+Z` / `Cmd+Shift+Z` | Redo | |
| `Ctrl+C` / `Cmd+C` | Copy (the first selected symbol and, if it is in a multi-selection, the whole selection; else the target symbol) | `features.clipboard !== false` |
| `Ctrl+V` / `Cmd+V` | Arm paste mode (next click pastes) | `features.clipboard !== false` |
| `Ctrl+Shift+V` / `Cmd+Shift+V` | Paste Offset dialog | `features.clipboard !== false` |
| `Ctrl+D` / `Cmd+D` | Duplicate the selection in place | `features.clipboard !== false` |

Modifier handling: any `Ctrl` or `Cmd` press is routed to the Ctrl table and returns; unlisted Ctrl combinations do nothing. `Ctrl+C` and `Ctrl+D` call `preventDefault()` only when they act.

Other keys handled outside this manager:

| Key | Where | Action |
| --- | --- | --- |
| `Escape` | `EditEngine` (its own listener while a session is active) | End the edit session |
| `Escape` | Paste mode | Cancel paste mode |
| `Escape`, `Ctrl+S` / `Cmd+S` | Morphix modal | Close (confirm if dirty); Save |
| Shift+click, Ctrl/Cmd+Shift+drag | `SelectionEngine` | Toggle selection; clone-drag |

The context menu shows these shortcut hints next to items: `M`, `E`, `Esc`, `I`, `C`, `Del`, `Ctrl+Y` and similar.

### Enabling, disabling and rebinding

There is no rebinding API. Bindings are hard-coded in `KeyboardShortcutManager.onKeyDown`, and the manager instance is private, so its `attach()` / `detach()` methods cannot be reached from a host.

What a host can control:

| Goal | How |
| --- | --- |
| Turn all shortcuts off | Set `features.shortcuts` to `false` before the `SymbolEngine` is constructed (see [08-settings.md](08-settings.md)). The value is read once, at construction. Toggling it later does not attach or detach the listener. With it off, `Ctrl+K` also stops working, and the Undo/Redo context-menu entries are hidden. |
| Turn off copy/paste/duplicate keys | `features.clipboard = false` (can be changed at runtime; also clears the clipboard and hides the menu entries) |
| Hide Edit menu entries only | `features.editMoveScaleRotate`, `features.editControlPoints` |
| Trigger the same actions from your own keys | Call the `SymbolEngine` methods directly: `modifySymbol`, `activateEditControlPoints`, `deactivateEdit`, `undo`, `redo`, `copySymbol`, `_activatePasteMode`, `duplicateSelection`, `selectionEngine.lassoSelect`, ... |
| Prevent a key reaching the library | Not supported in code. A host listener on `document` in the capture phase can call `stopPropagation()` to keep an event from reaching the library's bubble-phase listener; this relies on browser event ordering and is not a library feature. |

`KeyboardShortcutManager` has `attach(): void`, `detach(): void` and `rewireEditEngine(editEngine: EditEngine): void`. The library calls `detach()` on `SymbolEngine.destroy()` and `rewireEditEngine()` on each view switch. Its constructor takes a `KeyboardShortcutDeps` object of callbacks (exported interface); constructing your own manager with different callbacks is technically possible, but you would need to avoid attaching two managers because the second `attach()` on the same instance is ignored while separate instances would both fire.

## Context menu hooks

`symbolEngine.contextMenuManager` returns the `ContextMenuManager` singleton (`ContextMenuManager.getInstance()`), the right-click menu shared by all symbol layers. Only the members a host normally needs are listed; the `link*Engine` methods wire analysis engines and are called by the library.

### Types

```ts
interface ContextMenuItem {
  id: string;
  label: string | ((graphic?: Graphic) => string);
  shortcut?: string;                 // display hint only
  icon?: string;                     // HTML string
  enabled?: boolean | ((graphic: Graphic) => boolean);
  visible?: boolean | ((graphic: Graphic) => boolean);
  action?: (graphic: Graphic) => void;
  group?: string;
  order?: number;
  children?: ContextMenuItem[];      // submenu
}

interface MenuItemEvent {
  actionId: string;
  graphic: Graphic;
  layerId: string;
  graphicType?: string;
  view: MapView | SceneView;
  point: Point;
  originalEvent: any;
}
```

### Methods

| Method | Signature | Meaning |
| --- | --- | --- |
| `getInstance` | `static (): ContextMenuManager` | Singleton |
| `initialize` | `(view: MapView \| SceneView, options?: ContextMenuOptions): void` | Called by `SymbolEngine`. `options`: `menuClass`, `menuItemClass`, `menuItemHoverClass`, `menuGroupClass`, `menuSeparatorClass`, `targetGraphicTypes`, `targetLayerIds`, `offsetX`, `offsetY`. |
| `configure` | `(options: ContextMenuOptions): void` | Merge options |
| `enable` / `disable` | `(): void` | Switch the menu on/off (`disable` also hides it). Driven by `features.contextMenu`. |
| `registerMenuItems` | `(graphicType: string, items: ContextMenuItem[]): void` | Replace the item set for a graphic type |
| `addMenuItem` | `(graphicType: string, item: ContextMenuItem): void` | Append an item and re-sort by group and order |
| `removeMenuItem` | `(graphicType: string, itemId: string): boolean` | True if something was removed |
| `clearMenuItems` | `(graphicType: string): void` | Remove all items for a type |
| `clearAllMenuItems` | `(): void` | Remove everything, including the library's own items |
| `addDynamicItemProvider` | `(provider: (graphic: Graphic) => ContextMenuItem[]): void` | Called every time the menu opens, so items can depend on runtime state. No removal method exists. |
| `getLastClickedGraphic` | `(): Graphic \| null` | Most recently right-clicked graphic |
| `menuItems` | `ReadonlyMap`-like `Map<string, ContextMenuItem[]>` (public field) | Registered items by graphic type |
| `on` | `(event: 'menu-item-click', listener: (e: MenuItemEvent) => void)` | ArcGIS `Evented` API (`ContextMenuManager extends Evented`) |
| `destroy` | `(): void` | Tears down listeners |

The menu looks items up by `graphic.attributes.graphicType`, then `attributes.type`. If no set is registered for that type it falls back to the first registered set, so items you add to one type may appear for all drawn symbols. Use the `visible` callback on your item to restrict it.

`SymbolEngine` also re-emits `menu-item-click` as a `symbolAction` DOM event on the view container with `{ type: actionId, graphic, layerId, graphicType, point }`.

### Example: add a host action

```ts
const cm = symbolEngine.contextMenuManager;

cm.addDynamicItemProvider((graphic) => [
  {
    id: 'host-open-report',
    label: 'Open report',
    visible: () => graphic.attributes?.type === 'symbol',
    action: (g) => myApp.openReport(g.attributes.id),
  },
]);

cm.on('menu-item-click', (e) => console.log('menu action', e.actionId, e.graphic.attributes.id));
```

`registerMenuItems` on an existing key replaces the library's items for that key, so prefer `addMenuItem` or a dynamic provider unless you intend to replace the menu. The harness (`index.html`) uses `menuItems`, `clearAllMenuItems` and `getLastClickedGraphic` in its API Test panel.

A right-clicked symbol's built-in menu contains Show Details, Center On, Remove, the Edit submenu (Move/Scale/Rotate, Edit Control Points, Copy, Paste, Paste with Offset, Undo, Redo) and the Selection and Align/Arrange submenus. Copy/Paste items are hidden unless `features.clipboard !== false`, and Undo/Redo unless `features.shortcuts !== false`.

## Ambiguities

- `TemplateEngine` is not connected to `SymbolEngine`; its availability in the minified build was not checked.
- Clone-drag checks `features.copyPaste`, a key that does not exist in `Settings.json`.
- Whether plan load and import push undo entries was not verified.
- The `Escape` key is handled by several listeners (edit banner, paste mode, keyboard manager, Morphix); when more than one is active they all run.
- The exact position of the menu-item groups and sort order comes from `sortMenuItems` and was not documented here.
