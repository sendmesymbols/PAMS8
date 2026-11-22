import { mountSettingsWidget, type SettingsWidgetHandle } from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { groundAppreciationSettingsManifest } from './GroundAppreciationSettingsManifest';

export function openGroundAppreciationSettings(opts: { anchor?: { x?: number; y?: number } } = {}): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'ground-appreciation-settings',
    title: 'Aprc',
    icon: '📝',
    manifest: groundAppreciationSettingsManifest,
    anchor: opts.anchor,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openGroundAppreciationSettings = openGroundAppreciationSettings;
}

CommandPalette.registerWidget({
  id: 'ground-appreciation',
  label: 'Aprc (Appreciation)',
  category: 'Engines',
  icon: 'layers',
  hint: 'The appreciation of the situation drafted from the map: Gr and Weather, apchs, deductions; Word, PDF, slides',
  keywords: ['aprc', 'appreciation', 'ground appreciation', 'gr and weather', 'apchs', 'deductions', 'word', 'pdf', 'slides'],
  opener: () => openGroundAppreciationSettings(),
});

export default openGroundAppreciationSettings;
