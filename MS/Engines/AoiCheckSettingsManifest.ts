/**
 * AoiCheckSettingsManifest.ts
 *
 * AOI Check — terrain data cover, gaps and sources over an area before planning (MS/Engines/AoiCheck). Off by default;
 * fetches nothing until a check is asked for.
 */

import type { SettingDescriptor } from '../Support/SettingsWidget';

export const aoiCheckSettingsManifest: SettingDescriptor[] = [
  {
    path: ['features', 'aoiCheck'],
    label: 'AOI Check',
    group: 'Engine',
    type: 'boolean',
    help: "Master switch. When on, the 🗺 AOI Check panel checks an area (drawn, or this view) against the terrain bundle: the share inside the data's frame, missing tiles and no-data patches per layer, the movers it has, the feature, road, population, climate and visibility data, the build date, and every source with its date and licence. Gaps are painted on the map with the readings they blank.",
    keywords: ['aoi', 'area of interest', 'preflight', 'coverage', 'missing tiles', 'terrain data', 'bundle', 'licence', 'sources', 'gaps', 'aoiCheck'],
  },
  {
    path: ['aoiCheck', 'maxTiles'],
    label: 'Most tiles per layer',
    group: 'Check',
    type: 'number',
    min: 8,
    max: 400,
    step: 8,
    help: 'A bigger AOI is checked at a coarser zoom so each layer needs no more tiles than this (the panel says when it is coarser than the readers use).',
  },
  {
    path: ['aoiCheck', 'map'],
    label: 'Draw on the map',
    group: 'Map',
    type: 'boolean',
    help: "The AOI, gap tiles (red: Gr class or heights; amber: other layers) and the data's frame.",
  },
  {
    path: ['aoiCheck', 'labels'],
    label: 'Labels on the map',
    group: 'Map',
    type: 'boolean',
    help: 'How many layers each gap tile misses.',
  },
  {
    path: ['aoiCheck', 'bundleUrl'],
    label: 'Terrain bundle URL',
    group: 'Data',
    type: 'string',
    advanced: true,
    help: 'Where the terrain bundle is served (default /terrain-bundle).',
  },
  {
    path: ['aoiCheck', 'useWorker'],
    label: 'Read tiles in a worker',
    group: 'Data',
    type: 'boolean',
    advanced: true,
    help: 'Fetch and decode terrain tiles off the main thread (falls back automatically).',
  },
];
