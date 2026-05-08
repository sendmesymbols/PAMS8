# Plan DrawEss Schema Fix - Bugfix Design

## Overview

The Save Plan function exports drawEss JSON that doesn't match the legacy schema format expected by the system. The bug manifests across all geometry types (Point, Area, Line, FPoint) where the exported plan contains structural and type mismatches that prevent proper interoperability with legacy systems. The fix will ensure that the `normalizeDrawEssForLegacyExport` function in `Plan.ts` properly transforms all drawEss fields to match the exact legacy schema structure and type expectations.

The fix approach is to enhance the `normalizeDrawEssForLegacyExport` method to include all missing default values and perform proper type conversions (number to string) for specific fields based on geometry type. This is a targeted fix that modifies only the export normalization logic without affecting runtime behavior or import functionality.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug - when exporting a plan, the drawEss JSON structure doesn't match legacy schema expectations
- **Property (P)**: The desired behavior when exporting plans - drawEss should conform exactly to legacy schema with all required fields and correct types
- **Preservation**: Existing import/export behavior for valid fields, runtime drawEss handling, and all non-export functionality must remain unchanged
- **normalizeDrawEssForLegacyExport**: The function in `MS/Engines/ImportExport/Plan.ts` that transforms drawEss objects for export to legacy format
- **normalizeDrawEssForRuntime**: The function in `MS/Engines/ImportExport/Plan.ts` that transforms imported drawEss objects for runtime use
- **drawEss**: The drawing essentials object that contains all symbol rendering and metadata information
- **SYM_GEO_TYPE**: The property that determines the geometry type (Point, Line, Area, FPoint)
- **Legacy Schema**: The expected JSON structure format used by legacy PAMS systems and consumers

## Bug Details

### Bug Condition

The bug manifests when the `savePlanToFile` method in `ImportExportEngine.ts` calls `Plan.normalizeDrawEssForLegacyExport` to prepare drawEss objects for export. The normalization function is incomplete and fails to include required default values and perform necessary type conversions, resulting in exported JSON that doesn't match the legacy schema.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { operation: string, drawEss: object, geoType: string }
  OUTPUT: boolean
  
  RETURN input.operation == 'export'
         AND (
           (input.geoType == 'Point' AND (drawEss.OFFSET is undefined OR typeof drawEss.labelOptions.textSize == 'number'))
           OR (input.geoType == 'Area' AND (drawEss.drawExtendType is undefined OR typeof drawEss.HEAD_RATIO == 'number'))
           OR (input.geoType == 'Line' AND drawEss.drawExtendType is undefined)
           OR (input.geoType == 'FPoint' AND (drawEss.OPTIONS.labelOptions == 0 OR typeof drawEss.OPTIONS.size == 'number'))
           OR (drawEss.FLAP_ANGLE is undefined OR drawEss.BK_LN_DIST_RATIO is undefined)
         )
