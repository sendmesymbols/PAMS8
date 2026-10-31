"""Step 5 — rules.json + one distance-to-no-go raster per mobility profile.

Inputs : rules.yaml, classes.yaml, work/grid/grid.json, work/classify/class.tif
Outputs: work/profiles/rules.json             bundle rules (classes + profiles)
         work/profiles/dist_<profile>.tif     uint8, value*distScaleM = metres,
                                              0 = inside no-go, 254 = >= cap, 255 = nodata

No-go per profile: the `nogo` set, or — for a profile with `requires` — every
class NOT in `requires` (nodata is never no-go; it stays 255 in the output).

Distance is a Euclidean distance transform (scipy.ndimage.distance_transform_edt)
run on blocks with a halo of cap_px pixels, so distances up to the cap are exact
across block edges; anything beyond the halo is >= cap -> 254 anyway.

Metric approximation: the EDT runs in pixels and is scaled by
pixel_size * cos(lat) using the latitude at the CENTRE of each block
(Web Mercator is conformal, so x and y share the scale). Within a 2048-px
block at z12 (~78 km) the true scale varies by < 1 %, i.e. < 1 tile value
at the 2540 m cap. The `sampling` argument of the EDT carries this scale.
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import numpy as np

from common import GTIFF_U8, dump_json, iter_blocks, load_json, load_yaml, row_latitudes, setup_logging

log = setup_logging("profiles")


def build_rules(rules: dict, classes: dict) -> dict:
    out = {"version": str(rules["version"]),
           "classes": {str(c["code"]): {"name": c["name"], "label": c["label"]} for c in classes["classes"]},
           "profiles": {}}
    for pid, p in rules["profiles"].items():
        entry = {"label": p["label"]}
        for key in ("nogo", "requires", "caution"):
            if key in p:
                entry[key] = [int(v) for v in p[key]]
        out["profiles"][pid] = entry
    if rules.get("profileOverrides"):
        out["profileOverrides"] = rules["profileOverrides"]
    return out


def nogo_mask(cls: np.ndarray, profile: dict) -> np.ndarray:
    valid = cls != 255
    if "requires" in profile:
        return valid & ~np.isin(cls, profile["requires"])
    return np.isin(cls, profile["nogo"])


def dist_layer(grid: dict, class_tif: Path, out: Path, profile: dict, scale_m: float, block: int) -> None:
    import rasterio
    from rasterio.transform import Affine
    from rasterio.windows import Window
    from scipy.ndimage import distance_transform_edt

    cap_m = 254 * scale_m
    lat_n = max(abs(grid["aoi"][1]), abs(grid["aoi"][3]))
    px_min = grid["pixel_size"] * math.cos(math.radians(lat_n))     # smallest ground pixel
    halo = int(math.ceil(cap_m / px_min)) + 2
    prof = dict(GTIFF_U8, width=grid["width"], height=grid["height"], crs=grid["crs"],
                transform=Affine(*grid["transform"]))
    log.info("%s: cap %.0f m, halo %d px", out.name, cap_m, halo)

    with rasterio.open(class_tif) as src, rasterio.open(out, "w", **prof) as dst:
        for i, b in enumerate(iter_blocks(grid["width"], grid["height"], block, halo)):
            cls = src.read(1, window=Window(b["rcol"], b["rrow"], b["rw"], b["rh"]))
            nogo = nogo_mask(cls, profile)
            lat_c = float(row_latitudes(grid, b["rrow"] + b["rh"] // 2, 1)[0])
            pm = grid["pixel_size"] * math.cos(math.radians(lat_c))
            if nogo.any():
                d = distance_transform_edt(~nogo, sampling=(pm, pm))
                val = np.minimum(np.rint(d / scale_m), 254).astype(np.uint8)
            else:
                val = np.full(cls.shape, 254, dtype=np.uint8)
            val[cls == 255] = 255
            core = val[b["oy"]:b["oy"] + b["h"], b["ox"]:b["ox"] + b["w"]]
            dst.write(core, 1, window=Window(b["col"], b["row"], b["w"], b["h"]))
            if i % 50 == 0:
                log.info("  block %d at row %d/%d", i, b["row"], grid["height"])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rules", type=Path, default=Path("rules.yaml"))
    ap.add_argument("--classes", type=Path, default=Path("classes.yaml"))
    ap.add_argument("--grid", type=Path, default=Path("work/grid"))
    ap.add_argument("--class-tif", type=Path, default=Path("work/classify/class.tif"))
    ap.add_argument("--out", type=Path, default=Path("work/profiles"))
    ap.add_argument("--block", type=int, default=2048)
    ap.add_argument("--only", nargs="*", help="profile ids to (re)build")
    ap.add_argument("--rules-only", action="store_true", help="write rules.json, no rasters")
    args = ap.parse_args()

    rules, classes = load_yaml(args.rules), load_yaml(args.classes)
    args.out.mkdir(parents=True, exist_ok=True)
    dump_json(args.out / "rules.json", build_rules(rules, classes))
    log.info("rules.json written (version %s)", rules["version"])
    if args.rules_only:
        return 0

    grid = load_json(args.grid / "grid.json")
    scale = float(rules.get("distScaleM", 10))
    for pid, p in rules["profiles"].items():
        if "nogo" not in p and "requires" not in p:
            log.info("%s: no nogo/requires -> no dist layer", pid)
            continue
        if args.only and pid not in args.only:
            continue
        dist_layer(grid, args.class_tif, args.out / f"dist_{pid}.tif", p, scale, args.block)
    return 0


if __name__ == "__main__":
    sys.exit(main())
