# PAMS8 — Briefing, Animation & Export (Remaining Phases) — Implementation Plan

## Context & goals

Today a PAMS8 user who wants to *present* a tactical plan — walk stakeholders through it, animate a phased build-up, or hand off an editable deck — has to leave the app for PowerPoint. That means re-screenshotting the map by hand, re-drawing overlays, and losing the link between the plan and the briefing. These three phases close that gap entirely, inside the app:

- **Phase 4 — Briefing / Present Mode + Animations.** Capture map states as slides, play them back with smooth `goTo` transitions, run a distraction-free full-screen present mode, and stage reveal "builds" (appear / fade / fly-in / draw-on) driven by the bundled GSAP ticker.
- **Phase 5 — PPTX Export.** Emit a real `.pptx` via `pptxgenjs`: first a flat screenshot deck (Mode A, ships first), later an editable-shapes overlay (Mode B) that re-emits military graphics as native PowerPoint shapes over a basemap raster.
- **Phase 3 — Pin to Screen.** A per-item toggle so a title, legend, or callout stays fixed on screen while the map pans and zooms beneath it.

All three are independently shippable, each gated behind its own `features.*` flag, and each reuses the existing engine lifecycle, settings, and serialization machinery rather than inventing new plumbing.

---

## Shared foundations & constraints

These facts are common to all three phases and were verified against the current tree. **Read this section before starting any phase.**

### Stable graphic ids (relied on by all three phases)

Every committed graphic gets a stable id at draw completion:

- `drawSymEnd` (`MS/Engines/SymbolEngine.ts:3203`) assigns `attrs.id` (lines 3266–3273): uses `_pendingAttrs.symbolId` (from load/paste) else `this.generateUUID()` (3272), then `graphic.attributes = attrs; graphic.set('id', attrs.id)` (3280–3281).
- `drawSymEnd` also sets `attrs.type = symbolType || 'symbol'` (3262). Graphic type label is read as `graphic.attributes.graphicType || graphic.attributes.type` (`ContextMenuManager.ts:504–505`, `1533–1534`).
- Round-trips through save/load: `SerializationEngine.savePlanToFile` uses `g.attributes?.id || this._generateUUID()` (`SerializationEngine.ts:98`); `loadPlanSymbolsFromData` re-applies saved ids.

**Consequence:** slides, builds, and pins all target graphics by `graphic.attributes.id`, which survives reload.

### Dynamic-load + teardown pattern (mirror exactly for every new engine)

Reference: `DeploymentBuilderEngine` and `MGRSEngine`.

- **Type-only import** at top of `SymbolEngine.ts` (e.g. line 62): `import type DeploymentBuilderEngine from './DeploymentBuilder/DeploymentBuilderEngine.ts'`.
- **`_initXEngine()`** (e.g. `SymbolEngine.ts:878`): read `(settingsData as any).features?.X`, gate on the flag, `const { default: X } = await import('./…')`, `this._x = X.getInstance(); this._x.start(this.view, this.serializationEngine); this._x.enable(); (window as any).xEngine = this._x; this.emitEvent('xEngineReady', { engine })` — all inside try/catch.
- **Boot call** from `initialize()` near `SymbolEngine.ts:425`.
- **Runtime toggle** in `onSettingChanged()` (signature `public onSettingChanged(path: string[], value: any): void`, `SymbolEngine.ts:1821`; branches on `fullPath.startsWith('features.')` at 1861). deploymentBuilder branch at 2063–2073: `if (fullPath === 'features.deploymentBuilder') { if (value && !this._x) this._initX(); else if (!value && this._x) this._x.disable(); else if (value && this._x) this._x.enable(); }`.
- **View-switch hook** in `onViewChanged()` (`SymbolEngine.ts:666`): `this._x?.onViewChanged(newView)`.
- **Engine singleton contract** (`DeploymentBuilderEngine.ts`): `private static _instance` (105), `public static getInstance()` (153), `public start(view, serialEngine)` (162), `public onViewChanged(view)` (171), `public enable()` (184), `public disable()` (188), `public destroy()` (194).

Gating polarity: `deploymentBuilder` uses `!== true` (opt-in); `measurementEngine` uses `!== false`.

### Settings manifest / widget pattern (Ctrl+K palette + ⚙ menu)

Two shapes, both self-registering via a side-effect import in `SymbolEngine.ts` (block at lines 115–129):

- **Settings panel** (Phase 3, Phase 4): a `XSettingsManifest.ts` exporting `SettingDescriptor[]` (`import type` from `../Support/SettingsWidget`) — each descriptor `{ path, label, group, type:'boolean'|'number'|'color', help, keywords }` — paired with a `XSettingsWidget.ts` that calls `mountSettingsWidget({ id, title, icon, manifest })` and `CommandPalette.registerWidget({ id, label, category, icon, hint, keywords, opener })` at module load. Mirror `MGRSSettingsManifest.ts` / `MGRSSettingsWidget.ts:23`, `TextStyleSettingsManifest.ts` / `TextStyleSettingsWidget.ts:33–41`.
- **Action** (Phase 5 export — action-shaped, no panel): `CommandPalette.registerActions([{ id, label, hint, keywords, run }])` — mirror `LandingZoneCommands.ts:22–30`.

