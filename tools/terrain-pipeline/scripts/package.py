"""Step 8 — write manifest.json + LICENSES.txt and zip the bundle.

Inputs : out/terrain-bundle/ (tiles from tile.py), work/profiles/rules.json,
         work/grid/grid.json, sources.lock, work/raw/checksums.json (optional),
         rules.yaml (distScaleM, version)
Outputs: out/terrain-bundle/manifest.json, rules.json, LICENSES.txt
         out/terrain-bundle.zip (unless --no-zip)

`sources[].sha256` in the manifest comes from checksums.json (written by
fetch.py) and falls back to the value pinned in sources.lock, so a bundle
can be traced to its exact inputs. `profiles` lists only the profiles that
actually have a dist_ folder in the bundle.
"""
from __future__ import annotations

import argparse
import shutil
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from common import PIPELINE_VERSION, TILE_SIZE, dump_json, load_json, load_yaml, setup_logging

log = setup_logging("package")


def sources_block(lock: dict, checks: dict) -> list[dict]:
    out = []
    for s in lock["sources"]:
        rec = checks.get(s["id"], {})
        out.append({"id": s["id"], "name": s["name"], "version": str(s.get("version", "")),
                    "licence": s["licence"], "sha256": rec.get("sha256", str(s.get("sha256", ""))),
                    "files": len(rec.get("files", {})) or None})
    return out


def licenses_text(lock: dict, built: str) -> str:
    lines = [f"PAMS terrain bundle — data sources and licences (built {built})", ""]
    for s in lock["sources"]:
        lines += [f"{s['name']}  [{s.get('version', '')}]",
                  f"  licence     : {s['licence']}",
                  f"  attribution : {s.get('attribution', '')}",
                  f"  source      : {s.get('landing', '')}", ""]
    lines += ["Derived data (class and distance tiles) is a mechanical combination of",
              "the sources above; redistribute it under the most restrictive of their",
              "terms (ODbL for anything containing OpenStreetMap-derived pixels)."]
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bundle", type=Path, default=Path("out/terrain-bundle"))
    ap.add_argument("--grid", type=Path, default=Path("work/grid/grid.json"))
    ap.add_argument("--rules-json", type=Path, default=Path("work/profiles/rules.json"))
    ap.add_argument("--rules", type=Path, default=Path("rules.yaml"))
    ap.add_argument("--lock", type=Path, default=Path("sources.lock"))
    ap.add_argument("--checksums", type=Path, default=Path("work/raw/checksums.json"))
    ap.add_argument("--name", default="Pakistan deployable terrain")
    ap.add_argument("--zip", type=Path, default=Path("out/terrain-bundle.zip"))
    ap.add_argument("--no-zip", action="store_true")
    args = ap.parse_args()

    grid, rules = load_json(args.grid), load_yaml(args.rules)
    lock = load_yaml(args.lock)
    checks = load_json(args.checksums) if args.checksums.exists() else {}
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
        "built": built, "pipelineVersion": PIPELINE_VERSION, "rulesVersion": str(rules["version"]),
        "sources": sources_block(lock, checks),
    }
    dump_json(args.bundle / "manifest.json", manifest)
    shutil.copyfile(args.rules_json, args.bundle / "rules.json")
    (args.bundle / "LICENSES.txt").write_text(licenses_text(lock, built), encoding="utf-8")
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
