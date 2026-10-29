import {
  mountSettingsWidget,
  type SettingsWidgetHandle,
} from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { placementSettingsManifest } from './PlacementSettingsManifest';

export function openPlacementSettings(opts: { anchor?: { x?: number; y?: number } } = {}): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'placement-settings',
    title: 'Placement',
    icon: '⛰',
    manifest: placementSettingsManifest,
    anchor: opts.anchor,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openPlacementSettings = openPlacementSettings;
}

CommandPalette.registerWidget({
  id: 'placement',
  label: 'Placement',
  category: 'Engines',
  icon: 'layers',
  hint: 'Terrain advice while drawing — mode, bundle, thresholds',
  keywords: ['terrain', 'deployable', 'no-go', 'water', 'marsh', 'placement'],
  opener: () => openPlacementSettings(),
});

export default openPlacementSettings;