`CommandPalette` also exposes `registerSettings(manifest, opener?)`. Legacy `index.html` `settingMappings` table must also get an entry so the ⚙ checkbox dispatches `settingsChanged` correctly.

### Verified environment constraints

- **3D-headless `takeScreenshot` freeze.** `view.takeScreenshot()` HANGS in the 3D `SceneView` inside the headless preview pane (rAF frozen), but WORKS in 2D `MapView`; **both work in a real browser.** All screenshot/thumbnail paths must be time-out/guarded and fall back to a placeholder; 3D screenshot/export is verified only in a real browser. There are currently **zero** `takeScreenshot` call sites in the codebase — this API is greenfield.
- **No per-graphic opacity.** ArcGIS graphics have no opacity property. Fading must go through a temp `GraphicsLayer`'s `layer.opacity` (0–1) or per-frame symbol-color-alpha cloning. Layer opacity is already proven wired at `index.html:5896–5903` (per-layer opacity sliders doing `layer.opacity = Number(slider.value)/100`).
- **Drape layers.** Symbol layers use `elevationInfo` mode `'on-the-ground'`. Any geometry-offset animation (fly-in) or screen-anchor re-projection in 3D re-drapes to terrain and behaves nonlinearly under camera tilt.
- **`tween.js` is GSAP TweenMax v1.8.4, NOT `@tweenjs/tween.js`.** `index.html:1548` loads `MS/ThirdParty/TweenJS/tween.js`, registering globals `TweenMax`/`TweenLite` on `window`. No ES module export, no real `.d.ts` (`tween.d.ts` is just `declare var q: any`). Signature: `TweenMax.to(target, durationSeconds, vars)` — **duration in SECONDS** — where `vars` carries `onUpdate`, `onComplete`, `ease`, and target props. GSAP self-drives its own ticker; there is **no** `TWEEN.update()` rAF loop. Existing usage: `MS/Support/Shapes.ts:2256` & `2540` (`(window as any).TweenMax.to(position, numberOfPts, { …, onUpdate, ease })` then `tween.time(i)`). Always cast `(window as any).TweenMax`.

### View access & camera/extent state

- `SymbolEngine` exposes `get view()` → `this._getView()` (constructed with `_getView: () => MapView|SceneView`).
- Dimension via `this.view.type` — string `'2d'` (MapView) or `'3d'` (SceneView). Used e.g. `Ocoka.ts:606`.
- **2D state:** `view.extent` (an `Extent`; `.clone()`/`.toJSON()`); also `view.center`, `view.zoom`, `view.rotation`.
- **3D state:** `view.camera` (a `Camera`; `.clone()`/`.toJSON()` — position/heading/tilt).
- **`goTo` signature** (verified across ~12 sites, e.g. `DeadGroundMapper.ts:446`, `OpRanker.ts:922`): `view.goTo(target, { duration, easing }): Promise` — always `.catch(() => {})` to swallow user-interrupt `AbortError`. `easing` ∈ `'linear'|'ease'|'ease-in'|'ease-out'|'ease-in-out'` (default `'ease-in-out'`). `target` can be an `Extent`, `Camera`, `Graphic`, geometry, or `{ target, zoom, tilt, heading, center }`.
- **Layers:** `LAYER_NAMES` (`GraphicsLayerManager.ts:6–15`): `FORCE='ForceSymbolsLayer'`, `TACT_PT='TacticalPointSymbolsLayer'`, `TACT='TacticalSymbolsLayer'`, `SKETCH`, `ANNOTATION_LAYER`, `CLUSTER`, `LEADER_LINE`, `LADDER`; plus `LEGACY_MIL_SYMBOLS_LAYER_ID='milSymbols'`. Get via `layerManager.getLayer(name)` / `.getOrCreateLayer(name)`. Each `GraphicsLayer` has `.visible` (bool) and `.opacity` (0–1). Per-graphic visibility: `graphic.visible` (bool). **Layers are keyed per-view** — 2D and 3D resolve to different `GraphicsLayerManager` instances, so re-resolve on view switch.

---

## Phase 4 — Briefing / Present Mode + Animations

Build a pluggable **`BriefingEngine`** (`MS/Engines/Briefing/BriefingEngine.ts`) as a singleton mirroring the `DeploymentBuilderEngine` lifecycle, gated behind `features.briefing`.

### Data model

Slides reference graphics by stable `attributes.id`. Store **both** a 2D extent and a 3D camera so a briefing survives a view switch. Concrete TypeScript interfaces to implement:

```ts
// MS/Engines/Briefing/BriefingTypes.ts (or inline in BriefingEngine.ts)

export type ViewKind = '2d' | '3d';

export interface CapturedViewState {
  /** JSON of view.extent (2D). Present when captured in a MapView. */
  extent?: __esri.ExtentProperties;
  /** JSON of view.camera (3D). Present when captured in a SceneView. */
  camera?: __esri.CameraProperties;
  /** The view.type at capture time — drives which of extent/camera to prefer. */
  capturedIn: ViewKind;
  rotation?: number;   // 2D only
}

export type BuildEffect = 'appear' | 'fade' | 'flyIn' | 'drawOn';

export interface BuildStep {
  graphicId: string;        // → graphic.attributes.id
  effect: BuildEffect;
  delayMs: number;          // offset from slide-enter (or from previous step if sequenced)
  durationMs: number;       // 0 for instant 'appear'
  /** flyIn only: map-units offset the graphic starts at, animating to 0,0. */
  flyFrom?: { dx: number; dy: number };
}

export interface Slide {
  id: string;               // engine-generated UUID
  title: string;
  notes?: string;           // speaker notes → reused by Phase 5 addNotes()
  view: CapturedViewState;
  /** LAYER_NAMES value (+ 'milSymbols') → visible. */
  visibleLayers: Record<string, boolean>;
  /** Optional per-graphic overrides by attributes.id. */
  graphicVisibility?: Record<string, boolean>;
  builds?: BuildStep[];     // ordered staged-reveal steps
  transitionMs: number;     // goTo duration entering this slide (default 1000)
  thumbnailDataUrl?: string; // lazy; absent in 3D-headless
}

export interface BriefingDocument {
  version: 1;
  slides: Slide[];
}
```

