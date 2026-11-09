"""Formation overlay POIs (Google Earth deployment KMZs) into the GeoNames country dump D:\\Imagery\\PK.txt.

Inputs : --base  the GeoNames dump as it was before any overlay (default D:\\Imagery\\PK.before-kmz-20261109.txt);
                 the step always starts from it, so it can be re-run
         --kmz   the overlays (date read from the document name, e.g. "Depl 7 Div 15 Oct 2026 (1006)")
Outputs: --out   D:\\Imagery\\PK.txt (same 19-column GeoNames layout, CRLF, UTF-8)
         work/kmz/pk_kmz.csv   every row added or updated, old / new position and the shift in metres

The overlay points are read and filtered exactly as kmz.py does (read_kml / classify_point / clean_name): no
descriptions, no ORBAT folders, no unit designations, HQ names, VP / EVP ratings or strengths in names; points with
no place name left are not taken. Each kept point gets a GeoNames feature code:
  post (OP, pqt, check post, gate, barrier) S.PSTP   border_post S.PSTB   fort S.FT   police_station S.PP
  watch_tower S.TOWR   village (named BUA) P.PPL   helipad S.AIRH   school S.SCH   bhu S.HSPC   hospital S.HSP
  market S.MKT   mosque S.MSQE   church S.CH

Update: a point whose name matches a GeoNames row of the same class (P for BUAs within UPDATE_M["P"], S for the
rest within UPDATE_M["S"]) moves that row to the overlay position, adds the overlay spelling to its alternate names
and sets its modification date to the overlay date.
Add: any other point becomes a new row, id NEW_ID0 + n, admin1 / admin2 from the nearest GeoNames place,
modification date = overlay date.

Several overlays: the latest is taken whole. An older one adds its spelling to the same item in the latest (same
kind within SAME_M), and adds its own permanent items (BUAs, forts, police, services); its temporary items (posts,
OPs, BOPs, towers) are left out - a post missing from the newer overlay may have been vacated (the user's rule for
kmz.py, 9 Nov 2026).
"""
from __future__ import annotations

import argparse
import csv
import math
import re
import unicodedata
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

from kmz import classify_point, clean_name, doc_date, read_kml

FCODE = {"post": "S.PSTP", "border_post": "S.PSTB", "fort": "S.FT", "police_station": "S.PP", "watch_tower": "S.TOWR",
         "village": "P.PPL", "helipad": "S.AIRH", "school": "S.SCH", "bhu": "S.HSPC", "hospital": "S.HSP",
         "market": "S.MKT", "mosque": "S.MSQE", "church": "S.CH", "airport": "S.AIRP"}
TEMPORARY = {"post", "border_post", "watch_tower"}     # taken from the latest overlay only
UPDATE_M = {"P": 2500.0, "S": 1000.0}                  # how far a GeoNames row may be from the overlay point to match
ALT_M = 1000.0                                         # ... when only one of its alternate names matches
SAME_M = 300.0                                         # same kind this close in two overlays = the same item
NAME_RATIO = 0.85
NEW_ID0 = 900_000_000                                  # ids for added rows (GeoNames ids are < 14 million)
GENERIC = re.compile(r"\b(?:fort|post|posts|pqts?|piquet|picquet|police|station|ps|pp|thana|check|cps?|o?ps?|bops?|"
                     r"gate|barrier|towers?|camp|chowki|chowk|bazaa?r|market|school|hospital|bhu|helipad|hls|new|old|"
                     r"inner|outer|main|out|depth|top|kallay|kalay|kalle|kala|church|mosque|masjid|cmh|airport|ap)\b", re.I)
