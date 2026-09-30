# SymbolEngine API Reference

`SymbolEngine` (`MS/Engines/SymbolEngine.ts`, shipped as `dist/MS/Engines/SymbolEngine.min.js` plus `SymbolEngine.d.ts`) is the central mediator of PAMS8. It owns the graphics layers of one view, builds and starts every optional sub-engine, drives interactive drawing, and exposes the host-facing API.

Related documents: [README](README.md) | [Getting started](01-getting-started.md) | [Drawing and events](03-drawing-and-events.md) | [Support classes](04-support-classes.md) | [Editing and Morphix](05-editing-morphix.md) | [Selection, clipboard, undo, templates](06-selection-clipboard-undo-templates.md) | [Import and export](07-import-export.md) | [Settings](08-settings.md) | [Measurement, cues, MGRS](09-measurement-cues-mgrs.md) | [Declutter and visualization](10-declutter-visualization.md) | [Analysis engines](11-analysis-engines.md)

Scope of this document: only public members. Members declared `private`/`protected`, members whose name starts with `_` (for example `_pushUndo`, `_activatePasteMode`, `_showPasteOffsetDialog`, `_activatePasteModeWithOffset`, which are declared `public` in TypeScript but are internal plumbing), and unexported helpers are intentionally omitted.

## Contents by task

| Task | Members |
| --- | --- |
| Module exports | default `SymbolEngine`; type exports `MorphixSymbolPatch`, `MorphixSymbolSnapshot`, `MorphixEditedState`, `GeoKind` |
| Lifecycle | `constructor`, `destroy()`, `setupGlobalEventListener()`, `removeGlobalEventListener()` |
| Views | `onViewChanged()`, `view`, `SymbolEngine.isView2D()`, `SymbolEngine.isView3D()` |
| Drawing | `initialize()`, `getSymbol()`, `creationMode`, `stopContinuousMode()`, `registerSymbol()`, `unregisterSymbol()`, `reProject()` |
| Symbol catalogue | `getSymbolData()`, `getSymbolByKey()`, `getSymbolNamesForAutocomplete()`, `enrichSymbolOptions()` |
| Editing passthroughs | `modifySymbol()`, `activateEditControlPoints()`, `scalePointSymbol()`, `deactivateEdit()`, `updateSymbol()`, `getSymbolState()`, `openSymbolEditor()`, `applyMorphixEdit()` |
| Graphics management | `clearAllGraphics()`, `undo()`, `redo()`, `undoCount`, `redoCount`, `nextUndoLabel`, `nextRedoLabel`, `copySymbol()`, `pasteSymbol()`, `duplicateSelection()`, `hasClipboard` |
| Layers | `layerManager`, `view` |
| Persistence | `loadSymbolFromJSON()`, `exportLayerToJSON()`, `importLayerFromJSON()`, `saveToFile()`, `savePlanToFile()`, `loadPlanFromFile()`, `loadFromFile()`, `exportToGeoJSON()`, `importFromGeoJSON()`, `saveToGeoJSONFile()`, `loadFromGeoJSONFile()`, `serializationEngine` |
| Sub-engine access | `editEngine`, `selectionEngine`, `contextMenuManager`, `measurementEngine`, `proximityEngine`, `drawingCueEngine`, `mgrsEngine`, `visualizationEngine`, `roadNetworkEngine`, `trafficabilityEngine`, `briefingEngine`, `screenAnchorEngine`, `collabEngine`, 16 analysis-engine getters |
| Visualization and analysis shortcuts | `toggleMeasurement()`, `beginSectorDraw()`, `openSectorPanel()`, `closeSectorPanel()`, `clearSectors()`, `showMgrsDensity()`, `clearMgrsDensity()`, `showRouteProfile()`, `clearRouteProfile()`, `showIntervisibility()`, `clearIntervisibility()` |
| Settings | `settings`, `onSettingChanged()` |
| Events | `emit()`, plus the DOM `CustomEvent`s listed in [03-drawing-and-events.md](03-drawing-and-events.md) |
| Legacy helpers | `createPointSymbol()`, `createLineSymbol()`, `createFillSymbol()`, `createPictureMarkerSymbol()`, `addPointToLayer()`, `addPictureMarkerAtCenter()`, `drawMilSymbolInteractively()`, `addMilSymbolAtPoint()`, `addMilSymbolAtCenter()`, `applySymbol()`, `generateForceSymbol()`, `createSymbolCacheKey()`, `ensureMsAvailable()`, `testMilSymbol()` |

## Module exports

The build entry point is `MS/Engines/SymbolEngine.ts` (see `vite.config.ts`, `build.lib.entry`). Its exports are exactly:

```typescript
export default SymbolEngine;
export type {
  MorphixSymbolPatch,
  MorphixSymbolSnapshot,
  MorphixEditedState,
  GeoKind,
} from './Morphix/MorphixEngine';
```

Notes:

