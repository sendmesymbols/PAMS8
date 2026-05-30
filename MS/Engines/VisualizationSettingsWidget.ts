import {
  mountSettingsWidget,
  type SettingsWidgetHandle,
} from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { visualizationSettingsManifest } from './VisualizationSettingsManifest';

export function openVisualizationSettings(opts: { anchor?: { x?: number; y?: number }; focusGroup?: string } = {}): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'visualization-settings',
    title: 'Visualization',
    icon: '🎨',
    manifest: visualizationSettingsManifest,
    anchor: opts.anchor,
    focusGroup: opts.focusGroup,
    width: 360,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openVisualizationSettings = openVisualizationSettings;
}

CommandPalette.registerWidget({
  id: 'visualization',
  label: 'Visualization',
  category: 'Engines',
  icon: 'eye',
  hint: 'Render, layer effects, coverage rings, force grid, hull, extrude',
  keywords: ['render', 'effect', 'glow', 'extrude', 'hull', 'coverage', 'overlay'],
  opener: () => openVisualizationSettings(),
});

export default openVisualizationSettings;
