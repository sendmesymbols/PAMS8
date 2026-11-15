import { mountSettingsWidget, type SettingsWidgetHandle } from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { planBuilderSettingsManifest } from './PlanBuilderSettingsManifest';

export function openPlanBuilderSettings(opts: { anchor?: { x?: number; y?: number } } = {}): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'plan-builder-settings',
    title: 'Deployment Mgr: Intelligent Deployment',
    icon: '🧩',
    manifest: planBuilderSettingsManifest,
    anchor: opts.anchor,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openPlanBuilderSettings = openPlanBuilderSettings;
}

CommandPalette.registerWidget({
  id: 'planBuilder',
  label: 'Deployment Mgr: Intelligent Deployment',
  category: 'Engines',
  icon: 'layers',
  hint: 'Baseline plans from the task, the unit and the ground: two up, three up, one up, all round, Auto; quick ghost on the move, fit at rest',
  keywords: ['intelligent deployment', 'plan builder', 'build', 'baseline plan', 'deployment', 'defence', 'two up', 'three up', 'layout', 'recipe', 'planBuilder'],
  opener: () => openPlanBuilderSettings(),
});

export default openPlanBuilderSettings;
