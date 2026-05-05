/**
 * PlanEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Singleton engine that manages military plan types (Defence, Attack, Logistic,
 * Engineers, Communications) via JSON templates stored in Templates/plans/.
 *
 * Template-driven approach:
 *  - Each plan type has a JSON file in Templates/plans/<type>.json
 *  - All symbol positions are in normalized ratio space (−1..+1 on both axes)
 *  - User supplies a PlacementArea (center, frontage, depth, orientation)
 *  - _ratioToWorld() transforms each ratio coordinate to geodetic WGS-84
 *  - Emits CustomEvents on document for HUD / other engines to react
 *  - Each plan lives on its own named GraphicsLayer group
 *
 * Usage (in app bootstrap):
 *   const planEngine = PlanEngine.getInstance();
 *   planEngine.start(symbolEngine, layerManager, view);
 *
 *   const area: PlacementArea = {
 *     center: { longitude: 73.05, latitude: 33.62 },
 *     orientationDeg: 45,
 *     units: 'kilometers',
 *     frontage: 20,
 *     depth: 15,
 *   };
 *   planEngine.activatePlan('defence', area);
 * ─────────────────────────────────────────────────────────────────────────────
 */

import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polyline from '@arcgis/core/geometry/Polyline';
import Polygon from '@arcgis/core/geometry/Polygon';
import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol';
import Color from '@arcgis/core/Color';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import * as reactiveUtils from '@arcgis/core/core/reactiveUtils';

import GraphicsLayerManager from '../Managers/GraphicsLayerManager';
import AnnotationEngine from './AnnotationEngine';
import type SymbolEngine from './SymbolEngine';

// ─────────────────────────────────────────────────────────────────────────────
// PlacementArea — user-supplied envelope that drives template coordinate transform
// ─────────────────────────────────────────────────────────────────────────────

export interface PlacementArea {
    /** Map click point — geodetic WGS-84 */
    center: { longitude: number; latitude: number };

    /**
     * Bearing the "front" (+y) faces.
     * 0 = North, 90 = East, 180 = South, 270 = West.
     */
    orientationDeg: number;

    units: 'meters' | 'kilometers' | 'miles' | 'nautical-miles';

    /**
     * Width of the placement area in `units`.
     * Required unless expandRatio is used instead.
     */
    frontage?: number;

    /**
     * Depth / height of the placement area in `units`.
     * Required unless expandRatio is used instead.
     */
    depth?: number;

    /**
     * Scale factor applied to template defaults.frontageKm / defaults.depthKm.
     * 1.0 = default size, 2.0 = double, 0.5 = half.
     * Used only when frontage + depth are NOT provided.
     */
    expandRatio?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Template types — mirror the JSON schema in Templates/plans/*.json
// ─────────────────────────────────────────────────────────────────────────────

export interface TemplateDefaults {
    frontageKm: number;
    depthKm: number;
    orientationDeg: number;
    units: 'meters' | 'kilometers' | 'miles' | 'nautical-miles';
}

export interface TemplateStyle {
    /** Line color RGB 0–255 */
    color?: [number, number, number];
    /** ArcGIS SimpleLineSymbol style */
    lineStyle?: 'solid' | 'dash' | 'dot' | 'dash-dot' | 'long-dash' | 'long-dash-dot';
    /** Line width in pixels */
    width?: number;
    /** Fill color RGB 0–255 */
    fillColor?: [number, number, number];
    /** Fill opacity 0–1 */
    fillOpacity?: number;
    /** Outline color RGB 0–255 */
    outlineColor?: [number, number, number];
    /** Outline width in pixels */
    outlineWidth?: number;
    /** Point symbol size in pixels */
    size?: number;
}

export interface TemplateAmplifier {
    uniqueDesignation?: string;
    higherFormation?: string;
    dtg?: string;
    staffComments?: string;
    additionalInfo?: string;
}

