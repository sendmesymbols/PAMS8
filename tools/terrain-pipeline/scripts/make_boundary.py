"""Step 1b — build the OFFICIAL Pakistan boundary (all of Jammu & Kashmir on Pakistan's side) from the NCGDB.

The Survey of Pakistan's own depiction (e.g. its "Pakistan Relief Map") shows the whole of Jammu & Kashmir as
Pakistan's, with the Line of Control marked as a line, not a limit. NCGDB's `Province_Bdry` carries exactly
that: every entry with COUNTRY = Pakistan (Punjab, Sindh, Balochistan, Khyber Pakhtunkhwa, AJK,
Gilgit-Baltistan and "IIOJK" = the Indian-administered part of J&K) plus the FATA layer. OpenStreetMap's
boundary, by contrast, stops at the LoC, so using it would cut Indian-administered Kashmir off the map.

Inputs : the NCGDB geodatabase (--ncgdb, $NCGDB_PATH or classes.yaml `sources.ncgdb.path`)
Outputs: <out>/pakistan_official.geojson  one MultiPolygon, EPSG:4326: the clip polygon for grid.py --boundary
         <out>/boundary_display.geojson   small, simplified: outline, provinces, LoC and international lines,
                                          for drawing on a map (copied into the bundle by package.py)
         <out>/boundary.json              {"source", "aoi": [w, s, e, n], "provinces": {name: km2}}
Without an NCGDB nothing is written and "NO_OFFICIAL_BOUNDARY" is printed (exit 0): callers then fall back
to OSM's boundary and warn that Indian-administered Kashmir is not covered. A boundary of your own can be
supplied to grid.py with --boundary <GeoJSON> instead.

This is a presentation choice of the data owner, made explicit rather than buried: it follows the official
Survey of Pakistan map. Nothing here is traced from images; the geometry is the survey data itself.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

from common import load_yaml, setup_logging
from derive import resolve_ncgdb

log = setup_logging("make_boundary")


def _round_geom(geom, digits: int = 5):
    import shapely
    return shapely.set_precision(geom, 10 ** -digits)


def build(gdb: Path, out: Path) -> dict:
    import pyogrio.raw as raw
    import shapely

    meta, _f, geom, data = raw.read(gdb, layer="Province_Bdry", columns=["COUNTRY", "Prov_Name"])
    cols = dict(zip(meta["fields"], data))
    gs = shapely.from_wkb(geom)
    parts: dict[str, list] = {}
    for i, g in enumerate(gs):
        if g is not None and str(cols["COUNTRY"][i]).strip().lower() == "pakistan":
            parts.setdefault(str(cols["Prov_Name"][i]).strip() or "Pakistan", []).append(shapely.make_valid(g))
    m2, _f2, g2, d2 = raw.read(gdb, layer="EX_FATA_Bdry", columns=["COUNTRY", "Prov_Name"])
    c2 = dict(zip(m2["fields"], d2))
    for i, g in enumerate(shapely.from_wkb(g2)):
        if g is not None and str(c2["COUNTRY"][i]).strip().lower() == "pakistan":
            parts.setdefault(str(c2["Prov_Name"][i]).strip() or "FATA", []).append(shapely.make_valid(g))
    if not parts:
        raise SystemExit("Province_Bdry has no entries with COUNTRY = Pakistan - wrong geodatabase?")

    prov = {k: shapely.union_all(v) for k, v in parts.items()}
    union = shapely.union_all(list(prov.values()))
    # Close hairline slivers between provinces so the clip polygon has no holes (buffer out and back in).
    union = shapely.buffer(shapely.buffer(union, 0.002), -0.002)
    km2 = lambda g: g.area * 111.32 ** 2 * math.cos(math.radians(30.0))     # rough, for sanity only
    total = km2(union)
    if not 900_000 < total < 1_100_000:
        log.warning("boundary area %.0f km2 is outside the expected 0.9-1.1 million km2 - check the geodatabase", total)
    west, south, east, north = union.bounds
    aoi = [math.floor(west * 10) / 10, math.floor(south * 10) / 10, math.ceil(east * 10) / 10, math.ceil(north * 10) / 10]

    out.mkdir(parents=True, exist_ok=True)
    clip = {"type": "FeatureCollection", "name": "pakistan_official",
            "features": [{"type": "Feature", "properties": {"name": "Pakistan (official, incl. Jammu & Kashmir)"},
                          "geometry": json.loads(shapely.to_geojson(_round_geom(union)))}]}
    (out / "pakistan_official.geojson").write_text(json.dumps(clip), encoding="utf-8")
    (out / "clip.geojson").write_text(json.dumps(clip), encoding="utf-8")     # what fetch.py filters tiles by

    # Lightweight copy for drawing: simplified outline + provinces + the LoC / international lines.
    tol = 0.002                                                       # ~220 m: invisible at any sensible zoom
    feats = [{"type": "Feature", "properties": {"kind": "outline", "name": "Pakistan"},
              "geometry": json.loads(shapely.to_geojson(_round_geom(shapely.simplify(union.boundary, tol))))}]
    for name, g in sorted(prov.items()):
        feats.append({"type": "Feature", "properties": {"kind": "province", "name": name, "km2": round(km2(g))},
                      "geometry": json.loads(shapely.to_geojson(_round_geom(shapely.simplify(g, tol))))})
    m3, _f3, g3, d3 = raw.read(gdb, layer="Political_Bdry", columns=["Name", "CATEGORY", "Pak_Politi"])
    c3 = dict(zip(m3["fields"], d3))
    for i, ln in enumerate(shapely.from_wkb(g3)):
        if ln is None or ln.is_empty or str(c3["Pak_Politi"][i]).strip().lower() != "pakistan":
            continue
        cat = str(c3["CATEGORY"][i]).strip()
        feats.append({"type": "Feature",
                      "properties": {"kind": "loc" if cat == "LOC" else "border", "name": str(c3["Name"][i]).strip()},
                      "geometry": json.loads(shapely.to_geojson(_round_geom(shapely.simplify(ln, tol))))})
    (out / "boundary_display.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}),
                                                  encoding="utf-8")
    info = {"source": "official", "from": "NCGDB Province_Bdry (COUNTRY = Pakistan) + EX_FATA_Bdry; "
                                          "includes all of Jammu & Kashmir; the Line of Control is a line, not a limit",
            "aoi": aoi, "area_km2_approx": round(total), "provinces": {k: round(km2(v)) for k, v in sorted(prov.items())}}
    (out / "boundary.json").write_text(json.dumps(info, indent=1), encoding="utf-8")
    return info


# Extent of the Survey of Pakistan "Pakistan Relief Map" sheet, read off its graticule (66E..80E, 24N..36N
# labels; the frame runs about 59.7E..80.3E, 23.0N..37.3N) and widened a little, plus the south to 20.5N so the
# Junagadh & Manavadar inset is covered. The maps give the BOUNDS of the data; nothing inside is clipped.
DEFAULT_FRAME = "59.5,20.5,80.5,37.5"


def build_frame(spec: str, out: Path) -> dict:
    """Write the data extent as a plain rectangle: clip.geojson (what grid.py warps to) + boundary.json."""
    w, s, e, n = (float(v) for v in spec.split(","))
    if not (-180 <= w < e <= 180 and -90 <= s < n <= 90):
        raise SystemExit(f"--frame must be west,south,east,north in WGS84 degrees, got {spec!r}")
    out.mkdir(parents=True, exist_ok=True)
    ring = [[w, s], [e, s], [e, n], [w, n], [w, s]]
    clip = {"type": "FeatureCollection", "name": "map_frame",
            "features": [{"type": "Feature", "properties": {"name": "Survey of Pakistan map extent"},
                          "geometry": {"type": "Polygon", "coordinates": [ring]}}]}
    (out / "clip.geojson").write_text(json.dumps(clip), encoding="utf-8")
    for stale in ("pakistan_official.geojson", "boundary_display.geojson"):      # from an earlier official run
        (out / stale).unlink(missing_ok=True)
    info = {"source": "frame", "from": "extent of the Survey of Pakistan relief map (rectangle, nothing clipped inside)",
            "aoi": [w, s, e, n]}
    (out / "boundary.json").write_text(json.dumps(info, indent=1), encoding="utf-8")
    return info


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=Path("work/boundary"))
    ap.add_argument("--classes", type=Path, default=Path("classes.yaml"))
    ap.add_argument("--ncgdb", help="NCGDB .gdb folder; 'none' = do not build an official boundary")
    ap.add_argument("--frame", nargs="?", const=DEFAULT_FRAME, metavar="W,S,E,N",
                    help="do NOT build a boundary polygon: use a plain rectangle as the data extent "
                         f"(default {DEFAULT_FRAME}, the Survey of Pakistan map sheet)")
    args = ap.parse_args()

    if args.frame:
        info = build_frame(args.frame, args.out)
        log.info("data extent (rectangle, no clipping inside): %s -> %s", info["aoi"], args.out)
        print("FRAME_OK")
        return 0

    cfg = load_yaml(args.classes)["sources"].get("ncgdb", {})
    gdb, explicit = resolve_ncgdb(args.ncgdb, cfg.get("path"))
    if gdb is None or not gdb.is_dir():
        if explicit and gdb is not None:
            raise SystemExit(f"NCGDB folder not found: {gdb}")
        for stale in ("pakistan_official.geojson", "boundary_display.geojson", "boundary.json"):
            (args.out / stale).unlink(missing_ok=True)
        log.warning("no NCGDB available: the official boundary cannot be built")
        print("NO_OFFICIAL_BOUNDARY")
        return 0
    info = build(gdb, args.out)
    log.info("official boundary: %s km2 (approx), AOI %s", f"{info['area_km2_approx']:,}", info["aoi"])
    for name, a in info["provinces"].items():
        log.info("  %-20s %9s km2", name, f"{a:,}")
    log.info("-> %s", args.out)
    print("OFFICIAL_BOUNDARY_OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
