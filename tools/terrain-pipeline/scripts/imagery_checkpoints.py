"""Step I2 — check points: measure the bundle's sources against the 0.25 m imagery before anything is taken from it.

Random points, stratified by the bundle's class layer so rare ground (trees, built-up, water, mapped tracks) gets as
many points as common ground, inside the latest imagery sheet of each place (work/imagery/latest.json, imagery_index.py).
For each point: two image chips (the 38 m cell at ~0.5 m, and its surroundings at ~2 m) and what every candidate source
says there, so that once people have labelled the chips, imagery_accuracy.py can say how often each source is right,
by type of ground. The labels, not this script, are the truth.

Inputs : work/imagery/latest.json; work/classify/class.tif and cc.tif, work/grotbc/route.tif (the bundle's own calls);
         work/raw/worldcover (ESA WorldCover 2021, 10 m); D:/Imagery/Misc/Trees/pak_ctrees_aboveground_biomass.tif
         (CTrees 2025, 100 m, Mg/ha x 10); the Meta / WRI 1 m canopy height (CHM) read by window over HTTP
         (s3 dataforgood-fb-data/forests/v1/alsgedi_global_v6_float), nothing downloaded in bulk.
Outputs: work/imagery/checkpoints/points.json   points, sheet / year / file, every source's call
         work/imagery/checkpoints/points.js     the same for the labelling page (file:// cannot fetch JSON)
         work/imagery/checkpoints/chips/<id>_n.jpg, <id>_c.jpg
         work/imagery/checkpoints/label.html    the labelling page (a copy of ../imagery_label.html): opens from disk,
                                                saves in the browser, Export writes labels.json
The imagery is restricted: everything stays under work/ (git-ignored), never in the bundle or online.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import setup_logging  # noqa: E402

log = setup_logging("imagery_checkpoints")

# class.tif code groups (classes.yaml) -> stratum
STRATA = {
    "trees": {1, 7, 29, 30, 31},
    "crop": {2, 23, 48},
    "open": {0},
    "desert": {12, 13, 14, 16, 17},
    "rock_hill": {9, 10, 15, 18, 19, 27},
    "built": {3, 32},
    "water": {4, 5, 6, 20, 21, 22, 46, 47},
    "track": {38},
}
CLASS_NAMES = {0: "open_land", 1: "tree_cover", 2: "cropland", 3: "built_up", 4: "water_permanent", 5: "water_seasonal",
               6: "wetland", 7: "mangrove", 9: "steep_slope", 10: "moderate_slope", 12: "bare_desert", 13: "sand",
               14: "dunes", 15: "rocky_ground", 16: "salt_pan", 17: "dry_riverbed", 18: "gentle_slope",
               19: "sloping_ground", 20: "canal", 21: "distributary", 22: "drain", 23: "irrigated_cropland",
               27: "escarpment", 29: "walled_orchard", 30: "orchard", 31: "forest", 32: "graveyard", 38: "road_unmetalled",
               46: "stream_perennial", 47: "nullah_dry", 48: "irrigated_wire"}
WORLDCOVER = {10: "tree", 20: "shrub", 30: "grass", 40: "crop", 50: "built", 60: "bare", 70: "snow", 80: "water",
              90: "wetland", 95: "mangrove", 100: "moss"}
# Meta / WRI canopy height: v1 (2024, imagery ~2009-2020) and v2 (2026, DINOv3, with an imagery date per patch).
# Both are read so the check points can say which is right more often (the data rule says take the latest).
CHM = {"v1": ("https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float", 9),
       "v2": ("https://dataforgood-fb-data.s3.amazonaws.com/forests/v2/global/dinov3_global_chm_v2_ml3", 10)}
CTREES = Path("D:/Imagery/Misc/Trees/pak_ctrees_aboveground_biomass.tif")
R = 6378137.0


def merc(lon, lat):
    return math.radians(lon) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R


def deg_box(lon, lat, half_m):
    dlat = half_m / 111320.0
    dlon = half_m / (111320.0 * max(0.2, math.cos(math.radians(lat))))
    return lon - dlon, lat - dlat, lon + dlon, lat + dlat


def quadkey(lon, lat, z):
    s = math.sin(math.radians(lat))
    x = int((lon + 180) / 360 * 2 ** z)
    y = int((0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * 2 ** z)
    q = ""
    for i in range(z, 0, -1):
        d = 0
        m = 1 << (i - 1)
        if x & m:
            d += 1
        if y & m:
            d += 2
        q += str(d)
    return q


def chip(path: str, lon: float, lat: float, half_m: float, px: int, box_half_m: float | None):
    """An RGB chip of 2*half_m ground metres, px x px, from the sheet's overviews; a square of box_half_m drawn."""
    import rasterio
    from PIL import Image, ImageDraw
    from rasterio.enums import Resampling
    from rasterio.windows import from_bounds
    with rasterio.open(path) as d:
        bb = deg_box(lon, lat, half_m)
        if d.crs is not None and d.crs.to_epsg() != 4326:        # the 4 Web Mercator sheets
            from rasterio.warp import transform_bounds
            bb = transform_bounds("EPSG:4326", d.crs, *bb)
        w = from_bounds(*bb, transform=d.transform)
        a = d.read([1, 2, 3], window=w, out_shape=(3, px, px), boundless=True, fill_value=0,
                   resampling=Resampling.bilinear)
    rgb = np.moveaxis(a, 0, -1).astype(np.uint8)
    empty = float(((rgb.max(axis=2) <= 5) | (rgb.min(axis=2) >= 250)).mean())
    im = Image.fromarray(rgb)
    dr = ImageDraw.Draw(im)
    c = px / 2
    if box_half_m:
        h = px * box_half_m / (2 * half_m)
        dr.rectangle([c - h, c - h, c + h, c + h], outline=(255, 230, 0), width=2)
    dr.ellipse([c - 2, c - 2, c + 2, c + 2], outline=(255, 0, 0), width=1)
    return im, empty


