import { mountSettingsWidget, type SettingsWidgetHandle } from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { compareSettingsManifest } from './CompareSettingsManifest';

export function openCompareSettings(opts: { anchor?: { x?: number; y?: number } } = {}): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'compare-settings',
    title: 'Compare',
    icon: '⚖',
    manifest: compareSettingsManifest,
    anchor: opts.anchor,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openCompareSettings = openCompareSettings;
}

CommandPalette.registerWidget({
  id: 'compare',
  label: 'Compare',
  category: 'Engines',
  icon: 'layers',
  hint: 'Corridors and positions side by side: same mover, month and threat; differences and how worked out',
  keywords: ['compare', 'alternatives', 'corridors', 'positions', 'courses open', 'compare'],
  opener: () => openCompareSettings(),
});

export default openCompareSettings;
