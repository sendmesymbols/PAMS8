/**
 * PlatoonGuideSettingsManifest.ts
 *
 * Platoon Guide — what a section, platoon or company commander needs at a point, read from the terrain bundle
 * (MS/Engines/PlatoonGuide). Off by default; while off it never looks for the bundle.
 */

import type { SettingDescriptor } from '../Support/SettingsWidget';

export const platoonGuideSettingsManifest: SettingDescriptor[] = [
  {
    path: ['features', 'platoonGuide'],
    label: 'Platoon Guide',
    group: 'Engine',
    type: 'boolean',
    help: 'Master switch. When on, the Pl Guide reads the point under the cursor (Hover), a Team / Sec / Pl / Coy being placed or selected, or a selected line: the going, cover, water, way out, landing site and hospital; what you see and what is dead ground; likely mine / IED and ambush sites round you; people and BUA; help; where to stop; and the patrol route card. Needs the terrain bundle; when off, nothing is loaded and drawing is unchanged.',
    keywords: ['platoon', 'section', 'company', 'ground card', 'patrol', 'water', 'dead ground', 'ied', 'ambush', 'casevac', 'field', 'soldier', 'platoonGuide'],
  },
  {
    path: ['platoonGuide', 'hover'],
    label: 'Read where the mouse is',
    group: 'Reading',
    type: 'boolean',
    help: 'Read the point under the cursor without drawing anything: quick reads on every move, the full reading when the cursor rests.',
  },
  {
    path: ['platoonGuide', 'onSymbols'],
    label: 'Read Team to Coy symbols',
    group: 'Reading',
    type: 'boolean',
    help: 'Read a land unit of Team, Section, Platoon or Company echelon while it is placed and when it is selected; a selected line gets the patrol route card.',
  },
  {
    path: ['platoonGuide', 'echelon'],
    label: 'Bubble when no symbol gives one',
    group: 'Reading',
    type: 'enum',
    options: [
      { value: 'team', label: 'Team (300 m)' },
      { value: 'section', label: 'Section (500 m)' },
      { value: 'platoon', label: 'Platoon (1 km)' },
      { value: 'company', label: 'Company (2 km)' },
    ],
    help: 'How far round the point the dangers, people, help and where-to-stop are read (MS/Data/PlatoonDoctrine.json bubble.radiusM). A placed symbol uses its own echelon.',
  },
  {
    path: ['platoonGuide', 'eye'],
    label: 'Eye height',
    group: 'Reading',
    type: 'enum',
    options: [
      { value: 'prone', label: 'Prone (0.5 m)' },
      { value: 'kneeling', label: 'Kneeling (1 m)' },
      { value: 'standing', label: 'Standing (1.6 m)' },
      { value: 'rooftop', label: 'On a roof (6 m)' },
    ],
    help: 'The eye the visibility sketch, range card and resection are read from.',
  },
  {
    path: ['platoonGuide', 'mover'],
    label: 'Vehicles',
    group: 'Reading',
    type: 'enum',
    options: [
      { value: 'wheeled', label: 'Wheeled' },
      { value: 'tracked', label: 'Tracked' },
    ],
    help: 'Whose NO-GO decides the vehicle way out and where a vehicle cannot leave the road (likely ambush sites).',
  },
  {
    path: ['platoonGuide', 'threat'],
    label: 'Threat place',
    group: 'Reading',
    type: 'enum',
    options: [
      { value: 'groundGuide', label: 'Ground Guide threat marker' },
      { value: 'none', label: 'None' },
    ],
    help: 'Where the threat is for the patrol route card (stretches hidden from it and exposed to it): the marker dragged in the Ground Guide OCOKA lens. Enemy symbols are never read.',
  },
  {
    path: ['platoonGuide', 'map'],
    label: 'Show on the map',
    group: 'Display',
    type: 'boolean',
    help: 'The bubble, lettered markers (W water, C cover, H landing Gr, + hospital, K KM stone, M / A likely mine and ambush sites, PB patrol base, OP), and the patrol route card.',
  },
  {
    path: ['platoonGuide', 'mapSight'],
    label: 'Dead Gr on the map',
    group: 'Display',
    type: 'boolean',
    help: 'Paint dead ground (red) and ground screened by crops, trees and buildings (amber) round the point. The panel\'s sketch always shows it.',
  },
  {
    path: ['platoonGuide', 'card'],
    label: 'Cursor card',
    group: 'Display',
    type: 'boolean',
    help: 'The small card that follows the cursor while hovering or placing a Team to Coy, like the Ground Guide\'s: going on foot, way out, water, the lead danger, casevac and people. It stays hidden while the Ground Guide\'s own card is on the cursor.',
  },
  {
    path: ['platoonGuide', 'keys'],
    label: 'A opens the Pl Detail',
    group: 'Display',
    type: 'boolean',
    help: 'A opens the Pl Detail docked at the foot of the map and walks it (next page, then the next tab: Here, See, Danger, People, Help, Stop, Patrol); Shift+A goes back; Esc closes it. A selected symbol or a right-click opens it too.',
  },
  {
    path: ['platoonGuide', 'bundleUrl'],
    label: 'Terrain bundle URL',
    group: 'Data',
    type: 'string',
    help: 'Folder that serves manifest.json, rules.json and the tiles (the same bundle as the Ground Guide).',
    advanced: true,
  },
  {
    path: ['platoonGuide', 'useWorker'],
    label: 'Decode tiles in a worker',
    group: 'Data',
    type: 'boolean',
    help: 'Decode terrain tiles off the main thread (falls back automatically).',
    advanced: true,
  },
];
