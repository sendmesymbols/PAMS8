import type { Point } from '@arcgis/core/geometry';
import type { SimpleMarkerSymbol, PictureMarkerSymbol } from '@arcgis/core/symbols';
import type Graphic from "@arcgis/core/Graphic";

export interface SIDC {
    schema: string;
    identity: string;
    battleDimension: string;
    status: string;
    functionId: string;
    modifier: string;
    echelon: string;
    mobility: string;
}

export interface SymbolDescriptor {
    parameterized: string;
    sidc: string;
    hierarchy: string[];
    scope: 'UNIT' | 'INSTALLATION' | 'EQUIPMENT' | 'ACTIVITY' | 'SKKM';
    dimensions: string[];
    geometry: {
        type: 'Point' | 'LineString' | 'Polygon';
        layout?: 'rectangle' | 'circle' | 'corridor';
    };
    class?: string;
}

export interface SymbolOptions {
    sidc: string;
    size?: number;
    quantity?: string;
    reinforcedReduced?: string;
    staffComments?: string;
    additionalInformation?: string;
    type?: string;
    dtg?: string;
    location?: string;
    outlineColor?: string;
    outlineWidth?: number;
    schema?: string;
    identity?: string;
    battleDimension?: string;
    status?: string;
    modifier?: string;
    echelon?: string;
    mobility?: string;
}

export interface SymbolResult {
    graphic: Graphic;
    symbol: SimpleMarkerSymbol | PictureMarkerSymbol;
    geometry: Point;
}
