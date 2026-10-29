"""Step 4 — stack the masks by precedence into one class raster.

Inputs : work/grid/grid.json, work/grid/worldcover.tif, work/grid/jrc_occurrence.tif,
         work/derive/slope.tif, work/derive/osm_<theme>.tif, classes.yaml
Outputs: work/classify/class.tif   uint8 class code, 255 nodata, COG + DEFLATE

For each block every class collects a boolean "evidence" mask from the
sources (WorldCover code map, JRC thresholds, slope thresholds, OSM themes).
Classes are then painted from the LOWEST precedence to the HIGHEST, so the
first entry of `precedence` in classes.yaml wins wherever masks overlap.
A pixel with no evidence at all (WorldCover 0 and nothing else) stays 255.
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

from common import (COG_OPTS, GTIFF_U8, class_table, iter_blocks, load_json, load_yaml, run,
                    setup_logging)

log = setup_logging("classify")


def evidence(arrays: dict, src_cfg: dict, shape) -> dict[str, np.ndarray]:
    m: dict[str, np.ndarray] = defaultdict(lambda: np.zeros(shape, dtype=bool))
    wc, occ, slope = arrays["worldcover"], arrays["jrc_occurrence"], arrays["slope"]
    for code, name in src_cfg["worldcover"].items():
        m[name] |= wc == int(code)
    j = src_cfg["jrc"]
    jv = occ <= 100
    m["water_permanent"] |= jv & (occ >= j["permanent_min_pct"])
    m["water_seasonal"] |= jv & (occ >= j["seasonal_min_pct"]) & (occ < j["permanent_min_pct"])
    s = src_cfg["slope"]
    sv = slope != 255
    m["steep_slope"] |= sv & (slope >= s["steep_deg"])
    m["moderate_slope"] |= sv & (slope >= s["moderate_deg"]) & (slope < s["steep_deg"])
    for theme, t in src_cfg["osm"]["themes"].items():
        m[t["class"]] |= arrays[f"osm_{theme}"] == 1
    return m


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--grid", type=Path, default=Path("work/grid"))
    ap.add_argument("--derive", type=Path, default=Path("work/derive"))
    ap.add_argument("--out", type=Path, default=Path("work/classify"))
    ap.add_argument("--classes", type=Path, default=Path("classes.yaml"))
    ap.add_argument("--block", type=int, default=2048)
    args = ap.parse_args()

    import rasterio
    from rasterio.transform import Affine
    from rasterio.windows import Window

    grid = load_json(args.grid / "grid.json")
    cfg = load_yaml(args.classes)
    codes = class_table(cfg)
    order = [n for n in reversed(cfg["precedence"])]          # paint low -> high
    unknown = set(order) - set(codes)
    if unknown:
        raise SystemExit(f"precedence names not in class table: {unknown}")

    paths = {"worldcover": args.grid / "worldcover.tif",
             "jrc_occurrence": args.grid / "jrc_occurrence.tif",
             "slope": args.derive / "slope.tif"}
    for theme in cfg["sources"]["osm"]["themes"]:
        paths[f"osm_{theme}"] = args.derive / f"osm_{theme}.tif"
    missing = [str(p) for p in paths.values() if not p.exists()]
    if missing:
        raise SystemExit("missing inputs: " + ", ".join(missing))

    args.out.mkdir(parents=True, exist_ok=True)
    tmp = args.out / "class_tmp.tif"
    t = grid["transform"]
    prof = dict(GTIFF_U8, width=grid["width"], height=grid["height"], crs=grid["crs"],
                transform=Affine(*t))
    srcs = {k: rasterio.open(p) for k, p in paths.items()}
    hist = np.zeros(256, dtype=np.int64)
    try:
        with rasterio.open(tmp, "w", **prof) as dst:
            for i, b in enumerate(iter_blocks(grid["width"], grid["height"], args.block)):
                win = Window(b["col"], b["row"], b["w"], b["h"])
                arrays = {k: s.read(1, window=win) for k, s in srcs.items()}
                m = evidence(arrays, cfg["sources"], (b["h"], b["w"]))
                cls = np.full((b["h"], b["w"]), 255, dtype=np.uint8)
                for name in order:
                    cls[m[name]] = codes[name]
                dst.write(cls, 1, window=win)
                hist += np.bincount(cls.ravel(), minlength=256)
                if i % 50 == 0:
                    log.info("block %d at row %d/%d", i, b["row"], grid["height"])
    finally:
        for s in srcs.values():
            s.close()

    run(["gdal_translate", *COG_OPTS, tmp, args.out / "class.tif"], log)
    tmp.unlink(missing_ok=True)
    total = int(hist.sum())
    log.info("class histogram (%% of all pixels incl. nodata):")
    for name, code in sorted(codes.items(), key=lambda kv: kv[1]):
        if hist[code]:
            log.info("  %3d %-16s %6.2f%%", code, name, 100 * hist[code] / total)
    return 0


if __name__ == "__main__":
    sys.exit(main())
