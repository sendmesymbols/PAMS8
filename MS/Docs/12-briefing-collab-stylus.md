# 12 - Briefing, Collaboration, Stylus and Other Host-Facing Engines

Briefing and present mode, multi-user collaboration and its relay, stylus input, screen pinning, the route elevation profile, and a few smaller engines and command entry points.

Related documents: [README](README.md) | [02 Symbol Engine API](02-symbol-engine-api.md) | [03 Drawing and Events](03-drawing-and-events.md) | [07 Import and Export](07-import-export.md) | [08 Settings](08-settings.md) | [11 Analysis Engines](11-analysis-engines.md) | [14 FAQ](14-faq-troubleshooting.md)

## Contents

| Section | Subject | Feature flag (`Settings.json`) | Access |
| --- | --- | --- | --- |
| 1 | Briefing engine, slides, builds, present mode, slide editor | `features.briefing` (default `true`) | `symbolEngine.briefingEngine`, `window.briefingEngine` |
| 2 | Collaboration engine and relay | `features.collab` (default `false`) | `symbolEngine.collabEngine`, `window.collabEngine` |
| 3 | Stylus / pen drawing | `stylus.*` settings | Settings only |
| 4 | Pin to Screen (`ScreenAnchorEngine`) | `features.screenAnchor` (default `false`) | `symbolEngine.screenAnchorEngine`, `window.screenAnchorEngine` |
| 5 | Route elevation profile (`RouteProfileEngine`) | none | `symbolEngine.showRouteProfile()` |
| 6 | Combat Power, Airspace and Landing Zone command entries | `analysis.airspace`, `analysis.landingZone` | `window.openCombatPower()` and others |
| 7 | `SymbolMetadataService`, `AnnotationEngine` | none | `symbolEngine` delegates |

Engines in sections 1, 2 and 4 are loaded lazily by `SymbolEngine` (dynamic `import()`), so the getter is `null` and the `window` global is undefined until the load finishes. When the load completes, `SymbolEngine` dispatches a `CustomEvent` on the view container that bubbles to `document`: `briefingEngineReady`, `collabEngineReady`, `screenAnchorEngineReady`, each with `detail.engine`.

```ts
document.addEventListener('briefingEngineReady', (e) => {
  const be = (e as CustomEvent).detail.engine;
  be.captureSlide('Start line');
});
```

The engines follow the same lifecycle as other optional engines: `getInstance()`, `start(...)`, `enable()`, `disable()`, `onViewChanged(view)`, `destroy()`. `SymbolEngine` calls these; a host normally does not. Toggling the feature flag at runtime (via the settings bus, see [08](08-settings.md)) loads, enables or disables the engine.

---

## 1. Briefing

Source: `MS/Engines/Briefing/*` (`BriefingEngine.ts`, `BriefingTypes.ts`, `SlideEditor.ts`, `Present/PresentSession.ts`, `SlideChrome.ts`, `SlideLayouts.ts`, `SlideLinks.ts`, `ChartFactory.ts`, and others). A briefing is an ordered list of slides. Each slide is either a map slide (captured 2D extent or 3D camera plus layer visibility) or a screen-only slide (an editor page with no map state, for example one imported from PowerPoint).

Requirements: `features.briefing: true`. The build-effect animations use the global `window.TweenMax` (GSAP TweenMax 1.8.4 from `MS/ThirdParty/TweenJS/tween.js`, loaded by a script tag); without it every effect degrades to an instant appear. Screenshots use `view.takeScreenshot()`, guarded by timeouts (2.5 s for thumbnails, 8 s for the full-resolution background), so a stalled 3D screenshot leaves the slide without a thumbnail rather than blocking capture.

Most methods return without effect (or `null`) when the engine is not enabled.

### 1.1 Data model

Exported from `BriefingTypes.ts` (types are in `BriefingTypes.d.ts` in the build).

`Slide`:

| Field | Type | Meaning |
| --- | --- | --- |
| id | `string` | Engine-generated UUID |
| title | `string` | Slide title |
| notes | `string?` | Speaker notes (exported as PowerPoint notes) |
| view | `CapturedViewState` | `{ capturedIn: '2d' \| '3d'; extent?; camera?; rotation? }`. Screen-only slides have neither `extent` nor `camera` |
| visibleLayers | `Record<string, boolean>` | Layer id (the `LAYER_NAMES` values plus `milSymbols`) to visible |
| graphicVisibility | `Record<string, boolean>?` | Exceptions only: graphic `attributes.id` to `false` for graphics hidden at capture |
| builds | `BuildStep[]?` | Staged-reveal steps |
| buildMode | `'auto' \| 'click'?` | Absent means `auto` |
| transitionMs | `number` | `goTo` duration entering the slide |
| slideTransition | `'fade' \| 'pushLeft' \| 'pushRight' \| 'wipe'?` | Played only between two screen-only slides |
| hidden | `boolean?` | Skipped by stepping (PowerPoint "Hide Slide") |
| noChrome | `boolean?` | Suppress deck headers/footers on this slide |
| section | `string?` | PowerPoint section name |
| overlays | `SlideOverlay[]?` | Editor annotations (text, shapes, images, tables, charts, milsym, and more), coordinates normalised to 0..1 |
| comments | `SlideComment[]?` | Review threads (editor only, never rendered in present mode) |
| thumbnailDataUrl | `string?` | Lazy thumbnail |
| backgroundDataUrl | `string?` | Full-resolution capture used as editor background and as the slide image of screen-only slides |

