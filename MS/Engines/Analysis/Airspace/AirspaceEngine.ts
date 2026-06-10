import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polygon from '@arcgis/core/geometry/Polygon';
import * as geometryEngine from '@arcgis/core/geometry/geometryEngine';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils';
import SketchViewModel from '@arcgis/core/widgets/Sketch/SketchViewModel';
import EngineLogger from '../../../Support/EngineLogger';

/**
 * AirspaceEngine
 * ──────────────
 * Authors and analyses airspace control measures:
 *   • ROZ — Restricted Operations Zone
 *   • ACA — Airspace Coordination Area
 *
 * Each volume is a footprint polygon plus a floor/ceiling altitude band and an
 * effective DTG window. Mirrors the PosDef engine lifecycle (initialize / open /
 * openWidget / close / destroy + a self-hosted draggable panel).
 *
 * Map output:
 *   • 2D (MapView): hatched footprint + label block (name, floor–ceiling, DTG).
 *   • 3D (SceneView): footprint extruded between floor and ceiling altitude
 *     (wall quads + floor/ceiling caps, hasZ rings) — the technique used by
 *     VisualizationEngine._computeExtrudedFootprints, adapted to an altitude band.
 *   • Conflict detection: footprint intersection AND altitude-band overlap with
 *     other airspace volumes and flight routes is highlighted in red.
 *
 * Floor/ceiling are edited on the drawn footprint through Morphix updateSymbol
 * so the metadata persists with save/load.
 */

const WGS84 = { wkid: 4326 } as any;
const ENGINE_NAME = 'AirspaceEngine';
const FT_PER_M = 3.280839895;

type AirspaceType = 'ROZ' | 'ACA';
type AltMode = 'AGL' | 'MSL' | 'FL';

interface AirspaceVolume {
  id: number;
  type: AirspaceType;
  name: string;
  polygon: Polygon;            // WGS84 geographic
  floor: number;               // value in the chosen unit (m for AGL/MSL, FL number for FL)
  ceiling: number;
  altMode: AltMode;
  dtgFrom: string;
  dtgTo: string;
  graphic: Graphic | null;     // source footprint graphic (for Morphix patch)
  groundZ: number;             // terrain elevation at centroid (m MSL), resolved on analyze
}

const TYPE_COLOR: Record<AirspaceType, [number, number, number]> = {
  ROZ: [220, 70, 40],   // restrictive — warm
  ACA: [55, 138, 221],  // coordinating — cool
};

let _volumeSeq = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function polygonCentroid(geom: any): Point | null {
  if (!geom) return null;
  if (geom.centroid) return geom.centroid as Point;
  if (geom.extent?.center) return geom.extent.center as Point;
  return null;
}

export class AirspaceEngine {
  static readonly FOOTPRINT_LAYER_ID = 'airspace-footprints';
  static readonly VOLUME_LAYER_ID = 'airspace-volumes-3d';
  static readonly LABEL_LAYER_ID = 'airspace-labels';
  static readonly CONFLICT_LAYER_ID = 'airspace-conflicts';

  private _view: MapView | SceneView | null = null;
  private _footprintLayer!: GraphicsLayer;
  private _volumeLayer!: GraphicsLayer;
  private _labelLayer!: GraphicsLayer;
  private _conflictLayer!: GraphicsLayer;

  private _panelEl: HTMLDivElement | null = null;
  private _draggableBound: WeakSet<HTMLElement> = new WeakSet();
  private _sketch: SketchViewModel | null = null;

  private _volumes: AirspaceVolume[] = [];
  private _activeId: number | null = null;

  constructor() {
    this._createLayers();
  }

  initialize(view: MapView | SceneView): void {
    if (this._view === view) return;
    this._view = view;
    // The sketch is bound to a specific view — drop it so it rebinds on demand.
    try { this._sketch?.destroy(); } catch {}
    this._sketch = null;
    const map = view.map as any;
    if (map && !map.findLayerById(this._footprintLayer.id)) {
      map.addMany([this._footprintLayer, this._volumeLayer, this._labelLayer, this._conflictLayer]);
    }
    // Re-render on view switch so the 3D volume appears/disappears appropriately.
    if (this._volumes.length) this._renderAll();
  }

