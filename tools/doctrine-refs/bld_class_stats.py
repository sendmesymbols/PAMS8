"""bld_class_stats.py -- what the terrain bundle's building classes hold, as data behind OcokaDoctrine.json surfaceBlockers.built.

    tools/terrain-pipeline/.venv/Scripts/python.exe tools/doctrine-refs/bld_class_stats.py

Reads the building cells the pipeline keeps (tools/terrain-pipeline/work/buildings/cells.npz: Google Open Buildings v3
count and footprint area, GHSL GHS-BUILT-H R2023A net height, per ~150 m cell), classes them exactly as
scripts/buildings.py does, and writes, per class, the number of cells and the quartiles of what the class stands for:
buildings per km2 (density class), the side of a square of the mean footprint (size class) and the net height (height
class). Writes tools/doctrine-refs/bld_class_stats.txt, its first line saying what it is and when it was made, so
verify.py can check the figures quoted from it. Nothing is fetched.
"""
import datetime
import json
import os
import sys

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PIPE = os.path.join(ROOT, 'tools', 'terrain-pipeline')
sys.path.insert(0, os.path.join(PIPE, 'scripts'))
from buildings import BLD_DENSITY, BLD_HEIGHT, BLD_SIZE, DECIM, DENSITY_LABEL, HEIGHT_LABEL, SIZE_LABEL  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), 'bld_class_stats.txt')


def classes(values, table):
    out = np.zeros(values.shape, dtype=np.uint8)
    for lo, k in reversed(table):
        out[values >= lo] = k
    return out


def q(v):
    return np.percentile(v, [25, 50, 75]) if v.size else [float('nan')] * 3


def main():
    z = np.load(os.path.join(PIPE, 'work', 'buildings', 'cells.npz'))
    grid = json.load(open(os.path.join(PIPE, 'work', 'grid', 'grid.json'), encoding='utf-8'))
    cnt, area, height = z['count'], z['area'], z['height']
    H, W = cnt.shape
    res = grid['pixel_size'] * DECIM
    ymid = grid['transform'][5] - (np.arange(H) + 0.5) * res
    km2 = ((res * np.cos(np.arctan(np.sinh(ymid / 6378137.0)))) / 1000.0) ** 2
    rows, cols = np.nonzero(cnt)
    n = cnt[rows, cols].astype(np.float64)
    dens = n / km2[rows]
    side = np.sqrt(area[rows, cols] / n)
    hgt = height[rows, cols] if height.shape == cnt.shape else np.zeros_like(n)
    dcls, scls = classes(dens, BLD_DENSITY), classes(area[rows, cols] / n, BLD_SIZE)
    hcls = classes(hgt, BLD_HEIGHT)
    today = datetime.date.today().isoformat()
    L = [f'PAMS8 building class statistics, made {today} by tools/doctrine-refs/bld_class_stats.py from tools/terrain-pipeline/work/buildings/cells.npz '
         f'(Google Open Buildings v3, imagery to 2022; GHSL GHS-BUILT-H R2023A net height 2018), {rows.size} cells of about {res:.0f} m with buildings',
         '']
    L.append('Density class (value & 7): buildings per km2 in the cells of the class, quartiles 25 / 50 / 75')
    for k in range(1, 7):
        v = dens[dcls == k]
        a, b, c = q(v)
        L.append(f'density class {k} {DENSITY_LABEL[k]}: {v.size} cells, buildings per km2 {a:.0f} / {b:.0f} / {c:.0f}')
    L.append('')
    L.append('Size class (value >> 3 & 7): side of a square of the mean footprint in the cells of the class, metres, quartiles 25 / 50 / 75')
    for k in range(1, 6):
        v = side[scls == k]
        a, b, c = q(v)
        L.append(f'size class {k} {SIZE_LABEL[k]}: {v.size} cells, side {a:.1f} / {b:.1f} / {c:.1f} m')
    L.append('')
    L.append('Height class (value >> 6): GHSL average net building height in the cells of the class, metres, quartiles 25 / 50 / 75')
    for k in range(0, 4):
        v = hgt[(hcls == k) & (hgt > 0)] if k == 0 else hgt[hcls == k]
        a, b, c = q(v)
        none = int(((hcls == 0) & ~(hgt > 0)).sum()) if k == 0 else 0
        L.append(f'height class {k} {HEIGHT_LABEL[k]}: {v.size} cells with a height' + (f' and {none} with none' if k == 0 else '')
                 + f', height {a:.1f} / {b:.1f} / {c:.1f} m')
    open(OUT, 'w', encoding='utf-8').write('\n'.join(L) + '\n')
    print('\n'.join(L))


if __name__ == '__main__':
    main()