`BuildStep`: `{ graphicId: string; effect: 'appear' \| 'fade' \| 'flyIn' \| 'drawOn'; delayMs: number; durationMs: number; flyFrom?: { dx: number; dy: number }; trigger?: 'click' \| 'withPrev' \| 'afterPrev' }`. `graphicId` is `graphic.attributes.id`. `flyFrom` is a map-units offset. In `auto` build mode every step runs on one shared clock at its absolute `delayMs`; in `click` mode steps are grouped by `trigger` and each group waits for the presenter to advance.

`SlideOverlay` (`kind`: `text`, `image`, `table`, `rect`, `ellipse`, `diamond`, `triangle`, `star`, `callout`, `blockArrow`, `blockArrowDouble`, `chevron`, `line`, `arrow`, `tacArrow`, `freehand`, `highlight`, `milsym`, `chart`) has many optional style fields. Consult `BriefingTypes.d.ts` for the full list rather than relying on this summary.

`BriefingDocument`: `{ version: 1..12; slides: Slide[]; chrome?: DeckChrome }`. `exportBriefing()` writes `version: 12`; `importBriefing()` accepts 1 to 12.

`DeckChrome` (all optional): `enabled`, `classification`, `headerText`, `footerText`, `slideNumbers`, `numberFormat` (`'n'` or `'n-of-m'`), `skipFirst`. Header and footer text supports `{DTG}`, `{DATE}`, `{TITLE}`, `{SLIDE}`, `{SECTION}`, `{PAGE}`, `{PAGES}`, `{COMPANY}`, `{AUTHOR}`, `{SUBJECT}`.

### 1.2 Lifecycle and slide capture

| Method | Description |
| --- | --- |
| `### captureSlide(title?: string): Slide \| null` | Snapshot the current view (2D extent and rotation, or 3D camera), layer visibility and hidden-graphic exceptions into a new slide appended to the deck and made current. Default title `Slide <n>`. `transitionMs` comes from `briefing.defaultTransitionMs` (fallback 1000). Thumbnail and background raster are attached asynchronously. Returns `null` if there is no view or the engine is disabled. |
| `addBlankSlide(title?: string): Slide \| null` | Append an empty screen-only slide with a white 1280x720 background. Use the editor to add content. |
| `captureIntoSlide(ref?: number \| string): Slide \| null` | Re-shoot the current map into an existing slide (index or slide id; default current). Keeps title, notes, overlays and builds; turns a screen-only slide into a map slide. With no valid target it behaves like `captureSlide()`. |
| `getSlides(): readonly Slide[]` | The live slide array (do not mutate directly). |
| `currentIndex: number` (getter) | Current slide index, `-1` before any slide is shown. |
| `removeSlide(ref)`, `renameSlide(ref, title)`, `setSlideNotes(ref, notes)` | Edit a slide. `ref` is an index or a slide id. Invalid refs are ignored. |
| `moveSlide(from, to: number)` | Reorder; the current-slide marker follows the slide. |
| `duplicateSlide(ref): Slide \| null` | Deep copy inserted after the original, with a new id and a `(copy)` suffix. |
| `setSlideHidden(ref, hidden?: boolean)`, `toggleSlideHidden(ref)` | Hide a slide from stepping (still reachable by index). |
| `setSlideSection(ref, section?: string)`, `getSections(): string[]` | PowerPoint section name; empty removes it. |
| `setSlideTransition(ref, type?: SlideTransitionType)` | Transition for screen-only slide pairs. |
| `getChrome()`, `getResolvedChrome()`, `setChrome(patch: Partial<DeckChrome>)`, `toggleSlideNoChrome(ref)` | Deck headers and footers. `getChrome()` returns only what was set; `getResolvedChrome()` overlays it on the `exportTools.*` defaults. In `setChrome`, `undefined` is ignored and `''` or `null` clears a field back to the default. |
| `addChartOverlay(spec: ChartSpec, ref?, box?): Promise<SlideOverlay \| null>` | Add a native-exportable chart to a slide (default current). `box` is `{ x, y, w, h }` in 0..1, default `{ x: 0.08, y: 0.16, w: 0.42, h: 0.4 }`. `ChartSpec` is `{ type, labels, series, title?, showLegend?, ... }` with `type` one of `bar`, `barStacked`, `barHorizontal`, `line`, `area`, `pie`, `doughnut`, `scatter`, `radar`. |
| `listComments()` | Every review comment flattened as `{ slideIndex, slideId, id, anchor, author, at, text, resolved, replies }`. |
| `firstVisibleIndex()`, `lastVisibleIndex()`, `nextVisibleIndex(from, dir: 1 \| -1)` | Index helpers that skip hidden slides; `-1` means none. |

