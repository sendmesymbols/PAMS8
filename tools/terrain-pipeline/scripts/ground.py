"""Step 4d — G (Ground): terrain feature inventory and Important Tactical Ground (ITG) candidates.

Inputs : work/grid/grid.json, work/grid/dem.tif, work/grotbc/route.tif, work/classify/{class,cc}.tif,
         work/network/{nodes,edges,names}.bin|json, work/grotbc/vector/features/ (written by grotbc.py),
         rules.yaml `itg`, classes.yaml
Outputs: work/grotbc/vector/features/   the same tiles, with the G kinds 160-166 and 204 merged in and `ig` / `it`
                                        on the crossings, passes and tunnels that pass an ITG test (re-runnable:
                                        the step strips its own kinds and attributes first)
         work/ground/ground_inventory.gpkg   the same features in the GIS inventory schema
                                        (Feature_ID, Feature_Name, Feature_Type, ..., ITG_Status, Data_Source)
         work/ground/ground.json        counts and the thresholds used

What the DEM gives (on the DEM averaged over `itg.coarse` x `itg.coarse` pixels, ~100 m):
  peak / hill / knoll  the highest point within `peak.neighbourhoodM`, standing `peak.reliefM` (and a share of the
                       local relief) above the lowest ground within 2 km; sorted by that relief
  saddle               alternating higher / lower ground on a ring of `saddle.ringM`, both high arms rising
                       `saddle.minDepthM` within `saddle.armM`
  plateau              level ground (`plateau.maxSlopeDeg`) at least `plateau.aboveM` above the lowest ground within
                       5 km, `plateau.minAreaKm2` or more
  depression           a low point every way out of which climbs `depression.minDepthM` within 2 km
  ridgeline            crest cells (above the mean at 300 m and at 2 km, and higher than both sides on some axis)
                       joined uphill into lines of `ridge.minLengthKm` or more
and, for each point: relative relief, dominance radius, the share of the ground visible within
`viewRadiusKm`, the nearest main supply route in view, the slope round it, land cover and cover at it,
and the distance to the nearest MSR and road. Main road junctions come from the road graph.

ITG candidates: a feature that passes any of `itg.reasons` gets `ig` (the letters) and `it` (1 candidate,
2 strong). This is a property of the ground. Whether a candidate IS important or most important (MITG)
depends on the task and is decided in the app; the bundle never says so.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

from common import class_table, load_json, load_yaml, row_latitudes, setup_logging
from grotbc import FEATURE_Z, GROUND_ATTRS, GROUND_KINDS, KIND_CODE, KINDS, QUANT, TileWriter
from common import ORIGIN_SHIFT, source_ref

log = setup_logging("ground")

R_EARTH = 6371008.8
RAIL_RANKS = {8, 9, 10, 11, 12, 13}
ROAD_RANKS = set(range(14, 23))                 # street .. road tunnel (route codebook)
TRACK_RANKS = {1, 2, 3, 4, 5, 6, 7}             # footpath .. cart track
HIGHWAY_CLAZZ = {11, 12, 13, 14}                # network.json clazz: motorway, trunk (the national highways) and links
PASS_RANKS = ROAD_RANKS | {2, 3, 7}             # what makes a saddle a pass: roads, pack track, track in bed, cart track
WATER_XING = {4, 5, 20, 46, 39, 40, 41, 42}     # classes under a bridge that make it a water crossing (not a drain)
CROSSING_KINDS = {"bridge", "bridge_iron", "boat_bridge", "ferry", "ford", "viaduct", "tunnel", "barrage", "headworks", "dam"}
TYPE_LABEL = {"peak": "Peak", "hill": "Hill", "knoll": "Knoll / raised ground", "saddle": "Saddle", "plateau": "Plateau",
              "depression": "Depression", "main_junction": "Road junction", "ridgeline": "Ridge"}
SUBTYPE = {"peak": "Natural", "hill": "Natural", "knoll": "Natural", "saddle": "Natural", "plateau": "Natural",
           "depression": "Natural", "ridgeline": "Natural", "main_junction": "Transport"}

# ----------------------------------------------------------------------------- block helpers


def _read_pad(path: str, rc0: int, rr0: int, rw: int, rh: int, fill):
    """Window (col rc0, row rr0, rw x rh) of band 1, padded with `fill` where it runs off the raster."""
    import rasterio
    from rasterio.windows import Window
    with rasterio.open(path) as d:
        out = np.full((rh, rw), fill, dtype=d.dtypes[0])
        c0, r0 = max(0, rc0), max(0, rr0)
        c1, r1 = min(d.width, rc0 + rw), min(d.height, rr0 + rh)
        if c1 > c0 and r1 > r0:
            out[r0 - rr0:r1 - rr0, c0 - rc0:c1 - rc0] = d.read(1, window=Window(c0, r0, c1 - c0, r1 - r0))
        return out, d.nodata


def _filters():
    from scipy.ndimage import maximum_filter, minimum_filter, uniform_filter
    return maximum_filter, minimum_filter, uniform_filter


def _odd(n: float) -> int:
    return max(3, int(round(n)) | 1)


def _ring(rad: float, n: int = 16) -> list[tuple[int, int]]:
    """n (dy, dx) offsets on a circle of `rad` pixels, going round."""
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n
        out.append((int(round(-rad * math.sin(a))), int(round(rad * math.cos(a)))))
    return out


def _shift(a: np.ndarray, dy: int, dx: int, fill) -> np.ndarray:
    """a moved so that out[r, c] = a[r + dy, c + dx] (fill outside)."""
    out = np.full_like(a, fill)
    h, w = a.shape
    ys, yd = (slice(dy, h), slice(0, h - dy)) if dy >= 0 else (slice(0, h + dy), slice(-dy, h))
    xs, xd = (slice(dx, w), slice(0, w - dx)) if dx >= 0 else (slice(0, w + dx), slice(-dx, w))
    out[yd, xd] = a[ys, xs]
    return out


def _runs(flags: np.ndarray) -> list[tuple[int, int]]:
    """Circular runs of True in a 1-D bool array as (start, length); [] if none, [(0, n)] if all."""
    n = len(flags)
    if flags.all():
        return [(0, n)]
    if not flags.any():
        return []
    start = int(np.argmin(flags))                 # rotate so we begin on a False
    f = np.roll(flags, -start)
    out, i = [], 0
    while i < n:
        if f[i]:
            j = i
            while j < n and f[j]:
                j += 1
            out.append(((i + start) % n, j - i))
            i = j
        else:
            i += 1
    return out


def _rays(z, msr, rows, cols, z0, g, radius_px, angles, eye, curv=True):
    """View test along `angles` rays from each (row, col) out to radius_px.
    Returns (visible %, nearest MSR in view in km or nan) per origin."""
    s = np.arange(1, radius_px + 1, dtype="float32")
    th = np.linspace(0, 2 * np.pi, angles, endpoint=False, dtype="float32")
    dr = np.rint(-np.sin(th)[:, None] * s[None, :]).astype(np.int32)        # (A, S)
    dc = np.rint(np.cos(th)[:, None] * s[None, :]).astype(np.int32)
    H, W = z.shape
    vis_pct = np.full(len(rows), np.nan, dtype="float32")
    mv = np.full(len(rows), np.nan, dtype="float32")
    d_m = s * g
    drop = (d_m ** 2) / (2 * R_EARTH) * 0.87 if curv else np.zeros_like(d_m)
    for i0 in range(0, len(rows), 1500):
        r = rows[i0:i0 + 1500, None, None] + dr[None]
        c = cols[i0:i0 + 1500, None, None] + dc[None]
        inside = (r >= 0) & (r < H) & (c >= 0) & (c < W)
        rc, cc = np.clip(r, 0, H - 1), np.clip(c, 0, W - 1)
        zt = z[rc, cc]
        ok = inside & np.isfinite(zt)
        ang = (np.where(ok, zt, -1e9) - drop[None, None, :] - (z0[i0:i0 + 1500, None, None] + eye)) / d_m[None, None, :]
        run = np.maximum.accumulate(ang, axis=2)
        prev = np.concatenate([np.full(ang.shape[:2] + (1,), -np.inf, dtype=ang.dtype), run[..., :-1]], axis=2)
        vis = (ang >= prev) & ok
        wgt = s[None, None, :]
        tot = (ok * wgt).sum(axis=(1, 2))
        vis_pct[i0:i0 + 1500] = np.where(tot > 0, 100.0 * (vis * wgt).sum(axis=(1, 2)) / np.maximum(tot, 1e-6), np.nan)
        if msr is not None:
            seen = vis & msr[rc, cc]
            dist = np.where(seen, d_m[None, None, :], np.inf).min(axis=(1, 2))
            mv[i0:i0 + 1500] = np.where(np.isfinite(dist), dist / 1000.0, np.nan)
    return vis_pct, mv


def _spill(z, rows, cols, radius_px, angles=16):
    """For each origin: the lowest of the highest points met along each ray out to radius_px (the spill height)."""
    s = np.arange(1, radius_px + 1)
    th = np.linspace(0, 2 * np.pi, angles, endpoint=False)
    dr = np.rint(-np.sin(th)[:, None] * s[None, :]).astype(np.int32)
    dc = np.rint(np.cos(th)[:, None] * s[None, :]).astype(np.int32)
    H, W = z.shape
    r = rows[:, None, None] + dr[None]
    c = cols[:, None, None] + dc[None]
    inside = (r >= 0) & (r < H) & (c >= 0) & (c < W)
    zt = z[np.clip(r, 0, H - 1), np.clip(c, 0, W - 1)]
    zt = np.where(inside & np.isfinite(zt), zt, -np.inf)      # no data (sea) does not hold water in
    return zt.max(axis=2).min(axis=1)

# ----------------------------------------------------------------------------- one block


def _block(task) -> dict:
    """Features of one coarse block. Returns {'pts': [...], 'lines': [...]} in Web Mercator."""
    from scipy import ndimage

    (paths, grid, cfg, codes, cb) = task
    maxf, minf, meanf = _filters()
    F = int(cfg["coarse"])
    res = grid["pixel_size"]
    left, top = grid["bounds_3857"][0], grid["bounds_3857"][3]
    rc0, rr0, rw, rh = cb["rcol"], cb["rrow"], cb["rw"], cb["rh"]
    ox, oy, cw, ch = cb["ox"], cb["oy"], cb["w"], cb["h"]
    fr0, fc0, fw, fh = rr0 * F, rc0 * F, rw * F, rh * F
    cls, _ = _read_pad(paths["class"], fc0, fr0, fw, fh, 255)
    if (cls == 255).all():                                         # outside the bundle's boundary
        return {"pts": [], "lines": [], "stats": {}}
    zf, nod = _read_pad(paths["dem"], fc0, fr0, fw, fh, np.nan)
    zf = zf.astype("float32")
    zf[(zf < -1000) | ((zf == nod) if nod is not None else False)] = np.nan
    if not np.isfinite(zf).any():
        return {"pts": [], "lines": [], "stats": {}}
    rf, _ = _read_pad(paths["route"], fc0, fr0, fw, fh, 0)
    rf[rf == 255] = 0
    ccf, _ = _read_pad(paths["cc"], fc0, fr0, fw, fh, 255)
    inside = (cls != 255).reshape(rh, F, rw, F).any(axis=(1, 3))

    blocks = zf.reshape(rh, F, rw, F)
    with np.errstate(invalid="ignore"), __import__("warnings").catch_warnings():
        __import__("warnings").simplefilter("ignore", RuntimeWarning)
        z = np.nanmean(blocks, axis=(1, 3)).astype("float32")
    valid = np.isfinite(z)
    rank = (rf & 31)
    rmax = rf.reshape(rh, F, rw, F).max(axis=(1, 3))
    rrank = rmax & 31
    msr = ((rf & 128) > 0).reshape(rh, F, rw, F).any(axis=(1, 3)) & ~np.isin(rrank, list(RAIL_RANKS))
    road_any = np.isin(rank, list(ROAD_RANKS | TRACK_RANKS)).reshape(rh, F, rw, F).any(axis=(1, 3))
    pass_rt = np.isin(rank, list(PASS_RANKS)).reshape(rh, F, rw, F).any(axis=(1, 3))
    road = np.isin(rank, list(ROAD_RANKS)).reshape(rh, F, rw, F).any(axis=(1, 3))

    lat = float(row_latitudes(grid, (rr0 + rh // 2) * F, 1)[0])
    g = F * res * math.cos(math.radians(lat))                      # ground metres per coarse pixel
    px = lambda m: m / g                                           # noqa: E731
    lo = np.where(valid, z, 1e9)
    hi = np.where(valid, z, -1e9)
    ok = valid.astype("float32")
    zz = np.where(valid, z, 0)

    def mean_r(m):
        n = _odd(2 * px(m) + 1)
        return meanf(zz, n, mode="nearest") / np.maximum(meanf(ok, n, mode="nearest"), 1e-6)

    min2 = minf(lo, _odd(2 * px(2000) + 1), mode="nearest")
    max5 = maxf(hi, _odd(2 * px(5000) + 1), mode="nearest")
    min5 = minf(lo, _odd(2 * px(5000) + 1), mode="nearest")
    relief5 = np.where(valid, max5 - min5, 0)
    rr = np.where(valid, z - min2, 0)
    gy, gx = np.gradient(np.where(valid, z, mean_r(300)), g)
    slope = np.degrees(np.arctan(np.hypot(gx, gy))).astype("float32")
    slope300 = meanf(np.where(valid, slope, 0), _odd(2 * px(300) + 1), mode="nearest")

    core = np.zeros_like(valid)
    core[oy:oy + ch, ox:ox + cw] = True
    pts: list[dict] = []
    stats = defaultdict(int)
    ds = cfg["dsmSuspect"]
    dsm_codes = {codes[n] for n in ds["classes"] if n in codes}
    water_codes = {codes[n] for n in cfg["depression"]["excludeClasses"] if n in codes}
    # share of built-up ground round each cell: a road or a flyover inside a town is still the town's surface
    built = (cls == codes["built_up"]).reshape(rh, F, rw, F).mean(axis=(1, 3)).astype("float32")
    built = meanf(built, _odd(2 * px(ds["builtRadiusM"]) + 1), mode="nearest")
    # the surface with anything narrower than openingM (buildings, tree lines) taken off, for the spill height
    k_open = _odd(px(ds["openingM"]))
    z_open = np.where(valid, maxf(minf(lo, k_open, mode="nearest"), k_open, mode="nearest"), np.nan)

    def dsm_suspect(r, c, fr, fc, relief):
        return relief < ds["maxReliefM"] and (cls[fr, fc] in dsm_codes or built[r, c] >= ds["builtShare"])

    # distance to the nearest MSR / road (km), capped at the halo
    dist_msr = ndimage.distance_transform_edt(~msr) * g / 1000.0 if msr.any() else np.full(z.shape, np.inf)
    dist_road = ndimage.distance_transform_edt(~road_any) * g / 1000.0 if road_any.any() else np.full(z.shape, np.inf)
    cap = min(5.0, cb["halo"] * g / 1000.0)

    def fine_xy(r, c, pick_max=False):
        """Web Mercator x, y and the full-resolution pixel of coarse cell (r, c) (its highest pixel if pick_max)."""
        if pick_max:
            b = blocks[r, :, c, :]
            if np.isfinite(b).any():
                k = int(np.nanargmax(b))
                fr, fc = r * F + k // F, c * F + k % F
            else:
                fr, fc = r * F + F // 2, c * F + F // 2
        else:
            fr, fc = r * F + F // 2, c * F + F // 2
        x = left + ((rc0 * F) + fc + 0.5) * res
        y = top - ((rr0 * F) + fr + 0.5) * res
        return x, y, fr, fc

    def attrs(r, c, fr, fc, elev):
        a = {"e": int(round(elev)), "rr": int(round(float(rr[r, c]))), "sp": round(float(slope300[r, c]), 1),
             "lc": int(cls[fr, fc]) if cls[fr, fc] != 255 else None,
             "cv": int(ccf[fr, fc]) if ccf[fr, fc] != 255 else None, "src": "dem"}
        if dist_msr[r, c] <= cap:
            a["dr"] = round(float(dist_msr[r, c]), 1)
        if dist_road[r, c] <= cap:
            a["dn"] = round(float(dist_road[r, c]), 1)
        return a

    # ---------------------------------------------------------------- peaks / hills / knolls
    p = cfg["peak"]
    top_mask = valid & (hi >= maxf(hi, _odd(2 * px(p["neighbourhoodM"]) + 1), mode="nearest") - 1e-3)
    top_mask &= (rr >= p["reliefM"]) & (rr >= p["reliefShare"] * relief5)
    lab, n = ndimage.label(top_mask, structure=np.ones((3, 3)))
    cand = []
    if n:
        idx = ndimage.maximum_position(np.where(valid, z, -1e9), lab, index=np.arange(1, n + 1))
        for (r, c) in idx:
            if core[r, c]:
                cand.append((r, c))
    iso_r = [1, 2, 3, 5]
    iso_tops = {k: hi >= maxf(hi, _odd(2 * px(k * 1000) + 1), mode="nearest") - 1e-3 for k in iso_r}
    peaks = []
    for r, c in cand:
        x, y, fr, fc = fine_xy(r, c, pick_max=True)
        relief = float(rr[r, c])
        if dsm_suspect(r, c, fr, fc, relief):
            stats["dsm_dropped"] += 1
            continue
        kind = "peak" if relief >= p["mountainM"] else "hill" if relief >= p["hillM"] else "knoll"
        a = attrs(r, c, fr, fc, float(np.nanmax(blocks[r, :, c, :])))
        iso = 0.5
        for k in iso_r:
            if iso_tops[k][r, c]:
                iso = k
        a["iso"] = iso
        if kind == "knoll" and iso < p["knollDominanceKm"]:          # dune fields: every crest is a rise
            stats["knoll_minor"] += 1
            continue
        peaks.append((r, c))
        pts.append({"kind": kind, "x": x, "y": y, "a": a})
        stats[kind] += 1

    # ---------------------------------------------------------------- saddles
    s = cfg["saddle"]
    ring1 = _ring(px(s["ringM"]))
    above = np.stack([_shift(hi, dy, dx, -1e9) > z for dy, dx in ring1])
    changes = (above != np.roll(above, -1, axis=0)).sum(axis=0)
    ring2 = _ring(px(s["armM"]))
    arm = np.stack([_shift(np.where(valid, z, np.nan), dy, dx, np.nan) for dy, dx in ring2])
    with __import__("warnings").catch_warnings():
        __import__("warnings").simplefilter("ignore", RuntimeWarning)
        arm_max = np.nanmax(arm, axis=0)
    sad = valid & core & (changes >= 4) & (relief5 >= s["minLocalReliefM"]) & (arm_max - z >= s["minDepthM"])
    lab, n = ndimage.label(sad, structure=np.ones((3, 3)))
    if n:
        idx = ndimage.minimum_position(slope, lab, index=np.arange(1, n + 1))
        for (r, c) in idx:
            v = arm[:, r, c]
            if not np.isfinite(v).all():
                continue
            z0 = float(z[r, c])
            need = max(s["minDepthM"], s["depthShare"] * float(relief5[r, c]))
            highs = _runs(v > z0 + need)
            lows = _runs(v < z0)
            if len(highs) < 2 or len(lows) < 2:
                continue
            arms = sorted((float(np.max(np.roll(v, -st)[:ln])) for st, ln in highs), reverse=True)
            x, y, fr, fc = fine_xy(r, c)
            a = attrs(r, c, fr, fc, z0)
            a["dp"] = int(round(arms[1] - z0))                      # the lower of the two high arms
            a.pop("rr", None)
            k_ = max(1, int(round(px(cfg["reasons"]["P"]["roadM"]))))
            pts.append({"kind": "saddle", "x": x, "y": y, "a": a, "_rc": (r, c),
                        "_road": bool(pass_rt[max(0, r - k_):r + k_ + 1, max(0, c - k_):c + k_ + 1].any())})
    # keep the deepest saddle within 1 km
    sad_i = [i for i, f in enumerate(pts) if f["kind"] == "saddle"]
    if sad_i:
        from scipy.spatial import cKDTree
        rc = np.array([pts[i]["_rc"] for i in sad_i], dtype="float64")
        dep = np.array([pts[i]["a"]["dp"] for i in sad_i])
        tree = cKDTree(rc)
        drop = set()
        for j in np.argsort(-dep):
            if sad_i[j] in drop:
                continue
            for k in tree.query_ball_point(rc[j], px(1000)):
                if k != j:
                    drop.add(sad_i[k])
        pts = [f for i, f in enumerate(pts) if i not in drop]
        stats["saddle"] += len(sad_i) - len(drop)

    # ---------------------------------------------------------------- plateaus
    q = cfg["plateau"]
    flat = valid & (slope < q["maxSlopeDeg"]) & (z - min5 >= q["aboveM"])
    lab, n = ndimage.label(flat, structure=np.ones((3, 3)))
    if n:
        areas = ndimage.sum(np.ones_like(z), lab, index=np.arange(1, n + 1)) * g * g / 1e6
        coms = ndimage.center_of_mass(np.ones_like(z), lab, index=np.arange(1, n + 1))
        means = ndimage.mean(np.where(valid, z, 0), lab, index=np.arange(1, n + 1))
        for i, (area, (cr, cc_), mz) in enumerate(zip(areas, coms, means)):
            if area < q["minAreaKm2"]:
                continue
            r, c = int(round(cr)), int(round(cc_))
            if not (0 <= r < rh and 0 <= c < rw) or lab[r, c] != i + 1:
                rs, cs = np.nonzero(lab == i + 1)
                k = int(np.argmin((rs - cr) ** 2 + (cs - cc_) ** 2))
                r, c = int(rs[k]), int(cs[k])
            if not core[r, c]:
                continue
            x, y, fr, fc = fine_xy(r, c)
            a = attrs(r, c, fr, fc, float(mz))
            a["rr"] = int(round(float(mz - min5[r, c])))
            a["a"] = round(float(area), 1)
            pts.append({"kind": "plateau", "x": x, "y": y, "a": a})
            stats["plateau"] += 1

    # ---------------------------------------------------------------- depressions
    dq = cfg["depression"]
    low = valid & core & (lo <= minf(lo, _odd(2 * px(1000) + 1), mode="nearest") + 1e-3)
    lab, n = ndimage.label(low, structure=np.ones((3, 3)))
    if n:
        idx = np.array(ndimage.minimum_position(lo, lab, index=np.arange(1, n + 1)), dtype=np.int64).reshape(-1, 2)
        if len(idx):
            spill = _spill(z_open, idx[:, 0], idx[:, 1], int(round(px(2000))))
            depth = spill - z[idx[:, 0], idx[:, 1]]
            for (r, c), dp in zip(idx, depth):
                if not np.isfinite(dp) or dp < dq["minDepthM"]:
                    continue
                x, y, fr, fc = fine_xy(int(r), int(c))
                if cls[fr, fc] in water_codes or dsm_suspect(r, c, fr, fc, float(dp)):
                    stats["dsm_dropped"] += 1
                    continue
                a = attrs(int(r), int(c), fr, fc, float(z[r, c]))
                a.pop("rr", None)
                a["dp"] = int(round(float(dp)))
                pts.append({"kind": "depression", "x": x, "y": y, "a": a})
                stats["depression"] += 1

    # ---------------------------------------------------------------- view test for the high features
    hi_idx = [i for i, f in enumerate(pts) if f["kind"] in ("peak", "hill", "knoll", "saddle", "plateau")]
    if hi_idx:
        rcs = []
        for i in hi_idx:
            f = pts[i]
            fr = int(round((top - f["y"]) / res - 0.5)) - rr0 * F
            fc = int(round((f["x"] - left) / res - 0.5)) - rc0 * F
            rcs.append((fr // F, fc // F))
        rcs = np.array(rcs, dtype=np.int64)
        z0 = z[rcs[:, 0], rcs[:, 1]]
        vs, mv = _rays(z, msr, rcs[:, 0], rcs[:, 1], z0, g, int(round(px(cfg["viewRadiusKm"] * 1000))), 72,
                       float(cfg["eyeHeightM"]))
        for i, v, m in zip(hi_idx, vs, mv):
            if np.isfinite(v):
                pts[i]["a"]["vs"] = int(round(float(v)))
            if np.isfinite(m):
                pts[i]["a"]["mv"] = round(float(m), 1)

    # ---------------------------------------------------------------- ridgelines
    rg = cfg["ridge"]
    lines = []
    m300, m2k = mean_r(300), mean_r(2000)
    step = max(1, int(round(px(200))))
    axis_max = np.zeros_like(valid)
    for dy, dx in ((0, step), (step, 0), (step, step), (step, -step)):
        a1 = _shift(hi, dy, dx, -1e9)
        a2 = _shift(hi, -dy, -dx, -1e9)
        axis_max |= (z > a1 + 1) & (z > a2 + 1)
    crest = valid & inside & axis_max & (z - m300 >= rg["crestM"]) & (z - m2k >= rg["crestWideM"]) & (relief5 >= rg["minLocalReliefM"])
    if crest.any():
        lines = _trace_ridges(crest, z, g, rg["minLengthKm"], core)
        out = []
        for chain in lines:
            rs = np.array([p_[0] for p_ in chain])
            cs = np.array([p_[1] for p_ in chain])
            xs = left + ((rc0 + cs) * F + F / 2) * res
            ys = top - ((rr0 + rs) * F + F / 2) * res
            zc = z[rs, cs]
            out.append({"kind": "ridgeline", "xy": np.column_stack([xs, ys]),
                        "a": {"e": int(round(float(np.nanmax(zc)))), "lk": round(len(chain) * g / 1000.0, 1), "src": "dem"}})
            stats["ridgeline"] += 1
        lines = out
    pts = [f for f in pts if f["a"].get("lc") is not None]     # class nodata = outside the boundary
    for f in pts:
        f.pop("_rc", None)
    return {"pts": pts, "lines": lines, "stats": dict(stats)}


def _trace_ridges(crest: np.ndarray, z: np.ndarray, g: float, min_km: float, core: np.ndarray) -> list[list[tuple]]:
    """Join crest cells uphill: each cell steps to its highest crest neighbour above it. Where branches meet the
    longest carries on; a chain ends at the top. Returns chains of (row, col) at least min_km long that start in
    the core."""
    H, W = crest.shape
    rs, cs = np.nonzero(crest)
    if not len(rs):
        return []
    zc = np.where(crest, z, -np.inf)
    best = np.full(len(rs), -np.inf)
    succ = np.full((len(rs), 2), -1, dtype=np.int64)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy == 0 and dx == 0:
                continue
            r2, c2 = rs + dy, cs + dx
            ok = (r2 >= 0) & (r2 < H) & (c2 >= 0) & (c2 < W)
            v = np.full(len(rs), -np.inf)
            v[ok] = zc[r2[ok], c2[ok]]
            take = (v > z[rs, cs]) & (v > best)
            best[take] = v[take]
            succ[take, 0], succ[take, 1] = r2[take], c2[take]
    flat = rs * W + cs
    pos = {int(k): i for i, k in enumerate(flat)}
    nxt = np.array([pos.get(int(r * W + c), -1) if r >= 0 else -1 for r, c in succ], dtype=np.int64)
    # longest uphill branch into each cell (cells in rising order, so every lower neighbour is done first);
    # at a merge only that branch carries on, the others end on the merge cell
    run = np.ones(len(rs), dtype=np.int64)
    main = np.full(len(rs), -1, dtype=np.int64)
    for n_ in np.argsort(z[rs, cs], kind="stable"):
        s_ = nxt[n_]
        if s_ >= 0 and run[n_] + 1 > run[s_]:
            run[s_] = run[n_] + 1
            main[s_] = n_
    min_cells = min_km * 1000.0 / g
    chains = []
    for s0 in np.nonzero(main < 0)[0]:
        chain, cur = [s0], s0
        while nxt[cur] >= 0:
            s_ = nxt[cur]
            chain.append(s_)
            if main[s_] != cur:
                break
            cur = s_
        if len(chain) >= min_cells and core[rs[chain[0]], cs[chain[0]]]:
            chains.append([(int(rs[i]), int(cs[i])) for i in chain])
    return chains

# ----------------------------------------------------------------------------- whole country


def _coarse_blocks(grid: dict, F: int, block: int, halo: int):
    W, H = grid["width"] // F, grid["height"] // F
    for row in range(0, H, block):
        for col in range(0, W, block):
            w, h = min(block, W - col), min(block, H - row)
            rcol, rrow = col - halo, row - halo
            yield dict(col=col, row=row, w=w, h=h, rcol=rcol, rrow=rrow, rw=w + 2 * halo, rh=h + 2 * halo,
                       ox=halo, oy=halo, halo=halo)


def run_blocks(paths: dict, grid: dict, cfg: dict, codes: dict, block: int, workers: int, aoi=None) -> tuple[list, list, dict]:
    from concurrent.futures import ProcessPoolExecutor
    F = int(cfg["coarse"])
    lat_n = max(abs(grid["aoi"][1]), abs(grid["aoi"][3]))
    g_min = F * grid["pixel_size"] * math.cos(math.radians(lat_n))
    halo = int(math.ceil(cfg["viewRadiusKm"] * 1000 / g_min)) + 4
    tasks = []
    for cb in _coarse_blocks(grid, F, block, halo):
        if aoi is not None:
            left, top, res = grid["bounds_3857"][0], grid["bounds_3857"][3], grid["pixel_size"] * F
            x0, x1 = left + cb["col"] * res, left + (cb["col"] + cb["w"]) * res
            y1, y0 = top - cb["row"] * res, top - (cb["row"] + cb["h"]) * res
            if x1 < aoi[0] or x0 > aoi[2] or y1 < aoi[1] or y0 > aoi[3]:
                continue
        tasks.append((paths, grid, cfg, codes, cb))
    log.info("ground: %d coarse blocks of %d px (x%d), halo %d px, %d workers", len(tasks), block, F, halo, workers)
    pts, lines, stats = [], [], defaultdict(int)
    done = 0
    with ProcessPoolExecutor(workers) as pool:
        for res in pool.map(_block, tasks, chunksize=1):
            pts += res["pts"]
            lines += res["lines"]
            for k, v in res["stats"].items():
                stats[k] += v
            done += 1
            if done % 20 == 0 or done == len(tasks):
                log.info("  blocks %d/%d: %s", done, len(tasks), dict(stats))
    return pts, lines, dict(stats)

# ----------------------------------------------------------------------------- road junctions


def junctions(network: Path, cfg: dict) -> list[dict]:
    """Nodes where three or more main-road edges meet (motorway / trunk / primary or an MSR edge), merged within mergeM."""
    from scipy.spatial import cKDTree
    meta = load_json(network / "network.json")
    nodes = np.fromfile(network / "nodes.bin", dtype="<f4").reshape(-1, 2)
    dt = np.dtype([(n, {"uint32": "<u4", "float32": "<f4", "uint8": "u1", "uint16": "<u2"}[t]) for n, t in meta["edge"]["fields"]])
    e = np.fromfile(network / "edges.bin", dtype=dt)
    names = load_json(network / "names.json")
    names = names if isinstance(names, list) else names.get("names", [])
    main = np.isin(e["clazz"], cfg["junction"]["clazz"]) | ((e["flags"] & 2) > 0)
    em = e[main]
    ends = np.concatenate([em["src"], em["dst"]])
    deg = np.bincount(ends, minlength=len(nodes))
    j = np.nonzero(deg >= 3)[0]
    if not len(j):
        return []
    lon, lat = nodes[j, 0].astype("float64"), nodes[j, 1].astype("float64")
    x = np.radians(lon) * 6378137.0
    y = np.log(np.tan(np.pi / 4 + np.radians(lat) / 2)) * 6378137.0
    scale = 1.0 / np.cos(np.radians(lat))
    tree = cKDTree(np.column_stack([x, y]))
    pairs = tree.query_pairs(cfg["junction"]["mergeM"] * float(scale.mean()))
    parent = np.arange(len(j))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for a, b in pairs:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    groups = defaultdict(list)
    for i in range(len(j)):
        groups[find(i)].append(i)
    # names / MSR / class of the main edges at each node
    at = defaultdict(list)
    for k in range(len(em)):
        at[int(em["src"][k])].append(k)
        at[int(em["dst"][k])].append(k)
    label = {11: "motorway", 12: "motorway", 13: "trunk road", 14: "trunk road", 15: "primary road", 16: "primary road"}
    out = []
    def directions(bearings: list[float], tol: float = 50.0) -> int:
        """Distinct ways out: bearings closer than tol degrees are one way (a dual carriageway is one road)."""
        if not bearings:
            return 0
        b = sorted(bearings)
        gaps = [(b[(i + 1) % len(b)] - b[i]) % 360 or (360 if len(b) == 1 else 0) for i in range(len(b))]
        return max(1, sum(1 for gp in gaps if gp > tol))

    for members in groups.values():
        nodes_in = {int(j[i]) for i in members}
        ks = list(dict.fromkeys(k for n_ in nodes_in for k in at[n_]))
        cx, cy = float(lon[members].mean()), float(lat[members].mean())
        out_main, out_hwy, msr = [], [], False
        for k in ks:
            s_, d_ = int(em["src"][k]), int(em["dst"][k])
            if (s_ in nodes_in) == (d_ in nodes_in):              # inside the interchange
                continue
            far = d_ if s_ in nodes_in else s_
            brg = math.degrees(math.atan2((nodes[far, 0] - cx) * math.cos(math.radians(cy)), nodes[far, 1] - cy)) % 360
            out_main.append(brg)
            msr |= bool(em["flags"][k] & 2)
            if int(em["clazz"][k]) in HIGHWAY_CLAZZ:
                out_hwy.append(brg)
        n_main = directions(out_main)
        if n_main < 3:                                             # a bend or a carriageway split, not a junction
            continue
        nm = []
        for k in ks:
            ni = int(em["name"][k])
            if 0 <= ni < len(names) and names[ni] and names[ni] not in nm:
                nm.append(names[ni])
        top_cls = min(int(em["clazz"][k]) for k in ks)
        a = {"n": " / ".join(nm[:3]) or None, "t": ("interchange" if len(members) > 2 else "junction") + ", " + label.get(top_cls, "main road"),
             "m": 1 if msr else None, "mx": directions(out_hwy) or None, "src": "osm"}
        out.append({"kind": "main_junction", "x": float(x[members].mean()), "y": float(y[members].mean()), "a": a})
    log.info("junctions: %d main-road nodes of degree 3+ -> %d junctions", len(j), len(out))
    return out

# ----------------------------------------------------------------------------- merge into features/


def _tile_xy(tx, ty, q):
    size = 2 * ORIGIN_SHIFT / 2 ** FEATURE_Z
    return (-ORIGIN_SHIFT + tx * size + q[0] / QUANT * size, ORIGIN_SHIFT - ty * size - q[1] / QUANT * size)


def load_features(feat: Path) -> dict:
    """All tiles of features/ as {(tx, ty): obj}, with the G kinds and ITG attributes this step adds removed."""
    tiles = {}
    for p in (feat / str(FEATURE_Z)).glob("*/*.json"):
        obj = json.loads(p.read_text(encoding="utf-8"))
        obj["p"] = [pt for pt in obj.get("p", []) if pt[0] not in GROUND_KINDS]
        for pt in obj["p"]:
            if len(pt) > 3:
                pt[3].pop("ig", None)
                pt[3].pop("it", None)
                if not pt[3]:
                    del pt[3]
        obj["l"] = [ln for ln in obj.get("l", []) if ln[0] not in GROUND_KINDS]
        tiles[(obj["x"], obj["y"])] = obj
    return tiles


def existing_points(tiles: dict, kinds: set[str]) -> dict[str, list]:
    """kind -> [(x, y, attrs-dict-ref), ...] for the existing points of those kinds."""
    codes = {KIND_CODE[k]: k for k in kinds}
    out = defaultdict(list)
    for (tx, ty), obj in tiles.items():
        for pt in obj["p"]:
            k = codes.get(pt[0])
            if k is None:
                continue
            x, y = _tile_xy(tx, ty, (pt[1], pt[2]))
            if len(pt) < 4:
                pt.append({})
            out[k].append((x, y, pt[3]))
    return out


def sample_route_at(route_tif: Path, grid: dict, xy: np.ndarray, radius_px: int, among: set | None = None) -> np.ndarray:
    """Route code max within radius_px of each Web Mercator point (0 outside). With `among`, the raster is read as
    a class raster and the result is 1 where any of those codes lies within radius_px."""
    import rasterio
    from rasterio.windows import Window
    from scipy.ndimage import maximum_filter
    res = grid["pixel_size"]
    x0, y1 = grid["bounds_3857"][0], grid["bounds_3857"][3]
    col = np.floor((xy[:, 0] - x0) / res).astype(np.int64)
    row = np.floor((y1 - xy[:, 1]) / res).astype(np.int64)
    out = np.zeros(len(xy), dtype=np.uint8)
    inside = (col >= 0) & (col < grid["width"]) & (row >= 0) & (row < grid["height"])
    order = np.argsort(row)
    srow = row[order]
    strip = 2048
    with rasterio.open(route_tif) as rs:
        for r0 in range(0, grid["height"], strip):
            a, b = np.searchsorted(srow, [r0, r0 + strip])
            sel = order[a:b]
            sel = sel[inside[sel]]
            if not len(sel):
                continue
            rr0 = max(0, r0 - radius_px)
            rh = min(grid["height"], r0 + strip + radius_px) - rr0
            v = rs.read(1, window=Window(0, rr0, grid["width"], rh))
            v = np.isin(v, list(among)).astype(np.uint8) if among is not None else np.where(v == 255, 0, v)
            # max of the MSR bit and of the type rank separately would need two filters; MAX of the code keeps MSR roads
            v = maximum_filter(v, size=2 * radius_px + 1)
            out[sel] = v[row[sel] - rr0, col[sel]]
    return out


def itg_reasons(f: dict, rcfg: dict) -> str:
    a, k = f["a"], f["kind"]
    out = ""
    if k in ("peak", "hill", "knoll", "plateau") and a.get("iso", 0) >= rcfg["H"]["dominanceKm"]:
        out += "H"
    if a.get("vs") is not None and a["vs"] >= rcfg["O"]["viewPct"] and k != "depression":
        out += "O"
    if a.get("mv") is not None and a["mv"] <= rcfg["R"]["routeViewKm"]:
        out += "R"
    if f.get("_road"):
        out += "P"
    if f.get("_choke"):
        out += "C"
    if k == "main_junction" and a.get("m"):
        out += "J"
    return out


def strength(letters: str, scfg: dict, a: dict | None = None) -> int:
    if not letters:
        return 0
    if len(letters) >= scfg["minReasons"] or any(all(x in letters for x in pair) for pair in scfg["pairs"]):
        return 2
    if "J" in letters and a is not None and (a.get("mx") or 0) >= scfg.get("junctionHighwayWays", 3):
        return 2
    return 1


def name_features(pts: list, ex: dict) -> None:
    """Names from GeoNames / NCGDB named terrain within reach; surveyed heights from trig stations / spot heights."""
    from scipy.spatial import cKDTree

    def tree(kinds):
        rows = [(x, y, a) for k in kinds for (x, y, a) in ex.get(k, [])]
        if not rows:
            return None, []
        return cKDTree(np.array([[r[0], r[1]] for r in rows])), rows
    t_mtn, r_mtn = tree(["mountain", "landform_name"])
    t_pass, r_pass = tree(["pass"])
    t_hs, r_hs = tree(["trig_station", "spot_height"])
    for f in pts:
        sc = 1.0 / max(math.cos(2 * math.atan(math.exp(f["y"] / 6378137.0)) - math.pi / 2), 0.2)
        if f["kind"] in ("peak", "hill", "knoll", "plateau", "ridgeline_pt"):
            if t_mtn is not None:
                d, i = t_mtn.query((f["x"], f["y"]), distance_upper_bound=1500 * sc)
                if np.isfinite(d) and r_mtn[i][2].get("n"):
                    f["a"]["n"] = r_mtn[i][2]["n"]
            if t_hs is not None:
                d, i = t_hs.query((f["x"], f["y"]), distance_upper_bound=250 * sc)
                if np.isfinite(d):
                    for key in ("e", "n"):                     # the NCGDB Heights layer keeps the height in Name
                        try:
                            f["a"]["hs"] = int(round(float(r_hs[i][2][key])))
                            break
                        except (KeyError, TypeError, ValueError):
                            continue
        elif f["kind"] == "saddle" and t_pass is not None:
            d, i = t_pass.query((f["x"], f["y"]), distance_upper_bound=1000 * sc)
            if np.isfinite(d):
                if r_pass[i][2].get("n"):
                    f["a"]["n"] = r_pass[i][2]["n"]
                f["a"]["t"] = "pass"


def merge(feat: Path, tiles: dict, pts: list, lines: list, flagged: int) -> dict:
    tw = TileWriter(FEATURE_Z, (-180, -85, 180, 85))
    for obj in tiles.values():
        obj["p"] = [pt[:3] if len(pt) > 3 and not pt[3] else pt for pt in obj["p"]]
    for (tx, ty), obj in tiles.items():
        tw.points[(tx, ty)] = obj["p"]
        tw.lines[(tx, ty)] = obj["l"]
    old = load_json(feat / "index.json")
    counts = {int(k): v["count"] for k, v in old["kinds"].items() if int(k) not in GROUND_KINDS}
    for f in pts:
        tw.point(f["kind"], f["x"], f["y"], f["a"])
    for ln in lines:
        import shapely
        tw.line("ridgeline", shapely.simplify(shapely.LineString(ln["xy"]), 40.0), ln["a"])
    for k, v in tw.counts.items():
        counts[k] = counts.get(k, 0) + v if k not in GROUND_KINDS else v
    # write the tiles (TileWriter.write rewrites index.json; restore the counts of the untouched kinds)
    n = tw.write(feat)
    idx = load_json(feat / "index.json")
    for k, v in idx["kinds"].items():
        v["count"] = counts.get(int(k), 0)
    lock = load_yaml(Path("sources.lock")) if Path("sources.lock").exists() else None
    idx["sources"] = dict(old.get("sources") or {}, **{
        "Copernicus DEM (kinds 160-165, 204)": source_ref(lock, "glo30"),
        "OSM road graph (kind 166 junctions)": source_ref(lock, "osm_network")})
    idx["itg"] = {"note": "ig / it on a point: ITG candidate (rules.json grotbc.itg). Candidates only; ITG / MITG "
                          "designation belongs to the task and is made in the app.", "flaggedExisting": flagged}
    (feat / "index.json").write_text(json.dumps(idx, indent=1, ensure_ascii=False), encoding="utf-8")
    return {"tiles": n}


INT_COLS = {"Feature_ID", "Land_Cover_Code", "Cover_Code"}
TEXT_COLS = {"Feature_Name", "Feature_Type", "Feature_Subtype", "GROTBC", "ITG_Status", "ITG_Reasons", "Data_Source",
             "Observation_Date", "Verification", "Remarks"}


def write_gpkg(path: Path, pts: list, lines: list, ex_flagged: list, dem_version: str, date: str) -> None:
    """The inventory in the GIS schema the owner asked for (one layer of points, one of ridgelines)."""
    import pyogrio.raw as raw
    import shapely
    path.unlink(missing_ok=True)

    def rows_for(items, geoms):
        cols = defaultdict(list)
        for i, (f, g) in enumerate(zip(items, geoms)):
            a = f["a"]
            k = f["kind"]
            cols["Feature_ID"].append(KIND_CODE.get(k, 0) * 1_000_000 + i + 1)
            cols["Feature_Name"].append(a.get("n") or "")
            cols["Feature_Type"].append(TYPE_LABEL.get(k, KINDS[KIND_CODE[k]][1]))
            cols["Feature_Subtype"].append(SUBTYPE.get(k, "Transport" if k in CROSSING_KINDS or k == "pass" else "Natural"))
            cols["GROTBC"].append("G")
            cols["Elevation"].append(float(a["e"]) if a.get("e") is not None else None)
            cols["Surveyed_Height"].append(float(a["hs"]) if a.get("hs") is not None else None)
            cols["Relative_Relief"].append(float(a["rr"]) if a.get("rr") is not None else None)
            cols["Depth"].append(float(a["dp"]) if a.get("dp") is not None else None)
            cols["Area_Km2"].append(float(a["a"]) if a.get("a") is not None else None)
            cols["Length_Km"].append(float(a["lk"]) if a.get("lk") is not None else None)
            cols["Slope_Deg"].append(float(a["sp"]) if a.get("sp") is not None else None)
            cols["Dominance_Km"].append(float(a["iso"]) if a.get("iso") is not None else None)
            cols["View_Pct"].append(float(a["vs"]) if a.get("vs") is not None else None)
            cols["MSR_In_View_Km"].append(float(a["mv"]) if a.get("mv") is not None else None)
            cols["Nearest_MSR_Km"].append(float(a["dr"]) if a.get("dr") is not None else None)
            cols["Nearest_Road_Km"].append(float(a["dn"]) if a.get("dn") is not None else None)
            cols["Land_Cover_Code"].append(int(a["lc"]) if a.get("lc") is not None else None)
            cols["Cover_Code"].append(int(a["cv"]) if a.get("cv") is not None else None)
            cols["ITG_Status"].append({0: "Not a candidate", 1: "ITG candidate", 2: "Strong candidate (check as MITG)"}[a.get("it", 0)])
            cols["ITG_Reasons"].append(a.get("ig") or "")
            src = a.get("src")
            cols["Data_Source"].append({"dem": f"Copernicus DEM GLO-30 {dem_version}", "osm": "OpenStreetMap road graph"}.get(src, "NCGDB / GeoNames"))
            cols["Observation_Date"].append(date)
            cols["Verification"].append("Unverified (modelled)" if src in ("dem", "osm") else "Recorded")
            cols["Remarks"].append(a.get("t") or "")
        return cols

    def write(layer, items, geoms, gtype, append):
        if not items:
            return
        cols = rows_for(items, geoms)
        names = list(cols)
        arrays = []
        for n in names:
            v = cols[n]
            if n in INT_COLS:
                arrays.append(np.array([x if x is not None else -1 for x in v], dtype=np.int64))
            elif n in TEXT_COLS:
                arrays.append(np.array([str(x) for x in v], dtype=object))
            else:
                arrays.append(np.array([x if x is not None else np.nan for x in v], dtype=np.float64))
        wkb = shapely.to_wkb(np.array(geoms, dtype=object))
        raw.write(str(path), wkb, arrays, names, layer=layer, driver="GPKG", crs="EPSG:3857",
                  geometry_type=gtype, append=append)

    allp = pts + ex_flagged
    write("ground_features", allp, [shapely.Point(f["x"], f["y"]) for f in allp], "Point", False)
    write("ground_ridgelines", lines, [shapely.LineString(ln["xy"]) for ln in lines], "LineString", True)
    log.info("inventory: %d points, %d ridgelines -> %s", len(allp), len(lines), path)

# ----------------------------------------------------------------------------- main


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--grid", type=Path, default=Path("work/grid"))
    ap.add_argument("--grotbc", type=Path, default=Path("work/grotbc"))
    ap.add_argument("--classify", type=Path, default=Path("work/classify"))
    ap.add_argument("--network", type=Path, default=Path("work/network"))
    ap.add_argument("--out", type=Path, default=Path("work/ground"))
    ap.add_argument("--classes", type=Path, default=Path("classes.yaml"))
    ap.add_argument("--rules", type=Path, default=Path("rules.yaml"))
    ap.add_argument("--lock", type=Path, default=Path("sources.lock"))
    ap.add_argument("--block", type=int, default=1024, help="coarse block size (px of the averaged DEM)")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--aoi", help="west,south,east,north: test on part of the grid (features/ is NOT touched)")
    args = ap.parse_args()

    grid = load_json(args.grid / "grid.json")
    rules, classes = load_yaml(args.rules), load_yaml(args.classes)
    cfg = rules["itg"]
    codes = class_table(classes)
    paths = {"dem": str(args.grid / "dem.tif"), "route": str(args.grotbc / "route.tif"),
             "class": str(args.classify / "class.tif"), "cc": str(args.classify / "cc.tif")}
    aoi = None
    if args.aoi:
        from common import lnglat_to_merc
        w, s, e, n = (float(v) for v in args.aoi.split(","))
        (x0, y0), (x1, y1) = lnglat_to_merc(w, s), lnglat_to_merc(e, n)
        aoi = (x0, y0, x1, y1)
    args.out.mkdir(parents=True, exist_ok=True)

    pts, lines, stats = run_blocks(paths, grid, cfg, codes, args.block, args.workers, aoi)
    if aoi is not None:
        pts = [f for f in pts if aoi[0] <= f["x"] <= aoi[2] and aoi[1] <= f["y"] <= aoi[3]]
    if (args.network / "network.json").exists():
        js = junctions(args.network, cfg)
        if aoi is not None:
            js = [f for f in js if aoi[0] <= f["x"] <= aoi[2] and aoi[1] <= f["y"] <= aoi[3]]
        pts += js

    feat = args.grotbc / "vector" / "features"
    tiles = load_features(feat)
    ex = existing_points(tiles, CROSSING_KINDS | {"pass", "mountain", "landform_name", "trig_station", "spot_height"})
    name_features(pts, ex)

    # existing crossings / passes: chokepoint on an MSR (C), pass on a road or track (P)
    ex_rows = [(k, x, y, a) for k in sorted(CROSSING_KINDS | {"pass"}) for (x, y, a) in ex.get(k, [])]
    if aoi is not None:
        ex_rows = [r for r in ex_rows if aoi[0] <= r[1] <= aoi[2] and aoi[1] <= r[2] <= aoi[3]]
    ex_flagged = []
    if ex_rows:
        code = sample_route_at(Path(paths["route"]), grid, np.array([[r[1], r[2]] for r in ex_rows]), 3)
        exy = np.array([[r[1], r[2]] for r in ex_rows])
        prox = sample_route_at(Path(paths["route"]), grid, exy, 8)
        wet = sample_route_at(Path(paths["class"]), grid, exy, 3, among=WATER_XING)
        for (k, x, y, a), cd, pr, w in zip(ex_rows, code, prox, wet):
            rank = int(cd) & 31
            on_msr = bool(cd & 128) and rank not in RAIL_RANKS
            f = {"kind": k, "x": x, "y": y, "a": a,
                 "_choke": on_msr and (k not in ("bridge", "bridge_iron", "viaduct") or bool(w)),
                 "_road": k == "pass" and (int(pr) & 31) in PASS_RANKS}
            letters = itg_reasons(f, cfg["reasons"])
            if letters:
                a["ig"], a["it"] = letters, strength(letters, cfg["strong"])
                ex_flagged.append(f)

    for f in pts:
        letters = itg_reasons(f, cfg["reasons"])
        f.pop("_road", None)
        if letters:
            f["a"]["ig"], f["a"]["it"] = letters, strength(letters, cfg["strong"], f["a"])
    cand = defaultdict(lambda: [0, 0])
    for f in pts + ex_flagged:
        if f["a"].get("it"):
            cand[f["kind"]][f["a"]["it"] - 1] += 1
    log.info("ITG candidates (candidate, strong) by kind: %s", dict(cand))

    lock = load_yaml(args.lock)
    dem_version = next((s.get("version", "") for s in lock.get("sources", []) if s.get("id") == "glo30"), "")
    import datetime as _dt
    write_gpkg(args.out / "ground_inventory.gpkg", pts, lines, ex_flagged, dem_version, _dt.date.today().isoformat())
    summary = {"stats": stats, "points": len(pts), "ridgelines": len(lines), "existingFlagged": len(ex_flagged),
               "candidates": {k: {"candidate": v[0], "strong": v[1]} for k, v in cand.items()}, "itg": cfg,
               "aoi": args.aoi}
    (args.out / "ground.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    if aoi is not None:
        log.info("test run (--aoi): features/ left unchanged; see %s", args.out)
        return 0
    m = merge(feat, tiles, pts, lines, len(ex_flagged))
    log.info("features: %d tiles rewritten with %d G points and %d ridgelines", m["tiles"], len(pts), len(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
