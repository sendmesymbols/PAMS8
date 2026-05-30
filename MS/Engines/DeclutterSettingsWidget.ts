import {
  mountSettingsWidget,
  type SettingsWidgetHandle,
} from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { declutterSettingsManifest } from './DeclutterSettingsManifest';

export function openDeclutterSettings(opts: { anchor?: { x?: number; y?: number }; focusGroup?: string } = {}): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'declutter-settings',
    title: 'Declutter',
    icon: '🧹',
    manifest: declutterSettingsManifest,
    anchor: opts.anchor,
    focusGroup: opts.focusGroup,
    width: 360,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openDeclutterSettings = openDeclutterSettings;
}

CommandPalette.registerWidget({
  id: 'declutter',
  label: 'Declutter',
  category: 'Engines',
  icon: 'layers',
  hint: 'Clustering, label placement, disperse, ladder, density',
  keywords: ['cluster', 'label', 'maplex', 'overlap', 'disperse', 'ladder', 'halyard'],
  opener: () => openDeclutterSettings(),
});

export default openDeclutterSettings;
