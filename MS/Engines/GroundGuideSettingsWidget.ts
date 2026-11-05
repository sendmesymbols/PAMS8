import {
  mountSettingsWidget,
  type SettingsWidgetHandle,
} from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { groundGuideSettingsManifest, GROUND_GUIDE_ADVANCED_META } from './GroundGuideSettingsManifest';

export function openGroundGuideSettings(opts: { anchor?: { x?: number; y?: number } } = {}): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'ground-guide-settings',
    title: 'Ground Guide',
    icon: '⛰',
    manifest: groundGuideSettingsManifest,
    advancedMeta: GROUND_GUIDE_ADVANCED_META,
    anchor: opts.anchor,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openGroundGuideSettings = openGroundGuideSettings;
}

CommandPalette.registerWidget({
  id: 'groundGuide',
  label: 'Ground Guide',
  category: 'Engines',
  icon: 'layers',
  hint: 'Terrain advice while drawing — mode, bundle, thresholds',
  keywords: ['terrain', 'deployable', 'no-go', 'water', 'marsh', 'groundGuide'],
  opener: () => openGroundGuideSettings(),
});

export default openGroundGuideSettings;
