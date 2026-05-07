/**
 * BufferEngine.ts
 * Buffer & Threat Rings analysis engine.
 *
 * Integrated with ContextMenuManager via linkBufferEngine().
 * Right-clicking any military symbol -> Analysis -> Buffer abd Threat Rings
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
  private _pickMode: 'replace' | 'add' | null = null;

  private _mode: AnalysisMode = 'single';
  private _presetKey = 'artillery_155mm';
  private _sourcePoints: Point[] = [];

  private _dragOffsetX = 0;
  private _dragOffsetY = 0;
  private _isDragging = false;

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

  open(graphic: Graphic, view: MapView | SceneView): void {
    this.initialize(view);

    if (this._panelEl && this._panelEl.style.display === 'none') {
      this._panelEl.style.display = 'block';
      return;
    }

    const geom = graphic.geometry;
    let src: Point | null = null;
    if (geom?.type === 'point') src = geom as Point;
    else if ((geom as any)?.centroid) src = (geom as any).centroid as Point;

    if (src) {
      if (this._mode === 'single') this._sourcePoints = [src];
      else this._sourcePoints.push(src);
    }

    this._showPanel();
    this._drawSources();
    this._redraw();
  }

  close(): void {
    this._hidePanel();
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
    this._panelEl = null;
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
    const extrudeHeightM = (this._inp('buffer-opt-extrude')?.checked ?? false) ? 300 : 0;
    return rings.flatMap((ring) => {
      if (!ring.geometry) return [];
      const colors = RING_COLORS[ring.colorKey] ?? RING_COLORS.info;
      const [fr, fg, fb, fa] = colors.fill;
      const [or, og, ob, oa] = colors.outline;

      if (is3D) {
        const symbolLayers: any[] = [{
          type: 'fill',
          material: { color: [fr, fg, fb, fa] },
          outline: { color: [or, og, ob, oa], size: 1.5 },
        }];
        if (extrudeHeightM > 0) {
          symbolLayers.push({
            type: 'extrude',
            material: { color: [fr, fg, fb, fa * 0.6] },
            edges: { type: 'solid', color: [or, og, ob, oa * 0.4], size: 0.5 },
            size: extrudeHeightM,
          });
        }
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
    return rings.map((ring) => {
      const colors = RING_COLORS[ring.colorKey] ?? RING_COLORS.info;
      const labelPt = destinationPoint(
        sourcePoint.longitude,
        sourcePoint.latitude,
        0,
        ring.radiusM,
      );
      return new Graphic({
        geometry: new Point({
          longitude: labelPt.longitude,
          latitude: labelPt.latitude,
          spatialReference: { wkid: 4326 },
        }),
        symbol: {
          type: 'text',
          color: colors.label,
          haloColor: [0, 0, 0, 0.7],
          haloSize: 1.5,
          text: `${ring.label}  ${ring.radiusM >= 1000
            ? `${(ring.radiusM / 1000).toFixed(1)} km`
            : `${ring.radiusM} m`}`,
          font: { family: 'Courier New', size: 10, weight: 'bold' },
          horizontalAlignment: 'center',
          verticalAlignment: 'bottom',
        } as any,
        attributes: { type: 'buffer_label', label: ring.label },
      });
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

    const defs = this._currentRings().filter((r) => r.radiusM > 0);
    const showLabels = this._inp('buffer-opt-labels')?.checked ?? true;
    const asDonut = this._inp('buffer-opt-donut')?.checked ?? true;
    const showContested = this._inp('buffer-opt-contested')?.checked ?? false;

    if (this._mode === 'corridor') {
      if (this._sourcePoints.length >= 2) {
        const widthM = Math.max(10, Number(this._inp('buffer-corridor-width')?.value ?? 250));
        const standoffM = Math.max(0, Number(this._inp('buffer-corridor-standoff')?.value ?? 500));
        const path = this._sourcePoints.map((p) => [p.longitude, p.latitude]);
        const line = new Polyline({ paths: [path], spatialReference: { wkid: 4326 } });
        const { corridor, standoff } = this._computeCorridorBuffer(line, widthM, standoffM);
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
        const sortedDefs: ComputedRing[] = [...defs]
          .sort((a, b) => b.radiusM - a.radiusM)
          .map((d) => ({ ...d, geometry: null }));
        this._buildLabelGraphics(this._sourcePoints[0], sortedDefs)
          .forEach((g) => this._labelLayer.add(g));
      }

      if (showContested && this._sourcePoints.length >= 2) {
        const a = this._computeRings(this._sourcePoints[0], defs, false);
        const b = this._computeRings(this._sourcePoints[1], defs, false);
        const contested = this._computeContestedZone(a, b);
        if (contested) this._analysisLayer.add(this._contestedGraphic(contested));
      }
    }

    this._syncStats(defs);
    this._setStatus('ready');
    this._syncCommit();
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
    this._pickMode = mode;
    this._setStatus('picking');
    this._pickHandle = this._view.on('click', async (event: any) => {
      this._cancelPick();
      let point: Point;
      if (this._view?.type === '3d') {
        const hit = await (this._view as any).hitTest(event, {
          include: [(this._view as any).map.ground],
        });
        const gp = hit?.ground?.mapPoint ?? event.mapPoint;
        point = new Point({
          longitude: gp.longitude,
          latitude: gp.latitude,
          z: gp.z ?? 0,
          spatialReference: { wkid: 4326 },
        });
      } else {
        point = new Point({
          longitude: event.mapPoint.longitude,
          latitude: event.mapPoint.latitude,
          z: event.mapPoint.z ?? 0,
          spatialReference: { wkid: 4326 },
        });
      }

      if (mode === 'replace') this._sourcePoints = [point];
      else this._sourcePoints.push(point);

      this._drawSources();
      this._redraw();
    });
  }

  private _cancelPick(): void {
    this._pickHandle?.remove();
    this._pickHandle = null;
    this._pickMode = null;
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
    this._setStatus('committed');
    setTimeout(() => this._setStatus('ready'), 1800);
  }

  private _showPanel(): void {
    if (!this._panelEl) {
      this._panelEl = document.createElement('div');
      this._panelEl.id = 'buffer-engine-panel';
      this._panelEl.className = 'buffer-panel';
      document.body.appendChild(this._panelEl);
    }
    this._panelEl.innerHTML = this._buildPanelHTML();
    this._panelEl.style.display = 'block';
    this._bindPanelEvents();
    this._makeDraggable();
    this._syncStats(this._currentRings());
    this._syncCommit();
    this._setStatus(this._sourcePoints.length > 0 ? 'ready' : 'awaiting');
  }

  private _hidePanel(): void {
    if (this._panelEl) this._panelEl.style.display = 'none';
  }

  private _buildPanelHTML(): string {
    const presetOptions = Object.entries(THREAT_PRESETS)
      .map(([k, p]) => `<option value="${k}"${k === this._presetKey ? ' selected' : ''}>${p.label}</option>`)
      .join('');

    return `
      <div class="buffer-header" id="buffer-drag-handle">
        <span class="buffer-header-icon">⭕</span>
        <span class="buffer-header-title">Buffer abd Threat Rings</span>
        <span class="buffer-status-dot" id="buffer-status-dot"></span>
        <span class="buffer-status-lbl" id="buffer-status-lbl">Awaiting source</span>
        <button class="buffer-close-btn" id="buffer-close-btn" title="Minimise">–</button>
      </div>

      <div class="buffer-body">
        <div class="buffer-sec">Mode</div>
        <div class="buffer-field-full">
          <select id="buffer-mode" class="buffer-select">
            <option value="single"${this._mode === 'single' ? ' selected' : ''}>Single source</option>
            <option value="union"${this._mode === 'union' ? ' selected' : ''}>Multi-source union</option>
            <option value="corridor"${this._mode === 'corridor' ? ' selected' : ''}>Corridor</option>
          </select>
        </div>

        <div class="buffer-sec">Preset</div>
        <div class="buffer-field-full">
          <select id="buffer-preset" class="buffer-select">${presetOptions}</select>
        </div>

        <div id="buffer-corridor-wrap" style="display:${this._mode === 'corridor' ? 'block' : 'none'}">
          <div class="buffer-sec">Corridor</div>
          <div class="buffer-grid">
            <div class="buffer-field">
              <div class="buffer-label">Width (m)</div>
              <input id="buffer-corridor-width" class="buffer-input" type="number" value="250" min="10" step="10" />
            </div>
            <div class="buffer-field">
              <div class="buffer-label">Standoff (m)</div>
              <input id="buffer-corridor-standoff" class="buffer-input" type="number" value="500" min="0" step="10" />
            </div>
          </div>
        </div>

        <div class="buffer-divider"></div>
        <div class="buffer-sec">Display</div>
        <div class="buffer-toggle-row">
          <label class="buffer-label">Donut rings</label>
          <input id="buffer-opt-donut" type="checkbox" class="buffer-check" checked />
        </div>
        <div class="buffer-toggle-row">
          <label class="buffer-label">Show labels</label>
          <input id="buffer-opt-labels" type="checkbox" class="buffer-check" checked />
        </div>
        <div class="buffer-toggle-row">
          <label class="buffer-label">Extrude rings (3D)</label>
          <input id="buffer-opt-extrude" type="checkbox" class="buffer-check" />
        </div>
        <div class="buffer-toggle-row">
          <label class="buffer-label">Show contested zone</label>
          <input id="buffer-opt-contested" type="checkbox" class="buffer-check" />
        </div>

        <div class="buffer-divider"></div>
        <div class="buffer-sec">Legend</div>
        <div class="buffer-legend">
          <div class="buffer-legend-row"><span class="buffer-legend-dot" style="background:#DC3C30"></span><span class="buffer-legend-label">Lethal</span></div>
          <div class="buffer-legend-row"><span class="buffer-legend-dot" style="background:#EF9F27"></span><span class="buffer-legend-label">Warning</span></div>
          <div class="buffer-legend-row"><span class="buffer-legend-dot" style="background:#1D9E75"></span><span class="buffer-legend-label">Safe / Max range</span></div>
          <div class="buffer-legend-row"><span class="buffer-legend-dot" style="background:#378ADD"></span><span class="buffer-legend-label">Info / Observe</span></div>
          <div class="buffer-legend-row"><span class="buffer-legend-dot" style="background:#B428DC"></span><span class="buffer-legend-label">Contested zone</span></div>
        </div>

        <div class="buffer-divider"></div>
        <div class="buffer-stats">
          <div class="buffer-stat"><div class="buffer-stat-lbl">Sources</div><div class="buffer-stat-val" id="buffer-st-sources">0</div></div>
          <div class="buffer-stat"><div class="buffer-stat-lbl">Rings</div><div class="buffer-stat-val" id="buffer-st-rings">0</div></div>
          <div class="buffer-stat"><div class="buffer-stat-lbl">Outer</div><div class="buffer-stat-val" id="buffer-st-outer">—</div></div>
          <div class="buffer-stat"><div class="buffer-stat-lbl">Mode</div><div class="buffer-stat-val" id="buffer-st-mode">Single</div></div>
        </div>

        <div class="buffer-btn-row">
          <button class="buffer-btn" id="buffer-pick-btn">Pick Source</button>
          <button class="buffer-btn" id="buffer-add-btn">Add Source</button>
        </div>
        <div class="buffer-btn-row">
          <button class="buffer-btn" id="buffer-undo-btn">Undo Last</button>
          <button class="buffer-btn buffer-btn-danger" id="buffer-clear-btn">Clear</button>
          <button class="buffer-btn buffer-btn-primary" id="buffer-commit-btn" disabled>Commit ↗</button>
        </div>
      </div>
    `;
  }

  private _bindPanelEvents(): void {
    if (!this._panelEl) return;
    const p = this._panelEl;

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

    ['buffer-opt-donut', 'buffer-opt-labels', 'buffer-opt-extrude', 'buffer-opt-contested']
      .forEach((id) => p.querySelector(`#${id}`)?.addEventListener('change', () => this._redraw()));

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

  private _inp(id: string): HTMLInputElement | null {
    return this._panelEl?.querySelector<HTMLInputElement>(`#${id}`) ?? null;
  }

  private _setStatus(state: 'awaiting' | 'picking' | 'computing' | 'ready' | 'committed' | 'error'): void {
    const dotEl = this._panelEl?.querySelector<HTMLElement>('#buffer-status-dot');
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

  private _injectStyles(): void {
    if (document.getElementById('buffer-engine-styles')) return;
    const style = document.createElement('style');
    style.id = 'buffer-engine-styles';
    style.textContent = `
      .buffer-panel {
        position: fixed;
        top: 60px;
        left: 902px;
        width: 292px;
        background: rgba(16, 18, 24, 0.97);
        border: 1px solid rgba(55, 138, 221, 0.4);
        border-radius: 6px;
        color: #b8c5d8;
        font-family: 'SF Mono', 'Consolas', 'Courier New', monospace;
        font-size: 11px;
        z-index: 1100;
        user-select: none;
        box-shadow: 0 12px 40px rgba(0,0,0,0.65), inset 0 0 0 1px rgba(255,255,255,0.04);
        display: none;
      }
      .buffer-header {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 9px 10px 8px;
        border-bottom: 1px solid rgba(255,255,255,0.07);
        background: rgba(55,138,221,0.08);
        border-radius: 5px 5px 0 0;
        cursor: grab;
      }
      .buffer-header:active { cursor: grabbing; }
      .buffer-header-title {
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #378ADD;
        font-weight: 700;
        flex: 1;
      }
      .buffer-status-dot {
        width: 7px; height: 7px; border-radius: 50%; background: #555; flex-shrink: 0;
      }
      .buffer-status-lbl {
        font-size: 8.5px; letter-spacing: 0.08em; text-transform: uppercase;
        color: #5a6a80; min-width: 58px;
      }
      .buffer-close-btn {
        background: none; border: none; color: #4a5a78; font-size: 13px;
        cursor: pointer; padding: 0 2px; line-height: 1;
      }
      .buffer-close-btn:hover { color: #c0c8e0; }
      .buffer-body { padding: 0 0 6px; }
      .buffer-sec {
        font-size: 8.5px; letter-spacing: 0.1em; text-transform: uppercase;
        color: #3a5070; padding: 9px 12px 4px;
      }
      .buffer-field-full { padding: 0 10px 8px; }
      .buffer-grid {
        display: grid; grid-template-columns: 1fr 1fr; gap: 7px; padding: 0 10px 8px;
      }
      .buffer-field { display: flex; flex-direction: column; gap: 3px; }
      .buffer-label {
        font-size: 8.5px; letter-spacing: 0.07em; text-transform: uppercase; color: #5a7090;
      }
      .buffer-input, .buffer-select {
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 3px; color: #c0cce0;
        font-family: inherit; font-size: 11px; padding: 5px 7px; width: 100%;
        outline: none;
      }
      .buffer-select option { background: #12141a; }
      .buffer-toggle-row {
        display: flex; align-items: center; justify-content: space-between; padding: 4px 12px;
      }
      .buffer-check { accent-color: #378ADD; width: 13px; height: 13px; cursor: pointer; }
      .buffer-divider {
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.07), transparent);
        margin: 4px 0;
      }
      .buffer-stats {
        display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px; padding: 8px 10px 6px;
      }
      .buffer-legend {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px 8px;
        padding: 2px 10px 8px;
      }
      .buffer-legend-row {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }
      .buffer-legend-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .buffer-legend-label {
        font-size: 8px;
        letter-spacing: 0.07em;
        text-transform: uppercase;
        color: #6f7f95;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .buffer-stat { display: flex; flex-direction: column; gap: 2px; }
      .buffer-stat-lbl {
        font-size: 8px; letter-spacing: 0.08em; text-transform: uppercase; color: #506078;
      }
      .buffer-stat-val {
        font-size: 11px; color: #378ADD; font-weight: 700;
      }
      .buffer-btn-row {
        display: flex; gap: 6px; padding: 6px 10px 2px;
      }
      .buffer-btn {
        flex: 1; padding: 6px 4px; font-family: inherit; font-size: 9.5px;
        letter-spacing: 0.05em; text-transform: uppercase; cursor: pointer;
        border-radius: 3px; border: 1px solid rgba(255,255,255,0.12);
        background: rgba(255,255,255,0.04); color: #8a9ab8;
      }
      .buffer-btn:hover { background: rgba(255,255,255,0.1); color: #d0daf0; }
      .buffer-btn:disabled { opacity: 0.35; cursor: not-allowed; }
      .buffer-btn-primary {
        border-color: rgba(55,138,221,0.6); color: #378ADD; background: rgba(55,138,221,0.1);
      }
      .buffer-btn-danger {
        border-color: rgba(226,75,74,0.55); color: #E24B4A; background: rgba(226,75,74,0.08);
      }
    `;
    document.head.appendChild(style);
  }
}

export default BufferEngine;
