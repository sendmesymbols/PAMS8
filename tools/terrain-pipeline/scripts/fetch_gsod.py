"""Step 1c — NOAA NCEI Global Summary of the Day (GSOD): daily station records for the visibility climatology.

GSOD is one CSV per station per year, so fetch.py's one-file-per-entry model does not fit; like fetch_soil.py this step
fetches by itself (sources.lock `gsod` carries `fetched_by: scripts/fetch_gsod.py`) and records the hashes in
work/raw/checksums.json under `gsod`.

    1. work/raw/gsod/isd-history.csv      the station list (USAF, WBAN, name, country, lat, lon, elevation, BEGIN, END)
    2. stations inside the data extent (grid.json aoi, else --aoi) plus --margin degrees, that reported across --begin-by
       .. --end-after, are written to work/raw/gsod/stations_selected.json
    3. work/raw/gsod/<year>/<USAF><WBAN>.csv for every selected station and year of --years. HTTP 404 means the station
       did not report that year; it is remembered in work/raw/gsod/missing.json so a re-run does not ask again.

Polite: a few parallel requests, a short pause between them, retries with backoff, a generic User-Agent. Files that
exist are not fetched again. NCEI's usage statement for GSOD: "free and unrestricted use in research, education, and
other non-commercial activities. However, for non-U.S. locations' data, the data or any derived product shall not be
provided to other users or be used for the re-export of commercial services." (readme.txt, 10/28/2020)

    python scripts/fetch_gsod.py --years 2016-2025 --workers 3
"""
from __future__ import annotations

import argparse
import csv
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from common import dump_json, load_json, setup_logging
from fetch import hash_source, sha256_file

log = setup_logging("fetch_gsod")

BASE = "https://www.ncei.noaa.gov/data/global-summary-of-the-day"
HISTORY_URL = "https://www.ncei.noaa.gov/pub/data/noaa/isd-history.csv"
UA = "terrain-pipeline/0.1"     # generic on purpose: nothing about the user or the project goes to the server
DEFAULT_AOI = (59.5, 20.5, 80.5, 37.5)


def get(url: str, retries: int = 4, timeout: int = 90) -> bytes | None:
    """The body of url, None for HTTP 404, an exception after the retries."""
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None
            err: Exception = exc
        except Exception as exc:        # network hiccup, timeout, reset
            err = exc
        if attempt + 1 < retries:
            time.sleep(1.5 * (attempt + 1) ** 2)
    raise RuntimeError(f"{url}: {err}")


def station_id(row: dict) -> str:
    return f"{row['USAF'].strip():0>6}{row['WBAN'].strip():0>5}"


