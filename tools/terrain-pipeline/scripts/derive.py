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

Hybrid data (optional): when an NCGDB geodatabase is available (classes.yaml
`sources.ncgdb`, overridden by --ncgdb / $NCGDB_PATH; `--ncgdb none` disables) the
`ncgdb` product is also built:
         work/derive/ncgdb_class.tif       uint8 class code, 255 = NCGDB maps nothing here
         work/derive/ncgdb_provenance.json fingerprint of the geodatabase + rules used
Each worker process reads the polygons of one block straight from the .gdb (no full
reprojection of 5 GB), projects them to Web Mercator, burns every rule of classes.yaml
and paints the classes lowest-precedence first, so each pixel keeps the strongest
class NCGDB asserts. scripts/classify.py then merges that with the open data.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from common import (GTIFF_U8, class_table, iter_blocks, load_json, load_yaml, merc_to_lnglat,
                    row_latitudes, run, setup_logging)

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
            # No `-select`: ogr2ogr refuses it together with -append ("if -append is specified,
            # -select cannot be used"). The `waterway` column buffer_lines() needs is kept anyway.
            run(["ogr2ogr", "-f", "GPKG", "-update", "-append", gpkg, pbf, "lines",
                 "-nln", f"{theme}_lines", "-where", f"waterway IN ({types})", *common], log, dry)
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


def _merc_xy(coords: np.ndarray) -> np.ndarray:
    """(N, 2) lon/lat degrees -> Web Mercator metres (vectorised; used with shapely.transform)."""
    r = 6378137.0
    out = np.empty(coords.shape, dtype="float64")
    out[:, 0] = np.radians(coords[:, 0]) * r
    out[:, 1] = np.log(np.tan(np.pi / 4 + np.radians(np.clip(coords[:, 1], -85.0511, 85.0511)) / 2)) * r
    return out


def _ncgdb_block(task: tuple) -> np.ndarray:
    """Worker: the NCGDB class raster of ONE block (uint8, 255 = nothing mapped).

    Top-level so it can be pickled into a worker process. Reads each layer once per block with a bbox,
    so cost scales with the block, not with the 5 GB database.
    """
    gdb, rules, rank, bounds, w, h, tr = task
    import warnings
    warnings.filterwarnings("ignore", category=RuntimeWarning)   # GDAL: "spatial index depth is suspicious" (it falls back to a scan)
    import pyogrio.raw as raw
    import shapely
    from rasterio.features import rasterize
    from rasterio.transform import Affine

    x0, y0, x1, y1 = bounds
    lon0, lat0 = merc_to_lnglat(x0, y0)
    lon1, lat1 = merc_to_lnglat(x1, y1)
    pad = 0.003                                   # ~300 m so polygons crossing the block edge are read
    bbox = (min(lon0, lon1) - pad, min(lat0, lat1) - pad, max(lon0, lon1) + pad, max(lat0, lat1) + pad)
    transform = Affine(*tr)
    masks: dict[int, np.ndarray] = {}

    by_layer: dict[str, list[dict]] = {}
    for r in rules:
        by_layer.setdefault(r["layer"], []).append(r)
    for layer, rs in by_layer.items():
        fields = sorted({r["field"] for r in rs})
        meta, _fid, geom, data = raw.read(gdb, layer=layer, bbox=bbox, columns=fields)
        if len(geom) == 0:
            continue
        gs = shapely.transform(shapely.from_wkb(geom), _merc_xy)
        bad = ~shapely.is_valid(gs)
        if bad.any():
            gs[bad] = shapely.make_valid(gs[bad])
        cols = dict(zip(meta["fields"], data))
        typ = {f: np.array([("" if v is None else str(v).strip()) for v in cols[f]]) for f in fields}
        for r in rs:
            t = typ[r["field"]]
            sel = np.isin(t, r["values"])
            if not sel.any():
                continue
            shapes = [(g, 1) for g, s in zip(gs, sel) if s and g is not None and not g.is_empty]
            if not shapes:
                continue
            m = rasterize(shapes, out_shape=(h, w), transform=transform, fill=0, dtype="uint8",
                          all_touched=bool(r.get("all_touched"))).astype(bool)
            if r.get("exclude") and m.any():
                holes = [(g, 1) for g, s in zip(gs, np.isin(t, r["exclude"])) if s and g is not None and not g.is_empty]
                if holes:
                    m &= ~rasterize(holes, out_shape=(h, w), transform=transform, fill=0, dtype="uint8").astype(bool)
            code = r["code"]
            masks[code] = (masks[code] | m) if code in masks else m

    out = np.full((h, w), 255, dtype="uint8")
    for code in sorted(masks, key=lambda c: -rank[c]):     # lowest precedence first, highest overwrites
        out[masks[code]] = code
    return out


