/**
 * LocalPeaksEngine.ts
 * Terrain local peak / valley detection widget.
 *
 * Mirrors FlightEngine's self-contained analysis-engine pattern: private layers,
 * draggable panel, status/progress, map interaction handles, and exports.
 */

import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polygon from '@arcgis/core/geometry/Polygon';
import Polyline from '@arcgis/core/geometry/Polyline';
import Extent from '@arcgis/core/geometry/Extent';
import SketchViewModel from '@arcgis/core/widgets/Sketch/SketchViewModel';
import ElevationProfile from '@arcgis/core/widgets/ElevationProfile';
import * as geometryEngine from '@arcgis/core/geometry/geometryEngine';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils';
import EngineLogger from '../../../Support/EngineLogger';

const WGS84 = { wkid: 4326 } as any;
const ENGINE_NAME = 'LocalPeaksEngine';
const EARTH_RADIUS_M = 6_371_008.8;
const M_PER_DEG = 111_320;

export type PeakMode = 'peaks' | 'valleys';
type AoiMode = 'extent' | 'custom' | 'buffer';
type AoiDrawMode = 'polygon' | 'rectangle';
export type SortKey = 'rank' | 'elevation' | 'prominence';
type StatusTone = 'ready' | 'running' | 'warn' | 'pick' | 'done';

interface LocalPeaksValues {
  mode: PeakMode;
  aoiMode: AoiMode;
  cellSizeM: number;
  searchRadiusM: number;
  prominenceM: number;
  isolationM: number;
  minElevationM: number;
  maxResults: number;
  autoRun: boolean;
  showLabels: boolean;
  sortKey: SortKey;
}

export interface LocalPeaksHeadlessOptions {
  aoi?: Polygon | Extent;
  mode?: PeakMode;
  cellSizeM?: number;
  searchRadiusM?: number;
  prominenceM?: number;
  isolationM?: number;
  minElevationM?: number;
  maxResults?: number;
  sortKey?: SortKey;
}

interface GridSample {
  grid: Float32Array;
  sampler: any;
  extent: Extent;
  cols: number;
  rows: number;
  dLon: number;
  dLat: number;
}

export interface LocalPeakResult {
  id: number;
  rank: number;
  longitude: number;
  latitude: number;
  elevation: number;
  prominence: number;
  neighborhoodMean: number;
  neighborhoodMin: number;
  neighborhoodMax: number;
  isolationM: number;
  type: PeakMode;
  row: number;
  col: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toRad(value: number): number {
  return (value * Math.PI) / 180;
}

function toDeg(value: number): number {
  return (value * 180) / Math.PI;
}

function distanceM(a: { longitude: number; latitude: number }, b: { longitude: number; latitude: number }): number {
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function destinationPoint(lon: number, lat: number, bearingDeg: number, distM: number): { longitude: number; latitude: number } {
  const angularDistance = distM / EARTH_RADIUS_M;
  const bearing = toRad(bearingDeg);
  const lat1 = toRad(lat);
  const lon1 = toRad(lon);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
  );
  return { longitude: toDeg(lon2), latitude: toDeg(lat2) };
}

function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return 'n/a';
  if (meters >= 10_000) return `${(meters / 1000).toFixed(0)} km`;
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

export class LocalPeaksEngine {
  static readonly PEAK_LAYER_ID = 'local-peaks-results';
  static readonly LABEL_LAYER_ID = 'local-peaks-labels';
  static readonly AOI_LAYER_ID = 'local-peaks-aoi';
  static readonly PROFILE_LAYER_ID = 'local-peaks-profile';

  private _view: MapView | SceneView | null = null;
  private _peakLayer!: GraphicsLayer;
  private _labelLayer!: GraphicsLayer;
  private _aoiLayer!: GraphicsLayer;
  private _profileLayer!: GraphicsLayer;
  private _panelEl: HTMLDivElement | null = null;
  private _sketch: SketchViewModel | null = null;
  private _bufferPickHandle: any = null;
  private _viewWatchHandle: any = null;
  private _autoTimer: number | null = null;
  private _profileWidget: ElevationProfile | null = null;
  private _profileContainer: HTMLDivElement | null = null;
  private _customAoi: Polygon | Extent | null = null;
  private _bufferCenter: Point | null = null;
  private _results: LocalPeakResult[] = [];
  private _selectedId: number | null = null;
  private _running = false;
  private _dragOffsetX = 0;
  private _dragOffsetY = 0;
  private _isDragging = false;

  constructor() {
    this._createLayers();
    this._injectStyles();
  }

  initialize(view: MapView | SceneView): void {
    if (this._view === view) return;
    this._cancelBufferPick();
    this._detachAutoRun();
    this._view = view;
    const map = view.map as any;
    if (map && !map.findLayerById(this._peakLayer.id)) {
      map.addMany([this._aoiLayer, this._profileLayer, this._peakLayer, this._labelLayer]);
    }
    this._ensureSketch();
  }

  open(graphic?: Graphic, view?: MapView | SceneView): void {
    if (view) this.initialize(view);
    if (!this._view) return;
    const geom = graphic?.geometry;
    let src: Point | null = null;
    if (geom?.type === 'point') src = geom as Point;
    else if ((geom as any)?.centroid) src = (geom as any).centroid as Point;
    if (src) {
      this._bufferCenter = src;
      this._drawBufferAoi();
    }
    this._showPanel();
    this._syncAutoRun();
  }

  close(): void {
    this._hidePanel();
    this._cancelBufferPick();
    this._detachAutoRun();
    this._sketch?.cancel();
    this._destroyProfileWidget();
  }

  destroy(): void {
    this.close();
    this.clearResults();
    const map = this._view?.map as any;
    if (map) {
      map.remove(this._peakLayer);
      map.remove(this._labelLayer);
      map.remove(this._aoiLayer);
      map.remove(this._profileLayer);
    }
    this._panelEl?.remove();
    this._panelEl = null;
    this._view = null;
  }

  clearResults(): void {
    this._peakLayer.removeAll();
    this._labelLayer.removeAll();
    this._profileLayer.removeAll();
    this._results = [];
    this._selectedId = null;
    this._renderResults();
    this._syncStats();
    this._setProgress(0, 'Idle');
    this._setStatus('Results cleared.', 'ready');
  }

  public async runHeadless(options: LocalPeaksHeadlessOptions = {}): Promise<LocalPeakResult[]> {
    if (!this._view) throw new Error('LocalPeaksEngine requires initialize(view) before runHeadless().');
    const extent = options.aoi?.type === 'extent'
      ? options.aoi as Extent
      : ((options.aoi as any)?.extent ?? this._view.extent);
    if (!extent) return [];
    const values: LocalPeaksValues = {
      mode: options.mode ?? 'peaks',
      aoiMode: 'extent',
      cellSizeM: options.cellSizeM ?? 90,
      searchRadiusM: options.searchRadiusM ?? 240,
      prominenceM: options.prominenceM ?? 20,
      isolationM: options.isolationM ?? 250,
      minElevationM: options.minElevationM ?? -10000,
      maxResults: options.maxResults ?? 30,
      autoRun: false,
      showLabels: false,
      sortKey: options.sortKey ?? 'rank',
    };
    const gridSpec = this._gridSpec(extent, values.cellSizeM);
    const sample = await this._sampleGrid(extent, gridSpec.cols, gridSpec.rows);
    const smooth = this._smooth(sample.grid, sample.cols, sample.rows);
    const candidates = this._detectCandidates(smooth, sample, options.aoi ?? extent, values);
    return this._rankAndFilter(candidates, values);
  }

  private _createLayers(): void {
    this._peakLayer = new GraphicsLayer({ id: LocalPeaksEngine.PEAK_LAYER_ID, title: 'Peak Analysis - Results', elevationInfo: { mode: 'on-the-ground' } as any });
    this._labelLayer = new GraphicsLayer({ id: LocalPeaksEngine.LABEL_LAYER_ID, title: 'Peak Analysis - Labels', elevationInfo: { mode: 'on-the-ground' } as any });
    this._aoiLayer = new GraphicsLayer({ id: LocalPeaksEngine.AOI_LAYER_ID, title: 'Peak Analysis - AOI', elevationInfo: { mode: 'on-the-ground' } as any });
    this._profileLayer = new GraphicsLayer({ id: LocalPeaksEngine.PROFILE_LAYER_ID, title: 'Peak Analysis - Profile line', elevationInfo: { mode: 'on-the-ground' } as any });
  }

  private _ensureSketch(): void {
    if (!this._view || this._sketch) return;
    this._sketch = new SketchViewModel({ view: this._view, layer: this._aoiLayer, defaultCreateOptions: { mode: 'click' } as any });
    this._sketch.on('create', (event: any) => {
      if (event.state !== 'complete') return;
      const geometry = event.graphic?.geometry as Polygon | Extent | null;
      if (!geometry) return;
      this._customAoi = geometry;
      this._styleAoiGraphic(event.graphic);
      this._setSelectValue('peaks-aoi-mode', 'custom');
      this._setStatus('Custom AOI set. Run analysis when ready.', 'ready');
      this._maybeAutoRun();
    });
  }

