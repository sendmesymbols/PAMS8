# 21 · AOI Check, X-Section and Compare

Three terrain tools, built 17 Nov 2026. Each is its own engine, off by default, with a top-bar button and a ⚙ gear, a
Ctrl+K settings widget and a panel of its own. Each reads the terrain bundle only while it is on (`claude_rules.md`).
They share the site-finder code in `MS/Engines/SiteScan/` with Gun Deployment and Admin Area (doc 20):
- `SiteLine.ts` is the pure line reader.
- `SiteScan.readArea` reads an area.
- `SiteProbe.ts` is the bundle reader, now with line of sight.
- `SiteMap.ts` draws the map layers.

`node tools/sitefinder-test/tools.mjs` runs 40 checks on a synthetic ground and the real manifest.

| | AOI Check | X-Section | Compare |
|---|---|---|---|
| Button | 🗺 AOI Check | 📈 X-Section | ⚖ Compare |
| Switch | `features.aoiCheck` | `features.crossSection` | `features.compare` |
| Settings | `aoiCheck.*` | `crossSection.*` | `compare.*` |
| Panel | top left, below the bar | bottom centre | top right, below the bar |
| Map layer | `ms-aoi-check` | `ms-cross-section` | `ms-compare` |
| Pure part | `AoiCheck/AoiCheckRead.ts` | `SiteScan/SiteLine.ts`, `CrossSection/CrossSectionChart.ts` | `Compare/CompareRead.ts` |
| API | `symbolEngine.aoiCheck` | `symbolEngine.crossSection` | `symbolEngine.compare` |

## AOI Check

