"""Step 4b — terrain type (G, read by T), soil texture and strength (G; cone index used by T), banks and hut density (B).

Inputs : work/classify/{class,wet}.tif, work/grotbc/slopeband.tif, work/raw/soilgrids/*.tif (fetch_soil.py),
         rules.yaml (terrainType, soilStrength), the NCGDB `Hut` layer
Outputs: work/terrain/terrain.tif   uint8 classes.yaml `layers.terrain` (Plain / Hilly / Solid / Marshy / Wet /
                                    Desert / Mountainous / Built-up / Snow-ice), 255 nodata
         work/terrain/soil.tif      uint8 texture | confidence << 4 | mapped << 6: texture = classes.yaml
                                    `layers.soil` (USDA class of the top 30 cm, 13-14 mapped only), confidence =
                                    `layers.soilConfidence`, bit 6 = NCGDB 1:50k soil area; 255 nodata
         work/terrain/rci_dry.tif   uint8 cone index dry season / after heavy rain (rules.yaml soilStrength):
         work/terrain/rci_wet.tif   value & 127 = cone index (127 = 127+), bit 7 = coarse (sand thresholds); 255 nodata
         work/terrain/soil_props.tif  float32 GIS check on the SoilGrids grid: texture, uscs, confidence, Ks, rci dry / wet
         work/terrain/bank.tif      uint8 land along water: kind << 2 | distance band (rules.yaml banks), 0 none, 255 nodata
         work/terrain/hut.tif       uint8: bits 0-6 permanent huts per km2 (0..126), bit 7 temporary huts nearby;
                                    255 nodata. Huts are the 1:50k symbols for kacha (mud) and temporary dwellings.

Soil: SoilGrids sand, silt, clay, coarse fragments, bulk density and organic carbon at 0-5, 5-15 and 15-30 cm are
averaged over the top 30 cm (weights 5:10:15); sand + silt + clay are normalised to 100 %. The inputs are warped
bilinear onto the bundle grid and classified there: USDA texture (soil layer), a USCS-style group, Saxton-Rawls Ks
(drainage) and a cone index for the dry season and after rain (rci layers), which the engine compares with the
mode's vehicle cone index (rules.yaml soilStrength.vehicles). Where the NCGDB 1:50k map shows sand, dunes, rock or
salt pan (class.tif), the map wins. Confidence comes from the width of SoilGrids' 90 % prediction interval. It is
a modelled surface at ~250 m: it says what the ground tends to be, not what it is at a point.
"""
from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np

from common import GTIFF_U8, ORIGIN_SHIFT, iter_blocks, load_json, load_yaml, setup_logging

log = setup_logging("terrain")

DEPTHS = (("0-5cm", 5.0), ("5-15cm", 10.0), ("15-30cm", 15.0))
HUT_CELL_PX = 16
FILL_CELLS = 24                        # SoilGrids cells (~275 m): how far nearby soil is carried into a no-data hole


# ----------------------------------------------------------------------------- terrain type

def terrain_block(cls: np.ndarray, slope: np.ndarray, wet: np.ndarray, tt: dict) -> np.ndarray:
    """First matching rule wins: snow > built-up > wet > marshy > mountainous > hilly > desert > solid > plain."""
    c = tt["codes"]
    out = np.full(cls.shape, c["plain"], dtype=np.uint8)

    def by_class(key):
        return np.isin(cls, tt["byClass"].get(key, []))

    rules = [
        ("snow_ice", by_class("snow_ice")),
        ("built_up", by_class("built_up")),
        ("wet", by_class("wet")),
        ("marshy", by_class("marshy") | (wet == int(tt.get("waterloggedWetValue", 4)))),
        ("mountainous", (slope == int(tt["slopeband"]["mountainous"])) | np.isin(cls, tt["classSlope"].get("mountainous", []))),
        ("hilly", (slope == int(tt["slopeband"]["hilly"])) | np.isin(cls, tt["classSlope"].get("hilly", []))),
        ("desert", by_class("desert")),
        ("solid", by_class("solid")),
    ]
    done = np.zeros(cls.shape, dtype=bool)
    for name, m in rules:
        m = m & ~done
        out[m] = c[name]
        done |= m
    out[cls == 255] = 255
    return out