- There is one runtime export: the default export `SymbolEngine`. There is no named runtime export.
- `SymbolOptions`, `SymbolDefinition` and `UndoEntry` are declared in the file but are not exported. The `SymbolOptions` type used by the harness comes from `MS/ThirdParty/MilSymbols/UEITypes.ts`, which is a second Rollup input in the build.
- The build uses `preserveModules`, so every source module is emitted as its own `*.min.js` file with a `.d.ts`. Host applications can therefore import supporting classes by path, which is what the harness does through its `@lib` alias:

```typescript
import SymbolEngine from '@lib/Engines/SymbolEngine';
import Amplifier from '@lib/Support/Amplifier';
import DrawEssentials from '@lib/Support/DrawEssentials';
```

  Which of these deep imports are stable is not stated in the source; the ones used by `src/main.ts` (`SymbolEngine`, `Amplifier`, `DrawEssentials`, `SettingsMenu`, `VisualizationEngine`, `DrawingCueEngine`, `CombatPowerEngine`) are the safest. `@arcgis/core` is external and must be provided by the host.
- The `terser` step is configured in `vite.config.ts` and can mangle `_`-prefixed properties. Do not rely on `_` members from the built package.

## Global exposure

`SymbolEngine` does not assign itself to `window`. The harness does it explicitly in `src/main.ts`:

```typescript
const symbolEngine = new SymbolEngine(() => appConfig.activeView);
(window as any).symbolEngine = symbolEngine;
```

Several library modules read `window.symbolEngine` at run time (for example `SettingsBus.getSetting()` / `setSetting()`, the road-network consumers, `AirspaceCommands`, `TrafficabilityEngine`). A host that uses the modular settings widgets, the Ctrl+K palette, or the analysis engines must therefore also set `window.symbolEngine`. This is a real coupling in the source, not a convention.

Other globals required by the library (see [01-getting-started.md](01-getting-started.md)): `window.MS` (milsymbol.js, loaded through a `<script>` tag). The constructor calls `ensureMsAvailable()`, which throws `'MS (UEITypes) library is not properly loaded or invalid.'` if `window.MS` is undefined.

---

## Lifecycle

### constructor(viewProvider: () => MapView | SceneView)

Creates the engine, its layers, and all sub-engines gated by `Settings.json` feature flags.

| Name | Type | Default | Meaning |
| --- | --- | --- | --- |
| viewProvider | `() => MapView \| SceneView` | required | Callback that returns the currently active view. It is called repeatedly, so the engine follows view switches once `onViewChanged()` is called. |

What the constructor does, in order (verified in source):

1. Pre-loads the ArcGIS `projectOperator` (fire-and-forget) for `reProject()`.
2. Gets the per-view `GraphicsLayerManager` singleton and calls `initializeLayers()` (creates the TACT, TACT_PT, FORCE and ANNOTATION layers).
3. Creates `EditEngine`, `StylusDrawController`, `UndoRedoManager`, `ClipboardEngine`, `SelectionEngine` (activated on `SYMBOL_LAYER_IDS`), and `SelectionActionPanel` (enabled unless `features.selectionQuickToolbar === false`).
4. Calls `ensureMsAvailable()` (throws if `window.MS` is missing).
5. Starts `SerializationEngine`, the `ContextMenuManager` (disabled if `features.contextMenu === false`), `MorphixEngine`, and `ThemeManager` (theme `ui.theme`, default `ops-dark`).
6. Starts, depending on flags in `Settings.json`: `MeasurementEngine` (loaded dynamically unless `features.measurementEngine === false`), `ProximityEngine`, `DrawingCueEngine`, `MGRSEngine`, `VisualizationEngine`, `RoadNetworkEngine`, `DeploymentBuilderEngine`, `BriefingEngine`, `ScreenAnchorEngine`, `CollabEngine`, the analysis engines (through `AnalysisEngineRegistry`), and the declutter engines.
7. Wires keyboard shortcuts (unless `features.shortcuts === false`), registers the Ctrl+K palette entries, and calls `setupGlobalEventListener()`.

Side effects: adds `document` event listeners, adds layers to `view.map`, dispatches the `*EngineReady` events described in [03-drawing-and-events.md](03-drawing-and-events.md) as engines finish loading (some are asynchronous, so a listener registered after construction may still catch them, but a listener registered late can miss synchronous ones; prefer reading the getter and listening for the event).

```typescript
import SymbolEngine from '@lib/Engines/SymbolEngine';

const symbolEngine = new SymbolEngine(() => appConfig.activeView);
(window as any).symbolEngine = symbolEngine;
```

### destroy(): void

Full teardown for hosts that unmount the map or replace the engine (SPA route change, multi-map dashboards). The engine is not usable afterwards; construct a new instance.

Actions, as implemented: cancels any in-flight interactive draw, clears the continuous-mode timer, calls `removeGlobalEventListener()`, detaches the keyboard shortcut manager, destroys `MeasurementEngine`, disables `ProximityEngine`/`DrawingCueEngine`/`VisualizationEngine`, destroys `MGRSEngine`, deactivates `EditEngine`, disables `SelectionActionPanel`, destroys `MorphixEngine`, `ContextMenuManager` and `StylusDrawController`, clears the undo/redo history, and clears registered symbols and in-process listeners.

