/**
 * LOSEngine.ts
 * Line-of-Sight / Viewshed analysis engine.
 *
 * 3D SceneView → Uses fixed-resolution terrain ray-casting for direct-target LOS
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
import EngineLogger from '../../Support/EngineLogger';

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
  nativeInteractive?: boolean;
}
const ENGINE_NAME = 'LOSEngine';

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
  private _losAnalysis: any = null;
  private _losAnalysisView: any = null;
  private _losResultsWatch: any = null;
  private _committedLOSAnalyses: any[] = [];
  private _viewshedAnalysis: any = null;
  private _viewshedAnalysisView: any = null;
  private _viewshedLayer: any = null;
  private _viewshedLayerView: any = null;
  private _committedViewshedAnalysis: any = null;
  private _committedViewshedLayer: any = null;
  private _nativeStateWatches: any[] = [];

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
    if (view.type === '3d' && this._committedLOSAnalyses.length) {
      const analyses = (view as any).analyses;
      this._committedLOSAnalyses.forEach((analysis) => {
        try {
          const alreadyAdded = typeof analyses?.includes === 'function'
            ? analyses.includes(analysis)
            : false;
          if (!alreadyAdded) analyses?.add?.(analysis);
        } catch { /* ignore */ }
      });
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
        nativeInteractive: attrs.nativeInteractive ?? undefined,
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
    this._clearNativeStateWatches();
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
    if (this._viewshedLayer && this._view?.map) {
      try {
        (this._view.map as any).remove(this._viewshedLayer);
      } catch { /* ignore */ }
      this._viewshedLayer = null;
      this._viewshedLayerView = null;
    }
  }

  private _clearCommittedViewshedAnalysis(): void {
    if (this._view?.type === '3d') {
      const sv = this._view as SceneView;
      this._committedLOSAnalyses.forEach((analysis) => {
        try {
          (sv as any).analyses?.remove(analysis);
        } catch { /* ignore */ }
      });
    }
    this._committedLOSAnalyses = [];
    if (this._committedViewshedAnalysis && this._view?.type === '3d') {
      const sv = this._view as SceneView;
      try {
        (sv as any).analyses?.remove(this._committedViewshedAnalysis);
      } catch { /* ignore */ }
    }
    this._committedViewshedAnalysis = null;
    if (this._committedViewshedLayer && this._view?.map) {
      try {
        (this._view.map as any).remove(this._committedViewshedLayer);
      } catch { /* ignore */ }
    }
    this._committedViewshedLayer = null;
  }

  private _engineMode(): string {
    return this._sel('los-analysis-mode')?.value ?? 'Auto';
  }

  private _isTerrainMode(): boolean {
    return this._engineMode().startsWith('Terrain ray trace');
  }

  private _useViewshedLayerMode(): boolean {
    return this._engineMode() === 'ArcGIS native 3D layer';
  }

  private _nativeInteractiveEnabled(): boolean {
    return this._panelEl?.querySelector<HTMLInputElement>('#los-native-interactive')?.checked ?? true;
  }

  private _useArcGIS3D(): boolean {
    return this._view?.type === '3d' && !this._isTerrainMode();
  }

  private _setCommitEnabled(enabled: boolean): void {
    const commitBtn = this._panelEl?.querySelector<HTMLButtonElement>('#los-commit-btn');
    if (commitBtn) commitBtn.disabled = !enabled;
  }

  private _clearNativeStateWatches(): void {
    this._nativeStateWatches.forEach((handle) => {
      try {
        handle?.remove?.();
      } catch { /* ignore */ }
    });
    this._nativeStateWatches = [];
  }

  private _round(value: number, digits: number = 1): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  private _normalizeDeg(value: number): number {
    return ((value % 360) + 360) % 360;
  }

  private _setNumericInput(id: string, value: number, digits: number = 1): void {
    const input = this._inp(id);
    if (input) input.value = String(this._round(value, digits));
  }

  private _setSliderInput(id: string, value: number, labelId: string): void {
    const rounded = Math.round(value);
    const input = this._inp(id);
    const label = this._panelEl?.querySelector<HTMLElement>(`#${labelId}`);
    if (input) input.value = String(rounded);
    if (label) label.textContent = String(rounded).padStart(3, '0') + '°';
  }

  private _updateNativeInteractivityUI(): void {
    const checkbox = this._panelEl?.querySelector<HTMLInputElement>('#los-native-interactive');
    const note = this._panelEl?.querySelector<HTMLElement>('#los-native-interactive-note');
    if (!checkbox || !note) return;
    const enabled = this._useArcGIS3D();
    checkbox.disabled = !enabled;
    note.textContent = enabled
      ? 'Drag native 3D handles to edit LOS and viewshed in scene'
      : 'Native 3D handles are available only in SceneView native mode';
  }

  private _applyNativeInteractivity(): void {
    const interactive = this._useArcGIS3D() && this._nativeInteractiveEnabled();
    if (this._losAnalysisView) {
      this._losAnalysisView.interactive = interactive;
    }
    if (this._viewshedAnalysisView) {
      this._viewshedAnalysisView.interactive = interactive;
      const selectedViewshed = this._viewshedAnalysis?.viewsheds?.getItemAt?.(0)
        ?? this._viewshedAnalysis?.viewsheds?.[0]
        ?? null;
      this._viewshedAnalysisView.selectedViewshed = selectedViewshed;
    }
    if (this._viewshedLayerView) {
      this._viewshedLayerView.interactive = interactive;
      const selectedViewshed = this._viewshedLayer?.source?.viewsheds?.getItemAt?.(0)
        ?? this._viewshedLayer?.source?.viewsheds?.[0]
        ?? null;
      this._viewshedLayerView.selectedViewshed = selectedViewshed;
    }
  }

  private _syncObserverFromNative(position: Point | null | undefined): void {
    if (!position) return;

    const input = this._inp('los-obsheight');
    const currentHeight = Number(input?.value ?? 2);
    const groundZ = position.z != null ? position.z - currentHeight : 0;

    if (input) input.value = String(this._round(currentHeight, 1));
    this._observerPoint = new Point({
      longitude: position.longitude,
      latitude: position.latitude,
      z: groundZ,
      spatialReference: { wkid: 4326 },
    });
    this._drawObserver();
  }

  private _syncTargetsFromNative(): void {
    const targets = this._losAnalysis?.targets;
    if (!targets) return;

    const count = typeof targets.length === 'number' ? targets.length : 0;
    this._targets = [];
    for (let i = 0; i < count; i++) {
      const target = typeof targets.getItemAt === 'function' ? targets.getItemAt(i) : targets[i];
      const pos = target?.position;
      if (!pos) continue;
      this._targets.push({
        point: new Point({
          longitude: pos.longitude,
          latitude: pos.latitude,
          z: pos.z ?? 0,
          spatialReference: { wkid: 4326 },
        }),
        label: `T${this._targets.length + 1}`,
      });
    }
    this._drawTargetMarkers();
    this._updateTargetList();
  }

  private _syncViewshedFromNative(): void {
    const viewshed = this._viewshedAnalysisView?.selectedViewshed
      ?? this._viewshedAnalysis?.viewsheds?.getItemAt?.(0)
      ?? this._viewshedAnalysis?.viewsheds?.[0]
      ?? this._viewshedLayerView?.selectedViewshed
      ?? this._viewshedLayer?.source?.viewsheds?.getItemAt?.(0)
      ?? this._viewshedLayer?.source?.viewsheds?.[0]
      ?? null;
    if (!viewshed) return;

    this._syncObserverFromNative(viewshed.observer ?? null);
    this._setNumericInput('los-maxrange', viewshed.farDistance ?? 5000, 0);

    const horizontalFieldOfView = viewshed.horizontalFieldOfView ?? 360;
    if (horizontalFieldOfView >= 359.5) {
      this._setSliderInput('los-az-start', 0, 'los-az-start-val');
      this._setSliderInput('los-az-end', 360, 'los-az-end-val');
    } else {
      const azStart = this._normalizeDeg((viewshed.heading ?? 0) - horizontalFieldOfView / 2);
      let azEnd = this._normalizeDeg((viewshed.heading ?? 0) + horizontalFieldOfView / 2);
      if (azEnd === 0) azEnd = 360;
      this._setSliderInput('los-az-start', azStart, 'los-az-start-val');
      this._setSliderInput('los-az-end', azEnd, 'los-az-end-val');
    }

    const verticalFieldOfView = viewshed.verticalFieldOfView ?? 45;
    const elevCenter = (viewshed.tilt ?? 90) - 90;
    const elevMin = elevCenter - verticalFieldOfView / 2;
    const elevMax = elevCenter + verticalFieldOfView / 2;
    this._setNumericInput('los-elevmin', elevMin, 1);
    this._setNumericInput('los-elevmax', elevMax, 1);
  }

  private _watchNativeAnalysisState(): void {
    this._clearNativeStateWatches();

    if (this._losAnalysis) {
      this._nativeStateWatches.push(reactiveUtils.watch(
        () => [
          this._losAnalysis?.observer?.position?.longitude ?? null,
          this._losAnalysis?.observer?.position?.latitude ?? null,
          this._losAnalysis?.observer?.position?.z ?? null,
          ...(this._losAnalysis?.targets?.map((target: any) => {
            const pos = target?.position;
            return pos ? [pos.longitude, pos.latitude, pos.z ?? null].join('|') : 'null';
          }) ?? []),
        ],
        () => {
          this._syncObserverFromNative(this._losAnalysis?.observer?.position ?? null);
          this._syncTargetsFromNative();
          this._updateLOS3DResults();
          this._setCommitEnabled(true);
        }
      ));
    }

    if (this._viewshedAnalysisView) {
      this._nativeStateWatches.push(reactiveUtils.watch(
        () => {
          const viewshed = this._viewshedAnalysisView?.selectedViewshed
            ?? this._viewshedAnalysis?.viewsheds?.getItemAt?.(0)
            ?? this._viewshedAnalysis?.viewsheds?.[0]
            ?? null;
          return viewshed ? [
            viewshed.observer?.longitude ?? null,
            viewshed.observer?.latitude ?? null,
            viewshed.observer?.z ?? null,
            viewshed.farDistance ?? null,
            viewshed.heading ?? null,
            viewshed.tilt ?? null,
            viewshed.horizontalFieldOfView ?? null,
            viewshed.verticalFieldOfView ?? null,
          ] : null;
        },
        () => {
          this._syncViewshedFromNative();
          this._setCommitEnabled(true);
        }
      ));
    }
    if (this._viewshedLayerView) {
      this._nativeStateWatches.push(reactiveUtils.watch(
        () => {
          const viewshed = this._viewshedLayerView?.selectedViewshed
            ?? this._viewshedLayer?.source?.viewsheds?.getItemAt?.(0)
            ?? this._viewshedLayer?.source?.viewsheds?.[0]
            ?? null;
          return viewshed ? [
            viewshed.observer?.longitude ?? null,
            viewshed.observer?.latitude ?? null,
            viewshed.observer?.z ?? null,
            viewshed.farDistance ?? null,
            viewshed.heading ?? null,
            viewshed.tilt ?? null,
            viewshed.horizontalFieldOfView ?? null,
            viewshed.verticalFieldOfView ?? null,
          ] : null;
        },
        () => {
          this._syncViewshedFromNative();
          this._setCommitEnabled(true);
        }
      ));
    }
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
      const observer = new LineOfSightAnalysisObserver({ position: observerPt });
      const targets  = this._targets.map(t => new LineOfSightAnalysisTarget({ position: t.point }));

      this._losAnalysis = new LineOfSightAnalysis({ observer, targets });
      (sv as any).analyses.add(this._losAnalysis);

      this._losAnalysisView = await (sv as any).whenAnalysisView(this._losAnalysis);
      this._applyNativeInteractivity();
      this._losResultsWatch = reactiveUtils.watch(
        () => this._losAnalysisView?.results.map((r: any) =>
          [r?.visible ?? null, r?.intersectedLocation?.longitude ?? null, r?.intersectedLocation?.latitude ?? null].join('|')
        ),
        () => this._updateLOS3DResults()
      );
      this._watchNativeAnalysisState();

      return true;

    } catch (err) {
      console.error('[LOSEngine] 3D LOS error:', err);
      return false;
    }
  }

  private _updateLOS3DResults(): void {
    if (!this._losAnalysisView || !this._analysisLayer) return;

    const results = this._losAnalysisView.results ?? [];
    const oldLines = this._analysisLayer.graphics.filter((g: Graphic) =>
      ['los_visible', 'los_masked', 'los_obstruction'].includes(g.attributes?.type)
    );
    oldLines.forEach((g: Graphic) => this._analysisLayer.remove(g));

    results.forEach((result: any, idx: number) => {
      const target = this._targets[idx];
      if (!target) return;
      if (!result) return;

      const visible = result?.visible === true;
      if (!visible) {
        const interPt = result.intersectedLocation;
        if (interPt) {
          this._analysisLayer.add(new Graphic({
            geometry: interPt,
            symbol: this._obstructionSymbol(),
            attributes: { type: 'los_obstruction' },
          }));
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
        { default: ViewshedLayer },
      ] = await Promise.all([
        import('@arcgis/core/analysis/Viewshed'),
        import('@arcgis/core/analysis/ViewshedAnalysis'),
        import('@arcgis/core/layers/ViewshedLayer'),
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
      if (this._useViewshedLayerMode()) {
        this._viewshedLayer = new ViewshedLayer({
          id: 'los-viewshed-working-layer',
          title: 'LOS Viewshed — Working',
          source: this._viewshedAnalysis,
        });
        (sv.map as any).add(this._viewshedLayer);
        this._viewshedLayerView = await (sv as any).whenLayerView(this._viewshedLayer);
      } else {
        (sv as any).analyses.add(this._viewshedAnalysis);
        this._viewshedAnalysisView = await (sv as any).whenAnalysisView(this._viewshedAnalysis);
      }
      this._applyNativeInteractivity();
      this._watchNativeAnalysisState();
      return true;
    } catch (err) {
      console.error('[LOSEngine] 3D viewshed error:', err);
      return false;
    }
  }

  private async _ensureCommittedViewshedAnalysis(): Promise<any> {
    if (!this._view || this._view.type !== '3d') return null;

    const sv = this._view as SceneView;
    if (this._useViewshedLayerMode()) {
      if (!this._committedViewshedAnalysis) {
        const { default: ViewshedAnalysis } = await import('@arcgis/core/analysis/ViewshedAnalysis');
        this._committedViewshedAnalysis = new ViewshedAnalysis();
      }
      if (!this._committedViewshedLayer) {
        const { default: ViewshedLayer } = await import('@arcgis/core/layers/ViewshedLayer');
        this._committedViewshedLayer = new ViewshedLayer({
          id: 'los-viewshed-committed-layer',
          title: 'LOS Viewshed — Committed',
          source: this._committedViewshedAnalysis,
        });
      }
      const map = sv.map as any;
      if (map && !map.layers?.includes?.(this._committedViewshedLayer)) {
        map.add(this._committedViewshedLayer);
      }
      return this._committedViewshedAnalysis;
    }

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

private async _runTerrain(skipLines: boolean = false, skipDome: boolean = false): Promise<void> {
    const observerPoint = this._observerPoint;
    if (!observerPoint || !this._view) return;
    const obsLon = Number(observerPoint.longitude);
    const obsLat = Number(observerPoint.latitude);

    const obsH  = Number(this._inp('los-obsheight')?.value ?? 2);
    const maxR  = Math.max(100, Number(this._inp('los-maxrange')?.value ?? 5000));
    const out   = this._sel('los-output')?.value ?? 'Both';
    const doLines  = !skipLines && out !== 'Viewshed dome';
    const doDome   = !skipDome && out !== 'LOS line only';

    this._setStatus('computing');

    try {
      // Build extent for sampler - expand to include targets
      let maxTargetDist = 0;
      for (const { point: tgt } of this._targets) {
        const tgtLon = Number(tgt.longitude);
        const tgtLat = Number(tgt.latitude);
        const d = _haversineM(obsLon, obsLat, tgtLon, tgtLat);
        if (d > maxTargetDist) maxTargetDist = d;
      }
      const sampleExtent = Math.max(maxR, maxTargetDist * 1.1);

      const extentGeom = geometryEngine.geodesicBuffer(observerPoint, sampleExtent, 'meters');
      const extent = Array.isArray(extentGeom)
        ? extentGeom[0]?.extent
        : (extentGeom as Polygon | null)?.extent;
      if (!extent) { this._setStatus('error'); return; }

      const sampler = await ElevationUtils.createSampler(this._view, extent, {
        noDataValue: 0,
        // Use a fixed DEM resolution so navigation does not change LOS output.
        demResolution: 30,
      });
      const obsGroundZ = ElevationUtils.queryPointElevation(sampler, observerPoint);
      const obsZ = obsGroundZ + obsH;
      const obsEyePoint = new Point({
        longitude: obsLon,
        latitude: obsLat,
        z: obsZ,
        spatialReference: { wkid: 4326 },
      });

      // ── Point-to-point LOS lines ───────────────────────────────────────────
      if (doLines && this._targets.length > 0) {
        for (const { point: tgt } of this._targets) {
          const tgtLon = Number(tgt.longitude);
          const tgtLat = Number(tgt.latitude);
          const tDist = _haversineM(
            obsLon, obsLat,
            tgtLon, tgtLat
          );
          const tBearing = _bearing(
            obsLon, obsLat,
            tgtLon, tgtLat
          );
          const stepM = Math.max(10, tDist / 180);
          const numSteps = Math.ceil(tDist / stepM);
          let obstrPt: Point | null = null;
          const tGroundZ = ElevationUtils.queryPointElevation(sampler, { longitude: tgtLon, latitude: tgtLat });
          const tZ = (tgt.z ?? 0) !== 0 ? (tgt.z ?? tGroundZ) : tGroundZ;
          const targetPoint = new Point({
            longitude: tgtLon,
            latitude: tgtLat,
            z: tZ,
            spatialReference: { wkid: 4326 },
          });

          for (let s = 1; s <= numSteps && !obstrPt; s++) {
            const dist = (s / numSteps) * tDist;
            const pt = _destPt(obsLon, obsLat, tBearing, dist);
            const samplePt = { longitude: pt.longitude, latitude: pt.latitude };
            const terrZ = ElevationUtils.queryPointElevation(sampler, samplePt);
            const losZ = obsZ + ((tZ - obsZ) * dist) / tDist;

            // Compare terrain directly against the observer-to-target ray.
            if (terrZ > losZ + 1) {
              obstrPt = new Point({
                longitude: pt.longitude,
                latitude: pt.latitude,
                z: terrZ,
                spatialReference: { wkid: 4326 },
              });
            }
          }
          const visible = !obstrPt;

          if (visible) {
            this._analysisLayer.add(this._makeLOSLine(obsEyePoint, targetPoint, true));
          } else {
            if (obstrPt) {
              this._analysisLayer.add(this._makeLOSLine(obsEyePoint, obstrPt, true));
              this._analysisLayer.add(this._makeLOSLine(obstrPt, targetPoint, false));
              this._analysisLayer.add(new Graphic({
                geometry: obstrPt,
                symbol: this._obstructionSymbol(),
                attributes: { type: 'los_obstruction' },
              }));
            } else {
              this._analysisLayer.add(this._makeLOSLine(obsEyePoint, targetPoint, false));
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
          const ringRaw = geometryEngine.geodesicBuffer(observerPoint, r, 'meters');
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
    let usedAnalysis = false;

    if (this._useArcGIS3D()) {
      if (out === 'LOS line only' && this._targets.length === 0) {
        this._setStatus('error');
        this._setCommitEnabled(false);
        return;
      }

      if (this._targets.length > 0 && out !== 'Viewshed dome') {
        // Native 3D LOS can flip when pan/zoom changes streamed terrain or scene LOD.
        // Keep Auto deterministic by using the fixed DEM sampler; explicit native mode remains available.
        if (this._engineMode() === 'ArcGIS native 3D') {
          usedAnalysis = await this._runLOS3D();
          if (!usedAnalysis) {
            await this._runTerrain(false, true);
            usedAnalysis = true;
          }
        } else {
          await this._runTerrain(false, true);
          usedAnalysis = true;
        }
      }

      if (out !== 'LOS line only') {
        usedAnalysis = await this._runViewshed3D() || usedAnalysis;
      }

      if (usedAnalysis) {
        this._setStatus('ready');
        this._setCommitEnabled(true);
        return;
      }
      this._setStatus('error');
      this._setCommitEnabled(false);
      return;
    }

    // Terrain ray-cast is used for MapView or when explicitly selected.
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
      paths: [[[Number(from.longitude), Number(from.latitude), from.z ?? 0], [Number(to.longitude), Number(to.latitude), to.z ?? 0]]],
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
      nativeInteractive: this._nativeInteractiveEnabled(),
    };

    if (this._losAnalysis && this._view?.type === '3d') {
      try {
        const clone = this._losAnalysis.clone?.() ?? null;
        if (clone) {
          (this._view as any).analyses?.add?.(clone);
          this._committedLOSAnalyses.push(clone);
        }
      } catch { /* ignore */ }
    }

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
    this._setStatus('picking');

    const coordsEl = this._panelEl?.querySelector<HTMLElement>('#los-coords');
    if (mode === 'observer' && coordsEl) coordsEl.textContent = '⊕  Click map to place observer…';

    this._pickHandle = this._view.on('click', async (event: any) => {
      this._cancelPick();
      let pt: Point;

      if (this._is3D()) {
        const sv = this._view as SceneView;
        const hit = await sv.hitTest(event);
        let gp = event.mapPoint;

        if (hit?.results?.length) {
          for (const r of hit.results) {
            const graphic = (r as any).graphic;
            const mapPoint = (r as any).mapPoint;
            if (graphic?.layer?.type === 'ground' || graphic?.layer?.id === 'ground') {
              gp = mapPoint;
              break;
            }
            if (!gp.z && mapPoint?.z) {
              gp = mapPoint;
            }
          }
        }

        if (!gp.z || gp.z === 0) {
          gp = new Point({
            longitude: gp.longitude,
            latitude: gp.latitude,
            z: gp.z ?? 0,
            spatialReference: { wkid: 4326 },
          });
        }

        pt = new Point({
          longitude: gp.longitude,
          latitude:  gp.latitude,
          z: mode === 'observer' ? gp.z : gp.z + 2,
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
    const analysisModeRaw = v.analysisMode ?? 'Auto';
    const analysisMode = analysisModeRaw === 'Terrain ray trace'
      ? 'Terrain ray trace (approx)'
      : analysisModeRaw;
    const nativeInteractive = v.nativeInteractive ?? true;
    const isEdit  = override != null;

    const outputOpts = ['LOS line only', 'Viewshed dome', 'Both'];
    const colorOpts  = ['Range', 'Elevation angle', 'Binary'];
    const analysisOpts = ['Auto', 'ArcGIS native 3D', 'ArcGIS native 3D layer', 'Terrain ray trace (approx)'];

    return `
      <div class="los-header" id="los-drag-handle">
        <span class="los-header-icon">◉</span>
        <span class="los-header-title">LOS Analysis${isEdit ? ' — Re-edit' : ''}</span>
        <span class="los-status-dot" id="los-status-dot"></span>
        <span class="los-status-lbl" id="los-status-lbl">${isEdit ? 'Restored' : 'Awaiting'}</span>
        <button class="los-help-btn" id="los-help-btn" title="How LOS analysis works">?</button>
        <button class="los-minimize-btn" id="los-minimize-btn" title="Minimize">▼</button>
        <button class="los-close-btn" id="los-close-btn" title="Close (keeps graphics)">✕</button>
      </div>

      <div class="los-help-popover" id="los-help-popover" hidden>
        <div class="los-help-head">
          <div>
            <div class="los-help-kicker">Field Guide</div>
            <div class="los-help-title">Line Of Sight / Viewshed</div>
          </div>
          <button class="los-help-close" id="los-help-close" title="Close">✕</button>
        </div>
        <div class="los-help-body">
          <p>Evaluates what an observer can see across terrain. In 2D it samples elevation along rays, and in 3D it can also hand the problem to ArcGIS native LOS or viewshed analysis.</p>
          <div class="los-help-block">
            <h4>How It Works</h4>
            <ol>
              <li>Set an observer point and eye height above ground.</li>
              <li>Add target points if you want direct line checks to named locations.</li>
              <li>Define the azimuth and elevation window for the search volume.</li>
              <li>Run the analysis to draw visible or masked LOS paths, obstruction markers, and optionally a viewshed footprint.</li>
            </ol>
          </div>
          <div class="los-help-block">
            <h4>Phenomenon</h4>
            <p>LOS asks whether the straight path from observer to target stays above terrain and scene obstructions. Viewshed expands that same idea into a sector or full dome by testing many rays inside the chosen horizontal and vertical envelope.</p>
          </div>
          <div class="los-help-block">
            <h4>Parameters</h4>
            <dl>
              <dt>Output</dt><dd>Choose LOS lines, viewshed coverage, or both together.</dd>
              <dt>Engine</dt><dd>"Auto" prefers native 3D tools in SceneView and falls back to terrain ray tracing when needed.</dd>
              <dt>Obs height</dt><dd>Raises the observer eye above the ground point before casting rays.</dd>
              <dt>Targets</dt><dd>Each target creates a separate visible or masked LOS test from the observer.</dd>
              <dt>Max range</dt><dd>Stops ray tests and viewshed generation at this distance from the observer.</dd>
              <dt>Az start/end</dt><dd>Defines the horizontal bearing sector to search; 0-360 gives all-around coverage.</dd>
              <dt>Elev min/max</dt><dd>Defines the vertical look envelope, useful for low-angle scans or elevated surveillance.</dd>
              <dt>Color by</dt><dd>Styles the result by distance, elevation angle, or simple visible vs blocked output.</dd>
              <dt>3D handles</dt><dd>Lets ArcGIS native analyses stay interactive in SceneView so you can drag them in place.</dd>
            </dl>
          </div>
        </div>
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
        <div class="los-field-full">
          <label class="los-toggle">
            <input id="los-native-interactive" type="checkbox"${nativeInteractive ? ' checked' : ''} />
            <span>Enable native 3D edit handles</span>
          </label>
          <div class="los-inline-note" id="los-native-interactive-note"></div>
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

    p.querySelector('#los-help-btn')?.addEventListener('click', (event) => {
      event.stopPropagation();
      const help = p.querySelector<HTMLElement>('#los-help-popover');
      if (help) help.hidden = !help.hidden;
    });
    p.querySelector('#los-help-close')?.addEventListener('click', () => {
      const help = p.querySelector<HTMLElement>('#los-help-popover');
      if (help) help.hidden = true;
    });

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
    p.querySelector('#los-native-interactive')?.addEventListener('change', () => this._applyNativeInteractivity());
    p.querySelector('#los-analysis-mode')?.addEventListener('change', () => {
      this._updateNativeInteractivityUI();
      this._applyNativeInteractivity();
    });

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

    this._updateNativeInteractivityUI();
    this._applyNativeInteractivity();
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
    const statusTextMap: Record<typeof state, string> = { awaiting: 'Awaiting observer', picking: 'Click map', computing: 'Computing', ready: 'Ready', committed: 'Committed', error: 'Error' };
    const message = statusTextMap[state];
    if (state === 'ready' || state === 'committed') EngineLogger.success(ENGINE_NAME, message);
    else if (state === 'error') EngineLogger.error(ENGINE_NAME, message);
    else EngineLogger.nextStep(ENGINE_NAME, message);
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
      .los-help-btn, .los-minimize-btn, .los-close-btn {
        background:none;
        border:1px solid transparent;
        color:var(--ms-text-dim);
        font-size:12px;
        cursor:pointer;
        padding:0 2px;
        line-height:1;
        transition:color 0.15s;
        flex:0 0 auto;
      }
      .los-help-btn {
        width:17px;
        height:17px;
        border-color:var(--ms-border);
        border-radius:50%;
        color:var(--ms-success);
        font-weight:700;
      }
      .los-help-btn:hover, .los-minimize-btn:hover, .los-close-btn:hover { color:var(--ms-text); }
      .los-help-popover {
        position:absolute;
        top:39px;
        left:8px;
        right:8px;
        z-index:1120;
        max-height:min(520px, calc(100vh - 132px));
        overflow-y:auto;
        background:var(--ms-bg);
        border:1px solid var(--ms-border);
        border-radius:4px;
        box-shadow:var(--ms-shadow);
        color:var(--ms-text);
      }
      .los-help-popover[hidden] { display:none; }
      .los-help-head {
        display:flex;
        justify-content:space-between;
        gap:10px;
        padding:10px 11px 8px;
        border-bottom:1px solid var(--ms-divider);
        background:var(--ms-bg-header);
      }
      .los-help-kicker {
        font-size:var(--ms-fs-xs);
        color:var(--ms-text-label);
        letter-spacing:0.09em;
        text-transform:uppercase;
      }
      .los-help-title {
        margin-top:2px;
        font-size:13px;
        color:var(--ms-success);
        font-weight:700;
      }
      .los-help-close {
        width:20px;
        height:20px;
        border:1px solid var(--ms-border);
        border-radius:3px;
        background:var(--ms-bg-input);
        color:var(--ms-text-dim);
        cursor:pointer;
      }
      .los-help-close:hover { color:var(--ms-text); }
      .los-help-body {
        padding:10px 11px 12px;
        font-size:var(--ms-fs-xs);
        line-height:1.45;
        color:var(--ms-text-dim);
        user-select:text;
      }
      .los-help-body p { margin:0 0 9px; }
      .los-help-block { margin-top:10px; }
      .los-help-block h4 {
        margin:0 0 5px;
        font-size:var(--ms-fs-xs);
        letter-spacing:0.08em;
        text-transform:uppercase;
        color:var(--ms-text);
      }
      .los-help-block ol, .los-help-block ul { margin:0; padding-left:17px; }
      .los-help-block li { margin:3px 0; }
      .los-help-block dl {
        display:grid;
        grid-template-columns:72px minmax(0, 1fr);
        gap:5px 8px;
        margin:0;
      }
      .los-help-block dt { color:var(--ms-success); font-weight:700; }
      .los-help-block dd { margin:0; }
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
      .los-toggle {
        display:flex; align-items:center; gap:8px;
        color:var(--ms-text); font-size:var(--ms-fs-sm);
        padding:2px 0 4px;
      }
      .los-toggle input { accent-color: var(--ms-accent); }
      .los-inline-note {
        color:var(--ms-text-dim);
        font-size:var(--ms-fs-xs);
        line-height:1.35;
        padding-bottom:4px;
      }
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