def make_terrain(grid: dict, classify: Path, grotbc: Path, rules: dict, out: Path, block: int) -> None:
    import rasterio
    from rasterio.transform import Affine
    from rasterio.windows import Window

    tt = rules["terrainType"]
    prof = dict(GTIFF_U8, width=grid["width"], height=grid["height"], crs=grid["crs"], transform=Affine(*grid["transform"]))
    with rasterio.open(classify / "class.tif") as cs, rasterio.open(classify / "wet.tif") as ws, \
            rasterio.open(grotbc / "slopeband.tif") as ss, rasterio.open(out / "terrain.tif", "w", **prof) as dst:
        for i, b in enumerate(iter_blocks(grid["width"], grid["height"], block)):
            win = Window(b["col"], b["row"], b["w"], b["h"])
            dst.write(terrain_block(cs.read(1, window=win), ss.read(1, window=win), ws.read(1, window=win), tt), 1, window=win)
            if i % 100 == 0:
                log.info("  terrain block %d at row %d/%d", i, b["row"], grid["height"])
    log.info("terrain.tif -> %s", out)


# ----------------------------------------------------------------------------- soil texture and strength

def usda_texture(sand: np.ndarray, clay: np.ndarray) -> np.ndarray:
    """USDA texture class 1-12 from sand and clay in % (silt = the rest); 255 where either is missing."""
    silt = 100.0 - sand - clay
    t = np.full(sand.shape, 4, dtype=np.uint8)                       # loam unless a rule below matches
    done = np.zeros(sand.shape, dtype=bool)

    def put(code, m):
        nonlocal done
        m = m & ~done
        t[m] = code
        done |= m

    put(1, silt + 1.5 * clay < 15)
    put(2, (silt + 1.5 * clay >= 15) & (silt + 2 * clay < 30))
    put(3, ((clay >= 7) & (clay < 20) & (sand > 52) & (silt + 2 * clay >= 30)) | ((clay < 7) & (silt < 50) & (silt + 2 * clay >= 30)))
    put(4, (clay >= 7) & (clay < 27) & (silt >= 28) & (silt < 50) & (sand <= 52))
    put(5, ((silt >= 50) & (clay >= 12) & (clay < 27)) | ((silt >= 50) & (silt < 80) & (clay < 12)))
    put(6, (silt >= 80) & (clay < 12))
    put(7, (clay >= 20) & (clay < 35) & (silt < 28) & (sand > 45))
    put(8, (clay >= 27) & (clay < 40) & (sand > 20) & (sand <= 45))
    put(9, (clay >= 27) & (clay < 40) & (sand <= 20))
    put(10, (clay >= 35) & (sand > 45))
    put(11, (clay >= 40) & (silt >= 40))
    put(12, (clay >= 40) & (sand <= 45) & (silt < 40))
    t[~np.isfinite(sand) | ~np.isfinite(clay)] = 255
    return t


INPUTS = ("sand", "clay", "cfvo", "bd", "om")        # continuous model inputs, warped bilinear onto the grid
INPUT_DEFAULTS = {"cfvo": 0.0, "bd": 1.40, "om": 1.7}  # where SoilGrids has texture but not these (%, g/cm3, % OM)


def depth_mean(raw: Path, prop: str, stat: str = "mean"):
    """Depth-weighted (5:10:15) mean of the top 30 cm in SoilGrids' units, float32 with NaN nodata, and its transform."""
    import rasterio
    total = sum(w for _d, w in DEPTHS)
    acc = ok = tr = None
    for depth, w in DEPTHS:
        name = f"{prop}_{depth}.tif" if stat == "mean" else f"{prop}_{depth}_{stat}.tif"
        with rasterio.open(raw / "soilgrids" / name) as d:
            a = d.read(1)
            tr = d.transform
            good = a != d.nodata
        a = a.astype("float32") * (w / total)
        acc = a if acc is None else acc + a
        ok = good if ok is None else ok & good
    acc[~ok] = np.nan
    return acc, tr


