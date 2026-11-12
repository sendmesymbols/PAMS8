# 15 · Ground Guide (deployable-terrain check)

Optional engine that tells the user, **while they draw**, whether the symbol is
on deployable land, near a no-go area (and how far), partly inside one, or
inside one. It is gated by `features.groundGuide` and needs a
**terrain bundle** — a folder of static tiles produced by the data pipeline in
`tools/terrain-pipeline` and served by the host app from any plain web server.
With no bundle configured the engine is dormant and existing hosts are unaffected.

**Where the bundle lives.** The pipeline writes it to `MS/Data/terrain-bundle` (git-ignored, several GB).
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

await gg.speedAround([lon, lat], { sidc })      // T Speed at a point (see "Speed (T)"); speedText() for Copy as Text
gg.moverFor(sidc)         // { key: 'a_tracked', label, cat: 'A', from: 'catalog' } — who moves
gg.speedTables            // the speed tables in force; gg.setSpeedTables(patch) overrides any part
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

**The cursor card.** The coloured header gives the verdict, an **S** keycap with *Quick Fix* while the quick fix can
help, and the civil flag; its second line says **who the ground is judged for**: the mode's icon and name with the
echelon (`Dismounted Force · Battalion`), a *Set by Hand* tag when P chose the mode instead of the symbol, and the
season and light the going and speed are read for (`Dry, Nov · Day`). When the going overlay is fixed in the settings
to another mode, an amber line under the header says so (`Map colours show Tracked, not Dismounted Force`). Under it
the card is label-left rows split by hairlines (2026-11-07); Why has no label and takes the card's whole width.
Since 2026-11-06 the card is **minimal** by default (`card.cursor: minimal`): these rows and nothing else, so it stays
short while it follows the cursor; `card.cursor: full` brings back every section the switches below turn on.
With the Detail closed the minimal card reads only what its rows need (the going at the point, the cover, the road
for the mode, the ITG candidates and a pixel-only obstacle scan: about 2 ms more a move in central Lahore, measured 2026-11-07); the terrain
rays, road density and feature queries wait for the Detail.

| row | shows |
|-----|-------|
| *(Why, no label)* | the GO / SLOW-GO / NO-GO scale with the verdict's step lit, the deciding ground, and the rule owner's reason when the bundle gives one |
| **Key facts** | two cells: the going in the other season (*After Rain*, or *When Dry* in the wet) and the cover or concealment the mode needs most (`Cover · Direct Fire: None`), each a word with a dot in its colour |
| **Inside** | only while some of it is in NO-GO, with no label and the card's whole width: how much and in what, as `34% of the Frontage in Permanent Water` for an echelon (judged on its frontage) or `of the Shape in …` for a line or area (the commonest NO-GO class among the samples in it). An echelon gets the **frontage strip**: 16 small bars across the front, left to right as the unit faces (compass letter at each end), green or orange for SLOW-GO with red rising by the share of that block in NO-GO, so the card shows which end is in it (`footprint.front` / `frontEnds` on the verdict, from the samples the verdict already took). A line or area keeps the plain bar |
| **Nearest** | `card.nearest: ranked` (default, 2026-11-07): up to three different things round the point, most important first, each a coloured dot, its name, distance and direction, and why it matters in small type; one compass under the label (it turns with the map) carries the first as the needle and every one, the first included, as a dot in its list colour (2026-11-08: a red needle alone near north read as the compass's own north needle; a dot moved in by a clash goes further in near north, and the N is drawn last on a dark halo). The order: the ground that decides the verdict; an obstacle that is NO-GO for the mode; better cover when the field the mode needs is Poor or None here, and the nearest place when the civil flag is raised; the road for the mode, an obstacle that slows it, a strong ITG candidate; the nearest place; an ITG candidate or an obstacle that does not stop the mode. One of each kind, the same ground seen twice kept once, and the point's own class (already in Why) left out. Under a metre reads *Touching* / *At the Point*. `card.nearest: deciding` shows only the deciding ground, as before |
| **Inter Gap Rule** | footprint-judged echelons: the gap to the next same-echelon unit against the minimum |

In `enforce` mode a red strip closes the card ("Enforce Mode: A click here is refused. Hold Shift and
click to place it anyway."). The P / S keys are explained in the Legend, not on the card. A foot
cue names the **D** and **H** keys.

**The hint chip (H).** While drawing, **H** shrinks the card to a small chip by the cursor (2026-11-07: the user
sometimes wants to see the map under the symbol and only a hint of GO / NO-GO): the verdict colour and icon, one word
(*GO*, *SLOW-GO*, *NO-GO*, *NO-GO Near*), and the one figure that changes the decision (`29% Inside`, or
`180 m SW` with its arrow, or *Touching*, when NO-GO ground is close), a *Refused* tag in enforce mode, and a faint
**H** keycap. It stays a chip across moves and draws until **H** again brings the card back; `card.hint` starts the
session with the chip. H does nothing when no symbol is being drawn. A see-through card was considered and left out:
text over imagery stops being readable before the map under it becomes visible.

**Clear ground on the chip** (2026-11-08, the user picked the arrow chip from `ground-guide-card-concepts.html`). When
some of a point symbol is in NO-GO, the chip adds the way out: a solid pointer that turns with the map, then
`Clear Gr 382 m NE`, the nearest spot where all of the symbol (its footprint for an echelon) is out of NO-GO
(`NO-GO · 44% in · ➤ Clear Gr 382 m NE`; the share shortens to `% in` beside it). It is the S Quick Fix's own search
(`_findSnap`), so **S moves the symbol exactly there**; the spot can be GO or merely out of NO-GO (Marginal / SLOW-GO),
as for S. `No clear Gr in 5.1 km` when the search reaches its limit (`SNAP_MAX_PX`) with nothing; nothing while it waits
on tiles, and nothing for lines and areas (S is points only). The search costs 3–6 ms, so `_clearFor` runs it at most
every 120 ms while the cursor moves (`CLEAR_INTERVAL_MS`; in between, the spot already found is kept and only its
distance and direction follow the cursor), at once when the cursor has gone over half the way to the spot, and once
more when the cursor rests. Hosts get it as `GroundGuideVerdict.clear` (`GroundGuideClearGround`) on
`ground-guide-advice`; screen readers hear "Clear ground 382 m NE".

**The Ground Detail (D).** Everything else the engine reads is in a wide card docked at the foot of the map
(`GroundGuideDetail.ts`), opened with **D** while drawing, with a tab a GROTBC letter and a last **Legend** tab.
It **never scrolls** (2026-11-07: the tabs are switched by key while the mouse places the symbol). Under the tabs an
**answer strip** (`GroundGuideDetailSummary.ts`) opens with who the ground is judged for (mode, echelon, *From the
Symbol* or *Set by Hand (P)*, season and light, and the overlay warning), then the letter's answer and key facts on
one line (facts that do not fit the width are left to the tiles). Below it a band of fixed height holds the tab's
pictures, then its lists and notes, placed down columns first-fit (a short tile fills the space under a tall one; a
list taller than the band continues at the top of a later column). What does not fit the card's width goes to a next
page: **the same letter again turns the page**, wrapping from the last page to the first, and **Shift + the letter**
goes back a page (2026-11-08; the letter no longer closes the card); the footer shows `Page 1 of 2` and the keys.
Since 2026-11-08 the card **fills its width**: when a tab fits one page its tiles are shared out side by side over
every column there is room for (in order, the tallest column as short as it can be, a column up to 560 px), and a last
page with columns to spare does the same with its own tiles, so a short tab no longer leaves half the card empty.
Text is **12 px at the least** everywhere, from the shared type scale in `GroundGuideTokens.ts` (the runtime rule that
raised small text in the Detail is gone, 2026-11-08), and the pictures' own labels are drawn at 10.5 px on screen at
the least. Label / value lists have a hairline and air between rows, so a value that wraps stays one row; the G
list's **Going** is a small grid (a mode a row, *Dry* and *After Rain* a column).

| tab | tiles |
|-----|-------|
| **G** Ground | the slope cross-section with the military crest (or the schematic slope and band gauge), the soil (texture triangle, source, cone index, strength gauge), the ITG candidates, the terrain / relief / water rows |
| **R** Roads & Rail | the road as a sign with its record, road network density (gauge, ways-out rose, route classification bar, what the band means), the road line for the mode, the route rows with rail and air (the check for the mode is on the strip) |
| **O** Obstacles | obstacles round it (dial), the exits strip (what blocks each direction), the gap cross-section when a canal or reach is recorded, the obstacle rows (natural and man-made with their effect are on the strip) |
| **T** Trafficability | the going gauge (dry and after-rain markers), the movement rose, the time-to-range rose, the going map (north up), the way out, who can move here, who moves how fast, going by month, **W** the year's weather, speed (headline, day / night grid, strip to the road) and the month's weather figures (the dry and after-rain going are on the strip) |
| **B** Built-Up | people (radar and rings, density scale), people by direction, the 1 km people map, out from here, ages, places; where (tehsil, sheet, grid, border), buildings and services, protected sites, against the province (the civil flag is on the strip) |
| **C** Cover | the four tiles, the cover rose, the nearest cover per field, the four levels as meters, what the mode needs and the area round it, what else is mapped (underground, landform, buildings); the four levels and the better cover nearby are on the strip |
| **L** Legend (key **K**) | the mode as pills (one click judges or paints for it), the overlay key with the season and day / night switches, **Map Layers** switches (going overlay with its opacity, terrain data boundary, People layer, indicator lines, footprint outline), the NO-GO and SLOW-GO lists for the mode, the keys. There is no docked legend on the map any more: this tab is the legend, and D opens the card before a draw too |

A letter key (**G R O T B C**, and **K** for the Legend, since L is Lasso Select) opens the detail on that tab; the same
letter again turns the page (wrapping), Shift + the letter goes back. **D** and **Esc** close it; the **first Esc closes
only the Detail** (it is stopped before the draw tool sees it) and a second Esc reaches the draw tool as before.
Only the active tab is built on each cursor move. **Copy as Text** in its header copies every registered
section as plain lines for orders. The detail keeps the last draw's content until closed. API: `guide.showDetail(open,
tab?)`, `guide.isDetailOpen`, `guide.detailTab` (`showBrief()` / `isBriefOpen` still work). The old T key, which
stepped the T block's tabs, is now the Trafficability tab; a folded T block on the full cursor card counts as open
while the detail is.

**The Gr Scope rail (V).** A side window docked at the right edge of the map (`groundGuide.scope.side`: right or left),
**shown and hidden with V** at any time the guide is on, drawing or not (2026-11-08, approved from
`ground-guide-scope-window.html`). It has **nothing to do with the mouse**: it never follows the cursor, and the cursor
card and its H chip are separate and unchanged (the cursor card steps aside from the rail, as it does from the Detail).
Plain V is free in the app; Ctrl+V stays paste. The choice is remembered between sessions; while it is hidden a small
**V · Gr Scope** tab sits at that edge (`scope.tab`; click it to show the rail). The rail is 400 × 836 px, scaled down to
fit a shorter map, and **never scrolls**. While both are open the Ground Detail stops short of it.
- **What it reads**: the symbol **being placed**; with nothing being placed, the **one selected symbol** (SymbolEngine
  passes its selection, `guide.setScopeTarget(graphic)`); else the symbol **just placed** (until the map is panned more
  than a fifth of the screen); else the **map centre** (a reticle, no verdict). A placed symbol is judged as the audit
  judges it (a mode set by hand when it was placed is kept), with the clear ground the S search finds.
- **Top**: the verdict bar (the ladder colour and title the cursor card uses), who the ground is judged for (mode,
  echelon, season, month, day / night), what it reads with the frontage (`Placing · Frontage 525 m · Facing N`), then
  the answer: how much of the frontage is in NO-GO and in what (a share that rounds to 0 is written 1%, never clear),
  and the way out: `Clear Gr 200 m NW` with **S** while placing a point, `No clear Gr within 5.1 km: check on the
  ground`, or the NO-GO beside a Marginal position.
- **The map** is the window, the real ground round the spot for the echelon: Section 240 m each way (rings 50 / 100 /
  200 m), Pl 720 m (100 / 300 / 600), Coy 1.5 km (250 / 500 / 1000), Bn 3.6 km (1 / 2 / 3 km), Bde 10 km (3 / 6 / 9 km);
  a point with no frontage and the map centre read like a Coy, a line or area widens the map to hold it. The symbol is
  a white arrow for its facing (not a unit frame: not every symbol is one); the frontage is drawn for the echelon, its
  front edge in blocks red where it is in NO-GO (pale for some, strong for most); the clear ground is the frontage again,
  dashed green, with an arrow to it (a pointer at the edge when it is off the map). **No Inter Gap marks** on the rail.
  The map turns with a rotated view (north badge top left), with a scale bar.
- **The GROTBC layers** (`GroundGuideScopeScene.ts`, from the bundle's class layer and `features/`): **G** hills with
  their heights, ridgelines, ITG candidates as violet diamonds; **R** MSR white (cased), all-weather blue, fair-weather
  violet, minor grey, tracks dashed, railways, road numbers, bridges close in; **O** canals and rivers, power lines;
  **T** the going under everything (the guide's own NO-GO / SLOW-GO / Marginal classing for the mode; off: plain ground
  with NO-GO kept in blue-grey); **B** built-up hatched, towns and villages sized by people, the biggest named; **C**
  trees and orchards dotted, nullahs and dry beds.
- **Kept clear**: the wider the echelon, the less is drawn. Bn drops tracks; Bde keeps only MSR and all-weather roads;
  villages only below Bn; bridges to Coy; spot heights to Pl; junctions from Bn; ITG at most 6 drawn (strong first, then
  nearest; the legend gives the count); names a handful (the 3 biggest towns, the 2 highest points, road numbers),
  never one over another. A place or hill recorded twice (two sources) is drawn once.
- **Legend**: under the map only, one line per letter, each giving the nearest or biggest of each thing in view
  (`N-5 MSR Cl 70 383 m N`, `Jhelum 190k 2.3 km N`, `NO-GO Gr at the symbol`, the going shares). **Each line is that
  layer's switch**: click it to hide or show the layer (remembered).
- **With the Extended View on** (F; 2026-11-12) the same rail reads the same spot in its Extended mode, see *Extended
  View* below. Its foot shows **F Ext View** (off) or **F Close Ext** (on).
- API: `guide.showScope(open?)` (no argument toggles, as V does), `guide.isScopeOpen`, `guide.setScopeTarget(graphic |
  null)`; event `ground-guide-scope` `{ open }`.

**Visual review (2026-11-08, the user's picks from `ground-guide-visual-options.html`).** One type scale and one set of
colours for every Ground Guide surface live in `GroundGuideTokens.ts`: sizes 12 / 13.5 / 15.5 / 18 / 22 px, weights
400 / 600 / 750, labels `#c3cbd3`, stronger hairlines, no faded text, dark only.
- **Verdict ladder** (bar, chip, gauge, overlay, Legend key, indicator lines): *Suitable* green ✓, *Marginal* yellow
  outline triangle (Adjacent: the shape is on GO ground beside NO-GO, so the gauge lights **GO** with a
  `NO-GO 120 m NE` tag), *SLOW-GO* orange filled triangle, *Part NO-GO* hatched red outline octagon (Encroaching,
  Partially Obstructed), *NO-GO* deep red filled octagon with a cross, *Checking* grey. Red and green mean verdicts
  only: roads are white with a dark casing and the letters MSR, blue all-weather, violet fair-weather, dashed grey
  track; other units' footprints violet; natural obstacles blue-grey; letter badges and tabs neutral.
- **Cursor card**: the bar holds the verdict only (icon, 18 px title, `33% Inside`); mode, echelon, season, light
  and the civil flag's people count (written out) sit on a neutral line under it; Why opens with the gauge (one bar in
  three colours, a pointer over the lit step); labels are written to fit (two lines rather than cut); the footer is
  *D Detail · H Hint* (plus a lit *S Quick Fix* when it can help). With the Detail open the card opens on the side of
  the cursor that has room and never over the Detail; where no side has room it folds to the chip until there is.
