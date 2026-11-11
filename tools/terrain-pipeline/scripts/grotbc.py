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

from common import (GTIFF_U8, WORLDPOP_TIF, WORLDPOP_YEAR, read_people, source_ref, ORIGIN_SHIFT, class_table, iter_blocks, load_json, load_yaml, merc_to_lnglat,
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
# code -> (key, label, GROTBC letters). Codes are stable; the engine reads them from features/index.json.
# Letters follow GROTBC.md: G Ground (relief, terrain type, soil, vegetation, hydrology), R Roads / tracks / railway
# network (incl. crossings, airfields), O Obstacles, T Trafficability (changes the going), B Built-up areas (settlements, public infrastructure, installations, borders),
# C Cover & concealment.
KINDS = {
    1: ("tube_well", "Tube well", "G"), 2: ("well_lined", "Well (lined)", "G"), 3: ("well_unlined", "Well (unlined)", "G"),
    4: ("spring", "Spring", "G"), 5: ("tank_perennial", "Tank (perennial)", "G"), 6: ("tank_seasonal", "Tank (non-perennial)", "G"),
    7: ("karez", "Karez (perennial)", "G"), 8: ("hand_pump", "Hand pump", "G"), 9: ("tank_overhead", "Overhead tank", "G"),
    20: ("bridge", "Bridge", "RO"), 21: ("bridge_iron", "Iron bridge", "RO"), 22: ("foot_bridge", "Foot bridge", "RO"),
    23: ("aqueduct", "Aqueduct", "O"), 24: ("siphon", "Siphon", "O"), 25: ("ferry", "Ferry", "RO"), 26: ("ford", "Ford", "RO"),
    27: ("boat_bridge", "Boat bridge", "RO"), 28: ("tunnel", "Road tunnel", "R"), 29: ("rail_tunnel", "Railway tunnel", "R"),
    30: ("viaduct", "Viaduct", "RO"), 31: ("culvert", "Culvert", "RO"), 32: ("canal_tunnel", "Canal tunnel", "O"),
    40: ("helipad", "Helipad", "R"), 41: ("airfield", "Airfield", "R"), 42: ("air_base", "Air base", "R"),
    43: ("landing_strip", "Landing strip", "R"), 44: ("airport", "Airport", "R"), 45: ("landing_ground", "Landing ground", "R"),
    46: ("runway", "Runway", "R"), 47: ("road_runway", "Road runway", "R"),
    50: ("rail_station", "Railway station", "R"),
    55: ("pass", "Pass", "RG"), 56: ("dam", "Dam", "GO"), 57: ("barrage", "Barrage", "GO"), 58: ("headworks", "Headworks", "GO"),
    60: ("watch_tower", "Watch tower", "B"), 61: ("post", "Piquet / post", "B"), 62: ("bunker", "Bunker", "C"),
    63: ("trench", "Trench", "C"), 64: ("fort", "Fort", "B"), 65: ("border_post", "Border post", "B"),
    66: ("cantonment", "Cantonment", "B"), 67: ("boundary_pillar", "Boundary pillar", "B"), 68: ("wireless_station", "Wireless station", "B"),
    69: ("firing_range", "Firing range", "B"), 70: ("hospital", "Hospital", "B"), 71: ("bhu", "Basic health unit", "B"),
    72: ("dispensary", "Dispensary", "B"), 73: ("vet_hospital", "Veterinary hospital", "B"), 74: ("grid_station", "Grid station", "B"),
    75: ("rest_house", "Rest house", "B"), 76: ("petrol_pump", "Petrol pump", "R"), 77: ("police_station", "Police station", "B"),
    78: ("mast", "Mast", "O"), 79: ("wind_tower", "Wind tower", "O"), 80: ("oil_gas_well", "Oil / gas well", "B"),
    81: ("oil_tank", "Oil tank", "B"),
    85: ("cave", "Cave", "C"), 86: ("mine", "Mine", "B"), 87: ("mine_shaft", "Mine shaft", "B"),
    88: ("deserted_site", "Deserted site", "B"), 89: ("air_target", "Air firing / bombing target", "B"),
    90: ("km_road", "KM stone (road)", "R"), 91: ("km_rail", "KM stone (railway)", "R"), 92: ("km_canal", "KM stone (canal)", "O"),
    100: ("trig_station", "Trig station", "G"), 101: ("spot_height", "Spot height", "G"), 102: ("bench_mark", "Bench mark", "G"),
    110: ("city", "City", "B"), 111: ("district_hq", "District HQ", "B"), 112: ("town", "Town", "B"),
    113: ("village_imp", "Important village", "B"), 114: ("village", "Village", "B"),
    120: ("tomb", "Tomb", "B"), 121: ("kiln", "Kiln", "B"), 122: ("chimney", "Factory chimney", "B"),
    # 2026-11-06: GeoNames (PK.txt) codes the card asked for that had no kind (levees, industrial areas, camps,
    # named vegetation, parks)
    123: ("levee", "Levee / flood bund", "OC"), 124: ("industrial_area", "Industrial area", "B"), 125: ("camp", "Camp", "B"),
    126: ("vegetation_name", "Orchard / grove / cultivated area (named)", "GC"), 127: ("park", "Park / garden", "B"),
    # 2026-11-03: named detail for B, R, O (Services_Point, Reservior, Glacier_Polygon, River_Pakmap)
    130: ("mosque", "Mosque", "B"), 131: ("graveyard_pt", "Graveyard / grave", "BC"), 132: ("temple", "Temple", "B"),
    133: ("church", "Church", "B"), 134: ("eidgah", "Eidgah", "B"), 135: ("telecom_booster", "Telephone / TV booster", "B"),
    136: ("post_office", "Post office", "B"), 137: ("telephone_exchange", "Telephone / telegraph office", "B"),
    138: ("market", "Market", "B"), 139: ("bus_stand", "Bus stand", "R"), 140: ("mill", "Mill / factory", "B"),
    141: ("stadium", "Stadium", "B"), 142: ("toll_plaza", "Toll plaza", "R"), 143: ("waterfall", "Waterfall", "GO"),
    144: ("lake", "Lake / reservoir", "GO"), 145: ("glacier", "Glacier", "GT"), 146: ("river_reach", "River reach (bed, depth, current)", "GO"),
    # 2026-11-04: GeoNames (PK.txt) names the NCGDB lacks
    147: ("school", "School / college", "B"), 148: ("bank", "Bank", "B"), 149: ("government_office", "Government office / court", "B"),
    150: ("mountain", "Mountain / hill / ridge", "G"), 151: ("dune", "Dune (named)", "GT"), 152: ("landform_name", "Named landform", "G"),
    153: ("stream_name", "Stream (named)", "GO"), 154: ("canal_name", "Canal (named)", "O"), 155: ("well", "Well", "G"),
    156: ("marsh", "Marsh / swamp", "GOT"), 157: ("locality", "Locality / area", "G"), 158: ("forest_name", "Forest (named)", "GTC"),
    159: ("road_junction", "Road junction (named)", "R"),
    # 2026-11-04: G terrain feature inventory and Important Tactical Ground candidates (ground.py merges these
    # into features/ after this step; `ig` / `it` on any point mark an ITG candidate, rules.json grotbc.itg)
    160: ("peak", "Peak", "G"), 161: ("hill", "Hill", "G"), 162: ("knoll", "Knoll / raised ground", "G"),
    163: ("saddle", "Saddle / col", "G"), 164: ("plateau", "Plateau", "G"), 165: ("depression", "Closed depression", "G"),
    166: ("main_junction", "Junction of main roads", "GR"),
    # 2026-11-06: NCGDB layers not read before. Soil_Line / Soil_Point dunes become dune fields (one point per
    # ~2 km cell: crest spacing, orientation); the other Soil_Point symbols, moraines (Soil_Line 1), crevasses
    # (Glacier_Line 4), solar power stations (Misc_Polygon_Feature 2) and the sheet's own text (Annotation_) as notes.
    167: ("dune_field", "Dune field", "GT"), 168: ("quarry", "Quarry", "GB"), 169: ("broken_ground", "Broken rocky ground", "GT"),
    170: ("stony_waste", "Stony waste", "GT"), 171: ("scree", "Scree", "GT"), 172: ("earth_slide", "Earth / gravel slide", "GO"),
    173: ("moraine", "Moraine", "GT"), 174: ("ice_pinnacles", "Ice pinnacles", "GO"), 175: ("sand_plain", "Sand plain", "GT"),
    176: ("crevasse", "Crevasses", "GO"), 177: ("solar_plant", "Solar power station", "B"),
    178: ("note_going", "Map note: going", "T"), 179: ("note_vegetation", "Map note: vegetation", "GC"),
    180: ("note_ground", "Map note: ground", "G"), 181: ("note_water", "Map note: water", "G"),
    # Soil_Point 16: the sheet's wind arrows. `wd` = the arrow's axis (Angle clockwise from north: checked against
    # the dune lines round 471 arrows, 79 % within 20 degrees); which end the wind blows from is not recorded.
    182: ("wind_arrow", "Wind arrow (map)", "G"),
    # lines (features.json "l")
    200: ("road", "Road", "R"), 201: ("railway", "Railway", "R"), 202: ("canal", "Canal", "O"), 203: ("river", "River", "GO"),
    204: ("ridgeline", "Ridgeline", "G"),
    # 2026-11-06: OpenStreetMap lines (fords, health and fuel go onto the existing point kinds with src = osm)
    205: ("power_line", "Power line", "O"), 206: ("pipeline", "Pipeline", "O"), 207: ("wall_fence", "Wall / fence", "OC"),
    # Limit_Line 6 (Lal Suhanra)
    208: ("park_boundary", "National park boundary", "B"),
}
KIND_CODE = {v[0]: k for k, v in KINDS.items()}
GROUND_KINDS = {160, 161, 162, 163, 164, 165, 166, 204}          # written by ground.py, never by this step
# attributes ground.py adds (G inventory + ITG candidates)
GROUND_ATTRS = {"rr": "relative relief: height above the lowest ground within 2 km (m)",
                "iso": "dominance: the highest ground within this radius (km; 5 = 5 km or more)",
                "vs": "share of the ground within 5 km visible from 2 m above the feature (%)",
                "mv": "nearest main supply route in view (km)", "sp": "mean slope within 300 m (degrees)",
                "dr": "nearest main supply route (km, up to 5)", "dn": "nearest road or track (km, up to 5)",
                "lc": "class code at the feature (classes.yaml)", "cv": "cover / concealment code at the feature (cc layer)",
                "hs": "surveyed height of a trig station / spot height within 250 m (m)", "lk": "length (km)",
                "mx": "ways out of a road junction along motorways / national highways (3+ = two highways meet)",
                "ig": "ITG candidate: reason letters (rules.json grotbc.itg.reasons)",
                "it": "1 ITG candidate, 2 strong candidate (check as MITG for the task)"}
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


def parse_len_m(text) -> float | None:
    """A recorded length / height with its unit -> metres: '552 METERS', '300 ft', '6.30 Km', '30 MILES',
    '1,223.5 METERS', '450' (metres when no unit). None when unreadable or 0."""
    t = _s(text).lower().replace("\xa0", " ")
    m = re.search(r"\d[\d,]*(?:\.\d+)?", t)
    if not m:
        return None
    v = float(m.group(0).replace(",", ""))
    rest = t[m.end():]
    if re.match(r"\s*(km|kilomet)", rest):
        v *= 1000.0
    elif re.match(r"\s*mile", rest):
        v *= 1609.344
    elif re.match(r"\s*(ft|feet|')", rest):
        v *= 0.3048
    return round(v, 1) if 0 < v < 100_000 else None


def parse_count(text) -> int | None:
    m = re.search(r"\d+", _s(text))
    return int(m.group(0)) if m and 0 < int(m.group(0)) < 10_000 else None


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
    named = {n.strip().lower() for n in (msr_cfg.get("namedRoutes") or [])}
    official = bool(named) and (_s(row.get("NAME")).lower() in named or _s(row.get("ROAD_NO")).lower() in named)
    msr = (kind in msr_cfg.get("types", [])) or (defence and msr_cfg.get("defenceRoad", True)) or official or \
          (metalled and load is not None and load >= int(msr_cfg.get("metalledMinClass", 50)))
    # seasonal / temporary closure, condition and landslide sites recorded on the road (few segments carry them)
    closed = _s(row.get("CLOSED_DUE"))
    closed = closed if len(closed) > 1 and closed.lower() not in ("none", "nan") else ""
    cond = _s(row.get("CONDITION"))
    cond = cond if cond.lower() not in ("", "none", "nan") else ""
    slides = _clean(row.get("NO_OF_SLID"))
    bridges = parse_count(row.get("NO_OF_BRS"))          # 2026-11-10: bridges recorded on this road section (7,085 sections)
    attrs = {k: v for k, v in (("n", _s(row.get("NAME"))), ("r", _s(row.get("ROAD_NO"))), ("t", kind),
                               ("c", _s(row.get("CLASSIFICA")).upper()), ("w", width), ("k", tier),
                               ("d", 1 if defence else 0), ("m", 1 if msr else 0),
                               ("x", closed), ("cn", cond[:24]),
                               ("sl", slides if isinstance(slides, int) else None),
                               ("nb", bridges if bridges and bridges < 1000 else None)) if v not in ("", None, 0)}
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
          (metalled and load is not None and load >= int(msr_cfg.get("metalledMinClass", 50)))
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
     {"n": "NAME", "p": "POPULATION", "d": "DISTT_NAME", "h": "TEH_NAME", "e": "ELEVATION", "pv": "Province"}),
    ("Services_Point", "Type_of__Svc_Point", {"33": "mosque", "23": "graveyard_pt", "12": "graveyard_pt", "22": "graveyard_pt",
     "51": "temple", "15": "church", "20": "eidgah", "49": "telecom_booster", "50": "telecom_booster", "37": "post_office",
     "39": "telephone_exchange", "48": "telephone_exchange", "32": "market", "11": "bus_stand", "70": "mill", "65": "stadium",
     "71": "toll_plaza", "57": "waterfall"}, {"n": "Name"}, {"22"}),       # single graves (22) only when named
    ("Railway_Station", "Type_of_Rly_Station", {"1": "rail_station"}, {"n": "Name"}),
    ("KM_Stone", "Type_of_KM_Stone", {"3": "km_road", "4": "km_road", "2": "km_rail", "1": "km_canal"}, {"n": "Name"}),
    ("Boundry_Piller", "Type_of_BdryPiller", {"1": "boundary_pillar", "2": "boundary_pillar"}, {"n": "Name"}),
    ("Kiln", "Type_of_Kiln", {"1": "kiln"}, {}),
    ("AiR_Field_Pakmap", "AIR_FD_TYP", {"Air Fd": "airfield", "Landing Strip": "landing_strip", "Air Base": "air_base",
     "Helipad": "helipad", "Rd Runway": "road_runway", "Airport": "airport"},
     {"n": "NAME", "c": "COUNTRY", "rw": "RUNWAY_SIZ", "rd": "RUNWAY_DIR", "s": "SURFACE", "e": "ELEV_M_",
      "u1": "FMN", "u2": "SQN", "u3": "CBT_AC", "u4": "TPT_AC", "u5": "HELI", "u6": "UAV"}),
    ("Airports_Pakmap", "AIR_FD_TYP", {"Airport": "airport", "Air Fd": "airfield"}, {"n": "NAME", "c": "Category", "s": "Classifica"}),
    # 2026-11-06: the structure detail (length, width, height, gates, spans, storage, power, discharge, year) as well
    ("HeadWorks_Pakmap", "CATEGORY", {"Dam": "dam", "H/W": "headworks", "Barrage": "barrage", "Reservoir": "dam"},
     {"n": "NAME", "c": "CLASSIFICA", "rv": "RIVER", "s": "STRUCTURE", "lm": "LENGTH_M", "wm": "WIDTH_M", "hm": "HEIGHT",
      "gt": "NO_OF_GATE", "sn": "SPAN_NO", "st": "STORAGE_CA", "pw": "POWER_GEN_", "dc": "DISCHARGE", "yr": "YEAR_OF_CO"}),
    ("Cantts_Pakmap", None, {"": "cantonment"}, {"n": "Cantts", "f": "Fmn_Name", "pc": "Parent_Cor", "s": "Cantts_Siz"}),
    # 2026-11-06: layers not read before. Soil_Point dune symbols (6, 9, 11, 12) go into the dune fields instead,
    # 16 (wind arrows) into wind_arrows(); 3 (query mark) is left out.
    ("Soil_Point", "Type_of_Soil_Point", {"1": "broken_ground", "2": "quarry", "4": "earth_slide", "5": "moraine",
     "7": "sand_plain", "8": "scree", "10": "stony_waste", "15": "ice_pinnacles"}, {"n": "Name"}),
    ("Misc_Polygon_Feature", "Type_of_Misc_Polygon", {"2": "solar_plant", "3": "stadium"}, {"n": "Name"}),
]
LINE_POINT_RULES = [   # lines kept as one point (their middle)
    ("Crosings_line", "Type_of_Crossing", {"4": "ferry", "5": "ford", "1": "boat_bridge", "2": "boat_bridge", "3": "bridge",
     "6": "bridge_iron", "9": "bridge", "10": "bridge"}, {"n": "Name"}, None),
    ("Water_Feature_Line", "Type_of_Water_Feature_Line", {"8": "karez"}, {"n": "Name"}, "Type_of_Water_Feature_Line = '8'"),
    ("Misc_Line_Features", "Type_of_Line", {"12": "landing_ground", "7": "firing_range", "18": "firing_range"}, {"n": "Name"}, None),
    ("Tracks", "Type_of_Track", {"6": "ford"}, {"n": "Name"}, "Type_of_Track = '6'"),
    ("Runway", "Type_of_RUNWAY", {"1": "runway"}, {"n": "Name"}, None),
    ("Glacier_Line", "Type_of_Glacier_Line", {"4": "crevasse"}, {"n": "Name"}, "Type_of_Glacier_Line = '4'"),
    ("Soil_Line", "Type_Soil_Line", {"1": "moraine"}, {"n": "Name"}, "Type_Soil_Line = '1'"),
]

