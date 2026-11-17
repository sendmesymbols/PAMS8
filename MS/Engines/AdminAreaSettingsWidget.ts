import { mountSettingsWidget, type SettingsWidgetHandle } from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { adminAreaSettingsManifest } from './AdminAreaSettingsManifest';

export function openAdminAreaSettings(opts: { anchor?: { x?: number; y?: number } } = {}): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'admin-area-settings',
    title: 'Admin Area',
    icon: '🏕',
    manifest: adminAreaSettingsManifest,
    anchor: opts.anchor,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openAdminAreaSettings = openAdminAreaSettings;
}

CommandPalette.registerWidget({
  id: 'adminArea',
  label: 'Admin Area',
  category: 'Engines',
  icon: 'layers',
  hint: 'Ground for B Ech, BAA, DAA, RP, AP, ADS: clear of his guns, firm, flood-free, hidden, on a road',
  keywords: ['admin area', 'baa', 'daa', 'echelon', 'b ech', 'rp', 'ads', 'support area', 'adminArea'],
  opener: () => openAdminAreaSettings(),
});

export default openAdminAreaSettings;
