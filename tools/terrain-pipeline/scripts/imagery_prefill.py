"""Step I2b — pre-fill the labelling page with a first guess per check point, for people to confirm or correct.

Inputs : work/imagery/checkpoints/guesses.txt  one line per point: `<nnnn> <cover> <canopy> <way>` or `<nnnn> cant`,
                                               made by looking at the chips (Claude, 2026-11-11, from the 120 m chip)
Outputs: work/imagery/checkpoints/prefill.js   window.PREFILL = {id: {cover, canopy, way | image: "cant", by}}

The page shows a guess dashed, never as an answer: Enter accepts the guesses still open on that point, a key replaces
one. Only confirmed answers are exported; each label records which answers were the guess accepted unchanged
(`guessKept`), so the scores can say how much rests on accepted guesses (a pre-fill can lead people to agree with it).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import setup_logging  # noqa: E402

log = setup_logging("imagery_prefill")

COVER = {"tree", "shrub", "crop", "open", "bare", "rock", "built", "water"}
CANOPY = {"0", "lt10", "10-30", "30-60", "gt60"}
WAY = {"none", "path", "unmetalled", "metalled"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", type=Path, default=Path("work/imagery/checkpoints"))
    ap.add_argument("--by", default="Claude, from the chip (2026-11-11)")
    args = ap.parse_args()
    pts = {p["id"] for p in json.loads((args.dir / "points.json").read_text(encoding="utf-8"))["points"]}
    out, bad = {}, []
    for n, line in enumerate((args.dir / "guesses.txt").read_text(encoding="utf-8").splitlines(), 1):
        f = line.split()
        if not f:
            continue
        pid = "P" + f[0]
        if f[1:] == ["cant"]:
            out[pid] = {"image": "cant", "by": args.by}
        elif len(f) == 4 and f[1] in COVER and f[2] in CANOPY and f[3] in WAY:
            out[pid] = {"cover": f[1], "canopy": f[2], "way": f[3], "by": args.by}
        else:
            bad.append(f"line {n}: {line}")
    missing = sorted(pts - set(out))
    (args.dir / "prefill.js").write_text("window.PREFILL = " + json.dumps(out) + ";\n", encoding="utf-8")
    log.info("prefill: %d points guessed, %d bad lines %s, %d points without a guess %s", len(out), len(bad), bad[:5],
             len(missing), missing[:10])
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