def select_stations(history: Path, aoi: tuple, margin: float, begin_by: str, end_after: str) -> list[dict]:
    w, s, e, n = aoi
    out = []
    with open(history, encoding="utf-8", errors="replace", newline="") as f:
        for r in csv.DictReader(f):
            try:
                lat, lon = float(r["LAT"]), float(r["LON"])
            except ValueError:
                continue
            if not (w - margin <= lon <= e + margin and s - margin <= lat <= n + margin):
                continue
            if not (r["BEGIN"] <= begin_by and r["END"] >= end_after):
                continue
            try:
                elev = float(r["ELEV(M)"])
            except ValueError:
                elev = None
            out.append({"id": station_id(r), "name": r["STATION NAME"].strip(), "country": r["CTRY"].strip(),
                        "lat": lat, "lon": lon, "elev": elev, "begin": r["BEGIN"], "end": r["END"]})
    return sorted(out, key=lambda x: x["id"])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--grid", type=Path, default=Path("work/grid/grid.json"))
    ap.add_argument("--aoi", default=None, help="w,s,e,n (default: grid.json aoi)")
    ap.add_argument("--margin", type=float, default=1.0, help="degrees of stations beyond the extent (interpolation edge)")
    ap.add_argument("--years", default="2016-2025", help="first-last, inclusive")
    ap.add_argument("--begin-by", default="20230101", help="station BEGIN must be on or before this (YYYYMMDD)")
    ap.add_argument("--end-after", default="20230101", help="station END must be on or after this (YYYYMMDD)")
    ap.add_argument("--out", type=Path, default=Path("work/raw"))
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--pause", type=float, default=0.05, help="seconds each worker waits after a request")
    ap.add_argument("--refresh-history", action="store_true")
    args = ap.parse_args()

    if args.aoi:
        aoi = tuple(float(v) for v in args.aoi.split(","))
    elif args.grid.exists():
        aoi = tuple(float(v) for v in load_json(args.grid)["aoi"])
    else:
        aoi = DEFAULT_AOI
    y0, y1 = (int(v) for v in args.years.split("-"))
    root = args.out / "gsod"
    root.mkdir(parents=True, exist_ok=True)

    history = root / "isd-history.csv"
    if args.refresh_history or not history.exists():
        body = get(HISTORY_URL)
        if body is None:
            log.error("%s: HTTP 404", HISTORY_URL)
            return 1
        history.write_bytes(body)
        log.info("isd-history.csv: %.1f MB", len(body) / 1e6)
    stations = select_stations(history, aoi, args.margin, args.begin_by, args.end_after)
    dump_json(root / "stations_selected.json", {"aoi": list(aoi), "margin": args.margin, "years": [y0, y1],
                                                "beginBy": args.begin_by, "endAfter": args.end_after, "stations": stations})
    log.info("%d stations inside %s + %.1f deg, reporting across %s..%s", len(stations), aoi, args.margin,
             args.begin_by, args.end_after)

    miss_path = root / "missing.json"
    missing = set(load_json(miss_path)) if miss_path.exists() else set()
    todo = [(y, st["id"]) for y in range(y0, y1 + 1) for st in stations
            if not (root / str(y) / f"{st['id']}.csv").exists() and f"{y}/{st['id']}" not in missing]
    log.info("%d station-years to fetch (%d already on disk, %d known missing)", len(todo),
             sum(1 for y in range(y0, y1 + 1) for st in stations if (root / str(y) / f"{st['id']}.csv").exists()),
             len(missing))

    def one(y: int, sid: str) -> str:
        body = get(f"{BASE}/access/{y}/{sid}.csv")
        time.sleep(args.pause)
        if body is None:
            return "404"
        d = root / str(y)
        d.mkdir(exist_ok=True)
        tmp = d / f"{sid}.csv.part"
        tmp.write_bytes(body)
        tmp.replace(d / f"{sid}.csv")
        return "ok"

    done = bad = 0
    failures: list[str] = []
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
        futs = {ex.submit(one, y, sid): (y, sid) for y, sid in todo}
        for i, fut in enumerate(as_completed(futs), 1):
            y, sid = futs[fut]
            try:
                res = fut.result()
            except Exception as exc:
                failures.append(f"{y}/{sid}: {exc}")
                continue
            if res == "404":
                missing.add(f"{y}/{sid}")
                bad += 1
            else:
                done += 1
            if i % 200 == 0:
                log.info("  %d / %d (%.0f s)", i, len(todo), time.time() - t0)
                dump_json(miss_path, sorted(missing))
    dump_json(miss_path, sorted(missing))
    for f in failures[:20]:
        log.warning("failed: %s", f)

    files = {f"{p.parent.name}/{p.name}": sha256_file(p) for p in sorted(root.glob("[0-9][0-9][0-9][0-9]/*.csv"))}
    total = sum(p.stat().st_size for p in root.glob("[0-9][0-9][0-9][0-9]/*.csv"))
    checks_path = args.out / "checksums.json"
    checks = load_json(checks_path) if checks_path.exists() else {}
    checks["gsod"] = dict(files=files, sha256=hash_source(files))
    dump_json(checks_path, checks)
    log.info("gsod: %d files on disk (%.1f MB), %d fetched now, %d stations did not report that year, %d failed",
             len(files), total / 1e6, done, bad, len(failures))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
