/**
 * SettingsWidget.ts
 *
 * Manifest-driven settings widget renderer. One `mountSettingsWidget()` call
 * produces a draggable `ms-panel` populated from a `SettingDescriptor[]`.
 *
 * Per-engine widget files are thin shells around this — see
 *   MS/Engines/MeasurementSettingsWidget.ts for the canonical example.
 *
 * Wiring conventions:
 *   - Widget reads + writes through SettingsBus (the same `settingsChanged`
 *     CustomEvent the legacy #settingsPanel drives). Engines need no changes.
 *   - Theme is CSS-var driven via ThemeManager. The widget tags itself
 *     `ms-theme-ops-dark` at creation; theme switches happen via :root vars and
 *     repaint automatically.
 *   - One widget instance per `id`. Re-opening focuses + raises the existing
 *     widget rather than stacking duplicates.
 *
 * Gear-icon convention (for follow-up widgets):
 *   Topbar buttons that own a feature get a small `.ms-gear-btn` adjacent to
 *   them. The main button toggles/activates the feature; the gear calls the
 *   feature's `openXxxSettings()` to mount this widget anchored just below.
 */
export type SettingType = 'boolean' | 'number' | 'enum' | 'color' | 'string' | 'action';
export interface SettingOption {
    value: string;
    label: string;
}
export interface SettingDescriptor {
    path: string[];
    label: string;
    group: string;
    type: SettingType;
    options?: SettingOption[];
    min?: number;
    max?: number;
    step?: number;
    /** Value persisted as `[r,g,b]` triple instead of `'#hex'` (e.g. measurement.lineColor). */
    colorAsRgb?: boolean;
    /** Display only — no live setting. Used for header help text. */
    hint?: string;
    help: string;
    keywords?: string[];
    /** For `type: 'action'` — button caption (defaults to `label`). */
    buttonLabel?: string;
    /** For `type: 'action'` — invoked when the button is clicked. */
    onClick?: () => void;
}
export interface MountWidgetOptions {
    /** DOM id for the panel. Doubles as instance-singleton key. */
    id: string;
    /** Header title (e.g. "Measurement"). */
    title: string;
    /** Header icon (short text or emoji, rendered in the icon badge). */
    icon: string;
    /** Settings to render. */
    manifest: SettingDescriptor[];
    /** Optional anchor — pixel coordinates near which to place the widget. */
    anchor?: {
        x?: number;
        y?: number;
    };
    /** Optional override for the default panel width (px). */
    width?: number;
    /** Optional preselected group to scroll into view on open. */
    focusGroup?: string;
}
export interface SettingsWidgetHandle {
    /** DOM id of the mounted panel. */
    id: string;
    /** Focus + raise the widget. */
    focus(): void;
    /** Scroll the named group into view. */
    scrollToGroup(group: string): void;
    /** Remove the widget. */
    close(): void;
}
export declare function mountSettingsWidget(opts: MountWidgetOptions): SettingsWidgetHandle;
/** Close all settings widgets currently mounted. */
export declare function closeAllSettingsWidgets(): void;
