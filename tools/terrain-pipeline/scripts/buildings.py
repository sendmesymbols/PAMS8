"""Step 4e — buildings (GROTBC B, construction): Google Open Buildings v3 footprints aggregated on the grid.

Inputs : work/raw/openbuildings/<s2token>_buildings.csv.gz (fetch.py, source `openbuildings`), the per-tile confidence
         thresholds (score_thresholds_s2_level_4.csv, fetched by this script if missing), grid.json, class.tif
Outputs: work/buildings/cells.npz   count + footprint area per ~150 m cell (grid / DECIM), for settlements.py
         work/buildings/bld.tif     uint8 on the full grid: density class | size class << 3 | height class << 6
                                    (BLD_DENSITY, BLD_SIZE, BLD_HEIGHT), 0 = no buildings, 255 nodata
Height: GHSL GHS-BUILT-H R2023A average net building height (2018, ~90 m) from work/raw/ghsl_height/*.zip, averaged
onto the cells; it tells one- and two-storey ground from multi-storey blocks.

A footprint is kept when its confidence reaches the tile's 80 %-precision threshold. Only the first four CSV fields
(latitude, longitude, area_in_meters, confidence) are read; the polygon is not. The mean footprint size says what the
buildings are: under 40 m2 mostly huts / kacha dwellings, 40-100 small houses, 100-250 houses, 250-1,000 large houses
and blocks, over 1,000 industrial, warehouses and big public buildings. It is a machine-detected outline from imagery
(2021-2023), not a survey: it says nothing about storeys or material.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import math
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

from common import GTIFF_U8, iter_blocks, load_json, setup_logging

log = setup_logging("buildings")

DECIM = 4                         # must match settlements.py
THRESHOLDS_URL = "https://storage.googleapis.com/open-buildings-data/v3/score_thresholds_s2_level_4.csv"
BLD_DENSITY = [(3000, 6), (1000, 5), (300, 4), (100, 3), (30, 2), (1, 1)]     # buildings per km2 -> class
BLD_SIZE = [(1000, 5), (250, 4), (100, 3), (40, 2), (0, 1)]                   # mean footprint m2 -> class
DENSITY_LABEL = {0: "None", 1: "Scattered (under 30 / km2)", 2: "Sparse (30-100)", 3: "Open (100-300)",
                 4: "Medium (300-1,000)", 5: "Dense (1,000-3,000)", 6: "Very dense (3,000+)"}
BLD_HEIGHT = [(12.0, 3), (6.0, 2), (3.0, 1)]                                 # mean net height m -> class
HEIGHT_LABEL = {0: "Not known / under 3 m", 1: "Low (3-6 m, 1-2 storeys)", 2: "Medium (6-12 m, 2-4 storeys)",
                3: "High (12 m+, multi-storey)"}
SIZE_LABEL = {1: "Huts / kacha (under 40 m2)", 2: "Small houses (40-100 m2)", 3: "Houses (100-250 m2)",
              4: "Large houses / blocks (250-1,000 m2)", 5: "Industrial / large buildings (1,000+ m2)"}


def _tile_job(task) -> tuple[np.ndarray, np.ndarray, int, int]:
    path, thr, grid, chunk = task
    H, W = grid["height"] // DECIM, grid["width"] // DECIM
    res = grid["pixel_size"] * DECIM
    x0, y1 = grid["transform"][2], grid["transform"][5]
    cnt = np.zeros(H * W, dtype=np.uint16)
    area = np.zeros(H * W, dtype=np.float32)
    n_read = n_kept = 0

    def flush(lat, lon, ar, cf):
        nonlocal n_kept
        lat, lon, ar, cf = (np.array(v, dtype="float64") for v in (lat, lon, ar, cf))
        ok = cf >= thr
        mx = np.radians(lon[ok]) * 6378137.0
        my = np.log(np.tan(np.pi / 4 + np.radians(np.clip(lat[ok], -85, 85)) / 2)) * 6378137.0
        c = ((mx - x0) / res).astype(np.int64)
        r = ((y1 - my) / res).astype(np.int64)
        inside = (c >= 0) & (c < W) & (r >= 0) & (r < H)
        cell = r[inside] * W + c[inside]
        np.add.at(cnt, cell, 1)
        np.add.at(area, cell, ar[ok][inside].astype(np.float32))
        n_kept += int(inside.sum())

    lat, lon, ar, cf = [], [], [], []
    with gzip.open(path, "rt", encoding="utf-8", newline="") as f:
        head = f.readline()
        assert head.startswith("latitude,longitude,area_in_meters,confidence"), head[:80]
        for line in f:
            p = line.split(",", 4)
            try:
                lat.append(float(p[0])); lon.append(float(p[1])); ar.append(float(p[2])); cf.append(float(p[3]))
            except (ValueError, IndexError):
                continue
            n_read += 1
            if len(lat) >= chunk:
                flush(lat, lon, ar, cf)
                lat, lon, ar, cf = [], [], [], []
    if lat:
        flush(lat, lon, ar, cf)
    return cnt, area, n_read, n_kept


def thresholds(raw: Path) -> dict[str, float]:
    p = raw / "openbuildings" / "score_thresholds_s2_level_4.csv"
    if not p.exists():
        import urllib.request
        urllib.request.urlretrieve(THRESHOLDS_URL, p)
    return {r["s2_token"]: float(r["confidence_threshold_80%_precision"]) for r in csv.DictReader(open(p, encoding="utf-8"))}


def height_cells(raw: Path, grid: dict) -> np.ndarray | None:
    """GHSL net building height (m) averaged onto the ~150 m cells; 0 where no height; None without the files."""
    import zipfile

    import rasterio
    from rasterio.transform import Affine
    from rasterio.warp import Resampling, reproject
    zips = sorted((raw / "ghsl_height").glob("*.zip"))
    if not zips:
        return None
    H, W = grid["height"] // DECIM, grid["width"] // DECIM
    res = grid["pixel_size"] * DECIM
    dst_tr = Affine(res, 0, grid["transform"][2], 0, -res, grid["transform"][5])
    out = np.zeros((H, W), dtype=np.float32)
    for z in zips:
        tif = next(n for n in zipfile.ZipFile(z).namelist() if n.endswith(".tif"))
        with rasterio.open(f"/vsizip/{z.as_posix()}/{tif}") as d:
            a = d.read(1)
            part = np.zeros((H, W), dtype=np.float32)
            reproject(np.where(a > 0, a, np.nan).astype(np.float32), part, src_transform=d.transform, src_crs=d.crs,
                      dst_transform=dst_tr, dst_crs=grid["crs"], resampling=Resampling.average, src_nodata=np.nan,
                      dst_nodata=0)
        part = np.nan_to_num(part)
        out = np.where(part > 0, part, out)
        log.info("height: %s -> %d cells", z.name, int((part > 0).sum()))
    return out


def classify_cells(cnt: np.ndarray, area: np.ndarray, grid: dict, height: np.ndarray | None = None) -> np.ndarray:
    H, W = cnt.shape
    res = grid["pixel_size"] * DECIM
    y1 = grid["transform"][5]
    ymid = y1 - (np.arange(H) + 0.5) * res
    lat = np.arctan(np.sinh(ymid / 6378137.0))
    km2 = ((res * np.cos(lat)) / 1000.0) ** 2
    dens = cnt / km2[:, None]
    mean = np.where(cnt > 0, area / np.maximum(cnt, 1), 0)
    dcls = np.zeros(cnt.shape, dtype=np.uint8)
    for lo, k in reversed(BLD_DENSITY):
        dcls[dens >= lo] = k
    dcls[cnt == 0] = 0
    scls = np.zeros(cnt.shape, dtype=np.uint8)
    for lo, k in reversed(BLD_SIZE):
        scls[(cnt > 0) & (mean >= lo)] = k
    hcls = np.zeros(cnt.shape, dtype=np.uint8)
    if height is not None:
        for lo, k in reversed(BLD_HEIGHT):
            hcls[(cnt > 0) & (height >= lo)] = k
    return dcls | (scls << 3) | (hcls << 6)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--grid", type=Path, default=Path("work/grid/grid.json"))
    ap.add_argument("--raw", type=Path, default=Path("work/raw"))
    ap.add_argument("--class-tif", type=Path, default=Path("work/classify/class.tif"))
    ap.add_argument("--out", type=Path, default=Path("work/buildings"))
    ap.add_argument("--workers", type=int, default=3, help="each worker holds ~1.3 GB of cell arrays")
    ap.add_argument("--block", type=int, default=2048)
    args = ap.parse_args()

    import rasterio
    from rasterio.transform import Affine
    from rasterio.windows import Window

    grid = load_json(args.grid)
    args.out.mkdir(parents=True, exist_ok=True)
    thr = thresholds(args.raw)
    files = sorted((args.raw / "openbuildings").glob("*_buildings.csv.gz"))
    if not files:
        raise SystemExit("no Open Buildings tiles in work/raw/openbuildings (run fetch.py --only openbuildings)")
    H, W = grid["height"] // DECIM, grid["width"] // DECIM
    cnt = np.zeros(H * W, dtype=np.uint32)
    area = np.zeros(H * W, dtype=np.float64)
    tasks = [(f, thr.get(f.name.split("_")[0], 0.7), grid, 2_000_000) for f in files]
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        for f, (c, a, n_read, n_kept) in zip(files, pool.map(_tile_job, tasks)):
            cnt += c
            area += a
            log.info("%s: %d footprints read, %d kept inside the extent (threshold %.3f)", f.name, n_read, n_kept,
                     thr.get(f.name.split("_")[0], 0.7))
    cnt2, area2 = cnt.reshape(H, W), area.reshape(H, W).astype(np.float32)
    height = height_cells(args.raw, grid)
    np.savez_compressed(args.out / "cells.npz", count=cnt2, area=area2, decim=DECIM,
                        height=height if height is not None else np.zeros((1, 1), np.float32))
    cell = classify_cells(cnt2, area2, grid, height)
    log.info("buildings: %.1f M kept, %d cells with buildings", cnt.sum() / 1e6, int((cnt > 0).sum()))

    prof = dict(GTIFF_U8, width=grid["width"], height=grid["height"], crs=grid["crs"], transform=Affine(*grid["transform"]))
    with rasterio.open(args.class_tif) as cs, rasterio.open(args.out / "bld.tif", "w", **prof) as dst:
        for b in iter_blocks(grid["width"], grid["height"], args.block):
            win = Window(b["col"], b["row"], b["w"], b["h"])
            rows = np.minimum((b["row"] + np.arange(b["h"])) // DECIM, H - 1)
            cols = np.minimum((b["col"] + np.arange(b["w"])) // DECIM, W - 1)
            arr = cell[np.ix_(rows, cols)].copy()
            arr[cs.read(1, window=win) == 255] = 255
            dst.write(arr, 1, window=win)
    log.info("bld.tif -> %s", args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
