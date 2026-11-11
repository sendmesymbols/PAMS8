"""Step 8 — write manifest.json + LICENSES.txt and zip the bundle.

Inputs : MS/Data/terrain-bundle/ (tiles from tile.py), work/profiles/rules.json,
         work/grid/grid.json, sources.lock, work/raw/checksums.json (optional),
         rules.yaml (distScaleM, version)
Outputs: MS/Data/terrain-bundle/manifest.json, rules.json, LICENSES.txt
         bundle v2 (when work/grotbc/vector exists): features/, admin.geojson, boundaries.geojson, sheets.json
         out/terrain-bundle.zip (unless --no-zip)

`sources[].sha256` in the manifest comes from checksums.json (written by
fetch.py) and falls back to the value pinned in sources.lock, so a bundle
can be traced to its exact inputs. Every source also carries where it came from
(`location`: download URLs or local path, `landing`) and when (`dataDate`, `released`),
and every layer and file names the source ids it was built from (`sources`). `profiles` lists only the profiles that
actually have a dist_ folder in the bundle.

Bundle v2 keeps manifest `version` 1 (an engine that reads v1 still loads it: class + dist_<mode> are
unchanged in form) and adds `dataVersion: 2` and a `grotbc` block naming the auxiliary layers and files.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from common import BUNDLE_DIR, PIPELINE_VERSION, TILE_SIZE, dump_json, load_json, load_yaml, setup_logging, source_ref

log = setup_logging("package")


# what each bundle product is built from (source ids; "ncgdb" only in a hybrid bundle)
CLASS_SOURCES = ["worldcover", "jrc_gsw", "glo30", "osm_pakistan", "ncgdb"]     # class.tif, read by most layers
PRODUCT_SOURCES = {
    "admin": ["ncgdb"], "boundaries": ["ncgdb"], "sheets": ["ncgdb"], "routes": ["ncgdb"],
    "climate": ["worldclim"],
    "visibility": ["gsod"],
    "population": ["worldpop", "worldpop_agesex", "worldpop_density", "worldpop_pwd"],
    "network": ["osm_network", "ncgdb", "heigit_planet_roads"],
    "settlements": CLASS_SOURCES + ["worldpop", "worldpop_agesex", "openbuildings", "ghsl_height", "ghsl_smod",
                                    "geonames_pk"],
    "features": ["ncgdb", "geonames_pk", "worldpop", "glo30", "osm_network"],
}


def ncgdb_source(ncgdb: dict, classes: Path) -> dict:
    """The NCGDB as a source entry: it is not in sources.lock (restricted, identified by a folder fingerprint)."""
    def find(o):
        if isinstance(o, dict):
            if isinstance(o.get("ncgdb"), dict) and o["ncgdb"].get("path"):
                return o["ncgdb"]["path"]
            return next((r for r in map(find, o.values()) if r), None)
        return None
    path = find(load_yaml(classes)) if classes.exists() else None
    newest = ncgdb["fingerprint"].get("newest_file", "")[:10]
    return {"id": "ncgdb", "name": ncgdb["name"], "version": ncgdb["version"], "licence": ncgdb["licence"],
            "location": [path] if path else [], "landing": None,
            "dataDate": "not recorded in the geodatabase (Survey of Pakistan NCGDB Ver-6)",
            "released": f"local copy, newest file {newest}" if newest else None,
            "sha256": ncgdb["fingerprint"]["listing_sha256"], "files": ncgdb["fingerprint"]["files"],
            "restricted": True, "rulesSha256": ncgdb["rules_sha256"]}


def in_bundle(s: dict) -> bool:
    """sources.lock entries with `stage: candidate` are being measured (check points), not built into the bundle:
    they are not listed in its manifest or LICENSES until they pass and a product reads them."""
    return s.get("stage", "used") != "candidate"


def sources_block(lock: dict, checks: dict, ncgdb: dict | None = None) -> list[dict]:
    out = []
    for s in filter(in_bundle, lock["sources"]):
        rec = checks.get(s["id"], {})
        ref = source_ref(lock, s["id"])
        out.append({"id": s["id"], "name": s["name"], "version": str(s.get("version", "")),
                    "location": ref["location"], "landing": ref["landing"], "dataDate": ref["dataDate"],
                    "released": ref["released"], "licence": s["licence"],
                    "sha256": rec.get("sha256", str(s.get("sha256", ""))), "files": len(rec.get("files", {})) or None,
                    **({"restriction": s["restriction"]} if s.get("restriction") else {})})
    if ncgdb:
        out.append(ncgdb)
    return out


# Who may receive what, on top of "the bundle is restricted" (added 2026-11-10 with the NOAA visibility layer).
SHARING_NOTE = [
    "Sharing limits by source (these apply on top of the restriction above):",
    "  - NCGDB and the formation overlays: only with the data owner's permission.",
    "  - NOAA GSOD, layer visibility/: for non-U.S. stations the data or any derived product shall not be provided to",
    "    other users or used for the re-export of commercial services (NCEI GSOD readme). Leave visibility/ out of a",
    "    bundle that goes to another party (package.py --visibility <a folder that does not exist>) and out of any",
    "    commercial service.",
    "  - WorldClim, layer climate/: research and related use; check its terms before passing it on.",
    "  - OpenStreetMap-derived pixels and features: ODbL, attribution and share-alike.",
    "  - HeiGIT Planet road surface / width / passability (the `pad` byte of network/edges.bin and the last array of",
    "    network/gg tiles): non-commercial use only; it contains PlanetScope derivatives, so redistribution is subject",
    "    to Planet Labs PBC terms. Check those terms before a bundle with it goes to another party.",
    "Not in this bundle but used with it: the OCOKA lens data in the library (MS/Data/OcokaDoctrine.json and the Rng",
    "field of MS/Data/Symbols.json) quotes figures from Pakistan Army pamphlets and carries its own handling note;",
    "keep it under the same terms as the pamphlets.",
]


def licenses_text(lock: dict, built: str, ncgdb: dict | None = None) -> str:
    lines = [f"PAMS terrain bundle — data sources and licences (built {built})", ""]
    for s in filter(in_bundle, lock["sources"]):
        lines += [f"{s['name']}  [{s.get('version', '')}]",
                  f"  data date   : {s.get('dataDate', '')}",
                  f"  released    : {s.get('released', '')}",
                  f"  licence     : {s['licence']}",
                  f"  attribution : {s.get('attribution', '')}",
                  f"  source      : {s.get('landing', '')}"]
        lines += [f"  location    : {u}" for u in source_ref(lock, s["id"])["location"]]
        lines += ([f"  *** RESTRICTED USE: {s['restriction']} ***"] if s.get("restriction") else []) + [""]
    if ncgdb:
        lines += [f"{ncgdb['name']}  [{ncgdb['version']}]",
                  f"  data date   : {ncgdb['dataDate']}",
                  f"  released    : {ncgdb['released']}",
                  f"  location    : {', '.join(ncgdb['location'])}",
                  f"  licence     : {ncgdb['licence']}",
                  f"  attribution : {ncgdb.get('attribution', '')}",
                  "  *** RESTRICTED: this bundle contains pixels derived from NCGDB. Do not redistribute it",
                  "      outside the data owner's permission. Rebuild with --ncgdb none for an open-data bundle. ***", ""]
    lines += ["Bundle v2 also carries NCGDB point and line features (features/, admin.geojson, boundaries.geojson,",
              "sheets.json), including sensitive military content: corps areas, cantonments, posts, bunkers and",
              "air bases with their units. Treat the whole bundle as restricted.", ""] if ncgdb else []
    lines += SHARING_NOTE + [""]
    lines += ["Derived data (class and distance tiles) is a mechanical combination of",
              "the sources above; redistribute it under the most restrictive of their",
              "terms (ODbL for anything containing OpenStreetMap-derived pixels)."]
    return "\n".join(lines) + "\n"


AUX_LAYERS = {
    "route":    {"sources": ["ncgdb"], "reduce": "max", "codebook": "rules.json grotbc.layers.route",
                 "note": "bit 7 main supply route, bits 5-6 load-class tier, bits 0-4 route type; 0 = no route"},
    "landform": {"sources": ["glo30"], "reduce": "mode", "codebook": "rules.json grotbc.layers.landform", "nodata": 255},
    "cc":       {"sources": CLASS_SOURCES, "reduce": "mode", "codebook": "rules.json grotbc.layers.cc", "nodata": 255,
                 "note": "concealment = value >> 4, cover = value & 15; 0 none, 1 poor, 2 fair, 3 good"},
    "wet":      {"sources": CLASS_SOURCES, "reduce": "max", "codebook": "rules.json grotbc.layers.wet", "nodata": 255},
    "terrain":  {"sources": CLASS_SOURCES, "reduce": "mode", "codebook": "rules.json grotbc.layers.terrain", "nodata": 255,
                 "note": "GROTBC G terrain type (T reads it for the going): Plain / Hilly / Solid / Marshy / Wet / Desert / Mountainous / Built-up / Snow-ice"},
    "soil":     {"sources": ["soilgrids", "ncgdb"], "reduce": "mode", "codebook": "rules.json grotbc.layers.soil", "nodata": 255,
                 "note": "texture = value & 15 (USDA class of the top 30 cm, SoilGrids ~250 m modelled; 13-14 NCGDB only), "
                         "confidence = (value >> 4) & 3 (rules.json grotbc.layers.soilConfidence), bit 6 = NCGDB 1:50k soil area; "
                         "notes in rules.json grotbc.soilBearing"},
    "rci_dry":  {"sources": ["soilgrids", "ncgdb"], "reduce": "min", "codebook": "rules.json grotbc.soilStrength", "nodata": 255,
                 "note": "dry-season cone index = value & 127 (127 = 127 or more), bit 7 = coarse (use the vehicle's coarse "
                         "thresholds); compare with soilStrength.vehicles[byProfile[mode]]: >= vci50 GO, >= vci1 SLOW-GO, else NO-GO"},
    "rci_wet":  {"sources": ["soilgrids", "ncgdb"], "reduce": "min", "codebook": "rules.json grotbc.soilStrength", "nodata": 255,
                 "note": "cone index after heavy rain; encoded as rci_dry"},
    "hut":      {"sources": ["ncgdb"], "reduce": "maxnd", "codebook": "rules.json grotbc.layers.hut", "nodata": 255,
                 "note": "bits 0-6 permanent (kacha) huts per km2, bit 7 temporary huts nearby"},
    "bank":     {"sources": CLASS_SOURCES, "reduce": "maxnd", "codebook": "rules.json grotbc.banks", "nodata": 255,
                 "note": "land along water: kind = value >> 2 (rules.json grotbc.banks.kinds), band = value & 3 (0 nearest, bandsM); 0 = no bank"},
    "bld":      {"sources": ["openbuildings", "ghsl_height"], "reduce": "maxnd", "codebook": "rules.json grotbc.layers.bld", "nodata": 255,
                 "note": "Open Buildings footprints per ~150 m cell: density class = value & 7, size class = value >> 3; 0 = none"},
    "elev_hi":  {"sources": ["glo30"], "reduce": "mean", "note": "elevation m = elev_hi * 256 + elev_lo - 500; elev_hi 255 = nodata"},
    "elev_lo":  {"sources": ["glo30"], "reduce": "mean"},
}


def grotbc_block(bundle: Path, vector: Path, climate: Path | None = None, network: Path | None = None,
                 settlements: Path | None = None, population: Path | None = None,
                 visibility: Path | None = None) -> dict | None:
    """Copy the v2 vector files into the bundle and describe the v2 layers; None for a v1 bundle. Every layer and
    file names its `sources` (ids in manifest.sources)."""
    layers = {k: dict(v, path=k) for k, v in AUX_LAYERS.items() if (bundle / k).is_dir()}
    if not layers:
        return None
    out = {"version": 2, "layers": layers, "elevation": {"hi": "elev_hi", "lo": "elev_lo", "offsetM": 500}}
    if vector.is_dir():
        for name in ("admin.geojson", "boundaries.geojson", "sheets.json", "routes.json"):
            if (vector / name).exists():
                shutil.copyfile(vector / name, bundle / name)
                out[name.split(".")[0]] = name
                out[name.split(".")[0] + "Sources"] = PRODUCT_SOURCES[name.split(".")[0]]
        if climate is not None and (climate / "climate.json").exists():
            (bundle / "climate").mkdir(exist_ok=True)
            for name in ("climate.json", "climate.bin"):
                shutil.copyfile(climate / name, bundle / "climate" / name)
            out["climate"] = {"index": "climate/climate.json", "data": "climate/climate.bin",
                              "sources": PRODUCT_SOURCES["climate"]}
        if visibility is not None and (visibility / "visibility.json").exists():
            (bundle / "visibility").mkdir(exist_ok=True)
            for name in ("visibility.json", "visibility.bin"):
                shutil.copyfile(visibility / name, bundle / "visibility" / name)
            out["visibility"] = {"index": "visibility/visibility.json", "data": "visibility/visibility.bin",
                                 "sources": PRODUCT_SOURCES["visibility"]}
        if population is not None and (population / "population.json").exists():
            (bundle / "population").mkdir(exist_ok=True)
            for name in ("population.json", "population.bin"):
                shutil.copyfile(population / name, bundle / "population" / name)
            out["population"] = {"index": "population/population.json", "data": "population/population.bin",
                                 "sources": PRODUCT_SOURCES["population"]}
        if network is not None and (network / "network.json").exists():
            shutil.rmtree(bundle / "network", ignore_errors=True)
            shutil.copytree(network, bundle / "network")
            nj = load_json(network / "network.json")
            out["network"] = {"index": "network/network.json", "tiles": "network/tiles/{z}/{x}/{y}.json",
                              "dataVersion": nj.get("dataVersion"), "sources": PRODUCT_SOURCES["network"],
                              "note": "the road graph GeoCore solves on (same edges, attributes and dataVersion); "
                                      "draw roads from network/tiles so the map and a route agree"}
            # routes.json: roads from the same canonical edges (so an MSR's length is the routed one), railways kept
            # from the NCGDB index
            if (network / "routes.json").exists():
                roads = load_json(network / "routes.json")
                rails = load_json(bundle / "routes.json").get("rails", []) if (bundle / "routes.json").exists() else []
                roads["rails"] = rails
                roads["note"] = roads.get("note", "") + " Roads come from the canonical road network (network/), " \
                                                        "railways from the NCGDB railway lines."
                (bundle / "routes.json").write_text(json.dumps(roads, separators=(",", ":"), ensure_ascii=False),
                                                    encoding="utf-8")
        if settlements is not None and (settlements / "settlements.json").exists():
            for name in ("settlements.json", "settlements.geojson"):
                shutil.copyfile(settlements / name, bundle / name)
            out["settlements"] = {"list": "settlements.json", "geojson": "settlements.geojson",
                                  "sources": PRODUCT_SOURCES["settlements"]}
        if (vector / "features" / "index.json").exists():
            shutil.rmtree(bundle / "features", ignore_errors=True)
            shutil.copytree(vector / "features", bundle / "features")
            idx = load_json(vector / "features" / "index.json")
            out["features"] = {"path": "features/{z}/{x}/{y}.json", "index": "features/index.json", "z": idx["z"],
                               "quant": idx["quant"], "sources": PRODUCT_SOURCES["features"] + [   # + formation overlays (kmz.py)
                                   v["id"] for v in (idx.get("sources") or {}).values()
                                   if isinstance(v, dict) and str(v.get("id") or "").startswith("kmz_")]}
    return out


def _drop_source(node, sid: str) -> None:
    """Remove one source id from every `sources` / `*Sources` list in the manifest."""
    if isinstance(node, dict):
        for k, v in node.items():
            if (k == "sources" or k.endswith("Sources")) and isinstance(v, list) and all(isinstance(x, str) for x in v):
                node[k] = [x for x in v if x != sid]
            else:
                _drop_source(v, sid)
    elif isinstance(node, list):
        for v in node:
            _drop_source(v, sid)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bundle", type=Path, default=BUNDLE_DIR)
    ap.add_argument("--grid", type=Path, default=Path("work/grid/grid.json"))
    ap.add_argument("--rules-json", type=Path, default=Path("work/profiles/rules.json"))
    ap.add_argument("--rules", type=Path, default=Path("rules.yaml"))
    ap.add_argument("--lock", type=Path, default=Path("sources.lock"))
    ap.add_argument("--checksums", type=Path, default=Path("work/raw/checksums.json"))
    ap.add_argument("--ncgdb-provenance", type=Path, default=Path("work/derive/ncgdb_provenance.json"),
                    help="written by derive.py when an NCGDB was used (absent = open-data bundle)")
    ap.add_argument("--classes", type=Path, default=Path("classes.yaml"), help="for the NCGDB path")
    ap.add_argument("--class-stats", type=Path, default=Path("work/classify/class_stats.json"))
    ap.add_argument("--boundary-display", type=Path, default=Path("work/boundary/boundary_display.geojson"),
                    help="outline for drawing on a map; copied into the bundle as boundary.geojson (official boundary only)")
    ap.add_argument("--network", type=Path, default=Path("work/network"), help="road graph (network.py)")
    ap.add_argument("--settlements", type=Path, default=Path("work/settlements"), help="settlements.py output")
    ap.add_argument("--climate", type=Path, default=Path("work/climate"), help="climate.json / climate.bin (climate.py)")
    ap.add_argument("--visibility", type=Path, default=Path("work/visibility"),
                    help="visibility.json / visibility.bin (visibility.py; the OCOKA view by month)")
    ap.add_argument("--population", type=Path, default=Path("work/population"),
                    help="population.json / population.bin (population.py)")
    ap.add_argument("--grotbc-vector", type=Path, default=Path("work/grotbc/vector"),
                    help="bundle v2 features / admin / boundaries / sheets written by grotbc.py")
    ap.add_argument("--name", default="Pakistan deployable terrain")
    ap.add_argument("--zip", type=Path, default=Path("out/terrain-bundle.zip"))
    ap.add_argument("--no-zip", action="store_true")
    args = ap.parse_args()

    grid, rules = load_json(args.grid), load_yaml(args.rules)
    lock = load_yaml(args.lock)
    checks = load_json(args.checksums) if args.checksums.exists() else {}
    ncgdb = ncgdb_source(load_json(args.ncgdb_provenance), args.classes) if args.ncgdb_provenance.exists() else None
    stats = load_json(args.class_stats) if args.class_stats.exists() else {}
    if bool(ncgdb) != (stats.get("mode") == "hybrid") and stats:
        log.error("provenance (%s) and class_stats (%s) disagree about NCGDB - re-run derive and classify",
                  "ncgdb" if ncgdb else "open", stats.get("mode"))
        return 1
    built = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    profiles = sorted(p.name[len("dist_"):] for p in args.bundle.glob("dist_*") if p.is_dir())
    if not (args.bundle / "class").is_dir():
        log.error("%s has no class/ folder — run tile.py first", args.bundle)
        return 1

    manifest = {
        "format": "pams-terrain-bundle", "version": 1, "name": args.name, "crs": "EPSG:3857",
        "tileSize": TILE_SIZE, "zoom": {"min": grid["zmin"], "max": grid["zmax"]},
        "bounds": grid["aoi"], "distScaleM": float(rules.get("distScaleM", 10)),
        "layers": {"class": "class", "dist": "dist_{profile}"}, "profiles": profiles,
        "layerSources": {"class": CLASS_SOURCES, "dist": CLASS_SOURCES},
        "built": built, "pipelineVersion": PIPELINE_VERSION, "rulesVersion": str(rules["version"]),
        "sources": sources_block(lock, checks, ncgdb),
        "hybrid": bool(ncgdb),
        "restricted": bool(ncgdb),
    }
    v2 = grotbc_block(args.bundle, args.grotbc_vector, args.climate, args.network, args.settlements, args.population,
                      args.visibility)
    if v2:
        manifest["dataVersion"] = 2
        manifest["layers"].update({k: k for k in v2["layers"]})
        manifest["grotbc"] = v2
    if not ncgdb:          # open-data bundle: there is no NCGDB to name
        _drop_source(manifest, "ncgdb")
    bsrc = grid.get("boundary", {}).get("source", "osm")
    manifest["boundary"] = {"source": bsrc}
    if bsrc == "official" and args.boundary_display.exists():
        shutil.copyfile(args.boundary_display, args.bundle / "boundary.geojson")
        manifest["boundary"]["file"] = "boundary.geojson"
        manifest["boundary"]["note"] = ("Survey of Pakistan official depiction: all of Jammu & Kashmir is shown on "
                                        "Pakistan's side; the Line of Control is a line, not a limit")
    elif bsrc == "frame":
        manifest["boundary"]["note"] = "Data extent = the Survey of Pakistan relief-map sheet (a rectangle); no country border is drawn or clipped"
    elif bsrc == "osm":
        manifest["boundary"]["note"] = "OpenStreetMap boundary: stops at the Line of Control (Indian-administered Kashmir not covered)"
    dump_json(args.bundle / "manifest.json", manifest)
    shutil.copyfile(args.rules_json, args.bundle / "rules.json")
    (args.bundle / "LICENSES.txt").write_text(licenses_text(lock, built, ncgdb), encoding="utf-8")
    log.info("manifest: profiles=%s zoom=%s built=%s", profiles, manifest["zoom"], built)

    if not args.no_zip:
        args.zip.parent.mkdir(parents=True, exist_ok=True)
        n = 0
        with zipfile.ZipFile(args.zip, "w", zipfile.ZIP_STORED) as zf:   # PNGs are already compressed
            for p in sorted(args.bundle.rglob("*")):
                if p.is_file():
                    zf.write(p, Path("terrain-bundle") / p.relative_to(args.bundle))
                    n += 1
        log.info("%s: %d files, %.1f MB", args.zip, n, args.zip.stat().st_size / 1e6)
    return 0


if __name__ == "__main__":
    sys.exit(main())