def ncgdb_fingerprint(gdb: Path) -> dict:
    """Cheap, stable identity of a geodatabase folder: file count, bytes, newest mtime, hash of the listing."""
    files = sorted(p for p in gdb.iterdir() if p.is_file())
    listing = "\n".join(f"{p.name} {p.stat().st_size}" for p in files)
    newest = max((p.stat().st_mtime for p in files), default=0)
    return {"files": len(files), "bytes": sum(p.stat().st_size for p in files),
            "newest_file": datetime.fromtimestamp(newest, timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "listing_sha256": hashlib.sha256(listing.encode()).hexdigest()}


def resolve_ncgdb(cli: str | None, cfg_path: str | None) -> tuple[Path | None, bool]:
    """(path or None, explicit). `none` disables; CLI/env are explicit (missing = error); the yaml default is soft."""
    pick = cli or os.environ.get("NCGDB_PATH")
    if pick:
        return (None, True) if pick.strip().lower() in ("none", "off", "no", "") else (Path(pick), True)
    return (Path(cfg_path) if cfg_path else None), False


def derive_ncgdb(grid: dict, gdb: Path, class_cfg: dict, out_dir: Path, block: int, workers: int) -> None:
    """Rasterize the NCGDB rules onto the grid -> ncgdb_class.tif + ncgdb_provenance.json."""
    import pyogrio
    import rasterio
    from concurrent.futures import ProcessPoolExecutor
    from rasterio.windows import Window

    codes = class_table(class_cfg)
    rank = {codes[n]: i for i, n in enumerate(class_cfg["precedence"])}
    nc = class_cfg["sources"]["ncgdb"]
    rules = [dict(r, code=codes[r["class"]]) for r in nc["rules"]]
    missing_class = [r["class"] for r in nc["rules"] if codes[r["class"]] not in rank]
    if missing_class:
        raise SystemExit(f"NCGDB rules use classes missing from `precedence`: {sorted(set(missing_class))}")

    # Fail early and clearly if this geodatabase does not have the layers / fields the rules expect.
    have = {name for name, _ in pyogrio.list_layers(gdb)}
    used: dict[str, int] = {}
    for layer in sorted({r["layer"] for r in rules}):
        if layer not in have:
            raise SystemExit(f"NCGDB layer '{layer}' not found in {gdb} (has {len(have)} layers)")
        info = pyogrio.read_info(gdb, layer=layer)
        need = {r["field"] for r in rules if r["layer"] == layer}
        if need - set(info["fields"]):
            raise SystemExit(f"NCGDB layer '{layer}' lacks field(s) {sorted(need - set(info['fields']))}")
        used[layer] = int(info["features"])

    res = grid["pixel_size"]
    left, top = grid["bounds_3857"][0], grid["bounds_3857"][3]
    tasks, wins = [], []
    for b in iter_blocks(grid["width"], grid["height"], block):
        bx0 = left + b["col"] * res
        by1 = top - b["row"] * res
        tasks.append((str(gdb), rules, rank, (bx0, by1 - b["h"] * res, bx0 + b["w"] * res, by1), b["w"], b["h"],
                      (res, 0.0, bx0, 0.0, -res, by1)))
        wins.append(Window(b["col"], b["row"], b["w"], b["h"]))
    log.info("NCGDB %s: %d rules over %d layers, %d blocks, %d workers", gdb.name, len(rules), len(used), len(tasks), workers)

    out_tif = out_dir / "ncgdb_class.tif"
    hist = np.zeros(256, dtype=np.int64)
    chunk = max(1, workers * 3)
    with rasterio.open(out_tif, "w", **u8_profile(grid, 255)) as dst, ProcessPoolExecutor(workers) as pool:
        for i in range(0, len(tasks), chunk):
            for win, arr in zip(wins[i:i + chunk], pool.map(_ncgdb_block, tasks[i:i + chunk])):
                dst.write(arr, 1, window=win)
                hist += np.bincount(arr.ravel(), minlength=256)
            log.info("  ncgdb blocks %d/%d", min(i + chunk, len(tasks)), len(tasks))
    names = {v: k for k, v in codes.items()}
    total = int(hist.sum())
    log.info("ncgdb classes (%% of grid pixels; 255 = not mapped): %s",
             ", ".join(f"{names.get(c, c)} {100 * hist[c] / total:.2f}%" for c in np.nonzero(hist)[0]))

    prov = {"id": "ncgdb", "name": f"{gdb.name} (local, not downloaded)", "version": gdb.stem,
            "licence": nc.get("licence", "restricted"), "attribution": nc.get("attribution", ""),
            "fingerprint": ncgdb_fingerprint(gdb), "layers_used": used,
            "rules_sha256": hashlib.sha256(json.dumps(nc["rules"], sort_keys=True).encode()).hexdigest(),
            "built": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "restricted": True}
    (out_dir / "ncgdb_provenance.json").write_text(json.dumps(prov, indent=1), encoding="utf-8")
    log.info("ncgdb -> %s", out_tif)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--grid", type=Path, default=Path("work/grid"))
    ap.add_argument("--raw", type=Path, default=Path("work/raw"))
    ap.add_argument("--out", type=Path, default=Path("work/derive"))
    ap.add_argument("--classes", type=Path, default=Path("classes.yaml"))
    ap.add_argument("--block", type=int, default=2048)
    ap.add_argument("--only", nargs="*", choices=["slope", "jrc", "osm", "ncgdb"], help="subset of products")
    ap.add_argument("--ncgdb", help="NCGDB .gdb folder (default: classes.yaml, then $NCGDB_PATH); 'none' = open data only")
    ap.add_argument("--workers", type=int, default=6, help="processes for the NCGDB product")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    grid = load_json(args.grid / "grid.json")
    class_cfg = load_yaml(args.classes)
    cfg = class_cfg["sources"]
    args.out.mkdir(parents=True, exist_ok=True)
    gdb, explicit = resolve_ncgdb(args.ncgdb, cfg.get("ncgdb", {}).get("path"))
    use_ncgdb = gdb is not None and gdb.is_dir()
    if gdb is not None and not use_ncgdb:
        if explicit:
            raise SystemExit(f"NCGDB folder not found: {gdb}  (pass --ncgdb none for open data only)")
        log.warning("NCGDB not found at %s - building from open data only", gdb)
    want = set(args.only or ["slope", "jrc", "osm"] + (["ncgdb"] if use_ncgdb else []))

    if "slope" in want and not args.dry_run:
        derive_slope(grid, args.grid / "dem.tif", args.out / "slope.tif", args.block)
    if "jrc" in want and not args.dry_run:
        derive_jrc(grid, args.grid / "jrc_occurrence.tif", args.out, cfg["jrc"], args.block)
    if "osm" in want:
        pbf = next((args.raw / "osm_pakistan").glob("*.osm.pbf"), Path("pakistan.osm.pbf"))
        gpkg = extract_osm(pbf, args.out, cfg["osm"], args.dry_run)
        rasterize_osm(grid, gpkg, args.out, cfg["osm"], args.dry_run)
    if "ncgdb" in want and use_ncgdb and not args.dry_run:
        derive_ncgdb(grid, gdb, class_cfg, args.out, args.block, args.workers)
    elif not use_ncgdb and not args.dry_run:
        # open-data run: make sure a previous hybrid run cannot leak into classify.py
        for stale in ("ncgdb_class.tif", "ncgdb_provenance.json"):
            (args.out / stale).unlink(missing_ok=True)
    if not args.dry_run and not args.only:
        (args.out / ".mode").write_text("hybrid" if use_ncgdb else "open", encoding="ascii")
    return 0


if __name__ == "__main__":
    sys.exit(main())
