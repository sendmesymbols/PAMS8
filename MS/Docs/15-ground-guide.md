# 15 · Ground Guide (deployable-terrain check)

Optional engine that tells the user, **while they draw**, whether the symbol is
on deployable land, near a no-go area (and how far), partly inside one, or
inside one. It is gated by `features.groundGuide` and needs a
**terrain bundle** — a folder of static tiles produced by the data pipeline in
`tools/terrain-pipeline/` and served by the host app from any plain web server.
With no bundle configured the engine is dormant and existing hosts are unaffected.

**Where the bundle lives.** The pipeline writes it to `MS/Data/terrain-bundle/` (git-ignored, several GB).
`npm run dev` serves that folder at `/terrain-bundle`, so the default `groundGuide.bundleUrl` works in the
harness with nothing to copy. A host app copies the folder to wherever it serves static files and sets
`groundGuide.bundleUrl` to that URL.

```
HOST SERVER  /terrain-bundle/ (static files)      BROWSER
  manifest.json  rules.json                        TileLoader  (fetch + decode, pan/zoom only)
  class/{z}/{x}/{y}.png                                 |
  dist_<profile>/{z}/{x}/{y}.png                   TileCache   (LRU of Uint8Array tiles)
                                                       |  synchronous read  <- every mouse move
                                                  GroundGuide
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
const gg = symbolEngine.groundGuide;          // GroundGuide | null

await gg.configure({ bundleUrl: '/terrain-bundle' });   // loads manifest + rules
gg.setOptions({ mode: 'advise', nearThresholdM: 250 });  // see GroundGuideOptions
gg.enable(); gg.disable();

const v = gg.evaluateGeometry(geometry, sidc);   // synchronous, from cached tiles
// v: { verdict, profile, profileLabel, classCode, className, distanceM, fraction, samples, unknown,
//      message,   <- headline: what is wrong and why
//      detail,    <- second line: what it means for this unit type / what is nearby
//      nearest }  <- { kind, classCode, className, distanceM, bearingDeg, compass } or null

gg.sampleAt(point)        // { classCode, distanceM | null } for the active profile
gg.resolveProfile(sidc)   // 'dismounted' | 'wheeled' | 'tracked' | 'vessel' | 'generic' | 'exempt'
gg.getManifest()          // bundle manifest or null
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
| in no-go | `Permanent Water: NO-GO for Dismounted Force` | `Nearest suitable ground: Bare / desert, 314 m to the E` (or `No suitable ground within 1.1 km`) |
| close to no-go | `Permanent Water 120 m to the W` | `NO-GO for Dismounted Force` |
| line/area partly in | `Partially in Permanent Water (43%): NO-GO for Dismounted Force` | |
| touches no-go | `Encroaching on Permanent Water (2%): NO-GO for Wheeled Vehicle` | |
| difficult ground | `SLOW-GO: Built-Up Area` | `SLOW-GO terrain for Wheeled Vehicle. Nearest NO-GO: …` |
| suitable | `Suitable: Bare / Desert` | `Nearest NO-GO: Permanent water, 580 m to the W` (or `Clear of NO-GO terrain within 2.5 km`) |

The badge title above the headline uses the same words: *Suitable Position*, *Adjacent to …* /
*Encroaching on …*, *SLOW-GO Terrain*, *Partially Obstructed*, *Unsuitable Position*.

**The cursor card.** Under that coloured header (which also carries the share inside bad ground, e.g.
`34% Inside`, and an **S** keycap with *Quick Fix* while the quick fix can help) the card is a stack of
bands on alternating backgrounds, each captioned in capitals in the verdict's colour:

| band | shows |
|------|-------|
| **Why** | the deciding ground and the mode (`Permanent Water · Dismounted Force`), the rule owner's reason when the bundle gives one, and a GO / SLOW-GO / NO-GO scale with the verdict's step lit |
| **Inside** | lines and areas: how much of the shape (or footprint) is in bad ground, as a bar and `34% of the Footprint` |
| **Nearest** | a compass dial pointing at the nearest deciding ground (it turns with the map), its name, and the distance in large type |
| **Intermediate Gap Rule** | footprint-judged echelons: the gap to the next same-echelon unit against the minimum |

In `enforce` mode a red strip closes the card ("Enforce Mode: A click here is refused. Hold Shift and
click to place it anyway."). The mode and the P / S keys are explained in the Legend, not on the card.

The distance layer only stores *how far* the nearest no-go is, not *what* it is,
so the guide searches the class tile around the deciding sample (a window of
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
its click point (`groundGuide.footprint.enabled`, on by default). Other echelons (team, squad,
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
`GroundGuideFootprint.ts` (`ECHELON_FOOTPRINTS`) and a bundle's `rules.json` may override any of them:

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
verdict and `enforce` never refuses on it). The guide compares the footprint with same-echelon,
same-side (friendly / hostile / neutral) point symbols already on the map (the force, tactical-point,
tactical and legacy layers; the symbol's SIDC decides echelon and side). The gap is the box-to-box
distance between the two footprints (0 when they touch or overlap); below the echelon's minimum
(the low end of its intergap range) the badge adds an amber line — `⚠ Only 120 m from the next
Platoon — keep at least 300 m between them` or `⚠ Overlaps a neighbouring Platoon footprint …` —
and the offending neighbours are outlined in orange. Under `worst4` the tightest of the four facings is
used; under `circle` the gap is centre distance minus the frontage.

The placed symbols are grouped by echelon and side once and reused for two seconds, not re-scanned on every
mouse move (the grouping is dropped when a draw starts or ends and at the start of an audit), so the check
costs the same however many symbols are on the map. A symbol judged after it was placed (an audit, a
re-check after a move, "Ground check…") is never counted as its own neighbour.

```ts
v.spacing: { status: 'ok' | 'tight' | 'overlap', minGapM, nearestGapM | null,
             conflicts: { at, gapM, ring }[], message | null } | undefined