- **Ground Detail**: every tab shows its letter, a short name and **its own answer** as a dot and a word (the open
  tab light, tabs neutral); who the ground is judged for has its own line under the tabs; each strip opens with the
  letter's **answer block** (22 px, in its verdict colour, judged for the mode), then the facts. One idea, one name:
  road crossings of the circle are **Rds out** (`15 in 7 Dirs`, R only); cross-country directions for the mode are
  **Open Dirs** (`6 of 8`, the same reading in O and T); R's route uses the road T found when the 1:50k map has none
  within 500 m; R's density callout judges for the mode. Read-only scales (slope band, people band) are rulers with a
  marker; *Who moves how fast* is a plain grid. Every round picture shares one frame (120 px, one ring, one N, a
  one-line key under it) but keeps its own shape; the Rds out rose's key says white MSR, blue all-weather, violet
  fair-weather. Group labels are sentence case; capitals only for GO, SLOW-GO, NO-GO, MSR, ITG.
- **Height**: drag the grip on the Detail's top edge to 40, 50 or 60 % of the window (remembered, 50 % to start;
  Up / Down on the focused grip); the card is never shorter than 440 px, so the band keeps the 220 px its tallest
  tiles need, and the height is the same on every tab.
- **Map labels**: none (the user first chose a dark plate, then had it removed the same day because it covered the
  ground; the line and its end marker in the verdict colour remain).

The distance layer only stores *how far* the nearest no-go is, not *what* it is,
so the guide searches the class tile around the deciding sample (a window of
±32 tile pixels, about ±1 km at the finest level) for the closest pixel of the
opposite kind. It reports that pixel's class and compass direction; the distance
comes from the pipeline's exact layer when it is below the layer cap. Beyond the
window, when the distance layer still has the no-go (2026-11-07), the guide walks down that layer from the point
(sixteen reads round it, a step of half the distance left) to the no-go's edge and takes the bearing from there,
naming the class from the pixels at the walk's end, so the card's Nearest keeps its compass (at z12 it agreed with
the pixel scan within 4°). Inside no-go, beyond the window, it says so ("No deployable ground within 1.1 km")
instead of guessing.
A shape that spans tiles still being fetched is judged on what is known and says
`Still loading terrain data`.

**While tiles load**, the cursor card does not blank out. When the tile under the cursor is missing, the
last real verdict of the draw stays up, but **grey**: the bar says *Checking* with `Last: Suitable` beside it, the
gauge lights nothing and the facts read "…" (2026-11-08; a verdict judged before all its tiles arrived is shown the
same way, unless what is known already puts NO-GO ground in the shape, which stays red), provided the cursor is within
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

`footprint.outline` draws the footprint on the map while placing (blue). The cursor card keeps clear of it
(2026-11-08): the usual spots beside the cursor first, then beside the frontage or clear of it above / below, and
only where none is clear the old spot. It is also in the verdict:

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
for the advice (`groundGuide.indicators.enabled`, on by default). No text is written on the map
(2026-11-08: a label there covered the ground being judged; the cursor card names it and says how far):

| situation | line | end marker |
|-----------|------|------------|
| symbol too close to no-go (point, or the part of a shape nearest it) | red, dashed, to the nearest no-go edge | red ring |
| symbol inside no-go | **green**, dashed, to the nearest deployable ground (where it could move to) | green diamond |
| line/area partly or mostly in no-go (or touching it) | red, from the cursor to the nearest contested sample | red ring; the stretches of the line / area edge (or footprint outline) in no-go are drawn **solid red on a white casing**, plus red **×** on contested ground inside an area and on single samples too short to draw (at most 16) |
| deployable, caution, unknown | none | |

The edge is walked one tile pixel at a time (at most 1,200 points) and each run through no-go ground is
drawn from half a step before it to half a step after, so the colour stops where the ground does. That shows
where a line or area needs to move, not just how much of it is wrong.

The line has a white casing for contrast on imagery (a dark one under a yellow Marginal line). The graphics live on one ground-draped
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
| `ground-guide-access`        | `{ graphic, access }` — the way out by road after a placement (`traffic.access`; `GroundGuideAccess`) |

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
  reasons. Under the reasons, two lines give what the pipeline measured on it (ground.py, DEM features only; added
  2026-11-06): what it commands, "Rises 85 m · Highest within 3 km · Sees 42 % to 5 km · MSR in view 1.2 km" (`rr`,
  `iso`, `vs`, `mv`), and what it is like to hold, "Slope 4° · MSR 2.1 km · Road or track 300 m · Scrub · Cover Poor,
  Concealment Fair (area) · Surveyed 1,234 m" (`sp`, `dr`, `dn`, `lc`, `cv`, `hs`). A missing `mv` / `dr` / `dn` on a
  DEM feature means none within 5 km and is said so; NCGDB features flagged as candidates (bridges, junctions) carry
  none of these. Feature tiles (z10, ~30 km) load in the background like terrain tiles; the card never waits on them.
- **From code**: `await guide.groundCandidates(point, { radiusKm, max, minLevel })` returns
  `GroundGuideItgCandidate[]` (`kind`, `kindLabel`, `name`, `level`, `reasons`, `reasonLabels`, `elevationM`,
  `lngLat`, `distanceM`, `bearingDeg`, `compass`, `attributes`, `traits`: the characteristics decoded).
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
after rain. The going itself (soil, cone index, season, the card sections A–H, the Ground Detail) is the going
engine's (`going.*`, `card.*`, GroundGuideGoing.ts). `traffic.*` adds the pieces on top of it, each an option so they
can be compared live before one set is chosen (GroundGuideTrafficability.ts, GroundGuideTrafficView.ts):

| Option | Default | What it does |
| --- | --- | --- |
| `traffic.road` | on | A **T · Road** band after the going sections: the nearest road the mode can use within `roadRadiusKm` (3 km), from the roads `traffic.roadSource` names. Tracks: a tankable road (tier `k` 3, class 60+). Wheels: an all-weather road (load code `A`, else not unmetalled), and a fair-weather road that is much nearer, marked SLOW-GO after rain. The MSR comes first when it is no more than half as far again. Foot: the nearest road or track; on GO ground the line adds "Or GO Cross-Country", so both options are shown and the user decides. A helicopter landing site gets a **Landing** line (slope band, power lines within 100 m, soft after rain). Also in the Ground Detail under R and T. |
| `traffic.pill` | on | A header pill when rain makes the going worse ("Rain: NO-GO"), or the season is wet ("After Rain: SLOW-GO"). |
| `traffic.dual` | off | A second GO / SLOW-GO / NO-GO scale under Why, for the other season. |
| `traffic.legend` | `label` | `none`; `label` a caption "T · Trafficability · Dry Season"; `season` adds a Dry / After Rain switch; `month` a month stepper with the month's rain at the map centre. The switch and stepper write `going.season` / `going.month`, so the card, the overlay and the settings panel follow. |
| `traffic.overlay` | off | The overlay paints the going for the season at the map centre (soil and wet ground included, the same rules as the card) instead of the ground classes alone. Painted in the tile worker from the class, soil (cone index or texture) and wet tiles; repainted when the season, month or rule changes or an `auto` season changes as the map moves. |
| `traffic.header` | `dry` | `season` (opt-in): a **point** on soil or wet ground that is SLOW-GO / NO-GO for the season gets that verdict in the header and the Why scale, and Enforce Mode refuses it. Only ever makes a verdict worse; lines and areas keep the class verdict. |
| `traffic.rain` | `cone` | How soil changes the going, everywhere (card sections, overlay, verdict): `cone` the rating cone index against the vehicle's (GO at VCI50, SLOW-GO at VCI1); `bearing` the texture's bearing for the season (`rules.json grotbc.soilBearing`: Poor lowers vehicles one step, Very Poor two and foot one); `words` the soil is described but never changes GO / SLOW-GO / NO-GO. |

