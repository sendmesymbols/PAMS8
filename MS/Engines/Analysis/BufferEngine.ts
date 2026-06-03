/**
 * BufferEngine.ts
 * Buffer & Threat Rings analysis engine.
 *
 * Integrated with ContextMenuManager via linkBufferEngine().
 * Right-clicking any military symbol -> Analysis -> Buffer and Threat Rings
 * opens this panel with the symbol location as source origin.
 */

import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polyline from '@arcgis/core/geometry/Polyline';
import Polygon from '@arcgis/core/geometry/Polygon';
import * as geometryEngine from '@arcgis/core/geometry/geometryEngine';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils';
import EngineLogger from '../../Support/EngineLogger';

export interface ThreatRingDef {
  label: string;
  radiusM: number;
  colorKey: keyof typeof RING_COLORS;
}

interface ThreatPreset {
  label: string;
  rings: ThreatRingDef[];
}

interface ComputedRing extends ThreatRingDef {
  geometry: Polygon | null;
}
const ENGINE_NAME = 'BufferEngine';

type AnalysisMode = 'single' | 'union' | 'corridor';

export const THREAT_PRESETS: Record<string, ThreatPreset> = {
  artillery_155mm: {
    label: 'Artillery 155 mm',
    rings: [
      { label: 'Max range', radiusM: 30000, colorKey: 'safe' },
      { label: 'Effective range', radiusM: 18000, colorKey: 'warning' },
      { label: 'Danger close', radiusM: 600, colorKey: 'lethal' },
    ],
  },
  mortar_81mm: {
    label: 'Mortar 81 mm',
    rings: [
      { label: 'Max range', radiusM: 5600, colorKey: 'safe' },
      { label: 'Effective range', radiusM: 3200, colorKey: 'warning' },
      { label: 'Danger close', radiusM: 200, colorKey: 'lethal' },
    ],
  },
  atgm: {
    label: 'ATGM',
    rings: [
      { label: 'Max range', radiusM: 5500, colorKey: 'safe' },
      { label: 'Min arm dist', radiusM: 75, colorKey: 'dead' },
    ],
  },
  ied_vbied: {
    label: 'IED / VBIED',
    rings: [
      { label: 'Safe standoff', radiusM: 600, colorKey: 'safe' },
      { label: 'Injury radius', radiusM: 300, colorKey: 'warning' },
      { label: 'Lethal radius', radiusM: 100, colorKey: 'lethal' },
    ],
  },
  nbc_release: {
    label: 'NBC release',
    rings: [
      { label: 'Downwind hazard', radiusM: 10000, colorKey: 'warning' },
      { label: 'Hot zone', radiusM: 500, colorKey: 'lethal' },
    ],
  },
  observation_post: {
    label: 'Observation post',
    rings: [
      { label: 'Max observe', radiusM: 8000, colorKey: 'info' },
      { label: 'Effective obs', radiusM: 3000, colorKey: 'safe' },
    ],
  },
  custom: {
    label: 'Custom',
    rings: [
      { label: 'Ring 1', radiusM: 3000, colorKey: 'safe' },
      { label: 'Ring 2', radiusM: 1500, colorKey: 'warning' },
      { label: 'Ring 3', radiusM: 500, colorKey: 'lethal' },
    ],
  },
};

export const RING_COLORS = {
  lethal: { fill: [220, 60, 48, 0.18], outline: [220, 60, 48, 0.85], label: '#DC3C30' },
  warning: { fill: [239, 159, 39, 0.13], outline: [239, 159, 39, 0.8], label: '#EF9F27' },
  safe: { fill: [29, 158, 117, 0.09], outline: [29, 158, 117, 0.6], label: '#1D9E75' },
  info: { fill: [55, 138, 221, 0.1], outline: [55, 138, 221, 0.65], label: '#378ADD' },
  dead: { fill: [100, 100, 100, 0.25], outline: [150, 150, 150, 0.7], label: '#969490' },
  exclusion: { fill: [180, 40, 220, 0.12], outline: [180, 40, 220, 0.7], label: '#B428DC' },
} as const;

function destinationPoint(
  lon: number,
  lat: number,
  bearingDeg: number,
  distM: number,
): { longitude: number; latitude: number } {
  const R = 6_371_008.8;
  const d = distM / R;
  const t = (bearingDeg * Math.PI) / 180;
  const p1 = (lat * Math.PI) / 180;
  const l1 = (lon * Math.PI) / 180;
  const p2 = Math.asin(
    Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t),
  );
  const l2 = l1 + Math.atan2(
    Math.sin(t) * Math.sin(d) * Math.cos(p1),
    Math.cos(d) - Math.sin(p1) * Math.sin(p2),
  );
  return { longitude: (l2 * 180) / Math.PI, latitude: (p2 * 180) / Math.PI };
}

export class BufferEngine {
  static readonly ANALYSIS_LAYER_ID = 'buffer-analysis';
  static readonly LABEL_LAYER_ID = 'buffer-labels';
  static readonly SOURCE_LAYER_ID = 'buffer-sources';
  static readonly COMMITTED_LAYER_ID = 'buffer-committed';

  private _view: MapView | SceneView | null = null;
  private _analysisLayer!: GraphicsLayer;
  private _labelLayer!: GraphicsLayer;
  private _sourceLayer!: GraphicsLayer;
  private _committedLayer!: GraphicsLayer;

  private _panelEl: HTMLDivElement | null = null;
  private _pickHandle: any = null;

  private _mode: AnalysisMode = 'single';
  private _presetKey = 'artillery_155mm';
  private _sourcePoints: Point[] = [];

  private _dragOffsetX = 0;
  private _dragOffsetY = 0;
  private _isDragging = false;

  // Transient "pick a location" tooltip state
  private _tooltipEl: HTMLDivElement | null = null;
  private _tooltipTimer: number | null = null;

  constructor() {
    this._createLayers();
    this._injectStyles();
  }

  initialize(view: MapView | SceneView): void {
    if (this._view === view) return;
    this._view = view;
    const map = view.map as any;
    if (map && !map.findLayerById(this._analysisLayer.id)) {
      map.addMany([
        this._committedLayer,
        this._analysisLayer,
        this._labelLayer,
        this._sourceLayer,
      ]);
    }
  }

