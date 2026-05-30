/**
 * MeasurementSettingsWidget.ts
 *
 * Thin shell over `mountSettingsWidget` — the manifest does all the heavy
 * lifting. Open this widget via:
 *   - the ⚙ gear next to the Measure topbar button
 *   - Ctrl+K → type "measurement" → Enter on the widget action
 *   - `window.openMeasurementSettings()` from anywhere
 */
import { type SettingsWidgetHandle } from '../Support/SettingsWidget';
export interface OpenMeasurementSettingsOpts {
    /** Anchor near this screen position (e.g. just below the gear icon). */
    anchor?: {
        x?: number;
        y?: number;
    };
    /** Scroll a particular group ("Units", "Display", "Advanced", "Styling") into view. */
    focusGroup?: string;
}
export declare function openMeasurementSettings(opts?: OpenMeasurementSettingsOpts): SettingsWidgetHandle;
export default openMeasurementSettings;
