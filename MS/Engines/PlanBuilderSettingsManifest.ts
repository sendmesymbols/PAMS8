/**
 * PlanBuilderSettingsManifest.ts
 *
 * The Build tab of the Deployment Mgr (PlanBuilder_Plan.md): a doctrinal baseline plan from the task, the unit's ORBAT
 * and the ground. Recipes live in MS/Data/Deployments/Recipes, figures in MS/Data/PlanDoctrine.json. Off by default.
 * The terrain bundle is optional: without it the plan is laid by geometry and every ground check reads "not checked".
 */

import type { SettingDescriptor } from '../Support/SettingsWidget';

export const planBuilderSettingsManifest: SettingDescriptor[] = [
  {
    path: ['features', 'planBuilder'],
    label: 'Intelligent Deployment tab (baseline plans)',
    group: 'Engine',
    type: 'boolean',
    help: 'Adds an Intelligent Deployment tab to the Deployment Mgr beside Templates (on by default: it loads nothing until the tab is opened). Pick the task, echelon, unit and layout (two up, three up, one up, all round, Auto), mark the threat, then Place on Map: the plan follows the cursor as a quick ghost, fits itself to the ground when the mouse rests, and a click places it as ordinary symbols in one undo step. Off: the tab is not shown and nothing is loaded.',
    keywords: ['intelligent deployment', 'plan builder', 'build', 'baseline plan', 'deployment', 'defence', 'two up', 'three up', 'layout', 'recipe', 'planBuilder'],
  },
  {
    path: ['planBuilder', 'useTerrain'],
    label: 'Fit to the terrain',
    group: 'Fit',
    type: 'boolean',
    help: 'Read the terrain bundle to slide posns out of NO-GO ground and water, check fields of fire, flanks, exposure and the approaches, and rank the layouts (Auto). Off: nothing is loaded; the plan is laid by doctrinal spacing alone and the ground checks show grey "not checked", never green.',
  },
  {
    path: ['planBuilder', 'fit', 'atRest'],
    label: 'Fit when the mouse rests',
    group: 'Fit',
    type: 'boolean',
    help: 'While placing: a quick ghost while the mouse moves, the full fit (slide, checks, ranking) once it stops. Off: the full fit runs only on the click that places the plan.',
  },
  {
    path: ['planBuilder', 'fit', 'restMs'],
    label: 'Rest before the fit (ms)',
    group: 'Fit',
    type: 'number',
    min: 150,
    max: 1500,
    step: 50,
    help: 'How long the mouse must stay still before the full fit runs.',
  },
  {
    path: ['planBuilder', 'auto', 'enabled'],
    label: 'Auto ranks the layouts',
    group: 'Fit',
    type: 'boolean',
    help: 'Fit every layout of the family on the spot and rank them by the score card (fails first, then warnings, then the weighted score in PlanDoctrine.json). Needs the terrain.',
  },
  {
    path: ['planBuilder', 'alternates', 'show'],
    label: 'Show alternates while building',
    group: 'Display',
    type: 'boolean',
    help: 'Alternate posns (dashed) with the route and time from each main posn.',
  },
  {
    path: ['planBuilder', 'alternates', 'create'],
    label: 'Alternates on Create on Map',
    group: 'Display',
    type: 'enum',
    options: [
      { value: 'hidden', label: 'Created, hidden' },
      { value: 'visible', label: 'Created, shown' },
      { value: 'none', label: 'Not created' },
    ],
    help: 'Whether the alternate and supplementary posns go on the map with the plan (planned status, dashed).',
  },
  {
    path: ['planBuilder', 'card'],
    label: 'Card at the cursor',
    group: 'Display',
    type: 'boolean',
    help: 'While placing, a small card beside the cursor: the layouts ranked on the spot and the worst check.',
  },
  {
    path: ['planBuilder', 'labelSize'],
    label: 'Label size on built plans (pt)',
    group: 'Display',
    type: 'number',
    min: 5,
    max: 16,
    step: 1,
    help: 'Text size of the designations a built plan writes (A Coy, T1, FUP, Alt A). 7 pt is half the usual label size, so a Bn plan stays readable at the scale it is placed.',
  },
  {
    path: ['planBuilder', 'gmaDeg'],
    label: 'Grid-magnetic angle for route cards (° E +)',
    group: 'Display',
    type: 'number',
    min: -30,
    max: 30,
    step: 0.1,
    help: 'The GMA from the map sheet, east positive: a patrol\'s route card then gives magnetic bearings too (magnetic = grid - GMA). Empty: grid bearings and mils only.',
    keywords: ['gma', 'declination', 'magnetic', 'patrol', 'route card'],
  },
  {
    path: ['planBuilder', 'map', 'approachBands'],
    label: 'Enemy approaches on the map',
    group: 'Display',
    type: 'boolean',
    help: 'The approaches found from the threat, as bands with their chokepoints. Needs the terrain.',
  },
  {
    path: ['planBuilder', 'threat', 'fromEnemySymbols'],
    label: 'Read enemy symbols as the threat',
    group: 'Fit',
    type: 'boolean',
    help: 'Also take hostile symbols already on the map as where the enemy comes from. Off: the threat is the marker only.',
  },
  {
    path: ['planBuilder', 'recipesUrl'],
    label: 'Recipes URL',
    group: 'Data',
    type: 'string',
    help: 'Folder serving index.json and one JSON file per recipe.',
    advanced: true,
  },
  {
    path: ['planBuilder', 'orbatUrl'],
    label: 'ORBAT URL',
    group: 'Data',
    type: 'string',
    help: 'Folder serving the ORBAT (inf.json, en.json, weapons.json, engr.json from SO\'s Hbk 2019): the unit types, their weapons and ranges, APCs, the enemy\'s units and the minelaying rates. Missing: the doctrine figures stand.',
    advanced: true,
  },
  {
    path: ['planBuilder', 'bundleUrl'],
    label: 'Terrain bundle URL',
    group: 'Data',
    type: 'string',
    help: 'Folder that serves manifest.json, rules.json and the tiles (the same bundle as the Ground Guide).',
    advanced: true,
  },
  {
    path: ['planBuilder', 'useWorker'],
    label: 'Decode tiles in a worker',
    group: 'Data',
    type: 'boolean',
    help: 'Decode terrain tiles off the main thread (falls back automatically).',
    advanced: true,
  },
];
