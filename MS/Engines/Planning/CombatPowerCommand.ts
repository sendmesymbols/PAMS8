/**
 * CombatPowerCommand.ts
 *
 * Self-registration for the Combat Power calculator. Combat Power has no
 * settings to toggle — it is a one-shot tool — so this registers a single
 * ACTION with the Ctrl+K command palette that opens the readout panel for the
 * active view.
 *
 * Side-effect import from SymbolEngine.ts makes it discoverable on load.
 */

import { CommandPalette } from '../../Support/CommandPalette';
import CombatPowerEngine from './CombatPowerEngine';

export function openCombatPower(): void {
  const view = (window as any).symbolEngine?.view;
  CombatPowerEngine.getInstance().open(view);
}

if (typeof window !== 'undefined') {
  (window as any).openCombatPower = openCombatPower;
}

CommandPalette.registerActions([
  {
    id: 'combatPower.open',
    label: 'Combat Power — force ratio',
    hint: 'Sum friendly vs hostile combat power and show the force ratio',
    keywords: ['combat', 'power', 'force', 'ratio', 'strength', '3:1', 'correlation', 'analysis'],
    run: () => openCombatPower(),
  },
]);

export default openCombatPower;
