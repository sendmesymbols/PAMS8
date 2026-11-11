import { mountSettingsWidget, type SettingsWidgetHandle } from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { nightMarchSettingsManifest } from './NightMarchSettingsManifest';

export function openNightMarchSettings(opts: { anchor?: { x?: number; y?: number } } = {}): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'night-march-settings',
    title: 'Night March',
    icon: '🌙',
    manifest: nightMarchSettingsManifest,
    anchor: opts.anchor,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openNightMarchSettings = openNightMarchSettings;
}

CommandPalette.registerWidget({
  id: 'nightMarch',
  label: 'Night March',
  category: 'Engines',
  icon: 'layers',
  hint: 'Night march chart: bearings and paced legs (120 paces = 100 m), time by night, FUP and SL marking layout, timings back from H',
  keywords: ['night march', 'march chart', 'bearing', 'paces', 'compass', 'fup', 'start line', 'h hour', 'attack', 'nightMarch'],
  opener: () => openNightMarchSettings(),
});

export default openNightMarchSettings;
