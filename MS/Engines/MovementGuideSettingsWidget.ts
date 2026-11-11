import { mountSettingsWidget, type SettingsWidgetHandle } from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { movementGuideSettingsManifest } from './MovementGuideSettingsManifest';

export function openMovementGuideSettings(opts: { anchor?: { x?: number; y?: number } } = {}): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'movement-guide-settings',
    title: 'Movement Guide',
    icon: '🛣',
    manifest: movementGuideSettingsManifest,
    anchor: opts.anchor,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openMovementGuideSettings = openMovementGuideSettings;
}

CommandPalette.registerWidget({
  id: 'movementGuide',
  label: 'Movement Guide',
  category: 'Engines',
  icon: 'layers',
  hint: 'Safety of the move: route dangers, picketing, piqueting, cordon troops',
  keywords: ['movement', 'route', 'convoy', 'picket', 'piquet', 'cordon', 'ambush', 'mine', 'safety', 'movementGuide'],
  opener: () => openMovementGuideSettings(),
});

export default openMovementGuideSettings;
