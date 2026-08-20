
import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import PictureMarkerSymbol from "@arcgis/core/symbols/PictureMarkerSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";
import SymbolEvents from "../Support/SymbolEvents";
import '../ThirdParty/MilSymbols/milsymbol.d.ts';

declare const ms: any;

export interface UEISymbolOptions {
    SIDC?: string;
    GEOM?: Point;
    ANGLE?: number;
    SIZE?: number;
    AMPLIFIER?: Amplifier;
    [key: string]: any;
}

interface MilSymbolMarker {
    asCanvas: () => HTMLCanvasElement;
    height: number;
    width: number;
    markerAnchor?: { x: number; y: number };
}

const AMPLIFIER_FIELDS = [
    'uniqueDesignation', 'quantity', 'reinforcedReduced', 'staffComments',
    'additionalInformation', 'evaluationRating', 'combatEffectiveness',
    'signatureEquipment', 'higherFormation', 'hostile', 'iffSif',
    'direction', 'sigint', 'type', 'dtg', 'altitudeDepth', 'location',
    'speed', 'specialHeadquarters', 'platformType', 'equipmentTeardownTime',
    'commonIdentifier', 'auxiliaryEquipmentIndicator',
] as const;

export class UEISymbol {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;

    private SIC: string = "000000";
    private symName: string = "UEISymbol";
    private symGeometricType: string = "FPoint";
    private _ueiData: MilSymbolMarker | null = null;
    private _ptSymbol: PictureMarkerSymbol | null = null;
    private _options: any = null;
    private _sidc: string = "";

    private isDrawing: boolean = false;
    private tempGraphic: Graphic | null = null;
    private amplifier: Amplifier;
    private events: SymbolEvents;

    private mouseMoveHandler: { remove(): void } | null = null;
    private clickHandler: { remove(): void } | null = null;

