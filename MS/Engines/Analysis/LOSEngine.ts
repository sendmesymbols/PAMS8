/**
 * LOSEngine.ts
 * Line-of-Sight / Viewshed analysis engine.
 *
 * 3D SceneView → Uses ArcGIS LineOfSightAnalysis for direct-target LOS
 *                + ArcGIS ViewshedAnalysis for viewshed dome.
 * 2D MapView   → ElevationSampler terrain ray-casting only.
 *
 * Integrated with ContextMenuManager via linkLOSEngine().
 * Right-click any symbol → Analysis → Line of Sight.
 *
 * Layers:
 *   los-analysis   — working graphics (cleared on every run)
 *   los-observer   — observer marker
 *   los-committed  — persisted results after Commit
 */

import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polyline from '@arcgis/core/geometry/Polyline';
import Polygon from '@arcgis/core/geometry/Polygon';
import * as geometryEngine from '@arcgis/core/geometry/geometryEngine';
import * as reactiveUtils from '@arcgis/core/core/reactiveUtils';
import { ElevationUtils } from '../../Support/Elevation/ElevationUtils';

// ─── Geodetic helpers ────────────────────────────────────────────────────────

function _destPt(
  lon: number, lat: number, bearingDeg: number, distM: number
): { longitude: number; latitude: number } {
  const R = 6_371_008.8;
  const δ = distM / R;
  const θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
  );
  const λ2 = λ1 + Math.atan2(
    Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
    Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
  );
  return { longitude: (λ2 * 180) / Math.PI, latitude: (φ2 * 180) / Math.PI };
}

