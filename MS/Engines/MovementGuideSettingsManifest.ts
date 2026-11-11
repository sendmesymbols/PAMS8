/**
 * MovementGuideSettingsManifest.ts
 *
 * Movement Guide — eight cards for the safety of the move (cordon, picketing, convoy, likely mines, patrol + night
 * march chart, ambush, road block / tank ambush, infiltration), read from the terrain bundle
 * (MS/Engines/MovementGuide). Off by default; while off it never looks for the bundle. Each card's own settings live
 * on the card.
 */

import type { SettingDescriptor } from '../Support/SettingsWidget';

export const movementGuideSettingsManifest: SettingDescriptor[] = [
  {
    path: ['features', 'movementGuide'],
    label: 'Movement Guide',
    group: 'Engine',
    type: 'boolean',
    help: 'Master switch. When on, the Mov Guide cards open: Cordon, Picket, Convoy, Mines, Patrol, Ambush, Rd Block and Infil. Each works out its plan from what you draw on the card (a town, a route, two points, a line) and can create it on the map as symbols. Needs the terrain bundle; when off, nothing is loaded and drawing is unchanged.',
    keywords: ['movement', 'route', 'convoy', 'picket', 'piquet', 'cordon', 'ambush', 'mine', 'ied', 'patrol', 'march chart', 'road block', 'infiltration', 'safety'],
  },
  {
    path: ['movementGuide', 'threat'],
    label: 'Threat place',
    group: 'Reading',
    type: 'enum',
    options: [
      { value: 'groundGuide', label: 'Ground Guide threat marker' },
      { value: 'none', label: 'None' },
    ],
    help: 'Where the threat is for "the threat may see" (routes, patrols): the marker dragged in the Ground Guide OCOKA lens. Enemy symbols are never read.',
  },
  {
    path: ['movementGuide', 'map'],
    label: 'Show on the map',
    group: 'Display',
    type: 'boolean',
    help: "Draw the open card's plan on the map (ribbon, pickets, cordon, bounds, routes, lanes). Create on Map adds the plan as symbols either way.",
  },
  {
    path: ['movementGuide', 'cursor'],
    label: 'Cursor card',
    group: 'Display',
    type: 'boolean',
    help: 'A small card beside the mouse while the Mov Detail is open: what is under the pointer for the open card (the route km and dangers, the picket that sees it, the bound and packet times, the sector, the patrol leg, the lane).',
  },
  {
    path: ['movementGuide', 'keys'],
    label: 'Keys (N, 1-8)',
    group: 'Display',
    type: 'boolean',
    help: 'N opens and closes the Mov Detail; while it is open, 1 Cordon, 2 Picket, 3 Convoy, 4 Mines, 5 Patrol, 6 Ambush, 7 Rd Block, 8 Infil, and the same number again turns the page (Shift turns back). Esc closes it.',
  },
  {
    path: ['movementGuide', 'bundleUrl'],
    label: 'Terrain bundle URL',
    group: 'Data',
    type: 'string',
    help: 'Folder that serves manifest.json, rules.json and the tiles (the same bundle as the Ground Guide).',
    advanced: true,
  },
  {
    path: ['movementGuide', 'useWorker'],
    label: 'Decode tiles in a worker',
    group: 'Data',
    type: 'boolean',
    help: 'Decode terrain tiles off the main thread (falls back automatically).',
    advanced: true,
  },
];
