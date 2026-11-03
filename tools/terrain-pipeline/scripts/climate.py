"""Step 4c — climate normals grid (GROTBC T, weather and climate) from WorldClim 2.1.

Inputs : work/raw/worldclim/wc2.1_5m_{tmin,tmax,prec,wind}.zip (fetch.py), grid.json aoi
Outputs: work/climate/climate.bin   little-endian int16, layers in the order of climate.json `layers`, each
                                    [rows][cols], north row first; -32768 = no data (sea)
         work/climate/climate.json  header: bounds, cell size, rows, cols, layer list with units and scale

Monthly layers (tmin_01 ... wind_12): tmin / tmax in 0.1 degC, prec in mm, wind in 0.1 m/s.
Summary layers: tmean (0.1 degC, mean of the monthly (tmin + tmax) / 2), prec_year (mm), monsoon_pct (% of the
year's rain that falls June-September), frost_months (months with tmin below 0), hot_months (tmax of 40 or more),
wet_months (100 mm or more). WorldClim is the 1970-2000 normal at 5 arc-minutes (~9 km): it says what a month is
usually like, it is not a forecast, and it smooths valleys and ridges.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

from common import dump_json, load_json, setup_logging

log = setup_logging("climate")

NODATA = -32768
CELL = 1.0 / 12.0                      # 5 arc-minutes
VARS = (("tmin", 10.0, "0.1 degC"), ("tmax", 10.0, "0.1 degC"), ("prec", 1.0, "mm"), ("wind", 10.0, "0.1 m/s"))


def read_var(raw: Path, name: str, scale: float, aoi: tuple) -> np.ndarray:
    """12 x rows x cols int16 of one WorldClim variable over the aoi."""
    import rasterio
    from rasterio.windows import from_bounds
    w, s, e, n = aoi
    out = []
    zpath = raw / "worldclim" / f"wc2.1_5m_{name}.zip"
    for m in range(1, 13):
        with rasterio.open(f"/vsizip/{zpath.as_posix()}/wc2.1_5m_{name}_{m:02d}.tif") as d:
            win = from_bounds(w, s, e, n, d.transform).round_offsets().round_lengths()
            a = d.read(1, window=win).astype("float64")
            bad = ~np.isfinite(a) | (a < -1e4)
        v = np.rint(a * scale)
        v[bad] = NODATA
        out.append(np.clip(v, NODATA, 32767).astype(np.int16))
    return np.stack(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--grid", type=Path, default=Path("work/grid/grid.json"))
    ap.add_argument("--raw", type=Path, default=Path("work/raw"))
    ap.add_argument("--out", type=Path, default=Path("work/climate"))
    args = ap.parse_args()

    aoi = tuple(float(v) for v in load_json(args.grid)["aoi"])
    args.out.mkdir(parents=True, exist_ok=True)
    data = {n: read_var(args.raw, n, sc, aoi) for n, sc, _u in VARS}
    rows, cols = data["tmin"].shape[1:]
    land = (data["tmin"] != NODATA).all(axis=0) & (data["prec"] != NODATA).all(axis=0)

    tmean = np.where(land, np.rint((data["tmin"].astype("int32") + data["tmax"].astype("int32")).mean(axis=0) / 2), NODATA)
    prec = data["prec"].astype("float32")
    year = prec.sum(axis=0)
    monsoon = np.where(year > 0, 100.0 * prec[5:9].sum(axis=0) / np.maximum(year, 1e-6), 0)
    summary = {
        "tmean": tmean,
        "prec_year": np.where(land, np.minimum(year, 32767), NODATA),
        "monsoon_pct": np.where(land, np.rint(monsoon), NODATA),
        "frost_months": np.where(land, (data["tmin"] < 0).sum(axis=0), NODATA),
        "hot_months": np.where(land, (data["tmax"] >= 400).sum(axis=0), NODATA),
        "wet_months": np.where(land, (data["prec"] >= 100).sum(axis=0), NODATA),
    }
    layers, blocks = [], []
    for n, sc, unit in VARS:
        for m in range(12):
            layers.append({"id": f"{n}_{m + 1:02d}", "unit": unit, "scale": sc})
            blocks.append(data[n][m])
    units = {"tmean": ("0.1 degC", 10), "prec_year": ("mm", 1), "monsoon_pct": ("%", 1), "frost_months": ("months", 1),
             "hot_months": ("months", 1), "wet_months": ("months", 1)}
    for n, arr in summary.items():
        layers.append({"id": n, "unit": units[n][0], "scale": units[n][1]})
        blocks.append(np.rint(arr).astype(np.int16))
    np.stack(blocks).astype("<i2").tofile(args.out / "climate.bin")
    w, s, e, n = aoi
    dump_json(args.out / "climate.json", {
        "format": "pams-climate-grid", "version": 1, "source": "WorldClim 2.1, 1970-2000 normals, 5 arc-minutes",
        "bounds": [w, s, e, n], "cell": CELL, "cols": cols, "rows": rows, "dtype": "int16-le", "nodata": NODATA,
        "layout": "layers x rows x cols; row 0 is the north row; value = file value / scale",
        "months": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
        "thresholds": {"frostBelowC": 0, "hotFromC": 40, "wetFromMm": 100, "monsoonMonths": "Jun-Sep"},
        "layers": layers, "file": "climate.bin"})
    log.info("climate: %d x %d cells, %d layers, %d land cells -> %s (%.1f MB)", cols, rows, len(layers), int(land.sum()),
             args.out, (args.out / "climate.bin").stat().st_size / 1e6)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