| `traffic.block` | `band` | T as **one block** instead of the separate pieces (`off`: the Cross-Country and Movement sections and the Road band, as before). With a block on, those two going sections and the Road band are left out (the other card sections stay as set). `band` the going now in large type, then Why (soil, cone index against the vehicle's), Road (shield, name, distance, class tag, all-weather alternative) and Move (directions open); `gauge` one GO to NO-GO bar with sun and drop markers; `calendar` twelve months coloured by the going they leave, rain bars, this month outlined; `tiles` foot / wheels / tracks (and the mode placed) with dry and after-rain bars; `wayout` a line to the road coloured by the going crossed, ending in the road shield; `rose` the movement rose with the road marked on its rim (turns with the map); `ticker` one strip under the header; `tabs` Now / Rain / Road / Months, T cycles them while drawing. Compared side by side in `ground-guide-t-presentation.html`. |
| `traffic.where` | `afterWhy` | `afterWhy`; `grotbc` after the G sections, before B; `folded` one line (going, after rain, road) that **T** opens and closes while drawing (with `tabs`: closed, each tab, closed). The ticker always sits under the header. |

| `traffic.roadSource` | `network` | Where the road line's roads come from. `network`: the bundle's **routing network** (`network/gg/10/x/y.bin`, written by the pipeline's `network.py write_gg_roads`): the same edges, load classes, MSR, tankable and fair-weather flags GeoCore routes on and the map's roads layer draws, so the card, a route and the map name the same road the same way. OSM roads with the NCGDB classes attached, so roads the NCGDB does not map are found too. Residential, service and path edges are left out unless they are an MSR, tankable or load-classed (997 k edges, 38 MB for Pakistan; the largest tile is 1.9 MB). `ncgdb`: the NCGDB road lines of the feature tiles (`features/`, kind `road`), also the fallback for a bundle with no network. |
| `traffic.access` | on | **Way out by road** after a unit or vehicle is placed: one request to the road server (GeoCore, through RoadNetworkEngine) for the route to the nearest MSR within `accessRadiusKm` (15 km; else the nearest tankable road for tracks, all-weather road for wheels), as **Tracked Vehicle** (tracked, amphibious) or **Wheeled Vehicle** (wheeled, gun, AD, signals, road-bound, generic); foot, helicopter, vessel and rail get none. A short card says "3.4 km by Road · 6 min to N-5 (MSR)" and the weakest bridge or lowest load class on the way, or "No Road Out for Tracked Vehicle" with the roads that close it; the route is drawn dashed red for 8 s. The answer is kept on the symbol (`attributes.groundGuide.access`) and sent as `ground-guide-access`. Never while drawing; nothing without a road server (`setRouter()`). |
| `traffic.accessRadiusKm` | 15 | How far the way out looks for an MSR, km (1-30). |

**Performance.** The road line reads only tiles in memory on each mouse move (a bounding box per edge leaves a few
dozen edges to measure; well under a millisecond); tiles are typed-array views over one binary file each, fetched
in the background, 24 kept. The way out is one HTTP request per placement, nothing while drawing.

The card's MSR shield is red, as the roads layer draws the MSR (yellow there is a recorded class below 60).

`v.traffic` on the verdict carries `{ road, pending, pill, dual, block, where, open, tab }`; `road.main` / `road.alt` give the road
as the drawn styles need it (shield, name, tag, MSR, all-weather, distance, bearing). The going is `v.going`. Ctrl+K: *Trafficability (T)*.

### Speed (T): how fast the unit or vehicle moves here

The last open item of T. Speed is worked out in the browser from layers the bundle already ships (no pipeline step):
the ground class, the going for the season (the going engine's GO / SLOW-GO / NO-GO, soil and wet ground included),
the slope from `elev_hi` / `elev_lo` and the routing network's roads. The tables are **`MS/Data/MovementSpeeds.json`**,
a **starting proposal** to be corrected by the rule owner; a bundle may override any key in `rules.json grotbc.speed`,
and a host with `setSpeedTables(patch)` (deep merge; arrays replace). Code: `GroundGuideSpeed.ts` (pure logic),
`GroundGuideSpeedView.ts` (card and Brief).

**Who moves (the mover).** In order: `speed.mover` when set by hand; the unit type picked with **P** for this draw;
the SIDC's **mobility amplifier** (positions 9–10 of a land equipment SIDC: 31 wheeled limited cross-country → B
Road, 32 wheeled cross-country → B Truck, 33 tracked / 34 wheeled and tracked / 52 amphibious → A Tracks, 35 towed,
37 pack animals); the catalogue's **`Mover`** (MS/Data/Symbols.json); else the Ground Guide profile
(`byProfile`: dismounted → foot, tracked → A Tracks, wheeled → B Truck, gun / AD → towed, ...). Movers:

| Mover | Category | Covers |
| --- | --- | --- |
| `foot` | — | Infantry on foot, SOF, mountain infantry; rifles, MGs, grenade launchers |
| `pack` | — | Mules (mountain artillery) |
| `b_light` | B | Jeep, Land Cruiser, Hilux, motorcycle; recce units, ambulances |
| `b_truck` | B | Cross-country truck; motorised infantry and engineers |
| `b_truck_road` | B | Limited cross-country truck, bus |
| `b_heavy` | B | Tractor-trailer, tank transporter, missile and rocket carriers (TEL / TELAR, MLRS) |
| `towed` | — | Guns and trailers behind a B vehicle; field and AD artillery |
| `a_wheeled` | A | Wheeled APC, armoured car |
| `a_tracked` | A | MBT, tracked APC / IFV, SP gun, ARV, mine-clearing tank; armour, mechanised infantry |
| `c_tracked` | C | Dozer, excavator |
| `c_wheeled` | C | Crane, tractor, bridging and mine-laying equipment |

**Catalogue fields.** Vehicle entries in `MS/Data/Symbols.json` carry
`"VehCat": "A" | "B" | "C"` (A combat vehicle, B general purpose, C engineer plant: `Material/Veh`) and every
tagged entry `"Mover"`. Both are extra keys at the top of the entry, so nothing that reads the catalogue changes;
weapons and units carry `Mover` only. 91 entries are tagged. (`MS2` and `MS3` are outdated and not updated.)

**The arithmetic.** Speed at a spot = the mover's km/h on that kind of ground (`grounds`: open, fields, irrigated,
orchard, forest, firm desert, loose sand, dunes, rocky, riverbed, marsh, salt pan, built-up, snow, water gap; a ground
the mover has no figure for, such as `hill` or `road`, goes at its `open` speed), by **day or night**, × `slowGo` on
SLOW-GO ground, 0 on NO-GO, × `afterRain` after rain, × the **slope**, × height above sea level (foot and pack, from
3,050 m). Slope: **Tobler's walking formula** for foot and pack animals, scaled so flat ground gives the table and
fitted so a 20 % path gives the Pakistani table's mountain ascent and descent (2 / 3 km/h by day, 1 / 2 by night),
never faster than the table; vehicles take a **factor per slope band** (Level < 3°, Gentle < 7°, Sloping < 15°,
Moderate < 30°, Steep), from FM 5-33's gradability rule (factor = (gradability − slope) ÷ gradability: tanks and
M113 45 %, trucks 30 %, jeeps 28 %). Foot speeds on plains and desert are the Pakistani infantry marching table
(plains 4 / 3, desert firm 3 / 2.5, loose sand 2.5 / 2 km/h by day / night), harder ground FM 21-18's cross-country
2.4 / 1.6, snow ATP 3-90.97; a day's march is the table's 24-hour distances (plains 30–35 km with combat load, 40–45
without; desert 15–20 / 25–30; mountain 10–15 / 20–25), chosen by the bundle's terrain type. Height above 3,050 m (where
the table stops) takes about 10 % off per 914 m (USARIEM). Mules: FM 25-7, ATP 3-90.97 and the Yunnan record (5 km/h,
13–32 km a day). Columns: FM 55-30 (open column 40 km/h by day, blackout 16 at night; halts 10–15 min every 2 h).
Every figure's source and date is in the file's `sources`; no Pakistani or Indian vehicle or road movement table is
published, so those are `gaps` for the owner's staff tables.

**Roads.** The nearest road the mover would use (tankable first for tracks, all-weather first after rain), typed by
its road number (M- motorway, N- highway) or its class; its speed for **one vehicle alone** or **a column**
(`columns`: never faster than the road allows one vehicle, with halts for the rate in km in the hour), × `fairAfterRain`
on a fair-weather road after rain; and the minutes to reach it cross-country in a straight line at the speed here.

| Setting | Default | |
| --- | --- | --- |
| `speed.enabled` | on | Work out speed at all (card, Brief, `speedAround`). |
| `speed.card` | `line` | `off` (Brief only); `line` **S1** the speed now, up / down the slope, the road and the time to reach it, a day's march on foot; `grid` **S2** day / night × dry / after rain; `rose` **S3** minutes to cover `going.rangeKm` in eight directions, slope and ground taken along the way (turns with the map); `modes` **S4** foot / B truck / A tracked (and the mover) side by side; `road` **S5** a strip from here to the road, cross-country then the road speed. All kept to compare. |
| `speed.light` | `day` | `day` or `night` (blackout / night vision). The S2 grid and the Brief show both. |
| `speed.road` | `convoy` | `convoy` a column on the move (convoy march rates); `single` one vehicle alone. |
| `speed.load` | `combat` | Foot, a day's march with or without combat load. |
| `speed.mover` | `auto` | Or a mover key: judge every symbol as it. |
| `speed.legend` | on | A Speed caption and a Day / Night switch on the Legend. |

The block sits right after the T block (or the last T section when `traffic.block` is `off`). The Ground Detail has a
**T · Speed** section: the grid, the eight-direction rose and the lines Copy as Text gives. `v.speed` on the verdict
is a `GroundGuideSpeed` (mover, category, ground, slope, going, `kmh`, `up` / `down`, `grid`, `modes`, `road`,
`rays`, `dayKm`, `basis`). Ctrl+K: *Speed (T)*.

Safety first: a speed is never faster than its table, uphill is the speed a foot card leads with, and every figure is
an estimate for planning, not a march timing; check on the ground.

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

The Ground Detail (D key, B tab) draws **B · Built-Up Areas · Civil Considerations** (rings to 10 km, age, eight named
places, province comparison, sources with dates) through `registerBriefSection`, and Copy as Text includes it.
API: `guide.populationAround(pointOrLngLat, { radiusKm })` → `GroundGuidePopulationReading | null`,
`guide.populationText(point)` → the Copy as Text lines. `v.population` on a live verdict carries
`{ reading, style, flag }`. Ctrl+K: *People*. Test panel: Ground Guide → People (B).

### Cover, Camouflage & Concealment (C)

