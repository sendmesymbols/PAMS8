"""Step 7 — verify a terrain bundle against the format contract.

Inputs : a bundle folder (class/, dist_*/, rules.json; manifest.json if present),
         golden_points.yaml (optional, --no-golden to skip)
Outputs: a report on stdout; exit code 1 on any failure.

Checks
  1. every PNG: 8-bit greyscale, 256x256, non-interlaced, chunks are exactly
     IHDR, IDAT..., IEND (no gAMA/sRGB/iCCP/tRNS/pHYs), CRCs valid
  2. class histogram per zoom level (printed as a table)
  3. golden points: expected class occurs within +-tolerance_px at ZMAX
  4. dist layers (random sample of ZMAX tiles): 0 exactly where the class is
     no-go for that profile, 255 exactly where class is nodata
  5. dist overviews (random sample): coarse value <= MIN of its 2x2 children
  6. tile counts and total size per layer
"""
from __future__ import annotations

import argparse
import random
import sys
from pathlib import Path

import numpy as np

from common import TILE_SIZE, lnglat_to_pixel, load_json, load_yaml, read_png_chunks, setup_logging

log = setup_logging("validate")
FORBIDDEN = {"gAMA", "sRGB", "iCCP", "tRNS", "pHYs", "PLTE", "cHRM", "iTXt", "tEXt", "zTXt"}


def png_array(path: Path) -> np.ndarray:
    from PIL import Image
    with Image.open(path) as im:
        return np.asarray(im, dtype=np.uint8)


def tile_index(bundle: Path) -> dict[str, dict[int, list[tuple[int, int, Path]]]]:
    """layer -> z -> [(x, y, path)]"""
    idx: dict[str, dict[int, list]] = {}
    for layer_dir in sorted(p for p in bundle.iterdir() if p.is_dir()):
        for png in layer_dir.rglob("*.png"):
            z, x = int(png.parent.parent.name), int(png.parent.name)
            idx.setdefault(layer_dir.name, {}).setdefault(z, []).append((x, int(png.stem), png))
    return idx


def check_png_format(idx) -> tuple[int, int]:
    bad = total = 0
    for layer, levels in idx.items():
        for z, tiles in levels.items():
            for _, _, p in tiles:
                total += 1
                info = read_png_chunks(p)
                h, chunks = info["ihdr"], info["chunks"]
                problems = []
                if (h.get("width"), h.get("height")) != (TILE_SIZE, TILE_SIZE):
                    problems.append(f"size {h.get('width')}x{h.get('height')}")
                if h.get("bit_depth") != 8 or h.get("color_type") != 0:
                    problems.append(f"depth {h.get('bit_depth')} colour type {h.get('color_type')}")
                if h.get("interlace"):
                    problems.append("interlaced")
                extra = set(chunks) - {"IHDR", "IDAT", "IEND"}
                if extra:
                    problems.append("extra chunks " + ",".join(sorted(extra & FORBIDDEN or extra)))
                if not info["crc_ok"]:
                    problems.append("bad CRC")
                if problems:
                    bad += 1
                    if bad <= 20:
                        log.error("%s: %s", p, "; ".join(problems))
    return bad, total


def class_histogram(idx, classes: dict) -> None:
    levels = idx.get("class", {})
    print("\nclass histogram (% of tiles' pixels, nodata included)")
    names = {int(k): v["name"] for k, v in classes.items()}
    print(f"{'z':>3} " + " ".join(f"{names[c][:8]:>8}" for c in sorted(names)))
    for z in sorted(levels):
        hist = np.zeros(256, dtype=np.int64)
        for _, _, p in levels[z]:
            hist += np.bincount(png_array(p).ravel(), minlength=256)
        pct = 100 * hist / max(1, hist.sum())
        print(f"{z:>3} " + " ".join(f"{pct[c]:>8.2f}" for c in sorted(names)))


