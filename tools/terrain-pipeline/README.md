# Terrain-bundle pipeline

Produces the **terrain bundle** consumed by the PAMS8 Ground Guide
(`../../15-ground-guide.md`, "Terrain bundle format (v1)"): a folder of
static XYZ tiles that tells the engine, per pixel, the terrain class and the
distance to the nearest no-go pixel for each mobility profile.

```
MS/Data/terrain-bundle/                  (repo root; git-ignored)
  manifest.json  rules.json  LICENSES.txt
  class/{z}/{x}/{y}.png            terrain class code, 255 = nodata        (overviews: nearest)
  dist_<profile>/{z}/{x}/{y}.png   metres / distScaleM to nearest no-go,   (overviews: MIN)
                                   0 = inside no-go, 254 = >= cap, 255 = nodata
  -- bundle v2 (GROTBC, hybrid builds) --
  route/ landform/ cc/ wet/ elev_hi/ elev_lo/   auxiliary layers (codebooks in rules.json `grotbc.layers`)
  terrain/ soil/ hut/  climate/{climate.json,climate.bin}   terrain type, soil texture, hut density, climate normals
  features/10/{x}/{y}.json  features/index.json  points and named lines from the NCGDB
  admin.geojson  boundaries.geojson  sheets.json  routes.json
```

Bundle v2 organises the data by **GROTBC** as defined in `GROTBC.md` (Ground, Roads / tracks / railway network,
Obstacles, Trafficability, Built-up areas, Cover / camouflage / concealment); see "Bundle v2 (GROTBC)" below and
`MS/Docs/16-ground-guide-grotbc-card.md`. The first build read R as Relief and T as Tactical features; relabelled on
2026-11-03 (relief is now under G, roads / rail / crossings / airfields under R). On 2026-11-04 T became
Trafficability (the going per mode, dry and after rain); terrain type and vegetation moved to G. `routes.json` (named routes with
from - to, length, load class, closures) and `rules.json grotbc.coverSplit` (cover and concealment four ways) were added then.

Tiles are Web Mercator (EPSG:3857) 256 px XYZ, z = 8..12, 8-bit greyscale PNG
with only `IHDR/IDAT/IEND` chunks. Missing tile = no coverage. Everything in
the bundle is a static file; the air-gapped host only receives `MS/Data/terrain-bundle/`.

## Reproduce

```sh
cd tools/terrain-pipeline
python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
make bundle                      # fetch -> grid -> derive -> classify -> profiles -> tile -> validate -> package
```

Variables: `AOI` (`w,s,e,n`; normally empty = taken from the boundary), `RES_M`
(target, 30), `ZMIN`/`ZMAX` (8/12), `OUT_DIR`, `WORKERS`, `BLOCK`, `BOUNDARY`
(GeoJSON clip polygon of your own; see "Country boundary" below), `NCGDB`.
Example: `make bundle ZMAX=13 WORKERS=8`.

Steps write `work/<step>/` and a `.done` stamp; `make clean-<step>` forces a
re-run of that step and everything after it. Only `make fetch` touches the
network.

**On Windows** use `run_lc_data_pipeline.ps1` in the repository root instead of `make`: it creates this
folder's `.venv`, installs `requirements.txt`, finds GDAL (QGIS / OSGeo4W), and runs the same steps with
the same skip-if-done behaviour. `-Check` sets everything up without running a step; `-NoNcgdb` builds
from open data only; `-Ncgdb <folder>` chooses the geodatabase (see "Hybrid data").

**GDAL in Docker instead of a host install**: if a container named `GDAL` exists (`-GdalContainer <name>` or
`$env:GDAL_CONTAINER` pick another), the script uses it before looking for QGIS / OSGeo4W, and `scripts/common.py`
runs every GDAL command there with `docker exec`, translating paths. The container only needs the GDAL
command-line tools (e.g. `ghcr.io/osgeo/gdal:ubuntu-small-latest`) and this folder mounted at `/work`:

