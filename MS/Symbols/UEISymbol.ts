
import PictureMarkerSymbol from "@arcgis/core/symbols/PictureMarkerSymbol";
import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
//import WebMercatorUtils from "@arcgis/core/geometry/support/WebMercatorUtils";
import DrawEssentials from "../Support/DrawEssentials"; // Assuming this is a custom module
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";

interface UEISymbolOptions {
    ANGLE?: number;
    GEOM?: any;  // Define more specific type if necessary
}

interface Evented {
    on(type: string, listener: Function): { remove(): void };
    emit(type: string, event: any): boolean;
}

class UEISymbol implements Evented {
    SIC: string = "000000";
    symName: string = "UEISymbol";
    symGeometricType: string = "FPoint";

    private _ptSymbol: PictureMarkerSymbol | null = null;
    private _point: Point | null = null;
    private _geometryType: any = null;
    private size: any;
    private _options: UEISymbolOptions = {};
    private _ueiData: any = null;
    private _height: number = 0;
    private _width: number = 0;
    private _tGraphic: Graphic = new Graphic();
    private _onClk: any = null;
    private _onMM: any = null;
    private map: MapView | SceneView;

    constructor(map: MapView | SceneView) {
        this.map = map;
        this._tGraphic = new Graphic();  // Initialize the graphic
    }

    init(options: UEISymbolOptions, marker: any, sic: string, symName: string, offset: string, sidc: string): void {
        this._ueiData = new MS.symbol(sidc, options).getMarker();
        this._options = options;

        this.SIC = sic;
        this.symName = symName;

        this._height = this._ueiData.height;
        this._width = this._ueiData.width;

        this._ptSymbol = new PictureMarkerSymbol(this._ueiData.asImage(), this._width, this._height);

        if (options.ANGLE) {
            this._ptSymbol.setAngle(options.ANGLE);
        }

        const drawEssentials = new DrawEssentials();

        if (options.GEOM) {
            this._point = options.GEOM;
            const clonedGeom = { ...options.GEOM }; // Use object spread instead of lang.clone
            drawEssentials = this.createDrawEssentials(clonedGeom, options);
            this.__drawEnd(options.GEOM, this._ptSymbol, drawEssentials);
            this._clear();
        } else {
            this._tGraphic = new Graphic({
                geometry: this.map.extent.center, // You might want to adjust this for SceneView
                symbol: this._ptSymbol
            });
            this.map.graphics.add(this._tGraphic);

            this._onMM = this.map.on("mouse-move", (event) => this._onMMoveHdler(event));
            this._onClk = this.map.on("click", (event) => this._onClckHdler(event));
        }
    }

    createDrawEssentials(geom: any, options: UEISymbolOptions): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SIC;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.OPTIONS = options;
        drawEssentials.GEOM = geom;
        drawEssentials.AMPLIFIER = this.amplifier;  // Define amplifier or remove if unnecessary
        drawEssentials.UEI = "1";

        return drawEssentials;
    }

    private _onMMoveHdler(inputPoint: any): void {
        if (this._tGraphic) {
            this._tGraphic.geometry = inputPoint.mapPoint;
            this.emit("onDrawProgress", {
                currentGeometry: this._tGraphic.geometry,
                currentDrawEssentials: null,
                currentMarker: null
            });
        }
    }

    private _onClckHdler(clickPoint: any): void {
        this._point = clickPoint.mapPoint.offset(0, 0);
        this.cleanUp();
    }

    private cleanUp(): void {
        const drawEss = this.createDrawEssentials({ ...this._point }, this._options);
        this.__drawEnd(this._point, this._ptSymbol, drawEss);
        this._clear();
        this._removeEvents();
    }

    private __drawEnd(drawGeometry: any, symbol: any, drawEssentials: any): void {
        if (drawGeometry) {
            let geographicGeometry: any;
            const spRef = this.map.spatialReference;

            if (spRef && spRef.isWebMercator()) {
                geographicGeometry = WebMercatorUtils.webMercatorToGeographic(drawGeometry);
            } else if (spRef && spRef.wkid === 4326) {
                geographicGeometry = jsonUtility.fromJson(drawGeometry.toJson());
            }

            this.__onDrawEnd(drawGeometry, symbol, drawEssentials);
        }
    }

    private __onDrawEnd(geometry: any, symbol: any, drawEssParam: any): void {
        this.emit("onDrawEnd", {
            geometry: geometry,
            marker: symbol,
            drawEssentials: drawEssParam
        });
    }

    private _clear(): void {
        this._point = null;
        if (this._tGraphic) {
            this.map.graphics.remove(this._tGraphic);
        }
    }

    private _removeEvents(): void {
        if (this._onClk) this._onClk.remove();
        if (this._onMM) this._onMM.remove();
        this.map.enableDoubleClickZoom();
    }

    deactivate(): void {
        this._clear();
        this._removeEvents();
        this._geometryType = null;
    }

    private _onDrawComplete(event: any): void {
        // Handle draw complete event if necessary
    }
}

export default UEISymbol;
