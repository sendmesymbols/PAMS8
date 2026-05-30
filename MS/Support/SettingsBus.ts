/**
 * SettingsBus.ts
 *
 * Tiny adapter over the existing `settingsChanged` CustomEvent bus used by the
 * legacy `#settingsPanel` in index.html. Lets per-engine settings widgets and
 * the Ctrl+K command palette read/write the same nested `window.symbolEngine.settings`
 * object the old panel already drives — without inventing a new pathway.
 *
 *   getSetting(['measurement', 'distUnit'])         -> current value
 *   setSetting(['measurement', 'distUnit'], 'km')   -> dispatches settingsChanged
 *   onSettingsChanged(cb)                           -> subscribe (cross-sync)
 *
 * Color helpers mirror the inline ones in index.html so widget code does not
 * have to redeclare them.
 */

export type SettingPath = readonly string[];

export interface SettingsChangedDetail {
  path: string[];
  value: unknown;
  fullPath: string;
}

const SETTINGS_EVENT = 'settingsChanged';

/** Walk `window.symbolEngine.settings` along `path` and return the leaf. */
export function getSetting<T = unknown>(path: SettingPath): T | undefined {
  const root = (window as any).symbolEngine?.settings;
  if (!root) return undefined;
  let cur: any = root;
  for (const seg of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur as T;
}

/**
 * Dispatch a `settingsChanged` CustomEvent identical to the one fired by the
 * inline handlers in index.html. SymbolEngine.onSettingChanged consumes it and
 * routes the value to the relevant sub-engine.
 */
export function setSetting(path: SettingPath, value: unknown): void {
  const detail: SettingsChangedDetail = {
    path: [...path],
    value,
    fullPath: path.join('.'),
  };
  window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail }));
}

/** Subscribe to settings changes. Returns an unsubscribe function. */
export function onSettingsChanged(
  cb: (detail: SettingsChangedDetail) => void,
): () => void {
  const handler = (e: Event) => {
    const ce = e as CustomEvent<SettingsChangedDetail>;
    if (ce?.detail) cb(ce.detail);
  };
  window.addEventListener(SETTINGS_EVENT, handler);
  return () => window.removeEventListener(SETTINGS_EVENT, handler);
}

/** `"#ef9f27"` -> `[239, 159, 39]`. Returns `[0,0,0]` on malformed input. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** `[239, 159, 39]` -> `"#ef9f27"`. Clamps + pads. */
export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    '#' +
    ((1 << 24) + (clamp(r) << 16) + (clamp(g) << 8) + clamp(b))
      .toString(16)
      .slice(1)
  );
}

/** Accepts an RGB tuple or hex string and normalises to a hex color the
 *  `<input type="color">` element accepts. Returns `"#000000"` on bad input. */
export function toHexColor(value: unknown): string {
  if (Array.isArray(value) && value.length >= 3) {
    return rgbToHex(Number(value[0]), Number(value[1]), Number(value[2]));
  }
  if (typeof value === 'string' && /^#?[a-f\d]{6}$/i.test(value)) {
    return value.startsWith('#') ? value : '#' + value;
  }
  return '#000000';
}
