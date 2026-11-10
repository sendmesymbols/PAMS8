"""Step 4d — visibility climatology grid (OCOKA Observation: how far the weather lets a soldier see, by month).

Inputs : work/raw/gsod/<year>/<station>.csv + stations_selected.json (fetch_gsod.py), work/climate/climate.json + .bin
         (the grid and the land mask), sources.lock (names the source's location and dates)
Outputs: work/visibility/stations.json    per station and month: days, mean visibility, share of days with a poor view,
                                          fog and haze/dust days; the quality notes
         work/visibility/visibility.bin   little-endian int16, layers in the order of visibility.json `layers`, each
                                          [rows][cols], north row first, same 5 arc-minute grid as climate.bin;
                                          -32768 = no data (sea, or no station within 300 km)
         work/visibility/visibility.json  header: bounds, cell size, rows, cols, layer list with units and scale, caveats

Layers (per month 01..12): vis_mean_NN (0.1 km), lt2km_NN (% of days with a daily mean view under 2 km), haze_NN (% of
days with a daily mean view under 3 km and no fog / rain / snow / hail / thunder flag: a proxy for dust, haze and
smog), fog_NN (% of days with the fog flag). Plus `dist`: km to the nearest station with at least 6 usable months (capped at 999): a station with one good month does not make a cell "near a station".

What the numbers are (and are not):
  * GSOD VISIB is the DAILY MEAN of the day's reports (miles to tenths, 999.9 = missing). A fog bank at dawn that lifts
    by nine does not pull the mean under 2 km, so lt2km and haze UNDERSTATE short bad-view episodes. They say how often
    a whole day is poor, not how often it is poor at some hour.
  * Some stations never report more than 10 miles (16 km): their mean saturates and a clear mountain day looks the same
    as a clear plain day. Compare places only inside what the station can report. Stations that report up to 50 km
    (Tajikistan, Uzbekistan) would drag the mean up, so the daily view is CAPPED at 10 miles (16.1 km) in vis_mean;
    the shares under 2 / 5 km are not affected by the cap.
  * The fog flag and the weather flags are the stations' own coded reports. A station that flags no weather at all in
    ten years is not trusted for fog and haze (flags_reported false) and is left out of those two layers.
  * haze_dust_pct is a PROXY: poor view on a day without any fog / rain / snow / hail / thunder flag. Dust storms, smoke
    and smog all land here; so does a station that simply does not code its weather.
  * Interpolation is inverse-distance from the nearest 4 stations within 300 km, with no height correction: valleys,
    smoke plumes and irrigated plains differ from the nearest airport. Treat a cell as "what the nearest airport sees".

    python scripts/visibility.py --raw work/raw --climate work/climate --out work/visibility
"""
from __future__ import annotations

import argparse
import csv
from pathlib import Path

import numpy as np

from common import dump_json, load_json, load_yaml, setup_logging, source_ref

log = setup_logging("visibility")

NODATA = -32768
MI_KM = 1.609344
LT1_KM, LT2_KM, LT5_KM = 1.0, 2.0, 5.0           # a day's mean view under these counts as poor (station summary)
HAZE_KM = 3.0                                    # the haze / dust proxy: a poor view of 3 km or less (5 km flagged 45-90 % of ordinary plains days, 2026-11-10)
CAP_KM = 10 * MI_KM                              # the mean view is capped at 10 miles: some stations report up to 50 km, most stop near 10 miles
MIN_DAYS = 90                                    # valid days a station-month needs (about 3 years of a 30-day month)
MIN_YEARS = 3
MIN_FLAG_DAYS = 30                               # days with any fog / rain / snow / hail / thunder flag, over the whole record
IDW_K, IDW_MAX_KM, IDW_POWER, IDW_MIN_KM = 4, 300.0, 2.0, 5.0
DIST_CAP_KM = 999
DIST_MIN_MONTHS = 6                              # `dist` counts only stations with this many usable months of mean view
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
GROUPS = (("vis_mean", "0.1 km", 10), ("lt2km", "% of days", 1), ("haze", "% of days", 1), ("fog", "% of days", 1))