```

The commit stamp (`attributes.groundGuide`) also records `echelon`, `frontageM`, `depthM` and `spacing`.

### Indicator lines

While drawing, a line on the map joins the symbol to the terrain that is the reason
for the advice (`groundGuide.indicators.enabled`, on by default; `labels` writes the
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
`GraphicsLayer` (`ms-ground-guide-indicators`, `gg.indicatorLayer`) and are created once;
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

`groundGuide.overlay.enabled` (checkbox "Show terrain on map") paints the bundle on
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

**The Legend.** While the overlay is on, or a terrain-bound symbol is being drawn, a card titled
*Legend* is docked bottom-left through the view's own UI (so it follows 2D / 3D switches). From top to
bottom:

- the **mode** the ground is judged for, with *Mode 2 / 5*, Previous / Next buttons and one icon per mode
  of the bundle. While drawing it is the draw's own mode, tagged *Auto · From Symbol* or *Set by Hand*,
  and the buttons do what P does. With nothing drawn it is the mode the overlay paints; under
  `overlay.profile: auto` the buttons change which mode that is until the next draw, and when the
  setting names a mode they change the setting (tagged *Set in Settings*);
- the overlay's four colours as a ramp (*Suitable*, *Marginal*, *SLOW-GO*, *NO-GO*) with
  `Marginal: Within 250 m of NO-GO` from the current `nearThresholdM`. The labels come from
  `OVERLAY_LEGEND`, so a host that renames the verdicts changes the card too;
- what counts as **NO-GO** and **SLOW-GO** for that mode, listed from the bundle's own rules
  (a vessel's NO-GO reads "Anywhere Off Permanent Water"). The ▾ button folds these lists away, and the
  choice is remembered in `localStorage` (`ms-ground-guide-legend-details`);
- the keys: **P** *Change Mode* (lit while a draw can change mode) and **S** *Quick Fix* (lit, in green,
  while the quick fix can help). They are left out for touch input and when `profileKey` / `snapKey` are off.

**Hints.** Nothing shows until a symbol is picked, so the guide says so once per browser (remembered in
`localStorage` under `ms.groundGuide.hintSeen`): "Ground Guide is on: pick a symbol and terrain advice
follows your cursor." Arming a symbol that is not terrain-bound (air, space, …) shows "This symbol is
not terrain-bound, so it gets no terrain advice." instead of leaving the missing card looking broken.

`groundGuide.overlay.boundary` ("Show official boundary", off by default) also draws the bundle's
`boundary.geojson`: the national outline (green), the provinces (grey), the Line of Control
(red, dashed) and the international borders (black). It is lines only, so it never hides the
terrain colours or your symbols. The file is written by the pipeline and named in
`manifest.boundary.file`; a bundle without one simply has nothing to draw. In the **official**
bundle (the pipeline's default) the whole of Jammu & Kashmir is on Pakistan's side, following the
Survey of Pakistan's *Pakistan Relief Map*, with the Line of Control shown as a line, not a limit;
`manifest.boundary.source` says which boundary built the bundle (`official`, `osm` or `custom`).
The engine draws exactly what the bundle contains and adds no geometry of its own.

`groundGuide.overlay.profile` chooses whose terrain is painted: `dismounted` (Dismounted Force),
`wheeled` (Wheeled Vehicle), `tracked` (Tracked Vehicle), `vessel` (Surface Vessel; water is green,
land red) or `generic` (Gr Based); `auto`
follows the symbol being drawn and keeps the last one when idle. Below the
bundle's minimum zoom nothing is drawn; above its maximum the finest tile is
over-zoomed. `gg.overlayLayer` exposes the layer. The overlay needs the guide
enabled and a bundle loaded, but works in any `mode`.

### Tile worker

Fetching and decoding a PNG tile costs about 3 ms of canvas readback and byte
loops, and painting an overlay tile about the same again — enough to saturate the
main thread while panning with the overlay on. With `groundGuide.useWorker` (default
on) that work runs in a Web Worker (`TerrainTileWorker`, bundled inline by Vite so
it needs no extra file on the host and works air-gapped). The worker also keeps its
own small decoded-tile cache so the guide and the overlay never decode a tile twice.

What moves and what does not:

- **Moves to the worker:** tile fetch + PNG decode (guide cold path), and the
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
`gg.tileWorkerActive` tells you which path is live; toggling `useWorker` at runtime
swaps the source without reloading the bundle. The painter
(`GroundGuideOverlayPaint.ts`) is a pure module shared by the worker and the fallback.

### Modes

- `off` — nothing is sampled.
- `advise` (default) — badge + events; the verdict is stamped on the graphic as
  `attributes.groundGuide = { verdict, profile, classCode, distanceM, fraction }`.
- `enforce` — as advise, plus `drawSymEnd` refuses to add a graphic whose verdict is in
  `blockOn` (default `['in','partial']`). A `ground-guide-blocked` event is dispatched
  so the host can show why. Plan load, paste and other programmatic placements
  (lifecycle suppressed, or carrying a pending id) are never checked or blocked.
  A refused draw is not re-armed, even in continuous creation mode.
  While drawing, the badge says when a click would be refused. On a refusal the guide itself
  shows a "Not placed" card at the cursor for five seconds (why, and what is nearby).
  **Shift-click places it anyway** (`groundGuide.allowOverride`, default on): the graphic is stamped
  `groundGuide.overridden = true`, a `ground-guide-override` event is dispatched, and the host can record
  a reason with `guide.annotateOverride(graphic, reason)` (stored as `groundGuide.reason`).
  With `allowOverride` off the block is final.
  The legacy milsymbol sketch path (`drawMilSymbolInteractively`) shows advice
  but is not enforced.

### Document events

| event                     | detail |
|---------------------------|--------|
| `ground-guide-advice`        | the current `GroundGuideVerdict` (including `indicators`), dispatched only when the verdict text changes |
| `ground-guide-clear`         | `{}` when the draw ends or is cancelled |
| `ground-guide-state-change`  | `{ state: 'enabled' \| 'disabled' \| 'ready' \| 'no-bundle', isEnabled }` |
| `ground-guide-blocked`       | `{ verdict, drawEssentials }` in enforce mode |
| `ground-guide-tiles`         | `{ loaded, pending, failed }` — cache stats, for HUDs/tests |
| `ground-guide-override`      | `{ verdict, drawEssentials }` — enforce mode, Shift-click placed it anyway |
| `ground-guide-audit`         | `GroundGuideAudit` — `openAudit()` re-judged every placed symbol |
| `ground-guide-recheck`       | `GroundGuideAudit` — symbols re-judged after a move or edit |
| `ground-guide-profile`       | `{ profile, overridden }` — the draw is now judged for this unit type (P key) |
| `ground-guide-snap`          | `GroundGuideSnapResult` — the quick fix moved the symbol (`moved: true`) or found nowhere to go (`reason`) |

### Distance units

`groundGuide.units` (`metric` default, `imperial`, `nautical`; Settings: *Distance units*) chooses how
distances are written everywhere the guide writes one: the card, the messages, the overlay key, the
refusal card and the ground-guide-check panel. `metric` is m, then km from 1 km; `imperial` is yd, then
mi from 1 mile; `nautical` is m, then nm from half a nautical mile (a shorter distance is never quoted
in nm). One decimal under 10 of the big unit, none above. It is display only: the data,
`nearThresholdM` (the "Near (m)" setting), the event payloads and the stamp stay in metres, so a host
can format them its own way. The setting is read by `fmtDistance`, so it applies to every guide on
the page.

### Touch screens and 3D

When the last pointer move was a finger, the card is centred **above** the touch point (below it only
when there is no room above), so the hand never covers it, and it does not offer the S, P and Shift-click
shortcuts (in the card, the Legend or the spoken sentence), since there is no keyboard to press them on; the refusal
card says that placing a refused symbol anyway needs a keyboard. The card is at most as wide as the
viewport, so it fits a narrow phone. The mode can still be changed with the Legend's buttons, and both it and the quick fix are available
from code (`setProfileOverride()`, `snapToDeployable()`).

In 3D the sampling zoom comes from `view.resolution`, which a SceneView does report; the extent-based
fallback only runs for views that do not. Measured on a tilted scene (up to 70°) the local pixel size under
the cursor differs from it by up to about 2× near the centre and 4× toward the horizon, but the zoom is
clamped to the bundle's finest level there, and a finer zoom than the screen shows only costs a few more
tiles; it never loses accuracy, so no correction is made.

### Accessibility

The verdict never relies on colour alone: the card's header carries an icon and the verdict in words
("Unsuitable Position"), the overlay key and the ground-guide-check panel give every colour a text label,
and a refusal says so in the card. All header colours meet WCAG 2.1 AA contrast for their text (4.5:1;
the green bar is `#1c8247`, and the orange "Partially Obstructed" bar uses dark text like the amber
ones); the bar colours against the card background pass 3:1.

