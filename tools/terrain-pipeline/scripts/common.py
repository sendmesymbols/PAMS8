"""Shared helpers for the terrain pipeline.

Inputs : none (library module).
Outputs: none.

Provides Web Mercator / XYZ tile math, a minimal PNG chunk reader (used to
prove tiles carry no ancillary chunks), block iteration for out-of-core
raster processing, subprocess + logging helpers and YAML/JSON loaders.
"""
from __future__ import annotations

import json
import logging
import math
import os
import shutil
import struct
import subprocess
import sys
import zlib
from pathlib import Path
from typing import Iterator

EARTH_RADIUS = 6378137.0
ORIGIN_SHIFT = math.pi * EARTH_RADIUS          # half the Web Mercator world width
TILE_SIZE = 256
PIPELINE_VERSION = "0.1.0"

# WorldPop inputs (sources.lock worldpop / worldpop_agesex / worldpop_density / worldpop_pwd), read by grotbc.py,
# settlements.py and population.py. Change the year here and in sources.lock together. The population count is the
# 100 m file; the age groups come from the 1 km age-sex files as shares (group / all ages) applied to those people.
WORLDPOP_YEAR = 2026
WORLDPOP_TIF = Path("work/raw/worldpop/pak_pop_2026_CN_100m_R2025A_v1.tif")
WORLDPOP_AGESEX = "work/raw/worldpop_agesex/pak_{band}_2026_CN_1km_R2025A_UA_v1.tif"
WORLDPOP_SOURCE = ("WorldPop Global2 R2025A v1, 2026 estimate: people at 100 m (constrained), age groups as 1 km "
                   "shares (constrained, UN-adjusted)")
AGE_GROUPS = {   # field -> (label, WorldPop age-sex bands summed: m = male, t = total, number = first year of the band)
    "males15_49": ("males aged 15-49", ("m_15", "m_20", "m_25", "m_30", "m_35", "m_40", "m_45")),
    "under15": ("children under 15", ("t_00", "t_01", "t_05", "t_10")),
    "over65": ("people aged 65 and over", ("t_65", "t_70", "t_75", "t_80", "t_85", "t_90")),
}
ALL_AGES = ("t_00", "t_01") + tuple(f"t_{a:02d}" for a in range(5, 95, 5))      # every total band: the share denominator


def source_ref(lock: dict | None, sid: str) -> dict:
    """Where and when one sources.lock entry comes from: {id, name, location [urls / local paths], landing, dataDate,
    released}. Every product that names its inputs carries these, so each layer can be traced to a place and a date."""
    s = next((s for s in (lock or {}).get("sources", []) if s["id"] == sid), None)
    if s is None:
        return {"id": sid}
    if "files" in s:
        loc = [f["url"] for f in s["files"]]
    elif "tiles" in s:
        loc = [s["pattern"].format(tile=t) for t in s["tiles"]]
    elif "pattern" in s:
        loc = [s["pattern"]]
    else:
        loc = [s["location"]] if s.get("location") else []
    return {"id": sid, "name": s.get("name"), "location": loc, "landing": s.get("landing"),
            "dataDate": s.get("dataDate"), "released": s.get("released")}


def read_people(path: Path, with_mask: bool = False):
    """(people per cell as float32 with no-data as 0, affine transform, shape[, no-data mask]) of a WorldPop count
    raster. float32 keeps the 100 m country file at ~1.3 GB; sum it with dtype float64."""
    import numpy as np
    import rasterio
    with rasterio.open(path) as d:
        a = d.read(1).astype("float32", copy=False)
        nod = d.nodata
        tr = d.transform
    bad = ~np.isfinite(a) | (a < 0)
    if nod is not None:
        bad |= a == nod
    a[bad] = 0.0
    return (a, tr, a.shape, bad) if with_mask else (a, tr, a.shape)


