import {
  mountSettingsWidget,
  type SettingsWidgetHandle,
} from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { mgrsSettingsManifest } from './MGRSSettingsManifest';

export function openMGRSSettings(opts: { anchor?: { x?: number; y?: number }; focusGroup?: string } = {}): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'mgrs-settings',
    title: 'MGRS grid',
    icon: '⊞',
    manifest: mgrsSettingsManifest,
    anchor: opts.anchor,
    focusGroup: opts.focusGroup,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openMGRSSettings = openMGRSSettings;
}

CommandPalette.registerWidget({
  id: 'mgrs',
  label: 'MGRS grid',
  category: 'Map',
  icon: 'grid',
  hint: 'Military Grid Reference System overlay',
  keywords: ['mgrs', 'grid', 'utm', 'gzd', 'graticule'],
  opener: () => openMGRSSettings(),
});

export default openMGRSSettings;
