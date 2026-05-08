# Implementation Plan

- [ ] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Export Schema Conformance
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: For deterministic bugs, scope the property to the concrete failing case(s) to ensure reproducibility
  - Test that for any drawEss object being exported where the bug condition holds (missing required fields or incorrect types), the exported drawEss should conform exactly to the legacy schema
  - Test Point geometry: OFFSET field should be present with default "0", labelOptions.textSize and haloColorSize should be strings
  - Test Area geometry: drawExtendType should be present with default 1, HEAD_RATIO and TAIL_FACTOR should be strings, AMPLIFIER should include DTG, DTGTO, ph with empty string defaults
  - Test Line geometry: drawExtendType should be present with default 1
  - Test FPoint geometry: OPTIONS.labelOptions should be an object (never 0), OPTIONS should include msn, ph, roa with empty string defaults, OPTIONS.size should be a string
  - Test all geometry types: all default drawing fields should be present (FLAP_ANGLE, BK_LN_DIST_RATIO, etc.)
  - The test assertions should match the Expected Behavior Properties from design (Requirements 2.1-2.10)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found to understand root cause (e.g., "Point export missing OFFSET field", "Area HEAD_RATIO exported as number instead of string")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Export Behavior
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy inputs (operations that are NOT export, or drawEss objects with existing valid values)
  - Write property-based tests capturing observed behavior patterns from Preservation Requirements
  - Test that import functionality continues to work exactly as before (normalizeDrawEssForRuntime unchanged)
  - Test that runtime drawEss handling remains unchanged (symbols render and behave identically)
  - Test that existing field values are preserved (if OFFSET: "5", it should remain "5" not be overwritten with "0")
  - Test that control points (CTRL_PTS) and geometry (GEOM) serialization remain unchanged
  - Test that extraSettings handling remains unchanged
  - Test that all non-export operations (symbol creation, editing, rendering) remain unchanged
  - Property-based testing generates many test cases for stronger guarantees
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_

- [ ] 3. Fix for Plan DrawEss Schema Export

  - [ ] 3.1 Implement the fix in normalizeDrawEssForLegacyExport
    - Enhance Point geometry handling: add OFFSET field with default "0", add ISFHAND/FRHNDSZ/FRHNDWDTH with defaults, convert labelOptions.textSize and haloColorSize to strings
    - Enhance Line geometry handling: add DRAW_TYPE with default 1, add drawExtendType with default 1, add ISFHAND/FRHNDSZ/FRHNDWDTH with defaults
    - Enhance Area geometry handling: add DRAW_TYPE with default 1, add FACE_GAP with default 5, add drawExtendType with default 1, convert HEAD_RATIO and TAIL_FACTOR to strings, add DTG/DTGTO/ph to AMPLIFIER with empty string defaults
    - Enhance FPoint geometry handling: ensure OPTIONS.labelOptions is always an object (replace 0 with LEGACY_LABEL_OPTIONS_DEFAULT), add msn/ph/roa to OPTIONS with empty string defaults, convert OPTIONS.size to string
    - Ensure all default drawing fields are present (FLAP_ANGLE, BK_LN_DIST_RATIO, BK_LN_ANGL_RATIO, FRNT_LN_ANGL_RATIO, FRNT_LN_DIST_RATIO, FLAP_DIST_RATIO)
    - Use existing _toStringNumber helper for type conversions
    - Add geometry-specific conditional blocks after existing default field initialization
    - Do NOT modify normalizeDrawEssForRuntime to preserve import behavior
    - _Bug_Condition: isBugCondition(input) where input.operation == 'export' AND (missing required fields OR incorrect types for Point/Area/Line/FPoint geometry)_
    - _Expected_Behavior: For any drawEss object being exported where the bug condition holds, the fixed normalizeDrawEssForLegacyExport function SHALL produce a drawEss object that conforms exactly to the legacy schema with all required fields present and all types correct_
    - _Preservation: For any operation that is NOT an export operation, the fixed code SHALL produce exactly the same behavior as the original code, preserving all existing functionality for non-export interactions_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_

  - [ ] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Export Schema Conformance
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - Verify all geometry types now export with correct schema conformance
    - Verify all required fields are present with correct types
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10_

  - [ ] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Export Behavior
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)
    - Verify import functionality continues to work correctly
    - Verify runtime drawEss handling remains unchanged
    - Verify existing field values are preserved
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_

- [ ] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
