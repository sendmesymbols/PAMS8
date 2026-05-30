/**
 * MeasurementSettingsManifest.ts
 *
 * Single source of truth for the Measurement engine's user-facing settings.
 * Consumed by:
 *   - MeasurementSettingsWidget (renders rows)
 *   - CommandPalette (Ctrl+K index + inline edit)
 *
 * Paths mirror exactly what `SymbolEngine.onSettingChanged` already routes for
 * `measurement.*` — no engine code changes required.
 *
 * Pattern for follow-up engines: copy this file next to the engine, change the
 * paths/options, register with CommandPalette at startup.
 */
import type { SettingDescriptor } from '../Support/SettingsWidget';
export declare const measurementSettingsManifest: SettingDescriptor[];