```ts
const be = symbolEngine.briefingEngine!;
be.captureSlide('Phase 1 - crossing');
be.addBuildStep(0, { graphicId: someGraphic.attributes.id, effect: 'fade', durationMs: 1200 });
be.setSlideNotes(0, 'Talk to the bridging plan here');
```

### 1.3 Builds

| Method | Description |
| --- | --- |
| `addBuildStep(ref, step: Partial<BuildStep> & { graphicId: string }): BuildStep \| null` | Append a step. Defaults: `effect` from `briefing.defaultEffect` (else `'appear'`), `delayMs` 0, `durationMs` 800. Returns `null` for an invalid slide or missing `graphicId`. |
| `clearBuildSteps(ref)` | Remove all steps from the slide. |
| `setSlideBuildMode(ref, mode?: 'auto' \| 'click')` | `'click'` enables step-through builds; any other value resets to `auto`. |

Effects: `appear` shows the graphic at once; `fade` animates through a temporary layer's opacity (graphics have no per-graphic opacity); `flyIn` animates from the `flyFrom` offset; `drawOn` reveals a line or area progressively. A step with `durationMs <= 0`, or a missing `TweenMax`, shows the graphic instantly. A step whose graphic id is not found is skipped.

### 1.4 Playback

| Method | Description |
| --- | --- |
| `goToSlide(index: number): Promise<void>` | Fly to the slide (`view.goTo` with `easing: 'ease-in-out'`, `duration: slide.transitionMs`), apply its layer and graphic visibility, then run its builds. Ignored while a previous transition is in flight, or for an out-of-range index. |
| `nextSlide(): Promise<void>`, `prevSlide(): Promise<void>` | Step over hidden slides. While presenting, one call is one presenter advance, so a click-mode slide reveals its next build group first. |
| `enterPresent()`, `exitPresent()`, `togglePresent()`, `isPresenting(): boolean` | Full-screen slideshow. `exitPresent()` is idempotent and is also called on view switch, disable and destroy. |
| `togglePresenterPanel(open?: boolean)` | Presenter view: notes, timer, next-slide preview, jump grid; can be popped out to a second screen. |
| `startAutoplay(intervalMs?: number)`, `stopAutoplay()`, `isAutoplaying(): boolean` | Timed advance. Interval defaults to `briefing.autoplayIntervalMs`; `briefing.autoplayLoop` restarts from the first slide at the end. |
| `openPanel()`, `closePanel()`, `togglePanel()` | The slide-strip panel (`#briefingPanel`). |
| `openSorter()`, `closeSorter()`, `toggleSorter()` | Drag-and-drop slide sorter overlay. |
| `openSlideEditor(ref: number \| string): Promise<void>` | Open the slide editor on a slide. Closes present mode and the sorter first; resolves when the editor has opened. Loads the editor module on first use. |
| `applySlideForExport(index, revealedBuilds?): Promise<Slide \| null>` | Headless jump (no animation) used by the PowerPoint exporter. `revealedBuilds` leaves the first N steps revealed; omit for the fully built state. |

Present-mode keys (from `PresentSession`): Right, Space, PageDown, Enter next; Left, PageUp, Backspace previous; Home and End first and last visible; digits then Enter jump to a slide number; `B` and `W` black and white screen; `G` slide grid; `N` presenter panel; `L` laser, `P` pen, `S` spotlight (`[` and `]` resize it), `E` clear ink; `T` reset timer; `A` autoplay; `F` fullscreen; Esc unwinds one layer at a time (grid, jump buffer, tool, blackout) and finally exits. Present mode installs its own `document` keydown listener; it does not route through the shared keyboard manager.

Global shortcuts that are active while the engine is enabled, not typing in a field, not presenting and not in the editor: Ctrl+Shift+S add slide (and open the panel), Ctrl+Shift+B add blank slide, Ctrl+Shift+P toggle the panel.

### 1.5 Save and load

| Method | Description |
| --- | --- |
| `exportBriefing(): BriefingDocument` | Shallow copy of the slides plus `chrome` when set. `version: 12`. Includes each slide's `thumbnailDataUrl` and `backgroundDataUrl`, which can be large; strip them if you store many briefings. |
| `importBriefing(doc: BriefingDocument \| null \| undefined): void` | Replace the deck. Logs an error and returns if `doc.slides` is not an array. Cancels running builds, normalises chrome, resets the current index to `-1`, prunes links that point at missing slides, opens the panel. Does not validate slides individually. |
| `saveBriefingToFile(filename?: string)` | Download as `pams8_briefing_<Date.now()>.json`. |
| `loadBriefingFromFile()` | File picker, then `importBriefing`. |
| `importPptxFromFile()` | File picker for `.pptx`; slides are appended (not replaced) as screen-only slides. See [07](07-import-export.md), section 7. Requires an enabled engine. |

PowerPoint export is `window.exportPptxDeck(options?)`, documented in [07](07-import-export.md), section 6.

### 1.6 Slide editor

