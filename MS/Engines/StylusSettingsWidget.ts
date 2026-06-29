/**
 * StylusSettingsWidget.ts
 *
 * Thin shell around the manifest-driven settings widget for stylus / pen
 * drawing. Self-registers with the Ctrl+K command palette + ⚙ Settings menu on
 * import (side-effect import in SymbolEngine.ts).
 */

import {
  mountSettingsWidget,
  type SettingsWidgetHandle,
} from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { stylusSettingsManifest } from './StylusSettingsManifest';

export function openStylusSettings(opts: { anchor?: { x?: number; y?: number }; focusGroup?: string } = {}): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'stylus-settings',
    title: 'Stylus / Pen',
    icon: '✎',
    manifest: stylusSettingsManifest,
    anchor: opts.anchor,
    focusGroup: opts.focusGroup,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openStylusSettings = openStylusSettings;
}

CommandPalette.registerWidget({
  id: 'stylus',
  label: 'Stylus / Pen',
  category: 'Tools',
  icon: 'pencil',
  hint: 'Pen detection, freehand vs tap, drawing tolerances',
  keywords: ['stylus', 'pen', 'touch', 'tablet', 'freehand', 'tap', 'draw'],
  opener: () => openStylusSettings(),
});

export default openStylusSettings;