def soil_inputs(raw: Path, ss: dict):
    """Model inputs on the SoilGrids grid (EPSG:4326): {sand, clay (% of fine earth, normalised with silt), cfvo (%),
    bd (g/cm3), om (% organic matter)}, the confidence code (0-2 from the 90 % interval, 3 filled, 255 none) and the
    transform. Holes (cities, big water, glaciers) take the nearest valid soil within FILL_CELLS."""
    from scipy.ndimage import distance_transform_edt
    sand, tr = depth_mean(raw, "sand")
    silt, _ = depth_mean(raw, "silt")
    clay, _ = depth_mean(raw, "clay")
    tot = sand + silt + clay
    ok = np.isfinite(tot) & (tot > 0)
    with np.errstate(invalid="ignore", divide="ignore"):
        dev = np.abs(tot[ok] - 1000.0)
        log.info("soil: sand + silt + clay off 1000 g/kg by p50 %.0f / p99 %.0f g/kg (normalised)",
                 *np.percentile(dev, [50, 99])) if dev.size else None
        inp = {"sand": np.where(ok, sand / tot * 100.0, np.nan).astype("float32"),
               "clay": np.where(ok, clay / tot * 100.0, np.nan).astype("float32")}
    del sand, silt, clay, tot

    width = None
    for prop in ("sand", "clay"):
        lo, _ = depth_mean(raw, prop, "Q0.05")
        hi, _ = depth_mean(raw, prop, "Q0.95")
        w = (hi - lo) / 10.0
        width = w if width is None else np.fmax(width, w)
        del lo, hi
    good_w = width[ok & np.isfinite(width)]
    if good_w.size:
        log.info("soil: 90%% interval width (wider of sand / clay) p10 %.0f  p50 %.0f  p90 %.0f %%-points",
                 *np.percentile(good_w, [10, 50, 90]))
    del good_w
    edges = [float(e) for e in ss["confidence"]["pi90WidthPct"]]
    conf = np.minimum(np.digitize(np.nan_to_num(width, nan=1e9), edges), 2).astype(np.uint8)
    del width

    for key, prop, scale in (("cfvo", "cfvo", 0.1), ("bd", "bdod", 0.01), ("om", "soc", 0.01 * 1.724)):
        a, _ = depth_mean(raw, prop)
        a *= scale
        a[ok & ~np.isfinite(a)] = INPUT_DEFAULTS[key]
        a[~ok] = np.nan
        inp[key] = a

    hole = ~ok
    dist, (ri, ci) = distance_transform_edt(hole, return_distances=True, return_indices=True)
    fill = hole & (dist <= FILL_CELLS)
    del dist
    rf, cf = ri[fill], ci[fill]
    del ri, ci
    for a in inp.values():
        a[fill] = a[rf, cf]
    conf[fill] = 3
    conf[hole & ~fill] = 255
    log.info("soil: filled %d no-data cells within %d cells of valid soil; confidence %s", int(fill.sum()), FILL_CELLS,
             {int(k): int(v) for k, v in zip(*np.unique(conf, return_counts=True))})
    return inp, conf, tr