This matches the M3 sketch in `Features/M-Export-and-Briefing-Tools.md:41–49` (slides store extent + visible layers + time-phase; Capture Slide; Prev/Next playback via `view.goTo(slide.extent, { duration: 1000 })`; serialise `_slides` to JSON). The M3 guide names the host `ImportExportEngine`; the codebase has since split export into `SerializationEngine`, so a **dedicated `BriefingEngine`** is the correct home.

### Capture

`captureSlide(title?)`:
1. `const v = this.view;`
2. Build `CapturedViewState`: if `v.type === '2d'` snapshot `v.extent.toJSON()` + `v.rotation`; if `'3d'` snapshot `v.camera.toJSON()`. Set `capturedIn`.
3. Snapshot `visibleLayers`: iterate `LAYER_NAMES` (+ `'milSymbols'`), `layerManager.getLayer(name)?.visible`.
4. Optionally snapshot per-graphic `graphic.visible` by id.
5. Lazily attempt a thumbnail: `view.takeScreenshot({ width: 240 })` **guarded with a timeout** (see risks); on 3D-headless timeout leave `thumbnailDataUrl` undefined and render a placeholder tile.
6. Push to `_slides`, refresh the slide-strip panel.

### Playback + present mode + keyboard

- **Slide transition** = one `goTo` per Next/Prev: resolve the target from `slide.view` (prefer `camera` when `this.view.type === '3d'`, else `extent`; if a slide lacks the current view's state, fall back to the other and let `goTo` adapt), then `view.goTo(target, { duration: slide.transitionMs, easing: 'ease-in-out' }).catch(() => {})`. Apply `visibleLayers` / `graphicVisibility`, then run `builds`.
- **Debounce transitions:** rapid Next/Prev stacks `goTo` promises → track the in-flight promise and ignore/queue new advances until it settles (or accept the AbortError via `.catch`).
- **Present mode enter (`enterPresent()`):**
  - `document.body.classList.add('ms-present-mode')` — CSS in `index.html` hides HUD/panels (`.ms-present-mode #settingsPanel, .ms-present-mode .infobar, … { display:none }`). No such class exists yet.
  - Save the current ArcGIS UI widget list, then clear it: `this._savedUiComponents = view.ui.components; view.ui.components = [];` Restore on exit.
  - **Attach BriefingEngine's OWN `document` `keydown` listener** (do NOT route through `KeyboardShortcutManager` — its handler early-returns inside input/textarea/select/contenteditable at lines 110–113, which would swallow present-mode keys; Ctrl+K is the only key handled before that guard at line 103). Self-contained keys: `Escape` → exit; `ArrowRight`/`Space`/left-click on the view → next; `ArrowLeft` → prev. Detach on exit.
  - Existing `Esc` chain in `KeyboardShortcutManager.ts:178–196` (stylus → edit → continuous-mode) is untouched because present-mode owns its own listener; document this ordering assumption.
- **Present mode exit (`exitPresent()`) must be idempotent and run on abnormal exit** (view switch, error): remove body class, restore `view.ui.components`, detach keydown. Call it from `onViewChanged` and `destroy`.

### Build effects

Reuse the global GSAP ticker: `(window as any).TweenMax.to(target, durationSeconds, { onUpdate, onComplete, ease })` — **remember durationMs / 1000**.

| Effect | Technique |
|---|---|
| **appear** | Instant. Toggle `graphic.visible = true` after `delayMs` (use `TweenMax.delayedCall` or a `setTimeout`). No tween needed. |
| **fade** | Move the graphic into a dedicated temp `GraphicsLayer` (`layerManager.getOrCreateLayer('briefingFade')`), set `layer.opacity = 0`, `graphic.visible = true`, then `TweenMax.to(layer, durationMs/1000, { opacity: 1, onComplete })`. **Restore original layer membership after** — `drawSymEnd` routes graphics to their home layer via `getDrawEndLayer`, so record the origin layer and move the graphic back when the fade finishes. (Per-graphic opacity is unsupported; layer-opacity is the proven path — `index.html:5896–5903`.) |
| **flyIn** | Apply a geometry offset per frame in `onUpdate`. Tween a scalar `t: 1 → 0` over `durationMs/1000`; each frame translate the graphic's geometry (and its `drawEssentials` control points — see Phase 3's translate helper) by `flyFrom.dx*t, flyFrom.dy*t` from the resting position. **Test in both 2D and 3D** — draped layers may clip the offset to terrain in 3D. |
| **drawOn** | Progressive polyline reveal: cache the full `geom.paths`, then per frame in `onUpdate` slice the path array to a growing fraction of total vertices and reassign `graphic.geometry`. For polygons, reveal the ring similarly (or fall back to `fade`). |

