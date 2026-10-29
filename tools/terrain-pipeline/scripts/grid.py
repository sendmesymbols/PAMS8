"""Step 2 — define the target grid and warp every raster source onto it.

Inputs : work/raw/<source>/*.tif (from fetch.py), the AOI, ZMIN/ZMAX and either
         --boundary <GeoJSON> or the OSM extract (admin_level=2 relation).
Outputs: work/grid/grid.json      target grid definition (see build_grid())
         work/grid/boundary.geojson  clip polygon (copied or extracted from OSM)
         work/grid/worldcover.tif  uint8, nodata 0,     nearest
         work/grid/jrc_occurrence.tif uint8, nodata 255, nearest
         work/grid/dem.tif         float32, nodata -32768, bilinear

Grid: EPSG:3857, pixel size = resolution of zoom ZMAX, extent snapped OUTWARD
to whole ZMAX tiles so every tile boundary falls on a pixel boundary. All
later steps read grid.json instead of recomputing anything.
Only GDAL command-line tools are used here so the heavy lifting streams
through gdalwarp (-multi, all CPUs) and never loads a full raster in Python.
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

from common import (COG_OPTS, TILE_SIZE, dump_json, parse_aoi, resolution, run,
                    setup_logging, tile_bounds_merc, tile_range)

log = setup_logging("grid")

ISO_FILTER = "other_tags LIKE '%\"ISO3166-1\"=>\"PK\"%'"   # verify against the extract


def build_grid(aoi, zmin: int, zmax: int) -> dict:
    x0, y0, x1, y1 = tile_range(aoi, zmax)
    minx, _, _, maxy = tile_bounds_merc(zmax, x0, y0)
    _, miny, maxx, _ = tile_bounds_merc(zmax, x1, y1)
    res = resolution(zmax)
    width, height = (x1 - x0 + 1) * TILE_SIZE, (y1 - y0 + 1) * TILE_SIZE
    return dict(crs="EPSG:3857", aoi=list(aoi), zmin=zmin, zmax=zmax, pixel_size=res,
                tile_range=[x0, y0, x1, y1], bounds_3857=[minx, miny, maxx, maxy],
                width=width, height=height,
                transform=[res, 0.0, minx, 0.0, -res, maxy],   # GDAL-style affine
                tile_size=TILE_SIZE)


def extract_boundary(pbf: Path, dest: Path, dry: bool) -> None:
    run(["ogr2ogr", "-f", "GeoJSON", dest, pbf, "multipolygons", "-where",
         f"boundary='administrative' AND admin_level='2' AND {ISO_FILTER}",
         "--config", "OGR_INTERLEAVED_READING", "YES"], log, dry)


def warp(src: list[Path], dest: Path, grid: dict, boundary: Path, resample: str,
         dtype: str, src_nodata: str | None, dst_nodata: str, dry: bool) -> None:
    vrt = dest.with_suffix(".vrt")
    run(["gdalbuildvrt", "-overwrite", vrt, *src], log, dry)
    b = grid["bounds_3857"]
    res = grid["pixel_size"]
    cmd = ["gdalwarp", "-overwrite", "-t_srs", "EPSG:3857", "-te", *map(str, b),
           "-tr", str(res), str(res), "-r", resample, "-ot", dtype,
           "-cutline", boundary, "-dstnodata", dst_nodata,
           "-multi", "-wo", "NUM_THREADS=ALL_CPUS", "-wm", "1024", *COG_OPTS]
    if src_nodata is not None:
        cmd += ["-srcnodata", src_nodata]
    run(cmd + [vrt, dest], log, dry)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--aoi", default="60.8,23.6,77.9,37.1", help="west,south,east,north (WGS84)")
    ap.add_argument("--zmin", type=int, default=8)
    ap.add_argument("--zmax", type=int, default=12)
    ap.add_argument("--target-res-m", type=float, default=30.0,
                    help="warn if the ZMAX ground resolution at the AOI centre is coarser than this")
    ap.add_argument("--raw", type=Path, default=Path("work/raw"))
    ap.add_argument("--out", type=Path, default=Path("work/grid"))
    ap.add_argument("--boundary", type=Path, help="GeoJSON clip polygon; default: extract from OSM")
    ap.add_argument("--skip-warp", action="store_true", help="only write grid.json + boundary")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    aoi = parse_aoi(args.aoi)
    grid = build_grid(aoi, args.zmin, args.zmax)
    args.out.mkdir(parents=True, exist_ok=True)
    dump_json(args.out / "grid.json", grid)
    log.info("grid z%d: %d x %d px, %.3f m/px (equator), tiles x %d..%d y %d..%d",
             grid["zmax"], grid["width"], grid["height"], grid["pixel_size"], *grid["tile_range"])
    log.info("memory note: one uint8 plane = %.1f GB -> every step works in blocks",
             grid["width"] * grid["height"] / 1e9)
    import math
    ground = grid["pixel_size"] * math.cos(math.radians((aoi[1] + aoi[3]) / 2))
    log.info("ground resolution at AOI centre latitude: %.1f m/px (target %.0f m)", ground, args.target_res_m)
    if ground > args.target_res_m * 1.5:
        log.warning("ZMAX=%d is much coarser than the %.0f m target; consider ZMAX=%d",
                    args.zmax, args.target_res_m, args.zmax + 1)

    boundary = args.out / "boundary.geojson"
    if args.boundary:
        shutil.copyfile(args.boundary, boundary)
    elif not boundary.exists() or args.dry_run:
        pbf = next((args.raw / "osm_pakistan").glob("*.osm.pbf"), None)
        if pbf is None and not args.dry_run:
            log.error("no OSM .pbf in %s and no --boundary given", args.raw / "osm_pakistan")
            return 1
        extract_boundary(pbf or Path("pakistan.osm.pbf"), boundary, args.dry_run)
    if args.skip_warp:
        return 0

    sources = [  # (raw subfolder, output name, resample, dtype, src nodata, dst nodata)
        ("worldcover", "worldcover.tif", "near", "Byte", "0", "0"),
        ("jrc_gsw", "jrc_occurrence.tif", "near", "Byte", "255", "255"),
        ("glo30", "dem.tif", "bilinear", "Float32", None, "-32768"),
    ]
    for sub, name, resample, dtype, snd, dnd in sources:
        files = sorted((args.raw / sub).glob("*.tif"))
        if not files and not args.dry_run:
            log.error("no rasters in %s", args.raw / sub)
            return 1
        warp(files, args.out / name, grid, boundary, resample, dtype, snd, dnd, args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
