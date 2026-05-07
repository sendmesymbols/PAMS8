export function destinationPoint(originLon: any, originLat: any, bearingDeg: any, distanceM: any): {
    longitude: number;
    latitude: number;
};
export function createWEZEngine({ Point, Polygon, geometryEngine }: {
    Point: any;
    Polygon: any;
    geometryEngine: any;
}): {
    compute: (params: any) => {
        zone: any;
        minRing: any;
        maxRing: any;
        wedge: any;
        extrudeHeightM: number;
        preset: any;
    };
    computeTerrainMask: (view: any, observerPoint: any, maxRangeM: any, { numRays, stepDistanceM, observerHeightM, }?: {
        numRays?: number | undefined;
        stepDistanceM?: number | undefined;
        observerHeightM?: number | undefined;
    }) => Promise<{
        startBearingDeg: number;
        endBearingDeg: number;
    }[]>;
    buildMaskedSectorPolygons: (origin: any, maxRangeM: any, bearingRanges: any) => any;
    buildAzimuthWedge: (origin: any, azimuthCenterDeg: any, azimuthSpreadDeg: any, radiusM: any) => any;
};
export namespace WEAPON_PRESETS {
    namespace direct_fire {
        let label: string;
        let minRangeM: number;
        let maxRangeM: number;
        let azimuthSpreadDeg: number;
        let elevMinDeg: number;
        let elevMaxDeg: number;
        let extrudeHeightFactor: number;
        let color: number[];
    }
    namespace mortar {
        let label_1: string;
        export { label_1 as label };
        let minRangeM_1: number;
        export { minRangeM_1 as minRangeM };
        let maxRangeM_1: number;
        export { maxRangeM_1 as maxRangeM };
        let azimuthSpreadDeg_1: number;
        export { azimuthSpreadDeg_1 as azimuthSpreadDeg };
        let elevMinDeg_1: number;
        export { elevMinDeg_1 as elevMinDeg };
        let elevMaxDeg_1: number;
        export { elevMaxDeg_1 as elevMaxDeg };
        let extrudeHeightFactor_1: number;
        export { extrudeHeightFactor_1 as extrudeHeightFactor };
        let color_1: number[];
        export { color_1 as color };
    }
    namespace artillery {
        let label_2: string;
        export { label_2 as label };
        let minRangeM_2: number;
        export { minRangeM_2 as minRangeM };
        let maxRangeM_2: number;
        export { maxRangeM_2 as maxRangeM };
        let azimuthSpreadDeg_2: number;
        export { azimuthSpreadDeg_2 as azimuthSpreadDeg };
        let elevMinDeg_2: number;
        export { elevMinDeg_2 as elevMinDeg };
        let elevMaxDeg_2: number;
        export { elevMaxDeg_2 as elevMaxDeg };
        let extrudeHeightFactor_2: number;
        export { extrudeHeightFactor_2 as extrudeHeightFactor };
        let color_2: number[];
        export { color_2 as color };
    }
    namespace atgm {
        let label_3: string;
        export { label_3 as label };
        let minRangeM_3: number;
        export { minRangeM_3 as minRangeM };
        let maxRangeM_3: number;
        export { maxRangeM_3 as maxRangeM };
        let azimuthSpreadDeg_3: number;
        export { azimuthSpreadDeg_3 as azimuthSpreadDeg };
        let elevMinDeg_3: number;
        export { elevMinDeg_3 as elevMinDeg };
        let elevMaxDeg_3: number;
        export { elevMaxDeg_3 as elevMaxDeg };
        let extrudeHeightFactor_3: number;
        export { extrudeHeightFactor_3 as extrudeHeightFactor };
        let color_3: number[];
        export { color_3 as color };
    }
    namespace anti_air {
        let label_4: string;
        export { label_4 as label };
        let minRangeM_4: number;
        export { minRangeM_4 as minRangeM };
        let maxRangeM_4: number;
        export { maxRangeM_4 as maxRangeM };
        let azimuthSpreadDeg_4: number;
        export { azimuthSpreadDeg_4 as azimuthSpreadDeg };
        let elevMinDeg_4: number;
        export { elevMinDeg_4 as elevMinDeg };
        let elevMaxDeg_4: number;
        export { elevMaxDeg_4 as elevMaxDeg };
        let extrudeHeightFactor_4: number;
        export { extrudeHeightFactor_4 as extrudeHeightFactor };
        let color_4: number[];
        export { color_4 as color };
    }
}
