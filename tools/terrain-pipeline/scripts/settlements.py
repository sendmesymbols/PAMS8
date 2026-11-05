"""Step 4d — settlements (GROTBC B): built-up areas grouped into named settlements with population and size class.

Inputs : work/classify/class.tif (built_up = 3), WorldPop 2026 population and age-sex rasters (common.WORLDPOP_TIF,
         WORLDPOP_AGESEX), the place points in work/grotbc/vector/features (NCGDB + GeoNames), optional
         work/buildings/cells.npz (buildings.py)
Outputs: work/settlements/settlements.geojson  one feature per settlement: outline (polygon, simplified) for those of
                                               MIN_POLY_POP people or more, otherwise its centre point
         work/settlements/settlements.json     the same rows without geometry, biggest first (for search / lists)

Method: the built-up class is read at 1/4 resolution (~150 m), joined across gaps of up to ~150 m (closing), and each
connected patch is a settlement. Its population is the WorldPop 2026 people in it: a WorldPop cell finer than the
patch grid (the 100 m file) counts where its centre falls; a coarser one is shared out over the ~150 m pixels inside it
by building footprint area (cells.npz), or evenly over its built-up pixels where it has no mapped buildings. Those
people x the share of each age group in their 1 km age-sex cell give males 15-49, under 15 and 65+
(common.AGE_GROUPS). Its name is the highest-ranking named place inside it (city > district HQ > town > important village > village), the
next ones are listed in `alsoNames`. Size class by population (SIZE_CLASSES). Unnamed patches under MIN_UNNAMED_POP
people are dropped (fragments of a few buildings each). A settlement is "built-up land", so dispersed farmsteads between villages are not counted.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np

from common import (AGE_GROUPS, ORIGIN_SHIFT, WORLDPOP_SOURCE, WORLDPOP_TIF, WORLDPOP_YEAR, age_shares, cell_of,
                    load_json, load_yaml, read_people, setup_logging, source_ref)

log = setup_logging("settlements")

DECIM = 4
CLOSE_PX = 1
MIN_POLY_POP = 5000
MIN_UNNAMED_POP = 50      # an unnamed patch with fewer people is not listed (owner's decision, 2026-11-05)
SIZE_CLASSES = [  # (min people, class key, label)
    (1_000_000, "metropolitan", "Metropolitan city"),
    (500_000, "large_city", "Large city"),
    (100_000, "mid_city", "Mid-size city"),
    (20_000, "town", "Town"),
    (5_000, "large_village", "Large village"),
    (500, "village", "Village"),
    (0, "hamlet", "Hamlet"),
]
SMOD_LABEL = {30: "Urban centre", 23: "Dense urban cluster", 22: "Semi-dense urban cluster", 21: "Suburban / peri-urban",
              13: "Rural cluster", 12: "Low density rural", 11: "Very low density rural", 10: "Water"}
RANK = {110: 5, 111: 4, 112: 3, 113: 2, 114: 1}          # feature kind -> rank (city ... village)


def size_class(pop: float) -> tuple[str, str]:
    for lo, key, label in SIZE_CLASSES:
        if pop >= lo:
            return key, label
    return "hamlet", "Hamlet"


def share_at(shares, lon: np.ndarray, lat: np.ndarray) -> dict:
    """AGE_GROUPS field -> share of the people at each lon, lat (0 outside the age-sex grid); {} without shares."""
    if shares is None:
        return {}
    sh, s_tr, s_shape, _mask = shares
    ci = cell_of(s_tr, s_shape, lon, lat)
    return {k: np.where(ci >= 0, v.ravel()[np.maximum(ci, 0)], 0.0) for k, v in sh.items()}


def patch_people(a: np.ndarray, transform, lab: np.ndarray, n: int, x0: float, y1: float, res: float,
                 weight: np.ndarray | None, shares=None) -> dict:
    """"pop" and the AGE_GROUPS fields -> people per patch (index 0 = outside every patch) from one WorldPop people
    raster. A cell finer than the ~150 m patch grid (the 100 m file) is counted where its centre falls; a coarser one
    is shared out over the pixels inside it by `weight` (building footprint area), or evenly over its patch pixels
    where it has no weight. Age groups = people x the share of the age-sex cell they lie in (`shares`, age_shares())."""
    hw, ww = a.shape
    lat0 = math.radians(abs(transform.f + transform.e * hw / 2))
    if abs(transform.a) * 111320.0 * math.cos(lat0) <= 1.5 * res:
        rr, cc = np.nonzero(a > 0)
        vals = a[rr, cc].astype("float64")
        lon = transform.c + (cc + 0.5) * transform.a
        lat = transform.f + (rr + 0.5) * transform.e
        mx = np.radians(lon) * 6378137.0
        my = np.log(np.tan(np.pi / 4 + np.radians(lat) / 2)) * 6378137.0
        col = ((mx - x0) / res).astype(np.int64)
        row = ((y1 - my) / res).astype(np.int64)
        inside = (col >= 0) & (col < lab.shape[1]) & (row >= 0) & (row < lab.shape[0])
        plab = np.zeros(len(rr), dtype=np.int64)
        plab[inside] = lab[row[inside], col[inside]]
        out = {"pop": np.bincount(plab, weights=vals, minlength=n + 1)}
        for k, s in share_at(shares, lon, lat).items():
            out[k] = np.bincount(plab, weights=vals * s, minlength=n + 1)
        return out

    rasters = {"pop": a}
    if shares is not None:            # age-group rasters on this grid: people x the share at each cell centre
        cr, cc_ = np.mgrid[0:hw, 0:ww]
        for k, s in share_at(shares, transform.c + (cc_.ravel() + 0.5) * transform.a,
                             transform.f + (cr.ravel() + 0.5) * transform.e).items():
            rasters[k] = a * s.reshape(a.shape)

    # coarse cells: the WorldPop cell of every patch-grid pixel centre (rows and columns are separable)
    H, W = lab.shape
    lat = np.degrees(np.arctan(np.sinh((y1 - (np.arange(H) + 0.5) * res) / 6378137.0)))
    lon = np.degrees((x0 + (np.arange(W) + 0.5) * res) / 6378137.0)
    wr = np.floor((lat - transform.f) / transform.e).astype(np.int64)
    wc = np.floor((lon - transform.c) / transform.a).astype(np.int64)
    wr[(wr < 0) | (wr >= hw)] = -1
    wc[(wc < 0) | (wc >= ww)] = -1
    nc = hw * ww
    s_w = np.zeros(nc)
    pk_all, pw_all, pu_all = [], [], []
    for r0 in range(0, H, 512):
        r1 = min(H, r0 + 512)
        key = wr[r0:r1, None] * ww + wc[None, :]
        valid = (wr[r0:r1, None] >= 0) & (wc[None, :] >= 0)
        w = weight[r0:r1].astype("float64") if weight is not None else None
        if w is not None:
            s_w += np.bincount(key[valid], weights=w[valid], minlength=nc)
        m = valid & (lab[r0:r1] > 0)
        u, inv = np.unique(lab[r0:r1][m].astype(np.int64) * nc + key[m], return_inverse=True)
        pk_all.append(u)
        pu_all.append(np.bincount(inv, minlength=len(u)).astype("float64"))
        pw_all.append(np.bincount(inv, weights=w[m], minlength=len(u)) if w is not None else np.zeros(len(u)))
    u, inv = np.unique(np.concatenate(pk_all), return_inverse=True)
    pu = np.bincount(inv, weights=np.concatenate(pu_all), minlength=len(u))
    pw = np.bincount(inv, weights=np.concatenate(pw_all), minlength=len(u))
    P, C = u // nc, u % nc
    s_u = np.bincount(C, weights=pu, minlength=nc)
    frac = np.where(s_w[C] > 0, pw / np.maximum(s_w[C], 1e-12), pu / np.maximum(s_u[C], 1e-12))
    out = {}
    for k, a in rasters.items():
        flat = a.ravel()
        tot = np.bincount(P, weights=frac * flat[C], minlength=n + 1)
        tot[0] = flat.sum(dtype="float64") - tot[1:].sum()
        out[k] = tot
    return out


def read_places(features: Path) -> list[tuple[float, float, int, dict]]:
    """(x, y Web Mercator, kind, attrs) of every place point in the z10 feature tiles."""
    idx = load_json(features / "index.json")
    z, q = idx["z"], idx["quant"]
    size = 2 * ORIGIN_SHIFT / 2 ** z
    out = []
    for f in (features / str(z)).glob("*/*.json"):
        d = json.loads(f.read_text(encoding="utf-8"))
        minx = -ORIGIN_SHIFT + d["x"] * size
        maxy = ORIGIN_SHIFT - d["y"] * size
        for p in d.get("p", []):
            if p[0] in RANK:
                out.append((minx + p[1] / q * size, maxy - p[2] / q * size, p[0], p[3] if len(p) > 3 else {}))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--grid", type=Path, default=Path("work/grid/grid.json"))
    ap.add_argument("--class-tif", type=Path, default=Path("work/classify/class.tif"))
    ap.add_argument("--worldpop", type=Path, default=WORLDPOP_TIF)
    ap.add_argument("--features", type=Path, default=Path("work/grotbc/vector/features"))
    ap.add_argument("--buildings", type=Path, default=Path("work/buildings/cells.npz"))
    ap.add_argument("--raw", type=Path, default=Path("work/raw"), help="for ghsl_smod/ (GHSL degree of urbanisation)")
    ap.add_argument("--lock", type=Path, default=Path("sources.lock"), help="names each source's location and dates")
    ap.add_argument("--out", type=Path, default=Path("work/settlements"))
    args = ap.parse_args()

    import rasterio
    import shapely
    from rasterio.enums import Resampling
    from rasterio.features import shapes
    from rasterio.transform import Affine
    from scipy import ndimage

    grid = load_json(args.grid)
    lock = load_yaml(args.lock) if args.lock.exists() else None
    args.out.mkdir(parents=True, exist_ok=True)
    H, W = grid["height"] // DECIM, grid["width"] // DECIM
    res = grid["pixel_size"] * DECIM
    x0, y1 = grid["transform"][2], grid["transform"][5]
    tr = Affine(res, 0, x0, 0, -res, y1)
    with rasterio.open(args.class_tif) as cs:
        cls = cs.read(1, out_shape=(H, W), resampling=Resampling.nearest)
    built = cls == 3
    built = ndimage.binary_closing(built, structure=np.ones((3, 3), bool), iterations=CLOSE_PX) | built
    lab, n = ndimage.label(built, structure=np.ones((3, 3), bool))
    log.info("built-up patches: %d (grid %d x %d at %.0f m)", n, W, H, res)

    # buildings per patch (optional, from buildings.py); the footprint area also shares out coarse WorldPop cells
    bstat = barea = None
    if args.buildings.exists():
        z = np.load(args.buildings)
        if z["decim"] == DECIM:
            barea = z["area"]
            bl = lab.ravel()
            bc = z["count"].ravel().astype("float64")
            bstat = (np.bincount(bl, weights=bc, minlength=n + 1),
                     np.bincount(bl, weights=barea.ravel(), minlength=n + 1))
            if z["height"].shape == z["count"].shape:          # building-weighted mean height per settlement
                hh = z["height"].ravel().astype("float64")
                has = hh > 0
                bstat = bstat + (np.bincount(bl[has], weights=(hh * bc)[has], minlength=n + 1),
                                 np.bincount(bl[has], weights=bc[has], minlength=n + 1))
            log.info("buildings: %.1f M inside patches", bstat[0][1:].sum() / 1e6)

    # WorldPop people per patch, and the age groups on the same shares
    a, wtr, _wshape = read_people(args.worldpop)
    shares = age_shares()
    if shares is None:
        log.warning("WorldPop age-sex files missing: no age groups")
    sums = patch_people(a, wtr, lab, n, x0, y1, res, barea, shares)
    pop = sums["pop"]
    total = float(a.sum(dtype="float64"))
    del a
    log.info("WorldPop %d: %.1f M people, %.1f M (%.0f %%) inside built-up patches", WORLDPOP_YEAR, total / 1e6,
             pop[1:].sum() / 1e6, 100 * pop[1:].sum() / max(total, 1))

    # names: highest-ranking place inside each patch
    places = read_places(args.features)
    best: dict[int, list] = {}
    for x, y, k, at in places:
        c, r = int((x - x0) / res), int((y1 - y) / res)
        if not (0 <= c < W and 0 <= r < H) or lab[r, c] == 0 or not at.get("n"):
            continue
        best.setdefault(int(lab[r, c]), []).append((RANK[k], at.get("wc") or at.get("wp") or 0, str(at["n"]), at))
    log.info("named places: %d read, %d patches named", len(places), len(best))

    # geometry, one pass over the label raster: polygons for the bigger settlements
    objs = ndimage.find_objects(lab)
    keep_poly = {i for i in range(1, n + 1) if pop[i] >= MIN_POLY_POP}
    polys: dict[int, list] = {}
    for i in keep_poly:
        sl = objs[i - 1]
        sub = (lab[sl] == i).astype(np.uint8)
        str_ = tr * Affine.translation(sl[1].start, sl[0].start)
        for geom, v in shapes(sub, mask=sub.astype(bool), transform=str_):
            if v == 1:
                polys.setdefault(i, []).append(shapely.geometry.shape(geom))

    def to_ll(g):
        return shapely.transform(g, lambda c: np.column_stack([np.degrees(c[:, 0] / 6378137.0),
                                                               np.degrees(np.arctan(np.sinh(c[:, 1] / 6378137.0)))]))

    smod = smod_at = None
    smz = sorted(Path(args.raw).glob("ghsl_smod/*.zip")) if args.raw else []
    if smz:
        import zipfile
        from rasterio.warp import transform as warp_transform
        tif = next(nm for nm in zipfile.ZipFile(smz[0]).namelist() if nm.endswith(".tif"))
        smod = rasterio.open(f"/vsizip/{smz[0].as_posix()}/{tif}")

        def smod_at(lon_, lat_):
            xs, ys = warp_transform("EPSG:4326", smod.crs, [lon_], [lat_])
            r_, c_ = smod.index(xs[0], ys[0])
            if 0 <= r_ < smod.height and 0 <= c_ < smod.width:
                return int(smod.read(1, window=((r_, r_ + 1), (c_, c_ + 1)))[0, 0])
            return None
    feats, rows = [], []
    area_px = (res / 1000.0) ** 2
    for i in range(1, n + 1):
        sl = objs[i - 1]
        if sl is None:
            continue
        names = sorted(best.get(i, []), key=lambda t: (-t[0], -t[1]))
        if pop[i] < MIN_UNNAMED_POP and not names:
            continue
        cnt = int((lab[sl] == i).sum())
        ry = (sl[0].start + sl[0].stop) / 2
        lat_c = math.degrees(math.atan(math.sinh((y1 - ry * res) / 6378137.0)))
        km2 = cnt * area_px * math.cos(math.radians(lat_c)) ** 2
        key, label = size_class(pop[i])
        rr_, cc_ = np.nonzero(lab[sl] == i)
        cx = x0 + (sl[1].start + cc_.mean() + 0.5) * res
        cy = y1 - (sl[0].start + rr_.mean() + 0.5) * res
        clon, clat = math.degrees(cx / 6378137.0), math.degrees(math.atan(math.sinh(cy / 6378137.0)))
        top = names[0] if names else None
        row_ = {"id": i, "name": top[2] if top else None, "class": key, "label": label, "pop": int(round(pop[i], -1)),
                "km2": round(km2, 2), "lon": round(clon, 5), "lat": round(clat, 5),
                "alsoNames": [t[2] for t in names[1:6]] or None,
                "district": (top[3].get("d") if top else None), "tehsil": (top[3].get("h") if top else None),
                "province": (top[3].get("pv") if top else None),
                "officialPop": (top[3].get("p") if top else None)}
        for k in AGE_GROUPS:
            if k in sums and pop[i] >= 1:
                row_[k] = int(round(sums[k][i], -1))
        if pop[i] >= 1 and km2 > 0:
            row_["perKm2"] = int(round(pop[i] / km2))
        if bstat is not None and bstat[0][i] > 0:
            row_["buildings"] = int(bstat[0][i])
            row_["meanFootprintM2"] = int(round(bstat[1][i] / bstat[0][i]))
            if len(bstat) > 2 and bstat[3][i] > 0:
                row_["meanHeightM"] = round(float(bstat[2][i] / bstat[3][i]), 1)
        if smod is not None:
            code = smod_at(clon, clat)
            if code:
                row_["dou"], row_["douLabel"] = code, SMOD_LABEL.get(code)
        row_ = {k: v for k, v in row_.items() if v is not None}
        rows.append(row_)
        if i in polys:
            g = to_ll(shapely.simplify(shapely.union_all(polys[i]), res * 0.75))
        else:
            g = shapely.Point(clon, clat)
        feats.append({"type": "Feature", "properties": row_, "geometry": json.loads(shapely.to_geojson(shapely.set_precision(g, 1e-5)))})
    rows.sort(key=lambda r: -r["pop"])
    feats.sort(key=lambda f: -f["properties"]["pop"])
    (args.out / "settlements.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats},
                                                             separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    meta = {"format": "pams-settlements", "version": 1,
            "method": "built-up class at ~150 m, gaps up to ~300 m closed, connected patches; WorldPop people inside "
                      "(100 m cells; age groups as 1 km shares); named after the highest-ranking place inside",
            "sources": {f: source_ref(lock, sid) for f, sid in (
                ("built-up area", "worldcover"), ("population", "worldpop"), ("age groups", "worldpop_agesex"),
                ("buildings", "openbuildings"), ("building height", "ghsl_height"),
                ("degree of urbanisation", "ghsl_smod"), ("names", "geonames_pk"))},
            "population": {"source": WORLDPOP_SOURCE, "year": WORLDPOP_YEAR,
                           "fields": dict({"pop": "people", "perKm2": "people per km2 of built-up area"},
                                          **{k: v[0] for k, v in AGE_GROUPS.items()})},
            "sizeClasses": [{"minPop": lo, "class": k, "label": l} for lo, k, l in SIZE_CLASSES], "rows": rows}
    (args.out / "settlements.json").write_text(json.dumps(meta, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    by = {}
    for r in rows:
        by[r["label"]] = by.get(r["label"], 0) + 1
    log.info("settlements: %d (%s) -> %s", len(rows), ", ".join(f"{k} {v}" for k, v in by.items()), args.out)
    for r in rows[:12]:
        log.info("  %-28s %-18s %10d people %8.1f km2", r.get("name"), r["label"], r["pop"], r["km2"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
