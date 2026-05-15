import Extent from '@arcgis/core/geometry/Extent';
import Point from '@arcgis/core/geometry/Point';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';

export interface ElevationSamplerLike {
  queryElevation(geometry: Point): Point | null | undefined;
}

type PointLike =
  | Point
  | {
      longitude: number;
      latitude: number;
      spatialReference?: __esri.SpatialReferenceProperties | __esri.SpatialReference;
    };

export class ElevationUtils {
  static async createSampler(
    view: MapView | SceneView,
    extent: Extent,
    options: {
      noDataValue?: number;
      demResolution?: number | 'auto' | 'finest-contiguous';
    } = {}
  ): Promise<ElevationSamplerLike> {
    const ground = (view.map as any)?.ground;
    if (ground?.load) {
      await ground.load();
    }

    if (typeof ground?.createElevationSampler === 'function') {
      return ground.createElevationSampler(extent, {
        noDataValue: 0,
        ...options,
      });
    }

    const fallbackSampler = (view as any)?.groundView?.elevationSampler;
    if (fallbackSampler?.queryElevation) {
      return fallbackSampler as ElevationSamplerLike;
    }

    throw new Error('No ArcGIS elevation sampler API is available for the active view.');
  }

  static queryPointElevation(sampler: ElevationSamplerLike, point: PointLike): number {
    return sampler.queryElevation(ElevationUtils.toPoint(point))?.z ?? 0;
  }

  private static toPoint(point: PointLike): Point {
    return point instanceof Point
      ? point
      : new Point({
          longitude: point.longitude,
          latitude: point.latitude,
          spatialReference: point.spatialReference ?? { wkid: 4326 },
        });
  }
}
