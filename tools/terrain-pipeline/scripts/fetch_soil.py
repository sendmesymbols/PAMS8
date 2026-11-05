"""Step 1b — SoilGrids 2.0 soil properties for the data extent, read as windows of ISRIC's remote VRTs.

SoilGrids is published as a world mosaic (VRT over Interrupted Goode Homolosine COG tiles). Downloading the whole
mosaic is tens of GB, so this reads only the extent (grid.json aoi, else --aoi) through GDAL's /vsicurl/ and writes
work/raw/soilgrids/<prop>_<depth>[_<quantile>].tif: EPSG:4326, 0.0025 deg (~275 m), int16 in SoilGrids' mapped
units, nodata -32768. The warp from Homolosine uses AVERAGE resampling (the values are continuous fractions and
densities; nearest picked one 250 m cell and aliased the boundaries). A file written with another resampling is
fetched again.

    property  unit     use (terrain.py)
    sand      g/kg     texture class; Q0.05 / Q0.95 give its uncertainty
    clay      g/kg     texture class, plasticity (USCS group); Q0.05 / Q0.95 give its uncertainty
    silt      g/kg     texture class (fetched, not 1000 - sand - clay: the three are predicted separately)
    cfvo      cm3/dm3  coarse fragments (stones, gravel) -> gravelly ground bears more
    bdod      cg/cm3   bulk density -> denser soil bears more
    soc       dg/kg    organic carbon -> organic matter for the moisture model, organic (weak) soils

Also records the file hashes in work/raw/checksums.json under `soilgrids` (like fetch.py does for the others).

    python scripts/fetch_soil.py --aoi 59.5,20.5,80.5,37.5 --workers 4
"""
from __future__ import annotations

import argparse
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from common import dump_json, load_json, setup_logging
from fetch import hash_source, sha256_file

log = setup_logging("fetch_soil")

BASE = "https://files.isric.org/soilgrids/latest/data"
# property -> statistics to fetch ("mean" is written without a suffix, as before)
PROPS = {
    "sand": ("mean", "Q0.05", "Q0.95"),
    "clay": ("mean", "Q0.05", "Q0.95"),
    "silt": ("mean",),
    "cfvo": ("mean",),
    "bdod": ("mean",),
    "soc":  ("mean",),
}
DEPTHS = ("0-5cm", "5-15cm", "15-30cm")
RES = 0.0025
RESAMPLING = "average"                 # stored as the RESAMPLING tag; a file without it is fetched again


def file_name(prop: str, depth: str, stat: str) -> str:
    return f"{prop}_{depth}.tif" if stat == "mean" else f"{prop}_{depth}_{stat}.tif"


def up_to_date(path: Path) -> bool:
    if not path.exists():
        return False
    import rasterio
    with rasterio.open(path) as d:
        return d.tags().get("RESAMPLING") == RESAMPLING


def fetch_one(prop: str, depth: str, stat: str, aoi: tuple, dest: Path) -> None:
    import numpy as np
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.transform import from_origin
    from rasterio.vrt import WarpedVRT
    from rasterio.windows import Window

    w, s, e, n = aoi
    width, height = int(round((e - w) / RES)), int(round((n - s) / RES))
    transform = from_origin(w, n, RES, RES)
    url = f"/vsicurl/{BASE}/{prop}/{prop}_{depth}_{stat}.vrt"
    profile = dict(driver="GTiff", dtype="int16", count=1, width=width, height=height, crs="EPSG:4326",
                   transform=transform, nodata=-32768, compress="deflate", predictor=2, tiled=True,
                   blockxsize=256, blockysize=256)
    tmp = dest.with_suffix(".part")
    with rasterio.Env(GDAL_HTTP_MAX_RETRY=5, GDAL_HTTP_RETRY_DELAY=3, GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
                      CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".vrt,.tif", GDAL_HTTP_MULTIPLEX="YES"):
        with rasterio.open(url) as src, WarpedVRT(src, crs="EPSG:4326", transform=transform, width=width,
                                                  height=height, resampling=Resampling[RESAMPLING],
                                                  src_nodata=src.nodata, nodata=-32768) as vrt, \
                rasterio.open(tmp, "w", **profile) as out:
            step = 512
            for y in range(0, height, step):
                h = min(step, height - y)
                out.write(vrt.read(1, window=Window(0, y, width, h)).astype(np.int16), 1, window=Window(0, y, width, h))
                if (y // step) % 4 == 0:
                    log.info("  %s %s %s: %d / %d rows", prop, depth, stat, y + h, height)
            out.update_tags(RESAMPLING=RESAMPLING, SOURCE=f"{BASE}/{prop}/{prop}_{depth}_{stat}.vrt")
    tmp.replace(dest)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--grid", type=Path, default=Path("work/grid/grid.json"))
    ap.add_argument("--aoi", help="west,south,east,north (WGS84); default: grid.json aoi")
    ap.add_argument("--out", type=Path, default=Path("work/raw"))
    ap.add_argument("--only", nargs="*", help="file stems, e.g. sand_0-5cm clay_0-5cm_Q0.05")
    ap.add_argument("--workers", type=int, default=4, help="remote reads at a time")
    args = ap.parse_args()

    aoi = tuple(float(v) for v in args.aoi.split(",")) if args.aoi else tuple(load_json(args.grid)["aoi"])
    out = args.out / "soilgrids"
    out.mkdir(parents=True, exist_ok=True)
    jobs = []
    for prop, stats in PROPS.items():
        for stat in stats:
            for depth in DEPTHS:
                dest = out / file_name(prop, depth, stat)
                if args.only and dest.stem not in args.only:
                    continue
                jobs.append((prop, depth, stat, dest))
    todo = [j for j in jobs if not up_to_date(j[3])]
    log.info("soilgrids: %d files, %d to fetch (%d at a time)", len(jobs), len(todo), args.workers)
    failed = []
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futs = {pool.submit(fetch_one, p, d, s, aoi, dest): dest for p, d, s, dest in todo}
        for f in as_completed(futs):
            try:
                f.result()
                log.info("%s: done", futs[f].name)
            except Exception as exc:                               # keep the others going; report at the end
                failed.append(futs[f].name)
                log.error("%s: %s", futs[f].name, exc)
    if failed:
        log.error("soilgrids: %d failed (%s); rerun to retry", len(failed), ", ".join(failed))
        return 1

    hashes: dict[str, str] = {}
    for *_x, dest in jobs:
        hashes[dest.name] = sha256_file(dest)
        log.info("%s: %.1f MB", dest.name, dest.stat().st_size / 1e6)
    checks_path = args.out / "checksums.json"
    checks = load_json(checks_path) if checks_path.exists() else {}
    if not args.only:
        checks["soilgrids"] = dict(files=hashes, sha256=hash_source(hashes))
        dump_json(checks_path, checks)
        log.info("soilgrids: aggregate hash %s", checks["soilgrids"]["sha256"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
