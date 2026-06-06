import Graphic from '@arcgis/core/Graphic';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol';
import PictureMarkerSymbol from '@arcgis/core/symbols/PictureMarkerSymbol';
import PointSymbol3D from '@arcgis/core/symbols/PointSymbol3D';
import IconSymbol3DLayer from '@arcgis/core/symbols/IconSymbol3DLayer';
import Color from '@arcgis/core/Color';
import View from '@arcgis/core/views/View';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import SketchViewModel from '@arcgis/core/widgets/Sketch/SketchViewModel';
import * as reactiveUtils from '@arcgis/core/core/reactiveUtils';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Point from '@arcgis/core/geometry/Point';
import Polyline from '@arcgis/core/geometry/Polyline';
import Polygon from '@arcgis/core/geometry/Polygon';
import SpatialReference from '@arcgis/core/geometry/SpatialReference';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils';

//import  from "esri/core/reactiveUtils";

import GraphicsLayerManager, {
  LAYER_NAMES,
  LEGACY_MIL_SYMBOLS_LAYER_ID,
  SYMBOL_LAYER_IDS,
} from '../Managers/GraphicsLayerManager';
/*
import ms from '../ThirdParty/MilSymbols/UEITypes.js';
import type { SymbolOptions } from '../ThirdParty/MilSymbols/UEITypes.ts';
*/

// Import milsymbol types for the global MS object
import '../ThirdParty/MilSymbols/milsymbol.d.ts';
import { ParsedSIDC } from '../SIDC/SIDC';
import ContextMenuManager, {
  ContextMenuItem,
  MenuItemEvent,
} from '../Managers/ContextMenuManager';
import { menuIcon } from '../Managers/MenuIcons';

import symbolData from '../Data/Symbols.json';
import settingsData from '../Data/Settings.json';
import Amplifier from '../Support/Amplifier.ts';
import SIDC from '../Support/SIDC.ts';
import DrawEssentials from '../Support/DrawEssentials.ts';
import {
  getMinefieldTextureMetadata,
  syncMinefieldTextureGraphic,
  syncMinefieldTextureGraphicsForLayer,
  removeMinefieldTextureForGraphic,
} from '../Support/MinefieldTextureFill3D.ts';
import Mapper from '../Engines/Mapper.ts';
import AnnotationEngine from './AnnotationEngine.ts';
import EditEngine from './EditEngine.ts';
import SelectionEngine from './SelectionEngine.ts';
import SelectionActionPanel from './SelectionActionPanel.ts';
// MeasurementEngine is loaded dynamically based on Settings.json features.measurementEngine
import type MeasurementEngine from './MeasurementEngine.ts';
// DeploymentBuilderEngine is loaded dynamically based on Settings.json features.deploymentBuilder
import type DeploymentBuilderEngine from './DeploymentBuilder/DeploymentBuilderEngine.ts';
import ProximityEngine from './ProximityEngine.ts';
import DrawingCueEngine from './DrawingCueEngine.ts';
import MGRSEngine from './MGRSEngine.ts';
import VisualizationEngine from './Visualization/VisualizationEngine.ts';
import EngineLogger from '../Support/EngineLogger';
import type { DrawingCueOptions } from './DrawingCueEngine.ts';
import type { MGRSEngineOptions } from './MGRSEngine.ts';
import type { VisualizationOptions } from './Visualization/VisualizationEngine.ts';
import WeaponEffectEngine from './Analysis/WeaponEffectEngine';
import LOSEngine from './Analysis/LOSEngine';
import TrajectoryEngine from './Analysis/TrajectoryEngine';
import KeyTerrainIdentificationEngine from './Analysis/KeyTerrain/KeyTerrainIdentificationEngine';
import PosDefScorerEngine from './Analysis/PositionDefesibilityScorer/PosDefScorerEngine';
import OpRankerEngine from './Analysis/OpRanker/OpRankerEngine';
import LocalPeaksEngine from './Analysis/Peaks/LocalPeaksEngine';
import OcokaEngine from './OCOKA/Ocoka';
import MissionPlannerEngine from './MissionPlanner/MissionPlannerEngine';
import DeadGroundMapper from './Analysis/DeadGroundMapper';
import BufferEngine from './Analysis/BufferEngine';
import CorridorEngine from './Analysis/CorridorEngine';
import FlightEngine from './Analysis/FlightEngine';
import { EffectEngine } from './Analysis/EffectEngine';
import Plan from './ImportExport/Plan.ts';
import SerializationEngine from './ImportExport/SerializationEngine';
import ThemeManager from '../Managers/ThemeManager';
import DeclutterEngine from './Declutter/DeclutterEngine';
import ClusterEngine from './Declutter/ClusterEngine';
import LabelPlacer from './Declutter/LabelPlacer';
import MarkerDisperser from './Declutter/MarkerDisperser';
import LadderEngine from './Declutter/LadderEngine';
import MorphixEngine, {
  MorphixEditedState,
  MorphixSymbolPatch,
  MorphixSymbolSnapshot,
} from './Morphix/MorphixEngine';
import ClipboardEngine from './ClipboardEngine';
import UndoRedoManager from './UndoRedoManager';
import AnalysisEngineRegistry from './AnalysisEngineRegistry';
import RoadNetworkEngine from './Analysis/RoadNetworkEngine';
import TrafficabilityEngine from './Analysis/TrafficabilityEngine';
import SymbolMetadataService from './SymbolMetadataService';
import KeyboardShortcutManager from './KeyboardShortcutManager';
import CommandPalette from '../Support/CommandPalette';
// Each widget self-registers with the Ctrl+K palette + ⚙ Settings menu when
// imported. One side-effect import per engine keeps the wiring discoverable.
import './MeasurementSettingsWidget';
import './AppearanceSettingsWidget';
import './CoreFeaturesSettingsWidget';
import './ProximitySettingsWidget';
import './DrawingCuesSettingsWidget';
import './DeclutterSettingsWidget';
import './MGRSSettingsWidget';
import './VisualizationSettingsWidget';
import './AnalysisSettingsWidget';

interface Evented {
  on(type: string, listener: Function): { remove(): void };
  emit(type: string, event: any): boolean;
}

interface SymbolOptions {
  sidc?: string;
  size?: number;
  quantity?: string;
  staffComments?: string;
  additionalInformation?: string;
  type?: string;
  dtg?: string;
  location?: string;
  outlineColor?: string;
  outlineWidth?: number;
  [key: string]: any;
}

// Interfaces for data loaded from JSON
interface SymbolDefinition {
  Class: string;
  Name: string;
  Offset: { x: number; y: number };
  Fill: boolean;
  SymGeoType: 'Point' | 'FPoint' | 'Polyline' | 'Polygon';
}

interface SymbolData {
  [key: string]: SymbolDefinition;
}

interface UndoEntry {
  label: string;
  undo: () => void;
  redo: () => void;
}

class SymbolEngine implements Evented {
  private _layerManager: GraphicsLayerManager;
  private _contextMenuManager: ContextMenuManager;
  private _getView: () => MapView | SceneView;
  private _editEngine: EditEngine;
  private _measurementEngine?: MeasurementEngine;
  private _proximityEngine: ProximityEngine | null = null;
  private _drawingCueEngine: DrawingCueEngine | null = null;
  private _mgrsEngine: MGRSEngine | null = null;
  private _visualizationEngine: VisualizationEngine | null = null;
  /** Optional adapter for the external pgRouting road-network service (intermittent). */
  private _roadNetworkEngine: RoadNetworkEngine | null = null;
  /** Trafficability / trafficability / route-planning widget over the road network. */
  private _trafficabilityEngine: TrafficabilityEngine | null = null;
  /** Owns construction/destruction/view-attach for the 14 analysis engines. */
  private _analysisRegistry!: AnalysisEngineRegistry;
  private _deploymentBuilderEngine: DeploymentBuilderEngine | null = null;
  private _declutterEngine: DeclutterEngine | null = null;
  private _clusterEngine: ClusterEngine | null = null;
  private _labelPlacer: LabelPlacer | null = null;
  private _markerDisperser: MarkerDisperser | null = null;
  private _ladderEngine: LadderEngine | null = null;
  private _morphixEngine: MorphixEngine;
  public readonly serializationEngine = SerializationEngine.getInstance();
  private currentSymbol: any | undefined;
  private sidc: any | undefined;
  private amplifier: Amplifier | undefined;
  private _registeredSymbols: Set<any> = new Set();
  private eventListeners: Map<string, Function[]> = new Map();
  private labelOptions: any = {};
  private mapper: any;
  private isDrawing = false;
  private _creationMode: 'single' | 'continuous' = 'single';
  private _lastDrawEssentials: DrawEssentials | null = null;
  private _lastAmplifier: Amplifier | null = null;
  private _continuousTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private _suppressDrawLifecycleCount = 0;
  private _suppressNextAddUndoCount = 0;
  /** While > 0, applyMorphixEdit() re-renders without pushing an undo entry — used by settings-driven bulk re-renders (e.g. global force-symbol resize). */
  private _suppressEditUndoCount = 0;
  private _lastCreatedGraphic: Graphic | null = null;

  // Snapshot of the SIDC/amplifier that belongs to the in-progress draw session.
  // Set when initialize() starts a new draw; read by drawSymEnd() so a rapid
  // second initialize() (continuous mode / user re-pick) cannot clobber the
  // finishing graphic's identity.
  private _activeSIDC: any | null = null;
  private _activeAmplifier: Amplifier | null = null;

  // Undo/Redo state owned by UndoRedoManager (delegated to via public facade)
  private _undoRedoManager!: UndoRedoManager;

  // Copy/Paste state owned by ClipboardEngine (delegated to via public facade)
  private _clipboardEngine!: ClipboardEngine;

  // ID to assign to the next graphic created via initialize() (used when loading)
  private _pendingAttrs: { symbolId?: string } | null = null;

  // Multi-select
  private _selectionEngine!: SelectionEngine;

  // Contextual on-map toolbar for the current selection
  private _selectionActionPanel?: SelectionActionPanel;

  constructor(viewProvider: () => MapView | SceneView) {
    this._getView = viewProvider;
    this._layerManager = GraphicsLayerManager.getInstance(this.view);
    this._layerManager.initializeLayers();
    this._editEngine = new EditEngine(viewProvider, this._layerManager);
    this._undoRedoManager = new UndoRedoManager({
      layerManager: this._layerManager,
      editEngine: this._editEngine,
      getLabelOptions: () => this.labelOptions,
    });
    this._clipboardEngine = new ClipboardEngine({
      getView: () => this.view,
      layerManager: this._layerManager,
      getSelectionEngine: () => this._selectionEngine,
      pushUndo: (entry) => this._undoRedoManager.push(entry),
      closeActiveWorkflow: () => this._closeActiveWorkflow(),
      emitEvent: (name, data) => this.emitEvent(name, data),
      getLabelOptions: () => this.labelOptions,
    });
    this._selectionEngine = new SelectionEngine(
      viewProvider,
      this._layerManager,
    );
    this._selectionEngine.activate([...SYMBOL_LAYER_IDS]);
    this._selectionEngine.setCloneDragCallbacks({
      buildClones: (sources) => this._clipboardEngine.buildClones(sources),
      pushUndo: (entry) => this._pushUndo(entry),
      closeActiveWorkflow: () => this._closeActiveWorkflow(),
    });
    this._selectionEngine.setAnnotationRefreshCallback((graphic: Graphic) => {
      const de = graphic.attributes?.drawEssentials;
      const id = graphic.attributes?.id;
      if (!de?.AMPLIFIER || !id) return;
      const annotationLayer = this._layerManager.getOrCreateLayer(
        LAYER_NAMES.ANNOTATION_LAYER,
      );
      AnnotationEngine.deAnnotate(annotationLayer, id);
      AnnotationEngine.annotate(
        annotationLayer,
        graphic.geometry,
        de.AMPLIFIER,
        de,
        id,
        settingsData.textSize,
        de.ISFHAND || 0,
        this.labelOptions || {},
        {},
      );
    });
    this.ensureMsAvailable();

    // Selection quick-action toolbar (bottom-centre, adapts to selection shape)
    this._selectionActionPanel = new SelectionActionPanel(
      this._selectionEngine,
      this._editEngine,
      {
        copySymbol: (g: Graphic) => this.copySymbol(g),
        pushUndo: (entry) => this._pushUndo(entry),
        getView: () => this.view,
        modifySymbol: (g: Graphic) => this.modifySymbol(g),
      },
    );
    if ((settingsData as any).features?.selectionQuickToolbar !== false) {
      this._selectionActionPanel.enable();
    }

    // Initialize EngineLogger from settings
    EngineLogger.setEnabled((settingsData as any).logging?.enabled !== false);

    // Initialize creation mode from settings
    this._creationMode = ((settingsData as any).creationMode as 'single' | 'continuous') || 'single';

    // Start serialization engine â€” provides save/load plan functionality
    this.serializationEngine.start(
      this._layerManager,
      (data) => this.loadSymbolFromJSON(data as any),
      (data) => this._applyTemplateData(data),
    );

    // Initialize symbol engine
    console.log('Symbol Engine initialized');

    //reactiveUtils.watch(() => this._getView()?.zoom, (newType: "2d" | "3d" | undefined) => {

    reactiveUtils.watch(
      () => this._getView()?.type,
      (_newType: string | undefined, _oldType: string | undefined) => {
        // Reserved hook: view-type change reactor. Real re-attach work is in onViewChanged().
      },
      { initial: true },
    );

    // Zoom-based declutter is handled by DeclutterEngine (see _initDeclutterEngine)

    // Initialize the ContextMenuManager
    this._contextMenuManager = ContextMenuManager.getInstance();
    this._contextMenuManager.initialize(this.view, {
      targetGraphicTypes: [], // any type on these layers gets the menu
      targetLayerIds: [...SYMBOL_LAYER_IDS],
    });
    if ((settingsData as any).features?.contextMenu === false) {
      this._contextMenuManager.disable();
    }
    this._contextMenuManager.linkSymbolEngine(this);
    this._morphixEngine = new MorphixEngine();
    this._morphixEngine.initialize(this.view, this._layerManager, {
      applyEdit: (graphic, editedState) =>
        this.applyMorphixEdit(graphic, editedState),
    });

    // Register context menu items for different graphic types
    this.registerContextMenuItems();
    this.serializationEngine.registerContextMenuItems(this._contextMenuManager);

    // Listen for context menu events
    this._contextMenuManager.on(
      'menu-item-click',
      this.handleContextMenuAction.bind(this),
    );

    // Initialize ThemeManager with the configured theme
    ThemeManager.getInstance().init((settingsData as any).ui?.theme ?? 'ops-dark');

    // Conditionally load MeasurementEngine based on Settings.json feature flag.
    // Runtime toggles (M key, ∟ button, Settings checkbox) lazy-load on demand
    // via toggleMeasurement() / onSettingChanged, so the gate only controls boot.
    {
      const features = (settingsData as any).features ?? {};
      if (features.measurementEngine !== false) {
        void this._initMeasurementEngine();
      } else {
        console.info('[SymbolEngine] MeasurementEngine disabled via Settings.json (lazy-load available)');
      }
    }

    // Conditionally load ProximityEngine based on Settings.json feature flag
    this._initProximityEngine();

    // Conditionally load DrawingCueEngine based on Settings.json feature flag
    this._initDrawingCueEngine();

    // Conditionally load MGRSEngine based on Settings.json feature flag
    this._initMGRSEngine();

    // Conditionally load VisualizationEngine based on Settings.json feature flag
    this._initVisualizationEngine();

    // Conditionally load RoadNetworkEngine (external pgRouting service — optional/intermittent).
    // It probes the backend before attaching anything road-dependent (TrafficabilityEngine,
    // roads reference layer); when the server is gone these never spin up.
    this._initRoadNetworkEngine();

    // Conditionally load DeploymentBuilderEngine based on Settings.json feature flag
    this._initDeploymentBuilderEngine();

    // Initialise the 14 analysis engines (each respects its own analysis.* flag)
    this._analysisRegistry = new AnalysisEngineRegistry({
      getView: () => this.view,
      contextMenuManager: this._contextMenuManager,
      emitEvent: (name, data) => this.emitEvent(name, data),
    });
    this._analysisRegistry.initAll();

    // Initialise DeclutterEngine â€” manages annotation and symbol zoom/echelon visibility
    this._initDeclutterEngine();


    // Wire global keyboard shortcuts (if enabled in Settings.json)
    if ((settingsData as any).features?.shortcuts !== false) {
      this._setupKeyboardShortcuts();
    }

    // Populate the Ctrl+K command palette with settings manifests + actions.
    this._registerCommandPalette();

    // Set up global event listeners for drawing events
    this.setupGlobalEventListener();

    // Initialize symbol engine
    console.log('Symbol Engine initialized');

    // --- Context Menu Setup using the Evented Class ---

    //when(this._getView, "ready", () => {
    //   console.log("RWADY")
    //});
  }

