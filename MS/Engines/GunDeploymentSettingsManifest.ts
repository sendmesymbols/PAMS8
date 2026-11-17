/**
 * GunDeploymentSettingsManifest.ts
 *
 * Gun Deployment — find gun areas for a Bty or Regt with crest clearance (MS/Engines/GunDeployment). Off by default.
 * Reads the terrain bundle only while on; figures in MS/Data/GunDoctrine.json.
 */

import type { SettingDescriptor } from '../Support/SettingsWidget';

export const gunDeploymentSettingsManifest: SettingDescriptor[] = [
  {
    path: ['features', 'gunDeployment'],
    label: 'Gun Deployment',
    group: 'Engine',
    type: 'boolean',
    help: 'Master switch. When on, the 🎯 Gun Depl panel finds gun areas round a place you pick: room for the Bty / Regt, level and firm ground, hidden from the air, a road in, the target in range, the distance behind the FDL, the crest toward the target (FM 6-50 angle of site and clearance, the range low-angle fire clears it from) and landmarks to avoid. Needs the terrain bundle.',
    keywords: ['gun', 'gun area', 'gun posn', 'paa', 'artillery', 'arty', 'battery', 'regiment', 'crest clearance', 'min qe', 'gunDeployment'],
  },
  {
    path: ['gunDeployment', 'weapon'],
    label: 'Gun (weapons.json id)',
    group: 'Guns',
    type: 'string',
    help: 'The own gun from the ORBAT (MS/Data/Orbat/PK/weapons.json), e.g. 155-mm-how-sp-m109-a2-a5, 122-mm-how-d-30, 130-mm-gun. The panel lists them all.',
  },
  {
    path: ['gunDeployment', 'unit'],
    label: 'Area for',
    group: 'Guns',
    type: 'enum',
    options: [
      { value: 'bty', label: 'Bty (400 x 200 m, FM 6-50)' },
      { value: 'regt', label: "Regt (1000 x 1000 m, SO's Hbk p 225)" },
    ],
    help: 'The size of the gun area the finder fits on the ground.',
  },
  {
    path: ['gunDeployment', 'op'],
    label: 'Task',
    group: 'Guns',
    type: 'enum',
    options: [
      { value: 'def', label: 'Defence' },
      { value: 'attk', label: 'Attack' },
    ],
    help: 'How far behind the front the guns may stand (2/3 of the range kept forward, SZ Battle p 24).',
  },
  {
    path: ['gunDeployment', 'radiusKm'],
    label: 'Search radius (km)',
    group: 'Search',
    type: 'number',
    min: 1,
    max: 20,
    step: 0.5,
    help: 'How far round the picked place gun areas are looked for.',
  },
  {
    path: ['gunDeployment', 'month'],
    label: 'Month (0 = this month)',
    group: 'Search',
    type: 'number',
    min: 0,
    max: 12,
    step: 1,
    help: "The soil after rain or dry (the month's rain at the place) and what grows on the ground (crops raise the crest).",
  },
  {
    path: ['gunDeployment', 'map'],
    label: 'Draw on the map',
    group: 'Map',
    type: 'boolean',
    help: 'The search circle, the gun areas by verdict, the line of fire, the crest, the stretch low-angle fire cannot reach and the range arcs.',
  },
  {
    path: ['gunDeployment', 'labels'],
    label: 'Labels on the map',
    group: 'Map',
    type: 'boolean',
    help: "Ranks, the crest's angles, ranges.",
  },
  {
    path: ['gunDeployment', 'bundleUrl'],
    label: 'Terrain bundle URL',
    group: 'Data',
    type: 'string',
    advanced: true,
    help: 'Where the terrain bundle is served (default /terrain-bundle).',
  },
  {
    path: ['gunDeployment', 'orbatUrl'],
    label: 'ORBAT folder URL',
    group: 'Data',
    type: 'string',
    advanced: true,
    help: 'Folder with weapons.json (default /MS/Data/Orbat/PK).',
  },
  {
    path: ['gunDeployment', 'useWorker'],
    label: 'Read tiles in a worker',
    group: 'Data',
    type: 'boolean',
    advanced: true,
    help: 'Fetch and decode terrain tiles off the main thread (falls back automatically).',
  },
];