Sequencing: schedule each `BuildStep` at its `delayMs` from slide-enter (a shared clock), so steps can overlap or stagger.

### BriefingEngine + panel + settings

- **Engine boot:** add `_initBriefingEngine()` to `SymbolEngine` (gate `features.briefing !== true`, dynamic `import('./Briefing/BriefingEngine.ts')`, `getInstance()`, `start(this.view, this.serializationEngine)`, expose as `symbolEngine.briefingEngine` + `window.briefingEngine`, emit `'briefingEngineReady'`); call at boot near `SymbolEngine.ts:425`; add `type` import near line 62; add `this._briefingEngine?.onViewChanged(newView)` near line 666; add the `features.briefing` toggle branch in `onSettingChanged` near line 2063; add a public getter.
- **Settings:** add `features.briefing` (default `false`, opt-in — mirror deploymentBuilder polarity but default off) to the `features` subtree in `Settings.json` (~line 420), plus an optional `briefing` config block (default transition ms, default effect, autoplay interval). Create `BriefingSettingsManifest.ts` + `BriefingSettingsWidget.ts` (mirror the MGRS pair), side-effect import in `SymbolEngine.ts` (~line 124).
- **UI:** add a slide-strip panel to `index.html` with **Capture Slide / Prev / Next / Present** buttons and thumbnail tiles — mirror the `deployment-manager-btn` markup at `index.html:1726`. Wire the buttons in `src/main.ts` to `window.briefingEngine` — mirror the deployment wiring at ~`src/main.ts:2364`. Add a settings checkbox + `settingMappings` entry.

### Persistence

Store slides in a **separate briefing JSON** (or a top-level `briefing` block on the Plan document) — do **not** embed in per-symbol serialization. Slides reference graphics by stable `attributes.id`. Provide `exportBriefing(): BriefingDocument` and `importBriefing(doc)` on `BriefingEngine`, plus save/load via the existing download helper (`SerializationEngine._downloadJSON`, `SerializationEngine.ts:914–923`). Optionally extend `savePlanToFile`/`loadPlanFromFile` to carry the `briefing` block alongside symbols.

---

## Phase 5 — PPTX Export

Depends on Phase 4's slide/build model (Mode A iterates slides; explode-builds reuses `BuildStep`). Create `MS/Engines/ImportExport/PptxExporter.ts` as a singleton mirroring `SerializationEngine` (`getInstance` / `start(layerManager, getView)`). Gate behind a new `features.exportTools` flag.

### Prerequisite: install pptxgenjs

`pptxgenjs "^4.0.1"` is declared in `package.json:29` but **is NOT installed** in `node_modules` (verified). Run `npm install` (or `npm i pptxgenjs`) before any import resolves — otherwise the dev server 500s on the dynamic import. v4 ships an ESM build so the default-export import works under Vite; if Vite complains, add it to `optimizeDeps`.

### ArcGIS screenshot API (verified, v5.0.19)

`view.takeScreenshot(options?): Promise<Screenshot>` on BOTH `MapView` (`MapView.d.ts:480`) and `SceneView`. `Screenshot = { dataUrl: string; data: ImageData }` — `dataUrl` is a PNG/JPEG data URL usable directly as pptx `addImage({ data })`. Options (`UserSettings`): `{ width, height, area: Rect, layers?: ReadonlyArrayOrCollection<Layer>, format: 'png'|'jpeg'|'jpg' (default png), quality (jpeg only, ~90), ignoreBackground?, ignorePadding }`. Example: `view.takeScreenshot({ width: view.width * pixelRatio, height: view.height * pixelRatio })`.

The `layers` option is an **allow-list of operational layers to INCLUDE** (basemap always included) — this is the Mode B enabler.

### Mode A — flat screenshot deck (ship first)

Per slide state (or the current view):
1. `await view.goTo(state).catch(() => {})` to position the map.
2. `const shot = await view.takeScreenshot({ width, height, format: 'png' })` — derive `width`/`height` from `view.width`/`view.height` (or force 16:9, e.g. 1280×720) so the image matches the slide aspect and doesn't letterbox.
3. `slide.addImage({ data: shot.dataUrl, x: 0, y: 0, w: 10, h: 5.625 })`.
4. `slide.addText(slide.title, { x, y, w, h, fontSize, bold, color })` — titles/legends are HTML/map-overlay and are **NOT** in the screenshot, so re-draw them as pptx text/shapes.
5. `slide.addNotes(slide.notes ?? '')`.

**Explode-builds option:** emit one image per staged reveal step — for each `BuildStep` in order, apply the build's visibility state, screenshot, add a slide. Reuses the Phase 4 build model directly.

### Mode B — editable overlay (later)

