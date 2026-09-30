# 08 - Settings system

This document covers the runtime settings tree (`Data/Settings.json`), how a host reads, changes, observes and persists it, the modular settings-widget mechanism (`SettingsWidget`, `SettingsMenu`, `CommandPalette` / Ctrl+K), and the legacy `settingsChanged` event. A complete reference table of every key in `Settings.json` is at the end.

Related documents: [README](README.md) | [Getting started](01-getting-started.md) | [SymbolEngine API](02-symbol-engine-api.md) | [Measurement, cues, MGRS](09-measurement-cues-mgrs.md) | [Declutter and visualization](10-declutter-visualization.md) | [Analysis engines](11-analysis-engines.md) | [Briefing, collab, stylus](12-briefing-collab-stylus.md)

| Task | Where |
| --- | --- |
| Understand where settings live and who applies them | [Mental model](#mental-model) |
| Read a setting | [Reading settings](#reading-settings) |
| Change a setting at runtime | [Changing settings](#changing-settings-at-runtime) |
| Observe changes | [Observing changes](#observing-changes) |
| Persist settings across sessions | [Persistence](#persistence) |
| `SettingsBus` functions | [SettingsBus API](#settingsbus-api) |
| Build or register a settings panel | [Modular widgets](#modular-settings-widgets) |
| Register a command in Ctrl+K | [CommandPalette API](#commandpalette-api) |
| The `settingsChanged` event contract | [Legacy event](#the-settingschanged-event) |
| What `onSettingChanged` does for each path | [Routing table](#what-onsettingchanged-does-per-path) |
| Every key, type and default | [Key reference](#settingsjson-key-reference) |

---

## Mental model

- The settings tree is a single plain JSON object imported by the library as a module (`Data/Settings.json`; in the build it is `Data/Settings.json.min.js`). `SymbolEngine.settings` returns that same object (not a copy). Every `SymbolEngine` instance and every sub-engine in the same page reads the same object.
- The library never writes settings to disk, `localStorage` or a server. The tree is in-memory only and resets to the shipped defaults on page reload. Persistence is the host's job (see [Persistence](#persistence)).
- `SymbolEngine.onSettingChanged(path, value)` is the single entry point that both stores a value and routes it to the affected sub-engine.
- The library does **not** subscribe to the window-level `settingsChanged` event itself. The settings widgets, the Ctrl+K palette and `SettingsBus.setSetting()` only dispatch that event. Something must forward it to `symbolEngine.onSettingChanged()`. In the test harness this bridge is a listener in `index.html`; a host application must add the equivalent (see [Bridging](#bridging-the-event-to-the-engine)).
- Sub-engines read the tree in two ways: some are pushed the changed block by `onSettingChanged` (measurement, MGRS, drawing cues, proximity, visualization, road network), others read `Settings.json` live at the moment they need a value (declutter engines, freehand `drawStyle`, `features.*` guards in edit/selection/clipboard/shortcuts).

---

## Reading settings

```ts
const s = symbolEngine.settings;            // typeof Settings.json, live object
s.measurement.distUnit;                     // "kilometers"
s.features.mgrsEngine;                      // false
```

Or through the bus, which walks `window.symbolEngine.settings`:

```ts
import { getSetting } from '@lib/Support/SettingsBus';
getSetting<string>(['measurement', 'distUnit']);   // string | undefined
```

`getSetting` reads `window.symbolEngine`, so it returns `undefined` unless the host has assigned the engine to `window.symbolEngine` (the harness does this in `src/main.ts`).

---

## Changing settings at runtime

Three paths exist. Use the first or second.

| Path | Effect |
| --- | --- |
| `symbolEngine.onSettingChanged(path, value)` | Stores the value in the tree and routes it to sub-engines. Preferred programmatic API. |
| `setSetting(path, value)` (SettingsBus) | Dispatches `settingsChanged` on `window`. Takes effect only if a bridge listener forwards it to `onSettingChanged`. Use this when you want widgets and other subscribers to be notified as well. |
| Mutating `symbolEngine.settings.x.y = v` directly | Changes the stored value only. No engine is notified and no event fires. Suitable only before engines read the value (e.g. before the first draw) or for keys read live. Not recommended. |

### Bridging the event to the engine

Add this once in the host, after creating the engine. It is the same wiring `index.html` uses.

```ts
window.addEventListener('settingsChanged', (e) => {
  const { path, value } = (e as CustomEvent).detail as { path: string[]; value: unknown };
  symbolEngine.onSettingChanged(path, value);
});
```

Use `detail.path`, not `detail.fullPath`. Events dispatched by `MagneticCompass` (see [09](09-measurement-cues-mgrs.md)) carry only `path` and `value`; `fullPath` is absent on those.

### `onSettingChanged(path: string[], value: any): void`

Creates intermediate objects if a path segment is missing, assigns `value` at the leaf, applies engine-specific routing (table [below](#what-onsettingchanged-does-per-path)), then dispatches the `settingChanged` DOM event (see [Observing changes](#observing-changes)).

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `path` | `string[]` | required | Key path, e.g. `['declutter', 'cluster', 'enabled']`. |
| `value` | `any` | required | New value. No validation or type coercion is performed by this method; widgets coerce numbers before dispatching. Colors are `[r, g, b]` arrays. |

```ts
symbolEngine.onSettingChanged(['measurement', 'distUnit'], 'nautical-miles');
symbolEngine.onSettingChanged(['features', 'mgrsEngine'], true);   // lazy-inits the MGRS engine
```

---

## Observing changes

Three notification surfaces exist.

| Surface | Fired by | Target | Payload |
| --- | --- | --- | --- |
| `settingsChanged` (CustomEvent) | `setSetting()`, widgets, palette, legacy panel, `DrawingCueEngine.openCompassWidget()`, `MagneticCompass` widget | `window` | `{ path: string[], value: unknown, fullPath?: string }` |
| `onSettingsChanged(cb)` | Wraps the `settingsChanged` listener | `window` | Same payload; returns an unsubscribe function |
| `settingChanged` (CustomEvent) | `SymbolEngine.onSettingChanged()` after routing | The view container element (bubbles, cancelable); falls back to `document` if the container is null | `{ path: string, value: any }` where `path` is dot-joined (e.g. `"mgrs.showGZD"`) |

Note the different names: `settingsChanged` (plural, window) is the request/broadcast; `settingChanged` (singular, view container) is emitted by the engine after it has applied the change.

```ts
symbolEngine.view?.container?.addEventListener('settingChanged', (e) => {
  const { path, value } = (e as CustomEvent).detail;
  console.log(path, value);
});
```

(`SymbolEngine.view` is a public getter returning the active view. The event bubbles, so it can equally be caught on `document`.)

---

## Persistence

The library has no settings persistence. Two host-side patterns follow. Both are suggestions, not library features.

**Record user changes.** Keep a map of overrides keyed by dot path and write it to storage from the bridge listener:

```ts
const KEY = 'myapp.pams8.overrides';
const overrides: Record<string, unknown> = JSON.parse(localStorage.getItem(KEY) ?? '{}');

window.addEventListener('settingsChanged', (e) => {
  const { path, value } = (e as CustomEvent).detail;
  symbolEngine.onSettingChanged(path, value);
  overrides[path.join('.')] = value;
  localStorage.setItem(KEY, JSON.stringify(overrides));
});
```

**Restore at startup.** Either replay the overrides through `onSettingChanged` after constructing the engine, or apply them to the settings module before constructing it.

```ts
// A: replay after construction
for (const [dotPath, value] of Object.entries(overrides)) {
  symbolEngine.onSettingChanged(dotPath.split('.'), value);
}
```

Replay has a limit tied to boot gates (see the `features.*` rows in the [routing table](#what-onsettingchanged-does-per-path)): engines the constructor skipped because their `features.*` flag was off at boot are only lazily created for some flags. `features.proximityEngine` and `features.drawingCues` are **not** lazily created by `onSettingChanged` (the handler only acts when the engine object already exists). `features.measurementEngine`, `features.mgrsEngine`, `features.visualizationEngine`, `features.roadNetwork`, `features.deploymentBuilder`, `features.briefing`, `features.screenAnchor`, `features.collab` are created on demand.

```ts
// B: mutate the settings module before `new SymbolEngine(...)`
import settings from '<path-to-build>/Data/Settings.json.min.js';   // default export is the object the engine reads
settings.features.proximityEngine = true;
settings.features.drawingCues = true;
const symbolEngine = new SymbolEngine(() => view);
```

Pattern B relies on your bundler resolving that import to the same module instance the library imports (`../Data/Settings.json.min.js`). Verify this in your bundler; the source does not enforce it. In a source build the equivalent is editing `MS/Data/Settings.json`.

---

## SettingsBus API

Module: `Support/SettingsBus` (`@lib/Support/SettingsBus` in the harness alias; `dist/MS/Support/SettingsBus.min.js` in the build). All functions are named exports.

### Types

```ts
type SettingPath = readonly string[];

interface SettingsChangedDetail {
  path: string[];
  value: unknown;
  fullPath: string;
}
```

### getSetting&lt;T = unknown&gt;(path: SettingPath): T | undefined

Walks `window.symbolEngine.settings` along `path` and returns the leaf. Returns `undefined` if `window.symbolEngine` or `.settings` is missing, or if any intermediate value is null or not an object.

### setSetting(path: SettingPath, value: unknown): void

Dispatches `new CustomEvent('settingsChanged', { detail: { path: [...path], value, fullPath: path.join('.') } })` on `window`. It does not modify the tree itself; the bridge listener (or another subscriber) does that.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `path` | `SettingPath` | required | Key path. |
| `value` | `unknown` | required | New value. |

### onSettingsChanged(cb: (detail: SettingsChangedDetail) => void): () => void

Adds a `window` listener for `settingsChanged` and calls `cb` for every event that has a `detail`. Returns a function that removes the listener. Note the declared type says `fullPath: string`, but some emitters omit it; do not rely on it.

### Color helpers

| Function | Signature | Behavior |
| --- | --- | --- |
| `hexToRgb` | `(hex: string): [number, number, number]` | `"#ef9f27"` to `[239,159,39]`. Leading `#` optional. Returns `[0,0,0]` on malformed input. |
| `rgbToHex` | `(r: number, g: number, b: number): string` | Clamps each channel to 0..255, rounds, returns `#rrggbb`. |
| `toHexColor` | `(value: unknown): string` | Accepts an RGB array (3+ elements) or a 6-digit hex string (with or without `#`); returns a `#rrggbb` string; `"#000000"` on bad input. |

---

## The `settingsChanged` event

This is the legacy bus that the `#settingsPanel` in `index.html` introduced and that every newer surface reuses.

| Item | Value |
| --- | --- |
| Name | `settingsChanged` |
| Target | `window` |
| `detail.path` | `string[]`, e.g. `['declutter','ladder','layout']` |
| `detail.value` | New value. Colors are `[r,g,b]` arrays (legacy panel converts with `hexToRgb`); numbers are numbers; toggles are booleans |
| `detail.fullPath` | `string`, `path.join('.')`. Present on events from `setSetting()`, the legacy panel and most callers; absent on `MagneticCompass` events |

Dispatching it manually is equivalent to using `setSetting()`:

```ts
window.dispatchEvent(new CustomEvent('settingsChanged', {
  detail: { path: ['mgrs', 'show10K'], value: true, fullPath: 'mgrs.show10K' },
}));
```

Subscribers in the library: `CollabEngine` (via `onSettingsChanged`, for `collab.*` and `features.collab`), every open settings widget (to keep its controls in sync). The harness adds `index.html` listeners for the engine bridge, the render-settings shim (`visualization.render.*` calls `window.applyRenderSettings`), and the declutter perf HUD (`declutter.perfHud`).

---

## Modular settings widgets

Each engine area ships a pair: a manifest file (`XxxSettingsManifest.ts`, an array of `SettingDescriptor`) and a widget file (`XxxSettingsWidget.ts`, which mounts a panel from the manifest and self-registers with the palette and the menu). `SymbolEngine.ts` imports all widget files for their side effects, so the built-in widgets register when the library is loaded.

### SettingDescriptor

```ts
type SettingType = 'boolean' | 'number' | 'enum' | 'color' | 'string' | 'action';

interface SettingOption { value: string; label: string; }

interface SettingDescriptor {
  path: string[];
  label: string;
  group: string;
  type: SettingType;
  options?: SettingOption[];
  min?: number;
  max?: number;
  step?: number;
  colorAsRgb?: boolean;
  hint?: string;
  help: string;
  keywords?: string[];
  buttonLabel?: string;
  onClick?: () => void;
}
```

| Field | Meaning |
| --- | --- |
| `path` | Settings path the row reads and writes. |
| `label` / `group` | Row caption / section heading. Rows are grouped by `group` in first-seen order. |
| `type` | Control: `boolean` checkbox, `number` numeric input, `enum` select, `color` color input, `string` text input, `action` button (no setting is written). |
| `options` | Required for `enum`. `value` is compared as a string. |
| `min`, `max`, `step` | Attributes for `number` inputs. Not enforced when the value is written by other means. |
| `colorAsRgb` | Persist the color as `[r,g,b]` instead of a `#hex` string. Built-in manifests using `type: 'color'` without `colorAsRgb` would write a hex string; check the manifest before assuming the stored form. |
| `hint` | Declared as "display only" in source; not used by the renderer. |
| `help` | Tooltip text shown by the `?` badge. Required. |
| `keywords` | Search synonyms. Declared on the type; the current palette does not index individual settings (see below). |
| `buttonLabel`, `onClick` | For `action` rows: button caption (defaults to `label`) and click handler. |

### mountSettingsWidget(opts: MountWidgetOptions): SettingsWidgetHandle

Module: `Support/SettingsWidget`. Builds a draggable `ms-panel`, appends it to `document.body`, and binds each control to `SettingsBus`. One instance per `id`: calling it again focuses and raises the existing panel (and scrolls to `focusGroup` if given) and returns the existing handle.

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `id` | `string` | required | DOM id and singleton key. |
| `title` | `string` | required | Header title. |
| `icon` | `string` | required | Short text or emoji in the header badge. |
| `manifest` | `SettingDescriptor[]` | required | Rows to render. |
| `anchor` | `{ x?: number; y?: number }` | left 320, top 62 | Pixel position; clamped to the viewport. |
| `width` | `number` | `340` | Panel width in px. |
| `focusGroup` | `string` | none | Group title to scroll into view on open. |

Behavior:

- Controls write through `setSetting()`: booleans and enums on `change`; numbers and strings on `change` and `blur`. A non-finite number is written as `0`.
- The panel listens to `settingsChanged` and updates the matching control, so the panel stays in sync with the legacy panel, the palette and programmatic changes.
- Esc closes the panel (first closes the help popover if open). The panel is tagged `ms-theme-ops-dark`; themes are applied through CSS variables by `ThemeManager`.
- The widget CSS is `MS/Styles/Widgets.css` (`dist/MS/Styles/Widgets.css`). The harness links it from `index.html`. The library does not inject it; a host must load it or the panels are unstyled.

Returned handle:

```ts
interface SettingsWidgetHandle {
  id: string;
  focus(): void;                       // raise above other widgets
  scrollToGroup(group: string): void;
  close(): void;                       // removes DOM and listeners
}
```

### closeAllSettingsWidgets(): void

Closes every widget currently mounted through `mountSettingsWidget`.

### Built-in widgets

Each is also exposed on `window` as `openXxxSettings` and is registered with the palette and the menu under the given category.

| Widget id (registered) | Menu label | Category | Opener | Manifest covers |
| --- | --- | --- | --- | --- |
| `measurement` | Measurement | Engines | `openMeasurementSettings` | `features.measurementEngine`, `measurement.*` |
| `proximity` | Proximity | Engines | `openProximitySettings` | `features.proximityEngine`, `proximity.*` |
| `drawing-cues` | Drawing cues | Engines | `openDrawingCuesSettings` | `features.drawingCues`, `drawingCues.*` |
| `declutter` | Declutter | Engines | `openDeclutterSettings` | `declutter.*` |
| `visualization` | Visualization | Engines | `openVisualizationSettings` | `features.visualizationEngine`, `visualization.*` |
| `analysis` | Analysis engines | Engines | `openAnalysisSettings` | `features.analysisEngines`, `analysis.*` |
| `mgrs` | MGRS grid | Map | `openMGRSSettings` | `features.mgrsEngine`, `mgrs.*` |
| `appearance` | Appearance | Appearance | `openAppearanceSettings` | `size`, `lineWidth`, `PtlineWidth`, `textSize`, `freeHandTextSize`, `freeHandLineWidth`, `ui.theme`, `creationMode` |
| `drawstyle` | Freehand Style | Appearance | `openDrawStyleSettings` | `drawStyle.*` |
| `textstyle` | Text Style | Appearance | `openTextStyleSettings` | `textStyle.*` |
| `core-features` | Application features | Tools | `openCoreFeaturesSettings` | `logging.enabled`, general `features.*` toggles |
| `briefing` | Briefing / Present mode | Tools | `openBriefingSettings` | `features.briefing`, `briefing.*` |
| `export-tools` | PPTX Export | Tools | `openExportToolsSettings` | `features.exportTools`, `exportTools.*` |
| `screen-anchor` | Pin to Screen | Tools | `openScreenAnchorSettings` | `features.screenAnchor` |
| `stylus` | Stylus / Pen | Tools | `openStylusSettings` | `stylus.*` |
| `collab` | Collaboration | Tools | `openCollabSettings` | `features.collab`, `collab.*` |

Each opener accepts `{ anchor?: { x?: number; y?: number } }`; most also accept `focusGroup?: string`. Verify a specific opener's options in its `.d.ts` before relying on `focusGroup`.

The manifests for `roadNetwork.*` and `standardIdentities`/echelon tables have no widget.

---

## CommandPalette API

Module: `Support/CommandPalette`. Named and default export `CommandPalette`. Opened with Ctrl+K (or Cmd+K), handled by `KeyboardShortcutManager`, which is only created when `features.shortcuts !== false`. The key handler works even while an input is focused.

The palette is a launcher: it lists **actions** only. Individual settings are intentionally not shown in results (the ranking code skips them); to change a value the user opens the owning widget. The palette scores by substring, token and label-acronym match against label, hint and keywords.

| Method | Signature | Behavior |
| --- | --- | --- |
| `registerWidget` | `(opts: { id: string; label: string; opener: () => void; category?: string; icon?: string; hint?: string; keywords?: string[] }): void` | One call registers an action `Open <label> settings` (key `widget.<id>`) in the palette **and** a row in the Settings menu under `category` (default `'Engines'`). Errors thrown by `opener` are caught and logged. |
| `registerActions` | `(actions: ActionEntry[]): void` | Adds or replaces actions by `id`. |
| `unregisterAction` | `(id: string): void` | Removes an action. |
| `registerSettings` | `(manifestId: string, manifest: SettingDescriptor[], opener?: () => void): void` | Stores descriptors in an internal registry. The registry is not used for ranking or display, and no built-in module calls it. Provided for compatibility. |
| `open` / `close` / `toggle` | `(): void` | Show, hide, toggle the overlay. |
| `isOpen` | `(): boolean` | Overlay visibility. |

```ts
interface ActionEntry {
  id: string;
  label: string;
  hint?: string;          // faint secondary text
  keywords?: string[];    // synonyms that raise rank
  run: () => void;        // invoked on Enter or click
}
```

The palette overlay uses classes from `Widgets.css` (`ms-palette-*`).

### Registering your own command and widget

```ts
import CommandPalette from '@lib/Support/CommandPalette';
import { mountSettingsWidget } from '@lib/Support/SettingsWidget';
import type { SettingDescriptor } from '@lib/Support/SettingsWidget';

const manifest: SettingDescriptor[] = [
  {
    path: ['measurement', 'speedKmh'],
    label: 'March speed (km/h)',
    group: 'Planning',
    type: 'number', min: 0, max: 200, step: 0.5,
    help: 'Speed used for march-time estimates.',
  },
  {
    path: ['measurement', 'lineColor'],
    label: 'Line color',
    group: 'Planning',
    type: 'color', colorAsRgb: true,
    help: 'Color of measurement lines.',
  },
];

function openMyPanel() {
  return mountSettingsWidget({ id: 'my-planning-settings', title: 'Planning', icon: 'P', manifest });
}

CommandPalette.registerWidget({
  id: 'my-planning',
  label: 'Planning',
  category: 'Tools',
  opener: openMyPanel,
  keywords: ['march', 'speed'],
});

CommandPalette.registerActions([
  { id: 'myapp.export', label: 'Export plan', hint: 'MyApp', run: () => myExport() },
]);
```

The custom panel only affects the engine if the [bridge](#bridging-the-event-to-the-engine) is installed, because it writes through `setSetting()`.

---

## SettingsMenu API

Module: `Support/SettingsMenu`. Named and default export `SettingsMenu`. A popover listing every registered widget grouped by category; clicking a row closes the popover and calls the entry's `opener`.

Category order: `Engines`, `Map`, `Appearance`, `Tools`; any other category appears after these. Entries within a category are sorted alphabetically by label.

| Method | Signature | Behavior |
| --- | --- | --- |
| `registerEntry` | `(entry: MenuEntry): void` | Adds or replaces an entry by `id`; refreshes the popover if open. Normally called indirectly through `CommandPalette.registerWidget`. |
| `unregisterEntry` | `(id: string): void` | Removes an entry. |
| `open` | `(anchor: HTMLElement): void` | Opens the popover under `anchor` (aligned to the anchor's right edge, clamped to the viewport). If already open, closes it instead (toggle). Click outside or Esc closes. |
| `close` | `(): void` | Closes the popover. |
| `isOpen` | `(): boolean` | Popover state. |

```ts
interface MenuEntry {
  id: string;
  label: string;
  category: string;     // 'Engines' | 'Map' | 'Appearance' | 'Tools' | custom
  icon?: string;        // icon name from Managers/MenuIcons; falls back to 'settings'
  hint?: string;
  opener: () => void;
}
```

Harness usage (`src/main.ts`): `settingsMenuBtn.addEventListener('click', () => SettingsMenu.open(menuDropdownBtn));`.

---

## What `onSettingChanged` does per path

Rows are evaluated independently, so one change can match several rows.

| Path pattern | Effect |
| --- | --- |
| `drawStyle.*`, `textStyle.*` | If a freehand draw is armed but not yet started, re-arms it after an 80 ms debounce so the new style is used. Otherwise stored only; freehand symbols read `drawStyle` at draw time. |
| `features.measurementEngine` | true: lazy-loads `MeasurementEngine` if needed, then `enable()`. false: `disable()`. |
| `features.collab` | true: lazy-loads `CollabEngine`. false: `disable()`. `collab.*` is read by the collab engine itself through `SettingsBus`. |
| `features.proximityEngine` | Calls `enable()` / `disable()` only if the engine object exists (it is not created here). |
| `features.contextMenu` | `contextMenuManager.enable()` / `disable()`. |
| `features.clipboard` = false | Clears the clipboard. Other guards read the flag live. |
| `features.selectionQuickToolbar` | Enables/disables the selection action panel if it exists. |
| Other `features.*` | Stored; guards elsewhere read the flag live (`copyPaste`, `shortcuts`, `selectionMenu`, `alignMenu`, `editMoveScaleRotate`, `editControlPoints`, `saveLoad`, `autoShapes`, `exportTools`). |
| `measurement.*` | Re-applies the whole `measurement` block through `MeasurementEngine.setOptions` (only if the engine is loaded). |
| `proximity.*` | Maps the leaf key to `ProximityEngine.updateConfig` (keys: `nearestVertex`, `nearestCoordinate`, `showDistance`, `distanceUnit`, `snapRadiusPx`, `lineColor`, `lineOpacity`, `lineWidth`, `markerColor`, `markerSize`, `fontSize`, `fontColor`). Only if the engine exists. |
| `features.analysisEngines` | false: `destroyAll()`; true: `initAll(true)`. |
| `analysis.<name>` | `AnalysisEngineRegistry.setEnabled(name, !!value)` while `features.analysisEngines` is not false. |
| `features.mgrsEngine` | Enables/disables; if the engine was not created at boot and value is true, creates it. |
| `mgrs.*` | Re-applies the whole `mgrs` block through `MGRSEngine.setOptions` (only if the engine exists). |
| `features.visualizationEngine` | Enables/disables; creates the engine when value is true and it does not exist. |
| `visualization.*` | Re-applies the whole `visualization` block through `VisualizationEngine.setOptions` (only if the engine exists). Render settings additionally need `applyRenderSettings` (see [10](10-declutter-visualization.md)). |
| `features.drawingCues` | `enable()` / `disable()` only if the engine exists (not created here). |
| `drawingCues.*` | Re-applies the whole `drawingCues` block through `DrawingCueEngine.setOptions` (only if the engine exists). |
| `features.roadNetwork` | true: re-probes the backend and, if reachable, shows the roads layer and initializes trafficability; false: disables and hides. |
| `roadNetwork.*` | `showRoadsLayer` shows/hides the roads layer; other keys are pushed to `RoadNetworkEngine.updateConfig`. |
| `logging.enabled` | `EngineLogger.setEnabled(!!value)`. |
| `features.deploymentBuilder`, `features.briefing`, `features.screenAnchor` | Lazy-create on true; `disable()` on false; `enable()` when already created. |
| `size` | Resizes every FPoint (force symbol) already on the FORCE layer through `updateSymbol` (undo suppressed). |
| `creationMode` | Sets single or continuous creation; switching to `single` cancels the active draw. |
| `ui.theme` | `ThemeManager.getInstance().setTheme(value)`. |
| `declutter.enabled` | `DeclutterEngine.enable()` / `disable()`. |
| `declutter.cluster.enabled`, `declutter.labels.enabled`, `declutter.disperse.enabled`, `declutter.ladder.enabled` | Enable/disable the matching sub-engine. |
| any `declutter.*` except `declutter.enabled` | `refresh()` on the declutter engine, plus the matching sub-engine for `cluster.*`, `labels.*`, `disperse.*`, `ladder.*`. |
| every path | Emits `settingChanged` (see [Observing changes](#observing-changes)). |

Not routed by `onSettingChanged`: `stylus.*` (read live by the stylus controller through `getSettings`), `exportTools.*`, `briefing.*`, `standardIdentities`, the echelon tables. These are read when needed.

---

## Settings.json key reference

Types: `bool`, `number`, `string`, `rgb` (array `[r,g,b]`, 0..255), `enum`, `object`, `array`. "Default" is the value shipped in `Settings.json` at the time of writing. Where the code has a different fallback than the shipped JSON, this is stated in the meaning (the JSON value wins whenever the key is present).

"Read by" notes use these terms: **boot** = evaluated once at engine construction; **live** = read each time it is needed; **pushed** = applied by `onSettingChanged` routing.

### Root and metadata

| Path | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | string | `"Military Symbology Settings File"` | Descriptive label. Not read by the library. |
| `version` | string | `"0.1.1"` | File version label. Not read by the library. |
| `date` | string | `"13-Feb-2017"` | File date label. Not read by the library. |
| `offline` | bool | `false` | Read by the harness `src/main.ts` only: true selects local ArcGIS Server services for the basemap, false selects Esri's online basemap. No effect inside the library. |
| `size` | number | `30` | Default marker size (px) for force (UEI/FPoint) symbols that do not declare their own `Size` parameter. Changing it resizes existing force symbols (live via `onSettingChanged`). Widget range 5..200. |
| `lineWidth` | number | `2.5` | Default stroke width for symbol outlines and tactical graphics (px). Read from `Settings.lineWidth` in `SIDC.ts`. Widget range 0.5..20. |
| `PtlineWidth` | number | `14` | Line width used for point-based symbols in `SIDC.ts` (`Settings.PtlineWidth`). Widget range 1..50. |
| `textSize` | number | `12` | Default annotation/label font size (px); read by draw, edit, clipboard, selection and undo paths when they rebuild labels. Widget range 6..48. |
| `freeHandTextSize` | number | `14` | Font size for text added by the freehand tools. Exposed in the Appearance widget; no direct reader found in `MS/` other than the widget and the legacy panel. |
| `freeHandLineWidth` | number | `2.5` | Line width for freehand graphics. Exposed in the Appearance widget; no direct reader found in `MS/` other than the widget and the legacy panel. |
| `creationMode` | enum | `"single"` | `"single"` or `"continuous"`. Continuous re-arms the same symbol after each placement. Also available as `symbolEngine.creationMode` getter/setter. Pushed. |

### drawStyle (freehand style)

Read live when a freehand symbol is drawn; changing it while a freehand draw is armed re-arms the draw.

| Path | Type | Default | Meaning |
| --- | --- | --- | --- |
| `drawStyle.useAffiliationColor` | bool | `false` | true: strokes use the SIDC affiliation color; false: `lineColor` is applied. (The widget help text says "default" for true, but the shipped value is false.) |
| `drawStyle.lineColor` | rgb | `[0,51,204]` | Stroke color for freehand symbols when `useAffiliationColor` is false. |
| `drawStyle.lineWidth` | number | `3` | Stroke width (px), range 0.5..20. |
| `drawStyle.lineStyle` | enum | `"solid"` | `solid`, `dash`, `dot`, `dash-dot`, `short-dash`, `short-dot`, `long-dash`, `long-dash-dot`, `long-dash-dot-dot`. |
| `drawStyle.fill` | bool | `true` | Fill freehand area symbols. |
| `drawStyle.fillColor` | rgb | `[0,51,204]` | Fill color for freehand areas. |
| `drawStyle.fillOpacity` | number | `0.5` | Fill opacity 0..1. |

### textStyle

Applied to newly created labels. The harness reads it in `src/main.ts` when building label parameters.

| Path | Type | Default | Meaning |
| --- | --- | --- | --- |
| `textStyle.fontFamily` | enum | `"Arial"` | `Arial`, `Times New Roman`, `Courier New`, `Verdana`, `Tahoma`, `Georgia`, `Trebuchet MS`. |
| `textStyle.textSize` | number | `14` | Point size, range 6..72. |
| `textStyle.textColor` | rgb | `[0,0,0]` | Label fill color. |
| `textStyle.bold` | bool | `false` | Bold labels. |
| `textStyle.italic` | bool | `false` | Italic labels. |
| `textStyle.underline` | bool | `false` | Underline labels. |
| `textStyle.highlight` | bool | `false` | Colored halo behind text. When false, text keeps a thin white halo. |
| `textStyle.highlightColor` | rgb | `[255,235,60]` | Halo color. |
| `textStyle.highlightSize` | number | `4` | Halo thickness (px), range 1..12. |

### Symbology tables

| Path | Type | Default | Meaning |
| --- | --- | --- | --- |
| `standardIdentities` | array of objects | 26 entries | Each entry has a two-digit key (`"00"`..`"25"`) whose value is a color string such as `"[0, 51, 204]"` (a JSON-encoded array in a string, parsed by `SIDC.ts`) and a `Name`. Used for affiliation colors. Keys `"03"` Friend `[0,51,204]`, `"04"` Neutral `[64,135,64]`, `"06"` Hostile `[255,48,49]`, `"01"` Unknown `[255,255,0]`. |
| `ZoomLvlEchelon` | object | keys `"0"`..`"23"` | Map of integer zoom level to the list of echelon codes visible at that zoom. Read live by `DeclutterEngine` when `declutter.symbols.echelonBased` is true. The engine picks the greatest key not above the current integer zoom; echelon `"00"` (none) is always in the lists. |
| `echelonMap`, `echelonMap20`, `echelonMap23` | object | keys by level | Echelon-by-level tables (`echelonMap` keys `0`..`16`, `echelonMap20` keys `0`..`20`, `echelonMap23` keys `0`..`23`). No reader found in `MS/` or `src/`; treat as legacy data. |

### features

Master switches. "Boot" column: how the flag is evaluated at construction; runtime behavior is in the [routing table](#what-onsettingchanged-does-per-path).

| Path | Type | Default | Meaning and boot rule |
| --- | --- | --- | --- |
| `features.measurementEngine` | bool | `false` | Live measurement. Boot: engine module is loaded unless the flag is exactly `false`. It stays disabled until `enable()`/`toggleMeasurement()`. |
| `features.contextMenu` | bool | `true` | Right-click menu. Boot: disabled only if exactly `false`. |
| `features.editEngine` | bool | `true` | Listed in the Application-features widget. No reader found in `MS/` beyond the manifest. |
| `features.annotationEngine` | bool | `true` | Listed in the widget. No reader found in `MS/` beyond the manifest. |
| `features.shortcuts` | bool | `true` | Global keyboard shortcuts including Ctrl+K. Boot: shortcuts are attached unless exactly `false`; context-menu shortcut items also check it live. |
| `features.copyPaste` | bool | `true` | Copy/paste of selected symbols and clone-drag. Read live. |
| `features.saveLoad` | bool | `true` | Save/load plans. Read live by `SerializationEngine`. |
| `features.templates` | bool | `true` | Listed in the widget. No reader found in `MS/` beyond the manifest. |
| `features.proximityEngine` | bool | `false` | Snap indicators. Boot: engine is created and enabled unless exactly `false`. Not lazily created afterwards. |
| `features.selectionMenu` | bool | `true` | Selection submenu in the context menu. Read live. |
| `features.alignMenu` | bool | `true` | Align/distribute submenu (needs 2+ selected). Read live. |
| `features.selectionQuickToolbar` | bool | `true` | Bottom-centre toolbar when symbols are selected. Boot and pushed. |
| `features.clipboard` | bool | `true` | Clipboard storage behind copy/paste. Read live; false clears it. |
| `features.editMoveScaleRotate` | bool | `true` | Move/Scale/Rotate items in the Edit menu. Read live. |
| `features.editControlPoints` | bool | `true` | "Edit control points" items. Read live. |
| `features.drawingCues` | bool | `false` | Drawing cue overlays. Boot: created and enabled unless exactly `false`. Not lazily created afterwards. |
| `features.mgrsEngine` | bool | `false` | MGRS grid. Boot: created and enabled unless exactly `false`; lazily created when set to true later. |
| `features.analysisEngines` | bool | `true` | Master switch for the analysis suite. |
| `features.deploymentBuilder` | bool | `true` | Deployment manager. Boot: loaded only if exactly `true`; lazy on change. |
| `features.visualizationEngine` | bool | `true` | Tactical overlays. Boot: created only if exactly `true`; lazy on change. |
| `features.roadNetwork` | bool | `true` | Optional road-network service. Boot: created only if exactly `true`. Degrades to estimates when the service is unreachable. |
| `features.autoShapes` | bool | `true` | Auto Shapes symbols. Read live (`!== false`). |
| `features.briefing` | bool | `true` | Briefing / present engine. Boot: loaded only if exactly `true`; lazy on change. |
| `features.exportTools` | bool | `true` | PPTX exporter. Read live at call time; must be exactly `true`. |
| `features.screenAnchor` | bool | `false` | "Pin to Screen". Boot: loaded only if exactly `true`; lazy on change. |
| `features.collab` | bool | `false` | Collaboration engine. Boot: loaded only if exactly `true`; lazy on change. |

### logging

| Path | Type | Default | Meaning |
| --- | --- | --- | --- |
| `logging.enabled` | bool | `true` | Emit `engine-log` events for the Engine Log panel. Boot: `!== false`; pushed to `EngineLogger.setEnabled`. |

### ui

| Path | Type | Default | Meaning |
| --- | --- | --- | --- |
| `ui.theme` | enum | `"ops-dark"` | Widget/panel theme: `ops-dark`, `night-vision`, `sandstorm`, `arctic`, `sipr`. Does not affect map symbols. Boot: `ThemeManager.init`; pushed to `setTheme`. |

### measurement

Pushed as a whole block to `MeasurementEngine.setOptions` (mapping in [09](09-measurement-cues-mgrs.md)).

| Path | Type | Default | Meaning |
| --- | --- | --- | --- |
| `measurement.distUnit` | enum | `"kilometers"` | `feet`, `miles`, `kilometers`, `nautical-miles`, `meters`, `yards`. |
| `measurement.areaUnit` | enum | `"square-kilometers"` | `square-miles`, `acres`, `square-kilometers`, `hectares`, `square-meters`, `square-feet`, `square-yards`. |
| `measurement.fontSize` | number | `12` | Label font size, widget range 8..24. |
| `measurement.fontColor` | rgb | `[0,80,200]` | Label color. |
| `measurement.fontOpacity` | number | `1` | Label opacity 0..1. |
| `measurement.lineColor` | rgb | `[0,255,0]` | Overlay line color. |
| `measurement.lineWidth` | number | `2` | Overlay line width (px), range 0.5..10. |
| `measurement.lineOpacity` | number | `0.5` | Overlay line opacity. |
| `measurement.showBng` | bool | `true` | Show bearing with segment length. |
| `measurement.showHeight` | bool | `true` | Show bounding-box height label. |
| `measurement.showWidth` | bool | `true` | Show bounding-box width label. |
| `measurement.showArea` | bool | `true` | Show area label. |
| `measurement.showTotal` | bool | `true` | Show cumulative length label. |
| `measurement.showSegment` | bool | `true` | Show per-segment label. |
| `measurement.showExtent` | bool | `true` | Draw the extent rectangle. |
| `measurement.showLine` | bool | `true` | Draw the measurement line. |
| `measurement.showLastSegOnly` | bool | `false` | Keep only the latest segment label (forces `showSegment` on). |
| `measurement.slantRange` | bool | `false` | Include elevation difference (3D slant range). |
| `measurement.magneticDeclination` | number | `0` | Degrees, positive east; range -180..180. Non-zero switches bearing labels to magnetic (`M`). |
| `measurement.speedKmh` | number | `5.0` | March speed for ETA; 0 disables ETA text. (`MeasurementEngine`'s own field default is 0; the JSON value is pushed at load.) |
| `measurement.bearingFormat` | enum | `"decimal"` | `decimal`, `mils`, `quadrant`. |
| `measurement.autoUnit` | bool | `false` | Choose a readable unit per value. |
| `measurement.preserveOnComplete` | bool | `false` | Keep labels on the map after drawing completes. |
| `measurement.roadEta` | bool | `false` | Add road-following distance/ETA from the road-network service. |

### drawingCues

Pushed as a whole block to `DrawingCueEngine.setOptions`. `drawingCues.enabled` is applied as `enable()`/`disable()`. See [09](09-measurement-cues-mgrs.md).

| Path | Type | Default | Meaning |
| --- | --- | --- | --- |
| `drawingCues.enabled` | bool | `true` | Cue engine on/off (inside the block; independent of `features.drawingCues`). |
| `drawingCues.closeCue` | bool | `true` | Ring marker on the first vertex when a polygon can be closed (armed at 3+ committed vertices, 16 px hotspot). |
| `drawingCues.rubberBand.enabled` | bool | `true` | Dashed line from last vertex to cursor. |
| `drawingCues.rubberBand.lineColor` | rgb | `[255,200,0]` | Line color. |
| `drawingCues.rubberBand.lineOpacity` | number | `0.75` | Opacity 0..1. |
| `drawingCues.rubberBand.lineWidth` | number | `1.5` | Line width (px). |
| `drawingCues.rubberBand.showLabel` | bool | `true` | Length/bearing label. |
| `drawingCues.rubberBand.fontSize` | number | `11` | Label size. |
| `drawingCues.rubberBand.fontColor` | rgb | `[255,230,50]` | Label color. |
| `drawingCues.coordinateDisplay.enabled` | bool | `true` | Cursor lat/lon readout. |
| `drawingCues.coordinateDisplay.fontSize` | number | `11` | Readout size. |
| `drawingCues.coordinateDisplay.fontColor` | rgb | `[220,220,220]` | Readout color. |
| `drawingCues.angularGuides.enabled` | bool | `true` | Angle snap guides from the last vertex. |
| `drawingCues.angularGuides.snapThresholdDeg` | number | `8` | Snap tolerance in degrees (widget 2..30). |
| `drawingCues.angularGuides.snapIntervalDeg` | number | `45` | Guide spacing in degrees (widget 5..90). |
| `drawingCues.angularGuides.lineColor` | rgb | `[80,200,255]` | Guide color. |
| `drawingCues.angularGuides.lineOpacity` | number | `0.75` | Guide opacity. |
| `drawingCues.angularGuides.lineWidth` | number | `1.5` | Guide width. |
| `drawingCues.angularGuides.showLabel` | bool | `true` | Angle label on guides. |
| `drawingCues.angularGuides.fontSize` | number | `11` | Angle label size. |
| `drawingCues.angularGuides.showArc` | bool | `true` | Protractor arc plus live bearing needle. |
| `drawingCues.angularGuides.arcRadiusKm` | number | `0.5` | Protractor radius (km, widget 0.1..20). |
| `drawingCues.angularGuides.showFan` | bool | `true` | Fan-shaped snap zone. |
| `drawingCues.angularGuides.showSnapPoint` | bool | `true` | Marker at the snap point. |
| `drawingCues.angularGuides.showAnchor` | bool | `true` | Cross marker at the anchor vertex. |
| `drawingCues.angularGuides.relativeSegment` | bool | `false` | Extra guide aligned with the previous segment. |
| `drawingCues.distanceRings.enabled` | bool | `true` | Concentric rings around the last vertex (or cursor for point symbols). |
| `drawingCues.distanceRings.intervalKm` | number | `1.0` | Ring spacing (km). |
| `drawingCues.distanceRings.ringCount` | number | `5` | Number of rings (widget 1..10). |
| `drawingCues.distanceRings.lineColor` | rgb | `[80,230,120]` | Ring color. |
| `drawingCues.distanceRings.lineOpacity` | number | `0.7` | Ring opacity. |
| `drawingCues.distanceRings.lineWidth` | number | `1.5` | Ring width. |
| `drawingCues.distanceRings.showLabels` | bool | `true` | Distance labels on rings. |
| `drawingCues.distanceRings.fontSize` | number | `11` | Label size. |
| `drawingCues.distanceRings.fontColor` | rgb | `[255,255,255]` | Label color. |
| `drawingCues.nearbyHighlight.enabled` | bool | `true` | Highlight existing symbols near the cursor. |
| `drawingCues.nearbyHighlight.radiusKm` | number | `5.0` | Distance within which symbols are highlighted (km). |
| `drawingCues.nearbyHighlight.ringRadiusKm` | number | `0.5` | Radius of each highlight ring (km). |
| `drawingCues.nearbyHighlight.nearColor` | rgb | `[255,80,80]` | Color for the nearest band. |
| `drawingCues.nearbyHighlight.midColor` | rgb | `[255,200,80]` | Middle band color. |
| `drawingCues.nearbyHighlight.farColor` | rgb | `[80,200,80]` | Far band color. |
| `drawingCues.nearbyHighlight.outlineWidth` | number | `2.5` | Ring outline width. |
| `drawingCues.nearbyHighlight.outlineOpacity` | number | `0.85` | Ring outline opacity. |
| `drawingCues.adaptive.enabled` | bool | `false` | Auto-size ring spacing from the visible extent. |
| `drawingCues.adaptive.coverageFraction` | number | `0.25` | Target fraction of the smaller view dimension covered by the outermost ring. |
| `drawingCues.adaptive.maxOuterKm` | number | `200` | Cap on the outermost ring radius (km). |
| `drawingCues.magneticCompass.enabled` | bool | `false` | Interactive compass overlay. |
| `drawingCues.magneticCompass.size` | number | `210` | Compass size (px). |
| `drawingCues.magneticCompass.opacity` | number | `1.0` | Compass opacity. |
| `drawingCues.magneticCompass.northColor` | rgb | `[255,80,80]` | North-needle color. |
| `drawingCues.magneticCompass.bezelColor` | rgb | `[212,160,60]` | Bezel color. |
| `drawingCues.magneticCompass.declination` | number | `1.5` | Declination offset in degrees, positive east. |

### mgrs

Pushed as a whole block to `MGRSEngine.setOptions`. See [09](09-measurement-cues-mgrs.md).

| Path | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mgrs.showGZD` | bool | `true` | Grid Zone Designator lines and labels. |
| `mgrs.show100K` | bool | `true` | 100 km squares. |
| `mgrs.show10K` | bool | `false` | 10 km squares. |
| `mgrs.show1K` | bool | `false` | 1 km squares. |
| `mgrs.autoZoom` | bool | `true` | Gate each sub-grid by zoom (100 km at zoom 6+, 10 km at 9+, 1 km at 12+). |
| `mgrs.gzdColor` | rgb | `[255,200,50]` | GZD line color. |
| `mgrs.gzdOpacity` | number | `0.85` | GZD opacity. |
| `mgrs.gzdWidth` | number | `1.5` | GZD width. |
| `mgrs.hundredKColor` | rgb | `[255,200,50]` | 100 km line color. |
| `mgrs.hundredKOpacity` | number | `0.55` | 100 km opacity. |
| `mgrs.hundredKWidth` | number | `0.8` | 100 km width. |
| `mgrs.tenKColor` | rgb | `[255,200,50]` | 10 km line color. |
| `mgrs.tenKOpacity` | number | `0.35` | 10 km opacity. |
| `mgrs.tenKWidth` | number | `0.5` | 10 km width. |
| `mgrs.oneKColor` | rgb | `[255,200,50]` | 1 km line color. |
| `mgrs.oneKOpacity` | number | `0.25` | 1 km opacity. |
| `mgrs.oneKWidth` | number | `0.35` | 1 km width. |
| `mgrs.showLabels` | bool | `true` | Grid labels. |
| `mgrs.labelSize` | number | `11` | Label font size. |
| `mgrs.labelColor` | rgb | `[255,255,255]` | Label color. |
| `mgrs.labelOpacity` | number | `0.9` | Label opacity. |

### proximity

Pushed per leaf key to `ProximityEngine.updateConfig`. See [09](09-measurement-cues-mgrs.md).

| Path | Type | Default | Meaning |
| --- | --- | --- | --- |
| `proximity.nearestVertex` | bool | `true` | Snap to the nearest vertex. |
| `proximity.nearestCoordinate` | bool | `true` | Snap to the nearest point on any geometry (takes precedence over vertex-only for lines/areas). |
| `proximity.showDistance` | bool | `true` | Distance label. |
| `proximity.distanceUnit` | enum | `"miles"` | `feet`, `miles`, `kilometers`, `nautical-miles`, `meters`, `yards`. |
| `proximity.snapRadiusPx` | number | `0` | Screen-pixel radius; 0 means unlimited (within the pre-filter). Widget 0..200. |
| `proximity.lineColor` | rgb | `[0,120,255]` | Connector line color. |
| `proximity.lineOpacity` | number | `0.7` | Connector opacity. |
| `proximity.lineWidth` | number | `1.5` | Connector width. |
| `proximity.markerColor` | rgb | `[0,120,255]` | Snap marker outline color. |
| `proximity.markerSize` | number | `10` | Marker diameter (px). |
| `proximity.fontSize` | number | `11` | Label size. |
| `proximity.fontColor` | rgb | `[0,80,200]` | Label color. |

### declutter

Read live by the declutter engines. Full behavior and tuning in [10](10-declutter-visualization.md).

| Path | Type | Default | Meaning |
| --- | --- | --- | --- |
| `declutter.enabled` | bool | `false` | Master switch. Nothing else runs when false. |
| `declutter.perfHud` | bool | `false` | Harness perf overlay (`declutter-solve-stats`); handled by `index.html`, not by the library. |
| `declutter.annotations.mode` | enum | `"zoom"` | `off`, `zoom`, `minscale`, `density`: how the annotation layer is thinned. |
| `declutter.annotations.zoomThreshold` | number | `8` | Zoom below which labels hide (`zoom`) or `minScale` derived from it (`minscale`). |
| `declutter.annotations.densityMinPx` | number | `30` | Cell size (px) for `density` mode; one label per cell. |
| `declutter.annotations.fadeMs` | number | `400` | Label layer fade duration in `zoom` mode. |
| `declutter.symbols.hideBelow` | bool | `false` | Hide symbol layers below `symbols.zoomThreshold`. |
| `declutter.symbols.zoomThreshold` | number | `5` | Zoom threshold for `hideBelow`. |
| `declutter.symbols.echelonBased` | bool | `false` | Show only echelons listed in `ZoomLvlEchelon` for the current zoom. |
| `declutter.symbols.fadeMs` | number | `300` | Fade duration for symbol visibility changes. |
| `declutter.cluster.enabled` | bool | `false` | Aggregate nearby symbols into badges. |
| `declutter.cluster.minClusterSize` | number | `2` | Minimum members per cluster (code fallback 3). |
| `declutter.cluster.radiusPx` | number | `80` | Neighbour search radius (px) (code fallback 40). |
| `declutter.cluster.maxZoom` | number | `14` | No clustering above this zoom. |
| `declutter.cluster.fadeMs` | number | `250` | Cluster layer fade. |
| `declutter.cluster.respectIdentity` | bool | `true` | Cluster friendly/hostile/neutral/unknown separately. |
| `declutter.cluster.promoteMode` | enum | `"badge"` | `badge` (circle + count) or `seed` (keep the highest-priority member, add an x-N tag; falls back to a badge when members differ in echelon). |
| `declutter.labels.enabled` | bool | `false` | Label placement with leader lines. |
| `declutter.labels.offsetPx` | number | `16` | Distance from symbol to preferred label position. |
| `declutter.labels.leaderThresholdPx` | number | `20` | Draw a leader only if the label is displaced farther than this. |
| `declutter.labels.leaderColor` | rgb | `[128,128,128]` | Leader color. |
| `declutter.labels.leaderWidth` | number | `0.75` | Leader width. |
| `declutter.labels.leaderOpacity` | number | `0.7` | Leader opacity. |
| `declutter.labels.maxToPlace` | number | `500` | Per-solve cap; lowest-priority overflow labels are hidden. |
| `declutter.labels.abbreviateOnOverflow` | bool | `true` | Retry with truncated text when no position fits. |
| `declutter.labels.abbreviateMaxChars` | number | `8` | Characters kept before the ellipsis. |
| `declutter.labels.hideOnOverflow` | bool | `false` | Hide a label that cannot be placed instead of overlapping. |
| `declutter.disperse.enabled` | bool | `false` | Radial fan-out of stacked symbols. |
| `declutter.disperse.minZoom` | number | `11` | Active at or above this zoom. |
| `declutter.disperse.maxZoom` | number | `18` | Symbols return to true positions above this zoom. |
| `declutter.disperse.thresholdPx` | number | `12` | Screen distance under which symbols count as a stack. |
| `declutter.disperse.radiusPx` | number | `18` | Fan radius. |
| `declutter.disperse.maxGroupSize` | number | `12` | Members beyond this stay at their true position. |
| `declutter.ladder.enabled` | bool | `false` | Vertical "halyard" stacking. |
| `declutter.ladder.minZoom` | number | `11` | Active at or above this zoom. |
| `declutter.ladder.maxZoom` | number | `20` | Symbols return to true positions above this zoom (code fallback 17). |
| `declutter.ladder.thresholdPx` | number | `50` | Gathering radius (px). |
| `declutter.ladder.minRungs` | number | `2` | Smaller stacks are left alone. |
| `declutter.ladder.maxRungs` | number | `15` | Larger stacks are released to true positions. |
| `declutter.ladder.layout` | enum | `"side"` | `side` or `center`. |
| `declutter.ladder.sideOffsetPx` | number | `24` | Spine-to-rung distance in `side` layout. |
| `declutter.ladder.rungSpacingPx` | number | `22` | Vertical spacing between rungs. |
| `declutter.ladder.spineColor` | rgb | `[180,180,180]` | Spine and tie-line color. |
| `declutter.ladder.spineWidth` | number | `2` | Spine width (code fallback 1). |
| `declutter.ladder.spineOpacity` | number | `0.8` | Spine opacity (tie-lines use 60 percent of it). |
| `declutter.ladder.respectIdentity` | bool | `true` | Separate ladders per identity group. |
| `declutter.ladder.showTieLines` | bool | `true` | Perpendicular tie-lines in `side` layout. |
| `declutter.ladder.altitudeMode` | bool | `true` | In 3D, stack rungs in altitude with a ground stem; in 2D falls back to screen-space layout. |
| `declutter.ladder.altitudeSpacingM` | number | `250` | Meters between rungs in altitude mode. |
| `declutter.ladder.stemBaseAltitudeM` | number | `0` | Height above ground where the stem starts. |

### visualization

Pushed as a whole block to `VisualizationEngine.setOptions`. See [10](10-declutter-visualization.md).

| Path | Type | Default | Meaning |
| --- | --- | --- | --- |
| `visualization.render.highQuality3D` | bool | `false` | SceneView `qualityProfile = 'high'`. |
| `visualization.render.disableSceneShadows` | bool | `false` | Turn off direct shadows and ambient occlusion. |
| `visualization.render.highAtmosphereQuality` | bool | `false` | High-quality atmosphere. |
| `visualization.render.liftForcePoints` | bool | `false` | Lift force point symbols above terrain. |
| `visualization.render.liftTacticalPoints` | bool | `false` | Lift tactical point symbols. |
| `visualization.render.liftLinesAreas` | bool | `false` | Lift tactical line/area graphics. |
| `visualization.render.symbolElevationOffset` | number | `400` | Meters used by the lift toggles (engine default 100). |
| `visualization.render.forcePointDropLines` | bool | `true` | Vertical line from lifted force points to ground (3D). |
| `visualization.render.dropLineColor` | rgb | `[255,0,0]` | Drop-line color. |
| `visualization.render.dropLineWidth` | number | `2` | Drop-line width. |
| `visualization.render.dropLineOpacity` | number | `0.85` | Drop-line opacity. |
| `visualization.layerEffects.enabled` | bool | `false` | Apply ArcGIS layer effects (2D MapView only). |
| `visualization.layerEffects.forceEffect` | string | `"bloom(1, 0.5px, 0.1)"` | Effect string for the FORCE layer. |
| `visualization.layerEffects.tactPtEffect` | string | `"bloom(0.8, 0.5px, 0.05)"` | Effect for the TACT_PT layer. |
| `visualization.layerEffects.tactEffect` | string | `"drop-shadow(0px, 0px, 6px, #0050ff, 0.7)"` | Effect for the TACT layer. |
| `visualization.coverageRings.enabled` | bool | `false` | Geodesic rings around friendly/enemy point symbols. |
| `visualization.coverageRings.radiusKm` | number | `5` | Ring radius (km). |
| `visualization.coverageRings.showOverlap` | bool | `true` | Highlight friendly/enemy ring overlap. |
| `visualization.coverageRings.friendlyColor` | rgb | `[0,100,200]` | Friendly ring color. |
| `visualization.coverageRings.enemyColor` | rgb | `[220,50,50]` | Enemy ring color. |
| `visualization.coverageRings.overlapColor` | rgb | `[255,150,0]` | Overlap color. |
| `visualization.coverageRings.fillOpacity` | number | `0.12` | Ring fill opacity. |
| `visualization.coverageRings.outlineWidth` | number | `1.5` | Ring outline width. |
| `visualization.forceRatioGrid.enabled` | bool | `false` | Friendly-to-enemy ratio grid. |
| `visualization.forceRatioGrid.cellSizeKm` | number | `20` | Cell side (km); grid is capped at 20 x 20 cells. |
| `visualization.forceRatioGrid.favorableColor` | rgb | `[0,80,200]` | Friendly dominant (ratio 1.5:1 or better). |
| `visualization.forceRatioGrid.parityColor` | rgb | `[150,150,150]` | Roughly equal. |
| `visualization.forceRatioGrid.unfavorableColor` | rgb | `[200,50,50]` | Enemy dominant. |
| `visualization.forceRatioGrid.fillOpacity` | number | `0.25` | Cell fill opacity. |
| `visualization.convexHull.enabled` | bool | `false` | Convex hull footprints per identity. |
| `visualization.convexHull.friendlyFillColor` | rgb | `[0,80,200]` | Friendly hull fill. |
| `visualization.convexHull.enemyFillColor` | rgb | `[200,50,50]` | Enemy hull fill. |
| `visualization.convexHull.fillOpacity` | number | `0.1` | Hull fill opacity. |
| `visualization.convexHull.outlineWidth` | number | `2` | Hull outline width. |
| `visualization.extrudedFootprints.enabled` | bool | `false` | Extrude tactical polygons/lines into 3D blocks/walls (3D only). |
| `visualization.extrudedFootprints.extrudePolygons` | bool | `true` | Extrude areas. |
| `visualization.extrudedFootprints.polygonHeightM` | number | `100` | Block height (m). |
| `visualization.extrudedFootprints.polygonShowEdges` | bool | `true` | Solid edges. |
| `visualization.extrudedFootprints.extrudeLines` | bool | `true` | Extrude lines into walls. |
| `visualization.extrudedFootprints.lineWallHeightM` | number | `100` | Wall height (m). |
| `visualization.extrudedFootprints.lineWallThicknessM` | number | `6` | Wall thickness (m). |
| `visualization.extrudedFootprints.fillOpacity` | number | `0.22` | Face opacity. |
| `visualization.extrudedFootprints.colorMode` | enum | `"identity"` | `identity`, `inherit`, `single`. |
| `visualization.extrudedFootprints.singleColor` | rgb | `[80,120,200]` | Used when `colorMode` is `single`. |
| `visualization.extrudedFootprints.edgeColor` | rgb | `[40,40,40]` | Edge color. |

`VisualizationOptions` also accepts `visualization.aggregate.*` and `visualization.convexHull.neutralFillColor`, which have engine defaults but are not present in `Settings.json`.

### analysis

Each key is a boolean, default `true`. Applied through `AnalysisEngineRegistry.setEnabled` while `features.analysisEngines` is not false. Details in [11](11-analysis-engines.md).

| Path | Engine |
| --- | --- |
| `analysis.los` | Line of Sight |
| `analysis.wez` | Weapon Engagement Zone |
| `analysis.trajectory` | Projectile Trajectory |
| `analysis.buffer` | Buffer & Threat Rings |
| `analysis.corridor` | Corridor Analysis |
| `analysis.flight` | UAV Flight Analysis |
| `analysis.effects` | Weapon Effects |
| `analysis.deadGround` | Dead Ground Mapper |
| `analysis.keyTerrain` | Key Terrain Identifier |
| `analysis.positionDefensibility` | Position Defensibility Scorer |
| `analysis.opRanker` | Observation Post Ranker |
| `analysis.localPeaks` | Peak Analysis |
| `analysis.missionPlanner` | Mission Planner Dashboard |
| `analysis.ocoka` | OCOKA (avenues of approach) |
| `analysis.landingZone` | Landing Zone Planner |
| `analysis.airspace` | Airspace (ROZ / ACA) |

### roadNetwork

Read at construction of `RoadNetworkEngine` (only if `features.roadNetwork` is true) and re-pushed by `roadNetwork.*` changes. No widget edits these keys.

| Path | Type | Default | Meaning |
| --- | --- | --- | --- |
| `roadNetwork.serverUrl` | string | `"https://192.168.0.15:6443"` | No reader found in `MS/` or `src/`. Informational; the engine uses `naServerUrl` and `roadsLayerUrl`. |
| `roadNetwork.naServerUrl` | string | `"/roadnet/arcgis/rest/services/RoadNetwork/NAServer"` | Network Analyst service base URL without a layer name. A same-origin path assumes a reverse proxy (the Vite `/roadnet` proxy in the harness). |
| `roadNetwork.routeLayer` | string | `"Route"` | Route layer name on the NAServer. |
| `roadNetwork.serviceAreaLayer` | string | `""` | Service Area layer; empty means auto-detect. |
| `roadNetwork.roadsLayerUrl` | string | `"/roadnet/arcgis/rest/services/RoadNetwork/MapServer"` | Source roads service for display and class enrichment. |
| `roadNetwork.roadsSublayerId` | number | `11` | Sublayer id of routable roads. |
| `roadNetwork.impedanceAttribute` | string | `"Cost"` | Cost attribute to minimise. |
| `roadNetwork.impedanceUnits` | enum | `"hours"` | `hours`, `minutes`, `seconds`, `kilometers`, `meters`. |
| `roadNetwork.distanceAttribute` | string | `"Kilometers"` | Distance attribute accumulated alongside impedance. |
| `roadNetwork.classFieldName` | string | `"CLAZZ"` | Integer road-class field on the roads layer. |
| `roadNetwork.classifyRoutes` | bool | `true` | Run road-class enrichment after each solve. |
| `roadNetwork.classifySamples` | number | `120` | Maximum samples along a route for enrichment. |
| `roadNetwork.classifyToleranceM` | number | `25` | Search radius (m) from a sample to a road edge. |
| `roadNetwork.timeoutMs` | number | `30000` | Per-request timeout. |
| `roadNetwork.availabilityTtlMs` | number | `30000` | How long a health probe result is trusted. |
| `roadNetwork.showRoadsLayer` | bool | `false` | Show the roads reference layer (pushed as show/hide). |

### stylus

Read live by the stylus controller. Enum values from `StylusSettingsManifest`. Detailed behavior: [12](12-briefing-collab-stylus.md).

| Path | Type | Default | Meaning |
| --- | --- | --- | --- |
| `stylus.mode` | enum | `"auto"` | `auto` (engage for pen/touch), `on` (all inputs), `off` (classic click drawing). |
| `stylus.paradigm` | enum | `"freehand"` | Global default: `native`, `freehand`, `tap`, `scrub`. |
| `stylus.perSymbol` | object | `{}` | Per-symbol paradigm overrides: a map from symbol `Class` name to a paradigm value (`native`, `freehand`, `tap`, `scrub`). Takes precedence over `stylus.paradigm`. |
| `stylus.freehand.simplifyTolerancePx` | number | `4` | Douglas-Peucker tolerance (px). |
| `stylus.tap.tapTolerancePx` | number | `6` | Maximum drift for a press-release to count as a tap. |
| `stylus.tap.showFinishToolbar` | bool | `true` | Floating Finish/Undo/Cancel toolbar in tap mode. |
| `stylus.scrub.detail` | enum | `"balanced"` | `smooth`, `balanced`, `fine`, `custom`. |
| `stylus.scrub.tolerancePx` | number | `6` | Used when `detail` is `custom`. |
| `stylus.native.tapFallbackMs` | number | `400` | Synthetic vertex commit if no click follows a stationary tap. |
| `stylus.premium.enabled` | bool | `true` | Premium stylus features (native paradigm only). |
| `stylus.premium.cursor.enabled` | bool | `true` | Glide cursor. |
| `stylus.premium.cursor.size` | number | `22` | Cursor size. |
| `stylus.premium.cursor.color` | rgb | `[0,200,255]` | Cursor color. |
| `stylus.premium.cursor.snapColor` | rgb | `[120,255,140]` | Cursor color when snapped. |
| `stylus.premium.smoothing.enabled` | bool | `true` | 1-euro input filter. |
| `stylus.premium.smoothing.minCutoff` | number | `1.0` | Filter minimum cutoff. |
| `stylus.premium.smoothing.beta` | number | `0.02` | Filter speed coefficient. |
| `stylus.premium.smoothing.dCutoff` | number | `1.0` | Filter derivative cutoff. |
| `stylus.premium.snap.enabled` | bool | `true` | Snap cursor to Proximity targets (needs the Proximity engine). |
| `stylus.premium.snap.pullPx` | number | `24` | Snap pull distance. |
| `stylus.premium.palmReject` | bool | `true` | Ignore palm-sized contacts and touches while a pen is active. |
| `stylus.premium.palmWindowMs` | number | `1200` | Palm rejection window. |
| `stylus.premium.palmSizePx` | number | `45` | Contact size treated as a palm. |
| `stylus.premium.finish.dwellMs` | number | `0` | Hold-still-to-finish time; 0 is off. |
| `stylus.premium.precision.enabled` | bool | `false` | Committed vertices land on the resolved target (snap, angle lock, length lock). |
| `stylus.premium.precision.snapCommit` | bool | `true` | Snap committed vertex to nearest existing vertex/coordinate. |
| `stylus.premium.precision.angleLock.enabled` | bool | `false` | Lock segments to guide angles. |
| `stylus.premium.precision.angleLock.intervalDeg` | number | `45` | Angle interval. |
| `stylus.premium.precision.angleLock.thresholdDeg` | number | `8` | Lock tolerance. |
| `stylus.premium.precision.lengthLock.enabled` | bool | `false` | Snap segment lengths to an interval. |
| `stylus.premium.precision.lengthLock.intervalKm` | number | `1` | Length interval (km). |
| `stylus.premium.freehandStroke` | bool | `false` | Drag-to-draw for the freehand symbols. |
| `stylus.premium.ink.pressure` | bool | `false` | Scale the cursor with pen pressure (visual only). |

### briefing

Read by `BriefingEngine`. Details in [12](12-briefing-collab-stylus.md).

| Path | Type | Default | Meaning |
| --- | --- | --- | --- |
| `briefing.defaultTransitionMs` | number | `1000` | Default camera transition when entering a slide; stored per slide at capture. |
| `briefing.defaultEffect` | enum | `"appear"` | `appear`, `fade`, `flyIn`, `drawOn`: effect for new build steps. |
| `briefing.autoplayIntervalMs` | number | `5000` | Delay between slides in autoplay. |
| `briefing.autoplayLoop` | bool | `false` | Restart after the last slide. |
| `briefing.fullscreen` | bool | `true` | Enter browser fullscreen when the slideshow starts. |
| `briefing.presenterPanel` | bool | `false` | Show the presenter view on start. |
| `briefing.controlsIdleMs` | number | `2500` | Idle time before present-mode controls fade. |
| `briefing.penColor` | string | `"#ff2d2d"` | Present-mode pen color (hex string). |
| `briefing.penWidth` | number | `0.0024` | Pen width as a fraction of view height. |
| `briefing.spotlightRadius` | number | `0.12` | Spotlight radius as a fraction of the view's smaller side. |

### exportTools

Read by the PPTX exporter when exporting. Requires `features.exportTools` true.

| Path | Type | Default | Meaning |
| --- | --- | --- | --- |
| `exportTools.mode` | enum | `"flat"` | `flat` (map screenshots) or `editable` (native PowerPoint shapes over a raster). |
| `exportTools.format` | enum | `"png"` | Screenshot format: `png` or `jpeg`. |
| `exportTools.explodeBuilds` | bool | `false` | One extra slide per staged-reveal step. |
| `exportTools.includeNotes` | bool | `true` | Slide notes as speaker notes. |
| `exportTools.layout` | enum | `"16x9"` | `16x9`, `16x10`, `4x3`, `wide`, `custom`. |
| `exportTools.deckWidth` | number | `1280` | Custom width in px at 96 DPI (layout `custom`). |
| `exportTools.deckHeight` | number | `720` | Custom height in px at 96 DPI. |
| `exportTools.compress` | bool | `false` | Deflate the .pptx. |
| `exportTools.slideNumbers` | bool | `false` | Stamp slide numbers. |
| `exportTools.useMaster` | bool | `false` | Draw header/footer strips, classification banners and title placeholder. |
| `exportTools.classification` | string | `""` | Banner text (blank: no banners); needs `useMaster`. |
| `exportTools.footerText` | string | `""` | Footer text; supports tokens such as `{DTG}`, `{DATE}`, `{TITLE}`, `{SLIDE}`, `{SECTION}`, `{PAGE}`, `{PAGES}`, `{COMPANY}`, `{AUTHOR}`, `{SUBJECT}`. |
| `exportTools.headerText` | string | `""` | Header text; same tokens. |
| `exportTools.numberFormat` | enum | `"n"` | `n` (7) or `n-of-m` (7 / 24). |
| `exportTools.skipFirst` | bool | `false` | Leave slide 1 without furniture. |
| `exportTools.headFont` | string | `""` | Deck heading font; blank keeps the PptxGenJS default. |
| `exportTools.bodyFont` | string | `""` | Deck body font. |
| `exportTools.useSchemeColors` | bool | `false` | Emit exporter chrome as PowerPoint theme colors. |
| `exportTools.rtl` | bool | `false` | Mark the deck right-to-left. |
| `exportTools.deckTitle` | string | `"PAMS8 Briefing"` | Document title property. |
| `exportTools.author` | string | `""` | Document author. |
| `exportTools.company` | string | `""` | Document company. |
| `exportTools.subject` | string | `""` | Document subject. |
| `exportTools.revision` | string | `""` | Document revision. |

### collab

Read by `CollabEngine` (through `SettingsBus`). Requires `features.collab`. Details in [12](12-briefing-collab-stylus.md).

| Path | Type | Default | Meaning |
| --- | --- | --- | --- |
| `collab.transport` | enum | `"sse"` | `sse` (LAN relay) or `broadcast` (BroadcastChannel, same PC only). |
| `collab.relayUrl` | string | `""` | Absolute relay URL; blank uses the serving origin. |
| `collab.room` | string | `"default"` | Room name; same name means same session. |
| `collab.userName` | string | `""` | Display name; blank auto-names. |
| `collab.showRoster` | bool | `true` | Online-users chip. |
| `collab.syncMap` | bool | `true` | Share symbol create/move/edit/delete. |
| `collab.syncSlides` | bool | `true` | Share slides (needs the Briefing engine). |
| `collab.syncView` | bool | `false` | Follow-the-leader map view. |
| `collab.sharePresentation` | bool | `true` | Shared podium for the deck. |
| `collab.shareInk` | bool | `true` | Share laser/pen/spotlight of the presenter. |
| `collab.slideImageMaxKb` | number | `256` | Slide thumbnails above this size are not sent; 0 never sends. |
| `collab.showCursors` | bool | `true` | Peer cursors. |
| `collab.showTrails` | bool | `true` | Cursor trails. |
| `collab.trailLength` | number | `8` | Positions kept per trail. |
| `collab.showPreviews` | bool | `true` | Peers' in-progress shapes. |
| `collab.showPings` | bool | `true` | "Look here" markers. |
| `collab.shareViewport` | bool | `true` | Broadcast own viewport extent about once per second. |
| `collab.showViewports` | bool | `false` | Outline peers' viewports. |
| `collab.chat` | bool | `true` | Room text channel. |
| `collab.activityLog` | bool | `true` | Log peer edits to the Engine Log. |
| `collab.cursorHz` | number | `20` | Cursor broadcast rate. |
| `collab.locks` | bool | `true` | Selection claims an object; others cannot edit it. |
| `collab.showLocks` | bool | `true` | Padlock marker on locked objects. |
| `collab.lockTtlMs` | number | `10000` | Lock auto-release after inactivity. |
| `collab.token` | string | `""` | Shared secret; must match the relay's `COLLAB_TOKEN` when set. |
| `collab.debug` | bool | `false` | Verbose sync-chain logging to the console. |

---

## Verification notes

- Keys marked "no reader found" were searched for in `MS/` and `src/`; a reader outside those trees (a host application) is possible.
- Manifest ranges (`min`/`max`) are UI constraints only; the engines do not clamp values pushed through `onSettingChanged`.
