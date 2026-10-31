# Terrain-bundle pipeline

Produces the **terrain bundle** consumed by the PAMS8 Placement Advisor
(`MS/Docs/15-placement-advisor.md`, "Terrain bundle format (v1)"): a folder of
static XYZ tiles that tells the engine, per pixel, the terrain class and the
distance to the nearest no-go pixel for each mobility profile.

```
out/terrain-bundle/
  manifest.json  rules.json  LICENSES.txt
  class/{z}/{x}/{y}.png            terrain class code, 255 = nodata        (overviews: nearest)
  dist_<profile>/{z}/{x}/{y}.png   metres / distScaleM to nearest no-go,   (overviews: MIN)
                                   0 = inside no-go, 254 = >= cap, 255 = nodata
```

Tiles are Web Mercator (EPSG:3857) 256 px XYZ, z = 8..12, 8-bit greyscale PNG
with only `IHDR/IDAT/IEND` chunks. Missing tile = no coverage. Everything in
the bundle is a static file; the air-gapped host only receives `out/`.

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

**Viewing the bundle in the dev harness**: `npm run dev` serves `out/terrain-bundle` at `/terrain-bundle` when
`public/terrain-bundle` does not exist (do not put the real bundle under `public/`: Vite indexes it and stalls).
Its file watcher also ignores this folder's `out/`, `work/` and `.venv/`.

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
writes a warning into `LICENSES.txt`. Do not ship such a bundle, or commit `work/` / `out/`, without the data
owner's permission. `--ncgdb none` rebuilds an open-data bundle.

## Verifying a bundle

```sh
python3 scripts/validate.py --bundle out/terrain-bundle            # also run by `make bundle`
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
| classify | `classify.py` | evidence masks painted low→high precedence: water_permanent > mangrove > wetland > built_up > restricted > snow_ice > steep_slope > dunes > salt_pan > water_seasonal > dry_riverbed > moderate_slope > rocky_ground > tree_cover > cropland > sand > bare_desert > open_land; everything outside the country cutline stays 255 |
| profiles | `profiles.py` | `scipy.ndimage.distance_transform_edt` per block with a halo ≥ cap; `sampling` = pixel·cos(lat at block centre). Approximation: < 1 % scale error inside a 2048-px block, i.e. < 1 tile value at the 2540 m cap. Nodata is never no-go and stays 255 |
| tile | `tile.py` | ZMAX straight from the rasters; each coarser level from the four child PNGs: class nearest (`--class-reduce mode` for majority), dist MIN. All-nodata tiles are not written |

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