```sh
docker create --name GDAL --restart unless-stopped --entrypoint sleep \
  -v "<repo>/tools/terrain-pipeline:/work" -w /work ghcr.io/osgeo/gdal:ubuntu-small-latest infinity
docker start GDAL
```

`-NoDocker` ignores it. The NCGDB is read by Python (pyogrio), so it is not mounted.

**Where the bundle lives**: the pipeline writes it to `MS/Data/terrain-bundle/` (`OUT_DIR` in the Makefile, `-OutDir` in
`run_lc_data_pipeline.ps1`), next to the library's other data, and it is git-ignored. `npm run dev` serves that folder at
`/terrain-bundle` when `public/terrain-bundle` does not exist (do not put the real bundle under `public/`: Vite indexes it
and stalls). The file watcher and `tsconfig.build.json` skip it, as the watcher also skips this folder's `out/`, `work/`
and `.venv/`. `out/` now holds only `terrain-bundle.zip`. The GDAL container mounts only this folder, which is enough:
`tile`, `validate` and `package` are pure Python and write to the bundle folder directly.

### Prerequisites

- Linux / WSL / Windows, Python 3.11+, GDAL 3.4+ command-line tools on `PATH`
  (`gdalwarp gdalbuildvrt gdal_rasterize gdal_translate ogr2ogr`), the OSM
  driver built in (`ogrinfo --formats | grep OSM`). When the tools come from a QGIS or
  OSGeo4W install, `common.run()` sets `GDAL_DATA` for the *child* process so the OSM
  reader finds `osmconf.ini` (never for the Python process, whose rasterio wheel has its own GDAL).
- Python packages from `requirements.txt` (rasterio/pyogrio wheels bundle
  their own GDAL, which is fine; only the CLI tools need the system GDAL).
- Disk: ~25 GB raw downloads, ~20 GB `work/`, bundle itself ~1-3 GB
  (the z12 grid over Pakistan is ~49k x 46k px; every step streams in blocks,
  RAM use is bounded by `BLOCK` — 2048 needs ~1-2 GB).

### Before the first run — check `sources.lock`

The URL patterns in `sources.lock` were checked on 2026-10-29 (HTTP 200 for a
tile of each source; the OSM extract is a dated Geofabrik file, never `-latest`).
Re-check them if a download 404s later: providers move buckets. `fetch.py --record`
(used by the Makefile and the PowerShell script) writes the sha256 of what it
downloaded into the lock in place of `TO_BE_FILLED`; commit that lock. On later
runs hashes are verified and a mismatch fails the build. `manifest.json` carries
the same hashes. Downloads retry with backoff, resume partial `.part` files and run
four at a time, so re-running `fetch` after an interruption continues where it stopped.

Likewise `golden_points.yaml` coordinates were placed from general knowledge;
confirm each against the data on first `make validate` and tighten the
tolerances.

## Changing the rules

- `classes.yaml` — class table (codes are stable, never renumber), precedence
  when layers overlap, and the source → class mapping (WorldCover codes, JRC
  thresholds, slope thresholds, OSM filters and waterway buffer widths).
- `rules.yaml` — profiles (`nogo` / `requires` / `caution`), `distScaleM`,
  `profileOverrides`, `version`.

After editing **rules.yaml only** (profiles), nothing upstream changes:

```sh
make rebuild-rules               # profiles -> tile -> validate -> package (steps 5-8)
```

After editing **classes.yaml** the class raster must be rebuilt
(`make clean-derive bundle` if OSM filters/thresholds changed, or
`make clean-classify bundle` if only precedence/mapping changed).

## Data extent (the Survey of Pakistan map sheet) and the optional border

