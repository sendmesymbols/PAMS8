/**
 * CorridorEngine.ts
 * Route corridor / MSR analysis engine.
 *
 * Integrated with ContextMenuManager via linkCorridorEngine().
 * Right-clicking a symbol -> Analysis -> Corridor Analysis opens this panel.
 */

import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polyline from '@arcgis/core/geometry/Polyline';
import Polygon from '@arcgis/core/geometry/Polygon';
import * as geometryEngine from '@arcgis/core/geometry/geometryEngine';

import {
  CORRIDOR_PRESETS,
  EXPOSURE_COLORS,
  destinationPoint,
  densifyRoute,
  computeLegs,
  scoreSegments,
  detectChokepoints,
} from './corridor-engine.js';

type Waypoint = { longitude: number; latitude: number };
type PlacementMode = 'waypoint' | 'threat' | null;

interface ThreatOverlayPreset {
  id: string;
  label: string;
  radiusM: number;
  color: [number, number, number];
}

interface ThreatItem {
  id: number;
  overlayId: string;
  label: string;
  radiusM: number;
  longitude: number;
  latitude: number;
  color: [number, number, number];
  geometry: Polygon;
}

interface CorridorPanelOverride {
  presetKey?: string;
  corridorM?: number;
  standoffM?: number;
  exclusionM?: number;
  segmentLenM?: number;
}

interface CorridorPreset {
  label: string;
  corridorM: number;
  standoffM: number;
  exclusionM: number;
  segmentLenM: number;
  color: [number, number, number];
}

interface CorridorAnalysisMeta {
  committedAt: string;
  presetKey: string;
  waypoints: Waypoint[];
  corridorM: number;
  standoffM: number;
  exclusionM: number;
  segmentLenM: number;
}

const THREAT_OVERLAY_PRESETS: ThreatOverlayPreset[] = [
  { id: 'high', label: 'High-threat zone', radiusM: 2000, color: [220, 60, 48] },
  { id: 'medium', label: 'Medium-threat zone', radiusM: 1200, color: [239, 159, 39] },
  { id: 'low', label: 'Low-threat zone', radiusM: 700, color: [120, 200, 80] },
  { id: 'observation', label: 'Observation threat', radiusM: 3000, color: [55, 138, 221] },
];

export class CorridorEngine {
  static readonly ANALYSIS_LAYER_ID = 'corridor-analysis';
  static readonly THREAT_LAYER_ID = 'corridor-threats';
  static readonly COMMITTED_LAYER_ID = 'corridor-committed';
  static readonly PREVIEW_LAYER_ID = 'corridor-preview';

  private _view: MapView | SceneView | null = null;
  private _analysisLayer!: GraphicsLayer;
  private _threatLayer!: GraphicsLayer;
  private _committedLayer!: GraphicsLayer;
  private _previewLayer!: GraphicsLayer;