The card follows the cursor and is rebuilt as it moves, so it is hidden from assistive technology
(`aria-hidden`) and a separate visually hidden `role="status"` `aria-live="polite"` region speaks
instead: one short sentence (verdict, why, and the keys S / Shift-click that can change it), only once
the cursor has rested on a verdict for half a second and only when the sentence changes. The quick
fix's "no usable ground within …" message is spoken at once. Cards that outlive a draw use
`role="alert"` for a refusal and `role="status"` for everything else ("ready", "loading", "not
terrain-bound"). The ground-guide-check panel moves keyboard focus to its heading when it opens, returns
it to whatever opened it on close (Escape or ×), shows a visible focus ring on every control, keeps
its controls at least 28 px tall, reads its summary as a status and does not animate for
`prefers-reduced-motion`. The map overlay itself is colour only by nature; its key is the text
alternative.

### Quick fix: move to usable ground

While a **point** symbol is being drawn on ground the verdict rejects (`in`, `partial`, or anything
`blockOn` refuses in `enforce` mode) the card's header shows an **S** keycap with *Quick Fix* and the Legend lights its S key; pressing **S** places the
symbol at the nearest ground that passes. `snapToDeployable()` does the same from code. It searches
rings of candidate spots around the cursor (out to 160 tile pixels, 16 directions) with the same verdict
function that gates a commit, footprint included, and prefers a clean `ok` spot over a marginal
`near`/`caution` one if it is only a little further out. It then clicks that spot with real pointer
events, so the symbol's own draw end, the commit check and the stamp run as usual (Ctrl+Z undoes it).
Lines and areas are not moved. Turn it off with `groundGuide.snapKey`.

### Judging for a different mode

The unit type the ground is judged for (`dismounted`, `wheeled`, `tracked`, …) comes from the SIDC, which
does not always say how a unit moves: a mounted and a dismounted infantry platoon share one. While a
symbol is being drawn the Legend names the **mode** ("Dismounted Force · Auto · From Symbol"), and **P**,
the Legend's Previous / Next or a mode's icon (or `guide.cycleProfile(1 | -1)` /
`setProfileOverride(profile | null)`) judges it for another mode of the bundle, stepping in the Legend's
order; reaching the SIDC's own mode goes back to auto. The card, overlay, quick fix and the commit check all follow at once.
It is for **that one draw**: arming the next symbol starts from the SIDC again. The stamp records
`groundGuide.profileOverride = true` with the profile used, and the audit keeps judging that symbol for the
profile it was placed with (the panel says "chosen when placed"). Symbols that are not terrain-bound have
nothing to change. Turn the key off with `groundGuide.profileKey`; the `ground-guide-profile` event reports
each change.

### Symbols already on the map

The advice above only runs while drawing, so the stamp can go stale (a symbol moved, edited, loaded from
a plan). Three things keep it honest:

- **Check all placements** — `await guide.openAudit()` (Settings / Ctrl+K: *Check all placements*)
  re-judges every point, line and area in the symbol layers, anywhere on the map, refreshes each
  `attributes.groundGuide` and lists the ones in, partly in or touching no-go, worst first. Click a row
  to zoom to the symbol and flash it; the row opens to show what changed since it was placed, a
  Shift-click override with its reason, and any spacing breach. `guide.auditPlacements()` is the same
  without the panel and returns a `GroundGuideAudit` (`entries`, `problems`, counts of exempt / outside
  coverage / unchecked symbols); `ground-guide-audit` carries the result. Tiles for symbols outside the
  view are loaded in batches of 16, and each symbol is judged at a zoom that keeps its footprint within
  about 96 tile pixels, so the result does not depend on where the camera is.
- **Re-check on move / edit** — after an `EditEngine` `changeInSymbol` (move, rotate, scale, control
  points) or a Morphix edit, the affected symbols are judged again and their stamps updated. One that
  has ended up on bad ground gets a "Placement changed" card and an Engine Log line; a
  `ground-guide-recheck` event carries the result. An override survives while the symbol still needs it.
  Undo / redo does not trigger a re-check; run the audit.
- **Ground check…** — right-click a symbol while the guide is active. `guide.explain(graphic)` does
  the same from code and opens the panel on that symbol. Air and sea symbols say they are not
  terrain-bound.

### Important Tactical Ground (G)

A bundle built with the pipeline's `ground.py` step carries a terrain feature inventory (peaks, hills, knolls,
saddles, plateaus, depressions, main road junctions, ridgelines) in `features/`, and marks the features that pass
an objective test as **ITG candidates** (`it` 1 candidate, 2 strong candidate; `ig` the reason letters, labelled in
`rules.json grotbc.itg.reasons`). ITG and MITG sit under G (Ground) in GROTBC. The bundle only proposes; the user
designates.