# Soil_Line dune lines (1:50k "Sand Dunes 1-5 Dot" line styles) and Soil_Point dune symbols, summed per DUNE_CELL_DEG cell
DUNE_LINE_TYPES = ("2", "3", "4", "5", "6")
DUNE_STAR, DUNE_OTHER = {"9"}, {"6", "11", "12"}        # star dunes; sand dunes, tail sand hill, whale-back dunes
DUNE_CELL_DEG = 0.02                                     # ~2 km
DUNE_MIN_KM = 1.0                                        # a cell needs this much dune line (or 3 dune symbols)

# Annotation_ (the sheet's own text): first rule that matches the lower-cased text wins; NOTE_SKIP drops labels of
# other things (boundaries, rest houses, offices). Each note keeps the text as written (`n`).
NOTE_RULES = [
    ("note_going", r"\b(jeepable|motorable|fair weather|follows (the )?bed|bricks? surfaced|causeway|fordable|impassable|"
                   r"pack track|mule track|camel track|unmetalled|kacha|kutcha)\b"),
    ("note_water", r"\b(brackish|brakish|undrinkable|sweet water|fresh water|salty|saline|dry|high water line|"
                   r"low water line|falls \d+|flood(ed|ing)?)\b"),
    ("note_vegetation", r"\b(scrub|jungle|pine|forest|grass|bush(es)?|reeds?|trees|plantation|deodar|chir|oak|thorn)\b"),
    ("note_ground", r"\b(rocky|stony|scree|moraines?|sand( dunes?| hills?)?|sandy|mud|marsh(y)?|swamp(y)?|glaciated|"
                    r"snow bed|depression|ravines?|broken ground|boulders?|cliffs?|precipitous|slides?|terraces?|salt)\b"),
]
NOTE_SKIP = r"\b(boundary|rest house|rh|lodge|colony|school|mills?|office|post|station|chowki|farm|kilns?|factory)\b"
NOTE_DEDUPE_M = 500


def _clean(v):
    s = _s(v)
    if s in ("", "None", "nan", "0", "0.0", "<Null>", "Unknown") or set(s) <= {"-", " ", "c"}:
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
        self.xy: dict[str, list] = defaultdict(list)        # point positions per kind, for de-duplicating other sources
        self.refs: dict[str, list] = defaultdict(list)      # the attrs dict of each point, aligned with xy (later steps enrich it)
        (w, s), (e, n) = _merc_xy(np.array([[aoi[0], aoi[1]], [aoi[2], aoi[3]]]))
        self.trange = (*self._tile(w, n), *self._tile(e, s))          # lines are kept only inside the AOI

    def _tile(self, x: float, y: float) -> tuple[int, int]:
        return int((x + ORIGIN_SHIFT) // self.size), int((ORIGIN_SHIFT - y) // self.size)

    def _q(self, tx, ty, x, y):
        minx = -ORIGIN_SHIFT + tx * self.size
        maxy = ORIGIN_SHIFT - ty * self.size
        return (int(min(QUANT - 1, max(0, round((x - minx) / self.size * QUANT)))),
                int(min(QUANT - 1, max(0, round((maxy - y) / self.size * QUANT)))))

    def point(self, kind: str, x: float, y: float, attrs: dict) -> dict:
        tx, ty = self._tile(x, y)
        qx, qy = self._q(tx, ty, x, y)
        k = KIND_CODE[kind]
        a = {key: val for key, val in attrs.items() if val is not None}
        self.points[(tx, ty)].append([k, qx, qy, a])           # the dict is kept (write() drops it when empty)
        self.counts[k] += 1
        self.xy[kind].append((x, y))
        self.refs[kind].append(a)
        return a

    def nearest(self, kinds, x: float, y: float, r: float) -> tuple[str, dict, float] | None:
        """The nearest point already written of any of `kinds` within r (Web Mercator metres): (kind, attrs, distance)."""
        best = None
        for kind in kinds:
            pts = self.xy.get(kind)
            if not pts:
                continue
            p = np.asarray(pts)
            d = np.hypot(p[:, 0] - x, p[:, 1] - y)
            i = int(d.argmin())
            if d[i] <= r and (best is None or d[i] < best[2]):
                best = (kind, self.refs[kind][i], float(d[i]))
        return best

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
                obj["p"] = [p if len(p) < 4 or p[3] else p[:3] for p in self.points[(tx, ty)]]   # ground.py re-feeds tiles from disk
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
                           "dp": "depth (m)", "b": "bank height (m)",
                           "bl": "left bank height (m), looking along the line as drawn",
                           "br": "right bank height (m), looking along the line as drawn", "g": "gauge", "s": "surface / structure / size",
                           "rw": "runway size", "rd": "runway direction", "rv": "river", "f": "formation",
                           "x": "seasonal / temporary closure as recorded (e.g. Jun-Oct, Snow)", "cn": "recorded road condition",
                           "sl": "landslide sites on the road segment", f"wp": f"estimated population (WorldPop {WORLDPOP_YEAR}, share nearest this place)",
                           "an": "alternate names / spellings (GeoNames)", "gn": "GeoNames id", "src": "source when not the NCGDB (gn = GeoNames)",
                           f"wc": f"WorldPop {WORLDPOP_YEAR} people within 12 km (city) / 8 km (district HQ) / 4 km (town) of the place",
                           "pv": "province", "a": "area (km2)", "cu": "current (m/s)", "ws": "wet span of a river reach",
                           "dc": "discharge (cusecs)", "dm": "maximum depth (m)", "bk": "bank height",
                           "pc": "parent corps", "u1": "formation", "u2": "squadrons", "u3": "combat aircraft",
                           "u4": "transport aircraft", "u5": "helicopters", "u6": "UAV",
                           "lm": "length (m)", "wm": "width (m)", "hm": "height (m)", "gt": "gates", "sn": "spans",
                           "st": "storage capacity (as recorded)", "pw": "power generation (as recorded)", "yr": "year completed",
                           "hq": "administrative seat: province / district / tehsil (NCGDB Places)",
                           "sp": "dune field: mean spacing of the dune lines (m)",
                           "or": "dune field: orientation of the dune lines, degrees from north (an axis, 0-179)",
                           "oc": "dune field: how parallel the dune lines are (0-100)", "dk": "dune field: km of dune line per km²",
                           "sd": "dune field: star-dune symbols in the cell", "ds": "dune field: other dune symbols in the cell",
                           "v": "power line voltage (kV)",
                           "wd": "map wind arrow: axis, degrees clockwise from north (0-179); which end the wind blows from is not recorded",
                           "nb": "bridges recorded on the road section (NCGDB NO_OF_BRS)",
                           "bt": "crossing type words from its name and the sheet's text beside it: temporary, suspension, "
                                 "cantilever, wooden, rope, iron, masonry, natural, snow, boats, overhead, underpass, foot, "
                                 "viaduct, causeway",
                           "bs": "crossing status from the sheet's text: u/c (under construction) or disused",
                           "su": "months the crossing is in use as the sheet writes them (ferry, ford, bridge of boats), e.g. Oct-Apr",
                           "bo": "boats of a ferry, as the sheet writes it",
                           "lb": "1 = crossing placed at the sheet's label (no symbol near it): a few hundred metres out",
                           **GROUND_ATTRS},
                 "kinds": {str(k): {"key": v[0], "label": v[1], "grotbc": v[2], "count": self.counts.get(k, 0)}
                           for k, v in sorted(KINDS.items())},
                 "tiles": len(keys)}
        if getattr(self, "sources", None):
            index["sources"] = self.sources
        (out / "index.json").write_text(json.dumps(index, indent=1, ensure_ascii=False), encoding="utf-8")
        return n


