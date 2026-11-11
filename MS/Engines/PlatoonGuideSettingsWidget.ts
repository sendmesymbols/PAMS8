import { mountSettingsWidget, type SettingsWidgetHandle } from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { platoonGuideSettingsManifest } from './PlatoonGuideSettingsManifest';

export function openPlatoonGuideSettings(opts: { anchor?: { x?: number; y?: number } } = {}): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'platoon-guide-settings',
    title: 'Platoon Guide',
    icon: '🪖',
    manifest: platoonGuideSettingsManifest,
    anchor: opts.anchor,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openPlatoonGuideSettings = openPlatoonGuideSettings;
}

CommandPalette.registerWidget({
  id: 'platoonGuide',
  label: 'Platoon Guide',
  category: 'Engines',
  icon: 'layers',
  hint: 'Ground card at a point: going, cover, water, way out, casevac, dead ground, likely IED / ambush sites, people, patrol route card',
  keywords: ['platoon', 'section', 'company', 'ground card', 'patrol', 'water', 'dead ground', 'ied', 'ambush', 'casevac', 'harbour', 'platoonGuide'],
  opener: () => openPlatoonGuideSettings(),
});

export default openPlatoonGuideSettings;