  /** Open from context menu against a drawn footprint polygon. */
  open(graphic: Graphic, view: MapView | SceneView): void {
    this.initialize(view);
    this._ensurePanel();
    this._showPanel();
    const geom = graphic?.geometry as any;
    if (geom && (geom.type === 'polygon' || geom.rings)) {
      const vol = this._registerVolume(graphic);
      this._activeId = vol.id;
      this._loadVolumeIntoPanel(vol);
      this._renderAll();
    }
  }

  /** Open standalone — shows the panel; user picks a footprint to author. */
  openWidget(view?: MapView | SceneView): void {
    if (view) this.initialize(view);
    if (!this._view) return;
    this._ensurePanel();
    this._showPanel();
    this._refreshVolumeSelect();
  }

  close(): void {
    try { this._sketch?.cancel(); } catch {}
    this._hidePanel();
  }

  destroy(): void {
    this.close();
    try { this._sketch?.destroy(); } catch {}
    this._sketch = null;
    const map = this._view?.map as any;
    if (map) {
      [this._footprintLayer, this._volumeLayer, this._labelLayer, this._conflictLayer]
        .forEach((l) => { try { map.remove(l); } catch {} });
    }
    this._panelEl?.remove();
    this._panelEl = null;
    this._volumes = [];
    this._view = null;
  }

  // ─── Layers ────────────────────────────────────────────────────────────────

  private _createLayers(): void {
    this._footprintLayer = new GraphicsLayer({ id: AirspaceEngine.FOOTPRINT_LAYER_ID, title: 'Airspace - Footprints', elevationInfo: { mode: 'on-the-ground' } as any });
    this._volumeLayer = new GraphicsLayer({ id: AirspaceEngine.VOLUME_LAYER_ID, title: 'Airspace - 3D Volumes', elevationInfo: { mode: 'absolute-height' } as any });
    this._labelLayer = new GraphicsLayer({ id: AirspaceEngine.LABEL_LAYER_ID, title: 'Airspace - Labels', elevationInfo: { mode: 'on-the-ground' } as any });
    this._conflictLayer = new GraphicsLayer({ id: AirspaceEngine.CONFLICT_LAYER_ID, title: 'Airspace - Conflicts', elevationInfo: { mode: 'on-the-ground' } as any });
  }

  // ─── Volume registry ──────────────────────────────────────────────────────

  private _registerVolume(graphic: Graphic): AirspaceVolume {
    // Reuse an existing registration if we already track this graphic.
    const existing = this._volumes.find((v) => v.graphic === graphic);
    if (existing) return existing;

    const poly = this._toGeographicPolygon(graphic.geometry as any);
    const de = (graphic.attributes?.drawEssentials ?? {}) as any;
    const name = de.AIRSPACE_NAME ?? graphic.attributes?.uniqueDesignation ?? `Airspace ${_volumeSeq}`;
    const type: AirspaceType = (de.AIRSPACE_TYPE === 'ACA' ? 'ACA' : 'ROZ');
    const vol: AirspaceVolume = {
      id: _volumeSeq++,
      type,
      name,
      polygon: poly,
      floor: Number(de.FLOOR_ALT_M ?? 0),
      ceiling: Number(de.CEILING_ALT_M ?? 1000),
      altMode: (de.ALT_MODE as AltMode) ?? 'AGL',
      dtgFrom: de.DTG_FROM ?? '',
      dtgTo: de.DTG_TO ?? '',
      graphic,
      groundZ: 0,
    };
    this._volumes.push(vol);
    this._refreshVolumeSelect();
    return vol;
  }

  /** Register a freshly-drawn footprint (no source graphic) as a new volume. */
  private _registerVolumeFromPolygon(poly: Polygon): AirspaceVolume {
    const type = (this._select('airspace-type', 'ROZ') as AirspaceType);
    const vol: AirspaceVolume = {
      id: _volumeSeq++,
      type,
      name: (this._input('airspace-name')?.value || `Airspace ${_volumeSeq}`).trim(),
      polygon: poly,
      floor: this._num('airspace-floor', 0),
      ceiling: this._num('airspace-ceiling', 1000),
      altMode: (this._select('airspace-altmode', 'AGL') as AltMode),
      dtgFrom: this._input('airspace-dtg-from')?.value ?? '',
      dtgTo: this._input('airspace-dtg-to')?.value ?? '',
      graphic: null,
      groundZ: 0,
    };
    this._volumes.push(vol);
    this._refreshVolumeSelect();
    return vol;
  }