def check_golden(bundle: Path, points: list, zmax: int, codes: dict[str, int]) -> int:
    fails = 0
    for pt in points:
        px, py = lnglat_to_pixel(pt["lon"], pt["lat"], zmax)
        tol = int(pt.get("tolerance_px", 3))
        # `expect` is one class name or a list of acceptable ones (a hybrid bundle can call the Thar
        # "sand" or "dunes" where open data says "bare_desert").
        wanted = pt["expect"] if isinstance(pt["expect"], list) else [pt["expect"]]
        expects = {codes[n] for n in wanted}
        found = set()
        for sy in range(int(py) - tol, int(py) + tol + 1):
            for sx in range(int(px) - tol, int(px) + tol + 1):
                p = bundle / "class" / str(zmax) / str(sx // TILE_SIZE) / f"{sy // TILE_SIZE}.png"
                if p.exists():
                    found.add(int(png_array(p)[sy % TILE_SIZE, sx % TILE_SIZE]))
        ok = bool(expects & found)
        fails += not ok
        log.log(20 if ok else 40, "golden %-38s expect %s (%s) found %s -> %s",
                pt["name"], sorted(expects), "/".join(wanted), sorted(found) or "no tile", "OK" if ok else "FAIL")
    return fails


def check_dist(bundle: Path, idx, rules: dict, zmax: int, sample: int, rng) -> int:
    fails = 0
    class_tiles = idx.get("class", {}).get(zmax, [])
    for pid, prof in rules["profiles"].items():
        layer = f"dist_{pid}"
        if layer not in idx:
            continue
        for x, y, p in rng.sample(class_tiles, min(sample, len(class_tiles))):
            dp = bundle / layer / str(zmax) / str(x) / f"{y}.png"
            if not dp.exists():
                log.error("%s: missing where class tile exists (%d/%d/%d)", layer, zmax, x, y)
                fails += 1
                continue
            cls, dist = png_array(p), png_array(dp)
            valid = cls != 255
            nogo = (valid & ~np.isin(cls, prof["requires"])) if "requires" in prof else np.isin(cls, prof["nogo"])
            if not np.array_equal(dist == 0, nogo) or not np.array_equal(dist == 255, ~valid):
                log.error("%s %d/%d/%d: 0/255 pattern does not match class no-go/nodata", layer, zmax, x, y)
                fails += 1
        # overview monotonicity: parent <= min(children)
        for z in sorted(idx[layer]):
            if z == zmax:
                continue
            for x, y, p in rng.sample(idx[layer][z], min(sample, len(idx[layer][z]))):
                parent = png_array(p)
                for dy in (0, 1):
                    for dx in (0, 1):
                        kp = bundle / layer / str(z + 1) / str(2 * x + dx) / f"{2 * y + dy}.png"
                        if not kp.exists():
                            continue
                        kmin = png_array(kp).reshape(128, 2, 128, 2).min(axis=(1, 3))
                        quad = parent[dy * 128:(dy + 1) * 128, dx * 128:(dx + 1) * 128]
                        if (quad > kmin).any():
                            log.error("%s %d/%d/%d: coarse > min(children) at child %d/%d", layer, z, x, y, dx, dy)
                            fails += 1
    return fails


def size_report(idx) -> None:
    print("\nlayer            z  tiles      MB")
    grand = 0
    for layer, levels in idx.items():
        for z in sorted(levels):
            size = sum(p.stat().st_size for _, _, p in levels[z])
            grand += size
            print(f"{layer:<15} {z:>2} {len(levels[z]):>6} {size / 1e6:>7.1f}")
    print(f"total {grand / 1e6:.1f} MB")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bundle", type=Path, default=Path("out/terrain-bundle"))
    ap.add_argument("--golden", type=Path, default=Path("golden_points.yaml"))
    ap.add_argument("--no-golden", action="store_true")
    ap.add_argument("--sample", type=int, default=40, help="tiles per random check")
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()

    rules = load_json(args.bundle / "rules.json")
    manifest_path = args.bundle / "manifest.json"
    idx = tile_index(args.bundle)
    zmax = load_json(manifest_path)["zoom"]["max"] if manifest_path.exists() else max(idx["class"])
    fails = 0

    bad, total = check_png_format(idx)
    log.info("png format: %d/%d bad", bad, total)
    fails += bad
    class_histogram(idx, rules["classes"])
    if not args.no_golden and args.golden.exists():
        codes = {v["name"]: int(k) for k, v in rules["classes"].items()}
        fails += check_golden(args.bundle, load_yaml(args.golden)["points"], zmax, codes)
    fails += check_dist(args.bundle, idx, rules, zmax, args.sample, random.Random(args.seed))
    size_report(idx)
    log.log(20 if not fails else 40, "validation %s (%d failure(s))", "PASSED" if not fails else "FAILED", fails)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
