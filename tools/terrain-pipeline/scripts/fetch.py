"""Step 1 — download the pinned sources.

Inputs : sources.lock (YAML). Network access (the ONLY step that needs it).
Outputs: work/raw/<source id>/<file>  and  work/raw/checksums.json
         With --record, every `sha256: TO_BE_FILLED` in sources.lock is replaced
         by the recorded hash (per-source aggregate, see hash_source()).

Existing files are not re-downloaded; they are re-hashed and verified.
A source with `allow_missing: true` tolerates HTTP 404/403 (ocean-only tiles).
Downloads retry with backoff, resume partial `.part` files with a byte Range request, verify the
size, and run four at a time; a re-run after any failure continues where it stopped.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from common import dump_json, load_json, load_yaml, setup_logging

log = setup_logging("fetch")


def expand_files(src: dict) -> list[dict]:
    """Turn files / pattern+tiles / pattern+tile_range into [{name, url, bbox?}].

    `bbox` = (west, south, east, north) of the tile when it is known; a source with `only_intersecting:
    <boundary geojson>` keeps only the tiles that touch that polygon (the DEM range is a rectangle, but
    over half of it lies outside the country, so downloading it all wastes hours).
    """
    if "files" in src:
        return [dict(name=f["name"], url=f["url"]) for f in src["files"]]
    pat = src["pattern"]
    out = []
    if "tiles" in src:
        for t in src["tiles"]:
            url = pat.format(tile=t)
            e = dict(name=url.rsplit("/", 1)[-1], url=url)
            m = re.fullmatch(r"([NS])(\d+)([EW])(\d+)", t)                # WorldCover: 3-degree, south-west corner
            if m:
                la = int(m.group(2)) * (1 if m.group(1) == "N" else -1)
                lo = int(m.group(4)) * (1 if m.group(3) == "E" else -1)
                e["bbox"] = (lo, la, lo + 3, la + 3)
            m = re.fullmatch(r"(\d+)([EW])_(\d+)([NS])", t)                # JRC: 10-degree, NORTH-west corner
            if m:
                lo = int(m.group(1)) * (1 if m.group(2) == "E" else -1)
                la = int(m.group(3)) * (1 if m.group(4) == "N" else -1)
                e["bbox"] = (lo, la - 10, lo + 10, la)
            out.append(e)
    elif "tile_range" in src:
        la0, la1 = src["tile_range"]["lat"]
        lo0, lo1 = src["tile_range"]["lon"]
        for la in range(la0, la1 + 1):
            for lo in range(lo0, lo1 + 1):
                url = pat.format(lat=f"N{la:02d}", lon=f"E{lo:03d}")
                out.append(dict(name=url.rsplit("/", 1)[-1], url=url, bbox=(lo, la, lo + 1, la + 1)))
    return filter_by_boundary(out, src)


def filter_by_boundary(files: list[dict], src: dict) -> list[dict]:
    """Apply `only_intersecting` (a GeoJSON polygon path). A missing boundary file keeps every tile."""
    spec = src.get("only_intersecting")
    if not spec:
        return files
    path = Path(spec)
    if not path.exists():
        log.warning("%s: boundary %s not found - keeping ALL %d tiles (run make_boundary.py first to download only "
                    "the tiles the country needs)", src["id"], spec, len(files))
        return files
    import shapely
    geom = shapely.from_geojson(path.read_text(encoding="utf-8"))
    shapely.prepare(geom)
    kept = [f for f in files if "bbox" not in f or geom.intersects(shapely.box(*f["bbox"]))]
    log.info("%s: %d of %d tiles intersect %s", src["id"], len(kept), len(files), path.name)
    return kept


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


MAX_ATTEMPTS = 6
WORKERS = int(os.environ.get("FETCH_WORKERS", "4"))     # parallel downloads; raise on a fast link (the DEM is ~270 tiles)


def _fetch_once(url: str, tmp: Path) -> int:
    """One attempt: resume `tmp` with a Range request when it already holds bytes. Returns the final size.

    Raises on any network error (the caller retries). A server that ignores Range (HTTP 200) restarts the file.
    """
    have = tmp.stat().st_size if tmp.exists() else 0
    req = urllib.request.Request(url, headers={"Range": f"bytes={have}-"} if have else {})
    try:
        resp = urllib.request.urlopen(req, timeout=60)
    except urllib.error.HTTPError as exc:
        if exc.code == 416 and have:           # range starts at/after the end: complete only if the sizes agree
            m = re.search(r"/(\d+)\s*$", exc.headers.get("Content-Range") or "")
            if m and int(m.group(1)) == have:
                return have
            tmp.unlink(missing_ok=True)        # oversize / unknown: it is corrupt, start this file again
            raise IOError(f"{tmp.name}: partial file is {have} bytes but the server has {m.group(1) if m else '?'}; restarting")
        raise
    with resp:
        if have and resp.status != 206:        # no resume support: start over
            have = 0
        total = int(resp.headers.get("Content-Length") or 0) + have
        with open(tmp, "ab" if have else "wb") as out:
            while True:
                chunk = resp.read(1 << 20)
                if not chunk:
                    break
                out.write(chunk)
                have += len(chunk)
    if total and have != total:
        raise IOError(f"incomplete download: got {have} of {total} bytes")
    return have


def download(url: str, dest: Path, allow_missing: bool) -> bool:
    """Download with retries, resume and size verification. False = skipped (missing, allowed)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            size = _fetch_once(url, tmp)
            tmp.replace(dest)
            log.info("  %s  %.1f MB", dest.name, size / 1e6)
            return True
        except urllib.error.HTTPError as exc:
            if exc.code in (403, 404) and allow_missing:   # S3 answers 403 for keys that do not exist
                tmp.unlink(missing_ok=True)
                log.warning("  %s: HTTP %d, skipped (allow_missing)", dest.name, exc.code)
                return False
            if exc.code < 500 and exc.code != 429:
                raise                                       # a client error will not fix itself
            err: Exception = exc
        except (urllib.error.URLError, OSError, TimeoutError) as exc:   # includes IncompleteRead, resets, timeouts
            err = exc
        if attempt == MAX_ATTEMPTS:
            raise err
        wait = min(60, 2 ** attempt)
        log.warning("  %s: %s - retry %d/%d in %ds", dest.name, err, attempt, MAX_ATTEMPTS - 1, wait)
        time.sleep(wait)
    return False


