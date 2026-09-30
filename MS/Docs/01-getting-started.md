# 01 - Getting Started

This document describes what the PAMS8 build ships, what a host application must provide, and how to create, switch and destroy a `SymbolEngine`.

Related documents: [README](README.md) | [02 SymbolEngine API](02-symbol-engine-api.md) | [03 Drawing and events](03-drawing-and-events.md) | [04 Support classes](04-support-classes.md) | [08 Settings](08-settings.md) | [14 FAQ](14-faq-troubleshooting.md)

| Section | Topic |
| --- | --- |
| 1 | What ships in `dist/MS` |
| 2 | Requirements |
| 3 | Static assets the host must serve |
| 4 | Required page elements and script tags |
| 5 | Minimal 2D example |
| 6 | Minimal 3D example |
| 7 | Switching between 2D and 3D |
| 8 | Teardown |
| 9 | What the harness demonstrates |

---

## 1. What ships in `dist/MS`

`npm run build` runs, in order (`package.json`):

```
vite build
npm run copy-data        # MS/Data        -> dist/MS/Data
npm run copy-thirdparty  # MS/ThirdParty  -> dist/MS/ThirdParty
npm run copy-styles      # MS/Styles      -> dist/MS/Styles
npm run docs:build       # docs:catalog (tools/genSymbolCatalog.mjs) + docs:api (typedoc) + copy-docs (MS/Docs -> dist/MS/Docs/markdown)
tsc -p tsconfig.build.json
```

`npm run dev:dist` runs the same copy steps plus `copy-docs`, then serves the harness against `dist/MS`.

The Vite library build (`vite.config.ts`) has these properties:

| Property | Value |
| --- | --- |
| Entry (`build.lib.entry`) | `MS/Engines/SymbolEngine.ts` |
| Additional rollup input | `MS/ThirdParty/MilSymbols/UEITypes.ts` |
| Format | ES modules only (`formats: ['es']`) |
| Layout | `preserveModules: true`, `preserveModulesRoot: 'MS'`, so `dist/MS` mirrors the `MS/` tree |
| File names | `[name].min.js`, for example `dist/MS/Engines/SymbolEngine.min.js` |
| Minifier | terser, top-level mangling only. Property mangling is intentionally disabled (see comment in `vite.config.ts`), so public property names are preserved |
| Console | `console.log/debug/info/trace` are stripped; `console.warn` and `console.error` are kept |
| External | `/^@arcgis\//` - `@arcgis/core` is never bundled |
| Declarations | `vite-plugin-dts` writes a `.d.ts` beside every module (`dist/MS/**/*.d.ts`) |

JSON data modules that are `import`ed by the code (`Symbols.json`, `Settings.json`, `TacticalPointSymbols.json`) are emitted as `*.json.min.js` next to the raw `.json` file.

Observed top-level layout of `dist/MS`:

| Path | Content |
| --- | --- |
| `Engines/`, `Symbols/`, `Support/`, `Managers/`, `Cache/`, `SIDC/`, `PlotPoint.d.ts` | Minified modules and declarations. Entry: `Engines/SymbolEngine.min.js` / `Engines/SymbolEngine.d.ts` |
| `Data/` | JSON metadata, copied by `copy-data` (and, for the imported files, also compiled to `*.json.min.js`) |
| `ThirdParty/` | Copied by `copy-thirdparty`: `MilSymbols/`, `Fabric/`, `TweenJS/`, `PptxGenJS/`, `MGRS/`, `Tacticals/` |
| `Styles/Widgets.css` | Copied by `copy-styles` |
| `assets/`, `fonts/` | ArcGIS runtime assets and fonts. Present in the observed output; they come from the repository `public/` folder, which Vite copies into the output directory. Not produced by the `copy-*` scripts |

The public entry point is the default export of `Engines/SymbolEngine`:

```ts
import SymbolEngine from './MS/Engines/SymbolEngine.min.js';
```

