import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import ContextMenuManager from '../Managers/ContextMenuManager';
import WeaponEffectEngine from './Analysis/WeaponEffectEngine';
import LOSEngine from './Analysis/LOSEngine';
import TrajectoryEngine from './Analysis/TrajectoryEngine';
import BufferEngine from './Analysis/BufferEngine';
import CorridorEngine from './Analysis/CorridorEngine';
import FlightEngine from './Analysis/FlightEngine';
import { EffectEngine } from './Analysis/EffectEngine';
import DeadGroundMapper from './Analysis/DeadGroundMapper';
import KeyTerrainIdentificationEngine from './Analysis/KeyTerrain/KeyTerrainIdentificationEngine';
import PosDefScorerEngine from './Analysis/PositionDefesibilityScorer/PosDefScorerEngine';
import OpRankerEngine from './Analysis/OpRanker/OpRankerEngine';
import LocalPeaksEngine from './Analysis/Peaks/LocalPeaksEngine';
import OcokaEngine from './OCOKA/Ocoka';
import MissionPlannerEngine from './MissionPlanner/MissionPlannerEngine';
export type AnalysisKey = 'wez' | 'los' | 'trajectory' | 'buffer' | 'corridor' | 'effects' | 'flight' | 'deadGround' | 'keyTerrain' | 'positionDefensibility' | 'opRanker' | 'localPeaks' | 'ocoka' | 'missionPlanner';
export interface AnalysisRegistryDeps {
    getView: () => MapView | SceneView;
    contextMenuManager: ContextMenuManager;
    emitEvent: (eventName: string, data: any) => void;
}
/**
 * Owns construction, destruction, view re-attachment, and runtime
 * enable/disable of the 14 analysis engines. Extracted from SymbolEngine
 * to consolidate ~28 near-identical init and destroy methods behind one
 * config-driven entry point.
 *
 * SymbolEngine retains typed getters (weaponEffectEngine, losEngine, …) and
 * the per-engine init/destroy methods as thin delegates so external callers
 * and existing call sites are unchanged.
 */
export default class AnalysisEngineRegistry {
    private readonly deps;
    private _wez;
    private _los;
    private _trajectory;
    private _buffer;
    private _corridor;
    private _effects;
    private _flight;
    private _deadGround;
    private _keyTerrain;
    private _posDef;
    private _opRanker;
    private _localPeaks;
    private _ocoka;
    private _missionPlanner;
    private readonly SPECS;
    constructor(deps: AnalysisRegistryDeps);
    get weaponEffectEngine(): WeaponEffectEngine | null;
    get losEngine(): LOSEngine | null;
    get trajectoryEngine(): TrajectoryEngine | null;
    get bufferEngine(): BufferEngine | null;
    get corridorEngine(): CorridorEngine | null;
    get effectEngine(): EffectEngine | null;
    get flightEngine(): FlightEngine | null;
    get deadGroundMapper(): DeadGroundMapper | null;
    get keyTerrainIdentificationEngine(): KeyTerrainIdentificationEngine | null;
    get posDefScorerEngine(): PosDefScorerEngine | null;
    get opRankerEngine(): OpRankerEngine | null;
    get localPeaksEngine(): LocalPeaksEngine | null;
    get ocokaEngine(): OcokaEngine | null;
    get missionPlannerEngine(): MissionPlannerEngine | null;
    /** Has the engine been constructed? */
    has(key: AnalysisKey): boolean;
    /**
     * Initialise a single engine if the master analysisEngines flag is on AND
     * the individual analysis.<key> flag is on AND it isn't already loaded.
     */
    init(key: AnalysisKey): void;
    /** Destroy a single engine and unlink it from the context menu. */
    destroy(key: AnalysisKey): void;
    /**
     * Initialise all enabled engines (respects master + individual flags).
     *
     * Each engine's construction wires context-menu entries and view listeners,
     * which is non-trivial work × 14. Doing it synchronously on boot pushed
     * first-paint out by tens of ms. Instead we schedule each engine on the
     * browser's idle queue so the main thread can finish the first frame, then
     * trickle in the analysis engines one tick at a time. Context-menu items
     * appear within a few ms of boot completion, before the user could plausibly
     * right-click.
     *
     * `force === true` keeps the eager path for callers that need every engine
     * built immediately (e.g. tests, or a synchronous setEnabled toggle).
     */
    initAll(force?: boolean): void;
    /** Destroy every engine and tell the context menu the analysis tools are gone. */
    destroyAll(): void;
    /** Toggle a single engine on or off at runtime (called from onSettingChanged). */
    setEnabled(key: AnalysisKey, enabled: boolean): void;
    /** Re-attach every loaded engine to the new view (called on view switch). */
    onViewChanged(newView: MapView | SceneView): void;
    private getInstance;
    private setInstance;
}