- **On the card** (`itg.enabled`): while drawing, an *Important Tactical Ground* section lists the nearest
  candidates within `itg.radiusKm` of the point (or the cursor, for lines and areas), strongest first: name,
  kind and height, *ITG Candidate* or *Strong Candidate (Check as MITG)*, distance and direction, and the
  reasons. Feature tiles (z10, ~30 km) load in the background like terrain tiles; the card never waits on them.
- **From code**: `await guide.groundCandidates(point, { radiusKm, max, minLevel })` returns
  `GroundGuideItgCandidate[]` (`kind`, `kindLabel`, `name`, `level`, `reasons`, `reasonLabels`, `elevationM`,
  `lngLat`, `distanceM`, `bearingDeg`, `compass`, `attributes`).
- **Designate**: `symbolEngine.designateGround(candidateOrPoint, 'ITG' | 'MITG', { radiusM?, name? })` draws an
  area round it, named after the feature: **MITG** a **Vital Gr** (2525D control measure 25-242301, "VG"),
  **ITG** an **Imp Gr** ("IG", catalog key `00000160`: a PAMS8 local symbol, since 2525D has no Important Ground
  symbol; symbol set 00 like the Freehand symbols, so it never collides with a 2525D code). Both are ordinary
  symbols: saved, loaded, edited, exported and undone like any other, so no plan format change is needed, and
  both can be drawn by hand from the catalog (the card then lists the candidates under the cursor). The radius
  defaults to a plateau's own size, 250 m for a junction or crossing, 400 m otherwise.