  // ─── Footprint drawing ────────────────────────────────────────────────────

  private _ensureSketch(): void {
    if (!this._view || this._sketch) return;
    this._sketch = new SketchViewModel({
      view: this._view,
      layer: this._footprintLayer,
      defaultCreateOptions: { mode: 'click' } as any,
    } as any);
    this._sketch.on('create', (event: any) => {
      if (event.state !== 'complete') return;
      const geom = event.graphic?.geometry;
      if (!geom || geom.type !== 'polygon') return;
      const poly = this._toGeographicPolygon(geom);
      const vol = this._registerVolumeFromPolygon(poly);
      this._activeId = vol.id;
      this._loadVolumeIntoPanel(vol);
      void this._renderAll();
      this._setStatus(`${vol.type} ${vol.name} drawn — set band & Apply`, 'ok');
    });
  }

  private _startDrawing(): void {
    if (!this._view) return;
    this._ensureSketch();
    try { this._sketch?.cancel(); } catch {}
    this._setStatus('Draw the footprint — click vertices, double-click to finish', 'ok');
    this._sketch?.create('polygon');
  }

  /** Resolve a band value (in its unit) to absolute metres MSL. */
  private _absMeters(value: number, altMode: AltMode, groundZ: number): number {
    if (altMode === 'FL') return (value * 100) / FT_PER_M;     // FL080 → 8000 ft → m MSL
    if (altMode === 'MSL') return value;                       // already m MSL
    return groundZ + value;                                    // AGL → ground + offset
  }

