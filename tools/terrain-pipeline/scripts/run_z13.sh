#!/usr/bin/env bash
# 2026-11-20: bundle at ZMAX 13 (~16 m) with the Google GEM-15 DTM over Copernicus GLO-30.
# Rebuilds every grid raster in $W (not work/), cuts tiles into $OUT; the live bundle is not touched here.
# Each step leaves a .done stamp and is skipped next time, so a stopped run goes on where it stopped.
# Needs the GDAL Docker container (GDAL_CONTAINER) running. scripts/resume_z13.sh runs this, then assembles and swaps.
#   W=work/z13 OUT=out/terrain-bundle-z13 bash scripts/run_z13.sh            # full
#   W=work/z13test OUT=out/z13test AOI=72.9,33.6,73.2,33.8 bash scripts/run_z13.sh   # test area
set -euo pipefail
cd "$(dirname "$0")/.."   # the pipeline dir
export GDAL_CONTAINER=GDAL PYTHONUTF8=1
PY=.venv/Scripts/python.exe
W=${W:-work/z13}; OUT=${OUT:-out/terrain-bundle-z13}; AOI=${AOI:-}
mkdir -p "$W/logs"
T0=$(date +%s)
step() { echo; echo "==> $1  $(date +%T)  (+$(( ($(date +%s) - T0) / 60 )) min)"; }
AOI_ARG=(); [ -n "$AOI" ] && AOI_ARG=(--aoi "$AOI")

if [ ! -f "$W/grid/.done" ]; then
step "grid z13 (worldcover, JRC, GEM-15 over GLO-30)"
$PY scripts/grid.py "${AOI_ARG[@]}" --zmin 8 --zmax 13 --target-res-m 30 --raw work/raw --out "$W/grid" \
    --boundary work/boundary/clip.geojson --boundary-source frame --gem15 work/raw/gem15 > "$W/logs/grid.log" 2>&1
tail -4 "$W/logs/grid.log"; touch "$W/grid/.done"
fi

if [ ! -f "$W/derive/.done" ]; then
step "derive (slope, JRC, OSM, NCGDB)"
$PY scripts/derive.py --grid "$W/grid" --raw work/raw --out "$W/derive" --classes classes.yaml --block 2048 --workers 10 > "$W/logs/derive.log" 2>&1
tail -3 "$W/logs/derive.log"; touch "$W/derive/.done"
fi

if [ ! -f "$W/grotbc/.done" ]; then
step "grotbc relief + vector rasters"
$PY scripts/grotbc.py --grid "$W/grid" --derive "$W/derive" --out "$W/grotbc" --classes classes.yaml --rules rules.yaml \
    --workers 10 --only relief vector > "$W/logs/grotbc.log" 2>&1
tail -3 "$W/logs/grotbc.log"; touch "$W/grotbc/.done"
fi

if [ ! -f "$W/classify/.done" ]; then
step "classify"
$PY scripts/classify.py --grid "$W/grid" --derive "$W/derive" --grotbc "$W/grotbc" --out "$W/classify" --classes classes.yaml > "$W/logs/classify.log" 2>&1
tail -3 "$W/logs/classify.log"; touch "$W/classify/.done"
fi

if [ ! -f "$W/terrain/.done" ]; then
step "terrain (terrain, soil, hut, bank)"
$PY scripts/terrain.py --grid "$W/grid" --classify "$W/classify" --grotbc "$W/grotbc" --raw work/raw --out "$W/terrain" > "$W/logs/terrain.log" 2>&1
tail -3 "$W/logs/terrain.log"; touch "$W/terrain/.done"
fi

if [ ! -f "$W/buildings/.done" ]; then
mkdir -p "$W/buildings"
if ls work/raw/openbuildings/*_buildings.csv.gz >/dev/null 2>&1; then
  step "buildings (bld.tif from Open Buildings)"
  $PY scripts/buildings.py --grid "$W/grid/grid.json" --raw work/raw --class-tif "$W/classify/class.tif" --out "$W/buildings" --workers 3 > "$W/logs/buildings.log" 2>&1
else
  # the Open Buildings CSVs are no longer in work/raw: bld is a ~150 m cell product, so the z12 bld.tif warped
  # nearest onto the z13 grid carries exactly the same cells (the class mask is the same boundary)
  step "buildings (z12 bld.tif warped nearest onto the grid; Open Buildings raw not present)"
  read -r B0 B1 B2 B3 RES < <($PY -c "import json;g=json.load(open('$W/grid/grid.json'));print(*g['bounds_3857'],g['pixel_size'])")
  MSYS_NO_PATHCONV=1 docker exec GDAL gdalwarp -overwrite -t_srs EPSG:3857 -te $B0 $B1 $B2 $B3 -tr $RES $RES -r near -dstnodata 255 \
      -multi -wo NUM_THREADS=ALL_CPUS -of COG -co COMPRESS=DEFLATE -co BLOCKSIZE=512 -co OVERVIEWS=NONE -co BIGTIFF=IF_SAFER \
      /work/work/buildings/bld.tif "/work/$W/buildings/bld.tif" > "$W/logs/buildings.log" 2>&1
fi
tail -3 "$W/logs/buildings.log"; touch "$W/buildings/.done"
fi

if [ ! -f "$W/profiles/.done" ]; then
step "profiles (dist_*, rules.json)"
pids=()
for grp in "rail signals" "oversnow roadbound" "tracked vessel" "dismounted wheeled" "generic gun" "amphibious pack" "ad hls"; do
  $PY scripts/profiles.py --rules rules.yaml --classes classes.yaml --grid "$W/grid" --class-tif "$W/classify/class.tif" \
      --out "$W/profiles" --only $grp > "$W/logs/profiles_${grp// /_}.log" 2>&1 & pids+=($!)
done
for p in "${pids[@]}"; do wait $p; done
$PY scripts/profiles.py --rules rules.yaml --classes classes.yaml --grid "$W/grid" --class-tif "$W/classify/class.tif" --out "$W/profiles" --rules-only > "$W/logs/profiles_rules.log" 2>&1
ls "$W/profiles" | tr '\n' ' '; echo; touch "$W/profiles/.done"
fi

if [ ! -f "$W/tile.done" ]; then
step "tile -> $OUT"
rm -rf "$OUT"
$PY scripts/tile.py --grid "$W/grid" --class-tif "$W/classify/class.tif" --profiles "$W/profiles" --grotbc "$W/grotbc" \
    --terrain "$W/terrain" --buildings "$W/buildings" --out "$OUT" --workers 12 > "$W/logs/tile.log" 2>&1
grep -E "layers|z13:|z8 class|rules.json" "$W/logs/tile.log" | tail -5; touch "$W/tile.done"
fi
step "done"