**Input:** **Pick area** (draw the AOI) or **This view** (the map's extent). In code: `aoiCheck.check(ring, name, { lngLat })`.

**What is checked:**
- **Raster layers:** every raster layer in the manifest, plus each mover's distance-to-NO-GO layer (28 layers in the current bundle).
  - Each is fetched tile by tile over the AOI, at the finest zoom that keeps it within `aoiCheck.maxTiles` tiles a layer (48 by default).
  - A bigger AOI is checked at a coarser zoom, and the panel says so in amber.
  - Each tile is present, missing (404: no cover) or failed. In present tiles, the pixels inside the AOI with no data (255) are counted.
- **Feature and road tiles (z10):** a tile with nothing in it is not written, so an absent one may only mean an empty place, and the note says so.
- **Population, climate and visibility grids:** checked by their bounds.

**The report:**
- **Verdict:**
  - **Bad** when the AOI is outside the data, or the Gr class or heights are missing over half of it.
  - **Warn** for any smaller gap.
  - **OK** for full cover.
- **Header facts:** the share inside the data's frame, the build date, the rules and data versions.
- **Readings affected,** worst first, with the core layers (Gr class, heights) first. Each line says what it blanks, e.g. "Going / NO-GO for every mover…". The movers' distance layers are one line, as are the two height bytes.
- **Layers table:** tiles, gap and sources with dates.
- **Movers table.**
- **Grids and point data.**
- **Sources:** every source with its data date, release and licence. Restricted and non-commercial ones are marked. The 1:50k map is never named "NCGDB".

**Map:** the AOI; gap tiles in red (Gr class or heights) or amber (other layers), labelled with how many layers they miss; the data's frame when the AOI crosses it.

## X-Section

**Input:** a line drawn after the button (click points, double-click to finish), **Selected line**, or right-click a placed line or area → **X-Section…**. An area is read round its edge. In code: `crossSection.setLine(pts, { lngLat })` or `useGraphic(g)`.

**Reading** (`profileLine`), a sample every 30 m, widened to keep under 1,500 samples:
- **Height:** the 30 m elevation. Climb is counted in steps of 3 m, about GLO-30's vertical noise, so flat ground does not add up a false climb.
- **Going for the mover in the month:** the worst of three things:
  - the class, from the rules.json profile;
  - the season's soil cone index against the vehicle's (rules.json soilStrength);
  - the wet layer (water stops everyone; after rain, waterlogged ground stops vehicles and slows foot; flood-prone and riverbed ground slows everyone).
- **Obstacles:** runs of a class.
  - A linear feature (canal, drain, stream, railway, road, bridge, ford, bund, cutting, cliff, wall, nullah) crossed in 250 m or less is a crossing; longer is "along".
  - Areas (BUA, water, marsh, dunes, forest) are "in".
- **Steep stretches:** slope over a 60 m base, steep from rules.json's own slope classes. Vehicles are steep from 15° (26.8 %, class 10), foot from 30° (57.7 %, class 9).
- **No-data gaps:** no height, no class, or both.
- **Seen by threat:** with the Ground Guide threat marker set as a place, the chance its eye (2 m) sees the line at 1.8 m (foot) or 2.5 m (vehicles), from the OCOKA sight engine.

**Panel:**
- **Facts:** length, height range, up / down, steepest, NO-GO, SLOW-GO, crossings, seen, no data.
- **Chart:**
  - height, with steep stretches in red;
  - a going band, an obstacle row with a letter per event and words where there is room, and a seen band;
  - distance markers; no-data stretches hatched;
  - hovering reads a point (km, height, slope, class, going, seen) and moves a marker on the map.
- **Event list** with chainage; a note on how it was read.

**Map:** the line with distance markers, NO-GO stretches in red, gaps dashed grey.

The always-on `RouteProfileEngine` (`symbolEngine.showRouteProfile`) is unchanged. It profiles from the map's own elevation service, without the bundle.

## Compare

**Input:** up to four alternatives, lettered A–D:
- **+ Line:** a corridor.
- **+ Area** or **+ Point:** a position. A point is read as a circle of `compare.pointRadiusM`, 250 m by default.
- **+ Selected:** the selected line, area or point symbols.

In code: `compare.addAlternative(kind, pts, { lngLat, name })`.

**Assumptions,** one set for all and shown above the table: the mover, the month (dry / after rain at the first alternative), and the threat marker with its eye height for "seen".

**Corridor rows:**
- length;
- climb;
- steepest;
- NO-GO, with the number of stretches;
- SLOW-GO;
- water crossings (canal, drain, stream, ford);
- bridges (with the number whose class is not recorded);
- railway crossings;
- through BUA;
- seen by threat;
- no data.

**Position rows:**
- area;
- usable Gr;
- tilt and relief;
- firm;
- wet / flood;
- hidden from air;
- cover from fire;
- Rd from centre;
- seen by threat;
- people;
- no data.

**How results are ranked:**
- Each row carries its "how" in its tooltip, and all of them are listed under **How each row was worked out**.
- The best and worst cells in a row are marked only when the alternatives differ by more than that row's smallest real difference:

  | Row | Smallest real difference |
  |---|---|
  | Length | 100 m |
  | NO-GO | 15 m |
  | SLOW-GO | 30 m |
  | Water crossings | 1 crossing |
  | Shares | 10 points |

- Rows marked · (bridges, area) are shown but never ranked.
- **Differences** writes each ranked row out as a sentence.
- **Best on** counts the rows each alternative wins. There is no overall score: the user weighs the rows.
- Corridors and positions are ranked only among their own kind.

**Map:** each alternative in its colour with its letter; NO-GO stretches on corridors in red.

## Everything backed (17 Nov 2026)

Each tool states what its result rests on, so that nothing is a hidden number:

- **Data.** Each tool names the bundle layers it read, the sources they were built from, and their dates, taken from the
  bundle manifest (`SiteScan.dataCatalog`). The 1:50k map is never named NCGDB.
- **Terrain rules.** These are the rules.json NO-GO class lists for the mover, and the slope classes for steep ground
  (26.8 % vehicles / 57.7 % foot). For the month's rain they are the climate grid's wet threshold (100 mm), shown with
  the climate source.
- **Inputs.** These are where each line or area came from: drawn, selected, or this view.
- **Working thresholds.** Each one is named as a proposal, with its value:
  - **X-Section ("What this rests on"):**
    - 30 m samples;
    - 250 m to count a crossing as across rather than along;
    - 3 m climb step;
    - 60 m slope base;
    - 0.5 sight chance.
  - **Compare:**
    - each row's "how" ends with "Ranked only when the alternatives differ by more than X (proposal, CompareRead.ts)"
      or "Shown, not ranked";
    - it then gives "Data: ..." and where the alternatives came from.
  - **AOI Check ("How it is judged", `AOI_JUDGED`):**
    - gaps under 0.5 % are not counted;
    - bad from a 50 % gap in the core layers;
    - the finest zoom within `maxTiles`.

`node tools/sitefinder-test/tools.mjs` (43) checks the thresholds, the data line and how source dates are read
(`shortDate`: "1984-2021", "2011-2015", the "2024 used" year).

## Decisions (tell the user if asked)

- **Separate engines with top-bar buttons,** as with Gun Deployment and Admin Area. The top bar wraps to more rows on a narrow window, so the top-docked panels sit below its real bottom edge (`dockBelowBar`), and the bottom ones stop under it (`fitBelowBar`).
- **No ArcGIS elevation fallback:** X-Section reads the bundle's elevation (offline, the same data every other reading uses). The old route profile is left as it was.
- **Thresholds:** the steep thresholds come from rules.json slope classes. The 3 m climb step and the rows' smallest real differences are my proposals.
- **AOI Check zoom:** a large AOI is checked coarser rather than fetching thousands of tiles. The panel says when this happens.

## Verified (17 Nov 2026, in the app; the pane was hidden at the end, so the last checks were read from the DOM)

- **AOI Check:**
  - This view over Sialkot (4,628 km², z11, 28 layers x 24 tiles, under 10 s): full cover.
  - An AOI astride 80.5°E (16 s): 50 % in the frame, Gr class and heights missing over 52 %, verdict bad, the population grid 0 % (it ends at 77.8°E).
- **X-Section,** 22 km east of Daska: 14 canal crossings and 8 bridges, NO-GO 1.5 km for wheels; hover read-out and map marker.
- **Compare:** two corridors and two points read with differences and tallies.
- **Not verified:** 3D; the gears; Pick area by mouse for AOI Check; the right-click X-Section item (wired the same way as the Night March one).
