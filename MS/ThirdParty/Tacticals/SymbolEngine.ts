import Graphic from "@arcgis/core/Graphic";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";
import PictureMarkerSymbol from "@arcgis/core/symbols/PictureMarkerSymbol";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import Color from "@arcgis/core/Color";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Polygon from "@arcgis/core/geometry/Polygon";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import SketchViewModel from "@arcgis/core/widgets/Sketch/SketchViewModel";
import type MapView from "@arcgis/core/views/MapView";
import type SceneView from "@arcgis/core/views/SceneView";

import { SIDCFormatter } from './SIDCFormatter';
import { LAYER_NAMES } from './constants';
import type { SymbolOptions, SymbolResult } from './types';
import { TacticalGraphicsEngine, type TacticalGraphicOptions } from './TacticalGraphics';

export class SymbolEngine {
    private view: MapView | SceneView;
    private layers: Map<string, GraphicsLayer>;
    private sketchVM: SketchViewModel | null;
    private symbolCache: Map<string, PictureMarkerSymbol>;

    constructor(view: MapView | SceneView) {
        this.view = view;
        this.layers = new Map();
        this.sketchVM = null;
        this.symbolCache = new Map();
        this.initializeLayers();
    }

    private initializeLayers(): void {
        // Create force layer
        const forceLayer = new GraphicsLayer({
            id: LAYER_NAMES.FORCE,
            title: "Force Layer"
        });
        this.view.map.add(forceLayer);
        this.layers.set(LAYER_NAMES.FORCE, forceLayer);

        // Create milsymbols layer
        const milSymbolsLayer = new GraphicsLayer({
            id: LAYER_NAMES.MILSYMBOLS,
            title: "Military Symbols"
        });
        this.view.map.add(milSymbolsLayer);
        this.layers.set(LAYER_NAMES.MILSYMBOLS, milSymbolsLayer);

        // Create tactical graphics layer
        const tacticalLayer = new GraphicsLayer({
            id: LAYER_NAMES.TACTICAL,
            title: "Tactical Graphics"
        });
        this.view.map.add(tacticalLayer);
        this.layers.set(LAYER_NAMES.TACTICAL, tacticalLayer);
    }

    private getLayer(name: string): GraphicsLayer {
        const layer = this.layers.get(name);
        if (!layer) {
            throw new Error(`Layer ${name} not found`);
        }
        return layer;
    }

    public async drawMilSymbolInteractively(options: SymbolOptions): Promise<void> {
        if (!this.sketchVM) {
            this.sketchVM = new SketchViewModel({
                view: this.view,
                layer: this.getLayer(LAYER_NAMES.MILSYMBOLS),
                pointSymbol: this.createDefaultPointSymbol()
            });
        }

        return new Promise((resolve, reject) => {
            this.sketchVM!.create("point");
            
            const handler = this.sketchVM!.on("create", (event) => {
                if (event.state === "complete") {
                    const point = event.graphic.geometry as Point;
                    try {
                        this.addMilSymbolAtPoint(point, options);
                        handler.remove();
                        resolve();
                    } catch (error) {
                        handler.remove();
                        reject(error);
                    }
                }
            });
        });
    }

    public addMilSymbolAtPoint(point: Point, options: SymbolOptions): SymbolResult {
        const layer = this.getLayer(LAYER_NAMES.MILSYMBOLS);
        const symbol = this.generateMilitarySymbol(options);
        
        const graphic = new Graphic({
            geometry: point,
            symbol: symbol
        });
        
        layer.add(graphic);

        return {
            graphic,
            symbol,
            geometry: point
        };
    }