  /**
   * Implement Evented interface methods
   */

  /*
    public on(type: string, listener: Function): { remove(): void } {
        if (!this.eventListeners.has(type)) {
            this.eventListeners.set(type, []);
        }
        this.eventListeners.get(type)!.push(listener);
        
        return {
            remove: () => {
                const listeners = this.eventListeners.get(type);
                if (listeners) {
                    const index = listeners.indexOf(listener);
                    if (index > -1) {
                        listeners.splice(index, 1);
                    }
                }
            }
        };
    }
    */

  public emit(type: string, event: any): boolean {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.forEach((listener) => listener(event));
      return true;
    }
    return false;
  }

  /**
   * Register any symbol instance to listen to its events
   */
  public registerSymbol(
    symbolInstance: any,
    symbolType: string = 'Symbol',
  ): void {
    if (this._registeredSymbols.has(symbolInstance)) {
      console.warn(`${symbolType} instance is already registered`);
      return;
    }

    this._registeredSymbols.add(symbolInstance);

    // Listen to the onDrawProgress event
    if (symbolInstance.on && typeof symbolInstance.on === 'function') {
      symbolInstance.on('onDrawProgress', (data: any) => {
        this.emitEvent('onDrawProgress', {
          symbolType: symbolType,
          currentGeometry: data.currentGeometry,
          currentDrawEssentials: data.currentDrawEssentials,
          currentMarker: data.currentMarker,
          originalData: data,
        });
      });

      symbolInstance.on('onDrawEnd', (data: any) => {
        this.emitEvent('onDrawEnd', {
          symbolType: symbolType,
          originalData: data,
        });
      });
    } else {
      console.warn(
        `${symbolType} instance does not support event listening (missing 'on' method)`,
      );
    }
  }

  /**
   * Unregister any symbol instance
   */
  public unregisterSymbol(
    symbolInstance: any,
    symbolType: string = 'Symbol',
  ): void {
    this._registeredSymbols.delete(symbolInstance);
    console.log(`${symbolType} unregistered from SymbolEngine`);
  }

  /**
   * Setup global event listener for onDrawProgress events
   * This allows catching events from any symbol class without manual registration
   */
  public setupGlobalEventListener(): void {
    // Listen to custom events on the document
    document.addEventListener('onDrawProgress', (event: any) => {
      // Arm proximity indicator on first progress event (idempotent â€” no-ops if already active)
      this._proximityEngine?.activate();

      // Arm drawing cue overlays (idempotent)
      this._drawingCueEngine?.activate([...SYMBOL_LAYER_IDS]);

      // Feed drawing progress into the measurement engine
      const detail = event.detail;
      if (detail?.currentGeometry && detail?.currentDrawEssentials?.CTRL_PTS) {
        this._measurementEngine?.updateSegments(
          detail.currentGeometry,
          detail.currentDrawEssentials.CTRL_PTS,
        );
        this._drawingCueEngine?.updateFromProgress(
          detail.currentGeometry,
          detail.currentDrawEssentials.CTRL_PTS,
        );
      }

    });

    // New control point clicked â€” arm the next segment measurement graphic
    document.addEventListener('onDrawClick', (event: any) => {
      const detail = event.detail;
      if (detail?.currentPts) {
        this._measurementEngine?.addSegment(detail.currentPts);
      }
    });

    document.addEventListener('onDrawEnd', (event: any) => {
      // Handle the draw end event by creating and adding a graphic
      this.drawSymEnd(event.detail);

      if (this._suppressDrawLifecycleCount > 0) {
        this._suppressDrawLifecycleCount--;
        return;
      }

      // Clear measurement overlays when the symbol is finalised
      this._measurementEngine?.wrapUp();

      // Deactivate proximity indicator when drawing ends
      this._proximityEngine?.deactivate();
      // Deactivate drawing cue overlays when drawing ends
      this._drawingCueEngine?.deactivate();
    });

    console.log('SymbolEngine global event listeners set up');
  }

  /**
   * Generate a UUID for graphics
   */
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
      /[xy]/g,
      function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      },
    );
  }

  onViewChanged(newView: MapView | SceneView) {
    console.log('SymbolEngine: Detected view change:', newView?.type);
    this._editEngine.deactivate();
    this._layerManager = GraphicsLayerManager.getInstance(newView);
    this._layerManager.initializeLayers();
    this._clipboardEngine.rewireLayerManager(this._layerManager);
    this._editEngine = new EditEngine(this._getView, this._layerManager);
    this._undoRedoManager.rewireEditEngine(this._editEngine);
    // SelectionActionPanel and KeyboardShortcutManager both capture the original
    // EditEngine reference at construction.  Without swapping them here the old
    // engine remains pinned (memory leak) and their callbacks invoke the
    // discarded engine bound to the previous view.
    this._selectionActionPanel?.rewireEditEngine(this._editEngine);
    this._keyboardShortcutManager?.rewireEditEngine(this._editEngine);
    this._selectionEngine.onViewChanged(newView);
    this._selectionActionPanel?.refresh();
    this._morphixEngine.initialize(newView, this._layerManager, {
      applyEdit: (graphic, editedState) =>
        this.applyMorphixEdit(graphic, editedState),
    });
    // Re-attach measurement engine to the new view
    this._measurementEngine?.onViewChanged(newView);
    // Re-attach proximity engine to the new view
    this._proximityEngine?.onViewChanged(newView);
    // Re-attach drawing cue engine to the new view
    this._drawingCueEngine?.onViewChanged(newView);
    // Re-attach MGRS engine to the new view
    this._mgrsEngine?.onViewChanged(newView);
    // Re-attach visualization engine to the new view
    this._visualizationEngine?.onViewChanged(newView);
    // Re-attach road network engine (moves the optional roads layer to the new map)
    this._roadNetworkEngine?.onViewChanged(newView);
    // Re-attach trafficability widget (moves its analysis/marker/committed layers)
    this._trafficabilityEngine?.onViewChanged(newView);

    // Re-attach DeploymentBuilderEngine to the new view
    this._deploymentBuilderEngine?.onViewChanged(newView);
    // Re-attach declutter engines to the new view. Each must also adopt the
    // new GraphicsLayerManager — 2D and 3D resolve to different manager
    // instances, so without this they keep querying the old view's layers.
    this._declutterEngine?.onViewChanged(newView, this._layerManager);
    this._clusterEngine?.onViewChanged(newView, this._layerManager);
    this._labelPlacer?.onViewChanged(newView, this._layerManager);
    this._markerDisperser?.onViewChanged(newView, this._layerManager);
    this._ladderEngine?.onViewChanged(newView, this._layerManager);

    // Re-attach all loaded analysis engines to the new view
    this._analysisRegistry.onViewChanged(newView);

    // Re-initialize the ContextMenuManager for the new view so its
    // pointer-down / contextmenu listeners are bound to the active view.
    this._contextMenuManager.initialize(newView, {
      targetGraphicTypes: [],
      targetLayerIds: [...SYMBOL_LAYER_IDS],
    });

    // Swap minefield polygon symbols (PictureFillSymbol ↔ invisible fill) and
    // create/remove their textured Mesh children for the new view type.
    syncMinefieldTextureGraphicsForLayer(
      this._layerManager.getOrCreateLayer(LAYER_NAMES.TACT),
      newView,
    );
  }

  /**
   * Dynamically import and initialise MeasurementEngine. Idempotent — returns
   * the existing instance if already loaded. The Settings.json feature flag
   * is checked by the boot caller and by toggleMeasurement(); this method
   * itself is gate-free so runtime opt-in works regardless of the boot state.
   */
  private async _initMeasurementEngine(): Promise<MeasurementEngine | null> {
    if (this._measurementEngine) return this._measurementEngine;
    try {
      const { default: ME } = await import('./MeasurementEngine.ts');
      this._measurementEngine = ME.getInstance();
      
      const measureCfg = (settingsData as any).measurement ?? {};
      this._measurementEngine.setOptions({
          dist_unit: measureCfg.distUnit,
          area_unit: measureCfg.areaUnit,
          font_size: measureCfg.fontSize,
          font_color: measureCfg.fontColor,
          font_opacity: measureCfg.fontOpacity,
          line_color: measureCfg.lineColor,
          line_width: measureCfg.lineWidth,
          line_opacity: measureCfg.lineOpacity,
          show_bng: measureCfg.showBng,
          show_height: measureCfg.showHeight,
          show_width: measureCfg.showWidth,
          show_area: measureCfg.showArea,
          show_total: measureCfg.showTotal,
          show_segment: measureCfg.showSegment,
          show_extent: measureCfg.showExtent,
          show_line: measureCfg.showLine,
          show_last_seg_only: measureCfg.showLastSegOnly,
          slant_range: measureCfg.slantRange,
          magnetic_declination: measureCfg.magneticDeclination,
          speed_kmh: measureCfg.speedKmh,
          bearing_format: measureCfg.bearingFormat,
          auto_unit: measureCfg.autoUnit,
          preserve_labels_on_complete: measureCfg.preserveOnComplete,
          road_eta: measureCfg.roadEta
      });

      this._measurementEngine.start(this.view);
      this._contextMenuManager.linkMeasurementEngine(this._measurementEngine);
      // Emit so the host app can initialise its panel
      this.emitEvent('measurementEngineReady', {
        engine: this._measurementEngine,
      });
      console.info('[SymbolEngine] MeasurementEngine loaded');
      return this._measurementEngine;
    } catch (e) {
      console.error('[SymbolEngine] Failed to load MeasurementEngine:', e);
      return null;
    }
  }

  private _initProximityEngine(): void {
    const features = (settingsData as any).features ?? {};
    if (features.proximityEngine === false) {
      console.info('[SymbolEngine] ProximityEngine disabled via Settings.json');
      return;
    }
    const proxCfg = (settingsData as any).proximity ?? {};

    this._proximityEngine = ProximityEngine.getInstance();
    this._proximityEngine.start(
      this.view,
      [...SYMBOL_LAYER_IDS],
      {
        nearestVertex: proxCfg.nearestVertex ?? true,
        nearestCoordinate: proxCfg.nearestCoordinate ?? true,
        showDistance: proxCfg.showDistance ?? true,
        distanceUnit: proxCfg.distanceUnit ?? 'meters',
        snapRadiusPx: proxCfg.snapRadiusPx ?? 80,
        lineColor: proxCfg.lineColor ?? [0, 120, 255],
        lineOpacity: proxCfg.lineOpacity ?? 0.7,
        lineWidth: proxCfg.lineWidth ?? 1.5,
        markerColor: proxCfg.markerColor ?? [0, 120, 255],
        markerSize: proxCfg.markerSize ?? 10,
        fontSize: proxCfg.fontSize ?? 11,
        fontColor: proxCfg.fontColor ?? [0, 80, 200],
      },
    );

    this._proximityEngine.enable();
    this.emitEvent('proximityEngineReady', { engine: this._proximityEngine });
    console.info('[SymbolEngine] ProximityEngine loaded');
  }

  private _initDrawingCueEngine(): void {
    const features = (settingsData as any).features ?? {};
    if (features.drawingCues === false) {
      console.info('[SymbolEngine] DrawingCueEngine disabled via Settings.json');
      return;
    }
    const cuesCfg = (settingsData as any).drawingCues ?? {};
    this._drawingCueEngine = DrawingCueEngine.getInstance();
    this._drawingCueEngine.start(this.view);
    this._drawingCueEngine.setOptions(cuesCfg as DrawingCueOptions);
    this._drawingCueEngine.enable();
    this.emitEvent('drawingCueEngineReady', { engine: this._drawingCueEngine });
    console.info('[SymbolEngine] DrawingCueEngine loaded');
  }

  private _initMGRSEngine(): void {
    const features = (settingsData as any).features ?? {};
    if (features.mgrsEngine === false) {
      console.info('[SymbolEngine] MGRSEngine disabled via Settings.json');
      return;
    }
    const mgrsCfg = (settingsData as any).mgrs ?? {};
    this._mgrsEngine = MGRSEngine.getInstance();
    this._mgrsEngine.start(this.view);
    this._mgrsEngine.setOptions(mgrsCfg as MGRSEngineOptions);
    this._mgrsEngine.enable();
    this.emitEvent('mgrsEngineReady', { engine: this._mgrsEngine });
    console.info('[SymbolEngine] MGRSEngine loaded');
  }

  private _initVisualizationEngine(): void {
    const features = (settingsData as any).features ?? {};
    if (features.visualizationEngine !== true) {
      console.info('[SymbolEngine] VisualizationEngine disabled via Settings.json');
      return;
    }
    const vizCfg = (settingsData as any).visualization ?? {};
    this._visualizationEngine = VisualizationEngine.getInstance();
    this._visualizationEngine.start(this.view);
    this._visualizationEngine.setOptions(vizCfg as VisualizationOptions);
    this._visualizationEngine.enable();
    this.emitEvent('visualizationEngineReady', { engine: this._visualizationEngine });
    console.info('[SymbolEngine] VisualizationEngine loaded');
  }

  private _initRoadNetworkEngine(): void {
    const features = (settingsData as any).features ?? {};
    if (features.roadNetwork !== true) {
      console.info('[SymbolEngine] RoadNetworkEngine disabled via Settings.json');
      return;
    }
    const cfg = (settingsData as any).roadNetwork ?? {};
    this._roadNetworkEngine = new RoadNetworkEngine({
      apiBaseUrl: cfg.apiBaseUrl,
      dataBaseUrl: cfg.dataBaseUrl,
      timeoutMs: cfg.timeoutMs,
      availabilityTtlMs: cfg.availabilityTtlMs,
      enabled: true,
    });
    this._roadNetworkEngine.initialize(this.view);
    (window as any).roadNetworkEngine = this._roadNetworkEngine;
    // Probe FIRST. Only attach roads layer + Trafficability if the backend
    // actually answers — otherwise the rest of PAMS8 stays clean: no failed
    // GeoJSONLayer load, no orphan menu item. The engine instance is kept so
    // a later re-probe (e.g. user toggles the feature) can bring everything up.
    void this._roadNetworkEngine.ensureAvailable().then((up) => {
      if (!up) {
        console.info('[SymbolEngine] Road network backend unreachable — features gated off');
        return;
      }
      if (cfg.showRoadsLayer !== false) {
        void this._roadNetworkEngine!.showRoadsLayer();
      }
      this._initTrafficabilityEngine();
      this.emitEvent('roadNetworkEngineReady', { engine: this._roadNetworkEngine });
      console.info('[SymbolEngine] RoadNetworkEngine loaded');
    });
  }

  private _initTrafficabilityEngine(): void {
    const features = (settingsData as any).features ?? {};
    // Trafficability is a road-network tool; load it alongside RoadNetworkEngine.
    // (It still works offline — degrading to range-ring / straight-line estimates.)
    if (features.roadNetwork !== true) return;
    if (this._trafficabilityEngine) return;
    this._trafficabilityEngine = new TrafficabilityEngine();
    this._trafficabilityEngine.initialize(this.view);
    // Surface it in the right-click "More Actions…" palette.
    this._contextMenuManager?.linkTrafficabilityEngine(this._trafficabilityEngine);
    (window as any).trafficabilityEngine = this._trafficabilityEngine;
    this.emitEvent('trafficabilityEngineReady', { engine: this._trafficabilityEngine });
    console.info('[SymbolEngine] TrafficabilityEngine loaded');
  }

  private async _initDeploymentBuilderEngine(): Promise<void> {
    const features = (settingsData as any).features ?? {};
    if (features.deploymentBuilder !== true) {
      console.info('[SymbolEngine] DeploymentBuilderEngine disabled via Settings.json');
      return;
    }
    try {
      const { default: DBE } = await import('./DeploymentBuilder/DeploymentBuilderEngine.ts');
      this._deploymentBuilderEngine = DBE.getInstance();
      this._deploymentBuilderEngine!.start(this.view, this.serializationEngine);
      this._deploymentBuilderEngine!.enable();
      this._contextMenuManager.linkDeploymentBuilderEngine(this._deploymentBuilderEngine!);
      (window as any).deploymentBuilderEngine = this._deploymentBuilderEngine;
      this.emitEvent('deploymentBuilderEngineReady', { engine: this._deploymentBuilderEngine });
      console.info('[SymbolEngine] DeploymentBuilderEngine loaded');
    } catch (err) {
      console.error('[SymbolEngine] Failed to load DeploymentBuilderEngine:', err);
    }
  }


  get view() {
    return this._getView();
  }

  get layerManager(): GraphicsLayerManager {
    return GraphicsLayerManager.getInstance(this.view);
  }

  set layerManager(value: GraphicsLayerManager) {
    this._layerManager = value;
  }

  createPointSymbol(
    color: string = '#FF0000',
    size: number = 10,
  ): SimpleMarkerSymbol {
    return new SimpleMarkerSymbol({
      color: new Color(color),
      size,
      outline: { color: '#000000', width: 1 },
    });
  }

  /**
   * Register context menu items for different graphic types
   */
  private registerContextMenuItems(): void {
    console.log('Registered');
    const milSymbolMenuItems: ContextMenuItem[] = [
      {
        id: 'show-details',
        label: 'Show Details',
        shortcut: 'I',
        icon: menuIcon('info'),
        action: (graphic) => this.showSymbolDetails(graphic),
      },
      {
        id: 'center-on',
        label: 'Center On',
        shortcut: 'C',
        icon: menuIcon('navigation'),
        action: (graphic) => this.centerOnGraphic(graphic),
      },
      {
        id: 'remove-graphic',
        label: 'Remove',
        shortcut: 'Del',
        icon: menuIcon('trash'),
        action: (graphic) => this.removeGraphic(graphic),
      },
      // ── Edit submenu (owned by EditEngine) ─────────────────────────
      ...this._editEngine.buildContextMenuItems(
        (graphic) => this.modifySymbol(graphic),
        (graphic) => this.activateEditControlPoints(graphic),
        () => this.deactivateEdit(),
        () => this._selectionEngine?.count ?? 0,
      ),
      // ── Selection + Align submenus (owned by SelectionEngine) ──────────
      ...this._selectionEngine.buildContextMenuItems(
        (e) => this._pushUndo(e),
        () => this._closeActiveWorkflow(),
      ),
      // ── Clipboard submenu ───────────────────────────────────────────
      {
        id: 'clipboard-submenu',
        label: 'Clipboard',
        icon: menuIcon('clipboard'),
        visible: () =>
          (settingsData as any).features?.clipboard !== false &&
          ((settingsData as any).features?.copyPaste !== false ||
           (settingsData as any).features?.shortcuts !== false),
        children: [
          {
            id: 'copy-symbol',
            label: 'Copy Symbol',
            shortcut: 'Ctrl+C',
            icon: menuIcon('copy'),
            visible: () => (settingsData as any).features?.copyPaste !== false,
            action: (graphic) => this.copySymbol(graphic),
          },
          {
            id: 'paste-symbol',
            label: 'Paste Symbol',
            shortcut: 'Ctrl+V',
            icon: menuIcon('clipboard'),
            visible: () =>
              (settingsData as any).features?.copyPaste !== false &&
              this._clipboardEngine.hasClipboard,
            action: (_graphic) => this._activatePasteMode(),
          },
          {
            id: 'paste-symbol-offset',
            label: 'Paste with Offset...',
            shortcut: 'Ctrl+Shift+V',
            icon: menuIcon('move'),
            visible: () =>
              (settingsData as any).features?.copyPaste !== false &&
              this._clipboardEngine.hasClipboard,
            action: (_graphic) => this._showPasteOffsetDialog(),
          },
          {
            id: 'undo',
            label: () => {
              const lbl = this._undoRedoManager.nextUndoLabel;
              return lbl ? `Undo ${lbl}` : 'Undo';
            },
            shortcut: 'Ctrl+Z',
            icon: menuIcon('rotate-ccw'),
            enabled: (_graphic) => this._undoRedoManager.undoCount > 0,
            visible: () => (settingsData as any).features?.shortcuts !== false,
            action: (_graphic) => this.undo(),
          },
          {
            id: 'redo',
            label: () => {
              const lbl = this._undoRedoManager.nextRedoLabel;
              return lbl ? `Redo ${lbl}` : 'Redo';
            },
            shortcut: 'Ctrl+Y',
            icon: menuIcon('rotate-cw'),
            enabled: (_graphic) => this._undoRedoManager.redoCount > 0,
            visible: () => (settingsData as any).features?.shortcuts !== false,
            action: (_graphic) => this.redo(),
          },
        ],
      },
    ];


    // Register menu items for force symbols
    const forceMenuItems: ContextMenuItem[] = [
      {
        id: 'show-details',
        label: 'Show Details',
        shortcut: 'I',
        icon: menuIcon('info'),
        action: (graphic) => this.showSymbolDetails(graphic),
      },
      {
        id: 'center-on',
        label: 'Center On',
        shortcut: 'C',
        icon: menuIcon('navigation'),
        action: (graphic) => this.centerOnGraphic(graphic),
      },
      {
        id: 'remove-graphic',
        label: 'Remove',
        shortcut: 'Del',
        icon: menuIcon('trash'),
        action: (graphic) => this.removeGraphic(graphic),
      },
    ];

    // Register the menu items
    // "milSymbol" / "force" = legacy explicit types
    // "symbol" = default type set by drawSymEnd for all tactical symbols
    this._contextMenuManager.registerMenuItems('milSymbol', milSymbolMenuItems);
    this._contextMenuManager.registerMenuItems('symbol', milSymbolMenuItems);
    this._contextMenuManager.registerMenuItems('force', forceMenuItems);

    // You can also register menu items for other graphic types as needed
  }

  /**
   * Handle context menu actions
   */
  private handleContextMenuAction(event: MenuItemEvent): void {
    console.log(
      `Context menu action: ${event.actionId} on ${event.graphicType} in layer ${event.layerId}`,
    );

    // Emit a custom event for the main application to handle
    // This allows the main app to perform any additional housekeeping
    this.emitEvent('symbolAction', {
      type: event.actionId,
      graphic: event.graphic,
      layerId: event.layerId,
      graphicType: event.graphicType,
      point: event.point,
    });
  }

  /**
   * Emit events for the main application to handle
   */
  private emitEvent(eventName: string, data: any): void {
    // Create a custom event that bubbles up to the document level
    const customEvent = new CustomEvent(eventName, {
      detail: data,
      bubbles: true,
      cancelable: true,
    });

    // Dispatch the event from the view container with null check
    if (this.view && this.view.container) {
      this.view.container.dispatchEvent(customEvent);
    } else {
      // Fallback to dispatching from document if container is null
      document.dispatchEvent(customEvent);
    }
  }

  /**
   * Show details for a symbol
   */
  private showSymbolDetails(graphic: Graphic): void {
    this._morphixEngine.open(graphic);
  }

  /**
   * Center the map view on a graphic
   */
  private centerOnGraphic(graphic: Graphic): void {
    console.log('Centering on graphic:', graphic.attributes?.name || 'Unnamed');

    if (graphic.geometry) {
      this.view
        .goTo({
          target: graphic,
          zoom: this.view.zoom,
        })
        .catch((error) => {
          console.error('Error centering on graphic:', error);
        });
    }
  }

  /**
   * Remove a graphic from its layer
   */
  private removeGraphic(graphic: Graphic): void {
    console.log('Removing graphic:', graphic.attributes?.name || 'Unnamed');

    const layer = (graphic.origin?.layer ?? null) as GraphicsLayer | null;
    if (!layer) return;

    const annotationLayer = this._layerManager.getOrCreateLayer(
      LAYER_NAMES.ANNOTATION_LAYER,
    );
    const graphicId = graphic.attributes?.id;
    const de = graphic.attributes?.drawEssentials;

    this._pushUndo({
      label: 'Remove Symbol',
      undo: () => {
        layer.add(graphic);
        syncMinefieldTextureGraphic(layer, graphic, this._getView());
        if (de?.AMPLIFIER && graphicId) {
          AnnotationEngine.annotate(
            annotationLayer,
            graphic.geometry,
            de.AMPLIFIER,
            de,
            graphicId,
            settingsData.textSize,
            de.ISFHAND || 0,
            this.labelOptions || {},
            {},
          );
        }
      },
      redo: () => {
        removeMinefieldTextureForGraphic(layer, graphic);
        layer.remove(graphic);
        if (graphicId) AnnotationEngine.deAnnotate(annotationLayer, graphicId);
      },
    });

    removeMinefieldTextureForGraphic(layer, graphic);
    layer.remove(graphic);
    if (graphicId) AnnotationEngine.deAnnotate(annotationLayer, graphicId);
  }

  /**
   * Close whichever workflow is currently active (EditEngine edit session or
   * SelectionEngine move) before starting a new one.  Must be called at the
   * top of every operation that begins an interactive workflow.
   */
  private _closeActiveWorkflow(): void {
    this._editEngine.deactivate();
    this._selectionEngine.cancelMove();
  }

  /**
   * Activate interactive editing for a graphic.
   * Point symbols â†’ move.  Poly/polygon symbols â†’ move + rotate + scale.
   * Called automatically from the right-click context menu or M shortcut.
   */
  public modifySymbol(graphic: Graphic): void {
    console.log(
      'SymbolEngine: activating edit for',
      graphic.attributes?.id ?? 'graphic',
    );
    this._closeActiveWorkflow();

    // Match the SelectionActionPanel popup exactly: when a multi-selection is
    // active, edit the WHOLE live selection regardless of which graphic was
    // right-clicked. ANY group of 2+ symbols (same-type OR mixed point/line/area)
    // is routed through the proxy-based group transform, which supports move +
    // rotate + scale. ArcGIS SketchViewModel only allows translation when several
    // graphics are updated together, so a single graphic alone keeps the native
    // edit (point = move, line/area = move + scale + rotate + reshape).
    const selected = this._selectionEngine.selectedGraphics;
    const isInSelection = selected.some((g) => g === graphic);
    const allForEdit: Graphic[] =
      selected.length > 1
        ? isInSelection
          ? [graphic, ...selected.filter((g) => g !== graphic)]
          : [...selected]
        : [graphic];
    const primary = allForEdit[0];
    const additional = allForEdit.slice(1);

    this._capturePreEditSnapshot(primary, additional, 'Move, Scale, Rotate');
    // Always route through the proxy-based mixed-edit path so single-symbol
    // selections get the same proxy-driven UX as 2+ selections.
    // activateMixedEdit() accepts an empty `additional` array.
    //
    // For a SINGLE POINT symbol scaling is suppressed (move + rotate only) —
    // a lone point has no meaningful extent to scale. Lines, areas, and any
    // multi-graphic selection keep full move + rotate + scale.
    const isSinglePoint =
      additional.length === 0 && primary.geometry?.type === 'point';
    this._editEngine.activateMixedEdit(primary, additional, {
      enableScaling: !isSinglePoint,
    });
    this._selectionActionPanel?.refresh();
  }

  /**
   * Activate control-point editing (CTRL_PTS drag handles) for a poly/polygon graphic.
   */
  public activateEditControlPoints(graphic: Graphic): void {
    this._closeActiveWorkflow();
    this._capturePreEditSnapshot(graphic, [], 'Edit Control Points');
    this._editEngine.activateEditControlPoints(graphic);
    this._selectionActionPanel?.refresh();
  }

  /**
   * Programmatically scale a point symbol by a factor (e.g. 1.2 = +20 %).
   * Emits "scalePointSymbol" on the EditEngine; listen there to regenerate
   * the PictureMarkerSymbol with the new SIZE.
   */
  public scalePointSymbol(graphic: Graphic, factor: number): void {
    this._editEngine.scalePointSymbol(graphic, factor);
  }

  /**
   * Deactivate any active edit / reshape session.
   */
  public deactivateEdit(): void {
    this._editEngine.deactivate();
    this._selectionActionPanel?.refresh();
  }

  /** Access the underlying EditEngine to register event listeners. */
  public get editEngine(): EditEngine {
    return this._editEngine;
  }

  /** Access the SelectionEngine for multi-select state and batch operations. */
  public get selectionEngine(): SelectionEngine {
    return this._selectionEngine;
  }

  /** Access the ContextMenuManager instance. */
  public get contextMenuManager(): ContextMenuManager {
    return this._contextMenuManager;
  }

  /** Remove all graphics from every managed layer. */
  public clearAllGraphics(): void {
    const lm = this.layerManager;
    lm.listLayers().forEach((id) => {
      const layer = lm.getLayer(id);
      if (layer) layer.removeAll();
    });
    this._undoRedoManager.clear();
    console.info('[SymbolEngine] All graphics cleared');
  }

  /**
   * Wire global keyboard shortcuts for context-menu actions.
   * Shortcuts only fire when the map container (or document) is focused and
   * no input/textarea element has keyboard focus.
   *
   * Shortcut table:
   *   M        â†’ Move, Scale, Rotate (last right-clicked graphic)
   *   E        â†’ Edit Control Points (last right-clicked graphic)
   *   Escape   â†’ Deactivate any active edit session
   *   Delete   â†’ Remove last right-clicked graphic
   *   I        â†’ Show Details
   *   C        â†’ Center On
   */
  private _keyboardShortcutManager?: KeyboardShortcutManager;

  private _setupKeyboardShortcuts(): void {
    this._keyboardShortcutManager = new KeyboardShortcutManager({
      contextMenuManager: this._contextMenuManager,
      editEngine: this._editEngine,
      selectionEngine: this._selectionEngine,
      modifySymbol: (g) => this.modifySymbol(g),
      activateEditControlPoints: (g) => this.activateEditControlPoints(g),
      deactivateEdit: () => this.deactivateEdit(),
      undo: () => this.undo(),
      redo: () => this.redo(),
      copySymbol: (g) => this.copySymbol(g),
      activatePasteMode: () => this._activatePasteMode(),
      showPasteOffsetDialog: () => this._showPasteOffsetDialog(),
      removeGraphic: (g) => this.removeGraphic(g),
      showSymbolDetails: (g) => this.showSymbolDetails(g),
      centerOnGraphic: (g) => this.centerOnGraphic(g),
      closeActiveWorkflow: () => this._closeActiveWorkflow(),
      pushUndo: (entry) => this._pushUndo(entry),
      stopContinuousMode: () => this.stopContinuousMode(),
      getCreationMode: () => this._creationMode,
    });
    this._keyboardShortcutManager.attach();
  }

  /**
   * Populate the Ctrl+K command palette. The palette is a *launcher* only — it
   * opens settings widgets, Analysis Hub tools, the Deployment Manager, and a
   * handful of plan-level utilities. Individual settings rows do NOT appear in
   * the palette (they live in the widgets, where the row + tooltip have proper
   * context).
   *
   * Per-engine settings widgets self-register through `CommandPalette.registerWidget`
   * in their own module — those imports are at the top of this file.
   */
  private _registerCommandPalette(): void {
    // Helper: synthesize a click on an existing topbar / hub button so the
    // palette re-uses whatever wiring main.ts already established.
    const clickEl = (selector: string) => () => {
      const el = document.querySelector(selector) as HTMLElement | null;
      el?.click();
    };

    // Each Analysis Hub tool — these are wired in src/main.ts as
    // `.ah-tool[data-tool="..."]` and dispatch to the relevant engine.
    const hubTool = (
      tool: string,
      label: string,
      hint: string,
      keywords: string[],
    ) => ({
      id: `analysis.${tool}`,
      label,
      hint,
      keywords: ['analysis', 'hub', ...keywords],
      run: clickEl(`.ah-tool[data-tool="${tool}"]`),
    });

    CommandPalette.registerActions([
      // ── Tools / panels ──────────────────────────────────────────────────
      {
        id: 'deployment.manager',
        label: 'Deployment Manager',
        hint: 'Place pre-built formation templates',
        keywords: ['mgr', 'formation', 'template', 'deploy'],
        run: clickEl('#deployment-manager-btn'),
      },
      {
        id: 'analysisHub.open',
        label: 'Analysis Hub',
        hint: 'Browse every terrain / force / weapon / mission tool',
        keywords: ['hub', 'panel'],
        run: clickEl('#analysis-hub-btn'),
      },

      // ── Analysis Hub · Terrain ─────────────────────────────────────────
      hubTool('keyTerrain', 'Key Terrain',
        'Hills, saddles, spurs, reentrants — tactically significant features',
        ['terrain', 'feature', 'hill', 'saddle']),
      hubTool('localPeaks', 'Peak Analysis',
        'Detect terrain peaks and valleys in the AO',
        ['peak', 'valley', 'terrain', 'elevation']),
      hubTool('deadGround', 'Dead Ground',
        'Map terrain hidden from the observer position',
        ['dead', 'hidden', 'mask', 'cover']),
      hubTool('ocoka', 'OCOKA — Avenues of Approach',
        'Multi-factor terrain analysis for AAs',
        ['ocoka', 'avenue', 'approach', 'mcoo']),

      // ── Analysis Hub · Force & Position ────────────────────────────────
      hubTool('los', 'Line of Sight',
        'Viewshed from an observer position',
        ['los', 'viewshed', 'visibility']),
      hubTool('posDefScorer', 'Position Defensibility',
        'Rate defensive value across 6 military factors',
        ['defensibility', 'position', 'score', 'defence']),
      hubTool('opRanker', 'OP Ranker',
        'Rank and compare candidate observation posts',
        ['op', 'observation', 'post', 'rank']),

      // ── Analysis Hub · Weapons & Threats ───────────────────────────────
      hubTool('wez', 'Weapon Engagement Zone',
        'Visualize weapon-system engagement coverage',
        ['wez', 'weapon', 'engagement', 'range']),
      hubTool('trajectory', 'Projectile Trajectory',
        'Model projectile flight path and impact',
        ['trajectory', 'ballistic', 'projectile']),
      hubTool('effects', 'Weapon Effects',
        'Munitions effects radius — blast, frag, shock',
        ['blast', 'effect', 'munition']),
      hubTool('buffer', 'Buffer & Threat Rings',
        'Buffer zones and concentric threat rings',
        ['buffer', 'ring', 'threat']),

      // ── Analysis Hub · Route & Mission ─────────────────────────────────
      hubTool('corridor', 'Corridor Analysis',
        'Route corridor width, threats, chokepoints',
        ['corridor', 'route', 'msr', 'chokepoint']),
      hubTool('flight', 'UAV Flight',
        'Plan UAV routes and analyse coverage',
        ['uav', 'flight', 'drone']),
      hubTool('missionPlanner', 'Mission Planner',
        'Integrated multi-factor terrain analysis dashboard',
        ['mission', 'planner', 'dashboard']),
      hubTool('trafficability', 'Trafficability',
        'Drive-time service areas, MSRs, GO/SLOW/NO-GO',
        ['traffic', 'msr', 'route', 'drive']),

      // ── Plan-level utilities ───────────────────────────────────────────
      {
        id: 'plan.save',
        label: 'Save plan…',
        hint: 'Persist current symbols + annotations to a file',
        keywords: ['export', 'download'],
        run: () => this.savePlanToFile(),
      },
      {
        id: 'plan.load',
        label: 'Load plan…',
        hint: 'Restore a previously saved plan',
        keywords: ['import', 'open'],
        run: () => this.loadPlanFromFile(),
      },
      {
        id: 'view.clear',
        label: 'Clear all graphics',
        hint: 'Remove every drawn symbol from the map',
        keywords: ['reset', 'wipe'],
        run: () => this.clearAllGraphics(),
      },
    ]);
  }

  /** Access the MeasurementEngine â€” configure units or toggle programmatically.
   *  May be undefined if the feature is disabled in Settings.json or not yet loaded. */
  public get measurementEngine(): MeasurementEngine | undefined {
    return this._measurementEngine;
  }

  /** Toggle the MeasurementEngine, lazy-loading it on first use when the
   *  Settings.json gate left it off at boot. Every UI hook (M key, ∟ button,
   *  Settings checkbox) should funnel through this so the feature can be
   *  switched on without restarting the app. */
  public async toggleMeasurement(): Promise<void> {
    const engine = this._measurementEngine ?? (await this._initMeasurementEngine());
    engine?.toggle();
  }

  /** Access the ProximityEngine â€” toggle or adjust snap options programmatically.
   *  May be undefined if the feature is disabled in Settings.json or not yet loaded. */
  public get proximityEngine(): ProximityEngine | null {
    return this._proximityEngine;
  }

  /** Access the DrawingCueEngine â€” control visual overlays during drawing. */
  public get drawingCueEngine(): DrawingCueEngine | null {
    return this._drawingCueEngine;
  }

  /** Access the MGRSEngine â€” grid overlay controls and runtime configuration. */
  public get mgrsEngine(): MGRSEngine | null {
    return this._mgrsEngine;
  }

  /** Access the VisualizationEngine â€” force overlays (rings, hull, grid, effects). */
  public get visualizationEngine(): VisualizationEngine | null {
    return this._visualizationEngine;
  }

  /** Access the RoadNetworkEngine â€” optional external routing/service-area adapter. */
  public get roadNetworkEngine(): RoadNetworkEngine | null {
    return this._roadNetworkEngine;
  }

  /** Access the TrafficabilityEngine â€” open the trafficability / route-planning widget. */
  public get trafficabilityEngine(): TrafficabilityEngine | null {
    return this._trafficabilityEngine;
  }

  /** Access the WeaponEffectEngine â€” open WEZ analysis panels programmatically. */
  public get weaponEffectEngine(): WeaponEffectEngine | null {
    return this._analysisRegistry.weaponEffectEngine;
  }

  /** Access the LOSEngine â€” open LOS/viewshed panels programmatically. */
  public get losEngine(): LOSEngine | null {
    return this._analysisRegistry.losEngine;
  }

  /** Access the TrajectoryEngine â€” open projectile trajectory analysis panels programmatically. */
  public get trajectoryEngine(): TrajectoryEngine | null {
    return this._analysisRegistry.trajectoryEngine;
  }

  public get keyTerrainIdentificationEngine(): KeyTerrainIdentificationEngine | null {
    return this._analysisRegistry.keyTerrainIdentificationEngine;
  }

  public get posDefScorerEngine(): PosDefScorerEngine | null {
    return this._analysisRegistry.posDefScorerEngine;
  }

  public get opRankerEngine(): OpRankerEngine | null {
    return this._analysisRegistry.opRankerEngine;
  }

  public get localPeaksEngine(): LocalPeaksEngine | null {
    return this._analysisRegistry.localPeaksEngine;
  }

  public get ocokaEngine(): OcokaEngine | null {
    return this._analysisRegistry.ocokaEngine;
  }

  public get missionPlannerEngine(): MissionPlannerEngine | null {
    return this._analysisRegistry.missionPlannerEngine;
  }

  public get deadGroundMapper(): DeadGroundMapper | null {
    return this._analysisRegistry.deadGroundMapper;
  }

  public get bufferEngine(): BufferEngine | null {
    return this._analysisRegistry.bufferEngine;
  }

  public get corridorEngine(): CorridorEngine | null {
    return this._analysisRegistry.corridorEngine;
  }

  public get effectEngine(): EffectEngine | null {
    return this._analysisRegistry.effectEngine;
  }

  public get flightEngine(): FlightEngine | null {
    return this._analysisRegistry.flightEngine;
  }

  /** Get current settings data for the control panel */
  public get settings(): typeof settingsData {
    return settingsData;
  }


  /**
   * Handle runtime setting changes from the control panel.
   * Updates settingsData in memory and applies changes to active engines.
   */
  public onSettingChanged(path: string[], value: any): void {
    // Build the nested path in settingsData
    let current: any = settingsData;
    for (let i = 0; i < path.length - 1; i++) {
      if (!current[path[i]]) current[path[i]] = {};
      current = current[path[i]];
    }
    current[path[path.length - 1]] = value;

    console.log(`[SymbolEngine] Setting updated: ${path.join('.')} =`, value);

    // Apply specific setting changes to active engines
    const fullPath = path.join('.');

    if (fullPath.startsWith('features.')) {
      const feature = path[1];
      if (feature === 'measurementEngine') {
        if (value) {
          // Lazy-load the engine on first opt-in so flipping the Settings
          // checkbox works even when the boot gate left it unloaded.
          void (async () => {
            const engine = this._measurementEngine ?? (await this._initMeasurementEngine());
            engine?.enable();
          })();
        } else {
          this._measurementEngine?.disable();
        }
      } else if (feature === 'proximityEngine' && this._proximityEngine) {
        value
          ? this._proximityEngine.enable()
          : this._proximityEngine.disable();
      } else if (feature === 'contextMenu') {
        value
          ? this._contextMenuManager.enable()
          : this._contextMenuManager.disable();
      } else if (feature === 'clipboard' && !value) {
        this._clipboardEngine.clear();
      } else if (feature === 'selectionQuickToolbar' && this._selectionActionPanel) {
        value
          ? this._selectionActionPanel.enable()
          : this._selectionActionPanel.disable();
      } else {
        console.log(`[SymbolEngine] Feature '${feature}' changed to ${value}`);
      }
    }

    if (fullPath.startsWith('measurement.') && this._measurementEngine) {
      const measureCfg = (settingsData as any).measurement ?? {};
      this._measurementEngine.setOptions({
          dist_unit: measureCfg.distUnit,
          area_unit: measureCfg.areaUnit,
          font_size: measureCfg.fontSize,
          font_color: measureCfg.fontColor,
          font_opacity: measureCfg.fontOpacity,
          line_color: measureCfg.lineColor,
          line_width: measureCfg.lineWidth,
          line_opacity: measureCfg.lineOpacity,
          show_bng: measureCfg.showBng,
          show_height: measureCfg.showHeight,
          show_width: measureCfg.showWidth,
          show_area: measureCfg.showArea,
          show_total: measureCfg.showTotal,
          show_segment: measureCfg.showSegment,
          show_extent: measureCfg.showExtent,
          show_line: measureCfg.showLine,
          show_last_seg_only: measureCfg.showLastSegOnly,
          slant_range: measureCfg.slantRange,
          magnetic_declination: measureCfg.magneticDeclination,
          speed_kmh: measureCfg.speedKmh,
          bearing_format: measureCfg.bearingFormat,
          auto_unit: measureCfg.autoUnit,
          preserve_labels_on_complete: measureCfg.preserveOnComplete,
          road_eta: measureCfg.roadEta
      });
      console.log(`[SymbolEngine] MeasurementEngine config updated from Settings.json`);
    }

    if (fullPath.startsWith('proximity.')) {
      // Update proximity engine config if it's running
      if (this._proximityEngine) {
        const key = path[path.length - 1];
        const config: any = {};

        // Map setting keys to ProximityEngine config
        const keyMap: Record<string, string> = {
          nearestVertex: 'nearestVertex',
          nearestCoordinate: 'nearestCoordinate',
          showDistance: 'showDistance',
          distanceUnit: 'distanceUnit',
          snapRadiusPx: 'snapRadiusPx',
          lineColor: 'lineColor',
          lineOpacity: 'lineOpacity',
          lineWidth: 'lineWidth',
          markerColor: 'markerColor',
          markerSize: 'markerSize',
          fontSize: 'fontSize',
          fontColor: 'fontColor',
        };

        const configKey = keyMap[key];
        if (configKey) {
          config[configKey] = value;
          this._proximityEngine.updateConfig(config);
          console.log(
            `[SymbolEngine] ProximityEngine config updated: ${configKey} =`,
            value,
          );
        }
      }
    }

    if (fullPath === 'features.analysisEngines') {
      if (!value) {
        this._analysisRegistry.destroyAll();
      } else {
        // User-initiated re-enable — build immediately so the next right-click
        // shows the Analysis submenu without an idle-callback delay.
        this._analysisRegistry.initAll(true);
      }
    }

    // Individual analysis engine toggles
    if (fullPath.startsWith('analysis.') && (settingsData as any).features?.analysisEngines !== false) {
      this._analysisRegistry.setEnabled(path[1] as any, !!value);
    }

    if (fullPath === 'features.mgrsEngine') {
      if (this._mgrsEngine) {
        value ? this._mgrsEngine.enable() : this._mgrsEngine.disable();
      } else if (value) {
        // Engine was disabled at startup — initialise it now
        this._initMGRSEngine();
      }
    }

    if (fullPath.startsWith('mgrs.') && this._mgrsEngine) {
      const mgrsCfg = (settingsData as any).mgrs ?? {};
      this._mgrsEngine.setOptions(mgrsCfg as MGRSEngineOptions);
    }

    if (fullPath === 'features.visualizationEngine') {
      if (this._visualizationEngine) {
        value ? this._visualizationEngine.enable() : this._visualizationEngine.disable();
      } else if (value) {
        this._initVisualizationEngine();
      }
    }

    if (fullPath === 'features.roadNetwork') {
      if (value) {
        // Turning ON: (re-)probe the backend, and only spin up the dependent
        // pieces (roads layer, Trafficability widget) once it actually answers.
        if (this._roadNetworkEngine) {
          this._roadNetworkEngine.updateConfig({ enabled: true });
          void this._roadNetworkEngine.ensureAvailable(true).then((up) => {
            if (!up) {
              console.info('[SymbolEngine] Road network still unreachable on re-toggle');
              return;
            }
            if ((settingsData as any).roadNetwork?.showRoadsLayer !== false) {
              void this._roadNetworkEngine!.showRoadsLayer();
            }
            this._initTrafficabilityEngine();
          });
        } else {
          // First-time init: probe is built in.
          this._initRoadNetworkEngine();
        }
      } else {
        // Turning OFF: tear down anything attached, but keep the engine instance
        // around so the next ON-toggle can just re-probe.
        if (this._roadNetworkEngine) {
          this._roadNetworkEngine.updateConfig({ enabled: false });
          this._roadNetworkEngine.hideRoadsLayer();
        }
        this._trafficabilityEngine?.close();
        this._contextMenuManager?.linkTrafficabilityEngine(null);
      }
    }

    if (fullPath.startsWith('roadNetwork.') && this._roadNetworkEngine) {
      const key = path[path.length - 1];
      if (key === 'showRoadsLayer') {
        value
          ? void this._roadNetworkEngine.showRoadsLayer()
          : this._roadNetworkEngine.hideRoadsLayer();
      } else {
        const rn = (settingsData as any).roadNetwork ?? {};
        this._roadNetworkEngine.updateConfig({
          apiBaseUrl: rn.apiBaseUrl,
          dataBaseUrl: rn.dataBaseUrl,
          timeoutMs: rn.timeoutMs,
          availabilityTtlMs: rn.availabilityTtlMs,
        });
      }
    }

    if (fullPath.startsWith('visualization.') && this._visualizationEngine) {
      const vizCfg = (settingsData as any).visualization ?? {};
      this._visualizationEngine.setOptions(vizCfg as VisualizationOptions);
    }

    if (fullPath === 'features.drawingCues' && this._drawingCueEngine) {
      value ? this._drawingCueEngine.enable() : this._drawingCueEngine.disable();
    }

    if (fullPath.startsWith('drawingCues.') && this._drawingCueEngine) {
      // Re-apply the entire drawingCues block from the (already-mutated) settingsData
      const cuesCfg = (settingsData as any).drawingCues ?? {};
      this._drawingCueEngine.setOptions(cuesCfg as DrawingCueOptions);
    }

    if (fullPath === 'logging.enabled') {
      EngineLogger.setEnabled(!!value);
    }

    if (fullPath === 'features.deploymentBuilder') {
      if (value && !this._deploymentBuilderEngine) {
        this._initDeploymentBuilderEngine();
      } else if (!value && this._deploymentBuilderEngine) {
        this._deploymentBuilderEngine.disable();
        this._contextMenuManager.linkDeploymentBuilderEngine(null);
      } else if (value && this._deploymentBuilderEngine) {
        this._deploymentBuilderEngine.enable();
        this._contextMenuManager.linkDeploymentBuilderEngine(this._deploymentBuilderEngine);
      }
    }

    if (fullPath === 'size') {
      // Force-symbol marker size — resize every FPoint already on the map so the
      // setting drives existing symbols, not just newly drawn ones.
      this._applyForceSymbolSize(value);
    }

    if (fullPath === 'creationMode') {
      if (this._continuousTimeoutId !== null) {
        clearTimeout(this._continuousTimeoutId);
        this._continuousTimeoutId = null;
      }
      this._creationMode = value as 'single' | 'continuous';
    }

    if (fullPath === 'ui.theme') {
      ThemeManager.getInstance().setTheme(value);
    }

    if (fullPath === 'declutter.enabled') {
      if (value) this._declutterEngine?.enable();
      else this._declutterEngine?.disable();
    }

    if (fullPath === 'declutter.cluster.enabled') {
      if (value) this._clusterEngine?.enable();
      else this._clusterEngine?.disable();
    }

    if (fullPath === 'declutter.labels.enabled') {
      if (value) this._labelPlacer?.enable();
      else this._labelPlacer?.disable();
    }

    if (fullPath === 'declutter.disperse.enabled') {
      if (value) this._markerDisperser?.enable();
      else this._markerDisperser?.disable();
    }

    if (fullPath === 'declutter.ladder.enabled') {
      if (value) this._ladderEngine?.enable();
      else this._ladderEngine?.disable();
    }

    if (fullPath.startsWith('declutter.') && fullPath !== 'declutter.enabled') {
      this._declutterEngine?.refresh();
      if (fullPath.startsWith('declutter.cluster.')) this._clusterEngine?.refresh();
      if (fullPath.startsWith('declutter.labels.')) this._labelPlacer?.refresh();
      if (fullPath.startsWith('declutter.disperse.')) this._markerDisperser?.refresh();
      if (fullPath.startsWith('declutter.ladder.')) this._ladderEngine?.refresh();
    }

    // Emit event so other parts of the app can react
    this.emitEvent('settingChanged', { path: path.join('.'), value });
  }

  /**
   * Re-render every force (FPoint) symbol on the FORCE layer at the given marker
   * size. Called when the Settings-panel "Size" value changes so the setting
   * also drives symbols already on the map. Routed through {@link updateSymbol}
   * so geometry, amplifiers, angle and opacity are preserved; undo is suppressed
   * because — like every other settings change — a global resize is not an
   * undoable edit.
   */
  private _applyForceSymbolSize(size: number): void {
    const n = Number(size);
    if (!Number.isFinite(n) || n <= 0) return;

    const forceLayer = this._layerManager.getLayer(LAYER_NAMES.FORCE);
    if (!forceLayer) return;

    // Snapshot first — updateSymbol() removes and re-adds each graphic, which
    // would otherwise mutate the collection while we iterate it. (toArray()
    // already returns a fresh array.)
    const graphics = forceLayer.graphics.toArray();

    this._suppressEditUndoCount++;
    try {
      for (const graphic of graphics) {
        const de = (graphic.attributes as any)?.drawEssentials;
        const isFPoint =
          String(de?.SYM_GEO_TYPE ?? '').toLowerCase() === 'fpoint' ||
          de?.UEI === '1' ||
          de?.UEI === 1;
        if (!isFPoint) continue;
        if (Number(de?.extraSettings?.size) === n) continue; // already this size
        this.updateSymbol(graphic, { extraSettings: { size: n } });
      }
    } finally {
      this._suppressEditUndoCount = Math.max(0, this._suppressEditUndoCount - 1);
    }
  }

  // -----------------------------------------------------------------------
  // DeclutterEngine
  // -----------------------------------------------------------------------

  private _initDeclutterEngine(): void {
    this._declutterEngine = new DeclutterEngine(this._getView, this._layerManager);
    const d = (settingsData as any).declutter;
    if (d?.enabled === true) this._declutterEngine.enable();

    // ClusterEngine sits on top of DeclutterEngine — registers itself as a
    // solve step when enabled, dormant otherwise.
    this._clusterEngine = new ClusterEngine(
      this._getView,
      this._layerManager,
      this._declutterEngine,
    );
    if (d?.cluster?.enabled === true) this._clusterEngine.enable();

    // LabelPlacer — Maplex-style label placement with leader lines. Also
    // a solve step; dormant until enabled in settings.
    this._labelPlacer = new LabelPlacer(
      this._getView,
      this._layerManager,
      this._declutterEngine,
    );
    if (d?.labels?.enabled === true) this._labelPlacer.enable();

    // MarkerDisperser — radial fan-out for symbols stacked at the same
    // point at high zoom. Complements clustering (which handles dense
    // scenes at low/mid zoom).
    this._markerDisperser = new MarkerDisperser(
      this._getView,
      this._layerManager,
      this._declutterEngine,
    );
    if (d?.disperse?.enabled === true) this._markerDisperser.enable();

    // LadderEngine — vertical-stack ("flag halyard") alternative to the
    // radial disperser at high zoom. Same activation range as Disperse;
    // when both are enabled, ladder claims qualifying stacks first
    // (via __ladderRung guard) and disperser handles the residue.
    this._ladderEngine = new LadderEngine(
      this._getView,
      this._layerManager,
      this._declutterEngine,
    );
    if (d?.ladder?.enabled === true) this._ladderEngine.enable();
  }

  // -----------------------------------------------------------------------
  // Undo / Redo — delegated to UndoRedoManager
  // -----------------------------------------------------------------------

  /** Push an undo entry and clear the redo stack. */
  public _pushUndo(entry: UndoEntry): void {
    this._undoRedoManager.push(entry);
  }

  /** Snapshot the graphic's current geometry and CTRL_PTS before an edit begins. */
  private _capturePreEditSnapshot(
    graphic: Graphic,
    additionalGraphics: Graphic[],
    operationLabel: string,
  ): void {
    this._undoRedoManager.capturePreEditSnapshot(
      graphic,
      additionalGraphics,
      operationLabel,
    );
  }

  /** Undo the last operation. */
  public undo(): void {
    this._undoRedoManager.undo();
  }

  /** Redo the last undone operation. */
  public redo(): void {
    this._undoRedoManager.redo();
  }

  /** Number of operations available to undo. */
  public get undoCount(): number {
    return this._undoRedoManager.undoCount;
  }

  /** Current creation mode ('single' or 'continuous'). */
  public get creationMode(): 'single' | 'continuous' {
    return this._creationMode;
  }

  public set creationMode(mode: 'single' | 'continuous') {
    if (this._continuousTimeoutId !== null) {
      clearTimeout(this._continuousTimeoutId);
      this._continuousTimeoutId = null;
    }
    this._creationMode = mode;
    (settingsData as any).creationMode = mode;
  }

  /** Stop continuous creation mode and revert to single. No-op if already single. */
  public stopContinuousMode(): void {
    if (this._creationMode !== 'continuous') return;
    if (this._continuousTimeoutId !== null) {
      clearTimeout(this._continuousTimeoutId);
      this._continuousTimeoutId = null;
    }
    this._creationMode = 'single';
    (settingsData as any).creationMode = 'single';
    this._lastDrawEssentials = null;
    this._lastAmplifier = null;
    this.emitEvent('creationModeChanged', { mode: 'single' });
    EngineLogger.success('Symbol Engine', 'Continuous mode stopped â€” reverted to single');
  }

  /** Number of operations available to redo. */
  public get redoCount(): number {
    return this._undoRedoManager.redoCount;
  }

  /** Label of the next undo operation, or null if the stack is empty. */
  public get nextUndoLabel(): string | null {
    return this._undoRedoManager.nextUndoLabel;
  }

  /** Label of the next redo operation, or null if the stack is empty. */
  public get nextRedoLabel(): string | null {
    return this._undoRedoManager.nextRedoLabel;
  }

  // -----------------------------------------------------------------------
  // Copy / Paste — delegated to ClipboardEngine
  // -----------------------------------------------------------------------

  /**
   * Copy a graphic to the internal clipboard.
   * Stores a deep clone of the graphic's geometry, symbol, and drawEssentials.
   */
  public copySymbol(graphic: Graphic): void {
    this._clipboardEngine.copy(graphic);
  }

  /**
   * True when the clipboard holds a graphic ready to paste.
   */
  public get hasClipboard(): boolean {
    return this._clipboardEngine.hasClipboard;
  }

  /**
   * Paste clipboard graphic(s) at targetPoint.
   * Single item: places its centroid at targetPoint.
   * Multiple items: preserves relative layout, collective centroid lands at targetPoint.
   * Returns the first pasted Graphic, or null if clipboard is empty.
   */
  public pasteSymbol(
    targetPoint: Point,
    expandDistance: number = 0,
    expandUnit: string = 'meters',
  ): Graphic | null {
    return this._clipboardEngine.paste(targetPoint, expandDistance, expandUnit);
  }

  /**
   * Show Paste Offset Dialog (Triggered by CTRL+SHIFT+V)
   */
  public _showPasteOffsetDialog(): void {
    this._clipboardEngine.showPasteOffsetDialog();
  }

  /**
   * Enter "paste mode" with expansion/contraction distance: the next map click pastes the clipboard graphic there.
   */
  public _activatePasteModeWithOffset(
    expandDistance: number,
    expandUnit: string,
  ): void {
    this._clipboardEngine.activatePasteModeWithOffset(
      expandDistance,
      expandUnit,
    );
  }

  /**
   * Enter "paste mode": the next map click pastes the clipboard graphic there.
   * Escape cancels paste mode.
   */
  public _activatePasteMode(): void {
    this._clipboardEngine.activatePasteMode();
  }


  public enrichSymbolOptions(options: SymbolOptions): SymbolOptions & {
    parsedSIDC?: ParsedSIDC;
    label?: string;
    text?: string;
  } {
    return SymbolMetadataService.enrich(options);
  }

  createLineSymbol(
    color: string = '#0000FF',
    width: number = 2,
  ): SimpleLineSymbol {
    return new SimpleLineSymbol({ color: new Color(color), width });
  }

  createFillSymbol(
    color = '#00FF00',
    outlineColor = '#000000',
    outlineWidth = 1,
  ): SimpleFillSymbol {
    return new SimpleFillSymbol({
      color: new Color(color),
      outline: new SimpleLineSymbol({
        color: new Color(outlineColor),
        width: outlineWidth,
      }),
    });
  }

  createPictureMarkerSymbol(
    url: string,
    width: number,
    height: number,
  ): PictureMarkerSymbol {
    return new PictureMarkerSymbol({ url, width, height });
  }

  addPointToLayer(geometry: Point): void {
    const layer = this._layerManager.getOrCreateLayer(LAYER_NAMES.FORCE);
    const symbol = this.createPointSymbol();
    const graphic = new Graphic({ geometry, symbol });
    layer.add(graphic);
  }

  addPictureMarkerAtCenter(
    url: string,
    width = 20,
    height = 20,
    view: MapView | SceneView,
  ): void {
    if (!view.center) return console.error('View center is not defined.');
    const geometry = view.center.clone();

    if (SymbolEngine.isView2D(view)) {
      this.addPictureMarkerFor2D(geometry, url, width, height);
    } else {
      this.addPictureMarkerFor3D(geometry, url, width, height);
    }
  }

  drawMilSymbolInteractively(
    drawEssentials: DrawEssentials,
    amplifier: Amplifier,
    attr: object,
  ): void {
    const sketchLayer = this._layerManager.getOrCreateLayer(LAYER_NAMES.SKETCH);
    const view = this.view;
    const sketchVM = new SketchViewModel({
      view,
      layer: sketchLayer,
      pointSymbol: this.generateForceSymbol(drawEssentials, amplifier, attr),
    });

    sketchVM.create('point');

    sketchVM.on('create', (event) => {
      if (event.state === 'active' && event.graphic?.geometry) {
        // Feed cursor position into the proximity/echelon-buffer pipeline
        document.dispatchEvent(
          new CustomEvent('onDrawProgress', {
            detail: {
              symbolType: 'milSymbol',
              currentGeometry: event.graphic.geometry,
              currentDrawEssentials: { AMPLIFIER: amplifier },
            },
            bubbles: true,
          }),
        );
      }
      if (event.state === 'complete') {
        const point = event.graphic.geometry as Point;
        this.addMilSymbolAtPoint(point, drawEssentials, amplifier, attr);
        sketchLayer.remove(event.graphic);
        sketchVM.destroy();
        this._proximityEngine?.deactivate();
      }
      if (event.state === 'cancel') {
        this._proximityEngine?.deactivate();
      }
    });
  }
  private addMilSymbolFor2D(
    geometry: Point,
    drawEssentials: DrawEssentials,
    amplifier: Amplifier,
    attr: object,
  ): void {
    const layer = this._layerManager.getSymbolLayer();
    const symbol = this.generateForceSymbol(drawEssentials, amplifier, attr);

    const graphic = new Graphic({ geometry, symbol, attributes: attr });
    layer.add(graphic);
  }

  addMilSymbolAtPoint(
    point: Point,
    drawEssentials: DrawEssentials,
    amplifier: Amplifier,
    attr: object,
  ): void {
    try {
      this.addMilSymbolFor2D(point, drawEssentials, amplifier, attr);
      /*
            if (SymbolEngine.isView2D(view)) {
                this.addMilSymbolFor2D(point, options, dataUrl, width, height);
            } else {
                this.addMilSymbolFor3D(point, options, dataUrl, width, height);
            }
            */
    } catch (err) {
      console.error('Error drawing milsymbol:', err);
    }
  }

  addMilSymbolAtCenter(options: SymbolOptions): void {
    if (!this.view.center) return console.error('View center is not defined.');
    const geometry = this.view.center.clone();

    try {
      this.addMilSymbolFor2D(geometry, options);

      /*
            if (SymbolEngine.isView2D(view)) {
                this.addMilSymbolFor2D(geometry, options, dataUrl, width, height);
            } else {
                this.addMilSymbolFor3D(geometry, options, dataUrl, width, height);
            }
             */
    } catch (error) {
      console.error('Error creating milsymbol:', error);
    }
  }

  protected svgToDataURL(svg: string): string {
    const encodedSVG = encodeURIComponent(svg);
    return `data:image/svg+xml;charset=utf-8,${encodedSVG}`;
  }

  protected addMilSymbolFor3D(
    geometry: Point,
    options: SymbolOptions,
  ): void {
    const layer = this._layerManager.getOrCreateLayer(LEGACY_MIL_SYMBOLS_LAYER_ID);
    const symbol = this.generateForceSymbol(options, 3);

    const graphic = new Graphic({
      geometry,
      symbol,
      attributes: {
        type: 'force',
      },
    });
    layer.add(graphic);
  }

  private addPictureMarkerFor2D(
    geometry: Point,
    url: string,
    width: number,
    height: number,
  ): void {
    const layer = this._layerManager.getOrCreateLayer(LAYER_NAMES.FORCE);
    const symbol = new PictureMarkerSymbol({ url, width, height });

    const graphic = new Graphic({
      geometry,
      symbol,
      attributes: {
        type: 'force',
      },
    });
    layer.add(graphic);
  }

  private addPictureMarkerFor3D(
    geometry: Point,
    url: string,
    width: number,
    height: number,
  ): void {
    const layer = this._layerManager.getOrCreateLayer(LAYER_NAMES.FORCE);

    const symbol = new PointSymbol3D({
      symbolLayers: [
        new IconSymbol3DLayer({
          resource: { href: url },
          size: width,
          anchor: 'bottom',
        }),
      ],
      verticalOffset: {
        screenLength: height,
        maxWorldLength: 500,
        minWorldLength: 50,
      },
    });

    const graphic = new Graphic({ geometry, symbol });
    layer.add(graphic);
  }

  applySymbol(
    graphic: Graphic,
    symbol: SimpleMarkerSymbol | SimpleLineSymbol | SimpleFillSymbol,
  ): void {
    graphic.symbol = symbol;
  }

  static isView2D(view: View): boolean {
    return view.type === '2d';
  }

  static isView3D(view: View): boolean {
    return view instanceof SceneView;
  }

  ensureMsAvailable(): void {
    // Check for both UEITypes.js and milsymbol.js
    if (typeof (window as any).MS === 'undefined') {
      throw new Error(
        'MS (UEITypes) library is not properly loaded or invalid.',
      );
    }

    console.log('MS (milsymbol.js) version:', (window as any).MS.version);
    console.log(
      'MS (milsymbol.js) standard:',
      (window as any).MS._STD2525 ? '2525' : 'APP6',
    );
    console.log(
      'MS (milsymbol.js) marker parts count:',
      (window as any).MS.getMarkerParts().length,
    );
  }

  /**
   * Cache for the expensive milsymbol → canvas → dataURL rasterisation.
   * Keyed on SIDC + size; re-used across draws of the same symbol class.
   * PictureMarkerSymbol instances are still constructed per call (cheap) so
   * ArcGIS isn't handed the same mutable symbol object twice.
   */
  private static _forceRasterCache: Map<
    string,
    { url: string; width: number; height: number; xoffset: number; yoffset: number }
  > = new Map();
  private static readonly _FORCE_RASTER_CACHE_MAX = 256;

  generateForceSymbol(
    drawEssentials: DrawEssentials,
    amplifier: Amplifier,
    attr: object,
  ): PictureMarkerSymbol | undefined {
    try {
      // Use milsymbol.js instead of UEITypes
      const sidc = amplifier.SIDC;
      if (!sidc) {
        console.error('SIDC is required for symbol generation');
        return undefined;
      }

      const size = drawEssentials.SIZE || 35;
      const cacheKey = `${sidc}|${size}`;
      const cached = SymbolEngine._forceRasterCache.get(cacheKey);
      if (cached) {
        return new PictureMarkerSymbol({
          url: cached.url,
          width: cached.width + 'px',
          height: cached.height + 'px',
          xoffset: cached.xoffset,
          yoffset: cached.yoffset,
        });
      }

      // Create milsymbol.js options
      const msOptions = {
        size,
      };

      // Generate the symbol using milsymbol.js
      const symbol = new window.MS.symbol(sidc, msOptions);

      /*// Initialize the marker to generate drawInstructions
            symbol.getMarker();
            // Generate SVG
            const svgString = symbol.asSVG();
            console.log("Generated SVG from milsymbol.js:", svgString);
            // Convert SVG to data URL
            const dataUrl = "data:image/svg+xml;base64," + btoa(svgString);

            // Get symbol dimensions
            const width = symbol.width || 35;
            const height = symbol.height || 35;

            // Calculate offsets based on anchor point
            const anchor = symbol.markerAnchor || { x: width / 2, y: height / 2 };
            const xoffset = (width / 2) - anchor.x;
            const yoffset = (height / 2) - anchor.y;

            const pictureMarkerSymbol = new PictureMarkerSymbol({
                url: dataUrl,
                width: width + "px",
                height: height + "px",
                xoffset,
                yoffset
            });*/
      symbol.getMarker();
      // Generate SVG
      const canvas = symbol.asCanvas();

      // Convert SVG to data URL
      const dataUrl = canvas.toDataURL();

      // Get symbol dimensions
      const width = symbol.width || 35;
      const height = symbol.height || 35;

      // Calculate offsets based on anchor point
      const anchor = symbol.markerAnchor || { x: width / 2, y: height / 2 };
      const xoffset = width / 2 - anchor.x;
      const yoffset = height / 2 - anchor.y;

      const pictureMarkerSymbol = new PictureMarkerSymbol({
        url: dataUrl,
        width: width + 'px',
        height: height + 'px',
        xoffset,
        yoffset,
      });

      if (SymbolEngine._forceRasterCache.size >= SymbolEngine._FORCE_RASTER_CACHE_MAX) {
        const firstKey = SymbolEngine._forceRasterCache.keys().next().value;
        if (firstKey !== undefined) SymbolEngine._forceRasterCache.delete(firstKey);
      }
      SymbolEngine._forceRasterCache.set(cacheKey, {
        url: dataUrl,
        width,
        height,
        xoffset,
        yoffset,
      });

      return pictureMarkerSymbol;
    } catch (e) {
      console.error('Error generating force symbol with milsymbol.js:', e);
      return undefined;
    }
  }

  public initialize(
    drawEssentials: DrawEssentials,
    amplifier: Amplifier,
    isPassive?: boolean,
  ): void {
    try {
      if (isPassive === undefined) {
        isPassive = false;
      }

      // Cancel any pending continuous re-init from the previous draw
      if (this._continuousTimeoutId !== null) {
        clearTimeout(this._continuousTimeoutId);
        this._continuousTimeoutId = null;
      }

      // Store for continuous creation mode re-use
      if (!isPassive) {
        this._lastDrawEssentials = drawEssentials;
        this._lastAmplifier = amplifier;
      }

      // Close any active edit/move workflow before starting a new draw
      if (!isPassive) {
        this._closeActiveWorkflow();
        this._selectionEngine.setDrawing(true);
        // Arm proximity indicator for the upcoming draw session
        this._proximityEngine?.activate();
        // Arm drawing cue overlays for the upcoming draw session
        this._drawingCueEngine?.activate([...SYMBOL_LAYER_IDS]);
      }

      // Moved initialization of symbolData to constructor to avoid re-parsing
      // this.symbolData = JSON.parse(symData); // symData is already imported as JSON object

      // Ensure SIDC and currentSymbol are properly set before proceeding
      // This part assumes that SIDC and amplifier are already set up in a way that getSID/getSIDC return meaningful values
      // Or, they need to be passed into initialize if they vary per call.
      // For now, I'll use the dummy SIDC initialized in the constructor.
      // If you have a concrete SIDC instance, use that here.
      this.sidc = new SIDC(amplifier.SIDC); // Assuming Amplifier has a SIDC property and SIDC class can be instantiated this way.
      this.amplifier = amplifier; // Set the amplifier for later use

      // Snapshot the current draw session's identity so drawSymEnd() reads
      // from these stable copies even if initialize() is called again before
      // this draw completes (e.g. rapid re-pick or continuous mode).
      this._activeSIDC = this.sidc;
      this._activeAmplifier = this.amplifier;

      const reqSID = this.sidc.getSID();
      const coSIDC = this.sidc.getSIDC();
      const symSet = coSIDC.substring(4, 6); // Changed substr to substring for correctness in modern JS

      // Find the current symbol definition
      this.currentSymbol = symbolData[symSet + reqSID];

      if (this.currentSymbol) {
        // Wrap the rest of the logic in this check
        const symbol = this.getSymbol(drawEssentials.IS_LINE);
        symbol.amplifier = amplifier;

        /*
                // Set up event handlers
                this.endEvent = symbol.on("onDrawEnd", (data: any) => this.drawSymEnd(data));
                this.drawProgressEvent = symbol.on("onDrawProgress", (data: any) => this.symDrawProgress(data));
                this.drawClickEvent = symbol.on("onDrawClick", (data: any) => this.symDrawClick(data));
                this.drawBaseLineEndEvent = symbol.on("onBaseLineDrawEnd", (data: any) => this.baseLineDrawEnd(data));
                */

        let marker: any = null;

        if (drawEssentials.extraSettings !== undefined) {
          if (drawEssentials.extraSettings.textSize !== undefined) {
            settingsData.textSize = drawEssentials.extraSettings.textSize;
          }
        }

        // Make sure labelOptions is defined; assuming it might be part of SymbolEngine's state or a parameter
        // If labelOptions is not passed as a parameter to initialize, you need to decide how it's initialized.
        // For now, I'll keep it as `this.labelOptions = labelOptions || {};` and assume `labelOptions` is an existing variable in this scope.
        // If it's not, you'll need to pass it or define a default.
        // For the purpose of this snippet, let's assume it comes from `drawEssentials` or is a class property.
        this.labelOptions = drawEssentials.labelOptions || {};

        if (
          this.currentSymbol.SymGeoType === 'Point' ||
          this.currentSymbol.SymGeoType === 'FPoint'
        ) {
          marker = this.sidc.getMarker(
            symbol.symGeometricType,
            symbol.isObstacle,
            this.currentSymbol.Fill,
          );

          /*
                    extraSettings parameters is added to pass line width and force symbol size from interface, remove it and relevant conditions
                    to let SIDC class read settings from settings.json
                    */

          if (drawEssentials.extraSettings !== undefined) {
            // Changed 'extraSettings' to 'drawEssentials.extraSettings'
            if (this.currentSymbol.SymGeoType === 'Point') {
              if (drawEssentials.extraSettings.hasOwnProperty('lineWidth')) {
                marker.outline.width = drawEssentials.extraSettings.lineWidth;
              }

              if (drawEssentials.extraSettings.hasOwnProperty('size')) {
                drawEssentials.SIZE = drawEssentials.extraSettings.size;
              }

              if (drawEssentials.extraSettings.hasOwnProperty('opacity')) {
                marker.outline.color.a = drawEssentials.extraSettings.opacity;
                if (drawEssentials.SID !== '000110')
                  marker.color.a = drawEssentials.extraSettings.opacity;
                drawEssentials.opacity = drawEssentials.extraSettings.opacity;
              }
            }
            if (this.currentSymbol.SymGeoType === 'FPoint') {
              // The Settings-panel "Size" (settingsData.size) is the source of
              // truth for force-symbol marker size — drive every freshly drawn
              // FPoint from it so changing the setting actually takes effect.
              // Passive re-renders (Morphix edits, plan loads, global resize)
              // keep the size already baked into extraSettings.
              if (!isPassive) {
                const panelSize = Number((settingsData as any).size);
                if (Number.isFinite(panelSize) && panelSize > 0) {
                  drawEssentials.extraSettings.size = panelSize;
                }
              }

              if (drawEssentials.extraSettings.hasOwnProperty('size')) {
                drawEssentials.SIZE = drawEssentials.extraSettings.size; // Changed drawEssentials.size to drawEssentials.SIZE
              }

              if (drawEssentials.extraSettings.hasOwnProperty('opacity')) {
                drawEssentials.opacity = drawEssentials.extraSettings.opacity;
              }
            }
          }

          if (isPassive === true) {
            const deAny = drawEssentials as any;
            if (deAny.GEOM) {
              deAny.GEOM = this.reProject(
                deAny.GEOM,
                this.view.spatialReference,
              );
            }
            if (
              deAny.OPTIONS &&
              Object.prototype.hasOwnProperty.call(deAny.OPTIONS, 'GEOM') &&
              deAny.OPTIONS.GEOM
            ) {
              deAny.OPTIONS.GEOM = this.reProject(
                deAny.OPTIONS.GEOM,
                this.view.spatialReference,
              );
            }
          }

          symbol.init(
            drawEssentials,
            marker,
            this.sidc.getSID(),
            this.currentSymbol.Name,
            this.currentSymbol.Offset,
            this.sidc._sidc,
          );
        } else {
          marker = this.sidc.getMarker(
            symbol.symGeometricType,
            symbol.isObstacle,
          );

          /*
                    extraSettings parameters is added to pass line width and force symbol size from interface, remove it and relevant conditions
                    to let SIDC class read settings from settings.json
                    */
          if (drawEssentials.extraSettings !== undefined) {
            // Changed 'extraSettings' to 'drawEssentials.extraSettings'

            if (drawEssentials.extraSettings.hasOwnProperty('lineWidth')) {
              marker.width = drawEssentials.extraSettings.lineWidth;
            }

            if (drawEssentials.extraSettings.hasOwnProperty('opacity')) {
              marker.color.a = drawEssentials.extraSettings.opacity;
              drawEssentials.opacity = drawEssentials.extraSettings.opacity;
            }
          }

          if (isPassive === true) {
            if (
              drawEssentials.hasOwnProperty('CTRL_PTS') &&
              drawEssentials.CTRL_PTS
            ) {
              for (var j = 0; j < drawEssentials.CTRL_PTS.length; j++) {
                drawEssentials.CTRL_PTS[j] = this.reProject(
                  drawEssentials.CTRL_PTS[j],
                  this.view.spatialReference,
                ); // Changed this.map to this.view
              }
            }

            if (
              drawEssentials.hasOwnProperty('BASE_LN_PTS') &&
              drawEssentials.BASE_LN_PTS
            ) {
              if (
                drawEssentials.BASE_LN_PTS.hasOwnProperty('startPt') &&
                drawEssentials.BASE_LN_PTS.startPt
              )
                drawEssentials.BASE_LN_PTS.startPt = this.reProject(
                  drawEssentials.BASE_LN_PTS.startPt,
                  this.view.spatialReference,
                ); // Changed this.map to this.view
              if (
                drawEssentials.BASE_LN_PTS.hasOwnProperty('midPt') &&
                drawEssentials.BASE_LN_PTS.midPt
              )
                drawEssentials.BASE_LN_PTS.midPt = this.reProject(
                  drawEssentials.BASE_LN_PTS.midPt,
                  this.view.spatialReference,
                ); // Changed this.map to this.view
              if (
                drawEssentials.BASE_LN_PTS.hasOwnProperty('endPt') &&
                drawEssentials.BASE_LN_PTS.endPt
              )
                drawEssentials.BASE_LN_PTS.endPt = this.reProject(
                  drawEssentials.BASE_LN_PTS.endPt,
                  this.view.spatialReference,
                ); // Changed this.map to this.view
            }
          }
          symbol.init(drawEssentials, marker);
        }
      } else {
        console.warn(`Symbol data not found for SIDC part: ${symSet + reqSID}`);
      }
    } catch (e) {
      console.error('Error parsing labels for symbol generation', e);
    }
  }

  public getSymbol(isLine?: boolean): any {
    if (this.currentSymbol !== undefined) {
      this.mapper = new Mapper(this.currentSymbol.Class);
      const SymbolClass = this.mapper.getInstance();
      return new SymbolClass(this.view, isLine);
    } else {
      throw new Error('SIDC not found');
    }
  }

  /**
   * Project a Point to the specified spatial reference.
   * @param point The Point to project
   * @param spatialReference The target spatial reference
   * @returns The projected Point
   */
  public reProject(point: Point, spatialReference: SpatialReference): Point {
    if (!point || !spatialReference) return point;

    const srcWkid = point.spatialReference?.wkid ?? point.spatialReference?.latestWkid;
    const dstWkid = spatialReference.wkid ?? spatialReference.latestWkid;

    // Same SR (or unknown on both) -> keep as-is.
    if (
      (srcWkid !== undefined && dstWkid !== undefined && srcWkid === dstWkid) ||
      (srcWkid === undefined && dstWkid === undefined)
    ) {
      return point;
    }

    // Plan import path is usually WGS84 -> WebMercator.
    if (srcWkid === 4326 && (dstWkid === 3857 || dstWkid === 102100)) {
      const projected = webMercatorUtils.geographicToWebMercator(point) as Point;
      if (projected) return projected;
    }

    // Handle reverse conversion when needed.
    if (
      (srcWkid === 3857 || srcWkid === 102100) &&
      dstWkid === 4326
    ) {
      const projected = webMercatorUtils.webMercatorToGeographic(point) as Point;
      if (projected) return projected;
    }

    // Fallback: keep coordinates and retag SR so downstream draw code stays consistent.
    return new Point({
      x: point.x,
      y: point.y,
      spatialReference,
    });
  }

  createSymbolCacheKey(options: SymbolOptions, scaleFactor: number): string {
    const relevantOptions = {
      sidc: options.sidc,
      scaleFactor,
      quantity: options.quantity,
      staffComments: options.staffComments,
      additionalInformation: options.additionalInformation,
      type: options.type,
      dtg: options.dtg,
      location: options.location,
      outlineColor: options.outlineColor,
      outlineWidth: options.outlineWidth,
    };

    return JSON.stringify(relevantOptions);
  }

  private drawSymEnd(event: any): void {
    try {
      const suppressLifecycle = this._suppressDrawLifecycleCount > 0;
      // Handle both event types - extract common properties
      const { geometry, marker, drawEssentials, symbolType } = event;

      // Validation from handleDrawEnd
      if (!geometry || !marker) {
        console.warn('Missing geometry or marker in draw end event');
        this._selectionEngine.setDrawing(false);
        return;
      }

      // Handle different geometry types
      let symbol;
      if (
        geometry.type === 'point' ||
        geometry.type === 'polyline' ||
        geometry.type === 'polygon'
      ) {
        symbol = marker;
      } else {
        console.error('Unhandled geometry type:', geometry.type);
        return;
      }

      // Create the graphic
      const graphic = new Graphic({
        geometry: geometry,
        symbol: symbol,
      });
      this.isDrawing = false;
      this._selectionEngine.setDrawing(false);

      // Generate a temporary ID
      const tempId = this.generateUUID();

      // Set up drawEssentials and attributes
      if (drawEssentials) {
        // Set SIDC if we have it — read from the per-draw snapshot so a
        // subsequent initialize() (rapid re-pick / continuous mode) cannot
        // replace the in-flight draw's identity before drawSymEnd fires.
        if (this._activeSIDC && this._activeSIDC.getSIDC) {
          drawEssentials.SIDC = this._activeSIDC.getSIDC();
        }

        // Set AMPLIFIER if we have it (same snapshot rationale as above)
        if (this._activeAmplifier) {
          drawEssentials.AMPLIFIER = this._activeAmplifier;
        }

        graphic.set('drawEssentials', drawEssentials);
      }

      // Set up graphic attributes - handle both old style (this.attrs) and new style
      const attrs: any = {
        drawEssentials: drawEssentials,
        type: symbolType || 'symbol',
      };

      // Handle ID assignment â€” use pending ID from load/paste, else generate new
      if (this._pendingAttrs?.symbolId) {
        attrs.id = this._pendingAttrs.symbolId;
        this._pendingAttrs = null;
      } else if ((this as any).attrs?.symbolId != null) {
        attrs.id = (this as any).attrs.symbolId;
      } else {
        attrs.id = tempId;
      }

      // Merge additional attributes if they exist
      if ((this as any).attrs) {
        Object.assign(attrs, (this as any).attrs);
      }

      graphic.attributes = attrs;
      graphic.set('id', attrs.id);

      // Route completed graphics to the same logical layer used while drawing.
      // Without this, all final graphics land in ForceSymbolsLayer and inherit
      // force-point render settings such as 3D lift.
      const graphicsLayer = this.getDrawEndLayer(drawEssentials, geometry);
      graphicsLayer.add(graphic);
      this._lastCreatedGraphic = graphic;
      console.info('Symbol Added');

      // Minefield-style polygons render through PictureFillSymbol in 2D, but
      // SceneView refuses it. The symbol class has already stamped texture
      // metadata onto drawEssentials; emit the textured Mesh child here so
      // the same PNG pattern shows in 3D.
      if (
        geometry?.type === 'polygon' &&
        getMinefieldTextureMetadata(drawEssentials)
      ) {
        syncMinefieldTextureGraphic(graphicsLayer, graphic, this._getView());
      }

      // Push undo entry for the Add operation
      const symLabel = drawEssentials?.SYM_NAME
        ? drawEssentials.SYM_NAME
        : 'Symbol';
      const annotationLayer = this._layerManager.getOrCreateLayer(
        LAYER_NAMES.ANNOTATION_LAYER,
      );
      if (this._suppressNextAddUndoCount > 0) {
        this._suppressNextAddUndoCount--;
      } else {
        this._pushUndo({
          label: `Add ${symLabel}`,
          undo: () => {
            removeMinefieldTextureForGraphic(graphicsLayer, graphic);
            graphicsLayer.remove(graphic);
            AnnotationEngine.deAnnotate(annotationLayer, attrs.id);
          },
          redo: () => {
            graphicsLayer.add(graphic);
            syncMinefieldTextureGraphic(graphicsLayer, graphic, this._getView());
            if (drawEssentials?.AMPLIFIER) {
              AnnotationEngine.annotate(
                annotationLayer,
                geometry,
                drawEssentials.AMPLIFIER,
                drawEssentials,
                attrs.id,
                settingsData.textSize,
                drawEssentials.ISFHAND || 0,
                this.labelOptions || {},
                {},
              );
            }
          },
        });
      }

      // Handle annotation if drawEssentials and amplifier are available
      if (drawEssentials && drawEssentials.AMPLIFIER) {
        const isFreeHand = drawEssentials.ISFHAND || 0;
        drawEssentials.labelOptions = this.labelOptions;

        const options = this.getOpacityValue(graphic);

        // Get the annotation layer from LayerManager
        const annotationLayer = this._layerManager.getOrCreateLayer(
          LAYER_NAMES.ANNOTATION_LAYER,
        );

        AnnotationEngine.annotate(
          annotationLayer,
          geometry,
          drawEssentials.AMPLIFIER,
          drawEssentials,
          attrs.id,
          settingsData.textSize,
          isFreeHand,
          this.labelOptions || {},
          options,
        );
      }

      // Clean up opacity if it exists
      if (drawEssentials && drawEssentials.hasOwnProperty('opacity')) {
        delete drawEssentials.opacity;
      }

      if (!suppressLifecycle) {
        EngineLogger.success(
          'Symbol Engine',
          `Symbol placed â€” ${symbolType || geometry.type} added to map`,
        );
      }
      console.log('Graphic added to layer:', {
        id: attrs.id,
        geometryType: geometry.type,
        symbolType: symbolType || 'unknown',
      });

      // Emit custom events for further processing
      if (!suppressLifecycle) {
        this.emit('symDrawEnd', {
          isDone: 'done',
          drawEssentials: drawEssentials,
          id: attrs.id,
          graphic: graphic,
        });

        this.emitEvent('symbolCreated', {
          graphic: graphic,
          id: attrs.id,
          drawEssentials: drawEssentials,
          isDone: 'done',
        });
      }

      // Continuous creation mode â€” re-initialize with same symbol immediately
      if (
        !suppressLifecycle &&
        this._creationMode === 'continuous' &&
        this._lastDrawEssentials &&
        this._lastAmplifier
      ) {
        this._continuousTimeoutId = setTimeout(() => {
          this._continuousTimeoutId = null;
          this.initialize(this._lastDrawEssentials!, this._lastAmplifier!);
        }, 0);
      }
    } catch (error) {
      console.error('Error in drawSymEnd:', error);
    }
  }

  private getDrawEndLayer(drawEssentials: any, geometry: any): GraphicsLayer {
    const symGeoType = String(drawEssentials?.SYM_GEO_TYPE ?? '').toLowerCase();
    const isUei = drawEssentials?.UEI === '1' || drawEssentials?.UEI === 1;

    if (isUei || symGeoType === 'fpoint') {
      return this._layerManager.getOrCreateLayer(LAYER_NAMES.FORCE);
    }

    if (symGeoType === 'point' || geometry?.type === 'point') {
      return this._layerManager.getOrCreateLayer(LAYER_NAMES.TACT_PT);
    }

    return this._layerManager.getOrCreateLayer(LAYER_NAMES.TACT);
  }

  /**
   * Programmatically update an existing symbol from a host program's own UI.
   *
   * Applies a partial {@link MorphixSymbolPatch} to the symbol's current state and
   * re-renders it through the same pipeline the interactive editor uses. Geometry
   * (GEOM / CTRL_PTS) is preserved untouched. Returns the new Graphic, or null if
   * the patch could not be applied (e.g. invalid SIDC).
   *
   * @example
   * // Point/Line/Area amplifier edit
   * symbolEngine.updateSymbol(graphic, { amplifier: { UNIQUE_DESIG: 'TF-9' }, drawEssentials: { opacity: 0.6 } });
   * // Force (FPoint) symbol — edits flow through the milsymbol OPTIONS object
   * symbolEngine.updateSymbol(graphic, { options: { uniqueDesignation: 'A Coy' }, extraSettings: { size: 40 } });
   */
  public updateSymbol(
    graphic: Graphic,
    patch: MorphixSymbolPatch,
  ): Graphic | null {
    return this._morphixEngine.update(graphic, patch);
  }

  /** Read a symbol's current editable state (kind, sidc, amplifier, options, …) without opening the editor. */
  public getSymbolState(graphic: Graphic): MorphixSymbolSnapshot {
    return this._morphixEngine.getSymbolState(graphic);
  }

  /** Open the built-in Morphix symbol editor modal for a graphic. */
  public openSymbolEditor(graphic: Graphic): void {
    this._morphixEngine.open(graphic);
  }

  public applyMorphixEdit(
    graphic: Graphic,
    editedState: MorphixEditedState,
  ): Graphic | null {
    const oldLayer = (graphic.origin?.layer ?? null) as GraphicsLayer | null;
    if (!oldLayer) {
      throw new Error('Selected symbol is not attached to a graphics layer.');
    }

    const oldGraphic = graphic;
    const oldId = oldGraphic.attributes?.id || this.generateUUID();
    const oldAttrs = { ...(oldGraphic.attributes || {}) };
    const oldDe = oldAttrs.drawEssentials;
    const targetLayer = oldLayer;
    const annotationLayer = this._layerManager.getOrCreateLayer(
      LAYER_NAMES.ANNOTATION_LAYER,
    );

    const nextAttrs = {
      ...oldAttrs,
      ...editedState.attributes,
      id: oldId,
      symbolId: oldAttrs.symbolId,
      sidc: editedState.sidc,
      type: oldAttrs.type || 'symbol',
      drawEssentials: editedState.drawEssentials,
    };
    Object.keys(nextAttrs).forEach((key) => {
      if ((nextAttrs as any)[key] === undefined) delete (nextAttrs as any)[key];
    });

    const previousAttrs = (this as any).attrs;
    const previousPendingAttrs = this._pendingAttrs;
    const suppressBefore = this._suppressDrawLifecycleCount;

    try {
      AnnotationEngine.deAnnotate(annotationLayer, oldId);
      oldLayer.remove(oldGraphic);

      this._lastCreatedGraphic = null;
      this._pendingAttrs = { symbolId: oldId };
      (this as any).attrs = nextAttrs;
      this._suppressDrawLifecycleCount++;
      this._suppressNextAddUndoCount++;

      // ── [Morphix DEBUG] remove after diagnosis ───────────────────────────
      const _dbgDe = editedState.drawEssentials as any;
      console.log('[Morphix DEBUG] applyMorphixEdit → initialize', {
        oldId,
        oldGeomType: (oldGraphic.geometry as any)?.type,
        SYM_GEO_TYPE: _dbgDe?.SYM_GEO_TYPE,
        symbolKey: editedState.symbolKey,
        sidc: editedState.sidc,
        hasGEOM: !!_dbgDe?.GEOM,
        ctrlPtsLen: Array.isArray(_dbgDe?.CTRL_PTS) ? _dbgDe.CTRL_PTS.length : 'none',
        hasBASE_LN_PTS: !!_dbgDe?.BASE_LN_PTS,
        hasOPTIONS: !!_dbgDe?.OPTIONS,
        UNIQUE_DESIG: editedState.amplifier?.UNIQUE_DESIG,
        opacity: _dbgDe?.opacity,
        DRAW_TYPE: _dbgDe?.DRAW_TYPE,
      });
      // ─────────────────────────────────────────────────────────────────────

      this.initialize(
        editedState.drawEssentials,
        editedState.amplifier,
        true,
      );

      const _viaLastCreated = !!this._lastCreatedGraphic;
      const newGraphic =
        this._lastCreatedGraphic ||
        Array.from(this._layerManager.getSymbolLayer().graphics).find(
          (g: any) => g.attributes?.id === oldId,
        ) ||
        null;

      // ── [Morphix DEBUG] remove after diagnosis ───────────────────────────
      console.log('[Morphix DEBUG] applyMorphixEdit ← initialize result', {
        oldId,
        synchronousEmit: _viaLastCreated,
        newGraphicFound: !!newGraphic,
        newGraphicId: newGraphic?.attributes?.id,
        newGeomType: (newGraphic?.geometry as any)?.type,
        newLayerId: (newGraphic?.origin?.layer as any)?.id,
      });
      // ─────────────────────────────────────────────────────────────────────

      this._suppressDrawLifecycleCount = suppressBefore;
      this._pendingAttrs = previousPendingAttrs;
      (this as any).attrs = previousAttrs;

      if (!newGraphic) {
        oldLayer.add(oldGraphic);
        if (oldDe?.AMPLIFIER) {
          AnnotationEngine.annotate(
            annotationLayer,
            oldGraphic.geometry as any,
            oldDe.AMPLIFIER,
            oldDe,
            oldId,
            settingsData.textSize,
            oldDe.ISFHAND || 0,
            oldDe.labelOptions || this.labelOptions || {},
            {},
          );
        }
        throw new Error('Edited symbol could not be rendered.');
      }

      const createdLayer = (newGraphic.origin?.layer ?? null) as GraphicsLayer | null;
      if (createdLayer && createdLayer !== targetLayer) {
        createdLayer.remove(newGraphic);
        targetLayer.add(newGraphic);
      }

      newGraphic.attributes = nextAttrs;
      newGraphic.set('id', oldId);
      if ((editedState.drawEssentials as any)?.AMPLIFIER) {
        AnnotationEngine.deAnnotate(annotationLayer, oldId);
        AnnotationEngine.annotate(
          annotationLayer,
          newGraphic.geometry as any,
          (editedState.drawEssentials as any).AMPLIFIER,
          editedState.drawEssentials,
          oldId,
          settingsData.textSize,
          editedState.drawEssentials.ISFHAND || 0,
          editedState.drawEssentials.labelOptions || this.labelOptions || {},
          {},
        );
      }

      if (this._suppressEditUndoCount === 0) {
      this._pushUndo({
        label: 'Edit Symbol Details',
        undo: () => {
          targetLayer.remove(newGraphic);
          AnnotationEngine.deAnnotate(annotationLayer, oldId);
          oldGraphic.attributes = oldAttrs;
          targetLayer.add(oldGraphic);
          if (oldDe?.AMPLIFIER) {
            AnnotationEngine.annotate(
              annotationLayer,
              oldGraphic.geometry as any,
              oldDe.AMPLIFIER,
              oldDe,
              oldId,
              settingsData.textSize,
              oldDe.ISFHAND || 0,
              oldDe.labelOptions || this.labelOptions || {},
              {},
            );
          }
        },
        redo: () => {
          targetLayer.remove(oldGraphic);
          AnnotationEngine.deAnnotate(annotationLayer, oldId);
          targetLayer.add(newGraphic);
          if ((editedState.drawEssentials as any)?.AMPLIFIER) {
            AnnotationEngine.annotate(
              annotationLayer,
              newGraphic.geometry as any,
              (editedState.drawEssentials as any).AMPLIFIER,
              editedState.drawEssentials,
              oldId,
              settingsData.textSize,
              editedState.drawEssentials.ISFHAND || 0,
              editedState.drawEssentials.labelOptions || this.labelOptions || {},
              {},
            );
          }
        },
      });
      }

      this.emitEvent('symbolDetailsEdited', {
        graphic: newGraphic,
        id: oldId,
        drawEssentials: editedState.drawEssentials,
      });

      return newGraphic;
    } catch (error) {
      this._suppressDrawLifecycleCount = suppressBefore;
      this._pendingAttrs = previousPendingAttrs;
      (this as any).attrs = previousAttrs;
      if (this._suppressNextAddUndoCount > 0) this._suppressNextAddUndoCount--;
      throw error;
    }
  }

  private getOpacityValue(graphic: Graphic): { opacity?: number } {
    const options: { opacity?: number } = {};
    if (
      graphic.geometry.type === 'polyline' ||
      graphic.geometry.type === 'polygon'
    ) {
      const symbol = graphic.symbol as SimpleLineSymbol; // Or SimpleFillSymbol
      if (symbol && symbol.color) {
        options.opacity = symbol.color.a;
      }
    } else if (graphic.attributes?.drawEssentials?.SYM_GEO_TYPE === 'Point') {
      const symbol = graphic.symbol as SimpleMarkerSymbol;
      if (symbol && symbol.outline?.color) {
        options.opacity = symbol.outline.color.a;
      }
    }
    return options;
  }

  private symDrawProgress(event: {
    currentDrawEssentials: DrawEssentials;
    currentGeometry: any;
    currentMarker: any;
  }): void {
    this.emit('symDrawProgress', {
      currentDrawEssentials: event.currentDrawEssentials,
      currentGeometry: event.currentGeometry,
      currentMarker: event.currentMarker,
    });
  }

  private symDrawClick(event: { currentPts: Point[] }): void {
    this.emit('symDrawClick', {
      currentPts: event.currentPts,
    });
  }

  private baseLineDrawEnd(event: { currentPts: Point[] }): void {
    this.emit('baseLineDrawEnd', {
      currentPts: event.currentPts,
    });
  }

  /**
   * Test method to demonstrate milsymbol.js integration
   * This replicates the functionality from main.ts
   */
  public testMilSymbol(): void {
    console.log('Testing milsymbol.js integration in SymbolEngine...');

    // Check if MS object is available
    if (typeof window.MS === 'undefined') {
      console.error('MS object not found. Make sure milsymbol.js is loaded.');
      return;
    }

    console.log('MS version:', window.MS.version);
    console.log('MS standard:', window.MS._STD2525 ? '2525' : 'APP6');
    console.log('MS marker parts count:', window.MS.getMarkerParts().length);
    console.log(
      'MS color modes available:',
      Object.keys(window.MS._colorModes || {}),
    );

    // Test creating a simple military symbol
    //const sidc = "130310001412050000000000000000"; // User-provided SIDC
    const sidc = '10121000001205000000'; // User-provided SIDC
    //
    const options = {
      size: 60,
    };

    try {
      // Generate the symbol using the correct API
      const symbol = new window.MS.symbol(sidc, options);
      console.log('Generated symbol:', symbol);

      // Check if symbol was created properly
      if (!symbol) {
        console.error('Failed to create symbol object');
        return;
      }

      // Get symbol properties
      const properties = symbol.getProperties();
      console.log('Symbol properties:', properties);

      // Initialize the marker to generate drawInstructions
      symbol.getMarker();
      console.log(
        'Marker initialized, drawInstructions length:',
        symbol.drawInstructions?.length || 0,
      );
      console.log('DrawInstructions:', symbol.drawInstructions);
      console.log('Symbol properties after getMarker:', symbol.properties);
      console.log('Symbol colors after getMarker:', symbol.colors);

      // Test color modes
      const lightColors = window.MS.getColorMode('Light');
      console.log('Light color mode:', lightColors);

      // Test dash arrays
      const dashArrays = window.MS.getDashArrays();
      console.log('Dash arrays:', dashArrays);

      // Test setting a new standard
      const standardSet = window.MS.setStandard('2525');
      console.log('Standard set to 2525:', standardSet);

      // Create a test graphic on the map
      const view = this.view;
      if (view && symbol) {
        // Create a graphics layer for test symbols
        let testLayer = view.map.findLayerById(
          'testSymbolLayer',
        ) as GraphicsLayer;
        if (!testLayer) {
          testLayer = new GraphicsLayer({ id: 'testSymbolLayer' });
          view.map.add(testLayer);
        }

        // Get SVG string from the symbol
        const svgString = symbol.asSVG();
        console.log('Generated SVG:', svgString);

        // Convert SVG to data URL for PictureMarkerSymbol
        const dataUrl = 'data:image/svg+xml;base64,' + btoa(svgString);

        // Create a point at the center of the view
        const center = view.center;
        const point = new Point({
          longitude: center.longitude,
          latitude: center.latitude,
          spatialReference: view.spatialReference,
        });

        // Create the symbol
        const pictureSymbol = new PictureMarkerSymbol({
          url: dataUrl,
          width: '35px',
          height: '35px',
        });

        // Create and add the graphic
        const graphic = new Graphic({
          geometry: point,
          symbol: pictureSymbol,
          attributes: {
            type: 'testSymbol',
            sidc: sidc,
            description:
              'Test military symbol created with milsymbol.js in SymbolEngine',
          },
        });

        testLayer.add(graphic);
        console.log(
          'Test symbol added to map at center point from SymbolEngine',
        );
      }
    } catch (error) {
      console.error('Error testing milsymbol.js in SymbolEngine:', error);
    }
  }

  /** Complete symbol catalogue. Delegated to SymbolMetadataService. */
  public getSymbolData(): any {
    return SymbolMetadataService.getData();
  }

  /** Lookup a symbol definition by key. Delegated to SymbolMetadataService. */
  public getSymbolByKey(key: string): any {
    return SymbolMetadataService.getByKey(key);
  }

  /** Autocomplete list of { key, name } entries. Delegated to SymbolMetadataService. */
  public getSymbolNamesForAutocomplete(): Array<{ key: string; name: string }> {
    return SymbolMetadataService.getNamesForAutocomplete();
  }

  // -----------------------------------------------------------------------
  // Feature 5 â€” Save / Load Symbol Configurations
  // -----------------------------------------------------------------------

  private _serializePoint(pt: any): object | null {
    if (!pt) return null;
    return {
      x: pt.x,
      y: pt.y,
      spatialReference: pt.spatialReference?.toJSON?.() ?? pt.spatialReference,
    };
  }

  /**
   * Serialize a single graphic to a plain JSON-safe object.
   * Saves CTRL_PTS / BASE_LN_PTS for line/area symbols and GEOM for point symbols.
   * On load these are fed back into initialize(isPassive=true) so the symbol is
   * reconstructed through the same rendering pipeline used when it was first drawn.
   */
  /*
  public saveSymbolToJSON(graphic: Graphic): object {
    const de: any = graphic.attributes?.drawEssentials;
    const amplifier: any = de?.AMPLIFIER;
    const sp = (pt: any) => this._serializePoint(pt);

    const ctrlPts = de?.CTRL_PTS ? de.CTRL_PTS.map(sp) : undefined;
    const baseLnPts = de?.BASE_LN_PTS
      ? {
          startPt: sp(de.BASE_LN_PTS.startPt),
          midPt: sp(de.BASE_LN_PTS.midPt),
          endPt: sp(de.BASE_LN_PTS.endPt),
        }
      : undefined;

    // For point symbols with no explicit GEOM, derive it from the actual geometry
    let geom: object | undefined;
    if (de?.GEOM) {
      geom = sp(de.GEOM) ?? undefined;
    } else if (!ctrlPts && !baseLnPts && graphic.geometry?.type === 'point') {
      geom = sp(graphic.geometry) ?? undefined;
    }

    const deJson: any = { ...de };
    delete deJson.SCOPE;
    delete deJson.AMPLIFIER;
    delete deJson.CTRL_PTS;
    delete deJson.BASE_LN_PTS;
    delete deJson.GEOM;
    if (ctrlPts) deJson.CTRL_PTS = ctrlPts;
    if (baseLnPts) deJson.BASE_LN_PTS = baseLnPts;
    if (geom) deJson.GEOM = geom;

    return {
      pams8Version: '2.0',
      type: 'pams8-symbol',
      layerId: graphic.origin?.layer?.id ?? this._layerManager.getSymbolLayer().id,
      id: graphic.attributes?.id,
      sidc: amplifier?.SIDC || de?.SIDC,
      amplifier: amplifier ? { ...amplifier } : {},
      drawEssentials: deJson,
    };
  }
   */

  /**
   * Reconstruct a graphic from a serialised pams8 object.
   * When CTRL_PTS / BASE_LN_PTS / GEOM are present the symbol is re-rendered
   * through initialize(isPassive=true) â€” the same pipeline as interactive drawing.
   * Falls back to direct Graphic construction for milsymbol / legacy format.
   */

  public loadSymbolFromJSON(data: any): Graphic | null {
    try {
      const deData = data.drawEssentials || {};

      // Support both old (_CTRL_PTS/_BASE_LN_PTS) and new (CTRL_PTS/BASE_LN_PTS) formats
      const ctrlPtsRaw = deData.CTRL_PTS ?? deData._CTRL_PTS;
      const baseLnPtsRaw = deData.BASE_LN_PTS ?? deData._BASE_LN_PTS;
      const geomRaw = deData.GEOM;

      const hasDrawData = ctrlPtsRaw?.length > 0 || !!baseLnPtsRaw || !!geomRaw;

      if (hasDrawData) {
        // Re-render through initialize() so rendering pipeline is identical to interactive draw
        const de = new DrawEssentials();
        const {
          CTRL_PTS: _c1,
          _CTRL_PTS: _c2,
          BASE_LN_PTS: _b1,
          _BASE_LN_PTS: _b2,
          GEOM: _g,
          ...rest
        } = deData;
        Object.assign(de, rest);

        if (ctrlPtsRaw) {
          (de as any).CTRL_PTS = (ctrlPtsRaw as any[])
            .map((p: any) =>
              p
                ? new Point({
                    x: p.x,
                    y: p.y,
                    spatialReference: p.spatialReference,
                  })
                : null,
            )
            .filter(Boolean);
        }
        if (baseLnPtsRaw) {
          (de as any).BASE_LN_PTS = {
            startPt: baseLnPtsRaw.startPt
              ? new Point(baseLnPtsRaw.startPt)
              : undefined,
            midPt: baseLnPtsRaw.midPt
              ? new Point(baseLnPtsRaw.midPt)
              : undefined,
            endPt: baseLnPtsRaw.endPt
              ? new Point(baseLnPtsRaw.endPt)
              : undefined,
          };
        }
        if (geomRaw) {
          (de as any).GEOM = new Point({
            x: geomRaw.x,
            y: geomRaw.y,
            spatialReference: geomRaw.spatialReference,
          });
        }

        const amplifier = new Amplifier();
        if (data.amplifier) Object.assign(amplifier, data.amplifier);
        if (data.sidc && !amplifier.SIDC) amplifier.SIDC = data.sidc;

        const symbolId = data.id;
        this._pendingAttrs = { symbolId };
        // Reset the watcher so we can detect whether initialize() produced a graphic synchronously.
        this._lastCreatedGraphic = null;

        const suppressBefore = this._suppressDrawLifecycleCount;
        if (data.suppressDrawingLifecycle === true) {
          this._suppressDrawLifecycleCount++;
        }
        this.initialize(de, amplifier, true);
        if (
          data.suppressDrawingLifecycle === true &&
          this._suppressDrawLifecycleCount === suppressBefore + 1
        ) {
          this._suppressDrawLifecycleCount = suppressBefore;
        }

        // Happy path — the symbol class's passive init synchronously emitted
        // onDrawEnd, drawSymEnd() placed the graphic, _lastCreatedGraphic is set.
        // Local cast: TS control-flow narrows the field to `null` after the
        // reset above and can't see that initialize() may mutate it.
        const created = this._lastCreatedGraphic as Graphic | null;
        if (created?.attributes?.id === symbolId) {
          return created;
        }

        // Fallback path — the symbol class didn't emit synchronously. Build the
        // graphic directly. Runs at most once per load (no timer, no polling),
        // so bulk imports stay O(N) instead of O(N²) on layer scans.
        const geom = (de as any).GEOM || (de as any).CTRL_PTS?.[0];
        if (!geom) return null;

        const amp = new Amplifier();
        if (data.amplifier) Object.assign(amp, data.amplifier);
        if (data.sidc && !amp.SIDC) amp.SIDC = data.sidc;

        const sidcInstance = new SIDC(amp.SIDC);
        const symSet = sidcInstance.getSIDC().substring(4, 6);
        const symDef = (symbolData as any)[symSet + sidcInstance.getSID()];

        let marker: any;
        if (symDef) {
          marker = sidcInstance.getMarker(symDef.symGeometricType, symDef.isObstacle, symDef.Fill);
        }

        (de as any).AMPLIFIER = amp;
        (de as any).SIDC = amp.SIDC;

        const fallbackGraphic = new Graphic({
          geometry: geom,
          symbol: marker,
          attributes: {
            id: symbolId,
            type: 'symbol',
            drawEssentials: de,
          },
        });

        const targetLayer = this.getDrawEndLayer(de, geom);
        targetLayer.add(fallbackGraphic);

        const annotationLayer = this._layerManager.getOrCreateLayer(
          LAYER_NAMES.ANNOTATION_LAYER,
        );
        if (amp.SIDC) {
          AnnotationEngine.annotate(
            annotationLayer,
            geom,
            amp,
            de,
            symbolId,
            settingsData.textSize,
            (de as any).ISFHAND || 0,
            this.labelOptions || {},
            {},
          );
        }
        console.info('[SaveLoad] Symbol added via fallback path:', symbolId);
        return fallbackGraphic;
      }

      // Fallback: milsymbol or v1.0 legacy format â€” direct Graphic construction
      let geometry: any;
      if (data.geometry && data.geometryType) {
        if (data.geometryType === 'point') geometry = new Point(data.geometry);
        else if (data.geometryType === 'polyline')
          geometry = new Polyline(data.geometry);
        else if (data.geometryType === 'polygon')
          geometry = new Polygon(data.geometry);
      }

      let symbol: any;
      if (data.symbol && data.symbolType) {
        if (data.symbolType === 'picture-marker')
          symbol = new PictureMarkerSymbol(data.symbol);
        else if (data.symbolType === 'simple-line')
          symbol = new SimpleLineSymbol(data.symbol);
        else if (data.symbolType === 'simple-fill')
          symbol = new SimpleFillSymbol(data.symbol);
        else if (data.symbolType === 'simple-marker')
          symbol = new SimpleMarkerSymbol(data.symbol);
      }

      const amplifier = new Amplifier();
      if (data.amplifier) Object.assign(amplifier, data.amplifier);
      if (data.sidc && !amplifier.SIDC) amplifier.SIDC = data.sidc;

      const de = new DrawEssentials();
      if (data.drawEssentials) {
        const {
          _CTRL_PTS,
          _BASE_LN_PTS,
          CTRL_PTS,
          BASE_LN_PTS,
          GEOM,
          ...rest
        } = data.drawEssentials;
        Object.assign(de, rest);
      }
      (de as any).AMPLIFIER = amplifier;

      const id = data.id || this.generateUUID();
      const graphic = new Graphic({
        geometry,
        symbol,
        attributes: {
          id,
          type: data.graphicType || 'symbol',
          drawEssentials: de,
        },
      });
      const layer =
        this._layerManager.getOrCreateLayer(data.layerId) ??
        this._layerManager.getSymbolLayer();
      layer.add(graphic);

      const annotationLayer = this._layerManager.getOrCreateLayer(
        LAYER_NAMES.ANNOTATION_LAYER,
      );
      if (geometry && amplifier.SIDC) {
        AnnotationEngine.annotate(
          annotationLayer,
          geometry,
          amplifier,
          de,
          id,
          settingsData.textSize,
          (de as any).ISFHAND || 0,
          this.labelOptions || {},
          {},
        );
      }
      return graphic;
    } catch (e) {
      console.error('[SaveLoad] loadSymbolFromJSON failed:', e);
      return null;
    }
  }



  /** Serialise every graphic across all symbol layers into an array. */
  public exportLayerToJSON(): object[] {
    return this.serializationEngine.exportLayerToJSON();
  }

  /** Reconstruct all graphics from a serialised array. */
  public importLayerFromJSON(data: object[]): void {
    this.serializationEngine.importLayerFromJSON(data);
  }

  /** Download all symbols as a PAMS8 JSON file. */
  public saveToFile(filename?: string): void {
    this.serializationEngine.saveToFile(filename);
  }


  /** Download all graphics as a Plan JSON file. Delegates to SerializationEngine. */
  public savePlanToFile(filename?: string): void {
    this.serializationEngine.savePlanToFile(filename);
  }

  /** Open a Plan JSON file and restore all symbols from it. Delegates to SerializationEngine. */
  public loadPlanFromFile(): void {
    this.serializationEngine.loadPlanFromFile();
  }

  /** Open a file picker; loads from PAMS8 JSON, template, or GeoJSON file. */
  public loadFromFile(): void {
    this.serializationEngine.loadFromFile();
  }

  /** Reconstruct DrawEssentials from template data and start interactive placement. */
  private _applyTemplateData(data: any): void {
    const de = new DrawEssentials();
    if (data.drawEssentials) {
      // Templates intentionally omit GEOM/CTRL_PTS so placement is interactive
      const { CTRL_PTS, BASE_LN_PTS, GEOM, ...rest } = data.drawEssentials;
      Object.assign(de, rest);
    }
    const amplifier = new Amplifier();
    if (data.amplifier) Object.assign(amplifier, data.amplifier);
    if (data.sidc && !amplifier.SIDC) amplifier.SIDC = data.sidc;

    this.initialize(de, amplifier); // interactive â€” no geometry pre-set
    console.info(`[Templates] Loaded template "${data.name || '(unnamed)'}"`);
  }

  // -----------------------------------------------------------------------
  // GeoJSON Export / Import
  // -----------------------------------------------------------------------

  /** Export all symbol layers as a standard GeoJSON FeatureCollection (WGS84 coordinates). */
  public exportToGeoJSON(): object {
    return this.serializationEngine.exportToGeoJSON();
  }

  /** Reconstruct symbols from a pams8 GeoJSON FeatureCollection. */
  public importFromGeoJSON(geojson: any): void {
    this.serializationEngine.importFromGeoJSON(geojson);
  }

  /** Download all symbols as a standard GeoJSON file. */
  public saveToGeoJSONFile(filename?: string): void {
    this.serializationEngine.saveToGeoJSONFile(filename);
  }

  /** Open a file picker and load symbols from a GeoJSON or PAMS8 JSON file. */
  public loadFromGeoJSONFile(): void {
    this.serializationEngine.loadFromGeoJSONFile();
  }

}

export type {
  MorphixSymbolPatch,
  MorphixSymbolSnapshot,
  MorphixEditedState,
  GeoKind,
} from './Morphix/MorphixEngine';

export default SymbolEngine;