def remote_size(url: str) -> int | None:
    """Content-Length of `url` from a HEAD request (None if the server does not say)."""
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=30) as r:
                return int(r.headers.get("Content-Length") or 0) or None
        except urllib.error.HTTPError as exc:
            if exc.code in (403, 404):
                return None
        except (urllib.error.URLError, OSError, TimeoutError):
            pass
        time.sleep(2 ** attempt)
    return None


def verify_sizes(lock: dict, out: Path, only: list[str] | None) -> int:
    """Compare every downloaded file with the server's size; delete the ones that differ so the next
    run fetches them again. Catches interrupted or doubly-written downloads. Returns the number removed."""
    bad = checked = 0
    for src in lock["sources"]:
        if only and src["id"] not in only:
            continue
        for f in expand_files(src):
            dest = out / src["id"] / f["name"]
            if not dest.exists():
                continue
            checked += 1
            want = remote_size(f["url"])
            have = dest.stat().st_size
            if want is not None and want != have:
                log.error("SIZE MISMATCH %s: have %d, server %d - deleting", dest.name, have, want)
                dest.unlink()
                bad += 1
    log.info("size check: %d file(s) compared, %d removed", checked, bad)
    return bad


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
    ap.add_argument("--verify-size", action="store_true",
                    help="before fetching, compare existing files with the server's size and delete mismatches")
    args = ap.parse_args()

    lock = load_yaml(args.lock)
    if args.verify_size and not args.dry_run:
        verify_sizes(lock, args.out, args.only)
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
        if args.dry_run:
            for f in files:
                log.info("  would fetch %s", f["url"])
            continue

        def get(f: dict) -> tuple[str, str | None]:
            dest = args.out / sid / f["name"]
            if not dest.exists():
                log.info("  GET %s", f["url"])
                if not download(f["url"], dest, bool(src.get("allow_missing"))):
                    return f["name"], None
            return f["name"], sha256_file(dest)

        # A few files at a time: the DEM alone is ~250 tiles. One failed file stops this source (after
        # its retries) but every finished file is kept, so re-running resumes where it stopped.
        with ThreadPoolExecutor(WORKERS) as pool:
            for name, digest in pool.map(get, files):
                if digest is not None:
                    file_hashes[name] = digest
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
