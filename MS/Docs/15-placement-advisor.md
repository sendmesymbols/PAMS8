# 15 · Placement Advisor (deployable-terrain check)

Optional engine that tells the user, **while they draw**, whether the symbol is
on deployable land, near a no-go area (and how far), partly inside one, or
inside one. It is gated by `features.placementAdvisor` and needs a
**terrain bundle** — a folder of static tiles produced by the data pipeline in
`tools/terrain-pipeline/` and served by the host app from any plain web server.
With no bundle configured the engine is dormant and existing hosts are unaffected.

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
// v: { verdict, profile, classCode, className, distanceM, fraction, samples, unknown, message }

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

### Modes

- `off` — nothing is sampled.
- `advise` (default) — badge + events; the verdict is stamped on the graphic as
  `attributes.placement = { verdict, profile, classCode, distanceM, fraction }`.
- `enforce` — as advise, plus `drawSymEnd` refuses to add a graphic whose verdict is in
  `blockOn` (default `['in','partial']`). A `placement-blocked` event is dispatched
  so the host can show why. Plan load, paste and other programmatic placements
  (lifecycle suppressed, or carrying a pending id) are never checked or blocked.
  A refused draw is not re-armed, even in continuous creation mode.
  The legacy milsymbol sketch path (`drawMilSymbolInteractively`) shows advice
  but is not enforced.

### Document events

| event                     | detail |
|---------------------------|--------|
| `placement-advice`        | the current `PlacementVerdict`, dispatched only when the verdict text changes |
| `placement-clear`         | `{}` when the draw ends or is cancelled |
| `placement-state-change`  | `{ state: 'enabled' \| 'disabled' \| 'ready' \| 'no-bundle', isEnabled }` |
| `placement-blocked`       | `{ verdict, drawEssentials }` in enforce mode |
| `placement-tiles`         | `{ loaded, pending, failed }` — cache stats, for HUDs/tests |

### Settings (`MS/Data/Settings.json`)

```json
"features": { "placementAdvisor": false },
"placement": {
  "mode": "advise",
  "bundleUrl": "/terrain-bundle",
  "nearThresholdM": 250,
  "partialFraction": 0.2,
  "blockOn": ["in", "partial"],
  "showBadge": true,
  "logVerdicts": true,
  "cacheTiles": 256,
  "prefetchMarginTiles": 1,
  "maxSamples": 400
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
- A tile that does not exist (HTTP 404) means **no coverage** — the reader records it
  and never re-requests it in the session.
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

`bounds` is `[west, south, east, north]` in WGS84 degrees. The engine returns
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
    "255": { "name": "nodata",          "label": "No data" }
  },
  "profiles": {
    "dismounted": { "label": "Dismounted",       "nogo": [4, 8, 11],             "caution": [5, 6, 7, 9] },
    "wheeled":    { "label": "Wheeled vehicles", "nogo": [4, 5, 6, 7, 8, 9, 11], "caution": [1, 3, 10] },
    "tracked":    { "label": "Tracked vehicles", "nogo": [4, 6, 7, 8, 9, 11],    "caution": [3, 5, 10] },
    "vessel":     { "label": "Surface vessel",   "requires": [4],                "caution": [5] },
    "generic":    { "label": "Generic land",     "nogo": [4],                    "caution": [6, 7] },
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
- `profileOverrides` is optional and overrides the defaults compiled into
  `MS/Engines/Placement/PlacementProfiles.ts`. Keys: 2-digit 2525D symbol set,
  or `symbolSet:entityPrefix` matched against the 6-digit entity code.
- Class codes are **stable identifiers**: never renumber; append new ones.

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

- **Point**: one sample at the point.
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
- Measured on the synthetic bundle (tiles warm): point 3 µs, 60-vertex area
  (340 samples) 0.07 ms, 300-vertex 4 km area 0.19 ms per mouse move.

## Open decisions (rules, not code)

- Control measures (symbol set 25: boundaries, phase lines, areas) default to the
  `generic` profile (only permanent water is no-go), so a boundary along a river
  reads `near`/`partial`. If that is noise for planners, set
  `"symbolSets": {"25": "exempt"}` in `profileOverrides`.
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
