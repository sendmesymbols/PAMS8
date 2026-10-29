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

Variables: `AOI` (`w,s,e,n`, default Pakistan `60.8,23.6,77.9,37.1`), `RES_M`
(target, 30), `ZMIN`/`ZMAX` (8/12), `OUT_DIR`, `WORKERS`, `BLOCK`, `BOUNDARY`
(GeoJSON clip polygon; default = OSM `admin_level=2` relation with
`ISO3166-1=PK`, see `grid.py`). Example: `make bundle ZMAX=13 WORKERS=8`.

Steps write `work/<step>/` and a `.done` stamp; `make clean-<step>` forces a
re-run of that step and everything after it. Only `make fetch` touches the
network.

### Prerequisites

- Linux / WSL, Python 3.11+, GDAL 3.4+ command-line tools on `PATH`
  (`gdalwarp gdalbuildvrt gdal_rasterize gdal_translate ogr2ogr`), the OSM
  driver built in (`ogrinfo --formats | grep OSM`).
- Python packages from `requirements.txt` (rasterio/pyogrio wheels bundle
  their own GDAL, which is fine; only the CLI tools need the system GDAL).
- Disk: ~25 GB raw downloads, ~20 GB `work/`, bundle itself ~1-3 GB
  (the z12 grid over Pakistan is ~49k x 46k px; every step streams in blocks,
  RAM use is bounded by `BLOCK` — 2048 needs ~1-2 GB).

### Before the first run — check `sources.lock`

The download URL patterns in `sources.lock` are marked **verify**: they are
the documented bucket layouts, not verified facts. Open each `landing` page,
confirm the pattern/version (and pin a dated Geofabrik file instead of
`-latest`), then run `make fetch`. `fetch.py --record` (used by the Makefile)
writes the sha256 of what it downloaded into the lock in place of
`TO_BE_FILLED`; commit that lock. On later runs hashes are verified and a
mismatch fails the build. `manifest.json` carries the same hashes.

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
| derive | `derive.py` | slope in degrees from `np.gradient` scaled by `pixel·cos(lat)` per row; JRC occurrence ≥ 80 % permanent, 20–80 % seasonal; OSM themes extracted with `ogr2ogr`, waterways buffered in UTM 42N (river 40 m, canal 15 m, stream 5 m), rasterised with `gdal_rasterize` |
| classify | `classify.py` | evidence masks painted low→high precedence: water_permanent > wetland > mangrove > built_up > restricted > snow_ice > steep_slope > water_seasonal > moderate_slope > tree_cover > cropland > bare_desert > open_land |
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

The OSM contribution (water bodies, wetlands, restricted and built-up areas)
means the derived `class` and `dist` tiles are a *derivative database* under
ODbL: redistribute the bundle with `LICENSES.txt` and under ODbL-compatible
terms. The country boundary used for clipping is OpenStreetMap's and reflects
OSM's rendering of disputed borders; pass `BOUNDARY=<your.geojson>` to use
an official boundary instead.
