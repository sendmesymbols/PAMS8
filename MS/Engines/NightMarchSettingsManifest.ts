/**
 * NightMarchSettingsManifest.ts
 *
 * Night March chart — bearings and paced legs from the SP to the FUP, the FUP marking layout and the timings back from
 * H (MS/Engines/NightMarch). Off by default. The terrain bundle is optional: without it the chart is worked out from the
 * geometry on open ground.
 */

import type { SettingDescriptor } from '../Support/SettingsWidget';

export const nightMarchSettingsManifest: SettingDescriptor[] = [
  {
    path: ['features', 'nightMarch'],
    label: 'Night March',
    group: 'Engine',
    type: 'boolean',
    help: 'Master switch. When on, 🌙 draws a route (click the SP and each turn, double-click the FUP, click the Obj) and makes the night march chart: legs with bearing and paces (120 paces = 100 m), time by night, the landmark each leg ends on, the FUP and start line marking layout, the marking stores and the timings back from H. A cursor card follows the mouse while drawing; W opens the chart at the foot of the map and walks its styles.',
    keywords: ['night march', 'march chart', 'bearing', 'paces', 'pace count', 'compass', 'fup', 'forming up place', 'start line', 'h hour', 'attack', 'nightMarch'],
  },
  {
    path: ['nightMarch', 'echelon'],
    label: 'For',
    group: 'March',
    type: 'enum',
    options: [
      { value: 'platoon', label: 'Platoon (FUP 100 x 60 m)' },
      { value: 'company', label: 'Company (FUP 200 x 120 m)' },
      { value: 'battalion', label: 'Battalion (FUP 450 x 300 m)' },
    ],
    help: 'The FUP\'s size and the places in it (MS/Data/NightMarchDoctrine.json layout: a proposal, two up and one or two back), and its shake-out time before H.',
  },
  {
    path: ['nightMarch', 'gmaDeg'],
    label: 'Grid-magnetic angle (° E +)',
    group: 'March',
    type: 'number',
    min: -30,
    max: 30,
    step: 0.1,
    help: 'The GMA from the map sheet, east positive. Magnetic bearing = grid bearing - GMA. Empty: bearings are grid and the chart says so.',
    keywords: ['gma', 'declination', 'magnetic', 'variation'],
  },
  {
    path: ['nightMarch', 'hHour'],
    label: 'H hour (HH:MM)',
    group: 'March',
    type: 'string',
    help: 'When the SL is crossed. Set: the chart gives clock times (leave the SP, each turn, the halts, in the FUP) and the night\'s light through the march. Empty: times are given as H-2:45.',
    keywords: ['h hour', 'timings', 'programme'],
  },
  {
    path: ['nightMarch', 'units'],
    label: 'Bearings in',
    group: 'March',
    type: 'enum',
    options: [
      { value: 'deg', label: 'Degrees' },
      { value: 'mils', label: 'Mils (6400)' },
      { value: 'both', label: 'Degrees and mils' },
    ],
    help: 'How the bearings are written on the cards, the chart and the map labels.',
  },
  {
    path: ['nightMarch', 'tanks'],
    label: 'Tanks with the attack',
    group: 'March',
    type: 'boolean',
    help: 'The tank FUP distance applies: 2500-3000 m from the objective instead of 1000-1200 m.',
  },
  {
    path: ['nightMarch', 'terrain'],
    label: 'Ground when not read',
    group: 'March',
    type: 'enum',
    options: [
      { value: 'plains', label: 'Plains (3 km/h by night)' },
      { value: 'desert', label: 'Desert (2.5 km/h)' },
      { value: 'mountain', label: 'Mountain ascent (1 km/h)' },
    ],
    help: 'The march table\'s night speed used when the terrain is not read (no bundle, or Read the terrain off). With the terrain the times follow the ground and slope.',
  },
  {
    path: ['nightMarch', 'useTerrain'],
    label: 'Read the terrain',
    group: 'March',
    type: 'boolean',
    help: 'Times by ground and slope, the landmark each leg ends on, skylines, obstacles crossed, villages passed, the ground hidden from the Obj and a linear feature for the SL, from the terrain bundle. Off: nothing is loaded and the chart is worked out from the geometry.',
  },
  {
    path: ['nightMarch', 'style'],
    label: 'Chart opens on',
    group: 'Display',
    type: 'enum',
    options: [
      { value: 'chart', label: 'Chart (table + checks)' },
      { value: 'strip', label: 'Strip (route unrolled)' },
      { value: 'cards', label: 'Cards (a pocket card per leg)' },
      { value: 'trace', label: 'Trace (route shape, north up)' },
      { value: 'fup', label: 'FUP (marking layout)' },
      { value: 'clock', label: 'Clock (march against the clock)' },
    ],
    help: 'The style the chart at the foot of the map opens on. W walks the pages then the styles; Shift+W goes back.',
  },
  {
    path: ['nightMarch', 'card'],
    label: 'Cursor card',
    group: 'Display',
    type: 'boolean',
    help: 'The card that follows the mouse while the route is drawn: compass dial with the drift cone, bearing, paces and pace cord, time by night, the landmark the leg would end on, hazards and the distance to the Obj against the enemy\'s night sights.',
  },
  {
    path: ['nightMarch', 'hover'],
    label: 'Card on a finished route',
    group: 'Display',
    type: 'boolean',
    help: 'With the mouse on a finished route, the card shows that leg: paces in and to go, when the column passes, the landmark at its end.',
  },
  {
    path: ['nightMarch', 'keys'],
    label: 'W opens the chart',
    group: 'Display',
    type: 'boolean',
    help: 'W opens the night march chart at the foot of the map and walks it (next page, then the next style); Shift+W goes back; Esc closes it.',
  },
  {
    path: ['nightMarch', 'map'],
    label: 'Show on the map',
    group: 'Display',
    type: 'boolean',
    help: 'The route with leg labels, turns, lamps, check points, halts, the FUP tape, the places in it, the SL and the axis tape, and the Obj.',
  },
  {
    path: ['nightMarch', 'rings'],
    label: 'Enemy sight rings',
    group: 'Display',
    type: 'boolean',
    help: 'The enemy\'s night sights (1200 m) and thermal (4 km) round the Obj.',
  },
  {
    path: ['nightMarch', 'labels'],
    label: 'Labels on the map',
    group: 'Display',
    type: 'boolean',
    help: 'Leg labels (bearing and paces), SL, FUP and the places in it.',
  },
  {
    path: ['nightMarch', 'bundleUrl'],
    label: 'Terrain bundle URL',
    group: 'Data',
    type: 'string',
    help: 'Folder that serves manifest.json, rules.json and the tiles (the same bundle as the Ground Guide).',
    advanced: true,
  },
  {
    path: ['nightMarch', 'useWorker'],
    label: 'Decode tiles in a worker',
    group: 'Data',
    type: 'boolean',
    help: 'Decode terrain tiles off the main thread (falls back automatically).',
    advanced: true,
  },
];
