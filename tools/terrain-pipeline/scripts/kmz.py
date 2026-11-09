"""Step 4e — formation overlay KMZs (Google Earth deployment overlays) into features/.

Inputs : one or more .kmz / .kml overlays (`--kmz`), each with its date (read from the document name,
         e.g. "Depl 7 Div 15 Oct 2026 (1006)", or given as path=YYYY-MM-DD);
         work/grotbc/vector/features/ (written by grotbc.py, then ground.py)
Outputs: work/grotbc/vector/features/   the same tiles with the overlay's terrain items merged in, each marked
                                        src = "kmz" and dt = the overlay date (re-runnable: the step strips every
                                        src = "kmz" item first)
         work/kmz/kmz.json              counts, the tiles touched, what was dropped and why
         with --bundle: the same tiles, features/index.json, manifest.json and LICENSES.txt patched in the live
         bundle, and work/kmz/changed.txt listing the bundle files written (to copy to another machine)

What is taken (GROTBC), into kinds the engine already reads:
  R  routes and tracks (folder "MSR"): kind road; t = metalled for BT / metalled roads, unmetalled for other
     roads, cart_track for tracks (never better than the overlay says: no load class, so not tankable until checked);
     m = 1 only where the overlay itself says MSR
  O  the border fence (folder "Fence") and camp / cantonment perimeter walls (any line under the post folders):
     kind wall_fence, t = "Border fence" / "Perimeter wall"
  B  posts, OPs, check posts, piquets, gates, barriers -> post; forts -> fort; towers -> watch_tower;
     IB posts / BOPs -> border_post; police stations / posts -> police_station; named BUAs -> village;
     CMH / hospital, BHU, school, bazar / market, mosque, helipad by name
What is never taken: placemark descriptions (commanders, phone numbers, strength, weapons, ammunition, photos),
VP / EVP ratings, unit designations and HQ names in names, strength in brackets, and the ORBAT folders
(AIBs, unit / Bde / Div boundaries, unit and Bde labels, the international boundary, camp HQ layouts).

Several overlays: the latest is taken whole; an older one adds only route and fence / wall lines the latest does
not have (the parts more than `--dedupe-m` away from them). Posts come from the latest only (a post missing from
the newer overlay may have been vacated).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import re
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from xml.etree import ElementTree as ET

import numpy as np

from common import ORIGIN_SHIFT, lnglat_to_merc, load_json, load_yaml, setup_logging, source_ref
from grotbc import FEATURE_Z, KIND_CODE, KINDS, QUANT, TileWriter

log = setup_logging("kmz")

K = "{http://www.opengis.net/kml/2.2}"
SRC = "kmz"
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}

# ---------------------------------------------------------------------------------------------- what is left out
ORBAT_FOLDERS = re.compile(r"^AIBs\b|Units? Name|Unit Bdry|Bde Bdry|Bde Name|Div Bdry|International Bdry|HQ Loc\b", re.I)
JUNK_NAME = re.compile(r"^(?:untitled(?: path| placemark| polygon)?|path\W*m\W*e\W*a\W*s\W*u\W*r\W*e|new(?: path| placemark)?|[a-z]{1,2}|(?P<c>[a-z])(?P=c)+|tr|rd|wall|line|sec \d+)$", re.I)
UNIT = (r"(?:W|WTS|FF|SR|PR|BR|AK|NLI|FLI|SP|Med|Med Arty|Lt AD|L|C|H|PNI|Bde|IIBG|Div|Wing|Bn|IFCE|IWC|Sig Coy|"
        r"Mm Det|Sup Det|AD|Arty|Engrs?|Eng|Tec|Bty|Sqn|Coy|Pl|ATF|BTF|TF)")
UNIT_RE = re.compile(rf"\b\d{{1,3}}\s*(?:\(I\)\s*)?{UNIT}\b\.?", re.I)
HQ_RE = re.compile(r"\b(?:[BCW]HQ|Bn HQ|Bde HQ|Coy HQ|Div HQ|Wing HQ|HQ(?: Coy)?|[A-D] Coy|Coy|Comd|PC Lines?|ex)\b", re.I)
RATING_RE = re.compile(r"\b(?:E?VPs?|Std|SPs?)\b", re.I)

# ---------------------------------------------------------------------------------------------- point classes
POI = [  # (regex on the name, kind) - only for points that are not a post / OP by their folder
    (re.compile(r"\bCMH\b|hospital", re.I), "hospital"),
    (re.compile(r"\bBHU\b", re.I), "bhu"),
    (re.compile(r"school|college|\bAPS\b", re.I), "school"),
    (re.compile(r"bazaa?r|market|mandi\b", re.I), "market"),
    (re.compile(r"mosque|masjid", re.I), "mosque"),
    (re.compile(r"\bchurch\b", re.I), "church"),
    (re.compile(r"helipad|\bHLS\b", re.I), "helipad"),
]
POST_WORDS = re.compile(r"\b(?:posts?|pqts?|piquets?|picquets?|OPs?|E?VPs?|Std|CPs?|check ?posts?|BOPs?|SPs?|forts?|"
                        r"towers?|gates?|barriers?|cordon|out ?posts?)\b", re.I)


def doc_date(name: str) -> str | None:
    m = re.search(r"\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})\b", name or "")
    if not m or m.group(2).lower() not in MONTHS:
        return None
    return dt.date(int(m.group(3)), MONTHS[m.group(2).lower()], int(m.group(1))).isoformat()


def read_kml(path: Path) -> tuple[str, list[dict]]:
    """(document name, placemarks [{path: [folder names], name, geoms: [(type, [(lon, lat), ...])]}]).
    Descriptions are never read."""
    if path.suffix.lower() == ".kmz":
        with zipfile.ZipFile(path) as z:
            kml = next(n for n in z.namelist() if n.lower().endswith(".kml"))
            root = ET.fromstring(z.read(kml))
    else:
        root = ET.parse(path).getroot()
    doc = root.find(K + "Document")
    doc = doc if doc is not None else root
    out: list[dict] = []

    def coords(el) -> list[tuple[float, float]]:
        c = el.find(K + "coordinates")
        pts = []
        for tok in (c.text or "").split() if c is not None else []:
            v = tok.split(",")
            if len(v) >= 2:
                pts.append((float(v[0]), float(v[1])))
        return pts

    def geoms(pm) -> list[tuple[str, list]]:
        g = []
        for el in pm.iter():
            tag = el.tag[len(K):] if el.tag.startswith(K) else el.tag
            if tag == "Point":
                g.append(("Point", coords(el)))
            elif tag == "LineString":
                g.append(("LineString", coords(el)))
            elif tag == "Polygon":
                outer = el.find(f"{K}outerBoundaryIs/{K}LinearRing")
                if outer is not None:
                    g.append(("LineString", coords(outer)))         # a closed outline is drawn as a line
        return [x for x in g if x[1]]

    def walk(el, folders):
        for ch in el:
            tag = ch.tag[len(K):] if ch.tag.startswith(K) else ch.tag
            if tag in ("Folder", "Document"):
                nm = ch.find(K + "name")
                walk(ch, folders + [(nm.text or "").strip() if nm is not None else ""])
            elif tag == "Placemark":
                nm = ch.find(K + "name")
                out.append({"path": folders, "name": (nm.text or "").strip() if nm is not None else "", "geoms": geoms(ch)})
    walk(doc, [])
    nm = doc.find(K + "name")
    return ((nm.text or "").strip() if nm is not None else path.stem), out


def clean_name(name: str) -> str | None:
    """The place part of a name: no strength / rank brackets, unit designations, HQ names or post ratings."""
    s = re.sub(r"\([^)]*\)?", " ", name or "")
    s0 = s
    s = UNIT_RE.sub(" ", s)
    s = HQ_RE.sub(" ", s)
    s = re.sub(r"\b(?:ATF|BTF|AOR)\b", " ", s)
    s = RATING_RE.sub(" ", s)
    if s != s0 and re.search(r"\bto\b", s0, re.I):
        return None                                       # "Dwt to 196 W & 68 BR MSR": the end points were units
    s = re.sub(r"(?<!\w)[-&/,]+\s*\d*(?!\w)", " ", s) if s != s0 else s     # dangling "-2", "&" left by a removal
    s = re.sub(r"\s*[-,&/]\s*$|^\s*[-,&/]\s*", "", re.sub(r"\s+", " ", s)).strip(" -,&/.")
    s = re.sub(r"^(?:to|and|&)\s+|\s+(?:to|and|&)$", "", s, flags=re.I).strip()
    if not s or JUNK_NAME.match(s) or sum(ch.isalpha() for ch in s) < 3:
        return None
    return s


def folder_text(path: list[str]) -> str:
    return " / ".join(re.sub(r"\s*\(.*$", "", p).strip() for p in path)


def classify_line(path: list[str]) -> tuple[str, dict] | None:
    top = [p.lower() for p in path]
    if any(ORBAT_FOLDERS.search(p) for p in path):
        return None
    if any(p.startswith("msr") for p in top):
        return "road", {}
    if any(p.startswith("fence") for p in top):
        return "wall_fence", {"t": "Border fence"}
    if any(p.startswith(("post", "ops")) for p in top):
        return "wall_fence", {"t": "Perimeter wall"}
    return None


def road_attrs(path: list[str], name: str) -> dict:
    txt = (folder_text(path[-3:]) + " / " + (name or "")).lower()
    if re.search(r"\bbt\b|black ?top|metall?ed|pucca|paved", txt) and not re.search(r"un-?metall?ed|kacha|katcha|kutcha", txt):
        t = "metalled"
    elif re.search(r"kacha|katcha|kutcha|\btr\b|\btrs\b|tracks?\b|\bpath\b", txt):
        t = "cart_track"
    else:
        t = "unmetalled"
    a = {"t": t}
    # MSR only where the overlay names it: in the line's name, or a folder of one formation's MSR ("53 BDE MSR");
    # the overlay's catch-all "MSR / Bde MSR" folders also hold tracks, so they do not count
    if re.search(r"\bmsr\b", (name or "").lower()) or re.search(r"\b\d+\s*bde msr\b", (path[-1] if path else "").lower()):
        a["m"] = 1
    if re.search(r"exposed", txt):
        a["cn"] = "exposed"
    return a


def classify_point(path: list[str], name: str) -> tuple[str, dict] | None:
    if any(ORBAT_FOLDERS.search(p) for p in path):
        return None
    i = next((i for i, p in enumerate(path) if p.lower().startswith(("post", "ops"))), None)
    if i is None:                                         # only the post / OP folders hold points we take
        return None
    path = path[i:]
    ftxt = folder_text(path[1:])
    leaf = re.sub(r"\s*\(.*$", "", path[-1]).strip() if path else ""
    nm = name or ""
    both = f"{ftxt} / {nm}"
    if re.search(r"\bBUAs?\b", ftxt):
        return "village", {}
    if re.search(r"police", both, re.I):
        return "police_station", {"t": "Police post" if re.search(r"police posts?", both, re.I) else "Police station"}
    in_camp = bool(re.search(r"cantt|camp", leaf, re.I))       # "Bxu Cantt with Towers" holds services too
    folder_is_post = (bool(POST_WORDS.search(leaf)) and not in_camp) or bool(re.search(r"\bFCn Deply\b", ftxt, re.I))
    if not folder_is_post and not POST_WORDS.search(nm):
        for rx, kind in POI:
            if rx.search(nm):
                return kind, {}
    if in_camp and not POST_WORDS.search(nm):
        return None                                       # named installations inside a cantt / camp: not terrain
    tower_leaf = re.search(r"^towers?\b", leaf, re.I)
    if re.search(r"\btowers?\b", nm, re.I) or (tower_leaf and not re.search(r"gate|barrier", nm, re.I)):
        return "watch_tower", {}
    if re.search(r"\bfort\b", nm, re.I) or re.search(r"^fort\b", leaf, re.I):
        if not re.search(r"gate", nm, re.I):
            return "fort", {}
    if re.search(r"\bgate\b", nm, re.I) or re.search(r"^gates?\b", leaf, re.I):
        return "post", {"t": "Gate"}
    if re.search(r"barriers?", both, re.I):
        return "post", {"t": "Barrier"}
    if re.search(r"\bBOPs?\b|\bIB\b", both):
        return "border_post", {"t": "BOP"}
    if re.search(r"\bCPs?\b|check ?posts?", both, re.I):
        return "post", {"t": "Check post"}
    if re.search(r"\bO\.?Ps?\b|inner ops", both, re.I):
        return "post", {"t": "OP"}
    if re.search(r"\bpqts?\b|piquet|picquet|cordon", both, re.I):
        return "post", {"t": "Pqt"}
    if folder_is_post or POST_WORDS.search(nm):
        return "post", {"t": "Post"}
    return None                                           # camp interiors and anything else unrecognised


# ---------------------------------------------------------------------------------------------- geometry helpers
def merc_line(pts):
    import shapely
    return shapely.LineString([lnglat_to_merc(x, y) for x, y in pts]) if len(pts) >= 2 else None


def merc_scale(y: float) -> float:
    """Web Mercator metres per ground metre at mercator y."""
    lat = 2 * math.atan(math.exp(y / 6378137.0)) - math.pi / 2
    return 1.0 / max(math.cos(lat), 0.2)


def tile_of(x: float, y: float) -> tuple[int, int]:
    size = 2 * ORIGIN_SHIFT / 2 ** FEATURE_Z
    return int((x + ORIGIN_SHIFT) // size), int((ORIGIN_SHIFT - y) // size)


def tile_xy(tx: int, ty: int, qx: int, qy: int) -> tuple[float, float]:
    size = 2 * ORIGIN_SHIFT / 2 ** FEATURE_Z
    return -ORIGIN_SHIFT + tx * size + qx / QUANT * size, ORIGIN_SHIFT - ty * size - qy / QUANT * size


# ---------------------------------------------------------------------------------------------- main
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--kmz", nargs="+", required=True, help="overlay files; path or path=YYYY-MM-DD (date else from the document name)")
    ap.add_argument("--ids", nargs="*", help="sources.lock ids, one per --kmz (for the attribution)")
    ap.add_argument("--features", type=Path, default=Path("work/grotbc/vector/features"))
    ap.add_argument("--bundle", type=Path, help="live bundle: copy the touched tiles + index and patch manifest / LICENSES")
    ap.add_argument("--out", type=Path, default=Path("work/kmz"))
    ap.add_argument("--lock", type=Path, default=Path("sources.lock"))
    ap.add_argument("--dedupe-m", type=float, default=30.0, help="older lines within this of the latest are the same line")
    ap.add_argument("--near-m", type=float, default=100.0, help="a point of the same kind already within this is not added")
    ap.add_argument("--place-m", type=float, default=750.0, help="a BUA with a settlement already within this is not added")
    ap.add_argument("--dry-run", action="store_true", help="classify and report only")
    args = ap.parse_args()
    import shapely

    lock = load_yaml(args.lock) if args.lock.exists() else {"sources": []}
    overlays = []
    for i, spec in enumerate(args.kmz):
        p, _, d = spec.partition("=")
        title, pms = read_kml(Path(p))
        date = d or doc_date(title)
        if not date:
            log.error("%s: no date in the document name %r; give it as path=YYYY-MM-DD", p, title)
            return 2
        sid = args.ids[i] if args.ids and i < len(args.ids) else None
        overlays.append({"path": p, "title": title, "date": date, "pms": pms, "id": sid})
        log.info("%s: %r, %s, %d placemarks", p, title, date, len(pms))
    overlays.sort(key=lambda o: o["date"], reverse=True)
    latest = overlays[0]

    # ------------------------------------------------------------------ classify
    pts, lines = [], []                               # {kind, x, y | geom, a}
    dropped = Counter()
    kept = Counter()
    review = defaultdict(list)
    for o in overlays:
        is_latest = o is latest
        for pm in o["pms"]:
            for gtype, cs in pm["geoms"]:
                if gtype == "Point":
                    if not is_latest:
                        dropped["point in an older overlay"] += 1
                        continue
                    c = classify_point(pm["path"], pm["name"])
                    if c is None:
                        why = "ORBAT folder" if any(ORBAT_FOLDERS.search(p) for p in pm["path"]) else "not a terrain item"
                        dropped[f"point: {why}"] += 1
                        if why != "ORBAT folder" and len(review["dropped"]) < 400:
                            review["dropped"].append(f"{folder_text(pm['path'][1:])} | {pm['name']}")
                        continue
                    kind, a = c
                    n = clean_name(pm["name"])
                    if kind == "village":
                        if not n:
                            dropped["BUA: no name"] += 1
                            continue
                        n = re.sub(r"\s+vill(age)?\.?$", "", n, flags=re.I).strip() or n
                    x, y = lnglat_to_merc(*cs[0])
                    a = dict(a, n=n, src=SRC, dt=o["date"])
                    pts.append({"kind": kind, "x": x, "y": y, "a": a, "raw": pm["name"]})
                else:
                    c = classify_line(pm["path"])
                    if c is None:
                        dropped["line: ORBAT folder" if any(ORBAT_FOLDERS.search(p) for p in pm["path"]) else "line: other"] += 1
                        continue
                    kind, a = c
                    g = merc_line(cs)
                    if g is None or g.length == 0:
                        dropped["line: degenerate"] += 1
                        continue
                    if kind == "road":
                        a = dict(road_attrs(pm["path"], pm["name"]), n=clean_name(pm["name"]))
                    else:
                        a = dict(a)
                    a.update(src=SRC, dt=o["date"])
                    lines.append({"kind": kind, "geom": g, "a": a, "latest": is_latest, "raw": pm["name"]})

    # ------------------------------------------------------------------ the latest wins; older lines add what is new
    import shapely.ops
    by_kind = defaultdict(list)
    for ln in lines:
        if ln["latest"]:
            by_kind[ln["kind"]].append(ln["geom"])
    import shapely.prepared
    bufs, raw = {}, {}
    if any(not ln["latest"] for ln in lines):              # one buffer per kind round the latest overlay's lines
        sc = merc_scale(float(np.mean([ln["geom"].centroid.y for ln in lines])))
        for k, v in by_kind.items():
            raw[k] = shapely.ops.unary_union(v).buffer(args.dedupe_m * sc, quad_segs=4)
            bufs[k] = shapely.prepared.prep(raw[k])
    seen_wkb = set()
    final_lines = []
    for ln in lines:
        key = (ln["kind"], shapely.to_wkb(shapely.set_precision(ln["geom"], 1.0)))
        if key in seen_wkb:
            dropped["line: duplicate"] += 1
            continue
        seen_wkb.add(key)
        if ln["latest"]:
            final_lines.append(ln)
            continue
        pb = bufs.get(ln["kind"])
        if pb is not None and pb.contains(ln["geom"]):
            rest = shapely.LineString()
        elif pb is not None and pb.intersects(ln["geom"]):
            rest = ln["geom"].difference(raw[ln["kind"]])
        else:
            rest = ln["geom"]
        parts = [g for g in getattr(rest, "geoms", [rest]) if g.geom_type == "LineString" and not g.is_empty
                 and g.length >= 100 * merc_scale(g.centroid.y)]
        if not parts:
            dropped["older line: already in the latest"] += 1
            continue
        for g in parts:
            final_lines.append(dict(ln, geom=g))
        kept["older line parts added"] += len(parts)

    # ------------------------------------------------------------------ existing features round the overlay
    feat = args.features
    tiles_on_disk: dict[tuple, dict] = {}
    allxy = [(p["x"], p["y"]) for p in pts] + [xy for ln in final_lines for xy in ln["geom"].coords]
    if not allxy:
        log.error("nothing to add")
        return 1
    xs, ys = zip(*allxy)
    tx0, ty0 = tile_of(min(xs), max(ys))
    tx1, ty1 = tile_of(max(xs), min(ys))
    prev = load_json(args.out / "kmz.json") if (args.out / "kmz.json").exists() else {}
    span = {(tx, ty) for tx in range(tx0 - 1, tx1 + 2) for ty in range(ty0 - 1, ty1 + 2)}
    span |= {tuple(t) for t in prev.get("tiles", [])}
    stripped = Counter()
    for tx, ty in span:
        p = feat / str(FEATURE_Z) / str(tx) / f"{ty}.json"
        if not p.exists():
            continue
        obj = json.loads(p.read_text(encoding="utf-8"))
        for key in ("p", "l"):
            keep = []
            for it in obj.get(key, []):
                a = it[3] if key == "p" and len(it) > 3 else (it[2] if key == "l" and len(it) > 2 else None)
                if isinstance(a, dict) and a.get("src") == SRC:
                    stripped[it[0]] += 1
                else:
                    keep.append(it)
            if keep:
                obj[key] = keep
            else:
                obj.pop(key, None)
        tiles_on_disk[(tx, ty)] = obj
    from scipy.spatial import cKDTree
    ex = defaultdict(list)
    for (tx, ty), obj in tiles_on_disk.items():
        for it in obj.get("p", []):
            ex[it[0]].append(tile_xy(tx, ty, it[1], it[2]))
    trees = {k: cKDTree(np.array(v)) for k, v in ex.items() if v}
    place_codes = [KIND_CODE[k] for k in ("city", "district_hq", "town", "village_imp", "village", "locality")]

    def near(codes, x, y, r):
        for c in codes:
            t = trees.get(c)
            if t is not None and np.isfinite(t.query((x, y), distance_upper_bound=r)[0]):
                return True
        return False

    final_pts = []
    for f in pts:
        sc = merc_scale(f["y"])
        if f["kind"] == "village":
            if near(place_codes, f["x"], f["y"], args.place_m * sc):
                dropped["BUA: settlement already within %d m" % args.place_m] += 1
                continue
        elif near([KIND_CODE[f["kind"]]], f["x"], f["y"], args.near_m * sc):
            dropped[f"{f['kind']}: same kind already within {args.near_m:.0f} m"] += 1
            continue
        final_pts.append(f)
    # one point per spot (the overlay repeats some placemarks)
    uniq, seen = [], set()
    for f in final_pts:
        key = (f["kind"], round(f["x"] / 5), round(f["y"] / 5))
        if key in seen:
            dropped["point: duplicate"] += 1
            continue
        seen.add(key)
        uniq.append(f)
    final_pts = uniq

    by = Counter(f["kind"] for f in final_pts)
    byl = Counter((ln["kind"], ln["a"].get("t")) for ln in final_lines)
    log.info("points: %s", dict(by))
    log.info("lines: %s", {f"{k}/{t}": v for (k, t), v in byl.items()})
    log.info("dropped: %s", dict(dropped))
    args.out.mkdir(parents=True, exist_ok=True)
    rev = args.out / "review.txt"
    with rev.open("w", encoding="utf-8") as fh:
        fh.write("# what goes in (kind | type | name kept | name in the overlay)\n")
        for f in sorted(final_pts, key=lambda f: (f["kind"], f["a"].get("t") or "", f["raw"])):
            fh.write(f"{f['kind']} | {f['a'].get('t') or ''} | {f['a'].get('n') or ''} | {f['raw']}\n")
        for ln in sorted(final_lines, key=lambda f: (f["kind"], f["a"].get("t") or "")):
            fh.write(f"{ln['kind']} | {ln['a'].get('t') or ''}{' MSR' if ln['a'].get('m') else ''} | {ln['a'].get('n') or ''} | "
                     f"{ln['raw']} | {ln['a']['dt']} | {ln['geom'].length / merc_scale(ln['geom'].centroid.y) / 1000:.2f} km\n")
        fh.write("\n# points left out as not a terrain item (camp interiors etc.)\n")
        fh.writelines(s + "\n" for s in review["dropped"])
    log.info("review: %s", rev)
    if args.dry_run:
        return 0

    # ------------------------------------------------------------------ write
    tw = TileWriter(FEATURE_Z, (-180, -85, 180, 85))
    for f in final_pts:
        tw.point(f["kind"], f["x"], f["y"], f["a"])
    for ln in final_lines:
        tw.line(ln["kind"], shapely.simplify(ln["geom"], 2.0), ln["a"])
    touched = set(tw.points) | set(tw.lines) | {t for t in tiles_on_disk if t in {tuple(x) for x in prev.get("tiles", [])}}
    written = []
    for key in sorted(touched):
        tx, ty = key
        obj = tiles_on_disk.get(key) or {"z": FEATURE_Z, "x": tx, "y": ty, "q": QUANT}
        if tw.points.get(key):
            obj["p"] = obj.get("p", []) + [p if len(p) < 4 or p[3] else p[:3] for p in tw.points[key]]
        if tw.lines.get(key):
            obj["l"] = obj.get("l", []) + tw.lines[key]
        p = feat / str(FEATURE_Z) / str(tx) / f"{ty}.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
        written.append(key)

    # index.json: counts (minus what the last run added, plus this run), attrs, sources
    idx = load_json(feat / "index.json")
    old_counts = {int(k): v for k, v in (prev.get("counts") or {}).items()}
    new_counts = Counter({KIND_CODE[f["kind"]]: 0 for f in final_pts})
    for f in final_pts:
        new_counts[KIND_CODE[f["kind"]]] += 1
    for ln in final_lines:
        new_counts[KIND_CODE[ln["kind"]]] += 1
    for code in set(old_counts) | set(new_counts):
        k = idx["kinds"].get(str(code))
        if k is None:
            key, label, letters = KINDS[code]
            k = idx["kinds"][str(code)] = {"key": key, "label": label, "grotbc": letters, "count": 0}
        k["count"] = max(0, int(k.get("count", 0)) - old_counts.get(code, 0) + new_counts.get(code, 0))
    idx["attrs"]["src"] = "source when not the NCGDB (gn = GeoNames, osm = OpenStreetMap, kmz = formation overlay)"
    idx["attrs"]["dt"] = "date of the source item (formation overlay date)"
    srcs = {k: v for k, v in (idx.get("sources") or {}).items() if not k.startswith("Formation overlay")}
    for o in overlays:
        ref = source_ref(lock, o["id"]) if o["id"] else {"id": None}
        ref = {"id": o["id"], "name": ref.get("name") or o["title"], "location": ref.get("location") or [o["path"]],
               "dataDate": o["date"], "released": ref.get("released") or o["date"]}
        role = "latest" if o is latest else "older: route / fence / wall lines the latest lacks"
        srcs[f"Formation overlay {o['title']} (src = kmz, dt = {o['date']}; {role})"] = ref
    idx["sources"] = srcs
    (feat / "index.json").write_text(json.dumps(idx, indent=1, ensure_ascii=False), encoding="utf-8")

    summary = {"built": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
               "overlays": [{k: o[k] for k in ("path", "title", "date", "id")} for o in overlays],
               "counts": {str(k): v for k, v in new_counts.items()}, "points": dict(by),
               "lines": {f"{k}/{t}": v for (k, t), v in byl.items()}, "dropped": dict(dropped),
               "stripped": {str(k): v for k, v in stripped.items()}, "tiles": sorted([list(t) for t in written])}
    (args.out / "kmz.json").write_text(json.dumps(summary, indent=1, ensure_ascii=False), encoding="utf-8")
    log.info("features: %d tiles rewritten in %s", len(written), feat)

    if args.bundle:
        publish(args, feat, written, overlays, lock)
    return 0


def publish(args, feat: Path, written: list, overlays: list, lock: dict) -> None:
    """Copy the touched tiles and index.json to the live bundle; add the overlays to manifest.json and LICENSES.txt."""
    import shutil
    b = args.bundle
    changed = []
    for tx, ty in written:
        rel = Path("features") / str(FEATURE_Z) / str(tx) / f"{ty}.json"
        (b / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(feat / str(FEATURE_Z) / str(tx) / f"{ty}.json", b / rel)
        changed.append(rel.as_posix())
    shutil.copyfile(feat / "index.json", b / "features" / "index.json")
    changed.append("features/index.json")

    mpath = b / "manifest.json"
    m = load_json(mpath)
    ids = [o["id"] for o in overlays if o["id"]]
    m["sources"] = [s for s in m.get("sources", []) if s.get("id") not in ids]
    for o in overlays:
        if not o["id"]:
            continue
        s = next((s for s in lock.get("sources", []) if s["id"] == o["id"]), {})
        ref = source_ref(lock, o["id"])
        m["sources"].append({"id": o["id"], "name": ref.get("name") or o["title"], "version": str(s.get("version", "")),
                             "location": ref.get("location") or [o["path"]], "landing": ref.get("landing"),
                             "dataDate": o["date"], "released": ref.get("released") or o["date"],
                             "licence": s.get("licence", "restricted"), "sha256": str(s.get("sha256", "")), "files": None,
                             "restricted": True})
    fl = (m.get("grotbc") or {}).get("features")
    if isinstance(fl, dict):
        fl["sources"] = [x for x in fl.get("sources", []) if x not in ids] + ids
    else:
        log.warning("manifest: no grotbc.features entry found; only sources[] updated")
    m["restricted"] = True
    mpath.write_text(json.dumps(m, indent=1, ensure_ascii=False), encoding="utf-8")
    changed.append("manifest.json")

    lic = b / "LICENSES.txt"
    text = lic.read_text(encoding="utf-8") if lic.exists() else ""
    mark0, mark1 = "## formation overlays (kmz.py) ##", "## end formation overlays ##"
    text = re.sub(re.escape(mark0) + r".*?" + re.escape(mark1) + r"\n?", "", text, flags=re.S).rstrip("\n") + "\n\n"
    block = [mark0]
    for o in overlays:
        block += [f"{o['title']}",
                  f"  data date   : {o['date']}",
                  f"  location    : {o['path']}",
                  "  licence     : restricted (own formation overlay)",
                  "  used for    : features/ items with src = kmz (routes / tracks, border fence, perimeter walls, posts,",
                  "                forts, towers, police, named BUAs, services). Descriptions, strengths, unit designations",
                  "                and ORBAT folders are not taken.",
                  "  *** RESTRICTED: do not redistribute this bundle outside the data owner's permission. ***", ""]
    block.append(mark1)
    lic.write_text(text + "\n".join(block) + "\n", encoding="utf-8")
    changed.append("LICENSES.txt")
    (args.out / "changed.txt").write_text("\n".join(changed) + "\n", encoding="utf-8")
    log.info("bundle: %d files written (list in %s)", len(changed), args.out / "changed.txt")


if __name__ == "__main__":
    sys.exit(main())