def read_station(files: list[Path]) -> dict:
    """Daily records of one station over the years: per month counters (index 1..12) and per-year valid-day counts."""
    z = lambda: np.zeros(13, dtype="float64")
    c = {k: z() for k in ("days", "vis_sum", "lt1", "lt2", "lt5", "fog", "haze", "flag_days")}
    years: dict[int, set] = {m: set() for m in range(1, 13)}
    total_days = flag_days = 0
    top: dict[float, int] = {}                       # daily view (miles) -> days: shows the station's report ceiling
    for f in files:
        with open(f, encoding="utf-8", errors="replace", newline="") as fh:
            for row in csv.DictReader(fh):
                try:
                    v = float(row["VISIB"])
                    month = int(row["DATE"][5:7])
                    year = int(row["DATE"][:4])
                except (KeyError, ValueError):
                    continue
                if v >= 999.0 or v < 0:                       # 999.9 = missing
                    continue
                km = v * MI_KM
                fr = (row.get("FRSHTT") or "").strip().rjust(6, "0")
                flagged = any(ch == "1" for ch in fr[:5])     # fog, rain/drizzle, snow/ice, hail, thunder
                c["days"][month] += 1
                c["vis_sum"][month] += min(km, CAP_KM)
                top[round(v, 1)] = top.get(round(v, 1), 0) + 1
                c["lt1"][month] += km < LT1_KM
                c["lt2"][month] += km < LT2_KM
                c["lt5"][month] += km < LT5_KM
                c["fog"][month] += fr[0] == "1"
                c["haze"][month] += (km < HAZE_KM) and not flagged
                years[month].add(year)
                total_days += 1
                flag_days += flagged
    return {"c": c, "years": years, "total_days": total_days, "flag_days": flag_days, "top": top}


def station_record(st: dict, data: dict, min_days: int = MIN_DAYS, min_years: int = MIN_YEARS) -> dict:
    c, years = data["c"], data["years"]
    flags_ok = data["flag_days"] >= MIN_FLAG_DAYS
    months = {}
    for m in range(1, 13):
        n = int(c["days"][m])
        ok = n >= min_days and len(years[m]) >= min_years
        months[str(m)] = {
            "days": n, "years": len(years[m]),
            "vis_mean_km": round(c["vis_sum"][m] / n, 2) if ok else None,
            "p_lt1km": round(100 * c["lt1"][m] / n, 1) if ok else None,
            "p_lt2km": round(100 * c["lt2"][m] / n, 1) if ok else None,
            "p_lt5km": round(100 * c["lt5"][m] / n, 1) if ok else None,
            "fog_pct": round(100 * c["fog"][m] / n, 1) if ok and flags_ok else None,
            "haze_dust_pct": round(100 * c["haze"][m] / n, 1) if ok and flags_ok else None,
        }
    all_years = sorted({y for m in range(1, 13) for y in years[m]})
    total = max(1, data["total_days"])
    ceiling = max((v for v, n in data["top"].items() if n >= 0.02 * total), default=None)   # highest view reported on 2 % of days or more
    return {"id": st["id"], "name": st["name"], "country": st["country"], "lat": st["lat"], "lon": st["lon"],
            "elev": st["elev"], "years": all_years, "valid_days": data["total_days"], "flags_reported": flags_ok,
            "ceiling_km": round(ceiling * MI_KM, 1) if ceiling else None,
            "months": months}