  open(graphic?: Graphic | null, view?: MapView | SceneView): void {
    if (view) this.initialize(view);

    const geom = graphic?.geometry;
    let src: Point | null = null;
    if (geom?.type === 'point') src = geom as Point;
    else if ((geom as any)?.centroid) src = (geom as any).centroid as Point;

    const wgsSource = this._toWgs84Point(src);
    if (wgsSource) {
      if (this._mode === 'single') this._sourcePoints = [wgsSource];
      else this._sourcePoints.push(wgsSource);
    }

    this._showPanel();
    this._drawSources();
    this._redraw();

    if (this._sourcePoints.length === 0) {
      this._startPick('replace');
    }
  }

  close(): void {
    this._hidePanel();
    this._hideTooltip();
    this._analysisLayer.removeAll();
    this._labelLayer.removeAll();
    this._sourceLayer.removeAll();
    this._sourcePoints = [];
    this._cancelPick();
  }

  destroy(): void {
    this.close();
    const map = this._view?.map as any;
    if (map) {
      map.remove(this._analysisLayer);
      map.remove(this._labelLayer);
      map.remove(this._sourceLayer);
      map.remove(this._committedLayer);
    }
    this._panelEl?.remove();
    this._tooltipEl?.remove();
    this._panelEl = null;
    this._tooltipEl = null;
    this._view = null;
  }

  private _createLayers(): void {
    this._analysisLayer = new GraphicsLayer({
      id: BufferEngine.ANALYSIS_LAYER_ID,
      title: 'Buffer — Working',
      elevationInfo: { mode: 'on-the-ground' } as any,
    });
    this._labelLayer = new GraphicsLayer({
      id: BufferEngine.LABEL_LAYER_ID,
      title: 'Buffer — Labels',
      elevationInfo: { mode: 'on-the-ground' } as any,
    });
    this._sourceLayer = new GraphicsLayer({
      id: BufferEngine.SOURCE_LAYER_ID,
      title: 'Buffer — Sources',
      elevationInfo: { mode: 'on-the-ground' } as any,
    });
    this._committedLayer = new GraphicsLayer({
      id: BufferEngine.COMMITTED_LAYER_ID,
      title: 'Buffer — Committed',
      elevationInfo: { mode: 'on-the-ground' } as any,
    });
  }

  private _computeRings(
    sourcePoint: Point,
    ringDefs: ThreatRingDef[],
    asDonut: boolean,
  ): ComputedRing[] {
    const sorted = [...ringDefs].sort((a, b) => b.radiusM - a.radiusM);
    const buffers = sorted.map((def) => {
      const raw = geometryEngine.geodesicBuffer(sourcePoint, def.radiusM, 'meters');
      const geometry = Array.isArray(raw) ? ((raw[0] as Polygon | undefined) ?? null) : (raw as Polygon | null);
      return { ...def, geometry };
    });
    if (!asDonut) return buffers;

    return buffers.map((ring, i) => {
      const inner = buffers[i + 1];
      if (!ring.geometry) return ring;
      if (!inner?.geometry) return ring;
      return {
        ...ring,
        geometry: (geometryEngine.difference(ring.geometry, inner.geometry) as Polygon | null) ?? ring.geometry,
      };
    });
  }

  private _computeUnionRings(sourcePoints: Point[], ringDefs: ThreatRingDef[]): ComputedRing[] {
    const allByRadius: Record<string, Polygon[]> = {};
    sourcePoints.forEach((pt) => {
      const rings = this._computeRings(pt, ringDefs, false);
      rings.forEach((r) => {
        if (!r.geometry) return;
        const key = String(r.radiusM);
        if (!allByRadius[key]) allByRadius[key] = [];
        allByRadius[key].push(r.geometry);
      });
    });

    return Object.entries(allByRadius)
      .map(([radiusM, geoms]) => {
        const def = ringDefs.find((d) => d.radiusM === Number(radiusM));
        const merged = geoms.length === 1 ? geoms[0] : ((geometryEngine.union(geoms) as Polygon | null) ?? null);
        return {
          radiusM: Number(radiusM),
          label: def?.label ?? '',
          colorKey: (def?.colorKey ?? 'info') as keyof typeof RING_COLORS,
          geometry: merged,
        };
      })
      .sort((a, b) => b.radiusM - a.radiusM);
  }

  private _computeContestedZone(a: ComputedRing[], b: ComputedRing[]): Polygon | null {
    const geomsA = a.map((r) => r.geometry).filter((g): g is Polygon => !!g);
    const geomsB = b.map((r) => r.geometry).filter((g): g is Polygon => !!g);
    if (!geomsA.length || !geomsB.length) return null;
    const unionA = geomsA.length === 1 ? geomsA[0] : ((geometryEngine.union(geomsA) as Polygon | null) ?? null);
    const unionB = geomsB.length === 1 ? geomsB[0] : ((geometryEngine.union(geomsB) as Polygon | null) ?? null);
    if (!unionA || !unionB) return null;
    return (geometryEngine.intersect(unionA, unionB) as Polygon | null) ?? null;
  }

  private _computeMultiSourceContestedZone(sourcePoints: Point[], ringDefs: ThreatRingDef[]): Polygon | null {
    const contested: Polygon[] = [];
    const ringSets = sourcePoints.map((pt) => this._computeRings(pt, ringDefs, false));
    for (let i = 0; i < ringSets.length; i++) {
      for (let j = i + 1; j < ringSets.length; j++) {
        const zone = this._computeContestedZone(ringSets[i], ringSets[j]);
        if (zone) contested.push(zone);
      }
    }
    if (!contested.length) return null;
    return contested.length === 1
      ? contested[0]
      : ((geometryEngine.union(contested) as Polygon | null) ?? null);
  }

  private _computeCorridorBuffer(
    polyline: Polyline,
    widthM: number,
    standoffM: number,
  ): { corridor: Polygon | null; standoff: Polygon | null } {
    let densified: Polyline = polyline;
    try {
      densified = (geometryEngine.geodesicDensify(polyline, 50, 'meters') as Polyline) ?? polyline;
    } catch {
      densified = polyline;
    }
    const corridorRaw = geometryEngine.geodesicBuffer(densified, widthM, 'meters');
    const standoffRaw = standoffM > 0
      ? geometryEngine.geodesicBuffer(densified, widthM + standoffM, 'meters')
      : null;
    const corridor = Array.isArray(corridorRaw) ? ((corridorRaw[0] as Polygon | undefined) ?? null) : (corridorRaw as Polygon | null);
    const standoff = standoffRaw == null
      ? null
      : (Array.isArray(standoffRaw) ? ((standoffRaw[0] as Polygon | undefined) ?? null) : (standoffRaw as Polygon | null));
    return { corridor, standoff };
  }

