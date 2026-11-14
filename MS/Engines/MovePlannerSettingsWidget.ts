import { mountSettingsWidget, type SettingsWidgetHandle } from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { movePlannerSettingsManifest } from './MovePlannerSettingsManifest';

export function openMovePlannerSettings(opts: { anchor?: { x?: number; y?: number } } = {}): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'move-planner-settings',
    title: 'Move Planner',
    icon: '🚚',
    manifest: movePlannerSettingsManifest,
    anchor: opts.anchor,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openMovePlannerSettings = openMovePlannerSettings;
}

CommandPalette.registerWidget({
  id: 'movePlanner',
  label: 'Move Planner',
  category: 'Engines',
  icon: 'layers',
  hint: 'Rd Mov, Mov & Assy, DI Mov, Rly Mov and En Mov: mov tables, graphs, trains, induction matrix',
  keywords: ['move planner', 'mov plan', 'mov table', 'road move', 'rail move', 'de-induction', 'assembly', 'enemy move', 'tpp', 'trains', 'movePlanner'],
  opener: () => openMovePlannerSettings(),
});

export default openMovePlannerSettings;