Not covered by `destroy()` (nothing in the method touches them): the analysis engines, declutter engines, Briefing, ScreenAnchor, Collab, RoadNetwork, Trafficability and DeploymentBuilder engines, and the layers on the map. If the host needs those torn down, call their own teardown APIs through the getters (see the sub-engine table below) and remove the layers yourself. The source does not document a stronger guarantee.

### setupGlobalEventListener(): void

Attaches the three document-level listeners (`onDrawProgress`, `onDrawClick`, `onDrawEnd`) that connect symbol classes to the engine. Called by the constructor. It is idempotent: a second call is a no-op while the listeners are attached. You only need to call it again after `removeGlobalEventListener()`.

### removeGlobalEventListener(): void

Removes the document listeners added by `setupGlobalEventListener()`. Call it when discarding an engine that is not fully `destroy()`ed, or when a host embeds several engines. After it, finished symbols are no longer turned into graphics by this engine.

```typescript
symbolEngine.removeGlobalEventListener();   // stop reacting to draw events
symbolEngine.setupGlobalEventListener();    // resume
```

---

## Views

### view: MapView | SceneView (getter)

Returns `viewProvider()`. Read-only.

### onViewChanged(newView: MapView | SceneView): void

Re-attaches the engine and every loaded sub-engine to a new view. Call it whenever the host switches between 2D and 3D or replaces the view. It is not called automatically: the `reactiveUtils.watch` in the constructor on `view.type` is an empty reserved hook.

| Name | Type | Default | Meaning |
| --- | --- | --- | --- |
| newView | `MapView \| SceneView` | required | The view that `viewProvider` now returns. |

Behaviour (verified): cancels any in-flight interactive draw and pending paste mode; obtains the `GraphicsLayerManager` for the new view and initializes its layers; recreates `EditEngine` (so a reference to `symbolEngine.editEngine` taken earlier becomes stale, re-read the getter); calls `onViewChanged` on selection, stylus, Morphix, measurement, proximity, drawing-cue, MGRS, visualization, sector tools, intervisibility, road network, trafficability, deployment builder, briefing, screen anchor, collab, declutter (all five) and the analysis registry; re-initializes the context menu; and swaps minefield texture fills for the new view type.

Make sure `viewProvider` already returns the new view before calling.

```typescript
// from src/main.ts
onActiveViewChanged = (newView, oldView) => {
  symbolEngine.onViewChanged(newView);
};
```

### static isView2D(view: View): boolean

`true` when `view.type === '2d'`.

### static isView3D(view: View): boolean

`true` when `view instanceof SceneView`.

---

## Drawing

The complete flow is described in [03-drawing-and-events.md](03-drawing-and-events.md). The parameter classes are in [04-support-classes.md](04-support-classes.md).

### initialize(drawEssentials: DrawEssentials, amplifier: Amplifier, isPassive?: boolean): void

Starts an interactive draw, or places a symbol immediately when `isPassive` is `true`. This is the main entry point for creating symbols.

| Name | Type | Default | Meaning |
| --- | --- | --- | --- |
| drawEssentials | `DrawEssentials` | required | Drawing parameters: size, label options, extra settings, plus geometry (`GEOM`, `CTRL_PTS`, `BASE_LN_PTS`) when placing without interaction. |
| amplifier | `Amplifier` | required | Carries the SIDC (`amplifier.SIDC`) and amplifier text fields. |
| isPassive | `boolean` | `false` | `false`: interactive draw, the user clicks on the map. `true`: programmatic placement from the geometry already in `drawEssentials` (plan load, paste, tests). Geometry is re-projected to the view's spatial reference with `reProject()`. |

Behaviour (verified):

- Looks the symbol up in `Symbols.json` with the key `SIDC.substring(4, 6) + sid` (symbol set + six-digit entity id from the SIDC).
- If no entry is found it logs `console.warn('Symbol data not found for SIDC part: ...')` and returns. Any exception is caught and logged with `console.error`; nothing is thrown to the caller.
- Instantiates the symbol class through `Mapper` (`getSymbol()`), builds the marker from the SIDC, and calls the symbol's `init()`.
- For interactive calls it closes any active edit workflow, arms the proximity and drawing-cue engines, tells `SelectionEngine` a draw is active, stores the arguments for continuous mode, and tracks the symbol so an abandoned draw can be released.
- For freehand symbols (`isFreeHand === '1'` in `Symbols.json`) it applies the `drawStyle` settings (line width, dash style, colour, fill).
- When stylus/pen drawing is engaged (`StylusDrawController`), the mouse handlers of the symbol are bypassed or wrapped; see [12-briefing-collab-stylus.md](12-briefing-collab-stylus.md).
- Calling `initialize()` again while a draw is active replaces it (re-pick).
- When the draw finishes, the graphic is added to a layer and `symbolCreated` is dispatched (see [03-drawing-and-events.md](03-drawing-and-events.md)).

```typescript
const amplifier = new Amplifier();
amplifier.SIDC = '10110201004100000000';
const drawEssentials = new DrawEssentials();
drawEssentials.SIZE = 60;
symbolEngine.initialize(drawEssentials, amplifier);  // interactive
```

