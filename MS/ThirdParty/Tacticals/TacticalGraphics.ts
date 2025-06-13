import Polyline from "@arcgis/core/geometry/Polyline";
import Polygon from "@arcgis/core/geometry/Polygon";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import Color from "@arcgis/core/Color";
import type { Point } from "@arcgis/core/geometry";

export interface TacticalGraphicOptions {
    type: 'ATTACK' | 'AMBUSH' | 'DIRECTION_OF_ATTACK' | 'AXIS_OF_ADVANCE';
    points: Point[];
    color?: string;
    size?: number;
    width?: number;
}

export class TacticalGraphicsEngine {
    static createAttackArrow(points: Point[]): Polyline {
        if (points.length < 2) {
            throw new Error('Attack arrow requires at least 2 points');
        }

        const polyline = new Polyline({
            paths: [points.map(p => [p.longitude, p.latitude])],
            spatialReference: points[0].spatialReference
        });

        return polyline;
    }

    static createAmbushSymbol(location: Point, width: number = 30): SimpleFillSymbol {
        return new SimpleFillSymbol({
            color: new Color([255, 0, 0, 0.5]),
            outline: new SimpleLineSymbol({
                color: new Color("red"),
                width: 2
            }),
            style: "solid"
        });
    }

    static createAttackSymbol(width: number = 2): SimpleLineSymbol {
        return new SimpleLineSymbol({
            color: new Color("red"),
            width: width,
            style: "solid"
        });
    }

    static createAxisOfAdvance(points: Point[]): Polyline {
        if (points.length < 2) {
            throw new Error('Axis of advance requires at least 2 points');
        }

        const polyline = new Polyline({
            paths: [points.map(p => [p.longitude, p.latitude])],
            spatialReference: points[0].spatialReference
        });

        return polyline;
    }

    // SIDC helpers for tactical graphics
    static readonly SIDC = {
        ATTACK: "G*G*OLKA--****X",  // Offensive Line, Attack
        AMBUSH: "G*G*OLP---****X",  // Offensive Line, Ambush
        DIRECTION_OF_ATTACK: "G*G*OLKGM-****X", // Direction of Attack
        AXIS_OF_ADVANCE: "G*G*OLK---****X"  // Axis of Advance
    };
}