  private _buildRingGraphics(rings: ComputedRing[]): Graphic[] {
    const is3D = this._view?.type === '3d';
    const extrudeChecked = this._inp('buffer-opt-extrude')?.checked ?? false;
    const extrudeHeightM = extrudeChecked
      ? Math.max(50, Number(this._inp('buffer-extrude-height')?.value ?? 300))
      : 0;

    return rings.flatMap((ring) => {
      if (!ring.geometry) return [];
      const colors = RING_COLORS[ring.colorKey] ?? RING_COLORS.info;
      const [fr, fg, fb, fa] = colors.fill;
      const [or, og, ob, oa] = colors.outline;

      if (is3D) {
        // When extruding, use only the extrude layer — a flat fill layer on top
        // suppresses the extrusion entirely in SceneView.
        const symbolLayers: any[] = extrudeHeightM > 0
          ? [{
              type: 'extrude',
              material: { color: [fr, fg, fb, Math.min(fa * 2, 0.85)] },
              edges: { type: 'solid', color: [or, og, ob, oa], size: 0.5 },
              size: extrudeHeightM,
            }]
          : [{
              type: 'fill',
              material: { color: [fr, fg, fb, fa] },
              outline: { color: [or, og, ob, oa], size: 1.5 },
            }];

        return [new Graphic({
          geometry: ring.geometry,
          symbol: { type: 'polygon-3d', symbolLayers },
          attributes: {
            type: 'buffer_ring',
            label: ring.label,
            radiusM: ring.radiusM,
            colorKey: ring.colorKey,
          },
        })];
      }

      return [new Graphic({
        geometry: ring.geometry,
        symbol: {
          type: 'simple-fill',
          color: colors.fill,
          outline: { color: colors.outline, width: 1.5 },
        } as any,
        attributes: {
          type: 'buffer_ring',
          label: ring.label,
          radiusM: ring.radiusM,
          colorKey: ring.colorKey,
        },
      })];
    });
  }

  private _buildLabelGraphics(sourcePoint: Point, rings: ComputedRing[]): Graphic[] {
    const is3D = this._view?.type === '3d';
    return rings.map((ring) => {
      const colors = RING_COLORS[ring.colorKey] ?? RING_COLORS.info;
      const labelPt = destinationPoint(
        sourcePoint.longitude!,
        sourcePoint.latitude!,
        0,
        ring.radiusM,
      );
      const text = `${ring.label}  ${ring.radiusM >= 1000
        ? `${(ring.radiusM / 1000).toFixed(1)} km`
        : `${ring.radiusM} m`}`;
      const pt = new Point({
        longitude: labelPt.longitude,
        latitude: labelPt.latitude,
        spatialReference: { wkid: 4326 },
      });

      if (is3D) {
        return new Graphic({
          geometry: pt,
          symbol: {
            // PointSymbol3D, not LabelSymbol3D — LabelSymbol3D is only valid
            // inside a LabelClass on a layer's labelingInfo, not as a graphic's
            // own symbol. PointSymbol3D + TextSymbol3DLayer renders identically
            // with verticalOffset + callout.
            type: 'point-3d',
            symbolLayers: [{
              type: 'text',
              material: { color: colors.label },
              halo: { color: [0, 0, 0, 0.75], size: 1.5 },
              text,
              font: { family: 'Courier New', size: 10, weight: 'bold' },
            }],
            verticalOffset: { screenLength: 20, maxWorldLength: 2000, minWorldLength: 10 },
            callout: { type: 'line', size: 0.5, color: [0, 0, 0, 0.4] },
          } as any,
          attributes: { type: 'buffer_label', label: ring.label },
        });
      }

      return new Graphic({
        geometry: pt,
        symbol: {
          type: 'text',
          color: colors.label,
          haloColor: [0, 0, 0, 0.7],
          haloSize: 1.5,
          text,
          font: { family: 'Courier New', size: 10, weight: 'bold' },
          horizontalAlignment: 'center',
          verticalAlignment: 'bottom',
        } as any,
        attributes: { type: 'buffer_label', label: ring.label },
      });
    });
  }

  private _buildGeometryLabelGraphics(rings: ComputedRing[]): Graphic[] {
    const is3D = this._view?.type === '3d';
    return rings.flatMap((ring) => {
      if (!ring.geometry?.extent?.center) return [];
      const colors = RING_COLORS[ring.colorKey] ?? RING_COLORS.info;
      const text = `${ring.label}  ${ring.radiusM >= 1000
        ? `${(ring.radiusM / 1000).toFixed(1)} km`
        : `${ring.radiusM} m`}`;

      if (is3D) {
        return [new Graphic({
          geometry: ring.geometry.extent.center,
          symbol: {
            // PointSymbol3D, not LabelSymbol3D — LabelSymbol3D is only valid
            // inside a LabelClass on a layer's labelingInfo, not as a graphic's
            // own symbol. PointSymbol3D + TextSymbol3DLayer renders identically
            // with verticalOffset + callout.
            type: 'point-3d',
            symbolLayers: [{
              type: 'text',
              material: { color: colors.label },
              halo: { color: [0, 0, 0, 0.75], size: 1.5 },
              text,
              font: { family: 'Courier New', size: 10, weight: 'bold' },
            }],
            verticalOffset: { screenLength: 20, maxWorldLength: 2000, minWorldLength: 10 },
            callout: { type: 'line', size: 0.5, color: [0, 0, 0, 0.4] },
          } as any,
          attributes: { type: 'buffer_label', label: ring.label },
        })];
      }

      return [new Graphic({
        geometry: ring.geometry.extent.center,
        symbol: {
          type: 'text',
          color: colors.label,
          haloColor: [0, 0, 0, 0.7],
          haloSize: 1.5,
          text,
          font: { family: 'Courier New', size: 10, weight: 'bold' },
          horizontalAlignment: 'center',
          verticalAlignment: 'middle',
        } as any,
        attributes: { type: 'buffer_label', label: ring.label },
      })];
    });
  }

