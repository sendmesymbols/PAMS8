import {
  mountSettingsWidget,
  type SettingsWidgetHandle,
} from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { coreFeaturesSettingsManifest } from './CoreFeaturesSettingsManifest';

export function openCoreFeaturesSettings(opts: { anchor?: { x?: number; y?: number } } = {}): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'core-features-settings',
    title: 'Application features',
    icon: '🧰',
    manifest: coreFeaturesSettingsManifest,
    anchor: opts.anchor,
    width: 360,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openCoreFeaturesSettings = openCoreFeaturesSettings;
}

CommandPalette.registerWidget({
  id: 'core-features',
  label: 'Application features',
  category: 'Tools',
  icon: 'settings',
  hint: 'Context menu, editing, clipboard, save/load, logging…',
  keywords: ['app', 'features', 'context', 'edit', 'clipboard', 'logging'],
  opener: () => openCoreFeaturesSettings(),
});

export default openCoreFeaturesSettings;
