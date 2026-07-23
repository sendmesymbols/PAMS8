import {
  mountSettingsWidget,
  type SettingsWidgetHandle,
} from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { screenAnchorSettingsManifest } from './ScreenAnchorSettingsManifest';

export function openScreenAnchorSettings(opts: { anchor?: { x?: number; y?: number }; focusGroup?: string } = {}): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'screen-anchor-settings',
    title: 'Pin to Screen',
    icon: '📌',
    manifest: screenAnchorSettingsManifest,
    anchor: opts.anchor,
    focusGroup: opts.focusGroup,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openScreenAnchorSettings = openScreenAnchorSettings;
}

CommandPalette.registerWidget({
  id: 'screen-anchor',
  label: 'Pin to Screen',
  category: 'Tools',
  icon: '📌',
  hint: 'Keep titles / legends / callouts fixed on screen while the map moves',
  keywords: ['pin', 'anchor', 'screen', 'fixed', 'legend', 'sticky', 'callout'],
  opener: () => openScreenAnchorSettings(),
});

export default openScreenAnchorSettings;