`SymbolEngine.d.ts` also re-exports the types `MorphixSymbolPatch`, `MorphixSymbolSnapshot`, `MorphixEditedState` and `GeoKind`.

---

## 2. Requirements

| Requirement | Detail |
| --- | --- |
| `@arcgis/core` | Exactly the version the library is built against: `5.0.19` (`package.json` dependency, pinned). Consumed as npm ES modules. It is external to the build, so the host must install and bundle it. Do not use the CDN/AMD build |
| Module system | ES modules. The host page must load the library through `import` (bundler or `<script type="module">`) |
| Node (build only) | `engines.node >= 24.14.1` in `package.json` |
| Browser | WebGL is required for the ArcGIS views. The harness shows an alert if a `webgl` error is raised on view load |
| TypeScript (optional) | The shipped `.d.ts` files require no extra configuration beyond resolving `@arcgis/core` types |

Both `SymbolEngine` and the host must resolve to the same `@arcgis/core` instance. Two copies of the SDK produce import errors and instanceof failures, so deduplicate in your bundler.

---

## 3. Static assets the host must serve

Everything not compiled into the `.min.js` modules is a plain file that the host must serve. Paths below are the ones the library or the harness actually references.

| Asset | Where it comes from | How it is used | Notes |
| --- | --- | --- | --- |
| ArcGIS runtime assets | `node_modules/@arcgis/core/assets` (harness script `copy-assets` copies to `public/assets`) | `esriConfig.assetsPath = '/assets'` in `src/main.ts` | Copy only if `public/assets` does not exist (see `copy-assets`). Set `esriConfig.assetsPath` and `esriConfig.fontsUrl` to where you serve them |
| ArcGIS theme CSS | `assets/esri/themes/light/main.css` | `<link>` in `index.html` | Host choice of light or dark theme |
| ArcGIS fonts | `public/fonts` | `esriConfig.fontsUrl = '/fonts'` in `src/main.ts` | Needed for text symbols rendered offline |
| `MS/ThirdParty/MilSymbols/milsymbol.js` | `copy-thirdparty` | `<script>` tag; exposes global `window.MS` | Required for UEI (force) symbols. A customized fork of milsymbol 0.5.6; do not replace with the stock build. `SymbolEngine` checks `typeof window.MS` and logs an error if it is missing |
| `MS/ThirdParty/Fabric/fabric.min.js` | `copy-thirdparty` | `<script>` tag; exposes `window.fabric` (fabric.js 4.5) | Used by the Briefing overlay code (`Engines/Briefing/OverlayFabric.ts`, `LaserTrail.ts`), which reads `window.fabric` and never imports it |
| `MS/ThirdParty/TweenJS/tween.js` | `copy-thirdparty` | `<script>` tag in the harness | No reference to `TWEEN` was found in the library TypeScript. The harness loads it; whether legacy code paths need it is not established. Loading it is harmless |
| `MS/ThirdParty/PptxGenJS/pptxgen.bundle.js` | `copy-thirdparty` | Injected automatically as a `<script>` on the first PowerPoint export. `PptxExporter.ts` uses the relative URL `MS/ThirdParty/PptxGenJS/pptxgen.bundle.js` | Must be reachable at that path relative to the page. Only needed if you use PPTX export |
| `MS/Styles/Widgets.css` | `copy-styles` | `<link rel="stylesheet" href="/MS/Styles/Widgets.css" />` in `index.html` | Design tokens and `ms-*` classes used by the engine panels (analysis widgets, Briefing, Collab roster). Load it if you use any built-in panel |
| `MS/Data/Deployments/` (including `Deployemets.json`) | `copy-data` | `DeploymentBuilderEngine` fetches `/MS/Data/Deployments/Deployemets.json` (absolute path; the file name is spelled that way in the repository) | Only needed for the Deployment Builder |
| `MS/Data/CIMFills/*.json` | bundled into `dist` by dynamic `import()` in `Symbols/CartoInformationModelSymbol.ts` | Loaded through the module system, not `fetch` | Whether the bundler emits these as separate chunks in your host build was not verified |