def saxton_rawls_ks(sand: np.ndarray, clay: np.ndarray, om: np.ndarray) -> np.ndarray:
    """Saturated hydraulic conductivity (mm/h) from sand and clay (%) and organic matter (%): Saxton & Rawls 2006,
    SSSAJ 70:1569, equations 1-3, 5, 15-16 (no density or gravel adjustment)."""
    S, C, OM = sand / 100.0, clay / 100.0, np.clip(om, 0.0, 8.0)
    t1500t = -0.024 * S + 0.487 * C + 0.006 * OM + 0.005 * S * OM - 0.013 * C * OM + 0.068 * S * C + 0.031
    t1500 = t1500t + (0.14 * t1500t - 0.02)
    t33t = -0.251 * S + 0.195 * C + 0.011 * OM + 0.006 * S * OM - 0.027 * C * OM + 0.452 * S * C + 0.299
    t33 = t33t + (1.283 * t33t ** 2 - 0.374 * t33t - 0.015)
    ts33t = 0.278 * S + 0.034 * C + 0.022 * OM - 0.018 * S * OM - 0.027 * C * OM - 0.584 * S * C + 0.078
    ts33 = ts33t + (0.636 * ts33t - 0.107)
    ts = t33 + ts33 - 0.097 * S + 0.043
    t1500 = np.maximum(t1500, 0.005)
    t33 = np.maximum(t33, t1500 + 0.005)
    lam = (np.log(t33) - np.log(t1500)) / (math.log(1500.0) - math.log(33.0))
    return 1930.0 * np.maximum(ts - t33, 1e-4) ** (3.0 - lam)


def soil_group(inp: dict, ss: dict) -> np.ndarray:
    """USCS-style group code (rules.yaml soilStrength.groups[*].code), first matching rule; 0 where inputs are missing."""
    k, code = ss["classify"], {n: int(g["code"]) for n, g in ss["groups"].items()}
    sand, clay, cfvo, om = inp["sand"], inp["clay"], inp["cfvo"], inp["om"]
    fines = 100.0 - sand
    g = np.zeros(sand.shape, dtype=np.uint8)
    done = ~np.isfinite(sand) | ~np.isfinite(clay)
    with np.errstate(invalid="ignore"):
        for name, m in (("G", cfvo >= k["gravelCfvoPct"]),
                        ("SP", fines < k["cleanFinesPct"]),
                        ("SC", (fines < 50) & (clay >= k["scClayPct"])),
                        ("SM", fines < 50),
                        ("OL", om >= k["organicOmPct"]),
                        ("CH", clay >= k["chClayPct"]),
                        ("CL", clay >= k["clClayPct"]),
                        ("CL-ML", clay >= k["clmlClayPct"]),
                        ("ML", np.ones(sand.shape, dtype=bool))):
            m = m & ~done
            g[m] = code[name]
            done |= m
    return g


def soil_model(inp: dict, ss: dict, cls: np.ndarray | None = None) -> dict:
    """Texture (soil layer code), group, Ks and cone index dry / after rain for every pixel of `inp`. With `cls` (class
    codes on the same pixels) the NCGDB-mapped soil areas override the model (rules.yaml soilStrength.mapped)."""
    groups = ss["groups"]
    by_code = {int(g["code"]): g for g in groups.values()}
    lut_dry, lut_wet, lut_coarse = (np.full(256, np.nan, dtype="float32") for _ in range(3))
    for c, g in by_code.items():
        lut_dry[c], lut_wet[c], lut_coarse[c] = g["dry"], g["wet"], 1.0 if g.get("coarse") else 0.0
    tex = usda_texture(inp["sand"], inp["clay"])
    grp = soil_group(inp, ss)
    ks = saxton_rawls_ks(inp["sand"], inp["clay"], inp["om"]).astype("float32")

    m = ss["modifiers"]
    with np.errstate(invalid="ignore"):
        f = np.where((inp["cfvo"] >= m["gravelly"]["cfvoPct"]) & (grp != groups["G"]["code"]),
                     float(m["gravelly"]["factor"]), 1.0)
        d = m["density"]
        f = f * np.clip(1.0 + float(d["perGcm3"]) * (inp["bd"] - float(d["refGcm3"])), float(d["min"]), float(d["max"]))
        dr = m["drainage"]
        f_wet = f * np.asarray(dr["wetFactor"], dtype="float32")[np.digitize(np.nan_to_num(ks, nan=0.0), dr["ksBandsMmH"])]
    dry = lut_dry[grp] * f
    wet = lut_wet[grp] * f_wet

    mapped = np.zeros(tex.shape, dtype=bool)
    if cls is not None:
        for c, v in ss.get("mapped", {}).items():
            mm = cls == int(c)
            if mm.any():
                gc = int(groups[v["group"]]["code"])
                tex[mm] = int(v["soil"])
                grp[mm] = gc
                mapped |= mm
                dry[mm], wet[mm] = lut_dry[gc], lut_wet[gc]
    coarse = lut_coarse[grp] == 1.0
    return {"tex": tex, "grp": grp, "ks": ks, "dry": dry, "wet": wet, "coarse": coarse, "mapped": mapped}