/** Properties specific to exercise scenario seeds */
export interface ScenarioProp {
    isStartPoint?: boolean;
    isEndPoint?: boolean;
    isCheckpoint?: boolean;
    checkpointId?: string;
    snapRadiusKm?: number;
    isForbiddenZone?: boolean;
    forbiddenZoneId?: string;
    threatZoneRadiusKm?: number;
    isKillZone?: boolean;
    ambushSectorBearingDeg?: number;
    ambushSectorHalfAngleDeg?: number;
    ambushSectorRangeKm?: number;
}

/** Point or FPoint symbol — single position in ratio space */
export interface TemplateSymbolPoint {
    id: string;
    symbolKey: string;
    role: string;
    label?: string;
    geoType: 'Point' | 'FPoint';
    /** Normalized position: x ∈ [−1, +1], y ∈ [−1, +1] */
    position: { x: number; y: number };
    style?: TemplateStyle;
    amplifier?: TemplateAmplifier;
    /** True = SelectionEngine skips this graphic (exercise seed) */
    locked?: boolean;
    scenarioProp?: ScenarioProp;
}

/** Line symbol — ordered vertices in ratio space */
export interface TemplateSymbolLine {
    id: string;
    symbolKey: string;
    role: string;
    label?: string;
    geoType: 'Line';
    /** Ordered path vertices: x ∈ [−1, +1], y ∈ [−1, +1] */
    path: Array<{ x: number; y: number }>;
    style?: TemplateStyle;
    amplifier?: TemplateAmplifier;
    locked?: boolean;
    scenarioProp?: ScenarioProp;
}

/** Area (polygon) symbol — rings in ratio space */
export interface TemplateSymbolArea {
    id: string;
    symbolKey: string;
    role: string;
    label?: string;
    geoType: 'Area';
    /**
     * Polygon rings. Each ring is an array of [x, y] pairs in ratio space.
     * First ring = outer ring, subsequent = holes.
     */
    rings: Array<Array<[number, number]>>;
    style?: TemplateStyle;
    amplifier?: TemplateAmplifier;
    locked?: boolean;
    scenarioProp?: ScenarioProp;
}

export type TemplateSymbol =
    | TemplateSymbolPoint
    | TemplateSymbolLine
    | TemplateSymbolArea;

