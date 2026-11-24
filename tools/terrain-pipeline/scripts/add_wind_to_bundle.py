"""Add the wind grid to an EXISTING bundle without rebuilding it (the live MS/Data/terrain-bundle).

package.py does this for a full build (copies work/wind/, writes manifest.sources[] and grotbc.wind). The bundle took
hours to tile and the wind grid is about 2 MB, so this does the same three things in place, as
add_visibility_to_bundle.py does for the visibility grid:

    1. copies work/wind/wind.json + wind.bin to <bundle>/wind/
    2. inserts the `era5_wind` source after `gsod` (else `worldclim`) in manifest.sources and `grotbc.wind` after
       `grotbc.visibility` (else `grotbc.climate`); the manifest keeps its formatting (indent 1, UTF-8, its line ending)
    3. adds the ERA5 block to LICENSES.txt before the WorldPop block, and the sharing note line

The manifest is backed up first; a re-run replaces the entries instead of adding a second set. After writing, the
script proves that removing the added entries from the new manifest gives the old one back, key for key.

    python scripts/add_wind_to_bundle.py --bundle ../../MS/Data/terrain-bundle --backup work/backup/manifest_20261124.json
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from add_visibility_to_bundle import read_text, refresh_sharing_note
from common import load_json, load_yaml, setup_logging, source_ref
from package import PRODUCT_SOURCES, sources_block

log = setup_logging("add_wind")
SID = "era5_wind"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bundle", type=Path, default=Path("../../MS/Data/terrain-bundle"))
    ap.add_argument("--wind", type=Path, default=Path("work/wind"))
    ap.add_argument("--lock", type=Path, default=Path("sources.lock"))
    ap.add_argument("--checksums", type=Path, default=Path("work/raw/checksums.json"))
    ap.add_argument("--backup", type=Path, default=None, help="copy of the old manifest.json (skipped when it exists)")
    args = ap.parse_args()

    mpath = args.bundle / "manifest.json"
    old_text, nl = read_text(mpath)
    old = json.loads(old_text)
    if args.backup and not args.backup.exists():
        args.backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(mpath, args.backup)
        log.info("backup: %s", args.backup)

    # 1. the grid
    dest = args.bundle / "wind"
    dest.mkdir(exist_ok=True)
    for name in ("wind.json", "wind.bin"):
        shutil.copyfile(args.wind / name, dest / name)

    # 2. the manifest
    lock = load_yaml(args.lock)
    checks = load_json(args.checksums) if args.checksums.exists() else {}
    src = next(s for s in sources_block(lock, checks) if s["id"] == SID)
    new = json.loads(old_text)
    srcs = [s for s in new["sources"] if s["id"] != SID]
    ids = [s["id"] for s in srcs]
    after = "gsod" if "gsod" in ids else "worldclim"
    srcs.insert(ids.index(after) + 1, src)
    new["sources"] = srcs
    g, anchor = {}, ("visibility" if "visibility" in new["grotbc"] else "climate")
    for k, v in new["grotbc"].items():
        if k == "wind":
            continue
        g[k] = v
        if k == anchor:
            g["wind"] = {"index": "wind/wind.json", "data": "wind/wind.bin", "sources": PRODUCT_SOURCES["wind"]}
    assert "wind" in g, f"grotbc.{anchor} not found: nothing to insert after"
    new["grotbc"] = g
    out = json.dumps(new, indent=1, ensure_ascii=False, allow_nan=False).replace("\n", nl)
    mpath.write_bytes(out.encode("utf-8"))

    def bare(m: dict) -> dict:
        m = json.loads(json.dumps(m))
        m["sources"] = [s for s in m["sources"] if s["id"] != SID]
        m["grotbc"].pop("wind", None)
        return m
    if bare(json.loads(mpath.read_bytes().decode("utf-8"))) != bare(old):
        log.error("the manifest differs from the old one beyond the added entries; backup at %s", args.backup)
        return 1
    log.info("manifest: + sources[%s], + grotbc.wind; nothing else changed", SID)

    # 3. LICENSES.txt
    lpath = args.bundle / "LICENSES.txt"
    if lpath.exists():
        text, lnl = read_text(lpath)
        ref = source_ref(lock, SID)
        s = next(s for s in lock["sources"] if s["id"] == SID)
        block = [f"{s['name']}  [{s.get('version', '')}]",
                 f"  data date   : {s.get('dataDate', '')}",
                 f"  released    : {s.get('released', '')}",
                 f"  licence     : {s['licence']}",
                 f"  attribution : {s.get('attribution', '')}",
                 f"  source      : {s.get('landing', '')}"] + [f"  location    : {u}" for u in ref["location"]] + [""]
        head, sep, rest = text.partition(f"{s['name']}  [")
        if sep:       # a re-run: cut the old block (up to the blank line that ends it)
            rest = rest.split("\n\n", 1)[1] if "\n\n" in rest else ""
            text = head + rest
        marker = "WorldPop Pakistan 2026 population count"
        i = text.find(marker)
        if i < 0:
            log.warning("LICENSES.txt: anchor '%s' not found; appended at the end", marker)
            text = text.rstrip("\n") + "\n\n" + "\n".join(block)
        else:
            text = text[:i] + "\n".join(block) + "\n" + text[i:]
        text = refresh_sharing_note(text)
        lpath.write_bytes(text.replace("\n", lnl).encode("utf-8"))
        log.info("LICENSES.txt: ERA5 block and sharing note added")
    return 0


if __name__ == "__main__":
    sys.exit(main())
