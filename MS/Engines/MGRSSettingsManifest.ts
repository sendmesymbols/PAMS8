/**
 * MGRSSettingsManifest.ts
 *
 * Military Grid Reference System overlay — toggles per grid level (GZD,
 * 100km, 10km, 1km) plus per-level styling and labels.
 */

import type { SettingDescriptor } from '../Support/SettingsWidget';

export const mgrsSettingsManifest: SettingDescriptor[] = [
  {
    path: ['features', 'mgrsEngine'],
    label: 'MGRS engine',
    group: 'Engine',
    type: 'boolean',
    help: 'Master switch for the MGRS grid overlay.',
    keywords: ['enable', 'disable', 'grid'],
  },

  // ── Grid types ─────────────────────────────────────────────────────────────
  {
    path: ['mgrs', 'showGZD'],
    label: 'GZD',
    group: 'Grid types',
    type: 'boolean',
    help: 'Grid Zone Designator boundaries (e.g. 42S).',
  },
  {
    path: ['mgrs', 'show100K'],
    label: '100 km',
    group: 'Grid types',
    type: 'boolean',
    help: '100km grid squares (e.g. XD).',
  },
  {
    path: ['mgrs', 'show10K'],
    label: '10 km',
    group: 'Grid types',
    type: 'boolean',
    help: '10km grid squares.',
  },
  {
    path: ['mgrs', 'show1K'],
    label: '1 km',
    group: 'Grid types',
    type: 'boolean',
    help: '1km grid squares.',
  },
  {
    path: ['mgrs', 'autoZoom'],
    label: 'Auto-pick by zoom',
    group: 'Grid types',
    type: 'boolean',
    help: 'Show / hide each grid level automatically based on the map zoom.',
  },

  // ── GZD styling ────────────────────────────────────────────────────────────
  {
    path: ['mgrs', 'gzdColor'],
    label: 'GZD color',
    group: 'GZD styling',
    type: 'color',
    colorAsRgb: true,
    help: 'Line color for GZD boundaries.',
  },
  {
    path: ['mgrs', 'gzdOpacity'],
    label: 'GZD opacity',
    group: 'GZD styling',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    help: 'Opacity of GZD boundaries.',
  },
  {
    path: ['mgrs', 'gzdWidth'],
    label: 'GZD width',
    group: 'GZD styling',
    type: 'number',
    min: 0.1,
    max: 10,
    step: 0.1,
    help: 'Line width for GZD boundaries in pixels.',
  },

  // ── 100km styling ──────────────────────────────────────────────────────────
  {
    path: ['mgrs', 'hundredKColor'],
    label: '100 km color',
    group: '100 km styling',
    type: 'color',
    colorAsRgb: true,
    help: 'Line color for the 100km grid.',
  },
  {
    path: ['mgrs', 'hundredKOpacity'],
    label: '100 km opacity',
    group: '100 km styling',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    help: 'Opacity of the 100km grid.',
  },
  {
    path: ['mgrs', 'hundredKWidth'],
    label: '100 km width',
    group: '100 km styling',
    type: 'number',
    min: 0.1,
    max: 10,
    step: 0.1,
    help: 'Line width for the 100km grid in pixels.',
  },

  // ── 10km styling ───────────────────────────────────────────────────────────
  {
    path: ['mgrs', 'tenKColor'],
    label: '10 km color',
    group: '10 km styling',
    type: 'color',
    colorAsRgb: true,
    help: 'Line color for the 10km grid.',
  },
  {
    path: ['mgrs', 'tenKOpacity'],
    label: '10 km opacity',
    group: '10 km styling',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    help: 'Opacity of the 10km grid.',
  },
  {
    path: ['mgrs', 'tenKWidth'],
    label: '10 km width',
    group: '10 km styling',
    type: 'number',
    min: 0.1,
    max: 10,
    step: 0.1,
    help: 'Line width for the 10km grid in pixels.',
  },

  // ── 1km styling ────────────────────────────────────────────────────────────
  {
    path: ['mgrs', 'oneKColor'],
    label: '1 km color',
    group: '1 km styling',
    type: 'color',
    colorAsRgb: true,
    help: 'Line color for the 1km grid.',
  },
  {
    path: ['mgrs', 'oneKOpacity'],
    label: '1 km opacity',
    group: '1 km styling',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    help: 'Opacity of the 1km grid.',
  },
  {
    path: ['mgrs', 'oneKWidth'],
    label: '1 km width',
    group: '1 km styling',
    type: 'number',
    min: 0.1,
    max: 10,
    step: 0.1,
    help: 'Line width for the 1km grid in pixels.',
  },

  // ── Labels ─────────────────────────────────────────────────────────────────
  {
    path: ['mgrs', 'showLabels'],
    label: 'Show labels',
    group: 'Labels',
    type: 'boolean',
    help: 'Display MGRS coordinate labels along the grid.',
  },
  {
    path: ['mgrs', 'labelSize'],
    label: 'Label size',
    group: 'Labels',
    type: 'number',
    min: 8,
    max: 40,
    step: 1,
    help: 'Font size for grid labels.',
  },
  {
    path: ['mgrs', 'labelColor'],
    label: 'Label color',
    group: 'Labels',
    type: 'color',
    colorAsRgb: true,
    help: 'Text color for grid labels.',
  },
  {
    path: ['mgrs', 'labelOpacity'],
    label: 'Label opacity',
    group: 'Labels',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    help: 'Opacity of grid labels.',
  },
];
