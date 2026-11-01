"""Step 3b — GROTBC products for bundle v2: the NCGDB's lines and points, and relief from the DEM.

Inputs : work/grid/grid.json, work/grid/dem.tif, work/derive/slope.tif,
         classes.yaml (sources.grotbc, layers), rules.yaml (tankable, msr), the NCGDB
Outputs: work/grotbc/obst.tif       uint8 class code of the linear / man-made obstacles, 255 = none
         work/grotbc/road.tif       uint8 route code of roads and tracks, 0 = none
         work/grotbc/rail.tif       uint8 route code of railways, 0 = none
         work/grotbc/route.tif      uint8 max(road, rail): the bundle's `route` layer
         work/grotbc/xing.tif       uint8 1 bridge, 2 foot bridge, 3 ford / ferry, 0 = none
         work/grotbc/rx.tif         uint8 road / railway crossing of a linear water obstacle or of each other:
                                    1-4 road (load tier + 1), 5 railway, 6 level crossing, 0 = none
         work/grotbc/wire.tif       uint8 1 inside a power-line / mast corridor
         work/grotbc/irrig.tif      uint8 1 where field watercourses are dense
         work/grotbc/veg.tif        uint8 weighted vegetation symbols per km² / 2 (0..250)
         work/grotbc/slopeband.tif  uint8 0 under 3°, 1 3-7°, 2 7-15°, 3 15° or more (3x3 mean), 255 nodata
         work/grotbc/landform.tif   uint8 classes.yaml `layers.landform`, 255 nodata
         work/grotbc/elev_hi.tif, elev_lo.tif   elevation + 500 m as a 16-bit value split in two bytes;
                                    hi 255 = nodata
         work/grotbc/vector/        features/10/{x}/{y}.json + features/index.json, admin.geojson,
                                    boundaries.geojson, sheets.json (package.py copies them into the bundle)

Route code (route.tif, road.tif, rail.tif): bit 7 = main supply route (rules.yaml `msr`), bits 5-6 = load
class tier (0 not recorded, 1 below `tankable.limitedClass`, 2 limited, 3 at or above `tankable.minClass`),
bits 0-4 = route type rank (classes.yaml `layers.route.types`; bigger = more important), so a 2x2 MAX in
the overviews keeps the most important route. The NCGDB road load codes (40A1, 70A2, 9F1) are read as
<class><A|F><lanes>; only the number is used, and a fair-weather `F` road counts as unmetalled.

Lines are burned as connected 1-px paths (rasterio all_touched), so a 30 m pixel never lets a vehicle
slip diagonally through a canal. Points (bridges, masts) are buffered. Each worker reads one block's
features straight from the geodatabase with a bounding box, like derive.py's NCGDB product.

Relief: elevation as 16 bits, slope bands from the slope averaged over 3x3 pixels (so DEM noise on the
plains does not speckle them) and a landform class from the topographic position index at 300 m and
2 km: crest / upper slope / mid-slope / lower slope / valley floor / flat.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

from common import (GTIFF_U8, ORIGIN_SHIFT, class_table, iter_blocks, load_json, load_yaml, merc_to_lnglat,
                    row_latitudes, setup_logging)

log = setup_logging("grotbc")

# ----------------------------------------------------------------------------- route types
# rank -> key; ranks are the codebook in classes.yaml `layers.route.types` (keep the two in step)
ROUTE_TYPES = {
    "footpath": 1, "pack_track": 2, "track_in_bed": 3, "glacier_track": 4, "ropeway": 5, "ford": 6,
    "cart_track": 7, "tramway": 8, "rail_uc": 9, "rail_tunnel": 10, "rail_other": 11, "rail_bg_single": 12,
    "rail_bg_double": 13, "street": 14, "shingled": 15, "unmetalled": 16, "metalled_local": 17,
    "metalled": 18, "main_road": 19, "highway": 20, "motorway": 21, "road_tunnel": 22,
}
RAIL_RANKS = {8, 9, 10, 11, 12, 13}
MSR_BIT, TIER_SHIFT = 128, 5

PAKMAP_TYPE = {"1": "motorway", "2": "highway", "3": "main_road", "4": "metalled", "5": "metalled_local",
               "6": "street", "7": "metalled_local"}
TOPO_ROAD_TYPE = {"1": "motorway", "2": "highway", "3": "main_road", "4": "metalled", "7": "unmetalled",
                  "8": "shingled", "9": "unmetalled", "10": "unmetalled", "11": "road_tunnel"}
TRACK_TYPE = {"1": "cart_track", "2": "cart_track", "3": "cart_track", "4": "footpath", "5": "footpath",
              "6": "ford", "7": "pack_track", "8": "pack_track", "9": "ropeway", "10": "track_in_bed",
              "11": "glacier_track"}
TOPO_RAIL_TYPE = {"2": "rail_bg_double", "3": "rail_bg_single", "4": "rail_other", "5": "rail_other",
                  "6": "rail_uc", "7": "rail_uc", "8": "rail_uc", "9": "rail_uc", "10": "rail_tunnel",
                  "11": "tramway"}
UNMETALLED_WORDS = ("un_metal", "unmetal", "un-metal", "jeep", "fair weather", "kacha", "katcha", "kutcha",
                    "earthen", "dirt", "unpaved", "sand", "track")
SHINGLE_WORDS = ("shingl", "gravel")

# ----------------------------------------------------------------------------- feature kinds (features.json)
# code -> (key, label, GROTBC letter). Codes are stable; the engine reads them from features/index.json.
KINDS = {
    1: ("tube_well", "Tube well", "T"), 2: ("well_lined", "Well (lined)", "T"), 3: ("well_unlined", "Well (unlined)", "T"),
    4: ("spring", "Spring", "T"), 5: ("tank_perennial", "Tank (perennial)", "T"), 6: ("tank_seasonal", "Tank (non-perennial)", "T"),
    7: ("karez", "Karez (perennial)", "T"), 8: ("hand_pump", "Hand pump", "T"), 9: ("tank_overhead", "Overhead tank", "T"),
    20: ("bridge", "Bridge", "O"), 21: ("bridge_iron", "Iron bridge", "O"), 22: ("foot_bridge", "Foot bridge", "O"),
    23: ("aqueduct", "Aqueduct", "O"), 24: ("siphon", "Siphon", "O"), 25: ("ferry", "Ferry", "O"), 26: ("ford", "Ford", "O"),
    27: ("boat_bridge", "Boat bridge", "O"), 28: ("tunnel", "Road tunnel", "T"), 29: ("rail_tunnel", "Railway tunnel", "T"),
    30: ("viaduct", "Viaduct", "O"), 31: ("culvert", "Culvert", "O"), 32: ("canal_tunnel", "Canal tunnel", "O"),
    40: ("helipad", "Helipad", "T"), 41: ("airfield", "Airfield", "T"), 42: ("air_base", "Air base", "T"),
    43: ("landing_strip", "Landing strip", "T"), 44: ("airport", "Airport", "T"), 45: ("landing_ground", "Landing ground", "T"),
    46: ("runway", "Runway", "T"), 47: ("road_runway", "Road runway", "T"),
    50: ("rail_station", "Railway station", "T"),
    55: ("pass", "Pass", "TR"), 56: ("dam", "Dam", "TO"), 57: ("barrage", "Barrage", "TO"), 58: ("headworks", "Headworks", "TO"),
    60: ("watch_tower", "Watch tower", "T"), 61: ("post", "Piquet / post", "T"), 62: ("bunker", "Bunker", "TC"),
    63: ("trench", "Trench", "TC"), 64: ("fort", "Fort", "T"), 65: ("border_post", "Border post", "B"),
    66: ("cantonment", "Cantonment", "B"), 67: ("boundary_pillar", "Boundary pillar", "B"), 68: ("wireless_station", "Wireless station", "T"),
    69: ("firing_range", "Firing range", "B"), 70: ("hospital", "Hospital", "T"), 71: ("bhu", "Basic health unit", "T"),
    72: ("dispensary", "Dispensary", "T"), 73: ("vet_hospital", "Veterinary hospital", "T"), 74: ("grid_station", "Grid station", "T"),
    75: ("rest_house", "Rest house", "T"), 76: ("petrol_pump", "Petrol pump", "T"), 77: ("police_station", "Police station", "T"),
    78: ("mast", "Mast", "O"), 79: ("wind_tower", "Wind tower", "O"), 80: ("oil_gas_well", "Oil / gas well", "T"),
    81: ("oil_tank", "Oil tank", "T"),
    85: ("cave", "Cave", "TC"), 86: ("mine", "Mine", "TC"), 87: ("mine_shaft", "Mine shaft", "TC"),
    88: ("deserted_site", "Deserted site", "B"), 89: ("air_target", "Air firing / bombing target", "B"),
    90: ("km_road", "KM stone (road)", "T"), 91: ("km_rail", "KM stone (railway)", "T"), 92: ("km_canal", "KM stone (canal)", "T"),
    100: ("trig_station", "Trig station", "R"), 101: ("spot_height", "Spot height", "R"), 102: ("bench_mark", "Bench mark", "R"),
    110: ("city", "City", "B"), 111: ("district_hq", "District HQ", "B"), 112: ("town", "Town", "B"),
    113: ("village_imp", "Important village", "B"), 114: ("village", "Village", "B"),
    120: ("tomb", "Tomb", "B"), 121: ("kiln", "Kiln", "B"), 122: ("chimney", "Factory chimney", "B"),
    # lines (features.json "l")
    200: ("road", "Road", "T"), 201: ("railway", "Railway", "T"), 202: ("canal", "Canal", "O"), 203: ("river", "River", "O"),
}
KIND_CODE = {v[0]: k for k, v in KINDS.items()}
FEATURE_Z = 10
QUANT = 4096


def _s(v) -> str:
    return "" if v is None else str(v).strip()


def parse_width_m(text: str) -> float | None:
    """'12 ft', '3.05 m', '8 -12 m', '10', '20-50' -> metres (the mean of a range); None when unreadable."""
    t = _s(text).lower().replace(",", ".")
    if not t:
        return None
    nums = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", t)]
    nums = [n for n in nums if n < 1e6]
    if not nums:
        return None
    v = sum(nums[:2]) / min(2, len(nums))
    if "ft" in t or "feet" in t or "'" in t:
        v *= 0.3048
    return round(v, 1) if 0 < v < 500 else None


def parse_load_class(text: str) -> tuple[int | None, bool]:
    """'40A1' -> (40, False), '9F1' -> (9, True): load class and whether it is a fair-weather road."""
    m = re.match(r"^\s*(\d{1,3})\s*([A-Za-z])?", _s(text))
    if not m:
        return None, False
    return int(m.group(1)), (m.group(2) or "").upper() == "F"


def tier_of(load: int | None, width: float | None, tk: dict) -> int:
    if load is None:
        return 0
    if width is not None and width < float(tk.get("minWidthM", 0)):
        return 1
    if load >= int(tk["minClass"]):
        return 3
    if load >= int(tk["limitedClass"]):
        return 2
    return 1


def route_code(kind: str, tier: int = 0, msr: bool = False) -> int:
    return (MSR_BIT if msr else 0) | (tier << TIER_SHIFT) | ROUTE_TYPES[kind]


def pakmap_road(row: dict, tk: dict, msr_cfg: dict) -> tuple[str, int, bool, dict]:
    """Roads_updated_2016_Pakmap row -> (type key, tier, msr, attributes for features.json)."""
    kind = PAKMAP_TYPE.get(_s(row.get("TYPE")).split(".")[0], "metalled_local")
    load, fair = parse_load_class(row.get("CLASSIFICA"))
    width = parse_width_m(row.get("WIDTH_M"))
    desc = (_s(row.get("CATEGORY")) + " " + _s(row.get("SURFACE"))).lower()
    if kind not in ("motorway", "highway", "street"):
        if fair or any(w in desc for w in UNMETALLED_WORDS):
            kind = "unmetalled"
        elif any(w in desc for w in SHINGLE_WORDS):
            kind = "shingled"
    tier = tier_of(load, width, tk)
    defence = _s(row.get("DEFENCE_RD")).lower() == "yes"
    metalled = kind in ("metalled", "metalled_local", "main_road", "highway", "motorway")
    msr = (kind in msr_cfg.get("types", [])) or (defence and msr_cfg.get("defenceRoad", True)) or \
          (metalled and load is not None and load >= int(msr_cfg.get("metalledMinClass", 40)))
    attrs = {k: v for k, v in (("n", _s(row.get("NAME"))), ("r", _s(row.get("ROAD_NO"))), ("t", kind),
                               ("c", _s(row.get("CLASSIFICA")).upper()), ("w", width), ("k", tier),
                               ("d", 1 if defence else 0), ("m", 1 if msr else 0)) if v not in ("", None, 0)}
    return kind, tier, msr, attrs


def topo_road(row: dict, tk: dict, msr_cfg: dict) -> tuple[str, int, bool]:
    kind = TOPO_ROAD_TYPE.get(_s(row.get("Type_of_Road")), "metalled")
    load, fair = parse_load_class(row.get("CLASSIFICATION"))
    if fair and kind not in ("motorway", "highway"):
        kind = "unmetalled"
    tier = tier_of(load, None, tk)
    defence = _s(row.get("DEFENCE_RD")).lower() == "yes"
    metalled = kind in ("metalled", "main_road", "highway", "motorway")
    msr = (kind in msr_cfg.get("types", [])) or defence or \
          (metalled and load is not None and load >= int(msr_cfg.get("metalledMinClass", 40)))
    return kind, tier, msr


def pakmap_rail(row: dict) -> str:
    gauge = (_s(row.get("GAUGE")) + " " + _s(row.get("RLY_TYPE")) + " " + _s(row.get("CATEGORY"))).lower()
    status = _s(row.get("STATUS")).lower()
    if "disused" in status:
        return "rail_uc"
    broad = any(w in gauge for w in ("broad", "1.676", "1.7", "5.6", "bg", "board"))
    other = any(w in gauge for w in ("other", "metre", "mg", "narrow"))
    double = "double" in gauge
    if other and not broad:
        return "rail_other"
    return "rail_bg_double" if double else "rail_bg_single"

# ----------------------------------------------------------------------------- geometry helpers

def _merc_xy(coords: np.ndarray) -> np.ndarray:
    r = 6378137.0
    out = np.empty(coords.shape, dtype="float64")
    out[:, 0] = np.radians(coords[:, 0]) * r
    out[:, 1] = np.log(np.tan(np.pi / 4 + np.radians(np.clip(coords[:, 1], -85.0511, 85.0511)) / 2)) * r
    return out


def _read(gdb: str, layer: str, columns: list[str], bbox=None, where: str | None = None):
    """(geoms in Web Mercator, {field: np.array of str}) for one layer; geoms may contain None."""
    import pyogrio.raw as raw
    import shapely
    meta, _fid, geom, data = raw.read(gdb, layer=layer, bbox=bbox, columns=columns, where=where)
    if len(geom) == 0:
        return np.array([], dtype=object), {c: np.array([], dtype=object) for c in columns}
    gs = shapely.from_wkb(geom)
    ok = ~shapely.is_missing(gs)
    gs[ok] = shapely.transform(gs[ok], _merc_xy)
    cols = dict(zip(meta["fields"], data))
    return gs, {c: np.array([_s(v) for v in cols.get(c, [None] * len(gs))], dtype=object) for c in columns}


def _bbox_lnglat(bounds, pad_deg: float):
    x0, y0, x1, y1 = bounds
    lon0, lat0 = merc_to_lnglat(x0, y0)
    lon1, lat1 = merc_to_lnglat(x1, y1)
    return (min(lon0, lon1) - pad_deg, min(lat0, lat1) - pad_deg, max(lon0, lon1) + pad_deg, max(lat0, lat1) + pad_deg)

# ----------------------------------------------------------------------------- vector block worker

def _vector_block(task: tuple) -> dict:
    """Worker: every vector-derived raster of ONE block (padded by `halo` px for the window filters)."""
    gdb, cfg, codes, rank, tk, msr_cfg, bounds, w, h, res, halo, lat_c = task
    import warnings
    warnings.filterwarnings("ignore", category=RuntimeWarning)
    import shapely
    from rasterio.enums import MergeAlg
    from rasterio.features import rasterize
    from rasterio.transform import Affine
    from scipy.ndimage import uniform_filter

    x0, y0, x1, y1 = bounds
    W, H = w + 2 * halo, h + 2 * halo
    tr = Affine(res, 0.0, x0 - halo * res, 0.0, -res, y1 + halo * res)
    pbounds = (x0 - halo * res, y0 - halo * res, x1 + halo * res, y1 + halo * res)
    bbox = _bbox_lnglat(pbounds, 0.002)
    scale = 1.0 / math.cos(math.radians(lat_c))          # metres -> Web Mercator units here
    ground_px = res / scale

    def burn(shapes, fill=0, dtype="uint8", all_touched=True):
        shapes = [(g, v) for g, v in shapes if g is not None and not g.is_empty]
        if not shapes:
            return np.full((H, W), fill, dtype=dtype)
        return rasterize(shapes, out_shape=(H, W), transform=tr, fill=fill, dtype=dtype, all_touched=all_touched)

    def sel(gs, col, values):
        return [g for g, v in zip(gs, col) if v in values]

    g = cfg["grotbc"]
    cache: dict[tuple, tuple] = {}

    def layer(name, cols, where=None):
        key = (name, tuple(cols), where)
        if key not in cache:
            cache[key] = _read(gdb, name, list(cols), bbox, where)
        return cache[key]

    # obstacles: one mask per class, painted lowest precedence first
    masks: dict[int, np.ndarray] = {}
    for r in g["obstacles"]:
        gs, f = layer(r["layer"], [r["field"]])
        geo = sel(gs, f[r["field"]], set(r["values"]))
        if r.get("buffer_m"):
            geo = list(shapely.buffer(np.array(geo, dtype=object), r["buffer_m"] * scale, quad_segs=2)) if geo else []
        if not geo:
            continue
        m = burn([(x, 1) for x in geo]).astype(bool)
        c = codes[r["class"]]
        masks[c] = masks[c] | m if c in masks else m
    obst = np.full((H, W), 255, dtype=np.uint8)
    for c in sorted(masks, key=lambda c: -rank[c]):
        obst[masks[c]] = c

    # roads and tracks -> road; railways -> rail (shapes sorted by code so the biggest is painted last)
    road_shapes = []
    gs, f = layer("Tracks", ["Type_of_Track"])
    for geom, t in zip(gs, f["Type_of_Track"]):
        k = TRACK_TYPE.get(t)
        if k:
            road_shapes.append((geom, route_code(k)))
    gs, f = layer("Road", ["Type_of_Road", "CLASSIFICATION", "DEFENCE_RD"])
    for i, geom in enumerate(gs):
        k, tier, msr = topo_road({c: f[c][i] for c in f}, tk, msr_cfg)
        road_shapes.append((geom, route_code(k, tier, msr)))
    pcols = ["TYPE", "CLASSIFICA", "DEFENCE_RD", "WIDTH_M", "CATEGORY", "SURFACE", "NAME", "ROAD_NO"]
    gs, f = layer("Roads_updated_2016_Pakmap", pcols)
    for i, geom in enumerate(gs):
        k, tier, msr, _a = pakmap_road({c: f[c][i] for c in f}, tk, msr_cfg)
        road_shapes.append((geom, route_code(k, tier, msr)))
    road_shapes.sort(key=lambda s: s[1])
    road = burn(road_shapes, all_touched=False)   # thin (8-connected) so a road beside a canal or railway rarely shares its pixels

    rail_shapes = []
    gs, f = layer("Railway", ["Type_of_Railway"])
    for geom, t in zip(gs, f["Type_of_Railway"]):
        k = TOPO_RAIL_TYPE.get(t)
        if k:
            rail_shapes.append((geom, route_code(k, 0, msr_cfg.get("railBroadGauge", True) and k in ("rail_bg_single", "rail_bg_double"))))
    gs, f = layer("Railways_Pakmap", ["GAUGE", "RLY_TYPE", "CATEGORY", "STATUS"])
    for i, geom in enumerate(gs):
        k = pakmap_rail({c: f[c][i] for c in f})
        rail_shapes.append((geom, route_code(k, 0, msr_cfg.get("railBroadGauge", True) and k in ("rail_bg_single", "rail_bg_double"))))
    rail_shapes.sort(key=lambda s: s[1])
    rail = burn(rail_shapes, all_touched=False)

    # Where roads and railways cross the linear water obstacles (canals, distributaries, drains, streams) and
    # each other: true line intersections, buffered to ~1.5 px so the patch cuts the whole obstacle line.
    # Overlaps along a line (a road on a canal bank, beside a railway) are not intersections and never count.
    # rx: 1-4 road crossing (load tier + 1), 5 railway crossing, 6 level crossing.
    water_classes = {"canal", "distributary", "drain", "stream_perennial"}
    wl = []
    for r in g["obstacles"]:
        if r["class"] in water_classes:
            gs, f = layer(r["layer"], [r["field"]])
            wl += sel(gs, f[r["field"]], set(r["values"]))
    wl = np.array([x for x in wl if x is not None and not x.is_empty], dtype=object)
    roads_x = [(geom, (c >> TIER_SHIFT) & 3) for geom, c in road_shapes
               if geom is not None and (c & 31) >= ROUTE_TYPES["street"] and (c & 31) != ROUTE_TYPES["road_tunnel"]]
    rails_x = [geom for geom, c in rail_shapes if geom is not None and (c & 31) in (8, 11, 12, 13)]
    patch = 55.0 * scale
    rx_shapes: list[tuple] = []

    def crossings(lines, targets, value_of):
        if not len(targets) or not lines:
            return
        tree = shapely.STRtree(targets)
        for item in lines:
            geom, val = item if isinstance(item, tuple) else (item, None)
            for j in tree.query(geom, predicate="intersects"):
                hit = shapely.intersection(geom, targets[j])
                pts = [p for p in getattr(hit, "geoms", [hit]) if p.geom_type == "Point"]
                for p in pts:
                    rx_shapes.append((p.buffer(patch, quad_segs=2), value_of(val)))

    crossings(rails_x, wl, lambda _v: 5)
    crossings(roads_x, wl, lambda t: 1 + int(t))
    crossings(roads_x, np.array(rails_x, dtype=object), lambda _v: 6)
    rx_shapes.sort(key=lambda s: {5: 0, 6: 1}.get(s[1], 2 + s[1]))
    rx = burn(rx_shapes)

    # crossings: paint foot bridge, then ford / ferry, then bridge (a bridge wins)
    xing = np.zeros((H, W), dtype=np.uint8)
    for kind in (2, 3, 1):
        geo = []
        for r in g["crossings"]:
            if r["kind"] != kind:
                continue
            gs, f = layer(r["layer"], [r["field"]])
            sg = sel(gs, f[r["field"]], set(r["values"]))
            if r.get("buffer_m") and sg:
                sg = list(shapely.buffer(np.array(sg, dtype=object), r["buffer_m"] * scale, quad_segs=2))
            geo += sg
        if geo:
            xing[burn([(x, 1) for x in geo]).astype(bool)] = kind

    # wires
    geo = []
    for r in g["wires"]:
        gs, f = layer(r["layer"], [r["field"]])
        sg = sel(gs, f[r["field"]], set(r["values"]))
        if sg:
            geo += list(shapely.buffer(np.array(sg, dtype=object), r["buffer_m"] * scale, quad_segs=2))
    wire = burn([(x, 1) for x in geo])

    # dense field watercourses
    wc = g["watercourses"]
    gs, f = layer(wc["layer"], [wc["field"]])
    ch = burn([(x, 1) for x in sel(gs, f[wc["field"]], set(wc["values"]))]).astype("float32")
    win = max(3, int(round(wc["window_m"] / ground_px)) | 1)
    irrig = (uniform_filter(ch, size=win, mode="constant") >= float(wc["min_fraction"])).astype(np.uint8)

    # vegetation symbols -> weighted density per km²
    vg = g["vegetation"]
    gs, f = layer(vg["layer"], [vg["field"]])
    dens = np.zeros((H, W), dtype="float32")
    if len(gs):
        import shapely as _sh
        wts = np.array([float(vg["weights"].get(t, 0.0)) for t in f[vg["field"]]], dtype="float32")
        keep = (wts > 0) & ~_sh.is_missing(gs)
        if keep.any():
            xy = _sh.get_coordinates(gs[keep])
            cols = ((xy[:, 0] - tr.c) / res).astype(np.int64)
            rows = ((tr.f - xy[:, 1]) / res).astype(np.int64)
            inb = (cols >= 0) & (cols < W) & (rows >= 0) & (rows < H)
            np.add.at(dens, (rows[inb], cols[inb]), wts[keep][inb])
    vwin = max(3, int(round(vg["window_m"] / ground_px)) | 1)
    km2 = (vwin * ground_px / 1000.0) ** 2
    veg = np.clip(np.rint(uniform_filter(dens, size=vwin, mode="constant") * vwin * vwin / km2 / 2.0), 0, 250).astype(np.uint8)

    core = (slice(halo, halo + h), slice(halo, halo + w))
    return {"obst": obst[core], "road": road[core], "rail": rail[core], "xing": xing[core], "rx": rx[core],
            "wire": wire[core], "irrig": irrig[core], "veg": veg[core]}


def vector_rasters(grid: dict, gdb: Path, cfg: dict, rules: dict, out: Path, block: int, workers: int) -> None:
    import rasterio
    from concurrent.futures import ProcessPoolExecutor
    from rasterio.windows import Window

    codes = class_table(cfg)
    rank = {codes[n]: i for i, n in enumerate(cfg["precedence"])}
    tk, msr_cfg = rules["tankable"], rules.get("msr", {})
    res = grid["pixel_size"]
    left, top = grid["bounds_3857"][0], grid["bounds_3857"][3]
    lat_n = max(abs(grid["aoi"][1]), abs(grid["aoi"][3]))
    halo = int(math.ceil(max(cfg["sources"]["grotbc"]["watercourses"]["window_m"],
                             cfg["sources"]["grotbc"]["vegetation"]["window_m"]) / 2 / (res * math.cos(math.radians(lat_n))))) + 2
    tasks, wins = [], []
    for b in iter_blocks(grid["width"], grid["height"], block):
        bx0, by1 = left + b["col"] * res, top - b["row"] * res
        lat_c = float(row_latitudes(grid, b["row"] + b["h"] // 2, 1)[0])
        tasks.append((str(gdb), {"grotbc": cfg["sources"]["grotbc"]}, codes, rank, tk, msr_cfg,
                      (bx0, by1 - b["h"] * res, bx0 + b["w"] * res, by1), b["w"], b["h"], res, halo, lat_c))
        wins.append(Window(b["col"], b["row"], b["w"], b["h"]))
    log.info("vector rasters: %d blocks, halo %d px, %d workers", len(tasks), halo, workers)

    from rasterio.transform import Affine
    names = {"obst": 255, "road": 0, "rail": 0, "route": 0, "xing": 0, "rx": 0, "wire": 0, "irrig": 0, "veg": 0}
    prof = dict(GTIFF_U8, width=grid["width"], height=grid["height"], crs=grid["crs"], transform=Affine(*grid["transform"]))
    dsts = {n: rasterio.open(out / f"{n}.tif", "w", **dict(prof, nodata=nd)) for n, nd in names.items()}
    stats = defaultdict(int)
    try:
        chunk = max(1, workers * 2)
        with ProcessPoolExecutor(workers) as pool:
            for i in range(0, len(tasks), chunk):
                for win, arrs in zip(wins[i:i + chunk], pool.map(_vector_block, tasks[i:i + chunk])):
                    arrs["route"] = np.maximum(arrs["road"], arrs["rail"])
                    for n, a in arrs.items():
                        dsts[n].write(a, 1, window=win)
                    stats["obstacle_px"] += int((arrs["obst"] != 255).sum())
                    stats["road_px"] += int((arrs["road"] != 0).sum())
                    stats["rail_px"] += int((arrs["rail"] != 0).sum())
                    stats["wire_px"] += int(arrs["wire"].sum())
                    stats["irrig_px"] += int(arrs["irrig"].sum())
                log.info("  blocks %d/%d", min(i + chunk, len(tasks)), len(tasks))
    finally:
        for d in dsts.values():
            d.close()
    log.info("vector rasters: %s", dict(stats))

# ----------------------------------------------------------------------------- relief

def relief_rasters(grid: dict, dem: Path, slope: Path, cfg: dict, out: Path, block: int) -> None:
    import rasterio
    from rasterio.transform import Affine
    from rasterio.windows import Window
    from scipy.ndimage import uniform_filter

    s = cfg["sources"]["slope"]
    gentle, sloping, moderate = float(s.get("gentle_deg", 3)), float(s.get("sloping_deg", 7)), float(s["moderate_deg"])
    prof = dict(GTIFF_U8, width=grid["width"], height=grid["height"], crs=grid["crs"], transform=Affine(*grid["transform"]))
    halo = 72
    with rasterio.open(dem) as dsrc, rasterio.open(slope) as ssrc, \
            rasterio.open(out / "elev_hi.tif", "w", **dict(prof, nodata=255)) as dhi, \
            rasterio.open(out / "elev_lo.tif", "w", **dict(prof, nodata=None)) as dlo, \
            rasterio.open(out / "slopeband.tif", "w", **dict(prof, nodata=255)) as dsb, \
            rasterio.open(out / "landform.tif", "w", **dict(prof, nodata=255)) as dlf:
        nod = dsrc.nodata
        for i, b in enumerate(iter_blocks(grid["width"], grid["height"], block, halo)):
            rw = Window(b["rcol"], b["rrow"], b["rw"], b["rh"])
            z = dsrc.read(1, window=rw).astype("float32")
            bad = np.isnan(z) | ((z == nod) if nod is not None else False) | (z < -1000)
            core = (slice(b["oy"], b["oy"] + b["h"]), slice(b["ox"], b["ox"] + b["w"]))
            win = Window(b["col"], b["row"], b["w"], b["h"])

            v = np.clip(np.rint(np.where(bad, 0, z)) + 500, 0, 65279).astype(np.uint32)
            hi, lo = (v >> 8).astype(np.uint8), (v & 255).astype(np.uint8)
            hi[bad], lo[bad] = 255, 255
            dhi.write(hi[core], 1, window=win)
            dlo.write(lo[core], 1, window=win)

            sl = ssrc.read(1, window=rw).astype("float32")
            sv = sl != 255
            mean3 = uniform_filter(np.where(sv, sl, 0), 3) / np.maximum(uniform_filter(sv.astype("float32"), 3), 1e-6)
            band = np.select([mean3 < gentle, mean3 < sloping, mean3 < moderate], [0, 1, 2], 3).astype(np.uint8)
            band[~sv] = 255
            dsb.write(band[core], 1, window=win)

            # topographic position index at ~300 m and ~2 km (valid-weighted means, so nodata does not drag them)
            lat_c = float(row_latitudes(grid, b["rrow"] + b["rh"] // 2, 1)[0])
            gp = grid["pixel_size"] * math.cos(math.radians(lat_c))
            ok = (~bad).astype("float32")
            zz = np.where(bad, 0, z)

            def fmean(n):
                n = max(3, int(round(n)) | 1)
                return uniform_filter(zz, n, mode="nearest") / np.maximum(uniform_filter(ok, n, mode="nearest"), 1e-6)

            tpi_s = z - fmean(600 / gp)
            tpi_l = z - fmean(min(4000 / gp, 2 * halo - 1))
            flat = mean3 < 5
            lf = np.full(z.shape, 4, dtype=np.uint8)                                  # mid-slope
            lf[(tpi_l < -15)] = 2                                                     # lower slope
            lf[(tpi_l < -15) & flat] = 1                                              # valley floor
            lf[(np.abs(tpi_l) <= 15) & flat] = 3                                      # flat / plain
            lf[(tpi_l > 15)] = 5                                                      # upper slope
            lf[(tpi_l > 40) & (tpi_s > 5)] = 6                                        # crest / ridge
            lf[bad] = 255
            dlf.write(lf[core], 1, window=win)
            if i % 50 == 0:
                log.info("  relief block %d at row %d/%d", i, b["row"], grid["height"])
    log.info("relief rasters -> %s", out)

# ----------------------------------------------------------------------------- features (points + named lines)

POINT_RULES = [
    # layer, type field, {value: kind key}, {attribute key: field}
    ("Water_Sources_Point", "Type_of_Water_Source", {"7": "tube_well", "10": "well_lined", "11": "well_unlined", "3": "spring",
     "5": "tank_perennial", "4": "tank_seasonal", "2": "hand_pump", "6": "tank_overhead"}, {"n": "Name"}),
    ("Crossings_Point", "Type_of_Crossing", {"2": "bridge", "14": "bridge", "7": "bridge_iron", "6": "foot_bridge", "1": "aqueduct",
     "9": "siphon", "10": "siphon", "4": "culvert", "5": "culvert", "11": "tunnel", "8": "rail_tunnel", "3": "canal_tunnel",
     "12": "viaduct"}, {"n": "Name"}),
    ("BUA_Point", "Type_of_BUA_Point", {"8": "helipad", "6": "fort", "7": "fort", "3": "cave", "4": "cave", "9": "mine_shaft",
     "5": "deserted_site", "1": "air_target", "2": "air_target", "10": "deserted_site"}, {"n": "Name"}),
    ("Services_Point", "Type_of__Svc_Point", {"41": "pass", "78": "pass", "56": "watch_tower", "43": "post", "76": "bunker",
     "66": "trench", "26": "hospital", "68": "bhu", "18": "dispensary", "64": "vet_hospital", "25": "grid_station", "24": "grid_station",
     "45": "rest_house", "53": "rest_house", "62": "rest_house", "63": "rest_house", "42": "petrol_pump", "38": "police_station",
     "58": "wireless_station", "74": "mine", "36": "oil_gas_well", "72": "oil_gas_well", "35": "oil_tank", "52": "tomb",
     "21": "chimney", "77": "mast", "61": "wind_tower", "46": "firing_range", "54": "boundary_pillar"}, {"n": "Name"}),
    ("Heights", "Type_of_Hieghts", {"2": "trig_station", "3": "trig_station", "4": "spot_height", "6": "spot_height",
     "7": "bench_mark", "8": "bench_mark", "9": "bench_mark"}, {"e": "Elevation", "n": "Name"}),
    ("Place_Names", "CATEGORY", {"Major City": "city", "City": "city", "Distt City": "district_hq", "Town": "town",
     "ImpVillage": "village_imp", "Village": "village", "Post": "border_post"},
     {"n": "NAME", "p": "POPULATION", "d": "DISTT_NAME", "h": "TEH_NAME", "e": "ELEVATION"}),
    ("Railway_Station", "Type_of_Rly_Station", {"1": "rail_station"}, {"n": "Name"}),
    ("KM_Stone", "Type_of_KM_Stone", {"3": "km_road", "4": "km_road", "2": "km_rail", "1": "km_canal"}, {"n": "Name"}),
    ("Boundry_Piller", "Type_of_BdryPiller", {"1": "boundary_pillar", "2": "boundary_pillar"}, {"n": "Name"}),
    ("Kiln", "Type_of_Kiln", {"1": "kiln"}, {}),
    ("AiR_Field_Pakmap", "AIR_FD_TYP", {"Air Fd": "airfield", "Landing Strip": "landing_strip", "Air Base": "air_base",
     "Helipad": "helipad", "Rd Runway": "road_runway", "Airport": "airport"},
     {"n": "NAME", "c": "COUNTRY", "rw": "RUNWAY_SIZ", "rd": "RUNWAY_DIR", "s": "SURFACE", "e": "ELEV_M_",
      "u1": "FMN", "u2": "SQN", "u3": "CBT_AC", "u4": "TPT_AC", "u5": "HELI", "u6": "UAV"}),
    ("Airports_Pakmap", "AIR_FD_TYP", {"Airport": "airport", "Air Fd": "airfield"}, {"n": "NAME", "c": "Category", "s": "Classifica"}),
    ("HeadWorks_Pakmap", "CATEGORY", {"Dam": "dam", "H/W": "headworks", "Barrage": "barrage", "Reservoir": "dam"},
     {"n": "NAME", "c": "CLASSIFICA", "rv": "RIVER", "s": "STRUCTURE"}),
    ("Cantts_Pakmap", None, {"": "cantonment"}, {"n": "Cantts", "f": "Fmn_Name", "pc": "Parent_Cor", "s": "Cantts_Siz"}),
]
LINE_POINT_RULES = [   # lines kept as one point (their middle)
    ("Crosings_line", "Type_of_Crossing", {"4": "ferry", "5": "ford", "1": "boat_bridge", "2": "boat_bridge", "3": "bridge",
     "6": "bridge_iron", "9": "bridge", "10": "bridge"}, {"n": "Name"}, None),
    ("Water_Feature_Line", "Type_of_Water_Feature_Line", {"8": "karez"}, {"n": "Name"}, "Type_of_Water_Feature_Line = '8'"),
    ("Misc_Line_Features", "Type_of_Line", {"12": "landing_ground", "7": "firing_range", "18": "firing_range"}, {"n": "Name"}, None),
    ("Tracks", "Type_of_Track", {"6": "ford"}, {"n": "Name"}, "Type_of_Track = '6'"),
    ("Runway", "Type_of_RUNWAY", {"1": "runway"}, {"n": "Name"}, None),
]


def _clean(v):
    s = _s(v)
    if s in ("", "None", "nan", "0", "0.0") or set(s) <= {"-", " ", "c"}:
        return None
    try:
        f = float(s)
        return int(f) if f.is_integer() else round(f, 1)
    except ValueError:
        return s[:120]


class TileWriter:
    """Collects point and line features per z10 tile and writes compact JSON (tile-local coords 0..4095)."""

    def __init__(self, z: int, aoi):
        self.z = z
        self.size = 2 * ORIGIN_SHIFT / 2 ** z
        self.points: dict[tuple, list] = defaultdict(list)
        self.lines: dict[tuple, list] = defaultdict(list)
        self.counts: dict[int, int] = defaultdict(int)
        (w, s), (e, n) = _merc_xy(np.array([[aoi[0], aoi[1]], [aoi[2], aoi[3]]]))
        self.trange = (*self._tile(w, n), *self._tile(e, s))          # lines are kept only inside the AOI

    def _tile(self, x: float, y: float) -> tuple[int, int]:
        return int((x + ORIGIN_SHIFT) // self.size), int((ORIGIN_SHIFT - y) // self.size)

    def _q(self, tx, ty, x, y):
        minx = -ORIGIN_SHIFT + tx * self.size
        maxy = ORIGIN_SHIFT - ty * self.size
        return (int(min(QUANT - 1, max(0, round((x - minx) / self.size * QUANT)))),
                int(min(QUANT - 1, max(0, round((maxy - y) / self.size * QUANT)))))

    def point(self, kind: str, x: float, y: float, attrs: dict) -> None:
        tx, ty = self._tile(x, y)
        qx, qy = self._q(tx, ty, x, y)
        k = KIND_CODE[kind]
        a = {key: val for key, val in attrs.items() if val is not None}
        self.points[(tx, ty)].append([k, qx, qy, a] if a else [k, qx, qy])
        self.counts[k] += 1

    def line(self, kind: str, geom, attrs: dict) -> None:
        import shapely
        if geom is None or geom.is_empty:
            return
        x0, y0, x1, y1 = geom.bounds
        tx0, ty0 = self._tile(x0, y1)
        tx1, ty1 = self._tile(x1, y0)
        k = KIND_CODE[kind]
        a = {key: val for key, val in attrs.items() if val not in (None, "", 0)}
        ax0, ay0, ax1, ay1 = self.trange
        for tx in range(max(tx0, ax0), min(tx1, ax1) + 1):
            for ty in range(max(ty0, ay0), min(ty1, ay1) + 1):
                minx = -ORIGIN_SHIFT + tx * self.size
                maxy = ORIGIN_SHIFT - ty * self.size
                part = shapely.clip_by_rect(geom, minx, maxy - self.size, minx + self.size, maxy)
                if part.is_empty:
                    continue
                for ln in getattr(part, "geoms", [part]):
                    if ln.geom_type != "LineString" or ln.is_empty:
                        continue
                    flat = []
                    for x, y in ln.coords:
                        flat.extend(self._q(tx, ty, x, y))
                    if len(flat) >= 4:
                        self.lines[(tx, ty)].append([k, flat, a] if a else [k, flat])
        self.counts[k] += 1

    def write(self, out: Path) -> int:
        n = 0
        keys = set(self.points) | set(self.lines)
        for tx, ty in keys:
            obj = {"z": self.z, "x": tx, "y": ty, "q": QUANT}
            if self.points.get((tx, ty)):
                obj["p"] = self.points[(tx, ty)]
            if self.lines.get((tx, ty)):
                obj["l"] = self.lines[(tx, ty)]
            p = out / str(self.z) / str(tx) / f"{ty}.json"
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
            n += 1
        index = {"format": "pams-grotbc-features", "version": 1, "z": self.z, "quant": QUANT,
                 "note": "p = [kind, x, y, attrs?] in tile-local units 0..quant-1 (Web Mercator, y down); "
                         "l = [kind, [x0, y0, x1, y1, ...], attrs?]",
                 "attrs": {"n": "name", "e": "elevation (m)", "p": "population", "d": "district", "h": "tehsil",
                           "c": "load class code / country / category", "r": "road number", "t": "type",
                           "w": "width (m)", "k": "load-class tier (route codebook)", "m": "main supply route",
                           "dp": "depth (m)", "b": "bank height (m)", "g": "gauge", "s": "surface / structure / size",
                           "rw": "runway size", "rd": "runway direction", "rv": "river", "f": "formation",
                           "pc": "parent corps", "u1": "formation", "u2": "squadrons", "u3": "combat aircraft",
                           "u4": "transport aircraft", "u5": "helicopters", "u6": "UAV"},
                 "kinds": {str(k): {"key": v[0], "label": v[1], "grotbc": v[2], "count": self.counts.get(k, 0)}
                           for k, v in sorted(KINDS.items())},
                 "tiles": len(keys)}
        (out / "index.json").write_text(json.dumps(index, indent=1, ensure_ascii=False), encoding="utf-8")
        return n


def _in_aoi(xy: np.ndarray, aoi) -> np.ndarray:
    w, s, e, n = aoi
    x0, y0 = _merc_xy(np.array([[w, s]]))[0]
    x1, y1 = _merc_xy(np.array([[e, n]]))[0]
    return (xy[:, 0] >= x0) & (xy[:, 0] <= x1) & (xy[:, 1] >= y0) & (xy[:, 1] <= y1)


def features(gdb: Path, grid: dict, rules: dict, out: Path) -> None:
    import shapely
    aoi = grid["aoi"]
    tw = TileWriter(FEATURE_Z, aoi)
    g = str(gdb)
    tk, msr_cfg = rules["tankable"], rules.get("msr", {})

    for layer_name, field, kinds, attrs in POINT_RULES:
        cols = ([field] if field else []) + list(attrs.values())
        gs, f = _read(g, layer_name, cols)
        if not len(gs):
            continue
        ok = ~shapely.is_missing(gs)
        cen = np.full((len(gs), 2), np.nan)
        cen[ok] = shapely.get_coordinates(shapely.centroid(gs[ok]))
        keep = ok & _in_aoi(np.nan_to_num(cen), aoi)
        n0 = 0
        for i in np.nonzero(keep)[0]:
            kind = kinds.get(_s(f[field][i]).replace(".0", "") if field else "")
            if field and kind is None:
                kind = kinds.get(_s(f[field][i]))
            if not kind:
                continue
            tw.point(kind, cen[i, 0], cen[i, 1], {k: _clean(f[c][i]) for k, c in attrs.items()})
            n0 += 1
        log.info("features: %s -> %d points", layer_name, n0)

    for layer_name, field, kinds, attrs, where in LINE_POINT_RULES:
        gs, f = _read(g, layer_name, [field] + list(attrs.values()), where=where)
        if not len(gs):
            continue
        ok = ~shapely.is_missing(gs)
        n0 = 0
        for i in np.nonzero(ok)[0]:
            kind = kinds.get(_s(f[field][i]))
            if not kind:
                continue
            geom = gs[i]
            pt = geom.interpolate(0.5, normalized=True) if geom.geom_type in ("LineString", "MultiLineString") else geom.centroid
            if not _in_aoi(np.array([[pt.x, pt.y]]), aoi)[0]:
                continue
            tw.point(kind, pt.x, pt.y, {k: _clean(f[c][i]) for k, c in attrs.items()})
            n0 += 1
        log.info("features: %s -> %d points", layer_name, n0)

    # named lines: main roads (with load class and MSR), railways, canals, rivers
    tol = 15.0
    pcols = ["TYPE", "CLASSIFICA", "DEFENCE_RD", "WIDTH_M", "CATEGORY", "SURFACE", "NAME", "ROAD_NO"]
    gs, f = _read(g, "Roads_updated_2016_Pakmap", pcols)
    n0 = 0
    for i, geom in enumerate(gs):
        if geom is None:
            continue
        kind, tier, msr, a = pakmap_road({c: f[c][i] for c in pcols}, tk, msr_cfg)
        if not (msr or tier or a.get("n") or a.get("r")):
            continue
        tw.line("road", shapely.simplify(geom, tol), a)
        n0 += 1
    log.info("features: %d named / classed / MSR road lines", n0)
    gs, f = _read(g, "Railways_Pakmap", ["NAME", "GAUGE", "RLY_TYPE", "CATEGORY", "STATUS"])
    for i, geom in enumerate(gs):
        if geom is None:
            continue
        k = pakmap_rail({c: f[c][i] for c in f})
        tw.line("railway", shapely.simplify(geom, tol), {"n": _clean(f["NAME"][i]), "t": k,
                                                          "m": 1 if k in ("rail_bg_single", "rail_bg_double") else 0})
    gs, f = _read(g, "Canal_Pakmap", ["NAME", "TYPE_OF_CA", "WIDTH_M", "DEPTH_M", "RIGHTBANKH", "LEFTBANKHT", "CATEGORY"])
    for i, geom in enumerate(gs):
        if geom is None:
            continue
        bank = max([b for b in (parse_width_m(f["RIGHTBANKH"][i]), parse_width_m(f["LEFTBANKHT"][i])) if b] or [0]) or None
        tw.line("canal", shapely.simplify(geom, tol), {"n": _clean(f["NAME"][i]), "t": _clean(f["TYPE_OF_CA"][i]),
                                                        "w": parse_width_m(f["WIDTH_M"][i]), "dp": parse_width_m(f["DEPTH_M"][i]),
                                                        "b": bank, "s": _clean(f["CATEGORY"][i])})
    gs, f = _read(g, "RiverLine_Pakmap", ["NAME", "TYPE_OF_RI", "CONDITION", "WIDTH_m"])
    for i, geom in enumerate(gs):
        if geom is None or not _clean(f["NAME"][i]):
            continue
        tw.line("river", shapely.simplify(geom, tol), {"n": _clean(f["NAME"][i]), "t": _clean(f["TYPE_OF_RI"][i]),
                                                        "s": _clean(f["CONDITION"][i]), "w": parse_width_m(f["WIDTH_m"][i])})
    n = tw.write(out / "features")
    log.info("features: %d tiles at z%d -> %s", n, FEATURE_Z, out / "features")


def _geojson(gs_ll, props: list[dict], tol_deg: float) -> list[dict]:
    import shapely
    feats = []
    for geom, p in zip(gs_ll, props):
        if geom is None or geom.is_empty:
            continue
        geom = shapely.set_precision(shapely.simplify(geom, tol_deg, preserve_topology=True), 1e-5)
        if geom.is_empty:
            continue
        feats.append({"type": "Feature", "properties": {k: v for k, v in p.items() if v is not None},
                      "geometry": json.loads(shapely.to_geojson(geom))})
    return feats


def admin_and_sheets(gdb: Path, grid: dict, out: Path) -> None:
    """admin.geojson (province / district / tehsil / corps AOR), boundaries.geojson, sheets.json — WGS84."""
    import pyogrio.raw as raw
    import shapely
    g = str(gdb)
    w, s, e, n = grid["aoi"]
    bbox = (w, s, e, n)

    def read_ll(layer, cols, where=None):
        meta, _f, geom, data = raw.read(g, layer=layer, columns=cols, bbox=bbox, where=where)
        cols_d = dict(zip(meta["fields"], data))
        return shapely.from_wkb(geom), {c: [_clean(v) for v in cols_d.get(c, [None] * len(geom))] for c in cols}

    feats = []
    for layer, cols, mk in (
        ("Province_Bdry", ["NAME", "Prov_Name", "COUNTRY"], lambda d, i: {"layer": "province", "name": d["NAME"][i] or d["Prov_Name"][i], "country": d["COUNTRY"][i]}),
        ("Distt_Bdry", ["DISTT_NAME", "PROVINCE_N", "COUNTRY"], lambda d, i: {"layer": "district", "name": d["DISTT_NAME"][i], "province": d["PROVINCE_N"][i], "country": d["COUNTRY"][i]}),
        ("Tehsil_Bdry", ["TEH_NAME", "DISTT_NAME", "PROVINCE_N"], lambda d, i: {"layer": "tehsil", "name": d["TEH_NAME"][i], "district": d["DISTT_NAME"][i], "province": d["PROVINCE_N"][i]}),
        ("Corps_AOR", ["NAME", "TYPE"], lambda d, i: {"layer": "corps_aor", "name": d["NAME"][i], "type": d["TYPE"][i], "sensitive": True}),
    ):
        gs, d = read_ll(layer, cols)
        feats += _geojson(gs, [mk(d, i) for i in range(len(gs))], 0.0008)
        log.info("admin: %s %d", layer, len(gs))
    (out / "admin.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")

    bdry_kinds = {"3": "international (undemarcated)", "4": "Pakistan-Afghanistan", "5": "Pakistan-China", "6": "Pakistan-India",
                  "7": "Pakistan-Iran", "21": "Line of Control", "35": "international (demarcated)", "36": "Pakistan-India (undemarcated)",
                  "37": "Pakistan-Afghanistan (undemarcated)", "9": "province", "8": "province (undemarcated)"}
    gs, d = read_ll("Boundry", ["TYPE_OF_BDRY", "Name"])
    keep = [i for i, t in enumerate(d["TYPE_OF_BDRY"]) if str(t) in bdry_kinds]
    feats = _geojson([gs[i] for i in keep], [{"layer": "boundary", "kind": bdry_kinds[str(d["TYPE_OF_BDRY"][i])], "name": d["Name"][i]} for i in keep], 0.0003)
    for layer, kind, sens in (("LAC", "Line of Actual Control", False), ("CorpsOpsLine", "Corps operational line", True),
                              ("Political_Bdry", "political boundary", False)):
        gs2, d2 = read_ll(layer, ["Name"] if layer != "LAC" else ["NAME"])
        nm = d2.get("Name") or d2.get("NAME")
        feats += _geojson(gs2, [{"layer": "boundary", "kind": kind, "name": nm[i], **({"sensitive": True} if sens else {})} for i in range(len(gs2))], 0.0003)
    (out / "boundaries.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    log.info("boundaries: %d lines", len(feats))

    sheets = {}
    for key, layer, col in (("50k", "Sheets_50K", "SHEET_NO"), ("250k", "Sheets_250K", "Sheet_No"),
                            ("500k", "Sheets_500K", "Sheet_No"), ("1m", "Sheets_1Million", "Sheet_No")):
        gs, d = read_ll(layer, [col])
        rows = []
        for geom, no in zip(gs, d[col]):
            if geom is None or no is None:
                continue
            x0, y0, x1, y1 = geom.bounds
            rows.append([str(no), round(x0, 5), round(y0, 5), round(x1, 5), round(y1, 5)])
        sheets[key] = rows
        log.info("sheets: %s %d", key, len(rows))
    (out / "sheets.json").write_text(json.dumps({"format": "pams-grotbc-sheets", "note": "[sheet number, west, south, east, north] (WGS84)",
                                                 **sheets}, separators=(",", ":")), encoding="utf-8")

# ----------------------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--grid", type=Path, default=Path("work/grid"))
    ap.add_argument("--derive", type=Path, default=Path("work/derive"))
    ap.add_argument("--out", type=Path, default=Path("work/grotbc"))
    ap.add_argument("--classes", type=Path, default=Path("classes.yaml"))
    ap.add_argument("--rules", type=Path, default=Path("rules.yaml"))
    ap.add_argument("--ncgdb", help="NCGDB .gdb folder (default: classes.yaml, then $NCGDB_PATH)")
    ap.add_argument("--block", type=int, default=2048)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--only", nargs="*", choices=["vector", "relief", "features", "admin"], help="subset of products")
    args = ap.parse_args()

    from derive import resolve_ncgdb
    grid = load_json(args.grid / "grid.json")
    cfg, rules = load_yaml(args.classes), load_yaml(args.rules)
    gdb, _ = resolve_ncgdb(args.ncgdb, cfg["sources"].get("ncgdb", {}).get("path"))
    want = set(args.only or ["vector", "relief", "features", "admin"])
    if want - {"relief"} and (gdb is None or not gdb.is_dir()):
        raise SystemExit(f"grotbc needs the NCGDB for {sorted(want - {'relief'})}: not found at {gdb}")
    args.out.mkdir(parents=True, exist_ok=True)
    vec = args.out / "vector"
    vec.mkdir(parents=True, exist_ok=True)
    if "relief" in want:
        relief_rasters(grid, args.grid / "dem.tif", args.derive / "slope.tif", cfg, args.out, args.block)
    if "vector" in want:
        vector_rasters(grid, gdb, cfg, rules, args.out, args.block, args.workers)
    if "features" in want:
        import shutil
        shutil.rmtree(vec / "features", ignore_errors=True)
        features(gdb, grid, rules, vec)
    if "admin" in want:
        admin_and_sheets(gdb, grid, vec)
    return 0


if __name__ == "__main__":
    sys.exit(main())
