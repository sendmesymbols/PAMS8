"""2026-11-20: finish the ZMAX 13 bundle cut by scripts/run_z13.sh.

The z13 run rebuilds only the grid rasters (class, dist_*, elevation and the other tile layers). Everything else in the
live bundle (features/ with the ITG candidates and the 7 Div overlays, network/, settlements, climate, visibility,
population, admin / boundaries / sheets / routes) does not depend on the grid and was built by many later steps
(run_v2b..v2l), so it is copied byte for byte from the live bundle. manifest.json is the live one with:
zoom.max from the new grid, `built`, the GEM-15 source added next to GLO-30 wherever GLO-30 feeds a rebuilt layer,
`profiles` from the dist_ folders, and an `elevationModel` note. LICENSES.txt gets the GEM-15 block after GLO-30's.
rules.json comes from the z13 profiles run (current rules.yaml, the one the dist tiles were made with).
"""
import argparse, json, shutil, sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from common import dump_json, load_json, load_yaml, source_ref   # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--live", type=Path, default=Path("../../MS/Data/terrain-bundle"))
ap.add_argument("--out", type=Path, required=True)
ap.add_argument("--grid", type=Path, required=True)
ap.add_argument("--rules-json", type=Path, required=True)
ap.add_argument("--lock", type=Path, default=Path("sources.lock"))
ap.add_argument("--checksums", type=Path, default=Path("work/raw/checksums.json"))
a = ap.parse_args()

live = load_json(a.live / "manifest.json")
grid = load_json(a.grid)
tile_layers = set(live["layers"].values()) | {p.name for p in a.live.glob("dist_*")}
tile_layers.discard("dist_{profile}")
skip = tile_layers | {"manifest.json", "rules.json", "LICENSES.txt"}
copied = []
for p in sorted(a.live.iterdir()):
    if p.name in skip:
        continue
    dest = a.out / p.name
    if p.is_dir():
        shutil.copytree(p, dest, dirs_exist_ok=True)
    else:
        shutil.copy2(p, dest)
    copied.append(p.name)
print("copied from live:", " ".join(copied))
missing = sorted(n for n in tile_layers if not (a.out / n).is_dir())
if missing:
    sys.exit(f"tile layers missing in {a.out}: {missing}")

lock = load_yaml(a.lock)
checks = load_json(a.checksums) if a.checksums.exists() else {}
g = next(s for s in lock["sources"] if s["id"] == "gem15")
ref = source_ref(lock, "gem15")
gem = {"id": "gem15", "name": g["name"], "version": str(g.get("version", "")), "location": ref["location"],
       "landing": ref["landing"], "dataDate": ref["dataDate"], "released": ref["released"], "licence": g["licence"],
       "sha256": checks.get("gem15", {}).get("sha256", str(g.get("sha256", ""))),
       "files": len(checks.get("gem15", {}).get("files", {})) or None}

m = json.loads(json.dumps(live))
built = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
m["zoom"] = {"min": grid["zmin"], "max": grid["zmax"]}
m["built"] = built
m["profiles"] = sorted(p.name[len("dist_"):] for p in a.out.glob("dist_*") if p.is_dir())
m["sources"] = [s for s in m["sources"] if s["id"] != "gem15"]
i = next(k for k, s in enumerate(m["sources"]) if s["id"] == "glo30")
m["sources"].insert(i + 1, gem)

def add_gem(lst):
    if isinstance(lst, list) and "glo30" in lst and "gem15" not in lst:
        lst.insert(lst.index("glo30") + 1, "gem15")

for k in ("class", "dist"):
    add_gem(m["layerSources"][k])
for name, spec in m["grotbc"]["layers"].items():
    if name in tile_layers:
        add_gem(spec.get("sources"))
m["elevationModel"] = {
    "zmax": grid["zmax"], "groundResM": "about 16 m at 30 N (z13 pixel 19.1 m x cos lat)",
    "sources": ["gem15", "glo30"],
    "note": ("Google GEM-15 DTM (15 m, bare earth, EGM96) warped bilinear onto the z13 grid over Copernicus GLO-30 "
             "(EGM2008); GLO-30 fills where GEM-15 has no data (water, snow / ice, salt pans, low texture). "
             "GEM-15 heights over India are offset by Google, tapering outside India's border: measured +4.7 m at "
             "Sialkot / Jammu, +9.5 m Muzaffarabad, +16.6 m Srinagar (sources.lock gem15). Vector features "
             "(features/, ITG candidates) were not rebuilt and still come from the GLO-30 build."),
}
dump_json(a.out / "manifest.json", m)
shutil.copyfile(a.rules_json, a.out / "rules.json")

lic = (a.live / "LICENSES.txt").read_text(encoding="utf-8").splitlines()
lic[0] = f"PAMS terrain bundle — data sources and licences (built {built})"
block = [f"{g['name']}  [{g.get('version', '')}]",
         f"  data date   : {g.get('dataDate', '')}",
         f"  released    : {g.get('released', '')}",
         f"  licence     : {g['licence']}",
         f"  attribution : {g.get('attribution', '')}",
         f"  citation    : {g.get('citation', '')}",
         f"  source      : {g.get('landing', '')}"] + [f"  location    : {u}" for u in ref["location"]] + [""]
glo = next(s for s in lock["sources"] if s["id"] == "glo30")
start = next(k for k, l in enumerate(lic) if l.startswith(glo["name"]))
end = next(k for k in range(start, len(lic)) if lic[k] == "")
lic[end + 1:end + 1] = block
(a.out / "LICENSES.txt").write_text("\n".join(lic) + "\n", encoding="utf-8")
print("manifest zoom", m["zoom"], "profiles", len(m["profiles"]), "built", built)
