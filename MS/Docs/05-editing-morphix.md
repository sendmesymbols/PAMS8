# 05 - Editing and Morphix

This document covers everything a host application can do to a symbol that is already on the map:

- read its editable state,
- patch its attributes programmatically,
- open the built-in details editor (Morphix),
- start and stop the interactive move / rotate / scale and control-point (vertex) modes.

All of it is reached through the `SymbolEngine` instance. `MorphixEngine` and `EditEngine` are internal collaborators; the public entry points are the `SymbolEngine` methods and getters listed below. Related documents: [02-symbol-engine-api.md](02-symbol-engine-api.md), [03-drawing-and-events.md](03-drawing-and-events.md), [04-support-classes.md](04-support-classes.md) (Amplifier, DrawEssentials), [06-selection-clipboard-undo-templates.md](06-selection-clipboard-undo-templates.md) (undo, selection, shortcuts).

## Contents

| Task | API |
| --- | --- |
| Read a symbol's editable state | `symbolEngine.getSymbolState(graphic)` |
| Change SIDC, designation, size, opacity, labels, CIM | `symbolEngine.updateSymbol(graphic, patch)` |
| Open the built-in editor modal | `symbolEngine.openSymbolEditor(graphic)` |
| Replace the editor with a host UI | `symbolDetailsRequested` event (cancelable) |
| React to a details edit | `symbolDetailsEdited` event |
| Interactive move / rotate / scale | `symbolEngine.modifySymbol(graphic)` |
| Interactive vertex (control point) editing | `symbolEngine.activateEditControlPoints(graphic)` |
| Leave any edit mode | `symbolEngine.deactivateEdit()` |
| Test whether an edit mode is active | `symbolEngine.editEngine.isModifyingSymbol`, `.isEditingControlPoints` |
| Listen for completed geometry edits | `symbolEngine.editEngine.on('changeInSymbol', fn)` |
| Programmatic point-symbol scale factor | `symbolEngine.scalePointSymbol(graphic, factor)` |

## Types

These are exported from the package entry (`MS/Engines/SymbolEngine.ts`): `GeoKind`, `MorphixSymbolPatch`, `MorphixSymbolSnapshot`, `MorphixEditedState`.

```ts
type GeoKind = 'Point' | 'FPoint' | 'Line' | 'Area';
```

| Kind | Meaning | Where its data lives |
| --- | --- | --- |
| `Point` | Tactical point symbol (`TacticalPoint`) | `amplifier` + flat `drawEssentials` (`SIZE`, `ANGLE`, ...) |
| `FPoint` | Force / Unit-Equipment-Installation symbol (milsymbol) | nested `options` object; size in `extraSettings.size` |
| `Line` | Tactical polyline graphic | `amplifier` + `drawEssentials` + `extraSettings.lineWidth` |
| `Area` | Tactical polygon graphic | same as `Line` |

The kind is resolved from `drawEssentials.SYM_GEO_TYPE`, then the `SymGeoType` of the catalog entry in `Symbols.json`, then the milsymbol `symType`, then the graphic's geometry type. `Polyline` maps to `Line`, `Polygon` to `Area`.

```ts
interface MorphixSymbolPatch {
  sidc?: string;
  amplifier?: Record<string, any>;
  drawEssentials?: Record<string, any>;
  options?: Record<string, any>;          // FPoint only
  labelOptions?: Record<string, any>;
  extraSettings?: Record<string, any>;
  cim?: Record<string, any>;
}

interface MorphixSymbolSnapshot {
  kind: GeoKind | '';
  sidc: string;
  symbolKey: string;
  symbolName: string;
  amplifier: Record<string, any>;
  drawEssentials: Record<string, any>;
  options: Record<string, any>;
  labelOptions: Record<string, any>;
  extraSettings: Record<string, any>;
  cim: Record<string, any>;
}
```

`MorphixEditedState` (`sidc`, `symbolKey`, `symbolDefinition`, `amplifier`, `drawEssentials`, `attributes`) is the internal hand-off object passed to `SymbolEngine.applyMorphixEdit`. Hosts normally never construct it.

## Reading state

### getSymbolState(graphic: Graphic): MorphixSymbolSnapshot

Returns a deep-cloned, read-only snapshot of a symbol's editable state without opening the editor. Nothing on the map changes.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `graphic` | `Graphic` | required | A symbol graphic from one of the symbol layers. A stale reference is resolved to the live instance by `attributes.id`. |

