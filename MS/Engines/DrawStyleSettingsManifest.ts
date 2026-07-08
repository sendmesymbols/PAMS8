/**
 * DrawStyleSettingsManifest.ts
 *
 * Appearance knobs for freehand drawing — fill on/off + independent fill
 * colour/opacity, line (outline) colour, and line width. These are read live at
 * draw time by SymbolEngine.initialize() for freehand symbols (gated on
 * `isFreeHand === '1'`), so changes apply to the next freehand draw.
 *
 * Colours persist as `[r,g,b]` triples (`colorAsRgb: true`) to match the arrays
 * the engine / ArcGIS symbols expect.
 */

import type { SettingDescriptor } from '../Support/SettingsWidget';

export const drawStyleSettingsManifest: SettingDescriptor[] = [
  // ── Line (outline) ──────────────────────────────────────────────────────────
  {
    path: ['drawStyle', 'useAffiliationColor'],
    label: 'Use affiliation color',
    group: 'Line',
    type: 'boolean',
    help: 'When on, freehand strokes use the color derived from the SIDC standard identity (default). Turn off to apply the custom line color below.',
    keywords: ['sidc', 'identity', 'default', 'stroke'],
  },
  {
    path: ['drawStyle', 'lineColor'],
    label: 'Line color',
    group: 'Line',
    type: 'color',
    colorAsRgb: true,
    help: 'Outline/stroke color for freehand symbols. Only applied when "Use affiliation color" is off.',
    keywords: ['stroke', 'outline', 'border'],
  },
  {
    path: ['drawStyle', 'lineWidth'],
    label: 'Line width',
    group: 'Line',
    type: 'number',
    min: 0.5,
    max: 20,
    step: 0.5,
    help: 'Stroke width in pixels for freehand lines, arrows, and area outlines.',
    keywords: ['thickness', 'weight'],
  },

  // ── Fill ────────────────────────────────────────────────────────────────────
  {
    path: ['drawStyle', 'fill'],
    label: 'Fill areas',
    group: 'Fill',
    type: 'boolean',
    help: 'When on, freehand area symbols (Area, Semi Circle) are drawn filled. Lines and arrows are unaffected.',
    keywords: ['solid', 'shade', 'polygon'],
  },
  {
    path: ['drawStyle', 'fillColor'],
    label: 'Fill color',
    group: 'Fill',
    type: 'color',
    colorAsRgb: true,
    help: 'Fill color for freehand area symbols. Independent from the line color.',
    keywords: ['interior', 'shade'],
  },
  {
    path: ['drawStyle', 'fillOpacity'],
    label: 'Fill opacity',
    group: 'Fill',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    help: 'Opacity of the area fill (0 = transparent, 1 = solid).',
    keywords: ['alpha', 'transparency', 'translucent'],
  },
];
