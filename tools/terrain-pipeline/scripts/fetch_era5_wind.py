"""Fetch the ERA5 10 m wind climatology over the aoi (Ground Guide wind: direction, steadiness, day / night).

Source : WeatherBench 2 ERA5 hourly climatology 1990-2019, 0.25 degrees, 00 / 06 / 12 / 18 UTC (Google public bucket
         gs://weatherbench2, read over HTTPS without an account). Variables 10m_u_component_of_wind,
         10m_v_component_of_wind and 10m_wind_speed (the mean of the hourly speed, so |mean vector| / mean speed says how
         steady the wind is). sources.lock id `era5_wind`.

The zarr is chunked 3 hours x 3 days x the whole globe (blosc / lz4, about 28 MB a chunk), so a region cannot be cut
before download. This reads ONE chunk of days per month, the three days round the 15th, for both hour chunks
(00 / 06 / 12 UTC and 18 UTC) and the three variables: 12 x 2 x 3 = 72 chunks, about 1.4 GB, each decoded, averaged
over its three days, cut to the aoi (+ pad) and kept as a small .npy; the chunk itself is not kept. A re-run skips the
months already done. WeatherBench 2 builds its climatology with a 61-day window round each day of the year, so three
days round the 15th stand for the month.

Outputs: work/raw/era5_wind/<var>_<MM>_<hchunk>.npy   float32 [hours in the chunk][lat][lon], m/s
         work/raw/era5_wind/coords.json                 lat (north first) / lon of the cut, hours UTC, days read
         work/raw/era5_wind/chunks.json                 per chunk: url, bytes, sha256 (the raw chunk as served)

    python scripts/fetch_era5_wind.py --grid work/grid/grid.json --out work/raw --workers 3
"""
from __future__ import annotations

import argparse
import hashlib
import json
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np

from common import load_json, setup_logging

log = setup_logging("fetch_era5_wind")

BASE = "https://storage.googleapis.com/weatherbench2/datasets/era5-hourly-climatology/1990-2019_6h_1440x721.zarr"
VARS = ("10m_u_component_of_wind", "10m_v_component_of_wind", "10m_wind_speed")
SHORT = {"10m_u_component_of_wind": "u", "10m_v_component_of_wind": "v", "10m_wind_speed": "s"}
MID_DOY = (15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349)     # the 15th of each month, non-leap day of year
CHUNK = (3, 3, 721, 1440)                                               # hour, dayofyear, lat, lon
HOURS_UTC = (0, 6, 12, 18)


def http_get(url: str, tries: int = 4) -> bytes:
    for k in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=300) as r:
                return r.read()
        except Exception as e:                     # noqa: BLE001 - network: retry, then give up loudly
            if k == tries - 1:
                raise
            log.warning("%s: %s; retry %d", url, e, k + 1)
            time.sleep(5 * (k + 1))
    raise RuntimeError("unreachable")


def decode(raw: bytes) -> np.ndarray:
    import numcodecs
    return np.frombuffer(numcodecs.Blosc().decode(raw), dtype="<f4").reshape(CHUNK)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--grid", type=Path, default=Path("work/grid/grid.json"))
    ap.add_argument("--out", type=Path, default=Path("work/raw"))
    ap.add_argument("--pad", type=float, default=0.5, help="degrees round the aoi (bilinear reads at the edge)")
    ap.add_argument("--workers", type=int, default=3)
    args = ap.parse_args()

    w, s, e, n = (float(v) for v in load_json(args.grid)["aoi"])
    out = args.out / "era5_wind"
    out.mkdir(parents=True, exist_ok=True)
    lat = 90.0 - 0.25 * np.arange(721)
    lon = 0.25 * np.arange(1440)
    r0, r1 = int(np.searchsorted(-lat, -(n + args.pad))), int(np.searchsorted(-lat, -(s - args.pad), side="right"))
    c0, c1 = int(np.searchsorted(lon, w - args.pad)), int(np.searchsorted(lon, e + args.pad, side="right"))
    assert 0 <= c0 < c1 <= 1440 and 0 <= r0 < r1 <= 721, "the aoi must not cross 0 / 180 degrees"
    days = {m + 1: [3 * ((d - 1) // 3) + k + 1 for k in range(3)] for m, d in enumerate(MID_DOY)}
    (out / "coords.json").write_text(json.dumps({
        "lat": [float(x) for x in lat[r0:r1]], "lon": [float(x) for x in lon[c0:c1]], "hoursUtc": list(HOURS_UTC),
        "daysOfYear": days, "source": BASE, "note": "lat north first; values m/s; the mean over the three days of each month's chunk",
    }, indent=1), encoding="utf-8")

    sums_path = out / "chunks.json"
    sums = json.loads(sums_path.read_text(encoding="utf-8")) if sums_path.exists() else {}
    jobs = []
    for m, d in enumerate(MID_DOY, start=1):
        j = (d - 1) // 3
        for var in VARS:
            for hc in (0, 1):
                dst = out / f"{SHORT[var]}_{m:02d}_{hc}.npy"
                if dst.exists() and dst.name in sums:
                    continue
                jobs.append((var, m, hc, j, dst))
    log.info("%d chunks to fetch (%d done); cut rows %d-%d, cols %d-%d", len(jobs), 72 - len(jobs), r0, r1, c0, c1)

    def one(job):
        var, m, hc, j, dst = job
        url = f"{BASE}/{var}/{hc}.{j}.0.0"
        raw = http_get(url)
        a = decode(raw)
        nh = 3 if hc == 0 else 1                                       # the last hour chunk holds 18 UTC + padding
        cut = a[:nh, :, r0:r1, c0:c1].mean(axis=1).astype("float32")   # mean of the three days
        if not np.isfinite(cut).all():
            raise ValueError(f"{url}: NaN in the cut")
        np.save(dst, cut)
        return dst.name, {"url": url, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}

    t0, done_mb = time.time(), 0.0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(one, jb) for jb in jobs]
        for k, f in enumerate(as_completed(futs), start=1):
            name, info = f.result()
            sums[name] = info
            done_mb += info["bytes"] / 1e6
            sums_path.write_text(json.dumps(sums, indent=1, sort_keys=True), encoding="utf-8")
            log.info("%d/%d %s  %.0f MB in %.0f s", k, len(jobs), name, done_mb, time.time() - t0)
    total = sum(v["bytes"] for v in sums.values()) / 1e6
    log.info("era5 wind: %d chunks, %.0f MB read in all -> %s", len(sums), total, out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
