/**
 * ProximitySettingsManifest.ts
 *
 * Real-time snap indicators that appear while drawing — show the nearest
 * symbol with a dot, connector line, and distance label.
 */

import type { SettingDescriptor } from '../Support/SettingsWidget';

export const proximitySettingsManifest: SettingDescriptor[] = [
  {
    path: ['features', 'proximityEngine'],
    label: 'Proximity engine',
    group: 'Engine',
    type: 'boolean',
    help: 'Master switch. When on, drawing shows live snap indicators to the nearest existing symbol.',
    keywords: ['enable', 'disable', 'master'],
  },

  // ── Detection ──────────────────────────────────────────────────────────────
  {
    path: ['proximity', 'nearestVertex'],
    label: 'Snap to nearest vertex',
    group: 'Detection',
    type: 'boolean',
    help: 'Snap indicator follows the nearest vertex of existing symbols.',
  },
  {
    path: ['proximity', 'nearestCoordinate'],
    label: 'Snap to nearest coordinate',
    group: 'Detection',
    type: 'boolean',
    help: 'Snap indicator follows the nearest coordinate along any existing symbol geometry (not just vertices).',
  },
  {
    path: ['proximity', 'snapRadiusPx'],
    label: 'Snap radius (px)',
    group: 'Detection',
    type: 'number',
    min: 0,
    max: 200,
    step: 1,
    help: 'Snap kicks in when the cursor is within this pixel distance of a target.',
  },
  {
    path: ['proximity', 'showDistance'],
    label: 'Show distance label',
    group: 'Detection',
    type: 'boolean',
    help: 'Display the distance to the snapped symbol next to the indicator.',
  },
  {
    path: ['proximity', 'distanceUnit'],
    label: 'Distance unit',
    group: 'Detection',
    type: 'enum',
    options: [
      { value: 'meters', label: 'Meters' },
      { value: 'kilometers', label: 'Kilometres' },
      { value: 'miles', label: 'Miles' },
      { value: 'nautical-miles', label: 'Nautical miles' },
    ],
    help: 'Unit used by the distance label.',
  },

  // ── Connector line ─────────────────────────────────────────────────────────
  {
    path: ['proximity', 'lineColor'],
    label: 'Line color',
    group: 'Connector line',
    type: 'color',
    help: 'Color of the line drawn from the cursor to the nearest snap target.',
  },
  {
    path: ['proximity', 'lineWidth'],
    label: 'Line width',
    group: 'Connector line',
    type: 'number',
    min: 0.5,
    max: 10,
    step: 0.5,
    help: 'Width of the connector line in pixels.',
  },
  {
    path: ['proximity', 'lineOpacity'],
    label: 'Line opacity',
    group: 'Connector line',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    help: '0 = transparent, 1 = solid.',
  },

  // ── Marker ─────────────────────────────────────────────────────────────────
  {
    path: ['proximity', 'markerSize'],
    label: 'Marker size',
    group: 'Marker',
    type: 'number',
    min: 4,
    max: 30,
    step: 1,
    help: 'Diameter of the snap-point marker in pixels.',
  },
  {
    path: ['proximity', 'markerColor'],
    label: 'Marker color',
    group: 'Marker',
    type: 'color',
    help: 'Color of the snap-point marker.',
  },

  // ── Label ──────────────────────────────────────────────────────────────────
  {
    path: ['proximity', 'fontSize'],
    label: 'Font size',
    group: 'Label',
    type: 'number',
    min: 8,
    max: 24,
    step: 1,
    help: 'Font size for the distance label in pixels.',
  },
  {
    path: ['proximity', 'fontColor'],
    label: 'Font color',
    group: 'Label',
    type: 'color',
    help: 'Color of the distance label text.',
  },
];
