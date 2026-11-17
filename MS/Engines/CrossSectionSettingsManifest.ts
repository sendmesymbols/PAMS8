/**
 * CrossSectionSettingsManifest.ts
 *
 * X-Section — the terrain cross-section of a line (MS/Engines/CrossSection). Off by default; reads the terrain bundle
 * only while on.
 */

import type { SettingDescriptor } from '../Support/SettingsWidget';

const MOVER_OPTIONS = [
  { value: 'dismounted', label: 'Dismounted' },
  { value: 'wheeled', label: 'Wheeled' },
  { value: 'tracked', label: 'Tracked' },
  { value: 'pack', label: 'Pack animals' },
  { value: 'roadbound', label: 'Road-bound' },
  { value: 'generic', label: 'Gr based (generic)' },
  { value: 'amphibious', label: 'Amphibious' },
  { value: 'oversnow', label: 'Over snow' },
];

export const crossSectionSettingsManifest: SettingDescriptor[] = [
  {
    path: ['features', 'crossSection'],
    label: 'X-Section',
    group: 'Engine',
    type: 'boolean',
    help: 'Master switch. When on, 📈 X-Section draws the terrain cross-section of a line (drawn, selected, or right-click a line → X-Section…): height, the going for the mover in the month, obstacles crossed or followed, steep stretches, distance markers, no-data gaps and what the threat marker sees. Needs the terrain bundle.',
    keywords: ['cross section', 'x-section', 'profile', 'elevation profile', 'route profile', 'obstacles', 'crossings', 'crossSection'],
  },
  { path: ['crossSection', 'mover'], label: 'Mover', group: 'Reading', type: 'enum', options: MOVER_OPTIONS, help: 'The going band and NO-GO stretches are for this mover (rules.json profile).' },
  {
    path: ['crossSection', 'month'],
    label: 'Month (0 = this month)',
    group: 'Reading',
    type: 'number',
    min: 0,
    max: 12,
    step: 1,
    help: "Dry or after rain from the month's rain at the line (the soil and wet ground change the going).",
  },
  { path: ['crossSection', 'seen'], label: 'Seen by threat', group: 'Reading', type: 'boolean', help: "With a Ground Guide threat marker set as a place: the band of what it sees along the line." },
  { path: ['crossSection', 'eyeM'], label: "Threat's eye height (m)", group: 'Reading', type: 'number', min: 0.5, max: 100, step: 0.5, help: 'How high above the ground the threat looks from (2 m: a man on the ground).' },
  { path: ['crossSection', 'map'], label: 'Draw on the map', group: 'Map', type: 'boolean', help: 'The line with distance markers, NO-GO stretches and no-data gaps; a marker follows the chart.' },
  { path: ['crossSection', 'labels'], label: 'Labels on the map', group: 'Map', type: 'boolean', help: 'Distances and NO-GO words.' },
  { path: ['crossSection', 'bundleUrl'], label: 'Terrain bundle URL', group: 'Data', type: 'string', advanced: true, help: 'Where the terrain bundle is served (default /terrain-bundle).' },
  { path: ['crossSection', 'useWorker'], label: 'Read tiles in a worker', group: 'Data', type: 'boolean', advanced: true, help: 'Fetch and decode terrain tiles off the main thread (falls back automatically).' },
];