Settings: `itg: { enabled: true, radiusKm: 3, max: 2, minLevel: 1 }` (Ctrl+K: *Important Tactical Ground*).

### Trafficability (T): road line, season controls, rain rule

T in GROTBC is **Trafficability**: the going for the mode cross-country, on tracks, roads and the MSR, dry and
after rain. The going itself (soil, cone index, season, the card sections A–H, the Ground Brief) is the going
engine's (`going.*`, `card.*`, GroundGuideGoing.ts). `traffic.*` adds the pieces on top of it, each an option so they
can be compared live before one set is chosen (GroundGuideTrafficability.ts, GroundGuideTrafficView.ts):

| Option | Default | What it does |
| --- | --- | --- |
| `traffic.road` | on | A **T · Road** band after the going sections: the nearest road the mode can use within `roadRadiusKm` (3 km), from the bundle's road lines (`features/`, kind `road`). Tracks: a tankable road (tier `k` 3, class 60+). Wheels: an all-weather road (load code `A`, else not unmetalled), and a fair-weather road that is much nearer, marked SLOW-GO after rain. The MSR comes first when it is no more than half as far again. Foot on GO ground: "Not Needed". A helicopter landing site gets a **Landing** line (slope band, power lines within 100 m, soft after rain). Also in the Ground Brief under T. |
| `traffic.pill` | on | A header pill when rain makes the going worse ("Rain: NO-GO"), or the season is wet ("After Rain: SLOW-GO"). |
| `traffic.dual` | off | A second GO / SLOW-GO / NO-GO scale under Why, for the other season. |
| `traffic.legend` | `label` | `none`; `label` a caption "T · Trafficability · Dry Season"; `season` adds a Dry / After Rain switch; `month` a month stepper with the month's rain at the map centre. The switch and stepper write `going.season` / `going.month`, so the card, the overlay and the settings panel follow. |
| `traffic.overlay` | off | The overlay paints the going for the season at the map centre (soil and wet ground included, the same rules as the card) instead of the ground classes alone. Painted in the tile worker from the class, soil (cone index or texture) and wet tiles; repainted when the season, month or rule changes or an `auto` season changes as the map moves. |
| `traffic.header` | `dry` | `season` (opt-in): a **point** on soil or wet ground that is SLOW-GO / NO-GO for the season gets that verdict in the header and the Why scale, and Enforce Mode refuses it. Only ever makes a verdict worse; lines and areas keep the class verdict. |
| `traffic.rain` | `cone` | How soil changes the going, everywhere (card sections, overlay, verdict): `cone` the rating cone index against the vehicle's (GO at VCI50, SLOW-GO at VCI1); `bearing` the texture's bearing for the season (`rules.json grotbc.soilBearing`: Poor lowers vehicles one step, Very Poor two and foot one); `words` the soil is described but never changes GO / SLOW-GO / NO-GO. |

