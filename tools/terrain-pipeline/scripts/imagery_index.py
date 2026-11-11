"""Step I1 — index the owner's 0.25 m imagery (E:/Data From 477) before anything is taken from it.

Inputs : --root (default E:/Data From 477): the Survey of Pakistan sheet GeoTIFFs under Pakistan/<province>/ and
         Mosaic_Eastern_T_80km/Eastern_Trans_80km/. ArcGIS mosaic-dataset folders (*.gdb, *.Overviews, *_DataSet,
         *_MosaicDataSet) hold coarse derived copies of the same imagery and are left out (counted, not read).
Outputs: work/imagery/index.json   one record per sheet file: sheet, year, folder, size, raster header (crs, bounds,
                                   resolution, bands, overviews), and a read check of the coarsest overview (opens,
                                   share of empty / black pixels, mean brightness)
         work/imagery/latest.json  the sheet -> file to use: the latest year (data-source rule), else the larger /
                                   later-processed copy; every other copy listed with why it was dropped
         work/imagery/footprints.gpkg  footprints of the files in latest.json (for sampling and for GIS checks)
         work/imagery/summary.txt  counts by folder and year, duplicates, failures

Filenames are `<sheet>-25(<year>).tif` (38P10-25(2023).tif): the year is the only acquisition date the files carry;
their .xml sidecars hold the date pyramids were built (2025), not when the imagery was taken.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import setup_logging  # noqa: E402

log = setup_logging("imagery_index")

SKIP_DIR = re.compile(r"(\.gdb|\.overviews|_dataset|_mosaicdataset)$", re.I)
# "38P10-25(2023).tif", also the malformed "40L13-25(2023.tif", "44I10-(2024)z20.tif", "35B6-25N2023).tif" and the
# dot-named ".38O8-24(2023).tif" (each has a clean-named twin; the duplicate check decides which to keep)
NAME = re.compile(r"^\.?(?P<sheet>\d{2}[A-P]\d{1,2})(?:-(?P<sfx>\d*))?\s*[(N]?(?P<year>(?:19|20)\d{2})\)?", re.I)


def sources(root: Path):
    """Sheet GeoTIFFs, and the derived mosaic-dataset copies that are skipped."""
    files, skipped = [], Counter()
    for p in root.rglob("*"):
        if p.is_dir():
            continue
        if any(SKIP_DIR.search(part) for part in p.parts):
            if p.suffix.lower() in (".tif", ".tiff"):
                skipped[next(part for part in p.parts if SKIP_DIR.search(part))] += 1
            continue
        if p.suffix.lower() in (".tif", ".tiff"):
            files.append(p)
    return sorted(files), skipped


def read_one(p: Path, root: Path) -> dict:
    import rasterio
    from rasterio.enums import Resampling
    rec = {"path": str(p).replace("\\", "/"), "rel": str(p.relative_to(root)).replace("\\", "/"),
           "folder": str(p.parent.relative_to(root)).replace("\\", "/"), "bytes": p.stat().st_size,
           "mtime": time.strftime("%Y-%m-%d", time.localtime(p.stat().st_mtime))}
    m = NAME.match(p.name)
    rec["sheet"] = m.group("sheet").upper() if m else None
    rec["year"] = int(m.group("year")) if m else None
    ovr = p.with_name(p.name + ".ovr")
    rec["ovrFile"] = ovr.exists()
    t0 = time.time()
    try:
        with rasterio.open(p) as d:
            rec.update(crs=str(d.crs), width=d.width, height=d.height, bands=d.count, dtype=d.dtypes[0],
                       res=[abs(d.res[0]), abs(d.res[1])], bounds=list(d.bounds), compression=str(d.compression),
                       overviews=d.overviews(1))
            # lon / lat bounds and ground resolution whatever the file's CRS: 4 Eastern sheets are Web Mercator,
            # 5 Balochistan sheets have a geotransform in degrees but no CRS tag (taken as WGS84 and flagged)
            b = d.bounds
            if d.crs is None:
                if -180 <= b.left <= 180 and -90 <= b.bottom <= 90:
                    rec["crsNote"] = "no CRS tag; geotransform in degrees, taken as EPSG:4326"
                    rec["boundsLL"] = list(b)
                else:
                    raise ValueError("no CRS and bounds not in degrees: cannot place the sheet")
            elif d.crs.to_epsg() == 4326:
                rec["boundsLL"] = list(b)
            else:
                from rasterio.warp import transform_bounds
                rec["boundsLL"] = list(transform_bounds(d.crs, "EPSG:4326", *b))
            mid_lat = (rec["boundsLL"][1] + rec["boundsLL"][3]) / 2
            rec["resM"] = round(abs(d.res[1]) * (110574.0 if d.crs is None or d.crs.to_epsg() == 4326
                                                  else np.cos(np.radians(mid_lat))), 3)
            if not d.overviews(1) and d.width * d.height > 2e9:
                raise ValueError("no usable overviews (the .ovr is broken or missing) on a full-size sheet: not read")
            # the coarsest overview, read whole: proves the file decodes and gives an empty / black share
            f = max(d.overviews(1) or [1])
            h, w = max(1, d.height // f), max(1, d.width // f)
            a = d.read(out_shape=(d.count, h, w), resampling=Resampling.nearest)
            rgb = a[:3].astype(np.int16)
            black = (rgb.max(axis=0) <= 5)
            white = (rgb.min(axis=0) >= 250)
            rec["emptyPct"] = round(100 * float((black | white).mean()), 1)
            rec["meanRGB"] = [round(float(x), 1) for x in rgb.reshape(rgb.shape[0], -1).mean(axis=1)]
            rec["readOk"] = True
    except Exception as e:  # noqa: BLE001
        rec["readOk"] = False
        rec["error"] = str(e)[:300]
    rec["readS"] = round(time.time() - t0, 2)
    return rec


def choose_latest(recs: list[dict]) -> tuple[dict, list[dict]]:
    """sheet -> chosen record; and the dropped copies with the reason."""
    by = defaultdict(list)
    for r in recs:
        if r.get("readOk") and r.get("sheet") and r.get("year"):
            by[r["sheet"]].append(r)
    chosen, dropped = {}, []
    for sheet, rs in by.items():
        rs.sort(key=lambda r: (r["year"], r["emptyPct"] * -1, r["bytes"]), reverse=True)
        chosen[sheet] = rs[0]
        for r in rs[1:]:
            same = (r["year"] == rs[0]["year"] and r["bytes"] == rs[0]["bytes"] and r["width"] == rs[0]["width"]
                    and r["height"] == rs[0]["height"])
            why = ("same file copied (same year, size and raster)" if same
                   else f"older year ({r['year']} < {rs[0]['year']})" if r["year"] < rs[0]["year"]
                   else "same year, kept the one with less empty area / larger file")
            dropped.append({"sheet": sheet, "rel": r["rel"], "year": r["year"], "keep": rs[0]["rel"], "why": why})
    return chosen, dropped


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", type=Path, default=Path("E:/Data From 477"))
    ap.add_argument("--out", type=Path, default=Path("work/imagery"))
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--limit", type=int, default=0, help="read only the first N files (a test run)")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    files, skipped = sources(args.root)
    if args.limit:
        files = files[:: max(1, len(files) // args.limit)][: args.limit]
    log.info("%d sheet GeoTIFFs; skipped derived mosaic-dataset copies: %s", len(files), dict(skipped))
    recs = []
    t0 = time.time()
    with ThreadPoolExecutor(args.workers) as ex:
        for i, r in enumerate(ex.map(lambda p: read_one(p, args.root), files), 1):
            recs.append(r)
            if i % 100 == 0:
                log.info("  read %d / %d (%.0f s)", i, len(files), time.time() - t0)
    (args.out / "index.json").write_text(json.dumps({"root": str(args.root), "built": time.strftime("%Y-%m-%dT%H:%M:%S"),
                                                     "skippedDerived": dict(skipped), "files": recs}, indent=1),
                                         encoding="utf-8")
    chosen, dropped = choose_latest(recs)
    (args.out / "latest.json").write_text(json.dumps({"sheets": chosen, "dropped": dropped}, indent=1), encoding="utf-8")

    # footprints of the chosen files
    if chosen:
        import pyogrio.raw as raw
        import shapely
        geoms = [shapely.box(*c["boundsLL"]) for c in chosen.values()]
        fields = {"sheet": np.array(list(chosen), dtype=object),
                  "year": np.array([c["year"] for c in chosen.values()], dtype=np.int32),
                  "folder": np.array([c["folder"] for c in chosen.values()], dtype=object),
                  "rel": np.array([c["rel"] for c in chosen.values()], dtype=object),
                  "empty_pct": np.array([c["emptyPct"] for c in chosen.values()], dtype=np.float64),
                  "res_m": np.array([c["resM"] for c in chosen.values()], dtype=np.float64)}
        gp = args.out / "footprints.gpkg"
        if gp.exists():
            gp.unlink()
        raw.write(str(gp), np.array(shapely.to_wkb(geoms), dtype=object), list(fields.values()), list(fields),
                  driver="GPKG", crs="EPSG:4326", geometry_type="Polygon", layer="sheets")

    bad = [r for r in recs if not r.get("readOk")]
    unnamed = [r["rel"] for r in recs if r.get("readOk") and not r.get("sheet")]
    lines = [f"Imagery index of {args.root} ({time.strftime('%Y-%m-%d %H:%M')})",
             f"sheet files read: {len(recs)}; derived mosaic-dataset copies skipped: {sum(skipped.values())} {dict(skipped)}",
             f"unique sheets: {len(chosen)}; copies dropped: {len(dropped)} {dict(Counter(d['why'].split(' (')[0] for d in dropped))}",
             f"failed to read: {len(bad)} " + "; ".join(f"{r['rel']}: {r.get('error', '')[:120]}" for r in bad),
             f"names not matching <sheet>(<year>): {len(unnamed)} {unnamed[:10]}",
             "chosen sheets by year: " + ", ".join(f"{y} {n}" for y, n in sorted(Counter(c['year'] for c in chosen.values()).items())),
             "chosen sheets by folder: " + ", ".join(f"{f} {n}" for f, n in Counter(c['folder'] for c in chosen.values()).most_common()),
             "resolution (m, chosen): " + ", ".join(f"{k} {v}" for k, v in sorted(Counter(round(c['resM'], 2) for c in chosen.values()).items())),
             "CRS (chosen): " + ", ".join(f"{k} {v}" for k, v in Counter(c['crs'] for c in chosen.values()).items()) + "; no CRS tag, taken as EPSG:4326: " + str([c['rel'] for c in chosen.values() if c.get('crsNote')]),
             "chosen sheets more than 20 % empty: " + str(sum(1 for c in chosen.values() if c['emptyPct'] > 20)),
             f"TB (chosen): {sum(c['bytes'] for c in chosen.values()) / 1e12:.2f}; all: {sum(r['bytes'] for r in recs) / 1e12:.2f}",
             f"read time: {time.time() - t0:.0f} s"]
    (args.out / "summary.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    for ln in lines:
        log.info(ln)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