def haversine_km(lat1, lon1, lat2, lon2):
    """Great-circle km between arrays broadcast against each other (degrees in)."""
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dphi = p2 - p1
    dl = np.radians(lon2 - lon1)
    a = np.sin(dphi / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * 6371.0088 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def idw(dist: np.ndarray, vals: np.ndarray) -> np.ndarray:
    """dist [cells x stations] (km, inf = not usable), vals [stations] -> [cells] float, NaN where nothing is within range."""
    k = min(IDW_K, dist.shape[1])
    idx = np.argpartition(dist, k - 1, axis=1)[:, :k]
    d = np.take_along_axis(dist, idx, axis=1)
    w = np.where(d <= IDW_MAX_KM, 1.0 / np.maximum(d, IDW_MIN_KM) ** IDW_POWER, 0.0)
    v = np.where(w > 0, vals[idx], 0.0)          # a NaN of an unusable station must not poison the sum
    sw = w.sum(axis=1)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(sw > 0, (w * v).sum(axis=1) / sw, np.nan)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", type=Path, default=Path("work/raw"))
    ap.add_argument("--climate", type=Path, default=Path("work/climate"), help="climate.json / .bin: the grid and the land mask")
    ap.add_argument("--lock", type=Path, default=Path("sources.lock"), help="names the source's location and dates")
    ap.add_argument("--out", type=Path, default=Path("work/visibility"))
    ap.add_argument("--min-days", type=int, default=MIN_DAYS, help="valid days a station-month needs (test runs on a partial download)")
    ap.add_argument("--min-years", type=int, default=MIN_YEARS)
    args = ap.parse_args()

    root = args.raw / "gsod"
    sel = load_json(root / "stations_selected.json")
    cj = load_json(args.climate / "climate.json")
    w, s, e, n = cj["bounds"]
    cell, cols, rows = cj["cell"], cj["cols"], cj["rows"]
    ids = [L["id"] for L in cj["layers"]]
    clim = np.fromfile(args.climate / cj["file"], dtype="<i2").reshape(len(ids), rows, cols)
    land = clim[ids.index("tmin_01")] != cj["nodata"]

    recs = []
    for st in sel["stations"]:
        files = sorted(root.glob(f"[0-9][0-9][0-9][0-9]/{st['id']}.csv"))
        if not files:
            continue
        rec = station_record(st, read_station(files), args.min_days, args.min_years)
        if any(m["vis_mean_km"] is not None for m in rec["months"].values()):
            recs.append(rec)
    log.info("%d of %d selected stations have at least one usable month", len(recs), len(sel["stations"]))
    if not recs:
        log.error("no station data under %s - run fetch_gsod.py", root)
        return 1

    # ---- quality notes
    notes = []
    for r in recs:
        means = [m["vis_mean_km"] for m in r["months"].values() if m["vis_mean_km"] is not None]
        low1 = [m["p_lt1km"] for m in r["months"].values() if m["p_lt1km"] is not None]
        if not means:
            continue
        ann = sum(means) / len(means)
        if ann < 1.5:
            notes.append(f"{r['id']} {r['name']}: mean view {ann:.1f} km all year - check the station")
        if max(low1) > 50:
            notes.append(f"{r['id']} {r['name']}: more than half the days under 1 km in one month")
        if len(means) < 12:
            notes.append(f"{r['id']} {r['name']}: only {len(means)} usable months")
        if not r["flags_reported"]:
            notes.append(f"{r['id']} {r['name']}: reports no weather flags - left out of the fog and haze layers")
        if r.get("ceiling_km") and r["ceiling_km"] > 25:
            notes.append(f"{r['id']} {r['name']}: reports views up to {r['ceiling_km']:.0f} km (most stations stop at ~16 km): its mean view is capped at 16 km, shares under 2 / 5 km are unaffected")

    # ---- grid
    lon_c = w + (np.arange(cols) + 0.5) * cell
    lat_c = n - (np.arange(rows) + 0.5) * cell
    rr, cc = np.nonzero(land)
    clat, clon = lat_c[rr][:, None], lon_c[cc][:, None]
    slat = np.array([r["lat"] for r in recs])[None, :]
    slon = np.array([r["lon"] for r in recs])[None, :]
    D = haversine_km(clat, clon, slat, slon).astype("float32")   # [land cells x stations], km

    def month_vals(key: str, m: int) -> np.ndarray:
        return np.array([np.nan if r["months"][str(m)][key] is None else r["months"][str(m)][key] for r in recs], dtype="float64")

    keys = {"vis_mean": "vis_mean_km", "lt2km": "p_lt2km", "haze": "haze_dust_pct", "fog": "fog_pct"}
    layers, blocks = [], []
    used = np.zeros(len(recs), dtype=bool)
    for g, unit, scale in GROUPS:
        for m in range(1, 13):
            v = month_vals(keys[g], m)
            ok = np.isfinite(v)
            used |= ok
            Dm = np.where(ok[None, :], D, np.inf).astype("float32")
            out = idw(Dm, v)
            grid = np.full((rows, cols), NODATA, dtype="int16")
            good = np.isfinite(out)
            val = out * (scale if g == "vis_mean" else 1)
            grid[rr[good], cc[good]] = np.clip(np.rint(val[good]), 0, 32767).astype("int16")
            layers.append({"id": f"{g}_{m:02d}", "unit": unit, "scale": scale})
            blocks.append(grid)
    core = np.array([sum(r["months"][str(m)]["vis_mean_km"] is not None for m in range(1, 13)) >= DIST_MIN_MONTHS for r in recs])
    Du = np.where((core if core.any() else used)[None, :], D, np.inf)
    nearest = np.minimum(np.rint(Du.min(axis=1)), DIST_CAP_KM).astype("int16")
    dgrid = np.full((rows, cols), NODATA, dtype="int16")
    dgrid[rr, cc] = nearest
    layers.append({"id": "dist", "unit": "km", "scale": 1})
    blocks.append(dgrid)

    args.out.mkdir(parents=True, exist_ok=True)
    np.stack(blocks).astype("<i2").tofile(args.out / "visibility.bin")
    n_flag = sum(r["flags_reported"] for r in recs)
    years = sorted({y for r in recs for y in r["years"]})
    dump_json(args.out / "stations.json", {
        "note": "per station and month: days, mean of the daily mean view (km), share of days under 1 / 2 / 5 km, fog flag "
                f"days, haze / dust proxy days (% of valid days); None = fewer than {args.min_days} days or {args.min_years} years",
        "years": [years[0], years[-1]], "count": len(recs), "flagsReported": n_flag, "qa": notes, "stations": recs})
    dump_json(args.out / "visibility.json", {
        "format": "pams-visibility-grid", "version": 1,
        "source": "NOAA NCEI Global Summary of the Day, %d-%d, %d stations (visibility, fog and weather flags)" % (years[0], years[-1], len(recs)),
        "sourceRef": source_ref(load_yaml(args.lock) if args.lock.exists() else None, "gsod"),
        "bounds": [w, s, e, n], "cell": cell, "cols": cols, "rows": rows, "dtype": "int16-le", "nodata": NODATA,
        "layout": "layers x rows x cols; row 0 is the north row; value = file value / scale; no data at sea or with no station within 300 km",
        "months": list(MONTHS), "years": [years[0], years[-1]], "stations": len(recs), "stationsWithWeatherFlags": n_flag,
        "thresholds": {"meanViewCapKm": round(CAP_KM, 1), "poorViewKm": [LT1_KM, LT2_KM], "hazeDustViewKm": HAZE_KM, "hazeDustNeeds": "no fog / rain / snow / hail / thunder flag that day",
                       "minDaysPerMonth": MIN_DAYS, "minYearsPerMonth": MIN_YEARS,
                       "idw": {"nearestStations": IDW_K, "maxKm": IDW_MAX_KM, "power": IDW_POWER, "minKm": IDW_MIN_KM}, "distCapKm": DIST_CAP_KM, "distMinMonths": DIST_MIN_MONTHS},
        "caveats": [
            "VISIB is the daily mean of the day's reports: lt2km and haze understate short bad-view episodes (a dawn fog that lifts by nine)",
            "some stations report no view beyond 10 miles (16 km): their mean saturates there; stations that report up to 50 km are capped at 16 km in vis_mean so the layer is comparable",
            "haze is a proxy: poor view on a day without fog / rain / snow / hail / thunder flags (dust, smoke and smog all land here)",
            "a station that flags no weather in the record is left out of the fog and haze layers",
            "inverse-distance from the nearest 4 stations within 300 km, no height correction: read a cell as what the nearest airport sees",
            "2025 stops on 2025-08-24 where NCEI's record ends: Sep-Dec average 9 years, Jan-Aug 10",
        ],
        "layers": layers, "file": "visibility.bin"})
    log.info("visibility: %d x %d cells, %d layers, %d land cells, %d stations (%d with weather flags) -> %s (%.1f MB)",
             cols, rows, len(layers), int(land.sum()), len(recs), n_flag, args.out, (args.out / "visibility.bin").stat().st_size / 1e6)
    for t in notes:
        log.warning("%s", t)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
