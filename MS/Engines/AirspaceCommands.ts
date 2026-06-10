/**
 * AirspaceCommands.ts
 *
 * Self-registration for the Airspace (ROZ / ACA) authoring engine. The engine
 * hosts its own panel, so this registers a single ACTION with the Ctrl+K
 * command palette that opens it for the active view.
 *
 * Side-effect import from SymbolEngine.ts makes it discoverable on load.
 */

import { CommandPalette } from '../Support/CommandPalette';

export function openAirspaceEngine(): void {
  const se = (window as any).symbolEngine;
  se?.airspaceEngine?.openWidget(se.view);
}

if (typeof window !== 'undefined') {
  (window as any).openAirspaceEngine = openAirspaceEngine;
}

CommandPalette.registerActions([
  {
    id: 'airspace.open',
    label: 'Airspace (ROZ / ACA)',
    hint: 'Author restricted operations zones & airspace coordination areas with altitude bands',
    keywords: ['airspace', 'roz', 'aca', 'restricted', 'operations', 'coordination', 'altitude', 'ceiling', 'floor', 'flight level', 'volume'],
    run: () => openAirspaceEngine(),
  },
]);

export default openAirspaceEngine;