function _bearing(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function _haversineM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6_371_008.8;
  const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180;
  const Δφ = φ2 - φ1, Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface LOSTarget {
  point: Point;
  label: string;
}

interface LOSPanelOverride {
  obsHeight?: number;
  maxRange?: number;
  azStart?: number;
  azEnd?: number;
  elevMin?: number;
  elevMax?: number;
  outputType?: string;
  colorBy?: string;
  analysisMode?: string;
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export class LOSEngine {

  static readonly ANALYSIS_LAYER_ID  = 'los-analysis';
  static readonly OBSERVER_LAYER_ID  = 'los-observer';
  static readonly COMMITTED_LAYER_ID = 'los-committed';

  private _view: MapView | SceneView | null = null;
  private _analysisLayer!: GraphicsLayer;
  private _observerLayer!: GraphicsLayer;
  private _committedLayer!: GraphicsLayer;

  private _observerPoint: Point | null = null;
  private _targets: LOSTarget[] = [];
  private _panelEl: HTMLDivElement | null = null;
  private _pickHandle: any = null;
  private _pickMode: 'observer' | 'target' | null = null;
  private _losAnalysis: any = null;
  private _losAnalysisView: any = null;
  private _losResultsWatch: any = null;
  private _losObserverPoint: Point | null = null;
  private _viewshedAnalysis: any = null;
  private _viewshedAnalysisView: any = null;
  private _committedViewshedAnalysis: any = null;

  // Draggable state
  private _isDragging = false;
  private _dragOffsetX = 0;
  private _dragOffsetY = 0;

  constructor() {
    this._createLayers();
    this._injectStyles();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  initialize(view: MapView | SceneView): void {
    if (this._view === view) return;
    this._view = view;
    const map = view.map as any;
    if (map && typeof map.findLayerById === 'function' && !map.findLayerById(this._analysisLayer.id)) {
      map.addMany([this._committedLayer, this._analysisLayer, this._observerLayer]);
    }
    if (view.type === '3d' && this._committedViewshedAnalysis) {
      try {
        const analyses = (view as any).analyses;
        const alreadyAdded = typeof analyses?.includes === 'function'
          ? analyses.includes(this._committedViewshedAnalysis)
          : false;
        if (!alreadyAdded) analyses?.add?.(this._committedViewshedAnalysis);
      } catch { /* ignore */ }
    }
    this._clearLOSAnalysis();
  }

  open(graphic: Graphic, view: MapView | SceneView): void {
    this.initialize(view);
    const attrs = graphic.attributes ?? {};

    // Re-edit a committed LOS result
    if (attrs.type === 'los_viewshed' && attrs.committedAt != null) {
      this._analysisLayer.removeAll();
      this._observerLayer.removeAll();
      this._targets = [];

      if (attrs.observerLon != null && attrs.observerLat != null) {
        this._observerPoint = new Point({
          longitude: attrs.observerLon,
          latitude:  attrs.observerLat,
          spatialReference: { wkid: 4326 },
        });
      }

      const override: LOSPanelOverride = {
        obsHeight:  attrs.obsHeight  ?? undefined,
        maxRange:   attrs.maxRange   ?? undefined,
        azStart:    attrs.azStart    ?? undefined,
        azEnd:      attrs.azEnd      ?? undefined,
        elevMin:    attrs.elevMin    ?? undefined,
        elevMax:    attrs.elevMax    ?? undefined,
        outputType: attrs.outputType ?? undefined,
        colorBy:    attrs.colorBy    ?? undefined,
        analysisMode: attrs.analysisMode ?? undefined,
      };

      this._showPanel(override);
      if (this._observerPoint) this._drawObserver();
      return;
    }

    // Resume minimised panel
    if (this._panelEl && this._observerPoint && this._panelEl.style.display === 'none') {
      this._panelEl.style.display = 'block';
      return;
    }

    // Normal open — set observer from right-clicked graphic
    const geom = graphic.geometry;
    if (geom?.type === 'point') {
      this._observerPoint = geom as Point;
    } else if ((geom as any)?.centroid) {
      this._observerPoint = (geom as any).centroid as Point;
    } else {
      this._observerPoint = null;
    }

    this._targets = [];
    this._showPanel();
    if (this._observerPoint) this._drawObserver();
  }

  close(): void {
    this._hidePanel();
    this._analysisLayer.removeAll();
    this._observerLayer.removeAll();
    this._cancelPick();
    this._clearLOSAnalysis();
    this._observerPoint = null;
    this._targets = [];
  }

  destroy(): void {
    this._onDragEnd();
    this.close();
    this._clearCommittedViewshedAnalysis();
    const map = this._view?.map as any;
    if (map) {
      map.remove(this._analysisLayer);
      map.remove(this._committedLayer);
      map.remove(this._observerLayer);
    }
    this._panelEl?.remove();
    this._panelEl = null;
    this._view = null;
  }

  // ─── Private: Layers ────────────────────────────────────────────────────────

  private _createLayers(): void {
    this._analysisLayer = new GraphicsLayer({
      id: LOSEngine.ANALYSIS_LAYER_ID,
      title: 'LOS — Working',
      elevationInfo: { mode: 'absolute-height' } as any,
    });
    this._observerLayer = new GraphicsLayer({
      id: LOSEngine.OBSERVER_LAYER_ID,
      title: 'LOS — Observer',
      elevationInfo: { mode: 'absolute-height' } as any,
    });
    this._committedLayer = new GraphicsLayer({
      id: LOSEngine.COMMITTED_LAYER_ID,
      title: 'LOS — Committed',
      elevationInfo: { mode: 'absolute-height' } as any,
    });
  }

  // ─── Private: 3D LineOfSightAnalysis ─────────────────────────────────────────

  private _clearLOSAnalysis(): void {
    if (this._losResultsWatch) {
      this._losResultsWatch.remove();
      this._losResultsWatch = null;
    }
    this._losObserverPoint = null;
    this._losAnalysisView = null;
    if (this._losAnalysis && this._view?.type === '3d') {
      const sv = this._view as SceneView;
      try {
        (sv as any).analyses?.remove(this._losAnalysis);
      } catch { /* ignore */ }
      this._losAnalysis = null;
    }

    this._viewshedAnalysisView = null;
    if (this._viewshedAnalysis && this._view?.type === '3d') {
      const sv = this._view as SceneView;
      try {
        (sv as any).analyses?.remove(this._viewshedAnalysis);
      } catch { /* ignore */ }
      this._viewshedAnalysis = null;
    }
  }

  private _clearCommittedViewshedAnalysis(): void {
    if (this._committedViewshedAnalysis && this._view?.type === '3d') {
      const sv = this._view as SceneView;
      try {
        (sv as any).analyses?.remove(this._committedViewshedAnalysis);
      } catch { /* ignore */ }
    }
    this._committedViewshedAnalysis = null;
  }

  private _engineMode(): string {
    return this._sel('los-analysis-mode')?.value ?? 'Auto';
  }

  private _useArcGIS3D(): boolean {
    return this._view?.type === '3d' && this._engineMode() !== 'Terrain ray trace';
  }

  private _setCommitEnabled(enabled: boolean): void {
    const commitBtn = this._panelEl?.querySelector<HTMLButtonElement>('#los-commit-btn');
    if (commitBtn) commitBtn.disabled = !enabled;
  }

  private async _runLOS3D(): Promise<boolean> {
    if (!this._observerPoint || !this._view || this._view.type !== '3d') return false;
    if (this._targets.length === 0) return false;

    const sv = this._view as SceneView;
    const obsH = Number(this._inp('los-obsheight')?.value ?? 2);

    try {
      const [
        { default: LineOfSightAnalysis },
        { default: LineOfSightAnalysisObserver },
        { default: LineOfSightAnalysisTarget },
      ] = await Promise.all([
        import('@arcgis/core/analysis/LineOfSightAnalysis'),
        import('@arcgis/core/analysis/LineOfSightAnalysisObserver'),
        import('@arcgis/core/analysis/LineOfSightAnalysisTarget'),
      ]);

      this._clearLOSAnalysis();

      const observerPt = new Point({
        longitude: this._observerPoint.longitude,
        latitude:  this._observerPoint.latitude,
        z: (this._observerPoint.z ?? 0) + obsH,
        spatialReference: { wkid: 4326 },
      });
      this._losObserverPoint = observerPt;

      const observer = new LineOfSightAnalysisObserver({ position: observerPt });
      const targets  = this._targets.map(t => new LineOfSightAnalysisTarget({ position: t.point }));

      this._losAnalysis = new LineOfSightAnalysis({ observer, targets });
      (sv as any).analyses.add(this._losAnalysis);

      this._losAnalysisView = await (sv as any).whenAnalysisView(this._losAnalysis);
      this._losResultsWatch = reactiveUtils.watch(
        () => this._losAnalysisView?.results.map((r: any) => r?.intersectedLocation),
        () => this._updateLOS3DResults()
      );

      return true;

    } catch (err) {
      console.error('[LOSEngine] 3D LOS error:', err);
      return false;
    }
  }

  private _updateLOS3DResults(): void {
    if (!this._losAnalysisView || !this._analysisLayer) return;

    const results = this._losAnalysisView.results ?? [];
    const obsPt = this._losObserverPoint ?? this._observerPoint;
    if (!obsPt) return;

    const oldLines = this._analysisLayer.graphics.filter((g: Graphic) =>
      ['los_visible', 'los_masked', 'los_obstruction'].includes(g.attributes?.type)
    );
    oldLines.forEach((g: Graphic) => this._analysisLayer.remove(g));

    results.forEach((result: any, idx: number) => {
      const target = this._targets[idx];
      if (!target) return;

      const visible = !result?.intersectedLocation;
      const tgtPt = target.point;

      if (visible) {
        this._analysisLayer.add(this._makeLOSLine(obsPt, tgtPt, true));
      } else {
        const interPt = result.intersectedLocation;
        if (interPt) {
          this._analysisLayer.add(this._makeLOSLine(obsPt, interPt, true));
          this._analysisLayer.add(this._makeLOSLine(interPt, tgtPt, false));
          this._analysisLayer.add(new Graphic({
            geometry: interPt,
            symbol: this._obstructionSymbol(),
            attributes: { type: 'los_obstruction' },
          }));
        } else {
          this._analysisLayer.add(this._makeLOSLine(obsPt, tgtPt, false));
        }
      }
    });
  }

  private async _runViewshed3D(): Promise<boolean> {
    if (!this._observerPoint || !this._view || this._view.type !== '3d') return false;

    const sv = this._view as SceneView;
    const obsH = Number(this._inp('los-obsheight')?.value ?? 2);
    const maxR = Math.max(100, Number(this._inp('los-maxrange')?.value ?? 5000));
    const azStart = Number(this._inp('los-az-start')?.value ?? 0);
    const azEnd = Number(this._inp('los-az-end')?.value ?? 360);
    const elevMin = Number(this._inp('los-elevmin')?.value ?? -10);
    const elevMax = Number(this._inp('los-elevmax')?.value ?? 45);
    const azSweep = ((azEnd - azStart) + 360) % 360 || 360;
    const heading = (azStart + azSweep / 2) % 360;
    const horizontalFieldOfView = Math.min(360, Math.max(1, azSweep));
    const verticalFieldOfView = Math.min(180, Math.max(1, elevMax - elevMin));
    const tilt = Math.min(180, Math.max(0, 90 + ((elevMin + elevMax) / 2)));

    try {
      const [
        { default: Viewshed },
        { default: ViewshedAnalysis },
      ] = await Promise.all([
        import('@arcgis/core/analysis/Viewshed'),
        import('@arcgis/core/analysis/ViewshedAnalysis'),
      ]);

      const observerPt = new Point({
        longitude: this._observerPoint.longitude,
        latitude: this._observerPoint.latitude,
        z: (this._observerPoint.z ?? 0) + obsH,
        spatialReference: { wkid: 4326 },
      });

      const viewshed = new Viewshed({
        observer: observerPt,
        farDistance: maxR,
        heading,
        tilt,
        horizontalFieldOfView,
        verticalFieldOfView,
      });

      this._viewshedAnalysis = new ViewshedAnalysis({ viewsheds: [viewshed] });
      (sv as any).analyses.add(this._viewshedAnalysis);
      this._viewshedAnalysisView = await (sv as any).whenAnalysisView(this._viewshedAnalysis);
      return true;
    } catch (err) {
      console.error('[LOSEngine] 3D viewshed error:', err);
      return false;
    }
  }

  private async _ensureCommittedViewshedAnalysis(): Promise<any> {
    if (!this._view || this._view.type !== '3d') return null;

    const sv = this._view as SceneView;
    if (!this._committedViewshedAnalysis) {
      const { default: ViewshedAnalysis } = await import('@arcgis/core/analysis/ViewshedAnalysis');
      this._committedViewshedAnalysis = new ViewshedAnalysis();
    }

    const analyses = (sv as any).analyses;
    try {
      const alreadyAdded = typeof analyses?.includes === 'function'
        ? analyses.includes(this._committedViewshedAnalysis)
        : false;
      if (!alreadyAdded) analyses?.add?.(this._committedViewshedAnalysis);
    } catch { /* ignore */ }

    return this._committedViewshedAnalysis;
  }

  // ─── Private: Terrain ray-cast LOS + Viewshed ────────────────────────────────

private async _runTerrain(skipLines: boolean = false): Promise<void> {
    if (!this._observerPoint || !this._view) return;

    const obsH  = Number(this._inp('los-obsheight')?.value ?? 2);
    const maxR  = Math.max(100, Number(this._inp('los-maxrange')?.value ?? 5000));
    const out   = this._sel('los-output')?.value ?? 'Both';
    const doLines  = !skipLines && out !== 'Viewshed dome';
    const doDome   = out !== 'LOS line only';

    this._setStatus('computing');

    try {
      // Build extent for sampler - expand to include targets
      let maxTargetDist = 0;
      for (const { point: tgt } of this._targets) {
        const d = _haversineM(this._observerPoint.longitude, this._observerPoint.latitude, tgt.longitude, tgt.latitude);
        if (d > maxTargetDist) maxTargetDist = d;
      }
      const sampleExtent = Math.max(maxR, maxTargetDist * 1.1);

      const extentGeom = geometryEngine.geodesicBuffer(this._observerPoint, sampleExtent, 'meters');
      const extent = Array.isArray(extentGeom)
        ? extentGeom[0]?.extent
        : (extentGeom as Polygon | null)?.extent;
      if (!extent) { this._setStatus('error'); return; }

      const sampler = await ElevationUtils.createSampler(this._view, extent, {
        noDataValue: 0,
        // Use a fixed DEM resolution so navigation does not change LOS output.
        demResolution: 30,
      });
      const obsGroundZ = ElevationUtils.queryPointElevation(sampler, this._observerPoint);
      const obsZ = obsGroundZ + obsH;

      // ── Point-to-point LOS lines ───────────────────────────────────────────
      if (doLines && this._targets.length > 0) {
        for (const { point: tgt } of this._targets) {
          const tDist = _haversineM(
            this._observerPoint.longitude, this._observerPoint.latitude,
            tgt.longitude, tgt.latitude
          );
          const tBearing = _bearing(
            this._observerPoint.longitude, this._observerPoint.latitude,
            tgt.longitude, tgt.latitude
          );
          const stepM = Math.max(10, tDist / 180);
          const numSteps = Math.ceil(tDist / stepM);
          let obstrPt: Point | null = null;
          const tGroundZ = ElevationUtils.queryPointElevation(sampler, { longitude: tgt.longitude, latitude: tgt.latitude });
          const tZ = (tgt.z ?? 0) !== 0 ? (tgt.z ?? tGroundZ) : tGroundZ;

          for (let s = 1; s <= numSteps && !obstrPt; s++) {
            const dist = (s / numSteps) * tDist;
            const pt = _destPt(this._observerPoint.longitude, this._observerPoint.latitude, tBearing, dist);
            const samplePt = { longitude: pt.longitude, latitude: pt.latitude };
            const terrZ = ElevationUtils.queryPointElevation(sampler, samplePt);
            const losZ = obsZ + ((tZ - obsZ) * dist) / tDist;

            // Compare terrain directly against the observer-to-target ray.
            if (terrZ > losZ + 1) {
              obstrPt = new Point({ longitude: pt.longitude, latitude: pt.latitude, spatialReference: { wkid: 4326 } });
            }
          }
          const visible = !obstrPt;

          if (visible) {
            this._analysisLayer.add(this._makeLOSLine(this._observerPoint, tgt, true));
          } else {
            if (obstrPt) {
              this._analysisLayer.add(this._makeLOSLine(this._observerPoint, obstrPt, true));
              this._analysisLayer.add(this._makeLOSLine(obstrPt, tgt, false));
              this._analysisLayer.add(new Graphic({
                geometry: obstrPt,
                symbol: this._obstructionSymbol(),
                attributes: { type: 'los_obstruction' },
              }));
            } else {
              this._analysisLayer.add(this._makeLOSLine(this._observerPoint, tgt, false));
            }
          }
        }
      }

      // ── Viewshed dome ──────────────────────────────────────────────────────
      if (doDome) {
        const azStart  = Number(this._inp('los-az-start')?.value ?? 0);
        const azEnd    = Number(this._inp('los-az-end')?.value   ?? 360);
        const elevMin  = Number(this._inp('los-elevmin')?.value  ?? -10);
        const elevMax  = Number(this._inp('los-elevmax')?.value  ?? 45);
        const colorBy  = this._sel('los-colorby')?.value ?? 'Range';
        const azStep   = 4; // degrees per ray
        const STEP_M   = Math.max(20, maxR / 150);
        const numSteps = Math.ceil(maxR / STEP_M);
        const azSweep  = ((azEnd - azStart) + 360) % 360 || 360;
        const numRays  = Math.max(4, Math.ceil(azSweep / azStep));
        const elevMinRad = (elevMin * Math.PI) / 180;
        const elevMaxRad = (elevMax * Math.PI) / 180;

        const obsLon = this._observerPoint.longitude;
        const obsLat = this._observerPoint.latitude;

        // Visible sector: one horizon/limit point per azimuth ray
        const visibleRing: number[][] = [[obsLon, obsLat]];
        let visibleRayCount = 0;

        for (let i = 0; i < numRays; i++) {
          const bearing = (azStart + (i / (numRays - 1 || 1)) * azSweep) % 360;
          let maxSlopeRad = -Infinity;
          let visibleDist = 0;

          for (let s = 1; s <= numSteps; s++) {
            const dist = s * STEP_M;
            const pt = _destPt(obsLon, obsLat, bearing, dist);
            const terrZ = ElevationUtils.queryPointElevation(sampler, {
              longitude: pt.longitude,
              latitude: pt.latitude,
            });
            const slopeRad = Math.atan2(terrZ - obsZ, dist);

            if (slopeRad >= maxSlopeRad) {
              maxSlopeRad = slopeRad;
            }

            if (maxSlopeRad >= elevMinRad && maxSlopeRad <= elevMaxRad) {
              visibleDist = dist;
            }

            if (maxSlopeRad > elevMaxRad) {
              break;
            }
          }

          if (visibleDist <= 0) {
            visibleRing.push([obsLon, obsLat]);
          } else {
            const dest = _destPt(obsLon, obsLat, bearing, visibleDist);
            visibleRing.push([dest.longitude, dest.latitude]);
            visibleRayCount++;
          }
        }
        visibleRing.push([obsLon, obsLat]);

        if (visibleRing.length > 3 && visibleRayCount > 0) {
          this._analysisLayer.add(new Graphic({
            geometry: new Polygon({ rings: [visibleRing], spatialReference: { wkid: 4326 } }),
            symbol: this._viewshedSymbol(colorBy),
            attributes: {
              type: 'los_viewshed',
              obsHeight: obsH, maxRange: maxR,
              azStart, azEnd, elevMin, elevMax,
              outputType: out, colorBy,
            },
          }));
        }

        // Range rings for context
        [0.33, 0.66, 1].forEach(frac => {
          const r = maxR * frac;
          const ringRaw = geometryEngine.geodesicBuffer(this._observerPoint, r, 'meters');
          const ring = Array.isArray(ringRaw) ? ringRaw[0] : ringRaw;
          if (ring) {
            this._analysisLayer.add(new Graphic({
              geometry: ring as Polygon,
              symbol: {
                type: 'simple-fill',
                color: [55, 138, 221, 0],
                outline: { color: [55, 138, 221, 50], width: 0.6, style: 'short-dash' },
              } as any,
              attributes: { type: 'los_ring' },
            }));
          }
        });
      }

      this._setStatus('ready');
      this._setCommitEnabled(true);

    } catch (err) {
      console.error('[LOSEngine] Terrain computation error:', err);
      this._setStatus('error');
    }
  }

  // ─── Private: Run orchestration ──────────────────────────────────────────────

  private async _run(): Promise<void> {
    if (!this._observerPoint || !this._view) return;
    this._analysisLayer.removeAll();
    this._drawTargetMarkers();
    this._clearLOSAnalysis();
    this._setStatus('computing');
    this._setCommitEnabled(false);

    const out = this._sel('los-output')?.value ?? 'Both';
    let usedNative3D = false;

    if (this._useArcGIS3D()) {
      if (this._targets.length > 0 && out !== 'Viewshed dome') {
        usedNative3D = await this._runLOS3D() || usedNative3D;
      }
      if (out !== 'LOS line only') {
        usedNative3D = await this._runViewshed3D() || usedNative3D;
      }
      if (usedNative3D) {
        this._setStatus('ready');
        this._setCommitEnabled(true);
        return;
      }
    }

    // Terrain ray-cast (for 2D or fallback when 3D native analysis is unavailable)
    await this._runTerrain(false);
  }

  // ─── Private: Observer / Target drawing ─────────────────────────────────────

  private _drawObserver(): void {
    if (!this._observerPoint) return;
    this._observerLayer.removeAll();
    this._observerLayer.add(new Graphic({
      geometry: this._observerPoint,
      symbol: this._observerSymbol(),
      attributes: { type: 'los_observer' },
    }));

    const coordsEl = this._panelEl?.querySelector<HTMLElement>('#los-coords');
    if (coordsEl) {
      const lat = (this._observerPoint.latitude  ?? 0).toFixed(5);
      const lon = (this._observerPoint.longitude ?? 0).toFixed(5);
      coordsEl.textContent = `Observer: ${lat}°N  ${lon}°E`;
    }
  }

  private _drawTargetMarkers(): void {
    this._analysisLayer.graphics
      .filter((g: Graphic) => g.attributes?.type === 'los_target')
      .forEach((g: Graphic) => this._analysisLayer.remove(g));

    this._targets.forEach((tgt, i) => {
      this._analysisLayer.add(new Graphic({
        geometry: tgt.point,
        symbol: this._targetSymbol(),
        attributes: { type: 'los_target', index: i },
      }));
    });
  }

  // ─── Private: Symbols ────────────────────────────────────────────────────────

  private _is3D(): boolean { return this._view?.type === '3d'; }

  private _observerSymbol(): any {
    if (this._is3D()) {
      return {
        type: 'point-3d',
        symbolLayers: [{
          type: 'object',
          resource: { primitive: 'sphere' },
          material: { color: [55, 138, 221, 230] },
          width: 60, height: 60, depth: 60,
        }],
        verticalOffset: { screenLength: 24, maxWorldLength: 400, minWorldLength: 4 },
      } as any;
    }
    return {
      type: 'simple-marker',
      style: 'cross',
      color: [55, 138, 221, 220],
      size: 14,
      outline: { color: [255, 255, 255, 180], width: 1.5 },
    } as any;
  }

  private _targetSymbol(): any {
    if (this._is3D()) {
      return {
        type: 'point-3d',
        symbolLayers: [{
          type: 'object',
          resource: { primitive: 'cone' },
          material: { color: [226, 75, 74, 200] },
          width: 40, height: 80, depth: 40,
        }],
      } as any;
    }
    return {
      type: 'simple-marker',
      style: 'x',
      color: [226, 75, 74, 220],
      size: 12,
      outline: { color: [255, 255, 255, 160], width: 1.5 },
    } as any;
  }

  private _makeLOSLine(from: Point, to: Point, visible: boolean): Graphic {
    const color = visible ? [29, 158, 117, 220] : [226, 75, 74, 200];
    const geom = new Polyline({
      paths: [[[from.longitude, from.latitude, from.z ?? 0], [to.longitude, to.latitude, to.z ?? 0]]],
      spatialReference: { wkid: 4326 },
      hasZ: true,
    });
    const symbol: any = this._is3D()
      ? { type: 'line-3d', symbolLayers: [{ type: 'line', material: { color }, size: 2, cap: 'round' }] }
      : { type: 'simple-line', color, width: 2, style: visible ? 'solid' : 'short-dash' };

    return new Graphic({ geometry: geom, symbol, attributes: { type: visible ? 'los_visible' : 'los_masked' } });
  }

  private _obstructionSymbol(): any {
    return {
      type: 'simple-marker',
      style: 'circle',
      color: [226, 75, 74, 200],
      size: 8,
      outline: { color: [255, 200, 200, 220], width: 1.5 },
    } as any;
  }

  private _viewshedSymbol(colorBy: string): any {
    const alpha = 80;
    const fill: Record<string, number[]> = {
      'Range':            [239, 159, 39,  alpha],
      'Elevation angle':  [55,  138, 221, alpha],
      'Binary':           [29,  158, 117, alpha],
    };
    const outline: Record<string, number[]> = {
      'Range':            [239, 159, 39,  160],
      'Elevation angle':  [55,  138, 221, 160],
      'Binary':           [29,  158, 117, 160],
    };
    const fc = fill[colorBy]    ?? fill['Binary'];
    const oc = outline[colorBy] ?? outline['Binary'];

    if (this._is3D()) {
      return {
        type: 'polygon-3d',
        symbolLayers: [{ type: 'fill', material: { color: fc }, outline: { color: oc, size: 1 } }],
      } as any;
    }
    return { type: 'simple-fill', color: fc, outline: { color: oc, width: 1 } } as any;
  }

  // ─── Private: Commit ────────────────────────────────────────────────────────

  private async _commit(): Promise<void> {
    const hasGraphicResults = this._analysisLayer.graphics.length > 0;
    const hasViewshedAnalysis = !!this._viewshedAnalysis?.viewsheds?.length;
    if (!this._observerPoint || (!hasGraphicResults && !hasViewshedAnalysis)) return;
    const ts = new Date().toISOString();
    const meta = {
      committedAt:  ts,
      observerLon:  this._observerPoint.longitude  ?? 0,
      observerLat:  this._observerPoint.latitude   ?? 0,
      obsHeight:    Number(this._inp('los-obsheight')?.value  ?? 2),
      maxRange:     Number(this._inp('los-maxrange')?.value   ?? 5000),
      azStart:      Number(this._inp('los-az-start')?.value   ?? 0),
      azEnd:        Number(this._inp('los-az-end')?.value     ?? 360),
      elevMin:      Number(this._inp('los-elevmin')?.value    ?? -10),
      elevMax:      Number(this._inp('los-elevmax')?.value    ?? 45),
      outputType:   this._sel('los-output')?.value,
      colorBy:      this._sel('los-colorby')?.value,
      analysisMode: this._engineMode(),
    };

    if (hasViewshedAnalysis && this._view?.type === '3d') {
      const committedViewshedAnalysis = await this._ensureCommittedViewshedAnalysis();
      const viewsheds = this._viewshedAnalysis.viewsheds;
      const count = typeof viewsheds?.length === 'number'
        ? viewsheds.length
        : typeof viewsheds?.getItemAt === 'function'
          ? viewsheds.length
          : 0;
      for (let i = 0; i < count; i++) {
        const viewshed = typeof viewsheds.getItemAt === 'function' ? viewsheds.getItemAt(i) : viewsheds[i];
        committedViewshedAnalysis?.viewsheds?.add?.(viewshed?.clone?.() ?? viewshed);
      }
    }

    this._analysisLayer.graphics.forEach((g: Graphic) => {
      if (!g.geometry) return;
      const symbol = (g as any).symbol;
      const clonedSymbol = symbol && typeof symbol.clone === 'function' ? symbol.clone() : symbol ?? undefined;
      this._committedLayer.add(new Graphic({
        geometry:   g.geometry.clone(),
        symbol:     clonedSymbol,
        attributes: { ...g.attributes, ...meta },
      }));
    });
    this._observerLayer.graphics.forEach((g: Graphic) => {
      if (!g.geometry) return;
      const symbol = (g as any).symbol;
      const clonedSymbol = symbol && typeof symbol.clone === 'function' ? symbol.clone() : symbol ?? undefined;
      this._committedLayer.add(new Graphic({
        geometry:   g.geometry.clone(),
        symbol:     clonedSymbol,
        attributes: hasViewshedAnalysis ? { ...g.attributes, ...meta, type: 'los_viewshed' } : { ...g.attributes, committedAt: ts },
      }));
    });

    this._setStatus('committed');
    setTimeout(() => this._setStatus('ready'), 2000);
  }

  // ─── Private: Picking ────────────────────────────────────────────────────────

  private _startPick(mode: 'observer' | 'target'): void {
    if (!this._view) return;
    this._cancelPick();
    this._pickMode = mode;
    this._setStatus('picking');

    const coordsEl = this._panelEl?.querySelector<HTMLElement>('#los-coords');
    if (mode === 'observer' && coordsEl) coordsEl.textContent = '⊕  Click map to place observer…';

    this._pickHandle = this._view.on('click', async (event: any) => {
      this._cancelPick();
      const obsH = Number(this._inp('los-obsheight')?.value ?? 2);
      let pt: Point;

      if (this._is3D()) {
        const sv = this._view as SceneView;
        const hit = await sv.hitTest(event);
        let gp = event.mapPoint;

        if (hit?.results?.length) {
          for (const r of hit.results) {
            if (r.graphic?.layer?.type === 'ground' || (r.graphic?.layer as any)?.id === 'ground') {
              gp = r.mapPoint;
              break;
            }
            if (!gp.z && r.mapPoint?.z) {
              gp = r.mapPoint;
            }
          }
        }

        if (!gp.z || gp.z === 0) {
          try {
            const ptWithZ = ElevationUtils.queryPointElevation(null, { longitude: gp.longitude, latitude: gp.latitude });
            if (ptWithZ != null) {
              gp = new Point({
                longitude: gp.longitude,
                latitude: gp.latitude,
                z: ptWithZ,
                spatialReference: { wkid: 4326 },
              });
            }
          } catch { gp = new Point({ longitude: gp.longitude, latitude: gp.latitude, z: 0, spatialReference: { wkid: 4326 } }); }
        }

        pt = new Point({
          longitude: gp.longitude,
          latitude:  gp.latitude,
          z: gp.z + (mode === 'observer' ? obsH : 2),
          spatialReference: { wkid: 4326 },
        });
      } else {
        pt = new Point({
          longitude: event.mapPoint.longitude,
          latitude:  event.mapPoint.latitude,
          spatialReference: { wkid: 4326 },
        });
      }

      if (mode === 'observer') {
        this._observerPoint = pt;
        this._drawObserver();
        const out = this._sel('los-output')?.value ?? 'Both';
        if (this._targets.length > 0 || out !== 'LOS line only') {
          await this._run();
        } else {
          this._setStatus('ready');
        }
      } else {
        const label = `T${this._targets.length + 1}`;
        this._targets.push({ point: pt, label });
        this._drawTargetMarkers();
        this._updateTargetList();
        if (this._observerPoint) await this._run();
        else this._setStatus('ready');
      }
    });
  }

  private _cancelPick(): void {
    this._pickHandle?.remove();
    this._pickHandle = null;
    this._pickMode = null;
  }

  private _updateTargetList(): void {
    const listEl = this._panelEl?.querySelector<HTMLElement>('#los-target-list');
    if (!listEl) return;

    if (this._targets.length === 0) {
      listEl.innerHTML = '<div class="los-no-targets">No targets — use "Add Target" to pick on map</div>';
      return;
    }

    listEl.innerHTML = this._targets.map((t, i) => `
      <div class="los-target-item">
        <span class="los-ti-label">${t.label}</span>
        <span class="los-ti-coords">${(t.point.latitude ?? 0).toFixed(4)}°N  ${(t.point.longitude ?? 0).toFixed(4)}°E</span>
        <button class="los-ti-remove" data-idx="${i}">✕</button>
      </div>
    `).join('');

    listEl.onclick = async (e) => {
      const btn = (e.target as HTMLElement)?.closest('.los-ti-remove');
      if (!btn) return;
      const idx = parseInt((btn as HTMLElement).dataset.idx ?? '0');
      this._targets.splice(idx, 1);
      this._targets.forEach((t, j) => { t.label = `T${j + 1}`; });
      this._drawTargetMarkers();
      this._updateTargetList();
      if (this._observerPoint) {
        const out = this._sel('los-output')?.value ?? 'Both';
        if (this._targets.length > 0 || out !== 'LOS line only') {
          await this._run();
        } else {
          this._analysisLayer.removeAll();
          this._drawTargetMarkers();
          this._clearLOSAnalysis();
          this._setStatus('ready');
          this._setCommitEnabled(false);
        }
      }
    };
  }

  // ─── Private: Panel ──────────────────────────────────────────────────────────

  private _showPanel(override?: LOSPanelOverride): void {
    if (!this._panelEl) {
      this._panelEl = document.createElement('div');
      this._panelEl.id = 'los-engine-panel';
      this._panelEl.className = 'los-panel';
      document.body.appendChild(this._panelEl);
    }
    this._panelEl.innerHTML = this._buildPanelHTML(override);
    this._panelEl.style.display = 'block';
    this._bindPanelEvents();
    this._makeDraggable();
    this._updateTargetList();
  }

  private _hidePanel(): void {
    if (this._panelEl) this._panelEl.style.display = 'none';
  }

  private _buildPanelHTML(override?: LOSPanelOverride): string {
    const v = override ?? {};
    const obsH    = v.obsHeight   ?? 2;
    const maxR    = v.maxRange    ?? 5000;
    const azStart = v.azStart     ?? 0;
    const azEnd   = v.azEnd       ?? 360;
    const elevMin = v.elevMin     ?? -10;
    const elevMax = v.elevMax     ?? 45;
    const output  = v.outputType  ?? 'Both';
    const colorBy = v.colorBy     ?? 'Range';
    const analysisMode = v.analysisMode ?? 'Auto';
    const isEdit  = override != null;

    const outputOpts = ['LOS line only', 'Viewshed dome', 'Both'];
    const colorOpts  = ['Range', 'Elevation angle', 'Binary'];
    const analysisOpts = ['Auto', 'ArcGIS native 3D', 'Terrain ray trace'];

    return `
      <div class="los-header" id="los-drag-handle">
        <span class="los-header-icon">👁️</span>
        <span class="los-header-title">LOS Analysis${isEdit ? ' — Re-edit' : ''}</span>
        <span class="los-status-dot" id="los-status-dot"></span>
        <span class="los-status-lbl" id="los-status-lbl">${isEdit ? 'Restored' : 'Awaiting'}</span>
        <button class="los-minimize-btn" id="los-minimize-btn" title="Minimize">▼</button>
        <button class="los-close-btn" id="los-close-btn" title="Close (keeps graphics)">✕</button>
      </div>

      <div class="los-body">

        <div class="los-sec">Output Type</div>
        <div class="los-field-full">
          <select id="los-output" class="los-select">
            ${outputOpts.map(o => `<option value="${o}"${o===output?' selected':''}>${o}</option>`).join('')}
          </select>
        </div>
        <div class="los-field-full">
          <div class="los-label">Analysis Engine</div>
          <select id="los-analysis-mode" class="los-select">
            ${analysisOpts.map(o => `<option value="${o}"${o===analysisMode?' selected':''}>${o}</option>`).join('')}
          </select>
        </div>

        <div class="los-divider"></div>
        <div class="los-sec">Observer</div>
        <div class="los-grid">
          <div class="los-field">
            <div class="los-label">Height (m)</div>
            <input id="los-obsheight" class="los-input" type="number" value="${obsH}" min="0" max="100" step="0.5" />
          </div>
          <div class="los-field los-field-btn">
            <div class="los-label">Reposition</div>
            <button class="los-btn los-btn-sm" id="los-obs-pick-btn">Pick ⊕</button>
          </div>
        </div>
        <div class="los-coords" id="los-coords">${
          this._observerPoint
            ? `Observer: ${(this._observerPoint.latitude ?? 0).toFixed(5)}°N  ${(this._observerPoint.longitude ?? 0).toFixed(5)}°E`
            : 'Observer: symbol location set — reposition if needed'
        }</div>

        <div class="los-divider"></div>
        <div class="los-sec">Targets <span class="los-sec-note">— for LOS lines</span></div>
        <div class="los-grid">
          <div class="los-field">
            <button class="los-btn" id="los-add-target-btn">+ Add Target</button>
          </div>
          <div class="los-field">
            <button class="los-btn" id="los-clear-targets-btn">Clear Targets</button>
          </div>
        </div>
        <div id="los-target-list" class="los-target-list"></div>

        <div class="los-divider"></div>
        <div class="los-sec">Viewshed Parameters</div>
        <div class="los-grid">
          <div class="los-field">
            <div class="los-label">Max range (m)</div>
            <input id="los-maxrange" class="los-input" type="number" value="${maxR}" min="100" step="100" />
          </div>
          <div class="los-field">
            <div class="los-label">Colour by</div>
            <select id="los-colorby" class="los-select">
              ${colorOpts.map(o => `<option value="${o}"${o===colorBy?' selected':''}>${o}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="los-slider-row">
          <span class="los-label">Az start (°)</span>
          <input id="los-az-start" type="range" min="0" max="359" value="${azStart}" step="1" class="los-slider" />
          <span class="los-slider-val" id="los-az-start-val">${String(azStart).padStart(3,'0')}°</span>
        </div>
        <div class="los-slider-row">
          <span class="los-label">Az end (°)</span>
          <input id="los-az-end" type="range" min="1" max="360" value="${azEnd}" step="1" class="los-slider" />
          <span class="los-slider-val" id="los-az-end-val">${String(azEnd).padStart(3,'0')}°</span>
        </div>

        <div class="los-sec">Elevation Envelope</div>
        <div class="los-grid">
          <div class="los-field">
            <div class="los-label">Min elev (°)</div>
            <input id="los-elevmin" class="los-input" type="number" value="${elevMin}" min="-30" max="89" step="1" />
          </div>
          <div class="los-field">
            <div class="los-label">Max elev (°)</div>
            <input id="los-elevmax" class="los-input" type="number" value="${elevMax}" min="-5" max="90" step="1" />
          </div>
        </div>

        <div class="los-divider"></div>
        <div class="los-btn-row">
          <button class="los-btn los-btn-run" id="los-run-btn">▶ Run</button>
          <button class="los-btn" id="los-clear-btn">Clear</button>
          <button class="los-btn los-btn-primary" id="los-commit-btn" ${isEdit?'':'disabled'}>Commit ↗</button>
        </div>
        <div class="los-legend">
          <span class="los-leg-visible">— Visible</span>
          <span class="los-leg-masked">- - Masked</span>
          <span class="los-leg-obstr">● Obstruction</span>
        </div>

      </div>
    `;
  }

  private _bindPanelEvents(): void {
    if (!this._panelEl) return;
    const p = this._panelEl;

    p.querySelector('#los-close-btn')?.addEventListener('click', () => {
      this._hidePanel();
      this._cancelPick();
    });

    p.querySelector('#los-minimize-btn')?.addEventListener('click', () => {
      const body = p.querySelector<HTMLElement>('.los-body');
      const btn  = p.querySelector<HTMLElement>('#los-minimize-btn');
      if (!body || !btn) return;
      const minimized = body.style.display === 'none';
      body.style.display = minimized ? '' : 'none';
      btn.textContent = minimized ? '▼' : '▶';
    });

    p.querySelector('#los-obs-pick-btn')?.addEventListener('click', () => this._startPick('observer'));
    p.querySelector('#los-add-target-btn')?.addEventListener('click', () => this._startPick('target'));

    p.querySelector('#los-clear-targets-btn')?.addEventListener('click', () => {
      this._targets = [];
      this._drawTargetMarkers();
      this._clearLOSAnalysis();
      // Remove LOS line graphics but keep viewshed
      const toRemove = this._analysisLayer.graphics.filter((g: Graphic) =>
        ['los_target','los_visible','los_masked','los_obstruction'].includes(g.attributes?.type)
      );
      toRemove.forEach((g: Graphic) => this._analysisLayer.remove(g));
      this._updateTargetList();
    });

    p.querySelector('#los-run-btn')?.addEventListener('click', () => this._run());

    p.querySelector('#los-clear-btn')?.addEventListener('click', () => {
      this._analysisLayer.removeAll();
      this._observerLayer.removeAll();
      this._targets = [];
      this._clearLOSAnalysis();
      this._observerPoint = null;
      const coordsEl = p.querySelector<HTMLElement>('#los-coords');
      if (coordsEl) coordsEl.textContent = 'Observer: click map to place';
      this._setCommitEnabled(false);
      this._updateTargetList();
      this._setStatus('awaiting');
    });

    p.querySelector('#los-commit-btn')?.addEventListener('click', () => this._commit());

    p.querySelector('#los-az-start')?.addEventListener('input', (e) => {
      const v = (e.target as HTMLInputElement).value;
      (p.querySelector('#los-az-start-val') as HTMLElement).textContent = v.padStart(3,'0') + '°';
    });
    p.querySelector('#los-az-end')?.addEventListener('input', (e) => {
      const v = (e.target as HTMLInputElement).value;
      (p.querySelector('#los-az-end-val') as HTMLElement).textContent = v.padStart(3,'0') + '°';
    });
  }

  private _makeDraggable(): void {
    const handle = this._panelEl?.querySelector<HTMLElement>('#los-drag-handle');
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
    this._panelEl.style.left  = `${Math.max(0, e.clientX - this._dragOffsetX)}px`;
    this._panelEl.style.top   = `${Math.max(0, e.clientY - this._dragOffsetY)}px`;
    this._panelEl.style.right = 'auto';
  };

  private _onDragEnd = (): void => {
    this._isDragging = false;
    document.removeEventListener('mousemove', this._onDragMove);
    document.removeEventListener('mouseup', this._onDragEnd);
  };

  // ─── Private: Helpers ────────────────────────────────────────────────────────

  private _setStatus(state: 'awaiting'|'picking'|'computing'|'ready'|'committed'|'error'): void {
    const dotEl = this._panelEl?.querySelector<HTMLElement>('#los-status-dot');
    const lblEl = this._panelEl?.querySelector<HTMLElement>('#los-status-lbl');
    if (!dotEl || !lblEl) return;
    const map: Record<string,[string,string]> = {
      awaiting:  ['#555',    'Awaiting observer'],
      picking:   ['#378ADD', 'Click map…'],
      computing: ['#EF9F27', 'Computing…'],
      ready:     ['#1D9E75', 'Ready'],
      committed: ['#1D9E75', 'Committed ✓'],
      error:     ['#E24B4A', 'Error'],
    };
    const [color, label] = map[state] ?? map.awaiting;
    dotEl.style.background = color;
    dotEl.style.boxShadow  = `0 0 6px ${color}88`;
    lblEl.textContent = label;
  }

  private _inp(id: string): HTMLInputElement | null {
    return this._panelEl?.querySelector<HTMLInputElement>(`#${id}`) ?? null;
  }

  private _sel(id: string): HTMLSelectElement | null {
    return this._panelEl?.querySelector<HTMLSelectElement>(`#${id}`) ?? null;
  }

  // ─── Private: Styles ─────────────────────────────────────────────────────────

  private _injectStyles(): void {
    if (document.getElementById('los-engine-styles')) return;
    const style = document.createElement('style');
    style.id = 'los-engine-styles';
    style.textContent = `
      .los-panel {
        position: fixed;
        top: 60px;
        left: 310px;
        width: 284px;
        background: var(--ms-bg);
        border: 1px solid var(--ms-border);
        border-radius: var(--ms-radius);
        color: var(--ms-text);
        font-family: var(--ms-font);
        font-size: var(--ms-fs);
        z-index: 1100;
        user-select: none;
        box-shadow: var(--ms-shadow);
        display: none;
        animation: losPanelIn 0.18s cubic-bezier(0.34,1.56,0.64,1);
      }
      @keyframes losPanelIn {
        from { opacity:0; transform:scale(0.94) translateY(-8px); }
        to   { opacity:1; transform:scale(1) translateY(0); }
      }
      .los-header {
        display:flex; align-items:center; gap:7px;
        padding:9px 10px 8px;
        border-bottom:1px solid var(--ms-divider);
        background:var(--ms-bg-header);
        border-radius:5px 5px 0 0;
        cursor:grab;
      }
      .los-header:active { cursor:grabbing; }
      .los-header-icon { font-size:15px; flex-shrink:0; }
      .los-header-title {
        font-size:var(--ms-fs-sm); letter-spacing:0.12em; text-transform:uppercase;
        color:var(--ms-accent); font-weight:700; flex:1;
      }
      .los-status-dot {
        width:7px; height:7px; border-radius:50%; background:#555; flex-shrink:0;
        transition:background 0.3s, box-shadow 0.3s;
      }
      .los-status-lbl {
        font-size:var(--ms-fs-xs); letter-spacing:0.08em; text-transform:uppercase;
        color:var(--ms-text-dim); min-width:52px;
      }
      .los-minimize-btn, .los-close-btn {
        background:none; border:none; color:var(--ms-text-dim); font-size:var(--ms-fs-sm);
        cursor:pointer; padding:0 2px; line-height:1; transition:color 0.15s; flex-shrink:0;
      }
      .los-minimize-btn:hover, .los-close-btn:hover { color:var(--ms-text); }
      .los-body { padding:0 0 6px; }
      .los-sec {
        font-size:var(--ms-fs-xs); letter-spacing:0.1em; text-transform:uppercase;
        color:var(--ms-text-label); padding:9px 12px 4px;
      }
      .los-sec-note { font-size:var(--ms-fs-xs); opacity:0.6; text-transform:none; letter-spacing:0; }
      .los-divider {
        height:1px;
        background:linear-gradient(90deg, transparent, var(--ms-divider), transparent);
        margin:4px 0;
      }
      .los-grid {
        display:grid; grid-template-columns:1fr 1fr; gap:7px; padding:0 10px 8px;
      }
      .los-field { display:flex; flex-direction:column; gap:3px; }
      .los-field-full { padding:0 10px 8px; }
      .los-field-btn { justify-content:flex-end; }
      .los-label {
        font-size:var(--ms-fs-xs); letter-spacing:0.07em; text-transform:uppercase; color:var(--ms-text-dim);
      }
      .los-input, .los-select {
        background:var(--ms-bg-input);
        border:1px solid var(--ms-border);
        border-radius:3px; color:var(--ms-text);
        font-family:inherit; font-size:var(--ms-fs); padding:5px 7px;
        width:100%; outline:none; transition:border-color 0.15s;
      }
      .los-input:focus, .los-select:focus { border-color:var(--ms-accent); }
      .los-select option { background:var(--ms-bg); }
      .los-slider-row {
        display:flex; align-items:center; gap:8px; padding:2px 10px 6px;
      }
      .los-slider-row .los-label { flex:1; }
      .los-slider { flex:2; accent-color:var(--ms-accent); cursor:pointer; }
      .los-slider-val { font-size:var(--ms-fs-sm); color:var(--ms-accent); min-width:34px; text-align:right; }
      .los-coords {
        font-size:var(--ms-fs-xs); color:var(--ms-accent); padding:2px 12px 6px;
        letter-spacing:0.04em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
      }
      .los-target-list {
        padding:0 10px 4px; display:flex; flex-direction:column; gap:3px;
        max-height:88px; overflow-y:auto;
      }
      .los-target-list::-webkit-scrollbar { width:4px; }
      .los-target-list::-webkit-scrollbar-thumb { background:var(--ms-border); border-radius:2px; }
      .los-no-targets { font-size:var(--ms-fs-xs); color:var(--ms-text-label); font-style:italic; padding:4px 2px; }
      .los-target-item {
        display:flex; align-items:center; gap:5px; font-size:var(--ms-fs-sm);
        padding:3px 6px;
        background:var(--ms-bg-input);
        border:1px solid var(--ms-border);
        border-radius:3px;
      }
      .los-ti-label { color:var(--ms-accent); font-weight:700; min-width:18px; }
      .los-ti-coords {
        flex:1; color:var(--ms-text-dim); font-size:var(--ms-fs-xs);
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
      }
      .los-ti-remove {
        background:none; border:none; color:var(--ms-danger); cursor:pointer;
        font-size:var(--ms-fs-sm); padding:0 2px; opacity:0.7; flex-shrink:0;
      }
      .los-ti-remove:hover { opacity:1; }
      .los-btn-row { display:flex; gap:5px; padding:8px 10px 4px; }
      .los-btn {
        flex:1; padding:6px 4px;
        font-family:inherit; font-size:var(--ms-fs-xs); letter-spacing:0.05em; text-transform:uppercase;
        cursor:pointer; border-radius:3px;
        border:1px solid var(--ms-border);
        background:var(--ms-bg-input); color:var(--ms-text-dim); transition:all 0.14s;
      }
      .los-btn:hover { background:var(--ms-bg-header); color:var(--ms-text); }
      .los-btn:disabled { opacity:0.3; cursor:not-allowed; }
      .los-btn-sm { flex:0 0 auto; padding:4px 8px; font-size:var(--ms-fs-xs); }
      .los-btn-run {
        border-color:var(--ms-accent); color:var(--ms-accent); background:var(--ms-bg-input);
      }
      .los-btn-run:hover { background:var(--ms-bg-header); color:var(--ms-text); }
      .los-btn-primary {
        border-color:var(--ms-success); color:var(--ms-success); background:var(--ms-bg-input);
      }
      .los-btn-primary:hover { background:var(--ms-bg-header); color:var(--ms-text); }
      .los-legend {
        display:flex; gap:10px; padding:2px 12px 4px; flex-wrap:wrap;
      }
      .los-legend span { font-size:var(--ms-fs-xs); }
      .los-leg-visible { color:var(--ms-success); }
      .los-leg-masked  { color:var(--ms-danger); }
      .los-leg-obstr   { color:var(--ms-danger); opacity:0.75; }
    `;
    document.head.appendChild(style);
  }
}

export default LOSEngine;