The harness sets `drawEssentials.labelOptions` from the text-style settings and copies per-symbol parameters (`readSymbolParamsInto`) before calling `initialize`. The field list of `DrawEssentials` is in [04-support-classes.md](04-support-classes.md).

### getSymbol(isLine?: boolean): any

Creates a new symbol instance for the current `Symbols.json` entry (the one selected by the last `initialize()` call) using `Mapper`. Returns `new SymbolClass(view, isLine)`. Throws `Error('SIDC not found')` if no symbol has been resolved yet. Normally called internally; exposed for advanced hosts.

### creationMode: 'single' | 'continuous' (getter/setter)

`'single'` (default from `Settings.json` key `creationMode`, else `'single'`): each `initialize()` places one symbol. `'continuous'`: after each symbol is placed the engine re-runs `initialize()` with the same `DrawEssentials`/`Amplifier` (via `setTimeout(..., 0)`) until stopped.

Setting the property stores the value in `settings.creationMode`, cancels a pending re-arm and, when set to `'single'`, cancels the draw that continuous mode already armed. Setting it does not dispatch `creationModeChanged`.

### stopContinuousMode(): void

If in continuous mode, reverts to `'single'`, forgets the stored draw parameters, disarms the active draw and dispatches `creationModeChanged` with `{ mode: 'single' }` on the view container. No-op when already single.

### registerSymbol(symbolInstance: any, symbolType?: string): void

Legacy. Subscribes to a symbol instance's own `on('onDrawProgress' | 'onDrawEnd')` and re-dispatches them as `CustomEvent`s on the view container. `symbolType` defaults to `'Symbol'`. Logs a warning if the instance is already registered or has no `on` method.

Caution: the re-dispatched `onDrawEnd` has the detail `{ symbolType, originalData }` only, and the global document listener also receives it. `drawSymEnd` then finds no `geometry`/`marker` and logs `'Missing geometry or marker in draw end event'`. The normal `initialize()` path does not use `registerSymbol()`; avoid it in new code.

### unregisterSymbol(symbolInstance: any, symbolType?: string): void

Removes the instance from the internal registered set (`symbolType` is used only for the log message). It does not detach the handlers added by `registerSymbol()`.

### reProject(point: Point, spatialReference: SpatialReference): Point

Projects a point to the target spatial reference. Returns the input unchanged when both spatial references match, when either argument is missing, or when projection is not possible (an error is then written through `EngineLogger`). Handles WGS84 <-> Web Mercator (wkid 3857 and 102100) with `webMercatorUtils`; other pairs use the ArcGIS `projectOperator`, which is loaded in the constructor and may not be ready immediately after construction.

---

## Symbol catalogue

### getSymbolData(): any

Returns the complete `Symbols.json` catalogue (object keyed by symbol key), through `SymbolMetadataService`. See [13-symbol-catalog.md](13-symbol-catalog.md).

### getSymbolByKey(key: string): any

Returns the definition for one key (`Class`, `Name`, `SymGeoType`, `Parameters`, ...). Return type is `any`; the missing-key result is not defined in this class (delegated to `SymbolMetadataService`).

### getSymbolNamesForAutocomplete(): Array<{ key: string; name: string }>

List for search boxes. Auto shapes are included unless `settings.features.autoShapes === false`.

### enrichSymbolOptions(options: SymbolOptions): SymbolOptions & { parsedSIDC?: ParsedSIDC; label?: string; text?: string }

Delegates to `SymbolMetadataService.enrich()` to add parsed SIDC and label text to an options object. `SymbolOptions` here is the local, non-exported interface (`sidc`, `size`, `quantity`, `staffComments`, `additionalInformation`, `type`, `dtg`, `location`, `outlineColor`, `outlineWidth`, plus an index signature).

---

## Editing passthroughs

These forward to `EditEngine` and `MorphixEngine`. Details are in [05-editing-morphix.md](05-editing-morphix.md).

### modifySymbol(graphic: Graphic): void

Starts interactive move, rotate and scale. If a multi-selection is active the whole selection is edited. A single point symbol gets move and rotate only (no scaling). Pushes an undo snapshot ("Move, Scale, Rotate").

### activateEditControlPoints(graphic: Graphic): void

Starts control-point (CTRL_PTS) handle editing for a line or area graphic. Undo label "Edit Control Points".

### scalePointSymbol(graphic: Graphic, factor: number): void

Scales a point symbol by `factor` (for example `1.2` is +20 percent) by calling `EditEngine.scalePointSymbol`. The EditEngine emits `scalePointSymbol` to its own listeners; see [05-editing-morphix.md](05-editing-morphix.md).

### deactivateEdit(): void

Ends any active edit or reshape session and refreshes the selection toolbar.

### updateSymbol(graphic: Graphic, patch: MorphixSymbolPatch): Graphic | null

Applies a partial patch to a symbol and re-renders it. Geometry is preserved. Returns the new `Graphic` (the old one is removed and a new one with the same `attributes.id` is added) or `null` if the patch cannot be applied (for example an invalid SIDC). The graphic argument may be stale; it is resolved to the live instance by `attributes.id`.