def _geodesic_km(geom) -> float:
    """Length of a Web Mercator line in km: planar length x cos(latitude) of its centre (fragments are short)."""
    if geom is None or geom.is_empty:
        return 0.0
    lat = 2 * math.atan(math.exp(geom.centroid.y / 6378137.0)) - math.pi / 2
    return geom.length * math.cos(lat) / 1000.0


class RouteIndex:
    """routes.json: roads aggregated by road number (else by name) and railways by name, each with its from-to
    (when the name reads "A - B"), length, load class range, MSR flag, seasonal closures and recorded condition.
    The card reads it for "MSR: N-5, Karachi - Hyderabad, 163 km, class 70, tankable"."""

    LIMIT_KM = 1.0          # shorter, non-MSR, never-closed routes are left out (a village lane is not a route)
    PLACEHOLDER = re.compile(r"^(untitled|unnamed|unknown|no name)\b|^(road|rd|path|track|street|lane)$", re.I)

    def __init__(self) -> None:
        self.roads: dict[str, dict] = {}
        self.rails: dict[str, dict] = {}

    @staticmethod
    def _ends(name: str | None) -> tuple[str | None, str | None]:
        parts = [p.strip() for p in re.split(r"\s+(?:-|–|to)\s+", name or "") if p.strip()]
        return (parts[0], parts[-1]) if len(parts) >= 2 else (None, None)

    def _entry(self, table: dict, key: str, geom) -> dict:
        x0, y0, x1, y1 = geom.bounds
        lon0, lat0 = merc_to_lnglat(x0, y0)
        lon1, lat1 = merc_to_lnglat(x1, y1)
        e = table.get(key)
        if e is None:
            e = table[key] = {"km": 0.0, "frag": 0, "segs": defaultdict(float), "types": defaultdict(float),
                              "loads": [], "msr": 0, "closed": set(), "cond": defaultdict(int),
                              "bbox": [lon0, lat0, lon1, lat1]}
        b = e["bbox"]
        b[0], b[1], b[2], b[3] = min(b[0], lon0), min(b[1], lat0), max(b[2], lon1), max(b[3], lat1)
        return e

    def add_road(self, a: dict, geom, weight: float = 1.0) -> None:
        """weight scales the length: 0.5 for one carriageway of a dual carriageway drawn as two one-way lines."""
        key = a.get("r") or a.get("n")
        if not key:
            return
        e = self._entry(self.roads, key, geom)
        km = _geodesic_km(geom) * weight
        e["km"] += km
        e["frag"] += 1
        e["no"] = a.get("r")
        e["segs"][a.get("n") or ""] += km
        e["types"][a.get("t") or ""] += km
        load, _fair = parse_load_class(a.get("c"))
        if load is not None:
            e["loads"].append(load)
        e["msr"] |= 1 if a.get("m") else 0
        if a.get("x"):
            e["closed"].add(a["x"])
        if a.get("cn"):
            e["cond"][a["cn"]] += 1

    def add_rail(self, a: dict, geom) -> None:
        key = a.get("n")
        if not key:
            return
        e = self._entry(self.rails, key, geom)
        e["km"] += _geodesic_km(geom)
        e["frag"] += 1
        e["types"][a.get("t") or ""] += _geodesic_km(geom)
        e["msr"] |= 1 if a.get("m") else 0

    def _rows(self, table: dict, road: bool) -> list[dict]:
        rows = []
        for key, e in table.items():
            if e["km"] < self.LIMIT_KM and not e["msr"] and not e["closed"]:
                continue
            segs = {n: k for n, k in e["segs"].items() if n}
            by_number = road and e.get("no") is not None and key == e["no"]
            name = key if not by_number else (max(segs, key=segs.get) if segs else None)
            frm, to = self._ends(key if not by_number else None)
            if not by_number:
                # a placeholder ("???", "Untitled Path") or a bare generic name ("Road", "Link Road") joins unrelated
                # lines: drop it unless it reads "A - B" or its lines stay within ~3 degrees
                span = max(e["bbox"][2] - e["bbox"][0], e["bbox"][3] - e["bbox"][1])
                if not re.search(r"[A-Za-z]{3}", key) or self.PLACEHOLDER.search(key) or (not (frm and to) and span > 3.0):
                    continue
            row = {"id": key, "km": round(e["km"], 1), "frag": e["frag"],
                   "type": max(e["types"], key=e["types"].get) or None, "msr": e["msr"],
                   "bbox": [round(v, 2) for v in e["bbox"]]}
            if by_number:
                row["no"] = key
                row["segs"] = [n for n, _k in sorted(segs.items(), key=lambda kv: -kv[1])[:8]]
            else:
                row["name"] = name
            if frm and to:
                row["from"], row["to"] = frm, to
            if e["loads"]:
                row["load"] = [min(e["loads"]), max(e["loads"])]
            if e["closed"]:
                row["closed"] = sorted(e["closed"])
            if e["cond"]:
                row["cond"] = max(e["cond"], key=e["cond"].get)
            rows.append(row)
        rows.sort(key=lambda r: -r["km"])
        return rows

    def write(self, path: Path) -> None:
        roads, rails = self._rows(self.roads, True), self._rows(self.rails, False)
        doc = {"format": "pams-grotbc-routes", "version": 1,
               "note": "km = geodesic length of the NCGDB lines under that road number / name; from, to = the two ends "
                       "of a name written 'A - B'; load = lowest and highest recorded load class on it; closed = "
                       "seasonal closures as recorded; cond = commonest recorded condition; bbox = [w, s, e, n] WGS84. "
                       "Length is the sum of the mapped lines, not a surveyed route length.",
               "roads": roads, "rails": rails}
        path.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
        log.info("routes: %d roads (%d MSR), %d railways -> %s", len(roads), sum(r["msr"] for r in roads), len(rails), path)


SETTLEMENT_KINDS = {"city": 25_000, "district_hq": 15_000, "town": 8_000, "village_imp": 4_000, "village": 2_500}   # radius m
WITHIN_M = {"city": 12_000, "district_hq": 8_000, "town": 4_000}       # radius of the `wc` total
WORLDPOP = WORLDPOP_TIF
WP_PART_M = 250          # a coarser WorldPop cell is split into parts of about this size before the nearest-place share


