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
export function getEchelonCode(g: Graphic): string {
  const attrs = g.attributes ?? {};
  const de = attrs.drawEssentials;

  if (de?.ECHELON !== undefined && de.ECHELON !== "") {
    return String(de.ECHELON).padStart(2, "0").slice(-2);
  }

  const meta = attrs.metadata ?? (g as any).symbol?.metadata;
  if (meta?.echelon !== undefined && meta.echelon !== "") {
    return String(meta.echelon).padStart(2, "0").slice(-2);
  }

  const sidc: string = de?.SIDC || attrs.sidc || attrs.SIDC || "";
  if (!sidc) return "00";

  if (sidc.length === 30) {
    const symbolSet = sidc.slice(2, 4);
    const code = symbolSet === "03" || symbolSet === "10"
      ? sidc.slice(10, 12)
      : sidc.slice(6, 8);
    return code || "00";
  }

  if (sidc.length === 15) {
    const code = sidc.charAt(11);
    return code && code !== "-" ? code : "00";
  }

  return "00";
}

/** Standard identity character (single char) from 30-char or 15-char SIDC. */
export function getIdentityCode(g: Graphic): string {
  const attrs = g.attributes ?? {};
  const de = attrs.drawEssentials;
  const sidc: string = de?.SIDC || attrs.sidc || attrs.SIDC || "";
  if (sidc.length >= 2) return sidc.charAt(1);
  return "";
}