The clip decides which pixels exist at all, so it decides what the map shows. By default the pipeline uses the
**extent of the Survey of Pakistan's *Pakistan Relief Map*** as the bounds of the data: a plain rectangle
(`59.5,20.5,80.5,37.5`, read off the sheet's graticule, plus the south to 20.5°N for the Junagadh & Manavadar inset).
Whole of Jammu & Kashmir, Gilgit-Baltistan and the insets are inside it and **nothing inside is clipped**; no border is
drawn. Change it with `-Frame W,S,E,N` (PowerShell) or `scripts/make_boundary.py --frame W,S,E,N`.
`fetch.py` downloads only the source tiles that touch the extent (`only_intersecting` in `sources.lock`).

- **Default (`frame`)**: the rectangle above. Written to `work/boundary/clip.geojson`.

The modes below are opt-in (`-BoundaryMode official` / `osm` / `-Boundary`) and clip to a *country border*:

- **`official`**: `scripts/make_boundary.py` builds the polygon from the NCGDB's own survey geometry
  (`Province_Bdry`, every entry with `COUNTRY = Pakistan`, plus FATA). It is not traced from images. The result is
  ~990,000 km² reaching 79.4°E; the area (AOI), the source-tile lists and the manifest follow from it.
  It also writes `work/boundary/boundary_display.geojson` (a 400 KB outline, provinces, the LoC and the international
  lines), which `package.py` copies into the bundle as `boundary.geojson` so a map can draw it.
- **`osm`** (`-BoundaryMode osm`, or when there is no NCGDB): OpenStreetMap's boundary, which stops at the Line of
  Control. Indian-administered Kashmir is then *not covered*; the run says so in a warning and in the manifest.
- **Your own**: `-Boundary <geojson>` / `BOUNDARY=<geojson>` overrides both (e.g. an official file from the Survey).

Measured on real data around Muzaffarabad / Baramulla: with the OSM boundary 0.1 % of the Indian-administered side
survived; with the official boundary 100 % did. The eastern limit moved from 77.9°E to 79.4°E, so the source lists add
WorldCover tiles `N30E078` / `N33E078` and DEM columns out to 79°E (JRC's 70-80°E tile already covered it).
Changing the boundary mode re-runs `grid` and everything after it.

Note: with `official` the Junagadh & Manavadar and Sir Creek insets of the relief map are **not** part of the polygon
(NCGDB carries none for them); the default `frame` extent covers them.

## Hybrid data (open data + NCGDB)

The default build combines the downloaded open data (WorldCover, JRC water, Copernicus DEM, OSM) with a
local topographic geodatabase, **NCGDB Ver-6** (`classes.yaml` → `sources.ncgdb`). It was assessed on
2026-10-30 against WorldCover 2021 over all Pakistan-administered land, against OSM for linework, and on
imagery; neither source is better everywhere, so the two are **unioned by class precedence** (each class
takes evidence from every source; see `classify.py`):

| from NCGDB (WorldCover has no equivalent) | from WorldCover / others | both (union) |
|---|---|---|
| sand, dunes, rocky ground (scree, stony waste, rock outcrop, moraine), salt pan, dry riverbed / nullah, wet mud + reeds (→ wetland), perennial vs non-perennial water, cultivation limits | trees, shrub, grass, bare ground, snow/ice extent (NCGDB glaciers cover ~9 % of WorldCover's snow/ice), slope (DEM: only 7 % of NCGDB contours carry an elevation) | built-up (each omits land the other sees), cultivation, permanent water (+ JRC, OSM) |

Measured agreement (NCGDB vs WorldCover, Pakistan-administered land): cultivation 70 % precision / 86 % recall,
sand 72 % precision, glacier polygons 72 % precision; built-up 60 % / 35 % (NCGDB omits recent settlements),
water 49 % / 39 %. Railway and road linework sits a median 14-20 m from OSM. **These are agreement figures against
other imperfect sources, not ground-truth accuracy.** NCGDB records no per-feature date (`Updation` is empty), only a
`Source` phase, so its age cannot be audited per feature.

Switches: `--ncgdb <folder>` / `$NCGDB_PATH` / PowerShell `-Ncgdb`; `--ncgdb none` / `-NoNcgdb` = open data only
(the bundle is then unrestricted). `derive.py` writes `work/derive/ncgdb_class.tif` and
`ncgdb_provenance.json`; `classify.py` writes `work/classify/class_stats.json`, which says how many pixels NCGDB
changed versus open data only and into which class. Switching mode re-runs derive and everything after it.

**Restricted data.** A hybrid bundle contains NCGDB-derived pixels. `package.py` marks the manifest
`"restricted": true`, adds the geodatabase fingerprint (file listing hash, not its contents) to `sources`, and
writes a warning into `LICENSES.txt`. Do not ship such a bundle, or commit `work/`, `out/` or `MS/Data/terrain-bundle/`, without the data
owner's permission. `--ncgdb none` rebuilds an open-data bundle.

## Bundle v2 (GROTBC)

Step **grotbc** (`scripts/grotbc.py`, between derive and classify) reads the NCGDB's lines and points and the
DEM; `classify.py`, `profiles.py`, `tile.py` and `package.py` pick its products up when they exist.

| product | from | becomes |
|---|---|---|
| `obst.tif` | `classes.yaml sources.grotbc.obstacles`: canals / distributaries / drains (Canal, Canal_Pakmap), perennial streams and dry nullahs (Water_Feature_Line), embankments, bunds, cuttings, broken edges (Embankment), cliffs (Contour), walls and fences (Boundry) | classes 20-22, 24-27, 46, 47, 49 |
| `road.tif`, `rail.tif`, `route.tif` | Roads_updated_2016_Pakmap (load class, MSR), Road, Tracks, Railway, Railways_Pakmap | classes 28, 34-38; the bundle's `route` layer |
| `rx.tif`, `xing.tif` | true line intersections of roads / railways with canal and stream lines and with each other; Crossings_Point, Crosings_line, fords | classes 39-45 and 50 (bridges by load class, railway / foot bridges, fords, level crossings), derived in classify on water only |
| `wire.tif`, `irrig.tif` | power lines and masts (50-100 m), field-channel density (one every ~400 m) | classes 33, 48, 23 |
| `veg.tif` | 3.58 M vegetation symbols (weighted density) | the `cc` layer (with the classes) |
| `slopeband.tif`, `landform.tif`, `elev_hi/lo.tif` | DEM: 3x3-mean slope, topographic position index at 300 m and 2 km | classes 18-19; `landform`, `elev_*` layers |
| `vector/` | water sources, crossings, helipads, airfields, stations, passes, posts, settlements, heights, KM stones; named roads, railways, canals, rivers; province / district / tehsil / corps AOR; IB / LoC / LAC; map sheets | `features/`, `admin.geojson`, `boundaries.geojson`, `sheets.json` |

The road load codes (40A1, 70A2, 9F1) are read as `<class><A all-weather / F fair-weather><lanes>`; tankable is
class 60+ (`rules.yaml tankable`, from the tank table there). Lines are burned as connected 1-px paths; a road on
a canal bank or beside a railway is never mistaken for a crossing because crossings come from line
intersections. Thin obstacle lines are NO-GO on the line but cast no Marginal band (`rules.yaml marginalIgnore`).
An open-data build (`--ncgdb none` / `-NoNcgdb`) runs `grotbc --only relief` and gets the relief layers only.

The NCGDB lives on a USB disk here; copying it to an NVMe folder for the build (`work/ncgdb/`, git-ignored)
cut the block reads several-fold. Delete the copy afterwards.

### Terrain, soil, huts and climate (added 2026-11-03)

| product | step | from | becomes |
|---|---|---|---|
| `terrain.tif` | `scripts/terrain.py` | class, wet and slope-band rasters; `rules.yaml terrainType` | the `terrain` layer: Plain / Hilly / Solid / Marshy / Wet / Desert (+ Mountainous, Built-up, Snow / ice) |
| `soil.tif` | `scripts/fetch_soil.py` then `terrain.py` | SoilGrids 2.0 sand / silt / clay (+ Q0.05 / Q0.95), 0-30 cm, windowed from ISRIC's VRTs (average resampling); NCGDB soil areas | the `soil` layer: USDA texture, confidence, mapped bit |
| `rci_dry.tif`, `rci_wet.tif` | `terrain.py` | the same plus coarse fragments, bulk density, organic carbon; Saxton-Rawls Ks; `rules.yaml soilStrength` | cone index dry / after rain (the engine compares it with the mode's vehicle cone index) |
| `soil_props.tif` | `terrain.py` | the same, on the SoilGrids grid | GIS check only (texture, USCS group, confidence, Ks, cone index); not in the bundle |
| `hut.tif` | `terrain.py` | NCGDB `Hut` (3.77 M symbols) | the `hut` layer (huts per km2, ~600 m cells) |
| `climate.bin/json` | `scripts/climate.py` | WorldClim 2.1 5' tmin, tmax, prec, wind | `climate/` (monthly normals + frost / hot / wet / monsoon summaries) |
| `wp`, `wc` on places | `grotbc.py` features | WorldPop 2026 constrained, 100 m | people nearest each place; people within 12 / 8 / 4 km of a city / district HQ / town |

Added 2026-11-04:

| product | step | from | becomes |
|---|---|---|---|
| `network/` | `scripts/network.py` | the graph GeoCore serves (`D:\Projects\GeoCore\RoutingData\Network.gdb` `pkroads`, 2.76 M OSM edges) + NCGDB road lines (conflated per edge) + class raster (bridges, fords) | **the canonical military road network**: edges.bin (one record per OBJECTID: load class, MSR, defence, bridge class, closures, condition, landslides, width, names), tiles/ for the map, routes.json. GeoCore reads the same folder for military routing (`network_military`), so routes and the map share one `dataVersion`. `--tiles-only` / `--routes-only` rewrite those from the written files. See GROTBC-Roads.md section 0 |
| `bank.tif` | `terrain.py` | class raster (water classes) + `rules.yaml banks` | the `bank` layer: river / lake, floodplain, stream and canal banks in 30 / 75 / 150 m bands |
| `bld.tif`, `cells.npz` | `scripts/buildings.py` | Google Open Buildings v3 (16.6 GB, 7 S2 tiles) + GHSL building height (2018) | the `bld` layer: building density, mean footprint (huts ... industrial) and height class per ~150 m cell |
| `settlements.json/.geojson` | `scripts/settlements.py` | built-up class, WorldPop, place names, `cells.npz`, GHSL SMOD | every settlement with name, size class (metropolitan city ... hamlet), population, males 15-49 / under 15 / 65+, people per km2, area, buildings, mean height, degree of urbanisation |
| GeoNames kinds 147-159 + `an` / `gn` on places | `grotbc.py` features | `D:\Imagery\PK.txt` (GeoNames dump, CC BY 4.0) | schools, banks, government offices, named mountains / hills / ridges, dunes, streams, canals, wells, marshes, localities, forests; alternate spellings on matched places, new places where the NCGDB has none |

### Population: WorldPop 2026 (updated 2026-11-04; people at 100 m since 2026-11-05)

Rule set by the owner: where WorldPop offers two choices, take the **latest** and the **coarser** one. So the Global2
R2025A **2026** estimate (the current year; 2027-2030 are projections) at **1 km**, constrained and UN-adjusted (the
only 1 km form). The one exception, chosen by the owner on 2026-11-05: the **population count itself is the 100 m
file** (136 MB; 100 m has no UN-adjusted form), because settlements and villages need it. Age groups stay 1 km and
are applied as shares (group / all 20 total bands) to the 100 m people. Population Density and Population Weighted Density never moved to Global2: their latest is 2020.
Every source in `sources.lock` carries `dataDate` (the time the data describes) and `released` (the publisher's
release), and its location (the `files` / `pattern` URLs, or `location` for a local or VRT source).
`manifest.json` `sources[]` (NCGDB included) and `LICENSES.txt` list location and dates for each source;
`layerSources`, every `grotbc.layers.*.sources` and every file entry (`climate`, `population`, `network`,
`settlements`, `features`, `adminSources` ...) name the source ids it was built from; `population.json` layers,
`settlements.json sources`, `features/index.json sources` and `climate.json sourceRef` carry the full location and
dates themselves.

| product | step | from | becomes |
|---|---|---|---|
| `population.bin/json` | `scripts/population.py` (`make population`) | `worldpop` (2026 count, 100 m, summed into the 1 km cells), `worldpop_agesex` (2026: shares of males 15-49, under 15, 65+), `worldpop_density` (2020, unconstrained), `worldpop_pwd` (2020) | `population/`: 2034 x 1611 cells of 30", uint16 layers `pop`, `males15_49`, `under15`, `over65`, `density_2020` (people / km2, also over farmland); `provinces` = population weighted density per GADM 3.6 province |
| settlement population | `settlements.py` | the same 2026 rasters | each 100 m cell's people counted in the settlement its centre falls in; age groups = those people x their 1 km cell's shares (a coarser people file would be shared out by building footprint area, `cells.npz`) |

The earlier 2020 (100 m) and 2026 (1 km) population files were removed from `work/raw/worldpop/` on 2026-11-05.

### G: terrain feature inventory and Important Tactical Ground (added 2026-11-04)

ITG and MITG belong to G (Ground), not to a letter of their own. `scripts/ground.py` (`make ground`, after `grotbc`,
`classify` and `network`) builds the inventory from data already held and merges it into `features/`:

| product | from | becomes |
|---|---|---|
| kinds 160-165: peak, hill, knoll / raised ground, saddle, plateau, closed depression | Copernicus DEM averaged to ~100 m | points with elevation `e`, relative relief `rr`, dominance radius `iso`, view share `vs` and nearest MSR in view `mv` (5 km rays from 2 m eye height), slope round it `sp`, class `lc`, cover `cv`, nearest MSR `dr` / road `dn`, surveyed height `hs` (NCGDB trig station / spot height within 250 m), name `n` (GeoNames / NCGDB named mountain within 1.5 km, pass within 1 km) |
| kind 204: ridgeline | same | crest cells joined uphill into lines of 1 km or more, `e` highest point, `lk` length |
| kind 166: junction of main roads | `network/` (motorway / trunk / primary nodes of degree 3+, interchanges merged within 400 m) | `n` road names, `m` on an MSR, `mx` ways out along motorways / national highways |
| `ig` / `it` on any point | `rules.yaml itg.reasons` | ITG CANDIDATE: H highest ground around, O wide observation, R overlooks an MSR, P pass on a road or track, C chokepoint on an MSR (bridges over a river / canal / stream, fords, ferries, tunnels, passes, barrages, dams), J junction on an MSR; `it` 1 candidate, 2 strong (check it as MITG for the task) |
| `work/ground/ground_inventory.gpkg` | the same | the inventory for GIS: `Feature_ID`, `Feature_Name`, `Feature_Type`, `Feature_Subtype`, `Elevation`, `Relative_Relief`, `Slope_Deg`, `View_Pct`, `ITG_Status`, `ITG_Reasons`, `Data_Source`, `Observation_Date`, `Verification`, ... |

The bundle names candidates only. Whether one is important or most important depends on the task, the axis and the
enemy: that is decided in the app and saved with the plan. Copernicus DEM is a surface model, so a knoll or depression
under 35 m in built-up ground or under trees is dropped (`itg.dsmSuspect`). `--aoi w,s,e,n` runs a test on part of
the grid and leaves `features/` untouched. Every threshold is in `rules.yaml itg` (a starting proposal).

New named features (mosques, graves, telecom, post offices, lakes, glaciers, river reaches...) come from the same NCGDB
layers as before. `fetch_soil.py` is run once after `make fetch`; `terrain.py` and `climate.py` run after `classify`
(`python scripts/terrain.py`, `python scripts/climate.py`), then `tile` and `package` as usual.

## Verifying a bundle

```sh
python3 scripts/validate.py                                        # checks MS/Data/terrain-bundle; also run by `make bundle`
make synth-check                                                   # validates public/terrain-bundle (synthetic)
```

Checks: PNG chunk set/bit depth/size, class histogram per level, golden points,
`dist == 0` exactly on no-go pixels and `255` exactly on nodata, overview
monotonicity (coarse ≤ min of children), tile counts and size.

## How the numbers are made

| step | script | notes |
|------|--------|-------|
| grid | `grid.py` | pixel = resolution(ZMAX) = 2π·6378137/(256·2^ZMAX); extent snapped outward to whole ZMAX tiles; `gdalwarp` nearest (categorical) / bilinear (DEM), cut to the boundary |
| derive | `derive.py` | slope in degrees from `np.gradient` scaled by `pixel·cos(lat)` per row; JRC occurrence ≥ 80 % permanent, 20–80 % seasonal; OSM themes extracted with `ogr2ogr`, waterways buffered in UTM 42N (river 40 m, canal 15 m, stream 5 m), rasterised with `gdal_rasterize`; **NCGDB** (hybrid): each worker reads one block's polygons straight from the `.gdb`, projects them to Web Mercator, burns the `classes.yaml` rules (holes for cultivation exclusions / river islands) and paints lowest precedence first |
| grotbc | `grotbc.py` | NCGDB lines / points per block (bbox reads, like derive's NCGDB product), 1-px all-touched lines, points buffered; crossings from vector intersections; relief from the DEM; features as z10 JSON tiles (tile-local 0..4095) |
| classify | `classify.py` | evidence masks painted low→high precedence (`classes.yaml precedence`: crossings > canal > water_permanent > … > roads > railway > built_up > … > open_land); then crossings derived where a road / railway / crossing point meets water; `cc.tif` and `wet.tif` written alongside; everything outside the country cutline stays 255 |
| profiles | `profiles.py` | `scipy.ndimage.distance_transform_edt` per block with a halo ≥ cap; `sampling` = pixel·cos(lat at block centre). Approximation: < 1 % scale error inside a 2048-px block, i.e. < 1 tile value at the 2540 m cap. Nodata is never no-go and stays 255 |
| tile | `tile.py` | ZMAX straight from the rasters; each coarser level from the four child PNGs: class nearest (`--class-reduce mode` for majority), dist MIN, route / wet MAX, cc / landform majority, elevation mean of the 16-bit value. Tiles are written only where the class tile has data |

## Licences and attribution

The bundle's `LICENSES.txt` is generated from `sources.lock`. Summary:

| source | licence | attribution |
|--------|---------|-------------|
| ESA WorldCover 2021 v200 | CC-BY-4.0 | © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium |
| JRC Global Surface Water (occurrence, v1.4, 1984–2021) | free for any use with attribution (see landing page) | Pekel et al. 2016, Nature 540; European Commission JRC / Google |
| Copernicus DEM GLO-30 | Copernicus DEM licence (free, attribution required) | © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA |
| OpenStreetMap (Geofabrik Pakistan extract) | ODbL-1.0 | © OpenStreetMap contributors |
| NCGDB Ver-6 (local, hybrid builds only) | **restricted** - the owner's terms apply | Survey of Pakistan topographic data (see the owner) |

The OSM contribution (water bodies, wetlands, restricted and built-up areas)
means the derived `class` and `dist` tiles are a *derivative database* under
ODbL: redistribute the bundle with `LICENSES.txt` and under ODbL-compatible
terms. The country boundary used for clipping is the official Survey of Pakistan depiction by default
(see "Country boundary" above); only with `-BoundaryMode osm` is it OpenStreetMap's.
