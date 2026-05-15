import Extent from '@arcgis/core/geometry/Extent';
import Point from '@arcgis/core/geometry/Point';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
export interface ElevationSamplerLike {
    queryElevation(geometry: Point): Point | null | undefined;
}
type PointLike = Point | {
    longitude: number;
    latitude: number;
    spatialReference?: __esri.SpatialReferenceProperties | __esri.SpatialReference;
};
export declare class ElevationUtils {
    static createSampler(view: MapView | SceneView, extent: Extent, options?: {
        noDataValue?: number;
        demResolution?: number | 'auto' | 'finest-contiguous';
    }): Promise<ElevationSamplerLike>;
    static queryPointElevation(sampler: ElevationSamplerLike, point: PointLike): number;
    private static toPoint;
}
export {};