1. Screenshot **basemap + military only** via the `layers` allow-list: `view.takeScreenshot({ layers: [forceLayer, tactPtLayer] })` (FORCE, TACT_PT — omit AutoShape/text/annotation layers). Confirm the exact set against `GraphicsLayerManager.SYMBOL_LAYER_IDS` / `LAYER_NAMES`.
2. Lay that PNG as the slide background image.
3. Re-emit AutoShape/text/arrow graphics as **native pptx shapes**: project each geo vertex with `view.toScreen(mapPoint): {x,y}` (existing use `Shapes.ts:2653–2654`; returns null offscreen), convert screen px → inches: `x_in = (px / view.width) * 10`, `y_in = (py / view.height) * 5.625`, then `slide.addShape(pptx.ShapeType.rect|line|ellipse|…, { x, y, w, h, line, fill })` / `slide.addText(...)`.
4. **Fallbacks:** vertices that `toScreen` returns null for (offscreen), any 3D-tilt-distorted geometry, freehand fills, and milsymbol picture markers **cannot** become native shapes — leave them in the background raster.

### Exact pptxgenjs v4 calls

```ts
const { default: pptxgen } = await import('pptxgenjs'); // keep out of main bundle
const pptx = new pptxgen();
pptx.layout = 'LAYOUT_16x9';                 // default 16:9 = 10 × 5.625 in
const slide = pptx.addSlide();
slide.addImage({ data: shot.dataUrl, x: 0, y: 0, w: 10, h: 5.625 }); // 'data' for data URLs, 'path' for files
slide.addText('Phase I — Assembly', { x: 0.3, y: 0.2, w: 6, h: 0.6, fontSize: 24, bold: true, color: 'FFFFFF' });
slide.addShape(pptx.ShapeType.rect, { x: 1, y: 1, w: 2, h: 1, line: { color: 'FF0000', width: 2 }, fill: { color: 'FFCC00' } });
slide.addNotes('Speaker notes for this phase.');
// finish — either:
await pptx.writeFile({ fileName: 'briefing.pptx' });              // auto browser download
// or, to reuse the existing helper:
const blob = await pptx.write({ outputType: 'blob' });
// then feed blob to the _downloadBlob pattern (SerializationEngine._downloadJSON:914–923 / LocalPeaksEngine.ts:1170 / MissionPlannerEngine.ts:2526)
```

### Export UI + settings

- **Home:** `MS/Engines/ImportExport/IOEngine.ts` is currently **empty (0 bytes)** — a natural home, or a new `PptxExporter.ts` in the same dir. `SerializationEngine.start(layerManager, onLoadSymbol, onLoadTemplate?)` is the init contract to mirror; it iterates `LAYER_NAMES.TACT/TACT_PT/FORCE` + `LEGACY_MIL_SYMBOLS_LAYER_ID` via `layerManager.getOrCreateLayer(id)`.
- **Feature gate:** add `features.exportTools` to the `features` subtree (`Settings.json:398–421` — no `exportTools` key today) plus an `exportTools` config block (`mode: 'flat'|'editable'`, `format: 'png'|'jpeg'`, `explodeBuilds`, `includeNotes`, deck size). Wire runtime toggle into `onSettingChanged` (~line 1861) and the `index.html` `settingMappings` table.
- **Ctrl+K action:** new `MS/Engines/PptxExportCommands.ts` calling `CommandPalette.registerActions([{ id, label, hint, keywords, run }])` (mirror `LandingZoneCommands.ts:22–30`); side-effect import in `SymbolEngine.ts` alongside lines 115–129.
- **Buttons:** add an Export control to the `index.html` top bar (mirror `#savePlanButton`, class `ms-btn infobar-btn`, `index.html:1729`) and an API-panel button (mirror `#api-export` at `index.html:3360`; handlers wired at `index.html:4912–4962` call `engine.serializationEngine.*`). New handlers call the exporter.

---

## Phase 3 — Pin to Screen

Add a pluggable **`ScreenAnchorEngine`** (`MS/Engines/ScreenAnchorEngine.ts`) gated behind `features.screenAnchor` (default off), following the MGRS / DeploymentBuilder dynamic-load + `onSettingChanged` teardown pattern. Independent of Phases 4/5.

### Recipe (reactiveUtils)

`reactiveUtils` is already imported in `SymbolEngine.ts` (lines 7 and 13). `toScreen`/`toMap` are confirmed on the union view in both 2D and 3D: `view.toScreen(mapPoint): {x,y}` (`Shapes.ts:2653`), `view.toMap({x,y}): Point` (`Shapes.ts:2678`, `ContextMenuManager.ts:1553`, `SymbolEngine.ts:1247`).

**On "Pin to screen":**
1. Compute the graphic's current on-screen anchor: `const s = view.toScreen(anchorMapPoint)` where `anchorMapPoint` = the point geom, or the polygon/polyline centroid (or first vertex).
2. Store `attributes.pinned = true`, `attributes.xPct = s.x / view.width`, `attributes.yPct = s.y / view.height`.
3. Add to an in-engine `Map<graphicId, {xPct, yPct}>`.

**One continuous watch** (mirror `VisualizationEngine.ts:505–519` which watches `() => view.extent` and fires every frame during pan/zoom — NOT the stationary watch, so pins track *during* the pan):

```ts
reactiveUtils.watch(() => (this._view as any)?.extent, () => this._scheduleReanchor());
```

`_scheduleReanchor()` debounces ~16ms via a rAF/timer that clears the prior handle (mirror `MGRSEngine._scheduleRebuild`, `MGRSEngine.ts:349–362`, using `setTimeout` + `REBUILD_DEBOUNCE_MS`). Store handles in an array and `.remove()` on teardown (`MGRSEngine._handles.push(h)` / `VisualizationEngine._watchers.push`). **Skip entirely when the pin Map is empty.**