  private _toWgs84Point(point: Point | null | undefined): Point | null {
    if (!point) return null;
    const sr: any = point.spatialReference;
    const wkid = sr?.wkid ?? sr?.latestWkid;
    let source = point;

    if (wkid === 3857 || wkid === 102100 || sr?.isWebMercator) {
      source = webMercatorUtils.webMercatorToGeographic(point) as Point;
    }

    if (wkid && wkid !== 4326 && wkid !== 3857 && wkid !== 102100 && !sr?.isWGS84) {
      return null;
    }

    const longitude = Number.isFinite(source.longitude) ? source.longitude : source.x;
    const latitude = Number.isFinite(source.latitude) ? source.latitude : source.y;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;

    return new Point({
      longitude,
      latitude,
      z: source.z ?? point.z ?? 0,
      spatialReference: { wkid: 4326 },
    });
  }

  private _buildSourceGraphic(pt: Point): Graphic {
    if (this._view?.type === '3d') {
      return new Graphic({
        geometry: pt,
        symbol: {
          type: 'point-3d',
          symbolLayers: [{
            type: 'object',
            resource: { primitive: 'sphere' },
            material: { color: [55, 138, 221, 230] },
            width: 48,
            height: 48,
            depth: 48,
          }],
          verticalOffset: { screenLength: 22, maxWorldLength: 400, minWorldLength: 4 },
        } as any,
        attributes: { type: 'buffer_source' },
      });
    }

    return new Graphic({
      geometry: pt,
      symbol: {
        type: 'simple-marker',
        style: 'cross',
        color: [55, 138, 221, 220],
        size: 12,
        outline: { color: [255, 255, 255, 180], width: 1.2 },
      } as any,
      attributes: { type: 'buffer_source' },
    });
  }

  private _drawSources(): void {
    this._sourceLayer.removeAll();
    this._sourcePoints.forEach((pt) => this._sourceLayer.add(this._buildSourceGraphic(pt)));
  }

  private _redraw(): void {
    this._analysisLayer.removeAll();
    this._labelLayer.removeAll();
    this._setStatus(this._sourcePoints.length === 0 ? 'awaiting' : 'computing');

    try {
      const defs = this._currentRings().filter((r) => r.radiusM > 0);
      const showLabels = this._inp('buffer-opt-labels')?.checked ?? true;
      const asDonut = this._inp('buffer-opt-donut')?.checked ?? true;
      const showContested = this._inp('buffer-opt-contested')?.checked ?? false;

      if (this._mode === 'corridor') {
        if (this._sourcePoints.length >= 2) {
          const widthM = Math.max(10, Number(this._inp('buffer-corridor-width')?.value ?? 250));
          const standoffM = Math.max(0, Number(this._inp('buffer-corridor-standoff')?.value ?? 500));
          const path: number[][] = this._sourcePoints.map((p) => [p.longitude!, p.latitude!]);
          const line = new Polyline({ paths: [path], spatialReference: { wkid: 4326 } });
          const { corridor, standoff } = this._computeCorridorBuffer(line, widthM / 2, standoffM);
          if (standoff) this._analysisLayer.add(this._corridorGraphic(standoff, true));
          if (corridor) this._analysisLayer.add(this._corridorGraphic(corridor, false));
        }
        this._syncStats(defs);
        this._setStatus('ready');
        this._syncCommit();
        return;
      }

      if (this._sourcePoints.length > 0 && defs.length > 0) {
        let rings: ComputedRing[] = [];
        if (this._mode === 'union' && this._sourcePoints.length > 1) {
          rings = this._computeUnionRings(this._sourcePoints, defs);
          if (asDonut) {
            const sorted = [...rings].sort((a, b) => b.radiusM - a.radiusM);
            rings = sorted.map((ring, i) => {
              const next = sorted[i + 1];
              if (!ring.geometry || !next?.geometry) return ring;
              return {
                ...ring,
                geometry: (geometryEngine.difference(ring.geometry, next.geometry) as Polygon | null) ?? ring.geometry,
              };
            });
          }
        } else {
          rings = this._computeRings(this._sourcePoints[0], defs, asDonut);
        }

        this._buildRingGraphics(rings).forEach((g) => this._analysisLayer.add(g));

        if (showLabels && this._sourcePoints[0]) {
          if (this._mode === 'union' && this._sourcePoints.length > 1) {
            this._buildGeometryLabelGraphics(rings).forEach((g) => this._labelLayer.add(g));
          } else {
            const sortedDefs: ComputedRing[] = [...defs]
              .sort((a, b) => b.radiusM - a.radiusM)
              .map((d) => ({ ...d, geometry: null }));
            this._buildLabelGraphics(this._sourcePoints[0], sortedDefs)
              .forEach((g) => this._labelLayer.add(g));
          }
        }

        if (showContested && this._sourcePoints.length >= 2) {
          const contested = this._computeMultiSourceContestedZone(this._sourcePoints, defs);
          if (contested) this._analysisLayer.add(this._contestedGraphic(contested));
        }
      }

      this._syncStats(defs);
      this._setStatus('ready');
      this._syncCommit();
    } catch (error) {
      console.warn('[BufferEngine] Failed to compute buffer analysis', error);
      EngineLogger.error(ENGINE_NAME, 'Failed to compute buffer analysis');
      this._analysisLayer.removeAll();
      this._labelLayer.removeAll();
      this._setStatus('error');
      this._syncCommit();
    }
  }

  private _contestedGraphic(geometry: Polygon): Graphic {
    if (this._view?.type === '3d') {
      return new Graphic({
        geometry,
        symbol: {
          type: 'polygon-3d',
          symbolLayers: [{
            type: 'fill',
            material: { color: [180, 40, 220, 0.28] },
            outline: { color: [180, 40, 220, 0.9], size: 2 },
            pattern: { type: 'style', style: 'cross' },
          }],
        } as any,
        attributes: { type: 'contested_zone', label: 'Contested zone' },
      });
    }

    return new Graphic({
      geometry,
      symbol: {
        type: 'simple-fill',
        color: [180, 40, 220, 70],
        outline: { color: [180, 40, 220, 220], width: 1.8 },
      } as any,
      attributes: { type: 'contested_zone', label: 'Contested zone' },
    });
  }

