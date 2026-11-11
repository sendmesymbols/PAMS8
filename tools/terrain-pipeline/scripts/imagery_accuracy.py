"""Step I3 — how often each source is right at the check points, from the labels people made on the imagery chips.

Inputs : work/imagery/checkpoints/points.json (imagery_checkpoints.py), labels.json (Export on label.html; several
         labellers' files can be given: a point labelled differently by two people is reported, not averaged)
Outputs: work/imagery/accuracy.json and accuracy.md: per source and per stratum, the share of points where the source
         agrees with the label, confusion tables, and for trees the misses (source says none, people see crowns) and
         false trees (source says trees, people see none). False trees are the safety-critical error: they would
         overstate concealment.

Label vocabulary (label.html): cover tree / shrub / crop / open / bare / rock / built / water; canopy 0 / lt10 /
10-30 / 30-60 / gt60; way none / path / unmetalled / metalled; image ok / cant ("can't tell": left out).
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import setup_logging  # noqa: E402

log = setup_logging("imagery_accuracy")

# bundle class -> cover word. Line classes (canals 20-22, perennial streams 46, roads, railways) are a 1-pixel line
# through a cell whose cover is something else, so they are not scored for cover; a dry nullah (47) is bare ground.
BUNDLE_COVER = {1: "tree", 7: "tree", 29: "tree", 30: "tree", 31: "tree", 2: "crop", 23: "crop", 48: "crop", 0: "open",
                12: "bare", 13: "bare", 14: "bare", 16: "bare", 17: "bare", 47: "bare", 15: "rock", 3: "built", 32: "built",
                4: "water", 5: "water", 6: "water"}
WC_COVER = {"tree": "tree", "mangrove": "tree", "shrub": "shrub", "grass": "open", "moss": "open", "crop": "crop",
            "built": "built", "bare": "bare", "snow": "bare", "water": "water", "wetland": "water"}
CANOPY_MID = {"0": 0, "lt10": 5, "10-30": 20, "30-60": 45, "gt60": 80}


def has_trees(canopy: str | None) -> bool | None:
    return None if canopy is None else CANOPY_MID.get(canopy, 0) >= 10


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("labels", type=Path, nargs="+", help="labels.json exported from label.html")
    ap.add_argument("--points", type=Path, default=Path("work/imagery/checkpoints/points.json"))
    ap.add_argument("--out", type=Path, default=Path("work/imagery"))
    ap.add_argument("--agb-trees", type=float, default=10.0, help="CTrees Mg/ha taken as 'trees in the cell'")
    ap.add_argument("--chm-trees", type=float, default=10.0, help="CHM %% of the cell >= 3 m taken as 'trees in the cell'")
    args = ap.parse_args()
    pts = {p["id"]: p for p in json.loads(args.points.read_text(encoding="utf-8"))["points"]}
    merged: dict[str, dict] = {}
    conflicts = []
    for f in args.labels:
        lab = json.loads(f.read_text(encoding="utf-8"))
        for pid, l in (lab.get("labels") or lab).items():
            if pid in merged and any(merged[pid].get(k) != l.get(k) for k in ("cover", "canopy", "way")):
                conflicts.append({"id": pid, "a": merged[pid], "b": l})
            merged.setdefault(pid, l)
    use = {pid: l for pid, l in merged.items()
           if pid in pts and l.get("image") != "cant" and l.get("cover") and l.get("canopy") and l.get("way")}
    log.info("%d points labelled (%d can't tell, %d labelled twice differently)", len(use),
             sum(1 for l in merged.values() if l.get("image") == "cant"), len(conflicts))

    res = {"n": len(use), "conflicts": conflicts, "cover": {}, "trees": {}, "ways": {}}
    # 1. cover: bundle class and WorldCover against the label
    for name, call in (("bundle class", lambda p: BUNDLE_COVER.get(p["bundle"]["class"])),
                       ("WorldCover 2021", lambda p: WC_COVER.get((p.get("worldcover") or {}).get("top")))):
        conf, by = Counter(), defaultdict(Counter)
        for pid, l in use.items():
            c = call(pts[pid])
            if c is None:
                continue
            conf[(c, l["cover"])] += 1
            by[pts[pid]["stratum"]][c == l["cover"]] += 1
        n = sum(conf.values())
        res["cover"][name] = {"n": n, "agree": round(100 * sum(v for (a, b), v in conf.items() if a == b) / max(1, n), 1),
                              "byStratum": {s: round(100 * c[True] / max(1, sum(c.values())), 1) for s, c in by.items()},
                              "confusion": {f"{a}->{b}": v for (a, b), v in conf.most_common()}}
    # 2. trees in the cell: every source's yes / no against canopy >= 10 %
    calls = {
        "bundle class (tree kinds)": lambda p: p["bundle"]["class"] in (1, 7, 29, 30, 31),
        "WorldCover tree >= 10 % of cell": lambda p: (p.get("worldcover") or {}).get("treePct", 0) >= 10 if p.get("worldcover") else None,
        f"CTrees >= {args.agb_trees:g} Mg/ha": lambda p: None if p.get("ctreesAgb") is None else p["ctreesAgb"] >= args.agb_trees,
        f"CHM v2 >= 3 m on {args.chm_trees:g} % of cell": lambda p: (None if not isinstance(p.get("chm"), dict) or "tree3Pct" not in p["chm"]
                                                                      else p["chm"]["tree3Pct"] >= args.chm_trees),
        f"CHM v1 >= 3 m on {args.chm_trees:g} % of cell": lambda p: (None if not isinstance(p.get("chmV1"), dict) or "tree3Pct" not in p["chmV1"]
                                                                      else p["chmV1"]["tree3Pct"] >= args.chm_trees),
    }
    for name, call in calls.items():
        tp = fp = fn = tn = 0
        for pid, l in use.items():
            s, t = call(pts[pid]), has_trees(l.get("canopy"))
            if s is None or t is None:
                continue
            tp += s and t
            fp += s and not t
            fn += (not s) and t
            tn += (not s) and (not t)
        n = tp + fp + fn + tn
        res["trees"][name] = {"n": n, "agree": round(100 * (tp + tn) / max(1, n), 1),
                              "foundOfRealTrees": round(100 * tp / max(1, tp + fn), 1),
                              "falseTreesOfSaidTrees": round(100 * fp / max(1, tp + fp), 1), "tp": tp, "fp": fp, "fn": fn, "tn": tn}
    # 3. roads and tracks: mapped route in the cell against what people see
    tp = fp = fn = tn = 0
    for pid, l in use.items():
        s, t = bool(pts[pid]["bundle"].get("routeHere")), l.get("way") not in (None, "none")
        tp += s and t
        fp += s and not t
        fn += (not s) and t
        tn += (not s) and (not t)
    res["ways"] = {"mapped and seen": tp, "mapped, not seen (moved or gone)": fp, "seen, not mapped": fn, "neither": tn}

    # 4. the pre-fill (imagery_prefill.py): how many answers are a guess accepted unchanged, and how often people
    #    changed it. A high share of accepted guesses means the scores lean on the guesser as well as the labellers.
    pre = args.points.parent / "prefill.js"
    if pre.exists():
        s = pre.read_text(encoding="utf-8")
        guess = json.loads(s[s.index("{"):s.rindex("}") + 1])
        kept = changed = asked = 0
        for pid, l in use.items():
            g = guess.get(pid) or {}
            for k in ("cover", "canopy", "way"):
                if k not in g:
                    continue
                asked += 1
                if k in (l.get("guessKept") or []):
                    kept += 1
                elif l.get(k) != g[k]:
                    changed += 1
        res["prefill"] = {"answers": asked, "acceptedUnchanged": kept, "changedByPeople": changed,
                          "chosenSameAsGuess": asked - kept - changed}

    (args.out / "accuracy.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
    md = [f"# Check-point accuracy ({len(use)} points)", "", "## Cover in the 38 m cell", "", "| Source | Points | Agrees | By stratum |",
          "| --- | --- | --- | --- |"]
    md += [f"| {k} | {v['n']} | {v['agree']} % | " + ", ".join(f"{s} {a} %" for s, a in sorted(v["byStratum"].items())) + " |"
           for k, v in res["cover"].items()]
    md += ["", "## Trees in the cell (crowns on 10 % or more)", "", "| Source | Points | Agrees | Finds of real trees | False trees of its trees |",
           "| --- | --- | --- | --- | --- |"]
    md += [f"| {k} | {v['n']} | {v['agree']} % | {v['foundOfRealTrees']} % | {v['falseTreesOfSaidTrees']} % |" for k, v in res["trees"].items()]
    md += ["", "## Roads and tracks", ""] + [f"- {k}: {v}" for k, v in res["ways"].items()]
    if res.get("prefill"):
        pf = res["prefill"]
        md += ["", "## Pre-filled guesses", "",
               f"- {pf['answers']} answers had a guess: {pf['acceptedUnchanged']} accepted with Enter, "
               f"{pf['chosenSameAsGuess']} chosen by key and the same as the guess, {pf['changedByPeople']} changed.",
               "- Accepted guesses were looked at but not chosen independently: read the scores with that in mind."]
    (args.out / "accuracy.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    log.info("written %s", args.out / "accuracy.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
