/**
 * los-engine.js
 * Line-of-sight computation engine.
 * Pure functions — no ArcGIS dependency at import time.
 * Inject Point / Polyline via createLOSEngine({ Point, Polyline }).
 */
export function destinationPoint(lon: any, lat: any, bearingDeg: any, distM: any): {
    longitude: number;
    latitude: number;
};
export function bearingBetween(lon1: any, lat1: any, lon2: any, lat2: any): number;
export function generateDomeTargets(observer: any, { maxRangeM, azStartDeg, azEndDeg, azStepDeg, elevMinDeg, elevMaxDeg, elevStepDeg, }?: {
    maxRangeM?: number | undefined;
    azStartDeg?: number | undefined;
    azEndDeg?: number | undefined;
    azStepDeg?: number | undefined;
    elevMinDeg?: number | undefined;
    elevMaxDeg?: number | undefined;
    elevStepDeg?: number | undefined;
}): {
    lon: number;
    lat: number;
    z: any;
    azDeg: number;
    elDeg: number;
}[];
export function castTerrainRay(sampler: any, observer: any, target: any, { stepDistM, observerHeightM, }?: {
    stepDistM?: number | undefined;
    observerHeightM?: number | undefined;
}): {
    visible: boolean;
    obstructionDistM: number;
    horizon: number;
} | {
    visible: boolean;
    obstructionDistM: null;
    horizon: number;
};
export function summariseDomeResults(targets: any, results: any): {
    total: number;
    visible: number;
    obstructed: number;
    pct: number;
    byAzimuth: {};
};
export function createLOSEngine({ Point, Polyline }: {
    Point: any;
    Polyline: any;
}): {
    makePoint: (lon: any, lat: any, z: any) => any;
    makeRayLine: (fromPt: any, toPt: any) => any;
};
