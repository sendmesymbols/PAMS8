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
import EngineLogger from '../../Support/EngineLogger';
import { bindDisclosures } from '../../Support/Disclosure';
import RoadNetworkEngine, { type TrafficabilitySummary } from './RoadNetworkEngine';

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
const ENGINE_NAME = 'CorridorEngine';

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

  // Road-network snapping (optional external service; degrades to straight-line).
  private _snapToRoads = false;
  private _roadPath: number[][] | null = null; // [lng,lat][] following real roads
  private _roadSummary: {
    distanceKm: number;
    travelTimeMin: number;
    traffic: TrafficabilitySummary | null;
  } | null = null;

  constructor() {
    this._createLayers();
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

    if (this._panelEl && !this._panelEl.classList.contains('ms-visible')) {
      this._panelEl.classList.add('ms-visible');
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
      this._panelEl.className = 'ms-panel ms-theme-ops-dark';
      this._panelEl.setAttribute('data-engine', 'corridor');
      this._panelEl.style.top = '62px';
      this._panelEl.style.right = '12px';
      this._panelEl.style.width = '392px';
      document.body.appendChild(this._panelEl);
    }
    // The restore-from-committed path needs the override values written into
    // the markup, so the panel is rebuilt rather than reused.
    this._panelEl.innerHTML = this._buildPanelHTML(override);
    this._panelEl.classList.add('ms-visible');
    this._bindPanelEvents();
    this._makeDraggable();
    this._refreshPanel();
  }

  private _hidePanel(): void {
    this._panelEl?.classList.remove('ms-visible');
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
      <div class="ms-header" id="corr-drag-handle">
        <span class="ms-header-icon">⤳</span>
        <span class="ms-header-title">Corridor Analysis</span>
        <span class="ms-status-dot" id="corr-status-dot"></span>
        <span class="ms-status-lbl" id="corr-status-lbl">Awaiting route</span>
        <button class="ms-header-btn ms-btn-round" id="corr-help-btn" title="How corridor analysis works">?</button>
        <button class="ms-header-btn ms-btn-round" id="corr-minimize-btn" title="Minimize">▼</button>
        <button class="ms-header-btn ms-btn-round" id="corr-close-btn" title="Close (keeps graphics)">✕</button>
      </div>
      <div class="ms-help-popover" id="corr-help-popover" hidden>
        <div class="ms-help-head">
          <div>
            <div class="ms-help-kicker">Field Guide</div>
            <div class="ms-help-title">Corridor Analysis</div>
          </div>
          <button class="ms-help-close" id="corr-help-close" title="Close">✕</button>
        </div>
        <div class="ms-help-body">
          <div class="ms-help-answers">
            <div class="ms-help-answers-kicker">Answers</div>
            <div class="ms-help-answers-q">How exposed is this route?</div>
          </div>
          <p>Builds a movement corridor from two or more waypoints, then scores route exposure against placed threat overlays.</p>
          <div class="ms-help-block">
            <h4>Workflow</h4>
            <ol>
              <li>Press <strong>Add waypoint</strong> and click the map at least twice to define the centreline.</li>
              <li>Choose the route type. Its preset loads the corridor, standoff, exclusion and segment widths.</li>
              <li>Press <strong>Analyze</strong>. After the first run, changes redraw on their own.</li>
              <li>Place threat overlays under <strong>Threats</strong> to score exposure, then commit.</li>
            </ol>
          </div>
          <div class="ms-help-block">
            <h4>Parameters</h4>
            <dl>
              <dt>Corridor</dt><dd>Buffer distance on each side of the route centerline.</dd>
              <dt>Standoff</dt><dd>Outer planning buffer around the movement corridor.</dd>
              <dt>Exclusion</dt><dd>Outer caution ring beyond standoff, useful for no-go or watch areas.</dd>
              <dt>Segment</dt><dd>Approximate route slice length used for exposure scoring.</dd>
            </dl>
          </div>
          <div class="ms-help-block">
            <h4>Exposure Score</h4>
            <p>Each route segment is buffered by corridor width and intersected with all threat polygons. The segment score is overlap area divided by segment corridor area, clamped from 0 to 100%.</p>
            <div class="corr-help-formula">score = threat overlap area / segment corridor area</div>
          </div>
          <div class="ms-help-block">
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
      <div class="ms-body">
        <!-- Default view: lay down waypoints, choose a route type, analyze.
             Corridor widths, display toggles and threat placement all live in
             the collapsed disclosures below. -->
        <div class="ms-section-title">Route</div>
        <div class="ms-btn-row">
          <button class="ms-btn primary" id="corr-place-wp-btn" title="Click, then click the map to add a waypoint">📍 Add waypoint</button>
        </div>
        <div class="ms-coords" id="corr-coords">Ready to place waypoint</div>
        <div class="corr-list" id="corr-wp-list"></div>
        <div class="ms-btn-row" id="corr-route-actions" hidden>
          <button class="ms-btn" id="corr-undo-btn">Undo</button>
          <button class="ms-btn danger" id="corr-clear-btn">Clear</button>
        </div>

        <div class="ms-grid full">
          <div class="ms-field">
            <label class="ms-label" for="corr-preset">Route type</label>
            <select id="corr-preset" class="ms-select">${presetOptions}</select>
          </div>
        </div>

        <div class="ms-btn-row">
          <button class="ms-btn ms-cta" id="corr-analyze-btn" disabled>Analyze ↗</button>
        </div>

        <div id="corr-results" hidden>
          <div class="corr-stats">
            <div class="corr-stat"><div class="corr-stat-lbl">Distance</div><div class="corr-stat-val" id="corr-st-dist">—</div></div>
            <div class="corr-stat"><div class="corr-stat-lbl">Waypoints</div><div class="corr-stat-val" id="corr-st-wps">0</div></div>
            <div class="corr-stat"><div class="corr-stat-lbl">Threats</div><div class="corr-stat-val" id="corr-st-threats">0</div></div>
          </div>
          <div class="ms-section-title">Avg exposure</div>
          <div class="corr-exp-wrap">
            <div class="corr-exp-track"><div id="corr-exp-thumb" class="corr-exp-thumb"></div></div>
            <div class="corr-exp-labels">
              <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
            </div>
          </div>
          <div class="ms-btn-row">
            <button class="ms-btn primary" id="corr-commit-btn" disabled>Commit ↗</button>
          </div>
        </div>

        <div class="ms-disclosure" data-open="false">
          <button class="ms-disclosure-head" type="button" id="corr-threats-toggle" aria-expanded="false" aria-controls="corr-threats-body">
            <span class="ms-disclosure-chevron" aria-hidden="true">▶</span>
            <span class="ms-disclosure-title">Threats</span>
            <span class="ms-disclosure-meta" id="corr-threats-meta">Optional, drives exposure</span>
          </button>
          <div class="ms-disclosure-body" id="corr-threats-body" hidden>
            <div class="ms-section-title">Overlay type</div>
            <div class="corr-overlay-list" id="corr-overlay-list">
              ${THREAT_OVERLAY_PRESETS.map((o) => `
                <button class="corr-overlay-row${o.id === this._activeThreatOverlayId ? ' active' : ''}" data-overlay-id="${o.id}">
                  <span class="corr-overlay-dot" style="background: rgb(${o.color[0]}, ${o.color[1]}, ${o.color[2]})"></span>
                  <span class="corr-overlay-name">${o.label}</span>
                  <span class="corr-overlay-radius">${o.radiusM >= 1000 ? `${(o.radiusM / 1000).toFixed(1)} km` : `${o.radiusM} m`}</span>
                </button>
              `).join('')}
            </div>
            <div class="ms-grid" style="grid-template-columns:1fr auto;align-items:end;">
              <div class="ms-field">
                <label class="ms-label" for="corr-threat-radius">Radius (m)</label>
                <input id="corr-threat-radius" class="ms-input" type="number" min="100" step="100" value="2000" />
              </div>
              <div class="ms-field">
                <button class="ms-btn primary" id="corr-place-threat-btn" title="Click, then click the map to drop a threat">📍 Place</button>
              </div>
            </div>
            <div class="corr-list" id="corr-threat-list"></div>
          </div>
        </div>

        <div class="ms-disclosure" data-open="false">
          <button class="ms-disclosure-head" type="button" id="corr-adv-toggle" aria-expanded="false" aria-controls="corr-adv-body">
            <span class="ms-disclosure-chevron" aria-hidden="true">▶</span>
            <span class="ms-disclosure-title">Advanced</span>
            <span class="ms-disclosure-meta">Widths, display, road snapping</span>
          </button>
          <div class="ms-disclosure-body" id="corr-adv-body" hidden>
            <div class="ms-section-title">Corridor widths</div>
            <div class="ms-grid">
              <div class="ms-field">
                <label class="ms-label" for="corr-width">Corridor (m)</label>
                <input id="corr-width" class="ms-input" type="number" min="10" step="10" value="${corridorM}" />
              </div>
              <div class="ms-field">
                <label class="ms-label" for="corr-standoff">Standoff (m)</label>
                <input id="corr-standoff" class="ms-input" type="number" min="0" step="25" value="${standoffM}" />
              </div>
              <div class="ms-field">
                <label class="ms-label" for="corr-exclusion">Exclusion (m)</label>
                <input id="corr-exclusion" class="ms-input" type="number" min="0" step="50" value="${exclusionM}" />
              </div>
              <div class="ms-field">
                <label class="ms-label" for="corr-seglen">Segment (m)</label>
                <input id="corr-seglen" class="ms-input" type="number" min="50" step="50" value="${segmentLenM}" />
              </div>
            </div>

            <div class="ms-section-title">Display</div>
            <div class="ms-toggle-row">
              <label for="corr-opt-heat">Heat map</label>
              <input id="corr-opt-heat" type="checkbox" class="ms-input" checked />
            </div>
            <div class="ms-toggle-row">
              <label for="corr-opt-legs">Leg labels</label>
              <input id="corr-opt-legs" type="checkbox" class="ms-input" checked />
            </div>
            <div class="ms-toggle-row">
              <label for="corr-opt-choke">Chokepoints</label>
              <input id="corr-opt-choke" type="checkbox" class="ms-input" checked />
            </div>
            <div class="ms-toggle-row">
              <label for="corr-opt-excl">Exclusion ring</label>
              <input id="corr-opt-excl" type="checkbox" class="ms-input" checked />
            </div>

            <div class="ms-section-title">Road snapping</div>
            <div class="ms-toggle-row">
              <label for="corr-opt-snap">Snap route to roads</label>
              <input id="corr-opt-snap" type="checkbox" class="ms-input" />
            </div>
            <div class="ms-coords" id="corr-snap-note">Straight-line (road snapping off)</div>
            <div class="ms-coords" id="corr-traffic-note"></div>
          </div>
        </div>
      </div>
    `;
  }

  private _bindPanelEvents(): void {
    if (!this._panelEl) return;
    const p = this._panelEl;

    p.querySelector('#corr-minimize-btn')?.addEventListener('click', () => {
      const body = p.querySelector<HTMLElement>('.ms-body');
      const btn  = p.querySelector<HTMLElement>('#corr-minimize-btn');
      if (!body || !btn) return;
      const minimized = body.classList.toggle('ms-minimized');
      btn.textContent = minimized ? '▶' : '▼';
      btn.title = minimized ? 'Restore' : 'Minimize';
    });

    p.querySelector('#corr-close-btn')?.addEventListener('click', () => {
      this._hidePanel();
      this._cancelPlacement();
    });
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
        this._roadPath = null;
        this._roadSummary = null;
        this._drawPreview();
      } else {
        this._onWaypointsChanged();
      }
      this._refreshPanel();
    });

    p.querySelector('#corr-clear-btn')?.addEventListener('click', () => {
      this._waypoints = [];
      this._threats = [];
      this._routeDrawn = false;
      this._roadPath = null;
      this._roadSummary = null;
      this._cancelPlacement();
      this._analysisLayer.removeAll();
      this._threatLayer.removeAll();
      this._previewLayer.removeAll();
      this._workingGraphics = [];
      this._lastAvgScore = 0;
      this._setTrafficNote(null);
      this._refreshPanel();
      this._setStatus('awaiting');
    });

    p.querySelector('#corr-analyze-btn')?.addEventListener('click', () => {
      this._setRunBusy(true);
      if (this._snapToRoads) {
        void this._recomputeRoadPath()
          .then(() => this._redraw())
          .finally(() => this._setRunBusy(false));
      } else {
        try {
          this._redraw();
        } finally {
          this._setRunBusy(false);
        }
      }
    });
    p.querySelector('#corr-commit-btn')?.addEventListener('click', () => this._commit());

    bindDisclosures(p);

    p.querySelector('#corr-opt-snap')?.addEventListener('change', (e) => {
      this._snapToRoads = (e.target as HTMLInputElement).checked;
      if (this._snapToRoads) {
        void this._recomputeRoadPath().then(() => {
          this._drawPreview();
          if (this._routeDrawn) this._redraw();
        });
      } else {
        this._roadPath = null;
        this._roadSummary = null;
        this._setSnapNote('Straight-line (road snapping off)');
        this._setTrafficNote(null);
        this._drawPreview();
        if (this._routeDrawn) this._redraw();
      }
    });
  }

  /** Pulse whichever placement button `_placementMode` says is waiting on a click. */
  private _setPickArmed(): void {
    const p = this._panelEl;
    if (!p) return;
    p.querySelector('#corr-place-wp-btn')?.classList.toggle('ms-armed', this._placementMode === 'waypoint');
    p.querySelector('#corr-place-threat-btn')?.classList.toggle('ms-armed', this._placementMode === 'threat');
  }

  /** Primary CTA state while the engine is computing. */
  private _setRunBusy(busy: boolean): void {
    const btn = this._panelEl?.querySelector<HTMLButtonElement>('#corr-analyze-btn');
    if (!btn) return;
    btn.disabled = busy || this._waypoints.length < 2;
    btn.classList.toggle('ms-busy', busy);
    btn.textContent = busy ? 'Analysing\u2026' : 'Analyze \u2197';
  }

  private _startPlacement(mode: PlacementMode): void {
    if (!this._view || !mode) return;
    this._cancelPlacement();
    this._placementMode = mode;
    this._setPickArmed();
    this._setStatus('picking');

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
        this._onWaypointsChanged();
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
    this._setPickArmed();
  }

  // ── Road-network snapping (optional, degradable) ─────────────────────────

  /** Lazily reach the shared road-network adapter (may be absent). */
  private _roadNet(): any {
    return (window as any).symbolEngine?.roadNetworkEngine ?? null;
  }

  /** Centreline source: road-following path when snapping is active, else raw waypoints. */
  private _centrelineWaypoints(): Waypoint[] {
    if (this._snapToRoads && this._roadPath && this._roadPath.length >= 2) {
      return this._roadPath.map(([lng, lat]) => ({ longitude: lng, latitude: lat }));
    }
    return this._waypoints;
  }

  /** Update the small snap-status line in the panel (no-op if panel closed). */
  private _setSnapNote(msg: string): void {
    const el = this._panelEl?.querySelector('#corr-snap-note');
    if (el) (el as HTMLElement).textContent = msg;
  }

  /** Flatten a GeoJSON Line/MultiLineString into a single [lng,lat][] list. */
  private _flattenLineCoords(geom: any): number[][] {
    if (!geom || !Array.isArray(geom.coordinates)) return [];
    if (geom.type === 'MultiLineString') {
      const out: number[][] = [];
      for (const seg of geom.coordinates) for (const c of seg) out.push([c[0], c[1]]);
      return out;
    }
    return (geom.coordinates as number[][]).map((c) => [c[0], c[1]]);
  }

  /**
   * Recompute the road-following centreline by routing each consecutive
   * waypoint pair. Fully degradable: a missing service drops to straight-line,
   * and any single failed leg falls back to its straight segment while the rest
   * still follow roads. Never throws.
   */
  private async _recomputeRoadPath(): Promise<void> {
    this._roadPath = null;
    this._roadSummary = null;
    if (!this._snapToRoads || this._waypoints.length < 2) return;

    const rn = this._roadNet();
    if (!rn) {
      this._setSnapNote('Road service not loaded — straight-line');
      return;
    }
    this._setSnapNote('Routing along roads…');

    const path: number[][] = [];
    const byClassKm: Record<string, number> = {};
    let okLegs = 0,
      distKm = 0,
      timeMin = 0,
      degraded = false;

    for (let i = 0; i < this._waypoints.length - 1; i++) {
      const a = this._waypoints[i];
      const b = this._waypoints[i + 1];
      let res: any = null;
      try {
        res = await rn.route(a, b);
      } catch {
        res = { ok: false };
      }
      if (res?.ok && res.data?.geometry) {
        const coords = this._flattenLineCoords(res.data.geometry);
        if (path.length && coords.length) coords.shift(); // drop duplicate join vertex
        path.push(...coords);
        okLegs++;
        distKm += res.data.distanceKm || 0;
        timeMin += res.data.travelTimeMin || 0;
        for (const c of res.data.byClass ?? []) {
          byClassKm[c.fclass] = (byClassKm[c.fclass] || 0) + (c.km || 0);
        }
      } else {
        if (!path.length) path.push([a.longitude, a.latitude]);
        path.push([b.longitude, b.latitude]);
        degraded = true;
      }
    }

    if (okLegs === 0) {
      this._setSnapNote('Road network unavailable — straight-line');
      this._setTrafficNote(null);
      return;
    }
    // Classify trafficability across all routed legs (the route is only as
    // good as its most restrictive class — its bottleneck).
    const merged = Object.entries(byClassKm).map(([fclass, km]) => ({ fclass, km }));
    const traffic = merged.length ? RoadNetworkEngine.classifyRoute(merged) : null;
    this._roadPath = path;
    this._roadSummary = { distanceKm: distKm, travelTimeMin: timeMin, traffic };
    this._setSnapNote(
      `${degraded ? 'Partial road' : 'Road'} route — ${distKm.toFixed(1)} km, ${timeMin.toFixed(0)} min` +
        (traffic ? ` · ${traffic.rating}` : '') +
        (degraded ? ' (some legs straight)' : ''),
    );
    this._setTrafficNote(traffic);
  }

  /** Render the per-class trafficability breakdown into the panel (clears on null). */
  private _setTrafficNote(traffic: TrafficabilitySummary | null): void {
    const el = this._panelEl?.querySelector('#corr-traffic-note');
    if (!el) return;
    if (!traffic || traffic.classes.length === 0) {
      (el as HTMLElement).textContent = '';
      return;
    }
    const lim = RoadNetworkEngine.classifyClass(traffic.limitingClass);
    const breakdown = traffic.classes
      .slice(0, 4)
      .map((c) => `${c.info.label} ${c.pct.toFixed(0)}%`)
      .join(' · ');
    (el as HTMLElement).textContent =
      `Trafficability ${traffic.rating} — limiting: ${lim.label} (type ${lim.routeType}). ${breakdown}`;
  }

  /** Re-render after a waypoint change, recomputing the road path first when snapping. */
  private _onWaypointsChanged(): void {
    if (this._snapToRoads) {
      void this._recomputeRoadPath().then(() => {
        this._drawPreview();
        if (this._routeDrawn) this._redraw();
      });
    } else {
      this._drawPreview();
      if (this._routeDrawn) this._redraw();
    }
  }

  private _drawPreview(): void {
    this._previewLayer.removeAll();
    if (this._waypoints.length < 2) return;
    const dense = densifyRoute(this._centrelineWaypoints(), 100) as Waypoint[];
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
    const dense = densifyRoute(this._centrelineWaypoints(), 50) as Waypoint[];
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
            this._roadPath = null;
            this._roadSummary = null;
            this._setTrafficNote(null);
            this._drawPreview();
          } else {
            this._onWaypointsChanged();
          }
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
    if (this._snapToRoads && this._roadSummary) {
      // Road-following total (real network distance + drive time) supersedes the straight-line sum.
      const t = this._roadSummary.traffic;
      this._setText(
        '#corr-st-dist',
        `${this._roadSummary.distanceKm.toFixed(1)} km · ${this._roadSummary.travelTimeMin.toFixed(0)} min` +
          (t ? ` · ${t.rating}` : ''),
      );
    } else {
      this._setText('#corr-st-dist', dist > 0 ? (dist >= 1000 ? `${(dist / 1000).toFixed(2)} km` : `${Math.round(dist)} m`) : '—');
    }
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

    // Undo / Clear only apply once there is something to undo or clear, and the
    // stats, exposure bar and Commit only mean anything after an analysis run.
    const routeActions = this._panelEl?.querySelector<HTMLElement>('#corr-route-actions');
    if (routeActions) routeActions.hidden = this._waypoints.length === 0 && this._threats.length === 0;
    const results = this._panelEl?.querySelector<HTMLElement>('#corr-results');
    if (results) results.hidden = !this._routeDrawn;
    const threatsMeta = this._panelEl?.querySelector<HTMLElement>('#corr-threats-meta');
    if (threatsMeta) {
      threatsMeta.textContent = this._threats.length === 0
        ? 'Optional, drives exposure'
        : `${this._threats.length} threat${this._threats.length === 1 ? '' : 's'}`;
    }
  }

  private _restoreFromCommitted(attrs: Partial<CorridorAnalysisMeta>): void {
    this._waypoints = Array.isArray(attrs.waypoints) ? attrs.waypoints.map((w) => ({ longitude: w.longitude, latitude: w.latitude })) : [];
    this._routeDrawn = this._waypoints.length >= 2;
    this._snapToRoads = false;
    this._roadPath = null;
    this._roadSummary = null;
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
    const statusTextMap: Record<typeof state, string> = { awaiting: 'Awaiting route', picking: 'Click map', computing: 'Computing', ready: 'Ready', committed: 'Committed', error: 'Error' };
    const message = statusTextMap[state];
    if (state === 'committed' || state === 'ready') EngineLogger.success(ENGINE_NAME, message);
    else if (state === 'error') EngineLogger.error(ENGINE_NAME, message);
    else EngineLogger.nextStep(ENGINE_NAME, message);
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

}

export default CorridorEngine;

