/**
 * DrawStyleSettingsWidget.ts
 *
 * Thin shell around the manifest-driven settings widget for the freehand
 * draw-style palette (fill, line/fill color, line width, fill opacity).
 * Self-registers with the Ctrl+K command palette + ⚙ Settings menu on import
 * (side-effect import in SymbolEngine.ts). Shares the `drawStyle` SettingsBus
 * keys with the inline infobar palette, so the two surfaces stay in sync.
 */

import {
  mountSettingsWidget,
  type SettingsWidgetHandle,
} from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { drawStyleSettingsManifest } from './DrawStyleSettingsManifest';

export function openDrawStyleSettings(opts: { anchor?: { x?: number; y?: number }; focusGroup?: string } = {}): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'drawstyle-settings',
    title: 'Freehand Style',
    icon: '🎨',
    manifest: drawStyleSettingsManifest,
    anchor: opts.anchor,
    focusGroup: opts.focusGroup,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openDrawStyleSettings = openDrawStyleSettings;
}

CommandPalette.registerWidget({
  id: 'drawstyle',
  label: 'Freehand Style',
  category: 'Appearance',
  icon: '🎨',
  hint: 'Fill, line & fill color, line width for freehand symbols',
  keywords: ['freehand', 'fill', 'color', 'colour', 'line width', 'outline', 'stroke', 'palette', 'style'],
  opener: () => openDrawStyleSettings(),
});

export default openDrawStyleSettings;