GEONAMES = Path(r"D:\Imagery\PK.txt")      # GeoNames country dump (geonames.org, CC BY 4.0)
# GeoNames feature class.code -> (kind, subtype written to `t`)
GN_KINDS = {
    "S.SCH": ("school", "school"), "S.SCHC": ("school", "college"), "S.SCHM": ("school", "military school"),
    "S.SCHT": ("school", "technical school"), "S.SCHA": ("school", "agricultural school"), "S.SCHN": ("school", "school"),
    "S.UNIV": ("school", "university"), "S.HSP": ("hospital", "hospital"), "S.HSPC": ("hospital", "clinic"),
    "S.HSPD": ("hospital", "dispensary"), "S.BANK": ("bank", "bank"), "S.ADMF": ("government_office", "administrative office"),
    "S.CTHSE": ("government_office", "court house"), "S.MSQE": ("mosque", None), "S.SHRN": ("tomb", "shrine"),
    "S.TMB": ("tomb", "tomb"), "S.TMPL": ("temple", None), "S.CH": ("church", None), "S.CMTY": ("graveyard_pt", "cemetery"),
    "S.GRVE": ("graveyard_pt", "grave"), "S.PP": ("police_station", "police post"), "S.PSTP": ("post", "patrol post"),
    "S.PSTB": ("border_post", None), "S.CSTM": ("border_post", "customs post"), "S.PO": ("post_office", None),
    "S.MKT": ("market", None), "S.MALL": ("market", "mall"), "S.HTL": ("rest_house", "hotel"), "S.RHSE": ("rest_house", None),
    "S.FT": ("fort", None), "S.RSTN": ("rail_station", None), "S.AIRP": ("airport", None), "S.AIRF": ("airfield", None),
    "S.AIRH": ("helipad", None), "S.AIRB": ("air_base", None), "S.DAM": ("dam", None), "S.BDG": ("bridge", None),
    "S.ML": ("mill", "mill"), "S.MFG": ("mill", "factory"), "S.TOWR": ("mast", "tower"), "S.STDM": ("stadium", None),
    "S.RUIN": ("deserted_site", "ruin"), "S.PS": ("grid_station", "power station"), "S.STNR": ("wireless_station", "radio station"),
    "S.TRIG": ("trig_station", None), "S.CAVE": ("cave", None), "S.OILW": ("oil_gas_well", None), "S.MN": ("mine", None),
    "S.MNC": ("mine", "coal mine"), "S.WEIR": ("headworks", "weir"),
    "T.MT": ("mountain", "mountain"), "T.MTS": ("mountain", "mountain range"), "T.PK": ("mountain", "peak"),
    "T.HLL": ("mountain", "hill"), "T.HLLS": ("mountain", "hills"), "T.RDGE": ("mountain", "ridge"), "T.SPUR": ("mountain", "spur"),
    "T.MND": ("mountain", "mound"), "T.PASS": ("pass", None), "T.GAP": ("pass", "gap"), "T.SDL": ("pass", "saddle"),
    "T.DUNE": ("dune", None), "T.ERG": ("dune", "sand sea"), "T.DPR": ("landform_name", "depression"),
    "T.VAL": ("landform_name", "valley"), "T.VALG": ("landform_name", "hanging valley"), "T.GRGE": ("landform_name", "gorge"),
    "T.PLN": ("landform_name", "plain"), "T.PLAT": ("landform_name", "plateau"), "T.DSRT": ("landform_name", "desert"),
    "T.CLF": ("landform_name", "cliff"), "T.SLP": ("landform_name", "slope"), "T.SBED": ("landform_name", "dry stream bed"),
    "T.SCRP": ("landform_name", "escarpment"), "T.UPLD": ("landform_name", "upland"), "T.FORD": ("ford", None),
    "H.STM": ("stream_name", "stream"), "H.STMI": ("stream_name", "intermittent stream"), "H.STMD": ("stream_name", "distributary"),
    "H.STMC": ("stream_name", "canalized stream"), "H.STMX": ("stream_name", "section of stream"), "H.RVN": ("stream_name", "ravine"),
    "H.CNL": ("canal_name", "canal"), "H.CNLSB": ("canal_name", "underground irrigation canal (karez)"),
    "H.CNLQ": ("canal_name", "abandoned canal"), "H.CNLI": ("canal_name", "irrigation canal"), "H.SPNG": ("spring", None),
    "H.WLL": ("well", None), "H.LK": ("lake", "lake"), "H.LKI": ("lake", "intermittent lake"), "H.PND": ("lake", "pond"),
    "H.PNDI": ("lake", "intermittent pond"), "H.RSV": ("lake", "reservoir"), "H.RSVT": ("lake", "water tank"),
    "H.RSVI": ("lake", "intermittent reservoir"), "H.GLCR": ("glacier", None), "H.MRSH": ("marsh", "marsh"),
    "H.SWMP": ("marsh", "swamp"), "H.WTLD": ("marsh", "wetland"), "H.MRSHN": ("marsh", "salt marsh"),
    "L.AREA": ("locality", "area"), "L.LCTY": ("locality", "locality"), "L.RGN": ("locality", "region"),
    "L.TRB": ("locality", "tribal area"), "L.OILF": ("locality", "oil field"), "L.GASF": ("locality", "gas field"),
    "L.RESF": ("forest_name", "reserved forest"), "V.FRST": ("forest_name", "forest"), "R.RDJCT": ("road_junction", None),
    # 2026-11-06: the rest of the codes that matter for GROTBC (O levees, B industry / camps / barracks / parks,
    # G named vegetation, mud flats, islands)
    "T.LEV": ("levee", "levee"), "L.INDS": ("industrial_area", "industrial area"), "S.BRKS": ("cantonment", "barracks"),
    "S.CMP": ("camp", "camp"), "S.CMPRF": ("camp", "refugee camp"), "S.CMPMN": ("camp", "mining camp"),
    "V.CULT": ("vegetation_name", "cultivated area"), "V.OCH": ("vegetation_name", "orchard"), "V.GROVE": ("vegetation_name", "grove"),
    "V.SCRB": ("vegetation_name", "scrubland"), "H.FLTM": ("marsh", "mud flat"), "H.LBED": ("marsh", "lake bed"),
    "T.ISL": ("landform_name", "island"), "L.PRK": ("park", "park"), "S.GDN": ("park", "garden"), "S.ANS": ("deserted_site", "ancient site"),
    "S.MLSG": ("mill", "sugar mill"), "S.MLO": ("mill", "oil mill"), "H.CRKT": ("stream_name", "tidal creek"),
    "S.DIP": ("government_office", "diplomatic facility"), "S.MNMT": ("tomb", "monument"),
}
GN_PLACE = {"PPLC": "city", "PPLA": "city", "PPLA2": "district_hq", "PPLA3": "town", "PPL": "village", "PPLX": "locality",
            "PPLL": "locality", "PPLF": "village", "PPLS": "village", "PPLR": "village", "PPLH": "deserted_site",
            "PPLQ": "deserted_site", "PPLW": "deserted_site"}
GN_DEDUPE_M = 400          # a GeoNames POI this close to an NCGDB point of the same kind is the same thing
GN_OVERLAY_ID0 = 900_000_000   # PK.txt rows from this id up were added by pk_kmz.py from the formation overlays


def _norm(name) -> str:
    return re.sub(r"[^a-z]", "", str(name or "").casefold())


def geonames_features(path: Path, tw: "TileWriter", aoi, settle: list) -> None:
    """GeoNames points: named terrain (mountains, passes, dunes, streams), POIs the NCGDB lacks (schools, banks,
    government offices), and alternate spellings. A place that matches an NCGDB place within ~1 km by name gives it
    its alternate names (`an`) and GeoNames id (`gn`); an unmatched place is added with `src: gn`. POIs of a kind the
    NCGDB already has are skipped within GN_DEDUPE_M of one."""
    from difflib import SequenceMatcher
    from scipy.spatial import cKDTree
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            p = line.rstrip("\n").split("\t")
            if len(p) >= 19:
                rows.append(p)
    lon = np.array([float(p[5]) for p in rows])
    lat = np.array([float(p[4]) for p in rows])
    xy = _merc_xy(np.column_stack([lon, lat]))
    inside = _in_aoi(xy, aoi)
    stree = cKDTree(np.array([[s[0], s[1]] for s in settle])) if settle else None
    trees: dict = {}

    def near_same(kind: str, x: float, y: float, r: float) -> bool:
        if kind not in trees:
            pts = tw.xy.get(kind)
            trees[kind] = cKDTree(np.array(pts)) if pts else None
        t = trees[kind]
        return bool(t is not None and t.query_ball_point((x, y), r, return_length=True) > 0)

    counts: dict[str, int] = defaultdict(int)
    for i, p in enumerate(rows):
        if not inside[i]:
            continue
        if p[0].isdigit() and int(p[0]) >= GN_OVERLAY_ID0:
            counts["overlay row (kmz.py adds it)"] += 1           # rows pk_kmz.py added from the formation overlays
            continue
        x, y = xy[i]
        scale = 1.0 / max(math.cos(math.radians(lat[i])), 0.2)        # metres on the ground -> Web Mercator metres
        name = p[1].strip() or None
        alts = [a for a in dict.fromkeys(a.strip() for a in p[3].split(",")) if a and a != name][:10]
        pop = int(p[14]) if p[14].isdigit() and int(p[14]) > 0 else None
        ev = p[15] or p[16]
        elev = int(ev) if ev.lstrip("-").isdigit() and int(ev) > -500 else None
        code = p[6] + "." + p[7]
        if p[6] == "P":
            kind = GN_PLACE.get(p[7])
            if kind is None:
                continue
            if stree is not None and kind not in ("deserted_site", "locality"):
                d, j = stree.query((x, y), k=1, distance_upper_bound=1000.0 * scale)
                if np.isfinite(d):
                    sa = settle[j][2]
                    if SequenceMatcher(None, _norm(sa.get("n")), _norm(name)).ratio() >= 0.6:
                        extra = [a for a in [name] + alts if a and a != sa.get("n")]
                        if extra:
                            sa["an"] = ", ".join(extra)[:160]
                        sa["gn"] = int(p[0])
                        if pop and not sa.get("p"):
                            sa["p"] = pop
                        counts["matched place"] += 1
                        continue
            a = tw.point(kind, x, y, {"n": name, "an": ", ".join(alts)[:160] or None, "p": pop, "e": elev,
                                      "gn": int(p[0]), "src": "gn"})
            if kind in SETTLEMENT_KINDS:
                settle.append((x, y, a, kind))
            counts["new place"] += 1
            continue
        hit = GN_KINDS.get(code)
        if hit is None:
            continue
        kind, sub = hit
        if near_same(kind, x, y, GN_DEDUPE_M * scale):
            counts["duplicate " + kind] += 1
            continue
        tw.point(kind, x, y, {"n": name, "t": sub, "e": elev, "an": ", ".join(alts)[:160] or None, "gn": int(p[0]), "src": "gn"})
        counts[kind] += 1
    log.info("geonames: %d rows; %s", len(rows), ", ".join(f"{k} {v}" for k, v in sorted(counts.items(), key=lambda kv: -kv[1])))


def polygon_features(g: str, tw: "TileWriter", aoi) -> None:
    """Named lakes and reservoirs, named glaciers and river reaches with their bed / depth / current notes: one point each."""
    import shapely

    def centroids(layer, cols):
        gs, f = _read(g, layer, cols)
        ok = ~shapely.is_missing(gs)
        cen = np.full((len(gs), 2), np.nan)
        cen[ok] = shapely.get_coordinates(shapely.centroid(gs[ok]))
        area = np.zeros(len(gs))
        area[ok] = shapely.area(gs[ok])
        keep = ok & _in_aoi(np.nan_to_num(cen), aoi)
        lat = np.arctan(np.sinh(np.nan_to_num(cen[:, 1]) / ORIGIN_SHIFT * math.pi))
        return f, cen, area * np.cos(lat) ** 2 / 1e6, keep

    f, cen, km2, keep = centroids("Reservior", ["Category", "Name"])
    n0 = 0
    for i in np.nonzero(keep)[0]:
        cat = _s(f["Category"][i])
        name = _clean(f["Name"][i])
        if not cat.lower().startswith("lake") or (name is None and km2[i] < 0.25):
            continue
        if name and name.lower() in ("pond", "fish farm"):
            continue
        tw.point("lake", cen[i, 0], cen[i, 1], {"n": name, "t": cat.replace("_", " "), "a": round(float(km2[i]), 2)})
        n0 += 1
    log.info("features: Reservior -> %d lakes", n0)

    f, cen, km2, keep = centroids("Glacier_Polygon", ["Name"])
    n0 = 0
    for i in np.nonzero(keep)[0]:
        if _clean(f["Name"][i]):
            tw.point("glacier", cen[i, 0], cen[i, 1], {"n": _clean(f["Name"][i]), "a": round(float(km2[i]), 2)})
            n0 += 1
    log.info("features: Glacier_Polygon -> %d named glaciers", n0)

    detail = {"s": "BEDCONDITI", "dp": "DEPTH_m", "cu": "CURRENT_MS", "ws": "WETSPAN_M", "dc": "DISCHARGE_", "w": "WIDTH_m",
              "dm": "DEPTHMAX_m", "bk": "BANKHT_M"}
    f, cen, km2, keep = centroids("River_Pakmap", ["NAME"] + list(detail.values()))
    n0 = 0
    for i in np.nonzero(keep)[0]:
        a = {k: _clean(f[c][i]) for k, c in detail.items()}
        if not any(v is not None for k, v in a.items() if k != "w"):
            continue
        a["n"] = _clean(f["NAME"][i])
        tw.point("river_reach", cen[i, 0], cen[i, 1], a)
        n0 += 1
    log.info("features: River_Pakmap -> %d river reaches with detail", n0)


