export function destinationPoint(lon: any, lat: any, bearingDeg: any, distM: any): {
    longitude: number;
    latitude: number;
};
export function createBufferEngine({ geometryEngine, Point, Polyline, Polygon, Graphic }: {
    geometryEngine: any;
    Point: any;
    Polyline: any;
    Polygon: any;
    Graphic: any;
}): {
    computeRings: (sourcePoint: any, ringDefs: any, { asDonut }?: {
        asDonut?: boolean | undefined;
    }) => any[];
    computeUnionRings: (sourcePoints: any, ringDefs: any) => {
        radiusM: number;
        label: any;
        colorKey: any;
        geometry: any;
    }[];
    computeContestedZone: (ringsA: any, ringsB: any) => any;
    computeCorridorBuffer: (polyline: any, widthM: any, { standoffM }?: {
        standoffM?: number | undefined;
    }) => {
        corridor: any;
        standoff: any;
    };
    buildRingGraphics2D: (rings: any, labelOpts?: {}) => any;
    buildRingGraphics3D: (rings: any, { extrudeHeightM, usePattern }?: {
        extrudeHeightM?: number | undefined;
        usePattern?: boolean | undefined;
    }) => any;
    buildContestedGraphic: (contestedGeom: any) => any;
    buildCorridorGraphics: (corridorGeom: any, standoffGeom: any) => any[];
    buildLabelGraphics: (sourcePoint: any, rings: any) => any;
};
export namespace THREAT_PRESETS {
    namespace artillery_155mm {
        let label: string;
        let rings: {
            label: string;
            radiusM: number;
            colorKey: string;
        }[];
    }
    namespace mortar_81mm {
        let label_1: string;
        export { label_1 as label };
        let rings_1: {
            label: string;
            radiusM: number;
            colorKey: string;
        }[];
        export { rings_1 as rings };
    }
    namespace atgm {
        let label_2: string;
        export { label_2 as label };
        let rings_2: {
            label: string;
            radiusM: number;
            colorKey: string;
        }[];
        export { rings_2 as rings };
    }
    namespace ied_vbied {
        let label_3: string;
        export { label_3 as label };
        let rings_3: {
            label: string;
            radiusM: number;
            colorKey: string;
        }[];
        export { rings_3 as rings };
    }
    namespace nbc_release {
        let label_4: string;
        export { label_4 as label };
        let rings_4: {
            label: string;
            radiusM: number;
            colorKey: string;
        }[];
        export { rings_4 as rings };
    }
    namespace observation_post {
        let label_5: string;
        export { label_5 as label };
        let rings_5: {
            label: string;
            radiusM: number;
            colorKey: string;
        }[];
        export { rings_5 as rings };
    }
    namespace custom {
        let label_6: string;
        export { label_6 as label };
        let rings_6: {
            label: string;
            radiusM: number;
            colorKey: string;
        }[];
        export { rings_6 as rings };
    }
}
export namespace RING_COLORS {
    namespace lethal {
        export let fill: number[];
        export let outline: number[];
        let label_7: string;
        export { label_7 as label };
    }
    namespace warning {
        let fill_1: number[];
        export { fill_1 as fill };
        let outline_1: number[];
        export { outline_1 as outline };
        let label_8: string;
        export { label_8 as label };
    }
    namespace safe {
        let fill_2: number[];
        export { fill_2 as fill };
        let outline_2: number[];
        export { outline_2 as outline };
        let label_9: string;
        export { label_9 as label };
    }
    namespace info {
        let fill_3: number[];
        export { fill_3 as fill };
        let outline_3: number[];
        export { outline_3 as outline };
        let label_10: string;
        export { label_10 as label };
    }
    namespace dead {
        let fill_4: number[];
        export { fill_4 as fill };
        let outline_4: number[];
        export { outline_4 as outline };
        let label_11: string;
        export { label_11 as label };
    }
    namespace exclusion {
        let fill_5: number[];
        export { fill_5 as fill };
        let outline_5: number[];
        export { outline_5 as outline };
        let label_12: string;
        export { label_12 as label };
    }
}
