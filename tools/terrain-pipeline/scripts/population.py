"""Step 4e — population grid (GROTBC B: civil considerations) from WorldPop.

Inputs : WorldPop 2026 population count and age-sex rasters (common.WORLDPOP_TIF, WORLDPOP_AGESEX), WorldPop 2020
         population density (work/raw/worldpop_density/), WorldPop subnational population weighted density
         (work/raw/worldpop_pwd/), sources.lock (each layer carries its source's dates)
Outputs: work/population/population.bin   little-endian uint16, layers in the order of population.json `layers`, each
                                          [rows][cols], north row first; 65535 = no data (outside the country)
         work/population/population.json  header: bounds, cell size, rows, cols, layer list with units, scale and
                                          source dates; `provinces` = population weighted density per province

The grid is the WorldPop 2026 1 km grid (30 arc-seconds). Layers: pop (people in the cell, constrained: only cells
with buildings), the age groups of common.AGE_GROUPS (same grid), and density_2020 (people per km2, UNconstrained: it
spreads people over farmland too, so it shows dispersed rural presence the constrained count leaves out), resampled
nearest onto the 2026 grid. value = file value / scale.

Population weighted density (PWD) is the density the average person lives at (Craig 1984): arithmetic (pwdA),
geometric (pwdG) and median (pwdM), per GADM 3.6 level-1 unit, which still shows F.A.T.A. apart from Khyber
Pakhtunkhwa. The latest WorldPop publishes is 2020.
"""
from __future__ import annotations

import argparse
import csv
import io
import math
import zipfile
from pathlib import Path

import numpy as np

from common import AGE_GROUPS, WORLDPOP_TIF, WORLDPOP_YEAR, age_group_rasters, dump_json, load_yaml, setup_logging

log = setup_logging("population")

NODATA = 65535
PWD_YEAR = 2020


def dates(lock: dict, sid: str) -> dict:
    s = next((s for s in lock["sources"] if s["id"] == sid), {})
    return {"source": s.get("name"), "dataDate": s.get("dataDate"), "released": s.get("released")}


def to_u16(a: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, float]:
    """(uint16 block, scale) with value = file / scale; scale 1 unless the largest value needs a coarser step."""
    top = float(a[~mask].max()) if (~mask).any() else 0.0
    scale = 1.0 / math.ceil(top / (NODATA - 1)) if top > NODATA - 1 else 1.0
    v = np.clip(np.rint(a * scale), 0, NODATA - 1).astype(np.uint16)
    v[mask] = NODATA
    return v, scale


def read_pwd(path: Path) -> list[dict]:
    if not path.exists():
        return []
    z = zipfile.ZipFile(path)
    name = next((nm for nm in z.namelist() if nm.endswith(f"PWD_{PWD_YEAR}_sub_national_1km.csv")), None)
    if name is None:
        return []
    out = []
    for r in csv.DictReader(io.TextIOWrapper(z.open(name), encoding="utf-8", errors="replace")):
        if r.get("ISO") != "PAK":
            continue
        f = lambda k: round(float(r[k]), 1) if r.get(k) not in (None, "") else None       # noqa: E731
        out.append({"name": r["Adm_N"], "gid": r["GID_1"], "hasc": r["HASC"], "pop": int(float(r["Pop"])),
                    "density": f("Density"), "areaKm2": f("Area"), "pwdA": f("PWD_A"), "pwdG": f("PWD_G"),
                    "pwdM": f("PWD_M"), "centroid": [f("PWC_Lon"), f("PWC_Lat")]})
    return sorted(out, key=lambda r: -r["pop"])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", type=Path, default=Path("work/raw"))
    ap.add_argument("--lock", type=Path, default=Path("sources.lock"))
    ap.add_argument("--out", type=Path, default=Path("work/population"))
    args = ap.parse_args()

    import rasterio
    from rasterio.enums import Resampling
    from rasterio.warp import reproject

    lock = load_yaml(args.lock)
    args.out.mkdir(parents=True, exist_ok=True)
    with rasterio.open(WORLDPOP_TIF) as d:
        raw = d.read(1)
        tr, crs = d.transform, d.crs
        mask = ~np.isfinite(raw) | (raw < 0) | ((raw == d.nodata) if d.nodata is not None else False)
    pop = np.where(mask, 0.0, raw.astype("float64"))
    rows, cols = pop.shape
    layers = [dict({"id": "pop", "label": f"people in the cell ({WORLDPOP_YEAR}, constrained)", "unit": "people"},
                   **dates(lock, "worldpop"))]
    blocks = [pop]
    ages = age_group_rasters(pop.shape, tr)
    for k, (label, _bands) in AGE_GROUPS.items():
        if k in ages:
            layers.append(dict({"id": k, "label": f"{label} in the cell ({WORLDPOP_YEAR})", "unit": "people"},
                               **dates(lock, "worldpop_agesex")))
            blocks.append(ages[k])
    if not ages:
        log.warning("age-sex files missing or on another grid: no age layers")

    dens = sorted((args.raw / "worldpop_density").glob("*.tif"))
    if dens:
        dst = np.zeros(pop.shape, "float32")
        with rasterio.open(dens[-1]) as d:
            src = d.read(1).astype("float32")
            src[~np.isfinite(src) | (src < 0)] = 0
            reproject(src, dst, src_transform=d.transform, src_crs=d.crs, src_nodata=None, dst_transform=tr,
                      dst_crs=crs, resampling=Resampling.nearest)
        layers.append(dict({"id": "density_2020", "label": "people per km2 (2020, unconstrained)", "unit": "people/km2"},
                           **dates(lock, "worldpop_density")))
        blocks.append(dst.astype("float64"))
    else:
        log.warning("no WorldPop density file in %s", args.raw / "worldpop_density")

    out = []
    for lay, a in zip(layers, blocks):
        v, sc = to_u16(a, mask)
        lay["scale"] = sc
        out.append(v)
        log.info("  %-14s total %12.0f  max %9.0f  scale %g", lay["id"], a[~mask].sum(), a[~mask].max(), sc)
    np.stack(out).astype("<u2").tofile(args.out / "population.bin")
    provinces = read_pwd(args.raw / "worldpop_pwd" / "PWD_1km_sub_national_SCV.zip")
    dump_json(args.out / "population.json", {
        "format": "pams-population-grid", "version": 1,
        "bounds": [tr.c, tr.f + tr.e * rows, tr.c + tr.a * cols, tr.f], "cell": tr.a, "cols": cols, "rows": rows,
        "dtype": "uint16-le", "nodata": NODATA,
        "layout": "layers x rows x cols; row 0 is the north row; value = file value / scale",
        "layers": layers, "file": "population.bin",
        "total": int(round(pop.sum())), "year": WORLDPOP_YEAR,
        "provinces": {"year": PWD_YEAR, "units": "GADM 3.6 level 1", "note": "pwdA / pwdG / pwdM = population weighted "
                      "density (arithmetic / geometric / median), people per km2; centroid = population weighted "
                      "centre [lon, lat]", "rows": provinces, **dates(lock, "worldpop_pwd")}})
    log.info("population: %d x %d cells, %d layers, %.1f M people (%d), %d provinces -> %s (%.1f MB)", cols, rows,
             len(layers), pop.sum() / 1e6, WORLDPOP_YEAR, len(provinces), args.out,
             (args.out / "population.bin").stat().st_size / 1e6)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
