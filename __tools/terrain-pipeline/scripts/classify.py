"""Step 4 — stack the masks by precedence into one class raster.

Inputs : work/grid/grid.json, work/grid/worldcover.tif, work/grid/jrc_occurrence.tif,
         work/derive/slope.tif, work/derive/osm_<theme>.tif, classes.yaml
         work/derive/ncgdb_class.tif   (optional: present when derive.py ran with an NCGDB)
Outputs: work/classify/class.tif        uint8 class code, 255 nodata, COG + DEFLATE
         work/classify/class_stats.json class histogram + what NCGDB changed vs open data only

For each block every class collects a boolean "evidence" mask from the
sources (WorldCover code map, JRC thresholds, slope thresholds, OSM themes and,
when present, the NCGDB class raster). Classes are then painted from the LOWEST
precedence to the HIGHEST, so the first entry of `precedence` in classes.yaml
wins wherever masks overlap. Because every class takes evidence from every source,
this is a union per class: the hybrid result is the strongest class ANY source asserts.
Pixels outside the WorldCover valid area (the country cutline) stay 255, so NCGDB data
for neighbouring countries can never leak in.

With an NCGDB the block is classified twice (open data only, then with NCGDB) so the
report can say exactly how many pixels NCGDB changed and into what.
"""
from __future__ import annotations

import argparse
import json
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
    ncgdb_path = args.derive / "ncgdb_class.tif"
    hybrid = ncgdb_path.exists()
    if hybrid:
        paths["ncgdb"] = ncgdb_path
    log.info("mode: %s", "HYBRID (open data + NCGDB)" if hybrid else "open data only")

    def paint(m: dict, shape) -> np.ndarray:
        cls = np.full(shape, 255, dtype=np.uint8)
        for name in order:
            cls[m[name]] = codes[name]
        return cls

    args.out.mkdir(parents=True, exist_ok=True)
    tmp = args.out / "class_tmp.tif"
    t = grid["transform"]
    prof = dict(GTIFF_U8, width=grid["width"], height=grid["height"], crs=grid["crs"],
                transform=Affine(*t))
    srcs = {k: rasterio.open(p) for k, p in paths.items()}
    hist = np.zeros(256, dtype=np.int64)
    trans = np.zeros(256 * 256, dtype=np.int64)          # open-data class -> final class
    try:
        with rasterio.open(tmp, "w", **prof) as dst:
            for i, b in enumerate(iter_blocks(grid["width"], grid["height"], args.block)):
                win = Window(b["col"], b["row"], b["w"], b["h"])
                arrays = {k: s.read(1, window=win) for k, s in srcs.items()}
                shape = (b["h"], b["w"])
                valid = arrays["worldcover"] != 0                 # inside the country cutline
                m = evidence(arrays, cfg["sources"], shape)
                cls = paint(m, shape)
                if hybrid:
                    base = cls
                    n = arrays["ncgdb"]
                    for name, code in codes.items():
                        if code != 255:
                            m[name] |= n == code
                    cls = paint(m, shape)
                    base = np.where(valid, base, 255).astype(np.uint8)
                cls[~valid] = 255
                if hybrid:
                    trans += np.bincount(base.astype(np.int64).ravel() * 256 + cls.ravel(), minlength=256 * 256)
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
    names = {v: k for k, v in codes.items()}
    log.info("class histogram (%% of all pixels incl. nodata):")
    for name, code in sorted(codes.items(), key=lambda kv: kv[1]):
        if hist[code]:
            log.info("  %3d %-16s %6.2f%%", code, name, 100 * hist[code] / total)

    stats = {"mode": "hybrid" if hybrid else "open", "pixels": total,
             "histogram": {names.get(c, str(c)): int(hist[c]) for c in np.nonzero(hist)[0]}}
    if hybrid:
        mat = trans.reshape(256, 256)
        changed = [(int(a), int(c), int(mat[a, c])) for a in range(256) for c in range(256) if a != c and mat[a, c]]
        changed.sort(key=lambda x: -x[2])
        stats["ncgdb"] = {"changed_pixels": int(sum(x[2] for x in changed)),
                          "changed_pct_of_valid": round(100 * sum(x[2] for x in changed) / max(1, int(mat.sum()) - int(mat[255].sum())), 3),
                          "transitions": [{"from": names.get(a, str(a)), "to": names.get(c, str(c)), "pixels": n} for a, c, n in changed]}
        log.info("NCGDB changed %.2f%% of valid pixels vs open data only; largest changes:",
                 stats["ncgdb"]["changed_pct_of_valid"])
        for a, c, n in changed[:12]:
            log.info("  %-16s -> %-16s %12s px", names.get(a, a), names.get(c, c), f"{n:,}")
    (args.out / "class_stats.json").write_text(json.dumps(stats, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