Path caveat: the harness serves everything from the site root (`/MS/...`, `/assets`). `DeploymentBuilderEngine` hard-codes the absolute prefix `/MS/Data/Deployments/`, and `PptxExporter` uses a page-relative path. If you mount the library under a different base path, keep both URLs resolvable.

Optional external services (not part of the build): the road network and trafficability engines call an external ArcGIS Server service and degrade to straight-line estimates when it is unreachable. See [11 Analysis engines](11-analysis-engines.md).

---

## 4. Required page elements and script tags

### Script tags (classic scripts, before the module that creates the engine)

```html
<link rel="stylesheet" href="/assets/esri/themes/light/main.css" />
<link rel="stylesheet" href="/MS/Styles/Widgets.css" />

<script src="MS/ThirdParty/Fabric/fabric.min.js"></script>
<script src="MS/ThirdParty/MilSymbols/milsymbol.js"></script>
<script src="MS/ThirdParty/TweenJS/tween.js"></script>

<script type="module" src="/your-app.js"></script>
```

Order matters only in that `window.MS` must exist before the first UEI symbol is created.

### DOM

| Element | Required by the library? | Detail |
| --- | --- | --- |
| A container element for the view (`<div id="viewDiv">` in the harness) | Yes | Any element. It is passed to the ArcGIS view as `container`. Draw events are scoped to this container (`SymbolEngine._isOwnViewEvent`), so with several engines on one page give each view its own container |
| `<canvas id="fabricCanvas">` | No | Appears only in `index.html` (and its CSS). No library module in `MS/` references the id `fabricCanvas`. The Briefing overlay code creates its own fabric canvases. It is a harness leftover; you do not need it |
| Harness panels (`#settingsPanel`, `#apiPanel`, `#infoDiv`, `#sidcText`, `#symbolSearch`, and so on) | No | These are harness UI. The library does not require them |

The library builds its own UI (context menu, command palette, selection action panel, engine panels) at runtime, so no other host markup was found to be required. Exact mount points differ per widget and were not audited.

---

## 5. Minimal 2D example

The pattern below is taken from `src/main.ts` (`new SymbolEngine(() => appConfig.activeView)`, `drawMilSymbolInteractively`, `addMilSymbolAtCenter`). `SymbolEngine` takes a function that returns the currently active view, not the view itself.

```ts
import esriConfig from '@arcgis/core/config';
import Map from '@arcgis/core/Map';
import MapView from '@arcgis/core/views/MapView';
import SymbolEngine from './MS/Engines/SymbolEngine.min.js';
import Amplifier from './MS/Support/Amplifier.min.js';
import DrawEssentials from './MS/Support/DrawEssentials.min.js';

esriConfig.assetsPath = '/assets';
esriConfig.fontsUrl = '/fonts';

const view = new MapView({
  container: 'viewDiv',
  map: new Map({ basemap: 'satellite' }),
  center: [69.3451, 30.3753],
  zoom: 7,
});

// The engine calls this getter whenever it needs the current view.
const engine = new SymbolEngine(() => view);
(window as any).symbolEngine = engine; // optional; SettingsBus and some widgets read window.symbolEngine

await view.when();

// Interactive placement of a Friend infantry unit (30-digit SIDC, see 04).
const amplifier = new Amplifier();
amplifier.SIDC = '130310001812110000000000000000';

engine.drawMilSymbolInteractively(new DrawEssentials(), amplifier, {
  sidc: amplifier.SIDC,
  size: 35,
});
```

Notes:

- The constructor creates the per-view graphics layers (`GraphicsLayerManager.initializeLayers`), the selection, edit, undo/redo and clipboard engines, the context menu, keyboard shortcuts (unless `features.shortcuts === false` in `Settings.json`), the Ctrl+K palette, and registers the document-level draw event listeners (`setupGlobalEventListener()`). No separate `init()` call is required.
- `window.symbolEngine` is not created by the library. `SettingsBus.getSetting/setSetting` read `window.symbolEngine.settings`, so assign it if you use the settings widgets. See [08 Settings](08-settings.md).
- Programmatic placement without user interaction: `engine.addMilSymbolAtCenter(options)` draws at the view center. Full method reference: [02 SymbolEngine API](02-symbol-engine-api.md) and [03 Drawing and events](03-drawing-and-events.md).
- To listen to engine log output, add a document listener for the `engine-log` event. See [04 Support classes](04-support-classes.md#enginelogger).

---

## 6. Minimal 3D example

Only the view class differs; the engine code is identical.

```ts
import SceneView from '@arcgis/core/views/SceneView';

const sceneView = new SceneView({
  container: 'viewDiv',
  map: new Map({ basemap: 'satellite', ground: 'world-elevation' }),
  center: [69.3451, 30.3753],
  zoom: 7,
});

const engine = new SymbolEngine(() => sceneView);
await sceneView.when();
```

The harness suppresses the SDK double-click zoom on every view because multi-point symbols finish on double-click:

```ts
view.on('double-click', (event) => event.stopPropagation());
```

Add this to your own views if you draw line or area symbols.

---

## 7. Switching between 2D and 3D

`SymbolEngine` is not tied to one view instance. It calls the getter you passed to the constructor, and it must be told when the getter's result changes by calling `onViewChanged(newView)`. This re-attaches every sub-engine and layer manager (2D and 3D use different `GraphicsLayerManager` instances, but graphics survive because layers are re-used by id from the shared `Map`).

Both views must share the same `Map` instance. The harness builds one `Map` and creates both a `SceneView` and a `MapView` from it; only one view holds the container at a time.

```ts
let activeView: MapView | SceneView = sceneView;
const engine = new SymbolEngine(() => activeView);

function switchTo(next: MapView | SceneView) {
  const prev = activeView;
  const vp = prev.viewpoint.clone();
  prev.container = null;          // release the DOM node
  next.viewpoint = vp;
  next.container = document.getElementById('viewDiv') as HTMLDivElement;
  activeView = next;              // the getter now returns the new view
  engine.onViewChanged(next);     // required
}
```

The harness (`switchView` in `src/main.ts`) additionally:

- multiplies or divides `viewpoint.scale` by `cos(latitude)` when going 2D to 3D or back, to keep the visual scale comparable (2D scale is in Web Mercator units, 3D is ground distance);
- re-applies 3D render settings with `VisualizationEngine.getInstance().applyRenderSettings(sceneView, settings)` after returning to 3D.

`onViewChanged` cancels any in-flight interactive draw and armed paste mode before re-attaching, so switching mid-draw discards that draw.

The API in `onViewChanged`'s signature is `onViewChanged(newView: MapView | SceneView): void`. It has no `public` modifier in the source but is public by TypeScript default.

---

## 8. Teardown

For SPA route changes, widget unmount, or replacing an engine:

```ts
engine.destroy();          // full teardown
```

`destroy()` (verified in `SymbolEngine.ts`):

- cancels any in-flight interactive draw and any pending continuous-mode timer;
- calls `removeGlobalEventListener()`, which detaches the document-level draw listeners;
- detaches keyboard shortcuts;
- destroys the measurement, MGRS and Morphix engines and the context menu manager, and the stylus controller;
- disables the proximity, drawing-cue and visualization engines and the edit engine and selection action panel;
- clears the undo/redo history, the registered symbol set and the engine's event listeners.

The engine is not reusable afterwards; construct a new `SymbolEngine`.

Things `destroy()` does not do (by reading the source):

- It does not remove graphics layers from the map. Call `engine.clearAllGraphics()` first if you want the symbols gone, or remove the layers yourself (layer ids are in [04 Support classes](04-support-classes.md#graphicslayermanager)).
- It does not destroy the ArcGIS views. Destroy the `MapView`/`SceneView` yourself.
- Some engines are singletons (`ContextMenuManager.getInstance()`, `ThemeManager.getInstance()`, `DrawingCueEngine.getInstance()`, `VisualizationEngine.getInstance()`, `MeasurementEngine.getInstance()`); `ContextMenuManager.destroy()` resets its singleton so a new engine gets a fresh instance.

If you keep an engine alive but want it to stop reacting to draw events only, call `engine.removeGlobalEventListener()`.

When more than one `SymbolEngine` lives on the same page, each engine only reacts to draw events that bubble from its own view container. Events dispatched directly on `document` are accepted by every engine.

---

## 9. What the harness demonstrates

`index.html` (about 6,600 lines) and `src/main.ts` (about 3,300 lines) are the manual test surface and the best source of working usage. Neither ships in `dist`.

Notes on running it: `npm run dev` serves the source (`@lib` alias points to `MS/`), `npm run dev:dist` builds and serves the same harness against `dist/MS/*.min.js` (alias `@lib` points to `dist/MS`). Use `dev:dist` to check that the shipped output behaves like the source.

| Where | What it shows |
| --- | --- |
| `src/main.ts`, top (~lines 1-40) | Imports; `esriConfig.assetsPath` and `fontsUrl`; `@lib/...` imports of `SymbolEngine`, `Amplifier`, `DrawEssentials`, `VisualizationEngine` |
| `src/main.ts`, `offline` block | Choosing the basemap: local ArcGIS Server layers versus Esri online `satellite` + `world-elevation`, driven by `Settings.json` key `offline` |
| `src/main.ts`, `createView(...)` | View creation for both types, double-click zoom suppression, widget relocation, custom undo button calling `symbolEngine.undo()` |
| `src/main.ts`, `new SymbolEngine(() => appConfig.activeView)` | Engine construction with an active-view getter and assignment to `window.symbolEngine` |
| `src/main.ts`, `onActiveViewChanged` and `switchView()` | 2D/3D switching and `symbolEngine.onViewChanged(...)` (section 7 above) |
| `src/main.ts`, `drawButton` handler | Building `SymbolOptions`, `Amplifier` and `DrawEssentials`, then `drawMilSymbolInteractively` or `addMilSymbolAtCenter` |
| `src/main.ts`, around lines 780-960 | Building `Amplifier`/`DrawEssentials` for a chosen symbol from the dock: `amplifier.SIDC`, `UNIQUE_DESIG`, `drawEssentials.ECHELON = amplifier.getEchelon(sidc)`, `DRAW_TYPE`, `uniqueDesignation`, `infoFields` |
| `src/main.ts`, `engine-log` listener | Forwarding `engine-log` events to the console |
| `src/main.ts`, `window.*` getters | Access to `keyTerrainEngine`, `ocokaEngine`, `missionPlannerEngine` and other sub-engines via `symbolEngine` properties |
| `src/main.ts`, `selectionEngine?.on('selectionChange', ...)` | Subscribing to selection events |
| `src/main.ts`, `initializeAutocomplete()` | Symbol search over `symbolEngine.getSymbolNamesForAutocomplete()` and `getSymbolByKey(key)` |
| `index.html`, `<head>` | The exact script tags and stylesheets (section 4) |
| `index.html`, `#settingsPanel`, `#apiPanel` | Legacy settings panel dispatching `settingsChanged`; API Test panel with buttons for the public API (save/load, export, test fields, and so on) |
| `index.html`, `#infoDiv` | Top bar: symbol picker, draw and view-switch buttons |
| `src/testDataGenerator.ts` | `generateTestField`, `generateClutteredField`, `clearTestField` used by the API panel |

For the API surface in more depth continue with [02 SymbolEngine API](02-symbol-engine-api.md).
