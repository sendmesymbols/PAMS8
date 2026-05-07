export function destinationPoint(lon: any, lat: any, bearingDeg: any, distM: any): {
    longitude: number;
    latitude: number;
};
export function geodesicDistance(lon1: any, lat1: any, lon2: any, lat2: any): number;
export function geodesicBearing(lon1: any, lat1: any, lon2: any, lat2: any): number;
export function densifyRoute(waypoints: any, intervalM?: number): any;
export function computeLegs(waypoints: any): any;
export function scoreSegments(denseRoute: any, corridorM: any, threatGeometries: any, segmentLenM: any, { geometryEngine, Polyline, Point }: {
    geometryEngine: any;
    Polyline: any;
    Point: any;
}): {
    polyline: any;
    buffer: any;
    score: number;
    distFromStartM: number;
    length: number;
}[];
export function detectChokepoints(waypoints: any, corridorPolygon: any, corridorM: any, { geometryEngine, Point }: {
    geometryEngine: any;
    Point: any;
}): any[];
export function createCorridorEngine({ geometryEngine, Polyline, Polygon, Point, Graphic }: {
    geometryEngine: any;
    Polyline: any;
    Polygon: any;
    Point: any;
    Graphic: any;
}): {
    buildCorridorStack: (densePath: any, { corridorM, standoffM, exclusionM }: {
        corridorM: any;
        standoffM: any;
        exclusionM: any;
    }) => {
        polyline: any;
        corridor: any;
        standoff: any;
        exclusion: any;
        standoffRing: any;
        exclusionRing: any;
    };
    buildCorridorGraphics: (stack: any, preset: any, showExclusion: any) => any[];
    buildCentrelineGraphics: (waypoints: any, densePath: any, preset: any) => any[];
    buildSegmentGraphics: (segments: any) => any;
    buildChokepointGraphics: (chokepoints: any) => any;
    buildLegLabels: (legs: any) => any;
};
export namespace CORRIDOR_PRESETS {
    namespace foot_patrol {
        let label: string;
        let corridorM: number;
        let standoffM: number;
        let exclusionM: number;
        let segmentLenM: number;
        let color: number[];
    }
    namespace vehicle_patrol {
        let label_1: string;
        export { label_1 as label };
        let corridorM_1: number;
        export { corridorM_1 as corridorM };
        let standoffM_1: number;
        export { standoffM_1 as standoffM };
        let exclusionM_1: number;
        export { exclusionM_1 as exclusionM };
        let segmentLenM_1: number;
        export { segmentLenM_1 as segmentLenM };
        let color_1: number[];
        export { color_1 as color };
    }
    namespace heavy_convoy {
        let label_2: string;
        export { label_2 as label };
        let corridorM_2: number;
        export { corridorM_2 as corridorM };
        let standoffM_2: number;
        export { standoffM_2 as standoffM };
        let exclusionM_2: number;
        export { exclusionM_2 as exclusionM };
        let segmentLenM_2: number;
        export { segmentLenM_2 as segmentLenM };
        let color_2: number[];
        export { color_2 as color };
    }
    namespace drone_flyway {
        let label_3: string;
        export { label_3 as label };
        let corridorM_3: number;
        export { corridorM_3 as corridorM };
        let standoffM_3: number;
        export { standoffM_3 as standoffM };
        let exclusionM_3: number;
        export { exclusionM_3 as exclusionM };
        let segmentLenM_3: number;
        export { segmentLenM_3 as segmentLenM };
        let color_3: number[];
        export { color_3 as color };
    }
    namespace exfil_route {
        let label_4: string;
        export { label_4 as label };
        let corridorM_4: number;
        export { corridorM_4 as corridorM };
        let standoffM_4: number;
        export { standoffM_4 as standoffM };
        let exclusionM_4: number;
        export { exclusionM_4 as exclusionM };
        let segmentLenM_4: number;
        export { segmentLenM_4 as segmentLenM };
        let color_4: number[];
        export { color_4 as color };
    }
}
export const EXPOSURE_COLORS: {
    threshold: number;
    fill: number[];
    outline: number[];
}[];