def rci_byte(rci: np.ndarray, coarse: np.ndarray, cap: int) -> np.ndarray:
    """Layer value: cone index capped at `cap` (cap - 1 on sand, so 255 stays nodata) | coarse << 7; 255 nodata."""
    ok = np.isfinite(rci)
    v = np.where(coarse, np.minimum(np.rint(np.nan_to_num(rci)), cap - 1), np.minimum(np.rint(np.nan_to_num(rci)), cap))
    out = (np.maximum(v, 0).astype(np.uint8) | (coarse.astype(np.uint8) << 7))
    out[~ok] = 255
    return out


def soil_report(inp: dict, conf: np.ndarray, ss: dict, tr, out: Path) -> None:
    """work/terrain/soil_props.tif on the SoilGrids grid (GIS check; no NCGDB overrides) and a log of the group shares
    and the going they give each vehicle, dry and after rain."""
    import rasterio
    from rasterio.windows import Window
    h, w = conf.shape
    bands = ("texture", "uscs", "confidence", "ks_mm_h", "rci_dry", "rci_wet")
    prof = dict(driver="GTiff", dtype="float32", count=len(bands), width=w, height=h, crs="EPSG:4326", transform=tr,
                nodata=np.nan, compress="deflate", predictor=3, tiled=True, blockxsize=256, blockysize=256)
    names = {int(g["code"]): n for n, g in ss["groups"].items()}
    grp_count = np.zeros(256, dtype=np.int64)
    veh = ss["vehicles"]
    going = {(v, s): np.zeros(3, dtype=np.int64) for v in veh for s in ("dry", "wet")}
    with rasterio.open(out / "soil_props.tif", "w", **prof) as dst:
        for i, n in enumerate(bands, 1):
            dst.set_band_description(i, n)
        step = 512
        for y in range(0, h, step):
            sl = slice(y, min(h, y + step))
            sub = {k: a[sl] for k, a in inp.items()}
            r = soil_model(sub, ss)
            c = conf[sl]
            valid = c != 255
            grp_count += np.bincount(r["grp"][valid], minlength=256)
            for v, t in veh.items():
                for s in ("dry", "wet"):
                    ci = r[s][valid]
                    co = r["coarse"][valid]
                    v1 = np.where(co, t["coarse"][0], t["fine"][0])
                    v50 = np.where(co, t["coarse"][1], t["fine"][1])
                    going[(v, s)] += [(ci >= v50).sum(), ((ci >= v1) & (ci < v50)).sum(), (ci < v1).sum()]
            stack = np.stack([r["tex"].astype("float32"), r["grp"].astype("float32"), c.astype("float32"),
                              r["ks"], r["dry"], r["wet"]])
            stack[:, ~valid] = np.nan
            stack[0][r["tex"] == 255] = np.nan
            dst.write(stack, window=Window(0, y, w, sl.stop - y))
    total = max(1, int(grp_count.sum()))
    log.info("soil groups: %s", ", ".join(f"{names.get(c, c)} {100 * n / total:.1f}%"
                                         for c, n in enumerate(grp_count) if n))
    for (v, s), g in going.items():
        t = max(1, int(g.sum()))
        log.info("soil going %-13s %-3s  GO %5.1f%%  SLOW-GO %5.1f%%  NO-GO %5.1f%%", v, s, *(100 * g / t))
    log.info("soil_props.tif -> %s", out)