def assign_population(settle: list, tif: Path) -> None:
    """Share every WorldPop person (constrained; common.WORLDPOP_YEAR) out to the NEAREST named place within that
    place's radius, so nothing is counted twice; stored as `wp` (rounded to 10) on the place. A big city is split among
    the named parts inside it. A cell coarser than WP_PART_M (a 1 km file) is first split into equal parts of about
    that size, so two villages in one cell share it. Returns nothing when the raster is missing."""
    if not tif.exists() or not settle:
        log.warning("population: %s or places missing, skipped", tif)
        return
    from scipy.spatial import cKDTree

    def xyz(lon, lat):
        lon, lat = np.radians(lon), np.radians(lat)
        return np.column_stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)]) * 6371008.8

    px = np.array([[s[0], s[1]] for s in settle])
    lon = np.degrees(px[:, 0] / 6378137.0)
    lat = np.degrees(np.arctan(np.sinh(px[:, 1] / 6378137.0)))
    tree = cKDTree(xyz(lon, lat))
    radius = np.array([SETTLEMENT_KINDS[s[3]] for s in settle], dtype="float64")
    a, tr, _shape = read_people(tif)
    rr, cc = np.nonzero(a > 0)
    vals = a[rr, cc].astype("float64")
    plon = tr.c + (cc + 0.5) * tr.a
    plat = tr.f + (rr + 0.5) * tr.e
    k = max(1, round(abs(tr.a) * 111320.0 * math.cos(math.radians(float(np.mean(plat)))) / WP_PART_M)) if len(vals) else 1
    if k > 1:
        off = (np.arange(k) + 0.5) / k - 0.5
        ox, oy = np.meshgrid(off * tr.a, off * tr.e)
        plon = (plon[:, None] + ox.ravel()[None, :]).ravel()
        plat = (plat[:, None] + oy.ravel()[None, :]).ravel()
        vals = np.repeat(vals / (k * k), k * k)
    dist, idx = tree.query(xyz(plon, plat), k=1, workers=-1)
    take = dist <= radius[idx]
    total = np.bincount(idx[take], weights=vals[take], minlength=len(settle))
    n0 = 0
    for (x, y, attrs, kind), t in zip(settle, total):
        if t >= 5:
            attrs["wp"] = int(round(t / 10.0) * 10) or 10
            n0 += 1
    log.info("population: %.1f M people in the raster, %.1f M assigned to %d places (%.0f %%)", vals.sum() / 1e6,
             vals[take].sum() / 1e6, n0, 100 * vals[take].sum() / vals.sum())

    # `wp` splits a city among the named parts inside it, so towns and cities also get `wc`: everybody within a
    # fixed radius of the place (WorldPop summed on ~1 km cells), which is what "how big is this town" means.
    cell = 0.01
    ci = np.floor((plon + 180.0) / cell).astype(np.int64)
    cj = np.floor((plat + 90.0) / cell).astype(np.int64)
    key = ci * 100000 + cj
    uk, inv = np.unique(key, return_inverse=True)
    cpop = np.bincount(inv, weights=vals)
    clon = (uk // 100000 + 0.5) * cell - 180.0
    clat = (uk % 100000 + 0.5) * cell - 90.0
    ctree = cKDTree(xyz(clon, clat))
    n1 = 0
    for (x, y, attrs, kind), pt in zip(settle, xyz(lon, lat)):
        r = WITHIN_M.get(kind)
        if r is None:
            continue
        near = ctree.query_ball_point(pt, r)
        tot = float(cpop[near].sum()) if near else 0.0
        if tot >= 50:
            attrs["wc"] = int(round(tot / 100.0) * 100) or 100
            n1 += 1
    log.info("population: %d cities / towns with a within-radius total", n1)


def _in_aoi(xy: np.ndarray, aoi) -> np.ndarray:
    w, s, e, n = aoi
    x0, y0 = _merc_xy(np.array([[w, s]]))[0]
    x1, y1 = _merc_xy(np.array([[e, n]]))[0]
    return (xy[:, 0] >= x0) & (xy[:, 0] <= x1) & (xy[:, 1] >= y0) & (xy[:, 1] <= y1)


def _ground_scale(y: float) -> float:
    """Web Mercator metres per metre on the ground at Mercator y."""
    lat = 2 * math.atan(math.exp(y / ORIGIN_SHIFT * math.pi)) - math.pi / 2
    return 1.0 / max(math.cos(lat), 0.2)


def dune_fields(g: str, tw: "TileWriter", aoi) -> None:
    """Soil_Line dune lines and Soil_Point dune symbols summed per ~2 km cell, one `dune_field` point per cell:
    sp = mean spacing of the dune lines (m, = 1 / line density), or = their orientation (degrees from north, an axis
    0-179), oc = how parallel they are (0-100), dk = km of dune line per km², sd / ds = star-dune / other dune symbols."""
    import shapely
    types = ",".join(f"'{t}'" for t in DUNE_LINE_TYPES)
    gs, _f = _read(g, "Soil_Line", ["Type_Soil_Line"], where=f"Type_Soil_Line IN ({types})")
    ok = ~shapely.is_missing(gs)
    parts = shapely.get_parts(gs[ok]) if ok.any() else np.array([], dtype=object)
    cells: dict = defaultdict(lambda: np.zeros(7))      # [km, c2, s2, sum x*km, sum y*km, star, other]
    if len(parts):
        xy, idx = shapely.get_coordinates(parts, return_index=True)
        same = idx[1:] == idx[:-1]
        p0, p1 = xy[:-1][same], xy[1:][same]
        mid = (p0 + p1) / 2
        lat = np.arctan(np.sinh(mid[:, 1] / ORIGIN_SHIFT * math.pi))
        dx, dy = p1[:, 0] - p0[:, 0], p1[:, 1] - p0[:, 1]
        km = np.hypot(dx, dy) * np.cos(lat) / 1000.0
        th = np.arctan2(dx, dy)                          # bearing from north; doubled so a line and its reverse agree
        lon = np.degrees(mid[:, 0] / ORIGIN_SHIFT * math.pi)
        key = np.floor((lon + 180) / DUNE_CELL_DEG).astype(np.int64) * 100000 + np.floor((np.degrees(lat) + 90) / DUNE_CELL_DEG).astype(np.int64)
        uk, inv = np.unique(key, return_inverse=True)
        sums = [np.bincount(inv, weights=w, minlength=len(uk)) for w in
                (km, km * np.cos(2 * th), km * np.sin(2 * th), mid[:, 0] * km, mid[:, 1] * km)]
        for i, k in enumerate(uk):
            cells[int(k)][:5] = [s[i] for s in sums]
    sym = sorted(DUNE_STAR | DUNE_OTHER)
    gp, fp = _read(g, "Soil_Point", ["Type_of_Soil_Point"], where="Type_of_Soil_Point IN (" + ",".join(f"'{t}'" for t in sym) + ")")
    for geom, t in zip(gp, fp["Type_of_Soil_Point"]):
        if geom is None:
            continue
        lon, lat = merc_to_lnglat(geom.x, geom.y)
        k = int(math.floor((lon + 180) / DUNE_CELL_DEG)) * 100000 + int(math.floor((lat + 90) / DUNE_CELL_DEG))
        c = cells[k]
        c[5 if t.replace(".0", "") in DUNE_STAR else 6] += 1
    n0 = 0
    for k, c in cells.items():
        L, c2, s2, sx, sy, star, other = c
        if L < DUNE_MIN_KM and star + other < 3:
            continue
        clon = (k // 100000 + 0.5) * DUNE_CELL_DEG - 180
        clat = (k % 100000 + 0.5) * DUNE_CELL_DEG - 90
        if L >= DUNE_MIN_KM:
            x, y = sx / L, sy / L
        else:
            x, y = _merc_xy(np.array([[clon, clat]]))[0]
        if not _in_aoi(np.array([[x, y]]), aoi)[0]:
            continue
        area = (DUNE_CELL_DEG * 111.32) ** 2 * math.cos(math.radians(clat))
        a: dict = {"sd": int(star) or None, "ds": int(other) or None}
        if L >= DUNE_MIN_KM:
            dk = L / area
            a.update({"dk": round(dk, 1), "sp": int(round(1000.0 / dk / 10.0) * 10),
                      "or": int(round(math.degrees(math.atan2(s2, c2)) / 2)) % 180, "oc": int(round(100 * math.hypot(c2, s2) / L))})
        a["t"] = "star dunes" if star >= 3 and star >= other and L < DUNE_MIN_KM * 3 else "dune lines"
        tw.point("dune_field", x, y, a)
        n0 += 1
    log.info("features: Soil_Line / Soil_Point -> %d dune-field cells", n0)


def wind_arrows(g: str, tw: "TileWriter", aoi) -> None:
    """Soil_Point 16, the sheet's wind arrows, with their axis `wd` (degrees clockwise from north, 0-179).
    The NCGDB's point `Angle` turns a symbol clockwise (bridge symbols lie along their road this way: 94 % within
    15 degrees round Lahore); a wind arrow's axis = Angle (79 % of 471 arrows within 20 degrees of the local dune lines).
    The arrow symbol's own drawing is not in the geodatabase, so which end the wind blows from is not stored."""
    gp, fp = _read(g, "Soil_Point", ["Type_of_Soil_Point", "Angle"], where="Type_of_Soil_Point = '16'")
    n0 = 0
    for geom, ang in zip(gp, fp["Angle"]):
        if geom is None or not _in_aoi(np.array([[geom.x, geom.y]]), aoi)[0]:
            continue
        try:
            a = float(ang)
        except ValueError:
            continue
        tw.point("wind_arrow", geom.x, geom.y, {"wd": int(round(a)) % 180})
        n0 += 1
    log.info("features: Soil_Point 16 -> %d wind arrows", n0)


def annotation_notes(g: str, tw: "TileWriter", aoi) -> None:
    """The sheet's own text (Annotation_) that says something about the going, water, vegetation or ground:
    'Jeepable', 'Motorable in fair weather', '(Brackish)', 'Fairly dense pine', 'Scree'. One point per note at the
    text's centre; the same text of the same kind within NOTE_DEDUPE_M is kept once (labels repeat along a line)."""
    import shapely
    from scipy.spatial import cKDTree
    rules = [(k, re.compile(p)) for k, p in NOTE_RULES]
    skip = re.compile(NOTE_SKIP)
    gs, f = _read(g, "Annotation_", ["TextString"])
    ok = ~shapely.is_missing(gs)
    cen = np.full((len(gs), 2), np.nan)
    cen[ok] = shapely.get_coordinates(shapely.centroid(gs[ok]))
    keep = ok & _in_aoi(np.nan_to_num(cen), aoi)
    kept: dict = defaultdict(list)          # (kind, text) -> [(x, y)]
    counts: dict[str, int] = defaultdict(int)
    for i in np.nonzero(keep)[0]:
        raw_t = re.sub(r"\s+", " ", _s(f["TextString"][i])).strip()
        t = raw_t.lower()
        if len(t) < 3 or len(t) > 60 or skip.search(t):
            continue
        kind = next((k for k, rx in rules if rx.search(t)), None)
        if kind is None:
            continue
        x, y = cen[i]
        prev = kept[(kind, t)]
        r = NOTE_DEDUPE_M * _ground_scale(y)
        if prev and any((px - x) ** 2 + (py - y) ** 2 <= r * r for px, py in prev[-200:]):
            continue
        prev.append((x, y))
        text = raw_t.strip("() ").replace("( ", "(").replace(" )", ")")
        tw.point(kind, x, y, {"n": text[:1].upper() + text[1:]})
        counts[kind] += 1
    log.info("features: Annotation_ -> %s", ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))


# 2026-11-10: what the sheet's text (Annotation_) and a crossing's own name say about the crossing. The crossing layers
# record only the symbol (bridge, foot bridge, ferry, ford); the sheet adds the kind of bridge ("Suspension bridge",
# "Temporary wooden foot bridge"), causeways, the boats of a ferry and the months a ferry, ford or bridge of boats is
# in use. Canal names that contain "ford" / "br" (Fordwah, 8-BR minor, Chak 17-8 BR) and hotels are not crossings.
XING_SKIP = (r"\bford ?wah\b|\bfeeder\b|\bford distributary\b|\bchak \d+(-\d+)? (ford|br)\b|\b\d+[- ]?br\b|"
             r"\bbr (minor|disty)\b|\bp r\b|\bf c post\b|\bhotel\b|^br$|^bridges$")
XING_CATS = [            # first match wins: (category, pattern)
    ("boats", r"\bbridge of boats\b|\bboats? bridge\b|\bferry bridge\b"),
    ("ferry", r"\bferry\b"),
    ("causeway", r"\bcauseway\b"),
    ("viaduct", r"\bviaduct\b"),
    ("ford", r"\bford\b"),
    ("bridge", r"\bbr[ie]?dge?s?\b|\bbidge\b|\bflyover\b|\bf\.b\b|^fb$|\bsuspension\b"),
]
XING_TOKENS = [          # the words kept in `bt`, in this order
    ("temporary", r"\btemp[oa]?r[a]?a?ry\b|\btemarary\b"),
    ("suspension", r"\bs[au]s?pe[nm]s+[io]+ns?\b|\bsuspention\b"),
    ("cantilever", r"\bc[oa]n?ti?l?[ei]?ver\b"),
    ("wooden", r"\bwoo?d(en|an|ed)?\b|\bwodden\b|\blog\b"),
    ("rope", r"\brope\b|\bcradle\b"),
    ("iron", r"\biron\b"),
    ("masonry", r"\bm[ae]sonry\b"),
    ("natural", r"\bnatural\b"),
    ("snow", r"\bsnow\b"),
    ("boats", r"\bbridge of boats\b|\bboats? bridge\b|\bferry bridge\b"),
    ("overhead", r"\bover ?head\b|\bo\.? ?h\b|\bflyover\b"),
    ("underpass", r"\bunder ?pass\b"),
    ("railway", r"\brailway\b|\brly\b"),
    ("foot", r"\bfoot\b|\bf\.b\b|^fb$"),
    ("viaduct", r"\bviaduct\b"),
    ("causeway", r"\bcauseway\b"),
]
XING_STATUS = [("u/c", r"under ?construction|underconstruction"), ("disused", r"\bdisused\b")]
_MONTH = r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?"
XING_SEASON = re.compile(_MONTH + r"\s*(?:to|-|–)\s*" + _MONTH)
XING_BOATS = re.compile(r"\b(\d+|one|two|three|four|i)\s*\(?\s*boa?o?ts?\b")
XING_WORDS = {"bridge", "bridges", "brdge", "bidge", "br", "ferry", "ford", "causeway", "viaduct", "the", "and", "&", "of",
              "to", "stream", "fb", "f.b", "boat", "boats", "boots", "boot", "rs", "fall", "falls", "metre", "metres",
              "meteres", "m", "country", "road", "rd", "railway", "rly"}
# where a label may sit from its symbol (ground m): labels are set beside the symbol, median ~400 m on the sheets
XING_MATCH_M, XING_FAR_M = 600.0, 1500.0
XING_COMPAT = {
    "ferry": ("ferry", "boat_bridge"), "boats": ("boat_bridge", "ferry", "bridge"), "ford": ("ford",),
    "causeway": ("bridge", "culvert", "ford", "bridge_iron"), "viaduct": ("viaduct", "bridge"),
    "foot": ("foot_bridge", "bridge", "bridge_iron"),
    "bridge": ("bridge", "bridge_iron", "foot_bridge", "boat_bridge", "viaduct"),
}
XING_NEW_KIND = {"ferry": "ferry", "boats": "boat_bridge", "ford": "ford", "causeway": "ford", "viaduct": "viaduct",
                 "foot": "foot_bridge", "bridge": "bridge"}
XING_KINDS = ("bridge", "bridge_iron", "foot_bridge", "boat_bridge", "viaduct", "ferry", "ford", "culvert")


def parse_crossing_text(raw: str, default_cat: str | None = None) -> dict | None:
    """'Temporary wooden foot bridge' -> {cat, bt, bs, su, bo, name}; None when the text is not about a crossing.
    `default_cat` reads a crossing's own name ("Railway", "Wooden") that does not say "bridge"."""
    t = re.sub(r"\s+", " ", raw or "").strip().lower()
    if len(t) < 2 or len(t) > 60 or re.search(XING_SKIP, t):
        return None
    cat = next((c for c, p in XING_CATS if re.search(p, t)), None)
    if cat is None and default_cat and any(re.search(p, t) for _k, p in XING_TOKENS + XING_STATUS):
        cat = default_cat
    if cat is None:
        return None
    toks = [k for k, p in XING_TOKENS if re.search(p, t)]
    if cat == "bridge" and "foot" in toks and not any(k in toks for k in ("suspension", "iron", "cantilever")):
        cat = "foot"
    out = {"cat": cat, "bt": " ".join(toks) or None,
           "bs": next((s for s, p in XING_STATUS if re.search(p, t)), None)}
    m = XING_SEASON.search(t)
    out["su"] = f"{m.group(1).title()}-{m.group(2).title()}" if m else None
    b = XING_BOATS.search(t)
    if b:
        v = b.group(1)
        out["bo"] = int(v) if v.isdigit() else {"one": 1, "i": 1, "two": 2, "three": 3, "four": 4}[v]
    # a proper name is what is left once the crossing words, seasons and boats are taken out ("Jinnah bridge")
    rest = XING_SEASON.sub(" ", t)
    rest = XING_BOATS.sub(" ", rest)
    for _k, p in XING_TOKENS + XING_STATUS:
        rest = re.sub(p, " ", rest)
    words = [w for w in re.findall(r"[a-z][a-z.']*", rest) if w not in XING_WORDS]
    # the name as written outside brackets ("Jinnah bridge", "Iqbal Shahid (Suspension Bridge)" -> "Iqbal Shahid"),
    # else the bracketed one ("Viaduct (Guru Nanak)" -> "Guru Nanak")
    outside = re.sub(r"\([^)]*\)?", " ", raw)
    proper_out = [w for w in re.findall(r"[a-z][a-z.']*", outside.lower())
                  if w not in XING_WORDS and not any(re.fullmatch(p, w) for _k, p in XING_TOKENS)]
    inside = " ".join(re.findall(r"\(([^)]*)\)?", raw))
    clean = re.sub(r"\s+", " ", outside if proper_out else inside).strip(" ().")
    out["name"] = clean[:1].upper() + clean[1:] if words and clean else None
    return out


def crossing_labels(g: str, tw: "TileWriter", aoi) -> None:
    """Type, status, season and boats of the crossings, from their own names and from the sheet's text beside them.
    A label is tied to the nearest crossing of a fitting kind within XING_MATCH_M (ground) when no second one of a
    fitting kind is about as near; a label with no fitting crossing within XING_FAR_M becomes a crossing of its own
    at the label (`lb` = 1: placed at the label, a few hundred metres out); anything between is left alone rather
    than guessed. Attributes: bt (type words), bs (u/c, disused), su (months in use), bo (boats of a ferry)."""
    import shapely
    from scipy.spatial import cKDTree

    def merge(a: dict, p: dict, name_ok: bool) -> None:
        if p.get("bt"):
            have = (a.get("bt") or "").split()
            a["bt"] = " ".join(k for k, _p in XING_TOKENS if k in have or k in p["bt"].split())
        for k in ("bs", "su", "bo"):
            if p.get(k) and not a.get(k):
                a[k] = p[k]
        if name_ok and p.get("name") and not a.get("n"):
            a["n"] = p["name"]

    # 1. the crossings' own names ("Wooden bridge", "Ferry (1 boat)", "FB", "Causeway")
    own = 0
    for kind in XING_KINDS:
        for a in tw.refs.get(kind, []):
            n = a.get("n")
            if isinstance(n, str):
                p = parse_crossing_text(n, "bridge")
                if p and kind == "culvert" and p.get("bt") != "causeway":
                    continue        # a culvert symbol named "Foot bridge" / "Iron bridge": the name stays, the type is not guessed
                if p and (p.get("bt") or p.get("su") or p.get("bo") or p.get("bs")):
                    merge(a, p, False)
                    own += 1
    # 2. the sheet's text beside them
    pts, refs, kinds = [], [], []
    for kind in XING_KINDS:
        for (x, y), a in zip(tw.xy.get(kind, []), tw.refs.get(kind, [])):
            pts.append((x, y))
            refs.append(a)
            kinds.append(kind)
    tree = cKDTree(np.asarray(pts)) if pts else None
    kinds_a = np.asarray(kinds)
    gs, f = _read(g, "Annotation_", ["TextString"])
    ok = ~shapely.is_missing(gs)
    cen = np.full((len(gs), 2), np.nan)
    cen[ok] = shapely.get_coordinates(shapely.centroid(gs[ok]))
    keep = ok & _in_aoi(np.nan_to_num(cen), aoi)
    stats: dict[str, int] = defaultdict(int)
    added: dict = defaultdict(list)
    for i in np.nonzero(keep)[0]:
        p = parse_crossing_text(_s(f["TextString"][i]))
        if p is None:
            continue
        x, y = cen[i]
        sc = _ground_scale(y)
        cands = []
        if tree is not None:
            idx = tree.query_ball_point((x, y), XING_FAR_M * sc)
            compat = XING_COMPAT[p["cat"]]
            cands = sorted((float(np.hypot(pts[j][0] - x, pts[j][1] - y)) / sc, j) for j in idx if kinds_a[j] in compat)
        if cands and cands[0][0] <= XING_MATCH_M:
            d1 = cands[0][0]
            pick = cands[0][1]
            if len(cands) > 1 and cands[1][0] <= XING_MATCH_M and cands[1][0] < max(1.5 * d1, d1 + 150.0):
                # two about as near: the label's own kind settles it when only one of that kind is in reach
                # ("Foot bridge" beside a foot bridge and a road bridge)
                first = [j for d, j in cands if d <= XING_MATCH_M and kinds_a[j] == compat[0]]
                if len(first) != 1:
                    stats["ambiguous"] += 1
                    continue
                pick = first[0]
                stats["tied by kind"] += 1
            merge(refs[pick], p, True)
            stats["tied"] += 1
            continue
        if cands:
            stats["too far to tie"] += 1
            continue
        key = (p["cat"], p.get("bt"), p.get("name"))
        r = 1000.0 * sc
        if any((px - x) ** 2 + (py - y) ** 2 <= r * r for px, py in added[key]):
            stats["repeat"] += 1
            continue
        added[key].append((x, y))
        a = {k: p.get(k) for k in ("bt", "bs", "su", "bo")}
        a["n"], a["lb"] = p.get("name"), 1
        tw.point(XING_NEW_KIND[p["cat"]], x, y, a)
        stats["new at label"] += 1
    log.info("features: crossing types from own names %d; sheet text: %s", own,
             ", ".join(f"{k} {v}" for k, v in sorted(stats.items())))


def extra_ncgdb_points(g: str, tw: "TileWriter", aoi, settle: list) -> None:
    """Dam reservoirs (Reservoir_Pakmap) onto the lakes, the 74 strategic dams / headworks (HeadWorks_Pak) that
    HeadWorks_Pakmap lacks, and administrative seats (Places 1-3: province, district, tehsil HQ) onto the places."""
    import shapely
    from difflib import SequenceMatcher
    # Reservoir_Pakmap: a named dam reservoir; it names the nearest lake within 2 km, else it is added as a lake.
    gs, f = _read(g, "Reservoir_Pakmap", ["Name", "Usage", "Category", "Type_of_La"])
    n0 = n1 = 0
    for i, geom in enumerate(gs):
        if geom is None or geom.is_empty:
            continue
        c = geom.centroid
        if not _in_aoi(np.array([[c.x, c.y]]), aoi)[0]:
            continue
        name = _clean(f["Name"][i])
        sub = "dam reservoir" if _s(f["Usage"][i]).lower() == "dam" else "reservoir"
        hit = tw.nearest(["lake"], c.x, c.y, 2000 * _ground_scale(c.y))
        if hit:
            a = hit[1]
            a.setdefault("n", name) if name else None
            a["t"] = sub
            if _clean(f["Category"][i]):
                a.setdefault("s", _clean(f["Category"][i]))
            n0 += 1
        else:
            lat = math.degrees(math.atan(math.sinh(c.y / ORIGIN_SHIFT * math.pi)))
            tw.point("lake", c.x, c.y, {"n": name, "t": sub, "s": _clean(f["Category"][i]),
                                        "a": round(geom.area * math.cos(math.radians(lat)) ** 2 / 1e6, 2)})
            n1 += 1
    log.info("features: Reservoir_Pakmap -> %d lakes named as reservoirs, %d added", n0, n1)

    # HeadWorks_Pak: add the ones HeadWorks_Pakmap has no point for within 3 km.
    gs, f = _read(g, "HeadWorks_Pak", ["NAME", "CATEGORY", "STRUCTURE", "RIVER", "LENGTH_M", "WIDTH_M", "SPAN_NO", "CLASSIFICA"])
    kinds = {"dam": "dam", "h/w": "headworks", "barrage": "barrage"}
    n0 = 0
    for i, geom in enumerate(gs):
        if geom is None or not _in_aoi(np.array([[geom.x, geom.y]]), aoi)[0]:
            continue
        if tw.nearest(["dam", "barrage", "headworks"], geom.x, geom.y, 3000 * _ground_scale(geom.y)):
            continue
        kind = kinds.get(_s(f["CATEGORY"][i]).lower(), "barrage" if "barrage" in _s(f["STRUCTURE"][i]).lower() else "headworks")
        tw.point(kind, geom.x, geom.y, {"n": _clean(f["NAME"][i]), "rv": _clean(f["RIVER"][i]), "s": _clean(f["STRUCTURE"][i]),
                                        "c": _clean(f["CLASSIFICA"][i]), "lm": _clean(f["LENGTH_M"][i]),
                                        "wm": _clean(f["WIDTH_M"][i]), "sn": _clean(f["SPAN_NO"][i])})
        n0 += 1
    log.info("features: HeadWorks_Pak -> %d dams / headworks HeadWorks_Pakmap lacks", n0)

    # Places 1-3: the seat of a province, district or tehsil. Named: the place within 3 km whose name matches;
    # unnamed: the place within 1.5 km. The higher seat wins when one place gets two.
    hq_word = {"1": "province", "2": "district", "3": "tehsil"}
    rank = {"tehsil": 1, "district": 2, "province": 3}
    gs, f = _read(g, "Places", ["Type_of_Place", "Name"], where="Type_of_Place IN ('1','2','3')")
    if settle:
        from scipy.spatial import cKDTree
        tree = cKDTree(np.array([[s[0], s[1]] for s in settle]))
        n0 = 0
        for i, geom in enumerate(gs):
            if geom is None:
                continue
            hq = hq_word.get(_s(f["Type_of_Place"][i]).replace(".0", ""))
            name = _clean(f["Name"][i])
            sc = _ground_scale(geom.y)
            best = None
            for j in tree.query_ball_point((geom.x, geom.y), (3000 if name else 1500) * sc):
                sa = settle[j][2]
                d = math.hypot(settle[j][0] - geom.x, settle[j][1] - geom.y)
                if name and SequenceMatcher(None, _norm(sa.get("n")), _norm(name)).ratio() < 0.6:
                    continue
                if best is None or d < best[0]:
                    best = (d, sa)
            if best and hq and rank[hq] > rank.get(best[1].get("hq", ""), 0):
                best[1]["hq"] = hq
                n0 += 1
        log.info("features: Places -> %d places marked as province / district / tehsil seats", n0)


OSM_POINT_WHERE = ("other_tags LIKE '%\"ford\"=>\"yes\"%' OR other_tags LIKE '%\"amenity\"=>\"hospital\"%' OR "
                   "other_tags LIKE '%\"amenity\"=>\"clinic\"%' OR other_tags LIKE '%\"amenity\"=>\"doctors\"%' OR "
                   "other_tags LIKE '%\"amenity\"=>\"fuel\"%'")
OSM_LINE_WHERE = ("barrier IN ('wall','fence','city_wall','retaining_wall') OR man_made = 'pipeline' OR "
                  "other_tags LIKE '%\"power\"=>\"line\"%' OR other_tags LIKE '%\"power\"=>\"minor_line\"%' OR "
                  "other_tags LIKE '%\"ford\"=>\"yes\"%'")
OSM_AMENITY = {"hospital": ("hospital", "hospital"), "clinic": ("hospital", "clinic"), "doctors": ("hospital", "doctors"),
               "fuel": ("petrol_pump", "fuel station")}


def _tag(other: str, key: str) -> str | None:
    m = re.search(r'"' + re.escape(key) + r'"=>"([^"]*)"', other or "")
    return m.group(1) if m else None


def osm_features(pbf: Path, tw: "TileWriter", aoi) -> None:
    """OpenStreetMap: fords (points and the middle of ford lines), hospitals / clinics and fuel stations (points and
    building outlines) onto the existing kinds with src = osm, skipped within GN_DEDUPE_M of the same kind; power
    lines (v = kV), pipelines (t = substance) and walls / fences (t = barrier) as lines."""
    import shapely
    if not pbf.exists():
        log.warning("osm: %s missing, skipped", pbf)
        return
    counts: dict[str, int] = defaultdict(int)

    def add_point(kind: str, x: float, y: float, a: dict) -> None:
        if not _in_aoi(np.array([[x, y]]), aoi)[0]:
            return
        if tw.nearest([kind], x, y, GN_DEDUPE_M * _ground_scale(y)):
            counts["duplicate " + kind] += 1
            return
        tw.point(kind, x, y, {**a, "src": "osm"})
        counts[kind] += 1

    gs, f = _read(str(pbf), "points", ["name", "other_tags"], where=OSM_POINT_WHERE)
    for geom, name, other in zip(gs, f["name"], f["other_tags"]):
        if geom is None:
            continue
        if _tag(other, "ford") == "yes":
            add_point("ford", geom.x, geom.y, {"n": _clean(name)})
        am = OSM_AMENITY.get(_tag(other, "amenity") or "")
        if am:
            add_point(am[0], geom.x, geom.y, {"n": _clean(name), "t": am[1]})
    gs, f = _read(str(pbf), "multipolygons", ["name", "amenity"], where="amenity IN ('hospital','clinic','doctors','fuel')")
    for geom, name, amen in zip(gs, f["name"], f["amenity"]):
        if geom is None or geom.is_empty:
            continue
        c = geom.centroid
        am = OSM_AMENITY[amen]
        add_point(am[0], c.x, c.y, {"n": _clean(name), "t": am[1]})
    gs, f = _read(str(pbf), "lines", ["name", "barrier", "man_made", "other_tags"], where=OSM_LINE_WHERE)
    for geom, name, barrier, mm, other in zip(gs, f["name"], f["barrier"], f["man_made"], f["other_tags"]):
        if geom is None or geom.is_empty:
            continue
        if _tag(other, "ford") == "yes":
            p = geom.interpolate(0.5, normalized=True)
            add_point("ford", p.x, p.y, {"n": _clean(name)})
            continue
        simple = shapely.simplify(geom, 10.0)
        power = _tag(other, "power")
        if power in ("line", "minor_line"):
            volts = [float(v) for v in re.findall(r"\d+(?:\.\d+)?", _tag(other, "voltage") or "")]
            tw.line("power_line", simple, {"n": _clean(name), "t": "minor line" if power == "minor_line" else "power line",
                                           "v": int(round(max(volts) / 1000)) if volts and max(volts) >= 1000 else None})
            counts["power_line"] += 1
        elif mm == "pipeline":
            tw.line("pipeline", simple, {"n": _clean(name), "t": _tag(other, "substance")})
            counts["pipeline"] += 1
        elif barrier:
            tw.line("wall_fence", simple, {"t": barrier.replace("_", " ")})
            counts["wall_fence"] += 1
    log.info("osm: %s", ", ".join(f"{k} {v}" for k, v in sorted(counts.items(), key=lambda kv: -kv[1])))


OSM_PBF = Path("work/raw/osm_pakistan/pakistan.osm.pbf")


def features(gdb: Path, grid: dict, rules: dict, out: Path) -> None:
    import shapely
    aoi = grid["aoi"]
    tw = TileWriter(FEATURE_Z, aoi)
    g = str(gdb)
    tk, msr_cfg = rules["tankable"], rules.get("msr", {})

    settle: list[tuple[float, float, dict, str]] = []          # (x, y, attrs, kind) of every place, for the population share
    for rule in POINT_RULES:
        layer_name, field, kinds, attrs = rule[:4]
        named_only = rule[4] if len(rule) > 4 else set()         # type values kept only when they have a name
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
            a = {k: _clean(f[c][i]) for k, c in attrs.items()}
            if named_only and _s(f[field][i]).replace(".0", "") in named_only and not a.get("n"):
                continue
            a = tw.point(kind, cen[i, 0], cen[i, 1], a)
            if kind in SETTLEMENT_KINDS:
                settle.append((cen[i, 0], cen[i, 1], a, kind))
            n0 += 1
        log.info("features: %s -> %d points", layer_name, n0)

    # HeadWorks_Pakmap records sizes as text with units ("552 METERS", "300 ft", "6.30 Km"): to numbers (m, counts)
    for kind in ("dam", "barrage", "headworks"):
        for a in tw.refs.get(kind, []):
            for k in ("lm", "wm", "hm"):
                if k in a:
                    v = parse_len_m(a[k])
                    a.pop(k) if v is None else a.__setitem__(k, round(v))
            for k in ("gt", "sn"):
                if k in a:
                    v = parse_count(a[k])
                    a.pop(k) if v is None else a.__setitem__(k, v)
    polygon_features(g, tw, aoi)
    extra_ncgdb_points(g, tw, aoi, settle)
    if GEONAMES.exists():
        geonames_features(GEONAMES, tw, aoi, settle)
    assign_population(settle, WORLDPOP)

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

    dune_fields(g, tw, aoi)
    wind_arrows(g, tw, aoi)
    annotation_notes(g, tw, aoi)
    osm_features(OSM_PBF, tw, aoi)
    crossing_labels(g, tw, aoi)          # after every crossing source is in (NCGDB points and lines, OSM fords)

    # named lines: main roads (with load class and MSR), railways, canals, rivers
    tol = 15.0
    pcols = ["TYPE", "CLASSIFICA", "DEFENCE_RD", "WIDTH_M", "CATEGORY", "SURFACE", "NAME", "ROAD_NO",
             "CONDITION", "CLOSED_DUE", "NO_OF_SLID", "NO_OF_BRS"]
    routes = RouteIndex()
    gs, f = _read(g, "Roads_updated_2016_Pakmap", pcols)
    n0 = 0
    for i, geom in enumerate(gs):
        if geom is None:
            continue
        kind, tier, msr, a = pakmap_road({c: f[c][i] for c in pcols}, tk, msr_cfg)
        if not (msr or tier or a.get("n") or a.get("r")):
            continue
        simple = shapely.simplify(geom, tol)
        tw.line("road", simple, a)
        routes.add_road(a, geom)
        n0 += 1
    log.info("features: %d named / classed / MSR road lines", n0)
    gs, f = _read(g, "Railways_Pakmap", ["NAME", "GAUGE", "RLY_TYPE", "CATEGORY", "STATUS"])
    for i, geom in enumerate(gs):
        if geom is None:
            continue
        k = pakmap_rail({c: f[c][i] for c in f})
        rail = {"n": _clean(f["NAME"][i]), "t": k, "m": 1 if k in ("rail_bg_single", "rail_bg_double") else 0}
        tw.line("railway", shapely.simplify(geom, tol), rail)
        routes.add_rail(rail, geom)
    gs, f = _read(g, "Canal_Pakmap", ["NAME", "TYPE_OF_CA", "WIDTH_M", "DEPTH_M", "RIGHTBANKH", "LEFTBANKHT", "CATEGORY"])
    for i, geom in enumerate(gs):
        if geom is None:
            continue
        # 2026-11-11: both banks kept (the water obstacle classifier needs home vs far bank); b stays the higher one.
        # Right / left as the sheet records them, i.e. looking along the line as drawn (downstream on the NCGDB).
        br, bl = parse_width_m(f["RIGHTBANKH"][i]), parse_width_m(f["LEFTBANKHT"][i])
        bank = max([b for b in (br, bl) if b] or [0]) or None
        tw.line("canal", shapely.simplify(geom, tol), {"n": _clean(f["NAME"][i]), "t": _clean(f["TYPE_OF_CA"][i]),
                                                        "w": parse_width_m(f["WIDTH_M"][i]), "dp": parse_width_m(f["DEPTH_M"][i]),
                                                        "b": bank, "bl": bl, "br": br, "s": _clean(f["CATEGORY"][i])})
    gs, f = _read(g, "RiverLine_Pakmap", ["NAME", "TYPE_OF_RI", "CONDITION", "WIDTH_m"])
    for i, geom in enumerate(gs):
        if geom is None or not _clean(f["NAME"][i]):
            continue
        tw.line("river", shapely.simplify(geom, tol), {"n": _clean(f["NAME"][i]), "t": _clean(f["TYPE_OF_RI"][i]),
                                                        "s": _clean(f["CONDITION"][i]), "w": parse_width_m(f["WIDTH_m"][i])})
    # 2026-11-06: the topographic river lines (River_Line, mostly the north-west) with a name
    gs, f = _read(g, "River_Line", ["Name", "Usernote"])
    n0 = 0
    for i, geom in enumerate(gs):
        if geom is None or not _clean(f["Name"][i]):
            continue
        tw.line("river", shapely.simplify(geom, tol), {"n": _clean(f["Name"][i]), "t": _clean(f["Usernote"][i])})
        n0 += 1
    log.info("features: River_Line -> %d named river lines", n0)
    # Limit_Line: the outlines of water (1) and nawars (3) carry names nothing else has (nalas, mandas, nawars):
    # kept as river lines when no river / canal line already has that name; 6 = national park boundary.
    have = {_norm(ln[2].get("n")) for lst in tw.lines.values() for ln in lst
            if len(ln) > 2 and ln[0] in (KIND_CODE["river"], KIND_CODE["canal"]) and ln[2].get("n")}
    junk = {"fishfarm", "pond", "unknown", "limit", "burialground", "gravelimit", "none", "other", "lake"}
    gs, f = _read(g, "Limit_Line", ["Name", "Usernote", "Type_of_Limit_Line"], where="Type_of_Limit_Line IN ('1','3','6')")
    n0 = n1 = 0
    for i, geom in enumerate(gs):
        if geom is None:
            continue
        t = f["Type_of_Limit_Line"][i].replace(".0", "")
        name = _clean(f["Name"][i])
        if t == "6":
            tw.line("park_boundary", shapely.simplify(geom, tol), {"n": name if name and "park" not in str(name).lower() else None})
            n1 += 1
            continue
        key = _norm(name)
        if not isinstance(name, str) or len(key) < 3 or key in junk or key in have:
            continue
        note = str(_clean(f["Usernote"][i]) or "").lower()
        sub = next((w for k, w in (("river", "river"), ("strea", "stream"), ("stree", "stream"), ("nala", "nala"), ("lake", "lake"))
                    if k in note), None)
        tw.line("river", shapely.simplify(geom, tol), {"n": name, "t": "nawar (seasonal lake)" if t == "3" else sub})
        n0 += 1
    log.info("features: Limit_Line -> %d named water outlines, %d national park boundary lines", n0, n1)
    lock = load_yaml(Path("sources.lock")) if Path("sources.lock").exists() else None
    tw.sources = {     # where and when each part of the features comes from
        "NCGDB (places, roads, railways, obstacles, installations, named detail)": {
            "id": "ncgdb", "location": [str(gdb)], "dataDate": "not recorded in the geodatabase (Survey of Pakistan NCGDB Ver-6)"},
        "GeoNames (an, gn, src = gn)": source_ref(lock, "geonames_pk"),
        "OpenStreetMap (src = osm: fords, hospitals / clinics, fuel; power lines, pipelines, walls / fences)": source_ref(lock, "osm_pakistan"),
        "WorldPop (wp, wc)": source_ref(lock, "worldpop"),
    }
    n = tw.write(out / "features")
    log.info("features: %d tiles at z%d -> %s", n, FEATURE_Z, out / "features")
    routes.write(out / "routes.json")


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
        # 2026-11-06: Countries (the NCGDB's own NAME wins over CNTRY_NAME, e.g. IIOJ&K)
        ("Countries", ["NAME", "CNTRY_NAME"], lambda d, i: {"layer": "country", "name": d["NAME"][i] or d["CNTRY_NAME"][i]}),
    ):
        gs, d = read_ll(layer, cols)
        if layer == "Countries":                  # whole countries: only the part inside the bundle's AOI
            ok = ~shapely.is_missing(gs)
            gs[ok] = shapely.clip_by_rect(gs[ok], *bbox)
        feats += _geojson(gs, [mk(d, i) for i in range(len(gs))], 0.0008)
        log.info("admin: %s %d", layer, len(gs))
    (out / "admin.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")

    bdry_kinds = {"3": "international (undemarcated)", "4": "Pakistan-Afghanistan", "5": "Pakistan-China", "6": "Pakistan-India",
                  "7": "Pakistan-Iran", "21": "Line of Control", "35": "international (demarcated)", "36": "Pakistan-India (undemarcated)",
                  "37": "Pakistan-Afghanistan (undemarcated)", "9": "province", "8": "province (undemarcated)"}
    gs, d = read_ll("Boundry", ["TYPE_OF_BDRY", "Name"])
    keep = [i for i, t in enumerate(d["TYPE_OF_BDRY"]) if str(t) in bdry_kinds]
    feats = _geojson([gs[i] for i in keep], [{"layer": "boundary", "kind": bdry_kinds[str(d["TYPE_OF_BDRY"][i])], "name": d["Name"][i]} for i in keep], 0.0003)
    # 2026-11-06: the NCGDB's 80 km and 300 km lines (Trans_80KM_Line, Trans_300KM_Line), kept as sensitive lines
    for layer, kind, sens in (("LAC", "Line of Actual Control", False), ("CorpsOpsLine", "Corps operational line", True),
                              ("Political_Bdry", "political boundary", False), ("Trans_80KM_Line", "80 km line", True),
                              ("Trans_300KM_Line", "300 km line", True)):
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
    sheets["grid"] = military_grid(g)
    (out / "sheets.json").write_text(json.dumps({"format": "pams-grotbc-sheets", "note": "[sheet number, west, south, east, north] (WGS84)",
                                                 **sheets}, separators=(",", ":")), encoding="utf-8")


