#!/usr/bin/env bash
# ZMAX 13 bundle, whole chain (first used 2026-11-20): scripts/run_z13.sh (skips every step with a .done stamp, so it
# also resumes a stopped run) -> scripts/assemble_z13.py -> validate (format + dist checks: the gate) -> swap into
# MS/Data/terrain-bundle (the old bundle moved to work/backup/terrain-bundle-before-<time>) -> golden points (report only,
# on the live bundle, after the swap: it reads every tile again, ~1.5 h). No shutdown.
# Needs: the GEM-15 download complete (scripts/fetch_gem15.py), Docker Desktop with the GDAL container, and the app's
# dev server closed at the swap (an open handle in either bundle folder makes the rename fail; the old bundle is put back).
#   bash scripts/resume_z13.sh          (log: work/finish_z13.log; step logs: work/z13/logs)
cd "$(dirname "$0")/.."   # the pipeline dir
PY=.venv/Scripts/python.exe
LOG=work/finish_z13.log
exec >>"$LOG" 2>&1
LIVE=../../MS/Data/terrain-bundle
OUT=out/terrain-bundle-z13
BACKUP=work/backup/terrain-bundle-before-$(date +%Y%m%d-%H%M%S)
say() { echo "[$(date '+%F %T')] $*"; }
finish() { say "RESULT: $1"; exit 0; }

say "== resume_z13"
# keep the machine from idle-sleeping while this runs (a hidden PowerShell, up to 24 h)
powershell -NoProfile -Command "Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-Command','Add-Type -Namespace W -Name K -MemberDefinition ''[System.Runtime.InteropServices.DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f);''; [W.K]::SetThreadExecutionState(2147483649) | Out-Null; Start-Sleep -Seconds 86400'"
docker start GDAL >/dev/null 2>&1 || say "WARNING: docker start GDAL failed (start Docker Desktop)"

say "build z13"
if ! W=work/z13 OUT=$OUT bash scripts/run_z13.sh; then
  finish "z13 build FAILED - see work/z13/logs; live bundle untouched"
fi
say "assemble"
$PY -I scripts/assemble_z13.py --out $OUT --grid work/z13/grid/grid.json --rules-json work/z13/profiles/rules.json \
  || finish "assemble FAILED - live bundle untouched; tiles are in $OUT"
say "validate (format + dist; gate)"
if ! $PY scripts/validate.py --bundle $OUT --no-golden > work/z13/logs/validate.log 2>&1; then
  tail -20 work/z13/logs/validate.log
  finish "validation FAILED - live bundle untouched; new bundle left in $OUT"
fi
grep -E "png format|validation" work/z13/logs/validate.log

say "swap"
mkdir -p work/backup
[ -e "$BACKUP" ] && finish "backup folder $BACKUP exists - live untouched; new bundle in $OUT"
if ! mv "$LIVE" "$BACKUP"; then
  finish "could not move the live bundle aside (files in use? close the dev server) - live untouched; new bundle in $OUT"
fi
if ! mv "$OUT" "$LIVE"; then
  mv "$BACKUP" "$LIVE"
  finish "could not move the new bundle in (files in use?) - old bundle restored; new bundle in $OUT"
fi
say "live bundle is now z13; the old one kept at $BACKUP"
$PY -I - <<'PYEOF'
from pathlib import Path
p = Path("sources.lock"); s = p.read_text(encoding="utf-8")
s = s.replace("  - id: gem15\n    stage: candidate\n", "  - id: gem15\n    stage: used        # built into the bundle at ZMAX 13 (grid.py --gem15, over glo30)\n", 1)
p.write_text(s, encoding="utf-8")
PYEOF
say "golden points (report only, on the live bundle)"
$PY scripts/validate.py --bundle "$LIVE" --golden golden_points.yaml --sample 50 > work/z13/logs/validate_golden.log 2>&1
grep -E "golden|validation" work/z13/logs/validate_golden.log | grep -v " -> OK" | tail -15
finish "SUCCESS - z13 bundle live"
