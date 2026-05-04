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
} from '../Managers/GraphicsLayerManager';
/*
import ms from '../ThirdParty/MilSymbols/UEITypes.js';
import type { SymbolOptions } from '../ThirdParty/MilSymbols/UEITypes.ts';
*/

// Import milsymbol types for the global MS object
import '../ThirdParty/MilSymbols/milsymbol.d.ts';
import { parseSIDC, ParsedSIDC } from '../SIDC/SIDC';
import ContextMenuManager, {
  ContextMenuItem,
  MenuItemEvent,
} from '../Managers/ContextMenuManager';

import symbolData from '../Data/Symbols.json';
import settingsData from '../Data/Settings.json';
import Amplifier from '../Support/Amplifier.ts';
import SIDC from '../Support/SIDC.ts';
import DrawEssentials from '../Support/DrawEssentials.ts';
import Mapper from '../Engines/Mapper.ts';
import AnnotationEngine from './AnnotationEngine.ts';
import GeoTools from '../Support/GeoTools.ts';
import EditEngine from './EditEngine.ts';
import SelectionEngine from './SelectionEngine.ts';
// MeasurementEngine is loaded dynamically based on Settings.json features.measurementEngine
import type MeasurementEngine from './MeasurementEngine.ts';
import ProximityEngine from './ProximityEngine.ts';
import DrawingCueEngine from './DrawingCueEngine.ts';
import type { DrawingCueOptions } from './DrawingCueEngine.ts';

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
  private currentSymbol: any | undefined;
  private sidc: any | undefined;
  private amplifier: Amplifier | undefined;
  private _registeredSymbols: Set<any> = new Set();
  private eventListeners: Map<string, Function[]> = new Map();
  private labelOptions: any = {};
  private mapper: any;
  private isDrawing = false;

  // Undo / Redo stacks
  private _undoStack: UndoEntry[] = [];
  private _redoStack: UndoEntry[] = [];
  // Geometry/CTRL_PTS snapshot captured just before an edit operation starts
  private _preEditSnapshot: {
    geometry: any;
    ctrlPts: any;
    baseLnPts: any;
  } | null = null;

  // Copy/Paste clipboard — stores one or more items for multi-copy
  private _clipboard: Array<{ graphic: Graphic; layerId: string }> | null =
    null;

  // ID to assign to the next graphic created via initialize() (used when loading)
  private _pendingAttrs: { symbolId?: string } | null = null;

  // Multi-select
  private _selectionEngine!: SelectionEngine;

  constructor(viewProvider: () => MapView | SceneView) {
    this._getView = viewProvider;
    this._layerManager = GraphicsLayerManager.getInstance(this.view);
    this._layerManager.initializeLayers();
    this._editEngine = new EditEngine(viewProvider, this._layerManager);
    this._wireEditEngineUndo();
    this._selectionEngine = new SelectionEngine(
      viewProvider,
      this._layerManager,
    );
    this._selectionEngine.activate([
      LAYER_NAMES.FORCE,
      LAYER_NAMES.TACT_PT,
      LAYER_NAMES.TACT,
      'milSymbols',
    ]);
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

    // Initialize symbol engine
    console.log('Symbol Engine initialized');

    //reactiveUtils.watch(() => this._getView()?.zoom, (newType: "2d" | "3d" | undefined) => {

    reactiveUtils.watch(
      () => this._getView()?.type,
      (newType: string | undefined, oldType: string | undefined) => {
        // Use lowercase 'string' for primitive type
        console.log(
          'SymbolEngine ------ TYPE watcher FIRED. New:',
          newType,
          'Old:',
          oldType,
        );
        // Potentially re-initialize or update SymbolEngine based on new view type
      },
      { initial: true }, // This makes it fire once on setup
    );

    reactiveUtils.watch(
      () => this._getView()?.type,
      (newType: string | undefined, oldType: string | undefined) => {
        console.log(newType);
        console.log(oldType);
      },
    );

    reactiveUtils.watch(
      () => this._getView()?.type,
      (newType: '2d' | '3d' | undefined) => {
        console.log('SymbolEngine ------:', newType);
        // Potentially re-initialize or update SymbolEngine based on new view type
      },
    );

    reactiveUtils.watch(
      () => this._getView()?.zoom,
      (newType: Number) => {
        //console.log("SymbolEngine detected activeView type change:", newType);
        // Potentially re-initialize or update SymbolEngine based on new view type
      },
    );

    // Initialize the ContextMenuManager
    this._contextMenuManager = ContextMenuManager.getInstance();
    this._contextMenuManager.initialize(this.view, {
      targetGraphicTypes: [], // any type on these layers gets the menu
      targetLayerIds: [
        LAYER_NAMES.FORCE,
        LAYER_NAMES.TACT_PT,
        LAYER_NAMES.TACT,
        'milSymbols',
      ],
    });

    // Register context menu items for different graphic types
    this.registerContextMenuItems();

    // Listen for context menu events
    this._contextMenuManager.on(
      'menu-item-click',
      this.handleContextMenuAction.bind(this),
    );

    // Conditionally load MeasurementEngine based on Settings.json feature flag
    this._initMeasurementEngine();

    // Conditionally load ProximityEngine based on Settings.json feature flag
    this._initProximityEngine();

    // Conditionally load DrawingCueEngine based on Settings.json feature flag
    this._initDrawingCueEngine();

    // Wire global keyboard shortcuts (if enabled in Settings.json)
    if ((settingsData as any).features?.shortcuts !== false) {
      this._setupKeyboardShortcuts();
    }

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
        console.log(
          `SymbolEngine caught onDrawProgress event from ${symbolType}:`,
        );
        console.log('  currentGeometry:', data.currentGeometry);
        console.log('  currentDrawEssentials:', data.currentDrawEssentials);
        console.log('  currentMarker:', data.currentMarker);
        console.log('  Full event data:', data);

        // Emit a custom event that can be caught by the main application
        this.emitEvent('onDrawProgress', {
          symbolType: symbolType,
          currentGeometry: data.currentGeometry,
          currentDrawEssentials: data.currentDrawEssentials,
          currentMarker: data.currentMarker,
          originalData: data,
        });
      });

      // Listen to other events as well
      symbolInstance.on('onDrawEnd', (data: any) => {
        console.log(`SymbolEngine caught onDrawEnd event from ${symbolType}:`);
        console.log('  Full event data:', data);

        // Emit a custom event
        this.emitEvent('onDrawEnd', {
          symbolType: symbolType,
          originalData: data,
        });
      });

      console.log(
        `${symbolType} registered with SymbolEngine and event listeners attached`,
      );
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
      console.log('SymbolEngine caught global onDrawProgress event:');
      console.log('  Event detail:', event.detail);

      // Arm proximity indicator on first progress event (idempotent — no-ops if already active)
      this._proximityEngine?.activate();

      // Arm drawing cue overlays (idempotent)
      this._drawingCueEngine?.activate([
        LAYER_NAMES.FORCE, LAYER_NAMES.TACT_PT, LAYER_NAMES.TACT, 'milSymbols',
      ]);

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

    // New control point clicked — arm the next segment measurement graphic
    document.addEventListener('onDrawClick', (event: any) => {
      const detail = event.detail;
      if (detail?.currentPts) {
        this._measurementEngine?.addSegment(detail.currentPts);
      }
    });

    document.addEventListener('onDrawEnd', (event: any) => {
      console.log('SymbolEngine caught global onDrawEnd event:');
      console.log('  Event detail:', event.detail);

      // Handle the draw end event by creating and adding a graphic
      this.drawSymEnd(event.detail);

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
    this._editEngine = new EditEngine(this._getView, this._layerManager);
    this._wireEditEngineUndo();
    this._selectionEngine.onViewChanged(newView);
    // Re-attach measurement engine to the new view
    this._measurementEngine?.onViewChanged(newView);
    // Re-attach proximity engine to the new view
    this._proximityEngine?.onViewChanged(newView);
    // Re-attach drawing cue engine to the new view
    this._drawingCueEngine?.onViewChanged(newView);

    // Re-initialize the ContextMenuManager for the new view so its
    // pointer-down / contextmenu listeners are bound to the active view.
    this._contextMenuManager.initialize(newView, {
      targetGraphicTypes: [],
      targetLayerIds: [
        LAYER_NAMES.FORCE,
        LAYER_NAMES.TACT_PT,
        LAYER_NAMES.TACT,
        'milSymbols',
      ],
    });
  }

  /**
   * Dynamically import and initialise MeasurementEngine only when the
   * Settings.json feature flag is true.  The dynamic import keeps the module
   * out of the initial bundle when the feature is disabled.
   */
  private async _initMeasurementEngine(): Promise<void> {
    const features = (settingsData as any).features ?? {};
    if (features.measurementEngine === false) {
      console.info(
        '[SymbolEngine] MeasurementEngine disabled via Settings.json',
      );
      return;
    }
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
          speed_kmh: measureCfg.speedKmh
      });

      this._measurementEngine.start(this.view);
      this._contextMenuManager.linkMeasurementEngine(this._measurementEngine);
      // Emit so the host app can initialise its panel
      this.emitEvent('measurementEngineReady', {
        engine: this._measurementEngine,
      });
      console.info('[SymbolEngine] MeasurementEngine loaded');
    } catch (e) {
      console.error('[SymbolEngine] Failed to load MeasurementEngine:', e);
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
      [LAYER_NAMES.FORCE, LAYER_NAMES.TACT_PT, LAYER_NAMES.TACT, 'milSymbols'],
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
        icon: '<span style="font-size:14px">ℹ️</span>',
        action: (graphic) => this.showSymbolDetails(graphic),
      },
      {
        id: 'center-on',
        label: 'Center On',
        shortcut: 'C',
        icon: '<span style="font-size:14px">🎯</span>',
        action: (graphic) => this.centerOnGraphic(graphic),
      },
      {
        id: 'remove-graphic',
        label: 'Remove',
        shortcut: 'Del',
        icon: '<span style="font-size:14px">🗑️</span>',
        action: (graphic) => this.removeGraphic(graphic),
      },
      // ── Edit submenu ────────────────────────────────────────────────
      {
        id: 'edit-submenu',
        label: 'Edit',
        icon: '<span style="font-size:14px">✏️</span>',
        children: [
          {
            id: 'modify-symbol',
            label: 'Move, Scale, Rotate',
            shortcut: 'M',
            icon: '<span style="font-size:14px">✏️</span>',
            visible: (_graphic) => !this._editEngine.isModifyingSymbol,
            action: (graphic) => this.modifySymbol(graphic),
          },
          {
            id: 'disable-modify-symbol',
            label: 'Disable Move, Scale, Rotate',
            shortcut: 'Esc',
            icon: '<span style="font-size:14px">✖</span>',
            visible: (_graphic) => this._editEngine.isModifyingSymbol,
            action: (_graphic) => this.deactivateEdit(),
          },
          {
            id: 'edit-ctrl-pts',
            label: 'Edit Control Points',
            shortcut: 'E',
            icon: '<span style="font-size:14px">⬡</span>',
            visible: (_graphic) => !this._editEngine.isEditingControlPoints,
            action: (graphic) => this.activateEditControlPoints(graphic),
          },
          {
            id: 'deactivate-ctrl-pts',
            label: 'Deactivate Control Points',
            shortcut: 'Esc',
            icon: '<span style="font-size:14px">✖</span>',
            visible: (_graphic) => this._editEngine.isEditingControlPoints,
            action: (_graphic) => this.deactivateEdit(),
          },
        ],
      },
      // ── Selection submenu ───────────────────────────────────────────
      {
        id: 'selection-submenu',
        label: 'Selection',
        icon: '<span style="font-size:14px">☑</span>',
        children: [
          {
            id: 'lasso-select',
            label: () => this._selectionEngine.isLassoActive ? 'Cancel Lasso' : 'Lasso Select',
            shortcut: 'L',
            icon: '<span style="font-size:14px">🔲</span>',
            action: (_graphic) => {
              if (this._selectionEngine.isLassoActive) {
                this._selectionEngine.cancelLasso();
              } else {
                this._closeActiveWorkflow();
                this._selectionEngine.lassoSelect();
              }
            },
          },
          {
            id: 'toggle-select',
            label: (graphic: any) =>
              this._selectionEngine.isSelected(graphic)
                ? 'Deselect'
                : 'Add to Selection',
            shortcut: 'Shift+Click',
            icon: '<span style="font-size:14px">☑</span>',
            action: (graphic) => this._selectionEngine.toggleGraphic(graphic),
          },
          {
            id: 'clear-selection',
            label: () => `Clear Selection (${this._selectionEngine.count})`,
            icon: '<span style="font-size:14px">✕</span>',
            visible: () => this._selectionEngine.count > 0,
            action: (_graphic) => this._selectionEngine.clearSelection(),
          },
          {
            id: 'move-selected',
            label: () => `Move Selected (${this._selectionEngine.count})`,
            shortcut: 'M',
            icon: '<span style="font-size:14px">⤢</span>',
            visible: () => this._selectionEngine.count > 1,
            action: (_graphic) => {
              this._closeActiveWorkflow();
              this._selectionEngine.moveSelected(({ graphics, dx, dy }) =>
                this._pushUndo({
                  label: `Move ${graphics.length} Symbols`,
                  undo: () =>
                    this._selectionEngine['_applyDelta'](graphics, -dx, -dy),
                  redo: () =>
                    this._selectionEngine['_applyDelta'](graphics, dx, dy),
                }),
              );
            },
          },
          {
            id: 'delete-selected',
            label: () => `Delete Selected (${this._selectionEngine.count})`,
            shortcut: 'Del',
            icon: '<span style="font-size:14px">🗑️</span>',
            visible: () => this._selectionEngine.count > 1,
            action: (_graphic) =>
              this._selectionEngine.deleteSelected((entry) =>
                this._pushUndo(entry),
              ),
          },
          // ── Select Similar submenu ───────────────────────────────
          {
            id: 'select-similar-submenu',
            label: 'Select Similar',
            icon: '<span style="font-size:14px">🔍</span>',
            children: [
              {
                id: 'select-same-sidc',
                label: 'Same SIDC',
                icon: '<span style="font-size:14px">⚜</span>',
                action: (graphic) => this._selectionEngine.selectSimilarSameSIDC(graphic),
              },
              {
                id: 'select-same-echelon',
                label: 'Same Echelon',
                icon: '<span style="font-size:14px">▣</span>',
                action: (graphic) => this._selectionEngine.selectSimilarSameEchelon(graphic),
              },
              {
                id: 'select-own-only',
                label: 'Own Only',
                icon: '<span style="font-size:14px">🟢</span>',
                action: () => this._selectionEngine.selectOwnOnly(),
              },
              {
                id: 'select-enemy',
                label: 'Enemy',
                icon: '<span style="font-size:14px">🔴</span>',
                action: () => this._selectionEngine.selectEnemy(),
              },
            ],
          },
          // ── Select Within submenu ───────────────────────────────
          {
            id: 'select-within-submenu',
            label: 'Select Within',
            icon: '<span style="font-size:14px">⭕</span>',
            children: [
              {
                id: 'select-within',
                label: 'Within',
                icon: '<span style="font-size:14px">⭕</span>',
                action: (graphic) => this._selectionEngine.selectWithin(graphic, false),
              },
              {
                id: 'select-within-self',
                label: 'Within + Self',
                icon: '<span style="font-size:14px">◎</span>',
                action: (graphic) => this._selectionEngine.selectWithin(graphic, true),
              },
            ],
          },
          // ── Filter by Type submenu ───────────────────────────────
          {
            id: 'filter-type-submenu',
            label: 'Filter by Type',
            icon: '<span style="font-size:14px">▼</span>',
            children: [
              {
                id: 'select-points',
                label: 'Points',
                icon: '<span style="font-size:14px">●</span>',
                action: () => this._selectionEngine.selectPointSymbols(),
              },
              {
                id: 'select-areas',
                label: 'Areas',
                icon: '<span style="font-size:14px">■</span>',
                action: () => this._selectionEngine.selectAreaSymbols(),
              },
              {
                id: 'select-lines',
                label: 'Lines',
                icon: '<span style="font-size:14px">╱</span>',
                action: () => this._selectionEngine.selectLineSymbols(),
              },
            ],
          },
        ],
      },
      // ── Align parent menu (contains Align, Distribute, Arrange) ───────
      {
        id: 'align-parent',
        label: 'Align',
        icon: '<span style="font-size:14px">⊞</span>',
        visible: () => this._selectionEngine.count > 1,
        children: [
          // ── Align submenu ─────────────────────────────────
          {
            id: 'align-submenu',
            label: 'Align',
            icon: '<span style="font-size:14px">⊞</span>',
            children: [
              {
                id: 'align-left',
                label: 'Align Left',
                icon: '<span style="font-size:14px">⬅</span>',
                action: (_g) =>
                  this._selectionEngine.alignLeft((e) => this._pushUndo(e)),
              },
              {
                id: 'align-right',
                label: 'Align Right',
                icon: '<span style="font-size:14px">➡</span>',
                action: (_g) =>
                  this._selectionEngine.alignRight((e) => this._pushUndo(e)),
              },
              {
                id: 'align-top',
                label: 'Align Top',
                icon: '<span style="font-size:14px">⬆</span>',
                action: (_g) =>
                  this._selectionEngine.alignTop((e) => this._pushUndo(e)),
              },
              {
                id: 'align-bottom',
                label: 'Align Bottom',
                icon: '<span style="font-size:14px">⬇</span>',
                action: (_g) =>
                  this._selectionEngine.alignBottom((e) => this._pushUndo(e)),
              },
              {
                id: 'center-on-x',
                label: 'Center on X',
                icon: '<span style="font-size:14px">↕</span>',
                action: (_g) =>
                  this._selectionEngine.centerOnX((e) => this._pushUndo(e)),
              },
              {
                id: 'center-on-y',
                label: 'Center on Y',
                icon: '<span style="font-size:14px">↔</span>',
                action: (_g) =>
                  this._selectionEngine.centerOnY((e) => this._pushUndo(e)),
              },
            ],
          },
          // ── Distribute submenu ───────────────────────────────
          {
            id: 'distribute-submenu',
            label: 'Distribute',
            icon: '<span style="font-size:14px">⇔</span>',
            children: [
              {
                id: 'align-horizontal',
                label: 'Distribute Horizontal',
                icon: '<span style="font-size:14px">⇔</span>',
                action: (_g) =>
                  this._selectionEngine.alignHorizontal((e) =>
                    this._pushUndo(e),
                  ),
              },
              {
                id: 'align-vertical',
                label: 'Distribute Vertical',
                icon: '<span style="font-size:14px">⇕</span>',
                action: (_g) =>
                  this._selectionEngine.alignVertical((e) => this._pushUndo(e)),
              },
            ],
          },
          // ── Arrange submenu ─────────────────────────────────
          {
            id: 'arrange-submenu',
            label: 'Arrange',
            icon: '<span style="font-size:14px">⊜</span>',
            children: [
              {
                id: 'arrange-line',
                label: 'Line',
                icon: '<span style="font-size:14px">―</span>',
                action: (_g) =>
                  this._selectionEngine.arrangeLine(undefined, (e) =>
                    this._pushUndo(e),
                  ),
              },
              {
                id: 'arrange-column',
                label: 'Column',
                icon: '<span style="font-size:14px">|</span>',
                action: (_g) =>
                  this._selectionEngine.arrangeColumn(undefined, (e) =>
                    this._pushUndo(e),
                  ),
              },
              {
                id: 'arrange-square',
                label: 'Square Grid',
                icon: '<span style="font-size:14px">⊞</span>',
                action: (_g) =>
                  this._selectionEngine.arrangeSquare(undefined, (e) =>
                    this._pushUndo(e),
                  ),
              },
              {
                id: 'arrange-triangle',
                label: 'Triangle',
                icon: '<span style="font-size:14px">▲</span>',
                action: (_g) =>
                  this._selectionEngine.arrangeTriangle(undefined, (e) =>
                    this._pushUndo(e),
                  ),
              },
              {
                id: 'arrange-inv-triangle',
                label: 'Inverted Triangle',
                icon: '<span style="font-size:14px">▽</span>',
                action: (_g) =>
                  this._selectionEngine.arrangeInvertedTriangle(
                    undefined,
                    (e) => this._pushUndo(e),
                  ),
              },
              {
                id: 'arrange-wedge',
                label: 'Wedge',
                icon: '<span style="font-size:14px">⋁</span>',
                action: (_g) =>
                  this._selectionEngine.arrangeWedge(undefined, (e) =>
                    this._pushUndo(e),
                  ),
              },
              {
                id: 'arrange-echelon-left',
                label: 'Echelon Left',
                icon: '<span style="font-size:14px">↙</span>',
                action: (_g) =>
                  this._selectionEngine.arrangeEchelonLeft(undefined, (e) =>
                    this._pushUndo(e),
                  ),
              },
              {
                id: 'arrange-echelon-right',
                label: 'Echelon Right',
                icon: '<span style="font-size:14px">↘</span>',
                action: (_g) =>
                  this._selectionEngine.arrangeEchelonRight(undefined, (e) =>
                    this._pushUndo(e),
                  ),
              },
              {
                id: 'arrange-diamond',
                label: 'Diamond',
                icon: '<span style="font-size:14px">◇</span>',
                action: (_g) =>
                  this._selectionEngine.arrangeDiamond(undefined, (e) =>
                    this._pushUndo(e),
                  ),
              },
              {
                id: 'arrange-circle',
                label: 'Circle',
                icon: '<span style="font-size:14px">○</span>',
                action: (_g) =>
                  this._selectionEngine.arrangeCircle(undefined, (e) =>
                    this._pushUndo(e),
                  ),
              },
            ],
          },
        ],
      },
      // ── Clipboard submenu ───────────────────────────────────────────
      {
        id: 'clipboard-submenu',
        label: 'Clipboard',
        icon: '<span style="font-size:14px">📋</span>',
        visible: () =>
          (settingsData as any).features?.copyPaste !== false ||
          (settingsData as any).features?.shortcuts !== false,
        children: [
          {
            id: 'copy-symbol',
            label: 'Copy Symbol',
            shortcut: 'Ctrl+C',
            icon: '<span style="font-size:14px">📋</span>',
            visible: () => (settingsData as any).features?.copyPaste !== false,
            action: (graphic) => this.copySymbol(graphic),
          },
          {
            id: 'paste-symbol',
            label: 'Paste Symbol',
            shortcut: 'Ctrl+V',
            icon: '<span style="font-size:14px">📌</span>',
            visible: () =>
              (settingsData as any).features?.copyPaste !== false &&
              this._clipboard !== null,
            action: (_graphic) => this._activatePasteMode(),
          },
          {
            id: 'undo',
            label: () =>
              this._undoStack.length > 0
                ? `Undo ${this._undoStack[this._undoStack.length - 1].label}`
                : 'Undo',
            shortcut: 'Ctrl+Z',
            icon: '<span style="font-size:14px">↩</span>',
            enabled: (_graphic) => this._undoStack.length > 0,
            visible: () => (settingsData as any).features?.shortcuts !== false,
            action: (_graphic) => this.undo(),
          },
          {
            id: 'redo',
            label: () =>
              this._redoStack.length > 0
                ? `Redo ${this._redoStack[this._redoStack.length - 1].label}`
                : 'Redo',
            shortcut: 'Ctrl+Y',
            icon: '<span style="font-size:14px">↪</span>',
            enabled: (_graphic) => this._redoStack.length > 0,
            visible: () => (settingsData as any).features?.shortcuts !== false,
            action: (_graphic) => this.redo(),
          },
        ],
      },
      // ── Save / Load submenu ─────────────────────────────────────────
      {
        id: 'saveload-submenu',
        label: 'Save / Load',
        icon: '<span style="font-size:14px">💾</span>',
        visible: () => (settingsData as any).features?.saveLoad !== false,
        children: [
          {
            id: 'save-symbol',
            label: 'Save Symbol',
            icon: '<span style="font-size:14px">💾</span>',
            action: (graphic) => this.saveSymbolToFile(graphic),
          },
          {
            id: 'save-all-symbols',
            label: 'Save All Symbols',
            icon: '<span style="font-size:14px">🗂️</span>',
            action: (_graphic) => this.saveToFile(),
          },
          {
            id: 'load-symbols',
            label: 'Load Symbols',
            icon: '<span style="font-size:14px">📂</span>',
            action: (_graphic) => this.loadFromFile(),
          },
          {
            id: 'save-template-file',
            label: 'Save as Template…',
            icon: '<span style="font-size:14px">📌</span>',
            visible: () => (settingsData as any).features?.templates !== false,
            action: (graphic) => this.saveTemplateToFile(graphic),
          },
          {
            id: 'load-template-file',
            label: 'Load Template from File',
            icon: '<span style="font-size:14px">📋</span>',
            visible: () => (settingsData as any).features?.templates !== false,
            action: (_graphic) => this.loadTemplateFromFile(),
          },
          {
            id: 'export-geojson',
            label: 'Export as GeoJSON',
            icon: '<span style="font-size:14px">🌐</span>',
            action: (_graphic) => this.saveToGeoJSONFile(),
          },
          {
            id: 'import-geojson',
            label: 'Import GeoJSON',
            icon: '<span style="font-size:14px">🌍</span>',
            action: (_graphic) => this.loadFromGeoJSONFile(),
          },
        ],
      },
    ];

    // Dynamic Templates submenu — rebuilt each time the menu opens
    this._contextMenuManager.addDynamicItemProvider((graphic) => {
      if ((settingsData as any).features?.templates === false) return [];
      const names = this.listTemplates();
      const applyItems: ContextMenuItem[] = names.map((name, i) => ({
        id: `apply-template-${i}`,
        label: name,
        icon: '<span style="font-size:14px">🏷️</span>',
        action: (_g: Graphic) => this.applyTemplate(name, graphic),
      }));
      return [
        {
          id: 'templates-submenu',
          label: 'Templates',
          icon: '<span style="font-size:14px">📌</span>',
          children: [
            {
              id: 'save-as-template',
              label: 'Save as Template…',
              icon: '<span style="font-size:14px">📌</span>',
              action: (g) => this._promptSaveTemplate(g),
            },
            ...applyItems,
          ],
        },
      ];
    });

    // Register menu items for force symbols
    const forceMenuItems: ContextMenuItem[] = [
      {
        id: 'show-details',
        label: 'Show Details',
        shortcut: 'I',
        icon: '<span style="font-size:14px">ℹ️</span>',
        action: (graphic) => this.showSymbolDetails(graphic),
      },
      {
        id: 'center-on',
        label: 'Center On',
        shortcut: 'C',
        icon: '<span style="font-size:14px">🎯</span>',
        action: (graphic) => this.centerOnGraphic(graphic),
      },
      {
        id: 'remove-graphic',
        label: 'Remove',
        shortcut: 'Del',
        icon: '<span style="font-size:14px">🗑️</span>',
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
    console.log('Showing details for symbol:', graphic.attributes);

    // Example implementation - could show in a panel or dialog
    if (graphic.attributes?.sidc) {
      const parsedSidc = parseSIDC(graphic.attributes.sidc);
      console.log('Symbol details:', parsedSidc);

      // You could show this information in a panel or dialog
      // For now, just log to console
    }
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

    const layer = graphic.layer as __esri.GraphicsLayer | null;
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
        layer.remove(graphic);
        if (graphicId) AnnotationEngine.deAnnotate(annotationLayer, graphicId);
      },
    });

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
   * Point symbols → move.  Poly/polygon symbols → move + rotate + scale.
   * Called automatically from the right-click context menu or M shortcut.
   */
  public modifySymbol(graphic: Graphic): void {
    console.log(
      'SymbolEngine: activating edit for',
      graphic.attributes?.id ?? 'graphic',
    );
    this._closeActiveWorkflow();
    const selected = this._selectionEngine.selectedGraphics;
    const isInSelection = selected.some((g) => g === graphic);
    const additional = isInSelection
      ? selected.filter((g) => g !== graphic)
      : [];
    this._capturePreEditSnapshot(graphic, additional, 'Move, Scale, Rotate');
    this._editEngine.activate(graphic, additional);
  }

  /**
   * Activate control-point editing (CTRL_PTS drag handles) for a poly/polygon graphic.
   */
  public activateEditControlPoints(graphic: Graphic): void {
    this._closeActiveWorkflow();
    this._capturePreEditSnapshot(graphic, [], 'Edit Control Points');
    this._editEngine.activateEditControlPoints(graphic);
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
    this._undoStack = [];
    this._redoStack = [];
    console.info('[SymbolEngine] All graphics cleared');
  }

  /**
   * Wire global keyboard shortcuts for context-menu actions.
   * Shortcuts only fire when the map container (or document) is focused and
   * no input/textarea element has keyboard focus.
   *
   * Shortcut table:
   *   M        → Move, Scale, Rotate (last right-clicked graphic)
   *   E        → Edit Control Points (last right-clicked graphic)
   *   Escape   → Deactivate any active edit session
   *   Delete   → Remove last right-clicked graphic
   *   I        → Show Details
   *   C        → Center On
   */
  private _setupKeyboardShortcuts(): void {
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      // Skip when typing in an input field
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      // Handle Ctrl shortcuts first
      if (e.ctrlKey || e.metaKey) {
        if (e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
          e.preventDefault();
          this.redo();
        } else if (e.key === 'z' || e.key === 'Z') {
          e.preventDefault();
          this.undo();
        } else if (e.key === 'y' || e.key === 'Y') {
          e.preventDefault();
          this.redo();
        } else if (e.key === 'c' || e.key === 'C') {
          const g = this._contextMenuManager.getLastClickedGraphic();
          if (g) {
            e.preventDefault();
            this.copySymbol(g);
          }
        } else if (e.key === 'v' || e.key === 'V') {
          e.preventDefault();
          this._activatePasteMode();
        }
        return;
      }

      const graphic = this._contextMenuManager.getLastClickedGraphic();

      switch (e.key) {
        case 'm':
        case 'M':
          if (graphic) {
            e.preventDefault();
            this.modifySymbol(graphic);
          }
          break;
        case 'e':
        case 'E':
          if (graphic) {
            e.preventDefault();
            this.activateEditControlPoints(graphic);
          }
          break;
        case 'Escape':
          if (
            this._editEngine.isModifyingSymbol ||
            this._editEngine.isEditingControlPoints
          ) {
            e.preventDefault();
            this.deactivateEdit();
          }
          break;
        case 'Delete':
          // Batch delete if multiple selected, otherwise remove the right-clicked graphic
          if (this._selectionEngine.count > 1) {
            e.preventDefault();
            this._selectionEngine.deleteSelected((entry) =>
              this._pushUndo(entry),
            );
          } else if (graphic) {
            e.preventDefault();
            this.removeGraphic(graphic);
          }
          break;
        case 'i':
        case 'I':
          if (graphic) {
            e.preventDefault();
            this.showSymbolDetails(graphic);
          }
          break;
        case 'c':
        case 'C':
          if (graphic) {
            e.preventDefault();
            this.centerOnGraphic(graphic);
          }
          break;
        case 'l':
        case 'L':
          e.preventDefault();
          if (this._selectionEngine.isLassoActive) {
            this._selectionEngine.cancelLasso();
          } else {
            this._closeActiveWorkflow();
            this._selectionEngine.lassoSelect();
          }
          break;
      }
    });
  }

  /** Access the MeasurementEngine — configure units or toggle programmatically.
   *  May be undefined if the feature is disabled in Settings.json or not yet loaded. */
  public get measurementEngine(): MeasurementEngine | undefined {
    return this._measurementEngine;
  }

  /** Access the ProximityEngine — toggle or adjust snap options programmatically.
   *  May be undefined if the feature is disabled in Settings.json or not yet loaded. */
  public get proximityEngine(): ProximityEngine | null {
    return this._proximityEngine;
  }

  /** Access the DrawingCueEngine — control visual overlays during drawing. */
  public get drawingCueEngine(): DrawingCueEngine | null {
    return this._drawingCueEngine;
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
      if (feature === 'measurementEngine' && this._measurementEngine) {
        value
          ? this._measurementEngine.enable()
          : this._measurementEngine.disable();
      } else if (feature === 'proximityEngine' && this._proximityEngine) {
        value
          ? this._proximityEngine.enable()
          : this._proximityEngine.disable();
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
          speed_kmh: measureCfg.speedKmh
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

    if (fullPath === 'features.drawingCues' && this._drawingCueEngine) {
      value ? this._drawingCueEngine.enable() : this._drawingCueEngine.disable();
    }

    if (fullPath.startsWith('drawingCues.') && this._drawingCueEngine) {
      // Re-apply the entire drawingCues block from the (already-mutated) settingsData
      const cuesCfg = (settingsData as any).drawingCues ?? {};
      this._drawingCueEngine.setOptions(cuesCfg as DrawingCueOptions);
    }

    // Emit event so other parts of the app can react
    this.emitEvent('settingChanged', { path: path.join('.'), value });
  }

  // -----------------------------------------------------------------------
  // Undo / Redo
  // -----------------------------------------------------------------------

  /** Push an undo entry and clear the redo stack. */
  public _pushUndo(entry: UndoEntry): void {
    this._undoStack.push(entry);
    this._redoStack = [];
  }

  /** Snapshot the graphic's current geometry and CTRL_PTS before an edit begins. */
  private _capturePreEditSnapshot(
    graphic: Graphic,
    additionalGraphics: Graphic[],
    operationLabel: string,
  ): void {
    const de = graphic.attributes?.drawEssentials;
    this._preEditSnapshot = {
      geometry: graphic.geometry?.clone(),
      ctrlPts: de?.CTRL_PTS
        ? de.CTRL_PTS.map((p: any) => p.clone?.() ?? p)
        : null,
      baseLnPts: de?.BASE_LN_PTS
        ? JSON.parse(JSON.stringify(de.BASE_LN_PTS))
        : null,
    };
    (this._preEditSnapshot as any)._graphic = graphic;
    (this._preEditSnapshot as any)._label = operationLabel;
    (this._preEditSnapshot as any)._additionalSnapshots =
      additionalGraphics.map((g) => {
        const ade = g.attributes?.drawEssentials;
        return {
          graphic: g,
          geometry: g.geometry?.clone(),
          ctrlPts: ade?.CTRL_PTS
            ? ade.CTRL_PTS.map((p: any) => p.clone?.() ?? p)
            : null,
          baseLnPts: ade?.BASE_LN_PTS
            ? JSON.parse(JSON.stringify(ade.BASE_LN_PTS))
            : null,
        };
      });
  }

  /**
   * Wire the EditEngine's changeInSymbol event to push an undo entry.
   * Called once in the constructor; re-called after view switch.
   */
  private _wireEditEngineUndo(): void {
    this._editEngine.on(
      'changeInSymbol',
      ({ graphic }: { graphic: Graphic }) => {
        const snap = this._preEditSnapshot;
        if (!snap || (snap as any)._graphic !== graphic) return;

        const label = (snap as any)._label ?? 'Edit';
        const annotationLayer = this._layerManager.getOrCreateLayer(
          LAYER_NAMES.ANNOTATION_LAYER,
        );

        // Build undo/redo state for primary graphic
        const primaryStates = this._buildGraphicUndoState(graphic, snap);

        // Build undo/redo state for additional graphics
        const additionalPrev: {
          graphic: Graphic;
          geometry: any;
          ctrlPts: any;
          baseLnPts: any;
        }[] = ((snap as any)._additionalSnapshots ?? []).map((s: any) => ({
          graphic: s.graphic,
          geometry: s.geometry,
          ctrlPts: s.ctrlPts,
          baseLnPts: s.baseLnPts,
        }));
        const additionalNext = additionalPrev.map((s) =>
          this._buildGraphicUndoState(s.graphic, s),
        );

        const applyGraphicState = (
          g: Graphic,
          geom: any,
          ctrlPts: any,
          baseLnPts: any,
        ) => {
          const de = g.attributes?.drawEssentials;
          g.geometry = geom;
          if (de && ctrlPts) de.CTRL_PTS = ctrlPts;
          if (de && baseLnPts) de.BASE_LN_PTS = baseLnPts;
          const gid = g.attributes?.id;
          if (gid) {
            AnnotationEngine.deAnnotate(annotationLayer, gid);
            if (de?.AMPLIFIER) {
              AnnotationEngine.annotate(
                annotationLayer,
                geom,
                de.AMPLIFIER,
                de,
                gid,
                settingsData.textSize,
                de.ISFHAND || 0,
                this.labelOptions || {},
                {},
              );
            }
          }
        };

        this._pushUndo({
          label,
          undo: () => {
            applyGraphicState(
              graphic,
              primaryStates.prev.geometry,
              primaryStates.prev.ctrlPts,
              primaryStates.prev.baseLnPts,
            );
            additionalPrev.forEach((s) =>
              applyGraphicState(s.graphic, s.geometry, s.ctrlPts, s.baseLnPts),
            );
          },
          redo: () => {
            applyGraphicState(
              graphic,
              primaryStates.next.geometry,
              primaryStates.next.ctrlPts,
              primaryStates.next.baseLnPts,
            );
            additionalNext.forEach((s) =>
              applyGraphicState(s.graphic, s.geometry, s.ctrlPts, s.baseLnPts),
            );
          },
        });

        this._preEditSnapshot = null;
      },
    );
  }

  private _buildGraphicUndoState(
    graphic: Graphic,
    prevSnap: { geometry: any; ctrlPts: any; baseLnPts: any },
  ) {
    const de = graphic.attributes?.drawEssentials;
    return {
      prev: {
        geometry: prevSnap.geometry,
        ctrlPts: prevSnap.ctrlPts,
        baseLnPts: prevSnap.baseLnPts,
      },
      next: {
        geometry: graphic.geometry?.clone(),
        ctrlPts: de?.CTRL_PTS
          ? de.CTRL_PTS.map((p: any) => p.clone?.() ?? p)
          : null,
        baseLnPts: de?.BASE_LN_PTS
          ? JSON.parse(JSON.stringify(de.BASE_LN_PTS))
          : null,
      },
    };
  }

  /** Undo the last operation. */
  public undo(): void {
    const entry = this._undoStack.pop();
    if (!entry) return;
    entry.undo();
    this._redoStack.push(entry);
    console.info(`[Undo] ${entry.label}`);
  }

  /** Redo the last undone operation. */
  public redo(): void {
    const entry = this._redoStack.pop();
    if (!entry) return;
    entry.redo();
    this._undoStack.push(entry);
    console.info(`[Redo] ${entry.label}`);
  }

  /** Number of operations available to undo. */
  public get undoCount(): number {
    return this._undoStack.length;
  }

  /** Number of operations available to redo. */
  public get redoCount(): number {
    return this._redoStack.length;
  }

  /** Label of the next undo operation, or null if the stack is empty. */
  public get nextUndoLabel(): string | null {
    return this._undoStack.length > 0
      ? this._undoStack[this._undoStack.length - 1].label
      : null;
  }

  /** Label of the next redo operation, or null if the stack is empty. */
  public get nextRedoLabel(): string | null {
    return this._redoStack.length > 0
      ? this._redoStack[this._redoStack.length - 1].label
      : null;
  }

  // -----------------------------------------------------------------------
  // Copy / Paste
  // -----------------------------------------------------------------------

  /**
   * Copy a graphic to the internal clipboard.
   * Stores a deep clone of the graphic's geometry, symbol, and drawEssentials.
   */
  public copySymbol(graphic: Graphic): void {
    // When the right-clicked graphic is part of a multi-selection, copy all selected
    const toCopy =
      this._selectionEngine.isSelected(graphic) &&
      this._selectionEngine.count > 1
        ? this._selectionEngine.selectedGraphics
        : [graphic];
    const clipboard = toCopy.map((g) => ({
      graphic: g.clone(),
      layerId: String(g.layer?.id ?? this._layerManager.getSymbolLayer().id),
    }));
    this._clipboard = clipboard;
    console.info(`[CopyPaste] Copied ${clipboard.length} graphic(s)`);
    this.emitEvent('symbolCopied', { graphic, count: clipboard.length });
  }

  /**
   * True when the clipboard holds a graphic ready to paste.
   */
  public get hasClipboard(): boolean {
    return this._clipboard !== null;
  }

  /**
   * Paste clipboard graphic(s) at targetPoint.
   * Single item: places its centroid at targetPoint.
   * Multiple items: preserves relative layout, collective centroid lands at targetPoint.
   * Returns the first pasted Graphic, or null if clipboard is empty.
   */
  public pasteSymbol(targetPoint: Point): Graphic | null {
    if (!this._clipboard || this._clipboard.length === 0) return null;

    const annotationLayer = this._layerManager.getOrCreateLayer(
      LAYER_NAMES.ANNOTATION_LAYER,
    );

    if (this._clipboard.length === 1) {
      const item = this._clipboard[0];
      return this._pasteOneItem(
        item,
        this._offsetGeometryTo(item.graphic.geometry, targetPoint),
        annotationLayer,
      );
    }

    // Multi-paste: compute collective centroid and apply uniform offset
    const centroid = this._clipboardCentroid();
    const dx = targetPoint.x - centroid.x;
    const dy = targetPoint.y - centroid.y;

    const pasted: Graphic[] = [];
    const undos: (() => void)[] = [];
    const redos: (() => void)[] = [];

    for (const item of this._clipboard) {
      const newGeom = this._shiftGeometry(item.graphic.geometry, dx, dy);
      if (!newGeom) continue;
      const {
        graphic: g,
        undo,
        redo,
      } = this._buildPastedGraphic(item, newGeom, annotationLayer);
      const layer =
        this._layerManager.getOrCreateLayer(item.layerId) ??
        this._layerManager.getSymbolLayer();
      layer.add(g);
      pasted.push(g);
      undos.push(undo);
      redos.push(redo);
    }

    if (pasted.length > 0) {
      this._pushUndo({
        label: `Paste ${pasted.length} Symbols`,
        undo: () => undos.forEach((fn) => fn()),
        redo: () => redos.forEach((fn) => fn()),
      });
      console.info(
        `[CopyPaste] Pasted ${pasted.length} graphics at`,
        targetPoint,
      );
      this.emitEvent('symbolPasted', {
        graphics: pasted,
        count: pasted.length,
      });
    }
    return pasted[0] ?? null;
  }

  /** Paste a single clipboard item whose geometry has already been positioned. */
  private _pasteOneItem(
    item: { graphic: Graphic; layerId: string },
    newGeom: any,
    annotationLayer: GraphicsLayer,
  ): Graphic | null {
    if (!newGeom) return null;
    const {
      graphic: newGraphic,
      undo,
      redo,
    } = this._buildPastedGraphic(item, newGeom, annotationLayer);
    const layer =
      this._layerManager.getOrCreateLayer(item.layerId) ??
      this._layerManager.getSymbolLayer();
    layer.add(newGraphic);
    this._pushUndo({ label: 'Paste Symbol', undo, redo });
    console.info('[CopyPaste] Pasted at', newGeom);
    this.emitEvent('symbolPasted', { graphic: newGraphic });
    return newGraphic;
  }

  /** Shift CTRL_PTS, BASE_LN_PTS and GEOM in a drawEssentials copy by (dx, dy). */
  private _shiftDrawEssentials(de: any, dx: number, dy: number): any {
    if (!de) return de;
    const result = { ...de };
    const shiftPt = (pt: any) => {
      if (!pt) return pt;
      const clone = pt.clone?.() ?? { ...pt };
      clone.x += dx;
      clone.y += dy;
      return clone;
    };
    if (de.CTRL_PTS) result.CTRL_PTS = de.CTRL_PTS.map(shiftPt);
    if (de.BASE_LN_PTS) {
      result.BASE_LN_PTS = {
        startPt: shiftPt(de.BASE_LN_PTS.startPt),
        midPt: shiftPt(de.BASE_LN_PTS.midPt),
        endPt: shiftPt(de.BASE_LN_PTS.endPt),
      };
    }
    if (de.GEOM) result.GEOM = shiftPt(de.GEOM);
    return result;
  }

  /** Build a new graphic from a clipboard item + positioned geometry, returning undo/redo closures. */
  private _buildPastedGraphic(
    item: { graphic: Graphic; layerId: string },
    newGeom: any,
    annotationLayer: GraphicsLayer,
  ): { graphic: Graphic; undo: () => void; redo: () => void } {
    const source = item.graphic;
    const origGeom = source.geometry;

    // Compute translation vector so we can shift CTRL_PTS / BASE_LN_PTS too
    let dx = 0,
      dy = 0;
    if (origGeom && newGeom) {
      if (origGeom.type === 'point') {
        dx = (newGeom as any).x - (origGeom as any).x;
        dy = (newGeom as any).y - (origGeom as any).y;
      } else {
        const oe = origGeom.extent,
          ne = newGeom.extent;
        if (oe && ne) {
          dx = (ne.xmin + ne.xmax) / 2 - (oe.xmin + oe.xmax) / 2;
          dy = (ne.ymin + ne.ymax) / 2 - (oe.ymin + oe.ymax) / 2;
        }
      }
    }

    const sourceDe = source.attributes?.drawEssentials;
    const shiftedDe = this._shiftDrawEssentials(sourceDe, dx, dy);
    const newId = this.generateUUID();
    const newGraphic = source.clone();
    newGraphic.geometry = newGeom;
    newGraphic.attributes = {
      ...source.attributes,
      id: newId,
      drawEssentials: shiftedDe,
    };

    const layer =
      this._layerManager.getOrCreateLayer(item.layerId) ??
      this._layerManager.getSymbolLayer();
    if (shiftedDe?.AMPLIFIER) {
      AnnotationEngine.annotate(
        annotationLayer,
        newGeom,
        shiftedDe.AMPLIFIER,
        shiftedDe,
        newId,
        settingsData.textSize,
        shiftedDe.ISFHAND || 0,
        this.labelOptions || {},
        {},
      );
    }
    return {
      graphic: newGraphic,
      undo: () => {
        layer.remove(newGraphic);
        AnnotationEngine.deAnnotate(annotationLayer, newId);
      },
      redo: () => {
        layer.add(newGraphic);
        if (shiftedDe?.AMPLIFIER)
          AnnotationEngine.annotate(
            annotationLayer,
            newGeom,
            shiftedDe.AMPLIFIER,
            shiftedDe,
            newId,
            settingsData.textSize,
            shiftedDe.ISFHAND || 0,
            this.labelOptions || {},
            {},
          );
      },
    };
  }

  /** Centroid of all clipboard geometries (for multi-paste anchor). */
  private _clipboardCentroid(): { x: number; y: number } {
    if (!this._clipboard || this._clipboard.length === 0) return { x: 0, y: 0 };
    let tx = 0,
      ty = 0;
    for (const { graphic: g } of this._clipboard) {
      const geom = g.geometry;
      if (!geom) continue;
      if (geom.type === 'point') {
        tx += (geom as any).x;
        ty += (geom as any).y;
      } else {
        const ext = geom.extent;
        if (ext) {
          tx += (ext.xmin + ext.xmax) / 2;
          ty += (ext.ymin + ext.ymax) / 2;
        }
      }
    }
    return { x: tx / this._clipboard.length, y: ty / this._clipboard.length };
  }

  /** Translate all vertices of a geometry by (dx, dy). */
  private _shiftGeometry(sourceGeom: any, dx: number, dy: number): any {
    if (!sourceGeom) return null;
    try {
      const clone = sourceGeom.clone();
      if (clone.type === 'point') {
        clone.x += dx;
        clone.y += dy;
      } else if (clone.type === 'polyline') {
        clone.paths = clone.paths.map((path: number[][]) =>
          path.map(([x, y, ...r]) => [x + dx, y + dy, ...r]),
        );
      } else if (clone.type === 'polygon') {
        clone.rings = clone.rings.map((ring: number[][]) =>
          ring.map(([x, y, ...r]) => [x + dx, y + dy, ...r]),
        );
      }
      return clone;
    } catch {
      return sourceGeom.clone();
    }
  }

  /**
   * Enter "paste mode": the next map click pastes the clipboard graphic there.
   * Escape cancels paste mode.
   */
  public _activatePasteMode(): void {
    if (!this._clipboard) return;

    this._closeActiveWorkflow();
    this.emitEvent('pasteMode', { active: true });
    console.info('[CopyPaste] Paste mode active — click map to paste');

    const clickHandle = this.view.on('click', (evt) => {
      clickHandle.remove();
      keyHandle();
      const pt = this.view.toMap({ x: evt.x, y: evt.y });
      if (pt) this.pasteSymbol(pt);
      this.emitEvent('pasteMode', { active: false });
    });

    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clickHandle.remove();
        keyHandle();
        this.emitEvent('pasteMode', { active: false });
        console.info('[CopyPaste] Paste mode cancelled');
      }
    };
    document.addEventListener('keydown', keyHandler, { once: false });
    const keyHandle = () => document.removeEventListener('keydown', keyHandler);
  }

  /**
   * Translate all vertices of a geometry so that its centroid lands at targetPoint.
   */
  private _offsetGeometryTo(sourceGeom: any, targetPoint: Point): any {
    if (!sourceGeom) return null;
    try {
      const clone = sourceGeom.clone();
      if (clone.type === 'point') {
        clone.x = targetPoint.x;
        clone.y = targetPoint.y;
        if (targetPoint.z !== undefined) clone.z = targetPoint.z;
      } else {
        // Compute centroid from extent
        const ext = clone.extent;
        if (!ext) return clone;
        const dx = targetPoint.x - (ext.xmin + ext.xmax) / 2;
        const dy = targetPoint.y - (ext.ymin + ext.ymax) / 2;
        if (clone.type === 'polyline') {
          clone.paths = clone.paths.map((path: number[][]) =>
            path.map(([x, y, ...rest]) => [x + dx, y + dy, ...rest]),
          );
        } else if (clone.type === 'polygon') {
          clone.rings = clone.rings.map((ring: number[][]) =>
            ring.map(([x, y, ...rest]) => [x + dx, y + dy, ...rest]),
          );
        }
      }
      return clone;
    } catch {
      return sourceGeom.clone();
    }
  }

  public enrichSymbolOptions(options: SymbolOptions): SymbolOptions & {
    parsedSIDC?: ParsedSIDC;
    label?: string;
    text?: string;
  } {
    try {
      if (!options.sidc) throw new Error('Missing SIDC in symbol options');

      console.log('SIDC:', options.sidc);
      const parsed = parseSIDC(options.sidc);
      console.log('Parsed SIDC:', parsed);
      console.log('Standard Identity', parsed.setA.standardIdentityLabel);
      console.log('Symbol Set', parsed.setA.symbolSetLabel);
      console.log('Echelon', parsed.setA.echelonMobilityLabel);

      return {
        ...options,
        parsedSIDC: parsed,
        label:
          `${parsed.setA.standardIdentityLabel ?? ''} ${parsed.setA.symbolSetLabel ?? ''}`.trim(),
        text: parsed.setA.echelonMobilityLabel ?? '',
      };
    } catch (error) {
      console.warn(error);
      console.warn('Invalid SIDC provided:', options.sidc);
      return options;
    }
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

  addPointToLayer(geometry: __esri.Point): void {
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
        const point = event.graphic.geometry as __esri.Point;
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
    geometry: __esri.Point,
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
    point: __esri.Point,
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
    geometry: __esri.Point,
    options: SymbolOptions,
  ): void {
    const layer = this._layerManager.getOrCreateLayer('milSymbols');
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
    geometry: __esri.Point,
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
    geometry: __esri.Point,
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

      // Create milsymbol.js options
      const msOptions = {
        size: drawEssentials.SIZE || 35,
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

      // Close any active edit/move workflow before starting a new draw
      if (!isPassive) {
        this._closeActiveWorkflow();
        this._selectionEngine.setDrawing(true);
        // Arm proximity indicator for the upcoming draw session
        this._proximityEngine?.activate();
        // Arm drawing cue overlays for the upcoming draw session
        this._drawingCueEngine?.activate([
          LAYER_NAMES.FORCE, LAYER_NAMES.TACT_PT, LAYER_NAMES.TACT, 'milSymbols',
        ]);
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
              if (drawEssentials.extraSettings.hasOwnProperty('size')) {
                drawEssentials.SIZE = drawEssentials.extraSettings.size; // Changed drawEssentials.size to drawEssentials.SIZE
              }

              if (drawEssentials.extraSettings.hasOwnProperty('opacity')) {
                drawEssentials.opacity = drawEssentials.extraSettings.opacity;
              }
            }
          }

          if (isPassive === true) {
            debugger;
            // Assuming this.reProject and this.map exist
            if (drawEssentials.hasOwnProperty('GEOM') && drawEssentials.GEOM) {
              /*
              drawEssentials.GEOM = this.reProject(
                drawEssentials.GEOM,
                this.view.spatialReference,
              ); // Changed this.map to this.view

               */
            }
            if (
              drawEssentials.hasOwnProperty('OPTIONS') &&
              drawEssentials.OPTIONS?.hasOwnProperty('GEOM') &&
              drawEssentials.OPTIONS.GEOM
            ) {
              /*
              drawEssentials.OPTIONS.GEOM = this.reProject(
                drawEssentials.OPTIONS.GEOM,
                this.view.spatialReference,
              ); // Changed this.map to this.view
              debugger;

               */
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
            debugger;

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
              debugger;
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
   * @returns The projected Point (returns same as input)
   */
  public reProject(point: Point, spatialReference: SpatialReference): Point {
    return point;
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
        // Set SIDC if we have it
        if (this.sidc && this.sidc.getSIDC) {
          drawEssentials.SIDC = this.sidc.getSIDC();
        }

        // Set AMPLIFIER if we have it
        if (this.amplifier) {
          drawEssentials.AMPLIFIER = this.amplifier;
        }

        graphic.set('drawEssentials', drawEssentials);
      }

      // Set up graphic attributes - handle both old style (this.attrs) and new style
      const attrs: any = {
        drawEssentials: drawEssentials,
        type: symbolType || 'symbol',
      };

      // Handle ID assignment — use pending ID from load/paste, else generate new
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

      // Get the appropriate layer from LayerManager
      const graphicsLayer = this._layerManager.getSymbolLayer();
      graphicsLayer.add(graphic);
      console.info('Symbol Added');

      // Push undo entry for the Add operation
      const symLabel = drawEssentials?.SIDC
        ? `Symbol (${drawEssentials.SIDC.slice(0, 6)})`
        : 'Symbol';
      const annotationLayer = this._layerManager.getOrCreateLayer(
        LAYER_NAMES.ANNOTATION_LAYER,
      );
      this._pushUndo({
        label: `Add ${symLabel}`,
        undo: () => {
          graphicsLayer.remove(graphic);
          AnnotationEngine.deAnnotate(annotationLayer, attrs.id);
        },
        redo: () => {
          graphicsLayer.add(graphic);
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

      // Clean up event handlers if they exist
      this._endEventHandle?.remove();
      this._drawProgressEventHandle?.remove();
      this._drawClickEventHandle?.remove();
      this._drawBaseLineEndEventHandle?.remove();

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

      console.log('Graphic added to layer:', {
        id: attrs.id,
        geometryType: geometry.type,
        symbolType: symbolType || 'unknown',
      });

      // Emit custom events for further processing
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
    } catch (error) {
      console.error('Error in drawSymEnd:', error);
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

  /**
   * Getter function to expose symbol data
   * @returns The complete symbol data object
   */
  public getSymbolData(): any {
    return symbolData;
  }

  /**
   * Get symbol data by key
   * @param key The symbol key to retrieve
   * @returns The symbol data for the specified key or null if not found
   */
  public getSymbolByKey(key: string): any {
    return symbolData[key] || null;
  }

  /**
   * Get all symbol names for autocomplete
   * @returns Array of objects with key and name for autocomplete
   */
  public getSymbolNamesForAutocomplete(): Array<{ key: string; name: string }> {
    return Object.entries(symbolData).map(([key, data]: [string, any]) => ({
      key: key,
      name: data.Name || 'Unnamed Symbol',
    }));
  }

  // -----------------------------------------------------------------------
  // Feature 5 — Save / Load Symbol Configurations
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
      layerId: graphic.layer?.id ?? this._layerManager.getSymbolLayer().id,
      id: graphic.attributes?.id,
      sidc: amplifier?.SIDC || de?.SIDC,
      amplifier: amplifier ? { ...amplifier } : {},
      drawEssentials: deJson,
    };
  }

  /**
   * Reconstruct a graphic from a serialised pams8 object.
   * When CTRL_PTS / BASE_LN_PTS / GEOM are present the symbol is re-rendered
   * through initialize(isPassive=true) — the same pipeline as interactive drawing.
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

        this._pendingAttrs = { symbolId: data.id };
        this.initialize(de, amplifier, true);
        return null; // graphic is added to layer via drawSymEnd
      }

      // Fallback: milsymbol or v1.0 legacy format — direct Graphic construction
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
    const result: object[] = [];
    const layerIds = [
      LAYER_NAMES.TACT,
      LAYER_NAMES.TACT_PT,
      LAYER_NAMES.FORCE,
      'milSymbols',
    ];
    for (const layerId of layerIds) {
      const layer = this._layerManager.getOrCreateLayer(layerId) as any;
      if (!layer?.graphics) continue;
      (layer.graphics as any).forEach((g: Graphic) => {
        try {
          result.push(this.saveSymbolToJSON(g));
        } catch {
          /* skip */
        }
      });
    }
    return result;
  }

  /** Reconstruct all graphics from a serialised array. */
  public importLayerFromJSON(data: object[]): void {
    data.forEach((item) => this.loadSymbolFromJSON(item as any));
    console.info(`[SaveLoad] Imported ${data.length} symbols`);
  }

  /** Download all symbols as a PAMS8 JSON file. */
  public saveToFile(filename?: string): void {
    const data = this.exportLayerToJSON();
    this._downloadJSON(data, filename ?? `pams8_symbols_${Date.now()}.json`);
    console.info(`[SaveLoad] Exported ${data.length} symbols`);
  }

  /** Download a single graphic as a PAMS8 JSON file. */
  public saveSymbolToFile(graphic: Graphic): void {
    const data = this.saveSymbolToJSON(graphic);
    this._downloadJSON(data, `pams8_symbol_${Date.now()}.json`);
  }

  /** Open a file picker; loads from PAMS8 JSON, template, or GeoJSON file. */
  public loadFromFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.geojson,application/json';
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const parsed = JSON.parse(evt.target?.result as string);
          if (parsed?.type === 'FeatureCollection') {
            this.importFromGeoJSON(parsed);
          } else if (parsed?.type === 'pams8-template') {
            this._applyTemplateData(parsed);
          } else if (Array.isArray(parsed)) {
            this.importLayerFromJSON(parsed);
          } else {
            this.loadSymbolFromJSON(parsed);
          }
        } catch (err) {
          console.error('[SaveLoad] Failed to parse file:', err);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  /**
   * Save a symbol's draw configuration (without geometry) as a template file.
   * Loading the template triggers interactive placement (no GEOM/CTRL_PTS set).
   * Also stores to localStorage so the dynamic context-menu "Apply" list stays current.
   */
  public saveTemplateToFile(graphic: Graphic): void {
    const de: any = graphic.attributes?.drawEssentials;
    const amplifier = de?.AMPLIFIER;
    const name = window.prompt('Template name:');
    if (!name?.trim()) return;

    const deClean: any = { ...de };
    delete deClean.AMPLIFIER;
    delete deClean.SCOPE;
    delete deClean.CTRL_PTS;
    delete deClean.BASE_LN_PTS;
    delete deClean.GEOM;

    const template = {
      pams8Version: '1.0',
      type: 'pams8-template',
      name: name.trim(),
      sidc: amplifier?.SIDC || de?.SIDC,
      amplifier: amplifier ? { ...amplifier } : {},
      drawEssentials: deClean,
    };

    this._downloadJSON(
      template,
      `pams8_template_${name.trim().replace(/\s+/g, '_')}_${Date.now()}.json`,
    );
    this.saveAsTemplate(name.trim(), graphic); // keep localStorage in sync
    console.info(`[Templates] Template "${name.trim()}" saved to file`);
  }

  /** Open a file picker; loads a template and starts interactive placement. */
  public loadTemplateFromFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = JSON.parse(evt.target?.result as string);
          this._applyTemplateData(data);
        } catch (err) {
          console.error('[Templates] Failed to load template file:', err);
        }
      };
      reader.readAsText(file);
    };
    input.click();
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

    // Cache in localStorage so the dynamic context-menu "Apply" list shows it
    if (data.name) {
      const store = this._loadTemplatesStore();
      store[data.name] = data;
      localStorage.setItem(this._TEMPLATES_KEY, JSON.stringify(store));
    }

    this.initialize(de, amplifier); // interactive — no geometry pre-set
    console.info(`[Templates] Loaded template "${data.name || '(unnamed)'}"`);
  }

  // -----------------------------------------------------------------------
  // GeoJSON Export / Import
  // -----------------------------------------------------------------------

  /** Export all symbol layers as a standard GeoJSON FeatureCollection (WGS84 coordinates). */
  public exportToGeoJSON(): object {
    const features: any[] = [];
    const layerIds = [
      LAYER_NAMES.TACT,
      LAYER_NAMES.TACT_PT,
      LAYER_NAMES.FORCE,
      'milSymbols',
    ];
    const sp = (pt: any) => this._serializePoint(pt);

    for (const layerId of layerIds) {
      const layer = this._layerManager.getOrCreateLayer(layerId) as any;
      if (!layer?.graphics) continue;

      (layer.graphics as any).forEach((g: Graphic) => {
        try {
          const de: any = g.attributes?.drawEssentials;
          const amplifier = de?.AMPLIFIER;

          // Convert projected geometry to WGS84 for standard GeoJSON
          let geom: any = g.geometry;
          const wkid = geom?.spatialReference?.wkid;
          if (geom && (wkid === 102100 || wkid === 3857)) {
            geom = webMercatorUtils.webMercatorToGeographic(geom);
          }

          let geoJsonGeom: any = null;
          if (geom?.type === 'point') {
            const pt = geom as Point;
            geoJsonGeom = {
              type: 'Point',
              coordinates: [pt.longitude ?? pt.x, pt.latitude ?? pt.y],
            };
          } else if (geom?.type === 'polyline') {
            geoJsonGeom = {
              type: 'MultiLineString',
              coordinates: (geom as any).paths ?? [],
            };
          } else if (geom?.type === 'polygon') {
            geoJsonGeom = {
              type: 'Polygon',
              coordinates: (geom as any).rings ?? [],
            };
          }

          if (!geoJsonGeom) return;

          const ctrlPts = de?.CTRL_PTS ? de.CTRL_PTS.map(sp) : undefined;
          const baseLnPts = de?.BASE_LN_PTS
            ? {
                startPt: sp(de.BASE_LN_PTS.startPt),
                midPt: sp(de.BASE_LN_PTS.midPt),
                endPt: sp(de.BASE_LN_PTS.endPt),
              }
            : undefined;
          const deGeom = de?.GEOM
            ? sp(de.GEOM)
            : !ctrlPts && !baseLnPts && g.geometry?.type === 'point'
              ? sp(g.geometry)
              : undefined;

          const deJson: any = { ...de };
          delete deJson.AMPLIFIER;
          delete deJson.SCOPE;
          delete deJson.CTRL_PTS;
          delete deJson.BASE_LN_PTS;
          delete deJson.GEOM;
          if (ctrlPts) deJson.CTRL_PTS = ctrlPts;
          if (baseLnPts) deJson.BASE_LN_PTS = baseLnPts;
          if (deGeom) deJson.GEOM = deGeom;

          features.push({
            type: 'Feature',
            geometry: geoJsonGeom,
            properties: {
              pams8: true,
              id: g.attributes?.id,
              layerId,
              sidc: amplifier?.SIDC || de?.SIDC,
              amplifier: amplifier ? { ...amplifier } : {},
              drawEssentials: deJson,
            },
          });
        } catch (e) {
          console.warn('[GeoJSON] Skipping graphic:', e);
        }
      });
    }

    return { type: 'FeatureCollection', features };
  }

  /** Reconstruct symbols from a pams8 GeoJSON FeatureCollection. */
  public importFromGeoJSON(geojson: any): void {
    if (
      geojson?.type !== 'FeatureCollection' ||
      !Array.isArray(geojson.features)
    ) {
      console.error('[GeoJSON] Expected a GeoJSON FeatureCollection');
      return;
    }

    let count = 0;
    for (const feature of geojson.features) {
      try {
        const props = feature.properties ?? {};
        if (!props.pams8) continue;

        const deData = props.drawEssentials ?? {};
        const ctrlPtsRaw = deData.CTRL_PTS;
        const baseLnPtsRaw = deData.BASE_LN_PTS;
        const geomRaw = deData.GEOM;
        const geoGeom = feature.geometry;

        const de = new DrawEssentials();
        const { CTRL_PTS, BASE_LN_PTS, GEOM, ...rest } = deData;
        Object.assign(de, rest);

        if (ctrlPtsRaw?.length > 0) {
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
        } else if (!ctrlPtsRaw && !baseLnPtsRaw && geoGeom?.type === 'Point') {
          // Derive GEOM from the standard GeoJSON Point geometry (WGS84)
          (de as any).GEOM = new Point({
            longitude: geoGeom.coordinates[0],
            latitude: geoGeom.coordinates[1],
            spatialReference: { wkid: 4326 },
          });
        }

        const amplifier = new Amplifier();
        if (props.amplifier) Object.assign(amplifier, props.amplifier);
        if (props.sidc && !amplifier.SIDC) amplifier.SIDC = props.sidc;

        this._pendingAttrs = { symbolId: props.id };
        this.initialize(de, amplifier, true);
        count++;
      } catch (e) {
        console.warn('[GeoJSON] Failed to import feature:', e);
      }
    }
    console.info(`[GeoJSON] Imported ${count} symbols`);
  }

  /** Download all symbols as a standard GeoJSON file. */
  public saveToGeoJSONFile(filename?: string): void {
    const data = this.exportToGeoJSON();
    this._downloadJSON(data, filename ?? `pams8_geojson_${Date.now()}.geojson`);
    console.info('[GeoJSON] Exported GeoJSON file');
  }

  /** Open a file picker and load symbols from a GeoJSON or PAMS8 JSON file. */
  public loadFromGeoJSONFile(): void {
    this.loadFromFile(); // loadFromFile now auto-detects FeatureCollection vs pams8 formats
  }

  private _downloadJSON(data: any, filename: string): void {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // -----------------------------------------------------------------------
  // Feature 7 — Symbol Templates
  // -----------------------------------------------------------------------

  private readonly _TEMPLATES_KEY = 'pams8_templates';

  /** Save the amplifier + size of the given graphic as a named template. */
  public saveAsTemplate(name: string, graphic: Graphic): void {
    const de: any = graphic.attributes?.drawEssentials;
    const templates = this._loadTemplatesStore();
    templates[name] = {
      name,
      size: de?.SIZE,
      amplifier: de?.AMPLIFIER ? { ...de.AMPLIFIER } : {},
    };
    localStorage.setItem(this._TEMPLATES_KEY, JSON.stringify(templates));
    console.info(`[Templates] Saved template: "${name}"`);
  }

  /** Apply a saved template's amplifier + size to an existing graphic and re-annotate. */
  public applyTemplate(name: string, graphic: Graphic): void {
    const t = this._loadTemplatesStore()[name];
    if (!t) {
      console.warn(`[Templates] Not found: "${name}"`);
      return;
    }

    const de: any = graphic.attributes?.drawEssentials;
    if (!de) return;

    if (t.size !== undefined) de.SIZE = t.size;

    const amplifier = new Amplifier();
    Object.assign(amplifier, t.amplifier);
    de.AMPLIFIER = amplifier;

    const id = graphic.attributes?.id;
    const annotationLayer = this._layerManager.getOrCreateLayer(
      LAYER_NAMES.ANNOTATION_LAYER,
    );
    if (id) {
      AnnotationEngine.deAnnotate(annotationLayer, id);
      if (amplifier.SIDC) {
        AnnotationEngine.annotate(
          annotationLayer,
          graphic.geometry,
          amplifier,
          de,
          id,
          settingsData.textSize,
          de.ISFHAND || 0,
          this.labelOptions || {},
          {},
        );
      }
    }
    console.info(`[Templates] Applied template: "${name}"`);
  }

  public listTemplates(): string[] {
    return Object.keys(this._loadTemplatesStore());
  }

  public deleteTemplate(name: string): void {
    const templates = this._loadTemplatesStore();
    delete templates[name];
    localStorage.setItem(this._TEMPLATES_KEY, JSON.stringify(templates));
  }

  private _loadTemplatesStore(): Record<string, any> {
    try {
      return JSON.parse(localStorage.getItem(this._TEMPLATES_KEY) || '{}');
    } catch {
      return {};
    }
  }

  private _promptSaveTemplate(graphic: Graphic): void {
    this.saveTemplateToFile(graphic); // saves to file + localStorage
  }
}

export default SymbolEngine;