`SlideEditor` (`Briefing/SlideEditor.ts`, singleton via `SlideEditor.getInstance()`) is the in-app, PowerPoint-style annotation editor: text, shapes, arrows, tactical arrows, freehand, tables, charts, images, MIL-STD symbols (`milsym` overlays), links, layouts, review comments and deck setup. It is a full-screen UI. Hosts open it with `BriefingEngine.openSlideEditor()` and interact through `getSlides()` afterwards. The public methods `isOpen()`, `editingIndex`, `insertOverlays(overlays)`, `open(host, index)`, `close(save)`, `refreshChrome()`, `refreshRail()` exist, but `open` takes a `SlideEditorHost` callback object that `BriefingEngine` supplies. Embedding the editor with your own host is not covered here; `SlideEditorHost` is exported as a type from `SlideEditor.ts` if you need it.

Built-in slide layouts (`SlideLayouts.ts`): `title`, `title-content`, `two-col`, `section`, `title-only`, `comparison`, `quad`, `chart`, `table`, `opord`, `blank`.

Ctrl+K palette actions from `ChartCommands.ts`: `briefing.chart.blank` (insert chart on slide), `briefing.chart.posdef`, `briefing.chart.oprank`, `briefing.chart.oprank.breakdown` (charts built from the Position Defensibility and OP Ranker analysis results, see [11](11-analysis-engines.md)).

### 1.7 Briefing settings

`Settings.json` `briefing` block (also editable in the Briefing settings widget, see [08](08-settings.md)):

| Key | Default | Meaning |
| --- | --- | --- |
| `defaultTransitionMs` | `1000` | Default `goTo` duration; stored per slide at capture |
| `defaultEffect` | `"appear"` | Effect for build steps added without one |
| `autoplayIntervalMs` | `5000` | Delay between slides in autoplay |
| `autoplayLoop` | `false` | Restart from the first slide instead of stopping |
| `fullscreen` | `true` | Request browser fullscreen on present start; leaving fullscreen ends the slideshow |
| `presenterPanel` | `false` | Open the presenter view when the slideshow starts |
| `controlsIdleMs` | `2500` | Idle time before the control bar, counter and cursor fade |
| `penColor` | `"#ff2d2d"` | Present-mode pen colour |
| `penWidth` | `0.0024` | Pen width as a fraction of view height |
| `spotlightRadius` | `0.12` | Spotlight size as a fraction of the view's smaller side |

Export-related keys live under `exportTools` (see [07](07-import-export.md)).

---

## 2. Collaboration

Source: `MS/Engines/Collab/*`, plus `tools/collabRelay.js` in the repository. Detailed design notes are in `MS/Engines/Collab/README.md`. The older planning document `L-Collaboration-and-Live-Sync.md` describes a WebSocket `SyncEngine` that was never built; it does not describe the shipped engine. The shipped engine is `CollabEngine` over SSE plus POST (or BroadcastChannel).

What it shares, at a glance: symbol create, move, edit and delete; slide and in-slide object edits; who is briefing (the podium) and the briefer's slide, build step, laser, pen and spotlight; cursors, trails, in-progress drawing previews, "look here" pings, peer viewports, chat, and soft object locks. The map view itself is shared only with `collab.syncView`. Undo history is not shared.

### 2.1 Enabling

1. Set `features.collab: true` (default `false`), or call `symbolEngine.collabEngine.enable()` after the engine has loaded. Setting the flag to true at runtime lazily loads the engine and joins the room.
2. Choose a transport and room (section 2.3).
3. Run a relay if you use the `sse` transport (section 2.4).

The room is resolved most-specific first: `?room=<name>` in the page URL, then the last room used in this browser profile (`localStorage`), then `collab.room`. The user name follows `collab.userName`, else the remembered name, else an auto-generated one. The client id is stored per browser tab (`sessionStorage`), so two windows of one browser are two people. Do not use "Duplicate tab" to test: it copies `sessionStorage` and both tabs share one id.

### 2.2 CollabEngine API

Singleton: `CollabEngine.getInstance()`; use `symbolEngine.collabEngine` (type `CollabEngine | undefined`) or `window.collabEngine`.

