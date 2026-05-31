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
export declare const analysisSettingsManifest: SettingDescriptor[];
