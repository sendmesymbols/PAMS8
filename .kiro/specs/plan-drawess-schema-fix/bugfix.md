# Bugfix Requirements Document

## Introduction

The Save Plan function exports drawEss JSON that doesn't match the legacy schema format expected by the system. When comparing the exported plan (new_pams8_plan_1778226673106.json) with the legacy sample (sample.json), there are structural and type mismatches in the drawEss field that prevent proper interoperability with legacy systems and consumers.

This bug affects all geometry types (Point, Area, Line, FPoint) and causes issues when legacy systems attempt to parse and render the exported plans. The fix must ensure that all exported plans conform exactly to the legacy schema structure and type expectations.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN exporting a Point geometry symbol THEN the system omits the OFFSET field from drawEss

1.2 WHEN exporting a Point geometry symbol with labelOptions THEN the system exports haloColorSize and textSize as numbers instead of strings

1.3 WHEN exporting an Area geometry symbol THEN the system omits the drawExtendType field from drawEss

1.4 WHEN exporting an Area geometry symbol THEN the system exports HEAD_RATIO and TAIL_FACTOR as numbers instead of strings

1.5 WHEN exporting an Area geometry symbol THEN the system omits DTG, DTGTO, and ph fields from AMPLIFIER when they are undefined

1.6 WHEN exporting a Line geometry symbol THEN the system omits the drawExtendType field from drawEss

1.7 WHEN exporting an FPoint geometry symbol with OPTIONS.labelOptions THEN the system allows labelOptions to be 0 instead of an object

1.8 WHEN exporting an FPoint geometry symbol THEN the system omits msn, ph, and roa fields from OPTIONS when they are undefined

1.9 WHEN exporting an FPoint geometry symbol THEN the system exports OPTIONS.size as a number instead of a string

1.10 WHEN exporting any geometry symbol THEN the system omits default values for drawing fields that legacy consumers expect (FLAP_ANGLE, BK_LN_DIST_RATIO, etc.)

### Expected Behavior (Correct)

2.1 WHEN exporting a Point geometry symbol THEN the system SHALL include OFFSET field with default value "0"

2.2 WHEN exporting a Point geometry symbol with labelOptions THEN the system SHALL export haloColorSize and textSize as strings

2.3 WHEN exporting an Area geometry symbol THEN the system SHALL include drawExtendType field with default value 1

2.4 WHEN exporting an Area geometry symbol THEN the system SHALL export HEAD_RATIO and TAIL_FACTOR as strings

2.5 WHEN exporting an Area geometry symbol THEN the system SHALL include DTG, DTGTO, and ph fields in AMPLIFIER with empty string defaults when undefined

2.6 WHEN exporting a Line geometry symbol THEN the system SHALL include drawExtendType field with default value 1

2.7 WHEN exporting an FPoint geometry symbol with OPTIONS.labelOptions THEN the system SHALL ensure labelOptions is always an object, never 0

2.8 WHEN exporting an FPoint geometry symbol THEN the system SHALL include msn, ph, and roa fields in OPTIONS with empty string defaults when undefined

2.9 WHEN exporting an FPoint geometry symbol THEN the system SHALL export OPTIONS.size as a string

2.10 WHEN exporting any geometry symbol THEN the system SHALL include all default values for drawing fields (FLAP_ANGLE, BK_LN_DIST_RATIO, FRNT_LN_ANGL_RATIO, FRNT_LN_DIST_RATIO, FLAP_DIST_RATIO, BK_LN_ANGL_RATIO)

### Unchanged Behavior (Regression Prevention)

3.1 WHEN exporting a symbol with existing OFFSET value THEN the system SHALL CONTINUE TO preserve the existing value

3.2 WHEN exporting a symbol with existing drawExtendType value THEN the system SHALL CONTINUE TO preserve the existing value

3.3 WHEN exporting a symbol with existing AMPLIFIER fields THEN the system SHALL CONTINUE TO preserve all existing field values

3.4 WHEN exporting a symbol with existing OPTIONS fields THEN the system SHALL CONTINUE TO preserve all existing field values

3.5 WHEN exporting a symbol with CTRL_PTS THEN the system SHALL CONTINUE TO serialize control points correctly

3.6 WHEN exporting a symbol with GEOM THEN the system SHALL CONTINUE TO serialize geometry points correctly

3.7 WHEN exporting a symbol with extraSettings THEN the system SHALL CONTINUE TO include default extraSettings (lineWidth, size, textSize, opacity)

3.8 WHEN importing a plan with legacy schema THEN the system SHALL CONTINUE TO parse and load symbols correctly

3.9 WHEN importing a plan with string-typed numeric fields THEN the system SHALL CONTINUE TO convert them to numbers for runtime use

3.10 WHEN exporting a symbol with UEI field THEN the system SHALL CONTINUE TO preserve the UEI value
