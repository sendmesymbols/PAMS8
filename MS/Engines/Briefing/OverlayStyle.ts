/**
 * OverlayStyle.ts
 *
 * Colour and dash helpers shared by every overlay builder. Extracted from
 * OverlayFabric so `OverlayTable` can use them without the two modules
 * importing each other — OverlayFabric delegates table building to
 * OverlayTable, so the dependency has to run one way only.
 *
 * OverlayFabric re-exports all three, so existing importers are unaffected.
 */

/** '#RGB' / '#RRGGBB' / 'rgb()' / 'rgba()' → hex + alpha. Null when unusable. */
export function parseColor(c: any): { hex: string; alpha: number } | null {
  if (!c || typeof c !== 'string') return null;
  const s = c.trim();
  if (!s) return null;
  if (s[0] === '#') {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex.split('').map((ch) => ch + ch).join('');
    if (hex.length < 6) return null;
    return { hex: `#${hex.slice(0, 6).toUpperCase()}`, alpha: 1 };
  }
  const m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (!m) return null;
  const to2 = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();
  const alpha = m[4] != null ? Math.max(0, Math.min(1, parseFloat(m[4]))) : 1;
  return { hex: `#${to2(+m[1])}${to2(+m[2])}${to2(+m[3])}`, alpha };
}

/** '#RRGGBB' + alpha → 'rgba(r, g, b, a)' (fabric fill strings carry alpha inline). */
export function withAlpha(hex: string, alpha: number): string {
  const p = parseColor(hex);
  if (!p) return hex;
  const r = parseInt(p.hex.slice(1, 3), 16);
  const g = parseInt(p.hex.slice(3, 5), 16);
  const b = parseInt(p.hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

/**
 * Dash pattern → fabric stroke props, scaled by width so dashes stay legible
 * at any thickness. Solid explicitly resets both (style changes reuse this).
 */
export function dashProps(
  dash: 'dashed' | 'dotted' | undefined | null,
  strokeWidthPx: number,
): Record<string, any> {
  const w = Math.max(1, strokeWidthPx);
  if (dash === 'dashed') return { strokeDashArray: [w * 3, w * 2], strokeLineCap: 'butt' };
  if (dash === 'dotted') return { strokeDashArray: [1, w * 2], strokeLineCap: 'round' };
  return { strokeDashArray: null, strokeLineCap: 'butt' };
}

export function overlayUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
