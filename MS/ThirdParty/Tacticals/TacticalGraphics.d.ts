import Polyline from "@arcgis/core/geometry/Polyline";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import type { Point } from "@arcgis/core/geometry";
export interface TacticalGraphicOptions {
    type: 'ATTACK' | 'AMBUSH' | 'DIRECTION_OF_ATTACK' | 'AXIS_OF_ADVANCE';
    points: Point[];
    color?: string;
    size?: number;
    width?: number;
}
export declare class TacticalGraphicsEngine {
    static createAttackArrow(points: Point[]): Polyline;
    static createAmbushSymbol(location: Point, width?: number): SimpleFillSymbol;
    static createAttackSymbol(width?: number): SimpleLineSymbol;
    static createAxisOfAdvance(points: Point[]): Polyline;
    static readonly SIDC: {
        ATTACK: string;
        AMBUSH: string;
        DIRECTION_OF_ATTACK: string;
        AXIS_OF_ADVANCE: string;
    };
}