**Per pinned graphic each tick:**
```
targetScreen = { x: xPct * view.width, y: yPct * view.height }
targetMap    = view.toMap(targetScreen)          // GUARD null
currentAnchor= <current geom anchor point>
dx = targetMap.x - currentAnchor.x
dy = targetMap.y - currentAnchor.y
if (Math.hypot(dx, dy) < EPSILON) continue;      // avoid feedback churn
translate geometry AND drawEssentials by (dx, dy)
```

### Geometry translation (point / line / area + control points)

Reuse the inlined affine transform from `EditEngine._applyAffineToGeometry` (`EditEngine.ts:647–681`): clones geometry, then applies `x' = a*x - b*y + tx; y' = b*x + a*y + ty`. For a pure translation pass `a=1, b=0, tx=dx, ty=dy`.

- **point:** set `geom.x`, `geom.y`.
- **polyline:** map `geom.paths` (`number[][][]`).
- **polygon:** map `geom.rings` (`number[][][]`).
- **Also translate `drawEssentials`**: `CTRL_PTS` (array of points), `BASE_LN_PTS` (`{ startPt, midPt, endPt }`) for line/area, and `GEOM` for point symbols — mirror `EditEngine._applyAffineToPoint` (`EditEngine.ts:640–644`). Keeping these in lockstep with geometry is mandatory or a later Morphix edit / re-render snaps the shape back to stale control points. (`saveSymbolToJSON` reads exactly these — `SerializationEngine.ts:278–302`.)

Use the inlined form (no per-vertex `Point` allocation) — `EditEngine.ts:651–653` inlines it specifically for this reason, important with many/large polygons × every-frame firing.

### Context-menu toggle

Use `ContextMenuManager.addDynamicItemProvider(provider: (graphic) => ContextMenuItem[])` (`ContextMenuManager.ts:483`) — called every time the menu opens, so the label flips Pin ↔ Unpin off `graphic.attributes.pinned`. `ContextMenuItem` (`ContextMenuManager.ts:31–42`): `{ id, label: string|((g)=>string), icon?, enabled?, visible?, action?: (g)=>void, group?, order?, children? }`. Use `label`-as-function for Pin/Unpin text and `visible`-as-function to gate to the freehand family only (`graphicType` ∈ text / AutoShape / AutoShapeArrow / freehand arrows). The extension point already exists at boot: `SymbolEngine.registerContextMenuItems()` (`SymbolEngine.ts:383`) with `this._contextMenuManager` (`ContextMenuManager.getInstance()`, `SymbolEngine.ts:367`). "Unpin" clears `attributes.pinned` and removes from the Map.

### Serialization

`saveSymbolToJSON` (`SerializationEngine.ts:273–316`) returns `{ pams8Version, type, layerId, id, sidc, amplifier, drawEssentials }` — it does **NOT** serialize arbitrary attributes, only `id` + `drawEssentials`. To persist pin state, either:
- **(a)** add `pinned/xPct/yPct` to the returned object AND read them in the load path (`SymbolEngine.loadSymbolFromJSON`, wired at `SerializationEngine.start`, `SymbolEngine.ts:345–349`); or
- **(b)** mirror `pinned/xPct/yPct` into `drawEssentials`, which is round-tripped whole (`deJson = { ...de }`) — simplest, no load-path change.

**On load, re-apply the pin from `xPct/yPct` against the NEW view size/extent** (the stored map geometry is a snapshot at the last anchor, not true geography). Re-anchor only after the view is ready — load order matters.

### GeoJSON exclusion

A pinned graphic's stored map geometry is non-geographic, so exclude it from geographic exports. In `exportToGeoJSON` (`SerializationEngine.ts:407–500`) add an early `if (g.attributes?.pinned) return;` inside the `layer.graphics.forEach` at ~line 426 (before building `geoJsonGeom`). Apply the same exclusion in the Phase 5 Mode B native-shape overlay so pinned items don't leak into geographic outputs.

### Engine wiring

Mirror `features.mgrsEngine`: boot gate in `SymbolEngine` constructor reads `const features = (settingsData as any).features ?? {}` (`SymbolEngine.ts:398–400`); `_initScreenAnchorEngine()` early-returns unless `features.screenAnchor === true`; runtime toggle in `onSettingChanged` (`fullPath === 'features.screenAnchor'`, near the mgrsEngine branch at 1973–1980) → `enable()`/`disable()` or lazy init; teardown removes watch handles + null the context-menu provider link. Add `features.screenAnchor` to `Settings.json` and a `ScreenAnchorSettingsManifest.ts` + `ScreenAnchorSettingsWidget.ts` self-registering pair (mirror `MeasurementSettingsManifest.ts` / `DrawingCuesSettingsManifest.ts`).

**3D caveat:** in a `SceneView`, `toMap` under camera tilt/heading is nonlinear and can return null (ray misses the globe). Null-guard every `toMap`; consider freezing pin updates when `view.camera.tilt > 0`. True screen-locking in 3D is approximate; 2D (with rotation) is exact.

---

## Files to create / edit (grouped by phase)

