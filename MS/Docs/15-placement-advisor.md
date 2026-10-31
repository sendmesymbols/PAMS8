# 15 · Placement Advisor (deployable-terrain check)

Optional engine that tells the user, **while they draw**, whether the symbol is
on deployable land, near a no-go area (and how far), partly inside one, or
inside one. It is gated by `features.placementAdvisor` and needs a
**terrain bundle** — a folder of static tiles produced by the data pipeline in
`tools/terrain-pipeline/` and served by the host app from any plain web server.
With no bundle configured the engine is dormant and existing hosts are unaffected.

**Where the bundle lives.** The pipeline writes it to `MS/Data/terrain-bundle/` (git-ignored, several GB).
`npm run dev` serves that folder at `/terrain-bundle`, so the default `placement.bundleUrl` works in the
harness with nothing to copy. A host app copies the folder to wherever it serves static files and sets
`placement.bundleUrl` to that URL.

```
HOST SERVER  /terrain-bundle/ (static files)      BROWSER
  manifest.json  rules.json                        TileLoader  (fetch + decode, pan/zoom only)
  class/{z}/{x}/{y}.png                                 |
  dist_<profile>/{z}/{x}/{y}.png                   TileCache   (LRU of Uint8Array tiles)
                                                       |  synchronous read  <- every mouse move
                                                  PlacementAdvisor
                                                    ProfileResolver  SIDC -> mobility profile
                                                    Sampler          geometry -> class, distance
                                                    Evaluator        samples + rules -> verdict
                                                    FeedbackUI       cursor badge + document events
```

The **hot path** (every `onDrawProgress`) never touches the network: it converts
the geometry to pixel indices and reads typed arrays already in memory. Tiles
that are not loaded yet contribute `unknown` samples and are requested in the
background; the **cold path** (view extent change) prefetches the tiles under
the viewport plus a margin.

---

## Public API

```ts
const pa = symbolEngine.placementAdvisor;          // PlacementAdvisor | null

await pa.configure({ bundleUrl: '/terrain-bundle' });   // loads manifest + rules
pa.setOptions({ mode: 'advise', nearThresholdM: 250 });  // see PlacementOptions
pa.enable(); pa.disable();

const v = pa.evaluateGeometry(geometry, sidc);   // synchronous, from cached tiles
// v: { verdict, profile, profileLabel, classCode, className, distanceM, fraction, samples, unknown,
//      message,   <- headline: what is wrong and why
//      detail,    <- second line: what it means for this unit type / what is nearby
//      nearest }  <- { kind, classCode, className, distanceM, bearingDeg, compass } or null

pa.sampleAt(point)        // { classCode, distanceM | null } for the active profile
pa.resolveProfile(sidc)   // 'dismounted' | 'wheeled' | 'tracked' | 'vessel' | 'generic' | 'exempt'
pa.getManifest()          // bundle manifest or null
```

### Verdicts

