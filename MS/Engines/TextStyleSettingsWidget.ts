/**
 * TextStyleSettingsWidget.ts
 *
 * Thin shell around the manifest-driven settings widget for the rich-text /
 * text-box palette (font family, text size/color, box fill + border).
 * Self-registers with the Ctrl+K command palette + ⚙ Settings menu on import
 * (side-effect import in SymbolEngine.ts). Shares the `textStyle` SettingsBus
 * keys read live by AnnotationEngine + SymbolEngine at annotate/draw time.
 */

import {
  mountSettingsWidget,
  type SettingsWidgetHandle,
} from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { textStyleSettingsManifest } from './TextStyleSettingsManifest';

export function openTextStyleSettings(opts: { anchor?: { x?: number; y?: number }; focusGroup?: string } = {}): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'textstyle-settings',
    title: 'Text Style',
    icon: '🔤',
    manifest: textStyleSettingsManifest,
    anchor: opts.anchor,
    focusGroup: opts.focusGroup,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openTextStyleSettings = openTextStyleSettings;
}

CommandPalette.registerWidget({
  id: 'textstyle',
  label: 'Text Style',
  category: 'Appearance',
  icon: '🔤',
  hint: 'Font family, text size & color, and text-box fill/border',
  keywords: ['text', 'font', 'label', 'family', 'callout', 'box', 'size', 'colour', 'color', 'typeface'],
  opener: () => openTextStyleSettings(),
});

export default openTextStyleSettings;