def make_soil(grid: dict, classify: Path, raw: Path, rules: dict, out: Path, block: int) -> None:
    """soil.tif (texture | confidence << 4 | mapped << 6), rci_dry.tif and rci_wet.tif on the bundle grid. The model
    inputs are warped BILINEAR onto each block and the texture, group and cone index are worked out there, so class
    boundaries follow the smooth fractions instead of the 250 m cells."""
    import rasterio
    from rasterio.transform import Affine
    from rasterio.warp import Resampling, reproject
    from rasterio.windows import Window

    ss = rules["soilStrength"]
    cap = int(ss.get("layerCap", 127))
    inp, conf, src_tr = soil_inputs(raw, ss)
    soil_report(inp, conf, ss, src_tr, out)
    stack = np.stack([inp.pop(k) for k in INPUTS])
    del inp
    prof = dict(GTIFF_U8, width=grid["width"], height=grid["height"], crs=grid["crs"], transform=Affine(*grid["transform"]))
    outs = {n: rasterio.open(out / f"{n}.tif", "w", **prof) for n in ("soil", "rci_dry", "rci_wet")}
    n_mapped = 0
    try:
        with rasterio.open(classify / "class.tif") as cs:
            for i, b in enumerate(iter_blocks(grid["width"], grid["height"], block)):
                win = Window(b["col"], b["row"], b["w"], b["h"])
                tr = outs["soil"].window_transform(win)
                cls = cs.read(1, window=win)
                nod = cls == 255
                if nod.all():
                    for ds in outs.values():
                        ds.write(np.full((b["h"], b["w"]), 255, dtype=np.uint8), 1, window=win)
                    continue
                arr = np.full((len(INPUTS), b["h"], b["w"]), np.nan, dtype="float32")
                reproject(stack, arr, src_transform=src_tr, src_crs="EPSG:4326", dst_transform=tr,
                          dst_crs=grid["crs"], resampling=Resampling.bilinear, src_nodata=np.nan, dst_nodata=np.nan)
                cf = np.full((b["h"], b["w"]), 255, dtype=np.uint8)
                reproject(conf, cf, src_transform=src_tr, src_crs="EPSG:4326", dst_transform=tr, dst_crs=grid["crs"],
                          resampling=Resampling.nearest, src_nodata=255, dst_nodata=255)
                r = soil_model(dict(zip(INPUTS, arr)), ss, cls)
                cf[r["mapped"]] = 0
                soil = np.where(r["tex"] == 255, 255,
                                r["tex"] | ((cf & 3) << 4) | (r["mapped"].astype(np.uint8) << 6)).astype(np.uint8)
                soil[(cf == 255) & ~r["mapped"]] = 255
                dry, wet = rci_byte(r["dry"], r["coarse"], cap), rci_byte(r["wet"], r["coarse"], cap)
                for a in (soil, dry, wet):
                    a[nod] = 255
                n_mapped += int(r["mapped"].sum())
                outs["soil"].write(soil, 1, window=win)
                outs["rci_dry"].write(dry, 1, window=win)
                outs["rci_wet"].write(wet, 1, window=win)
                if i % 100 == 0:
                    log.info("  soil block %d at row %d/%d", i, b["row"], grid["height"])
    finally:
        for ds in outs.values():
            ds.close()
    log.info("soil.tif, rci_dry.tif, rci_wet.tif -> %s (%d pixels from NCGDB soil areas)", out, n_mapped)


# ----------------------------------------------------------------------------- hut density

