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
/** Walk `window.symbolEngine.settings` along `path` and return the leaf. */
export declare function getSetting<T = unknown>(path: SettingPath): T | undefined;
/**
 * Dispatch a `settingsChanged` CustomEvent identical to the one fired by the
 * inline handlers in index.html. SymbolEngine.onSettingChanged consumes it and
 * routes the value to the relevant sub-engine.
 */
export declare function setSetting(path: SettingPath, value: unknown): void;
/** Subscribe to settings changes. Returns an unsubscribe function. */
export declare function onSettingsChanged(cb: (detail: SettingsChangedDetail) => void): () => void;
/** `"#ef9f27"` -> `[239, 159, 39]`. Returns `[0,0,0]` on malformed input. */
export declare function hexToRgb(hex: string): [number, number, number];
/** `[239, 159, 39]` -> `"#ef9f27"`. Clamps + pads. */
export declare function rgbToHex(r: number, g: number, b: number): string;
/** Accepts an RGB tuple or hex string and normalises to a hex color the
 *  `<input type="color">` element accepts. Returns `"#000000"` on bad input. */
export declare function toHexColor(value: unknown): string;
