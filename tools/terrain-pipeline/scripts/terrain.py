"""Step 4b — terrain type (G, read by T), soil texture (G; bearing used by T) and hut density (B) layers for bundle v2.

Inputs : work/classify/{class,wet}.tif, work/grotbc/slopeband.tif, work/raw/soilgrids/*.tif (fetch_soil.py),
         rules.yaml (terrainType), the NCGDB `Hut` layer
Outputs: work/terrain/terrain.tif   uint8 classes.yaml `layers.terrain` (Plain / Hilly / Solid / Marshy / Wet /
                                    Desert / Mountainous / Built-up / Snow-ice), 255 nodata
         work/terrain/soil.tif      uint8 classes.yaml `layers.soil` (USDA texture of the top 30 cm), 255 nodata
         work/terrain/bank.tif      uint8 land along water: kind << 2 | distance band (rules.yaml banks), 0 none, 255 nodata
         work/terrain/hut.tif       uint8: bits 0-6 permanent huts per km2 (0..126), bit 7 temporary huts nearby;
                                    255 nodata. Huts are the 1:50k symbols for kacha (mud) and temporary dwellings.

Soil: SoilGrids sand and clay (g/kg) at 0-5, 5-15 and 15-30 cm are averaged over the top 30 cm (weights 5:10:15),
silt = 1000 - sand - clay, and the USDA texture triangle gives the class. It is a modelled surface at ~250 m: it
says what the ground tends to be, not what it is at a point.
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


# ----------------------------------------------------------------------------- soil texture

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


def soil_source(raw: Path):
    """Texture class raster in the SoilGrids files' own grid (EPSG:4326) and its transform."""
    import rasterio
    total = sum(w for _d, w in DEPTHS)
    mean, ok, tr = {}, None, None
    for prop in ("sand", "clay"):
        acc = None
        for depth, w in DEPTHS:
            with rasterio.open(raw / "soilgrids" / f"{prop}_{depth}.tif") as d:
                a = d.read(1).astype("float32")
                tr = d.transform
                good = a != d.nodata
            acc = a * w if acc is None else acc + a * w
            ok = good if ok is None else ok & good
        mean[prop] = acc / total / 10.0                                     # g/kg -> %
    sand = np.where(ok, mean["sand"], np.nan)
    clay = np.where(ok, mean["clay"], np.nan)
    tex = usda_texture(sand, clay)
    # SoilGrids has no value under cities, big water and glaciers: take the nearest valid texture within FILL_CELLS
    # (~6 km) so a position in a built-up area still gets the soil of the ground around it; farther stays nodata
    from scipy.ndimage import distance_transform_edt
    dist, (ri, ci) = distance_transform_edt(tex == 255, return_distances=True, return_indices=True)
    fill = (tex == 255) & (dist <= FILL_CELLS)
    tex[fill] = tex[ri[fill], ci[fill]]
    log.info("soil: filled %d no-data cells within %d cells of valid soil", int(fill.sum()), FILL_CELLS)
    return tex, tr


def make_soil(grid: dict, classify: Path, raw: Path, out: Path, block: int) -> None:
    import rasterio
    from rasterio.transform import Affine
    from rasterio.warp import Resampling, reproject
    from rasterio.windows import Window

    tex, src_tr = soil_source(raw)
    log.info("soil texture (4326): %s, classes %s", tex.shape, np.unique(tex).tolist())
    prof = dict(GTIFF_U8, width=grid["width"], height=grid["height"], crs=grid["crs"], transform=Affine(*grid["transform"]))
    with rasterio.open(classify / "class.tif") as cs, rasterio.open(out / "soil.tif", "w", **prof) as dst:
        for i, b in enumerate(iter_blocks(grid["width"], grid["height"], block)):
            win = Window(b["col"], b["row"], b["w"], b["h"])
            tr = dst.window_transform(win)
            arr = np.full((b["h"], b["w"]), 255, dtype=np.uint8)
            reproject(tex, arr, src_transform=src_tr, src_crs="EPSG:4326", dst_transform=tr, dst_crs=grid["crs"],
                      resampling=Resampling.nearest, src_nodata=255, dst_nodata=255)
            arr[cs.read(1, window=win) == 255] = 255
            dst.write(arr, 1, window=win)
            if i % 100 == 0:
                log.info("  soil block %d at row %d/%d", i, b["row"], grid["height"])
    log.info("soil.tif -> %s", out)


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
        make_soil(grid, args.classify, args.raw, args.out, args.block)
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