```typescript
symbolEngine.updateSymbol(graphic, { amplifier: { UNIQUE_DESIG: 'B/1-7' }, drawEssentials: { opacity: 0.6 } });
// Force (FPoint) symbols patch OPTIONS instead:
symbolEngine.updateSymbol(graphic, { options: { uniqueDesignation: 'A Coy' }, extraSettings: { size: 40 } });
```

### getSymbolState(graphic: Graphic): MorphixSymbolSnapshot

Returns the current editable state (kind, sidc, amplifier, options, ...) without opening an editor. Field list: [05-editing-morphix.md](05-editing-morphix.md).

### openSymbolEditor(graphic: Graphic): void

Opens the built-in Morphix modal for the graphic. The harness calls this from its params dock.

### applyMorphixEdit(graphic: Graphic, editedState: MorphixEditedState): Graphic | null

Lower-level re-render used by Morphix and by `updateSymbol()`. Removes the old graphic, adds the rebuilt one on the same layer with the same id, re-annotates, pushes an undo entry, and dispatches `symbolDetailsEdited`. Throws `Error('Selected symbol is not attached to a graphics layer.')` if the graphic is on no layer. Hosts normally call `updateSymbol()` instead.

---

## Graphics management

### clearAllGraphics(): void

Removes all graphics from every layer registered in the layer manager (`layerManager.listLayers()`) and clears the undo/redo history. It is not undoable. It clears every managed layer, including declutter and annotation layers; layers unknown to the manager are untouched.

### undo(): void / redo(): void

Undo or redo the last operation. See [06-selection-clipboard-undo-templates.md](06-selection-clipboard-undo-templates.md).

### undoCount: number, redoCount: number (getters)

Size of the undo and redo stacks.

### nextUndoLabel: string | null, nextRedoLabel: string | null (getters)

Label of the next undo/redo entry (for example `"Add Phase Line"`), or `null` when the stack is empty.

### copySymbol(graphic: Graphic): void

Copies a graphic (deep clone of geometry, symbol, drawEssentials) into the internal clipboard.

### pasteSymbol(targetPoint: Point, expandDistance?: number, expandUnit?: string): Graphic | null

| Name | Type | Default | Meaning |
| --- | --- | --- | --- |
| targetPoint | `Point` | required | Where the clipboard centroid lands. |
| expandDistance | `number` | `0` | Expansion or contraction distance applied to a multi-item paste. |
| expandUnit | `string` | `'meters'` | Unit for `expandDistance`. Accepted values are defined in `ClipboardEngine`, not here. |

Returns the first pasted graphic, or `null` if the clipboard is empty.

### duplicateSelection(): void

Duplicates the current selection at a small offset, without using the clipboard, then selects only the copies (repeated calls stamp a row). Does nothing if `settings.features.clipboard === false` or nothing is selected.

### hasClipboard: boolean (getter)

`true` when the clipboard holds something to paste.

---

## Layers

### layerManager: GraphicsLayerManager (getter/setter)

The getter returns `GraphicsLayerManager.getInstance(this.view)`, that is, the manager of the current view. The setter only replaces the internal field used by the engine's own operations; it does not change what the getter returns. Prefer not to use the setter (the source gives no supported use case).

`GraphicsLayerManager` API (`MS/Managers/GraphicsLayerManager.ts`):

| Member | Signature | Meaning |
| --- | --- | --- |
| `GraphicsLayerManager.getInstance` | `(view: MapView \| SceneView): GraphicsLayerManager` | Per-view singleton. Rebuilt if the view was destroyed and recreated. |
| `initializeLayers` | `(): void` | Creates TACT, TACT_PT, FORCE and ANNOTATION_LAYER. |
| `getSymbolLayer` | `(): GraphicsLayer` | The FORCE layer. |
| `getOrCreateLayer` | `(layerName: string): GraphicsLayer` | Returns an existing layer (in the manager or already on the map by id), else creates one with `elevationInfo: { mode: 'on-the-ground' }` and adds it to the map. |
| `getLayer` | `(layerName: string): GraphicsLayer \| undefined` | Lookup without creating. |
| `listLayers` | `(): string[]` | Ids of layers cached by the manager. |

Exported constants of that module: `LAYER_NAMES`, `LEGACY_MIL_SYMBOLS_LAYER_ID`, `SYMBOL_LAYER_IDS`. They are not re-exported by `SymbolEngine`; import them from `Managers/GraphicsLayerManager`.

| `LAYER_NAMES` key | Layer id |
| --- | --- |
| `FORCE` | `ForceSymbolsLayer` |
| `TACT_PT` | `TacticalPointSymbolsLayer` |
| `TACT` | `TacticalSymbolsLayer` |
| `SKETCH` | `SketchLayer` |
| `ANNOTATION_LAYER` | `AnnotationLayer` |
| `CLUSTER` | `ClusterBadgeLayer` |
| `LEADER_LINE` | `LeaderLineLayer` |
| `LADDER` | `LadderLineLayer` |

`LEGACY_MIL_SYMBOLS_LAYER_ID` is `"milSymbols"`. `SYMBOL_LAYER_IDS` is `[FORCE, TACT_PT, TACT, "milSymbols"]` (FORCE first for priority).

