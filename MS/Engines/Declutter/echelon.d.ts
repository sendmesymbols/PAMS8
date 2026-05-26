import Graphic from "@arcgis/core/Graphic";
/**
 * Echelon parsing shared across the declutter subsystem.
 *
 * Mirrors the canonical 30-char 2525D layout used in MS/SIDC/SIDC.ts:
 *   - symbolSet "03" or "10"  → echelon at positions 10-12
 *   - any other symbolSet     → positions 6-8
 *
 * Falls back to drawEssentials.ECHELON, milsymbol metadata.echelon, and
 * the legacy 15-char 2525C single-char echelon at position 11.
 *
 * Returns "00" for unknown — callers should treat this as "always visible".
 */
export declare function getEchelonCode(g: Graphic): string;
/** Standard identity character (single char) from 30-char or 15-char SIDC. */
export declare function getIdentityCode(g: Graphic): string;
