/**
 * AppearanceSettingsWidget.ts — thin shell, all heavy lifting is in the manifest.
 */
import { type SettingsWidgetHandle } from '../Support/SettingsWidget';
export declare function openAppearanceSettings(opts?: {
    anchor?: {
        x?: number;
        y?: number;
    };
}): SettingsWidgetHandle;
export default openAppearanceSettings;