# The Indian grid of the 1:50k sheets (Kalianpur 1880 / India zone I and IIa, EPSG 24371 / 24372): Lambert conformal
# conic, one standard parallel, Everest 1830, metres. Mil_Grid holds its grid lines; GridLine the zone boundary.
GRID_ELLIPSOID = (6377299.36559538, 300.8017255)
GRID_K0, GRID_FE, GRID_FN = 0.99878641, 2743195.5, 914398.5
GRID_ZONES = {"I": (32.5, 68.0), "IIa": (26.0, 74.0)}


def grid_lcc(lon, lat, zone: str):
    """WGS84 lon / lat (arrays) -> (E, N) of the zone's Lambert projection, before the fitted correction."""
    a, invf = GRID_ELLIPSOID
    e = math.sqrt((2 - 1 / invf) / invf)
    p0, l0 = map(math.radians, GRID_ZONES[zone])

    def t(p):
        s = np.sin(p)
        return np.tan(np.pi / 4 - p / 2) / ((1 - e * s) / (1 + e * s)) ** (e / 2)
    n = math.sin(p0)
    F = math.cos(p0) / math.sqrt(1 - e * e * math.sin(p0) ** 2) / (n * t(p0) ** n)
    r0 = a * F * t(p0) ** n * GRID_K0
    r = a * F * t(np.radians(lat)) ** n * GRID_K0
    th = n * (np.radians(lon) - l0)
    return GRID_FE + r * np.sin(th), GRID_FN + r0 - r * np.cos(th)