`v.traffic` on the verdict carries `{ road, pending, pill, dual }`; the going is `v.going`. Ctrl+K: *Trafficability (T)*.

### People (B, civil considerations)

With a bundle that carries a population grid (`manifest.grotbc.population`, written by the pipeline's
`population.py`), the card gets a **B · Built-Up Areas · People** row for every mode: WorldPop 2026 people round the
cursor (100 m people summed to ~1 km cells; males 15–49, under 15 and 65+ as 1 km shares), the nearest named place
(bundle features 110–114, `wp`), and the province comparison (2020 population weighted density). Estimates
modelled from buildings, not a census; every view says so. The grid (~33 MB) loads once in the background when the
guide is on; readings are synchronous and cached per cell (`GroundGuidePopulation.ts`).

| Setting | Default | |
| --- | --- | --- |
| `population.card` | `scale` | How the row looks. Every style is built so they can be compared live (`ground-guide-population-options.html` shows them side by side): `line` (A), `scale` (B, six-step density scale), `rings` (C, 1 / 3 / 5 km target with places at their bearing), `ages` (D), `rose` (F, people by compass sector), `minimap` (G, 11 × 11 km of cells), `profile` (H, density by distance band), `icons` (I), `compare` (J, against the province), `block` (K, the whole civil block), `off`. |
| `population.flag` | `true` | Civil flag (E): a header pill and a strip when the unit type's threshold is met (`POPULATION_FLAGS`: gun / AD 200+ within 1 km, HLS 50+, signals 500+ within 2 km, wheeled / tracked 2,000+, road-bound 5,000+). Advisory: never changes the verdict. |
| `population.radiusKm` | `5` | Radius of the count, density class and age split. |
| `population.layer` / `layerOpacity` | `false` / `0.7` | The People map layer (L): every cell coloured by class (Empty, Sparse, Rural, Dense Rural, Town, Urban; B-family colours, never the verdict colours), with a key in the view's corner. |
| `population.enabled` | `true` | Off = the grid is never fetched. |

