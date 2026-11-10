"""Independent line-of-sight check for the OCOKA test program (run by run.mjs).

Reads the tiles itself, rebuilds the elevation, and for every sample the JavaScript engine saw or hid along each ray it asks
a different question: walk the straight line from the eye to the target with a sixth of a pixel between probes (the engine
uses one pixel or half a pixel) and see whether any ground rises above the line of sight (with the same earth curvature and refraction).
Prints one JSON object: how many samples agree.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

inp = json.loads(Path(sys.argv[1]).read_text())
bundle = Path(inp["bundle"])
tx0, ty0, nx, ny = inp["tx0"], inp["ty0"], inp["nx"], inp["ny"]
W, H = nx * 256, ny * 256
hi = np.full((H, W), 255, np.uint8)
lo = np.zeros((H, W), np.uint8)
for ty in range(ny):
    for tx in range(nx):
        for name, arr in (("elev_hi", hi), ("elev_lo", lo)):
            f = bundle / name / "12" / str(tx0 + tx) / f"{ty0 + ty}.png"
            if f.exists():
                arr[ty * 256:(ty + 1) * 256, tx * 256:(tx + 1) * 256] = np.array(Image.open(f))
elev = np.where(hi == 255, np.nan, hi.astype(np.float64) * 256 + lo - 500)


def bilinear(x, y):
    x0 = np.floor(x - 0.5).astype(int)
    y0 = np.floor(y - 0.5).astype(int)
    ok = (x0 >= 0) & (y0 >= 0) & (x0 + 1 < W) & (y0 + 1 < H)
    x0c, y0c = np.clip(x0, 0, W - 2), np.clip(y0, 0, H - 2)
    fx, fy = x - 0.5 - x0c, y - 0.5 - y0c
    v = (elev[y0c, x0c] * (1 - fx) + elev[y0c, x0c + 1] * fx) * (1 - fy) + (elev[y0c + 1, x0c] * (1 - fx) + elev[y0c + 1, x0c + 1] * fx) * fy
    return np.where(ok, v, np.nan)


ox, oy, res = inp["ox"], inp["oy"], inp["res"]
eye, tgt = inp["eyeM"], inp["targetM"]
kc = (1 - inp["k"]) / (2 * 6371008.8)
steps = inp["steps"]
step_px = inp.get("stepPx", 1)
bear = np.radians(np.array(inp["bearings"]))
trace = np.array(inp["trace"], np.uint8).reshape(len(bear), steps)
h0 = bilinear(np.array([ox]), np.array([oy]))[0]
eye_abs = h0 + eye
sub = 6
agree = tsSeenRefHidden = tsHiddenRefSeen = samples = 0
miss_d = []
for r, b in enumerate(bear):
    dx, dy = np.sin(b), -np.cos(b)
    t = np.arange(1, int(np.ceil(steps * step_px * sub)) + 1) / sub     # in pixels, probes every sixth of a pixel
    z = bilinear(ox + dx * t, oy + dy * t)
    d = t * res
    line_slope = (z - eye_abs - d * d * kc) / d      # slope of the ground at each probe
    run_max = np.maximum.accumulate(np.where(np.isnan(line_slope), -np.inf, line_slope))
    for s in range(1, steps + 1):
        flag = trace[r, s - 1]
        if flag == 2:
            continue
        i = int(round(s * step_px * sub)) - 1        # the probe that falls on the engine's sample
        if np.isnan(z[i]):
            continue
        target_slope = (z[i] + tgt - eye_abs - d[i] * d[i] * kc) / d[i]
        before = run_max[i - 1] if i > 0 else -np.inf
        ref_seen = target_slope >= before
        samples += 1
        if (flag == 1) == bool(ref_seen):
            agree += 1
        elif flag == 1:
            tsSeenRefHidden += 1
            miss_d.append(float(d[i]))
        else:
            tsHiddenRefSeen += 1
print(json.dumps({"samples": samples, "agree": agree, "agreePct": 100 * agree / max(1, samples), "tsSeenRefHidden": tsSeenRefHidden, "tsHiddenRefSeen": tsHiddenRefSeen, "missDistM": [round(x) for x in sorted(miss_d)]}))
