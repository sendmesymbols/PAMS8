import { mountSettingsWidget, type SettingsWidgetHandle } from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { crossSectionSettingsManifest } from './CrossSectionSettingsManifest';

export function openCrossSectionSettings(opts: { anchor?: { x?: number; y?: number } } = {}): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'cross-section-settings',
    title: 'X-Section',
    icon: '📈',
    manifest: crossSectionSettingsManifest,
    anchor: opts.anchor,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openCrossSectionSettings = openCrossSectionSettings;
}

CommandPalette.registerWidget({
  id: 'crossSection',
  label: 'X-Section',
  category: 'Engines',
  icon: 'layers',
  hint: 'Terrain cross-section of a line: height, going, obstacles, distance markers, no-data gaps',
  keywords: ['x-section', 'cross section', 'profile', 'elevation profile', 'obstacles', 'crossSection'],
  opener: () => openCrossSectionSettings(),
});

export default openCrossSectionSettings;