def age_shares():
    """({AGE_GROUPS field: share of all people in the 1 km cell}, transform, shape, no-data mask) from the age-sex
    files, or None when any is missing."""
    import numpy as np
    paths = {b: Path(WORLDPOP_AGESEX.format(band=b)) for b in set(ALL_AGES).union(*(g[1] for g in AGE_GROUPS.values()))}
    if not all(p.exists() for p in paths.values()):
        return None
    bands = {}
    tr = shape = mask = None
    for b, p in paths.items():
        bands[b], tr, shape, bad = read_people(p, with_mask=True)
        mask = bad if mask is None else mask & bad
    total = sum(bands[b].astype("float64") for b in ALL_AGES)
    shares = {k: np.where(total > 0, sum(bands[b].astype("float64") for b in bs) / np.maximum(total, 1e-9), 0.0)
              .astype("float32") for k, (_l, bs) in AGE_GROUPS.items()}
    return shares, tr, shape, mask


def cell_of(transform, shape, lon, lat):
    """Flat index of the cell of `transform` / `shape` holding each lon, lat; -1 outside the grid."""
    import numpy as np
    r = np.floor((np.asarray(lat) - transform.f) / transform.e).astype(np.int64)
    c = np.floor((np.asarray(lon) - transform.c) / transform.a).astype(np.int64)
    ok = (r >= 0) & (r < shape[0]) & (c >= 0) & (c < shape[1])
    return np.where(ok, r * shape[1] + c, -1)

# ----------------------------------------------------------------------------- logging

def setup_logging(name: str) -> logging.Logger:
    logging.basicConfig(level=logging.INFO, stream=sys.stderr,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
                        datefmt="%H:%M:%S")
    return logging.getLogger(name)


def _gdal_data_for(tool: str) -> str | None:
    """Folder holding GDAL's data files (osmconf.ini, ...) next to the GDAL install that owns `tool`.

    The OSM reader (ogr2ogr on a .pbf) needs osmconf.ini and fails with "Cannot find osmconf.ini
    (GDAL_DATA is not defined)" when the CLI tools come from a QGIS / OSGeo4W / conda install that is
    only on PATH. Returns None when GDAL_DATA is already set or nothing is found.
    """
    if os.environ.get("GDAL_DATA"):
        return None
    exe = shutil.which(tool)
    if not exe:
        return None
    root = Path(exe).resolve().parent.parent
    for cand in (root / "apps" / "gdal" / "share" / "gdal",     # QGIS standalone / OSGeo4W apps
                 root / "share" / "gdal",                       # OSGeo4W, Linux prefixes
                 root / "Library" / "share" / "gdal"):          # conda on Windows
        if (cand / "osmconf.ini").exists():
            return str(cand)
    return None


PIPELINE_DIR = Path(__file__).resolve().parent.parent
# Where the finished bundle lives: next to the library's other data, <repo>/MS/Data/terrain-bundle, so the host
# serves it from there. Anchored on this file, so it is the same whatever the working directory is.
BUNDLE_DIR = PIPELINE_DIR.parent.parent / "MS" / "Data" / "terrain-bundle"
CONTAINER_ROOT = "/work"                      # where the container mounts PIPELINE_DIR


def _to_container(arg) -> str:
    """Translate a Path (relative to the cwd, or absolute) under PIPELINE_DIR to its path in the container."""
    if not isinstance(arg, os.PathLike):
        return str(arg)
    full = Path(os.path.abspath(arg))
    try:
        rel = full.relative_to(PIPELINE_DIR)
    except ValueError:
        raise SystemExit(f"{full} is outside {PIPELINE_DIR}, which is all the GDAL container can see")
    return CONTAINER_ROOT + "/" + rel.as_posix() if rel.parts else CONTAINER_ROOT


