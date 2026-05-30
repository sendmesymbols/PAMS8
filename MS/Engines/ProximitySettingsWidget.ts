import {
  mountSettingsWidget,
  type SettingsWidgetHandle,
} from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { proximitySettingsManifest } from './ProximitySettingsManifest';

export function openProximitySettings(opts: { anchor?: { x?: number; y?: number } } = {}): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'proximity-settings',
    title: 'Proximity',
    icon: '➕',
    manifest: proximitySettingsManifest,
    anchor: opts.anchor,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openProximitySettings = openProximitySettings;
}

CommandPalette.registerWidget({
  id: 'proximity',
  label: 'Proximity',
  category: 'Engines',
  icon: 'crosshair',
  hint: 'Snap indicators while drawing — radius, line, marker, label',
  keywords: ['snap', 'distance', 'nearby', 'indicator'],
  opener: () => openProximitySettings(),
});

export default openProximitySettings;
