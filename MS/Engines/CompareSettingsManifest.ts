/**
 * CompareSettingsManifest.ts
 *
 * Compare — corridors and positions read side by side under one set of assumptions (MS/Engines/Compare). Off by
 * default; reads the terrain bundle only while on.
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

export const compareSettingsManifest: SettingDescriptor[] = [
  {
    path: ['features', 'compare'],
    label: 'Compare',
    group: 'Engine',
    type: 'boolean',
    help: 'Master switch. When on, ⚖ Compare reads up to four corridors (lines) or positions (areas, points) with the same mover, month and threat, side by side: the best in each row marked, the differences written out, and how each row was worked out. Needs the terrain bundle.',
    keywords: ['compare', 'alternatives', 'corridors', 'positions', 'courses open', 'side by side', 'compare'],
  },
  { path: ['compare', 'mover'], label: 'Mover', group: 'Assumptions', type: 'enum', options: MOVER_OPTIONS, help: 'Every alternative is read for this mover (rules.json profile).' },
  {
    path: ['compare', 'month'],
    label: 'Month (0 = this month)',
    group: 'Assumptions',
    type: 'number',
    min: 0,
    max: 12,
    step: 1,
    help: "Dry or after rain from the month's rain at the first alternative.",
  },
  { path: ['compare', 'seen'], label: 'Seen by threat', group: 'Assumptions', type: 'boolean', help: 'With a Ground Guide threat marker set as a place: how much of each alternative it sees.' },
  { path: ['compare', 'eyeM'], label: "Threat's eye height (m)", group: 'Assumptions', type: 'number', min: 0.5, max: 100, step: 0.5, help: 'How high above the ground the threat looks from.' },
  { path: ['compare', 'pointRadiusM'], label: 'Point radius (m)', group: 'Assumptions', type: 'number', min: 25, max: 5000, step: 25, help: 'A point alternative is read as a circle of this radius.' },
  { path: ['compare', 'map'], label: 'Draw on the map', group: 'Map', type: 'boolean', help: 'Each alternative in its colour with its letter; NO-GO stretches on corridors.' },
  { path: ['compare', 'labels'], label: 'Labels on the map', group: 'Map', type: 'boolean', help: 'NO-GO words.' },
  { path: ['compare', 'bundleUrl'], label: 'Terrain bundle URL', group: 'Data', type: 'string', advanced: true, help: 'Where the terrain bundle is served (default /terrain-bundle).' },
  { path: ['compare', 'useWorker'], label: 'Read tiles in a worker', group: 'Data', type: 'boolean', advanced: true, help: 'Fetch and decode terrain tiles off the main thread (falls back automatically).' },
];
