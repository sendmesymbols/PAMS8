/**
 * AnalysisSettingsManifest.ts
 *
 * On/off toggles for the suite of analysis engines (LOS, WEZ, Trajectory,
 * Buffer, Corridor, Flight, Effects, Dead Ground, Key Terrain, OP Ranker,
 * Position Defensibility, Local Peaks, Mission Planner, OCOKA).
 *
 * Per-engine configuration lives inside each engine's own widget panel (Peaks
 * already has one; the rest can grow theirs as needed).
 */

import type { SettingDescriptor } from '../Support/SettingsWidget';

const terrain = (key: string, label: string, help: string): SettingDescriptor => ({
  path: ['analysis', key],
  label,
  group: 'Terrain',
  type: 'boolean',
  help,
});
const force = (key: string, label: string, help: string): SettingDescriptor => ({
  path: ['analysis', key],
  label,
  group: 'Force & position',
  type: 'boolean',
  help,
});
const weap = (key: string, label: string, help: string): SettingDescriptor => ({
  path: ['analysis', key],
  label,
  group: 'Weapons & threats',
  type: 'boolean',
  help,
});
const route = (key: string, label: string, help: string): SettingDescriptor => ({
  path: ['analysis', key],
  label,
  group: 'Route & mission',
  type: 'boolean',
  help,
});

export const analysisSettingsManifest: SettingDescriptor[] = [
  {
    path: ['features', 'analysisEngines'],
    label: 'Analysis engines',
    group: 'Engine',
    type: 'boolean',
    help: 'Master switch for the whole analysis suite. When off, none of the analysis engines load and the Analysis context menu is hidden.',
    keywords: ['enable', 'disable', 'master'],
  },

  terrain('keyTerrain', 'Key Terrain Identifier', 'Identifies tactically significant terrain features (hills, saddles, spurs, reentrants).'),
  terrain('localPeaks', 'Peak Analysis', 'Detects terrain peaks and valleys in the area of operations.'),
  terrain('deadGround', 'Dead Ground Mapper', 'Maps terrain hidden from a chosen observer position.'),
  terrain('ocoka', 'OCOKA — Avenues of Approach', 'Multi-factor terrain analysis for avenues of approach.'),

  force('los', 'Line of Sight', 'Compute viewshed from an observer position.'),
  force('positionDefensibility', 'Position Defensibility Scorer', 'Rate a position\'s defensive value across 6 military factors.'),
  force('opRanker', 'Observation Post Ranker', 'Rank and compare candidate OP positions.'),

  weap('wez', 'Weapon Engagement Zone', 'Visualise weapon-system engagement coverage.'),
  weap('trajectory', 'Projectile Trajectory', 'Model projectile flight path and impact.'),
  weap('effects', 'Weapon Effects', 'Compute munitions effects radius (blast, fragments, shock).'),
  weap('buffer', 'Buffer & Threat Rings', 'Buffer zones and concentric threat rings.'),

  route('corridor', 'Corridor Analysis', 'Route corridor width, threats and chokepoints along MSRs.'),
  route('flight', 'UAV Flight Analysis', 'Plan UAV routes and analyse coverage.'),
  route('missionPlanner', 'Mission Planner Dashboard', 'Integrated multi-factor terrain analysis dashboard.'),
];
