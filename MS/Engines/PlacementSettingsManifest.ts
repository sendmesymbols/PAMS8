/**
 * PlacementSettingsManifest.ts
 *
 * Live terrain advice while drawing — warns when a symbol is placed on, in, or
 * near no-go terrain (water, marsh, built-up, steep slope, …) using a terrain
 * bundle served by the host app.
 */

import type { SettingDescriptor } from '../Support/SettingsWidget';

export const placementSettingsManifest: SettingDescriptor[] = [
  {
    path: ['features', 'placementAdvisor'],
    label: 'Placement advisor',
    group: 'Engine',
    type: 'boolean',
    help: 'Master switch. When on, drawing shows live advice about deployable terrain under the cursor. Needs a terrain bundle.',
    keywords: ['enable', 'disable', 'master', 'terrain', 'deployable'],
  },
  {
    path: ['placement', 'mode'],
    label: 'Mode',
    group: 'Engine',
    type: 'enum',
    options: [
      { value: 'advise', label: 'Advise (warn only)' },
      { value: 'enforce', label: 'Enforce (refuse listed verdicts)' },
      { value: 'off', label: 'Off' },
    ],
    help: 'Advise only informs. Enforce refuses to place a symbol whose verdict is in the "refuse" list.',
    keywords: ['block', 'warn', 'advisory'],
  },
  {
    path: ['placement', 'bundleUrl'],
    label: 'Terrain bundle URL',
    group: 'Data',
    type: 'string',
    help: 'Folder URL that holds manifest.json, rules.json and the tile folders, served as static files by the host app.',
    keywords: ['data', 'tiles', 'url', 'path'],
  },
  {
    path: ['placement', 'nearThresholdM'],
    label: 'Near threshold (m)',
    group: 'Verdicts',
    type: 'number',
    min: 0,
    max: 5000,
    step: 10,
    help: 'Deployable terrain closer than this to a no-go area is reported as "near" with the distance.',
  },
  {
    path: ['placement', 'partialFraction'],
    label: 'Partial share',
    group: 'Verdicts',
    type: 'number',
    min: 0.01,
    max: 1,
    step: 0.01,
    help: 'Lines and areas with at least this share of their outline/interior in no-go terrain are reported as "partial".',
  },
  {
    path: ['placement', 'showBadge'],
    label: 'Show cursor badge',
    group: 'Feedback',
    type: 'boolean',
    help: 'Show the verdict next to the cursor while drawing.',
  },
  {
    path: ['placement', 'logVerdicts'],
    label: 'Log to Engine Log',
    group: 'Feedback',
    type: 'boolean',
    help: 'Write near / caution / partial / in verdict changes to the Engine Log panel.',
  },
  {
    path: ['placement', 'cacheTiles'],
    label: 'Tile cache size',
    group: 'Performance',
    type: 'number',
    min: 16,
    max: 2048,
    step: 16,
    help: 'Decoded 256×256 tiles kept in memory (about 64 KB each).',
  },
  {
    path: ['placement', 'prefetchMarginTiles'],
    label: 'Prefetch margin (tiles)',
    group: 'Performance',
    type: 'number',
    min: 0,
    max: 4,
    step: 1,
    help: 'Extra tiles loaded around the viewport so panning does not outrun the data.',
  },
];
