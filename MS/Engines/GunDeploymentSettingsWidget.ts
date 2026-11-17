import { mountSettingsWidget, type SettingsWidgetHandle } from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { gunDeploymentSettingsManifest } from './GunDeploymentSettingsManifest';

export function openGunDeploymentSettings(opts: { anchor?: { x?: number; y?: number } } = {}): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'gun-deployment-settings',
    title: 'Gun Deployment',
    icon: '🎯',
    manifest: gunDeploymentSettingsManifest,
    anchor: opts.anchor,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openGunDeploymentSettings = openGunDeploymentSettings;
}

CommandPalette.registerWidget({
  id: 'gunDeployment',
  label: 'Gun Deployment',
  category: 'Engines',
  icon: 'layers',
  hint: 'Gun areas for a Bty / Regt: room, level, firm, hidden, access, range, behind the FDL, crest clearance',
  keywords: ['gun deployment', 'gun area', 'paa', 'artillery', 'crest clearance', 'battery', 'gunDeployment'],
  opener: () => openGunDeploymentSettings(),
});

export default openGunDeploymentSettings;
