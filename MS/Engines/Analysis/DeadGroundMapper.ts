import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import MediaLayer from '@arcgis/core/layers/MediaLayer';
import ExtentAndRotationGeoreference from '@arcgis/core/layers/support/ExtentAndRotationGeoreference';
import ImageElement from '@arcgis/core/layers/support/ImageElement';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Extent from '@arcgis/core/geometry/Extent';
import Mesh from '@arcgis/core/geometry/Mesh';
import Polyline from '@arcgis/core/geometry/Polyline';

const M_PER_DEG = 111_320;
const EARTH_R = 6_371_008.8;
const WGS84 = { wkid: 4326 } as any;

type DeadGroundViewMode = '2d' | '3d' | 'both';

interface DeadGroundRunResult {
  depthGrid: Float32Array;
  cols: number;
  rows: number;
  extent: Extent;
  deadCount: number;
  maxDepth: number;
  totalCells: number;
}

export class DeadGroundMapper {
  static readonly MESH_LAYER_ID = 'dead-ground-mesh';
  static readonly CONTOUR_LAYER_ID = 'dead-ground-contours';
  static readonly SPOKE_LAYER_ID = 'dead-ground-spokes';
  static readonly OBSERVER_LAYER_ID = 'dead-ground-observer';

  private _view: MapView | SceneView | null = null;
  private _meshLayer!: GraphicsLayer;
  private _contourLayer!: GraphicsLayer;
  private _spokeLayer!: GraphicsLayer;
  private _observerLayer!: GraphicsLayer;
  private _heatmapLayer: MediaLayer | null = null;