| verdict   | meaning |
|-----------|---------|
| `ok`      | every sample is on deployable terrain and farther than `nearThresholdM` from no-go |
| `near`    | deployable, but the nearest no-go pixel is within `nearThresholdM` (`distanceM` given); also a line/area whose share in no-go is below `partialFraction` ("touches no-go", `distanceM` = 0) |
| `caution` | on a "conditional" class for this profile (e.g. steep slope for wheeled) |
| `partial` | line/area: a share of samples (`fraction` ≥ `partialFraction`) is inside no-go |
| `in`      | point inside no-go, or line/area mostly inside |
| `unknown` | no tile coverage yet (loading, or outside the bundle's area) |
| `exempt`  | the symbol's profile is `exempt` (air, space, SIGINT, cyber …) |
| `off`     | engine disabled or no bundle configured |

### What the advice says

Every verdict explains itself — why, how far, what is near, and which way:

| situation | headline | detail |
|-----------|----------|--------|
| in no-go | `Permanent Water: NO-GO for Dismounted` | `Nearest suitable ground: Bare / desert, 314 m to the E` (or `No suitable ground within 1.1 km`) |
| close to no-go | `Permanent Water 120 m to the W` | `NO-GO for Dismounted` |
| line/area partly in | `Partially in Permanent Water (43%): NO-GO for Dismounted` | |
| touches no-go | `Encroaching on Permanent Water (2%): NO-GO for Wheeled Vehicles` | |
| difficult ground | `SLOW-GO: Built-Up Area` | `SLOW-GO terrain for Wheeled vehicles. Nearest NO-GO: …` |
| suitable | `Suitable: Bare / Desert` | `Nearest NO-GO: Permanent water, 580 m to the W` (or `Clear of NO-GO terrain within 2.5 km`) |

The badge title above the headline uses the same words: *Suitable Position*, *Adjacent to …* /
*Encroaching on …*, *SLOW-GO Terrain*, *Partially Obstructed*, *Unsuitable Position*.

The distance layer only stores *how far* the nearest no-go is, not *what* it is,
so the advisor searches the class tile around the deciding sample (a window of
±32 tile pixels, about ±1 km at the finest level) for the closest pixel of the
opposite kind. It reports that pixel's class and compass direction; the distance
comes from the pipeline's exact layer when it is below the layer cap. Beyond the
window it says so ("No deployable ground within 1.1 km") instead of guessing.
A shape that spans tiles still being fetched is judged on what is known and says
`Still loading terrain data`.

**While tiles load**, the cursor card does not blank out. When the tile under the cursor is missing, the
last real verdict of the draw stays up marked `Still loading terrain data`, provided the cursor is within
80 screen pixels of where that verdict was given (measured on screen between the two map positions, so
panning is accounted for). With nothing close enough to show, the card keeps what it had and waits 200 ms
before saying `Terrain data loading…`, so a tile that arrives in a blink never flashes it. Outside the
bundle's bounds it says how far the nearest data is and which way ("Outside terrain data coverage,
nearest data 42 km NW").

### Echelon footprint

A unit is not a point: it holds **frontage** (width across its front), **depth** (to its rear)
and keeps an **intergap** to the next unit of the same echelon along the front. A land-unit symbol
(symbol set 10) with one of these echelons is therefore judged on the ground it covers, not on
its click point (`placement.footprint.enabled`, on by default). Other echelons (team, squad,
regiment and above) stay a point.

| echelon (SIDC digits 9–10) | frontage | depth | intergap |
|----------------------------|----------|-------|----------|
| Section (13)   | 75–100 m       | none (a line) | 100–150 m |
| Platoon (14)   | 450–600 m      | none (a line) | 300 m |
| Company (15)   | 1200–1500 m    | 600–800 m     | 500 m |
| Battalion (16) | 3000–5000 m    | 2800–3000 m   | 1000–1200 m |
| Brigade (18)   | 10 000–12 000 m | 4000–6000 m  | 3000 m |

The footprint is centred on the symbol and sized in ground metres (converted to Web Mercator with
the cos-latitude factor). "Depth: none" means a line `frontage` long. `footprint.size` picks which
end of each range is used (`min` / `mid` default / `max`, the most cautious). The numbers live in
`PlacementFootprint.ts` (`ECHELON_FOOTPRINTS`) and a bundle's `rules.json` may override any of them:

```json
"echelons": { "14": { "name": "Platoon", "frontageM": [450, 600], "depthM": 0, "gapM": 300 } }
```

A placed symbol has no facing, so `footprint.facing` chooses how the footprint is oriented:

| facing | footprint |
|--------|-----------|
| `fixed` (default) | one rectangle whose frontage runs across `footprint.bearingDeg` (default 0° = north, so the frontage runs east–west) |
| `worst4` | the rectangle at 0°, 45°, 90° and 135°, keeping the worst verdict (a centred rectangle repeats every 180°, so these four cover every orientation in 45° steps) |
| `circle` | orientation-free disc whose diameter is the frontage (depth ignored) |

The footprint is sampled like any shape (edges every tile pixel, interior grid, capped at `maxSamples`),
so the existing rules apply: `fraction` ≥ 0.5 of the footprint in no-go → `in`, ≥ `partialFraction` →
`partial`, a sliver → `near` ("touches"), otherwise distance to no-go decides `near` / `ok`. The detail
line names the footprint: `Platoon footprint 520 m front, facing N`. With `enforce`, `in` and `partial`
therefore refuse a unit whose *footprint* straddles water even if its click point is dry.

`footprint.outline` draws the footprint on the map while placing (blue). It is also in the verdict:

```ts
v.footprint: { code, echelon, frontageM, depthM, gapM, facingDeg | null, facing, ring: [x, y][] } | undefined
```

**Intergap check** (`footprint.spacing`, on by default, advisory only — it never changes the terrain
verdict and `enforce` never refuses on it). The advisor compares the footprint with same-echelon,
same-side (friendly / hostile / neutral) point symbols already on the map (the force, tactical-point,
tactical and legacy layers; the symbol's SIDC decides echelon and side). The gap is the box-to-box
distance between the two footprints (0 when they touch or overlap); below the echelon's minimum
(the low end of its intergap range) the badge adds an amber line — `⚠ Only 120 m from the next
Platoon — keep at least 300 m between them` or `⚠ Overlaps a neighbouring Platoon footprint …` —
and the offending neighbours are outlined in orange. Under `worst4` the tightest of the four facings is
used; under `circle` the gap is centre distance minus the frontage.

```ts
v.spacing: { status: 'ok' | 'tight' | 'overlap', minGapM, nearestGapM | null,
             conflicts: { at, gapM, ring }[], message | null } | undefined
```

The commit stamp (`attributes.placement`) also records `echelon`, `frontageM`, `depthM` and `spacing`.

### Indicator lines

While drawing, a line on the map joins the symbol to the terrain that is the reason
for the advice (`placement.indicators.enabled`, on by default; `labels` writes the
class and distance at the end of the line):

| situation | line | end marker |
|-----------|------|------------|
| symbol too close to no-go (point, or the part of a shape nearest it) | red, dashed, to the nearest no-go edge | red ring |
| symbol inside no-go | **green**, dashed, to the nearest deployable ground (where it could move to) | green diamond |
| line/area partly or mostly in no-go (or touching it) | red, from the cursor to the nearest contested sample | red ring; the stretches of the line / area edge (or footprint outline) in no-go are drawn **solid red on a white casing**, plus red **×** on contested ground inside an area and on single samples too short to draw (at most 16) |
| deployable, caution, unknown | none | |

The edge is walked one tile pixel at a time (at most 1,200 points) and each run through no-go ground is
drawn from half a step before it to half a step after, so the colour stops where the ground does. That shows
where a line or area needs to move, not just how much of it is wrong.

The line has a white casing for contrast on imagery, and the label is placed beyond
the end of the line so it never covers it. The graphics live on one ground-draped
`GraphicsLayer` (`ms-placement-indicators`, `pa.indicatorLayer`) and are created once;
following the cursor only swaps geometry and toggles visibility, the same approach as
`ProximityEngine`, so no graphics are added or removed per move.

The geometry is also in the verdict, so a host can draw its own cue:

```ts
v.indicators: Array<{
  kind: 'no-go' | 'deployable' | 'contested',
  from: [x, y], to: [x, y],      // Web Mercator metres
  marks: [x, y][],               // contested samples of a line/area (decimated)
  stretches?: [x, y][][],        // contested only: runs of the edge that lie in no-go
  classCode, className, label
}>
```

`from` is the symbol for a point, the deciding sample for a shape that is merely close
to no-go, and the cursor (`view.toMap` of the last pointer position, falling back to the
shape's centroid) for a shape that is in no-go. `to` is the edge of the target, found by
the same ±32 px window search that names the nearest class.

### Map overlay

`placement.overlay.enabled` (checkbox "Show terrain on map") paints the bundle on
the map so a planner can see where ground is available before placing anything.
It is a `BaseTileLayer` coloured client-side from the same tiles — no extra data —
and works in 2D and 3D (draped), sitting under the symbol layers.

| colour | meaning (for the chosen profile) |
|--------|----------------------------------|
| green  | Suitable |
| yellow | Marginal: suitable but within `nearThresholdM` of no-go |
| amber  | SLOW-GO |
| red    | NO-GO |
| clear  | no data / outside the bundle |

The same key is shown on the map while the overlay is on: a small card docked bottom-left through the
view's own UI (so it follows 2D / 3D switches), titled with the unit type being painted ("Terrain for
Dismounted") and carrying the current `nearThresholdM` on the marginal row. The labels come from
`OVERLAY_LEGEND`, so a host that renames the verdicts changes the card too.

**Hints.** Nothing shows until a symbol is picked, so the advisor says so once per browser (remembered in
`localStorage` under `ms.placement.hintSeen`): "Placement advisor is on: pick a symbol and terrain advice
follows your cursor." Arming a symbol that is not terrain-bound (air, space, …) shows "This symbol is
not terrain-bound, so it gets no terrain advice." instead of leaving the missing card looking broken.

`placement.overlay.boundary` ("Show official boundary", off by default) also draws the bundle's
`boundary.geojson`: the national outline (green), the provinces (grey), the Line of Control
(red, dashed) and the international borders (black). It is lines only, so it never hides the
terrain colours or your symbols. The file is written by the pipeline and named in
`manifest.boundary.file`; a bundle without one simply has nothing to draw. In the **official**
bundle (the pipeline's default) the whole of Jammu & Kashmir is on Pakistan's side, following the
Survey of Pakistan's *Pakistan Relief Map*, with the Line of Control shown as a line, not a limit;
`manifest.boundary.source` says which boundary built the bundle (`official`, `osm` or `custom`).
The engine draws exactly what the bundle contains and adds no geometry of its own.

`placement.overlay.profile` chooses whose terrain is painted: `dismounted`,
`wheeled`, `tracked`, `vessel` (water is green, land red) or `generic`; `auto`
follows the symbol being drawn and keeps the last one when idle. Below the
bundle's minimum zoom nothing is drawn; above its maximum the finest tile is
over-zoomed. `pa.overlayLayer` exposes the layer. The overlay needs the advisor
enabled and a bundle loaded, but works in any `mode`.

### Tile worker

Fetching and decoding a PNG tile costs about 3 ms of canvas readback and byte
loops, and painting an overlay tile about the same again — enough to saturate the
main thread while panning with the overlay on. With `placement.useWorker` (default
on) that work runs in a Web Worker (`TerrainTileWorker`, bundled inline by Vite so
it needs no extra file on the host and works air-gapped). The worker also keeps its
own small decoded-tile cache so the advisor and the overlay never decode a tile twice.

What moves and what does not:

- **Moves to the worker:** tile fetch + PNG decode (advisor cold path), and the
  whole overlay tile (fetch, decode, paint).
- **Stays on the main thread:** the mouse-move verdict. It reads already-decoded
  typed arrays synchronously; a worker round trip there would add latency.

Measured with a message-channel responsiveness probe on 392 tile decodes / 120
overlay tiles (synthetic bundle): main thread busy **94 % → 31 %** (decode) and
**99 % → 20 %** (overlay paint). Wall-clock time improves only modestly
(about 8–18 %); the gain is that the map stays responsive, not raw throughput.

If a worker cannot start (no `Worker`, a CSP that forbids blob workers) or dies, every
call — including those already in flight — falls back to the main thread with
identical output (verified byte-for-byte), so enabling it cannot lose data.
`pa.tileWorkerActive` tells you which path is live; toggling `useWorker` at runtime
swaps the source without reloading the bundle. The painter
(`PlacementOverlayPaint.ts`) is a pure module shared by the worker and the fallback.

### Modes

- `off` — nothing is sampled.
- `advise` (default) — badge + events; the verdict is stamped on the graphic as
  `attributes.placement = { verdict, profile, classCode, distanceM, fraction }`.
- `enforce` — as advise, plus `drawSymEnd` refuses to add a graphic whose verdict is in
  `blockOn` (default `['in','partial']`). A `placement-blocked` event is dispatched
  so the host can show why. Plan load, paste and other programmatic placements
  (lifecycle suppressed, or carrying a pending id) are never checked or blocked.
  A refused draw is not re-armed, even in continuous creation mode.
  While drawing, the badge says when a click would be refused. On a refusal the advisor itself
  shows a "Not placed" card at the cursor for five seconds (why, and what is nearby).
  **Shift-click places it anyway** (`placement.allowOverride`, default on): the graphic is stamped
  `placement.overridden = true`, a `placement-override` event is dispatched, and the host can record
  a reason with `advisor.annotateOverride(graphic, reason)` (stored as `placement.reason`).
  With `allowOverride` off the block is final.
  The legacy milsymbol sketch path (`drawMilSymbolInteractively`) shows advice
  but is not enforced.

### Document events

| event                     | detail |
|---------------------------|--------|
| `placement-advice`        | the current `PlacementVerdict` (including `indicators`), dispatched only when the verdict text changes |
| `placement-clear`         | `{}` when the draw ends or is cancelled |
| `placement-state-change`  | `{ state: 'enabled' \| 'disabled' \| 'ready' \| 'no-bundle', isEnabled }` |
| `placement-blocked`       | `{ verdict, drawEssentials }` in enforce mode |
| `placement-tiles`         | `{ loaded, pending, failed }` — cache stats, for HUDs/tests |
| `placement-override`      | `{ verdict, drawEssentials }` — enforce mode, Shift-click placed it anyway |
| `placement-audit`         | `PlacementAudit` — `openAudit()` re-judged every placed symbol |
| `placement-recheck`       | `PlacementAudit` — symbols re-judged after a move or edit |
| `placement-profile`       | `{ profile, overridden }` — the draw is now judged for this unit type (P key) |
| `placement-snap`          | `PlacementSnapResult` — the quick fix moved the symbol (`moved: true`) or found nowhere to go (`reason`) |

### Accessibility

The verdict never relies on colour alone: the card's header carries an icon and the verdict in words
("Unsuitable Position"), the overlay key and the placement-check panel give every colour a text label,
and a refusal says so in the card. All header colours meet WCAG 2.1 AA contrast for their text (4.5:1;
the green bar is `#1c8247`, and the orange "Partially Obstructed" bar uses dark text like the amber
ones); the bar colours against the card background pass 3:1.

The card follows the cursor and is rebuilt as it moves, so it is hidden from assistive technology
(`aria-hidden`) and a separate visually hidden `role="status"` `aria-live="polite"` region speaks
instead: one short sentence (verdict, why, and the keys S / Shift-click that can change it), only once
the cursor has rested on a verdict for half a second and only when the sentence changes. The quick
fix's "no usable ground within …" message is spoken at once. Cards that outlive a draw use
`role="alert"` for a refusal and `role="status"` for everything else ("ready", "loading", "not
terrain-bound"). The placement-check panel moves keyboard focus to its heading when it opens, returns
it to whatever opened it on close (Escape or ×), shows a visible focus ring on every control, keeps
its controls at least 28 px tall, reads its summary as a status and does not animate for
`prefers-reduced-motion`. The map overlay itself is colour only by nature; its key is the text
alternative.

### Quick fix: move to usable ground

While a **point** symbol is being drawn on ground the verdict rejects (`in`, `partial`, or anything
`blockOn` refuses in `enforce` mode) the badge adds a *Quick fix* row, and pressing **S** places the
symbol at the nearest ground that passes. `snapToDeployable()` does the same from code. It searches
rings of candidate spots around the cursor (out to 160 tile pixels, 16 directions) with the same verdict
function that gates a commit, footprint included, and prefers a clean `ok` spot over a marginal
`near`/`caution` one if it is only a little further out. It then clicks that spot with real pointer
events, so the symbol's own draw end, the commit check and the stamp run as usual (Ctrl+Z undoes it).
Lines and areas are not moved. Turn it off with `placement.snapKey`.

### Judging for a different unit type

The unit type the ground is judged for (`dismounted`, `wheeled`, `tracked`, …) comes from the SIDC, which
does not always say how a unit moves: a mounted and a dismounted infantry platoon share one. While a
symbol is being drawn the card says "Judged as … P changes it", and **P** (or
`advisor.cycleProfile()` / `setProfileOverride(profile | null)`) judges it for the next other profile of the
bundle, then back to the SIDC's own. The card, overlay, quick fix and the commit check all follow at once.
It is for **that one draw**: arming the next symbol starts from the SIDC again. The stamp records
`placement.profileOverride = true` with the profile used, and the audit keeps judging that symbol for the
profile it was placed with (the panel says "chosen when placed"). Symbols that are not terrain-bound have
nothing to change. Turn the key off with `placement.profileKey`; the `placement-profile` event reports
each change.

### Symbols already on the map

The advice above only runs while drawing, so the stamp can go stale (a symbol moved, edited, loaded from
a plan). Three things keep it honest:

- **Check all placements** — `await advisor.openAudit()` (Settings / Ctrl+K: *Check all placements*)
  re-judges every point, line and area in the symbol layers, anywhere on the map, refreshes each
  `attributes.placement` and lists the ones in, partly in or touching no-go, worst first. Click a row
  to zoom to the symbol and flash it; the row opens to show what changed since it was placed, a
  Shift-click override with its reason, and any spacing breach. `advisor.auditPlacements()` is the same
  without the panel and returns a `PlacementAudit` (`entries`, `problems`, counts of exempt / outside
  coverage / unchecked symbols); `placement-audit` carries the result. Tiles for symbols outside the
  view are loaded in batches of 16, and each symbol is judged at a zoom that keeps its footprint within
  about 96 tile pixels, so the result does not depend on where the camera is.
- **Re-check on move / edit** — after an `EditEngine` `changeInSymbol` (move, rotate, scale, control
  points) or a Morphix edit, the affected symbols are judged again and their stamps updated. One that
  has ended up on bad ground gets a "Placement changed" card and an Engine Log line; a
  `placement-recheck` event carries the result. An override survives while the symbol still needs it.
  Undo / redo does not trigger a re-check; run the audit.
- **Placement check…** — right-click a symbol while the advisor is active. `advisor.explain(graphic)` does
  the same from code and opens the panel on that symbol. Air and sea symbols say they are not
  terrain-bound.

### When the terrain data is unavailable

`advisor.status` is `{ state, error, retryInMs }` with `state` one of `disabled`, `no-bundle-url`,
`loading`, `ready`, `failed`; `placement-state-change` carries the same `error`. When a draw is armed
while there is no data, the advisor shows a card once per cause ("Placement advisor paused": why, and
whether a retry is coming) instead of staying silent, and a "ready" card when the data arrives after
that. A load that failed for a reason that may pass (server unreachable, HTTP 5xx / 408 / 429) is
retried automatically after 4, 15 and 45 seconds; a 404, a non-JSON answer or an invalid bundle is not,
because asking again will not help. `advisor.retry()` (Settings: *Retry loading*) tries again at once and
resets the schedule.

### Settings (`MS/Data/Settings.json`)

```json
"features": { "placementAdvisor": false },
"placement": {
  "mode": "advise",
  "overlay": { "enabled": false, "profile": "auto", "opacity": 0.6 },
  "indicators": { "enabled": true, "labels": true },
  "footprint": { "enabled": true, "facing": "fixed", "bearingDeg": 0, "size": "mid", "outline": true, "spacing": true },
  "bundleUrl": "/terrain-bundle",
  "nearThresholdM": 250,
  "partialFraction": 0.2,
  "blockOn": ["in", "partial"],
  "allowOverride": true,
  "showBadge": true,
  "snapKey": true,
  "profileKey": true,
  "logVerdicts": true,
  "cacheTiles": 512,
  "prefetchMarginTiles": 1,
  "maxSamples": 400,
  "useWorker": true
}
```

`placement.*` is read live: changing `bundleUrl` reloads the bundle, the rest applies on the next mouse move.

Registered in the ⚙ Settings menu and the Ctrl+K palette as **Placement**.

---

## Terrain bundle format (v1)

A bundle is a folder. Everything is a static file; the host serves it like any
asset. Nothing in the bundle is executable.

```
terrain-bundle/
  manifest.json
  rules.json
  LICENSES.txt
  class/{z}/{x}/{y}.png
  dist_dismounted/{z}/{x}/{y}.png
  dist_wheeled/{z}/{x}/{y}.png
  dist_tracked/{z}/{x}/{y}.png
  dist_vessel/{z}/{x}/{y}.png
  dist_generic/{z}/{x}/{y}.png
```

### Tiles

- Scheme: **Web Mercator XYZ** (EPSG:3857 / wkid 102100), 256×256, origin top-left,
  the same `z/x/y` numbering as OSM/ArcGIS basemap tiles. `y` grows southward.
- Format: **PNG, 8-bit greyscale, opaque**, no `gAMA`, `sRGB`, `iCCP` or `tRNS` chunks
  (browsers would otherwise colour-manage the values). Palette or RGB PNGs are
  accepted as long as R carries the value and there is no alpha.
- A tile that does not exist means **no coverage** — the reader records it and never
  re-requests it in the session. That is an HTTP 404, **or any response that is not an
  image** (hosts with an SPA fallback, such as the Vite dev server, answer a missing
  file with `200 text/html`).
- Levels: `manifest.zoom.min` … `manifest.zoom.max`. The engine picks the level
  closest to the view's resolution, never finer than `max`.

**`class` layer** — value = terrain class code (table below). `255` = nodata.
Overviews use **nearest-neighbour** so codes stay valid.

**`dist_<profile>` layers** — value × `manifest.distScaleM` = metres from the pixel
centre to the nearest pixel that is **no-go for that profile**, computed on a
metric grid (true metres, not Web Mercator units). `0` = inside no-go,
`254` = ≥ cap (`254 × distScaleM`), `255` = nodata. Overviews use **MIN** so a coarse
pixel never claims to be farther from no-go than any fine pixel it covers.

### `manifest.json`

```json
{
  "format": "pams-terrain-bundle",
  "version": 1,
  "name": "Pakistan deployable terrain",
  "crs": "EPSG:3857",
  "tileSize": 256,
  "zoom": { "min": 8, "max": 12 },
  "bounds": [60.8, 23.6, 77.9, 37.1],
  "distScaleM": 10,
  "layers": { "class": "class", "dist": "dist_{profile}" },
  "profiles": ["dismounted", "wheeled", "tracked", "vessel", "generic"],
  "built": "2026-10-29T00:00:00Z",
  "pipelineVersion": "0.1.0",
  "rulesVersion": "2026.10",
  "sources": [
    { "id": "worldcover", "name": "ESA WorldCover 2021 v200", "licence": "CC-BY-4.0", "sha256": "…" }
  ]
}
```

`bounds` is `[west, south, east, north]` in WGS84 degrees (for the official bundle about
60.8, 23.7, 79.4, 37.1: it reaches 79.4°E because Jammu & Kashmir is included). An optional
`"boundary": { "source", "file", "note" }` names the boundary used and the drawable
`boundary.geojson`. The engine returns
`unknown` outside it without fetching.

### `rules.json`

```json
{
  "version": "2026.10",
  "classes": {
    "0":  { "name": "open_land",        "label": "Open land" },
    "1":  { "name": "tree_cover",       "label": "Tree cover" },
    "2":  { "name": "cropland",         "label": "Cropland" },
    "3":  { "name": "built_up",         "label": "Built-up area" },
    "4":  { "name": "water_permanent",  "label": "Permanent water" },
    "5":  { "name": "water_seasonal",   "label": "Seasonal water / flood zone" },
    "6":  { "name": "wetland",          "label": "Wetland / marsh" },
    "7":  { "name": "mangrove",         "label": "Mangrove" },
    "8":  { "name": "snow_ice",         "label": "Snow / ice / glacier" },
    "9":  { "name": "steep_slope",      "label": "Steep slope (>30°)" },
    "10": { "name": "moderate_slope",   "label": "Moderate slope (15–30°)" },
    "11": { "name": "restricted",       "label": "Restricted / protected area" },
    "12": { "name": "bare_desert",      "label": "Bare / desert" },
    "13": { "name": "sand",             "label": "Sand" },
    "14": { "name": "dunes",            "label": "Sand dunes" },
    "15": { "name": "rocky_ground",     "label": "Rocky ground / scree / stony waste" },
    "16": { "name": "salt_pan",         "label": "Salt pan" },
    "17": { "name": "dry_riverbed",     "label": "Dry riverbed / nullah" },
    "255": { "name": "nodata",          "label": "No data" }
  },
  "profiles": {
    "dismounted": { "label": "Dismounted",       "nogo": [4, 8, 11],                   "caution": [5, 6, 7, 9, 14, 15, 16] },
    "wheeled":    { "label": "Wheeled vehicles", "nogo": [4, 5, 6, 7, 8, 9, 11, 14],   "caution": [1, 3, 10, 13, 15, 16, 17] },
    "tracked":    { "label": "Tracked vehicles", "nogo": [4, 6, 7, 8, 9, 11],          "caution": [3, 5, 10, 14, 15, 16] },
    "vessel":     { "label": "Surface vessel",   "requires": [4],                      "caution": [5] },
    "generic":    { "label": "Generic land",     "nogo": [4],                          "caution": [6, 7, 14] },
    "exempt":     { "label": "Not terrain-bound" }
  },
  "profileOverrides": {
    "symbolSets": { "10": "wheeled" },
    "entities":   { "10:1211": "dismounted" }
  }
}
```

- A profile with `requires` treats every class **not** in `requires` as no-go
  (vessels need water). Its `dist_` layer is the distance to the nearest non-water
  pixel, i.e. distance to shore.
- `why` (per profile) and `note` (per class) are optional: one sentence each, in the rule owner's
  words. `profiles.<p>.why` maps a class code to why that ground is no-go or difficult for that
  profile (`"tracked": { "why": { "6": "…" } }`); `classes.<code>.note` is the fallback when a
  profile has no `why` for it. The advisor looks up the class that decides the verdict (for "close
  to no-go", the nearest no-go) and shows the sentence under the verdict in the badge, in the
  "Not placed" card and in the placement-check panel (`PlacementVerdict.reason`,
  `PlacementAuditEntry.rule`). It never writes any text of its own, so a bundle without them just has
  no reason line. `rules.yaml` takes `why:` under a profile and `classes.yaml` a `note:`;
  `scripts/profiles.py` copies both through. The synthetic dev bundle carries a few
  clearly-marked sample sentences so the line can be seen.
- `profileOverrides` is optional and overrides the defaults compiled into
  `MS/Engines/Placement/PlacementProfiles.ts`. Keys: 2-digit 2525D symbol set,
  or `symbolSet:entityPrefix` matched against the 6-digit entity code.
- Class codes are **stable identifiers**: never renumber; append new ones. Classes 13–17
  (sand, dunes, rocky ground, salt pan, dry riverbed) exist only in **hybrid** bundles,
  where the NCGDB topographic geodatabase supplies terrain WorldCover cannot tell apart; an
  open-data bundle simply never contains them. The engine needs no change: it reads class
  names and profile rules from `rules.json`. Their no-go / caution entries are a starting
  proposal for the domain owner to correct.
- A hybrid bundle's `manifest.json` has `"hybrid": true` and `"restricted": true`, and its
  `LICENSES.txt` carries the data owner's restriction. See `tools/terrain-pipeline/README.md`
  ("Hybrid data") for what each source contributes and how it was assessed.

### Default symbol-set → profile mapping (MS, overridable)

| 2525D symbol set | profile |
|------------------|---------|
| 01 Air, 02 Air missile, 05 Space, 06 Space missile | exempt |
| 10 Land unit, 11 Land civilian | wheeled (entity overrides: infantry → dismounted, armour/mech → tracked) |
| 15 Land equipment | wheeled (overrides for tracked/towed) |
| 20 Land installation | generic |
| 25 Control measure | generic |
| 27 Dismounted individual | dismounted |
| 30 Sea surface, 36 Mine warfare | vessel |
| 35 Sea subsurface | vessel |
| 40 Activities, 50–54 SIGINT, 60 Cyberspace | exempt |

---

## Sampling rules

- **Point**: one sample at the point — or, for a land-unit echelon with a footprint (see
  "Echelon footprint"), the footprint rectangle / line / disc sampled as an area / line.
- **Polyline**: every vertex plus points along each segment every
  one tile pixel (Web Mercator units at the sampling zoom), capped at
  `maxSamples` (default 400) by widening the step.
- **Polygon**: ring vertices and edges as above, plus a grid over the bounding box
  filtered by point-in-polygon, same cap.
- Geometry in WGS84 (SceneView) is converted with `webMercatorUtils.lngLatToXY`;
  any other spatial reference yields `unknown`.
- Aggregation (first match wins): `fraction` = IN samples ÷ known samples.
  Point: any IN → `in`. Multi-sample: `fraction ≥ 0.5` → `in`;
  `≥ partialFraction` → `partial`; any IN below that → `near` ("touches");
  any CAUTION → `caution`; min distance < `nearThresholdM` → `near`; else `ok`.
  All samples unknown → `unknown`.
- The sampling zoom follows the view resolution (clamped to the bundle's levels);
  in a view that cannot report one (3D without an extent) it uses the finest level.
  A feature narrower than a screen pixel at the current zoom is therefore only
  seen through the distance layer's MIN overviews (`distanceM` ≈ 0), as `near`.
- Measured on the synthetic bundle (tiles warm, including the nearest-terrain
  search): point 0.05 ms, 300-vertex 4 km area 0.24 ms per mouse move.

## Open decisions (rules, not code)

- Control measures (symbol set 25: boundaries, phase lines, areas) default to the
  `generic` profile (only permanent water is no-go), so a boundary along a river
  reads `near`/`partial`. If that is noise for planners, set
  `"symbolSets": {"25": "exempt"}` in `profileOverrides`.
- The echelon frontage / depth / intergap table is the one supplied by the domain owner; the
  Battalion intergap was written "100–1200 m" and is read as 1000–1200 m. Squad, team, regiment,
  division and above have no footprint yet. A footprint is centred on the symbol (the symbol is
  not taken to mark the front edge), and no per-symbol facing is stored, so orientation is the
  `footprint.facing` setting.
- Which classes are no-go versus caution for each mobility profile is the table in
  `rules.json` (`tools/terrain-pipeline/rules.yaml`); the defaults are a starting
  proposal for the domain owner to correct, not doctrine.

## Reproducing the data

See `tools/terrain-pipeline/README.md`. One command (`make bundle`) runs
fetch → grid → derive → classify → profiles → tile → validate → package against
pinned source versions and `rules.yaml`; the emitted `manifest.json` records
every source hash so a bundle can be traced back to its inputs.
`node tools/terrain-synth.mjs` writes a small **synthetic** bundle (1,644 tiles,
about 2 MB, ~45 s) to `public/terrain-bundle/` (git-ignored) for development and
tests without real data. Its manifest carries `synthetic: true` and a
`landmarks.json` of known coordinates with their expected class. Never ship it.

In the harness: tick **Placement Advisor** in the Settings panel (bundle URL
defaults to `/terrain-bundle`), then draw a symbol over the synthetic area around
69.35°E 30.35°N.
