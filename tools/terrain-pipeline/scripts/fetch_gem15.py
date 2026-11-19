"""Step 1d — Google GEM-15 (15 m DTM / DSM) for the cells that touch the bundle's data extent.

GEM-15 is one Cloud-Optimized GeoTIFF per 1 x 1 degree cell and asset, each in its local UTM zone, listed in a static STAC
index (items.ndjson). The file names carry a group and cell id that cannot be built from lat / lon reliably (the cell
73-74 E 33-34 N is `p30_p70/w73s33`), so this step reads the index instead of a pattern; sources.lock `gem15` carries
`fetched_by: scripts/fetch_gem15.py` and fetch.py skips it.

    1. work/raw/gem15/items.ndjson        the STAC index (13,485 cells, ~49 MB), fetched once (--refresh-index again)
    2. the cells whose 1-degree box intersects --boundary (default work/boundary/clip.geojson, the same filter as glo30)
       are written to work/raw/gem15/cells_selected.json, fullest cells first
    3. work/raw/gem15/<asset>/<cell>.tif for each asset of --assets (dtm by default; dsm is ~5x larger), resumed from
       .part files, retried, then checked against the bucket's MD5 (x-goog-hash). Checked files are remembered in
       work/raw/gem15/verified.json (size, md5, sha256) so a re-run skips them without re-reading.
    4. when every selected file is present, the sha256s go to work/raw/checksums.json under `gem15`.

The bucket is public (no login, no requester-pays). Licence CC BY 4.0, attribution "This dataset is produced by Google".
Heights are orthometric on EGM96 (Copernicus GLO-30 is on EGM2008). India's data is deliberately offset by Google and
the offset tapers over tens of km outside India's border, so it reaches AJK and the border belt (see sources.lock).

    python scripts/fetch_gem15.py --list                 # what would be fetched, and its size
    python scripts/fetch_gem15.py                        # the DTM
    python scripts/fetch_gem15.py --assets dtm,dsm       # both
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))      # works under `python -I` too

from common import dump_json, load_json, setup_logging      # noqa: E402
from fetch import download, hash_source                     # noqa: E402

log = setup_logging("fetch_gem15")

INDEX_URL = "https://storage.googleapis.com/climate-and-sustainability/gem-15/stac/items.ndjson"
UA = "terrain-pipeline/0.1"     # generic on purpose: nothing about the user or the project goes to the server


def fetch_index(dest: Path, refresh: bool) -> None:
    if dest.exists() and not refresh:
        return
    log.info("index: %s", INDEX_URL)
    download(INDEX_URL, dest, False)


def select_cells(index: Path, boundary: Path, assets: list[str]) -> list[dict]:
    import shapely
    geom = None
    if boundary.exists():
        geom = shapely.from_geojson(boundary.read_text(encoding="utf-8"))
        shapely.prepare(geom)
    else:
        log.warning("boundary %s not found - every cell in the index would be selected; refusing", boundary)
        raise SystemExit(1)
    cells = []
    with open(index, encoding="utf-8") as fh:
        for line in fh:
            it = json.loads(line)
            cell_box = shapely.box(*it["bbox"])
            if not geom.intersects(cell_box):
                continue
            share = shapely.area(shapely.intersection(geom, cell_box)) / shapely.area(cell_box)
            cid = it["properties"]["gem:cell_id"]
            row = dict(cell=cid, group=it["properties"]["gem:group_id"], bbox=it["bbox"],
                       epsg=it["properties"]["proj:epsg"], inside=round(share, 3), assets={})
            for a in assets:
                asset = it["assets"].get(a)
                if asset is None:
                    log.warning("%s: no %s asset", cid, a)
                    continue
                row["assets"][a] = dict(url=asset["href"], size=int(asset.get("file:size") or 0))
            cells.append(row)
    cells.sort(key=lambda c: (-c["inside"], c["cell"]))
    return cells


def remote_md5(url: str) -> str | None:
    """Hex MD5 from the bucket's x-goog-hash header (absent for composite objects)."""
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                for v in resp.headers.get_all("x-goog-hash") or []:
                    for part in v.split(","):
                        k, _, b64 = part.strip().partition("=")
                        if k == "md5":
                            return base64.b64decode(b64).hex()
                return None
        except Exception as exc:                            # noqa: BLE001 - retried, then reported
            if attempt == 3:
                raise
            log.warning("HEAD %s: %s - retry", url.rsplit("/gem-15/", 1)[-1], exc)
            time.sleep(2 ** (attempt + 1))
    return None