def hut_points(gdb: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(x, y in Web Mercator, temporary?) of every Hut symbol; reads the points' WKB directly."""
    import pyogrio.raw as raw
    meta, _fid, geom, data = raw.read(gdb, layer="Hut", columns=["Type"])
    kind = np.array([str(v).split(".")[0] for v in dict(zip(meta["fields"], data))["Type"]])
    blob = [g for g in geom]
    if all(g is not None and len(g) == 21 for g in blob):
        a = np.frombuffer(b"".join(blob), dtype=np.uint8).reshape(-1, 21)
        le = a[:, 0] == 1
        if not le.all():
            raise SystemExit("Hut WKB is not little-endian points")
        xy = np.frombuffer(a[:, 5:21].tobytes(), dtype="<f8").reshape(-1, 2)
    else:
        import shapely
        g = shapely.from_wkb(geom)
        xy = shapely.get_coordinates(g[~shapely.is_missing(g)])
        kind = kind[~shapely.is_missing(g)]
    lon, lat = xy[:, 0], np.clip(xy[:, 1], -85.0511, 85.0511)
    r = 6378137.0
    x = np.radians(lon) * r
    y = np.log(np.tan(np.pi / 4 + np.radians(lat) / 2)) * r
    return x, y, kind == "2"


def make_hut(grid: dict, classify: Path, gdb: str, out: Path, block: int) -> None:
    import rasterio
    from rasterio.transform import Affine
    from rasterio.windows import Window
    from scipy.ndimage import uniform_filter

    res = grid["pixel_size"]
    x0, y1 = grid["transform"][2], grid["transform"][5]
    W, H = grid["width"], grid["height"]
    cw, ch = math.ceil(W / HUT_CELL_PX), math.ceil(H / HUT_CELL_PX)
    x, y, temp = hut_points(gdb)
    log.info("huts: %d points (%d temporary)", len(x), int(temp.sum()))
    cx = np.floor((x - x0) / (HUT_CELL_PX * res)).astype(np.int64)
    cy = np.floor((y1 - y) / (HUT_CELL_PX * res)).astype(np.int64)
    ok = (cx >= 0) & (cx < cw) & (cy >= 0) & (cy < ch)
    flat = cy[ok] * cw + cx[ok]
    perm = np.bincount(flat[~temp[ok]], minlength=cw * ch).reshape(ch, cw).astype("float32")
    tmp = np.bincount(flat[temp[ok]], minlength=cw * ch).reshape(ch, cw).astype("float32")
    # ground area of a cell: its side (px * pixel * cos lat), latitude from the cell row's Web Mercator y
    ymid = y1 - (np.arange(ch) + 0.5) * HUT_CELL_PX * res
    lat = np.arctan(np.sinh(ymid / ORIGIN_SHIFT * math.pi))
    side_km = HUT_CELL_PX * res * np.cos(lat) / 1000.0
    area = (side_km ** 2)[:, None]
    dens = uniform_filter(perm / area, size=3, mode="constant")
    near_t = uniform_filter(tmp, size=3, mode="constant") > 0
    cell = np.minimum(126, np.rint(dens)).astype(np.uint8) | (near_t.astype(np.uint8) << 7)
    log.info("hut cells: %d with huts, max %d / km2", int((perm > 0).sum()), int(dens.max()))
    prof = dict(GTIFF_U8, width=W, height=H, crs=grid["crs"], transform=Affine(*grid["transform"]))
    with rasterio.open(classify / "class.tif") as cs, rasterio.open(out / "hut.tif", "w", **prof) as dst:
        for i, b in enumerate(iter_blocks(W, H, block)):
            win = Window(b["col"], b["row"], b["w"], b["h"])
            rows = (b["row"] + np.arange(b["h"])) // HUT_CELL_PX
            cols = (b["col"] + np.arange(b["w"])) // HUT_CELL_PX
            arr = cell[np.ix_(rows, cols)].copy()
            arr[cs.read(1, window=win) == 255] = 255
            dst.write(arr, 1, window=win)
    log.info("hut.tif -> %s", out)


# ----------------------------------------------------------------------------- banks

def make_bank(grid: dict, classify: Path, rules: dict, out: Path, block: int) -> None:
    """bank.tif: land within rules.yaml `banks.bandsM` of water. Value = kind << 2 | band (band 0 nearest), 0 = not a
    bank (or the water itself), 255 nodata. The kind is the water the bank faces (`banks.kinds[k].waterClasses`)."""
    import rasterio
    from rasterio.transform import Affine
    from rasterio.windows import Window
    from scipy.ndimage import distance_transform_edt

    from common import row_latitudes

    bk = rules["banks"]
    bands = [float(b) for b in bk["bandsM"]]
    kind_of = np.zeros(256, dtype=np.uint8)
    for k, v in bk["kinds"].items():
        for c in v["waterClasses"]:
            kind_of[int(c)] = int(k)
    water_cls = np.nonzero(kind_of)[0]
    res = grid["pixel_size"]
    lat_n = max(abs(grid["aoi"][1]), abs(grid["aoi"][3]))
    halo = int(math.ceil(bands[-1] / (res * math.cos(math.radians(lat_n))))) + 2
    prof = dict(GTIFF_U8, width=grid["width"], height=grid["height"], crs=grid["crs"], transform=Affine(*grid["transform"]))
    n_bank = 0
    with rasterio.open(classify / "class.tif") as cs, rasterio.open(out / "bank.tif", "w", **prof) as dst:
        for i, b in enumerate(iter_blocks(grid["width"], grid["height"], block, halo)):
            cls = cs.read(1, window=Window(b["rcol"], b["rrow"], b["rw"], b["rh"]))
            core = (slice(b["oy"], b["oy"] + b["h"]), slice(b["ox"], b["ox"] + b["w"]))
            water = np.isin(cls, water_cls)
            val = np.zeros(cls.shape, dtype=np.uint8)
            if water.any() and not water.all():
                lat = float(row_latitudes(grid, b["rrow"] + b["rh"] // 2, 1)[0])
                gp = res * math.cos(math.radians(lat))
                dist, (ri, ci) = distance_transform_edt(~water, sampling=gp, return_indices=True)
                band = np.digitize(dist, bands, right=True)          # 0 within bands[0], ..., len(bands) = beyond
                land = ~water & (cls != 255) & (band < len(bands))
                val[land] = (kind_of[cls[ri[land], ci[land]]] << 2) | band[land].astype(np.uint8)
            val[cls == 255] = 255
            out_core = val[core]
            n_bank += int(((out_core > 0) & (out_core != 255)).sum())
            dst.write(out_core, 1, window=Window(b["col"], b["row"], b["w"], b["h"]))
            if i % 100 == 0:
                log.info("  bank block %d at row %d/%d", i, b["row"], grid["height"])
    log.info("bank.tif -> %s (%d bank pixels)", out, n_bank)


# ----------------------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--grid", type=Path, default=Path("work/grid"))
    ap.add_argument("--classify", type=Path, default=Path("work/classify"))
    ap.add_argument("--grotbc", type=Path, default=Path("work/grotbc"))
    ap.add_argument("--raw", type=Path, default=Path("work/raw"))
    ap.add_argument("--out", type=Path, default=Path("work/terrain"))
    ap.add_argument("--rules", type=Path, default=Path("rules.yaml"))
    ap.add_argument("--classes", type=Path, default=Path("classes.yaml"))
    ap.add_argument("--ncgdb", help="NCGDB .gdb folder (default: classes.yaml, then $NCGDB_PATH)")
    ap.add_argument("--block", type=int, default=2048)
    ap.add_argument("--only", nargs="*", choices=["terrain", "soil", "hut", "bank"])
    args = ap.parse_args()

    grid, rules, cfg = load_json(args.grid / "grid.json"), load_yaml(args.rules), load_yaml(args.classes)
    want = set(args.only or ["terrain", "soil", "hut", "bank"])
    args.out.mkdir(parents=True, exist_ok=True)
    if "terrain" in want:
        make_terrain(grid, args.classify, args.grotbc, rules, args.out, args.block)
    if "soil" in want:
        make_soil(grid, args.classify, args.raw, rules, args.out, args.block)
    if "bank" in want:
        make_bank(grid, args.classify, rules, args.out, args.block)
    if "hut" in want:
        from derive import resolve_ncgdb
        gdb, _ = resolve_ncgdb(args.ncgdb, cfg["sources"].get("ncgdb", {}).get("path"))
        if gdb is None or not gdb.is_dir():
            raise SystemExit(f"hut density needs the NCGDB: not found at {gdb}")
        make_hut(grid, args.classify, str(gdb), args.out, args.block)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
