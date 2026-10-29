"""Step 6 — cut the class and dist rasters into XYZ PNG tiles.

Inputs : work/grid/grid.json, work/classify/class.tif, work/profiles/dist_*.tif
Outputs: <out>/class/{z}/{x}/{y}.png and <out>/dist_<profile>/{z}/{x}/{y}.png
         for z = ZMIN..ZMAX (default out: out/terrain-bundle)

ZMAX tiles are read straight from the rasters (the grid is snapped to whole
ZMAX tiles, so tile (x, y) is the window at ((x-x0)*256, (y-y0)*256)).
Each coarser level is a 2x reduction of the four child tiles ON DISK:
  class : nearest (top-left pixel; --class-reduce mode picks the majority of
          the 2x2 block, ignoring nodata) so codes stay valid
  dist  : MIN, so a coarse pixel never claims more clearance than any fine
          pixel under it (255 nodata is the max value, so it never wins
          unless all four are nodata)
Tiles that are 100 % nodata are NOT written: a 404 means "no coverage".
PNGs are 8-bit greyscale with only IHDR/IDAT/IEND (see common.write_png_l).
"""
from __future__ import annotations

import argparse
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

from common import TILE_SIZE, load_json, setup_logging, write_png_l

log = setup_logging("tile")


def read_tile(path: Path) -> np.ndarray | None:
    if not path.exists():
        return None
    from PIL import Image
    with Image.open(path) as im:
        return np.asarray(im.convert("L"), dtype=np.uint8)


def reduce_mode(a: np.ndarray) -> np.ndarray:
    """2x2 majority; ties and nodata resolved toward the top-left pixel."""
    v = np.stack([a[0::2, 0::2], a[0::2, 1::2], a[1::2, 0::2], a[1::2, 1::2]])
    counts = np.stack([(v == v[i]).sum(axis=0) for i in range(4)]).astype(np.int16)
    counts[v == 255] = -1                              # never prefer nodata ...
    best = counts.argmax(axis=0)
    out = np.take_along_axis(v, best[None], axis=0)[0]
    out[(v == 255).all(axis=0)] = 255                  # ... unless all four are nodata
    return out


def reduce_tile(a: np.ndarray, kind: str, class_reduce: str) -> np.ndarray:
    if kind == "dist":
        return a.reshape(TILE_SIZE, 2, TILE_SIZE, 2).min(axis=(1, 3))
    return reduce_mode(a) if class_reduce == "mode" else a[0::2, 0::2]


def cut_row(rasters: dict[str, Path], grid: dict, out: Path, y: int) -> int:
    """Write every ZMAX tile of row y for every layer. Returns tiles written."""
    import rasterio
    from rasterio.windows import Window
    x0, y0, x1, _ = grid["tile_range"]
    z, n = grid["zmax"], 0
    with rasterio.open(rasters["class"]) as cls_src:
        dist_srcs = {k: rasterio.open(p) for k, p in rasters.items() if k != "class"}
        try:
            for x in range(x0, x1 + 1):
                win = Window((x - x0) * TILE_SIZE, (y - y0) * TILE_SIZE, TILE_SIZE, TILE_SIZE)
                cls = cls_src.read(1, window=win)
                if (cls == 255).all():
                    continue
                write_png_l(out / "class" / str(z) / str(x) / f"{y}.png", cls)
                n += 1
                for name, s in dist_srcs.items():
                    write_png_l(out / name / str(z) / str(x) / f"{y}.png", s.read(1, window=win))
                    n += 1
        finally:
            for s in dist_srcs.values():
                s.close()
    return n


def build_overview(layer_dir: Path, kind: str, z: int, trange, class_reduce: str) -> int:
    """Build level z from level z+1 tiles on disk for one layer."""
    x0, y0, x1, y1 = trange
    n = 0
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            kids = [read_tile(layer_dir / str(z + 1) / str(2 * x + dx) / f"{2 * y + dy}.png")
                    for dy in (0, 1) for dx in (0, 1)]
            if all(k is None for k in kids):
                continue
            big = np.full((2 * TILE_SIZE, 2 * TILE_SIZE), 255, dtype=np.uint8)
            for (dy, dx), k in zip(((0, 0), (0, 1), (1, 0), (1, 1)), kids):
                if k is not None:
                    big[dy * TILE_SIZE:(dy + 1) * TILE_SIZE, dx * TILE_SIZE:(dx + 1) * TILE_SIZE] = k
            small = reduce_tile(big, kind, class_reduce)
            if (small == 255).all():
                continue
            write_png_l(layer_dir / str(z) / str(x) / f"{y}.png", small)
            n += 1
    return n


def parent_range(trange, levels: int):
    x0, y0, x1, y1 = trange
    f = 2 ** levels
    return x0 // f, y0 // f, x1 // f, y1 // f


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--grid", type=Path, default=Path("work/grid"))
    ap.add_argument("--class-tif", type=Path, default=Path("work/classify/class.tif"))
    ap.add_argument("--profiles", type=Path, default=Path("work/profiles"))
    ap.add_argument("--out", type=Path, default=Path("out/terrain-bundle"))
    ap.add_argument("--layers", nargs="*", help="subset, e.g. class dist_wheeled")
    ap.add_argument("--class-reduce", choices=["nearest", "mode"], default="nearest")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--skip-zmax", action="store_true", help="only rebuild overviews")
    args = ap.parse_args()

    grid = load_json(args.grid / "grid.json")
    rasters = {"class": args.class_tif}
    for p in sorted(args.profiles.glob("dist_*.tif")):
        rasters[p.stem] = p
    if args.layers:
        rasters = {k: v for k, v in rasters.items() if k in args.layers}
    log.info("layers: %s", ", ".join(rasters))

    x0, y0, x1, y1 = grid["tile_range"]
    if not args.skip_zmax:
        rows = range(y0, y1 + 1)
        with ProcessPoolExecutor(max_workers=args.workers) as pool:
            total = sum(pool.map(cut_row, [rasters] * len(rows), [grid] * len(rows),
                                 [args.out] * len(rows), rows, chunksize=1))
        log.info("z%d: %d tiles written", grid["zmax"], total)

    for z in range(grid["zmax"] - 1, grid["zmin"] - 1, -1):
        trange = parent_range(grid["tile_range"], grid["zmax"] - z)
        for name in rasters:
            kind = "dist" if name.startswith("dist_") else "class"
            n = build_overview(args.out / name, kind, z, trange, args.class_reduce)
            log.info("z%d %s: %d tiles", z, name, n)
    return 0


if __name__ == "__main__":
    sys.exit(main())
