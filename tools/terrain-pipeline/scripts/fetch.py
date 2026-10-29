"""Step 1 — download the pinned sources.

Inputs : sources.lock (YAML). Network access (the ONLY step that needs it).
Outputs: work/raw/<source id>/<file>  and  work/raw/checksums.json
         With --record, every `sha256: TO_BE_FILLED` in sources.lock is replaced
         by the recorded hash (per-source aggregate, see hash_source()).

Existing files are not re-downloaded; they are re-hashed and verified.
A source with `allow_missing: true` tolerates HTTP 404 (ocean-only tiles).
"""
from __future__ import annotations

import argparse
import hashlib
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

from common import dump_json, load_json, load_yaml, setup_logging

log = setup_logging("fetch")


def expand_files(src: dict) -> list[dict]:
    """Turn files / pattern+tiles / pattern+tile_range into [{name, url}]."""
    if "files" in src:
        return [dict(name=f["name"], url=f["url"]) for f in src["files"]]
    pat = src["pattern"]
    out = []
    if "tiles" in src:
        for t in src["tiles"]:
            out.append(dict(name=pat.format(tile=t).rsplit("/", 1)[-1], url=pat.format(tile=t)))
    elif "tile_range" in src:
        la0, la1 = src["tile_range"]["lat"]
        lo0, lo1 = src["tile_range"]["lon"]
        for la in range(la0, la1 + 1):
            for lo in range(lo0, lo1 + 1):
                url = pat.format(lat=f"N{la:02d}", lon=f"E{lo:03d}")
                out.append(dict(name=url.rsplit("/", 1)[-1], url=url))
    return out


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url: str, dest: Path, allow_missing: bool) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    try:
        with urllib.request.urlopen(url, timeout=120) as resp, open(tmp, "wb") as out:
            total = int(resp.headers.get("Content-Length") or 0)
            got = 0
            for chunk in iter(lambda: resp.read(1 << 20), b""):
                out.write(chunk)
                got += len(chunk)
            log.info("  %s  %.1f MB%s", dest.name, got / 1e6,
                     "" if not total or got == total else f" (expected {total})")
    except urllib.error.HTTPError as exc:
        tmp.unlink(missing_ok=True)
        if exc.code == 404 and allow_missing:
            log.warning("  %s: 404, skipped (allow_missing)", dest.name)
            return False
        raise
    tmp.replace(dest)
    return True


def hash_source(file_hashes: dict[str, str]) -> str:
    """Aggregate hash of a multi-file source: sha256 over sorted 'name hash' lines."""
    lines = "\n".join(f"{n} {h}" for n, h in sorted(file_hashes.items())) + "\n"
    return hashlib.sha256(lines.encode()).hexdigest()


def record_lock(lock_path: Path, hashes: dict[str, str]) -> None:
    """Replace `sha256: TO_BE_FILLED` under each `id:` with the recorded hash,
    editing the YAML as text so comments survive."""
    text = lock_path.read_text(encoding="utf-8")
    for sid, h in hashes.items():
        pat = re.compile(rf"(- id: {re.escape(sid)}\b.*?sha256:\s*)TO_BE_FILLED", re.S)
        text, n = pat.subn(rf"\g<1>{h}", text, count=1)
        if n == 0:
            log.warning("sources.lock: no TO_BE_FILLED placeholder for %s", sid)
    lock_path.write_text(text, encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lock", type=Path, default=Path("sources.lock"))
    ap.add_argument("--out", type=Path, default=Path("work/raw"))
    ap.add_argument("--only", nargs="*", help="source ids to fetch (default all)")
    ap.add_argument("--record", action="store_true", help="write missing hashes into sources.lock")
    ap.add_argument("--dry-run", action="store_true", help="list files, download nothing")
    args = ap.parse_args()

    lock = load_yaml(args.lock)
    checks_path = args.out / "checksums.json"
    checks = load_json(checks_path) if checks_path.exists() else {}
    failures, recorded = 0, {}

    for src in lock["sources"]:
        sid = src["id"]
        if args.only and sid not in args.only:
            continue
        files = expand_files(src)
        log.info("%s: %d file(s) [%s]", sid, len(files), src["licence"])
        file_hashes: dict[str, str] = {}
        for f in files:
            dest = args.out / sid / f["name"]
            if args.dry_run:
                log.info("  would fetch %s", f["url"])
                continue
            if not dest.exists():
                log.info("  GET %s", f["url"])
                if not download(f["url"], dest, bool(src.get("allow_missing"))):
                    continue
            file_hashes[f["name"]] = sha256_file(dest)
        if args.dry_run:
            continue
        if not file_hashes:
            log.error("%s: nothing downloaded", sid)
            failures += 1
            continue
        agg = hash_source(file_hashes)
        checks[sid] = dict(files=file_hashes, sha256=agg)
        expected = str(src.get("sha256", "TO_BE_FILLED"))
        if expected == "TO_BE_FILLED":
            log.warning("%s: no pinned hash; computed %s%s", sid, agg,
                        " (recording)" if args.record else " (use --record to pin)")
            recorded[sid] = agg
        elif expected != agg:
            log.error("%s: HASH MISMATCH expected %s got %s", sid, expected, agg)
            failures += 1
        else:
            log.info("%s: hash OK", sid)

    if not args.dry_run:
        dump_json(checks_path, checks)
        if args.record and recorded:
            record_lock(args.lock, recorded)
            log.info("recorded %d hash(es) into %s", len(recorded), args.lock)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
