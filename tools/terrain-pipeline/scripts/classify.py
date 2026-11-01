"""Step 4 — stack the masks by precedence into one class raster (+ the v2 cover and wet-season layers).

Inputs : work/grid/grid.json, work/grid/worldcover.tif, work/grid/jrc_occurrence.tif,
         work/derive/slope.tif, work/derive/osm_<theme>.tif, classes.yaml
         work/derive/ncgdb_class.tif   (optional: present when derive.py ran with an NCGDB)
         work/grotbc/*.tif             (optional: bundle v2, written by grotbc.py)
Outputs: work/classify/class.tif        uint8 class code, 255 nodata, COG + DEFLATE
         work/classify/cc.tif           uint8 concealment * 16 + cover (0 none .. 3 good each), 255 nodata  (v2)
         work/classify/wet.tif          uint8 wet-season code (classes.yaml layers.wet), 255 nodata          (v2)
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

Bundle v2 (GROTBC, when work/grotbc exists): the slope bands, linear obstacles, roads by load class,
railways, wire corridors and irrigated fields join the evidence; then the crossings are derived on the
painted classes — a road or railway over a polygon of water (river, lake, marsh) or at a vector
crossing of a canal / stream line (grotbc.py rx) becomes the bridge of its load class, a crossing point
over water a bridge / foot bridge / ford, and a road-railway crossing a level crossing. They win over
everything, so the distance layers see the gaps in the obstacles.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

from common import GTIFF_U8, class_table, iter_blocks, load_json, load_yaml, setup_logging, to_cog

log = setup_logging("classify")

GROTBC_RASTERS = ("obst", "road", "rail", "xing", "rx", "wire", "irrig", "veg", "slopeband")
ROUTE_STREET, ROUTE_SHINGLED, ROUTE_UNMETALLED, ROUTE_TUNNEL, ROUTE_FORD = 14, 15, 16, 22, 6
RAIL_OPEN = (8, 11, 12, 13)          # tramway, other gauge, broad gauge single / double


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
    if "slopeband" in arrays:                       # v2: from the DEM, so part of the open-data result too
        m["gentle_slope"] |= arrays["slopeband"] == 1
        m["sloping_ground"] |= arrays["slopeband"] == 2
    return m


def road_masks(road: np.ndarray) -> dict[str, np.ndarray]:
    """road.tif route codes -> one mask per road class (tracks and tunnels carry no class)."""
    typ, tier = road & 31, (road >> 5) & 3
    metalled = (typ >= ROUTE_STREET) & (typ != ROUTE_TUNNEL) & (typ != ROUTE_SHINGLED) & (typ != ROUTE_UNMETALLED)
    return {"road_tankable": metalled & (tier == 3), "road_limited": metalled & (tier == 2),
            "road_light": metalled & (tier == 1), "road_unclassed": metalled & (tier == 0),
            "road_unmetalled": (typ == ROUTE_SHINGLED) | (typ == ROUTE_UNMETALLED)}


def grotbc_evidence(m: dict, arrays: dict, codes: dict) -> None:
    """Add the NCGDB-derived v2 evidence (obstacles, routes, wires, irrigation) to `m` in place."""
    obst = arrays["obst"]
    for code in np.unique(obst):
        if code != 255:
            m[{v: k for k, v in codes.items()}[int(code)]] |= obst == code
    for name, mask in road_masks(arrays["road"]).items():
        m[name] |= mask
    m["railway"] |= np.isin(arrays["rail"] & 31, RAIL_OPEN)
    irrig = (arrays["irrig"] == 1) & m["cropland"]
    wire = arrays["wire"] == 1
    m["irrigated_cropland"] |= irrig
    m["irrigated_wire"] |= irrig & wire
    m["wire_hazard"] |= wire


def derive_crossings(cls: np.ndarray, arrays: dict, codes: dict) -> np.ndarray:
    """Bridges, rail bridges, foot bridges, fords and level crossings on the painted classes (255 = none)."""
    c = codes
    poly_water = np.isin(cls, [c["water_permanent"], c["water_seasonal"], c["wetland"], c["mangrove"]])
    line_water = np.isin(cls, [c["canal"], c["distributary"], c["drain"], c["stream_perennial"]])
    water = poly_water | line_water
    road, rail, rx, xing = arrays["road"], arrays["rail"], arrays["rx"], arrays["xing"]
    typ, tier = road & 31, (road >> 5) & 3
    road_any = (typ >= ROUTE_STREET) & (typ != ROUTE_TUNNEL)
    rail_open = np.isin(rail & 31, RAIL_OPEN)
    bridge = [c["bridge_unclassed"], c["bridge_light"], c["bridge_limited"], c["bridge_tankable"]]

    out = np.full(cls.shape, 255, dtype=np.uint8)
    out[water & (xing == 2)] = c["foot_bridge"]
    out[water & ((xing == 3) | (typ == ROUTE_FORD))] = c["ford_ferry"]
    out[water & (xing == 1)] = c["bridge_unclassed"]
    rb = (poly_water & rail_open & ~road_any) | (line_water & (rx == 5))
    out[rb] = c["rail_bridge"]
    for t in range(4):
        out[(poly_water & road_any & (tier == t)) | (line_water & (rx == 1 + t))] = bridge[t]
    out[(rx == 6) & ~water & np.isin(cls, [c["railway"], c["road_tankable"], c["road_limited"], c["road_light"],
                                           c["road_unclassed"], c["road_unmetalled"]])] = c["level_crossing"]
    return out


def cover_layers(cls: np.ndarray, m: dict, arrays: dict, codes: dict, jrc: dict) -> tuple[np.ndarray, np.ndarray]:
    """(cc, wet) for the painted block. cc = concealment * 16 + cover, 0 none .. 3 good; 255 nodata."""
    from scipy.ndimage import binary_dilation
    veg = arrays.get("veg", np.zeros(cls.shape, dtype=np.uint8)).astype(np.int32) * 2   # weighted symbols / km²
    near = lambda *names: binary_dilation(np.logical_or.reduce([m[n] for n in names]), iterations=1)
    conceal = np.zeros(cls.shape, dtype=np.uint8)
    conceal[(veg >= 10) | m["cropland"] | m["dunes"] | m["rocky_ground"] | m["escarpment"] | m["irrigated_cropland"]] = 1
    conceal[(veg >= 40) | m["wetland"] | m["graveyard"] | m["nullah_dry"] | m["dry_riverbed"] | m["sloping_ground"]] = 2
    conceal[(veg >= 100) | m["tree_cover"] | m["forest"] | m["orchard"] | m["walled_orchard"] | m["mangrove"] | m["built_up"]] = 3
    cover = np.zeros(cls.shape, dtype=np.uint8)
    cover[m["tree_cover"] | m["orchard"] | m["moderate_slope"] | m["dunes"] | m["gentle_slope"] | m["sloping_ground"]] = 1
    cover[near("bund", "railway", "nullah_dry") | m["dry_riverbed"] | m["rocky_ground"] | m["graveyard"] | m["forest"]] = 2
    cover[m["built_up"] | m["walled_orchard"] | m["wall_fence"] | near("escarpment", "embankment_high", "cutting")] = 3
    cc = (conceal * 16 + cover).astype(np.uint8)

    occ = arrays["jrc_occurrence"]
    jv = occ <= 100
    wet = np.zeros(cls.shape, dtype=np.uint8)
    wet[jv & (occ >= jrc.get("flood_prone_min_pct", 5)) & (occ < jrc["seasonal_min_pct"])] = 1
    wet[(cls == codes["water_seasonal"]) | (jv & (occ >= jrc["seasonal_min_pct"]) & (occ < jrc["permanent_min_pct"]))] = 2
    wet[cls == codes["dry_riverbed"]] = 3
    wet[np.isin(cls, [codes["wetland"], codes["mangrove"]])] = 4
    wet[np.isin(cls, [codes["water_permanent"], codes["canal"]])] = 5
    cc[np.isin(cls, [codes[n] for n in ("water_permanent", "canal", "distributary", "drain", "water_seasonal")])] = 0
    nod = cls == 255
    cc[nod], wet[nod] = 255, 255
    return cc, wet


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--grid", type=Path, default=Path("work/grid"))
    ap.add_argument("--derive", type=Path, default=Path("work/derive"))
    ap.add_argument("--grotbc", type=Path, default=Path("work/grotbc"), help="bundle v2 rasters (skipped when absent)")
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
    v2 = all((args.grotbc / f"{n}.tif").exists() for n in GROTBC_RASTERS)
    if v2:
        for n in GROTBC_RASTERS:
            paths[n] = args.grotbc / f"{n}.tif"
    log.info("mode: %s%s", "HYBRID (open data + NCGDB)" if hybrid else "open data only",
             " + GROTBC v2 layers" if v2 else "")

    def paint(m: dict, shape) -> np.ndarray:
        cls = np.full(shape, 255, dtype=np.uint8)
        for name in order:
            if name in m:
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
    extra = {}
    if v2:
        extra = {n: rasterio.open(args.out / f"{n}_tmp.tif", "w", **prof) for n in ("cc", "wet")}
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
                    if v2:
                        grotbc_evidence(m, arrays, codes)
                    cls = paint(m, shape)
                    base = np.where(valid, base, 255).astype(np.uint8)
                if v2:
                    xs = derive_crossings(cls, arrays, codes)
                    cls = np.where(xs != 255, xs, cls).astype(np.uint8)
                cls[~valid] = 255
                if hybrid:
                    trans += np.bincount(base.astype(np.int64).ravel() * 256 + cls.ravel(), minlength=256 * 256)
                dst.write(cls, 1, window=win)
                hist += np.bincount(cls.ravel(), minlength=256)
                if v2:
                    cc, wet = cover_layers(cls, m, arrays, codes, cfg["sources"]["jrc"])
                    extra["cc"].write(cc, 1, window=win)
                    extra["wet"].write(wet, 1, window=win)
                if i % 50 == 0:
                    log.info("block %d at row %d/%d", i, b["row"], grid["height"])
    finally:
        for s in srcs.values():
            s.close()
        for s in extra.values():
            s.close()

    to_cog(tmp, args.out / "class.tif", log)
    tmp.unlink(missing_ok=True)
    for n in extra:
        to_cog(args.out / f"{n}_tmp.tif", args.out / f"{n}.tif", log)
        (args.out / f"{n}_tmp.tif").unlink(missing_ok=True)
    total = int(hist.sum())
    names = {v: k for k, v in codes.items()}
    log.info("class histogram (%% of all pixels incl. nodata):")
    for name, code in sorted(codes.items(), key=lambda kv: kv[1]):
        if hist[code]:
            log.info("  %3d %-18s %6.2f%%", code, name, 100 * hist[code] / total)

    stats = {"mode": "hybrid" if hybrid else "open", "grotbc": v2, "pixels": total,
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
            log.info("  %-18s -> %-18s %12s px", names.get(a, a), names.get(c, c), f"{n:,}")
    (args.out / "class_stats.json").write_text(json.dumps(stats, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