With a bundle whose `rules.json grotbc` carries `coverSplit` (bundle v2), the card gets a **C · Cover &
Concealment** section for every mode: what the ground at the point gives against **direct fire, indirect fire, ground
observation and aerial observation**, each None / Poor / Fair / Good. The four levels come from the class under the
symbol (`coverSplit.byClass[class]`), raised by a river or canal bank within 75 m (`bank` layer + `grotbc.banks`;
the owner's rule of 2026-11-04: banks give cover and are deployment lines, shown as a *Deployment Line* tag). The
local cover and concealment density from the `cc` layer is shown beside them, never mixed in. The search looks out
to `cover.radiusM` for the nearest Fair or better of each kind and shades an eight-sector rose. The mode's main need is
marked (`COVER_FOCUS`: foot, direct fire; vehicles, ground observation; guns, AD and signals sites, the air; none for
landing sites, rail and vessels), and when it is short a line says where better is ("Dismounted Force needs Direct
Fire: None · Good 94 m N (Built-up area)"). The levels are the rule owner's **starting proposal**; every view says
"Proposal". Code: `GroundGuideCover.ts` (pure: decode, split, scan) and `GroundGuideCoverView.ts` (card styles, Brief).

**The spot, not the area (decided 2026-11-05, safety first).** The four levels describe the spot under the symbol. The
`cc` concealment value comes from the NCGDB vegetation-symbol density of the surrounding km² (`classify.py
cover_layers`), so a road or track through trees reads Good there although the road itself is open. The levels are
therefore **never raised** by `cc`, so the guide never tells a planner that a vehicle on an open road is hidden. They
are **never lowered** by it either, because `cc` does not know bunds or banks and would undo the owner's rules. When the
area conceals better than the spot, `v.cover.around` is set. The card then says "Concealed round it, not on this spot:
Good 31 m S (Tree cover)". On a road, track or railway (classes 28, 34–38) it adds that a canopy over the road may screen
it from the air, to be checked on the ground.

**Underground and enclosed cover (added 2026-11-06).** Every C style ends with an *Underground* line when a mapped
cave, bunker, trench, road tunnel or railway tunnel (feature kinds 85, 62, 63, 28, 29) lies within 5 km: the nearest of
each kind, up to three ("Underground · Trench 858 m NE"). The Brief always has the line ("none mapped within 5 km" when
there is none). They are points on the map, so they never change the four levels. `v.cover.shelters`.

**Lie of the ground and buildings (added 2026-11-06).** Every C style also ends with a *Ground* line (the landform at the point and the nearest closed depression within 2 km with its depth, kind 165: where dead ground may be) and a *Buildings* line (building density and height at the point, `bld`). Both sit beside the levels and never change them. `v.cover.form`, `v.cover.built`.

| Setting | Default | |
| --- | --- | --- |
| `cover.card` | `lines` | How the section looks. Every style is built so they can be compared live (`ground-guide-cover-options.html` shows them side by side): `lines` (C1, four lines with a meter and what gives each), `grid` (C2, cover beside concealment as four tiles), `summary` (C3, one line), `icons` (C4, shield and eye), `nearest` (C5, here or the nearest Fair or better of each kind), `rose` (C6, eight wedges by the best cover for the mode's need), `block` (C7, all of it), `off` (the Brief still has it). |
| `cover.where` | `grotbc` | `grotbc`: last on the card, after B. `afterWhy`: under Why (after T when T is there too). |
| `cover.radiusM` | `500` | How far the nearest and the rose look (100 to 2,000 m). |
| `cover.focus` | `true` | Mark the mode's main need and say where better is. |
| `cover.enabled` | `true` | Off = the `cc` / `bank` tiles are never fetched and nothing is shown. |

The Ground Detail (D key, C tab) draws **C · Cover, Camouflage & Concealment** in full (four lines, local density, bank, rose
and nearest list) through `registerBriefSection`, and Copy as Text includes it. API:
`guide.coverAround(pointOrLngLat, { profile, radiusM })` → `GroundGuideCover | null` (read at the bundle's finest zoom,
waits for the tiles), `guide.coverText(point)` → the Copy as Text lines. `v.cover` on a live verdict carries the same
object. Ctrl+K: *cover*. Test panel: Ground Guide → Cover & Concealment (C).

### Ground, Roads, Buildings & Weather (G R B W sections)

Since 2026-11-05 the card also reads the bundle layers it used to skip. Every label comes from `rules.json` codebooks
and `features/index.json`, and every threshold that decides something comes from `rules.json`. Code:
`GroundGuideSections.ts` (pure reading) and `GroundGuideSectionsView.ts` (card, Brief, Copy as Text).

| Section | Card line (`compact`, the default) | More rows (`lines` style and the Ground Detail) | Data |
| --- | --- | --- | --- |
| **G Ground** | Terrain type · elevation · slope in degrees and band (Level, Gentle, Sloping, Moderate, Steep) · landform | Nearest change of terrain type along 8 rays; the highest ground nearby with its height above the point; the named area (plains, plateaus, deserts, valleys, hill ranges, forests, regions); water sources (`grotbc.water.kinds` + wells); the nearest named river, canal or stream | `terrain`, `elev_hi` / `elev_lo` (3 × 3 gradient), `landform`; features 100–102, 150–164 with `e`, 152 / 150 / 157 / 151 / 158 names (NCGDB and GeoNames `D:\Imagery\PK.txt`), 1–9, 155, lines 202 / 203, 153 / 154 |
| **R Roads** | The route at the point, or the nearest within 500 m: type · load class · MSR, then the **check for the mode** · road density band; a second small line (added 2026-11-06) with the ways across the railway and the transport hubs when there are any | Nearest crossing (bridge, ford, ferry), railway station or line (10 km), airfield or helipad (15 km); **Rail Xing**: the nearest level crossing (vehicles cross here) and railway bridge (trains and foot only) within 2 km from the class layer, and railway tunnel (10 km); **Transport**: the nearest bus stand and toll plaza (10 km); **road network density** (km/km², all-weather share, ways out by direction; the Brief adds the make-up: all-weather, tracks, MSR and tankable km) | `route` (type, tier, MSR bit); `grotbc.tankable`; features 20–30, 50, 40–47, 29, 139, 142, line 201; classes 43 and 50; routing network `network/gg` for the density |
| **B Buildings** | Building density · kacha huts per km² · nearest service | Footprint size and height; temporary huts; nearest health, police, school, government office (5 km); security installations (posts, forts, border posts, cantonments) | `bld` (density, size, GHSL height), `hut`; features 70–72, 77, 136, 147, 149, 60–69 |
| **W Weather** | The month: highest / lowest temperature, rain, wind | The year: rain and monsoon share, frost months, months of 40° and over, wet months | Climate grid `tmin`, `tmax`, `prec`, `wind`, `prec_year`, `monsoon_pct` (WorldClim 1970–2000; one cell is about 9 km) |

**The check for the mode follows the rules and puts safety first.** For a Tracked Vehicle on a road:
- class 60 and over: "Tankable"
- class 50 to 59: "Al-Zarrar only, not Al-Khalid or T-80"
- below class 50: "not tankable"
- **class not recorded: "treat as not tankable until checked"**
- on a track: "no load class; check bridges and culverts"

For wheels, guns, AD and signals: metalled surfaces are "all-weather", and unmetalled ones get "Fair-weather surface:
SLOW-GO after rain". A Rail-Bound symbol is told whether it is on a railway. The check is advisory and never changes the
verdict. The slope is read at the map zoom; on an overview tile it is a mean, so the card says "about".

| Setting | Default | |
| --- | --- | --- |
| `sections.ground` / `roads` / `buildings` / `weather` | all `true` | Each section on or off. |
| `sections.style` | `compact` | `compact`: one line a section on the card. `lines`: a few rows a section. `brief`: only in the Ground Detail. The Detail always shows every row. Compact is the default because the card follows the cursor; the full rows add about 400 px. |
| `sections.detail` | on | (added 2026-11-06) Under each **one-line** G, R, O, B and W section, a small muted grid of what the line leaves out, so the card carries everything "A few rows" and the Brief show while keeping the one line. G: change of terrain, high ground, named area, water, river, ridge, **going for foot / wheeled / tracked** dry and after rain (GO / SLOW-GO / NO-GO in their colours), **soil** with its cone index against the mode's. R: named road and route, what is recorded on it, crossing, rail, ways across the railway, transport, air (the rail / transport second line is folded into it). O: canal, river reach, dam, levee, closures. B: building size and height, temporary huts, services, security, place, landmarks, utilities, admin, map sheet, border, **ages** (under 15, 15 to 64, 65+, men 15 to 49). W: the year and the wet months. Off: the one line alone, as before. **Added later on 2026-11-06 (the former Partly rows):** G **Land** (the ground class at the point, with the `cc` concealment of the area round it), **Trees** (nearest tree cover, orchard or forest within 3 km), **Lake** (nearest named lake, else permanent water), **Wet** (wet ground here or the nearest, `wet` codes 1-4), **Riverbed** (nearest dry riverbed / nullah); R **Choke** (the two nearest chokepoints on an MSR within 10 km, features flagged `ig` C), **Junction** (nearest junction of main roads with its `mx` ways out, and the nearest named chowk), **Fuel** (nearest petrol pump, 15 km); O River adds discharge (`dc`, cusecs) and wet span (`ws`), **Bank** (bank at the point, `bank` layer), **Flood** (wet ground with the wet months; mapped, not live), **Snow** (nearest snow / ice with the frost months); B Landmarks include banks (kind 148). These rows are in "A few rows" and the Brief too. **And the former Data-only kinds (2026-11-06):** G **Marsh** (nearest named marsh / lake bed, 10 km); R **Culvert**, **KM** (the nearest road and railway km stone within 2 km with a recorded reading, else "no reading recorded"), runways in **Air** with `rw` / `rd`; O **Canal Xing** (aqueducts, siphons, canal km stone); B **Vet** (veterinary hospital, 10 km), **Lodging** (rest house / hotel, 10 km), **Industry** (mines, mine shafts, kilns, chimneys, 5 km), **Deserted** (deserted site), boundary pillars in **Border**, air firing / bombing targets in **Security**. Every feature kind in the bundle is now read. Adds about 450 px to the card where the data is rich (Murree). |
| `sections.radiusKm` | `3` | How far the high ground, water, crossings, security and terrain-change searches look. Services look at least 5 km, stations 10 km, airfields 15 km and named areas 10 km. |
| `sections.roadDensity` | `true` | Road network density in the R section (below). |
| `sections.roadDensityKm` | `5` | Radius of the density circle (0.5–10 km). 5 km is about a battalion to brigade area; at 2 km most circles outside towns hold no road. |
| `sections.roadDensityStyle` | `rows` | How the card shows it (all built, to compare in `ground-guide-road-density-options.html`): `rows` D1 Density and Ways out rows (in one-line R: "road density dense"), `chip` D2 band chip only, `gauge` D3 0–3 km/km² bar, `rose` D4 ways-out rose (MSR / all-weather / fair-weather), `makeup` D5 bar of all-weather and track km with MSR and tankable km, `sentence` D6 one sentence, `brief` D7 Ground Detail only. Code `GroundGuideRoadDensityView.ts`. |
| `sections.roadDensityLead` | `afterRain` | When tracks lift the total a band: `afterRain` leads with the all-weather band (safe), `dry` with the band for every road, `both` shows two chips. |

**Road network density (R, Road Connectivity; added 2026-11-05).** `GroundGuideRoads.densityAround` clips every edge
of the routing network (`network/gg`, the same edges the T road line names and GeoCore routes on) to a circle round the
point and sums the kilometres: all-weather and fair-weather (tracks, paths and edges flagged fair-weather), MSR and
tankable. `GroundGuideRoadDensity.ts` turns that into km/km² and a band, and counts the **ways out**: where roads cross
the circle, crossings closer than 250 m along it merged into one, listed by direction with the all-weather ones apart.
Town streets, service roads and footpaths are not in these tiles (network.py `GG_SKIP_CLAZZ`), so a town reads as its
through roads.

| Band | km/km² | Meaning on the card |
| --- | --- | --- |
| No Roads | 0 | Cross-country only. |
| Sparse | under 0.25 | Movement canalised; each road a likely chokepoint. |
| Moderate | 0.25–0.75 | Some choice of route; alternatives limited. |
| Dense | 0.75–1.5 | Room to disperse and switch axes. |
| Very Dense | 1.5 and over | Built-up road grid: many routes, channelled and slow. |

The bands are a proposal from the bundle itself (1,500 random 5 km circles over the tiles that hold a road: median
0.15, 75th percentile 0.57, 90th 1.17, 99th 2.95 km/km²); `rules.json grotbc.roadDensity.bands` overrides them by key
when the bundle ships it. **Safety first:** when tracks and fair-weather roads lift the total into a higher band than
the all-weather roads alone, the card leads with the lower one, marked "after rain", and shows both figures. Read
from tiles in memory on the hot path; `guide.roadDensityAround(point, { radiusKm })` waits for them. Spot checks:
Cholistan No Roads; rural Gujranwala Dense 1.0; Kharian Dense 1.2 with 29 km of MSR; Lahore Very Dense. The Ground
Brief's R block "Road Network Density" always shows the rows with the make-up, the ways-out rose and what the band
means, whatever the card style. The defaults (D1, after rain) stand until the owner picks from the options page.

**Added 2026-11-06 (`sections.obstacles` and more rows):**

- **O Obstacles.** The card line names the nearest man-made and natural obstacle (classes whose `grotbc` letters
  carry O, split by `classes[c].origin`) with its effect for the mode (the profile's NO-GO / SLOW-GO lists), and wet
  ground at the point (`wet`). Crossings carry O but are left out: they are the way over an obstacle. More rows: the
  nearest canal with width, depth and bank height (line 202 `w`, `dp`, `b`); the river reach with bed, depth and
  current (146); dam, barrage or headworks; levee (123); roads closed by season or with landslide sites.
- **R.** The nearest road's record: load code, width, condition, closure, landslides, defence road. Its named route
  comes from `routes.json` (from, to, length, MSR). A missing record is said as "not recorded" / "no closure recorded",
  never as "good" or "open".
- **G.** Adds the nearest ridgeline (204: crest, length).
- **B.** Adds:
  - the nearest named settlement and its size class (thresholds of `settlements.py`; a city, district HQ or town whose
    figure is below a town keeps its kind);
  - landmarks, protected sites first (mosque, shrine, temple, church, eidgah, graveyard), then markets, mills,
    industrial areas, camps and parks;
  - utilities (grid station, mast, booster, exchange, wireless, oil and gas);
  - the admin area (`admin.geojson`) and the 1:50k / 1:250k sheet (`sheets.json`);
  - the distance to the international boundary, LoC or LAC (`boundaries.geojson`).
- **W.** The Brief says plainly that fog and visibility are not in the data.

`GroundGuidePlaceData.ts` loads `admin.geojson`, `boundaries.geojson`, `sheets.json` and `routes.json` once, in the
background. It never reads the corps AOR layer or corps operational lines, which the bundle marks sensitive.

The GeoNames codes the bundle lacked are mapped in `tools/terrain-pipeline/scripts/grotbc.py` (`GN_KINDS`, new kinds
123–127):
- levee (T.LEV)
- industrial area (L.INDS)
- camp (S.CMP, refugee and mining camps)
- named vegetation (V.CULT, V.OCH, V.GROVE, V.SCRB)
- park (L.PRK, S.GDN)
- mud flats, lake beds, islands, barracks, sugar and oil mills, tidal creeks, ancient sites, monuments, diplomatic
  facilities (existing kinds)

That is 1,566 points. They show on the card once the feature tiles are rebuilt (`grotbc.py --only features`, then
`ground.py`, then copying into the bundle); the engine already reads the new kinds.

**The data the bundle had but did not use (added later on 2026-11-06).**

- **G from the DEM** (the bundle's 30 m `elev_hi` / `elev_lo`, read in the browser like the slope; no new tile layer):
  - **Faces**: the way the slope faces, from a ~90 m gradient, with "forward slope to the NE, reverse slope to the SW".
    Not shown on level ground (under 2°).
  - **Mil crest**: walk up the slope to its top, then down a profile from the top to the foot (where it levels under 3°
    for two steps, 3 km at most). The military crest is the highest profile point from which a man standing (2 m) sees
    every point down to the foot. The card says whether the point is on it, above it (the slope below is partly dead
    ground) or below it (the foot is in view), with the top, the foot and the drop. A slope of under 15 m drop gives
    nothing. On a level hill top the steepest fall of 10 m within 150 m is read. G3 (relief) draws this real profile with
    MC and the dead ground marked.
  - **Surface**: how broken the ground is, from a plane fitted to 5 x 5 elevations 30 m apart (residual under 1 m
    Smooth, 2.5 Uneven, 5 Broken, else Very broken; a proposal). GLO-30 is a surface model, so trees and roofs count;
    the card says so. Finest zoom only.
- **G from NCGDB layers not read before** (`grotbc.py`, kinds 167–181):
  - **Dunes**: Soil_Line's dune lines and Soil_Point's dune symbols summed per ~2 km cell (`dune_field`: spacing `sp`,
    axis `or`, parallel `oc`, star / other dune symbols `sd` / `ds`), 29,551 cells. The card: "Dune lines every 280 m ·
    running NNW–SSE · move along them, not across".
  - **Marked**: scree, broken rocky ground, stony waste, quarries, earth slides, moraines (points and Soil_Line 1),
    crevasses (Glacier_Line 4), ice pinnacles, sand plains.
  - **Map notes**: the sheet's own text (Annotation_) that says something about going, water, vegetation or ground:
    "Jeepable", "Motorable in fair weather", "Track follows bed", "Brackish", "Undrinkable", "Fairly dense pine",
    "Grass 2 metres high", "Scree" (21,882 notes). The nearest of each kind within 2 km, as written.
  - Dam reservoirs (Reservoir_Pakmap) on the lakes; solar power stations (Misc_Polygon_Feature) in B utilities;
    province / district / tehsil seats (Places 1–3, `hq`) on the B place row; named river lines (River_Line).
- **O**: the dam row adds what HeadWorks_Pakmap records (river, length, height, gates, spans, load class; these
  fields were in the layer but not read). **Lines**: the nearest power line (kV), pipeline and wall / fence within
  2 km, from OpenStreetMap (205–207).
- **OSM** also adds fords, hospitals / clinics and fuel stations onto the existing kinds (`src: osm`), skipped within
  400 m of the same kind.
- `boundaries.geojson` gains the 80 km and 300 km lines (Trans_80KM_Line, Trans_300KM_Line), marked sensitive; the
  border row never reads sensitive lines.
- **Grid reference (B Grid row, Where style).** Mil_Grid holds the sheets' own grid lines: the Indian grid, zone I
  north of GridLine (GRID-I / GRID-II, about 28–29°N) and IIa south of it ("Sec Grid" = the other zone carried
  across), in metres. `grotbc.py military_grid()` fits the Lambert conformal conic (one parallel, Everest 1830,
  EPSG 24371 / 24372 parameters) to every line's value with an affine correction per zone and axis, which takes up the
  datum shift: rms 0.3–1.2 m over 128,000 samples. The fit goes into `sheets.json` `grid`;
  `GroundGuidePlaceData.gridAt()` does the same sum in the browser: "GR 603 451 · Indian grid zone I: 3,160,312 E,
  1,045,101 N".
- **Wind arrows (G Wind row, kind 182).** The NCGDB's point `Angle` turns a symbol clockwise: bridge symbols then lie
  along their road (94 % within 15° round Lahore). With that rule the wind arrows' axis agrees with the dune lines
  round them (79 % of 471 within 20°). The arrow symbol's own drawing is not in the geodatabase, so which end the wind
  blows from is not known: the card gives the axis only ("Along NNW–SSE · which end it blows from is not recorded").
- **Countries** go into `admin.geojson` (`layer: country`, the NCGDB's own names, e.g. IIOJ&K); the B Admin row names
  the country when it is not Pakistan.
- **Limit_Line**: types 1 and 2 are the outlines of water, cultivation, burial grounds and sand already read as
  polygons, but the water outlines carry names nothing else has (nalas, mandas, nawars such as Kalanchi Nawar): those
  are added as river lines (for the G River row) when no river or canal line has the name. Type 6 is the Lal Suhanra
  national park boundary (kind 208), named first on the B Landmarks row within 10 km.
- Left out, and why: Mask (556 small white masks drawn behind map text, about 50 m long: no ground meaning), Contour
  (the DEM is used instead), Canal_Polygon (8 polygons, no widths filled), HeadWorks_Pak (all 74 lie within 3 km of a
  HeadWorks_Pakmap point). The 0.25 m imagery in `D:\Imagery\PK\B` is not used.

**Per-section card styles (2026-11-06).** Every style is built and switchable, as with T and C, so the owner can pick
at the end (`ground-guide-sections-options.html` draws them with the engine's own code; open it from the dev server).
`sections.gStyle`, `rStyle`, `oStyle`, `bStyle`, `wStyle`: `auto` (follow `sections.style`; the default), `line`,
`rows`, `off`, and two drawn looks each:

| Section | Drawn look 3 | Drawn look 4 |
| --- | --- | --- |
| G | `relief`: the point on a drawn slope (valley floor to crest), slope band gauge, high ground marked | `chips`: terrain, height, slope band, landform, high ground, water, named area |
| R | `shield`: the road as a sign (number, from - to, length) with load, condition and closure chips | `verdict`: the rules check for the mode in large type, the route under it |
| O | `tiles`: natural beside man-made, each bordered by its effect for the mode | `gap`: the nearest canal or river reach drawn to width, depth and bank height |
| B | `where`: tehsil, district, sheet and border first (red under 10 km) | `protected`: worship, graves, health and schools first (no-strike, collateral) |
| W | `year`: twelve months of temperature range and rain, this month outlined | `icons`: high / low, rain and wind as large figures |

The drawn looks are in `GroundGuideSectionsStyles.ts`; R keeps the road-density block (its own setting) in every look.

API: `guide.sectionsAround(pointOrLngLat, { profile, radiusKm })` → `GroundGuideSections | null`, read at the bundle's
finest zoom with every section on; `guide.sectionsText(point)` → Copy as Text lines. `v.sections` on a live verdict.
`guide.roadDensityAround(pointOrLngLat, { radiusKm })` → `RoadDensityReading | null` (null when the bundle has no
routing network). Test panel: Ground Guide → Ground, Roads, Buildings & Weather → *Log ground at centre*, and *Log*
beside *Density circle* for the road density alone.

#### Crossings from the sheet, bridges per section, satellite road (R; added 2026-11-10)

The 1:50k crossing layers record only the symbol (bridge, foot bridge, ferry, ford). The pipeline
(`grotbc.py crossing_labels`) now adds what the crossing's own name and the sheet's text beside it say:

| Attr | Meaning | From |
| --- | --- | --- |
| `bt` | type words: temporary, suspension, cantilever, wooden, rope, iron, masonry, natural, snow, boats, overhead, underpass, railway, foot, viaduct, causeway | name ("Wooden bridge", "FB", "Causeway") and the sheet's text ("Temporary wooden foot bridge", "Bridge of boats") |
| `bs` | `u/c` (under construction) or `disused` | text |
| `su` | months in use as written ("Oct-Apr"): ferries, fords, bridges of boats | text |
| `bo` | boats of a ferry | text ("Ferry (2 boats)") |
| `lb` | 1 = the crossing is placed at the label: no symbol of that kind within 1.5 km, so it is a few hundred metres out | text |
| `nb` (road lines) | bridges recorded on the road section (`NO_OF_BRS`, 7,085 sections) | Pakmap roads |

A label is tied to the nearest crossing **of a fitting kind** within 600 m (labels sit ~400 m from their symbol on the
sheets); when two are about as near it is tied only if one is of the label's own kind ("Foot bridge" → the foot bridge),
else it is left alone. A label with nothing fitting within 1.5 km becomes its own crossing (`lb` 1); between 600 m and
1.5 km nothing is guessed. Canal names that contain "ford" / "br" (Fordwah, 8-BR minor, Chak 17-8 BR) and hotels are
skipped. A culvert named "Foot bridge" keeps its name but takes no type. Build of 2026-11-10 (v2k): 692 types from
own names; of the sheet's ~4,000 crossing labels 1,731 tied (55 of them by kind), 486 ambiguous (left), 655 too far to
tie (left), 933 new at the label (mostly foot bridges and causeways). In the bundle: 2,208 crossings with a type,
282 ferries with boats, 27 with months, 8 with a status; 7,637 road lines with `nb`.
Number-only names ("25", "1") stay in the data as they are; the card never shows a number as a name.

**Satellite road (HeiGIT Planet, PlanetScope 2020 / 2024).** `network.py` joins the HeiGIT arterial roads on the OSM
way id (97.8 % of its 40,107 ways are in the routing graph; 81–93 % of motorway to secondary km covered) and packs
surface 2024, width class (< 3.5 m light vehicles only, 3.5–5.5 m one lane heavy, > 5.5 m two lanes heavy), paved
since 2020 and the passability score into the edge's `pad` (GeoCore requires the field name and ignores the value)
and a last `hg` array of the GGR1 tiles. **It never raises a road**: the map's record and class stay what decides.
Build v2k: 186,234 edges (67,246 km) carry it; 4,389 km unpaved in 2024, 1,488 km under 3.5 m, 7,467 km paved since
2020 (`network.json stats.satellite`).

**On the card** (`GroundGuideSections.ts` / `GroundGuideSectionsView.ts`, `GroundGuideTrafficability.ts`):

- R **Crossing** row: the type as the sheet gives it, then boats, season, status and what it means for vehicles,
  safety first: "Suspension Br 1.2 km NE · Check before vehicles cross", "Ferry 3 km E · 2 boats · in use Nov to Apr",
  "Causeway 800 m S · Under water in floods · at map label, ±500 m", "Br 2 km N · U/C · Not open: under construction".
  Foot, rope and railway bridges say "Foot only" / "Trains and foot only". Chokepoints and Culvert use the same label.
- R **Recorded** row: "... · 7 Brs on this section" when `nb` is recorded.
- R **Sat 2024** row: "Unpaved: SLOW-GO after rain · under 3.5 m: light veh only · N-55, 120 m E"; when the satellite and
  the map's route layer disagree under the point it says "map says metalled: check on the ground" and picks neither.
- T **road line**, vehicle modes: "· Unpaved by Sat 2024" / "· Under 3.5 m by Sat" after the road's class.

Licence: the HeiGIT Planet data is **non-commercial**, with PlanetScope derivatives; redistribution is subject to
Planet Labs terms (sources.lock `heigit_planet_roads` restriction, LICENSES sharing note).

**`D:\Imagery\Misc` review (2026-11-10).** Gauged before ingesting; only the Planet roads went in.

| Folder | What / date | Verdict |
| --- | --- | --- |
| Planet Road Surface, Width, and Passability | HeiGIT, PlanetScope 2020–2024, 40,107 arterial ways; publisher 89.2 % accurate; agrees with all 11,644 OSM-paved ways it classified | **Ingested** (network `pad`, cautions only) |
| Road Surface Data | HeiGIT Mapillary street photos, HDX snapshot 2024-11-07; predictions on only 21,712 of 1.42 M ways, photos 2013–2024; disagrees with OSM on 8 % of paved and 36 % of unpaved (publisher: over-predicts unpaved) | Not ingested: sparse, older, overlaps Planet |
| Airports, Buildings, Education, Financial, Health, POI, Populated Places, Railways, Roads, Sea Ports, Waterways | HOT exports of OSM, Geofabrik 2026-10-12 (STAC metadata); the pipeline's OSM extract is 2026-10-28 | Not ingested: same source, older; take any theme from the 2026-10-28 extract |
| Subnational Administrative Boundaries | OCHA COD-AB (WFP), boundaries 2022-09, reviewed 2024-09; 7 / 160 / 577 units; AJK and GB only for Kashmir | Not ingested: the bundle keeps the official Survey of Pakistan boundary |
| Trees | CTrees above-ground biomass 2025, 100 m, int16 × 10 Mg/ha | Not ingested: biomass, not canopy cover or height; would only be a hint (same open decision as the canopy height model) |
| Rainfall, Rainfall for Pakistan, NVDI | WFP CHIRPS rainfall and MODIS NDVI by province / division, dekadal, to 2026-10-21 / 10-11 | Not ingested: area averages that go stale; the climate layer is finer |
| Copernicus Vegetation Index Anomaly | JRC GDO fAPAR anomaly, dekadal 2026, 1/12° (~9 km) | Not ingested: too coarse |
| Waterways (PDF, saved Wikipedia page) | Reference documents; the saved page's `.php` files are its scripts and styles | Reference only |
| Bridges Big Dataset | `pakistan_bridge_dataset.zip` (7.44 GB, finished 2026-11-11 00:52; zip entries dated 2024-09-04 and 2025-07-02): a YOLO oriented-box training set, 5,181 PNG chips of 1000 × 1000 px (train 3,627 / val 1,036 / test 518) with one label file each, **one class ("bridge")**, 1.09 boxes per image. The PNGs carry no coordinates (no geotransform, no text chunks) and the labels no type or load class. No byte-identical images, but 1,079 label files are identical across splits and their images differ only in colour (mean pixel difference 5–29 against 54 for unrelated chips): the same scenes recoloured in train and test. Two `labels/*.cache` files are Python pickles (not opened) | Not ingested: nothing to place on the map. **Removed 2026-11-11** at the owner's request (sent to the Recycle Bin) |

Duplicates: `Railways of Pakistan` holds a copy of the waterways export (`hotosm_pak_waterways_osm_shp.zip` and its
metadata are byte-identical to the ones in `Waterways of Pakistan`; its waterways KML holds the same 45,776 features).
Within each HOT folder the GeoJSON, KML, SHP and GPKG zips hold the same features (counts match; the buildings SHP has
one feature fewer than the GPKG). `Rainfall/pak-rainfall-subnat-5ytd.csv` and `NVDI/pak-ndvi-subnat-5ytd.csv` are the
last five years of the `-full` files, and `Rainfall for Pakistan` is the same WFP figures in the HDX HAPI layout.

Rebuild order: a `grotbc.py --only features` rebuild must be followed by `ground.py`, then **`kmz.py --bundle`**, or the
7 Div overlay items are lost. The v2k build (2026-11-10, `work/run_v2k.sh`) missed it; v2l (2026-11-11,
`work/run_v2l.sh`) repackaged and put them back (1,157 points, 1,005 lines), and wrote `work/changed_20261111.txt`, the
bundle files written since before v2k, for the other machine. `sources.lock geonames_pk` now records `D:/Imagery/PK.txt`
as it is (230,753 rows: the 2025-12-22 dump plus the 809 overlay rows of `pk_kmz.py`, which grotbc skips).

#### Imagery and check points (started 2026-11-11)

The owner's 0.25 m imagery (`E:\Data From 477`, restricted) is not built into the bundle: it is the **truth** the
candidate sources are measured against first. Nothing from it or from a candidate goes into the bundle until the check
points show where it is right (safety first: a source that sees trees that are not there would overstate concealment).
Steps (`make imagery-index imagery-checkpoints`, then people label, then `make imagery-accuracy LABELS=...`):

1. **Index** (`scripts/imagery_index.py` → `work/imagery/index.json`, `latest.json`, `footprints.gpkg`, `summary.txt`):
   1,937 sheet GeoTIFFs read (header plus the coarsest overview, about 2 minutes); 253 ArcGIS mosaic-dataset overview
   copies (`*_DataSet`, `*.Overviews`) skipped. **1,777 unique sheets** after 158 copies dropped: 30 exact copies (the
   same file in a province folder and the Eastern 80 km folder), 119 same-year alternates (kept the one with less empty
   area), 9 older years (the newest kept). Imagery years: 2023 848 sheets, 2024 693, 2025 85, 2022 78, 2012–2021 73.
   Mostly 0.24–0.27 m; 41 at 0.30 m, 25 at 0.47–0.59 m, 6 at 0.13 m. Problems found: `Balochistan\39A15-24(2024).tif`
   corrupt; `Gilgit Baltistan\43M9-25(2021).tif` has a broken pyramid file (an `.autolock` beside it: the build was
   cut short), so it is not read; 4 Eastern sheets are in Web Mercator (handled); 5 Balochistan sheets (31J16, 31O13,
   35B3, 35B5, 35B6) have no CRS tag but a geotransform in degrees (taken as WGS84, flagged); 30 files have malformed
   names (`40L13-25(2023.tif`, `44I10-(2024)z20.tif`, `35B6-25N2023).tif`, `.38O8-24(2023).tif`), all read; 11 chosen
   sheets are more than 20 % empty. The `.xml` sidecars hold only the 2025 pyramid-build date; the year in the file name
   is the only imagery date.
2. **Check points** (`scripts/imagery_checkpoints.py` → `work/imagery/checkpoints/`): 640 random points, 80 in each of
   eight kinds of ground (about 75 kept after chips that are more than 30 % empty are dropped) by the bundle's class layer (trees, crop, open, desert, rock / hill, built-up, water, mapped
   tracks), one per sheet and kind, in the latest sheet. Each has two chips (the 38 m bundle cell at ~0.5 m in a 120 m
   square, and 480 m round it at ~2 m) and what every source says there: the bundle's class, `cc` and route layers;
   ESA WorldCover 2021; CTrees biomass 2025; Meta / WRI canopy height **v2** (2026, imagery dated per patch, 2018–2019
   at the first Pakistan points) and v1 to compare.
3. **Labels**: `work/imagery/checkpoints/label.html` opens from disk (or the dev server); it shows only the chips, never
   what the sources say, so the labels are not led by them. Per point: what mostly covers the cell, tree crowns in it
   (none, under 10, 10–30, 30–60, over 60 %), any road or track, or "can't tell". Keys 1–8, Q–T, A–F, Z / X; it saves
   in the browser; Export writes `labels.json` (complete points only). About 1–2 s a point. Several people can label;
   points they disagree on are listed, not averaged.
   **Pre-fill (owner's choice, 2026-11-11):** every point carries a first guess made by looking at its chip
   (`guesses.txt` → `scripts/imagery_prefill.py` → `prefill.js`; 636 guesses: bare 175, crop 122, built-up 80, trees 70,
   shrub 67, open 49, rock 41, water 31, one "can't tell" for a cloud). The page shows a guess dashed, never as an
   answer: **Enter** accepts the guesses still open on the point, a key replaces one. Each label records the answers that
   were a guess accepted unchanged (`guessKept`), and `imagery_accuracy.py` reports that share beside the scores,
   because a pre-fill can lead people to agree with it. The guesses belong to this `points.json` (seed 20261111).
4. **Scores** (`scripts/imagery_accuracy.py` → `work/imagery/accuracy.md`): per source and kind of ground, how often it
   agrees; for trees, the share of real trees found and the share of **false trees** (the error that would overstate
   concealment); for roads and tracks, mapped-and-seen, mapped-but-not-seen, seen-but-not-mapped.

**Results (2026-11-11, 631 labelled points, `work/imagery/accuracy.md`).** The owner confirmed all 636 points (5
"can't tell"); 1,750 of 1,893 answers were the pre-filled guess accepted, 131 were changed (mostly "no track" →
"footpath / Tr", 62). So the scores compare each source with what the guesser and the owner both read in the 2023–25
imagery, not with an independent survey.

| Question | Finding |
| --- | --- |
| Tree crowns on 10 % or more of the cell (C) | Bundle tree class finds 29 % of such cells; 27 % of its tree cells have fewer. WorldCover finds 52 % (26 % false), canopy map v2 49 % (25 % false), v1 39 % (21 % false), CTrees 62 % but **60 % false** (not to be used). Canopy map v2 is graded: share of the cell 3 m or taller 60 % + → 92 % of cells have crowns, 30–59 % → 81 %, 10–29 % → 67 %, 1–9 % → 47 %, 0 → 14 %. Where the bundle says trees but WorldCover and v2 both say none, 6 of 7 cells had none. The `cc` layer does not follow crowns (cc 50–74 has crowns in 42 % of cells, cc 25–49 in 46 %). |
| Cover (G) | Bundle class agrees 48.5 %, WorldCover 57.7 %. `sand` cells are mostly shrub (21 of 33), `open_land` is a mix (bare 19, shrub 18, rock 13, open 9), `wetland` mostly dry (9 of 11), a third of `water_permanent` dry (9 of 27), `tree_cover` half crop fields with tree lines (23 of 73). |
| Roads and tracks (R) | A mapped route in the cell was seen in 49 of 91 cells; 37 more were seen one cell away from a mapped route (positions off by about a cell). 112 cells had a road or track mapped nowhere near: 97 footpaths / tracks, 10 unmetalled, 5 metalled. |

Proposed from these (not built until the owner chooses): C1 canopy map v2 as a graded "tree crowns" hint on the card
with the measured odds and "check on the ground", never raising concealment; C2 "trees may be gone" where the bundle
says trees and both other sources say none (lowers what the card may overstate; small sample); G1 a shrub class from
WorldCover instead of `open_land` / `sand` where it sees shrub (needs a class and rules change, full rebuild); R1 a
track finder trained on the imagery (days of work and GPU time). CTrees is dropped.

Sources are tagged in `sources.lock` with `stage: candidate` (`imagery_477`, `ctrees_agb`, `chm_meta_wri_v2`,
`chm_meta_wri_v1`): dated and located, but left out of the bundle's manifest and LICENSES (`package.py in_bundle`) until
one passes and a product reads it. Then the regeneration: a tree / shrub layer folded into `cc` (C, aerial
concealment, as a hint unless the scores say otherwise), land-cover fixes (false cropland in the desert), and track
positions (R), followed by the usual partial rebuild and `kmz.py`.

### Extended View (F)

User, 2026-11-12: the separate OCOKA lens of 2026-11-10 is gone and its name with it. GROTBC stays the one picture; much
of what the lens gave was already in it, so the rest is **added** to it while **F** is on. F turns the Extended View on
and off at any time the guide is on (drawing or not); it is **not kept** in the settings: it starts off, and turning the
Ground Guide off (Ctrl+G, or `features.groundGuide`) clears it. **Nothing in it is worked out while it is off**: no sight
reading, no fan, no approaches, no better position, no threat marker.

With it on:

- **The Ground Detail** gains three tabs **before the Legend**: **1 Obsn & Fd of Fire**, **2 Key Gr**, **3 Approaches**
  (their tab buttons carry a blue top edge). **O** gains a tile *Obs Toward the Threat* (the nearest NO-GO toward the
  threat, whether fire covers it, how much of the arc it lies across, the nearest SLOW-GO) and **C** a tile *Concealment
  in Crops* (the month's crop mix); both captions carry an *F · Ext View* tag. While it is off a dashed **F Ext View** tab
  stands where the three will be, saying what it adds, and a click on it turns it on. F off on one of its tabs goes back
  to the tab before it.
- **The cursor card** keeps its GROTBC rows and gains one short block: the threat and the weapon, then *Fd of Fire*
  (with *Threat sees / may see* when the threat's place probably sees the spot), the lead *Key Gr*, and the first
  *Apch*. The foot always shows **F Ext View** (lit while on); **J Better 240 m N** joins it once a better position is
  worked out.
- **The map** gets the yellow threat marker, the fire fan, the lines of sight, the threat's view, the approaches and the
  better position (*On the map*, below), and the overlay paints what can be seen (`extended.overlay`).
- **The Gr Scope rail** (V) reads in its Extended mode (below); its foot shows **F Ext View** off, **F Close Ext** on.
- **The H chip** gives the fields of fire and points to the better position; **Copy as Text** adds the Extended View's
  lines under the GROTBC brief.

**Keys.** GROTBC keeps its keys. **F** on / off. With it on: **1 2 3** open its tabs (again for the next page, Shift
back), **[** and **]** turn the threat by 15 degrees (Shift: 45), **J** takes the better position the map shows, the way S
takes clear ground. With it off the digits, brackets and J are left to the app. `extended.keys: false` takes F away.

**Enforce mode** stays on the GROTBC GO / NO-GO rule. An Extended View reading is a judgement and never blocks a
placement; the card's verdict bar is the GROTBC verdict.

**The threat** (`extended.threat`): `front` (the default) is the unit's front, `footprint.bearingDeg`; `bearing` uses
`extended.bearingDeg`; `point` judges toward `extended.at` (a place on the map) from wherever the symbol is; `allRound`
every direction. It is NOT read from enemy symbols. The yellow **Threat marker** (`GroundGuideThreat.ts`, a DOM handle
over the view, shown only with the Extended View on or the rail at its AOR scale) shows it: docked at the top of the map
it gives the bearing; dragged onto the map it sets `point`; a double-click returns it to the front. `extended.sectorDeg`
(30 to 180) is the arc judged. The threat's place is kept in the settings (the Movement and Platoon Guides read it).

**How sight is judged** (`GroundGuideOcoka.ts`, the OCOKA engine: pure, no imports; `GroundGuideOcokaRead.ts` assembles the
reading; the code keeps the doctrine's name, the screen does not). A 30 m elevation cannot show towns, crops, bunds or
walls and is itself good to about a metre, so a point is seen with a *chance*: the share of the target that clears the
terrain horizon (soft over 1 m), times the chance that nothing mapped stands in the line. Buildings come from the bundle's
building layer (density, footprint, height), tall crops from the month's crop mix, trees, bunds, walls and orchards from
their ground class (`OcokaDoctrine.json` `surfaceBlockers`, `cropCalendar`: proposals to correct). Nothing is random.
Three figures are given: on the ground alone (the upper bound), expected, and sure (80 % or more). `extended.surface:
false` judges on the ground alone. The cards say "may be seen" and "check on the ground".

| Tab | What it gives |
| --- | --- |
| 1 Obsn & Fd of Fire | For the symbol's weapon (`Rng`: direct fire at a standing man, or anti-armour at a vehicle; small arms 300 m when it has none; indirect and air-defence weapons "need an observer"). Good / Marginal / Poor on two tests, the lower stands: the clear distance to the first dead or screened ground (270 m good, 100 m marginal, 200 m the minimum for a primary task) and the share of the weapon's range that is seen (50 % / 20 %). Dead ground (terrain) is told apart from screened ground (crops, buildings, trees). Tiles: the viewshed picture, the seen share by range band, the threat's view, the better position, Obsn (country by how far the view reaches, share of the ground within `extended.radiusKm` that may be seen, what overlooks the point and from what share of the directions), weather and light (the month's visibility; `speed.light: night` reads the coming night as moonlight or starlight and the weapon's night sight on an ordinary, a haze and a fog day). |
| 2 Key Gr | The ITG candidates within the radius **ranked** (`rankKeyGround`): strong candidates, ground higher than the Posn, ground within 1 km of an approach (*Overlooks Apch 1 · 526 m*) or its narrows (*Covers the narrows*), ground toward the threat and ground in view of the Posn rank higher, nearer ground a little; the bundle's dominance and MSR-in-view add a little. The weights are a proposal. The answer names the **lead candidate** with why it leads; tiles: a round **Key Gr map** (north up, turned with the map, scaled just past the farthest candidate: the Posn, rings, the threat's arc, the approaches with chokepoints, a line of sight to each candidate coloured by the chance, the highest Gr ▲, the candidates numbered by rank), the **ranked list** (the lead as a card with its reasons as chips and the bundle's measures, the others two lines each), and **Heights Against the Posn** (the Posn on the middle line, the highest Gr and each candidate above or below it). Candidates only: the commander designates ITG / MITG (`designateGround`). |
| 3 Approaches | The approaches from the threat, with their chokepoints for the formation's frontage (On the map, below), then the straight ways out to 2 km in 24 directions for the mode: GO, SLOW-GO (half the way or more), or stopped by NO-GO, and what stops them. |

**On the map** (2026-11-11; `GroundGuideOcokaMap.ts`, layer `ms-ground-guide-ocoka` titled *Ground Guide Extended View*,
draped on the ground; geometry from `ocokaSight()` / `ocokaPlan()` in `GroundGuideOcokaRead.ts`). While a symbol is being
placed with the Extended View on, the reading is drawn where it applies, each product with its own switch:

| Product | Switch | What is drawn |
| --- | --- | --- |
| Fire fan | `extended.mapFan` | The arc toward the threat out to the weapon's range (yellow outline). Inside it **dead ground is red** (the terrain hides it) and **screened ground amber** (crops, buildings, trees probably hide it); ground left clear is ground that may be seen. |
| Lines of sight | `extended.mapSight` | From the position to each ITG candidate: green when it is probably in view, amber dashed when it may be, red with a cross where the line is lost. |
| Threat's view | `extended.mapEnemy` | Only when the threat is a place (the marker dragged onto the map): a 40 degree wedge from it toward the position, the ground it may see in violet, and its line to the position, with a cross where that line is lost. Its eye is a vehicle commander's (2.4 m): the higher eye sees more, so the threat is never understated. |
| Approaches | `extended.mapApproaches` | The cheapest way in for the mode from the threat's place (or, with only a direction, from a start up to 5 km out on that bearing: the card says "From N", not "From marker"). SLOW-GO ground costs three times GO, ground narrower than the frontage up to four times more, NO-GO is never crossed. Width is twice the distance to the nearest NO-GO ground. A second approach is drawn (dashed) when it shares less than 60 % with the first and costs at most 2.2 times as much. **Chokepoints** (diamonds) are where the passable ground is narrower than the frontage: "Gap in Permanent water 85 m", or the bridge or ford itself. |
| Better position | `extended.mapBetter` | A green ring and a line to it when a position within 300 m (12 bearings every 60 m, on ground the mode can use) has clearly better fields of fire toward the same threat for the same weapon: a better grade, or 15 points more of the range seen. **J** places the symbol there (`guide.takeBetter()`), refused if the GROTBC rule does not accept that ground. |

The frontage is the echelon's (`footprint.*`, section to brigade); a symbol without one is judged at 100 m. The fan, the
lines and the threat's view follow the cursor (at most every 60 ms); the approaches and the better position are worked
out once the cursor has rested for 220 ms. All of it is the same chance as the cards: a clear patch in the fan *may* be
seen, "unlikely to see" is not "cannot see". Check on the ground.

**The H chip** (`extChip()` in `GroundGuideExtendedView.ts`, `hintParts()` in `GroundGuideBadge.ts`). The chip keeps its
GO / SLOW-GO / NO-GO word and colour: it is the rule, and the one enforce mode applies. With the Extended View on, on
ground the mode can use, the figure beside the word is the fields of fire for the weapon (`Fd of Fire Poor`; the country
when the weapon needs an observer), with `· Threat sees` when the threat's place probably sees the spot, and the pointer
is to the better position (`Better Posn 240 m N`, which J takes). On NO-GO ground the share inside and the way to clear
ground come first, as with it off.

**The map overlay** (`extended.overlay`, with `overlay.enabled`; `ocokaViewshed()` in `GroundGuideOcokaRead.ts`, drawn by
`GroundGuideOcokaMap.showOverlay()`). With the Extended View on, the overlay paints what can be seen instead of the going:

| `extended.overlay` | What is painted |
| --- | --- |
| `auto` (default) | `threat` when the threat is a place, else `view`. |
| `threat` | **All the ground the threat may see** from the marker's place out to `extended.radiusKm`, in violet, inside a dashed circle. What is not painted is out of its view: covered ground, and covered approaches where it joins up. Read for a vehicle commander's eye (2.4 m, never understated) looking for the mode's unit (a vehicle for tracked and amphibious modes, else a standing man). It does not follow the cursor and shows whether or not a symbol is being placed; it is worked out again only for a new place, radius, month or tile. Nothing is painted when the threat is only a direction. With it on, the threat's 40 degree wedge toward the position is not drawn (its line to the position still is). |
| `view` | **All the ground that may be seen from the position** being placed, in light blue (green is lost on green hills), out to the same radius, for the unit's own eye and a standing man. Gone while the cursor moves, drawn where it rests (220 ms), cleared when nothing is being placed. |
| `going` | The GROTBC paint of GO / Marginal / SLOW-GO / NO-GO ground, as with the Extended View off. |

Ground is painted where it is seen with an even chance or better, in slices a ray wide (rays half a degree apart or
finer). Cost: about 11 ms for the view from the position (once per rest); the threat's view is the same sum, once per
change. Unpainted ground is *unlikely* to be seen, not safe. The Detail's Threat's View tile names the violet.

**Copy as Text** (`extendedText()` in `GroundGuideExtendedView.ts`). With the Extended View on, the Detail's Copy as Text
gives the GROTBC brief, then the Extended View's lines for orders: the head (position and height, month and light, the
GROTBC verdict, the threat and how far off it is when it is a place, the weapon with the kind of figure behind its range:
doctrine, catalogue, typical, estimate; the target, the eye, the frontage); **1 Obsn & Fd of Fire** (country, view, the
three seen figures, what overlooks the position, grade and what holds it down, clear distance, seen / dead / screened,
the seen share by range band, the two tests, the night and the night sight, the month's visibility); **Threat's View**
and **Better Posn** when there are any (the latter with the warning that cover there is not compared); **Obs Toward the
Threat**; **Concealment in Crops**; **2 Key Gr** (the highest ground, every candidate in rank order with why);
**3 Approaches** (every approach with every chokepoint and its distance from the position, then the straight ways out).
`await guide.extendedText(point, { sidc, profile, radiusKm, threatDeg, frontageM })` returns the same lines to a host for
any point (works with F off too), with the approaches, the threat's view and the better position worked out
(`frontageM` 100 m when not given).

**In the Gr Scope rail** (V; `GroundGuideScopeOcoka.ts` turns the products into the rail's frame, `GroundGuideScope.ts`
draws them, `extScopeText()` gives the words). With the Extended View on, the rail reads the same spot as before (the
symbol being placed, else the selected symbol, the one just placed, the map centre), so **a symbol already on the map
gets its fan, its dead ground and the approaches to it without being placed again**: select it. What changes on the rail:

- **The bar keeps the GROTBC verdict** (colour and title): an Extended View reading is never a GO / NO-GO.
- **Under it** a third line: the *Ext View* tag, the threat (`Threat NE 67° (marker) · 90° arc`) and the weapon with its range.
- **The answer**: the fields of fire for the weapon in their grade's colour (`Fd of Fire Poor · clear 191 m`; the country
  and the view when the weapon needs an observer), then the better position (`Better Posn 240 m N: Fd of Fire Marginal`,
  with **J** while placing a point), then whether the threat is likely to see the spot.
- **The map** holds the weapon's fan: a spot with no echelon gets the closest level that still holds the range (300 m
  small arms: the Pl's 720 m map; a tank's 2 km: the Bn's 3.6 km), an echelon keeps its own level, widened if the fan
  needs it. The going is not coloured (that is T's): plain ground with NO-GO in blue-grey. On it the fan with dead (red)
  and screened (amber) ground, the lines of sight to the ITG candidates, the threat's view in violet and its line to
  the spot, the approaches (the second dashed) with a diamond at each chokepoint, the better position as a green ring,
  and the threat as a yellow marker, or a yellow pointer at the edge with its distance when it is off the map. The
  frontage, the rings and the clear ground are drawn as in GROTBC.
- **The legend** has five lines, each its layer's switch (remembered apart from the GROTBC switches), badged with the key
  that opens the matching Detail tab: **1** seen / dead / screened shares of the weapon's range and the country (the
  fan); **C** the cover letter's two fields and the month's crops (trees and built-up ground on the map); **O** the
  nearest NO-GO toward the threat and whether it is covered by fire (NO-GO ground and water); **2** the lead Key Gr and
  the highest ground (hills, ITG diamonds, ridgelines, the lines of sight); **3** the approach's length and where it
  narrows for the frontage (approaches, chokepoints, the threat and its view, the main roads drawn thin).
- For a spot that is not being placed the fan and the threat's view are worked out at once and the approaches a quarter
  of a second after the spot has come to rest (the map centre moves with every pan). The map centre is not a position:
  no better position is offered for it. A redraw of the rail costs about 13 to 21 ms with the Extended View against 17
  to 20 ms without.

**Cost** (measured 2026-11-10 and 11): the reading takes about 1.5 ms per mouse move; in the app a move costs about 5 to 6 ms
with the Extended View against 4 ms without (card redraw included). The fan, lines and threat's view cost about 6 ms a
draw (7 ms at the 90th percentile), the approaches and better position about 18 ms once per rest (threat 6 km off, card
redraw included). The viewshed picture (6 to 8 ms) is only traced while the Detail shows tab 1. A reading is kept per 30 m
cell. With the Extended View off none of it runs.

**API.** `guide.extended`, `guide.setExtended(on)`, `guide.toggleExtended()`, `guide.setThreat({ threat, bearingDeg, at,
sectorDeg })`, `guide.turnThreat(deg)`, `await guide.extendedAround(pointOrLngLat, { sidc, profile, radiusKm, threatDeg,
picture, map, frontageM })` → `GroundGuideOcoka | null` (waits for the tiles; `map: true` adds `sight` and `plan`, the map
products as Web Mercator geometry, for a host that draws them itself), `await guide.extendedText(point, opts)` → the
Extended View's lines, `guide.takeBetter()` (J), `guide.setRangeLookup(fn)` for a host with its own catalogue. Events
`ground-guide-extended` `{ on }` and `ground-guide-better` `{ at, distanceM, compass, grade, from }`; `v.extended` (on /
off; null without its keys) and `v.ext` (the reading, with `sight` / `plan` once worked out) on a live verdict. Settings:
`groundGuide.extended.*` (Ctrl+K group *Extended View (F)*). Test panel: Ground Guide → Extended View (F) → *Turn on / off*,
*Log Ext View at centre*.

The data behind it:

- **`Rng` in `MS/Data/Symbols.json`** (90 entries: small arms, MGs, grenade launchers, AD guns and missiles, anti-tank guns,
  recoilless rifles, howitzers, mortars, rocket launchers, anti-tank rockets and missiles, tanks, APC, infantry / armour /
  anti-tank / artillery / mortar / AD units, sensor radar). Read it with `SymbolMetadataService.getByKey(key)?.Rng`.
  `dir`, `at`, `ind`, `ad` are `[min, eff, max]` metres (direct fire vs troops, vs armour, indirect, vs aircraft); `nv` is the
  weapon's night-sight range `{ moon, star, ti }`, `nvObs` the crew's best night observation range, `obs` a sensor's reach.
  `eff` is the figure to plan own fire on, `max` what to assume can reach you. `b` is the basis of the weakest figure:
  **D** read from a pamphlet in `Material/` (IC, IBB), **C** from `WeaponEqptV3.json`, **T** a typical public figure,
  **E** my estimate; `s` says where each figure comes from. T and E are for the planner to correct, they are not doctrine.
- **`MS/Data/OcokaDoctrine.json`**: everything that is not one symbol's own range: the pamphlets' ground-appreciation headings
  (fire position, observation, cover from fire, cover from view, cover from NVDs and surveillance radars, obstacles,
  approaches), field-of-fire minima (100 / 200 m, 270-500 m desirable), country classes by field of fire (close 400-500 m, very
  close 100-200 m), night-vision ranges, stand-offs, frontages and depths, canal / ditch / anti-tank ditch dimensions,
  reverse slope, surface blockers, a crop calendar (a proposal), threat sets, the threat-axis option and 19 judgement rules.
  The D figures come from Pakistan Army pamphlets: the file carries a handling note, keep it under the same terms.
- **Not in the bundle:** Ditch Cum Bund lines and anti-tank ditches (the NCGDB feed has only the bund class), enemy-placed
  obstacles, and the enemy's direction. The Extended View reads obstacle symbols from the map and the planner sets the threat axis.
- **Visibility grid** (`visibility/visibility.json` + `.bin` in the bundle, manifest `grotbc.visibility`, source `gsod`):
  NOAA NCEI Global Summary of the Day, 2016-2025 (2025 stops on 24 Aug), 174 stations, on the climate grid (5 arc-minutes,
  `int16`, 49 layers). Per month `vis_mean_NN` (0.1 km, capped at 16 km), `lt2km_NN` (% of days under 2 km), `haze_NN` (% of
  days with a view of 3 km or less and no fog / rain / snow / hail / thunder flag: a proxy that also catches dust and smoke),
  `fog_NN` (% of days with the fog flag), plus `dist` (km to the nearest usable station, read it: over 100 km is a guess,
  and Gilgit-Baltistan and the far south-west of Balochistan are over 150 km). GSOD gives a daily mean view, so short fog
  episodes are understated. Daylight and moonlight are calculated, not stored. **Licence:** NCEI allows non-commercial use
  and says that for non-U.S. locations the data or any derived product shall not be provided to other users or used for
  the re-export of commercial services: keep this layer inside the already restricted bundle, and leave it out of a bundle
  that goes to another party (`package.py --visibility <missing folder>`, or delete `work/visibility`). Rebuild, from
  `tools/terrain-pipeline`: `scripts/fetch_gsod.py --years 2016-2025 --workers 3`, then `scripts/visibility.py`, then
  `scripts/add_visibility_to_bundle.py --bundle ../../MS/Data/terrain-bundle --backup work/backup/manifest_20261110.json`.
- **Test program** (`tools/ocoka-test/`, see its README): runs the library's own engine (`GroundGuideOcoka.ts`) in Node, with
  33 checks (`node tools/ocoka-test/run.mjs`): synthetic cases with a known answer, sun and moon, nine real sites, cost, and
  an independent line-of-sight check (99.3 % agreement); plus an interactive page.
- **Ranges that differ from the doctrine** in `WeaponEqptV3.json` (left unchanged): G-3 274 m (doctrine 300 m effective,
  400-500 m confident), 106 mm RR 1300-1400 m (2000 m direct, 7600 m indirect), GLHMG 600 m (800 m on emplacements, 1750 m on
  troops), RPG-7 500 m (180-275 m to destroy a tank), 81 mm mortar 4100-4200 m (4550 m), 120 mm mortar 6747 m (5700 m POF,
  6602 m Brandt), 105 mm how 11000 m (11274 m), 130 mm gun 27150 m (27478 m).

### Gr Scope AOR scale (Shift+V)

User, 2026-11-11 (from the mockup `ground-guide-aor-options.html`, "add all with the user able to switch it on the fly").
**Shift+V** switches the Gr Scope rail between **Spot** (the rail above: the ground round one symbol) and **AOR**: the area
of ops read as the *Gr and Weather* factor of a defence appreciation, in the headings of `Material/AprDf.pdf` and the
marking of `Material/Vs72.docx`. It is a plan to check on the ground, never a fact: what the bundle cannot know is left
blank (`____`) or listed under Confirm on Gr.

**What it reads.**
- **The MITG:** a VG (Vital Gr, `designateGround(..., 'MITG')`) symbol on the map, else the selected or placed symbol, else
  the map centre (snapped to 250 m). `guide.setAorAnchor(point | null)` overrides it.
- **The threat:** the Extended View's threat. A place (the threat marker, which also shows in the AOR scale), else a bearing, else the
  unit's front.
- **The outline** (`aor.source`):
  - `boundaries`: the nearest Boundary symbol (2525D set 25, entity 110100) on each side of the MITG, cut to the echelon's
    depth.
  - `box`: a box dragged on the map (Draw in the rail, `guide.drawAorBox()`). The drag does not pan; Esc cancels.
  - `echelon`: a frame facing the threat: Coy 2 x 4 km, Bn 7 x 12 km, Bde 14 x 18 km forward of the MITG (a proposal).

  A missing box or pair of bdys falls back to the frame, and the rail says so.

**What it gives** (`GroundGuideAor.ts`, pure):
- **Three approaches** (Lt, Cen, Rt as the defender faces the threat), from starts forward of the AOR (`aor.leadKm`, or
  round the threat's place) to the MITG.
  - The search is the Extended View's own: NO-GO is never crossed, SLOW-GO is dearer, and ground narrower than the threat's
    corridor is dearer still. The corridor is two echelons up (`aor.corridorM`; 0 gives Coy 1 km, Bn 2 km, Bde 4 km).
  - It runs on the finest class tiles at 1 to 4 pixels a cell. A cell takes its highest-rank class, so a canal stays a line
    and a bridge stays a gap in it.
  - Each approach gets: where it crosses the border (`boundaries.geojson`: WB, LOC, international) and what it is near
    there; the places it passes through; the water it crosses, with the nearest bridge; the roads along it; and the BUA
    and tree share of a 1 km band.
  - Its capacity is the gap across it between NO-GO areas big enough to matter (a quarter of the corridor, squared).
    Canals and streams are crossings, not narrowings.
  - Rank: shortest past the border and least friction first.
- **Lines of def:**
  - W, X and Y are cuts square to the axis where a BUA is astride each approach. They are scored on a water line or ridge
    across two approaches, a metalled lateral, and a forward bonus.
  - Z is the cut through the MITG.
  - Roles: FDLs on the first line with a BUA or obstacle on every approach, a screen in front, depth 2 km or more behind,
    and the strong point on Z.
  - The FDLs' frontage between the bdys is tested against IBB's Bn three coys up (6.5 km; Coy 2 km, Bde 12 km). In the
    echelon frame the rail says the frame sets it.
- **MITG:** the road through it, and the MSR within 1.5 km.
- **Demolition:** bridges within 1 km of where an approach crosses water. None carries a load class in this bundle.
- **Laterals:** metalled roads of class 30 and up that touch two approaches.
- **Going:** GO / SLOW-GO / NO-GO shares in the AOR, NO-GO areas in it and beyond it, and the country (Canal plains, Plains,
  Riverine, Desert, Mountains, Built-up), from the class shares.

**The rail.** Every option of the mockup is kept. They switch on the fly from the rail's foot, and also from the settings,
Ctrl+K and the API.
- **A Deductions:** six lines under the map (Going, Apchs, Lines, MITG, Dml, MSR), each line its layer's switch.
- **B Sand model:** a 397 x 520 map with names and roles on it, and three lines.
- **C Appreciation:** a small map and AprDf's tables.
- **Trace or Dark.** Trace is Vs72's marking on a talc colour: NO-GO crisscross, SLOW-GO parallel lines, green natural,
  black artificial.
- **N↑ or T↑:** north up (turns with the view) or threat up (as a sand model faces the enemy).

The mode line switches the source (Bdys / Box / Ech, with Draw for the box). Lines are cut at the bdys and lettered front to
rear. The reading is worked out once per AOR, 260 ms after the map rests. At Phillora a Bn AOR takes about 0.45 s: cells
77 ms, approaches 300 ms, lines 26 ms (`reading.msParts`).

**D** (with the AOR scale shown) opens the approach sheets beside the rail (`GroundGuideAorSheet.ts`):
- one tab per approach, under AprDf's twelve sub-heads (Obsn points to the Extended View, F then 1);
- ITGs & Ded: the MITG, the ITGs on the FDLs and depth, the priority of approaches and of combinations, the lines with their
  roles, DP 1, the frontage and the prelim dml;
- Confirm.

**Copy as Text** gives the paragraph in AprDf's numbering: 6 Apchs, 7 ITGs, 8 Obs, 11 Deductions. The GROTBC letters still
open the Ground Detail, and Esc closes the sheets first.

**API.**
- `guide.scopeScale`, `setScopeScale('spot' | 'aor')`, `setAor(patch)`, `setAorAnchor(point | null)`, `drawAorBox()`,
  `aorReading()`, `aorText()`.
- Event `ground-guide-aor` `{ reading }`. `ground-guide-scope` carries `scale`.

**Settings** (`groundGuide.aor`):
- `keys`, `scale`;
- `layout` (`deductions` | `model` | `appreciation`), `style` (`trace` | `dark`), `orient` (`north` | `threat`);
- `source` (`echelon` | `boundaries` | `box`), `box` ([w, s, e, n]), `echelon` (`auto` | `coy` | `bn` | `bde`);
- `leadKm`, `corridorM`, `profile` (the threat's mover, `tracked`).

The layer switches are kept in the rail's own store (`ms-gg-scope`).

**Checked at Phillora** (Vs72's own ground), with the threat placed near Arnia and the Bn frame:
- the Cen approach starts at Arnia;
- the Lt approach runs through Khokhar, Budhe and Saidanwali to Phillaurah;
- bias Lt;
- MSR Sialkot – Nainkot 70A1, 0.9 km off; the road through the MITG is Chawinda – Sabaz Pir 30A1;
- none of the 47 bridges in the AOR has a class.

**Open:**
- DCB is not in the bundle (Vs72's lines W and X follow it).
- The frame sizes and corridor widths are proposals.
- Not checked in 3D with a rotated view, or against a second exercise.

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
  "indicators": { "enabled": true },
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
  "itg": { "enabled": true, "radiusKm": 3, "max": 2, "minLevel": 1 },
  "card": { "cursor": "minimal", "briefKey": true, "...": "the A-H card sections, shown only with cursor: full" },
  "scope": { "enabled": true, "side": "right", "tab": true, "topPx": 54 }
}
```

`scope`: the Gr Scope rail. `enabled` (V shows and hides it; off: no rail, no V key), `side` (the edge of the map it
docks to), `tab` (the `V · Gr Scope` tab at that edge while it is hidden), `topPx` (room left free above it for the
host's toolbar; it also docks inside any `view.padding` the host sets). `aor`: the rail's AOR scale (Shift+V); see
"Gr Scope AOR scale" above.

`groundGuide.*` is read live: changing `bundleUrl` reloads the bundle, the rest applies on the next mouse move.

Every value is validated. One that is not valid for its setting (`"units": "yards"`, `"mode": "enforse"`,
a `blockOn` entry that is not a verdict, an `overlay.profile` the bundle does not have, a string where a
switch is expected) is ignored and the previous value stays; a number outside its range is moved into it.
`guide.setOptions(patch)` returns the list of these (`{ path, value, reason }`), and each distinct set
is written once to the Engine Log, so a typo in a settings file does not fail silently. An overlay profile
chosen before the bundle was known is checked when it loads and falls back to `auto` if it is not there.

Registered in the ⚙ Settings menu and the Ctrl+K palette as **Ground Guide**. **Ctrl+G** switches the guide on and off
from the keyboard (`SymbolEngine.toggleGroundGuide()`, the same as `features.groundGuide`, published on the settings bus so
every panel stays in step), with a toast at the foot of the screen that says the new state and whether the terrain data
is ready, loading or unavailable.

**Keys** while the guide is on (handled by the guide itself, listed in the harness's Show Shortcuts and the Legend tab):
**V** Gr Scope rail (any time) · **Shift+V** its Spot / AOR scale (in AOR, **D** the approach sheets) · **D** Ground Detail, **G R O T B C** its tabs, **K** its Legend, **Esc** closes it ·
while drawing **S** Quick Fix, **P** change the mode, **H** shrink the cursor card to a chip, **Shift**-click to place
against an Enforce refusal.

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
[16 Ground Guide card: GROTBC handover](MS/Docs/16-ground-guide-grotbc-card.md) has the decisions, style guide and the full
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

Order: the bundle's entity overrides (`rules.json profileOverrides.entities`, longest prefix first), then the
mobility amplifier (land equipment), then the built-in entity defaults, then the symbol-set overrides and defaults.
Until 6 Nov 2026 land-equipment tanks and APCs were judged as wheeled; the Speed block already used tracks for them.

| 2525D symbol set | profile |
|------------------|---------|
| 01 Air, 02 Air missile, 05 Space, 06 Space missile | exempt |
| 10 Land unit, 11 Land civilian | wheeled (entity overrides: infantry → dismounted, armour/mech → tracked) |
| 15 Land equipment | wheeled; tracked for APC (120103/04), tank (1202), ARV (1203), mine-clearing tank (130902) and dozer (1311); the SIDC's mobility amplifier (positions 9–10) when set: 31 / 32 / 34 wheeled, 33 tracked, 35 gun (towed), 36 rail, 37 pack, 41 / 42 over-snow, 51 vessel, 52 amphibious |
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

`npm run dev` serves `/terrain-bundle` from the real bundle in `MS/Data/terrain-bundle`, **except** for any
file that also exists under `public/terrain-bundle/`: the synthetic bundle wins file by file, so while that
folder exists the harness shows synthetic data instead of the real data. **Delete `public/terrain-bundle/`
when you are done with the synthetic bundle.** (This is decided per request, so no restart is needed after
adding or deleting it.) Tile URLs carry the bundle's `built` stamp (`…/12/2877/1637.png?v=…`), so tiles the
browser cached for one bundle are not reused for another served from the same address.

In the harness: tick **Ground Guide** in the Settings panel (bundle URL
defaults to `/terrain-bundle`), then draw a symbol over the synthetic area around
69.35°E 30.35°N.
