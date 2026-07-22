/**
 * TextStyleSettingsManifest.ts
 *
 * Rich-text appearance knobs for labels/annotations — font family, size, and
 * colour. Read live at annotate time from `settingsData.textStyle`, so changes
 * apply to the next label/text/callout drawn.
 *
 * A text box's FILL + BORDER (e.g. the Callout Box / a rectangle used as a text
 * box) is a freehand-area appearance and is set via the existing Freehand Style
 * palette (drawStyle) — not duplicated here.
 *
 * Colours persist as `[r,g,b]` triples (`colorAsRgb: true`) to match the arrays
 * the engine / ArcGIS symbols expect. The font family is a conservative,
 * cross-platform, 3D-safe list so SceneView never silently substitutes.
 */

import type { SettingDescriptor } from '../Support/SettingsWidget';

export const textStyleSettingsManifest: SettingDescriptor[] = [
  // ── Text ─────────────────────────────────────────────────────────────────────
  {
    path: ['textStyle', 'fontFamily'],
    label: 'Font family',
    group: 'Text',
    type: 'enum',
    options: [
      { value: 'Arial', label: 'Arial' },
      { value: 'Times New Roman', label: 'Times New Roman' },
      { value: 'Courier New', label: 'Courier New' },
      { value: 'Verdana', label: 'Verdana' },
      { value: 'Tahoma', label: 'Tahoma' },
      { value: 'Georgia', label: 'Georgia' },
      { value: 'Trebuchet MS', label: 'Trebuchet MS' },
    ],
    help: 'Font family for symbol labels and text. Kept to cross-platform, 3D-safe families so the 3D scene never substitutes a different font.',
    keywords: ['font', 'typeface', 'label', 'text'],
  },
  {
    path: ['textStyle', 'textSize'],
    label: 'Text size',
    group: 'Text',
    type: 'number',
    min: 6,
    max: 72,
    step: 1,
    help: 'Point size for label / text symbols.',
    keywords: ['font size', 'label size'],
  },
  {
    path: ['textStyle', 'textColor'],
    label: 'Text color',
    group: 'Text',
    type: 'color',
    colorAsRgb: true,
    help: 'Fill color of the label text. (Tip: for a text box’s fill & border, draw a Callout Box or rectangle and use the Freehand Style palette.)',
    keywords: ['label color', 'font color', 'colour'],
  },
  {
    path: ['textStyle', 'bold'],
    label: 'Bold',
    group: 'Text',
    type: 'boolean',
    help: 'Draw new labels in bold.',
    keywords: ['weight', 'strong'],
  },
  {
    path: ['textStyle', 'italic'],
    label: 'Italic',
    group: 'Text',
    type: 'boolean',
    help: 'Draw new labels in italic.',
    keywords: ['oblique', 'slant'],
  },
  {
    path: ['textStyle', 'underline'],
    label: 'Underline',
    group: 'Text',
    type: 'boolean',
    help: 'Underline new labels.',
    keywords: ['decoration'],
  },

  // ── Highlight (rendered as a thick coloured halo behind the glyphs — 2D/3D-safe,
  //    unlike TextSymbol.backgroundColor which is MapView-only) ──────────────────
  {
    path: ['textStyle', 'highlight'],
    label: 'Highlight',
    group: 'Highlight',
    type: 'boolean',
    help: 'Draw a coloured glow/halo behind the text (highlighter effect). Renders in both 2D and 3D. When off, text keeps a thin white readability halo.',
    keywords: ['glow', 'halo', 'marker', 'background'],
  },
  {
    path: ['textStyle', 'highlightColor'],
    label: 'Highlight color',
    group: 'Highlight',
    type: 'color',
    colorAsRgb: true,
    help: 'Color of the highlight glow behind the text.',
    keywords: ['glow color', 'halo color'],
  },
  {
    path: ['textStyle', 'highlightSize'],
    label: 'Highlight strength',
    group: 'Highlight',
    type: 'number',
    min: 1,
    max: 12,
    step: 0.5,
    help: 'Thickness of the highlight glow (halo size in px).',
    keywords: ['glow size', 'halo size', 'thickness'],
  },
];