  private _panelEl: HTMLDivElement | null = null;
  private _pickHandle: any = null;
  private _observerPt: Point | null = null;
  private _obsZ = 0;
  private _running = false;
  private _currentView: DeadGroundViewMode = '2d';
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
    if (map && !map.findLayerById(this._meshLayer.id)) {
      map.addMany([
        this._meshLayer,
        this._contourLayer,
        this._spokeLayer,
        this._observerLayer,
      ]);
    }
  }

  open(graphic: Graphic, view: MapView | SceneView): void {
    this.initialize(view);
    this._showPanel();
    this._bindPick();

    const geom = graphic.geometry;
    let src: Point | null = null;
    if (geom?.type === 'point') src = geom as Point;
    else if ((geom as any)?.centroid) src = (geom as any).centroid as Point;
    if (src) {
      this._setObserver(new Point({
        longitude: src.longitude ?? src.x,
        latitude: src.latitude ?? src.y,
        spatialReference: WGS84,
      }));
    }
  }

  close(): void {
    this._hidePanel();
    this._clearResults();
    this._cancelPick();
  }

  destroy(): void {
    this.close();
    const map = this._view?.map as any;
    if (map) {
      map.remove(this._meshLayer);
      map.remove(this._contourLayer);
      map.remove(this._spokeLayer);
      map.remove(this._observerLayer);
      if (this._heatmapLayer) map.remove(this._heatmapLayer);
    }
    this._panelEl?.remove();
    this._panelEl = null;
    this._view = null;
  }

  private _createLayers(): void {
    this._meshLayer = new GraphicsLayer({
      id: DeadGroundMapper.MESH_LAYER_ID,
      title: 'Dead ground - 3D mesh',
      elevationInfo: { mode: 'absolute-height' } as any,
    });
    this._contourLayer = new GraphicsLayer({
      id: DeadGroundMapper.CONTOUR_LAYER_ID,
      title: 'Dead ground - contours',
      elevationInfo: { mode: 'on-the-ground' } as any,
    });
    this._spokeLayer = new GraphicsLayer({
      id: DeadGroundMapper.SPOKE_LAYER_ID,
      title: 'Dead ground - spokes',
      elevationInfo: { mode: 'on-the-ground' } as any,
    });
    this._observerLayer = new GraphicsLayer({
      id: DeadGroundMapper.OBSERVER_LAYER_ID,
      title: 'Dead ground - observer',
      elevationInfo: { mode: 'on-the-ground' } as any,
    });
  }

  private _bindPick(): void {
    if (!this._view || this._pickHandle) return;
    this._pickHandle = this._view.on('click', async (event: any) => {
      if (this._running || !this._panelEl || this._panelEl.style.display === 'none') return;
      const result: any = await this._view!.hitTest(event, { include: [(this._view!.map as any).ground] as any });
      const gp = result?.ground?.mapPoint ?? event.mapPoint;
      if (!gp) return;
      this._setObserver(new Point({
        longitude: gp.longitude,
        latitude: gp.latitude,
        spatialReference: WGS84,
      }));
    });
  }

  private _cancelPick(): void {
    this._pickHandle?.remove?.();
    this._pickHandle = null;
  }

  private _setObserver(point: Point): void {
    this._observerPt = point;
    const lat = point.latitude ?? point.y;
    const lon = point.longitude ?? point.x;
    const coords = this._el('dead-coords');
    if (coords) coords.textContent = `Observer: ${lat.toFixed(5)}\u00b0N  ${lon.toFixed(5)}\u00b0E`;
    const hint = this._el('dead-hint');
    if (hint) hint.style.opacity = '0';
    const runBtn = this._el('dead-btn-run') as HTMLButtonElement | null;
    if (runBtn) runBtn.disabled = false;
    this._setStatus('place', 'Observer placed - click Run');

    this._observerLayer.removeAll();
    this._observerLayer.add(new Graphic({
      geometry: point,
      symbol: this._view?.type === '3d'
        ? {
            type: 'point-3d',
            symbolLayers: [{
              type: 'object',
              resource: { primitive: 'sphere' },
              material: { color: [55, 138, 221, 0.95] },
              width: 60,
              height: 60,
              depth: 60,
            }],
            verticalOffset: { screenLength: 22, maxWorldLength: 500, minWorldLength: 4 },
          } as any
        : {
            type: 'simple-marker',
            style: 'circle',
            color: [55, 138, 221, 220],
            size: 10,
            outline: { color: [240, 240, 240, 180], width: 1.2 },
          } as any,
      attributes: { type: 'Observer', label: 'Observer position' },
    }));
  }

  private async _runAnalysis(): Promise<void> {
    if (!this._view || !this._observerPt || this._running) return;
    this._running = true;
    const runBtn = this._el('dead-btn-run') as HTMLButtonElement | null;
    if (runBtn) runBtn.disabled = true;

    const radiusM = Math.max(200, this._num('dead-inp-radius', 3000));
    const cellM = Math.max(10, this._num('dead-inp-cell', 35));
    const eyeH = Math.max(0.5, this._num('dead-inp-eye', 1.8));
    const maxDepth = Math.max(5, this._num('dead-inp-maxdepth', 50));
    const opacity = Math.max(0.2, Math.min(1, this._num('dead-inp-opacity', 0.75)));
    const showVisible = this._checked('dead-opt-visible', false);
    const showSpokes = this._checked('dead-opt-spokes', false);
    const showContours = this._checked('dead-opt-contours', true);
    const snapToTerrain = this._checked('dead-opt-snap', true);
    const show2D = this._currentView === '2d' || this._currentView === 'both';
    const show3D = this._currentView === '3d' || this._currentView === 'both';

    try {
      this._setStatus('sampling', 'Getting terrain elevation...');
      this._setProgress(0, 'Querying observer elevation');
      if (snapToTerrain) {
        try {
          const elev = await (this._view.map as any).ground.queryElevation(this._observerPt);
          this._obsZ = (elev?.geometry?.z ?? 0) + eyeH;
        } catch {
          this._obsZ = eyeH;
        }
      } else {
        this._obsZ = eyeH;
      }

      const result = await this._computeDeadGround(this._observerPt, this._obsZ, {
        radiusM,
        cellM,
        onProgress: (frac, label) => this._setProgress(frac * 0.7, label),
      });
      const realMaxDepth = Math.min(maxDepth, result.maxDepth > 0 ? result.maxDepth : maxDepth);
      let validCells = 0;
      let deadCells = 0;
      for (let i = 0; i < result.depthGrid.length; i++) {
        const d = result.depthGrid[i];
        if (!Number.isNaN(d)) {
          validCells++;
          if (d > 0) deadCells++;
        }
      }
      const pct = validCells > 0 ? Math.round((100 * deadCells) / validCells) : 0;

      this._clearResults();

      const shared = { maxDepth: realMaxDepth, opacity, showVisible, observerPt: this._observerPt };
      if (show2D) {
        this._setProgress(0.72, 'Rendering 2D heatmap...');
        this._heatmapLayer = this._buildHeatmapLayer(result.depthGrid, result.cols, result.rows, result.extent, {
          ...shared,
          radiusM,
        });
        (this._view.map as any).add(this._heatmapLayer);
      }
      if (show3D) {
        this._setProgress(0.8, 'Building 3D mesh...');
        const meshGraphic = await this._buildTerrainMesh(result.depthGrid, result.cols, result.rows, result.extent, shared);
        this._meshLayer.add(meshGraphic);
      }
      if (showContours) {
        this._setProgress(0.9, 'Drawing contours...');
        this._buildContourGraphics(result.depthGrid, result.cols, result.rows, result.extent, {
          maxDepth: realMaxDepth,
          observerPt: this._observerPt,
        }).forEach((g) => this._contourLayer.add(g));
      }
      if (showSpokes) {
        this._buildSpokeGraphics(this._observerPt, radiusM).forEach((g) => this._spokeLayer.add(g));
      }

      this._setText('dead-st-dead', `${pct}%`);
      this._setText('dead-st-depth', `${Math.round(result.maxDepth)} m`);
      this._setText('dead-st-cells', (result.cols * result.rows).toLocaleString());
      this._setProgress(1, `Done - ${pct}% dead ground`);
      this._setStatus('done', 'Done');
      this._view.goTo({ target: result.extent, tilt: show3D ? 65 : 0 }, { duration: 1000 }).catch(() => {});
    } catch (err) {
      console.error('[DeadGroundMapper] Analysis failed', err);
      this._setProgress(0, 'Analysis failed');
      this._setStatus('place', 'Analysis failed');
    } finally {
      this._running = false;
      if (runBtn) runBtn.disabled = false;
    }
  }

  private _clearResults(): void {
    this._meshLayer.removeAll();
    this._contourLayer.removeAll();
    this._spokeLayer.removeAll();
    if (this._heatmapLayer) {
      (this._view?.map as any)?.remove(this._heatmapLayer);
      this._heatmapLayer = null;
    }
  }

  private _clearAll(): void {
    this._clearResults();
    this._observerLayer.removeAll();
    this._observerPt = null;
    this._obsZ = 0;
    const runBtn = this._el('dead-btn-run') as HTMLButtonElement | null;
    if (runBtn) runBtn.disabled = true;
    const hint = this._el('dead-hint');
    if (hint) hint.style.opacity = '1';
    this._setText('dead-coords', 'Observer: click map to place');
    this._setText('dead-st-dead', '\u2014');
    this._setText('dead-st-depth', '\u2014');
    this._setText('dead-st-cells', '\u2014');
    this._setProgress(0, '\u2014');
    this._setStatus('place', 'Place observer');
  }

  private async _computeDeadGround(
    observerPt: Point,
    obsZ: number,
    opts: { radiusM: number; cellM: number; onProgress?: (frac: number, label: string) => void; },
  ): Promise<DeadGroundRunResult> {
    const radiusM = opts.radiusM;
    const cellM = opts.cellM;
    const pad = radiusM * 1.05;
    const cosLat = Math.cos(((observerPt.latitude ?? observerPt.y) * Math.PI) / 180);
    const extent = new Extent({
      xmin: (observerPt.longitude ?? observerPt.x) - pad / (M_PER_DEG * cosLat),
      ymin: (observerPt.latitude ?? observerPt.y) - pad / M_PER_DEG,
      xmax: (observerPt.longitude ?? observerPt.x) + pad / (M_PER_DEG * cosLat),
      ymax: (observerPt.latitude ?? observerPt.y) + pad / M_PER_DEG,
      spatialReference: WGS84,
    });
    const sampler = await (this._view!.map as any).ground.createElevationSampler(extent, { noDataValue: 0 });
    const cols = Math.ceil((radiusM * 2) / cellM);
    const rows = Math.ceil((radiusM * 2) / cellM);
    const N = cols * rows;
    const depthGrid = new Float32Array(N).fill(Number.NaN);
    const stepM = Math.max(10, cellM * 0.5);
    const horizonCache = new Map<string, number>();
    const lon0 = observerPt.longitude ?? observerPt.x;
    const lat0 = observerPt.latitude ?? observerPt.y;

    const getHorizon = (bearing: number, targetRange: number): number => {
      const bKey = ((Math.round(bearing) % 360) + 360) % 360;
      const rKey = Math.floor(targetRange / stepM);
      const cacheKey = `${bKey}_${rKey}`;
      const cached = horizonCache.get(cacheKey);
      if (cached != null) return cached;
      let maxSlopeDeg = -90;
      for (let d = stepM; d <= targetRange; d += stepM) {
        const tip = this._destPt(lon0, lat0, bKey, d);
        const pt = new Point({ longitude: tip.longitude, latitude: tip.latitude, spatialReference: WGS84 });
        const terrZ = sampler.queryElevation(pt)?.z ?? 0;
        const slopeDeg = (Math.atan2(terrZ - obsZ, d) * 180) / Math.PI;
        if (slopeDeg > maxSlopeDeg) maxSlopeDeg = slopeDeg;
      }
      horizonCache.set(cacheKey, maxSlopeDeg);
      return maxSlopeDeg;
    };

    let deadCount = 0;
    let maxDepth = 0;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const east = (col - cols / 2 + 0.5) * cellM;
        // Row 0 is the northern/top row, matching heatmap, contour, and mesh rendering.
        const north = (rows / 2 - row - 0.5) * cellM;
        const range = Math.sqrt(east * east + north * north);
        const idx = row * cols + col;
        if (range > radiusM || range < 2) {
          depthGrid[idx] = Number.NaN;
          continue;
        }
        const cellLon = lon0 + east / (M_PER_DEG * cosLat);
        const cellLat = lat0 + north / M_PER_DEG;
        const cellPt = new Point({ longitude: cellLon, latitude: cellLat, spatialReference: WGS84 });
        const terrZ = sampler.queryElevation(cellPt)?.z ?? 0;
        const bearing = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
        const horizonDeg = getHorizon(bearing, range);
        const losZ = obsZ + range * Math.tan((horizonDeg * Math.PI) / 180);
        const depth = losZ - terrZ;
        depthGrid[idx] = depth;
        if (depth > 0) {
          deadCount++;
          if (depth > maxDepth) maxDepth = depth;
        }
      }
      if (row % 4 === 0) {
        opts.onProgress?.((row + 1) / rows, `Row ${row + 1}/${rows}`);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    return { depthGrid, cols, rows, extent, deadCount, maxDepth, totalCells: N };
  }

  private _buildHeatmapLayer(
    depthGrid: Float32Array,
    cols: number,
    rows: number,
    extent: Extent,
    opts: { maxDepth: number; opacity: number; showVisible: boolean; radiusM: number; observerPt: Point },
  ): MediaLayer {
    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(cols, rows);
    for (let i = 0; i < depthGrid.length; i++) {
      const depth = depthGrid[i];
      const px = i * 4;
      if (Number.isNaN(depth)) {
        img.data[px + 3] = 0;
      } else if (depth > 0) {
        const rgba = this._depthToRGBA(depth, opts.maxDepth, opts.opacity);
        img.data[px] = rgba[0];
        img.data[px + 1] = rgba[1];
        img.data[px + 2] = rgba[2];
        img.data[px + 3] = rgba[3];
      } else if (opts.showVisible) {
        img.data[px] = 29;
        img.data[px + 1] = 158;
        img.data[px + 2] = 117;
        img.data[px + 3] = Math.round(opts.opacity * 0.35 * 255);
      } else {
        img.data[px + 3] = 0;
      }
    }
    ctx.putImageData(img, 0, 0);
    const imageElement = new ImageElement({
      image: canvas.toDataURL('image/png'),
      georeference: new ExtentAndRotationGeoreference({ extent }),
    });
    return new MediaLayer({ source: [imageElement], title: 'Dead ground heatmap', opacity: 1 });
  }

  private _buildContourGraphics(
    depthGrid: Float32Array,
    cols: number,
    rows: number,
    extent: Extent,
    opts: { maxDepth: number; observerPt: Point },
  ): Graphic[] {
    const graphics: Graphic[] = [];
    const levels = [5, 10, 20, 35, 50, 75, 100].filter((l) => l <= opts.maxDepth * 1.1);
    const dLon = (extent.xmax - extent.xmin) / cols;
    const dLat = (extent.ymax - extent.ymin) / rows;

    levels.forEach((level) => {
      const t = Math.min(1, level / opts.maxDepth);
      const stops = [[140, 28, 28], [220, 60, 48], [239, 159, 39], [245, 240, 64]];
      const si = t * (stops.length - 1);
      const lo = Math.floor(si);
      const hi = Math.min(stops.length - 1, lo + 1);
      const f = si - lo;
      const [r1, g1, b1] = stops[lo];
      const [r2, g2, b2] = stops[hi];
      const col = [Math.round(r1 + (r2 - r1) * f), Math.round(g1 + (g2 - g1) * f), Math.round(b1 + (b2 - b1) * f)];
      const segments: number[][][] = [];

      for (let row = 0; row < rows - 1; row++) {
        for (let c = 0; c < cols - 1; c++) {
          const d00 = depthGrid[row * cols + c];
          const d10 = depthGrid[row * cols + c + 1];
          const d01 = depthGrid[(row + 1) * cols + c];
          const d11 = depthGrid[(row + 1) * cols + c + 1];
          if ([d00, d10, d01, d11].some((d) => Number.isNaN(d))) continue;

          const lon0 = extent.xmin + c * dLon;
          const lon1 = extent.xmin + (c + 1) * dLon;
          const lat0 = extent.ymax - row * dLat;
          const lat1 = extent.ymax - (row + 1) * dLat;
          const crossings: number[][] = [];
          const check = (va: number, vb: number, a: number[], b: number[]) => {
            if ((va < level) !== (vb < level)) {
              const frac = (level - va) / (vb - va);
              crossings.push([a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac]);
            }
          };
          check(d00, d10, [lon0, lat0], [lon1, lat0]);
          check(d10, d11, [lon1, lat0], [lon1, lat1]);
          check(d11, d01, [lon1, lat1], [lon0, lat1]);
          check(d01, d00, [lon0, lat1], [lon0, lat0]);
          if (crossings.length === 2) {
            segments.push([crossings[0], crossings[1]]);
          }
        }
      }

      if (segments.length > 10) {
        graphics.push(new Graphic({
          geometry: new Polyline({ paths: segments as any, spatialReference: WGS84 }),
          symbol: { type: 'simple-line', color: [...col, 180], width: 1, style: 'solid' } as any,
          attributes: { type: 'contour', label: `${level} m depth contour` },
        }));
      }
    });
    return graphics;
  }

  private async _buildTerrainMesh(
    depthGrid: Float32Array,
    cols: number,
    rows: number,
    extent: Extent,
    opts: { maxDepth: number; opacity: number; showVisible: boolean; observerPt: Point },
  ): Promise<Graphic> {
    const sampler = await (this._view!.map as any).ground.createElevationSampler(extent, { noDataValue: 0 });
    const dLon = (extent.xmax - extent.xmin) / cols;
    const dLat = (extent.ymax - extent.ymin) / rows;
    const N = cols * rows;
    const positions = new Float64Array(N * 3);
    const colors = new Uint8Array(N * 4);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        const depth = depthGrid[i];
        const lon = extent.xmin + (col + 0.5) * dLon;
        const lat = extent.ymax - (row + 0.5) * dLat;
        const pt = new Point({ longitude: lon, latitude: lat, spatialReference: WGS84 });
        const z = (sampler.queryElevation(pt)?.z ?? 0) + 0.5;
        positions[i * 3] = lon;
        positions[i * 3 + 1] = lat;
        positions[i * 3 + 2] = z;
        if (Number.isNaN(depth)) {
          colors[i * 4 + 3] = 0;
          continue;
        }
        if (depth > 0) {
          const rgba = this._depthToRGBA(depth, opts.maxDepth, opts.opacity);
          colors[i * 4] = rgba[0];
          colors[i * 4 + 1] = rgba[1];
          colors[i * 4 + 2] = rgba[2];
          colors[i * 4 + 3] = rgba[3];
        } else if (opts.showVisible) {
          colors[i * 4] = 29;
          colors[i * 4 + 1] = 158;
          colors[i * 4 + 2] = 117;
          colors[i * 4 + 3] = Math.round(opts.opacity * 0.3 * 255);
        } else {
          colors[i * 4 + 3] = 0;
        }
      }
    }

    const numFaces = (cols - 1) * (rows - 1) * 2;
    const faces = new Uint32Array(numFaces * 3);
    let fi = 0;
    for (let row = 0; row < rows - 1; row++) {
      for (let col = 0; col < cols - 1; col++) {
        const v00 = row * cols + col;
        const v10 = row * cols + col + 1;
        const v01 = (row + 1) * cols + col;
        const v11 = (row + 1) * cols + col + 1;
        faces[fi++] = v00; faces[fi++] = v10; faces[fi++] = v01;
        faces[fi++] = v10; faces[fi++] = v11; faces[fi++] = v01;
      }
    }

    const mesh = new Mesh({
      vertexAttributes: { position: positions, color: colors },
      components: [{ faces, material: { colorMixMode: 'replace', doubleSided: true } as any }],
      spatialReference: WGS84,
    } as any);
    return new Graphic({
      geometry: mesh,
      symbol: {
        type: 'mesh-3d',
        symbolLayers: [{ type: 'fill', material: { color: [255, 255, 255, 255], colorMixMode: 'replace' } }],
      } as any,
      attributes: { type: 'dead_ground_mesh', label: 'Dead ground depth mesh' },
    });
  }

  private _buildSpokeGraphics(observerPt: Point, radiusM: number): Graphic[] {
    const lon0 = observerPt.longitude ?? observerPt.x;
    const lat0 = observerPt.latitude ?? observerPt.y;
    const g: Graphic[] = [];
    for (let i = 0; i < 36; i++) {
      const brg = (i / 36) * 360;
      const tip = this._destPt(lon0, lat0, brg, radiusM);
      g.push(new Graphic({
        geometry: new Polyline({
          paths: [[[lon0, lat0], [tip.longitude, tip.latitude]]],
          spatialReference: WGS84,
        }),
        symbol: { type: 'simple-line', color: [220, 60, 48, 30], width: 0.5 } as any,
      }));
    }
    return g;
  }

  private _destPt(lon: number, lat: number, bearingDeg: number, distM: number): { longitude: number; latitude: number } {
    const d = distM / EARTH_R;
    const t = (bearingDeg * Math.PI) / 180;
    const p1 = (lat * Math.PI) / 180;
    const l1 = (lon * Math.PI) / 180;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
    const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return { longitude: (l2 * 180) / Math.PI, latitude: (p2 * 180) / Math.PI };
  }

  private _depthToRGBA(depth: number, maxDepth: number, opacity: number): [number, number, number, number] {
    const t = Math.min(1, depth / maxDepth);
    const stops = [[30, 10, 10], [140, 28, 28], [220, 60, 48], [239, 159, 39], [245, 240, 64]];
    const seg = t * (stops.length - 1);
    const lo = Math.floor(seg);
    const hi = Math.min(stops.length - 1, lo + 1);
    const frac = seg - lo;
    const [r1, g1, b1] = stops[lo];
    const [r2, g2, b2] = stops[hi];
    return [
      Math.round(r1 + (r2 - r1) * frac),
      Math.round(g1 + (g2 - g1) * frac),
      Math.round(b1 + (b2 - b1) * frac),
      Math.round(opacity * 255),
    ];
  }

  private _showPanel(): void {
    if (!this._panelEl) {
      this._panelEl = document.createElement('div');
      this._panelEl.className = 'dead-ground-panel';
      this._panelEl.innerHTML = this._buildPanelHtml();
      document.body.appendChild(this._panelEl);
      this._bindPanelEvents();
      this._makeDraggable();
    }
    this._panelEl.style.display = 'block';
  }

  private _hidePanel(): void {
    if (!this._panelEl) return;
    this._panelEl.style.display = 'none';
  }

  private _buildPanelHtml(): string {
    return `
      <div class="dead-ph" id="dead-drag-handle">
        <div class="dead-ph-title">⊘ Dead Ground Mapper</div>
        <div class="dead-ph-status place" id="dead-status">Place observer</div>
        <button class="dead-help-btn" id="dead-help-btn">?</button>
        <button class="dead-minimize-btn" id="dead-minimize-btn">▼</button>
        <button class="dead-close-btn" id="dead-close-btn">×</button>
      </div>
      <div class="dead-help-popover" id="dead-help-popover" hidden>
        <div class="dead-help-head">
          <div>
            <div class="dead-help-kicker">Help Wiki</div>
            <div class="dead-help-title">Dead Ground Mapper</div>
          </div>
          <button class="dead-help-close" id="dead-help-close">×</button>
        </div>
        <div class="dead-help-body">
          <p>Dead ground is terrain hidden from an observer by intervening relief. This tool computes vertical dead-ground depth using terrain horizon sweep from the observer eye.</p>
          <div class="dead-help-block"><h4>Workflow</h4><ol><li>Place observer by clicking map.</li><li>Set eye height, radius, and grid cell size.</li><li>Select 2D heatmap, 3D mesh, or both.</li><li>Run analysis and inspect depth contours/stats.</li></ol></div>
          <div class="dead-help-block"><h4>Display</h4><p>Red→yellow indicates increasing dead-ground depth. Optional green shading shows visible terrain, spokes show LOS radial directions, and contours show equal-depth lines.</p></div>
        </div>
      </div>
      <div class="dead-body">
        <div class="dead-vtabs">
          <button class="dead-vtab active" data-view="2d">2D Heatmap</button>
          <button class="dead-vtab" data-view="3d">3D Mesh</button>
          <button class="dead-vtab" data-view="both">Both</button>
        </div>
        <div class="dead-ps">Observer</div>
        <div class="dead-pg">
          <div class="dead-pf"><div class="dead-pl">Eye height (m)</div><input id="dead-inp-eye" type="number" value="1.8" min="0.5" max="20" step="0.1" /></div>
          <div class="dead-pf"><div class="dead-pl">Analysis radius (m)</div><input id="dead-inp-radius" type="number" value="3000" min="200" max="15000" step="100" /></div>
        </div>
        <div class="dead-ps">Grid resolution</div>
        <div class="dead-pg">
          <div class="dead-pf dead-full"><div class="dead-pl">Cell size (m) - finer = slower</div>
            <select id="dead-inp-cell">
              <option value="20">20 m - fine (slow)</option>
              <option value="35" selected>35 m - balanced</option>
              <option value="50">50 m - fast</option>
              <option value="80">80 m - preview</option>
            </select>
          </div>
        </div>
        <div class="dead-ps">Depth colour scale</div>
        <div class="dead-psr"><div class="dead-psr-l">Max depth (m)</div><input id="dead-inp-maxdepth" type="range" min="5" max="200" step="5" value="50"/><div class="dead-psr-v" id="dead-maxdepth-v">50 m</div></div>
        <div class="dead-psr"><div class="dead-psr-l">Heatmap opacity</div><input id="dead-inp-opacity" type="range" min="0.2" max="1.0" step="0.05" value="0.75"/><div class="dead-psr-v" id="dead-opacity-v">0.75</div></div>
        <div class="dead-pdiv"></div>
        <div class="dead-ps">Display options</div>
        <div class="dead-ptr"><label>Show visible ground</label><input id="dead-opt-visible" type="checkbox"/></div>
        <div class="dead-ptr"><label>Show observer LOS spokes</label><input id="dead-opt-spokes" type="checkbox"/></div>
        <div class="dead-ptr"><label>Show depth contours</label><input id="dead-opt-contours" type="checkbox" checked/></div>
        <div class="dead-ptr"><label>Snap to terrain elevation</label><input id="dead-opt-snap" type="checkbox" checked/></div>
        <div class="dead-pdiv"></div>
        <div id="dead-depthkey">
          <div class="dead-dk-label">Dead ground depth key</div>
          <div class="dead-dk-bar"></div>
          <div class="dead-dk-legend"><span>0 m (shallow)</span><span id="dead-dk-max">50 m (deep)</span></div>
        </div>
        <div id="dead-progress-wrap"><div id="dead-progress-track"><div id="dead-progress-fill"></div></div><div id="dead-progress-label">—</div></div>
        <div id="dead-stats">
          <div class="dead-st"><div class="dead-st-l">Dead ground</div><div class="dead-st-v" id="dead-st-dead">—</div></div>
          <div class="dead-st"><div class="dead-st-l">Max depth</div><div class="dead-st-v" id="dead-st-depth">—</div></div>
          <div class="dead-st"><div class="dead-st-l">Cells</div><div class="dead-st-v" id="dead-st-cells">—</div></div>
        </div>
        <div id="dead-coords">Observer: click map to place</div>
        <div class="dead-pb-row">
          <button class="dead-pb" id="dead-btn-clear">Clear</button>
          <button class="dead-pb dead-primary" id="dead-btn-run" disabled>Run analysis ↗</button>
        </div>
        <div id="dead-legend">
          <div class="dead-leg-row"><div class="dead-leg-swatch" style="background:linear-gradient(to right,#3a1a1a,#DC3C30,#EF9F27,#F5F040)"></div><div class="dead-leg-lbl">Dead ground - shallow → deep</div></div>
          <div class="dead-leg-row"><div class="dead-leg-swatch" style="background:rgba(29,158,117,0.35);border:1px solid #1D9E75"></div><div class="dead-leg-lbl">Visible ground (if enabled)</div></div>
          <div class="dead-leg-row"><div class="dead-leg-swatch" style="background:#378ADD"></div><div class="dead-leg-lbl">Observer position</div></div>
        </div>
        <div id="dead-hint">Click anywhere on the map to place the observer</div>
      </div>
    `;
  }

  private _bindPanelEvents(): void {
    if (!this._panelEl) return;
    const p = this._panelEl;
    p.querySelector('#dead-help-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const help = this._el('dead-help-popover');
      if (help) help.hidden = !help.hidden;
    });
    p.querySelector('#dead-help-close')?.addEventListener('click', () => {
      const help = this._el('dead-help-popover');
      if (help) help.hidden = true;
    });
    p.querySelector('#dead-minimize-btn')?.addEventListener('click', () => {
      const body = p.querySelector<HTMLElement>('.dead-body');
      const btn = this._el('dead-minimize-btn');
      if (!body || !btn) return;
      const minimized = body.style.display === 'none';
      body.style.display = minimized ? '' : 'none';
      btn.textContent = minimized ? '▼' : '▶';
    });
    p.querySelector('#dead-close-btn')?.addEventListener('click', () => this._hidePanel());
    p.querySelector('#dead-btn-clear')?.addEventListener('click', () => this._clearAll());
    p.querySelector('#dead-btn-run')?.addEventListener('click', () => void this._runAnalysis());
    p.querySelector('#dead-inp-maxdepth')?.addEventListener('input', () => {
      const v = this._num('dead-inp-maxdepth', 50);
      this._setText('dead-maxdepth-v', `${Math.round(v)} m`);
      this._setText('dead-dk-max', `${Math.round(v)} m (deep)`);
    });
    p.querySelector('#dead-inp-opacity')?.addEventListener('input', () => {
      this._setText('dead-opacity-v', this._num('dead-inp-opacity', 0.75).toFixed(2));
    });
    p.querySelectorAll('.dead-vtab').forEach((tab) => {
      tab.addEventListener('click', () => {
        p.querySelectorAll('.dead-vtab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const v = (tab as HTMLElement).dataset.view as DeadGroundViewMode;
        this._currentView = v || '2d';
      });
    });
  }

  private _makeDraggable(): void {
    if (!this._panelEl) return;
    const handle = this._panelEl.querySelector<HTMLElement>('#dead-drag-handle');
    if (!handle) return;
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

  private _setStatus(state: 'place' | 'sampling' | 'building' | 'done', text: string): void {
    const el = this._el('dead-status');
    if (!el) return;
    el.textContent = text;
    el.className = `dead-ph-status ${state}`;
  }

  private _setProgress(frac: number, label: string): void {
    const fill = this._el('dead-progress-fill');
    const lbl = this._el('dead-progress-label');
    if (fill) fill.style.width = `${Math.round(frac * 100)}%`;
    if (lbl) lbl.textContent = label;
  }

  private _num(id: string, fallback: number): number {
    const el = this._el(id) as HTMLInputElement | null;
    const n = el ? Number(el.value) : fallback;
    return Number.isFinite(n) ? n : fallback;
  }

  private _checked(id: string, fallback: boolean): boolean {
    const el = this._el(id) as HTMLInputElement | null;
    return el ? el.checked : fallback;
  }

  private _setText(id: string, text: string): void {
    const el = this._el(id);
    if (el) el.textContent = text;
  }

  private _el(id: string): HTMLElement | null {
    return this._panelEl?.querySelector(`#${id}`) ?? null;
  }

  private _injectStyles(): void {
    if (document.getElementById('dead-ground-engine-styles')) return;
    const style = document.createElement('style');
    style.id = 'dead-ground-engine-styles';
    style.textContent = `
      .dead-ground-panel{position:fixed;top:60px;left:1210px;width:306px;max-width:calc(100vw - 24px);z-index:1100;background:rgba(6,8,9,0.97);border:1px solid rgba(220,60,48,0.30);border-radius:5px;color:#bfbcb4;font-family:'Courier New',monospace;font-size:12px;max-height:calc(100vh - 80px);overflow-y:auto;overflow-x:hidden;display:none;user-select:none;box-shadow:0 8px 24px rgba(0,0,0,0.38);box-sizing:border-box}
      .dead-ground-panel *{box-sizing:border-box}
      .dead-ph{display:flex;align-items:center;gap:6px;padding:9px 10px 8px;border-bottom:1px solid rgba(220,60,48,0.15);background:rgba(220,60,48,0.07);position:sticky;top:0;z-index:2;cursor:grab}
      .dead-ph:active{cursor:grabbing}
      .dead-ph-title{font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:#DC3C30;font-weight:700;flex:1}
      .dead-ph-status{font-size:9px;letter-spacing:.07em;text-transform:uppercase;color:#3a3935;transition:color .2s}
      .dead-ph-status.sampling{color:#EF9F27}.dead-ph-status.building{color:#378ADD}.dead-ph-status.done{color:#1D9E75}.dead-ph-status.place{color:#DC3C30}
      .dead-help-btn,.dead-minimize-btn,.dead-close-btn{background:none;border:1px solid transparent;color:#888780;font-size:12px;cursor:pointer;padding:0 2px;line-height:1}
      .dead-help-btn{width:17px;height:17px;border-color:rgba(220,60,48,0.3);border-radius:50%;color:#1D9E75;font-weight:700}
      .dead-help-btn:hover,.dead-minimize-btn:hover,.dead-close-btn:hover{color:#d6d2c8}
      .dead-help-popover{position:absolute;top:39px;left:8px;right:8px;z-index:1120;max-height:min(520px,calc(100vh - 132px));overflow-y:auto;background:rgba(6,8,9,0.97);border:1px solid rgba(220,60,48,0.30);border-radius:4px;box-shadow:0 8px 24px rgba(0,0,0,0.38)}
      .dead-help-popover[hidden]{display:none}
      .dead-help-head{display:flex;justify-content:space-between;gap:10px;padding:10px 11px 8px;border-bottom:1px solid rgba(220,60,48,0.15);background:rgba(220,60,48,0.07)}
      .dead-help-kicker{font-size:9px;color:#888780;letter-spacing:.09em;text-transform:uppercase}
      .dead-help-title{margin-top:2px;font-size:13px;color:#1D9E75;font-weight:700}
      .dead-help-close{width:20px;height:20px;border:1px solid rgba(220,60,48,0.25);border-radius:3px;background:rgba(255,255,255,0.04);color:#888780;cursor:pointer}
      .dead-help-body{padding:10px 11px 12px;font-size:10px;line-height:1.45;color:#bfbcb4;user-select:text}
      .dead-help-body p{margin:0 0 9px}.dead-help-block{margin-top:10px}.dead-help-block h4{margin:0 0 5px;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#DC3C30}.dead-help-block ol{margin:0;padding-left:17px}.dead-help-block li{margin:3px 0}
      .dead-body{padding-bottom:6px;overflow-x:hidden}
      .dead-vtabs{display:flex;gap:0;border-bottom:1px solid rgba(255,255,255,0.07)}
      .dead-vtab{flex:1;padding:7px;font-family:'Courier New',monospace;font-size:9px;letter-spacing:.07em;text-transform:uppercase;cursor:pointer;border:none;background:transparent;color:#888780;transition:all .13s}
      .dead-vtab.active{color:#DC3C30;border-bottom:2px solid #DC3C30}
      .dead-ps{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#3a3935;padding:9px 12px 5px}
      .dead-pg{display:grid;grid-template-columns:1fr 1fr;gap:7px 10px;padding:0 12px 9px}
      .dead-pf{display:flex;flex-direction:column;gap:3px}.dead-full{grid-column:1/-1}
      .dead-pl{font-size:9px;letter-spacing:.07em;text-transform:uppercase;color:#888780}
      .dead-ground-panel input,.dead-ground-panel select{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:3px;color:#bfbcb4;font-family:'Courier New',monospace;font-size:11px;padding:5px 7px;width:100%;outline:none;transition:border-color .15s}
      .dead-ground-panel input:focus,.dead-ground-panel select:focus{border-color:rgba(220,60,48,0.55)} .dead-ground-panel select option{background:#141618}
      .dead-psr{display:flex;align-items:center;gap:8px;padding:0 12px 8px}.dead-psr-l{font-size:9px;letter-spacing:.07em;text-transform:uppercase;color:#888780;flex:1.6}.dead-psr input[type=range]{flex:2;accent-color:#DC3C30;cursor:pointer}.dead-psr-v{font-size:10px;color:#DC3C30;min-width:40px;text-align:right}
      .dead-pdiv{height:1px;background:rgba(255,255,255,0.07);margin:4px 0}
      .dead-ptr{display:flex;align-items:center;justify-content:space-between;padding:5px 12px}.dead-ptr label{font-size:9px;letter-spacing:.07em;text-transform:uppercase;color:#888780;cursor:pointer}.dead-ptr input[type=checkbox]{accent-color:#DC3C30;width:13px;height:13px;cursor:pointer}
      #dead-depthkey{margin:0 12px 9px}.dead-dk-label{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#3a3935;margin-bottom:5px}.dead-dk-bar{height:10px;border-radius:2px;background:linear-gradient(to right,#3a1a1a,#8B1A1A,#DC3C30,#EF9F27,#F5F040);border:1px solid rgba(255,255,255,0.08)}.dead-dk-legend{display:flex;justify-content:space-between;margin-top:3px;font-size:8px;color:#3a3935}
      #dead-progress-wrap{padding:0 12px 9px}#dead-progress-track{height:7px;background:rgba(46,168,255,0.18);border:1px solid rgba(46,168,255,0.55);border-radius:3px;overflow:hidden}#dead-progress-fill{height:100%;background:#2EA8FF;border-radius:2px;width:0%;transition:width .12s;box-shadow:0 0 8px rgba(46,168,255,0.55)}#dead-progress-label{font-size:9px;color:#5fbfff;letter-spacing:.05em;margin-top:4px}
      #dead-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:4px 8px;margin:0 12px 8px;background:rgba(220,60,48,0.06);border:1px solid rgba(220,60,48,0.15);border-radius:3px;padding:7px 9px;font-size:10px}
      .dead-st{display:flex;flex-direction:column;gap:1px}.dead-st-l{font-size:8px;letter-spacing:.08em;text-transform:uppercase;color:#3a3935}.dead-st-v{color:#DC3C30}
      #dead-coords{font-size:9px;color:#DC3C30;padding:2px 12px 7px;letter-spacing:.05em;opacity:.75}
      .dead-pb-row{display:flex;gap:6px;padding:9px 12px}.dead-pb{flex:1;padding:7px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;border-radius:3px;border:1px solid rgba(220,60,48,0.38);background:transparent;color:#DC3C30;transition:all .14s}.dead-pb:hover:not(:disabled){background:rgba(220,60,48,0.10)}.dead-primary{background:rgba(220,60,48,0.16);border-color:#DC3C30}.dead-primary:hover:not(:disabled){background:rgba(220,60,48,0.28)}.dead-pb:disabled{opacity:.3;cursor:not-allowed}
      #dead-legend{margin:0 12px 8px;background:rgba(6,8,9,0.93);border:1px solid rgba(255,255,255,0.08);border-radius:4px;padding:9px 13px;display:flex;flex-direction:column;gap:5px}
      .dead-leg-row{display:flex;align-items:center;gap:8px}.dead-leg-swatch{width:28px;height:10px;border-radius:2px;flex-shrink:0}.dead-leg-lbl{font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:#888780}
      #dead-hint{margin:0 12px 10px;background:rgba(6,8,9,0.94);border:1px solid rgba(220,60,48,0.45);color:#DC3C30;font-family:'Courier New',monospace;font-size:11px;letter-spacing:.08em;padding:8px 10px;border-radius:3px;pointer-events:none;text-transform:uppercase;transition:opacity .25s;text-align:center}
    `;
    document.head.appendChild(style);
  }
}

export default DeadGroundMapper;