# names that are a function, a formation, an HQ, an installation or a deployment detail, not a place: never written
# to the gazetteer
NOT_PLACE = re.compile(
    r"\b(?:gun|posn|intercept|LP|offr|comd|msl|GKTF|[A-Z]{2,3}TF|CG|fwd|wing|sup(?:ply)? pt|bldg|TBO|TOB|BOO|LS|sec|"
    r"det|lines?|complex|cplx|mill|[RBTW]HQ|HQ|AIBs?|ISI|BN|Bde|Engrs?|Arty|Wksp|MT|water (?:pt|tk)|hostel|madrassa|"
    r"APS gate|CMH barrier|ADS|BMG|HSC|PICE|STS|TTB|KWC|KSF|MKCMP|ASBZ|Jco|factory|PTCL|machis|scouts?|pkts|vacant|"
    r"mandate|teep|trig|camping|FCn|(?-i:DO)|house|(?<!TDP )camp|base)\b"
    r"|^\s*(?:pqt|op|post|cp|bop|barrier|gate)\b|(?-i:^[A-Z]{2,5}(?:\s*-?\s*\d+)?$)", re.I)
# P rows an overlay BUA may update; S rows a point of each kind may update
P_CODES = {"PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLC", "PPLX", "PPLL", "PPLF", "PPLS", "PPLR"}
POSTISH = {"PSTP", "PSTB", "PP", "FT", "TOWR", "CSTM"}
S_CODES = {"post": POSTISH, "border_post": POSTISH, "fort": POSTISH, "police_station": POSTISH, "watch_tower": POSTISH,
           "helipad": {"AIRH", "AIRF"}, "school": {"SCH", "SCHC", "SCHM", "SCHT", "SCHN", "UNIV"},
           "bhu": {"HSP", "HSPC", "HSPD"}, "hospital": {"HSP", "HSPC", "HSPD"}, "market": {"MKT"},
           "mosque": {"MSQE"}, "church": {"CH"}, "airport": {"AIRP", "AIRF"}}


def norm(s: str) -> str:
    return re.sub(r"[^a-z]", "", ascii_of(s).casefold())


def roman_to_digits(s: str) -> str:
    return re.sub(r"(?<=[\s\-])(I{1,3}|IV|V|VI{1,3})\b", lambda m: str({"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5,
                  "VI": 6, "VII": 7, "VIII": 8}[m.group(1)]), s or "")


def core(s: str) -> str:
    """The name without generic words, for matching ("Mir Ali Fort" ~ "Fort Mir Ali")."""
    c = norm(GENERIC.sub(" ", s or ""))
    return c if len(c) >= 3 else norm(s)


def number(s: str) -> str:
    """The number in a name ("Bibak-6" -> "6"); two names with different numbers are different places."""
    return "".join(re.findall(r"\d+", roman_to_digits(s)))


def is_place(s: str) -> bool:
    return bool(s) and not NOT_PLACE.search(s) and len(core(s)) >= 3 and sum(c.isalpha() for c in GENERIC.sub(" ", s)) >= 3


def ascii_of(s: str) -> str:
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode("ascii")


def ground_m(lat1, lon1, lat2, lon2) -> float:
    k = math.cos(math.radians((lat1 + lat2) / 2))
    return 111_320.0 * math.hypot(lat2 - lat1, (lon2 - lon1) * k)


def safe(s: str) -> str:
    s = re.sub(r"[\u200b-\u200f\u2060\ufeff]", "", s or "")
    s = re.sub(r"\s+\d+\)", "", s).replace("(", " ").replace(")", " ")      # "Tabai-3 Post 25)": a cut strength
    return re.sub(r"\s+", " ", re.sub(r"[\t\r\n,]+", " ", s)).strip()