def run(cmd: list[str], log: logging.Logger, dry: bool = False) -> None:
    """Run an external command (GDAL etc.), echoing it; raise on failure.

    With $GDAL_CONTAINER set (a running Docker container that mounts this folder at /work) the command runs
    there via `docker exec`, Path arguments translated to container paths; no GDAL install is needed on the host.

    GDAL_DATA is set for the child process only (never for this Python process, whose rasterio wheel
    carries its own GDAL data and must not be pointed at a different install's).
    """
    log.info("$ %s", " ".join(str(c) for c in cmd))
    if dry:
        return
    container = os.environ.get("GDAL_CONTAINER")
    if container:
        subprocess.run(["docker", "exec", container, *[_to_container(c) for c in cmd]], check=True)
        return
    env = None
    data = _gdal_data_for(str(cmd[0]))
    if data:
        env = {**os.environ, "GDAL_DATA": data}
    subprocess.run([str(c) for c in cmd], check=True, env=env)

# ----------------------------------------------------------------------------- tile math

def resolution(z: int) -> float:
    """Metres per pixel at the equator for zoom z (256 px tiles)."""
    return 2 * ORIGIN_SHIFT / (TILE_SIZE * 2 ** z)


def lnglat_to_merc(lon: float, lat: float) -> tuple[float, float]:
    x = lon * ORIGIN_SHIFT / 180.0
    y = math.log(math.tan((90.0 + lat) * math.pi / 360.0)) * EARTH_RADIUS
    return x, y


def merc_to_lnglat(x: float, y: float) -> tuple[float, float]:
    lon = x / ORIGIN_SHIFT * 180.0
    lat = math.degrees(2 * math.atan(math.exp(y / EARTH_RADIUS)) - math.pi / 2)
    return lon, lat


def merc_to_pixel(x: float, y: float, z: int) -> tuple[float, float]:
    """Global pixel coordinates (origin top-left of the world) at zoom z."""
    res = resolution(z)
    return (x + ORIGIN_SHIFT) / res, (ORIGIN_SHIFT - y) / res


def lnglat_to_pixel(lon: float, lat: float, z: int) -> tuple[float, float]:
    return merc_to_pixel(*lnglat_to_merc(lon, lat), z)