END FUNCTION
```

### Examples

**Example 1: Point geometry missing OFFSET**
- Input: Point symbol with `SYM_GEO_TYPE: "Point"` but no OFFSET field
- Expected: drawEss should include `"OFFSET": "0"`
- Actual: OFFSET field is omitted from exported JSON

**Example 2: Point geometry with numeric labelOptions**
- Input: Point symbol with `labelOptions: { textSize: 15, haloColorSize: 2 }`
- Expected: drawEss should include `labelOptions: { textSize: "15", haloColorSize: "2" }`
- Actual: textSize and haloColorSize are exported as numbers

**Example 3: Area geometry missing drawExtendType**
- Input: Area symbol with `SYM_GEO_TYPE: "Area"` but no drawExtendType field
- Expected: drawEss should include `"drawExtendType": 1`
- Actual: drawExtendType field is omitted from exported JSON

**Example 4: Area geometry with numeric HEAD_RATIO**
- Input: Area symbol with `HEAD_RATIO: 0.2, TAIL_FACTOR: 0.15`
- Expected: drawEss should include `"HEAD_RATIO": "0.2", "TAIL_FACTOR": "0.15"`
- Actual: HEAD_RATIO and TAIL_FACTOR are exported as numbers

**Example 5: Area geometry missing AMPLIFIER fields**
- Input: Area symbol with AMPLIFIER object but DTG, DTGTO, ph are undefined
- Expected: drawEss should include `AMPLIFIER: { DTG: "", DTGTO: "", ph: "", ... }`
- Actual: DTG, DTGTO, ph fields are omitted from AMPLIFIER

**Example 6: FPoint geometry with labelOptions as 0**
- Input: FPoint symbol with `OPTIONS: { labelOptions: 0 }`
- Expected: drawEss should include `OPTIONS: { labelOptions: { haloColor: [255,0,0], ... } }`
- Actual: labelOptions is exported as 0

**Example 7: FPoint geometry missing OPTIONS fields**
- Input: FPoint symbol with OPTIONS object but msn, ph, roa are undefined
- Expected: drawEss should include `OPTIONS: { msn: "", ph: "", roa: "", ... }`
- Actual: msn, ph, roa fields are omitted from OPTIONS

**Example 8: FPoint geometry with numeric size**
- Input: FPoint symbol with `OPTIONS: { size: 25 }`
- Expected: drawEss should include `OPTIONS: { size: "25" }`
- Actual: size is exported as number 25

**Example 9: Missing default drawing fields**
- Input: Any symbol without FLAP_ANGLE, BK_LN_DIST_RATIO, etc.
- Expected: drawEss should include all default values (FLAP_ANGLE: 45, BK_LN_DIST_RATIO: 5, etc.)
- Actual: These fields are omitted if not present in the original drawEss

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Import functionality must continue to work exactly as before - `normalizeDrawEssForRuntime` should not be modified
- Runtime drawEss handling must remain unchanged - symbols should render and behave identically
- Existing field values must be preserved - if a symbol has OFFSET: "5", it should remain "5" not be overwritten with "0"
- Control points (CTRL_PTS) and geometry (GEOM) serialization must remain unchanged
- extraSettings handling must remain unchanged
- All non-export operations (symbol creation, editing, rendering) must remain unchanged

**Scope:**
All inputs that do NOT involve the export operation should be completely unaffected by this fix. This includes:
- Symbol creation and editing in the UI
- Symbol rendering on the map
- Import operations (loadPlanFromFile)
- Template operations
- GeoJSON export/import
- Individual symbol save/load operations

## Hypothesized Root Cause

Based on the bug description and code analysis, the most likely issues are:

1. **Incomplete Field Initialization**: The `normalizeDrawEssForLegacyExport` function doesn't initialize all required fields with default values. It only sets some defaults (FLAP_ANGLE, BK_LN_DIST_RATIO, etc.) but misses geometry-specific fields like OFFSET, drawExtendType, and AMPLIFIER sub-fields.

2. **Missing Type Conversions**: The function doesn't convert numeric values to strings for fields that legacy systems expect as strings. Specifically:
   - Point labelOptions: textSize and haloColorSize should be strings
   - Area geometry: HEAD_RATIO and TAIL_FACTOR should be strings
   - FPoint OPTIONS: size should be a string

3. **Incomplete Geometry-Specific Logic**: The function has some geometry-specific logic (for FPoint and Area) but it's incomplete:
   - Point geometry: Missing OFFSET field initialization
   - Line geometry: Missing drawExtendType field initialization
   - Area geometry: Missing DTG, DTGTO, ph fields in AMPLIFIER
   - FPoint geometry: Missing msn, ph, roa fields in OPTIONS, and doesn't handle labelOptions: 0 case

4. **Inconsistent Default Handling**: The function applies some defaults unconditionally but doesn't apply others. The legacy schema expects certain fields to always be present with default values, but the current implementation only adds them if they're undefined at the top level, not within nested objects like OPTIONS or AMPLIFIER.

## Correctness Properties

Property 1: Bug Condition - Export Schema Conformance

_For any_ drawEss object being exported where the bug condition holds (missing required fields or incorrect types), the fixed normalizeDrawEssForLegacyExport function SHALL produce a drawEss object that conforms exactly to the legacy schema with all required fields present and all types correct (strings where expected, objects where expected, default values where expected).

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10**

Property 2: Preservation - Non-Export Behavior

_For any_ operation that is NOT an export operation (symbol creation, editing, rendering, import, template operations), the fixed code SHALL produce exactly the same behavior as the original code, preserving all existing functionality for non-export interactions.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `MS/Engines/ImportExport/Plan.ts`

**Function**: `normalizeDrawEssForLegacyExport`

**Specific Changes**:

1. **Add Point Geometry Field Initialization**:
   - Add OFFSET field with default value "0" if undefined
   - Add ISFHAND field with default value 0 if undefined
   - Add FRHNDSZ field with default value 0 if undefined
   - Add FRHNDWDTH field with default value 0 if undefined
   - Convert labelOptions.textSize to string if it's a number
   - Convert labelOptions.haloColorSize to string if it's a number

2. **Add Line Geometry Field Initialization**:
   - Add DRAW_TYPE field with default value 1 if undefined
   - Add drawExtendType field with default value 1 if undefined
   - Add ISFHAND field with default value 0 if undefined
   - Add FRHNDSZ field with default value 0 if undefined
   - Add FRHNDWDTH field with default value 0 if undefined

3. **Enhance Area Geometry Handling**:
   - Add DRAW_TYPE field with default value 1 if undefined
   - Add FACE_GAP field with default value 5 if undefined
   - Add drawExtendType field with default value 1 if undefined
   - Convert HEAD_RATIO to string if it's a number
   - Convert TAIL_FACTOR to string if it's a number
   - Add DTG field to AMPLIFIER with default value "" if undefined
   - Add DTGTO field to AMPLIFIER with default value "" if undefined
   - Add ph field to AMPLIFIER with default value "" if undefined

4. **Enhance FPoint Geometry Handling**:
   - Ensure OPTIONS.labelOptions is always an object, never 0 or other primitive
   - If OPTIONS.labelOptions is 0 or not an object, replace with LEGACY_LABEL_OPTIONS_DEFAULT
   - Add msn field to OPTIONS with default value "" if undefined
   - Add ph field to OPTIONS with default value "" if undefined
   - Add roa field to OPTIONS with default value "" if undefined
   - Convert OPTIONS.size to string if it's a number

5. **Ensure All Default Drawing Fields Are Present**:
   - These are already handled but verify they're applied: FLAP_ANGLE, BK_LN_DIST_RATIO, BK_LN_ANGL_RATIO, FRNT_LN_ANGL_RATIO, FRNT_LN_DIST_RATIO, FLAP_DIST_RATIO

**Implementation Approach**:
- Add geometry-specific conditional blocks after the existing default field initialization
- Use the existing `_toStringNumber` helper for type conversions
- Ensure all changes are within `normalizeDrawEssForLegacyExport` only
- Do NOT modify `normalizeDrawEssForRuntime` to preserve import behavior

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code by comparing exported plans with legacy schema expectations, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that export symbols of each geometry type and assert that the exported drawEss JSON matches the legacy schema structure. Run these tests on the UNFIXED code to observe failures and understand the root cause.

**Test Cases**:
1. **Point Export Test**: Export a Point symbol and verify OFFSET field is present (will fail on unfixed code)
2. **Point LabelOptions Type Test**: Export a Point symbol with numeric labelOptions and verify they're strings (will fail on unfixed code)
3. **Area Export Test**: Export an Area symbol and verify drawExtendType field is present (will fail on unfixed code)
4. **Area Type Conversion Test**: Export an Area symbol and verify HEAD_RATIO and TAIL_FACTOR are strings (will fail on unfixed code)
5. **Area AMPLIFIER Test**: Export an Area symbol and verify DTG, DTGTO, ph fields are present in AMPLIFIER (will fail on unfixed code)
6. **Line Export Test**: Export a Line symbol and verify drawExtendType field is present (will fail on unfixed code)
7. **FPoint LabelOptions Test**: Export an FPoint symbol with labelOptions: 0 and verify it's an object (will fail on unfixed code)
8. **FPoint OPTIONS Test**: Export an FPoint symbol and verify msn, ph, roa fields are present in OPTIONS (will fail on unfixed code)
9. **FPoint Size Type Test**: Export an FPoint symbol and verify OPTIONS.size is a string (will fail on unfixed code)
10. **Default Fields Test**: Export any symbol and verify all default drawing fields are present (may fail on unfixed code)

**Expected Counterexamples**:
- Exported drawEss objects missing required fields (OFFSET, drawExtendType, DTG, etc.)
- Exported drawEss objects with incorrect types (numbers instead of strings)
- Exported drawEss objects with invalid nested structures (labelOptions: 0)
- Possible causes: incomplete field initialization, missing type conversions, incomplete geometry-specific logic

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL drawEss WHERE isBugCondition({ operation: 'export', drawEss, geoType }) DO
  result := normalizeDrawEssForLegacyExport_fixed(drawEss)
  ASSERT conformsToLegacySchema(result, geoType)
  ASSERT allRequiredFieldsPresent(result, geoType)
  ASSERT allTypesCorrect(result, geoType)
END FOR
```

