/**
 * AdminAreaSettingsManifest.ts
 *
 * Admin Area — find ground for admin areas and echelons (MS/Engines/AdminArea). Off by default. Reads the terrain bundle
 * only while on; figures in MS/Data/AdminDoctrine.json.
 */

import type { SettingDescriptor } from '../Support/SettingsWidget';

export const adminAreaSettingsManifest: SettingDescriptor[] = [
  {
    path: ['features', 'adminArea'],
    label: 'Admin Area',
    group: 'Engine',
    type: 'boolean',
    help: "Master switch. When on, the 🏕 Admin Area panel finds ground for a Unit Ech, BAA, DAA, RP, Amn / Sup / POL Pt or ADS round a place you pick: clear of the enemy guns from the threat place, the DAA's distance behind the front, firm and flood-free in the month, room to disperse, hidden from the air, a class 50 road in and the area off the main road, away from bridges and junctions, water and pucca buildings near. Needs the terrain bundle.",
    keywords: ['admin area', 'baa', 'daa', 'b ech', 'a ech', 'echelon', 'rp', 'replenishment point', 'ammunition point', 'pol point', 'ads', 'support area', 'bsa', 'dsa', 'logistics', 'adminArea'],
  },
  {
    path: ['adminArea', 'kind'],
    label: 'Kind',
    group: 'Area',
    type: 'enum',
    options: [
      { value: 'ech', label: 'Unit Ech (A / B Ech harbour)' },
      { value: 'baa', label: 'Bde Admin Area (BAA)' },
      { value: 'daa', label: 'Div Admin Area (DAA)' },
      { value: 'rp', label: 'Replenishment Point (RP)' },
      { value: 'ap', label: 'Amn / Sup / POL Pt' },
      { value: 'ads', label: 'ADS (Med)' },
    ],
    help: 'The admin area the panel opens on: its size, the enemy guns it must be clear of and what it needs nearby.',
  },
  {
    path: ['adminArea', 'op'],
    label: 'Operation',
    group: 'Area',
    type: 'enum',
    options: [
      { value: 'def', label: 'Defence (DAA 48 km back)' },
      { value: 'adv', label: 'Advance (DAA 15-20 km)' },
      { value: 'wdr', label: 'Withdrawal (DAA about 33 km)' },
    ],
    help: "The DAA's distance from forward troops (SO's Hbk Sec 10 p 1055).",
  },
  {
    path: ['adminArea', 'month'],
    label: 'Month (0 = this month)',
    group: 'Area',
    type: 'number',
    min: 0,
    max: 12,
    step: 1,
    help: "Firm and flood-free in this month (the month's rain at the place).",
  },
  {
    path: ['adminArea', 'gunDepthKm'],
    label: 'His guns behind the threat place (km)',
    group: 'Enemy',
    type: 'number',
    min: 0,
    max: 20,
    step: 0.5,
    help: "0 measures his guns' reach from the threat place itself (the safe side). Set it only when you know where his gun areas are.",
  },
  {
    path: ['adminArea', 'map'],
    label: 'Draw on the map',
    group: 'Map',
    type: 'boolean',
    help: "The search circle, the sites by verdict, his guns' reach from the threat place, the way to the road.",
  },
  {
    path: ['adminArea', 'labels'],
    label: 'Labels on the map',
    group: 'Map',
    type: 'boolean',
    help: "Ranks, his guns' reach, the road distance.",
  },
  {
    path: ['adminArea', 'bundleUrl'],
    label: 'Terrain bundle URL',
    group: 'Data',
    type: 'string',
    advanced: true,
    help: 'Where the terrain bundle is served (default /terrain-bundle).',
  },
  {
    path: ['adminArea', 'orbatUrl'],
    label: 'ORBAT folder URL',
    group: 'Data',
    type: 'string',
    advanced: true,
    help: 'Folder with weapons.json (default /MS/Data/Orbat/PK).',
  },
  {
    path: ['adminArea', 'useWorker'],
    label: 'Read tiles in a worker',
    group: 'Data',
    type: 'boolean',
    advanced: true,
    help: 'Fetch and decode terrain tiles off the main thread (falls back automatically).',
  },
];
