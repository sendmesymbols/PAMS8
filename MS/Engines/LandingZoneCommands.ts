/**
 * LandingZoneCommands.ts
 *
 * Self-registration for the Landing Zone Planner. The engine hosts its own
 * panels, so this registers a single ACTION with the Ctrl+K command palette
 * that opens the planner for the active view.
 *
 * Side-effect import from SymbolEngine.ts makes it discoverable on load.
 */

import { CommandPalette } from '../Support/CommandPalette';

export function openLandingZonePlanner(): void {
  const se = (window as any).symbolEngine;
  se?.landingZoneEngine?.openWidget(se.view);
}

if (typeof window !== 'undefined') {
  (window as any).openLandingZonePlanner = openLandingZonePlanner;
}

CommandPalette.registerActions([
  {
    id: 'landingZone.open',
    label: 'Landing Zone Planner (LZ / PZ / DZ)',
    hint: 'Assess helicopter landing/pickup/drop zone suitability',
    keywords: ['landing', 'zone', 'lz', 'pz', 'dz', 'helicopter', 'helo', 'insertion', 'pickup', 'drop', 'touchdown'],
    run: () => openLandingZonePlanner(),
  },
]);

export default openLandingZonePlanner;