def overlay_items(path: Path) -> tuple[str, list[dict], Counter]:
    name, pms = read_kml(path)
    date = doc_date(name) or doc_date(path.stem)
    if not date:
        raise SystemExit(f"{path}: no date in the document name {name!r}")
    items, why = [], Counter()
    for pm in pms:
        pt = next((g[1][0] for g in pm["geoms"] if g[0] == "Point"), None)
        if pt is None:
            continue
        cls = classify_point(pm["path"], pm["name"])
        if cls is None:
            why["not taken (ORBAT / camp interior / unrecognised)"] += 1
            continue
        nm = clean_name(pm["name"])
        if not nm:
            why["no place name left"] += 1
            continue
        if not is_place(nm):
            why["name is not a place (function / formation / bare 'Pqt-1')"] += 1
            continue
        kind = "airport" if re.search(r"\bairport\b", nm, re.I) else cls[0]
        items.append({"kind": kind, "name": safe(nm), "lon": pt[0], "lat": pt[1], "date": date, "alts": [],
                      "src": path.name})
    # one item per kind + name within SAME_M (an overlay repeats some labels)
    out: list[dict] = []
    for it in items:
        r = SAME_M if it["kind"] in TEMPORARY else 3 * SAME_M
        dup = next((o for o in out if o["kind"] == it["kind"] and core(o["name"]) == core(it["name"])
                    and number(o["name"]) == number(it["name"])
                    and ground_m(o["lat"], o["lon"], it["lat"], it["lon"]) < r), None)
        if dup:
            why["repeated in the overlay"] += 1
        else:
            out.append(it)
    return date, out, why


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--kmz", nargs="+", type=Path, default=[Path(r"D:\Imagery\KMZs\1006.kmz"), Path(r"D:\Imagery\KMZs\xyz.kmz")])
    ap.add_argument("--base", type=Path, default=Path(r"D:\Imagery\PK.before-kmz-20261109.txt"))
    ap.add_argument("--out", type=Path, default=Path(r"D:\Imagery\PK.txt"))
    ap.add_argument("--report", type=Path, default=Path(__file__).resolve().parent.parent / "work" / "kmz" / "pk_kmz.csv")
    a = ap.parse_args()
    if a.base.resolve() == a.out.resolve():
        raise SystemExit("--base and --out must differ (the step rebuilds --out from --base)")

    # ---- overlays, latest first
    ovs = sorted((overlay_items(p) + (p,) for p in a.kmz), key=lambda o: o[0], reverse=True)
    items: list[dict] = []
    stats = Counter()
    for i, (date, its, why, p) in enumerate(ovs):
        for k, v in why.items():
            stats[f"{p.name}: {k}"] += v
        if i == 0:
            items.extend(its)
            stats[f"{p.name}: taken"] += len(its)
            continue
        for it in its:
            same = [o for o in items if o["kind"] == it["kind"] and number(o["name"]) == number(it["name"])
                    and ground_m(o["lat"], o["lon"], it["lat"], it["lon"]) < SAME_M]
            if same:
                o = min(same, key=lambda o: ground_m(o["lat"], o["lon"], it["lat"], it["lon"]))
                if core(it["name"]) != core(o["name"]) and it["name"] not in o["alts"]:
                    o["alts"].append(it["name"])
                    stats[f"{p.name}: spelling added to the newer item"] += 1
                else:
                    stats[f"{p.name}: also in the newer overlay"] += 1
            elif it["kind"] in TEMPORARY:
                stats[f"{p.name}: {it['kind']} not in the newer overlay (left out)"] += 1
            else:
                items.append(it)
                stats[f"{p.name}: taken"] += 1

    # ---- base dump
    raw = a.base.read_bytes().decode("utf-8")
    nl = "\r\n" if "\r\n" in raw[:10000] else "\n"
    rows = [ln.split("\t") for ln in raw.split(nl) if ln]
    bad = [r for r in rows if len(r) != 19]
    if bad:
        raise SystemExit(f"{len(bad)} rows in {a.base} are not 19 columns")
    lat = np.array([float(r[4]) for r in rows])
    lon = np.array([float(r[5]) for r in rows])
    k0 = math.cos(math.radians(32.8))
    tree = cKDTree(np.column_stack([lat * 111_320.0, lon * 111_320.0 * k0]))
    ppl = [i for i, r in enumerate(rows) if r[6] == "P" and r[11]]
    ppl_tree = cKDTree(np.column_stack([lat[ppl] * 111_320.0, lon[ppl] * 111_320.0 * k0]))

    # ---- match (best overlay item per GeoNames row)
    cand = []
    for n, it in enumerate(items):
        cls = FCODE[it["kind"]][0]
        q = (it["lat"] * 111_320.0, it["lon"] * 111_320.0 * k0)
        for j in tree.query_ball_point(q, UPDATE_M[cls] * 1.05):
            r = rows[j]
            if r[6] != cls or r[7] not in (P_CODES if cls == "P" else S_CODES[it["kind"]]):
                continue
            d = ground_m(it["lat"], it["lon"], lat[j], lon[j])
            if d > UPDATE_M[cls]:
                continue
            best = None
            for rank, x in enumerate([r[1], r[2]] + [x for x in r[3].split(",") if x]):
                if number(x) != number(it["name"]) or (rank >= 2 and d > ALT_M):
                    continue
                ratio = SequenceMatcher(None, core(it["name"]), core(x)).ratio()
                if ratio >= NAME_RATIO:
                    key = (min(rank, 2), -ratio)          # the row's own name before its alternates
                    best = key if best is None or key < best else best
            if best is not None:
                cand.append((best[0], best[1], d, n, j))
    cand.sort()
    used_item, used_row, match = set(), set(), {}
    for _, _, d, n, j in cand:
        if n in used_item or j in used_row:
            continue
        used_item.add(n), used_row.add(j)
        match[n] = (j, d)

    report = []
    for n, (j, d) in match.items():
        it, r = items[n], rows[j]
        old = (r[4], r[5])
        r[4], r[5] = f"{it['lat']:.5f}", f"{it['lon']:.5f}"
        alts = [x for x in r[3].split(",") if x]
        have = {norm(x) for x in alts + [r[1], r[2]]}
        for nm in [it["name"]] + it["alts"]:
            if norm(nm) not in have:
                alts.append(nm)
                have.add(norm(nm))
        r[3] = ",".join(alts)
        r[18] = it["date"]
        stats[f"updated {r[6]}.{r[7]}"] += 1
        report.append(["updated", r[0], it["kind"], f"{r[6]}.{r[7]}", r[1], it["name"], "; ".join(it["alts"]),
                       old[0], old[1], r[4], r[5], round(d), it["date"], it["src"]])

    new = sorted((it for n, it in enumerate(items) if n not in match),
                 key=lambda it: (it["kind"], it["name"], round(it["lat"], 5), round(it["lon"], 5)))
    for n, it in enumerate(new):
        _, k = ppl_tree.query((it["lat"] * 111_320.0, it["lon"] * 111_320.0 * k0))
        near = rows[ppl[k]]
        fcl, fco = FCODE[it["kind"]].split(".")
        alts = ",".join(dict.fromkeys(x for x in it["alts"] if norm(x) != norm(it["name"])))
        row = [str(NEW_ID0 + n + 1), it["name"], ascii_of(it["name"]), alts, f"{it['lat']:.5f}", f"{it['lon']:.5f}",
               fcl, fco, "PK", "", near[10], near[11], "", "", "0", "", "-9999", "Asia/Karachi", it["date"]]
        rows.append(row)
        stats[f"added {fcl}.{fco}"] += 1
        report.append(["added", row[0], it["kind"], f"{fcl}.{fco}", "", it["name"], alts.replace(",", "; "),
                       "", "", row[4], row[5], "", it["date"], it["src"]])

    a.out.write_bytes((nl.join("\t".join(r) for r in rows) + nl).encode("utf-8"))
    a.report.parent.mkdir(parents=True, exist_ok=True)
    with open(a.report, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["action", "geonameid", "kind", "fcode", "geonames_name", "overlay_name", "older_spellings",
                    "old_lat", "old_lon", "lat", "lon", "shift_m", "date", "overlay"])
        w.writerows(report)
    for k, v in sorted(stats.items()):
        print(f"{v:6d}  {k}")
    shifts = [x[11] for x in report if x[0] == "updated"]
    if shifts:
        print(f"shift of updated rows: median {int(np.median(shifts))} m, max {max(shifts)} m")
    print(f"{len(rows)} rows -> {a.out}; report {a.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