| Member | Description |
| --- | --- |
| `start(host: unknown): void` | Bind to the host (`SymbolEngine`) without connecting; subscribes to the settings bus. Called by `SymbolEngine`. |
| `enable(): void` | Join the room and start all sync components. Logs an error and does nothing if the view does not exist yet. No-op if already enabled. |
| `disable(): void` | Leave the room and tear everything down. Hands back the podium if held. |
| `destroy(): void` | `disable()` plus unsubscribing from settings. |
| `isEnabled: boolean` | Getter. |
| `status: 'connecting' \| 'open' \| 'closed' \| 'error'` | Getter; `'closed'` when disabled. |
| `roster: CollabUser[]` | Getter: yourself first, then peers. `CollabUser` is `{ id: string; name: string; color: string }` (`color` is `#rrggbb`, derived from the client id). |
| `setUserName(name: string): void` | Change your display name; remembered per browser profile. |
| `resync(): void` | Ask the room for its state again. Merge-only: recovers missing objects, not stale local copies. Logs an error if not connected. |
| `pingHere(): void` | Drop a "look here" marker at the centre of your view. |
| `armPing(): void` | The next map click drops the marker. |
| `takePodium()`, `releasePodium(): void` | Start or stop briefing the room. Requires the Briefing engine and `collab.sharePresentation`. |
| `sendChat(text: string): void` | Post a chat line (whitespace collapsed, 500 characters max). |
| `chat: CollabChat \| null` | Getter. `CollabChat` has `send(raw)`, `history()`, `unread`, `isOpen`, `open()`, `close()`, `toggle()`. |
| `presentSync: PresentSync \| null` | Getter. Members: `briefer`, `isBriefer`, `detached`, `brieferActive`, `takePodium()`, `releasePodium()`, `togglePodium()`, `rejoin()`, `joinPresentation()`, `onChange(cb)`. |
| `viewSync: ViewSync \| null` | Getter. Members: `isSyncing`, `following`, `toggleSync()`, `follow(id: string \| null)`, `onChange(cb)`. |
| `session: CollabSession \| null` | Getter: transport, roster and message bus. Lower-level; `session.send(type, data)` and `session.on(type, handler)` exist but the message types are internal (protocol v2). |
| `onViewChanged(view)` | Re-attach overlays to a new view. Called by `SymbolEngine` on 2D and 3D switch. |
| `diagnose(): Record<string, unknown>` | One-shot health report: status, transport, room, peers, protocol-incompatible peers, which syncs are active, and a hint. Use it first when two clients do not see each other. |

`window.collabDebug(true)` (or `collab.debug: true`) turns on per-message console tracing.

```ts
const ce = symbolEngine.collabEngine;
if (ce && !ce.isEnabled) ce.enable();
console.table(ce?.roster);
console.log(ce?.diagnose());
```

The engine wraps `SymbolEngine`, `EditEngine`, `MorphixEngine`, `BriefingEngine` and `SlideEditor` at runtime from inside the `Collab` folder and restores them on teardown. Graphics are matched by `attributes.id`, and the engine swaps `Graphic` instances by id, so host code should look graphics up by id rather than holding object references across collaboration updates.

### 2.3 Settings

`Settings.json` `collab` block (defaults shown; changing `room`, `transport`, `relayUrl` or `token` while enabled reconnects transparently; the others apply in place):

| Key | Default | Meaning |
| --- | --- | --- |
| `transport` | `"sse"` | `"sse"`: SSE downstream plus POST upstream to a relay. `"broadcast"`: `BroadcastChannel` between windows of one browser, no server |
| `relayUrl` | `""` | Relay base URL. Blank means the same origin as the page. The client requests `<relayUrl>/collab/stream` and `<relayUrl>/collab/send` |
| `room` | `"default"` | Room name |
| `userName` | `""` | Display name (blank means auto or remembered) |
| `token` | `""` | Shared secret, sent as query parameter `t`; must match the relay's `COLLAB_TOKEN` |
| `showRoster` | `true` | Show the collaboration rail |
| `syncMap` | `true` | Share symbol create, move, edit, delete |
| `syncSlides` | `true` | Share slides and in-slide edits (needs the Briefing engine) |
| `syncView` | `false` | Shared pan and zoom |
| `sharePresentation` | `true` | Podium, slide position, build step |
| `shareInk` | `true` | Share the briefer's laser, pen and spotlight |
| `slideImageMaxKb` | `256` | Slide thumbnails larger than this are dropped when sending; `0` never sends thumbnails |
| `showCursors`, `showTrails`, `trailLength` | `true`, `true`, `8` | Peer cursors and fading trails |
| `showPreviews` | `true` | Peers' unfinished shapes as dashed ghosts |
| `showPings` | `true` | Draw peers' "look here" markers |
| `shareViewport`, `showViewports` | `true`, `false` | Broadcast your extent (about 1 Hz); outline peers' extents |
| `chat` | `true` | Room chat |
| `activityLog` | `true` | Who-did-what lines in the Engine Log |
| `cursorHz` | `20` | Pointer broadcast rate |
| `locks`, `showLocks`, `lockTtlMs` | `true`, `true`, `10000` | Soft per-object locks and their expiry |
| `debug` | `false` | Console tracing |

Behavior that matters to hosts:

- The wire protocol is version 2 (`PROTOCOL_VERSION`). Clients on another version ignore each other and show a warning badge on the rail. In practice this is a stale browser tab after a rebuild; reload it.
- Conflict handling: the newest hybrid-logical-clock stamp wins per object; locks are advisory and expire.
- Late joiners get a snapshot from one peer (lowest client id first, retried up to three peers). Snapshots never overwrite local work: graphics merge by id, and a deck is accepted only if the joiner has no slides.
- Slide capture images (`backgroundDataUrl`) are never transmitted; a shared slide arrives with its annotations and falls back to the live map.
- Failed persistent POSTs are queued (200 max, oldest dropped) and replayed with 0.5 to 4 s backoff. Ephemeral traffic (cursors, previews, chat) is not retried.
- A room holds at most 16 clients; the 17th receives HTTP 503 from the relay.

### 2.4 The relay