Layer routing of finished graphics (from `drawSymEnd`): `UEI == '1'` or `SYM_GEO_TYPE` `fpoint` goes to FORCE; `SYM_GEO_TYPE` `point` or a point geometry goes to TACT_PT; everything else goes to TACT. Labels go to ANNOTATION_LAYER.

```typescript
import { LAYER_NAMES } from '@lib/Managers/GraphicsLayerManager';
const force = symbolEngine.layerManager.getOrCreateLayer(LAYER_NAMES.FORCE);
console.log(force.graphics.length);
```

---

## Persistence

These forward to `serializationEngine` (a `public readonly` property of type `SerializationEngine`, the singleton from `SerializationEngine.getInstance()`). Formats and behaviour are in [07-import-export.md](07-import-export.md).

| Method | Signature | Meaning |
| --- | --- | --- |
| `loadSymbolFromJSON` | `(data: any): Graphic \| null` | Rebuilds one symbol from a serialized object. Uses `initialize(de, amplifier, true)` when `CTRL_PTS`, `BASE_LN_PTS` or `GEOM` are present, otherwise a fallback path. Restores a saved id, and pin-to-screen state when present. Returns `null` on failure (error logged). |
| `exportLayerToJSON` | `(): object[]` | Serializes every graphic on the symbol layers. |
| `importLayerFromJSON` | `(data: object[]): void` | Rebuilds graphics from that array. |
| `saveToFile` | `(filename?: string): void` | Downloads a PAMS8 JSON file. |
| `savePlanToFile` | `(filename?: string): void` | Downloads a Plan JSON file. |
| `loadPlanFromFile` | `(): void` | Opens a file picker for a Plan JSON. |
| `loadFromFile` | `(): void` | Opens a file picker; accepts PAMS8 JSON, template or GeoJSON. |
| `exportToGeoJSON` | `(): object` | Returns a GeoJSON FeatureCollection (WGS84). |
| `importFromGeoJSON` | `(geojson: any): void` | Rebuilds symbols from a PAMS8 GeoJSON. |
| `saveToGeoJSONFile` | `(filename?: string): void` | Downloads GeoJSON. |
| `loadFromGeoJSONFile` | `(): void` | Opens a file picker for GeoJSON or PAMS8 JSON. |

`saveSymbolToJSON()` exists in the source only as a commented-out block and is not part of the API even though earlier docs may mention it.

---

## Sub-engine and manager access

Each getter returns the live instance or `null`/`undefined` when the feature is disabled in `Settings.json` or not loaded yet. Read the getter when needed, or wait for the matching `*Ready` event (see [03-drawing-and-events.md](03-drawing-and-events.md)).

| Property | Type | Doc |
| --- | --- | --- |
| `serializationEngine` | `SerializationEngine` (readonly field) | [07](07-import-export.md) |
| `editEngine` | `EditEngine` (replaced by `onViewChanged()`, do not cache) | [05](05-editing-morphix.md) |
| `selectionEngine` | `SelectionEngine` | [06](06-selection-clipboard-undo-templates.md) |
| `contextMenuManager` | `ContextMenuManager` | [05](05-editing-morphix.md) |
| `measurementEngine` | `MeasurementEngine \| undefined` | [09](09-measurement-cues-mgrs.md) |
| `proximityEngine` | `ProximityEngine \| null` | [09](09-measurement-cues-mgrs.md) |
| `drawingCueEngine` | `DrawingCueEngine \| null` | [09](09-measurement-cues-mgrs.md) |
| `mgrsEngine` | `MGRSEngine \| null` | [09](09-measurement-cues-mgrs.md) |
| `visualizationEngine` | `VisualizationEngine \| null` | [10](10-declutter-visualization.md) |
| `roadNetworkEngine` | `RoadNetworkEngine \| null` | [11](11-analysis-engines.md) |
| `trafficabilityEngine` | `TrafficabilityEngine \| null` | [11](11-analysis-engines.md) |
| `weaponEffectEngine` | `WeaponEffectEngine \| null` | [11](11-analysis-engines.md) |
| `losEngine` | `LOSEngine \| null` | [11](11-analysis-engines.md) |
| `trajectoryEngine` | `TrajectoryEngine \| null` | [11](11-analysis-engines.md) |
| `keyTerrainIdentificationEngine` | `KeyTerrainIdentificationEngine \| null` | [11](11-analysis-engines.md) |
| `posDefScorerEngine` | `PosDefScorerEngine \| null` | [11](11-analysis-engines.md) |
| `opRankerEngine` | `OpRankerEngine \| null` | [11](11-analysis-engines.md) |
| `localPeaksEngine` | `LocalPeaksEngine \| null` | [11](11-analysis-engines.md) |
| `ocokaEngine` | `OcokaEngine \| null` | [11](11-analysis-engines.md) |
| `missionPlannerEngine` | `MissionPlannerEngine \| null` | [11](11-analysis-engines.md) |
| `landingZoneEngine` | `LandingZoneEngine \| null` | [11](11-analysis-engines.md) |
| `airspaceEngine` | `AirspaceEngine \| null` | [11](11-analysis-engines.md) |
| `deadGroundMapper` | `DeadGroundMapper \| null` | [11](11-analysis-engines.md) |
| `bufferEngine` | `BufferEngine \| null` | [11](11-analysis-engines.md) |
| `corridorEngine` | `CorridorEngine \| null` | [11](11-analysis-engines.md) |
| `effectEngine` | `EffectEngine \| null` | [11](11-analysis-engines.md) |
| `flightEngine` | `FlightEngine \| null` | [11](11-analysis-engines.md) |
| `briefingEngine` | `BriefingEngine \| null` | [12](12-briefing-collab-stylus.md) |
| `screenAnchorEngine` | `ScreenAnchorEngine \| null` | [12](12-briefing-collab-stylus.md) |
| `collabEngine` | `CollabEngine \| undefined` | [12](12-briefing-collab-stylus.md) |

