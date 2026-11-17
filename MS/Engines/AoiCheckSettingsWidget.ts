import { mountSettingsWidget, type SettingsWidgetHandle } from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { aoiCheckSettingsManifest } from './AoiCheckSettingsManifest';

export function openAoiCheckSettings(opts: { anchor?: { x?: number; y?: number } } = {}): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'aoi-check-settings',
    title: 'AOI Check',
    icon: '🗺',
    manifest: aoiCheckSettingsManifest,
    anchor: opts.anchor,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openAoiCheckSettings = openAoiCheckSettings;
}

CommandPalette.registerWidget({
  id: 'aoiCheck',
  label: 'AOI Check',
  category: 'Engines',
  icon: 'layers',
  hint: 'Terrain data cover over an area: missing tiles, layers, movers, build date, sources and licences',
  keywords: ['aoi check', 'preflight', 'coverage', 'missing tiles', 'terrain data', 'licence', 'aoiCheck'],
  opener: () => openAoiCheckSettings(),
});

export default openAoiCheckSettings;