  private _values(): LocalPeaksValues {
    return {
      mode: this._selectValue('peaks-type', 'peaks') as PeakMode,
      aoiMode: this._selectValue('peaks-aoi-mode', 'extent') as AoiMode,
      cellSizeM: this._num('peaks-cell-size', 45),
      searchRadiusM: this._num('peaks-search-radius', 180),
      prominenceM: this._num('peaks-prominence', 25),
      isolationM: this._num('peaks-isolation', 300),
      minElevationM: this._num('peaks-min-elev', -10000),
      maxResults: Math.round(this._num('peaks-max-results', 30)),
      autoRun: this._checked('peaks-auto-run', false),
      showLabels: this._checked('peaks-show-labels', true),
      sortKey: this._selectValue('peaks-sort', 'rank') as SortKey,
    };
  }

  private async _runAnalysis(): Promise<void> {
    if (!this._view || this._running) return;
    const runBtn = this._el('peaks-run-btn') as HTMLButtonElement | null;
    const values = this._values();
    const aoi = this._resolveAoi(values);
    if (!aoi.geometry || !aoi.extent) {
      this._setStatus('Choose or draw a valid AOI first.', 'warn');
      return;
    }
    this._running = true;
    if (runBtn) runBtn.disabled = true;
    try {
      this._setStatus('Sampling terrain elevation...', 'running');
      this._setProgress(0.05, 'Preparing AOI');
      this._peakLayer.removeAll();
      this._labelLayer.removeAll();
      this._profileLayer.removeAll();
      this._results = [];
      this._selectedId = null;
      this._drawAoiGeometry(aoi.geometry);
      const gridSpec = this._gridSpec(aoi.extent, values.cellSizeM);
      this._setProgress(0.12, `Sampling ${gridSpec.cols} x ${gridSpec.rows} cells`);
      await this._tick();
      const sample = await this._sampleGrid(aoi.extent, gridSpec.cols, gridSpec.rows);
      this._setProgress(0.3, 'Filtering terrain noise');
      await this._tick();
      const smooth = this._smooth(sample.grid, sample.cols, sample.rows);
      this._setProgress(0.45, 'Measuring prominence and isolation');
      await this._tick();
      const candidates = this._detectCandidates(smooth, sample, aoi.geometry, values);
      this._setProgress(0.68, 'Ranking terrain features');
      await this._tick();
      this._results = this._rankAndFilter(candidates, values);
      this._setProgress(0.82, 'Rendering map output');
      await this._tick();
      this._renderGraphics(values);
      this._renderResults();
      this._syncStats();
      this._setProgress(1, `Done - ${this._results.length} ${values.mode === 'peaks' ? 'peaks' : 'valleys'} found`);
      this._setStatus(
        this._results.length ? `Found ${this._results.length} features after prominence/isolation filtering.` : 'No results. Lower prominence, lower isolation, or enlarge the AOI.',
        this._results.length ? 'done' : 'warn',
      );
    } catch (error) {
      console.error('[LocalPeaks] Analysis failed', error);
      this._setStatus('Analysis failed. Terrain service may be unavailable for this area.', 'warn');
      this._setProgress(0, 'Error');
    } finally {
      this._running = false;
      if (runBtn) runBtn.disabled = false;
    }
  }

  private _gridSpec(extent: Extent, cellM: number): { cols: number; rows: number } {
    let widthM: number;
    let heightM: number;
    if (extent.spatialReference?.isWebMercator) {
      widthM = Math.max(1, extent.xmax - extent.xmin);
      heightM = Math.max(1, extent.ymax - extent.ymin);
    } else {
      const midLat = (extent.ymin + extent.ymax) / 2;
      widthM = Math.max(1, (extent.xmax - extent.xmin) * M_PER_DEG * Math.cos(toRad(midLat)));
      heightM = Math.max(1, (extent.ymax - extent.ymin) * M_PER_DEG);
    }
    return {
      cols: clamp(Math.ceil(widthM / Math.max(10, cellM)), 12, 240),
      rows: clamp(Math.ceil(heightM / Math.max(10, cellM)), 12, 240),
    };
  }

