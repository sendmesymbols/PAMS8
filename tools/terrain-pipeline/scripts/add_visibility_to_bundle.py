"""Add the visibility grid to an EXISTING bundle without rebuilding it (the live MS/Data/terrain-bundle).

package.py does this for a full build (copies work/visibility/, writes manifest.sources[] and grotbc.visibility). A
bundle that took hours to tile does not need a rebuild for one small grid, so this does the same three things in place:

    1. copies work/visibility/visibility.json + visibility.bin to <bundle>/visibility/
    2. inserts the `gsod` source after `worldclim` in manifest.sources and `grotbc.visibility` after `grotbc.climate`
       (the manifest is re-written with the formatting it has: indent 1, UTF-8, CRLF, no trailing newline)
    3. appends the GSOD block to LICENSES.txt after the WorldClim block

The manifest is backed up first; a re-run replaces the entries instead of adding a second set. After writing, the
script proves that removing the added entries from the new manifest gives the old one back, key for key.

    python scripts/add_visibility_to_bundle.py --bundle ../../MS/Data/terrain-bundle --backup work/backup/manifest_20261110.json
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from common import load_json, load_yaml, setup_logging, source_ref
from package import PRODUCT_SOURCES, SHARING_NOTE, sources_block

log = setup_logging("add_visibility")


def read_text(path: Path) -> tuple[str, str]:
    """(text with LF, the file's line ending)."""
    raw = path.read_bytes().decode("utf-8")
    return raw.replace("\r\n", "\n"), ("\r\n" if "\r\n" in raw else "\n")


def refresh_sharing_note(text: str) -> str:
    """Put the sharing-limits paragraph (package.SHARING_NOTE) in front of the "Derived data" paragraph, once."""
    note = "\n".join(SHARING_NOTE) + "\n\n"
    if SHARING_NOTE[0] in text:       # a re-run: replace the old paragraph
        a = text.index(SHARING_NOTE[0])
        b = text.index("Derived data (class and distance tiles)", a)
        return text[:a] + note + text[b:]
    i = text.find("Derived data (class and distance tiles)")
    return text if i < 0 else text[:i] + note + text[i:]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bundle", type=Path, default=Path("../../MS/Data/terrain-bundle"))
    ap.add_argument("--visibility", type=Path, default=Path("work/visibility"))
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
    dest = args.bundle / "visibility"
    dest.mkdir(exist_ok=True)
    for name in ("visibility.json", "visibility.bin"):
        shutil.copyfile(args.visibility / name, dest / name)

    # 2. the manifest
    lock = load_yaml(args.lock)
    checks = load_json(args.checksums) if args.checksums.exists() else {}
    gsod = next(s for s in sources_block(lock, checks) if s["id"] == "gsod")
    new = json.loads(old_text)
    srcs = [s for s in new["sources"] if s["id"] != "gsod"]
    at = next(i for i, s in enumerate(srcs) if s["id"] == "worldclim") + 1
    srcs.insert(at, gsod)
    new["sources"] = srcs
    g = {}
    for k, v in new["grotbc"].items():
        if k == "visibility":
            continue
        g[k] = v
        if k == "climate":
            g["visibility"] = {"index": "visibility/visibility.json", "data": "visibility/visibility.bin",
                               "sources": PRODUCT_SOURCES["visibility"]}
    assert "visibility" in g, "grotbc.climate not found: nothing to insert after"
    new["grotbc"] = g
    out = json.dumps(new, indent=1, ensure_ascii=False).replace("\n", nl)
    mpath.write_bytes(out.encode("utf-8"))

    # proof: the new manifest and the old one are equal once the entries this script owns are taken out of both
    def bare(m: dict) -> dict:
        m = json.loads(json.dumps(m))
        m["sources"] = [s for s in m["sources"] if s["id"] != "gsod"]
        m["grotbc"].pop("visibility", None)
        return m
    if bare(json.loads(mpath.read_bytes().decode("utf-8"))) != bare(old):
        log.error("the manifest differs from the old one beyond the added entries; backup at %s", args.backup)
        return 1
    log.info("manifest: + sources[gsod], + grotbc.visibility; nothing else changed")

    # 3. LICENSES.txt
    lpath = args.bundle / "LICENSES.txt"
    if lpath.exists():
        text, lnl = read_text(lpath)
        ref = source_ref(lock, "gsod")
        s = next(s for s in lock["sources"] if s["id"] == "gsod")
        block = [f"{s['name']}  [{s.get('version', '')}]",
                 f"  data date   : {s.get('dataDate', '')}",
                 f"  released    : {s.get('released', '')}",
                 f"  licence     : {s['licence']}",
                 f"  attribution : {s.get('attribution', '')}",
                 f"  source      : {s.get('landing', '')}"] + [f"  location    : {u}" for u in ref["location"]]
        block += ([f"  *** RESTRICTED USE: {s['restriction']} ***"] if s.get("restriction") else []) + [""]
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
        log.info("LICENSES.txt: GSOD block and sharing note added")
    return 0


if __name__ == "__main__":
    sys.exit(main())
