import {
  mountSettingsWidget,
  type SettingsWidgetHandle,
} from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { drawingCuesSettingsManifest } from './DrawingCuesSettingsManifest';

export function openDrawingCuesSettings(opts: { anchor?: { x?: number; y?: number }; focusGroup?: string } = {}): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'drawing-cues-settings',
    title: 'Drawing cues',
    icon: '✏',
    manifest: drawingCuesSettingsManifest,
    anchor: opts.anchor,
    focusGroup: opts.focusGroup,
    width: 360,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openDrawingCuesSettings = openDrawingCuesSettings;
}

CommandPalette.registerWidget({
  id: 'drawing-cues',
  label: 'Drawing cues',
  category: 'Engines',
  icon: 'pencil',
  hint: 'Rubber band, angular guides, distance rings, compass',
  keywords: ['rubber', 'angle', 'guide', 'protractor', 'ring', 'compass'],
  opener: () => openDrawingCuesSettings(),
});

export default openDrawingCuesSettings;