    private generateMilitarySymbol(options: SymbolOptions): SimpleMarkerSymbol | PictureMarkerSymbol {
        const sidc = SIDCFormatter.format(options.sidc, options);
        const cacheKey = this.createSymbolCacheKey(options);
        
        // Check cache first
        const cachedSymbol = this.symbolCache.get(cacheKey);
        if (cachedSymbol) {
            return cachedSymbol;
        }

        // Create default marker if no SIDC
        if (!sidc) {
            return this.createDefaultPointSymbol(options.outlineColor);
        }

        // Generate military symbol
        try {
            const symbol = this.createMilitarySymbol(sidc, options);
            this.symbolCache.set(cacheKey, symbol);
            return symbol;
        } catch (error) {
            console.error('Error generating military symbol:', error);
            return this.createDefaultPointSymbol(options.outlineColor);
        }
    }

    private createDefaultPointSymbol(color: string = "#FF0000"): SimpleMarkerSymbol {
        return new SimpleMarkerSymbol({
            color: new Color(color),
            size: 10,
            outline: {
                color: new Color("#000000"),
                width: 1
            }
        });
    }

    private createMilitarySymbol(sidc: string, options: SymbolOptions): PictureMarkerSymbol {
        // This is where you would integrate with your military symbol generation library
        // For now, we'll create a basic symbol
        return new PictureMarkerSymbol({
            url: this.generateSymbolURL(sidc),
            width: options.size || 32,
            height: options.size || 32
        });
    }

    private generateSymbolURL(sidc: string): string {
        // Implement your symbol generation logic here
        // This should return a data URL or path to the symbol image
        return `data:image/svg+xml,${encodeURIComponent('<svg>...</svg>')}`;
    }

    private createSymbolCacheKey(options: SymbolOptions): string {
        return JSON.stringify({
            sidc: options.sidc,
            size: options.size,
            outlineColor: options.outlineColor,
            outlineWidth: options.outlineWidth
        });
    }

    public async drawTacticalGraphic(options: TacticalGraphicOptions): Promise<void> {
        if (!this.sketchVM) {
            this.sketchVM = new SketchViewModel({
                view: this.view,
                layer: this.getLayer(LAYER_NAMES.TACTICAL),
                pointSymbol: this.createDefaultPointSymbol()
            });
        }

        return new Promise((resolve, reject) => {
            const geometryType = options.type === 'AMBUSH' ? 'point' : 'polyline';
            this.sketchVM!.create(geometryType);

            const handler = this.sketchVM!.on("create", (event) => {
                if (event.state === "complete") {
                    try {
                        this.addTacticalGraphic(event.graphic.geometry as any, options);
                        handler.remove();
                        resolve();
                    } catch (error) {
                        handler.remove();
                        reject(error);
                    }
                }
            });
        });
    }

    public addTacticalGraphic(geometry: Point | Polyline | Polygon, options: TacticalGraphicOptions): Graphic {
        const layer = this.getLayer(LAYER_NAMES.TACTICAL);
        let symbol;
        let graphic;

        switch (options.type) {
            case 'ATTACK':
                symbol = TacticalGraphicsEngine.createAttackSymbol(options.width);
                graphic = new Graphic({
                    geometry: TacticalGraphicsEngine.createAttackArrow(options.points),
                    symbol
                });
                break;

            case 'AMBUSH':
                symbol = TacticalGraphicsEngine.createAmbushSymbol(geometry as Point, options.width);
                graphic = new Graphic({
                    geometry,
                    symbol
                });
                break;

            case 'AXIS_OF_ADVANCE':
                symbol = TacticalGraphicsEngine.createAttackSymbol(options.width);
                graphic = new Graphic({
                    geometry: TacticalGraphicsEngine.createAxisOfAdvance(options.points),
                    symbol
                });
                break;

            default:
                throw new Error(`Unsupported tactical graphic type: ${options.type}`);
        }

        layer.add(graphic);
        return graphic;
    }

    public destroy(): void {
        if (this.sketchVM) {
            this.sketchVM.destroy();
        }
        this.layers.forEach(layer => {
            this.view.map.remove(layer);
        });
        this.layers.clear();
        this.symbolCache.clear();
    }
}