  private _corridorGraphic(geometry: Polygon, isStandoff: boolean): Graphic {
    if (this._view?.type === '3d') {
      return new Graphic({
        geometry,
        symbol: {
          type: 'polygon-3d',
          symbolLayers: [{
            type: 'fill',
            material: {
              color: isStandoff ? [220, 60, 48, 0.07] : [55, 138, 221, 0.12],
            },
            outline: {
              color: isStandoff ? [220, 60, 48, 0.6] : [55, 138, 221, 0.75],
              size: isStandoff ? 1.2 : 1.6,
            },
            ...(isStandoff ? { pattern: { type: 'style', style: 'diagonal-cross' } } : {}),
          }],
        } as any,
        attributes: {
          type: isStandoff ? 'corridor_standoff' : 'corridor_zone',
          label: isStandoff ? 'Standoff zone' : 'Movement corridor',
        },
      });
    }

    return new Graphic({
      geometry,
      symbol: {
        type: 'simple-fill',
        color: isStandoff ? [220, 60, 48, 18] : [55, 138, 221, 26],
        outline: {
          color: isStandoff ? [220, 60, 48, 170] : [55, 138, 221, 200],
          width: isStandoff ? 1.2 : 1.6,
        },
      } as any,
      attributes: {
        type: isStandoff ? 'corridor_standoff' : 'corridor_zone',
        label: isStandoff ? 'Standoff zone' : 'Movement corridor',
      },
    });
  }

  private _currentRings(): ThreatRingDef[] {
    const preset = THREAT_PRESETS[this._presetKey] ?? THREAT_PRESETS.artillery_155mm;
    return preset.rings.map((r) => ({ ...r }));
  }

  private _startPick(mode: 'replace' | 'add'): void {
    if (!this._view) return;
    this._cancelPick();
    this._setStatus('picking');
    this._pickHandle = this._view.on('click', async (event: any) => {
      this._cancelPick();
      let point: Point | null;
      if (this._view?.type === '3d') {
        const hit = await (this._view as any).hitTest(event, {
          include: [(this._view as any).map.ground],
        });
        const gp = hit?.ground?.mapPoint ?? event.mapPoint;
        point = this._toWgs84Point(gp);
      } else {
        point = this._toWgs84Point(event.mapPoint);
      }
      if (!point) {
        this._setStatus('error');
        return;
      }

      if (mode === 'replace') this._sourcePoints = [point];
      else this._sourcePoints.push(point);

      this._hideTooltip();
      this._drawSources();
      this._redraw();
    });
  }

  private _cancelPick(): void {
    this._pickHandle?.remove();
    this._pickHandle = null;
  }

  private _commit(): void {
    if (!this._analysisLayer.graphics.length && !this._labelLayer.graphics.length) return;
    const ts = new Date().toISOString();
    const meta = {
      committedAt: ts,
      mode: this._mode,
      presetKey: this._presetKey,
      sourceCount: this._sourcePoints.length,
    };

    const allGraphics = [
      ...this._analysisLayer.graphics.toArray(),
      ...this._labelLayer.graphics.toArray(),
      ...this._sourceLayer.graphics.toArray(),
    ];
    allGraphics.forEach((g) => {
      if (!g.geometry) return;
      this._committedLayer.add(new Graphic({
        geometry: g.geometry.clone(),
        symbol: (g as any).symbol?.clone(),
        attributes: { ...g.attributes, ...meta },
      }));
    });
    const btn = this._panelEl?.querySelector<HTMLButtonElement>('#buffer-commit-btn');
    if (btn) btn.disabled = true;
    this._setStatus('committed');
    setTimeout(() => this._setStatus('ready'), 1800);
  }

  private _showPanel(): void {
    if (!this._panelEl) {
      this._panelEl = document.createElement('div');
      this._panelEl.id = 'buffer-engine-panel';
      this._panelEl.className = 'ms-panel ms-theme-ops-dark';
      this._panelEl.setAttribute('data-engine', 'buffer');
      this._panelEl.style.top = '62px';
      this._panelEl.style.left = '306px';
      this._panelEl.style.width = '360px';
      document.body.appendChild(this._panelEl);
    }
    this._panelEl.innerHTML = this._buildPanelHTML();
    this._panelEl.classList.add('ms-visible');
    this._bindPanelEvents();
    this._makeDraggable();
    this._syncStats(this._currentRings());
    this._syncCommit();
    this._setStatus(this._sourcePoints.length > 0 ? 'ready' : 'awaiting');
  }

  private _hidePanel(): void {
    if (this._panelEl) this._panelEl.classList.remove('ms-visible');
  }

