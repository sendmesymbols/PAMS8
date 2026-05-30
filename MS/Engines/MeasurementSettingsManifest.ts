/**
 * MeasurementSettingsManifest.ts
 *
 * Single source of truth for the Measurement engine's user-facing settings.
 * Consumed by:
 *   - MeasurementSettingsWidget (renders rows)
 *   - CommandPalette (Ctrl+K index + inline edit)
 *
 * Paths mirror exactly what `SymbolEngine.onSettingChanged` already routes for
 * `measurement.*` — no engine code changes required.
 *
 * Pattern for follow-up engines: copy this file next to the engine, change the
 * paths/options, register with CommandPalette at startup.
 */

import type { SettingDescriptor } from '../Support/SettingsWidget';

export const measurementSettingsManifest: SettingDescriptor[] = [
  // ── Engine (master on/off) ─────────────────────────────────────────────────
  // Convention: every per-engine widget starts with an "Engine" group whose
  // first row toggles the owning engine via `features.<engine>` so the widget
  // is itself the place to turn the feature on or off.
  {
    path: ['features', 'measurementEngine'],
    label: 'Measurement engine',
    group: 'Engine',
    type: 'boolean',
    help: 'Master switch. Turns the live distance / area / bearing engine on or off. The on-map panel and all other settings below depend on this.',
    keywords: ['enable', 'disable', 'on', 'off', 'master'],
  },

  // ── Units ──────────────────────────────────────────────────────────────────
  {
    path: ['measurement', 'distUnit'],
    label: 'Distance unit',
    group: 'Units',
    type: 'enum',
    options: [
      { value: 'meters', label: 'Meters' },
      { value: 'kilometers', label: 'Kilometres' },
      { value: 'miles', label: 'Miles' },
      { value: 'nautical-miles', label: 'Nautical miles' },
    ],
    help: 'Unit used for all distance readouts in the measurement panel and on-map labels.',
    keywords: ['km', 'mi', 'nm', 'metric'],
  },
  {
    path: ['measurement', 'areaUnit'],
    label: 'Area unit',
    group: 'Units',
    type: 'enum',
    options: [
      { value: 'square-meters', label: 'Square metres' },
      { value: 'square-kilometers', label: 'Square kilometres' },
      { value: 'square-miles', label: 'Square miles' },
      { value: 'hectares', label: 'Hectares' },
      { value: 'acres', label: 'Acres' },
    ],
    help: 'Unit used for area readouts on polygon and enclosed-area symbols.',
    keywords: ['hectares', 'acres', 'sq km'],
  },
  {
    path: ['measurement', 'autoUnit'],
    label: 'Auto-pick unit',
    group: 'Units',
    type: 'boolean',
    help: 'Picks a readable unit per value (e.g. 850 m instead of 0.85 km, km / miles for long distances).',
    keywords: ['readable', 'humanize'],
  },

  // ── Display ────────────────────────────────────────────────────────────────
  {
    path: ['measurement', 'showBng'],
    label: 'Show bearing',
    group: 'Display',
    type: 'boolean',
    help: 'Show direction (bearing) for line and area symbols in the measurement panel.',
    keywords: ['azimuth', 'direction'],
  },
  {
    path: ['measurement', 'showArea'],
    label: 'Show area',
    group: 'Display',
    type: 'boolean',
    help: 'Show calculated area for polygon and enclosed symbols.',
  },
  {
    path: ['measurement', 'showTotal'],
    label: 'Show total',
    group: 'Display',
    type: 'boolean',
    help: 'Show cumulative distance for multi-segment line symbols.',
  },
  {
    path: ['measurement', 'showSegment'],
    label: 'Show segment',
    group: 'Display',
    type: 'boolean',
    help: 'Show distance of each individual segment in a multi-segment line.',
  },
  {
    path: ['measurement', 'showExtent'],
    label: 'Show extent',
    group: 'Display',
    type: 'boolean',
    help: 'Show width and height (bounding box) of area symbols and groups.',
    keywords: ['width', 'height', 'bounding'],
  },

  // ── Advanced ───────────────────────────────────────────────────────────────
  {
    path: ['measurement', 'bearingFormat'],
    label: 'Bearing format',
    group: 'Advanced',
    type: 'enum',
    options: [
      { value: 'decimal', label: 'Decimal °' },
      { value: 'mils', label: 'Mils (NATO 6400)' },
      { value: 'quadrant', label: 'Quadrant (N45°E)' },
    ],
    help: 'How bearings are displayed. Suffixed T (true) or M (magnetic) depending on declination setting.',
    keywords: ['mils', 'azimuth', 'compass'],
  },
  {
    path: ['measurement', 'magneticDeclination'],
    label: 'Magnetic declination °',
    group: 'Advanced',
    type: 'number',
    min: -180,
    max: 180,
    step: 0.1,
    help: 'Adjust bearings by local magnetic declination. Positive = east of true north.',
    keywords: ['magnetic', 'compass'],
  },
  {
    path: ['measurement', 'slantRange'],
    label: 'Slant range (3D)',
    group: 'Advanced',
    type: 'boolean',
    help: 'Account for elevation differences when computing distance in 3D.',
    keywords: ['3d', 'elevation'],
  },
  {
    path: ['measurement', 'speedKmh'],
    label: 'March speed (km/h)',
    group: 'Advanced',
    type: 'number',
    min: 0,
    max: 200,
    step: 0.5,
    help: 'Movement speed used to estimate arrival time (ETA) for unit symbols.',
    keywords: ['march', 'eta', 'travel'],
  },
  {
    path: ['measurement', 'roadEta'],
    label: 'Road ETA',
    group: 'Advanced',
    type: 'boolean',
    help: 'When measuring a line/route, add road-following distance, drive time and trafficability from the road-network service. Falls back to straight-line if offline.',
    keywords: ['route', 'road', 'trafficability'],
  },
  {
    path: ['measurement', 'preserveOnComplete'],
    label: 'Keep labels after drawing',
    group: 'Advanced',
    type: 'boolean',
    help: 'Keep measurement labels on the map after a symbol is finished — handy for briefings and screenshots.',
    keywords: ['briefing', 'screenshot'],
  },

  // ── Styling ────────────────────────────────────────────────────────────────
  {
    path: ['measurement', 'lineWidth'],
    label: 'Line width',
    group: 'Styling',
    type: 'number',
    min: 0.5,
    max: 10,
    step: 0.5,
    help: 'Width of measurement overlay lines in pixels.',
  },
  {
    path: ['measurement', 'lineColor'],
    label: 'Line color',
    group: 'Styling',
    type: 'color',
    colorAsRgb: true,
    help: 'Colour for measurement overlay lines and borders.',
  },
  {
    path: ['measurement', 'fontSize'],
    label: 'Font size',
    group: 'Styling',
    type: 'number',
    min: 8,
    max: 24,
    step: 1,
    help: 'Font size for measurement text in the panel and on-map overlays.',
  },
  {
    path: ['measurement', 'fontColor'],
    label: 'Font color',
    group: 'Styling',
    type: 'color',
    colorAsRgb: true,
    help: 'Text colour for measurement values.',
  },
];
