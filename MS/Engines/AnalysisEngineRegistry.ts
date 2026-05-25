import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';

import ContextMenuManager from '../Managers/ContextMenuManager';
import settingsData from '../Data/Settings.json';

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

export type AnalysisKey =
  | 'wez'
  | 'los'
  | 'trajectory'
  | 'buffer'
  | 'corridor'
  | 'effects'
  | 'flight'
  | 'deadGround'
  | 'keyTerrain'
  | 'positionDefensibility'
  | 'opRanker'
  | 'localPeaks'
  | 'ocoka'
  | 'missionPlanner';

interface AnalysisSpec {
  factory: () => any;
  link: (cmm: ContextMenuManager, inst: any) => void;
  unlink: (cmm: ContextMenuManager) => void;
  readyEvent: string;
  logName: string;
  /** Hook used by onViewChanged. Defaults to `inst.initialize(view)`. */
  onViewChanged?: (inst: any, view: MapView | SceneView) => void;
}

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
  private _wez: WeaponEffectEngine | null = null;
  private _los: LOSEngine | null = null;
  private _trajectory: TrajectoryEngine | null = null;
  private _buffer: BufferEngine | null = null;
  private _corridor: CorridorEngine | null = null;
  private _effects: EffectEngine | null = null;
  private _flight: FlightEngine | null = null;
  private _deadGround: DeadGroundMapper | null = null;
  private _keyTerrain: KeyTerrainIdentificationEngine | null = null;
  private _posDef: PosDefScorerEngine | null = null;
  private _opRanker: OpRankerEngine | null = null;
  private _localPeaks: LocalPeaksEngine | null = null;
  private _ocoka: OcokaEngine | null = null;
  private _missionPlanner: MissionPlannerEngine | null = null;

  private readonly SPECS: Record<AnalysisKey, AnalysisSpec> = {
    wez: {
      factory: () => new WeaponEffectEngine(),
      link: (cmm, e) => cmm.linkWeaponEffectEngine(e),
      unlink: (cmm) => cmm.linkWeaponEffectEngine(null),
      readyEvent: 'weaponEffectEngineReady',
      logName: 'WeaponEffectEngine',
    },
    los: {
      factory: () => new LOSEngine(),
      link: (cmm, e) => cmm.linkLOSEngine(e),
      unlink: (cmm) => cmm.linkLOSEngine(null),
      readyEvent: 'losEngineReady',
      logName: 'LOSEngine',
    },
    trajectory: {
      factory: () => new TrajectoryEngine(),
      link: (cmm, e) => cmm.linkTrajectoryEngine(e),
      unlink: (cmm) => cmm.linkTrajectoryEngine(null),
      readyEvent: 'trajectoryEngineReady',
      logName: 'TrajectoryEngine',
    },
    buffer: {
      factory: () => new BufferEngine(),
      link: (cmm, e) => cmm.linkBufferEngine(e),
      unlink: (cmm) => cmm.linkBufferEngine(null),
      readyEvent: 'bufferEngineReady',
      logName: 'BufferEngine',
    },
    corridor: {
      factory: () => new CorridorEngine(),
      link: (cmm, e) => cmm.linkCorridorEngine(e),
      unlink: (cmm) => cmm.linkCorridorEngine(null),
      readyEvent: 'corridorEngineReady',
      logName: 'CorridorEngine',
    },
    effects: {
      factory: () => new EffectEngine(),
      link: (cmm, e) => cmm.linkEffectEngine(e),
      unlink: (cmm) => cmm.linkEffectEngine(null),
      readyEvent: 'effectEngineReady',
      logName: 'EffectEngine',
    },
    flight: {
      factory: () => new FlightEngine(),
      link: (cmm, e) => cmm.linkFlightEngine(e),
      unlink: (cmm) => cmm.linkFlightEngine(null),
      readyEvent: 'flightEngineReady',
      logName: 'FlightEngine',
    },
    deadGround: {
      factory: () => new DeadGroundMapper(),
      link: (cmm, e) => cmm.linkDeadGroundMapper(e),
      unlink: (cmm) => cmm.linkDeadGroundMapper(null),
      readyEvent: 'deadGroundMapperReady',
      logName: 'DeadGroundMapper',
    },
    keyTerrain: {
      factory: () => new KeyTerrainIdentificationEngine(),
      link: (cmm, e) => cmm.linkKeyTerrainIdentificationEngine(e),
      unlink: (cmm) => cmm.linkKeyTerrainIdentificationEngine(null),
      readyEvent: 'keyTerrainIdentificationEngineReady',
      logName: 'KeyTerrainIdentificationEngine',
    },
    positionDefensibility: {
      factory: () => new PosDefScorerEngine(),
      link: (cmm, e) => cmm.linkPosDefScorerEngine(e),
      unlink: (cmm) => cmm.linkPosDefScorerEngine(null),
      readyEvent: 'posDefScorerEngineReady',
      logName: 'PosDefScorerEngine',
    },
    opRanker: {
      factory: () => new OpRankerEngine(),
      link: (cmm, e) => cmm.linkOpRankerEngine(e),
      unlink: (cmm) => cmm.linkOpRankerEngine(null),
      readyEvent: 'opRankerEngineReady',
      logName: 'OpRankerEngine',
    },
    localPeaks: {
      factory: () => new LocalPeaksEngine(),
      link: (cmm, e) => cmm.linkLocalPeaksEngine(e),
      unlink: (cmm) => cmm.linkLocalPeaksEngine(null),
      readyEvent: 'localPeaksEngineReady',
      logName: 'LocalPeaksEngine',
    },
    ocoka: {
      factory: () => new OcokaEngine(),
      link: (cmm, e) => cmm.linkOcokaEngine(e),
      unlink: (cmm) => cmm.linkOcokaEngine(null),
      readyEvent: 'ocokaEngineReady',
      logName: 'OCOKAEngine',
    },
    missionPlanner: {
      factory: () => new MissionPlannerEngine(),
      link: (cmm, e) => cmm.linkMissionPlannerEngine(e),
      unlink: (cmm) => cmm.linkMissionPlannerEngine(null),
      readyEvent: 'missionPlannerEngineReady',
      logName: 'MissionPlannerEngine',
      onViewChanged: (inst, view) => inst.onViewChanged(view),
    },
  };

  constructor(private readonly deps: AnalysisRegistryDeps) {}

  // Typed accessors mirroring the SymbolEngine public surface
  get weaponEffectEngine(): WeaponEffectEngine | null { return this._wez; }
  get losEngine(): LOSEngine | null { return this._los; }
  get trajectoryEngine(): TrajectoryEngine | null { return this._trajectory; }
  get bufferEngine(): BufferEngine | null { return this._buffer; }
  get corridorEngine(): CorridorEngine | null { return this._corridor; }
  get effectEngine(): EffectEngine | null { return this._effects; }
  get flightEngine(): FlightEngine | null { return this._flight; }
  get deadGroundMapper(): DeadGroundMapper | null { return this._deadGround; }
  get keyTerrainIdentificationEngine(): KeyTerrainIdentificationEngine | null { return this._keyTerrain; }
  get posDefScorerEngine(): PosDefScorerEngine | null { return this._posDef; }
  get opRankerEngine(): OpRankerEngine | null { return this._opRanker; }
  get localPeaksEngine(): LocalPeaksEngine | null { return this._localPeaks; }
  get ocokaEngine(): OcokaEngine | null { return this._ocoka; }
  get missionPlannerEngine(): MissionPlannerEngine | null { return this._missionPlanner; }

  /** Has the engine been constructed? */
  has(key: AnalysisKey): boolean {
    return this.getInstance(key) !== null;
  }

  /**
   * Initialise a single engine if the master analysisEngines flag is on AND
   * the individual analysis.<key> flag is on AND it isn't already loaded.
   */
  init(key: AnalysisKey): void {
    if ((settingsData as any).features?.analysisEngines === false) return;
    if ((settingsData as any).analysis?.[key] === false) return;
    if (this.getInstance(key)) return;

    const spec = this.SPECS[key];
    const inst = spec.factory();
    inst.initialize(this.deps.getView());
    this.setInstance(key, inst);
    spec.link(this.deps.contextMenuManager, inst);
    this.deps.emitEvent(spec.readyEvent, { engine: inst });
    console.info(`[SymbolEngine] ${spec.logName} loaded`);
  }

  /** Destroy a single engine and unlink it from the context menu. */
  destroy(key: AnalysisKey): void {
    const inst = this.getInstance(key);
    if (!inst) return;
    inst.destroy?.();
    this.setInstance(key, null);
    this.SPECS[key].unlink(this.deps.contextMenuManager);
  }

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
  initAll(force: boolean = false): void {
    const keys = Object.keys(this.SPECS) as AnalysisKey[];
    if (force) {
      keys.forEach((k) => this.init(k));
      return;
    }
    const schedule: (cb: () => void) => void =
      typeof (globalThis as any).requestIdleCallback === 'function'
        ? (cb) => (globalThis as any).requestIdleCallback(cb, { timeout: 250 })
        : (cb) => setTimeout(cb, 0);
    let i = 0;
    const pump = () => {
      if (i >= keys.length) return;
      const k = keys[i++];
      this.init(k);
      schedule(pump);
    };
    schedule(pump);
  }

  /** Destroy every engine and tell the context menu the analysis tools are gone. */
  destroyAll(): void {
    (Object.keys(this.SPECS) as AnalysisKey[]).forEach((k) => {
      const inst = this.getInstance(k);
      if (!inst) return;
      inst.destroy?.();
      this.setInstance(k, null);
    });
    this.deps.contextMenuManager.unlinkAnalysisEngines();
    console.info('[SymbolEngine] Analysis engines destroyed');
  }

  /** Toggle a single engine on or off at runtime (called from onSettingChanged). */
  setEnabled(key: AnalysisKey, enabled: boolean): void {
    if (enabled) {
      this.init(key);
      console.info(`[SymbolEngine] Analysis engine '${key}' enabled`);
    } else {
      this.destroy(key);
      console.info(`[SymbolEngine] Analysis engine '${key}' disabled`);
    }
  }

  /** Re-attach every loaded engine to the new view (called on view switch). */
  onViewChanged(newView: MapView | SceneView): void {
    (Object.keys(this.SPECS) as AnalysisKey[]).forEach((k) => {
      const inst = this.getInstance(k);
      if (!inst) return;
      const spec = this.SPECS[k];
      if (spec.onViewChanged) {
        spec.onViewChanged(inst, newView);
      } else {
        inst.initialize(newView);
      }
    });
  }

  private getInstance(key: AnalysisKey): any {
    switch (key) {
      case 'wez': return this._wez;
      case 'los': return this._los;
      case 'trajectory': return this._trajectory;
      case 'buffer': return this._buffer;
      case 'corridor': return this._corridor;
      case 'effects': return this._effects;
      case 'flight': return this._flight;
      case 'deadGround': return this._deadGround;
      case 'keyTerrain': return this._keyTerrain;
      case 'positionDefensibility': return this._posDef;
      case 'opRanker': return this._opRanker;
      case 'localPeaks': return this._localPeaks;
      case 'ocoka': return this._ocoka;
      case 'missionPlanner': return this._missionPlanner;
    }
  }

  private setInstance(key: AnalysisKey, inst: any): void {
    switch (key) {
      case 'wez': this._wez = inst; break;
      case 'los': this._los = inst; break;
      case 'trajectory': this._trajectory = inst; break;
      case 'buffer': this._buffer = inst; break;
      case 'corridor': this._corridor = inst; break;
      case 'effects': this._effects = inst; break;
      case 'flight': this._flight = inst; break;
      case 'deadGround': this._deadGround = inst; break;
      case 'keyTerrain': this._keyTerrain = inst; break;
      case 'positionDefensibility': this._posDef = inst; break;
      case 'opRanker': this._opRanker = inst; break;
      case 'localPeaks': this._localPeaks = inst; break;
      case 'ocoka': this._ocoka = inst; break;
      case 'missionPlanner': this._missionPlanner = inst; break;
    }
  }
}