  private _buildPanelHTML(): string {
    const presetOptions = Object.entries(THREAT_PRESETS)
      .map(([k, p]) => `<option value="${k}"${k === this._presetKey ? ' selected' : ''}>${p.label}</option>`)
      .join('');

    return `
      <div class="ms-header" id="buffer-drag-handle">
        <span class="ms-header-icon">◍</span>
        <span class="ms-header-title">Buffer & Threat Rings</span>
        <span class="ms-status-dot" id="buffer-status-dot"></span>
        <span class="ms-status-lbl" id="buffer-status-lbl">Awaiting source</span>
        <button class="ms-header-btn ms-btn-round" id="buffer-help-btn" title="How buffer analysis works">?</button>
        <button class="ms-header-btn ms-btn-round" id="buffer-minimize-btn" title="Minimize">▼</button>
        <button class="ms-header-btn ms-btn-round" id="buffer-close-btn" title="Close (keeps graphics)">✕</button>
      </div>

      <div class="ms-help-popover" id="buffer-help-popover" hidden>
        <div class="ms-help-head">
          <div>
            <div class="ms-help-kicker">Field Guide</div>
            <div class="ms-help-title">Buffer / Threat Rings</div>
          </div>
          <button class="ms-help-close" id="buffer-help-close" title="Close">✕</button>
        </div>
        <div class="ms-help-body">
          <p>Builds geodesic distance rings, merged threat envelopes, or a simple movement corridor from selected source points. It is best for fast range visualization rather than physics-heavy analysis.</p>
          <div class="ms-help-block">
            <h4>How It Works</h4>
            <ol>
              <li>Pick one source for a classic ring set, or add several for a shared footprint.</li>
              <li>Select a preset to load ring labels, distances, and semantic colors.</li>
              <li>Switch to corridor mode when you want a buffered path between multiple points instead of circular rings.</li>
              <li>Turn on labels, donut bands, extrusion, or contested overlap depending on the map product you need.</li>
            </ol>
          </div>
          <div class="ms-help-block">
            <h4>Phenomenon</h4>
            <p>Each ring is a geodesic buffer measured outward from a source point. Union mode merges matching radii from multiple sources, while corridor mode buffers a connecting route line to show movement space and standoff around that line.</p>
          </div>
          <div class="ms-help-block">
            <h4>Parameters</h4>
            <dl>
              <dt>Mode</dt><dd>"Single" draws one set of rings, "Union" merges same-distance rings from multiple sources, and "Corridor" buffers the line through the selected points.</dd>
              <dt>Preset</dt><dd>Defines ring count, radius values, labels, and meaning such as lethal, warning, safe, or observation.</dd>
              <dt>Width</dt><dd>In corridor mode, this is the main movement corridor width around the route centerline.</dd>
              <dt>Standoff</dt><dd>Adds a wider outer caution zone around the corridor.</dd>
              <dt>Donut</dt><dd>Subtracts inner rings so each band reads as a separate interval instead of stacked filled disks.</dd>
              <dt>Labels</dt><dd>Places range callouts at reference points around the buffer set.</dd>
              <dt>Extrude</dt><dd>Adds vertical volume in 3D to improve readability without changing footprint size.</dd>
              <dt>Contested</dt><dd>Highlights overlap where two source footprints compete or cover the same ground.</dd>
            </dl>
          </div>
        </div>
      </div>

      <div class="ms-body">
        <div class="ms-section-title">Mode</div>
        <div class="ms-field">
          <select id="buffer-mode" class="ms-select">
            <option value="single"${this._mode === 'single' ? ' selected' : ''}>Single source</option>
            <option value="union"${this._mode === 'union' ? ' selected' : ''}>Multi-source union</option>
            <option value="corridor"${this._mode === 'corridor' ? ' selected' : ''}>Corridor</option>
          </select>
        </div>

        <div class="ms-section-title">Preset</div>
        <div class="ms-field">
          <select id="buffer-preset" class="ms-select">${presetOptions}</select>
        </div>

        <div id="buffer-corridor-wrap" style="display:${this._mode === 'corridor' ? 'block' : 'none'}">
          <div class="ms-section-title">Corridor</div>
          <div class="ms-grid">
            <div class="ms-field">
              <div class="ms-label">Width (m)</div>
              <input id="buffer-corridor-width" class="ms-input" type="number" value="250" min="10" step="10" />
            </div>
            <div class="ms-field">
              <div class="ms-label">Standoff (m)</div>
              <input id="buffer-corridor-standoff" class="ms-input" type="number" value="500" min="0" step="10" />
            </div>
          </div>
        </div>

        <div class="ms-divider"></div>
        <div class="ms-section-title">Display</div>
        <div class="ms-toggle-row">
          <label class="ms-label">Donut rings</label>
          <input id="buffer-opt-donut" type="checkbox" checked />
        </div>
        <div class="ms-toggle-row">
          <label class="ms-label">Show labels</label>
          <input id="buffer-opt-labels" type="checkbox" checked />
        </div>
        <div class="ms-toggle-row">
          <label class="ms-label">Extrude rings (3D)</label>
          <input id="buffer-opt-extrude" type="checkbox" />
        </div>
        <div class="ms-field" id="buffer-extrude-height-wrap" style="display:none">
          <div class="ms-label">Height (m)</div>
          <input id="buffer-extrude-height" class="ms-input" type="number" value="300" min="50" max="5000" step="50" />
        </div>
        <div class="ms-toggle-row">
          <label class="ms-label">Show contested zone</label>
          <input id="buffer-opt-contested" type="checkbox" />
        </div>

        <div class="ms-divider"></div>
        <div class="ms-section-title">Legend</div>
        <div class="buffer-legend">
          <div class="buffer-legend-row"><span class="buffer-legend-dot" style="background:#DC3C30"></span><span class="buffer-legend-label">Lethal</span></div>
          <div class="buffer-legend-row"><span class="buffer-legend-dot" style="background:#EF9F27"></span><span class="buffer-legend-label">Warning</span></div>
          <div class="buffer-legend-row"><span class="buffer-legend-dot" style="background:#1D9E75"></span><span class="buffer-legend-label">Safe / Max range</span></div>
          <div class="buffer-legend-row"><span class="buffer-legend-dot" style="background:#378ADD"></span><span class="buffer-legend-label">Info / Observe</span></div>
          <div class="buffer-legend-row"><span class="buffer-legend-dot" style="background:#B428DC"></span><span class="buffer-legend-label">Contested zone</span></div>
        </div>

        <div class="ms-divider"></div>
        <div class="buffer-stats">
          <div class="buffer-stat"><div class="buffer-stat-lbl">Sources</div><div class="buffer-stat-val" id="buffer-st-sources">0</div></div>
          <div class="buffer-stat"><div class="buffer-stat-lbl">Rings</div><div class="buffer-stat-val" id="buffer-st-rings">0</div></div>
          <div class="buffer-stat"><div class="buffer-stat-lbl">Outer</div><div class="buffer-stat-val" id="buffer-st-outer">—</div></div>
          <div class="buffer-stat"><div class="buffer-stat-lbl">Mode</div><div class="buffer-stat-val" id="buffer-st-mode">Single</div></div>
        </div>

        <div class="ms-btn-row">
          <button class="ms-btn" id="buffer-pick-btn">Pick Source</button>
          <button class="ms-btn" id="buffer-add-btn">Add Source</button>
        </div>
        <div class="ms-btn-row">
          <button class="ms-btn" id="buffer-undo-btn">Undo Last</button>
          <button class="ms-btn ms-btn-danger" id="buffer-clear-btn">Clear</button>
          <button class="ms-btn ms-btn-primary" id="buffer-commit-btn" disabled>Commit ↗</button>
        </div>
      </div>
    `;
  }

