/**
 * MovePlannerSettingsManifest.ts
 *
 * Move Planner — Rd Mov, Mov & Assy, DI Mov (de-induction), Rly Mov and En Mov (MS/Engines/MovePlanner). Off by default.
 * Rules and figures in MS/Data/MoveDoctrine.json. Does not read the terrain bundle; solves routes on the road network
 * only when it is on and up.
 */

import type { SettingDescriptor } from '../Support/SettingsWidget';

export const movePlannerSettingsManifest: SettingDescriptor[] = [
  {
    path: ['features', 'movePlanner'],
    label: 'Move Planner',
    group: 'Engine',
    type: 'boolean',
    help: 'Master switch. When on, U opens the Mov Plan panel at the foot of the map: road moves (serials, TPP, halts, harbours, mov table and graph), move and assembly (block timings, matrix, assembly area size), de-induction (corps / group / unit priorities at crossings, progress by day, arm-wise and HMT reports), rail moves (vehicles onto wagons, trains within 72 C units and 2,000 tons, timetable, stock required) and enemy moves (trains, arrival, induction matrix).',
    keywords: ['move', 'movement', 'mov plan', 'mov table', 'road move', 'rail move', 'de-induction', 'induction', 'assembly', 'tpp', 'time past a point', 'march table', 'train', 'movePlanner'],
  },
  {
    path: ['movePlanner', 'kind'],
    label: 'Opens on',
    group: 'Plan',
    type: 'enum',
    options: [
      { value: 'road', label: 'Rd Mov' },
      { value: 'assy', label: 'Mov & Assy' },
      { value: 'di', label: 'DI Mov (de-induction)' },
      { value: 'rail', label: 'Rly Mov' },
      { value: 'enemy', label: 'En Mov' },
    ],
    help: 'The kind of plan the panel shows first. Each kind keeps its own plan.',
  },
  {
    path: ['movePlanner', 'utcOffsetMin'],
    label: 'Time zone (min east of UTC)',
    group: 'Plan',
    type: 'number',
    min: -720,
    max: 840,
    step: 30,
    help: 'The zone of new plans\' clocks (Pakistan 300). A plan keeps its own zone once made.',
  },
  {
    path: ['movePlanner', 'useNetwork'],
    label: 'Solve routes on the road network',
    group: 'Routes',
    type: 'boolean',
    help: '"+ Route on Rds" solves the clicks on the road network when it is on and up (with its load class, MSR share and weakest crossing noted); otherwise the clicks are the route.',
    keywords: ['route', 'road network', 'geocore'],
  },
  {
    path: ['movePlanner', 'routeMlc'],
    label: 'Load class for solved routes',
    group: 'Routes',
    type: 'number',
    min: 0,
    max: 120,
    step: 1,
    help: 'Keep solved routes to roads that carry this class (tanks 50, transporter with tank 80; SO\'s Handbook 916). Empty: no limit.',
    keywords: ['mlc', 'load class', 'bridge'],
  },
  {
    path: ['movePlanner', 'map'],
    label: 'Draw on the map',
    group: 'Map',
    type: 'boolean',
    help: 'Routes, SP / Rel P / CPs, halts, harbours, crossing waits, stations, and the columns at the timeline\'s time.',
  },
  {
    path: ['movePlanner', 'labels'],
    label: 'Labels on the map',
    group: 'Map',
    type: 'boolean',
    help: 'Names of routes and points, harbours with their times, who waits at each crossing.',
  },
  {
    path: ['movePlanner', 'halts'],
    label: 'Halts on the map',
    group: 'Map',
    type: 'boolean',
    help: 'Short halts (square), long halts (circle), harbours (orange diamond), close-up at last light (blue).',
  },
  {
    path: ['movePlanner', 'keys'],
    label: 'Keys',
    group: 'Panel',
    type: 'boolean',
    help: 'U opens / closes the panel, Shift+U walks its views, Esc closes it.',
  },
  {
    path: ['movePlanner', 'remember'],
    label: 'Keep plans in this browser',
    group: 'Panel',
    type: 'boolean',
    help: 'Each kind\'s plan is kept between visits on this computer. Save / Open in the panel moves plans as .json files.',
  },
];
