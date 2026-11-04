"""Step 3c — the canonical military road network (GROTBC R): ONE table that both GeoCore (route solving) and the
terrain bundle (roads on the map, the card, routes.json) read, so a road can never have one class on the map and
another in a route.

Inputs : Network.gdb `pkroads` (osm2po graph of OpenStreetMap roads that GeoCore serves: OBJECTID, ID, SOURCE /
         TARGET, KM, KMH, CLAZZ, REV_COST, OSM_NAME; EPSG:3857), the NCGDB road lines (Roads_updated_2016_Pakmap,
         Road) and bridges (Crossings_Point), work/classify/class.tif (bridge / ford classes 39-45), grid.json,
         rules.yaml (tankable, msr)
Outputs: work/network/edges.bin     one EDGE_DTYPE record per pkroads edge, ordered by OBJECTID (edge index = row)
         work/network/nodes.bin     float32 [lon, lat] per node (node index = position)
         work/network/geom.bin      float32 [lon, lat] intermediate vertices of every edge (simplified ~5 m)
         work/network/names.json    road names and numbers; edges.name / edges.rno index it (0 = none)
         work/network/network.json  schema, codebooks, rules used, statistics and the data version
         work/network/tiles/10/{x}/{y}.json   the edges for drawing: [edge index, [x0, y0, x1, y1, ...]] in tile units
         work/network/routes.json   named routes (road number, else name) aggregated from the same edges

Conflation: every OSM edge is sampled every SAMPLE_M; each sample takes the nearest NCGDB road line within MATCH_M
whose direction there agrees within ANGLE_DEG (so a cross street is never taken for the road); the edge takes the
NCGDB line most of its samples agree on, and that line's whole record (load code, road number, name, defence road,
seasonal closure, condition, landslide sites, width, surface). Crossings come from the class raster along the edge
(the WORST one counts: a class 40 bridge on a class 70 road makes the edge class 40 for a tank) and bridge names from
NCGDB Crossings_Point. An edge with no NCGDB match keeps its OSM class and says "class not recorded".
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

from common import ORIGIN_SHIFT, dump_json, load_json, load_yaml, setup_logging

log = setup_logging("network")

FORMAT_VERSION = 2
SAMPLE_M = 25.0
MATCH_M = 35.0
ANGLE_DEG = 35.0
SIMPLIFY_M = 5.0
TILE_Z = 10
QUANT = 4096
DEFAULT_NETWORK = r"D:\Projects\GeoCore\RoutingData\Network.gdb"

EDGE_DTYPE = np.dtype([
    ("oid", "<u4"), ("src", "<u4"), ("dst", "<u4"), ("km", "<f4"),
    ("kmh", "u1"), ("clazz", "u1"), ("flags", "<u2"),
    ("kind", "u1"), ("load", "u1"), ("tier", "u1"), ("xing", "u1"),
    ("close", "<u2"), ("cond", "u1"), ("slides", "u1"),
    ("width", "<u2"), ("match", "u1"), ("srcKind", "u1"),
    ("name", "<u4"), ("rno", "<u4"), ("xname", "<u4"),
    ("g0", "<u4"), ("gn", "<u2"), ("pad", "<u2"),
])
FLAG_BITS = {"oneway": 0, "msr": 1, "defence": 2, "fairWeather": 3, "matched": 4, "tankable": 5, "loadUnknown": 6,
             "closedSeasonally": 7, "landslide": 8, "narrow": 9, "transporter": 10, "limited": 11}
CROSSING = {0: "none", 1: "bridge class 60+", 2: "bridge class 50-59", 3: "bridge below class 50",
            4: "bridge, class not recorded", 5: "ford / ferry", 6: "foot bridge", 7: "railway bridge"}
# class.tif code -> (crossing code, badness for a vehicle; the edge keeps the worst)
XING_OF_CLASS = {39: (1, 1), 40: (2, 2), 41: (3, 5), 42: (4, 4), 45: (5, 3), 44: (6, 6), 43: (7, 0)}
CLAZZ = {11: "motorway", 12: "motorway link", 13: "trunk", 14: "trunk link", 15: "primary", 16: "primary link",
         21: "secondary", 22: "secondary link", 31: "tertiary", 32: "tertiary link", 41: "residential", 42: "road",
         43: "unclassified", 51: "service", 63: "track", 71: "track", 81: "path", 91: "path"}
# OSM class -> route type key (grotbc.ROUTE_TYPES) for an edge the NCGDB does not have
OSM_KIND = {11: "motorway", 12: "motorway", 13: "highway", 14: "highway", 15: "main_road", 16: "main_road",
            21: "metalled", 22: "metalled", 31: "metalled", 32: "metalled", 41: "metalled_local", 42: "metalled_local",
            43: "metalled_local", 51: "street", 63: "cart_track", 71: "cart_track", 81: "footpath", 91: "footpath"}
SRC_KIND = {0: "OSM only", 1: "NCGDB Pakmap roads", 2: "NCGDB topographic roads"}
COND = {0: None, 1: "Good", 2: "Satisfactory", 3: "Bad", 4: "Needs repair"}
MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
SNOW_MONTHS = (12, 1, 2, 3)          # "Snow" with no months: closed December to March (assumption, flagged in network.json)


def closure_mask(text: str) -> int:
    """'Jun-Oct' -> bits for Jun..Oct (bit 0 = January); 'Snow' -> Dec-Mar; unreadable -> 0."""
    t = (text or "").strip().lower()
    if not t or t in ("n", "none", "nan"):
        return 0
    found = [i for _pos, i in sorted((t.find(m), i) for i, m in enumerate(MONTHS) if m in t)]   # in text order
    mask = 0
    if len(found) >= 2 and "-" in t:
        a, b = found[0], found[-1]
        i = a
        while True:
            mask |= 1 << i
            if i == b:
                break
            i = (i + 1) % 12
    else:
        for i in found:
            mask |= 1 << i
    if not mask and "snow" in t:
        for m in SNOW_MONTHS:
            mask |= 1 << (m - 1)
    return mask


def cond_code(text: str) -> int:
    t = (text or "").strip().lower()
    if t.startswith("good"):
        return 1
    if t.startswith("satis"):
        return 2
    if t.startswith("bad"):
        return 3
    if t.startswith("req"):
        return 4
    return 0


# ----------------------------------------------------------------------------- inputs

def read_osm(gdb: str):
    import pyogrio.raw as raw
    import shapely
    cols = ["ID", "OSM_NAME", "CLAZZ", "SOURCE", "TARGET", "KM", "KMH", "REV_COST"]
    meta, fid, geom, data = raw.read(gdb, layer="pkroads", columns=cols, return_fids=True)
    d = dict(zip(meta["fields"], data))
    order = np.argsort(fid, kind="stable")
    gs = shapely.from_wkb(geom[order])
    gs = shapely.line_merge(gs)
    d = {k: np.asarray(v)[order] for k, v in d.items()}
    log.info("OSM graph: %d edges (OBJECTID %d..%d)", len(gs), int(fid.min()), int(fid.max()))
    return np.asarray(fid)[order], gs, d


def read_ncgdb(gdb: str, tk: dict, msr_cfg: dict):
    """NCGDB road lines in Web Mercator + their parsed record (grotbc's own readers, so the rules are the same)."""
    import grotbc
    lines, recs = [], []
    pcols = ["TYPE", "CLASSIFICA", "DEFENCE_RD", "WIDTH_M", "CATEGORY", "SURFACE", "NAME", "ROAD_NO", "CONDITION",
             "CLOSED_DUE", "NO_OF_SLID"]
    gs, f = grotbc._read(gdb, "Roads_updated_2016_Pakmap", pcols)
    for i, g in enumerate(gs):
        if g is None:
            continue
        row = {c: f[c][i] for c in pcols}
        kind, tier, msr, a = grotbc.pakmap_road(row, tk, msr_cfg)
        load, fair = grotbc.parse_load_class(row.get("CLASSIFICA"))
        lines.append(g)
        recs.append(dict(src=1, kind=kind, load=load, fair=fair, width=grotbc.parse_width_m(row.get("WIDTH_M")),
                         defence=grotbc._s(row.get("DEFENCE_RD")).lower() == "yes", msr=msr, name=a.get("n", ""),
                         rno=a.get("r", ""), close=closure_mask(grotbc._s(row.get("CLOSED_DUE"))),
                         cond=cond_code(grotbc._s(row.get("CONDITION"))), slides=a.get("sl") or 0))
    n1 = len(lines)
    tcols = ["Type_of_Road", "CLASSIFICATION", "DEFENCE_RD", "Name", "CONDITION", "SURFACE"]
    gs, f = grotbc._read(gdb, "Road", tcols)
    for i, g in enumerate(gs):
        if g is None:
            continue
        row = {c: f[c][i] for c in tcols}
        kind, tier, msr = grotbc.topo_road(row, tk, msr_cfg)
        load, fair = grotbc.parse_load_class(row.get("CLASSIFICATION"))
        lines.append(g)
        recs.append(dict(src=2, kind=kind, load=load, fair=fair, width=None,
                         defence=grotbc._s(row.get("DEFENCE_RD")).lower() == "yes", msr=msr,
                         name=grotbc._s(row.get("Name")), rno="", close=0,
                         cond=cond_code(grotbc._s(row.get("CONDITION"))), slides=0))
    log.info("NCGDB roads: %d Pakmap + %d topographic lines", n1, len(lines) - n1)
    return np.array(lines, dtype=object), recs


def bridge_points(gdb: str):
    import grotbc
    gs, f = grotbc._read(gdb, "Crossings_Point", ["Type_of_Crossing", "Name"])
    keep = [i for i, g in enumerate(gs) if g is not None and grotbc._s(f["Type_of_Crossing"][i]).split(".")[0] in
            ("2", "14", "7", "6", "12")]
    return gs[keep], [grotbc._clean(f["Name"][i]) for i in keep]


# ----------------------------------------------------------------------------- conflation

def _bearing(dx, dy):
    return np.degrees(np.arctan2(dy, dx)) % 180.0


def conflate(gs, lines, chunk: int = 1_500_000):
    """Per edge: index of the NCGDB line most of its aligned samples sit on (-1 none) and the matched share."""
    import shapely
    tree = shapely.STRtree(lines)
    dens = shapely.segmentize(gs, SAMPLE_M)
    xy, eidx = shapely.get_coordinates(dens, return_index=True)
    # direction of the OSM edge at each sample: towards the next vertex of the same edge (or from the previous one)
    nxt = np.roll(xy, -1, axis=0)
    same = np.roll(eidx, -1) == eidx
    prv = np.roll(xy, 1, axis=0)
    dx = np.where(same, nxt[:, 0] - xy[:, 0], xy[:, 0] - prv[:, 0])
    dy = np.where(same, nxt[:, 1] - xy[:, 1], xy[:, 1] - prv[:, 1])
    obear = _bearing(dx, dy)
    n_e = len(gs)
    total = np.bincount(eidx, minlength=n_e)
    keys = []
    for a in range(0, len(xy), chunk):
        b = min(len(xy), a + chunk)
        pts = shapely.points(xy[a:b])
        lat = np.arctan(np.sinh(xy[a:b, 1] / 6378137.0))
        # MATCH_M on the ground is MATCH_M / cos(lat) in Web Mercator; use the chunk's widest
        maxd = MATCH_M / float(np.cos(lat).min())
        (pi, ti), dist = tree.query_nearest(pts, max_distance=maxd, return_distance=True, all_matches=False)
        ok = dist * np.cos(lat[pi]) <= MATCH_M
        pi, ti = pi[ok], ti[ok]
        if len(pi):
            ln = lines[ti]
            dpos = shapely.line_locate_point(ln, pts[pi])
            p1 = shapely.get_coordinates(shapely.line_interpolate_point(ln, np.maximum(dpos - 6, 0)))
            p2 = shapely.get_coordinates(shapely.line_interpolate_point(ln, dpos + 6))
            nb = _bearing(p2[:, 0] - p1[:, 0], p2[:, 1] - p1[:, 1])
            diff = np.abs(nb - obear[a:b][pi])
            diff = np.minimum(diff, 180 - diff)
            al = diff <= ANGLE_DEG
            keys.append(eidx[a:b][pi[al]].astype(np.int64) * len(lines) + ti[al])
        log.info("  conflation: %d / %d samples", b, len(xy))
    key = np.concatenate(keys) if keys else np.zeros(0, np.int64)
    uk, cnt = np.unique(key, return_counts=True)
    ke, kl = uk // len(lines), uk % len(lines)
    o = np.lexsort((-cnt, ke))
    first = np.ones(len(o), bool)
    first[1:] = ke[o][1:] != ke[o][:-1]
    winner = np.full(n_e, -1, np.int64)
    winner[ke[o][first]] = kl[o][first]
    hits = np.bincount(ke, weights=cnt, minlength=n_e)
    share = np.where(total > 0, hits / np.maximum(total, 1), 0.0)
    return winner, share, xy, eidx


def crossings(xy, eidx, n_e, grid: dict, class_tif: Path):
    """Worst crossing code per edge from the class raster under its samples."""
    import rasterio
    from rasterio.windows import Window
    res = grid["pixel_size"]
    x0, y1 = grid["transform"][2], grid["transform"][5]
    col = np.floor((xy[:, 0] - x0) / res).astype(np.int64)
    row = np.floor((y1 - xy[:, 1]) / res).astype(np.int64)
    inside = (col >= 0) & (col < grid["width"]) & (row >= 0) & (row < grid["height"])
    ccode = np.full(len(xy), 255, np.uint8)
    order = np.argsort(row)
    srow = row[order]
    strip = 2048
    with rasterio.open(class_tif) as cs:
        for r0 in range(0, grid["height"], strip):
            a, b = np.searchsorted(srow, [r0, r0 + strip])
            sel = order[a:b]
            sel = sel[inside[sel]]
            if not len(sel):
                continue
            h = min(strip, grid["height"] - r0)
            cv = cs.read(1, window=Window(0, r0, grid["width"], h))
            ccode[sel] = cv[row[sel] - r0, col[sel]]
    worst = np.zeros(n_e, np.int16)
    xcode = np.zeros(n_e, np.uint8)
    for cls, (code, bad) in XING_OF_CLASS.items():
        e = np.unique(eidx[ccode == cls])
        if bad == 0:
            xcode[e[xcode[e] == 0]] = code
            continue
        better = bad > worst[e]
        worst[e[better]] = bad
        xcode[e[better]] = code
    return xcode


# ----------------------------------------------------------------------------- build

def build(args) -> int:
    import shapely
    from scipy.spatial import cKDTree

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import grotbc
    from derive import resolve_ncgdb

    grid = load_json(args.grid)
    rules, cfg = load_yaml(args.rules), load_yaml(args.classes)
    tk, msr_cfg = rules["tankable"], rules.get("msr", {})
    gdb, _ = resolve_ncgdb(args.ncgdb, cfg["sources"].get("ncgdb", {}).get("path"))
    out = args.out
    out.mkdir(parents=True, exist_ok=True)

    oid, gs, d = read_osm(args.network)
    n = len(gs)
    lines, recs = read_ncgdb(str(gdb), tk, msr_cfg)
    winner, share, sxy, seidx = conflate(gs, lines)
    xcode = crossings(sxy, seidx, n, grid, args.class_tif)
    del sxy, seidx

    # names and road numbers: one string table
    names = [""]
    nix = {"": 0}

    def sid(s) -> int:
        s = "" if s is None else str(s).strip()
        if s in ("None", "nan", "0"):
            s = ""
        j = nix.get(s)
        if j is None:
            j = nix[s] = len(names)
            names.append(s)
        return j

    e = np.zeros(n, dtype=EDGE_DTYPE)
    e["oid"] = oid
    clazz = d["CLAZZ"].astype(np.int64)
    e["clazz"] = clazz
    e["km"] = d["KM"].astype("float64")
    e["kmh"] = np.clip(d["KMH"].astype("float64"), 0, 255)
    e["match"] = np.rint(share * 100).astype(np.uint8)
    flags = np.zeros(n, np.uint32)
    flags |= (d["REV_COST"].astype("float64") > 1e5).astype(np.uint32) << FLAG_BITS["oneway"]
    flags |= (share >= 0.5).astype(np.uint32) << FLAG_BITS["matched"]
    min_w = float(tk.get("minWidthM", 0))
    kind = np.zeros(n, np.uint8)
    load = np.zeros(n, np.uint8)
    width = np.zeros(n, np.uint16)
    close = np.zeros(n, np.uint16)
    cond = np.zeros(n, np.uint8)
    slides = np.zeros(n, np.uint8)
    srck = np.zeros(n, np.uint8)
    nm = np.zeros(n, np.uint32)
    rn = np.zeros(n, np.uint32)
    msr_types = set(msr_cfg.get("types", []))
    for i in range(n):
        w = winner[i]
        osm_name = d["OSM_NAME"][i]
        if w >= 0 and share[i] >= 0.3:
            r = recs[w]
            k = r["kind"]
            kind[i] = grotbc.ROUTE_TYPES.get(k, 0)
            if r["load"] is not None:
                load[i] = min(int(r["load"]), 255)
            if r["width"]:
                width[i] = min(int(round(r["width"] * 10)), 65535)
            close[i], cond[i], slides[i], srck[i] = r["close"], r["cond"], min(int(r["slides"] or 0), 255), r["src"]
            f = 0
            f |= int(bool(r["msr"])) << FLAG_BITS["msr"]
            f |= int(bool(r["defence"])) << FLAG_BITS["defence"]
            f |= int(bool(r["fair"]) or k in ("unmetalled", "shingled")) << FLAG_BITS["fairWeather"]
            flags[i] |= f
            nm[i] = sid(r["name"] or osm_name)
            rn[i] = sid(r["rno"])
        else:
            k = OSM_KIND.get(int(clazz[i]), "metalled_local")
            kind[i] = grotbc.ROUTE_TYPES.get(k, 0)
            flags[i] |= int(k in msr_types) << FLAG_BITS["msr"]
            flags[i] |= int(k in ("cart_track", "footpath")) << FLAG_BITS["fairWeather"]
            nm[i] = sid(osm_name)
    # load-class tier exactly as the bundle's raster (grotbc.tier_of), then the crossing's limit
    wm = np.where(width > 0, width / 10.0, np.nan)
    tier = np.zeros(n, np.uint8)
    known = load > 0
    tier[known] = 1
    tier[known & (load >= int(tk["limitedClass"]))] = 2
    tier[known & (load >= int(tk["minClass"]))] = 3
    tier[known & np.isfinite(wm) & (wm < min_w)] = 1
    weak = np.isin(xcode, [2, 3, 4, 5, 6])
    flags |= ((tier == 3) & ~weak).astype(np.uint32) << FLAG_BITS["tankable"]
    flags |= (~known).astype(np.uint32) << FLAG_BITS["loadUnknown"]
    flags |= (close > 0).astype(np.uint32) << FLAG_BITS["closedSeasonally"]
    flags |= (slides > 0).astype(np.uint32) << FLAG_BITS["landslide"]
    flags |= (np.isfinite(wm) & (wm < min_w)).astype(np.uint32) << FLAG_BITS["narrow"]
    flags |= (known & (load >= int(tk.get("transporterClass", 70))) & ~weak).astype(np.uint32) << FLAG_BITS["transporter"]
    flags |= ((tier >= 2) & ~np.isin(xcode, [3, 4, 5, 6])).astype(np.uint32) << FLAG_BITS["limited"]
    e["flags"], e["kind"], e["load"], e["tier"], e["xing"] = flags.astype(np.uint16), kind, load, tier, xcode
    e["close"], e["cond"], e["slides"], e["width"], e["srcKind"], e["name"], e["rno"] = close, cond, slides, width, srck, nm, rn

    # bridge names: nearest NCGDB bridge point within 30 m of a bridged edge
    bpts, bnames = bridge_points(str(gdb))
    if len(bpts):
        bt = shapely.STRtree(bpts)
        bridged = np.nonzero(np.isin(xcode, [1, 2, 3, 4, 6]))[0]
        (gi, pj), dist = bt.query_nearest(gs[bridged], max_distance=40.0, return_distance=True, all_matches=False)
        for a, b in zip(gi, pj):
            if bnames[b]:
                e["xname"][bridged[a]] = sid(bnames[b])

    # nodes and geometry
    ids, inv = np.unique(np.concatenate([d["SOURCE"].astype(np.int64), d["TARGET"].astype(np.int64)]), return_inverse=True)
    e["src"], e["dst"] = inv[:n], inv[n:]
    first, last = shapely.get_point(gs, 0), shapely.get_point(gs, -1)
    nx, ny = np.full(len(ids), np.nan), np.full(len(ids), np.nan)
    nx[e["src"]], ny[e["src"]] = shapely.get_x(first), shapely.get_y(first)
    nx[e["dst"]], ny[e["dst"]] = shapely.get_x(last), shapely.get_y(last)
    lon, lat = np.degrees(nx / 6378137.0), np.degrees(np.arctan(np.sinh(ny / 6378137.0)))
    np.column_stack([lon, lat]).astype("<f4").tofile(out / "nodes.bin")
    simple = shapely.simplify(gs, SIMPLIFY_M)
    coords, cidx = shapely.get_coordinates(simple, return_index=True)
    counts = np.bincount(cidx, minlength=n)
    starts = np.concatenate([[0], np.cumsum(counts)[:-1]])
    inner = np.ones(len(coords), bool)
    inner[starts[counts > 0]] = False
    inner[(starts + counts - 1)[counts > 0]] = False
    gn = np.maximum(counts - 2, 0)
    e["g0"], e["gn"] = np.concatenate([[0], np.cumsum(gn)[:-1]]), np.minimum(gn, 65535)
    glon, glat = np.degrees(coords[inner, 0] / 6378137.0), np.degrees(np.arctan(np.sinh(coords[inner, 1] / 6378137.0)))
    np.column_stack([glon, glat]).astype("<f4").tofile(out / "geom.bin")
    e.tofile(out / "edges.bin")
    (out / "names.json").write_text(json.dumps(names, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    write_tiles(simple, out / "tiles")
    write_routes(e, gs, names, out / "routes.json")
    version = hashlib.sha256((out / "edges.bin").read_bytes()).hexdigest()[:16]
    header(e, ids, names, glon, rules, args, version, out)
    log.info("network: version %s -> %s", version, out)
    return 0


def write_tiles(simple, out: Path) -> None:
    """Each edge drawn in the z10 tile of its middle (edges are short; the few long ones overhang their tile)."""
    import shapely
    size = 2 * ORIGIN_SHIFT / 2 ** TILE_Z
    mid = shapely.get_coordinates(shapely.line_interpolate_point(simple, 0.5, normalized=True))
    tx = np.floor((mid[:, 0] + ORIGIN_SHIFT) / size).astype(np.int64)
    ty = np.floor((ORIGIN_SHIFT - mid[:, 1]) / size).astype(np.int64)
    coords, cidx = shapely.get_coordinates(simple, return_index=True)
    starts = np.concatenate([[0], np.cumsum(np.bincount(cidx, minlength=len(simple)))])
    key = tx * 100000 + ty
    order = np.argsort(key, kind="stable")
    ks = key[order]
    bounds = np.flatnonzero(np.diff(ks)) + 1
    groups = np.split(order, bounds)
    n_t = 0
    for g in groups:
        x, y = int(tx[g[0]]), int(ty[g[0]])
        minx, maxy = -ORIGIN_SHIFT + x * size, ORIGIN_SHIFT - y * size
        lines = []
        for i in g:
            c = coords[starts[i]:starts[i + 1]]
            q = np.empty((len(c), 2), np.int64)
            q[:, 0] = np.rint((c[:, 0] - minx) / size * QUANT)
            q[:, 1] = np.rint((maxy - c[:, 1]) / size * QUANT)
            lines.append([int(i), q.ravel().tolist()])
        p = out / str(TILE_Z) / str(x) / f"{y}.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"z": TILE_Z, "x": x, "y": y, "q": QUANT, "l": lines}, separators=(",", ":")), encoding="utf-8")
        n_t += 1
    log.info("tiles: %d z%d tiles", n_t, TILE_Z)


def write_routes(e, gs, names, path: Path) -> None:
    """routes.json from the canonical edges (grotbc's RouteIndex, so the format is unchanged)."""
    import grotbc
    ri = grotbc.RouteIndex()
    kinds = {v: k for k, v in grotbc.ROUTE_TYPES.items()}
    sel = np.nonzero((e["rno"] > 0) | (e["name"] > 0))[0]
    for i in sel:
        f = int(e["flags"][i])
        load = int(e["load"][i])
        a = {"n": names[e["name"][i]] or None, "r": names[e["rno"][i]] or None, "t": kinds.get(int(e["kind"][i])),
             "c": f"{load}" if load else None, "m": (f >> FLAG_BITS["msr"]) & 1,
             "x": ",".join(MONTHS[j].title() for j in range(12) if int(e["close"][i]) >> j & 1) or None,
             "cn": COND.get(int(e["cond"][i]))}
        ri.add_road({k: v for k, v in a.items() if v}, gs[i])
    ri.write(path)


def header(e, ids, names, glon, rules, args, version: str, out: Path) -> None:
    km = e["km"].astype("float64")
    fl = e["flags"].astype(np.uint32)

    def bit(name):
        return ((fl >> FLAG_BITS[name]) & 1).astype(bool)

    by = {}
    for c in sorted(set(int(v) for v in e["clazz"])):
        m = e["clazz"] == c
        by[str(c)] = {"label": CLAZZ.get(c, str(c)), "edges": int(m.sum()), "km": round(float(km[m].sum())),
                      "matchedKmPct": round(100 * float(km[m & bit("matched")].sum() / max(km[m].sum(), 1e-9)), 1),
                      "loadKnownKmPct": round(100 * float(km[m & ~bit("loadUnknown")].sum() / max(km[m].sum(), 1e-9)), 1),
                      "msrKm": round(float(km[m & bit("msr")].sum())), "tankableKm": round(float(km[m & bit("tankable")].sum()))}
    doc = {
        "format": "pams-road-network", "version": FORMAT_VERSION, "dataVersion": version,
        "source": {"graph": str(args.network), "graphLayer": "pkroads", "key": "oid = pkroads OBJECTID; edges are ordered by it",
                   "attributes": "NCGDB Roads_updated_2016_Pakmap and Road lines, conflated per edge; class raster for crossings"},
        "files": {"nodes": "nodes.bin", "edges": "edges.bin", "geom": "geom.bin", "names": "names.json",
                  "tiles": "tiles/{z}/{x}/{y}.json", "routes": "routes.json"},
        "nodes": "float32 little-endian [lon, lat] per node",
        "edge": {"bytes": EDGE_DTYPE.itemsize, "fields": [[k, str(EDGE_DTYPE.fields[k][0])] for k in EDGE_DTYPE.names],
                 "flagBits": FLAG_BITS,
                 "notes": {"load": "NCGDB military load class of the matched road, 0 = not recorded",
                           "tier": "0 not recorded, 1 below class 50 (or narrower than tankable.minWidthM), 2 class 50-59, 3 class 60+",
                           "xing": "worst crossing on the edge (codebooks.crossing)", "close": "months closed, bit 0 = January",
                           "cond": "codebooks.condition", "width": "decimetres, 0 = not recorded",
                           "kind": "route type (bundle route codebook, rules.json grotbc.layers.route.types)",
                           "match": "% of the edge's samples on an aligned NCGDB road within matchM",
                           "srcKind": "codebooks.srcKind", "name/rno/xname": "index into names.json (road name, road number, bridge name)",
                           "kmh": "graph free-flow speed (OSM class default), not a march rate",
                           "g0/gn": "first index and count of intermediate vertices in geom.bin"}},
        "codebooks": {"clazz": {str(k): v for k, v in CLAZZ.items()}, "crossing": {str(k): v for k, v in CROSSING.items()},
                      "condition": {str(k): v for k, v in COND.items() if v}, "srcKind": {str(k): v for k, v in SRC_KIND.items()}},
        "rules": {"tankable": rules.get("tankable"), "msr": rules.get("msr"), "tanks": rules.get("tanks"),
                  "snowClosure": "a closure recorded only as 'Snow' is taken as December to March"},
        "conflation": {"sampleM": SAMPLE_M, "matchM": MATCH_M, "angleDeg": ANGLE_DEG, "minShare": 0.3},
        "stats": {"edges": int(len(e)), "nodes": int(len(ids)), "km": round(float(km.sum())), "geomVertices": int(len(glon)),
                  "names": len(names) - 1, "matchedKmPct": round(100 * float(km[bit("matched")].sum() / km.sum()), 1),
                  "msrKm": round(float(km[bit("msr")].sum())), "tankableKm": round(float(km[bit("tankable")].sum())),
                  "closedSeasonallyKm": round(float(km[bit("closedSeasonally")].sum())),
                  "crossings": {CROSSING[k]: int((e["xing"] == k).sum()) for k in CROSSING if k}, "byClazz": by},
        "licence": "ODbL-1.0 (© OpenStreetMap contributors) for the graph; NCGDB-derived attributes are restricted",
    }
    dump_json(out / "network.json", doc)
    log.info("network: %d edges, %.0f km, matched %.1f %% of km, MSR %d km, tankable %d km", len(e), km.sum(),
             doc["stats"]["matchedKmPct"], doc["stats"]["msrKm"], doc["stats"]["tankableKm"])
    for c, v in by.items():
        log.info("  %-16s %8d edges %8d km  matched %5.1f %%  class known %5.1f %%  MSR %6d km  tankable %6d km",
                 v["label"], v["edges"], v["km"], v["matchedKmPct"], v["loadKnownKmPct"], v["msrKm"], v["tankableKm"])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--network", default=DEFAULT_NETWORK, help="the network geodatabase GeoCore serves (pkroads)")
    ap.add_argument("--ncgdb", help="NCGDB .gdb folder (default: classes.yaml, then $NCGDB_PATH)")
    ap.add_argument("--grid", type=Path, default=Path("work/grid/grid.json"))
    ap.add_argument("--class-tif", type=Path, default=Path("work/classify/class.tif"))
    ap.add_argument("--rules", type=Path, default=Path("rules.yaml"))
    ap.add_argument("--classes", type=Path, default=Path("classes.yaml"))
    ap.add_argument("--out", type=Path, default=Path("work/network"))
    return build(ap.parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