def pixel_to_tile(px: float, py: float) -> tuple[int, int]:
    return int(px // TILE_SIZE), int(py // TILE_SIZE)


def lnglat_to_tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    return pixel_to_tile(*lnglat_to_pixel(lon, lat, z))


def tile_bounds_merc(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """(minx, miny, maxx, maxy) in EPSG:3857 of tile z/x/y."""
    size = TILE_SIZE * resolution(z)
    minx = -ORIGIN_SHIFT + x * size
    maxy = ORIGIN_SHIFT - y * size
    return minx, maxy - size, minx + size, maxy


def tile_range(aoi: tuple[float, float, float, float], z: int) -> tuple[int, int, int, int]:
    """Inclusive (xmin, ymin, xmax, ymax) tile indices covering a WGS84 AOI."""
    w, s, e, n = aoi
    x0, y0 = lnglat_to_tile(w, n, z)                       # top-left
    x1, y1 = lnglat_to_tile(e, s, z)                       # bottom-right
    return x0, y0, x1, y1


def row_latitudes(grid: dict, row0: int, nrows: int):
    """Centre latitude (degrees) of each raster row in [row0, row0+nrows)."""
    import numpy as np
    top = grid["bounds_3857"][3]
    res = grid["pixel_size"]
    ys = top - (np.arange(row0, row0 + nrows) + 0.5) * res
    return np.degrees(2 * np.arctan(np.exp(ys / EARTH_RADIUS)) - np.pi / 2)


def parse_aoi(text: str) -> tuple[float, float, float, float]:
    parts = [float(p) for p in text.replace(" ", "").split(",")]
    if len(parts) != 4:
        raise ValueError("AOI must be 'west,south,east,north'")
    return tuple(parts)  # type: ignore[return-value]

# ----------------------------------------------------------------------------- blocks

def iter_blocks(width: int, height: int, block: int, halo: int = 0) -> Iterator[dict]:
    """Yield windows for out-of-core processing.

    Each item has the core window (col, row, w, h) to write and the padded read
    window (rcol, rrow, rw, rh) clipped to the raster, plus the offsets
    (ox, oy) of the core inside the padded array.
    """
    for row in range(0, height, block):
        for col in range(0, width, block):
            w, h = min(block, width - col), min(block, height - row)
            rcol, rrow = max(0, col - halo), max(0, row - halo)
            rw = min(width, col + w + halo) - rcol
            rh = min(height, row + h + halo) - rrow
            yield dict(col=col, row=row, w=w, h=h, rcol=rcol, rrow=rrow,
                       rw=rw, rh=rh, ox=col - rcol, oy=row - rrow)

# ----------------------------------------------------------------------------- PNG

PNG_SIG = b"\x89PNG\r\n\x1a\n"


def read_png_chunks(path: Path) -> dict:
    """Parse a PNG without Pillow: returns IHDR fields, chunk types, CRC status."""
    data = Path(path).read_bytes()
    if data[:8] != PNG_SIG:
        raise ValueError(f"{path}: not a PNG")
    pos, chunks, ihdr, crc_ok = 8, [], {}, True
    while pos + 8 <= len(data):
        length, ctype = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + length]
        crc = struct.unpack(">I", data[pos + 8 + length:pos + 12 + length])[0]
        crc_ok &= zlib.crc32(ctype + body) & 0xFFFFFFFF == crc
        name = ctype.decode("latin-1")
        chunks.append(name)
        if name == "IHDR":
            w, h, depth, ctype_i, _, _, interlace = struct.unpack(">IIBBBBB", body)
            ihdr = dict(width=w, height=h, bit_depth=depth, color_type=ctype_i,
                        interlace=interlace)
        pos += 12 + length
        if name == "IEND":
            break
    return dict(ihdr=ihdr, chunks=chunks, crc_ok=crc_ok, size=len(data))


def write_png_l(path: Path, arr) -> None:
    """Write a uint8 2-D array as an opaque 8-bit greyscale PNG with no
    ancillary chunks (no gAMA/sRGB/iCCP/tRNS/pHYs). Pillow emits only
    IHDR/IDAT/IEND for mode "L" when no pnginfo/icc/dpi is supplied."""
    from PIL import Image
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr, mode="L").save(path, format="PNG", optimize=True)

# ----------------------------------------------------------------------------- io

def load_yaml(path: Path):
    import yaml
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def load_json(path: Path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def dump_json(path: Path, obj) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8")


def class_table(classes_cfg: dict) -> dict[str, int]:
    """name -> code from classes.yaml."""
    return {c["name"]: int(c["code"]) for c in classes_cfg["classes"]}


COG_OPTS = ["-of", "COG", "-co", "COMPRESS=DEFLATE", "-co", "BLOCKSIZE=512",
            "-co", "OVERVIEWS=NONE", "-co", "BIGTIFF=IF_SAFER"]


def to_cog(src: Path, dst: Path, log: logging.Logger) -> None:
    """Rewrite a tiled GTiff as a DEFLATE Cloud-Optimised GeoTIFF with rasterio's own GDAL (no GDAL CLI needed)."""
    import rasterio.shutil
    log.info("COG %s -> %s", Path(src).name, Path(dst).name)
    Path(dst).unlink(missing_ok=True)
    rasterio.shutil.copy(str(src), str(dst), driver="COG", COMPRESS="DEFLATE", BLOCKSIZE=512,
                         OVERVIEWS="NONE", BIGTIFF="IF_SAFER")
# rasterio profile for intermediate uint8 rasters (tiled GTiff; converted to COG at the end)
GTIFF_U8 = dict(driver="GTiff", dtype="uint8", count=1, nodata=255, tiled=True,
                blockxsize=512, blockysize=512, compress="deflate", bigtiff="IF_SAFER")