Result fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `kind` | `GeoKind \| ''` | Geometry family. Empty string if it cannot be resolved. |
| `sidc` | `string` | Digits only. A 20-digit or 30-digit SIDC is preserved as is; a shorter code is right-padded with `0` to 20 digits. If the graphic carries no SIDC at all, one is derived from `drawEssentials.SID`, or `'10000000000000000000'` if that is absent too. |
| `symbolKey` | `string` | `SIDC[4..6] + SIDC[10..16]` (symbol set + entity). This is the key into `Symbols.json`. |
| `symbolName` | `string` | `Name` from `Symbols.json`, else `drawEssentials.SYM_NAME`, else `''`. |
| `amplifier` | `Record<string, any>` | Flat amplifier fields (see [Amplifier fields](#amplifier-fields-point-line-area)). Every editor-known key is present; missing values are `''`. Extra keys found on the symbol's amplifier are carried over. |
| `drawEssentials` | `Record<string, any>` | JSON-safe copy of the symbol's drawEssentials. Geometry (`GEOM`, `CTRL_PTS`, `BASE_LN_PTS`), the nested groups and `SCOPE` are excluded. `SIDC`, `SID`, `SYM_NAME`, `SYM_GEO_TYPE` and `ECHELON` are always set. |
| `options` | `Record<string, any>` | FPoint only: the milsymbol OPTIONS payload (camelCase keys such as `uniqueDesignation`). Empty object for other kinds. |
| `labelOptions` | `Record<string, any>` | Label style. If the symbol carries none, the `DrawEssentials` class defaults are shown (see the note on ownership below). |
| `extraSettings` | `Record<string, any>` | `lineWidth`, `size`, `textSize`, `opacity`. Same fallback rule as `labelOptions`. |
| `cim` | `Record<string, any>` | CIM fill-texture settings, `{}` when unset. |

```ts
const state = symbolEngine.getSymbolState(graphic);
if (state.kind === 'FPoint') {
  console.log(state.options.uniqueDesignation, state.extraSettings.size);
} else {
  console.log(state.amplifier.UNIQUE_DESIG);
}
```

Ownership note. `labelOptions` and `extraSettings` in the snapshot may be class defaults (red halo, green 20 pt label text, marker size 20) shown only so a form has something to display. The engine tracks whether the symbol actually owned those groups. Groups the symbol did not own are not written back by `updateSymbol` unless the patch itself contains that group. Do not treat the snapshot values as proof that the symbol was styled explicitly.

## Patching a symbol

### updateSymbol(graphic: Graphic, patch: MorphixSymbolPatch): Graphic | null

Applies a partial patch to a symbol and re-renders it through the same pipeline the editor's Save button uses. Geometry (`GEOM`, `CTRL_PTS`, `BASE_LN_PTS`) is never changed.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `graphic` | `Graphic` | required | The symbol to edit. Stale references are resolved by `attributes.id`. |
| `patch` | `MorphixSymbolPatch` | required | Only the members you want to change. |

Returns the new `Graphic`, or `null` if the edit was not applied. It does not throw: failures are logged with `console.error` and `null` is returned.

Behaviour:

- The old graphic is removed and a new `Graphic` is created that reuses `attributes.id`. Always continue with the returned graphic, not the one you passed in. If the old graphic was selected, the selection is silently moved to the new one (no `selectionChange` event).
- Labels (annotations) for the symbol are regenerated.
- One undo entry labelled `Edit Symbol Details` is pushed (see [06](06-selection-clipboard-undo-templates.md#undoredomanager)). Bulk re-renders driven by the global force-symbol size setting suppress this entry internally.
- A `symbolDetailsEdited` DOM event is emitted (see [Events](#events)).
- The graphic stays on the layer it was on.

Merge rules (`Object.assign`, shallow, per member):

| Patch member | Merged into | Notes |
| --- | --- | --- |
| `sidc` | the SIDC, re-deriving `SID`, `ECHELON`, `SYM_NAME`, `SYM_GEO_TYPE`, `symbolKey` | Non-digits are stripped; shorter than 20 digits is right-padded with `0`; length of 20 or more is kept (so 30-digit codes work). Applied first, before the other members. |
| `amplifier` | amplifier fields (`UNIQUE_DESIG`, `DTG`, ...) | Applies to all kinds, but see the FPoint note below. |
| `drawEssentials` | top-level drawEssentials (`SIZE`, `ANGLE`, `opacity`, `DRAW_TYPE`, ratios, ...) | Any key is accepted and merged. Whether a given symbol class reads a key on re-render depends on that class. |
| `options` | milsymbol OPTIONS object | Silently ignored unless `kind === 'FPoint'`. |
| `labelOptions` | label style | Marks the group as owned by the symbol. |
| `extraSettings` | `lineWidth`, `size`, `textSize`, `opacity` | Marks the group as owned by the symbol. For FPoint, `size` drives the marker size. |
| `cim` | CIM fill settings | Only written back if the merged object is non-empty. |

The SIDC is always mirrored into the amplifier (and into `options` for FPoint), whether or not `sidc` is in the patch.

Validation. The patch is rejected (returns `null`) when:

- the resulting SIDC is not at least 20 digits (`SIDC must be at least 20 digits.`),
- the resulting `symbolKey` is not in `Symbols.json` (`Unknown symbol key ...`),
- the new symbol's geometry family differs from the current one. `Point`, `FPoint` and the `Line`/`Area` pair are separate families: a Point cannot become an FPoint, or a Line/Area, and vice versa. `Line` and `Area` are treated as one family for this check.

Other `null` causes: `updateSymbol` called before the engine was initialized (`MorphixEngine.update() called before initialize()`), a falsy `graphic`, or an exception while re-rendering (for example the graphic is not attached to any graphics layer). The reason is in the console.

`SymbolEngine.applyMorphixEdit` is public, but it is the callback the engine registers with Morphix and it does throw. Use `updateSymbol`.

#### Patch shapes per kind

Point:

```ts
symbolEngine.updateSymbol(graphic, {
  amplifier: { UNIQUE_DESIG: 'TF-9', HIGHER_FORM: '1 Bn' },
  drawEssentials: { SIZE: 40, ANGLE: 45, opacity: 0.8 },
});
```

Line or Area:

```ts
symbolEngine.updateSymbol(graphic, {
  amplifier: { UNIQUE_DESIG: 'PL ALPHA' },
  drawEssentials: { opacity: 0.6 },
  extraSettings: { lineWidth: 4 },
});
```

FPoint (Force symbol). The renderer reads the milsymbol OPTIONS object, so designations go in `options`, size in `extraSettings.size`, rotation and opacity in `drawEssentials`:

```ts
symbolEngine.updateSymbol(graphic, {
  sidc: '10031000151211000000',
  options: { uniqueDesignation: 'A Coy', higherFormation: '1 Bn' },
  extraSettings: { size: 40 },
  drawEssentials: { ANGLE: 30, opacity: 0.9 },
});
```

Choose the shape from `getSymbolState(graphic).kind`, as the API Test panel in `index.html` does:

```ts
const { kind } = symbolEngine.getSymbolState(graphic);
const patch = kind === 'FPoint'
  ? { options: { uniqueDesignation: desig } }
  : { amplifier: { UNIQUE_DESIG: desig } };
const updated = symbolEngine.updateSymbol(graphic, patch);
if (!updated) console.warn('update rejected, see console');
```

Note for FPoint: the source states that the milsymbol renderer reads the amplifier data from `options`, so editing the flat `amplifier` of an FPoint symbol has no visible effect. The editor and `getSymbolState` do bridge the two naming schemes when reading (see the mapping table below) but `updateSymbol` does not bridge them on write. Patch `options` for FPoint.

Changing the SIDC. Pass `sidc` (see the FPoint example above). Two patterns are used in `src/main.ts` (`applyDockEditPatch`): read the current SIDC from `getSymbolState`, splice the identity digit (positions 2-4) and echelon digits (positions 8-10), and send the result. Only codes whose `symbolKey` exists in `Symbols.json` and belongs to the same geometry family are accepted; see [13-symbol-catalog.md](13-symbol-catalog.md).

#### Patchable fields

Any key can be merged, so this is not a closed list. The following are the fields the built-in editor exposes and that are known to have a visible effect. All other keys are stored but their effect depends on the symbol class.

##### Amplifier fields (Point, Line, Area)

Drawn beside the symbol by `AnnotationEngine`:

| Key | Editor type | Notes |
| --- | --- | --- |
| `UNIQUE_DESIG` | text | Unit / designation |
| `HIGHER_FORM` | text | Higher formation |
| `STAFF_COM` | text | Staff comments |
| `ADDL_INFO` | text | Additional info |
| `TARGET_DESIGNATOR` | text | |
| `DTG` | date-time group | Drawn above the symbol |
| `EDTG` | date-time group | Drawn below the symbol |

Stored with the symbol and carried into exports, but not drawn on the map:

| Key | Editor type |
| --- | --- |
| `TYPE` | text |
| `QUANTITY` | number, min 0 |
| `COUNTRY` | three-letter country code (ISO 3166-1 / GENC) |
| `LOC` | text |
| `ALTITUDE_DEPTH` | text |
| `DISTANCE` | text |
| `AZIMUTH` | number, 0-360 |

##### FPoint `options` fields

| Key | Editor type / range |
| --- | --- |
| `uniqueDesignation` | text |
| `higherFormation` | text |
| `type` | text |
| `quantity` | number, min 0 |
| `reinforcedReduced` | one of `''`, `'+'`, `'-'`, `'+-'` |
| `staffComments` | text |
| `additionalInformation` | text |
| `dtg` | date-time group |
| `location` | text |
| `direction` | number, 0-360 |
| `speed` | text |
| `altitudeDepth` | text |
| `combatEffectiveness` | text |
| `evaluationRating` | text |
| `commonIdentifier` | text |
| `specialHeadquarters` | text |
| `signatureEquipment` | text |
| `platformType` | text |
| `equipmentTeardownTime` | text |
| `iffSif` | text |
| `sigint` | text |
| `hostile` | text |

Values already stored under other `options` keys (for example `roa`, `msn`) survive an edit because the whole OPTIONS payload is cloned. They are not offered by the editor because the renderer does not draw them.

Name bridging between the flat amplifier and `options`, applied when reading state:

| Flat amplifier | `options` |
| --- | --- |
| `UNIQUE_DESIG` | `uniqueDesignation` |
| `HIGHER_FORM` | `higherFormation` |
| `STAFF_COM` | `staffComments` |
| `ADDL_INFO` | `additionalInformation` |
| `QUANTITY` | `quantity` |
| `TYPE` | `type` |
| `DTG` | `dtg` |
| `LOC` | `location` |
| `ALTITUDE_DEPTH` | `altitudeDepth` |

##### Size, rotation, opacity, line width

| Kind | Size | Rotation | Opacity | Line width |
| --- | --- | --- | --- | --- |
| Point | `drawEssentials.SIZE` (0-200 in the editor; 0 keeps the symbol's own default) | `drawEssentials.ANGLE` (0-360) | `drawEssentials.opacity` (0-1) | n/a |
| FPoint | `extraSettings.size` (10-200 in the editor; only applied when it is a finite number greater than 0) | `drawEssentials.ANGLE` | `drawEssentials.opacity` (default 1 on re-render) | n/a |
| Line | n/a | n/a | `drawEssentials.opacity` | `extraSettings.lineWidth` (0.5-12) |
| Area | n/a | n/a | `drawEssentials.opacity` | `extraSettings.lineWidth` |

For FPoint, `ANGLE`, `opacity` and `size` are copied into the OPTIONS object on re-render. `extraSettings.opacity` is a second copy of opacity that `SymbolEngine` prefers when present; the editor exposes only the `drawEssentials.opacity` control, so patch that one unless you also set `extraSettings.opacity` yourself.

##### Advanced drawEssentials fields

| Kinds | Keys |
| --- | --- |
| Point | `OFFSET` (text), `ISFHAND`, `FRHNDSZ`, `FRHNDWDTH` |
| Line | `DRAW_TYPE`, `ARROWHEAD_RATIO`, `BK_LN_DIST_RATIO`, `BK_LN_ANGL_RATIO`, `FRNT_LN_DIST_RATIO`, `FRNT_LN_ANGL_RATIO`, `FLAP_DIST_RATIO`, `FLAP_ANGLE`, `ISFHAND`, `FRHNDSZ`, `FRHNDWDTH` |
| Area | `DRAW_TYPE`, `ISFHAND`, `FRHNDSZ`, `FRHNDWDTH` |
| FPoint | none |
| all | `extraSettings.textSize` (marker text size, 6-72) |

`DRAW_TYPE` is a variant index defined by each symbol's own class. The five ratio fields default to the symbol class's own value; they are only written back if the symbol already carried them or the patch sets them.

##### Label style (`labelOptions`)

| Key | Type | Notes |
| --- | --- | --- |
| `fontFamily` | string | One of `Arial`, `Times New Roman`, `Courier New`, `Verdana`, `Tahoma`, `Georgia`, `Trebuchet MS` in the editor |
| `textSize` | number | 6-72 |
| `color` | `number[]` (RGB) | Label text colour, e.g. `[255, 255, 255]` |
| `haloColor` | `number[]` (RGB) | Outline colour |
| `haloColorSize` | number | 0-10 |
| `bold`, `italic`, `uLine`, `oLine`, `tLine` | `0 \| 1` | Bold, italic, underline, overline, strikethrough. The editor writes `1` or `0`. |

```ts
symbolEngine.updateSymbol(graphic, {
  labelOptions: { color: [255, 255, 255], haloColor: [0, 0, 0], haloColorSize: 2, bold: 1, textSize: 14 },
});
```

Colours. The editor has no field for the symbol's own line or fill colour on Point, Line, Area or FPoint symbols: those are derived from the SIDC (standard identity). To recolour by affiliation, change the SIDC. The `DrawEssentials` class also declares `LINE_COLOR`, `FILL`, `FILL_COLOR` and `FILL_OPACITY` (freehand draw-style overrides). They pass through `drawEssentials` patches, but this documentation did not verify that every symbol class honours them on re-render.

##### CIM fill texture (`cim`)

`DrawEssentials.cim` is typed as `{ style?, size?, color?, gridType?: 'Fixed' | 'Random', randomness?, stepX?, stepY?, shiftOddRows? }` (used by the minefield texture fill). It is merged as given. The built-in editor has no controls for it apart from a reset.

## Built-in editor (Morphix modal)

### openSymbolEditor(graphic: Graphic): void

Opens the modal editor for a symbol. It has four tabs (Symbol, Labels, Look, Advanced), a live preview, validation and a Save button. Save runs the same path as `updateSymbol`, so it produces the `Edit Symbol Details` undo entry and the `symbolDetailsEdited` event.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `graphic` | `Graphic` | required | Symbol to edit. |

Keyboard inside the modal: `Escape` closes (if there are unsaved edits it first asks to confirm discarding), `Ctrl+S` / `Cmd+S` saves when the state is valid. There is no public method to close the modal from code; it is closed by the user, or torn down when the engine is destroyed.

The modal mounts a `div#morphix-root` on `document.body` (`position: fixed`, `z-index: 4000`).

### Context menu "Show Details" and the `symbolDetailsRequested` event

The context menu item Show Details (shortcut `I`) calls an internal function that first dispatches a cancelable `CustomEvent` named `symbolDetailsRequested`. If no listener calls `preventDefault()`, the built-in Morphix modal opens. A host that has its own details panel claims the request:

```ts
document.addEventListener('symbolDetailsRequested', (e) => {
  const { graphic, state } = (e as CustomEvent).detail; // state = getSymbolState(graphic)
  e.preventDefault();                                   // suppress the built-in modal
  myDetailsPanel.show(graphic, state);
});
```

The event is dispatched on `view.container` (falling back to `document`) and bubbles, so a `document` listener receives it. This is the pattern used by the Symbol Details dock in `src/main.ts`. The dock falls back to `symbolEngine.openSymbolEditor(graphic)` for its "More details" button.

## Interactive geometry editing

### modifySymbol(graphic: Graphic): void

Starts the interactive Move / Scale / Rotate session. This is what the context menu item "Move, Scale, Rotate" and the `M` key call.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `graphic` | `Graphic` | required | Primary symbol. |

Behaviour:

- Any running draw, edit or selection-move workflow is closed first.
- If two or more symbols are selected, the whole live selection is edited together (the given graphic first), whichever graphic was passed.
- Every session runs through a proxy bounding box, so a single symbol and a group behave the same. Movement, rotation and uniform scaling are applied as one similarity transform to every member, including `CTRL_PTS` and `BASE_LN_PTS`.
- A single point symbol gets move and rotate only; scaling is disabled. Lines, areas and any multi-symbol selection get move, rotate and scale.
- Labels are hidden during the transform and rebuilt afterwards.
- A pre-edit snapshot labelled `Move, Scale, Rotate` is captured, and one undo entry is pushed when the edit completes.
- The session ends when the user clicks outside the proxy (completes the edit), clicks the on-map Disable button, or presses `Escape`.
- A draggable, minimizable banner appears bottom-right while the session is active. The selection quick toolbar is hidden meanwhile.
- Ending the session through `Escape` or `deactivateEdit()` commits the transform in progress (the source finalizes the proxy transform and emits `changeInSymbol` before tearing down); it does not revert to the pre-edit geometry.

### activateEditControlPoints(graphic: Graphic): void

Starts vertex editing: a draggable handle is shown at each control point (`drawEssentials.CTRL_PTS`), and the symbol is redrawn live through its own `createSymbol()`. This is what the context menu item "Edit Control Points" and the `E` key call.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `graphic` | `Graphic` | required | A line or area symbol that has `CTRL_PTS`. |

Behaviour:

- If the symbol has no control points (point symbols, most freehand shapes) an error is logged to the Engine Log and the console, and nothing else happens. No exception is thrown.
- Drag a handle to move that control point. Redraws are coalesced to one per animation frame.
- Click on the symbol body to insert a new control point on the nearest segment (the new handle is green).
- Click on a green (added) handle without dragging to remove it. Original handles cannot be removed, and removal is refused if only two points would remain.
- Click on empty map space or press `Escape` to leave the mode.
- Labels are hidden while editing and rebuilt after each completed drag.
- The context menu entry is hidden while two or more symbols are selected.
- Undo: a snapshot labelled `Edit Control Points` is captured at activation. Only the first `changeInSymbol` event of the session consumes that snapshot and creates an undo entry; later drags, additions or removals within the same session are not recorded as separate undo steps.

### deactivateEdit(): void

Ends any active Move/Scale/Rotate or control-point session and clears all handles, the proxy, the banner and the Escape listener. Safe to call when nothing is active. In a Move/Scale/Rotate session it commits the transform in progress, then emits `changeInSymbol`.

### scalePointSymbol(graphic: Graphic, factor: number): void

Sets `drawEssentials.SIZE` of a point symbol to `max(10, originalSize * factor)` and emits the `scalePointSymbol` event on the EditEngine (payload `{ graphic, newSize }`).

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `graphic` | `Graphic` | required | Point symbol. Does nothing if it has no drawEssentials. |
| `factor` | `number` | required | 1.2 = 20 percent larger, 0.8 = 20 percent smaller. |

The method only changes the stored `SIZE` and emits the event. The library does not itself listen for `scalePointSymbol` and does not re-render the marker, so the on-map symbol does not change unless the host regenerates it. To change the size and re-render in one call, use `updateSymbol(graphic, { drawEssentials: { SIZE: n } })` (Point) or `{ extraSettings: { size: n } }` (FPoint) instead.

The baseline size (`attributes.__origSize`, default `SIZE || 35`) is recorded on the first call and cleared by `deactivateEdit()`, so repeated calls scale from the true original.

### Programmatic transforms without the UI

There is no headless move/rotate/scale API for lines and areas. Options for a host:

- Point symbols: `updateSymbol` with `drawEssentials.ANGLE` (rotation) or the size fields above.
- Translate a set of graphics by map-unit offsets: `symbolEngine.selectionEngine._applyDelta(graphics, dx, dy)` exists and is public, but is underscore-prefixed and pushes no undo entry. Treat it as unstable.
- Interactive only: `modifySymbol`, `selectionEngine.moveSelected(...)` (see [06](06-selection-clipboard-undo-templates.md)).

### Entering and exiting edit mode programmatically

```ts
symbolEngine.modifySymbol(graphic);                 // enter move / rotate / scale
// or
symbolEngine.activateEditControlPoints(graphic);    // enter vertex editing

if (symbolEngine.editEngine.isModifyingSymbol || symbolEngine.editEngine.isEditingControlPoints) {
  symbolEngine.deactivateEdit();                    // exit either mode
}
```

Feature flags `features.editMoveScaleRotate` and `features.editControlPoints` (both `true` in `Settings.json`) only hide the corresponding context menu entries. Calling the methods directly is not gated by them. See [08-settings.md](08-settings.md).

## Events

### DOM events (CustomEvent on `view.container`, bubbling)

Dispatched on the view's container element, so a listener on `document` or on the container receives them (falls back to `document` if the container is unavailable).

| Event | Cancelable | `detail` | Emitted when |
| --- | --- | --- | --- |
| `symbolDetailsRequested` | yes | `{ graphic: Graphic, state: MorphixSymbolSnapshot }` | Show Details / `I` key. `preventDefault()` stops the built-in modal. |
| `symbolDetailsEdited` | yes (no effect) | `{ graphic: Graphic, id: string, drawEssentials: DrawEssentials }` | After every successful `updateSymbol` or editor Save. `graphic` is the new instance. |

### EditEngine events (`symbolEngine.editEngine.on`)

```ts
const handle = symbolEngine.editEngine.on('changeInSymbol', ({ graphic, additionalGraphics }) => {
  console.log('geometry edited', graphic.attributes.id, additionalGraphics?.length ?? 0);
});
handle.remove(); // unsubscribe
```

`on(type: string, listener: Function): { remove(): void }`

| Event | Payload | Emitted when |
| --- | --- | --- |
| `changeInSymbol` | `{ graphic }`, plus `additionalGraphics: Graphic[]` for move/scale/rotate sessions | A geometry edit completed: proxy transform completed or the session was finalized, a control-point handle drag finished, a control point was added or removed, a single-point SketchViewModel move completed. |
| `scalePointSymbol` | `{ graphic, newSize }` | After `scalePointSymbol()`. |

A listener that throws is caught and logged; it does not affect other listeners.

Important: the `EditEngine` instance is replaced on every 2D/3D view switch (`SymbolEngine.onViewChanged`). Read `symbolEngine.editEngine` again and re-register listeners after a view switch. The library re-wires its own listeners (undo, quick toolbar, keyboard) automatically; yours are not migrated.

## EditEngine reference

`symbolEngine.editEngine` returns the underlying `EditEngine`. Hosts should normally use the `SymbolEngine` methods above, because those also capture the pre-edit undo snapshot; calling `EditEngine` methods directly bypasses undo capture.

| Member | Signature | Notes |
| --- | --- | --- |
| `activate` | `(graphic: Graphic, additionalGraphics: Graphic[] = []): void` | Legacy SketchViewModel path: move for a point, transform for lines/areas. Needs the graphic's `origin.layer`; prefer `SymbolEngine.modifySymbol`. |
| `activateMixedEdit` | `(graphic: Graphic, additionalGraphics: Graphic[] = [], opts: { enableScaling?: boolean } = {}): void` | Proxy-based group transform used by `modifySymbol`. `enableScaling` defaults to `true`. |
| `activateEditControlPoints` | `(graphic: Graphic): void` | Vertex editing. |
| `scalePointSymbol` | `(graphic: Graphic, scaleFactor: number): void` | As above. |
| `deactivate` | `(): void` | End any session. |
| `isEditingControlPoints` | `boolean` (getter) | True while control-point handles are visible. |
| `isModifyingSymbol` | `boolean` (getter) | True while a SketchViewModel move/transform is active and control-point mode is not. |
| `on` | `(type: string, listener: Function): { remove(): void }` | See Events. |
| `buildContextMenuItems` | `(onModify, onActivateCtrlPts, onDeactivate, getSelectionCount?): ContextMenuItem[]` | Builds the "Edit" submenu (`edit-submenu`), used internally by `SymbolEngine`. |

Default shortcuts for these modes (`M`, `E`, `Escape`, `I`) are listed in [06-selection-clipboard-undo-templates.md](06-selection-clipboard-undo-templates.md#keyboard-shortcuts).

## MorphixEngine reference (internal)

`MorphixEngine` (`MS/Engines/Morphix/MorphixEngine.ts`, default export) is created and owned by `SymbolEngine`. Its members map to the public API as follows; do not instantiate it in a host.

| Member | Exposed through |
| --- | --- |
| `initialize(view, layerManager, callbacks)` | Called by `SymbolEngine` on construction and after every view switch. `callbacks.applyEdit` is `SymbolEngine.applyMorphixEdit`. |
| `open(graphic)` | `symbolEngine.openSymbolEditor` |
| `update(graphic, patch)` | `symbolEngine.updateSymbol` |
| `getSymbolState(graphic)` | `symbolEngine.getSymbolState` |
| `destroy()` | Called from `SymbolEngine.destroy()`; removes the modal root and its key listener. |

## Ambiguities and limits

- The engine logs `[Morphix DEBUG]` messages to the console on editor Save (marked for removal in the source).
- `options` patches on non-FPoint symbols are dropped without a warning.
- For FPoint symbols, the effect of patching `amplifier` (as opposed to `options`) is based on a source comment, not on a test.
- `extraSettings` and `labelOptions` reported by `getSymbolState` can be class defaults for symbols that never carried them (see the ownership note).