  private async _sampleGrid(extent: Extent, cols: number, rows: number): Promise<GridSample> {
    const sampler = await (this._view!.map as any).ground.createElevationSampler(extent, { noDataValue: 0 });
    const dLon = (extent.xmax - extent.xmin) / cols;
    const dLat = (extent.ymax - extent.ymin) / rows;
    const grid = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = extent.xmin + (c + 0.5) * dLon;
        const y = extent.ymax - (r + 0.5) * dLat;
        const z = sampler.queryElevation(new Point({ x, y, spatialReference: extent.spatialReference }))?.z ?? 0;
        grid[r * cols + c] = z;
      }
      if (r % 16 === 0) {
        this._setProgress(0.12 + 0.16 * (r / rows), `Sampling row ${r + 1}/${rows}`);
        await this._tick();
      }
    }
    return { grid, sampler, extent, cols, rows, dLon, dLat };
  }

  private _smooth(grid: Float32Array, cols: number, rows: number): Float32Array {
    const out = new Float32Array(grid.length);
    const kernel = [1, 2, 1, 2, 4, 2, 1, 2, 1];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = 0;
        let w = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
            const kw = kernel[(dr + 1) * 3 + (dc + 1)];
            sum += grid[rr * cols + cc] * kw;
            w += kw;
          }
        }
        out[r * cols + c] = w ? sum / w : grid[r * cols + c];
      }
    }
    return out;
  }

  private _detectCandidates(grid: Float32Array, sample: GridSample, aoiGeometry: Polygon | Extent, values: LocalPeaksValues): LocalPeakResult[] {
    const searchCells = clamp(Math.round(values.searchRadiusM / values.cellSizeM), 1, 20);
    const ringInner = Math.max(1, Math.floor(searchCells * 0.45));
    const candidates: LocalPeakResult[] = [];
    const isPeak = values.mode === 'peaks';
    let id = 1;
    for (let r = searchCells; r < sample.rows - searchCells; r++) {
      for (let c = searchCells; c < sample.cols - searchCells; c++) {
        const i = r * sample.cols + c;
        const elev = grid[i];
        if (values.mode === 'peaks' && elev < values.minElevationM) continue;
        if (values.mode === 'valleys' && values.minElevationM > -10000 && elev > values.minElevationM) continue;
        const x = sample.extent.xmin + (c + 0.5) * sample.dLon;
        const y = sample.extent.ymax - (r + 0.5) * sample.dLat;
        const pt = new Point({ x, y, spatialReference: sample.extent.spatialReference });
        if (!this._pointInAoi(pt, aoiGeometry)) continue;

        let wgs84Pt = pt;
        if (pt.spatialReference.isWebMercator) {
          wgs84Pt = webMercatorUtils.webMercatorToGeographic(pt) as Point;
        }
        const lon = wgs84Pt.longitude ?? wgs84Pt.x;
        const lat = wgs84Pt.latitude ?? wgs84Pt.y;
        let localExtreme = true;
        let sum = 0;
        let count = 0;
        let nMin = Infinity;
        let nMax = -Infinity;
        let saddle = isPeak ? -Infinity : Infinity;
        for (let dr = -searchCells; dr <= searchCells; dr++) {
          for (let dc = -searchCells; dc <= searchCells; dc++) {
            if (dr === 0 && dc === 0) continue;
            const distCells = Math.sqrt(dr * dr + dc * dc);
            if (distCells > searchCells) continue;
            const rr = r + dr;
            const cc = c + dc;
            const v = grid[rr * sample.cols + cc];
            if (isPeak && v > elev) localExtreme = false;
            if (!isPeak && v < elev) localExtreme = false;
            sum += v;
            count++;
            if (v < nMin) nMin = v;
            if (v > nMax) nMax = v;
            if (distCells >= ringInner) {
              if (isPeak && v > saddle) saddle = v;
              if (!isPeak && v < saddle) saddle = v;
            }
          }
        }
        if (!localExtreme) continue;
        const prominence = isPeak ? elev - saddle : saddle - elev;
        if (prominence < values.prominenceM) continue;
        candidates.push({
          id: id++, rank: 0, longitude: lon, latitude: lat, elevation: elev, prominence,
          neighborhoodMean: count ? sum / count : elev, neighborhoodMin: nMin, neighborhoodMax: nMax,
          isolationM: Infinity, type: values.mode, row: r, col: c,
        });
      }
    }
    for (const candidate of candidates) {
      let nearestHigher = Infinity;
      for (const other of candidates) {
        if (candidate === other) continue;
        const moreExtreme = isPeak ? other.elevation > candidate.elevation : other.elevation < candidate.elevation;
        if (!moreExtreme) continue;
        nearestHigher = Math.min(nearestHigher, distanceM(candidate, other));
      }
      candidate.isolationM = nearestHigher;
    }
    return candidates;
  }

  private _rankAndFilter(candidates: LocalPeakResult[], values: LocalPeaksValues): LocalPeakResult[] {
    const isPeak = values.mode === 'peaks';
    const ordered = [...candidates].sort((a, b) => {
      const promDelta = b.prominence - a.prominence;
      if (Math.abs(promDelta) > 0.001) return promDelta;
      return isPeak ? b.elevation - a.elevation : a.elevation - b.elevation;
    });
    const accepted: LocalPeakResult[] = [];
    for (const candidate of ordered) {
      if (accepted.some((pt) => distanceM(pt, candidate) < values.isolationM)) continue;
      accepted.push(candidate);
      if (accepted.length >= values.maxResults) break;
    }
    accepted.sort((a, b) => (isPeak ? b.elevation - a.elevation : a.elevation - b.elevation));
    accepted.forEach((pt, i) => { pt.rank = i + 1; pt.id = i + 1; });
    return accepted;
  }

  private _renderGraphics(values: LocalPeaksValues): void {
    this._peakLayer.removeAll();
    this._labelLayer.removeAll();
    const isPeak = values.mode === 'peaks';
    this._results.forEach((peak) => {
      const selected = peak.id === this._selectedId;
      const point = new Point({ longitude: peak.longitude, latitude: peak.latitude, z: peak.elevation, spatialReference: WGS84 });
      const baseColor: [number, number, number] = isPeak ? [239, 159, 39] : [55, 138, 221];

      // Top-3 halo ring for visual emphasis
      if (peak.rank <= 3 && !selected) {
        const haloR = Math.max(values.searchRadiusM * 0.28, 35) * (4 - peak.rank);
        const haloRaw = geometryEngine.geodesicBuffer(point, haloR, 'meters');
        const haloGeom = (Array.isArray(haloRaw) ? haloRaw[0] : haloRaw) as Polygon | null;
        if (haloGeom) {
          this._peakLayer.add(new Graphic({
            geometry: haloGeom,
            symbol: { type: 'simple-fill', color: [0, 0, 0, 0], outline: { color: [...baseColor, 0.55 - peak.rank * 0.10], width: peak.rank === 1 ? 2 : 1.5 } } as any,
            attributes: { type: 'local_peak_halo', peakId: peak.id },
          }));
        }
      }

      // Main peak marker
      const elevFormatted = Math.round(peak.elevation).toLocaleString();
      const promFormatted = Math.round(peak.prominence);
      this._peakLayer.add(new Graphic({
        geometry: point,
        symbol: this._peakSymbol(peak, selected),
        attributes: {
          type: 'local_peak', id: peak.id, rank: peak.rank,
          elevation: Math.round(peak.elevation * 10) / 10,
          prominence: Math.round(peak.prominence * 10) / 10,
          isolationM: Number.isFinite(peak.isolationM) ? Math.round(peak.isolationM) : null,
          featureType: isPeak ? 'Peak' : 'Valley',
          latitude: peak.latitude.toFixed(5), longitude: peak.longitude.toFixed(5),
        },
        popupTemplate: {
          title: (isPeak ? '▲' : '▽') + ' ' + (isPeak ? 'Peak' : 'Valley') + ' #' + peak.rank,
          content: '<b>Elevation:</b> ' + elevFormatted + ' m<br>'
            + '<b>Topographic Prominence:</b> ' + promFormatted + ' m<br>'
            + '<b>Isolation:</b> ' + (Number.isFinite(peak.isolationM) ? formatDistance(peak.isolationM) : 'Highest in area') + '<br>'
            + '<b>Neighborhood Mean:</b> ' + Math.round(peak.neighborhoodMean) + ' m<br>'
            + '<b>Δ above mean:</b> ' + (Math.round(peak.elevation - peak.neighborhoodMean) >= 0 ? '+' : '') + Math.round(peak.elevation - peak.neighborhoodMean) + ' m<br>'
            + '<b>Coordinates:</b> ' + peak.latitude.toFixed(5) + '°, ' + peak.longitude.toFixed(5) + '°',
        } as any,
      } as any));

      // Base label: rank number centered in circle (2D) or elevation at stick base (3D)
      const is3D = this._view?.type === '3d';
      const elevShort = elevFormatted + ' m';
      this._labelLayer.add(new Graphic({
        geometry: point,
        symbol: {
          type: 'text',
          text: is3D ? elevShort : String(peak.rank),
          color: [255, 255, 255, 1],
          haloColor: [0, 0, 0, 0.78],
          haloSize: is3D ? 1.5 : 1,
          yoffset: 0,
          font: { size: is3D ? 9 : (peak.rank >= 10 ? 7 : 8), family: 'Aptos, Segoe UI, sans-serif', weight: 'bold' },
        } as any,
        attributes: { type: 'local_peak_base_label', peakId: peak.id },
      }));

      // 2D only: elevation below the circle
      if (!is3D) {
        this._labelLayer.add(new Graphic({
          geometry: point,
          symbol: {
            type: 'text',
            text: elevShort,
            color: isPeak ? '#FFAD3A' : '#6ABAFF',
            haloColor: [3, 5, 14, 0.95],
            haloSize: 1.5,
            yoffset: -16,
            font: { size: 9, family: 'Aptos, Segoe UI, sans-serif', weight: 'bold' },
          } as any,
          attributes: { type: 'local_peak_elev_2d', peakId: peak.id },
        }));
      }

      // Top label — rank at top of stick; elevation already shown at base so omit it here
      if (values.showLabels) {
        const icon = isPeak ? '▲' : '▽';
        const isoFmt = Number.isFinite(peak.isolationM) ? formatDistance(peak.isolationM) : 'highest';
        const labelColor = isPeak ? '#FFAD3A' : '#6ABAFF';
        const labelHalo = [3, 5, 14, 0.97] as [number, number, number, number];

        let labelText: string;
        let fontSize: number;

        if (peak.rank === 1) {
          labelText = `${icon} ${isPeak ? 'PEAK' : 'VALLEY'}  #${peak.rank}\nPMN +${promFormatted} m  ·  ISO ${isoFmt}`;
          fontSize = 13;
        } else if (peak.rank <= 3) {
          labelText = `${icon} #${peak.rank}  PMN +${promFormatted} m\nISO ${isoFmt}`;
          fontSize = 12;
        } else if (peak.rank <= 10) {
          labelText = `${icon} #${peak.rank}  PMN +${promFormatted} m`;
          fontSize = 11;
        } else {
          labelText = `${icon} #${peak.rank}`;
          fontSize = 10;
        }

        let labelSymbol: any;
        if (is3D) {
          // Rank 1 = tallest stick, each subsequent rank decreases by ~3 screen pixels
          const vOffsetLen = Math.max(52, Math.round(148 - (peak.rank - 1) * 3.5));
          const vOffsetMax = Math.max(3500, Math.round(14000 - (peak.rank - 1) * 380));
          // Callout line thickness also scales with rank — rank 1 most prominent
          const calloutSize = Math.max(1.2, +(3 - (peak.rank - 1) * 0.065).toFixed(2));
          labelSymbol = {
            type: 'label-3d',
            symbolLayers: [{
              type: 'text',
              material: { color: labelColor },
              halo: { color: labelHalo, size: 2 },
              font: { size: fontSize, weight: 'bold', family: 'Aptos, Segoe UI, sans-serif' },
              text: labelText,
            }],
            verticalOffset: { screenLength: selected ? vOffsetLen + 20 : vOffsetLen, maxWorldLength: vOffsetMax, minWorldLength: 50 },
            callout: { type: 'line', color: labelColor, size: calloutSize, border: { color: [0, 0, 0, 0.6] } },
          };
        } else {
          const haloSize = peak.rank === 1 ? 3 : peak.rank <= 3 ? 2.5 : 2;
          const yoffset = peak.rank === 1 ? 27 : peak.rank <= 3 ? 23 : 18;
          labelSymbol = {
            type: 'text', text: labelText, color: labelColor,
            haloColor: labelHalo, haloSize, yoffset,
            font: { size: fontSize, family: 'Aptos, Segoe UI, sans-serif', weight: 'bold' },
          };
        }

        this._labelLayer.add(new Graphic({
          geometry: point,
          symbol: labelSymbol,
          attributes: { type: 'local_peak_label', peakId: peak.id },
        }));
      }
    });
  }

  private _peakSymbol(peak: LocalPeakResult, selected: boolean): any {
    const isPeak = peak.type === 'peaks';
    // Gradient: rank 1 = brightest/largest, rank 15+ = most muted/smallest
    const t = Math.min(1, (peak.rank - 1) / 14);
    const peakFill: [number, number, number, number] = selected
      ? [255, 255, 255, 1]
      : [Math.round(255 - t * 55), Math.round(168 - t * 78), Math.round(40 - t * 14), 0.95];
    const valFill: [number, number, number, number] = selected
      ? [255, 255, 255, 1]
      : [Math.round(52 + t * 68), Math.round(136 + t * 42), 220, 0.95];
    const fill = isPeak ? peakFill : valFill;
    const size = selected ? 26 : Math.round(22 - t * 8);
    const outlineW = selected ? 2.8 : peak.rank <= 3 ? 2.2 : 1.5;
    const outlineColor: [number, number, number, number] = selected
      ? (isPeak ? [239, 120, 20, 1] : [30, 100, 210, 1])
      : [6, 8, 12, 0.85];
    if (this._view?.type === '3d') {
      const h = selected ? 115 : Math.round(88 - t * 35);
      const w = selected ? 66 : Math.round(52 - t * 22);
      // Rank 1 = tallest marker stick, matching the label-3d vertical offset scaling
      const vOffsetLen = selected ? 168 : Math.max(52, Math.round(148 - (peak.rank - 1) * 3.5));
      const vOffsetMax = Math.max(3500, Math.round(14000 - (peak.rank - 1) * 380));
      const calloutSize = Math.max(1.2, +(3 - (peak.rank - 1) * 0.065).toFixed(2));
      return {
        type: 'point-3d',
        symbolLayers: [{ type: 'object', resource: { primitive: isPeak ? 'cone' : 'inverted-cone' }, material: { color: fill }, height: h, width: w, depth: w }],
        verticalOffset: { screenLength: vOffsetLen, maxWorldLength: vOffsetMax, minWorldLength: 50 },
        callout: { type: 'line', color: [fill[0], fill[1], fill[2], 0.92], size: calloutSize, border: { color: [0, 0, 0, 0.55] } },
      } as any;
    }
    // 2D: circle is far more legible than triangle — rank number centers perfectly inside
    return { type: 'simple-marker', style: 'circle', size, color: fill, outline: { color: outlineColor, width: outlineW } } as any;
  }

  private _resolveAoi(values: LocalPeaksValues): { geometry: Polygon | Extent | null; extent: Extent | null } {
    if (!this._view) return { geometry: null, extent: null };
    if (values.aoiMode === 'custom') {
      const geom = this._customAoi;
      return { geometry: geom, extent: (geom as any)?.extent ?? (geom as Extent | null) };
    }
    if (values.aoiMode === 'buffer') {
      const buffer = this._bufferGeometry();
      return { geometry: buffer, extent: buffer?.extent ?? null };
    }
    const extent = this._view.extent?.clone?.() as Extent | null;
    return { geometry: extent, extent };
  }

  private _bufferGeometry(): Polygon | null {
    if (!this._bufferCenter) return null;
    const radiusM = Math.max(25, this._num('peaks-buffer-radius', 2000));
    const raw = geometryEngine.geodesicBuffer(this._bufferCenter, radiusM, 'meters');
    return (Array.isArray(raw) ? raw[0] : raw) as Polygon | null;
  }

  private _pointInAoi(point: Point, geometry: Polygon | Extent): boolean {
    if (geometry.type === 'extent') return (geometry as Extent).contains(point);
    try {
      return geometryEngine.contains(geometry as Polygon, point) || geometryEngine.intersects(geometry as Polygon, point);
    } catch {
      return true;
    }
  }

  private _drawAoiGeometry(geometry: Polygon | Extent): void {
    this._aoiLayer.removeAll();
    const geom = geometry.type === 'extent' ? Polygon.fromExtent(geometry as Extent) : geometry;
    this._aoiLayer.add(new Graphic({ geometry: geom, symbol: this._aoiSymbol(), attributes: { type: 'local_peaks_aoi' } }));
  }

  private _drawBufferAoi(): void {
    const geom = this._bufferGeometry();
    if (!geom) return;
    this._aoiLayer.removeAll();
    this._aoiLayer.add(new Graphic({ geometry: geom, symbol: this._aoiSymbol(), attributes: { type: 'local_peaks_buffer' } }));
  }

  private _styleAoiGraphic(graphic: Graphic): void {
    graphic.symbol = this._aoiSymbol();
    graphic.attributes = { type: 'local_peaks_custom_aoi' };
  }

  private _aoiSymbol(): any {
    return { type: 'simple-fill', color: [29, 158, 117, 0.08], outline: { color: [29, 158, 117, 0.85], width: 1.4, style: 'dash' } } as any;
  }

  private _startDraw(mode: AoiDrawMode): void {
    if (!this._view || !this._sketch) return;
    this._cancelBufferPick();
    this._aoiLayer.removeAll();
    this._customAoi = null;
    this._setStatus(`Draw ${mode === 'rectangle' ? 'a bounding box' : 'a polygon'} AOI on the map.`, 'pick');
    this._sketch.create(mode === 'rectangle' ? 'rectangle' : 'polygon');
  }

  private _startBufferPick(): void {
    if (!this._view) return;
    this._cancelBufferPick();
    this._sketch?.cancel();
    this._setStatus('Click a point or route vertex to center the buffer AOI.', 'pick');
    this._bufferPickHandle = this._view.on('click', async (event: any) => {
      event.stopPropagation?.();
      let mapPoint = event.mapPoint as Point | null;
      if (!mapPoint && this._view?.type === '3d') {
        try {
          const hit = await (this._view as any).hitTest(event, { include: [(this._view as any).map.ground] });
          mapPoint = hit?.ground?.mapPoint ?? null;
        } catch {
          mapPoint = null;
        }
      }
      if (!mapPoint) return;
      this._bufferCenter = mapPoint;
      this._setSelectValue('peaks-aoi-mode', 'buffer');
      this._drawBufferAoi();
      this._cancelBufferPick();
      this._setStatus('Buffer AOI set. Run analysis when ready.', 'ready');
      this._maybeAutoRun();
    });
  }

  private _cancelBufferPick(): void {
    this._bufferPickHandle?.remove?.();
    this._bufferPickHandle = null;
  }

  private _selectPeak(id: number, fly = true): void {
    const peak = this._results.find((p) => p.id === id);
    if (!peak || !this._view) return;
    this._selectedId = id;
    this._renderGraphics(this._values());
    this._renderResults();
    this._drawProfileLine(peak);
    this._openProfile(peak);
    if (fly) {
      const target = new Point({ longitude: peak.longitude, latitude: peak.latitude, z: peak.elevation, spatialReference: WGS84 });
      void this._view.goTo({ target, zoom: this._view.type === '3d' ? undefined : 14, tilt: this._view.type === '3d' ? 60 : undefined } as any, { duration: 900 });
    }
  }

  private _drawProfileLine(peak: LocalPeakResult): void {
    this._profileLayer.removeAll();
    const values = this._values();
    const span = Math.max(values.searchRadiusM * 2, values.isolationM || 500);
    const a = destinationPoint(peak.longitude, peak.latitude, 270, span / 2);
    const b = destinationPoint(peak.longitude, peak.latitude, 90, span / 2);
    const line = new Polyline({ paths: [[[a.longitude, a.latitude], [b.longitude, b.latitude]]], spatialReference: WGS84 });
    this._profileLayer.add(new Graphic({ geometry: line, symbol: { type: 'simple-line', color: [255, 255, 255, 0.9], width: 2.2, style: 'short-dash' } as any, attributes: { type: 'local_peak_profile', peakId: peak.id } }));
  }

  private _openProfile(peak: LocalPeakResult): void {
    if (!this._view) return;
    if (!this._profileContainer) {
      this._profileContainer = document.createElement('div');
      this._profileContainer.className = 'peaks-profile-panel';
      document.body.appendChild(this._profileContainer);
    }
    const isPeakType = peak.type === 'peaks';
    this._profileContainer.style.display = 'block';
    this._profileContainer.innerHTML = `<div class="peaks-profile-head"><span>${isPeakType ? '▲' : '▽'} Elevation Profile — ${isPeakType ? 'Peak' : 'Valley'} #${peak.rank} · ${Math.round(peak.elevation).toLocaleString()} m ASL</span><button id="peaks-profile-close">✕</button></div><div id="peaks-profile-widget" class="peaks-profile-widget"></div>`;
    this._profileContainer.querySelector('#peaks-profile-close')?.addEventListener('click', () => this._destroyProfileWidget());
    this._profileWidget?.destroy();
    // ElevationProfile.input must be a Graphic (not geometry) — find the profile graphic directly
    const profileGraphic = this._profileLayer.graphics.find((g) => g.attributes?.type === 'local_peak_profile') ?? null;
    try {
      this._profileWidget = new ElevationProfile({
        view: this._view,
        container: this._profileContainer.querySelector('#peaks-profile-widget') as HTMLDivElement,
        profiles: [{ type: 'ground', color: isPeakType ? '#EF9F27' : '#378ADD', title: isPeakType ? 'Ground (Peak)' : 'Ground (Valley)' }] as any,
      } as any);
      if (profileGraphic) {
        (this._profileWidget as any).when(() => {
          if (this._profileWidget && profileGraphic) {
            (this._profileWidget as any).input = profileGraphic;
          }
        }).catch(() => {/* ignore */});
      }
    } catch {
      this._setStatus('Profile widget could not be opened in this view.', 'warn');
    }
  }

  private _destroyProfileWidget(): void {
    this._profileWidget?.destroy();
    this._profileWidget = null;
    if (this._profileContainer) this._profileContainer.style.display = 'none';
  }

  private _showPanel(): void {
    if (!this._panelEl) {
      this._panelEl = document.createElement('div');
      this._panelEl.id = 'local-peaks-panel';
      this._panelEl.className = 'peaks-panel';
      document.body.appendChild(this._panelEl);
    }
    this._panelEl.innerHTML = this._buildPanelHTML();
    this._panelEl.style.display = 'block';
    this._bindPanelEvents();
    this._makeDraggable();
    this._renderResults();
    this._syncStats();
    this._setStatus('Ready. Choose AOI and run local terrain analysis.', 'ready');
  }

  private _hidePanel(): void {
    if (this._panelEl) this._panelEl.style.display = 'none';
  }

  private _buildPanelHTML(): string {
    return `
      <div class="peaks-header" id="peaks-drag-handle"><span class="peaks-header-icon">PEAK</span><span class="peaks-header-title">Peak Analysis</span><span class="peaks-status-dot" id="peaks-status-dot"></span><span class="peaks-status-lbl" id="peaks-status-lbl">Ready</span><button class="peaks-help-btn" id="peaks-help-btn">?</button><button class="peaks-min-btn" id="peaks-min-btn">v</button><button class="peaks-close-btn" id="peaks-close-btn">x</button></div>
      <div class="peaks-help-popover" id="peaks-help-popover" hidden><div class="peaks-help-head"><div><div class="peaks-help-kicker">Field Guide</div><div class="peaks-help-title">Prominence-based peaks</div></div><button id="peaks-help-close">x</button></div><div class="peaks-help-body"><p>Samples terrain elevation inside the AOI, smooths single-cell noise, then detects true local maxima or minima using neighborhood comparison, approximate topographic prominence, and isolation filtering.</p><ol><li>Pick Current Extent, draw a custom polygon/box, or click a buffer center.</li><li>Tune search radius, prominence, and isolation to mission scale.</li><li>Run manually, or enable auto-run on pan/zoom for smaller AOIs.</li><li>Select a result to fly to it and open an elevation cross-section.</li></ol></div></div>
      <div class="peaks-body"><div class="peaks-status-msg" id="peaks-status">Ready.</div>
        <div class="peaks-sec">AOI</div><div class="peaks-grid"><label class="peaks-field full"><span>Spatial scope</span><select id="peaks-aoi-mode"><option value="extent">Current extent</option><option value="custom">Custom boundary</option><option value="buffer">Buffer zone</option></select></label><label class="peaks-field"><span>Buffer m</span><input id="peaks-buffer-radius" type="number" min="25" max="100000" step="100" value="2000"></label><label class="peaks-field"><span>Peak type</span><select id="peaks-type"><option value="peaks">Local maxima</option><option value="valleys">Valleys / pits</option></select></label></div>
        <div class="peaks-btn-row"><button id="peaks-draw-poly" class="peaks-btn">Draw Polygon</button><button id="peaks-draw-box" class="peaks-btn">Draw Box</button><button id="peaks-pick-buffer" class="peaks-btn">Pick Buffer</button></div>
        <div class="peaks-sec">Detection</div><div class="peaks-grid"><label class="peaks-field"><span>Cell m</span><input id="peaks-cell-size" type="number" min="10" max="500" step="5" value="45"></label><label class="peaks-field"><span>Search radius m</span><input id="peaks-search-radius" type="number" min="20" max="5000" step="25" value="180"></label><label class="peaks-field"><span>Prominence m</span><input id="peaks-prominence" type="number" min="0" max="5000" step="5" value="25"></label><label class="peaks-field"><span>Isolation m</span><input id="peaks-isolation" type="number" min="0" max="20000" step="25" value="300"></label><label class="peaks-field"><span>Min height m</span><input id="peaks-min-elev" type="number" step="10" value="-10000"></label><label class="peaks-field"><span>Max results</span><input id="peaks-max-results" type="number" min="1" max="500" step="1" value="30"></label></div>
        <div class="peaks-sec">Execution</div><div class="peaks-toggle"><label>Auto-calculate on pan/zoom</label><input id="peaks-auto-run" type="checkbox"></div><div class="peaks-toggle"><label>Peak layer visible</label><input id="peaks-layer-visible" type="checkbox" checked></div><div class="peaks-toggle"><label>Labels</label><input id="peaks-show-labels" type="checkbox" checked></div>
        <div class="peaks-progress"><div><div id="peaks-progress-fill"></div></div><span id="peaks-progress-label">Idle</span></div><div class="peaks-btn-row"><button id="peaks-clear-btn" class="peaks-btn">Clear Results</button><button id="peaks-run-btn" class="peaks-btn primary">Run Analysis</button></div>
        <div class="peaks-sec">Results</div><div class="peaks-stats"><div><span>Count</span><b id="peaks-stat-count">0</b></div><div><span>Avg elev</span><b id="peaks-stat-avg">-</b></div><div><span>Max prom</span><b id="peaks-stat-prom">-</b></div></div><label class="peaks-field full sort"><span>Sort</span><select id="peaks-sort"><option value="rank">Rank</option><option value="elevation">Elevation</option><option value="prominence">Prominence</option></select></label><div class="peaks-results" id="peaks-results"></div><div class="peaks-btn-row"><button id="peaks-export-csv" class="peaks-btn">CSV</button><button id="peaks-export-geojson" class="peaks-btn">GeoJSON</button><button id="peaks-export-shp" class="peaks-btn">Shapefile</button></div>
      </div>`;
  }

  private _bindPanelEvents(): void {
    this._el('peaks-help-btn')?.addEventListener('click', (event) => { event.stopPropagation(); const help = this._el('peaks-help-popover') as HTMLElement | null; if (help) help.hidden = !help.hidden; });
    this._el('peaks-help-close')?.addEventListener('click', () => { const help = this._el('peaks-help-popover') as HTMLElement | null; if (help) help.hidden = true; });
    this._el('peaks-min-btn')?.addEventListener('click', () => { const body = this._panelEl?.querySelector<HTMLElement>('.peaks-body'); if (body) body.style.display = body.style.display === 'none' ? '' : 'none'; });
    this._el('peaks-close-btn')?.addEventListener('click', () => this.close());
    this._el('peaks-run-btn')?.addEventListener('click', () => void this._runAnalysis());
    this._el('peaks-clear-btn')?.addEventListener('click', () => this.clearResults());
    this._el('peaks-draw-poly')?.addEventListener('click', () => this._startDraw('polygon'));
    this._el('peaks-draw-box')?.addEventListener('click', () => this._startDraw('rectangle'));
    this._el('peaks-pick-buffer')?.addEventListener('click', () => this._startBufferPick());
    this._el('peaks-export-csv')?.addEventListener('click', () => this._exportCsv());
    this._el('peaks-export-geojson')?.addEventListener('click', () => this._exportGeoJson(false));
    this._el('peaks-export-shp')?.addEventListener('click', () => this._exportShapefile());
    this._el('peaks-sort')?.addEventListener('change', () => this._renderResults());
    this._el('peaks-layer-visible')?.addEventListener('change', () => { const visible = this._checked('peaks-layer-visible', true); this._peakLayer.visible = visible; this._labelLayer.visible = visible; });
    this._el('peaks-show-labels')?.addEventListener('change', () => this._renderGraphics(this._values()));
    ['peaks-auto-run', 'peaks-aoi-mode'].forEach((id) => this._el(id)?.addEventListener('change', () => this._syncAutoRun()));
    ['peaks-cell-size', 'peaks-search-radius', 'peaks-prominence', 'peaks-isolation', 'peaks-min-elev', 'peaks-max-results', 'peaks-buffer-radius', 'peaks-type'].forEach((id) => this._el(id)?.addEventListener('change', () => this._maybeAutoRun()));
  }

  private _renderResults(): void {
    const list = this._el('peaks-results');
    if (!list) return;
    if (!this._results.length) {
      list.innerHTML = '<div class="peaks-empty">No peaks yet. Run analysis to populate ranked terrain features.</div>';
      return;
    }
    const sortKey = this._selectValue('peaks-sort', 'rank') as SortKey;
    const rows = [...this._results].sort((a, b) => {
      if (sortKey === 'elevation') return b.elevation - a.elevation;
      if (sortKey === 'prominence') return b.prominence - a.prominence;
      return a.rank - b.rank;
    });
    const minElev = Math.min(...rows.map((r) => r.elevation));
    const maxElev = Math.max(...rows.map((r) => r.elevation));
    const elevRange = Math.max(1, maxElev - minElev);
    list.innerHTML = rows.map((p) => {
      const t = Math.min(1, (p.rank - 1) / 14);
      const isPk = p.type === 'peaks';
      const cr = clamp(isPk ? Math.round(255 - t * 55) : Math.round(52 + t * 68), 0, 255);
      const cg = clamp(isPk ? Math.round(168 - t * 78) : Math.round(136 + t * 42), 0, 255);
      const cb = clamp(isPk ? Math.round(40 - t * 14) : 220, 0, 255);
      const hex = '#' + [cr, cg, cb].map((v) => v.toString(16).padStart(2, '0')).join('');
      const elevPct = elevRange < 1 ? 50 : Math.round(((p.elevation - minElev) / elevRange) * 100);
      const elevStr = Math.round(p.elevation).toLocaleString();
      const promStr = Math.round(p.prominence);
      const isoStr = Number.isFinite(p.isolationM) ? formatDistance(p.isolationM) : 'top';
      const deltaMean = Math.round(p.elevation - p.neighborhoodMean);
      const deltaStr = (deltaMean >= 0 ? '+' : '') + deltaMean;
      const icon = isPk ? '▲' : '▽';
      const latStr = Math.abs(p.latitude).toFixed(4) + '° ' + (p.latitude >= 0 ? 'N' : 'S');
      const lonStr = Math.abs(p.longitude).toFixed(4) + '° ' + (p.longitude >= 0 ? 'E' : 'W');
      const sel = p.id === this._selectedId ? ' selected' : '';
      return '<div class="peaks-row' + sel + '" data-id="' + p.id + '">'
        + '<div class="peaks-row-header">'
        + '<span class="peaks-row-badge" style="background:' + hex + '">' + icon + ' ' + p.rank + '</span>'
        + '<span class="peaks-row-elev">' + elevStr + '<span class="peaks-row-unit"> m</span></span>'
        + '<div class="peaks-row-btns">'
        + '<button data-select="' + p.id + '">Select</button>'
        + '<button data-fly="' + p.id + '">Fly ↗</button>'
        + '</div></div>'
        + '<div class="peaks-row-bar-wrap"><div class="peaks-row-bar" style="width:' + elevPct + '%;background:' + hex + '88"></div></div>'
        + '<div class="peaks-row-metrics">'
        + '<span><span class="peaks-lbl">Prom</span> ' + promStr + ' m</span>'
        + '<span><span class="peaks-lbl">Iso</span> ' + isoStr + '</span>'
        + '<span><span class="peaks-lbl">ΔMean</span> ' + deltaStr + ' m</span>'
        + '</div>'
        + '<div class="peaks-row-coord">' + latStr + ', ' + lonStr + '</div>'
        + '</div>';
    }).join('');
    list.querySelectorAll<HTMLElement>('[data-id]').forEach((row) => row.addEventListener('click', (event) => { if ((event.target as HTMLElement).tagName === 'BUTTON') return; this._selectPeak(Number(row.dataset.id), false); }));
    list.querySelectorAll<HTMLButtonElement>('[data-select]').forEach((btn) => btn.addEventListener('click', () => this._selectPeak(Number(btn.dataset.select), false)));
    list.querySelectorAll<HTMLButtonElement>('[data-fly]').forEach((btn) => btn.addEventListener('click', () => this._selectPeak(Number(btn.dataset.fly), true)));
  }

  private _syncStats(): void {
    this._setText('peaks-stat-count', String(this._results.length));
    if (!this._results.length) { this._setText('peaks-stat-avg', '-'); this._setText('peaks-stat-prom', '-'); return; }
    const avg = this._results.reduce((sum, p) => sum + p.elevation, 0) / this._results.length;
    const maxProm = Math.max(...this._results.map((p) => p.prominence));
    this._setText('peaks-stat-avg', `${Math.round(avg)} m`);
    this._setText('peaks-stat-prom', `${Math.round(maxProm)} m`);
  }

  private _syncAutoRun(): void {
    this._detachAutoRun();
    if (!this._view || !this._checked('peaks-auto-run', false)) return;
    this._viewWatchHandle = (this._view as any).watch('stationary', (stationary: boolean) => { if (stationary) this._scheduleAutoRun(); });
    this._setStatus('Auto-calculate enabled. Pan/zoom will rerun after the view settles.', 'ready');
  }

  private _detachAutoRun(): void {
    this._viewWatchHandle?.remove?.();
    this._viewWatchHandle = null;
    if (this._autoTimer != null) window.clearTimeout(this._autoTimer);
    this._autoTimer = null;
  }

  private _maybeAutoRun(): void {
    if (this._checked('peaks-auto-run', false)) this._scheduleAutoRun();
  }

  private _scheduleAutoRun(): void {
    if (this._autoTimer != null) window.clearTimeout(this._autoTimer);
    this._autoTimer = window.setTimeout(() => { this._autoTimer = null; void this._runAnalysis(); }, 650);
  }

  private _exportCsv(): void {
    if (!this._results.length) { this._setStatus('No peak results to export.', 'warn'); return; }
    const header = ['rank', 'type', 'longitude', 'latitude', 'elevation_m', 'prominence_m', 'isolation_m', 'neighborhood_mean_m', 'neighborhood_min_m', 'neighborhood_max_m'];
    const rows = this._results.map((p) => [p.rank, p.type, p.longitude, p.latitude, p.elevation, p.prominence, Number.isFinite(p.isolationM) ? p.isolationM : '', p.neighborhoodMean, p.neighborhoodMin, p.neighborhoodMax]);
    this._download(`local-${this._values().mode}.csv`, [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
  }

  private _exportGeoJson(shapefileRequested: boolean): void {
    if (!this._results.length) { this._setStatus('No peak results to export.', 'warn'); return; }
    const featureCollection = { type: 'FeatureCollection', features: this._results.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.longitude, p.latitude, p.elevation] }, properties: { rank: p.rank, type: p.type, elevation_m: p.elevation, prominence_m: p.prominence, isolation_m: Number.isFinite(p.isolationM) ? p.isolationM : null, neighborhood_mean_m: p.neighborhoodMean, neighborhood_min_m: p.neighborhoodMin, neighborhood_max_m: p.neighborhoodMax } })) };
    const filename = shapefileRequested ? `local-${this._values().mode}-shapefile-ready.geojson` : `local-${this._values().mode}.geojson`;
    this._download(filename, JSON.stringify(featureCollection, null, 2), 'application/geo+json');
    if (shapefileRequested) this._setStatus('Exported GeoJSON suitable for conversion to Shapefile by GIS tools.', 'done');
  }

  private _exportShapefile(): void {
    if (!this._results.length) { this._setStatus('No peak results to export.', 'warn'); return; }
    const base = `local-${this._values().mode}`;
    const { shp, shx } = this._buildPointShapefile();
    this._downloadBlob(`${base}.shp`, shp, 'application/octet-stream');
    this._downloadBlob(`${base}.shx`, shx, 'application/octet-stream');
    this._downloadBlob(`${base}.dbf`, this._buildDbf(), 'application/octet-stream');
    this._download(`${base}.prj`, 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]]', 'text/plain');
    this._setStatus('Downloaded Shapefile parts: SHP, SHX, DBF, and PRJ.', 'done');
  }

  private _buildPointShapefile(): { shp: Blob; shx: Blob } {
    const recordLengthBytes = 28;
    const shpBytes = 100 + this._results.length * recordLengthBytes;
    const shxBytes = 100 + this._results.length * 8;
    const shp = new ArrayBuffer(shpBytes);
    const shx = new ArrayBuffer(shxBytes);
    const shpView = new DataView(shp);
    const shxView = new DataView(shx);
    this._writeShapeHeader(shpView, shpBytes, this._shapeBounds());
    this._writeShapeHeader(shxView, shxBytes, this._shapeBounds());
    let shpOffset = 100;
    let shxOffset = 100;
    let contentOffsetWords = 50;
    this._results.forEach((p, i) => {
      shpView.setInt32(shpOffset, i + 1, false);
      shpView.setInt32(shpOffset + 4, 10, false);
      shpView.setInt32(shpOffset + 8, 1, true);
      shpView.setFloat64(shpOffset + 12, p.longitude, true);
      shpView.setFloat64(shpOffset + 20, p.latitude, true);
      shxView.setInt32(shxOffset, contentOffsetWords, false);
      shxView.setInt32(shxOffset + 4, 10, false);
      shpOffset += recordLengthBytes;
      shxOffset += 8;
      contentOffsetWords += recordLengthBytes / 2;
    });
    return { shp: new Blob([shp], { type: 'application/octet-stream' }), shx: new Blob([shx], { type: 'application/octet-stream' }) };
  }

  private _writeShapeHeader(view: DataView, byteLength: number, bounds: { xmin: number; ymin: number; xmax: number; ymax: number }): void {
    view.setInt32(0, 9994, false);
    view.setInt32(24, byteLength / 2, false);
    view.setInt32(28, 1000, true);
    view.setInt32(32, 1, true);
    view.setFloat64(36, bounds.xmin, true);
    view.setFloat64(44, bounds.ymin, true);
    view.setFloat64(52, bounds.xmax, true);
    view.setFloat64(60, bounds.ymax, true);
  }

  private _shapeBounds(): { xmin: number; ymin: number; xmax: number; ymax: number } {
    return {
      xmin: Math.min(...this._results.map((p) => p.longitude)),
      ymin: Math.min(...this._results.map((p) => p.latitude)),
      xmax: Math.max(...this._results.map((p) => p.longitude)),
      ymax: Math.max(...this._results.map((p) => p.latitude)),
    };
  }

  private _buildDbf(): Blob {
    const fields = [
      { name: 'RANK', type: 'N', len: 8, dec: 0 },
      { name: 'TYPE', type: 'C', len: 12, dec: 0 },
      { name: 'ELEV_M', type: 'N', len: 12, dec: 2 },
      { name: 'PROM_M', type: 'N', len: 12, dec: 2 },
      { name: 'ISO_M', type: 'N', len: 12, dec: 2 },
    ];
    const headerLength = 32 + fields.length * 32 + 1;
    const recordLength = 1 + fields.reduce((sum, f) => sum + f.len, 0);
    const buffer = new ArrayBuffer(headerLength + this._results.length * recordLength + 1);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    const now = new Date();
    view.setUint8(0, 0x03);
    view.setUint8(1, now.getFullYear() - 1900);
    view.setUint8(2, now.getMonth() + 1);
    view.setUint8(3, now.getDate());
    view.setUint32(4, this._results.length, true);
    view.setUint16(8, headerLength, true);
    view.setUint16(10, recordLength, true);
    fields.forEach((field, i) => {
      const offset = 32 + i * 32;
      this._writeAscii(bytes, offset, field.name, 11);
      view.setUint8(offset + 11, field.type.charCodeAt(0));
      view.setUint8(offset + 16, field.len);
      view.setUint8(offset + 17, field.dec);
    });
    bytes[headerLength - 1] = 0x0d;
    this._results.forEach((p, i) => {
      let offset = headerLength + i * recordLength;
      bytes[offset++] = 0x20;
      const values = [
        String(p.rank),
        p.type,
        p.elevation.toFixed(2),
        p.prominence.toFixed(2),
        Number.isFinite(p.isolationM) ? p.isolationM.toFixed(2) : '',
      ];
      fields.forEach((field, fieldIndex) => {
        const raw = values[fieldIndex] ?? '';
        const text = field.type === 'N' ? raw.padStart(field.len, ' ') : raw.padEnd(field.len, ' ');
        this._writeAscii(bytes, offset, text.slice(0, field.len), field.len);
        offset += field.len;
      });
    });
    bytes[bytes.length - 1] = 0x1a;
    return new Blob([buffer], { type: 'application/octet-stream' });
  }

  private _writeAscii(bytes: Uint8Array, offset: number, text: string, length: number): void {
    for (let i = 0; i < length; i++) bytes[offset + i] = i < text.length ? text.charCodeAt(i) : 0x20;
  }

  private _download(filename: string, content: string, type: string): void {
    const blob = new Blob([content], { type });
    this._downloadBlob(filename, blob, type);
  }

  private _downloadBlob(filename: string, blob: Blob, type: string): void {
    const typedBlob = blob.type === type ? blob : new Blob([blob], { type });
    const url = URL.createObjectURL(typedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  private _setStatus(message: string, tone: StatusTone): void {
    const status = this._el('peaks-status');
    if (tone === 'done' || tone === 'ready') EngineLogger.success(ENGINE_NAME, message);
    else if (tone === 'warn') EngineLogger.error(ENGINE_NAME, message);
    else EngineLogger.nextStep(ENGINE_NAME, message);
    if (status) { status.textContent = message; status.className = `peaks-status-msg ${tone}`; }
    const dot = this._el('peaks-status-dot');
    const lbl = this._el('peaks-status-lbl');
    const map: Record<StatusTone, [string, string]> = { ready: ['#1D9E75', 'Ready'], running: ['#EF9F27', 'Running'], warn: ['#DC3C30', 'Check'], pick: ['#378ADD', 'Pick'], done: ['#1D9E75', 'Done'] };
    const [color, label] = map[tone];
    if (dot) { dot.style.background = color; dot.style.boxShadow = `0 0 8px ${color}88`; }
    if (lbl) lbl.textContent = label;
  }

  private _setProgress(fraction: number, label: string): void {
    const fill = this._el('peaks-progress-fill') as HTMLElement | null;
    const out = this._el('peaks-progress-label');
    if (fill) fill.style.width = `${clamp(fraction, 0, 1) * 100}%`;
    if (out) out.textContent = label;
  }

  private _makeDraggable(): void {
    if (!this._panelEl) return;
    const handle = this._panelEl.querySelector('#peaks-drag-handle') as HTMLElement | null;
    if (!handle) return;
    handle.onmousedown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      this._isDragging = true;
      const rect = this._panelEl!.getBoundingClientRect();
      this._dragOffsetX = e.clientX - rect.left;
      this._dragOffsetY = e.clientY - rect.top;
      document.addEventListener('mousemove', this._onDragMove);
      document.addEventListener('mouseup', this._onDragEnd);
    };
  }

  private _onDragMove = (e: MouseEvent): void => {
    if (!this._isDragging || !this._panelEl) return;
    this._panelEl.style.left = `${clamp(e.clientX - this._dragOffsetX, 8, window.innerWidth - 320)}px`;
    this._panelEl.style.top = `${clamp(e.clientY - this._dragOffsetY, 8, window.innerHeight - 120)}px`;
    this._panelEl.style.right = 'auto';
  };

  private _onDragEnd = (): void => {
    this._isDragging = false;
    document.removeEventListener('mousemove', this._onDragMove);
    document.removeEventListener('mouseup', this._onDragEnd);
  };

  private _el(id: string): HTMLElement | null { return this._panelEl?.querySelector(`#${id}`) ?? null; }
  private _num(id: string, fallback: number): number { const el = this._el(id) as HTMLInputElement | null; const value = el ? Number(el.value) : fallback; return Number.isFinite(value) ? value : fallback; }
  private _checked(id: string, fallback: boolean): boolean { const el = this._el(id) as HTMLInputElement | null; return el ? el.checked : fallback; }
  private _selectValue(id: string, fallback: string): string { const el = this._el(id) as HTMLSelectElement | null; return el?.value || fallback; }
  private _setSelectValue(id: string, value: string): void { const el = this._el(id) as HTMLSelectElement | null; if (el) el.value = value; }
  private _setText(id: string, value: string): void { const el = this._el(id); if (el) el.textContent = value; }
  private _tick(): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, 0)); }

  private _injectStyles(): void {
    if (document.getElementById('local-peaks-engine-styles')) return;
    const style = document.createElement('style');
    style.id = 'local-peaks-engine-styles';
    style.textContent = `
      .peaks-panel{--ms-bg:#141820;--ms-bg-header:rgba(26,32,48,.97);--ms-bg-input:rgba(0,0,0,.28);--ms-border:rgba(90,140,220,.25);--ms-divider:rgba(80,100,150,.18);--ms-text:#dce8f5;--ms-text-dim:rgba(155,180,215,.72);--ms-text-label:rgba(120,150,185,.75);--ms-radius:9px;--ms-shadow:0 8px 36px rgba(0,0,0,.55),inset 0 0 0 1px rgba(255,255,255,.04);--ms-font:'SF Pro Display','Segoe UI',system-ui,sans-serif;--ms-fs:11.5px;--ms-fs-sm:12.5px;--ms-fs-xs:10px;position:fixed;top:62px;left:306px;width:304px;max-height:calc(100vh - 84px);background:var(--ms-bg);border:1px solid var(--ms-border);border-radius:var(--ms-radius);color:var(--ms-text);font-family:var(--ms-font);font-size:var(--ms-fs);z-index:1100;box-shadow:var(--ms-shadow);display:none;overflow:hidden;user-select:none;animation:peaksIn .18s cubic-bezier(.34,1.56,.64,1)}
      @keyframes peaksIn{from{opacity:0;transform:scale(.96) translateY(-8px)}to{opacity:1;transform:scale(1) translateY(0)}}
      .peaks-header{display:flex;align-items:center;gap:7px;padding:9px 10px 8px;border-bottom:1px solid var(--ms-divider);background:var(--ms-bg-header);cursor:grab}.peaks-header:active{cursor:grabbing}.peaks-header-icon{font-size:9px;letter-spacing:.08em;color:#EF9F27;border:1px solid var(--ms-border);border-radius:3px;padding:2px 3px}.peaks-header-title{font-size:var(--ms-fs-sm);letter-spacing:.12em;text-transform:uppercase;color:#EF9F27;font-weight:700;flex:1}.peaks-status-dot{width:7px;height:7px;border-radius:50%;background:#555}.peaks-status-lbl{font-size:var(--ms-fs-xs);letter-spacing:.08em;text-transform:uppercase;color:var(--ms-text-dim);min-width:42px}.peaks-help-btn,.peaks-min-btn,.peaks-close-btn{background:none;border:1px solid transparent;color:var(--ms-text-dim);font-size:12px;cursor:pointer;padding:0 2px}.peaks-help-btn{width:17px;height:17px;border-color:var(--ms-border);border-radius:50%;color:#1D9E75;font-weight:700}
      .peaks-body{max-height:calc(100vh - 122px);overflow-y:auto;padding:0 0 8px}.peaks-status-msg{margin:8px 10px 2px;padding:6px 7px;border:1px solid var(--ms-divider);border-radius:3px;background:var(--ms-bg-input);font-size:var(--ms-fs-xs);line-height:1.35;color:var(--ms-text-dim)}.peaks-status-msg.running{color:#EF9F27}.peaks-status-msg.warn{color:#DC3C30;border-color:#DC3C30}.peaks-status-msg.pick{color:#378ADD;border-color:#378ADD}.peaks-status-msg.done,.peaks-status-msg.ready{color:#1D9E75}.peaks-sec{font-size:var(--ms-fs-xs);letter-spacing:.1em;text-transform:uppercase;color:var(--ms-text-label);padding:9px 12px 5px}.peaks-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px 8px;padding:0 10px 8px}.peaks-field{display:flex;flex-direction:column;gap:3px}.peaks-field.full{grid-column:1/-1}.peaks-field.sort{padding:0 10px 7px}.peaks-field span,.peaks-toggle label{font-size:var(--ms-fs-xs);letter-spacing:.07em;text-transform:uppercase;color:var(--ms-text-dim)}.peaks-field input,.peaks-field select,.peaks-grid select,.peaks-grid input{background:var(--ms-bg-input);border:1px solid var(--ms-border);border-radius:3px;color:var(--ms-text);font-family:inherit;font-size:var(--ms-fs);padding:5px 7px;outline:none;box-sizing:border-box;width:100%}.peaks-field input:focus,.peaks-field select:focus{border-color:#EF9F27}.peaks-field select option{background:var(--ms-bg)}
      .peaks-btn-row{display:flex;gap:6px;padding:6px 10px 0}.peaks-btn{flex:1;padding:6px 4px;font-family:inherit;font-size:var(--ms-fs-xs);letter-spacing:.05em;text-transform:uppercase;cursor:pointer;border-radius:3px;border:1px solid var(--ms-border);background:var(--ms-bg-input);color:var(--ms-text-dim);transition:all .14s}.peaks-btn:hover:not(:disabled){background:var(--ms-bg-header);color:var(--ms-text)}.peaks-btn.primary{border-color:#EF9F27;color:#EF9F27}.peaks-btn:disabled{opacity:.35;cursor:not-allowed}.peaks-toggle{display:flex;align-items:center;justify-content:space-between;padding:4px 12px}.peaks-toggle input{accent-color:#EF9F27;width:13px;height:13px;cursor:pointer}.peaks-progress{padding:7px 10px 2px}.peaks-progress>div{height:4px;background:var(--ms-bg-input);border-radius:3px;overflow:hidden;border:1px solid var(--ms-divider)}#peaks-progress-fill{height:100%;width:0;background:linear-gradient(90deg,#1D9E75,#EF9F27);transition:width .16s}#peaks-progress-label{display:block;margin-top:4px;font-size:var(--ms-fs-xs);color:var(--ms-text-dim);letter-spacing:.04em}.peaks-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:0 10px 8px}.peaks-stats div{background:var(--ms-bg-input);border:1px solid var(--ms-divider);border-radius:3px;padding:5px 6px}.peaks-stats span{display:block;font-size:var(--ms-fs-xs);text-transform:uppercase;color:var(--ms-text-label)}.peaks-stats b{display:block;margin-top:2px;font-size:var(--ms-fs-sm);color:var(--ms-text);white-space:nowrap}
      .peaks-results{max-height:230px;overflow-y:auto;padding:0 10px}.peaks-empty{padding:14px 8px;color:var(--ms-text-dim);font-size:var(--ms-fs-xs);line-height:1.5;text-align:center;border:1px dashed var(--ms-divider);border-radius:3px}.peaks-row{border:1px solid var(--ms-divider);border-radius:4px;background:var(--ms-bg-input);padding:6px 7px;margin-bottom:6px;cursor:pointer}.peaks-row:hover,.peaks-row.selected{border-color:#EF9F27;background:var(--ms-bg-header)}.peaks-row-main{display:flex;align-items:center;gap:7px}.peaks-row-main b{color:#EF9F27}.peaks-row-main span{font-size:var(--ms-fs-xs);color:var(--ms-text-dim)}.peaks-row-metrics{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;font-size:var(--ms-fs-xs);color:var(--ms-text)}.peaks-row-actions{display:flex;gap:5px;margin-top:5px}.peaks-row-actions button{flex:1;border:1px solid var(--ms-border);background:transparent;color:var(--ms-text-dim);border-radius:3px;font-size:10px;cursor:pointer}.peaks-row-actions button:hover{color:#EF9F27;border-color:#EF9F27}
      .peaks-help-popover{position:absolute;top:39px;left:8px;right:8px;z-index:1120;max-height:min(420px,calc(100vh - 132px));overflow-y:auto;background:var(--ms-bg);border:1px solid var(--ms-border);border-radius:4px;box-shadow:var(--ms-shadow)}.peaks-help-popover[hidden]{display:none}.peaks-help-head{display:flex;justify-content:space-between;gap:10px;padding:10px 11px 8px;border-bottom:1px solid var(--ms-divider);background:var(--ms-bg-header)}.peaks-help-kicker{font-size:var(--ms-fs-xs);color:var(--ms-text-label);letter-spacing:.09em;text-transform:uppercase}.peaks-help-title{margin-top:2px;font-size:13px;color:#EF9F27;font-weight:700}.peaks-help-head button{width:20px;height:20px;border:1px solid var(--ms-border);border-radius:3px;background:var(--ms-bg-input);color:var(--ms-text-dim);cursor:pointer}.peaks-help-body{padding:10px 11px 12px;font-size:var(--ms-fs-xs);line-height:1.45;color:var(--ms-text-dim);user-select:text}.peaks-help-body p{margin:0 0 9px}.peaks-help-body ol{margin:0;padding-left:17px}
      .peaks-profile-panel{position:fixed;right:18px;bottom:18px;width:min(560px,calc(100vw - 36px));height:240px;background:var(--ms-bg);border:1px solid var(--ms-border);border-radius:var(--ms-radius);z-index:1099;box-shadow:var(--ms-shadow);display:none;overflow:hidden}.peaks-profile-head{display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:var(--ms-bg-header);border-bottom:1px solid var(--ms-divider);color:#EF9F27;font-size:var(--ms-fs-xs);letter-spacing:.08em;text-transform:uppercase;font-weight:700}.peaks-profile-head button{background:transparent;border:1px solid var(--ms-border);color:var(--ms-text-dim);border-radius:3px;cursor:pointer}.peaks-profile-widget{height:205px}
      .peaks-row-header{display:flex;align-items:center;gap:7px;margin-bottom:5px}.peaks-row-badge{display:inline-flex;align-items:center;padding:2px 7px;border-radius:3px;font-size:11px;font-weight:700;color:#fff;white-space:nowrap;min-width:38px;justify-content:center;letter-spacing:.03em}.peaks-row-elev{font-size:14px;font-weight:700;color:var(--ms-text);letter-spacing:.01em}.peaks-row-unit{font-size:10px;font-weight:400;color:var(--ms-text-dim)}.peaks-row-btns{display:flex;gap:4px;margin-left:auto}.peaks-row-btns button{padding:3px 7px;border:1px solid var(--ms-border);background:transparent;color:var(--ms-text-dim);border-radius:3px;font-size:9.5px;cursor:pointer;transition:all .12s}.peaks-row-btns button:hover{color:#EF9F27;border-color:#EF9F27}.peaks-row-bar-wrap{height:3px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;margin-bottom:6px}.peaks-row-bar{height:100%;border-radius:2px;transition:width .2s}.peaks-row-metrics{display:flex;gap:10px;flex-wrap:wrap;font-size:10px;color:var(--ms-text)}.peaks-lbl{font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--ms-text-label);margin-right:2px}.peaks-row-coord{font-size:9px;color:var(--ms-text-label);margin-top:3px;font-family:'SF Mono','Consolas',monospace;letter-spacing:.03em}
      @media(max-width:560px){.peaks-panel{left:12px;top:72px;width:calc(100vw - 24px)}.peaks-grid{grid-template-columns:1fr}.peaks-profile-panel{left:12px;right:12px;width:auto}}
    `;
    document.head.appendChild(style);
  }
}

export default LocalPeaksEngine;