The Ground Brief (G key) draws **B · Built-Up Areas · Civil Considerations** (rings to 10 km, age, eight named
places, province comparison, sources with dates) through `registerBriefSection`, and Copy as Text includes it.
API: `guide.populationAround(pointOrLngLat, { radiusKm })` → `GroundGuidePopulationReading | null`,
`guide.populationText(point)` → the Copy as Text lines. `v.population` on a live verdict carries
`{ reading, style, flag }`. Ctrl+K: *People*. Test panel: Ground Guide → People (B).

### When the terrain data is unavailable

`guide.status` is `{ state, error, retryInMs }` with `state` one of `disabled`, `no-bundle-url`,
`loading`, `ready`, `failed`; `ground-guide-state-change` carries the same `error`. When a draw is armed
while there is no data, the guide shows a card once per cause ("Ground Guide paused": why, and
whether a retry is coming) instead of staying silent, and a "ready" card when the data arrives after
that. A load that failed for a reason that may pass (server unreachable, HTTP 5xx / 408 / 429) is
retried automatically after 4, 15 and 45 seconds; a 404, a non-JSON answer or an invalid bundle is not,
because asking again will not help. `guide.retry()` (Settings: *Retry loading*) tries again at once and
resets the schedule.

### Settings (`MS/Data/Settings.json`)

```json
"features": { "groundGuide": false },
"groundGuide": {
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
  "units": "metric",
  "snapKey": true,
  "profileKey": true,
  "logVerdicts": true,
  "cacheTiles": 512,
  "prefetchMarginTiles": 1,
  "maxSamples": 400,
  "useWorker": true,
  "itg": { "enabled": true, "radiusKm": 3, "max": 2, "minLevel": 1 }
}
```

`groundGuide.*` is read live: changing `bundleUrl` reloads the bundle, the rest applies on the next mouse move.

Every value is validated. One that is not valid for its setting (`"units": "yards"`, `"mode": "enforse"`,
a `blockOn` entry that is not a verdict, an `overlay.profile` the bundle does not have, a string where a
switch is expected) is ignored and the previous value stays; a number outside its range is moved into it.
`guide.setOptions(patch)` returns the list of these (`{ path, value, reason }`), and each distinct set
is written once to the Engine Log, so a typo in a settings file does not fail silently. An overlay profile
chosen before the bundle was known is checked when it loads and falls back to `auto` if it is not there.