  private _bindPanelEvents(): void {
    if (!this._panelEl) return;
    const p = this._panelEl;

    p.querySelector('#buffer-help-btn')?.addEventListener('click', (event) => {
      event.stopPropagation();
      const help = p.querySelector<HTMLElement>('#buffer-help-popover');
      if (help) help.hidden = !help.hidden;
    });
    p.querySelector('#buffer-help-close')?.addEventListener('click', () => {
      const help = p.querySelector<HTMLElement>('#buffer-help-popover');
      if (help) help.hidden = true;
    });

    p.querySelector('#buffer-minimize-btn')?.addEventListener('click', () => {
      const body = p.querySelector<HTMLElement>('.ms-body');
      const btn  = p.querySelector<HTMLElement>('#buffer-minimize-btn');
      if (!body || !btn) return;
      const minimized = body.style.display === 'none';
      body.style.display = minimized ? '' : 'none';
      btn.textContent = minimized ? '▼' : '▶';
    });

    p.querySelector('#buffer-close-btn')?.addEventListener('click', () => {
      this._hidePanel();
      this._cancelPick();
    });

    p.querySelector('#buffer-mode')?.addEventListener('change', (e) => {
      this._mode = ((e.target as HTMLSelectElement).value || 'single') as AnalysisMode;
      if (this._mode === 'single' && this._sourcePoints.length > 1) {
        this._sourcePoints = [this._sourcePoints[0]];
        this._drawSources();
      }
      const cw = p.querySelector<HTMLElement>('#buffer-corridor-wrap');
      if (cw) cw.style.display = this._mode === 'corridor' ? 'block' : 'none';
      this._redraw();
    });

    p.querySelector('#buffer-preset')?.addEventListener('change', (e) => {
      this._presetKey = (e.target as HTMLSelectElement).value || 'artillery_155mm';
      this._redraw();
    });

    ['buffer-corridor-width', 'buffer-corridor-standoff'].forEach((id) => {
      p.querySelector(`#${id}`)?.addEventListener('change', () => this._redraw());
    });

    ['buffer-opt-donut', 'buffer-opt-labels', 'buffer-opt-contested']
      .forEach((id) => p.querySelector(`#${id}`)?.addEventListener('change', () => this._redraw()));

    p.querySelector('#buffer-opt-extrude')?.addEventListener('change', (e) => {
      const wrap = p.querySelector<HTMLElement>('#buffer-extrude-height-wrap');
      if (wrap) wrap.style.display = (e.target as HTMLInputElement).checked ? 'flex' : 'none';
      this._redraw();
    });
    p.querySelector('#buffer-extrude-height')?.addEventListener('change', () => this._redraw());

    p.querySelector('#buffer-pick-btn')?.addEventListener('click', () => this._startPick('replace'));
    p.querySelector('#buffer-add-btn')?.addEventListener('click', () => this._startPick('add'));

    p.querySelector('#buffer-undo-btn')?.addEventListener('click', () => {
      if (!this._sourcePoints.length) return;
      this._sourcePoints.pop();
      this._drawSources();
      this._redraw();
    });

    p.querySelector('#buffer-clear-btn')?.addEventListener('click', () => {
      this._analysisLayer.removeAll();
      this._labelLayer.removeAll();
      this._sourceLayer.removeAll();
      this._sourcePoints = [];
      this._syncStats(this._currentRings());
      this._syncCommit();
      this._setStatus('awaiting');
    });

    p.querySelector('#buffer-commit-btn')?.addEventListener('click', () => this._commit());
  }

  private _makeDraggable(): void {
    const handle = this._panelEl?.querySelector<HTMLElement>('#buffer-drag-handle');
    if (!handle || !this._panelEl) return;
    handle.addEventListener('mousedown', (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      this._isDragging = true;
      const rect = this._panelEl!.getBoundingClientRect();
      this._dragOffsetX = e.clientX - rect.left;
      this._dragOffsetY = e.clientY - rect.top;
      document.addEventListener('mousemove', this._onDragMove);
      document.addEventListener('mouseup', this._onDragEnd);
    });
  }

  private _onDragMove = (e: MouseEvent): void => {
    if (!this._isDragging || !this._panelEl) return;
    this._panelEl.style.left = `${Math.max(0, e.clientX - this._dragOffsetX)}px`;
    this._panelEl.style.top = `${Math.max(0, e.clientY - this._dragOffsetY)}px`;
    this._panelEl.style.right = 'auto';
  };

  private _onDragEnd = (): void => {
    this._isDragging = false;
    document.removeEventListener('mousemove', this._onDragMove);
    document.removeEventListener('mouseup', this._onDragEnd);
  };