def hashes(path: Path) -> tuple[str, str]:
    md5, sha = hashlib.md5(), hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 22), b""):
            md5.update(chunk)
            sha.update(chunk)
    return md5.hexdigest(), sha.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--assets", default="dtm", help="comma list of dtm, dsm")
    ap.add_argument("--boundary", type=Path, default=Path("work/boundary/clip.geojson"))
    ap.add_argument("--out", type=Path, default=Path("work/raw"))
    ap.add_argument("--workers", type=int, default=3, help="parallel files (the link, not the bucket, is the limit)")
    ap.add_argument("--limit", type=int, default=0, help="only the first N cells (testing)")
    ap.add_argument("--list", action="store_true", help="select and report sizes, download nothing")
    ap.add_argument("--refresh-index", action="store_true")
    args = ap.parse_args()

    assets = [a.strip() for a in args.assets.split(",") if a.strip()]
    if not set(assets) <= {"dtm", "dsm"}:
        log.error("--assets takes dtm and / or dsm")
        return 1
    root = args.out / "gem15"
    root.mkdir(parents=True, exist_ok=True)
    index = root / "items.ndjson"
    fetch_index(index, args.refresh_index)
    cells = select_cells(index, args.boundary, assets)
    dump_json(root / "cells_selected.json", cells)
    if args.limit:
        cells = cells[: args.limit]

    jobs = [(c["cell"], a, c["assets"][a]["url"], c["assets"][a]["size"]) for c in cells for a in assets if a in c["assets"]]
    total = sum(j[3] for j in jobs)
    log.info("%d cells, %d files, %.1f GB (%s)", len(cells), len(jobs), total / 1e9, ", ".join(
        f"{a} {sum(j[3] for j in jobs if j[1] == a) / 1e9:.1f} GB" for a in assets))
    if args.list:
        return 0

    vpath = root / "verified.json"
    verified: dict = load_json(vpath) if vpath.exists() else {}
    lock = threading.Lock()
    done_bytes = [0]
    t0 = time.time()

    def name_of(cell: str, asset: str) -> str:
        return f"{asset}/{cell}.tif"

    todo = []
    for cell, asset, url, size in jobs:
        name = name_of(cell, asset)
        dest = root / name
        v = verified.get(name)
        if v and dest.exists() and dest.stat().st_size == v["size"] == size:
            continue
        todo.append((cell, asset, url, size))
    todo_bytes = sum(j[3] for j in todo)
    log.info("%d files already checked, %d to fetch (%.1f GB)", len(jobs) - len(todo), len(todo), todo_bytes / 1e9)

    def get(job: tuple) -> tuple[str, bool]:
        cell, asset, url, size = job
        name = name_of(cell, asset)
        dest = root / name
        want = remote_md5(url)
        if not (dest.exists() and dest.stat().st_size == size):
            download(url, dest, False)
        md5, sha = hashes(dest)
        if want and md5 != want:
            dest.unlink(missing_ok=True)
            log.error("  %s: MD5 %s does not match the bucket's %s - deleted, run again", name, md5, want)
            return name, False
        with lock:
            verified[name] = dict(size=dest.stat().st_size, md5=md5, sha256=sha, md5_checked=bool(want))
            tmp = vpath.with_suffix(".json.tmp")              # a kill mid-write must not lose the record
            dump_json(tmp, verified)
            tmp.replace(vpath)
            done_bytes[0] += size
            rate = done_bytes[0] / max(1.0, time.time() - t0)
            left = (todo_bytes - done_bytes[0]) / max(rate, 1.0)
            log.info("  ok %s  %.0f MB | %.1f / %.1f GB, %.2f MB/s, about %.1f h left", name, size / 1e6,
                     done_bytes[0] / 1e9, todo_bytes / 1e9, rate / 1e6, left / 3600)
        return name, True

    failed = []
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
        futs = {ex.submit(get, j): j for j in todo}
        for f in as_completed(futs):
            try:
                name, ok = f.result()
                if not ok:
                    failed.append(name)
            except Exception as exc:                        # noqa: BLE001 - one bad cell must not stop the rest
                job = futs[f]
                failed.append(name_of(job[0], job[1]))
                log.error("  %s: %s", name_of(job[0], job[1]), exc)

    if failed:
        log.error("%d files failed (run again to resume): %s", len(failed), ", ".join(sorted(failed)[:20]))
        return 1
    if args.limit:
        log.info("--limit run: checksums.json not updated")
        return 0
    files = {name_of(c, a): verified[name_of(c, a)]["sha256"] for c, a, _, _ in jobs}
    files["items.ndjson"] = hashes(index)[1]
    checks_path = args.out / "checksums.json"
    checks = load_json(checks_path) if checks_path.exists() else {}
    checks["gem15"] = dict(files=files, sha256=hash_source(files))
    dump_json(checks_path, checks)
    log.info("gem15: %d files, aggregate sha256 %s (copy it to sources.lock)", len(files), checks["gem15"]["sha256"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
