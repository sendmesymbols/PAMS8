"""Step 4e — wind climatology grid (Ground Guide W and the IPB air / NBC readings: which way the wind usually blows).

Inputs : work/raw/era5_wind/*.npy + coords.json (fetch_era5_wind.py), sources.lock (names the source and its dates)
Outputs: work/wind/wind.bin   little-endian int16, layers in the order of wind.json `layers`, each [rows][cols], north
                              row first; value = file value / scale (m/s). No nodata: ERA5 covers land and sea.
         work/wind/wind.json  header: the grid of POINTS (lat0 north, lon0 west, step, rows, cols: read bilinearly
                              between them), hours UTC, months, layers with units and scale, caveats

Layers per month MM (01-12) and hour HH (00 / 06 / 12 / 18 UTC = 05 / 11 / 17 / 23 PKT):
  u_MM_HH, v_MM_HH   the mean 10 m wind vector (m/s toward east / north): its direction is where the wind usually
                     blows FROM (atan2(-u, -v)) and its length the steady part of the wind
  s_MM_HH            the mean 10 m wind speed (m/s): |mean vector| / s is the steadiness (1 = always the same way,
                     near 0 = it blows from all sides and the mean direction means little)

What the numbers are (and are not):
  * ERA5 at 0.25 degrees (~28 km): valleys, nullahs and sea breezes narrower than that are not in it. In the mountains
    the wind on the ground follows the valley, by day up it, by night down it; the grid gives the air above.
  * A 1990-2019 normal (WeatherBench 2: a 61-day window round each day of the year), not a forecast, not the hour of
    the operation, and no gusts. Met gives the wind on the day.

    python scripts/wind.py --raw work/raw --lock sources.lock --out work/wind
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from common import dump_json, load_yaml, setup_logging, source_ref

log = setup_logging("wind")

SCALE = 100                                        # 0.01 m/s
HOURS_UTC = (0, 6, 12, 18)
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def load_month(raw: Path, short: str, m: int) -> np.ndarray:
    """[4 hours][lat][lon] float32 of one variable and month (hour chunk 0 holds 00 / 06 / 12 UTC, chunk 1 18 UTC)."""
    a = np.load(raw / f"{short}_{m:02d}_0.npy")
    b = np.load(raw / f"{short}_{m:02d}_1.npy")
    assert a.shape[0] == 3 and b.shape[0] == 1, f"{short} {m}: hour chunks {a.shape} / {b.shape}"
    return np.concatenate([a, b], axis=0)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", type=Path, default=Path("work/raw"))
    ap.add_argument("--lock", type=Path, default=Path("sources.lock"))
    ap.add_argument("--out", type=Path, default=Path("work/wind"))
    args = ap.parse_args()

    src = args.raw / "era5_wind"
    coords = json.loads((src / "coords.json").read_text(encoding="utf-8"))
    lat, lon = np.array(coords["lat"]), np.array(coords["lon"])
    rows, cols = len(lat), len(lon)
    step = float(lon[1] - lon[0])
    assert abs(float(lat[0] - lat[1]) - step) < 1e-6, "lat and lon steps differ"

    layers, blocks = [], []
    steady_lo = 0
    for m in range(1, 13):
        u, v, s = (load_month(src, k, m) for k in ("u", "v", "s"))
        assert u.shape == (4, rows, cols), u.shape
        vec = np.hypot(u, v)
        bad = (vec > s + 0.05).sum()                           # |mean vector| can never exceed the mean speed
        if bad:
            log.warning("month %d: %d cells where |mean vector| > mean speed + 0.05 m/s", m, int(bad))
        steady_lo += int((vec < 0.3 * np.maximum(s, 1e-6)).sum())
        for hi, h in enumerate(HOURS_UTC):
            for name, arr in (("u", u), ("v", v), ("s", s)):
                layers.append({"id": f"{name}_{m:02d}_{h:02d}", "unit": "m/s", "scale": SCALE})
                blocks.append(np.clip(np.rint(arr[hi] * SCALE), -32767, 32767).astype("<i2"))
    args.out.mkdir(parents=True, exist_ok=True)
    np.stack(blocks).astype("<i2").tofile(args.out / "wind.bin")
    lock = load_yaml(args.lock) if args.lock.exists() else None
    dump_json(args.out / "wind.json", {
        "format": "pams-wind-grid", "version": 1,
        "source": "ERA5 10 m wind, 1990-2019 hourly climatology (WeatherBench 2), 0.25 degrees",
        "sourceRef": source_ref(lock, "era5_wind"),
        "lat0": float(lat[0]), "lon0": float(lon[0]), "step": step, "rows": rows, "cols": cols,
        "dtype": "int16-le", "layout": "layers x rows x cols; row 0 is the north row; the values are at grid POINTS (lat0 - row x step, lon0 + col x step): read bilinearly",
        "hoursUtc": list(HOURS_UTC), "months": list(MONTHS), "daysOfYear": coords.get("daysOfYear"),
        "caveats": [
            "A 1990-2019 normal at 0.25 degrees (~28 km), not a forecast: Met gives the wind on the day.",
            "Valley, nullah and sea-breeze winds narrower than the grid are not in it; in the mountains the ground wind follows the valley.",
            "Steadiness = |mean vector| / mean speed: under about 0.3 the wind blows from many sides and its mean direction means little.",
            "No gusts: the mean speed is not the strongest wind.",
        ],
        "layers": layers, "file": "wind.bin"})
    log.info("wind: %d x %d points, %d layers, %.2f MB -> %s; %d hour-cells with steadiness < 0.3",
             cols, rows, len(layers), (args.out / "wind.bin").stat().st_size / 1e6, args.out, steady_lo)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
