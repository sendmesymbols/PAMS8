/**
 * AppearanceSettingsWidget.ts — thin shell, all heavy lifting is in the manifest.
 */

import {
  mountSettingsWidget,
  type SettingsWidgetHandle,
} from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { appearanceSettingsManifest } from './AppearanceSettingsManifest';

export function openAppearanceSettings(opts: { anchor?: { x?: number; y?: number } } = {}): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'appearance-settings',
    title: 'Appearance',
    icon: '🎨',
    manifest: appearanceSettingsManifest,
    anchor: opts.anchor,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openAppearanceSettings = openAppearanceSettings;
}

CommandPalette.registerWidget({
  id: 'appearance',
  label: 'Appearance',
  category: 'Appearance',
  icon: 'sliders',
  hint: 'Symbol sizes, UI theme, creation mode',
  keywords: ['size', 'theme', 'dark', 'creation', 'color'],
  opener: () => openAppearanceSettings(),
});

export default openAppearanceSettings;