Registered in the ⚙ Settings menu and the Ctrl+K palette as **Ground Guide**.

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
    "dismounted": { "label": "Dismounted Force", "nogo": [4, 8, 11],                   "caution": [5, 6, 7, 9, 14, 15, 16] },
    "wheeled":    { "label": "Wheeled Vehicle",  "nogo": [4, 5, 6, 7, 8, 9, 11, 14],   "caution": [1, 3, 10, 13, 15, 16, 17] },
    "tracked":    { "label": "Tracked Vehicle",  "nogo": [4, 6, 7, 8, 9, 11],          "caution": [3, 5, 10, 14, 15, 16] },
    "vessel":     { "label": "Surface Vessel",   "requires": [4],                      "caution": [5] },
    "generic":    { "label": "Gr Based",         "nogo": [4],                          "caution": [6, 7, 14] },
    "exempt":     { "label": "Not Terrain-Bound" }
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
  profile has no `why` for it. The guide looks up the class that decides the verdict (for "close
  to no-go", the nearest no-go) and shows the sentence under the verdict in the badge, in the
  "Not placed" card and in the ground-guide-check panel (`GroundGuideVerdict.reason`,
  `GroundGuideAuditEntry.rule`). It never writes any text of its own, so a bundle without them just has
  no reason line. `rules.yaml` takes `why:` under a profile and `classes.yaml` a `note:`;
  `scripts/profiles.py` copies both through. The synthetic dev bundle carries a few
  clearly-marked sample sentences so the line can be seen.
- `profileOverrides` is optional and overrides the defaults compiled into
  `MS/Engines/GroundGuide/GroundGuideProfiles.ts`. Keys: 2-digit 2525D symbol set,
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

## Terrain bundle v2 (GROTBC)

Bundle v2 keeps the v1 format (`manifest.version` stays `1`, so the engine reads it with no change) and
adds `dataVersion: 2`, a `grotbc` block in the manifest, and more data, organised by the staff headings
**G**round, **R**elief, **O**bstacles, **T**actical features, **B**oundaries & built-up,
**C**over & concealment. The card that presents it by heading is the next piece of work:
[16 Ground Guide card: GROTBC handover](16-ground-guide-grotbc-card.md) has the decisions, style guide and the full
data contract.

- **Classes 18–50** are appended (codes 0–17 unchanged): slope bands 3–7° and 7–15°, canals, distributaries,
  drains, irrigated cropland, embankments and bunds, cuttings, cliffs, railways, walled orchards, orchards,
  forest, graveyards, power line corridors, metalled roads by load class (60+, 50–59, below 50, not recorded),
  unmetalled roads, bridges by load class, railway and foot bridges, fords / ferries, perennial streams, dry
  nullahs, walls / fences and level crossings. Each class in `rules.json` carries `note` (shown under the
  verdict), `grotbc` (heading letters), `origin` (natural / man-made) and `kind`.
- **Crossings are gaps in the obstacles.** A road or railway over a river polygon, or at a true line
  intersection with a canal or stream, becomes the bridge of its load class; a road along a canal bank or beside
  a railway does not.
- **Fourteen modes:** the five v1 modes plus Gun Position (`gun`), Air Defence Site (`ad`), Helicopter Landing
  Site (`hls`), Signals / EW Site (`signals`), Amphibious (`amphibious`), Mountain / Pack Transport (`pack`),
  Over-Snow (`oversnow`), Road-Bound Wheeled (`roadbound`) and Rail-Bound (`rail`). The bundle's
  `profileOverrides` pick them from the SIDC: field artillery, missiles and mortars → Gun Position, air defence →
  Air Defence Site, signal and EW units → Signals / EW Site, amphibious → Amphibious, trains → Rail-Bound,
  tractor-trailers → Road-Bound Wheeled, helicopter landing sites and landing zones → Helicopter Landing Site.
- **Tankable** = load class 60 or more (carries Al-Khalid, T-80UD, T-80 and Al-Zarrar); 50–59 carries Al-Zarrar
  only. The numbers live in `rules.json grotbc.tanks` / `grotbc.tankable`.
- **Marginal band:** thin lines (`rules.json marginalIgnore`: distributaries, drains, walls, railways, bunds,
  crossings …) are NO-GO on the line itself but do not make the ground beside them Marginal; the
  nearest-NO-GO search ignores them too, so the class it names and the distance agree. Road- and rail-bound
  modes have no Marginal band (`marginal: false`).
- **Auxiliary layers** (`route`, `landform`, `cc`, `wet`, `elev_hi` / `elev_lo`), **features**
  (`features/10/{x}/{y}.json`: water sources by kind, crossings, helipads, airfields, stations, passes, posts,
  settlements, spot heights …, plus named roads, railways, canals and rivers), `admin.geojson`,
  `boundaries.geojson` and `sheets.json`. The engine does not read them yet.

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
fetch → grid → derive → grotbc → classify → profiles → tile → validate → package against
pinned source versions and `rules.yaml`; the emitted `manifest.json` records
every source hash so a bundle can be traced back to its inputs.
`node tools/terrain-synth.mjs` writes a small **synthetic** bundle (1,644 tiles,
about 2 MB, ~45 s) to `public/terrain-bundle/` (git-ignored) for development and
tests without real data. Its manifest carries `synthetic: true` and a
`landmarks.json` of known coordinates with their expected class. Never ship it.

`npm run dev` serves `/terrain-bundle` from the real bundle in `MS/Data/terrain-bundle/`, **except** for any
file that also exists under `public/terrain-bundle/`: the synthetic bundle wins file by file, so while that
folder exists the harness shows synthetic data instead of the real data. **Delete `public/terrain-bundle/`
when you are done with the synthetic bundle.** (This is decided per request, so no restart is needed after
adding or deleting it.) Tile URLs carry the bundle's `built` stamp (`…/12/2877/1637.png?v=…`), so tiles the
browser cached for one bundle are not reused for another served from the same address.

In the harness: tick **Ground Guide** in the Settings panel (bundle URL
defaults to `/terrain-bundle`), then draw a symbol over the synthetic area around
69.35°E 30.35°N.
