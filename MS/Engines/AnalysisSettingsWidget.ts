import {
  mountSettingsWidget,
  type SettingsWidgetHandle,
} from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { analysisSettingsManifest } from './AnalysisSettingsManifest';

export function openAnalysisSettings(opts: { anchor?: { x?: number; y?: number }; focusGroup?: string } = {}): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'analysis-settings',
    title: 'Analysis engines',
    icon: '🔍',
    manifest: analysisSettingsManifest,
    anchor: opts.anchor,
    focusGroup: opts.focusGroup,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openAnalysisSettings = openAnalysisSettings;
}

CommandPalette.registerWidget({
  id: 'analysis',
  label: 'Analysis engines',
  category: 'Engines',
  icon: 'activity',
  hint: 'Toggle LOS, WEZ, Trajectory, Corridor, Mission Planner, OCOKA…',
  keywords: ['los', 'wez', 'trajectory', 'corridor', 'flight', 'effects', 'terrain', 'mission', 'ocoka'],
  opener: () => openAnalysisSettings(),
});

export default openAnalysisSettings;