  private _panelEl: HTMLDivElement | null = null;
  private _waypoints: Waypoint[] = [];
  private _threats: ThreatItem[] = [];
  private _routeDrawn = false;
  private _placementMode: PlacementMode = null;
  private _activeThreatOverlayId = THREAT_OVERLAY_PRESETS[0].id;
  private _mapClickHandle: { remove(): void } | null = null;
  private _workingGraphics: Graphic[] = [];
  private _lastAvgScore = 0;

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
        this._threatLayer,
        this._previewLayer,
      ]);
    }
  }

  open(graphic: Graphic, view: MapView | SceneView): void {
    this.initialize(view);
    const attrs = graphic.attributes ?? {};

    if (attrs.type === 'corridor_zone' && attrs.committedAt != null) {
      this._restoreFromCommitted(attrs as Partial<CorridorAnalysisMeta>);
      this._showPanel({
        presetKey: attrs.presetKey as string | undefined,
        corridorM: attrs.corridorM as number | undefined,
        standoffM: attrs.standoffM as number | undefined,
        exclusionM: attrs.exclusionM as number | undefined,
        segmentLenM: attrs.segmentLenM as number | undefined,
      });
      this._redraw();
      return;
    }

    if (this._panelEl && this._panelEl.style.display === 'none') {
      this._panelEl.style.display = 'block';
      return;
    }

    const maybePoint = this._graphicToPoint(graphic);
    if (maybePoint) {
      const wp = { longitude: maybePoint.longitude, latitude: maybePoint.latitude };
      if (this._waypoints.length === 0) this._waypoints.push(wp);
    }

    this._showPanel();
    this._drawPreview();
    this._refreshPanel();
    this._setStatus(this._waypoints.length >= 2 ? 'ready' : 'awaiting');
  }

  close(): void {
    this._hidePanel();
    this._analysisLayer.removeAll();
    this._previewLayer.removeAll();
    this._threatLayer.removeAll();
    this._workingGraphics = [];
    this._routeDrawn = false;
    this._waypoints = [];
    this._threats = [];
    this._lastAvgScore = 0;
    this._cancelPlacement();
  }

  destroy(): void {
    this.close();
    const map = this._view?.map as any;
    if (map) {
      map.remove(this._analysisLayer);
      map.remove(this._threatLayer);
      map.remove(this._previewLayer);
      map.remove(this._committedLayer);
    }
    this._panelEl?.remove();
    this._panelEl = null;
    this._view = null;
  }

  private _createLayers(): void {
    this._analysisLayer = new GraphicsLayer({
      id: CorridorEngine.ANALYSIS_LAYER_ID,
      title: 'Corridor - Working',
      elevationInfo: { mode: 'on-the-ground' } as any,
    });
    this._threatLayer = new GraphicsLayer({
      id: CorridorEngine.THREAT_LAYER_ID,
      title: 'Corridor - Threats',
      elevationInfo: { mode: 'on-the-ground' } as any,
    });
    this._previewLayer = new GraphicsLayer({
      id: CorridorEngine.PREVIEW_LAYER_ID,
      title: 'Corridor - Preview',
      elevationInfo: { mode: 'on-the-ground' } as any,
    });
    this._committedLayer = new GraphicsLayer({
      id: CorridorEngine.COMMITTED_LAYER_ID,
      title: 'Corridor - Committed',
      elevationInfo: { mode: 'on-the-ground' } as any,
    });
  }

  private _showPanel(override?: CorridorPanelOverride): void {
    if (!this._panelEl) {
      this._panelEl = document.createElement('div');
      this._panelEl.id = 'corridor-engine-panel';
      this._panelEl.className = 'corr-panel';
      document.body.appendChild(this._panelEl);
    }
    this._panelEl.innerHTML = this._buildPanelHTML(override);
    this._panelEl.style.display = 'block';
    this._bindPanelEvents();
    this._makeDraggable();
    this._refreshPanel();
  }

  private _hidePanel(): void {
    if (this._panelEl) this._panelEl.style.display = 'none';
    this._cancelPlacement();
  }

  private _buildPanelHTML(override?: CorridorPanelOverride): string {
    const presetMap = CORRIDOR_PRESETS as unknown as Record<string, CorridorPreset>;
    const fallbackPreset = presetMap.vehicle_patrol;
    const initialPreset = override?.presetKey && presetMap[override.presetKey]
      ? override.presetKey
      : 'vehicle_patrol';
    const preset = presetMap[initialPreset] ?? fallbackPreset;
    const corridorM = override?.corridorM ?? preset.corridorM;
    const standoffM = override?.standoffM ?? preset.standoffM;
    const exclusionM = override?.exclusionM ?? preset.exclusionM;
    const segmentLenM = override?.segmentLenM ?? preset.segmentLenM;

    const presetOptions = Object.entries(presetMap)
      .map(([k, p]) => `<option value="${k}"${k === initialPreset ? ' selected' : ''}>${p.label}</option>`)
      .join('');

    return `
      <div class="corr-header" id="corr-drag-handle">
        <span class="corr-header-icon">⤳</span>
        <span class="corr-header-title">Corridor Analysis</span>
        <span class="corr-status-dot" id="corr-status-dot"></span>
        <span class="corr-status-lbl" id="corr-status-lbl">Awaiting route</span>
        <button class="corr-help-btn" id="corr-help-btn" title="How corridor analysis works">?</button>
        <button class="corr-minimize-btn" id="corr-minimize-btn" title="Minimize">▼</button>
        <button class="corr-close-btn" id="corr-close-btn" title="Close (keeps graphics)">✕</button>
      </div>
      <div class="corr-help-popover" id="corr-help-popover" hidden>
        <div class="corr-help-head">
          <div>
            <div class="corr-help-kicker">Field Guide</div>
            <div class="corr-help-title">Corridor Analysis</div>
          </div>
          <button class="corr-help-close" id="corr-help-close" title="Close">✕</button>
        </div>
        <div class="corr-help-body">
          <p>Builds a movement corridor from two or more waypoints, then scores route exposure against placed threat overlays.</p>
          <div class="corr-help-block">
            <h4>Workflow</h4>
            <ol>
              <li>Add waypoints to define the route centerline.</li>
              <li>Select or place threat overlays near the route.</li>
              <li>Analyze to generate corridor, standoff, exclusion, heat-map, labels, and chokepoint graphics.</li>
              <li>Commit to keep the current analysis on the map.</li>
            </ol>
          </div>
          <div class="corr-help-block">
            <h4>Parameters</h4>
            <dl>
              <dt>Corridor</dt><dd>Buffer distance on each side of the route centerline.</dd>
              <dt>Standoff</dt><dd>Outer planning buffer around the movement corridor.</dd>
              <dt>Exclusion</dt><dd>Outer caution ring beyond standoff, useful for no-go or watch areas.</dd>
              <dt>Segment</dt><dd>Approximate route slice length used for exposure scoring.</dd>
            </dl>
          </div>
          <div class="corr-help-block">
            <h4>Exposure Score</h4>
            <p>Each route segment is buffered by corridor width and intersected with all threat polygons. The segment score is overlap area divided by segment corridor area, clamped from 0 to 100%.</p>
            <div class="corr-help-formula">score = threat overlap area / segment corridor area</div>
          </div>
          <div class="corr-help-block">
            <h4>Factors And Weights</h4>
            <ul>
              <li>Threat overlap: 100% of current heat score.</li>
              <li>Threat type affects radius and color, not weighting.</li>
              <li>Segment length controls scoring granularity.</li>
              <li>Chokepoints are flagged separately at interior waypoints where sampled corridor width is constrained.</li>
            </ul>
          </div>
        </div>
      </div>
      <div class="corr-body">
        <div class="corr-sec">Route Type</div>
        <div class="corr-field-full">
          <select id="corr-preset" class="corr-select">${presetOptions}</select>
        </div>

        <div class="corr-sec">Corridor Widths</div>
        <div class="corr-grid">
          <div class="corr-field">
            <div class="corr-label">Corridor (m)</div>
            <input id="corr-width" class="corr-input" type="number" min="10" step="10" value="${corridorM}" />
          </div>
          <div class="corr-field">
            <div class="corr-label">Standoff (m)</div>
            <input id="corr-standoff" class="corr-input" type="number" min="0" step="25" value="${standoffM}" />
          </div>
          <div class="corr-field">
            <div class="corr-label">Exclusion (m)</div>
            <input id="corr-exclusion" class="corr-input" type="number" min="0" step="50" value="${exclusionM}" />
          </div>
          <div class="corr-field">
            <div class="corr-label">Segment (m)</div>
            <input id="corr-seglen" class="corr-input" type="number" min="50" step="50" value="${segmentLenM}" />
          </div>
        </div>

        <div class="corr-divider"></div>
        <div class="corr-sec">Display</div>
        <div class="corr-toggle-grid">
          <div class="corr-toggle-col">
            <label class="corr-toggle-row"><span class="corr-label">Heat map</span><input id="corr-opt-heat" type="checkbox" class="corr-check" checked /></label>
            <label class="corr-toggle-row"><span class="corr-label">Leg labels</span><input id="corr-opt-legs" type="checkbox" class="corr-check" checked /></label>
          </div>
          <div class="corr-toggle-col">
            <label class="corr-toggle-row"><span class="corr-label">Chokepoints</span><input id="corr-opt-choke" type="checkbox" class="corr-check" checked /></label>
            <label class="corr-toggle-row"><span class="corr-label">Exclusion</span><input id="corr-opt-excl" type="checkbox" class="corr-check" checked /></label>
          </div>
        </div>

        <div class="corr-divider"></div>
        <div class="corr-sec">Threat Overlays</div>
        <div class="corr-overlay-list" id="corr-overlay-list">
          ${THREAT_OVERLAY_PRESETS.map((o) => `
            <button class="corr-overlay-row${o.id === this._activeThreatOverlayId ? ' active' : ''}" data-overlay-id="${o.id}">
              <span class="corr-overlay-dot" style="background: rgb(${o.color[0]}, ${o.color[1]}, ${o.color[2]})"></span>
              <span class="corr-overlay-name">${o.label}</span>
              <span class="corr-overlay-radius">${o.radiusM >= 1000 ? `${(o.radiusM / 1000).toFixed(1)} km` : `${o.radiusM} m`}</span>
            </button>
          `).join('')}
        </div>

        <div class="corr-sec">Threat Placement</div>
        <div class="corr-grid">
          <div class="corr-field">
            <div class="corr-label">Radius (m)</div>
            <input id="corr-threat-radius" class="corr-input" type="number" min="100" step="100" value="2000" />
          </div>
          <div class="corr-field corr-field-btn">
            <div class="corr-label">Add threat</div>
            <button class="corr-btn corr-btn-sm" id="corr-place-threat-btn">Place ⊕</button>
          </div>
        </div>
        <div class="corr-list" id="corr-threat-list"></div>

        <div class="corr-divider"></div>
        <div class="corr-sec">Waypoints</div>
        <div class="corr-list" id="corr-wp-list"></div>
        <div class="corr-coords" id="corr-coords">Ready to place waypoint</div>

        <div class="corr-divider"></div>
        <div class="corr-stats">
          <div class="corr-stat"><div class="corr-stat-lbl">Distance</div><div class="corr-stat-val" id="corr-st-dist">—</div></div>
          <div class="corr-stat"><div class="corr-stat-lbl">Waypoints</div><div class="corr-stat-val" id="corr-st-wps">0</div></div>
          <div class="corr-stat"><div class="corr-stat-lbl">Threats</div><div class="corr-stat-val" id="corr-st-threats">0</div></div>
        </div>

        <div class="corr-sec">Avg exposure</div>
        <div class="corr-exp-wrap">
          <div class="corr-exp-track"><div id="corr-exp-thumb" class="corr-exp-thumb"></div></div>
          <div class="corr-exp-labels">
            <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
          </div>
        </div>

        <div class="corr-btn-row">
          <button class="corr-btn" id="corr-place-wp-btn">Add WP</button>
          <button class="corr-btn" id="corr-undo-btn">Undo</button>
          <button class="corr-btn corr-btn-danger" id="corr-clear-btn">Clear</button>
        </div>
        <div class="corr-btn-row">
          <button class="corr-btn" id="corr-analyze-btn">Analyze</button>
          <button class="corr-btn corr-btn-primary" id="corr-commit-btn" disabled>Commit ↗</button>
        </div>
      </div>
    `;
  }

  private _bindPanelEvents(): void {
    if (!this._panelEl) return;
    const p = this._panelEl;

    p.querySelector('#corr-minimize-btn')?.addEventListener('click', () => {
      const body = p.querySelector<HTMLElement>('.corr-body');
      const btn  = p.querySelector<HTMLElement>('#corr-minimize-btn');
      if (!body || !btn) return;
      const minimized = body.style.display === 'none';
      body.style.display = minimized ? '' : 'none';
      btn.textContent = minimized ? '▼' : '▶';
    });

    p.querySelector('#corr-close-btn')?.addEventListener('click', () => this._hidePanel());
    p.querySelector('#corr-help-btn')?.addEventListener('click', (event) => {
      event.stopPropagation();
      const help = p.querySelector<HTMLElement>('#corr-help-popover');
      if (help) help.hidden = !help.hidden;
    });
    p.querySelector('#corr-help-close')?.addEventListener('click', () => {
      const help = p.querySelector<HTMLElement>('#corr-help-popover');
      if (help) help.hidden = true;
    });

    p.querySelector('#corr-preset')?.addEventListener('change', () => {
      const preset = this._currentPreset();
      this._setInputVal('corr-width', preset.corridorM);
      this._setInputVal('corr-standoff', preset.standoffM);
      this._setInputVal('corr-exclusion', preset.exclusionM);
      this._setInputVal('corr-seglen', preset.segmentLenM);
      if (this._routeDrawn) this._redraw();
    });

    ['corr-width', 'corr-standoff', 'corr-exclusion', 'corr-seglen'].forEach((id) => {
      p.querySelector(`#${id}`)?.addEventListener('change', () => {
        if (this._routeDrawn) this._redraw();
      });
    });

    ['corr-opt-heat', 'corr-opt-choke', 'corr-opt-legs', 'corr-opt-excl'].forEach((id) => {
      p.querySelector(`#${id}`)?.addEventListener('change', () => {
        if (this._routeDrawn) this._redraw();
      });
    });

    p.querySelector('#corr-place-wp-btn')?.addEventListener('click', () => this._startPlacement('waypoint'));
    p.querySelector('#corr-place-threat-btn')?.addEventListener('click', () => this._startPlacement('threat'));
    p.querySelectorAll<HTMLButtonElement>('.corr-overlay-row').forEach((btn) => {
      btn.addEventListener('click', () => {
        const overlayId = btn.dataset.overlayId;
        const overlay = THREAT_OVERLAY_PRESETS.find((o) => o.id === overlayId);
        if (!overlay) return;
        this._activeThreatOverlayId = overlay.id;
        this._setInputVal('corr-threat-radius', overlay.radiusM);
        this._refreshPanel();
        this._startPlacement('threat');
      });
    });

    p.querySelector('#corr-undo-btn')?.addEventListener('click', () => {
      if (this._waypoints.length === 0) return;
      this._waypoints.pop();
      if (this._waypoints.length < 2) {
        this._routeDrawn = false;
        this._analysisLayer.removeAll();
        this._workingGraphics = [];
      } else if (this._routeDrawn) {
        this._redraw();
      }
      this._drawPreview();
      this._refreshPanel();
    });

    p.querySelector('#corr-clear-btn')?.addEventListener('click', () => {
      this._waypoints = [];
      this._threats = [];
      this._routeDrawn = false;
      this._cancelPlacement();
      this._analysisLayer.removeAll();
      this._threatLayer.removeAll();
      this._previewLayer.removeAll();
      this._workingGraphics = [];
      this._lastAvgScore = 0;
      this._refreshPanel();
      this._setStatus('awaiting');
    });

    p.querySelector('#corr-analyze-btn')?.addEventListener('click', () => this._redraw());
    p.querySelector('#corr-commit-btn')?.addEventListener('click', () => this._commit());
  }

  private _startPlacement(mode: PlacementMode): void {
    if (!this._view || !mode) return;
    this._cancelPlacement();
    this._placementMode = mode;
    this._setStatus('picking');

    const placeBtn = this._panelEl?.querySelector<HTMLButtonElement>(
      mode === 'waypoint' ? '#corr-place-wp-btn' : '#corr-place-threat-btn',
    );
    if (placeBtn) placeBtn.textContent = 'Click map…';

    this._mapClickHandle = this._view.on('click', async (event: any) => {
      this._cancelPlacement();
      let pt: Point;
      try {
        pt = await this._pickMapPoint(event);
      } catch {
        this._setStatus('error');
        return;
      }

      if (mode === 'waypoint') {
        this._waypoints.push({ longitude: pt.longitude, latitude: pt.latitude });
        this._drawPreview();
        if (this._routeDrawn) this._redraw();
      } else {
        const overlay = this._currentThreatOverlay();
        const radiusM = this._numInput('corr-threat-radius', overlay.radiusM, 100);
        const threatGeom = this._firstPolygon(geometryEngine.geodesicBuffer(pt, radiusM, 'meters'));
        if (threatGeom) {
          const item: ThreatItem = {
            id: Date.now() + Math.floor(Math.random() * 1000),
            overlayId: overlay.id,
            label: overlay.label,
            radiusM,
            longitude: pt.longitude,
            latitude: pt.latitude,
            color: overlay.color,
            geometry: threatGeom,
          };
          this._threats.push(item);
          this._drawThreat(item);
          if (this._routeDrawn) this._redraw();
        }
      }

      this._refreshPanel();
      this._setStatus(this._waypoints.length >= 2 ? 'ready' : 'awaiting');
    });
  }

  private _cancelPlacement(): void {
    if (this._mapClickHandle) {
      this._mapClickHandle.remove();
      this._mapClickHandle = null;
    }
    this._placementMode = null;
    const wpBtn = this._panelEl?.querySelector<HTMLButtonElement>('#corr-place-wp-btn');
    const thBtn = this._panelEl?.querySelector<HTMLButtonElement>('#corr-place-threat-btn');
    if (wpBtn) wpBtn.textContent = 'Add WP';
    if (thBtn) thBtn.textContent = 'Place ⊕';
  }

  private _drawPreview(): void {
    this._previewLayer.removeAll();
    if (this._waypoints.length < 2) return;
    const dense = densifyRoute(this._waypoints, 100) as Waypoint[];
    this._previewLayer.add(new Graphic({
      geometry: new Polyline({
        paths: [dense.map((p) => [p.longitude, p.latitude])],
        spatialReference: { wkid: 4326 },
      }),
      symbol: this._is3D()
        ? {
            type: 'line-3d',
            symbolLayers: [{
              type: 'line',
              size: 4.2,
              material: { color: [8, 10, 12, 0.62] },
              pattern: { type: 'style', style: 'dash' },
              cap: 'round',
            }],
          } as any
        : {
            type: 'simple-line',
            color: [8, 10, 12, 190],
            width: 4.8,
            style: 'short-dash',
          } as any,
      attributes: { type: 'corridor_preview_halo' },
    }));
    this._previewLayer.add(new Graphic({
      geometry: new Polyline({
        paths: [dense.map((p) => [p.longitude, p.latitude])],
        spatialReference: { wkid: 4326 },
      }),
      symbol: this._is3D()
        ? {
            type: 'line-3d',
            symbolLayers: [{
              type: 'line',
              size: 2.4,
              material: { color: [29, 158, 117, 0.92] },
              pattern: { type: 'style', style: 'dash' },
              cap: 'round',
            }],
          } as any
        : {
            type: 'simple-line',
            color: [29, 158, 117, 240],
            width: 2.8,
            style: 'short-dash',
          } as any,
      attributes: { type: 'corridor_preview' },
    }));
  }

  private _drawThreat(item: ThreatItem): void {
    const [r, g, b] = item.color;
    this._threatLayer.add(new Graphic({
      geometry: item.geometry,
      symbol: this._is3D()
        ? {
            type: 'polygon-3d',
            symbolLayers: [{
              type: 'fill',
              material: { color: [r, g, b, 0.12] },
              outline: { color: [r, g, b, 0.95], size: 2 },
              pattern: { type: 'style', style: 'diagonal-cross' },
            }],
          } as any
        : {
            type: 'simple-fill',
            color: [r, g, b, 38],
            outline: { color: [r, g, b, 245], width: 2 },
          } as any,
      attributes: {
        type: 'corridor_threat',
        threatId: item.id,
        overlayId: item.overlayId,
        label: `${item.label} r=${Math.round(item.radiusM)} m`,
      },
    }));
  }

  private _redraw(): void {
    if (this._waypoints.length < 2) return;
    this._setStatus('computing');
    this._analysisLayer.removeAll();
    this._previewLayer.removeAll();
    this._workingGraphics = [];

    const corridorM = this._numInput('corr-width', 100, 10);
    const standoffM = this._numInput('corr-standoff', 500, 0);
    const exclusionM = this._numInput('corr-exclusion', 1000, 0);
    const segmentLenM = this._numInput('corr-seglen', 200, 50);
    const showHeat = this._inp('corr-opt-heat')?.checked ?? true;
    const showChoke = this._inp('corr-opt-choke')?.checked ?? true;
    const showLegs = this._inp('corr-opt-legs')?.checked ?? true;
    const showExcl = this._inp('corr-opt-excl')?.checked ?? true;

    const preset = this._currentPreset();
    const [r, g, b] = preset.color;
    const dense = densifyRoute(this._waypoints, 50) as Waypoint[];
    const legs = computeLegs(this._waypoints) as Array<{ index: number; from: Waypoint; to: Waypoint; distM: number; bearingDeg: number }>;

    const route = new Polyline({
      paths: [dense.map((p) => [p.longitude, p.latitude])],
      spatialReference: { wkid: 4326 },
    });

    let densified = route;
    try {
      densified = (geometryEngine.geodesicDensify(route, 50, 'meters') as Polyline) ?? route;
    } catch {
      densified = route;
    }

    let corridor: Polygon | null = null;
    let standoffRing: Polygon | null = null;
    let exclusionRing: Polygon | null = null;

    try {
      corridor = this._firstPolygon(geometryEngine.geodesicBuffer(densified, corridorM, 'meters'));
      const standoff = standoffM > 0
        ? this._firstPolygon(geometryEngine.geodesicBuffer(densified, corridorM + standoffM, 'meters'))
        : null;
      const exclusion = exclusionM > 0
        ? this._firstPolygon(geometryEngine.geodesicBuffer(densified, corridorM + standoffM + exclusionM, 'meters'))
        : null;

      standoffRing = standoff && corridor
        ? this._polygonResult(geometryEngine.difference(standoff, corridor) as Polygon | Polygon[] | null) ?? standoff
        : standoff;
      exclusionRing = exclusion && standoff
        ? this._polygonResult(geometryEngine.difference(exclusion, standoff) as Polygon | Polygon[] | null) ?? exclusion
        : exclusion && corridor
          ? this._polygonResult(geometryEngine.difference(exclusion, corridor) as Polygon | Polygon[] | null) ?? exclusion
          : exclusion;
    } catch {
      this._setStatus('error');
      this._refreshPanel(this._lastAvgScore);
      return;
    }

    if (showExcl && exclusionRing) this._addAnalysisGraphic(this._polygonGraphic(exclusionRing, [220, 60, 48], 0.06, 0.82, true, 'corridor_exclusion', 'Exclusion zone'));
    if (standoffRing) this._addAnalysisGraphic(this._polygonGraphic(standoffRing, [r, g, b], 0.08, 0.68, true, 'corridor_standoff', 'Standoff zone'));
    if (corridor) this._addAnalysisGraphic(this._polygonGraphic(corridor, [r, g, b], 0.14, 1, false, 'corridor_zone', 'Movement corridor'));

    this._addAnalysisGraphic(new Graphic({
      geometry: new Polyline({
        paths: [dense.map((p) => [p.longitude, p.latitude])],
        spatialReference: { wkid: 4326 },
      }),
      symbol: this._is3D()
        ? {
            type: 'line-3d',
            symbolLayers: [{
              type: 'line',
              size: 4.4,
              material: { color: [8, 10, 12, 0.62] },
              cap: 'round',
              join: 'round',
            }],
          } as any
        : {
            type: 'simple-line',
            color: [8, 10, 12, 190],
            width: 5,
          } as any,
      attributes: { type: 'corridor_centreline_halo', label: 'Route centreline border' },
    }));

    const centrelineGraphic = new Graphic({
      geometry: new Polyline({
        paths: [dense.map((p) => [p.longitude, p.latitude])],
        spatialReference: { wkid: 4326 },
      }),
      symbol: this._is3D()
        ? {
            type: 'line-3d',
            symbolLayers: [{
              type: 'line',
              size: 3,
              material: { color: [r, g, b, 1] },
              cap: 'round',
              join: 'round',
            }],
          } as any
        : {
            type: 'simple-line',
            color: [r, g, b, 255],
            width: 3.2,
          } as any,
      attributes: { type: 'corridor_centreline', label: 'Route centreline' },
    });
    this._addAnalysisGraphic(centrelineGraphic);

    this._waypoints.forEach((wp, i) => {
      const isEndpoint = i === 0 || i === this._waypoints.length - 1;
      const marker = new Graphic({
        geometry: new Point({ longitude: wp.longitude, latitude: wp.latitude, spatialReference: { wkid: 4326 } }),
        symbol: this._is3D()
          ? {
              type: 'point-3d',
              symbolLayers: [{
                type: 'object',
                resource: { primitive: isEndpoint ? 'diamond' : 'sphere' },
                material: { color: [r, g, b, isEndpoint ? 0.95 : 0.75] },
                width: isEndpoint ? 48 : 36,
                height: isEndpoint ? 48 : 36,
                depth: isEndpoint ? 48 : 36,
              }],
              verticalOffset: { screenLength: isEndpoint ? 24 : 16, maxWorldLength: 500, minWorldLength: 4 },
            } as any
          : {
              type: 'simple-marker',
              style: isEndpoint ? 'diamond' : 'circle',
              color: [r, g, b, 220],
              size: isEndpoint ? 10 : 8,
              outline: { color: [255, 255, 255, 255], width: 2.2 },
            } as any,
        attributes: {
          type: 'corridor_waypoint',
          index: i,
          label: i === 0 ? 'START' : i === this._waypoints.length - 1 ? 'END' : `WP ${i}`,
        },
      });
      this._addAnalysisGraphic(marker);
    });

    let avgScore = 0;
    if (showHeat && corridor) {
      let scored: Array<{ buffer: Polygon | null; score: number; distFromStartM: number }> = [];
      try {
        scored = scoreSegments(
          dense,
          corridorM,
          this._threats.map((t) => t.geometry),
          segmentLenM,
          { geometryEngine, Polyline, Point },
        ) as Array<{ buffer: Polygon | null; score: number; distFromStartM: number }>;
      } catch {
        scored = [];
      }

      if (scored.length > 0) {
        avgScore = scored.reduce((sum, seg) => sum + seg.score, 0) / scored.length;
      }

      scored.forEach((seg) => {
        if (!seg.buffer) return;
        const band = [...EXPOSURE_COLORS].reverse().find((c: any) => seg.score >= c.threshold) ?? EXPOSURE_COLORS[0];
        const fill = band.fill as [number, number, number, number];
        const outline = band.outline as [number, number, number, number];
        this._addAnalysisGraphic(new Graphic({
          geometry: seg.buffer,
          symbol: this._is3D()
            ? {
                type: 'polygon-3d',
                symbolLayers: [{
                  type: 'fill',
                  material: { color: [fill[0], fill[1], fill[2], fill[3] + 0.04] },
                  outline: { color: [outline[0], outline[1], outline[2], 1], size: 1.4 },
                }],
              } as any
            : {
                type: 'simple-fill',
                color: [fill[0], fill[1], fill[2], Math.round(fill[3] * 255)],
                outline: { color: [outline[0], outline[1], outline[2], 255], width: 1.4 },
              } as any,
          attributes: {
            type: 'corridor_segment',
            score: Math.round(seg.score * 100),
            distFromStartM: Math.round(seg.distFromStartM),
            label: `Exposure ${Math.round(seg.score * 100)}%`,
          },
        }));
      });
    }

    if (showLegs) {
      legs.forEach((leg) => {
        const mid = destinationPoint(leg.from.longitude, leg.from.latitude, leg.bearingDeg, leg.distM / 2);
        const distStr = leg.distM >= 1000 ? `${(leg.distM / 1000).toFixed(2)} km` : `${Math.round(leg.distM)} m`;
        const text = `${distStr} ${Math.round(leg.bearingDeg).toString().padStart(3, '0')}°`;
        const midPoint = new Point({
          longitude: mid.longitude,
          latitude: mid.latitude,
          spatialReference: { wkid: 4326 },
        });
        if (leg.distM > 0) {
          this._addAnalysisGraphic(new Graphic({
            geometry: midPoint,
            symbol: {
              type: 'text',
              color: '#c0bdb4',
              haloColor: [0, 0, 0, 0.75],
              haloSize: 1.4,
              text,
              font: { family: 'Courier New', size: 9.5, weight: 'bold' },
            } as any,
            attributes: { type: 'corridor_leg_label', label: text },
          }));
        }
      });
    }

    if (showChoke && corridor) {
      const chokepoints = detectChokepoints(this._waypoints, corridor, corridorM, { geometryEngine, Point }) as Array<{
        point: Waypoint;
        index: number;
      }>;
      chokepoints.forEach((cp) => {
        this._addAnalysisGraphic(new Graphic({
          geometry: new Point({
            longitude: cp.point.longitude,
            latitude: cp.point.latitude,
            spatialReference: { wkid: 4326 },
          }),
          symbol: this._is3D()
            ? {
                type: 'point-3d',
                symbolLayers: [{
                  type: 'object',
                  resource: { primitive: 'cylinder' },
                  material: { color: [220, 60, 48, 0.92] },
                  width: 44,
                  height: 72,
                  depth: 44,
                }],
                verticalOffset: { screenLength: 26, maxWorldLength: 600, minWorldLength: 5 },
              } as any
            : {
                type: 'simple-marker',
                style: 'circle',
                color: [220, 60, 48, 220],
                size: 9,
                outline: { color: [255, 230, 230, 210], width: 1.2 },
              } as any,
          attributes: { type: 'chokepoint', index: cp.index, label: 'Chokepoint' },
        }));
      });
    }

    this._routeDrawn = true;
    this._lastAvgScore = avgScore;
    this._refreshPanel(avgScore);
    this._setStatus('ready');
  }

  private _addAnalysisGraphic(graphic: Graphic): void {
    this._analysisLayer.add(graphic);
    this._workingGraphics.push(graphic);
  }

  private _polygonGraphic(
    geometry: Polygon,
    color: [number, number, number],
    fillAlpha: number,
    outlineAlpha: number,
    patterned: boolean,
    type: string,
    label: string,
  ): Graphic {
    const [r, g, b] = color;
    return new Graphic({
      geometry,
      symbol: this._is3D()
        ? {
            type: 'polygon-3d',
            symbolLayers: [{
              type: 'fill',
              material: { color: [r, g, b, fillAlpha] },
              outline: { color: [r, g, b, outlineAlpha], size: 2 },
              ...(patterned ? { pattern: { type: 'style', style: 'diagonal-cross' } } : {}),
            }],
          } as any
        : {
            type: 'simple-fill',
            color: [r, g, b, Math.round(fillAlpha * 255)],
            outline: { color: [r, g, b, Math.round(outlineAlpha * 255)], width: 2 },
          } as any,
      attributes: { type, label },
    });
  }

  private _commit(): void {
    if (this._workingGraphics.length === 0) return;
    const ts = new Date().toISOString();
    const meta: CorridorAnalysisMeta = {
      committedAt: ts,
      presetKey: this._presetKey(),
      waypoints: [...this._waypoints],
      corridorM: this._numInput('corr-width', 100, 10),
      standoffM: this._numInput('corr-standoff', 500, 0),
      exclusionM: this._numInput('corr-exclusion', 1000, 0),
      segmentLenM: this._numInput('corr-seglen', 200, 50),
    };

    this._workingGraphics.forEach((g) => {
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

  private _refreshPanel(avgScore = this._lastAvgScore): void {
    const wpList = this._panelEl?.querySelector<HTMLElement>('#corr-wp-list');
    if (wpList) {
      wpList.innerHTML = this._waypoints.length === 0
        ? '<div class="corr-list-empty">No waypoints</div>'
        : this._waypoints.map((wp, i) => {
            const label = i === 0 ? 'S' : i === this._waypoints.length - 1 ? 'E' : String(i);
            return `<div class="corr-list-row"><span class="corr-row-tag">${label}</span><span class="corr-row-text">${wp.latitude.toFixed(4)}°N ${wp.longitude.toFixed(4)}°E</span><button class="corr-row-del" data-wp-idx="${i}">✕</button></div>`;
          }).join('');
      wpList.querySelectorAll<HTMLButtonElement>('.corr-row-del').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.wpIdx ?? '-1');
          if (idx < 0) return;
          this._waypoints.splice(idx, 1);
          if (this._waypoints.length < 2) {
            this._routeDrawn = false;
            this._analysisLayer.removeAll();
            this._workingGraphics = [];
          } else if (this._routeDrawn) {
            this._redraw();
          }
          this._drawPreview();
          this._refreshPanel();
        });
      });
    }

    const thList = this._panelEl?.querySelector<HTMLElement>('#corr-threat-list');
    if (thList) {
      thList.innerHTML = this._threats.length === 0
        ? '<div class="corr-list-empty">No threats</div>'
        : this._threats.map((th, i) => {
            const radiusStr = th.radiusM >= 1000 ? `${(th.radiusM / 1000).toFixed(1)} km` : `${Math.round(th.radiusM)} m`;
            return `<div class="corr-list-row"><span class="corr-row-tag">T${i + 1}</span><span class="corr-row-text">${th.label} (${radiusStr})</span><button class="corr-row-del" data-th-id="${th.id}">✕</button></div>`;
          }).join('');
      thList.querySelectorAll<HTMLButtonElement>('.corr-row-del').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = Number(btn.dataset.thId ?? '-1');
          if (id < 0) return;
          this._threats = this._threats.filter((t) => t.id !== id);
          this._threatLayer.graphics
            .filter((g: Graphic) => g.attributes?.threatId === id)
            .forEach((g: Graphic) => this._threatLayer.remove(g));
          if (this._routeDrawn) this._redraw();
          this._refreshPanel();
        });
      });
    }

    const overlayList = this._panelEl?.querySelector<HTMLElement>('#corr-overlay-list');
    if (overlayList) {
      overlayList.querySelectorAll<HTMLButtonElement>('.corr-overlay-row').forEach((btn) => {
        const isActive = btn.dataset.overlayId === this._activeThreatOverlayId;
        btn.classList.toggle('active', isActive);
      });
    }

    const dist = this._computeTotalDistance();
    this._setText('#corr-st-dist', dist > 0 ? (dist >= 1000 ? `${(dist / 1000).toFixed(2)} km` : `${Math.round(dist)} m`) : '—');
    this._setText('#corr-st-wps', String(this._waypoints.length));
    this._setText('#corr-st-threats', String(this._threats.length));
    const thumb = this._panelEl?.querySelector<HTMLElement>('#corr-exp-thumb');
    if (thumb) thumb.style.left = `${Math.max(0, Math.min(100, avgScore * 100))}%`;

    const analyzeBtn = this._panelEl?.querySelector<HTMLButtonElement>('#corr-analyze-btn');
    const undoBtn = this._panelEl?.querySelector<HTMLButtonElement>('#corr-undo-btn');
    const commitBtn = this._panelEl?.querySelector<HTMLButtonElement>('#corr-commit-btn');
    if (analyzeBtn) analyzeBtn.disabled = this._waypoints.length < 2;
    if (undoBtn) undoBtn.disabled = this._waypoints.length === 0;
    if (commitBtn) commitBtn.disabled = this._workingGraphics.length === 0;
  }

  private _restoreFromCommitted(attrs: Partial<CorridorAnalysisMeta>): void {
    this._waypoints = Array.isArray(attrs.waypoints) ? attrs.waypoints.map((w) => ({ longitude: w.longitude, latitude: w.latitude })) : [];
    this._routeDrawn = this._waypoints.length >= 2;
  }

  private async _pickMapPoint(event: any): Promise<Point> {
    if (!this._view) {
      return new Point({ longitude: 0, latitude: 0, spatialReference: { wkid: 4326 } });
    }

    if (this._view.type === '3d') {
      const hit = await (this._view as any).hitTest(event, { include: [(this._view as any).map.ground] });
      const gp = hit?.ground?.mapPoint ?? event.mapPoint;
      if (!gp) throw new Error('No map point');
      return new Point({
        longitude: gp.longitude,
        latitude: gp.latitude,
        z: gp.z ?? 0,
        spatialReference: { wkid: 4326 },
      });
    }

    if (!event.mapPoint) throw new Error('No map point');
    return new Point({
      longitude: event.mapPoint.longitude,
      latitude: event.mapPoint.latitude,
      z: event.mapPoint.z ?? 0,
      spatialReference: { wkid: 4326 },
    });
  }

  private _graphicToPoint(graphic: Graphic): Point | null {
    const geom = graphic.geometry;
    if (!geom) return null;
    if (geom.type === 'point') return geom as Point;
    if ((geom as any).centroid) return (geom as any).centroid as Point;
    return null;
  }

  private _firstPolygon(geometry: Polygon | Polygon[] | null): Polygon | null {
    if (!geometry) return null;
    return Array.isArray(geometry) ? (geometry[0] ?? null) : geometry;
  }

  private _polygonResult(geometry: Polygon | Polygon[] | null): Polygon | null {
    return this._firstPolygon(geometry);
  }

  private _is3D(): boolean {
    return this._view?.type === '3d';
  }

  private _computeTotalDistance(): number {
    if (this._waypoints.length < 2) return 0;
    let total = 0;
    for (let i = 0; i < this._waypoints.length - 1; i++) {
      const a = this._waypoints[i];
      const b = this._waypoints[i + 1];
      total += (geometryEngine.geodesicLength(
        new Polyline({
          paths: [[[a.longitude, a.latitude], [b.longitude, b.latitude]]],
          spatialReference: { wkid: 4326 },
        }),
        'meters',
      ) as number) || 0;
    }
    return total;
  }

  private _currentPreset(): CorridorPreset {
    const presets = CORRIDOR_PRESETS as unknown as Record<string, CorridorPreset>;
    const key = this._presetKey();
    return presets[key] ?? presets.vehicle_patrol;
  }

  private _presetKey(): string {
    return this._panelEl?.querySelector<HTMLSelectElement>('#corr-preset')?.value ?? 'vehicle_patrol';
  }

  private _currentThreatOverlay(): ThreatOverlayPreset {
    return THREAT_OVERLAY_PRESETS.find((o) => o.id === this._activeThreatOverlayId) ?? THREAT_OVERLAY_PRESETS[0];
  }

  private _setInputVal(id: string, value: number): void {
    const el = this._inp(id);
    if (el) el.value = String(value);
  }

  private _numInput(id: string, fallback: number, min: number): number {
    const raw = Number(this._inp(id)?.value ?? fallback);
    const value = Number.isFinite(raw) ? raw : fallback;
    return Math.max(min, value);
  }

  private _inp(id: string): HTMLInputElement | null {
    return this._panelEl?.querySelector<HTMLInputElement>(`#${id}`) ?? null;
  }

  private _setText(selector: string, value: string): void {
    const el = this._panelEl?.querySelector<HTMLElement>(selector);
    if (el) el.textContent = value;
  }

  private _setStatus(state: 'awaiting' | 'picking' | 'computing' | 'ready' | 'committed' | 'error'): void {
    const dot = this._panelEl?.querySelector<HTMLElement>('#corr-status-dot');
    const lbl = this._panelEl?.querySelector<HTMLElement>('#corr-status-lbl');
    if (!dot || !lbl) return;

    const map: Record<typeof state, [string, string]> = {
      awaiting: ['#555', 'Awaiting route'],
      picking: ['#378ADD', 'Click map…'],
      computing: ['#EF9F27', 'Computing…'],
      ready: ['#1D9E75', 'Ready'],
      committed: ['#1D9E75', 'Committed ✓'],
      error: ['#E24B4A', 'Error'],
    };
    const [color, text] = map[state];
    dot.style.background = color;
    dot.style.boxShadow = `0 0 6px ${color}88`;
    lbl.textContent = text;
  }

  private _makeDraggable(): void {
    const handle = this._panelEl?.querySelector<HTMLElement>('#corr-drag-handle');
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
    if (document.getElementById('corridor-engine-styles')) return;
    const style = document.createElement('style');
    style.id = 'corridor-engine-styles';
    style.textContent = `
      .corr-panel {
        position: fixed;
        top: 60px;
        left: 910px;
        width: 302px;
        max-height: calc(100vh - 84px);
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
        overflow: hidden;
      }
      .corr-panel, .corr-panel * {
        box-sizing: border-box;
      }
      .corr-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 9px 10px 8px;
        border-bottom: 1px solid var(--ms-divider);
        background: var(--ms-bg-header);
        border-radius: calc(var(--ms-radius) - 1px) calc(var(--ms-radius) - 1px) 0 0;
        cursor: grab;
      }
      .corr-header:active { cursor: grabbing; }
      .corr-header-title {
        font-size: var(--ms-fs-xs);
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ms-success);
        font-weight: 700;
        flex: 1;
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .corr-status-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #555;
      }
      .corr-status-lbl {
        font-size: var(--ms-fs-xs);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ms-text-dim);
        min-width: 58px;
        flex-shrink: 0;
      }
      .corr-help-btn, .corr-minimize-btn, .corr-close-btn {
        background: none;
        border: 1px solid transparent;
        color: var(--ms-text-dim);
        font-size: 12px;
        cursor: pointer;
        padding: 0 2px;
        line-height: 1;
        flex: 0 0 auto;
      }
      .corr-help-btn {
        width: 17px;
        height: 17px;
        border-color: var(--ms-border);
        border-radius: 50%;
        color: var(--ms-success);
        font-weight: 700;
      }
      .corr-help-btn:hover, .corr-minimize-btn:hover, .corr-close-btn:hover { color: var(--ms-text); }
      .corr-help-popover {
        position: absolute;
        top: 39px;
        left: 8px;
        right: 8px;
        z-index: 1120;
        max-height: min(520px, calc(100vh - 132px));
        overflow-y: auto;
        background: var(--ms-bg);
        border: 1px solid var(--ms-border);
        border-radius: 4px;
        box-shadow: var(--ms-shadow);
        color: var(--ms-text);
      }
      .corr-help-popover[hidden] { display: none; }
      .corr-help-head {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 11px 8px;
        border-bottom: 1px solid var(--ms-divider);
        background: var(--ms-bg-header);
      }
      .corr-help-kicker {
        font-size: var(--ms-fs-xs);
        color: var(--ms-text-label);
        letter-spacing: 0.09em;
        text-transform: uppercase;
      }
      .corr-help-title {
        margin-top: 2px;
        font-size: 13px;
        color: var(--ms-success);
        font-weight: 700;
      }
      .corr-help-close {
        width: 20px;
        height: 20px;
        border: 1px solid var(--ms-border);
        border-radius: 3px;
        background: var(--ms-bg-input);
        color: var(--ms-text-dim);
        cursor: pointer;
      }
      .corr-help-close:hover { color: var(--ms-text); }
      .corr-help-body {
        padding: 10px 11px 12px;
        font-size: var(--ms-fs-xs);
        line-height: 1.45;
        color: var(--ms-text-dim);
        user-select: text;
      }
      .corr-help-body p {
        margin: 0 0 9px;
      }
      .corr-help-block {
        margin-top: 10px;
      }
      .corr-help-block h4 {
        margin: 0 0 5px;
        font-size: var(--ms-fs-xs);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ms-text);
      }
      .corr-help-block ol, .corr-help-block ul {
        margin: 0;
        padding-left: 17px;
      }
      .corr-help-block li {
        margin: 3px 0;
      }
      .corr-help-block dl {
        display: grid;
        grid-template-columns: 72px minmax(0, 1fr);
        gap: 5px 8px;
        margin: 0;
      }
      .corr-help-block dt {
        color: var(--ms-success);
        font-weight: 700;
      }
      .corr-help-block dd {
        margin: 0;
      }
      .corr-help-formula {
        padding: 6px 7px;
        border: 1px solid var(--ms-border);
        border-radius: 3px;
        background: var(--ms-bg-input);
        color: var(--ms-text);
        font-family: "Courier New", monospace;
        white-space: normal;
      }
      .corr-body {
        max-height: calc(100vh - 124px);
        overflow-y: auto;
        overflow-x: hidden;
        padding: 0 0 6px;
      }
      .corr-sec {
        font-size: var(--ms-fs-xs);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--ms-text-label);
        padding: 7px 12px 3px;
      }
      .corr-divider {
        height: 1px;
        background: linear-gradient(90deg, transparent, var(--ms-divider), transparent);
        margin: 3px 0;
      }
      .corr-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 7px;
        padding: 0 10px 6px;
      }
      .corr-field {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
      }
      .corr-field-full { padding: 0 10px 6px; }
      .corr-field-btn { justify-content: flex-end; }
      .corr-label {
        font-size: var(--ms-fs-xs);
        letter-spacing: 0.07em;
        text-transform: uppercase;
        color: var(--ms-text-label);
      }
      .corr-input, .corr-select {
        background: var(--ms-bg-input);
        border: 1px solid var(--ms-border);
        border-radius: 3px;
        color: var(--ms-text);
        font-family: inherit;
        font-size: var(--ms-fs);
        padding: 5px 7px;
        width: 100%;
        min-width: 0;
        outline: none;
      }
      .corr-input:focus, .corr-select:focus { border-color: var(--ms-success); }
      .corr-select option { background: var(--ms-bg); }
      .corr-toggle-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 1px minmax(0, 1fr);
        gap: 8px;
        padding: 0 10px 6px;
      }
      .corr-toggle-grid::before {
        content: '';
        grid-column: 2;
        grid-row: 1;
        width: 1px;
        background: var(--ms-divider);
      }
      .corr-toggle-col {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }
      .corr-toggle-col:first-child { grid-column: 1; }
      .corr-toggle-col:last-child { grid-column: 3; }
      .corr-toggle-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        min-height: 18px;
        min-width: 0;
        cursor: pointer;
      }
      .corr-check {
        accent-color: var(--ms-success);
        width: 13px;
        height: 13px;
        cursor: pointer;
        flex-shrink: 0;
      }
      .corr-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 78px;
        overflow-y: auto;
        padding: 0 10px 6px;
      }
      .corr-list-empty {
        font-size: var(--ms-fs-xs);
        color: var(--ms-text-dim);
        font-style: italic;
        padding: 2px 2px;
      }
      .corr-overlay-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 0 10px 6px;
      }
      .corr-overlay-row {
        display: flex;
        align-items: center;
        gap: 7px;
        width: 100%;
        min-width: 0;
        background: var(--ms-bg-input);
        border: 1px solid var(--ms-border);
        color: var(--ms-text);
        border-radius: 3px;
        padding: 4px 6px;
        cursor: pointer;
        font-family: inherit;
        font-size: var(--ms-fs-xs);
        text-align: left;
      }
      .corr-overlay-row:hover {
        background: rgba(220,60,48,0.10);
        border-color: rgba(220,60,48,0.24);
      }
      .corr-overlay-row.active {
        background: rgba(220,60,48,0.15);
        border-color: rgba(220,60,48,0.38);
      }
      .corr-overlay-dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .corr-overlay-name {
        font-size: var(--ms-fs-xs);
        letter-spacing: 0.04em;
        color: var(--ms-text);
        flex: 1;
        min-width: 0;
      }
      .corr-overlay-radius {
        font-size: var(--ms-fs-xs);
        color: var(--ms-text-dim);
        flex-shrink: 0;
      }
      .corr-list-row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 3px 6px;
        background: var(--ms-bg-input);
        border: 1px solid var(--ms-border);
        border-radius: 3px;
      }
      .corr-row-tag {
        font-size: var(--ms-fs-xs);
        color: var(--ms-success);
        font-weight: 700;
        min-width: 18px;
      }
      .corr-row-text {
        font-size: var(--ms-fs-xs);
        color: var(--ms-text-dim);
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .corr-row-del {
        background: none;
        border: none;
        color: var(--ms-danger);
        cursor: pointer;
        font-size: 10px;
        flex-shrink: 0;
      }
      .corr-coords {
        font-size: var(--ms-fs-xs);
        color: var(--ms-success);
        padding: 1px 12px 5px;
        letter-spacing: 0.04em;
      }
      .corr-stats {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
        gap: 8px;
        padding: 6px 10px;
      }
      .corr-stat {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .corr-stat-lbl {
        font-size: var(--ms-fs-xs);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ms-text-label);
      }
      .corr-stat-val {
        font-size: var(--ms-fs);
        color: var(--ms-success);
        font-weight: 700;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .corr-exp-wrap {
        padding: 0 10px 6px;
      }
      .corr-exp-track {
        margin: 0;
        height: 6px;
        border-radius: 3px;
        position: relative;
        border: 1px solid var(--ms-divider);
        background: linear-gradient(to right, #1D9E75, #78C840, #EF9F27, #DC3C30);
      }
      .corr-exp-thumb {
        position: absolute;
        top: -4px;
        left: 0%;
        transform: translateX(-50%);
        width: 14px;
        height: 14px;
        border-radius: 50%;
        border: 2px solid var(--ms-bg);
        background: #fff;
      }
      .corr-exp-labels {
        display: flex;
        justify-content: space-between;
        margin-top: 4px;
        font-size: var(--ms-fs-xs);
        color: var(--ms-text-dim);
        letter-spacing: 0;
      }
      .corr-btn-row {
        display: flex;
        gap: 6px;
        padding: 5px 10px 2px;
      }
      .corr-btn {
        flex: 1;
        min-width: 0;
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
      }
      .corr-btn:hover { background: var(--ms-accent-dim); color: var(--ms-text); }
      .corr-btn:disabled { opacity: 0.3; cursor: not-allowed; }
      .corr-btn-sm { flex: 0 0 auto; padding: 4px 8px; font-size: var(--ms-fs-xs); }
      .corr-btn-primary {
        border-color: var(--ms-success);
        color: var(--ms-success);
        background: var(--ms-bg-input);
      }
      .corr-btn-primary:hover { background: var(--ms-success); color: var(--ms-bg); }
      .corr-btn-danger {
        border-color: var(--ms-danger);
        color: var(--ms-danger);
        background: var(--ms-bg-input);
      }
      .corr-btn-danger:hover { background: var(--ms-danger); color: #fff; }
    `;
    document.head.appendChild(style);
  }
}

export default CorridorEngine;
