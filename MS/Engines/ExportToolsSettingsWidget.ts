import {
  mountSettingsWidget,
  type SettingsWidgetHandle,
} from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { exportToolsSettingsManifest } from './ExportToolsSettingsManifest';

export function openExportToolsSettings(opts: { anchor?: { x?: number; y?: number }; focusGroup?: string } = {}): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'export-tools-settings',
    title: 'PPTX Export',
    icon: '⬒',
    manifest: exportToolsSettingsManifest,
    anchor: opts.anchor,
    focusGroup: opts.focusGroup,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openExportToolsSettings = openExportToolsSettings;
}

CommandPalette.registerWidget({
  id: 'export-tools',
  label: 'PPTX Export',
  category: 'Tools',
  icon: '⬒',
  hint: 'PowerPoint deck export — flat screenshots or editable shapes',
  keywords: ['pptx', 'powerpoint', 'export', 'deck', 'editable', 'mode'],
  opener: () => openExportToolsSettings(),
});

export default openExportToolsSettings;
