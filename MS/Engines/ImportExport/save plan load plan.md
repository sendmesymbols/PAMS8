# Save Plan / Load Plan Notes

## Context
- File format target: legacy-compatible `drawEss` schema (reference: `d:\Projects\PAMS8\Features\sample.json`).
- Current system path:
  - Save Plan: `ImportExportEngine.savePlanToFile()`
  - Load Plan: `ImportExportEngine.loadPlanFromFile()`
  - Normalization utilities: `Plan.ts`

## Problem Summary
- Exported plan JSON was valid, but not consistently legacy-compatible in `drawEss`.
- Legacy consumer/loader expectations were stricter for:
  - Missing keys by `SYM_GEO_TYPE` (especially `Area`, `Point`, and nested `OPTIONS`/`AMPLIFIER` shapes).
  - Value type mismatches (`string` vs `number`) on specific fields.
  - Default drawing fields that may be absent in runtime state but are expected during load/use.
- Result: some plan files were not loading correctly or behaved inconsistently after load.

## Key Compatibility Issues Logged
- `Area` missing keys in some exports:
  - `DRAW_TYPE`, `FACE_GAP`, `drawExtendType`
- `Point` missing keys in some exports:
  - `ISFHAND`, `FRHNDSZ`, `FRHNDWDTH`, `OFFSET`
- `FPoint` nested optional legacy keys not always present:
  - `OPTIONS.msn`, `OPTIONS.ph`, `OPTIONS.roa`
- Legacy-priority type differences:
  - `Area.HEAD_RATIO` and `Area.TAIL_FACTOR` expected as strings in legacy export.
  - `Point.labelOptions.haloColorSize` and `Point.labelOptions.textSize` expected as strings in legacy export.
- Missing default drawing values in some states:
  - `FLAP_ANGLE`, `BK_LN_DIST_RATIO`, `BK_LN_ANGL_RATIO`, `FRNT_LN_ANGL_RATIO`, `FRNT_LN_DIST_RATIO`, `FLAP_DIST_RATIO`
  - `extraSettings`, `labelOptions`

## Fix Strategy (Import/Export Time Only)
- Keep runtime model classes unchanged (no forced schema edits in `DrawEssentials.ts`).
- Add normalization map in `Plan.ts`:
  - `normalizeDrawEssForLegacyExport(rawDrawEss)`
  - `normalizeDrawEssForRuntime(rawDrawEss)`
- Rule:
  - If a value exists, keep it (actual values take precedence).
  - If missing, inject legacy-safe defaults.
  - Coerce types only where legacy requires specific export representation.

## Implemented Changes
- `Plan.ts` now normalizes:
  - Common defaults when missing:
    - `FLAP_ANGLE = 45`
    - `BK_LN_DIST_RATIO = 5`
    - `BK_LN_ANGL_RATIO = 5`
    - `FRNT_LN_ANGL_RATIO = 0.8`
    - `FRNT_LN_DIST_RATIO = 1.5`
    - `FLAP_DIST_RATIO = 3`
    - `extraSettings = { lineWidth: 3, size: 20, textSize: 12, opacity: 1 }`
    - default `labelOptions`
  - `Area`:
    - Ensure `DRAW_TYPE`, `FACE_GAP`, `drawExtendType`
    - Export `HEAD_RATIO` / `TAIL_FACTOR` as strings (legacy)
    - Runtime parse these back to numbers
  - `Point`:
    - Ensure `ISFHAND`, `FRHNDSZ`, `FRHNDWDTH`, `OFFSET`
    - Export `labelOptions.haloColorSize` / `textSize` as strings (legacy)
    - Runtime parse back to numbers
  - `FPoint`:
    - Ensure `OPTIONS.msn`, `OPTIONS.ph`, `OPTIONS.roa`
    - Normalize `OPTIONS.size` to string on export
    - Ensure `OPTIONS.labelOptions` object exists
  - `AMPLIFIER` defaults:
    - Backfill legacy fields
    - Add `DTG`, `DTGTO`, `ph` for `Area` when missing
- `ImportExportEngine.ts` wiring:
  - Save path now calls `Plan.normalizeDrawEssForLegacyExport(...)`.
  - Load path now calls `Plan.normalizeDrawEssForRuntime(...)` before runtime object conversion.

## Operational Log
- Date: 2026-05-08
- Action: schema comparison performed against `sample.json` by `SYM_GEO_TYPE`.
- Action: compatibility gaps identified and documented.
- Action: normalization map implemented in `Plan.ts`.
- Action: save/load integration updated in `ImportExportEngine.ts`.
- Validation: diagnostics checked; no TypeScript errors in edited files.

## Expected Outcome
- Save Plan exports are closer to legacy schema and type behavior.
- Load Plan can consume both legacy-shaped and current-shaped `drawEss` more safely.
- Missing optional/default fields no longer cause fragile load behavior.

## Remaining Notes
- This normalization intentionally prioritizes compatibility over strict minimal output.
- If additional legacy fields appear in future sample files, extend only the normalization map (single source of compatibility rules).
