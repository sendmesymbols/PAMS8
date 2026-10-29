"""Step 3 — derive the intermediate masks the classifier stacks.

Inputs : work/grid/grid.json, work/grid/dem.tif, work/grid/jrc_occurrence.tif,
         work/raw/osm_pakistan/*.osm.pbf, classes.yaml (thresholds, OSM filters)
Outputs: work/derive/slope.tif           uint8 degrees 0..90, 255 nodata
         work/derive/jrc_permanent.tif   uint8 0/1
         work/derive/jrc_seasonal.tif    uint8 0/1
         work/derive/osm_<theme>.tif     uint8 0/1, one per theme in classes.yaml
         work/derive/osm_utm.gpkg, osm_3857.gpkg   vector intermediates

Slope is computed in numpy on blocks with a 1-px halo. Web Mercator is
conformal, so one scale factor per row — pixel_size * cos(lat) — converts
pixel gradients to metres in both axes.
Waterways are buffered by type in the metric CRS given by classes.yaml
(`osm.metric_crs`, UTM 42N) with shapely, then everything is reprojected to
EPSG:3857 by ogr2ogr and burnt with gdal_rasterize onto the grid.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

from common import GTIFF_U8, iter_blocks, load_json, load_yaml, row_latitudes, run, setup_logging

log = setup_logging("derive")


def u8_profile(grid: dict, nodata=None) -> dict:
    from rasterio.transform import Affine
    t = grid["transform"]
    p = dict(GTIFF_U8, width=grid["width"], height=grid["height"], crs=grid["crs"],
             transform=Affine(t[0], t[1], t[2], t[3], t[4], t[5]))
    p["nodata"] = nodata
    return p


def derive_slope(grid: dict, dem: Path, out: Path, block: int) -> None:
    import rasterio
    from rasterio.windows import Window
    with rasterio.open(dem) as src, rasterio.open(out, "w", **u8_profile(grid, 255)) as dst:
        nod = src.nodata
        for b in iter_blocks(grid["width"], grid["height"], block, halo=1):
            z = src.read(1, window=Window(b["rcol"], b["rrow"], b["rw"], b["rh"])).astype("float32")
            invalid = np.isnan(z) if nod is None else (z == nod) | np.isnan(z)
            z[invalid] = np.nan
            pm = grid["pixel_size"] * np.cos(np.radians(row_latitudes(grid, b["rrow"], b["rh"])))
            dzdy, dzdx = np.gradient(z)                         # per pixel
            slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy) / pm[:, None]))
            out_u8 = np.where(np.isnan(slope), 255, np.clip(np.rint(slope), 0, 90)).astype("uint8")
            core = out_u8[b["oy"]:b["oy"] + b["h"], b["ox"]:b["ox"] + b["w"]]
            dst.write(core, 1, window=Window(b["col"], b["row"], b["w"], b["h"]))
    log.info("slope -> %s", out)


def derive_jrc(grid: dict, occ_path: Path, out_dir: Path, jrc_cfg: dict, block: int) -> None:
    import rasterio
    from rasterio.windows import Window
    perm, seas = jrc_cfg["permanent_min_pct"], jrc_cfg["seasonal_min_pct"]
    prof = u8_profile(grid)
    with rasterio.open(occ_path) as src, \
         rasterio.open(out_dir / "jrc_permanent.tif", "w", **prof) as dp, \
         rasterio.open(out_dir / "jrc_seasonal.tif", "w", **prof) as ds:
        for b in iter_blocks(grid["width"], grid["height"], block):
            win = Window(b["col"], b["row"], b["w"], b["h"])
            occ = src.read(1, window=win)
            valid = occ <= 100                                   # 255 = nodata
            dp.write(((occ >= perm) & valid).astype("uint8"), 1, window=win)
            ds.write(((occ >= seas) & (occ < perm) & valid).astype("uint8"), 1, window=win)
    log.info("jrc masks -> %s", out_dir)


def extract_osm(pbf: Path, out_dir: Path, osm_cfg: dict, dry: bool) -> Path:
    """pbf -> osm_utm.gpkg (metric CRS): polygons per theme + buffered waterways."""
    gpkg = out_dir / "osm_utm.gpkg"
    gpkg.unlink(missing_ok=True)
    crs = osm_cfg["metric_crs"]
    common = ["-t_srs", crs, "--config", "OGR_INTERLEAVED_READING", "YES", "-nlt", "PROMOTE_TO_MULTI"]
    for theme, t in osm_cfg["themes"].items():
        run(["ogr2ogr", "-f", "GPKG", "-update", "-append", gpkg, pbf, "multipolygons",
             "-nln", theme, "-where", t["polygons"], *common], log, dry)
        if "waterways" in t:
            types = ",".join(f"'{k}'" for k in t["waterways"])
            run(["ogr2ogr", "-f", "GPKG", "-update", "-append", gpkg, pbf, "lines",
                 "-nln", f"{theme}_lines", "-where", f"waterway IN ({types})",
                 "-select", "waterway", *common], log, dry)
            if not dry:
                buffer_lines(gpkg, f"{theme}_lines", f"{theme}_buf", t["waterways"], crs)
    return gpkg


def buffer_lines(gpkg: Path, layer: str, out_layer: str, widths: dict, crs: str) -> None:
    import pyogrio
    import shapely
    meta, _, geoms, fields = pyogrio.raw.read(gpkg, layer=layer)
    kinds = fields[list(meta["fields"]).index("waterway")]
    lines = shapely.from_wkb(geoms)
    dist = np.array([float(widths.get(k, 0)) for k in kinds])
    bufs = shapely.buffer(lines, dist, quad_segs=4)
    pyogrio.raw.write(gpkg, shapely.to_wkb(bufs), [], fields=[], layer=out_layer,
                      driver="GPKG", geometry_type="MultiPolygon", crs=crs, append=True,
                      promote_to_multi=True)
    log.info("buffered %d waterway lines -> %s:%s", len(lines), gpkg.name, out_layer)


def rasterize_osm(grid: dict, gpkg_utm: Path, out_dir: Path, osm_cfg: dict, dry: bool) -> None:
    gpkg = out_dir / "osm_3857.gpkg"
    gpkg.unlink(missing_ok=True)
    run(["ogr2ogr", "-f", "GPKG", "-t_srs", "EPSG:3857", gpkg, gpkg_utm], log, dry)
    b, res = grid["bounds_3857"], grid["pixel_size"]
    for theme, t in osm_cfg["themes"].items():
        layers = ["-l", theme] + (["-l", f"{theme}_buf"] if "waterways" in t else [])
        run(["gdal_rasterize", "-burn", "1", "-ot", "Byte", "-init", "0", "-a_srs", "EPSG:3857",
             "-te", *map(str, b), "-tr", str(res), str(res), *layers,
             "-co", "COMPRESS=DEFLATE", "-co", "TILED=YES", "-co", "BIGTIFF=IF_SAFER",
             gpkg, out_dir / f"osm_{theme}.tif"], log, dry)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--grid", type=Path, default=Path("work/grid"))
    ap.add_argument("--raw", type=Path, default=Path("work/raw"))
    ap.add_argument("--out", type=Path, default=Path("work/derive"))
    ap.add_argument("--classes", type=Path, default=Path("classes.yaml"))
    ap.add_argument("--block", type=int, default=2048)
    ap.add_argument("--only", nargs="*", choices=["slope", "jrc", "osm"], help="subset of products")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    grid = load_json(args.grid / "grid.json")
    cfg = load_yaml(args.classes)["sources"]
    args.out.mkdir(parents=True, exist_ok=True)
    want = set(args.only or ["slope", "jrc", "osm"])

    if "slope" in want and not args.dry_run:
        derive_slope(grid, args.grid / "dem.tif", args.out / "slope.tif", args.block)
    if "jrc" in want and not args.dry_run:
        derive_jrc(grid, args.grid / "jrc_occurrence.tif", args.out, cfg["jrc"], args.block)
    if "osm" in want:
        pbf = next((args.raw / "osm_pakistan").glob("*.osm.pbf"), Path("pakistan.osm.pbf"))
        gpkg = extract_osm(pbf, args.out, cfg["osm"], args.dry_run)
        rasterize_osm(grid, gpkg, args.out, cfg["osm"], args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