  private _bandLabel(value: number, altMode: AltMode): string {
    if (altMode === 'FL') return `FL${String(Math.round(value)).padStart(3, '0')}`;
    if (altMode === 'MSL') return `${Math.round(value)} m MSL`;
    return `${Math.round(value)} m AGL`;
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  private async _renderAll(): Promise<void> {
    if (!this._view) return;
    this._footprintLayer.removeAll();
    this._labelLayer.removeAll();
    this._volumeLayer.removeAll();

    const is3d = this._view.type === '3d';
    for (const vol of this._volumes) {
      // Resolve ground elevation at the centroid (best effort) for AGL bands.
      if (vol.altMode === 'AGL') {
        try {
          const c = polygonCentroid(vol.polygon);
          if (c) {
            const er = await (this._view.map as any).ground.queryElevation(
              new Point({ longitude: c.longitude ?? c.x, latitude: c.latitude ?? c.y, spatialReference: WGS84 }),
            );
            vol.groundZ = (er?.geometry?.z ?? 0) as number;
          }
        } catch { vol.groundZ = 0; }
      }
      this._drawFootprint(vol);
      this._drawLabel(vol);
      if (is3d) this._drawVolume(vol);
    }
  }

  private _drawFootprint(vol: AirspaceVolume): void {
    const [r, g, b] = TYPE_COLOR[vol.type];
    const active = vol.id === this._activeId;
    this._footprintLayer.add(new Graphic({
      geometry: vol.polygon,
      symbol: {
        type: 'simple-fill',
        color: [r, g, b, active ? 0.18 : 0.1],
        outline: { color: [r, g, b, active ? 255 : 190], width: active ? 2 : 1.3, style: vol.type === 'ROZ' ? 'dash' : 'solid' },
      } as any,
      attributes: { type: `${vol.type} footprint`, label: vol.name, airspaceId: vol.id },
    }));
  }

  private _drawLabel(vol: AirspaceVolume): void {
    const c = polygonCentroid(vol.polygon);
    if (!c) return;
    const [r, g, b] = TYPE_COLOR[vol.type];
    const band = `${this._bandLabel(vol.floor, vol.altMode)} – ${this._bandLabel(vol.ceiling, vol.altMode)}`;
    const dtg = vol.dtgFrom || vol.dtgTo ? `\n${vol.dtgFrom || '—'} / ${vol.dtgTo || '—'}` : '';
    this._labelLayer.add(new Graphic({
      geometry: new Point({ longitude: c.longitude ?? c.x, latitude: c.latitude ?? c.y, spatialReference: WGS84 }),
      symbol: {
        type: 'text',
        text: `${vol.type} ${vol.name}\n${band}${dtg}`,
        color: [255, 255, 255, 0.95],
        haloColor: [r, g, b, 0.85],
        haloSize: 1.5,
        font: { family: 'Courier New', size: 12, weight: 'bold' },
        horizontalAlignment: 'center',
        verticalAlignment: 'middle',
      } as any,
      attributes: { type: 'airspace_label', airspaceId: vol.id },
    }));
  }

  /** Extrude the footprint between floor and ceiling altitude (3D volume). */
  private _drawVolume(vol: AirspaceVolume): void {
    const rings: number[][][] = (vol.polygon as any).rings ?? [];
    if (!rings.length) return;
    const [r, g, b] = TYPE_COLOR[vol.type];
    const floorZ = this._absMeters(vol.floor, vol.altMode, vol.groundZ);
    const ceilZ = this._absMeters(vol.ceiling, vol.altMode, vol.groundZ);
    const fill = {
      type: 'simple-fill',
      color: [r, g, b, 0.16],
      outline: { color: [r, g, b, 0.55], width: 1 },
    } as any;

    // Walls
    rings.forEach((ring) => {
      for (let i = 0; i < ring.length - 1; i++) {
        const [x0, y0] = ring[i];
        const [x1, y1] = ring[i + 1];
        this._volumeLayer.add(new Graphic({
          geometry: new Polygon({
            rings: [[[x0, y0, floorZ], [x1, y1, floorZ], [x1, y1, ceilZ], [x0, y0, ceilZ], [x0, y0, floorZ]]] as any,
            hasZ: true,
            spatialReference: WGS84,
          } as any),
          symbol: fill,
          attributes: { type: 'airspace_wall', airspaceId: vol.id },
        }));
      }
    });

    // Floor + ceiling caps
    [floorZ, ceilZ].forEach((z) => {
      this._volumeLayer.add(new Graphic({
        geometry: new Polygon({
          rings: rings.map((ring) => ring.map(([x, y]) => [x, y, z])) as any,
          hasZ: true,
          spatialReference: WGS84,
        } as any),
        symbol: fill,
        attributes: { type: 'airspace_cap', airspaceId: vol.id },
      }));
    });
  }

  // ─── Conflict detection ──────────────────────────────────────────────────

  private _runConflictCheck(): void {
    this._conflictLayer.removeAll();
    let conflicts = 0;

    // Volume vs volume — footprint intersection AND altitude-band overlap.
    for (let i = 0; i < this._volumes.length; i++) {
      for (let j = i + 1; j < this._volumes.length; j++) {
        const a = this._volumes[i];
        const c = this._volumes[j];
        const aF = this._absMeters(a.floor, a.altMode, a.groundZ);
        const aC = this._absMeters(a.ceiling, a.altMode, a.groundZ);
        const cF = this._absMeters(c.floor, c.altMode, c.groundZ);
        const cC = this._absMeters(c.ceiling, c.altMode, c.groundZ);
        const bandOverlap = aF <= cC && cF <= aC;
        if (!bandOverlap) continue;
        let inter: any = null;
        try { inter = geometryEngine.intersect(a.polygon, c.polygon); } catch { inter = null; }
        if (inter && !Array.isArray(inter)) {
          this._addConflictGraphic(inter, `${a.type} ${a.name} ∩ ${c.type} ${c.name}`);
          conflicts++;
        }
      }
    }

    // Volume vs flight routes — best-effort footprint intersection.
    const routes = this._collectFlightRoutes();
    for (const vol of this._volumes) {
      for (const route of routes) {
        let inter: any = null;
        try { inter = geometryEngine.intersect(vol.polygon, route.geometry); } catch { inter = null; }
        if (!inter) continue;
        // If the route carries an altitude, require band overlap; else flag as potential.
        if (route.altitudeM != null) {
          const vF = this._absMeters(vol.floor, vol.altMode, vol.groundZ);
          const vC = this._absMeters(vol.ceiling, vol.altMode, vol.groundZ);
          if (route.altitudeM < vF - 50 || route.altitudeM > vC + 50) continue;
        }
        this._addConflictGraphic(inter, `${vol.type} ${vol.name} ∩ flight route`);
        conflicts++;
      }
    }

    this._setStatus(conflicts > 0 ? `${conflicts} conflict${conflicts === 1 ? '' : 's'} found` : 'No conflicts', conflicts > 0 ? 'warn' : 'ok');
    EngineLogger.success(ENGINE_NAME, `Conflict check: ${conflicts} found across ${this._volumes.length} volumes.`);
  }

  private _addConflictGraphic(geometry: any, label: string): void {
    if (geometry.type === 'polygon') {
      this._conflictLayer.add(new Graphic({
        geometry,
        symbol: { type: 'simple-fill', color: [255, 30, 30, 0.32], outline: { color: [255, 40, 40, 230], width: 2 } } as any,
        attributes: { type: 'Airspace conflict', label },
      }));
    } else if (geometry.type === 'polyline') {
      this._conflictLayer.add(new Graphic({
        geometry,
        symbol: { type: 'simple-line', color: [255, 40, 40, 230], width: 3 } as any,
        attributes: { type: 'Airspace conflict', label },
      }));
    }
    const c = polygonCentroid(geometry) ?? (geometry.type === 'polyline' ? geometry.extent?.center : null);
    if (c) {
      this._conflictLayer.add(new Graphic({
        geometry: new Point({ longitude: c.longitude ?? c.x, latitude: c.latitude ?? c.y, spatialReference: WGS84 }),
        symbol: { type: 'text', text: '⚠', color: [255, 220, 0, 1], haloColor: [120, 0, 0, 1], haloSize: 2, font: { size: 16, weight: 'bold' } } as any,
        attributes: { type: 'airspace_conflict_label', label },
      }));
    }
  }

  /** Gather flight-route polylines from any flight-engine layers on the map. */
  private _collectFlightRoutes(): Array<{ geometry: any; altitudeM: number | null }> {
    const out: Array<{ geometry: any; altitudeM: number | null }> = [];
    const map = this._view?.map as any;
    if (!map?.layers) return out;
    map.layers.forEach((layer: any) => {
      const id = String(layer?.id ?? '');
      if (!id.toLowerCase().includes('flight') || !layer.graphics) return;
      layer.graphics.forEach((g: any) => {
        const geom = g?.geometry;
        if (!geom || geom.type !== 'polyline') return;
        const geographic = geom.spatialReference?.isWebMercator ? webMercatorUtils.webMercatorToGeographic(geom) : geom;
        const alt = g.attributes?.altitudeM ?? g.attributes?.altitude ?? null;
        out.push({ geometry: geographic, altitudeM: typeof alt === 'number' ? alt : null });
      });
    });
    return out;
  }

  // ─── Apply (Morphix patch + re-render) ─────────────────────────────────────

  private _applyActive(): void {
    const vol = this._volumes.find((v) => v.id === this._activeId);
    if (!vol) { this._setStatus('Select or open a footprint first', 'warn'); return; }
    vol.type = (this._select('airspace-type', 'ROZ') as AirspaceType);
    vol.name = (this._input('airspace-name')?.value || vol.name).trim();
    vol.altMode = (this._select('airspace-altmode', 'AGL') as AltMode);
    vol.floor = this._num('airspace-floor', vol.floor);
    vol.ceiling = this._num('airspace-ceiling', vol.ceiling);
    vol.dtgFrom = this._input('airspace-dtg-from')?.value ?? '';
    vol.dtgTo = this._input('airspace-dtg-to')?.value ?? '';

    // Persist metadata onto the source graphic via Morphix (best effort).
    if (vol.graphic) {
      try {
        const se = (window as any).symbolEngine;
        se?.updateSymbol?.(vol.graphic, {
          drawEssentials: {
            AIRSPACE_TYPE: vol.type,
            AIRSPACE_NAME: vol.name,
            ALT_MODE: vol.altMode,
            FLOOR_ALT_M: vol.floor,
            CEILING_ALT_M: vol.ceiling,
            DTG_FROM: vol.dtgFrom,
            DTG_TO: vol.dtgTo,
          },
        });
      } catch { /* Morphix unavailable — metadata kept in-engine only */ }
    }

    void this._renderAll();
    this._setStatus(`${vol.type} ${vol.name} applied`, 'ok');
  }

  // ─── Panel ─────────────────────────────────────────────────────────────────

  private _ensurePanel(): void {
    if (this._panelEl) return;
    this._panelEl = document.createElement('div');
    this._panelEl.id = 'airspace-panel';
    this._panelEl.className = 'ms-panel ms-theme-ops-dark';
    this._panelEl.style.cssText = 'position: absolute; top: 14px; right: 14px; width: 320px; z-index: 1098; max-height: calc(100vh - 28px); overflow-y: auto; display: none;';
    this._panelEl.innerHTML = this._panelHtml();
    document.body.appendChild(this._panelEl);
    this._bindPanelEvents();
    this._makePanelDraggable(this._panelEl);
  }

  private _panelHtml(): string {
    return `
      <div class="ms-header">
        <div class="ms-header-title">Airspace (ROZ / ACA)</div>
        <button class="ms-btn" id="airspace-close-btn" title="Close" style="padding: 4px 8px; font-size: var(--ms-fs-xs);">✕</button>
      </div>
      <div class="ms-body" style="display: flex; flex-direction: column;">
        <div style="padding: 8px 12px; font-size: var(--ms-fs-xs); letter-spacing: 0.07em; text-transform: uppercase; color: var(--ms-text-dim);" id="airspace-status">Open or select a footprint</div>
        <div class="ms-section-title">Active volume</div>
        <div class="ms-grid">
          <div class="ms-field" style="grid-column: 1/-1;"><label class="ms-label">Footprint</label><select id="airspace-volume-select" class="ms-select"><option value="">— none —</option></select></div>
        </div>
        <div style="padding: 0 12px 8px;"><button class="ms-btn ms-btn-primary" id="airspace-btn-draw" style="width: 100%;">✏ Draw footprint</button></div>
        <div style="font-size: var(--ms-fs-xs); color: var(--ms-text-dim); padding: 0 12px 6px; line-height: 1.5;">No symbol needed — draw a footprint here, or right-click an existing area and choose Airspace.</div>
        <div class="ms-section-title">Designation</div>
        <div class="ms-grid">
          <div class="ms-field"><label class="ms-label">Type</label><select id="airspace-type" class="ms-select"><option value="ROZ" selected>ROZ</option><option value="ACA">ACA</option></select></div>
          <div class="ms-field"><label class="ms-label">Name</label><input id="airspace-name" type="text" value="ALPHA" class="ms-input"></div>
        </div>
        <div class="ms-section-title">Altitude band</div>
        <div class="ms-grid">
          <div class="ms-field"><label class="ms-label">Reference</label><select id="airspace-altmode" class="ms-select"><option value="AGL" selected>AGL (m)</option><option value="MSL">MSL (m)</option><option value="FL">Flight Level</option></select></div>
          <div class="ms-field"></div>
          <div class="ms-field"><label class="ms-label">Floor</label><input id="airspace-floor" type="number" value="0" step="10" class="ms-input"></div>
          <div class="ms-field"><label class="ms-label">Ceiling</label><input id="airspace-ceiling" type="number" value="1000" step="10" class="ms-input"></div>
        </div>
        <div class="ms-section-title">Effective (DTG)</div>
        <div class="ms-grid">
          <div class="ms-field"><label class="ms-label">From</label><input id="airspace-dtg-from" type="text" placeholder="0600Z" class="ms-input"></div>
          <div class="ms-field"><label class="ms-label">To</label><input id="airspace-dtg-to" type="text" placeholder="1200Z" class="ms-input"></div>
        </div>
        <div style="font-size: var(--ms-fs-xs); color: var(--ms-text-dim); padding: 4px 12px 8px; line-height: 1.5;">Switch to the 3D scene to see the extruded altitude-band volume.</div>
        <div class="ms-divider" style="margin: 4px 0;"></div>
        <div style="display: flex; gap: 6px; padding: 9px 12px;">
          <button class="ms-btn" id="airspace-btn-conflict" style="flex: 1;">Conflict check</button>
          <button class="ms-btn ms-btn-primary" id="airspace-btn-apply" style="flex: 1;">Apply</button>
        </div>
        <div style="padding: 0 12px 10px;"><button class="ms-btn" id="airspace-btn-clear" style="width: 100%;">Clear overlays</button></div>
      </div>
    `;
  }

  private _bindPanelEvents(): void {
    const p = this._panelEl;
    if (!p) return;
    p.querySelector('#airspace-close-btn')?.addEventListener('click', () => this.close());
    p.querySelector('#airspace-btn-draw')?.addEventListener('click', () => this._startDrawing());
    p.querySelector('#airspace-btn-apply')?.addEventListener('click', () => this._applyActive());
    p.querySelector('#airspace-btn-conflict')?.addEventListener('click', () => this._runConflictCheck());
    p.querySelector('#airspace-btn-clear')?.addEventListener('click', () => this._conflictLayer.removeAll());
    p.querySelector('#airspace-volume-select')?.addEventListener('change', () => {
      const id = Number((this._el('airspace-volume-select') as HTMLSelectElement | null)?.value || 0);
      const vol = this._volumes.find((v) => v.id === id);
      if (vol) {
        this._activeId = vol.id;
        this._loadVolumeIntoPanel(vol);
        void this._renderAll();
      }
    });
  }

  private _refreshVolumeSelect(): void {
    const sel = this._el('airspace-volume-select') as HTMLSelectElement | null;
    if (!sel) return;
    sel.innerHTML = '<option value="">— none —</option>' +
      this._volumes.map((v) => `<option value="${v.id}"${v.id === this._activeId ? ' selected' : ''}>${v.type} ${v.name}</option>`).join('');
  }

  private _loadVolumeIntoPanel(vol: AirspaceVolume): void {
    this._setSelect('airspace-type', vol.type);
    this._setValue('airspace-name', vol.name);
    this._setSelect('airspace-altmode', vol.altMode);
    this._setValue('airspace-floor', String(vol.floor));
    this._setValue('airspace-ceiling', String(vol.ceiling));
    this._setValue('airspace-dtg-from', vol.dtgFrom);
    this._setValue('airspace-dtg-to', vol.dtgTo);
    this._refreshVolumeSelect();
    this._setStatus(`${vol.type} ${vol.name} loaded`, 'ok');
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private _toGeographicPolygon(geom: any): Polygon {
    try {
      if (geom?.spatialReference?.isWebMercator) {
        return webMercatorUtils.webMercatorToGeographic(geom) as Polygon;
      }
    } catch { /* fall through */ }
    return geom as Polygon;
  }

  private _showPanel(): void { if (this._panelEl) this._panelEl.style.display = 'block'; }
  private _hidePanel(): void { if (this._panelEl) this._panelEl.style.display = 'none'; }

  private _makePanelDraggable(panel: HTMLDivElement | null): void {
    if (!panel) return;
    const handle = panel.querySelector('.ms-header') as HTMLElement | null;
    if (!handle || this._draggableBound.has(panel)) return;
    this._draggableBound.add(panel);
    handle.style.cursor = 'grab';
    handle.style.userSelect = 'none';
    let dragging = false; let ox = 0; let oy = 0;
    handle.addEventListener('mousedown', (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button, input, select')) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      panel.style.left = rect.left + 'px'; panel.style.top = rect.top + 'px';
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
      ox = e.clientX - rect.left; oy = e.clientY - rect.top;
      handle.style.cursor = 'grabbing'; document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (!dragging) return;
      const maxLeft = window.innerWidth - panel.offsetWidth - 4;
      const maxTop = window.innerHeight - panel.offsetHeight - 4;
      panel.style.left = clamp(e.clientX - ox, 0, maxLeft) + 'px';
      panel.style.top = clamp(e.clientY - oy, 0, maxTop) + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false; handle.style.cursor = 'grab'; document.body.style.userSelect = '';
    });
  }

  private _setStatus(t: string, tone: 'ok' | 'warn'): void {
    const el = this._el('airspace-status');
    if (el) {
      el.textContent = t;
      el.style.color = tone === 'warn' ? '#EF9F27' : 'var(--ms-accent)';
    }
  }

  private _el(id: string): HTMLElement | null { return document.getElementById(id); }
  private _input(id: string): HTMLInputElement | null { return this._el(id) as HTMLInputElement | null; }
  private _num(id: string, fallback: number): number {
    const value = Number(this._input(id)?.value ?? fallback);
    return Number.isFinite(value) ? value : fallback;
  }
  private _select(id: string, fallback: string): string {
    return (this._el(id) as HTMLSelectElement | null)?.value ?? fallback;
  }
  private _setValue(id: string, value: string): void {
    const el = this._input(id);
    if (el) el.value = value;
  }
  private _setSelect(id: string, value: string): void {
    const el = this._el(id) as HTMLSelectElement | null;
    if (el) el.value = value;
  }
}

export default AirspaceEngine;