The relay is build-time tooling and is not part of `dist/MS`. It is a single dependency-free Node file, `tools/collabRelay.js` (ES module using `node:http`; the repository `package.json` has `"type": "module"`). It stores nothing and never inspects a message; it forwards each message to the other clients in the same room. State lives only in memory and is lost on restart, which costs nothing because clients reconnect and catch up from a peer.

A host that receives only `dist/MS` must obtain `tools/collabRelay.js` from the PAMS8 repository (or write an equivalent; the protocol is in the endpoint table below) and run it or mount it.

Three ways to run it:

| Mode | How | Client setting |
| --- | --- | --- |
| Vite dev server (this repository only) | `npm run dev` mounts the relay through `collabRelayPlugin` in `vite.config.ts`, at `/collab/*` on the dev server (port 6547). `vite preview` is covered too. | `relayUrl: ""` |
| Standalone process | `node tools/collabRelay.js --port 6600` (repository script: `npm run relay`). Binds `0.0.0.0`; default port 6600. | `relayUrl: "http://<host>:6600"` |
| Mounted in your own Node server | `import { createCollabRelay } from './tools/collabRelay.js'; app.use(createCollabRelay({ basePath: '/collab', token: '...' }))`. It is Connect-style `(req, res, next)` middleware, and requests outside `basePath` are passed to `next()`. | `relayUrl: ""` if same origin, else the absolute URL |

`createCollabRelay(options?)` options: `basePath` (default `/collab`; trailing slashes are stripped) and `token` (default: environment variable `COLLAB_TOKEN`, else none). The file also exports `collabRelayPlugin(options?)` for Vite.

Behind a reverse proxy, disable response buffering for the `/collab/stream` route (the relay sets `X-Accel-Buffering: no`, which nginx honours) and allow long-lived connections. The relay sends an SSE comment every 20 s as a keepalive.

Endpoints (all under `basePath`):

| Endpoint | Purpose |
| --- | --- |
| `GET /collab/stream?room=<r>&client=<id>[&t=<token>]` | SSE downstream, one connection per client. Returns 400 without `client`, 503 when the room has 16 clients. A reconnect with the same client id replaces the old stream. |
| `POST /collab/send?room=<r>&client=<id>[&t=<token>]` | JSON message or array of messages, up to 8 MB (413 above that). A message carrying `to` is delivered only to that client; everything else goes to all other clients in the room. Response: `{ ok: true, delivered: n }`. |
| `GET /collab/health` | `{ ok, rooms, clients, auth: 'token' \| 'open' }`. Always open, even when a token is set. |

`room` defaults to `default` when omitted. Any other path under the base returns 404. CORS is fully open (`Access-Control-Allow-Origin: *`), so a separately hosted relay works without configuration.

Trust model: by default the relay is unauthenticated. Anyone who can reach it can join any room, read every operation and send under any client id, because it does not verify the `client` parameter. That is designed for an isolated network. Setting `collab.token` on every client and `COLLAB_TOKEN` (or the `token` option) on the relay rejects everything else with 401. The token travels in the query string, so treat it as a deterrent and not as a security boundary; use TLS and network controls for anything stronger. Payload contents are validated on arrival by the client (shape checks, name and colour sanitising, prototype-safe copying).

Verify a relay:

```bash
curl http://localhost:6547/collab/health      # Vite dev
curl http://<host>:6600/collab/health         # standalone
```

### 2.5 Try it without a server

`features.collab: true`, `collab.transport: "broadcast"`, then open the app in two windows of the same browser (new window or tab; not "Duplicate tab"). No relay is needed. `BroadcastChannel` name is `pams8-collab-<room>`.

---

## 3. Stylus

Source: `MS/Engines/Stylus/StylusDrawController.ts`, `PremiumStylus.ts`, `OneEuroFilter.ts`, and `StylusSettingsManifest.ts` / `StylusSettingsWidget.ts`.

The stylus layer is internal to `SymbolEngine`, which owns one `StylusDrawController`. It has no host-facing methods; hosts configure it through the `stylus` settings. It applies to line and area symbols (`SymGeoType` of `Line` or `Area`) only. Point symbols keep the classic path.

How it works: with pen or touch input, `SymbolEngine.initialize()` skips the symbol's mouse-oriented interactive `init()` and hands the symbol to the controller. The controller captures a gesture, reduces it to control points, then calls the symbol's normal immediate-placement path, so a completed symbol emits `onDrawEnd` like any other. See [03](03-drawing-and-events.md).

`stylus.mode`:

| Value | Behavior |
| --- | --- |
| `"auto"` (default) | Engage when the last pointer that touched the view was a pen or touch |
| `"on"` | Engage for every input, mouse included |
| `"off"` | Classic click and double-click drawing |

`stylus.paradigm` (global default) and `stylus.perSymbol` (map of symbol `Class` name to paradigm; overrides the default):

| Paradigm | Behavior |
| --- | --- |
| `native` | Drives the symbol's own interactive drawing (real symbol as the live preview); tap per vertex; finish with the toolbar, Enter or double-tap |
| `freehand` (default) | Press, drag, lift; the stroke is simplified to control points; generic dashed preview |
| `tap` | Tap each vertex, then Finish (optional toolbar) |
| `scrub` | Freehand gesture with the real symbol as live preview |