def military_grid(g: str) -> dict:
    """Fit the grid to the sheets' own grid lines (Mil_Grid): each line's value (NAME) against the projection at up to
    12 of its vertices, an affine correction per zone and axis (it absorbs the datum shift, Kalianpur 1880 to WGS84).
    The browser computes the same projection plus the correction (GroundGuidePlaceData.gridAt)."""
    import pyogrio.raw as raw
    import shapely
    meta, _f, geom, data = raw.read(g, layer="Mil_Grid", columns=["NAME"])
    names = np.array([float(v) if _s(v).replace(".", "", 1).isdigit() else np.nan for v in dict(zip(meta["fields"], data))["NAME"]])
    gs = shapely.from_wkb(geom)
    xy, idx = shapely.get_coordinates(gs, return_index=True)
    cnt = np.bincount(idx, minlength=len(gs))
    starts = np.concatenate([[0], np.cumsum(cnt)[:-1]])
    take = np.zeros(len(xy), bool)
    for i in np.nonzero(cnt)[0]:
        take[starts[i] + np.unique(np.linspace(0, cnt[i] - 1, min(cnt[i], 12)).astype(int))] = True
    X, I = xy[take], idx[take]
    zones = []
    for z in GRID_ZONES:
        E, N = grid_lcc(X[:, 0], X[:, 1], z)
        fit = {}
        for ax, arr in (("E", E), ("N", N)):
            rows = []
            for i in np.unique(I):
                s = I == i
                v = names[i]
                if np.isfinite(v) and abs(np.median(arr[s]) - v) < 3000 and np.ptp(arr[s]) < 2000:
                    rows.append(np.column_stack([E[s], N[s], np.full(s.sum(), v)]))
            S = np.vstack(rows)
            M = np.column_stack([np.ones(len(S)), S[:, 0] - GRID_FE, S[:, 1] - GRID_FN])
            keep = np.ones(len(S), bool)
            for _ in range(3):
                c, *_r = np.linalg.lstsq(M[keep], S[keep, 2], rcond=None)
                res = M @ c - S[:, 2]
                keep = np.abs(res) < max(3 * res[keep].std(), 5)
            fit[ax] = {"c": [round(float(v), 9) for v in c], "rmsM": round(float(res[keep].std()), 1), "n": int(keep.sum())}
        lat0, lon0 = GRID_ZONES[z]
        zones.append({"id": z, "lat0": lat0, "lon0": lon0, "fitE": fit["E"], "fitN": fit["N"]})
        log.info("grid: zone %s fitted to the sheet grid lines, rms E %.1f m N %.1f m", z, fit["E"]["rmsM"], fit["N"]["rmsM"])
    gl, _ = _read_ll_all(g, "GridLine")
    bnd = [[round(x, 4), round(y, 4)] for x, y in shapely.get_coordinates(shapely.simplify(gl[0], 0.001))] if len(gl) else []
    return {"name": "Indian grid (Kalianpur 1880 / India zones I and IIa)", "ellipsoid": list(GRID_ELLIPSOID), "k0": GRID_K0,
            "fe": GRID_FE, "fn": GRID_FN, "zones": zones,
            "note": "E = c0 + c1 (E' - fe) + c2 (N' - fn) with fitE.c, N likewise with fitN.c, where E', N' are the Lambert conformal conic (one "
                    "parallel) of WGS84 lon / lat on the ellipsoid; c fitted to the NCGDB Mil_Grid lines. Zone I north of "
                    "`boundary` (NCGDB GridLine, GRID-I / GRID-II), IIa south of it.",
            "boundary": bnd}


def _read_ll_all(g: str, layer: str):
    import pyogrio.raw as raw
    import shapely
    meta, _f, geom, data = raw.read(g, layer=layer)
    return shapely.from_wkb(geom), dict(zip(meta["fields"], data))

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