The declutter engines (`DeclutterEngine`, `ClusterEngine`, `LabelPlacer`, `MarkerDisperser`, `LadderEngine`), `DeploymentBuilderEngine`, `StylusDrawController`, `MorphixEngine`, `ClipboardEngine` and `UndoRedoManager` are private fields with no public getter; use the facade methods or `Settings.json` flags. Some analysis engines are also reached through separate singletons or `window` getters in the harness (`keyTerrainEngine`, `posDefScorerEngine`, and others defined with `Object.defineProperty` in `src/main.ts`), but that is harness code, not library API.

### toggleMeasurement(): Promise<void>

Toggles the measurement engine, lazy-loading it first if the `Settings.json` gate left it unloaded. Use this from every UI hook so the feature can be switched on at run time.

### beginSectorDraw(center?: Point | Graphic): void

Starts the interactive threat-sector draw, optionally centred on a point or point graphic. No-op if the visualization engine is not loaded.

### openSectorPanel(): void / closeSectorPanel(): void / clearSectors(): void

Open or close the sector management panel; clear all drawn sectors.

### showMgrsDensity(opts?: { precision?: 0 | 1 | 2; mode?: "ratio" | "count" }): void

Shades MGRS grid cells by symbol density or force ratio. Source comment: `precision` 0 = 100 km, 1 = 10 km (documented as default), 2 = 1 km; `mode` is `"ratio"` or `"count"`. The default for `mode` is not stated in this class. Forwards to the visualization engine.

### clearMgrsDensity(): void

Clears the density heatmap.

### showRouteProfile(input: Graphic | Polyline | Polygon): Promise<void>

Shows the terrain elevation profile along a line, or along a polygon's outer boundary.

### clearRouteProfile(): void

Removes the elevation-profile panel.

### showIntervisibility(opts?: { observerHeightM?: number }): Promise<unknown>

Computes mutual line of sight between point symbols and draws the network plus matrix panel. Uses the selected point graphics; if fewer than two are selected it uses all point graphics on the FORCE and TACT_PT layers. The resolved value type is `unknown` in the source.

### clearIntervisibility(): void

Removes the intervisibility overlay and panel.

---

## Settings

### settings: typeof settingsData (getter)

Returns the live in-memory settings object (the imported `Settings.json`, shared module state, not a copy). `SettingsBus.getSetting()` reads through `window.symbolEngine.settings`. Structure and keys: [08-settings.md](08-settings.md).

### onSettingChanged(path: string[], value: any): void

Writes a value into the settings tree and routes it to the affected sub-engines.

| Name | Type | Default | Meaning |
| --- | --- | --- | --- |
| path | `string[]` | required | Path segments, for example `['measurement', 'distUnit']`. Missing intermediate objects are created. |
| value | `any` | required | New value. |

Verified routing (by `path.join('.')`):

| Path | Effect |
| --- | --- |
| `drawStyle.*`, `textStyle.*` | Re-arms an interactive freehand draw that has not yet placed its first point (debounced) |
| `features.measurementEngine` | Lazy-loads and enables, or disables, `MeasurementEngine` |
| `features.collab` | Lazy-loads `CollabEngine`, or disables it |
| `features.proximityEngine`, `features.contextMenu`, `features.selectionQuickToolbar` | Enable or disable the component |
| `features.clipboard` (false) | Clears the clipboard |
| `features.analysisEngines`, `analysis.*` | Enable or disable analysis engines through `AnalysisEngineRegistry` |
| `features.mgrsEngine`, `mgrs.*` | MGRS engine load and options |
| `features.visualizationEngine`, `visualization.*` | Visualization engine load and options |
| `features.roadNetwork`, `roadNetwork.*` | Road-network engine and its dependents |
| `features.drawingCues`, `drawingCues.*` | Drawing cue engine |
| `features.deploymentBuilder`, `features.briefing`, `features.screenAnchor` | Load the engine on first enable, then enable or disable it |
| `measurement.*`, `proximity.*` | Forwarded as engine options |
| `logging.enabled` | `EngineLogger.setEnabled` |
| `size` | Re-renders every force (FPoint) symbol at the new marker size (not undoable) |
| `creationMode` | Sets creation mode; switching to `'single'` disarms an armed draw |
| `ui.theme` | `ThemeManager.setTheme(value)` |
| `declutter.*` | Enable, disable and refresh the declutter engines |

