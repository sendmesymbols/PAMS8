import Accessor from "@arcgis/core/core/Accessor";
import { property, subclass } from "@arcgis/core/core/accessorSupport/decorators";
import PictureMarkerSymbol from "@arcgis/core/symbols/PictureMarkerSymbol";
import Point from "@arcgis/core/geometry/Point";
import Graphic from "@arcgis/core/Graphic";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import { whenFalse } from "@arcgis/core/core/watchUtils";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
import * as projection from "@arcgis/core/geometry/projection";
import * as webMercatorUtils from "@arcgis/core/geometry/support/webMercatorUtils";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";

// Declare MS as a global variable (assuming milsymbol library is loaded)
declare const MS: any;

type ViewType = MapView | SceneView;

interface UEIOptions {
    GEOM?: Point;
    ANGLE?: number;
    [key: string]: any;
}

interface UEIMarkerData {
    height: number;
    width: number;
    asImage(): string;
}

interface DrawEndEventData {
    geometry: Point;
    marker: PictureMarkerSymbol;
    drawEssentials: DrawEssentials;
}

interface DrawProgressEventData {
    currentGeometry: Point;
    currentDrawEssentials: DrawEssentials | null;
    currentMarker: PictureMarkerSymbol | null;
}

@subclass("UEISymbol")
export default class UEISymbol extends Accessor {
    @property()
    public SIC: string = "000000";

    @property()
    public symName: string = "UEISymbol";

    @property()
    public symGeometricType: string = "FPoint";

    @property()
    public amplifier: Amplifier;

    private view: ViewType;
    private _ptSymbol: PictureMarkerSymbol | null = null;
    private _point: Point | null = null;
    private _geometryType: string | null = null;
    private size: number = 0;
    private _options: UEIOptions = {};
    private _tGraphic: Graphic | null = null;
    private _height: number = 0;
    private _width: number = 0;
    private _ueiData: UEIMarkerData | null = null;
    private _isDrawing: boolean = false;
    private _clickHandler: IHandle | null = null;
    private _pointerMoveHandler: IHandle | null = null;

    constructor(view: ViewType, isLine?: boolean) {
        super();
        this.view = view;
    }

    public init(options: UEIOptions, marker: any, sic: string, symName: string, offset: string, sidc: string): void {
        try {
            // Create UEI symbol using milsymbol library
            this._ueiData = new MS.symbol(sidc, options).getMarker();
            this._options = options;
            this.SIC = sic;
            this.symName = symName;
            this._height = this._ueiData.height;
            this._width = this._ueiData.width;

            // Create picture marker symbol
            this._ptSymbol = new PictureMarkerSymbol({
                url: this._ueiData.asImage(),
                width: this._width,
                height: this._height
            });

            // Set angle if provided
            if (options.ANGLE !== undefined) {
                this._ptSymbol.angle = options.ANGLE;
            }

            if (options.GEOM) {
                // Direct placement mode
                this._point = options.GEOM;
                const drawEssentials = this.createDrawEssentials(this._point.clone(), options);
                this._drawEnd(options.GEOM, this._ptSymbol, drawEssentials);
                this._clear();
            } else {
                // Interactive drawing mode
                this._startDrawing();
            }
        } catch (error) {
            console.error("Error initializing UEI Symbol:", error);
        }
    }

    private _startDrawing(): void {
        if (!this._ptSymbol) return;

        this._isDrawing = true;

        // Create temporary graphic at center of view
        const centerPoint = this.view.extent ? this.view.extent.center : new Point({ x: 0, y: 0 });
        this._tGraphic = new Graphic({
            geometry: centerPoint,
            symbol: this._ptSymbol
        });

        // Add to view graphics
        this.view.graphics.add(this._tGraphic);

        // Set up event handlers
        this._setupEventHandlers();
    }

    private _setupEventHandlers(): void {
        // Handle pointer move
        this._pointerMoveHandler = this.view.on("pointer-move", (event) => {
            if (this._isDrawing && this._tGraphic) {
                const point = this.view.toMap({ x: event.x, y: event.y });
                if (point) {
                    this._tGraphic.geometry = point;
                    this.emit("onDrawProgress", {
                        currentGeometry: point,
                        currentDrawEssentials: null,
                        currentMarker: null
                    } as DrawProgressEventData);
                }
            }
        });

        // Handle click
        this._clickHandler = this.view.on("click", (event) => {
            if (this._isDrawing) {
                const point = this.view.toMap({ x: event.x, y: event.y });
                if (point) {
                    this._point = point;
                    this.cleanUp();
                }
            }
        });
    }

    private createDrawEssentials(geom: Point, options: UEIOptions): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SIC;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.OPTIONS = options;
        drawEssentials.GEOM = geom;
        drawEssentials.AMPLIFIER = this.amplifier;
        drawEssentials.UEI = "1";
        return drawEssentials;
    }

    private cleanUp(): void {
        if (this._point && this._ptSymbol) {
            const drawEss = this.createDrawEssentials(this._point.clone(), this._options);
            this._drawEnd(this._point, this._ptSymbol, drawEss);
        }
        this._clear();
        this._removeEvents();
    }

    private _drawEnd(drawGeometry: Point, symbol: PictureMarkerSymbol, drawEssentials: DrawEssentials): void {
        if (drawGeometry) {
            let geographicGeometry: Point = drawGeometry;

            // Handle spatial reference conversion
            const spatialRef = this.view.spatialReference;
            if (spatialRef && spatialRef.isWebMercator) {
                geographicGeometry = webMercatorUtils.webMercatorToGeographic(drawGeometry) as Point;
            } else if (spatialRef && spatialRef.wkid === 4326) {
                geographicGeometry = drawGeometry.clone();
            }

            this._onDrawEnd(drawGeometry, symbol, drawEssentials);
        }
    }

    private _onDrawEnd(geometry: Point, symbol: PictureMarkerSymbol, drawEssParam: DrawEssentials): void {
        this.emit("onDrawEnd", {
            geometry: geometry,
            marker: symbol,
            drawEssentials: drawEssParam
        } as DrawEndEventData);
    }

    private _clear(): void {
        if (this._tGraphic) {
            this.view.graphics.remove(this._tGraphic);
            this._tGraphic = null;
        }
        this._isDrawing = false;
    }

    private _removeEvents(): void {
        if (this._clickHandler) {
            this._clickHandler.remove();
            this._clickHandler = null;
        }
        if (this._pointerMoveHandler) {
            this._pointerMoveHandler.remove();
            this._pointerMoveHandler = null;
        }
    }

    public deactivate(): void {
        this._clear();
        this._removeEvents();
        this._geometryType = null;
        this._isDrawing = false;
    }

    // Event emitter methods (to be implemented by extending class or using event system)
    public emit(eventName: string, data: any): void {
        // Implementation depends on your event system
        // This could dispatch custom events or call registered callbacks
        console.log(`Event emitted: ${eventName}`, data);
    }

    public on(eventName: string, callback: (data: any) => void): { remove: () => void } {
        // Implementation depends on your event system
        // This would register event listeners
        return {
            remove: () => {
                // Remove event listener
            }
        };
    }
}