### Phase 4 — Briefing
- **NEW** `D:\Projects\Web\PAMS8\MS\Engines\Briefing\BriefingEngine.ts` — singleton engine, slide model, capture/restore, present mode, animations.
- **NEW** `D:\Projects\Web\PAMS8\MS\Engines\Briefing\BriefingTypes.ts` — `Slide`/`BuildStep`/`CapturedViewState`/`BriefingDocument` (or inline).
- **NEW** `D:\Projects\Web\PAMS8\MS\Engines\BriefingSettingsManifest.ts`
- **NEW** `D:\Projects\Web\PAMS8\MS\Engines\BriefingSettingsWidget.ts`
- **EDIT** `D:\Projects\Web\PAMS8\MS\Engines\SymbolEngine.ts` — type import ~62; side-effect widget import ~124; `_briefingEngine` field; `_initBriefingEngine()`; boot call ~425; `onViewChanged` hook ~666; `onSettingChanged features.briefing` ~2063; public getter.
- **EDIT** `D:\Projects\Web\PAMS8\MS\Data\Settings.json` — `features.briefing` ~420 + optional `briefing` block.
- **EDIT** `D:\Projects\Web\PAMS8\index.html` — slide-strip panel (mirror deployment-manager-btn:1726), Capture/Prev/Next/Present buttons, present-mode CSS, settings checkbox + `settingMappings` entry.
- **EDIT** `D:\Projects\Web\PAMS8\src\main.ts` — wire slide-strip buttons to `window.briefingEngine` (mirror deployment wiring ~2364).
- **OPTIONAL EDIT** `D:\Projects\Web\PAMS8\MS\Engines\ImportExport\SerializationEngine.ts` — add `briefing` block to Plan save/load (or keep separate JSON).
- **REFERENCE** `D:\Projects\Web\PAMS8\Features\M-Export-and-Briefing-Tools.md`.

### Phase 5 — PPTX Export
- **EDIT** `D:\Projects\Web\PAMS8\package.json` — dependency already declared; run `npm install`.
- **NEW** `D:\Projects\Web\PAMS8\MS\Engines\ImportExport\PptxExporter.ts` (or fill empty `IOEngine.ts`).
- **EDIT** `D:\Projects\Web\PAMS8\MS\Engines\ImportExport\IOEngine.ts` — currently empty (0 bytes); candidate home.
- **EDIT** `D:\Projects\Web\PAMS8\MS\Engines\ImportExport\SerializationEngine.ts` — reuse `_downloadJSON`/`_downloadBlob` (914–923), `start` contract, layer iteration.
- **NEW** `D:\Projects\Web\PAMS8\MS\Engines\PptxExportCommands.ts` — `CommandPalette.registerActions`.
- **EDIT** `D:\Projects\Web\PAMS8\MS\Engines\SymbolEngine.ts` — side-effect import of commands ~115–129; `features.exportTools` toggle ~1861.
- **EDIT** `D:\Projects\Web\PAMS8\MS\Data\Settings.json` — `features.exportTools` + `exportTools` block.
- **EDIT** `D:\Projects\Web\PAMS8\MS\Support\CommandPalette.ts` — (reference; `registerActions`).
- **EDIT** `D:\Projects\Web\PAMS8\index.html` — top-bar Export control + API-panel button (mirror `#savePlanButton`:1729 / `#api-export`:3360).
- **EDIT** `D:\Projects\Web\PAMS8\src\main.ts` — export button handlers.
- **REFERENCE** `D:\Projects\Web\PAMS8\MS\Managers\GraphicsLayerManager.ts` — `SYMBOL_LAYER_IDS` / `LAYER_NAMES` for Mode B allow-list.

### Phase 3 — Pin to Screen
- **NEW** `D:\Projects\Web\PAMS8\MS\Engines\ScreenAnchorEngine.ts`
- **NEW** `D:\Projects\Web\PAMS8\MS\Engines\ScreenAnchorSettingsManifest.ts`
- **NEW** `D:\Projects\Web\PAMS8\MS\Engines\ScreenAnchorSettingsWidget.ts`
- **EDIT** `D:\Projects\Web\PAMS8\MS\Engines\SymbolEngine.ts` — dynamic-load + `onSettingChanged features.screenAnchor` + context-menu provider registration.
- **EDIT** `D:\Projects\Web\PAMS8\MS\Managers\ContextMenuManager.ts` — (reference for `addDynamicItemProvider`).
- **EDIT** `D:\Projects\Web\PAMS8\MS\Engines\ImportExport\SerializationEngine.ts` — persist `pinned/xPct/yPct` (save + load); GeoJSON exclusion ~426.
- **EDIT** `D:\Projects\Web\PAMS8\MS\Engines\EditEngine.ts` — (reference for `_applyAffineToGeometry`; may extract a shared translate helper).
- **EDIT** `D:\Projects\Web\PAMS8\MS\Data\Settings.json` — `features.screenAnchor`.

---

## Build order & dependencies

1. **Phase 4 (Briefing) first.** It defines the `Slide`/`BuildStep` model that Phase 5's Mode A deck and explode-builds consume. Ship the flat capture/playback/present-mode path, then layer animations on top.
2. **Phase 5 (PPTX) second.** Consumes Phase 4 slides for the deck. Mode A (flat screenshot deck + explode-builds) ships first; Mode B (editable overlay) is a follow-on. First action: `npm install` to pull the declared-but-missing `pptxgenjs`.
3. **Phase 3 (Pin to Screen) is independent** and can be built in parallel or any time — it touches no briefing/export code (only the shared serialization exclusion overlaps with Phase 5 Mode B).