  private _injectStyles(): void {
    if (document.getElementById('buffer-engine-styles')) return;
    const style = document.createElement('style');
    style.id = 'buffer-engine-styles';
    style.textContent = `
      #buffer-engine-panel .ms-field {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      #buffer-engine-panel .ms-field-full {
        padding: 0 10px 8px;
      }
      #buffer-engine-panel .ms-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 7px;
        padding: 0 10px 8px;
      }
      #buffer-engine-panel .ms-input,
      #buffer-engine-panel .ms-select {
        background: var(--ms-bg-input);
        border: 1px solid var(--ms-border);
        border-radius: 3px;
        color: var(--ms-text);
        font-family: inherit;
        font-size: var(--ms-fs);
        padding: 5px 7px;
        outline: none;
        transition: border-color 0.15s;
        box-sizing: border-box;
      }
      #buffer-engine-panel .ms-grid .ms-input,
      #buffer-engine-panel .ms-grid .ms-select {
        width: 100%;
      }
      #buffer-engine-panel .ms-input:focus,
      #buffer-engine-panel .ms-select:focus {
        border-color: var(--ms-accent);
      }
      #buffer-engine-panel .ms-label {
        font-size: var(--ms-fs-xs);
        letter-spacing: 0.07em;
        text-transform: uppercase;
        color: var(--ms-text-dim);
      }
      #buffer-engine-panel .ms-section-title {
        font-size: var(--ms-fs-xs);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--ms-text-label);
        padding: 9px 12px 4px;
      }
      #buffer-engine-panel .ms-divider {
        height: 1px;
        background: linear-gradient(90deg, transparent, var(--ms-divider), transparent);
        margin: 4px 0;
      }
      #buffer-engine-panel .ms-toggle-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 12px;
        gap: 8px;
      }
      #buffer-engine-panel .ms-btn-row {
        display: flex;
        gap: 5px;
        padding: 8px 10px 4px;
      }
      #buffer-engine-panel .ms-btn {
        flex: 1;
        padding: 6px 4px;
        font-family: inherit;
        font-size: var(--ms-fs-xs);
        letter-spacing: 0.05em;
        text-transform: uppercase;
        cursor: pointer;
        border-radius: 3px;
        border: 1px solid var(--ms-border);
        background: var(--ms-bg-input);
        color: var(--ms-text-dim);
        transition: all 0.14s;
      }
      #buffer-engine-panel .ms-btn:hover {
        background: var(--ms-bg-header);
        color: var(--ms-text);
      }
      #buffer-engine-panel .ms-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }
      #buffer-engine-panel .ms-btn-primary {
        border-color: var(--ms-success);
        color: var(--ms-success);
        background: var(--ms-bg-input);
      }
      #buffer-engine-panel .ms-btn-primary:hover {
        background: var(--ms-bg-header);
        color: var(--ms-text);
      }
      #buffer-engine-panel .ms-btn-danger {
        border-color: var(--ms-danger);
        color: var(--ms-danger);
        background: var(--ms-bg-input);
      }
      #buffer-engine-panel .ms-btn-danger:hover {
        background: var(--ms-bg-header);
        color: var(--ms-text);
      }
    `;
    document.head.appendChild(style);
  }

  private _inp(id: string): HTMLInputElement | null {
    return this._panelEl?.querySelector<HTMLInputElement>(`#${id}`) ?? null;
  }

  /** Show a transient tooltip bubble anchored under the "Pick Source" button. */
  private _flashPickTooltip(message: string): void {
    const anchor = this._panelEl?.querySelector<HTMLElement>('#buffer-pick-btn');
    if (!anchor) return;
    if (!this._tooltipEl) {
      const tip = document.createElement('div');
      tip.style.cssText =
        'position:fixed;z-index:1200;background:var(--ms-bg-header,#1e2434);color:var(--ms-text,#fff);' +
        'border:1px solid var(--ms-accent,#378ADD);border-radius:5px;padding:7px 10px;font-size:11px;line-height:1.4;' +
        'max-width:240px;box-shadow:var(--ms-shadow,0 6px 20px rgba(0,0,0,.45));pointer-events:none;opacity:0;transition:opacity .18s;';
      document.body.appendChild(tip);
      this._tooltipEl = tip;
    }
    const tip = this._tooltipEl;
    tip.textContent = message;
    const rect = anchor.getBoundingClientRect();
    tip.style.left = `${Math.max(8, rect.left)}px`;
    tip.style.top = `${rect.bottom + 8}px`;
    void tip.offsetWidth; // force reflow so the transition replays
    tip.style.opacity = '1';
    anchor.animate?.(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }],
      { duration: 360 },
    );
    if (this._tooltipTimer) window.clearTimeout(this._tooltipTimer);
    this._tooltipTimer = window.setTimeout(() => this._hideTooltip(), 4000);
  }

  private _hideTooltip(): void {
    if (this._tooltipTimer) {
      window.clearTimeout(this._tooltipTimer);
      this._tooltipTimer = null;
    }
    if (this._tooltipEl) this._tooltipEl.style.opacity = '0';
  }

  private _setStatus(state: 'awaiting' | 'picking' | 'computing' | 'ready' | 'committed' | 'error'): void {
    const dotEl = this._panelEl?.querySelector<HTMLElement>('#buffer-status-dot');
    const statusTextMap: Record<typeof state, string> = { awaiting: 'Awaiting source', picking: 'Click map', computing: 'Computing', ready: 'Ready', committed: 'Committed', error: 'Error' };
    const message = statusTextMap[state];
    if (state === 'ready' || state === 'committed') EngineLogger.success(ENGINE_NAME, message);
    else if (state === 'error') EngineLogger.error(ENGINE_NAME, message);
    else EngineLogger.nextStep(ENGINE_NAME, message);
    const lblEl = this._panelEl?.querySelector<HTMLElement>('#buffer-status-lbl');
    if (!dotEl || !lblEl) return;
    const map: Record<string, [string, string]> = {
      awaiting: ['#555', 'Awaiting source'],
      picking: ['#378ADD', 'Click map…'],
      computing: ['#EF9F27', 'Computing…'],
      ready: ['#1D9E75', 'Ready'],
      committed: ['#1D9E75', 'Committed ✓'],
      error: ['#E24B4A', 'Error'],
    };
    const [color, label] = map[state] ?? map.awaiting;
    dotEl.style.background = color;
    dotEl.style.boxShadow = `0 0 6px ${color}88`;
    lblEl.textContent = label;
  }

  private _syncCommit(): void {
    const btn = this._panelEl?.querySelector<HTMLButtonElement>('#buffer-commit-btn');
    if (!btn) return;
    btn.disabled = this._analysisLayer.graphics.length === 0 && this._labelLayer.graphics.length === 0;
  }

  private _syncStats(defs: ThreatRingDef[]): void {
    const src = this._panelEl?.querySelector<HTMLElement>('#buffer-st-sources');
    const ring = this._panelEl?.querySelector<HTMLElement>('#buffer-st-rings');
    const out = this._panelEl?.querySelector<HTMLElement>('#buffer-st-outer');
    const mode = this._panelEl?.querySelector<HTMLElement>('#buffer-st-mode');
    if (src) src.textContent = String(this._sourcePoints.length);
    if (ring) ring.textContent = String(defs.length);
    if (out) {
      const maxR = defs.length ? Math.max(...defs.map((d) => d.radiusM)) : 0;
      out.textContent = maxR > 0
        ? (maxR >= 1000 ? `${(maxR / 1000).toFixed(1)} km` : `${maxR} m`)
        : '—';
    }
    if (mode) {
      mode.textContent = this._mode === 'single'
        ? 'Single'
        : this._mode === 'union'
          ? 'Union'
          : 'Corridor';
    }
  }
}

export default BufferEngine;