Other `features.*` keys only log a console message. After processing, it dispatches `settingChanged` (past tense, no `s`) on the view container with `{ path: 'a.b.c', value }`. This is different from the window-level `settingsChanged` event used by `SettingsBus` and the harness (see below).

The harness bridges the two: UI widgets dispatch `window` `settingsChanged` with `detail.path` (array) and `detail.value`, and `index.html` calls `window.symbolEngine.onSettingChanged(path, value)`:

```typescript
window.addEventListener('settingsChanged', (e) => {
  const { path, value } = (e as CustomEvent).detail;
  (window as any).symbolEngine?.onSettingChanged(path, value);
});
```

A host that does not use the harness UI can call `onSettingChanged()` directly. Note that `SettingsBus.setSetting()` only dispatches the window event; something must translate it into an `onSettingChanged` call (the harness does in `index.html`).

---

## Events

### emit(type: string, event: any): boolean

Calls in-process listeners registered for `type` and returns `true` if there were any. The engine uses it for `symDrawEnd`, `symDrawProgress`, `symDrawClick` and `baseLineDrawEnd`. Ambiguity: the matching `on()` method is commented out in the source (only `implements Evented` remains in the class declaration), so the internal listener map is never populated and `emit()` has no effect for external code. Use the DOM events in [03-drawing-and-events.md](03-drawing-and-events.md) instead.

Host-facing events are DOM `CustomEvent`s dispatched on `view.container` (bubbling to `document`). Their names, payloads and timing are listed in [03-drawing-and-events.md](03-drawing-and-events.md).

---

## Legacy helpers

These methods have no access modifier (so they are public in TypeScript) and predate the `initialize()` pipeline. They do not create annotated, undoable, serializable symbols. Use `initialize()` for new work.

| Method | Signature | Notes |
| --- | --- | --- |
| `createPointSymbol` | `(color = '#FF0000', size = 10): SimpleMarkerSymbol` | Marker with a black 1 px outline. |
| `createLineSymbol` | `(color = '#0000FF', width = 2): SimpleLineSymbol` | |
| `createFillSymbol` | `(color = '#00FF00', outlineColor = '#000000', outlineWidth = 1): SimpleFillSymbol` | |
| `createPictureMarkerSymbol` | `(url: string, width: number, height: number): PictureMarkerSymbol` | |
| `addPointToLayer` | `(geometry: Point): void` | Adds a red marker graphic to the FORCE layer. |
| `addPictureMarkerAtCenter` | `(url: string, width = 20, height = 20, view: MapView \| SceneView): void` | `view` is a required parameter that follows defaulted ones, so pass all four. Adds at `view.center` to the FORCE layer. |
| `drawMilSymbolInteractively` | `(drawEssentials: DrawEssentials, amplifier: Amplifier, attr: object): void` | Uses an ArcGIS `SketchViewModel` to place one force symbol. Dispatches a `document` `onDrawProgress` with `symbolType: 'milSymbol'` while moving. |
| `addMilSymbolAtPoint` | `(point: Point, drawEssentials: DrawEssentials, amplifier: Amplifier, attr: object): void` | Adds a force PictureMarker graphic to the FORCE layer with `attr` as attributes. |
| `addMilSymbolAtCenter` | `(options: SymbolOptions): void` | Ambiguous: its body calls an internal helper with a different argument list than that helper accepts, so it is not reliable. Not used by the harness (the call there is commented out). Avoid. |
| `applySymbol` | `(graphic: Graphic, symbol: SimpleMarkerSymbol \| SimpleLineSymbol \| SimpleFillSymbol): void` | Sets `graphic.symbol`. |
| `generateForceSymbol` | `(drawEssentials: DrawEssentials, amplifier: Amplifier, attr: object): PictureMarkerSymbol \| undefined` | Renders `amplifier.SIDC` with milsymbol.js at `drawEssentials.SIZE \|\| 35`. Results are cached (max 256 entries, key `SIDC\|size`). Returns `undefined` if the SIDC is missing or rendering fails. |
| `createSymbolCacheKey` | `(options: SymbolOptions, scaleFactor: number): string` | JSON key from selected option fields. |
| `ensureMsAvailable` | `(): void` | Throws if `window.MS` is undefined. Already called by the constructor. |
| `testMilSymbol` | `(): void` | Console diagnostic that renders a sample with milsymbol.js. |

---

## Minimal host setup

```typescript
import SymbolEngine from '@lib/Engines/SymbolEngine';
import Amplifier from '@lib/Support/Amplifier';
import DrawEssentials from '@lib/Support/DrawEssentials';

let activeView: MapView | SceneView = sceneView;
const engine = new SymbolEngine(() => activeView);
(window as any).symbolEngine = engine;           // needed by settings widgets / palette

document.addEventListener('symbolCreated', (e) => {
  const { id, graphic } = (e as CustomEvent).detail;
});

function switchView(next: MapView | SceneView) {
  activeView = next;
  engine.onViewChanged(next);                    // after the provider returns the new view
}

const a = new Amplifier(); a.SIDC = '10110201004100000000';
const d = new DrawEssentials(); d.SIZE = 60;
engine.initialize(d, a);

// Teardown
engine.destroy();
```