**Test Plan**: After implementing the fix, run the same test cases from exploratory checking and verify they all pass. Additionally, test with real-world symbol data from the sample.json file.

**Test Cases**:
1. **Point Geometry Conformance**: Export Point symbols and verify complete schema conformance
2. **Area Geometry Conformance**: Export Area symbols and verify complete schema conformance
3. **Line Geometry Conformance**: Export Line symbols and verify complete schema conformance
4. **FPoint Geometry Conformance**: Export FPoint symbols and verify complete schema conformance
5. **Mixed Geometry Plan**: Export a plan with all geometry types and verify all conform to schema
6. **Edge Cases**: Export symbols with partial data, empty fields, and verify proper defaults

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL operation WHERE operation != 'export' DO
  ASSERT behavior_original(operation) = behavior_fixed(operation)
END FOR

FOR ALL drawEss WHERE hasExistingValidValues(drawEss) DO
  result := normalizeDrawEssForLegacyExport_fixed(drawEss)
  ASSERT preservesExistingValues(result, drawEss)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for non-export operations and existing valid values, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Import Preservation**: Verify importing plans continues to work correctly with normalizeDrawEssForRuntime unchanged
2. **Runtime Preservation**: Verify symbols render correctly after import (runtime drawEss handling unchanged)
3. **Existing Values Preservation**: Verify that symbols with existing OFFSET, drawExtendType, etc. values preserve those values (not overwritten with defaults)
4. **CTRL_PTS Preservation**: Verify control points serialization remains unchanged
5. **GEOM Preservation**: Verify geometry serialization remains unchanged
6. **extraSettings Preservation**: Verify extraSettings handling remains unchanged
7. **Template Operations Preservation**: Verify template save/load operations continue to work
8. **GeoJSON Operations Preservation**: Verify GeoJSON export/import operations continue to work
9. **Symbol Creation Preservation**: Verify creating new symbols in UI works correctly
10. **Symbol Editing Preservation**: Verify editing symbols in UI works correctly

### Unit Tests

- Test normalizeDrawEssForLegacyExport with Point geometry symbols (with and without existing values)
- Test normalizeDrawEssForLegacyExport with Area geometry symbols (with and without existing values)
- Test normalizeDrawEssForLegacyExport with Line geometry symbols (with and without existing values)
- Test normalizeDrawEssForLegacyExport with FPoint geometry symbols (with and without existing values)
- Test type conversion helpers (_toStringNumber) with various inputs
- Test edge cases (undefined, null, empty objects, invalid types)

### Property-Based Tests

- Generate random drawEss objects for each geometry type and verify export conformance
- Generate random drawEss objects with existing valid values and verify preservation
- Generate random plans with mixed geometry types and verify complete export/import round-trip
- Test that all exported plans can be successfully imported and rendered

### Integration Tests

- Test full export flow: create symbols → export plan → verify JSON structure
- Test full import flow: load legacy plan → verify symbols render correctly
- Test round-trip: export plan → import plan → verify symbols match original
- Test with real legacy sample.json file: import → export → compare structure
- Test with new exported plan: verify it matches legacy schema format