Other keys (defaults from `Settings.json`):

| Key | Default | Meaning |
| --- | --- | --- |
| `freehand.simplifyTolerancePx` | `4` | Douglas-Peucker tolerance for stroke reduction |
| `tap.tapTolerancePx` | `6` | Max drift for a tap to count as a vertex rather than a pan |
| `tap.showFinishToolbar` | `true` | Floating Finish / Undo / Cancel toolbar in tap mode |
| `scrub.detail` | `"balanced"` | `smooth`, `balanced`, `fine` or `custom` |
| `scrub.tolerancePx` | `6` | Used when detail is `custom` |
| `native.tapFallbackMs` | `400` | Commit a vertex if a tablet never emits a click for a tap; `0` disables |
| `premium.enabled` | `true` | Master switch for the premium layer (native paradigm only) |
| `premium.cursor.*` | enabled, size 22, colours | Glide cursor that follows the pen |
| `premium.smoothing.*` | enabled, `minCutoff` 1.0, `beta` 0.02, `dCutoff` 1.0 | 1-euro filter smoothing |
| `premium.snap.*` | enabled, `pullPx` 24 | Snap the cursor to features |
| `premium.palmReject`, `palmWindowMs`, `palmSizePx` | `true`, `1200`, `45` | Palm rejection |
| `premium.finish.dwellMs` | `0` | Dwell-to-finish; `0` is off |
| `premium.precision.*` | disabled by default | Snap commit, angle lock (45 deg, 8 deg threshold) and length lock (1 km) |
| `premium.freehandStroke`, `premium.ink.pressure` | `false`, `false` | Freehand stroke and pressure options |

`stylus.debug: true` or `window.__stylusDebug = true` traces the pointer flow into the Engine Log; the `debug` key is not in the default `Settings.json`. Changes go through the settings bus (see [08](08-settings.md)). The controller's `isEngaged`, `finish()` and `cancel()` are reached internally by the keyboard manager (Enter and Escape routing).

---

## 4. ScreenAnchorEngine (Pin to Screen)

Source: `MS/Engines/ScreenAnchorEngine.ts`. Keeps a graphic at a fixed screen position while the map moves underneath. Opt-in: `features.screenAnchor: true`.

Pinning is offered for freehand-family graphics only: classes whose name starts with `Freehand` or `AutoShape`, and `TacticalPointText` / `TacticalPointTextBox`. Users pin from the right-click menu ("Pin to Screen"); the engine registers that item when it starts. A pin stores the anchor as fractions of the view size (`xPct`, `yPct`) on `graphic.attributes` (`pinned`, `xPct`, `yPct`); an extent watch re-translates the geometry (debounced about 16 ms). In 2D it is exact, including rotation. In 3D, re-anchoring pauses while the camera is tilted and any point that cannot be projected is skipped.

| Method | Description |
| --- | --- |
| `pinGraphic(graphic: Graphic): void` | Pin at the graphic's current on-screen position. Needs `graphic.attributes.id`. Logs an error and does nothing if the graphic is off-screen. |
| `unpinGraphic(graphic: Graphic): void` | Remove the pin; the graphic keeps its current geometry. |
| `registerSavedPin(graphic: Graphic): void` | Re-register a pin restored by a loader (attributes already set). Called by `SymbolEngine` when loading a symbol JSON item with `pinned`, `xPct`, `yPct`. |
| `pinCount: number` | Getter. |

Persistence: `SerializationEngine` round-trips pins (`pinned`, `xPct`, `yPct` in symbol JSON; `PINNED`, `PIN_X_PCT`, `PIN_Y_PCT` in plan `drawEss`). Pinned graphics are left out of GeoJSON export. See [07](07-import-export.md) for which load paths restore pins.

---

## 5. RouteProfileEngine (elevation profile)

Source: `MS/Engines/RouteProfileEngine.ts`. Not a singleton and not loaded lazily: `SymbolEngine` creates one instance with `new RouteProfileEngine(() => this.view)`. It has no feature flag, no settings and no built-in menu entry; a host calls it through `SymbolEngine`.

### showRouteProfile(input: Graphic | Polyline | Polygon): Promise<void>

Samples terrain elevation along a route and shows a distance-versus-elevation chart in a floating panel (id `routeProfilePanel`). Steep segments are highlighted, and hovering the chart moves a marker on the map.

| Name | Type | Default | Meaning |
| --- | --- | --- | --- |
| input | `Graphic \| Polyline \| Polygon` | required | A polyline (or a graphic with one) is profiled as is. For a polygon the outer boundary (first ring) is profiled as a route. |

Behavior and limits (from source):

- Resolves without a profile, after a log line, if the geometry is not a polyline or polygon, has zero geodesic length, no elevation source is available on the active view, or fewer than two samples result.
- Sample spacing is `max(length / 200, 5 m)`, so at most about 200 samples; the route is geodesically densified first.
- Slopes at or above 25 percent (absolute) are flagged as obstacles.
- Statistics: length, minimum and maximum elevation, total ascent and descent, maximum absolute slope.
- Works wherever an ArcGIS elevation sampler exists: always in a 3D `SceneView`; in a 2D `MapView` only when the map has a ground elevation layer.