class Sources:
    """What each candidate source says at a point. GDAL file handles are not thread-safe: the bundle layers are read
    in the (single-threaded) sampling loop; WorldCover and CTrees, read from the worker threads, get one handle per
    thread (a shared handle failed with TIFFReadEncodedTile errors and could return wrong pixels)."""

    def __init__(self, work: Path):
        import threading
        import rasterio
        self.cls = rasterio.open(work / "classify" / "class.tif")
        self.cc = rasterio.open(work / "classify" / "cc.tif")
        self.route = rasterio.open(work / "grotbc" / "route.tif")
        self.wc_dir = work / "raw" / "worldcover"
        self._tl = threading.local()
        self._meta = {}
        self._meta_lock = threading.Lock()

    def _open(self, path: Path):
        """This thread's handle on `path` (None when the file is not there)."""
        import rasterio
        h = getattr(self._tl, "h", None)
        if h is None:
            h = self._tl.h = {}
        if path not in h:
            h[path] = rasterio.open(path) if path.exists() else None
        return h[path]

    def _px(self, ds, x, y):
        r, c = ds.index(x, y)
        if 0 <= r < ds.height and 0 <= c < ds.width:
            from rasterio.windows import Window
            return int(ds.read(1, window=Window(c, r, 1, 1))[0, 0])
        return None

    def bundle(self, lon, lat):
        x, y = merc(lon, lat)
        k = self._px(self.cls, x, y)
        rt = self._px(self.route, x, y)
        return {"class": k, "className": CLASS_NAMES.get(k, str(k)), "cc": self._px(self.cc, x, y),
                "route": rt, "routeHere": bool(rt) and rt != 255}

    def worldcover(self, lon, lat, half_m):
        import rasterio
        from rasterio.windows import from_bounds
        la, lo = int(math.floor(lat / 3) * 3), int(math.floor(lon / 3) * 3)
        name = f"ESA_WorldCover_10m_2021_v200_{'N' if la >= 0 else 'S'}{abs(la):02d}{'E' if lo >= 0 else 'W'}{abs(lo):03d}_Map.tif"
        ds = self._open(self.wc_dir / name)
        if ds is None:
            return None
        a = ds.read(1, window=from_bounds(*deg_box(lon, lat, half_m), transform=ds.transform), boundless=True, fill_value=0)
        vals = Counter(int(v) for v in a.ravel() if v)
        if not vals:
            return None
        top = vals.most_common(1)[0][0]
        return {"top": WORLDCOVER.get(top, str(top)), "treePct": round(100 * vals.get(10, 0) / sum(vals.values())),
                "shares": {WORLDCOVER.get(k, str(k)): round(100 * v / sum(vals.values())) for k, v in vals.items()}}

    def ctrees_agb(self, lon, lat):
        ds = self._open(CTREES)
        if ds is None:
            return None
        v = self._px(ds, lon, lat)
        return None if v is None or v < 0 else round(v / 10.0, 1)      # int16 x 10 -> Mg/ha

    def chm_date(self, version, qk, lon, lat):
        """v2 only: the imagery date of the patch under the point (metadata/<tile>.geojson, cached per tile)."""
        import urllib.request
        import shapely
        key = (version, qk)
        with self._meta_lock:
            have = self._meta.get(key)
        if have is None:
            try:
                with urllib.request.urlopen(f"{CHM[version][0]}/metadata/{qk}.geojson", timeout=60) as r:
                    fc = json.loads(r.read().decode("utf-8"))
                have = [(shapely.geometry.shape(f["geometry"]), f["properties"].get("acq_date"))
                        for f in fc.get("features", [])]
            except Exception:  # noqa: BLE001
                have = []
            with self._meta_lock:
                self._meta[key] = have
        pt = shapely.Point(lon, lat)
        return next((d for g, d in have if g.covers(pt)), None)

    def chm(self, lon, lat, half_m, version="v2"):
        """Canopy height in the cell: share of 1 m pixels >= 3 m and >= 5 m, max height; None when not covered."""
        import rasterio
        from rasterio.windows import from_bounds
        base, z = CHM[version]
        qk = quadkey(lon, lat, z)
        url = f"/vsicurl/{base}/chm/{qk}.tif"
        try:
            with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
                              GDAL_HTTP_MAX_RETRY="3", GDAL_HTTP_RETRY_DELAY="2"):
                with rasterio.open(url) as ds:
                    from rasterio.warp import transform_bounds
                    bb = transform_bounds("EPSG:4326", ds.crs, *deg_box(lon, lat, half_m))
                    a = ds.read(1, window=from_bounds(*bb, transform=ds.transform), boundless=True,
                                fill_value=0).astype("float32")
        except Exception as e:  # noqa: BLE001
            return {"error": str(e)[:120]}
        if a.size == 0:
            return None
        out = {"tree3Pct": round(100 * float((a >= 3).mean())), "tree5Pct": round(100 * float((a >= 5).mean())),
               "maxM": round(float(a.max()), 1), "tile": qk}
        if version == "v2":
            out["date"] = self.chm_date(version, qk, lon, lat)
        return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--work", type=Path, default=Path("work"))
    ap.add_argument("--out", type=Path, default=Path("work/imagery/checkpoints"))
    ap.add_argument("--per-stratum", type=int, default=75)
    ap.add_argument("--seed", type=int, default=20261111)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--no-chm", action="store_true", help="skip the canopy-height reads (offline)")
    args = ap.parse_args()
    import rasterio
    out, chips = args.out, args.out / "chips"
    chips.mkdir(parents=True, exist_ok=True)
    latest = json.loads((args.work / "imagery" / "latest.json").read_text(encoding="utf-8"))["sheets"]
    sheets = [s for s in latest.values() if s.get("emptyPct", 0) < 20]
    log.info("%d sheets to sample (less than 20 %% empty)", len(sheets))
    src = Sources(args.work)
    rnd = random.Random(args.seed)
    want = {k: args.per_stratum for k in STRATA}
    code_to = {c: k for k, cs in STRATA.items() for c in cs}
    picked, tries = [], 0
    # province / folder spread: draw a sheet first (each sheet equally likely), then a point in it
    while any(want.values()) and tries < 400_000:
        tries += 1
        s = rnd.choice(sheets)
        w, so, e, n = s["boundsLL"]
        lon, lat = rnd.uniform(w, e), rnd.uniform(so, n)
        b = src.bundle(lon, lat)
        k = code_to.get(b["class"])
        if k is None or want[k] <= 0:
            continue
        # one point per sheet and stratum keeps them spread out
        if any(p["sheet"] == s["sheet"] and p["stratum"] == k for p in picked):
            continue
        picked.append({"lon": round(lon, 6), "lat": round(lat, 6), "stratum": k, "sheet": s["sheet"], "year": s["year"],
                       "file": s["path"], "folder": s["folder"], "bundle": b})
        want[k] -= 1
    log.info("sampled %d points in %d tries; short: %s", len(picked), tries, {k: v for k, v in want.items() if v})

    def work_one(i_p):
        i, p = i_p
        pid = f"P{i:04d}"
        try:
            near, e1 = chip(p["file"], p["lon"], p["lat"], 60, 240, 19)        # 120 m at 0.5 m, the 38 m cell boxed
            ctx, e2 = chip(p["file"], p["lon"], p["lat"], 240, 240, 60)        # 480 m at 2 m, the 120 m chip boxed
            near.save(chips / f"{pid}_n.jpg", quality=88)
            ctx.save(chips / f"{pid}_c.jpg", quality=85)
        except Exception as ex:  # noqa: BLE001
            return {**p, "id": pid, "chipError": str(ex)[:160]}
        rec = {**p, "id": pid, "chipEmptyPct": round(100 * e1)}
        rec["worldcover"] = src.worldcover(p["lon"], p["lat"], 19)
        rec["ctreesAgb"] = src.ctrees_agb(p["lon"], p["lat"])
        rec["chm"] = None if args.no_chm else src.chm(p["lon"], p["lat"], 19, "v2")
        rec["chmV1"] = None if args.no_chm else src.chm(p["lon"], p["lat"], 19, "v1")
        return rec

    t0 = time.time()
    recs = []
    with ThreadPoolExecutor(args.workers) as ex:
        for j, r in enumerate(ex.map(work_one, enumerate(picked, 1)), 1):
            recs.append(r)
            if j % 100 == 0:
                log.info("  %d / %d points done (%.0f s)", j, len(picked), time.time() - t0)
    bad = [r for r in recs if r.get("chipError") or r.get("chipEmptyPct", 0) > 30]
    keep = [r for r in recs if r not in bad]
    doc = {"built": time.strftime("%Y-%m-%dT%H:%M:%S"), "seed": args.seed, "perStratum": args.per_stratum,
           "strata": {k: sorted(v) for k, v in STRATA.items()}, "cellM": 38,
           "chips": {"n": "120 m square at ~0.5 m, the 38 m bundle cell boxed in yellow",
                     "c": "480 m square at ~2 m, the 120 m chip boxed"},
           "sources": {"bundle": "class.tif / cc.tif / route.tif of this pipeline",
                       "worldcover": "ESA WorldCover 2021 v200, 10 m, in the 38 m cell",
                       "ctreesAgb": "CTrees above-ground biomass 2025, 100 m, Mg/ha",
                       "chm": "Meta / WRI canopy height v2 (2026, 1.2 m, imagery date per patch), share >= 3 m / 5 m in the cell",
                       "chmV1": "Meta / WRI canopy height v1 (2024, 1.2 m, imagery about 2009-2020), the same"},
           "dropped": [{"id": r["id"], "why": r.get("chipError") or f"chip {r.get('chipEmptyPct')} % empty"} for r in bad],
           "points": keep}
    (out / "points.json").write_text(json.dumps(doc, indent=1), encoding="utf-8")
    (out / "points.js").write_text("window.CHECKPOINTS = " + json.dumps(doc) + ";\n", encoding="utf-8")
    page = Path(__file__).resolve().parent.parent / "imagery_label.html"
    if page.exists():
        (out / "label.html").write_text(page.read_text(encoding="utf-8"), encoding="utf-8")
    log.info("points: %d kept, %d dropped; by stratum %s; by folder %s", len(keep), len(bad),
             dict(Counter(r["stratum"] for r in keep)), dict(Counter(r["folder"] for r in keep)))
    chm_ok = sum(1 for r in keep if isinstance(r.get("chm"), dict) and "error" not in r["chm"])
    log.info("CHM read at %d points; WorldCover at %d; CTrees at %d", chm_ok,
             sum(1 for r in keep if r.get("worldcover")), sum(1 for r in keep if r.get("ctreesAgb") is not None))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