Each phase is independently shippable behind its own feature flag (`features.briefing`, `features.exportTools`, `features.screenAnchor`), all default-off (opt-in, `!== true` gating), so incomplete phases never affect the default build.

---

## Risks & open decisions

### Cross-cutting
- **3D-headless `takeScreenshot` freeze.** Affects Phase 4 thumbnails and all of Phase 5. `await` every screenshot behind a timeout guard so a stuck 3D call never freezes the UI; fall back to placeholder tiles; verify 3D screenshot/export **only in a real browser**.
- **GSAP TweenMax, not `@tweenjs/tween.js`.** Duration in **seconds**, `(window as any).TweenMax`, self-driven ticker — no `TWEEN.update()` loop.
- **No per-graphic opacity.** Fades go through temp-layer `opacity`; **restore original layer membership** after (drawSymEnd routes by `getDrawEndLayer`).
- **Per-view layers.** On view switch mid-flow, re-resolve layer references; slides carry both 2D extent and 3D camera.

### Phase 4
- `goTo` rejects (AbortError) on interrupt/interruption — `.catch(() => {})` everywhere; debounce rapid Next/Prev.
- Present mode must restore `view.ui.components` and remove `ms-present-mode` even on abnormal exit (view switch, error) — idempotent `exitPresent()` from `onViewChanged`/`destroy`.
- flyIn geometry offset may clip to terrain in 3D (drape) — test both dimensions.
- **Open decision:** briefing persistence as a separate JSON vs a `briefing` block on the Plan doc.

### Phase 5
- `pptxgenjs` not installed — `npm install` first, confirm ESM resolves under Vite (else `optimizeDeps`).
- Mode B: `toScreen` null/mis-projects offscreen and nonlinearly in 3D — fall back to raster.
- pptx shape styling is limited; complex AutoShape decorations and milsymbol picture markers stay in the raster.
- Titles/legends are HTML overlays, NOT in the screenshot — draw them as pptx text/shapes.
- Deck aspect must match view aspect (derive width/height from `view.width`/`view.height`, or crop via `area` Rect) or images letterbox on the 10×5.625 slide.
- **Open decision:** exact operational layer set for Mode B (FORCE, TACT_PT vs which to omit).

### Phase 3
- 3D `toMap` under tilt/heading is nonlinear/nullable — null-guard, consider freezing when `camera.tilt > 0`; 3D locking is approximate.
- Continuous extent watch × N pins × per-vertex translate is costly — debounce ~16ms, skip when no pins, use the inlined affine (no `Point` allocation).
- Feedback-loop risk: pin mutation retriggers `VisualizationEngine` geometry watches (`VisualizationEngine.ts:471–484`) — apply an EPSILON delta threshold.
- `saveSymbolToJSON` drops arbitrary attributes — persist `pinned/xPct/yPct` explicitly or mirror into `drawEssentials`.
- Pinned geometry is a snapshot, not geography — re-apply from `xPct/yPct` on load after view ready; exclude from GeoJSON (and Phase 5 Mode B).
- Keep `CTRL_PTS`/`BASE_LN_PTS` in lockstep or Morphix/re-render snaps back to stale control points.

---

## Verification

General: run `npm run dev` (Vite, port 3000; `predev` → `copy-assets`). For type-checking, `npm run build` runs `tsc -p tsconfig.build.json` which has a **pre-existing error baseline** — filter `tsc` output to the files you touched, don't treat the whole baseline as broken. Node is not on PATH in this environment — use the fnm install path for npm/tsc.

### Phase 4
- With `features.briefing = true`, capture 2–3 slides in 2D (`MapView`), verify thumbnails render (2D works headless).
- Prev/Next transitions via `goTo`; present mode enters (HUD hidden, `view.ui.components` cleared), keys (Esc/Arrows/Space/click) work, exit restores HUD + UI components.
- Each build effect: appear, fade (layer-opacity, graphic returns to origin layer), flyIn (2D + 3D), drawOn (polyline reveal).
- Save briefing JSON, reload plan, verify slides re-bind to graphics by `attributes.id`.
- **3D:** verify capture/thumbnail/present in a **real browser** (headless screenshot hangs in 3D).

### Phase 5
- After `npm install`, `features.exportTools = true`, export Mode A flat deck in 2D; open the `.pptx`, confirm one image per slide, titles as text, notes present, 16:9 aspect matches (no letterbox).
- Explode-builds: one slide per `BuildStep`.
- Mode B (when built): basemap+military raster + native shapes aligned via `toScreen`; offscreen/3D vertices fall back to raster.
- **3D export verified in a real browser only.**

### Phase 3
- `features.screenAnchor = true`, right-click a text/AutoShape graphic → Pin; pan/zoom in 2D and confirm it stays screen-fixed and exact; Unpin restores normal behavior.
- Many-pin performance under continuous pan (debounce holds; no jitter).
- Save/reload plan → pin re-applies at correct screen position against new view; pinned item excluded from GeoJSON export.
- **3D:** confirm null-guard and the tilt behavior (approximate/frozen) in a real browser; 2D is exact.