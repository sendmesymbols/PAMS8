"""Step 1b — SoilGrids 2.0 sand and clay for the data extent, read as windows of ISRIC's remote VRTs.

SoilGrids is published as a world mosaic (VRT over Interrupted Goode Homolosine COG tiles). Downloading the whole
mosaic is tens of GB, so this reads only the extent (grid.json aoi, else --aoi) through GDAL's /vsicurl/ and writes
work/raw/soilgrids/<prop>_<depth>.tif: EPSG:4326, 0.0025 deg (~275 m), int16 g/kg, nodata -32768.
Also records the file hashes in work/raw/checksums.json under `soilgrids` (like fetch.py does for the others).

    python scripts/fetch_soil.py --aoi 59.5,20.5,80.5,37.5
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from common import dump_json, load_json, setup_logging
from fetch import hash_source, sha256_file

log = setup_logging("fetch_soil")

BASE = "https://files.isric.org/soilgrids/latest/data"
PROPS = ("sand", "clay")
DEPTHS = ("0-5cm", "5-15cm", "15-30cm")
RES = 0.0025


def fetch_one(prop: str, depth: str, aoi: tuple, dest: Path) -> None:
    import numpy as np
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.transform import from_origin
    from rasterio.vrt import WarpedVRT
    from rasterio.windows import Window

    w, s, e, n = aoi
    width, height = int(round((e - w) / RES)), int(round((n - s) / RES))
    transform = from_origin(w, n, RES, RES)
    url = f"/vsicurl/{BASE}/{prop}/{prop}_{depth}_mean.vrt"
    profile = dict(driver="GTiff", dtype="int16", count=1, width=width, height=height, crs="EPSG:4326",
                   transform=transform, nodata=-32768, compress="deflate", predictor=2, tiled=True,
                   blockxsize=256, blockysize=256)
    tmp = dest.with_suffix(".part")
    with rasterio.Env(GDAL_HTTP_MAX_RETRY=5, GDAL_HTTP_RETRY_DELAY=3, GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
                      CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".vrt,.tif", GDAL_HTTP_MULTIPLEX="YES"):
        with rasterio.open(url) as src, WarpedVRT(src, crs="EPSG:4326", transform=transform, width=width,
                                                  height=height, resampling=Resampling.nearest,
                                                  nodata=-32768) as vrt, rasterio.open(tmp, "w", **profile) as out:
            step = 512
            for y in range(0, height, step):
                h = min(step, height - y)
                out.write(vrt.read(1, window=Window(0, y, width, h)).astype(np.int16), 1, window=Window(0, y, width, h))
                log.info("  %s %s: %d / %d rows", prop, depth, y + h, height)
    tmp.replace(dest)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--grid", type=Path, default=Path("work/grid/grid.json"))
    ap.add_argument("--aoi", help="west,south,east,north (WGS84); default: grid.json aoi")
    ap.add_argument("--out", type=Path, default=Path("work/raw"))
    ap.add_argument("--only", nargs="*", help="e.g. sand_0-5cm")
    args = ap.parse_args()

    aoi = tuple(float(v) for v in args.aoi.split(",")) if args.aoi else tuple(load_json(args.grid)["aoi"])
    out = args.out / "soilgrids"
    out.mkdir(parents=True, exist_ok=True)
    hashes: dict[str, str] = {}
    for prop in PROPS:
        for depth in DEPTHS:
            key = f"{prop}_{depth}"
            if args.only and key not in args.only:
                continue
            dest = out / f"{key}.tif"
            if not dest.exists():
                log.info("%s: reading %s", key, f"{BASE}/{prop}/{prop}_{depth}_mean.vrt")
                fetch_one(prop, depth, aoi, dest)
            hashes[dest.name] = sha256_file(dest)
            log.info("%s: %.1f MB", key, dest.stat().st_size / 1e6)
    checks_path = args.out / "checksums.json"
    checks = load_json(checks_path) if checks_path.exists() else {}
    checks["soilgrids"] = dict(files=hashes, sha256=hash_source(hashes))
    dump_json(checks_path, checks)
    log.info("soilgrids: aggregate hash %s", checks["soilgrids"]["sha256"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