/** Root structure of Templates/plans/*.json and Templates/Ex/*.json */
export interface PlanTemplate {
    id: string;
    name: string;
    version: string;
    description: string;
    /** For exercise templates only */
    scenarioType?: string;
    defaults: TemplateDefaults;
    symbols: TemplateSymbol[];
    /** Exercise-only: defines pass/fail conditions */
    successCriteria?: {
        maxRouteLengthKm?: number;
        forbiddenZoneIds?: string[];
        requiredCheckpoints?: string[];
        timeLimitMinutes?: number;
    };
    /** Exercise-only: score formula parameters */
    scoring?: {
        baseScore: number;
        penaltyPerKmOver?: number;
        penaltyForbiddenZone?: number;
        penaltyMissedCheckpoint?: number;
        passThreshold: number;
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan configuration — one entry per plan type, registered at construction
// ─────────────────────────────────────────────────────────────────────────────

export type PlanType =
    | 'defence'
    | 'attack'
    | 'logistic'
    | 'engineers'
    | 'communications';

export interface PlanConfig {
    id: PlanType;
    label: string;
    /** RGB accent applied to plan layers' overlay labels */
    accentColor: [number, number, number];
    /** SymbolEngine feature flags to force-enable when this plan activates */
    enableFeatures: string[];
    /** SIDC prefixes pinned to top of symbol palette while plan is focused */
    prioritySidcPrefixes: string[];
    /** Path to template JSON, relative to project root */
    templatePath: string;
}

/** Runtime state of a plan that has been activated */
export interface ActivePlan {
    type: PlanType;
    config: PlanConfig;
    template: PlanTemplate;
    placementArea: PlacementArea;
    overlayLayer: GraphicsLayer;
    symbolLayer: GraphicsLayer;
    annotationLayer: GraphicsLayer;
    opacity: number;
    visible: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Built-in plan configurations
// ─────────────────────────────────────────────────────────────────────────────

const PLAN_CONFIGS: PlanConfig[] = [
    {
        id: 'defence',
        label: 'Defence Plan',
        accentColor: [0, 112, 0],
        enableFeatures: ['measurementEngine', 'drawingCues', 'proximityEngine'],
        prioritySidcPrefixes: [
            '10031000141',  // Friendly land units
            'G*G*GL',       // Tactical lines: FEBA, FLOT, PL
            'G*G*SA',       // Engagement areas
            'G*G*OA',       // Obstacle belts, battle positions
            'G*M*OM',       // Minefields
        ],
        templatePath: 'Templates/plans/defence.json',
    },
    {
        id: 'attack',
        label: 'Attack Plan',
        accentColor: [180, 30, 30],
        enableFeatures: ['measurementEngine', 'drawingCues'],
        prioritySidcPrefixes: [
            '10031000141',
            'G*G*GL',
            'G*T*',
        ],
        templatePath: 'Templates/plans/attack.json',
    },
    {
        id: 'logistic',
        label: 'Logistic Plan',
        accentColor: [0, 100, 200],
        enableFeatures: ['measurementEngine'],
        prioritySidcPrefixes: [
            'G*S*',
            '10011000',
        ],
        templatePath: 'Templates/plans/logistic.json',
    },
    {
        id: 'engineers',
        label: 'Engineers Plan',
        accentColor: [180, 120, 0],
        enableFeatures: ['measurementEngine', 'drawingCues'],
        prioritySidcPrefixes: [
            'G*M*O',
            'G*M*B',
            '10031000134',
        ],
        templatePath: 'Templates/plans/engineers.json',
    },
    {
        id: 'communications',
        label: 'Communications Plan',
        accentColor: [100, 0, 180],
        enableFeatures: ['drawingCues'],
        prioritySidcPrefixes: [
            '10111',
            '10110207',
        ],
        templatePath: 'Templates/plans/communications.json',
    },
];

// ─────────────────────────────────────────────────────────────────────────────
// PlanEngine singleton
// ─────────────────────────────────────────────────────────────────────────────

class PlanEngine {
    private static _instance: PlanEngine | null = null;

    private _symbolEngine: SymbolEngine | null = null;
    private _layerManager: GraphicsLayerManager | null = null;
    private _view: MapView | SceneView | null = null;

    private _configs: Map<PlanType, PlanConfig> = new Map();
    private _activePlans: Map<PlanType, ActivePlan> = new Map();
    private _focusPlan: PlanType | null = null;
    private _zoomHandle: __esri.WatchHandle | null = null;

    // ── Singleton ──────────────────────────────────────────────────────────────

    static getInstance(): PlanEngine {
        if (!PlanEngine._instance) {
            PlanEngine._instance = new PlanEngine();
        }
        return PlanEngine._instance;
    }

    private constructor() {
        for (const cfg of PLAN_CONFIGS) {
            this._configs.set(cfg.id, cfg);
        }
    }

    // ── Initialisation ─────────────────────────────────────────────────────────

    public start(
        symbolEngine: SymbolEngine,
        layerManager: GraphicsLayerManager,
        view: MapView | SceneView,
    ): void {
        this._symbolEngine = symbolEngine;
        this._layerManager = layerManager;
        this._view = view;
        this._wireZoomWatcher();
        document.addEventListener('symbolCreated', (e: any) => {
            this._onSymbolCreated(e.detail);
        });
        console.info('[PlanEngine] Started');
    }

    public onViewChanged(newView: MapView | SceneView): void {
        this._view = newView;
        this._zoomHandle?.remove();
        this._wireZoomWatcher();
        this._activePlans.forEach((plan) => {
            const layers = newView.map.layers as any;
            if (!layers.includes(plan.overlayLayer)) {
                newView.map.addMany([plan.overlayLayer, plan.symbolLayer, plan.annotationLayer]);
            }
        });
    }

    // ── Plan lifecycle ─────────────────────────────────────────────────────────

    /**
     * Activate a plan:
     * 1. Loads template JSON from config.templatePath.
     * 2. Creates dedicated GraphicsLayer group.
     * 3. Calls placeTemplate() to transform and place all symbols.
     * 4. Emits planActivated.
     */
    public async activatePlan(type: PlanType, area: PlacementArea): Promise<void> {
        const config = this._configs.get(type);
        if (!config) { console.error(`[PlanEngine] Unknown plan type: ${type}`); return; }
        if (this._activePlans.has(type)) { this.setFocusPlan(type); return; }
        if (!this._view || !this._layerManager) { console.error('[PlanEngine] Call start() first'); return; }

        // Load template JSON
        const template = await this._loadTemplate(config.templatePath);

        // Create per-plan layer group
        const overlayLayer = new GraphicsLayer({
            id: `plan_overlay_${type}`,
            title: `${config.label} — Overlays`,
        });
        const symbolLayer = new GraphicsLayer({
            id: `plan_symbols_${type}`,
            title: `${config.label} — Symbols`,
        });
        const annotationLayer = new GraphicsLayer({
            id: `plan_annotations_${type}`,
            title: `${config.label} — Labels`,
            listMode: 'hide',
        });

        // Stacking: overlays (bottom) → symbols → annotations
        this._view.map.addMany([overlayLayer, symbolLayer, annotationLayer]);

        const activePlan: ActivePlan = {
            type, config, template, placementArea: area,
            overlayLayer, symbolLayer, annotationLayer,
            opacity: 1, visible: true,
        };
        this._activePlans.set(type, activePlan);
        this._focusPlan = type;

        // Resolve effective dimensions in km
        const resolved = this._resolveDimensions(area, template.defaults);

        // Place all template symbols on the overlay layer
        await this._placeTemplate(template, resolved, area, overlayLayer);

        // Force-enable required engine features
        config.enableFeatures.forEach((feature) => {
            (this._symbolEngine as any)?.updateSetting?.(['features', feature], true);
        });

        this._emitEvent('plan-activated', { type, config, activePlan, placementArea: area });
        console.info(`[PlanEngine] Activated: ${config.label}`);
    }

    /** Deactivate a plan. Pass keepLayers=false to fully remove from map. */
    public deactivatePlan(type: PlanType, keepLayers = true): void {
        const plan = this._activePlans.get(type);
        if (!plan) return;

        if (keepLayers) {
            plan.overlayLayer.visible = false;
            plan.symbolLayer.visible = false;
            plan.annotationLayer.visible = false;
        } else {
            this._view?.map.removeMany([plan.overlayLayer, plan.symbolLayer, plan.annotationLayer]);
            this._activePlans.delete(type);
        }

        if (this._focusPlan === type) {
            const remaining = [...this._activePlans.keys()].filter((t) => t !== type);
            this._focusPlan = remaining[0] ?? null;
        }

        this._emitEvent('plan-deactivated', { type });
    }

    public setFocusPlan(type: PlanType): void {
        if (!this._activePlans.has(type)) return;
        this._focusPlan = type;
        this._emitEvent('plan-focus-changed', { type });
    }

    // ── Opacity / visibility ───────────────────────────────────────────────────

    public setPlanOpacity(type: PlanType, opacity: number): void {
        const plan = this._activePlans.get(type);
        if (!plan) return;
        plan.opacity = Math.max(0, Math.min(1, opacity));
        plan.overlayLayer.opacity = plan.opacity;
        plan.symbolLayer.opacity = plan.opacity;
        plan.annotationLayer.opacity = plan.opacity;
    }

    public setPlanVisible(type: PlanType, visible: boolean): void {
        const plan = this._activePlans.get(type);
        if (!plan) return;
        plan.visible = visible;
        plan.overlayLayer.visible = visible;
        plan.symbolLayer.visible = visible;
        plan.annotationLayer.visible = visible;
        this._emitEvent('plan-visibility-changed', { type, visible });
    }

    // ── Overlay management ────────────────────────────────────────────────────

    public clearPlanOverlays(type: PlanType): void {
        const plan = this._activePlans.get(type);
        if (!plan) return;
        const toRemove = plan.overlayLayer.graphics
            .toArray()
            .filter((g) => g.attributes?.templateId);
        plan.overlayLayer.removeMany(toRemove);
    }

    /**
     * Re-seed overlays for a plan at a new or updated PlacementArea.
     * Call after the user re-defines the area of interest.
     */
    public async reseedOverlays(type: PlanType, newArea?: PlacementArea): Promise<void> {
        this.clearPlanOverlays(type);
        const plan = this._activePlans.get(type);
        if (!plan || !this._view) return;

        const area = newArea ?? plan.placementArea;
        if (newArea) plan.placementArea = newArea;

        const resolved = this._resolveDimensions(area, plan.template.defaults);
        await this._placeTemplate(plan.template, resolved, area, plan.overlayLayer);
    }

    // ── Template loading ───────────────────────────────────────────────────────

    /**
     * Load a plan/exercise template from a JSON file path.
     * Uses fetch() in browser context; adapt for Node/test contexts.
     */
    private async _loadTemplate(path: string): Promise<PlanTemplate> {
        // TODO: implement fetch / require based on runtime context
        const response = await fetch(`/${path}`);
        if (!response.ok) {
            throw new Error(`[PlanEngine] Failed to load template: ${path} (${response.status})`);
        }
        return response.json() as Promise<PlanTemplate>;
    }

    // ── Template placement ─────────────────────────────────────────────────────

    /**
     * Resolve effective frontage/depth in km from a PlacementArea and template defaults.
     * Priority: explicit frontage/depth → expandRatio × defaults → defaults as-is.
     */
    private _resolveDimensions(
        area: PlacementArea,
        defaults: TemplateDefaults,
    ): { frontageKm: number; depthKm: number } {
        const toKm = (v: number, units: PlacementArea['units']): number => {
            switch (units) {
                case 'meters':         return v / 1000;
                case 'miles':          return v * 1.60934;
                case 'nautical-miles': return v * 1.852;
                default:               return v; // kilometers
            }
        };

        if (area.frontage !== undefined && area.depth !== undefined) {
            return {
                frontageKm: toKm(area.frontage, area.units),
                depthKm:    toKm(area.depth,    area.units),
            };
        }

        const ratio = area.expandRatio ?? 1.0;
        return {
            frontageKm: defaults.frontageKm * ratio,
            depthKm:    defaults.depthKm    * ratio,
        };
    }

    /**
     * Place all symbols from a template onto targetLayer using the resolved dimensions.
     * Each symbol's ratio coordinates are transformed to geodetic WGS-84.
     */
    private async _placeTemplate(
        template: PlanTemplate,
        dims: { frontageKm: number; depthKm: number },
        area: PlacementArea,
        targetLayer: GraphicsLayer,
    ): Promise<void> {
        const graphics: Graphic[] = [];

        for (const sym of template.symbols) {
            const graphic = this._buildGraphic(sym, dims, area, template.id);
            if (graphic) graphics.push(graphic);
        }

        targetLayer.addMany(graphics);

        this._emitEvent('plan-overlays-seeded', {
            planType:     template.id,
            symbolCount:  graphics.length,
            targetLayer,
        });
    }

    /**
     * Build a single ArcGIS Graphic from a TemplateSymbol.
     * Applies ratio-to-world transform for each vertex/position.
     */
    private _buildGraphic(
        sym: TemplateSymbol,
        dims: { frontageKm: number; depthKm: number },
        area: PlacementArea,
        templateId: string,
    ): Graphic | null {
        const attrs: Record<string, any> = {
            templateId,
            symbolId:    sym.id,
            symbolKey:   sym.symbolKey,
            role:        sym.role,
            label:       sym.label ?? '',
            locked:      sym.locked ?? false,
            ...(sym.scenarioProp ?? {}),
        };

        if (sym.geoType === 'Point' || sym.geoType === 'FPoint') {
            const { longitude, latitude } = this._ratioToWorld(
                sym.position.x, sym.position.y, dims, area,
            );
            const geometry = new Point({ longitude, latitude, spatialReference: { wkid: 4326 } });
            const symbol   = this._makePointSymbol(sym.style);
            return new Graphic({ geometry, symbol, attributes: attrs });
        }

        if (sym.geoType === 'Line') {
            const coords = sym.path.map(({ x, y }) =>
                this._ratioToWorldArray(x, y, dims, area),
            );
            const geometry = new Polyline({ paths: [coords], spatialReference: { wkid: 4326 } });
            const symbol   = this._makeLineSymbol(sym.style);
            return new Graphic({ geometry, symbol, attributes: attrs });
        }

        if (sym.geoType === 'Area') {
            const rings = sym.rings.map((ring) =>
                ring.map(([x, y]) => this._ratioToWorldArray(x, y, dims, area)),
            );
            const geometry = new Polygon({ rings, spatialReference: { wkid: 4326 } });
            const symbol   = this._makeFillSymbol(sym.style);
            return new Graphic({ geometry, symbol, attributes: attrs });
        }

        return null;
    }

    // ── Coordinate transform ───────────────────────────────────────────────────

    /**
     * Convert a normalized (x, y) ratio position to geodetic (longitude, latitude).
     *
     * Coordinate system:
     *   x ∈ [−1, +1]: left (−1) to right (+1) of frontage
     *   y ∈ [−1, +1]: rear (−1) to front (+1) of depth
     *   orientation: bearing the front (+y) faces, clockwise from North
     *
     * Transform:
     *   dx_km = x × (frontageKm / 2)
     *   dy_km = y × (depthKm   / 2)
     *   θ     = orientationDeg × π / 180
     *   ΔNorth = dy_km × cos(θ) − dx_km × sin(θ)
     *   ΔEast  = dy_km × sin(θ) + dx_km × cos(θ)
     *   Δlat   = ΔNorth / 111.32
     *   Δlon   = ΔEast  / (111.32 × cos(lat × π / 180))
     */
    private _ratioToWorld(
        x: number, y: number,
        dims: { frontageKm: number; depthKm: number },
        area: PlacementArea,
    ): { longitude: number; latitude: number } {
        // TODO: implement using formula above
        const dx_km   = x * (dims.frontageKm / 2);
        const dy_km   = y * (dims.depthKm   / 2);
        const theta   = (area.orientationDeg ?? 0) * Math.PI / 180;
        const dNorth  = dy_km * Math.cos(theta) - dx_km * Math.sin(theta);
        const dEast   = dy_km * Math.sin(theta) + dx_km * Math.cos(theta);
        const latRad  = area.center.latitude * Math.PI / 180;
        const dLat    = dNorth / 111.32;
        const dLon    = dEast  / (111.32 * Math.cos(latRad));
        return {
            longitude: area.center.longitude + dLon,
            latitude:  area.center.latitude  + dLat,
        };
    }

    private _ratioToWorldArray(
        x: number, y: number,
        dims: { frontageKm: number; depthKm: number },
        area: PlacementArea,
    ): [number, number] {
        const { longitude, latitude } = this._ratioToWorld(x, y, dims, area);
        return [longitude, latitude];
    }

    // ── Symbol constructors ────────────────────────────────────────────────────

    private _makeLineSymbol(style?: TemplateStyle): SimpleLineSymbol {
        return new SimpleLineSymbol({
            color: new Color([...(style?.color ?? [80, 80, 80]), 1]),
            width: style?.width ?? 2,
            style: (style?.lineStyle ?? 'solid') as any,
        });
    }

    private _makeFillSymbol(style?: TemplateStyle): SimpleFillSymbol {
        const fc = style?.fillColor ?? [100, 100, 100];
        const oc = style?.outlineColor ?? fc;
        return new SimpleFillSymbol({
            color: new Color([...fc, style?.fillOpacity ?? 0.15]),
            outline: new SimpleLineSymbol({
                color: new Color([...oc, 0.8]),
                width: style?.outlineWidth ?? 1.5,
            }),
        });
    }

    private _makePointSymbol(style?: TemplateStyle): SimpleMarkerSymbol {
        return new SimpleMarkerSymbol({
            size:    style?.size ?? 16,
            color:   new Color([...(style?.fillColor ?? [80, 80, 200]), 1]),
            outline: new SimpleLineSymbol({ color: new Color([255, 255, 255, 1]), width: 1 }),
        });
    }

    // ── Echelon / zoom visibility ─────────────────────────────────────────────

    private readonly _echelonZoomThresholds = {
        brigade:  { min: 0,  max: 10 },
        battalion:{ min: 10, max: 12 },
        company:  { min: 12, max: 14 },
        platoon:  { min: 14, max: 99 },
    };

    private _wireZoomWatcher(): void {
        if (!this._view) return;
        this._zoomHandle = reactiveUtils.watch(
            () => this._view?.zoom,
            (zoom: number) => this._applyEchelonVisibility(zoom),
        );
    }

    private _applyEchelonVisibility(zoom: number): void {
        let echelon: string;
        if      (zoom < 10) echelon = 'brigade';
        else if (zoom < 12) echelon = 'battalion';
        else if (zoom < 14) echelon = 'company';
        else                echelon = 'platoon';
        this._emitEvent('echelon-visibility-changed', { zoom, echelon });
    }

    // ── Symbol routing (labels, plan layer assignment) ────────────────────────

    private _onSymbolCreated(detail: { graphic: Graphic; id: string; drawEssentials: any }): void {
        if (!this._focusPlan) return;
        const plan = this._activePlans.get(this._focusPlan);
        if (!plan) return;

        const { graphic, id, drawEssentials } = detail;

        // Move graphic from default layer to plan symbol layer
        const defaultLayer = (this._layerManager as any)?.getSymbolLayer?.();
        if (defaultLayer?.graphics?.includes(graphic)) {
            defaultLayer.remove(graphic);
            plan.symbolLayer.add(graphic);
        }

        // Tag graphic with plan metadata
        if (graphic.attributes) {
            graphic.attributes.planType  = this._focusPlan;
            graphic.attributes.planColor = plan.config.accentColor;
        }

        // Re-annotate with plan label colour
        if (drawEssentials?.AMPLIFIER && this._layerManager) {
            const [r, g, b] = plan.config.accentColor;
            AnnotationEngine.deAnnotate(plan.annotationLayer, id);
            AnnotationEngine.annotate(
                plan.annotationLayer,
                graphic.geometry,
                drawEssentials.AMPLIFIER,
                drawEssentials,
                id,
                10,
                drawEssentials.ISFHAND || 0,
                { textColor: [r, g, b] },
                {},
            );
        }
    }

    // ── Accessors ─────────────────────────────────────────────────────────────

    public get activePlans(): ActivePlan[] { return [...this._activePlans.values()]; }
    public get focusPlan(): PlanType | null { return this._focusPlan; }
    public getPlan(type: PlanType): ActivePlan | undefined { return this._activePlans.get(type); }
    public get availableTypes(): PlanType[] { return [...this._configs.keys()]; }

    public get focusPlanSidcPrefixes(): string[] {
        if (!this._focusPlan) return [];
        return this._configs.get(this._focusPlan)?.prioritySidcPrefixes ?? [];
    }

    // ── GeoJSON export ────────────────────────────────────────────────────────

    public exportPlan(type: PlanType): any {
        const plan = this._activePlans.get(type);
        if (!plan) return null;

        const features: any[] = [];
        const exportLayer = (layer: GraphicsLayer, role: string) => {
            layer.graphics.forEach((g) => {
                const geom = g.geometry;
                if (!geom) return;
                let geoGeom: any = null;
                if (geom.type === 'point') {
                    geoGeom = { type: 'Point', coordinates: [(geom as Point).longitude, (geom as Point).latitude] };
                } else if (geom.type === 'polyline') {
                    geoGeom = { type: 'MultiLineString', coordinates: (geom as Polyline).paths };
                } else if (geom.type === 'polygon') {
                    geoGeom = { type: 'Polygon', coordinates: (geom as Polygon).rings };
                }
                if (!geoGeom) return;
                features.push({ type: 'Feature', geometry: geoGeom, properties: { pams8: true, planType: type, role, ...g.attributes } });
            });
        };

        exportLayer(plan.overlayLayer, 'overlay');
        exportLayer(plan.symbolLayer,  'symbol');
        return { type: 'FeatureCollection', features };
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private _emitEvent(name: string, detail: any): void {
        document.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, cancelable: false }));
    }
}

export default PlanEngine;
