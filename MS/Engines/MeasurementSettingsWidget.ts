/**
 * MeasurementSettingsWidget.ts
 *
 * Thin shell over `mountSettingsWidget` — the manifest does all the heavy
 * lifting. Open this widget via:
 *   - the ⚙ gear next to the Measure topbar button
 *   - Ctrl+K → type "measurement" → Enter on the widget action
 *   - `window.openMeasurementSettings()` from anywhere
 */

import {
  mountSettingsWidget,
  type SettingsWidgetHandle,
} from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { measurementSettingsManifest } from './MeasurementSettingsManifest';

export interface OpenMeasurementSettingsOpts {
  /** Anchor near this screen position (e.g. just below the gear icon). */
  anchor?: { x?: number; y?: number };
  /** Scroll a particular group ("Units", "Display", "Advanced", "Styling") into view. */
  focusGroup?: string;
}

export function openMeasurementSettings(
  opts: OpenMeasurementSettingsOpts = {},
): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'measurement-settings',
    title: 'Measurement',
    icon: '📐',
    manifest: measurementSettingsManifest,
    anchor: opts.anchor,
    focusGroup: opts.focusGroup,
  });
}

// Expose to the inline scripts in index.html (gear-button click handler).
if (typeof window !== 'undefined') {
  (window as any).openMeasurementSettings = openMeasurementSettings;
}

// Self-register with the universal surfaces — Ctrl+K palette + ⚙ Settings menu.
CommandPalette.registerWidget({
  id: 'measurement',
  label: 'Measurement',
  category: 'Engines',
  icon: 'ruler-simple',
  hint: 'Distance units, bearing format, magnetic declination…',
  keywords: ['ruler', 'distance', 'area', 'bearing', 'magnetic'],
  opener: () => openMeasurementSettings(),
});

export default openMeasurementSettings;