    constructor(view: MapView | SceneView) {
        this.view = view;
        this.layerManager = GraphicsLayerManager.getInstance(view);
        this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.FORCE);
        this.amplifier = new Amplifier();
        this.events = new SymbolEvents(view, "UEISymbol");
        this.setupEventHandlers();
    }

    public init(options: any, marker?: any, sic?: string, symName?: string, offset?: string, sidc?: string): void {
        if (sic) this.SIC = sic;
        if (symName) this.symName = symName;
        if (sidc) this._sidc = sidc;
        this._options = options;

        const opts = options.OPTIONS || options;
        const amplifiers = Object.fromEntries(AMPLIFIER_FIELDS.map(f => [f, opts[f] || '']));
        // Size can arrive two ways: on the runtime drawEssentials (extraSettings.size,
        // what the editor / global resize write) or inside the milsymbol OPTIONS
        // (OPTIONS.size — the canonical plan format, see AttackPlan.json). Honour
        // whichever is present so a plan-loaded symbol renders at its stored size
        // instead of snapping back to 35.
        const milsymbolSize = Number(options.extraSettings?.size) || Number(opts.size) || 35;
        const milsymbolOptions = { size: milsymbolSize, ...amplifiers };

        this._ueiData = new (window as any).MS.symbol(sidc, milsymbolOptions).getMarker() as MilSymbolMarker;

        const height = this._ueiData.height || 35;
        const width  = this._ueiData.width  || 35;
        const anchor = this._ueiData.markerAnchor ?? { x: width / 2, y: height / 2 };

        this._ptSymbol = new PictureMarkerSymbol({
            url: this._ueiData.asCanvas().toDataURL(),
            width:   width  + "px",
            height:  height + "px",
            xoffset: `${(width  / 2) - anchor.x}px`,
            yoffset: `${anchor.y - (height / 2)}px`,
        });

        if (Object.prototype.hasOwnProperty.call(options, "ANGLE")) {
            this._ptSymbol.angle = options.ANGLE;
        }

        if (options.GEOM) {
            this.placeSymbolImmediately(options.GEOM.clone(), options);
        } else {
            this.startInteractiveDrawing();
        }
    }

    private placeSymbolImmediately(geometry: Point, options: UEISymbolOptions): void {
        if (!this._ptSymbol) return;
        this.emitDrawEnd(geometry, this._ptSymbol, this.createDrawEssentials(geometry, options));
        // GEOM path (plan load / paste / Morphix re-render) never armed interactive
        // drawing, so it otherwise leaks the constructor handlers — release them.
        this.cleanUp();
    }

    private startInteractiveDrawing(): void {
        if (!this._ptSymbol) return;
        this.isDrawing = true;
        const center = this.view.center;
        if (center) {
            this.tempGraphic = new Graphic({ geometry: center, symbol: this._ptSymbol });
            this.symbolLayer.add(this.tempGraphic);
        }
    }

    private setupEventHandlers(): void {
        this.mouseMoveHandler = this.view.on("pointer-move", (event) => {
            if (!this.isDrawing || !this.tempGraphic) return;
            const mapPoint = this.view.toMap(event);
            if (mapPoint) {
                this.tempGraphic.geometry = mapPoint;
                this.events.emit("onDrawProgress", {
                    currentGeometry: mapPoint,
                    currentDrawEssentials: null,
                    currentMarker: this._ptSymbol,
                });
            }
        });

        this.clickHandler = this.view.on("click", (event) => {
            if (!this.isDrawing) return;
            const mapPoint = this.view.toMap(event);
            if (mapPoint) {
                this.cleanUp();
                if (this._ptSymbol) {
                    this.emitDrawEnd(mapPoint, this._ptSymbol, this.createDrawEssentials(mapPoint, this._options));
                }
            }
        });
    }

    private createDrawEssentials(geometry: Point, options: UEISymbolOptions): DrawEssentials {
        const de = new DrawEssentials();
        de.SYM_GEO_TYPE = this.symGeometricType;
        de.SID = this.SIC;
        de.SYM_NAME = this.symName;
        de.GEOM = geometry;
        de.AMPLIFIER = this.amplifier.toString();

        // The real milsymbol options. `options` is the drawEssentials handed to
        // init(); a Morphix re-render / plan load nests the milsymbol options
        // under .OPTIONS, while an interactive draw leaves the fields flat on the
        // drawEssentials. Unwrap once — otherwise we store the WHOLE drawEssentials
        // (its own nested OPTIONS, AMPLIFIER, extraSettings, ratios, SCOPE and all)
        // as de.OPTIONS, which sinks the real options a level deeper on every edit
        // and drops the flat OPTIONS.size the plan format / serializer key off.
        const srcOptions = (options as any)?.OPTIONS || options || {};

        // Marker size actually rendered (init read it from extraSettings.size or
        // OPTIONS.size). Keep it on BOTH the runtime field the editor/global
        // resize read (de.extraSettings.size) and inside the canonical OPTIONS.size
        // the plan format stores (see AttackPlan.json).
        const usedSize =
            Number((options as any)?.extraSettings?.size) || Number(srcOptions.size);

        // Store a CLEAN, flat OPTIONS object matching the plan format: the milsymbol
        // fields plus size / symType / SIDC / ANGLE / opacity / GEOM — never a
        // drawEssentials. Spreading srcOptions first preserves any extra keys it
        // carried (alphaNum, hfid, ECHELON, …); the explicit keys below then pin the
        // canonical ones to what was actually rendered.
        const cleanOptions: Record<string, any> = { ...srcOptions };
        delete cleanOptions.OPTIONS;
        delete cleanOptions.AMPLIFIER;
        delete cleanOptions.extraSettings;
        delete cleanOptions.SCOPE;
        cleanOptions.symType = 'FPoint';
        cleanOptions.SIDC = (options as any)?.SIDC || srcOptions.SIDC || this._sidc || de.SIDC;
        cleanOptions.ANGLE = (options as any)?.ANGLE ?? srcOptions.ANGLE ?? 0;
        cleanOptions.opacity = (options as any)?.opacity ?? srcOptions.opacity ?? 1;
        cleanOptions.GEOM = geometry;
        if (Number.isFinite(usedSize) && usedSize > 0) {
            cleanOptions.size = usedSize;
            de.extraSettings = { ...de.extraSettings, size: usedSize };
        }

        (de as any).OPTIONS = cleanOptions;
        (de as any).UEI = "1";
        return de;
    }

    private emitDrawEnd(geometry: Point, symbol: PictureMarkerSymbol, drawEssentials: DrawEssentials): void {
        this.events.emit("onDrawEnd", { geometry, marker: symbol, drawEssentials });
    }

    private cleanUp(): void {
        this.isDrawing = false;
        if (this.tempGraphic) {
            this.symbolLayer.remove(this.tempGraphic);
            this.tempGraphic = null;
        }
        // Drop the view listeners registered in the constructor — the engine
        // creates a fresh instance per draw, so this instance is done.
        this.removeEventHandlers();
    }

    private removeEventHandlers(): void {
        this.mouseMoveHandler?.remove();
        this.mouseMoveHandler = null;
        this.clickHandler?.remove();
        this.clickHandler = null;
    }

    public deactivate(): void {
        this.cleanUp();
        this.removeEventHandlers();
        this._ptSymbol = null;
        this._ueiData = null;
    }

    public getSymbolLayer(): GraphicsLayer {
        return this.symbolLayer;
    }

    public clearSymbols(): void {
        this.symbolLayer.removeAll();
    }
}

export default UEISymbol;