### clearRouteProfile(): void

Removes the panel and the hover marker.

```ts
// routeGraphic: any polyline graphic you already hold, for example a Line symbol
await symbolEngine.showRouteProfile(routeGraphic);
// later
symbolEngine.clearRouteProfile();
```

---

## 6. Command entry points (Combat Power, Airspace, Landing Zone)

Three small modules register a single Ctrl+K palette action each and a `window` global. They are side-effect imports of `SymbolEngine.ts`, so they are available once the library is loaded.

| Module | Palette id | Global | What it does |
| --- | --- | --- | --- |
| `Planning/CombatPowerCommand.ts` | `combatPower.open` | `window.openCombatPower()` | Opens the Combat Power panel for `window.symbolEngine.view` |
| `AirspaceCommands.ts` | `airspace.open` | `window.openAirspaceEngine()` | Calls `symbolEngine.airspaceEngine?.openWidget(symbolEngine.view)` |
| `LandingZoneCommands.ts` | `landingZone.open` | `window.openLandingZonePlanner()` | Calls `symbolEngine.landingZoneEngine?.openWidget(symbolEngine.view)` |

The Airspace and Landing Zone globals do nothing when the corresponding engine is `null` (analysis flags `analysis.airspace` / `analysis.landingZone` off). The engines themselves are described in [11](11-analysis-engines.md). All three globals read `window.symbolEngine`; hosts that do not assign the engine to that global should call the engine methods directly.

### CombatPowerEngine

`Planning/CombatPowerEngine.ts`, singleton via `CombatPowerEngine.getInstance()`. Sums a relative combat-power value for unit and equipment symbols on the `FORCE` layer and the legacy `milSymbols` layer (tactical graphics are excluded), grouped by affiliation, and reports a friendly-to-hostile ratio. Values are an estimate: each symbol counts by its SIDC echelon weight (a symbol with no echelon counts 1). Affiliation comes from SIDC digits 3 and 4 (`02`, `03` friendly; `05`, `06` hostile; `04` neutral; others unknown).

| Method | Description |
| --- | --- |
| `compute(view: MapView \| SceneView): CombatPowerResult` | Pure read of the view's layers. Result: `friendly`, `hostile`, `neutral`, `unknown` (each `{ totalValue, unitCount, byEchelon }`), `ratio` (`number \| null`, null when there is no hostile force), `posture`, `verdict`. |
| `generateReport(view): string` | Multi-line plain-text summary of `compute()`. |
| `open(view): void` | Show the panel, compute, and recompute when unit symbols are added, removed or re-affiliated. Logs an error if `view` is falsy. |
| `close(): void` | Hide the panel and stop watching. |
| `destroy(): void` | Remove the panel. |

Postures by ratio: 3 or more "Deliberate attack", 2 to under 3 "Hasty attack", 1 to under 2 "Near parity", under 1 "Outnumbered"; "Uncontested" with no hostile force; "No forces" with no units. These are planning aids, not doctrine.

---

## 7. Metadata and annotation helpers

### SymbolMetadataService

`MS/Engines/SymbolMetadataService.ts`. Stateless static helpers over `Symbols.json` and SIDC parsing. `SymbolEngine` keeps thin delegates, which are the intended host entry points:

| `SymbolEngine` method | Delegates to | Description |
| --- | --- | --- |
| `getSymbolData(): any` | `SymbolMetadataService.getData()` | The whole `Symbols.json` catalogue |
| `getSymbolByKey(key: string): any` | `getByKey(key)` | One entry, or `null` |
| `getSymbolNamesForAutocomplete(): Array<{ key: string; name: string }>` | `getNamesForAutocomplete(includeAutoShapes)` | Flat `{ key, name }` list. Auto Shapes (`isAutoShape === '1'`) are included unless `features.autoShapes` is `false` |
| `enrichSymbolOptions(options)` | `enrich(options)` | Adds `parsedSIDC`, `label` and `text` to an options object that has `sidc`. If `sidc` is missing or invalid it logs a console warning and returns the input unchanged |

Catalogue contents and keys are covered in [13](13-symbol-catalog.md).

### AnnotationEngine

`MS/Engines/AnnotationEngine.ts` is a class of static helpers that the symbol classes call to create text labels on the annotation layer (`LAYER_NAMES.ANNOTATION_LAYER`) from a symbol's amplifier text and label options. Public statics are `annotate(...)`, `deAnnotate(textLayer, parentId)` and `getAnnotationLayer(layerManager)`. It is called during drawing, loading and editing, not by hosts. Label style comes from `labelOptions` (`color`, `haloColor`, `haloColorSize`, `textSize`, `bold`, `italic`, `uLine`, `oLine`, `tLine`, `fontFamily`) and the global text-style settings. UEI symbols (those with a `UEI` field in draw essentials) are skipped by `annotate`. Labels are linked to their symbol by `parentId` and are not saved in plan or symbol files; they are regenerated when the symbol is loaded. Use [05 Editing and Morphix](05-editing-morphix.md) to change label text on an existing symbol.
