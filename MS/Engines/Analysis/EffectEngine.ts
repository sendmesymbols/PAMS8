/**
 * EffectEngine.ts
 * Weapon Effect analysis engine.
 *
 * Integrated with ContextMenuManager via linkEffectEngine().
 * Right-click any symbol → Analysis → Weapon Effect.
 *
 * Layers:
 *   effects-analysis   — working graphics (rings, spheres, union)
 *   effects-marker     — impact point markers
 *   effects-anim       — animated blast wave sphere
 *   effects-committed  — persisted results after Commit
 */

import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polygon from '@arcgis/core/geometry/Polygon';
import Mesh from '@arcgis/core/geometry/Mesh';
import * as geometryEngine from '@arcgis/core/geometry/geometryEngine';
import { bindDisclosures } from '../../Support/Disclosure';

// ─── Constants & Physics Models ───────────────────────────────────────────────

export const MUNITION_PRESETS: Record<string, any> = {
  mortar_60mm:      { label: 'Mortar 60 mm',         tntEquivKg: 0.23,  fragmentVelocityMS: 1200, casingMassRatio: 2.8, detonationHeightM: 0,    color: [239, 159, 39], icon: '⬡' },
  mortar_81mm:      { label: 'Mortar 81 mm',         tntEquivKg: 0.56,  fragmentVelocityMS: 1350, casingMassRatio: 2.5, detonationHeightM: 0,    color: [239, 159, 39], icon: '⬡' },
  artillery_105mm:  { label: 'Artillery 105 mm HE',  tntEquivKg: 2.18,  fragmentVelocityMS: 1550, casingMassRatio: 3.1, detonationHeightM: 0,    color: [186, 117, 23], icon: '◈' },
  artillery_155mm:  { label: 'Artillery 155 mm HE',  tntEquivKg: 6.62,  fragmentVelocityMS: 1650, casingMassRatio: 3.3, detonationHeightM: 0,    color: [186, 117, 23], icon: '◈' },
  ied_10kg:         { label: 'IED 10 kg TNT',        tntEquivKg: 10.0,  fragmentVelocityMS: 800,  casingMassRatio: 0.5, detonationHeightM: 0,    color: [220, 90, 48],  icon: '✕' },
  vbied_100kg:      { label: 'VBIED 100 kg TNT',     tntEquivKg: 100.0, fragmentVelocityMS: 900,  casingMassRatio: 0.3, detonationHeightM: 1.2,  color: [220, 60, 48],  icon: '✕' },
  gbbu_500lb:       { label: 'GBU-12 500 lb',        tntEquivKg: 89.0,  fragmentVelocityMS: 1800, casingMassRatio: 4.2, detonationHeightM: 0,    color: [55, 138, 221], icon: '▽' },
  thermobaric:      { label: 'Thermobaric / FAE',    tntEquivKg: 55.0,  fragmentVelocityMS: 600,  casingMassRatio: 0.2, detonationHeightM: 15,   color: [180, 40, 220], icon: '◉' },
};

export const STRUCTURE_FACTORS: Record<string, any> = {
  open_area:           { label: 'Open area',             blastMult: 1.0,  fragMult: 1.0  },
  light_urban:         { label: 'Light urban (wood)',    blastMult: 0.75, fragMult: 0.60 },
  masonry:             { label: 'Masonry / brick',       blastMult: 0.55, fragMult: 0.40 },
  reinforced_concrete: { label: 'Reinforced concrete',   blastMult: 0.30, fragMult: 0.20 },
  reenforced_shelter:  { label: 'Field shelter / HESCO', blastMult: 0.40, fragMult: 0.35 },
};

const HC_TABLE = [
  [0.3, 82740], [0.4, 27580], [0.5, 12410], [0.6, 6210],
  [0.7, 3450], [0.8, 2070], [1.0, 1040], [1.2, 621],
  [1.5, 345], [2.0, 172], [2.5, 103], [3.0, 69],
  [4.0, 41], [5.0, 28], [7.0, 14], [10.0, 7],
  [15.0, 3.5], [20.0, 2.0], [30.0, 1.0], [50.0, 0.35],
];

function zToOverpressureKPa(Z: number): number {
  if (Z <= HC_TABLE[0][0]) return HC_TABLE[0][1];
  if (Z >= HC_TABLE[HC_TABLE.length - 1][0]) return HC_TABLE[HC_TABLE.length - 1][1];
  for (let i = 0; i < HC_TABLE.length - 1; i++) {
    const [z0, p0] = HC_TABLE[i];
    const [z1, p1] = HC_TABLE[i + 1];
    if (Z >= z0 && Z <= z1) {
      const t = (Z - z0) / (z1 - z0);
      return Math.exp(Math.log(p0) + t * (Math.log(p1) - Math.log(p0)));
    }
  }
  return 0;
}

function overpressureRadius(tntKg: number, targetKPa: number, heightM = 0): number {
  const W3 = Math.cbrt(tntKg);
  let lo = 0.1, hi = 60;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (zToOverpressureKPa(mid) > targetKPa) lo = mid; else hi = mid;
  }
  // `lo * W3` is the actual (slant) distance from the burst at which the target
  // overpressure occurs. For an elevated burst the radius felt on the ground is
  // the horizontal leg of that slant distance, so it *shrinks* with height.
  const slantR = lo * W3;
  const groundR = Math.sqrt(Math.max(0, slantR * slantR - heightM * heightM));
  return groundR;
}

function fragLethalRadius(tntKg: number, v0MS: number, casingRatio: number): number {
  const r0 = 0.15 * Math.cbrt(tntKg);
  const lambda = 180 + casingRatio * 15;
  const vMin = 60;
  let r = r0;
  for (let i = 0; i < 200; i++) {
    const v = v0MS * (r0 / r) * Math.exp(-r / lambda);
    if (v <= vMin) break;
    r += 0.5;
  }
  return r;
}

function thermalRadius(tntKg: number): number {
  return 1.8 * Math.cbrt(tntKg) * Math.pow(tntKg, 0.17);
}

export function computeEffects(munition: string, structureFactor = 'open_area', tntOverrideKg: number | null = null, detonationHeightOverride: number | null = null): any {
  const m = MUNITION_PRESETS[munition] ?? MUNITION_PRESETS.mortar_81mm;
  const sf = STRUCTURE_FACTORS[structureFactor] ?? STRUCTURE_FACTORS.open_area;
  const W = (tntOverrideKg != null && tntOverrideKg > 0) ? tntOverrideKg : m.tntEquivKg;
  const h = detonationHeightOverride ?? m.detonationHeightM;

  const rLethalBlast = overpressureRadius(W, 200, h) * sf.blastMult;
  const rInjuryBlast = overpressureRadius(W, 35, h) * sf.blastMult;
  const rSafeBlast   = overpressureRadius(W, 6.9, h) * sf.blastMult;

  const rFragLethal   = fragLethalRadius(W, m.fragmentVelocityMS, m.casingMassRatio) * sf.fragMult;
  const rFragCasualty = rFragLethal * 1.6;

  const rThermal = thermalRadius(W) * sf.blastMult;
  const rCompositeLethal = Math.max(rLethalBlast, rFragLethal);
  const rQD_inhabited = 22.2 * Math.cbrt(W);

  return {
    munition: m,
    structureFactor: sf,
    detonationHeightM: h,
    rings: [
      { id:'lethal_composite', label:'Lethal radius',    radiusM: rCompositeLethal, colorKey:'lethal',  opacity:0.22 },
      { id:'injury_blast',     label:'Injury — blast',   radiusM: rInjuryBlast,     colorKey:'warning', opacity:0.16 },
      { id:'frag_casualty',    label:'Frag casualty',    radiusM: rFragCasualty,    colorKey:'warning', opacity:0.12 },
      { id:'thermal',          label:'Thermal / 3° burn',radiusM: rThermal,         colorKey:'thermal', opacity:0.10 },
      { id:'safe_blast',       label:'Safe — blast',     radiusM: rSafeBlast,       colorKey:'safe',    opacity:0.08 },
      { id:'qd_inhabited',     label:'QD inhabited',     radiusM: rQD_inhabited,    colorKey:'qd',      opacity:0.06 },
    ].filter(r => r.radiusM > 0.5).sort((a, b) => b.radiusM - a.radiusM),
  };
}

export const EFFECTS_COLORS: Record<string, { fill: number[], outline: number[] }> = {
  lethal:  { fill:[220,  60, 48], outline:[220, 60, 48, 0.90] },
  warning: { fill:[239, 159, 39], outline:[239,159, 39, 0.85] },
  thermal: { fill:[220, 120,  0], outline:[220,120,  0, 0.80] },
  safe:    { fill:[ 29, 158,117], outline:[ 29,158,117, 0.70] },
  qd:      { fill:[ 55, 138,221], outline:[ 55,138,221, 0.60] },
};

export function destinationPoint(lon: number, lat: number, bearingDeg: number, distM: number): { longitude: number; latitude: number } {
  const R = 6_371_008.8;
  const δ = distM / R;
  const θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { longitude: (λ2 * 180) / Math.PI, latitude: (φ2 * 180) / Math.PI };
}

export class EffectEngine {

  static readonly ANALYSIS_LAYER_ID  = 'effects-analysis';
  static readonly MARKER_LAYER_ID    = 'effects-marker';
  static readonly ANIM_LAYER_ID      = 'effects-anim';
  static readonly COMMITTED_LAYER_ID = 'effects-committed';

  private _view: MapView | SceneView | null = null;
  private _analysisLayer!: GraphicsLayer;
  private _markerLayer!: GraphicsLayer;
  private _animLayer!: GraphicsLayer;
  private _committedLayer!: GraphicsLayer;

  private _panelEl: HTMLDivElement | null = null;
  private _legendEl: HTMLDivElement | null = null;
  private _hintEl: HTMLDivElement | null = null;

  private _strikes: any[] = [];
  private _pickHandle: any = null;
  private _blastAnimations: any[] = [];

  // Draggable panel state
  private _dragOffsetX = 0;
  private _dragOffsetY = 0;
  private _isDragging = false;

  constructor() {
    this._createLayers();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  initialize(view: MapView | SceneView): void {
    if (this._view === view) return;
    this._view = view;
    const map = view.map as any;
    if (map && !map.findLayerById(this._analysisLayer.id)) {
      map.addMany([this._committedLayer, this._analysisLayer, this._markerLayer, this._animLayer]);
    }
  }

  open(graphic?: Graphic | null, view?: MapView | SceneView): void {
    if (view) this.initialize(view);

    // Resume mode: panel was closed with working state intact
    if (this._panelEl && !this._panelEl.classList.contains('ms-visible') && this._strikes.length > 0) {
      this._panelEl.classList.add('ms-visible');
      this._legendEl?.classList.add('ms-visible');
      return;
    }

    // Normal mode
    this._strikes = [];
    this._showPanel();
    this._showLegend();
    this._showHint('Click map to place detonation point');

    // With a symbol, seed the first strike at its location; otherwise the user
    // places the detonation point by clicking the map (Pick is active below).
    let pt: Point | null = null;
    const geom = graphic?.geometry;
    if (geom?.type === 'point') {
      pt = geom as Point;
    } else if ((geom as any)?.centroid) {
      pt = (geom as any).centroid as Point;
    }

    if (pt) {
      this._addStrike(pt);
    }

    this._startPick();
  }

  close(): void {
    this._hidePanel();
    this._hideLegend();
    this._hideHint();
    this._analysisLayer.removeAll();
    this._markerLayer.removeAll();
    this._animLayer.removeAll();
    this._cancelPick();
    this._stopAllAnimations();
    this._strikes = [];
  }

  destroy(): void {
    this.close();
    const map = this._view?.map as any;
    if (map) {
      map.remove(this._analysisLayer);
      map.remove(this._markerLayer);
      map.remove(this._animLayer);
      map.remove(this._committedLayer);
    }
    this._panelEl?.remove();
    this._panelEl = null;
    this._legendEl?.remove();
    this._legendEl = null;
    this._hintEl?.remove();
    this._hintEl = null;
    this._view = null;
  }

  // ─── Private: Layers ────────────────────────────────────────────────────────

  private _createLayers(): void {
    this._analysisLayer = new GraphicsLayer({
      id: EffectEngine.ANALYSIS_LAYER_ID,
      title: 'Effects — Rings',
      elevationInfo: { mode: 'on-the-ground' } as any,
    });
    this._markerLayer = new GraphicsLayer({
      id: EffectEngine.MARKER_LAYER_ID,
      title: 'Effects — Markers',
      elevationInfo: { mode: 'on-the-ground' } as any,
    });
    this._animLayer = new GraphicsLayer({
      id: EffectEngine.ANIM_LAYER_ID,
      title: 'Effects — Blast Wave',
      elevationInfo: { mode: 'absolute-height' } as any,
    });
    this._committedLayer = new GraphicsLayer({
      id: EffectEngine.COMMITTED_LAYER_ID,
      title: 'Effects — Committed',
      elevationInfo: { mode: 'on-the-ground' } as any,
    });
  }

  // ─── Private: Core Logic ────────────────────────────────────────────────────

  private _addStrike(pt: Point): void {
    const munKey = this._inp('effects-inp-munition')?.value ?? 'mortar_81mm';
    const struct = this._inp('effects-inp-structure')?.value ?? 'open_area';
    const tntOvStr = this._inp('effects-inp-tnt')?.value?.trim() ?? '';
    const tntOvParsed = tntOvStr !== '' ? parseFloat(tntOvStr) : NaN;
    const tntOv = Number.isFinite(tntOvParsed) ? tntOvParsed : null;
    const hOv    = parseFloat(this._inp('effects-inp-height')?.value ?? '0') || 0;

    const res = computeEffects(munKey, struct, tntOv, hOv);

    this._strikes.push({ point: pt, result: res, munKey, struct, tntOv, hOv });

    const coordsEl = this._panelEl?.querySelector<HTMLElement>('#effects-coords');
    if (coordsEl) {
      coordsEl.textContent = `Strike ${this._strikes.length}  ${pt.latitude.toFixed(4)}°N  ${pt.longitude.toFixed(4)}°E`;
      coordsEl.style.color = '';
    }

    this._hideHint();
    const btnUndo = this._panelEl?.querySelector<HTMLButtonElement>('#effects-btn-undo');
    if (btnUndo) btnUndo.disabled = false;

    this._renderStrikeList();
    this._redrawAll();

    const optAnim = this._panelEl?.querySelector<HTMLInputElement>('#effects-opt-anim');
    if (optAnim?.checked) {
      this._playBlastWave(pt, res);
    }
  }

  private _redrawAll(): void {
    if (this._strikes.length === 0) return;
    this._setStatus('busy');
    this._analysisLayer.removeAll();
    this._markerLayer.removeAll();

    const donut  = this._inp('effects-opt-donut')?.checked ?? true;
    const labels = this._inp('effects-opt-labels')?.checked ?? true;
    const union  = this._inp('effects-opt-union')?.checked ?? true;
    const showDome    = this._inp('effects-opt-dome')?.checked ?? true;
    const domeOpacity = Number(this._inp('effects-dome-opacity')?.value ?? 95) / 100;

    this._strikes.forEach(s => {
      // Recompute each strike from ITS OWN stored munition / structure / overrides
      // (captured in _addStrike), so multiple strikes with different munitions can
      // coexist. The panel controls configure the NEXT strike to be placed — they
      // must not retroactively homogenise already-placed strikes.
      s.result = computeEffects(s.munKey, s.struct, s.tntOv, s.hOv);

      // Rings
      const ringGfx = this._buildRingGraphics(s.point, s.result, { asDonut: donut, showLabels: labels });
      this._analysisLayer.addMany(ringGfx);

      // Marker — the initial 3D detonation dome (optional)
      if (showDome) {
        const markerGfx = this._buildImpactMarker(s.point, s.result, domeOpacity);
        this._markerLayer.addMany(markerGfx);
      }
    });

    // Union
    if (union && this._strikes.length > 1) {
      const ug = this._buildUnionFootprint(this._strikes.map(s => s.point), this._strikes.map(s => s.result));
      if (ug) this._analysisLayer.add(ug);
    }

    // Readout
    const lastRes = this._strikes[this._strikes.length - 1].result;
    this._updatePhysicsPanel(lastRes);

    const btnBlast = this._panelEl?.querySelector<HTMLButtonElement>('#effects-btn-blast');
    const btnCommit = this._panelEl?.querySelector<HTMLButtonElement>('#effects-btn-commit');
    const showWave = this._inp('effects-opt-anim')?.checked ?? true;
    if (btnBlast) btnBlast.disabled = !showWave;
    if (btnCommit) btnCommit.disabled = false;

    this._setStatus('ready');
  }

  private _playBlastWave(pt: Point, res: any): void {
    const maxR = res.rings.find((r: any) => r.id === 'qd_inhabited')?.radiusM ?? 1000;
    const color = res.munition.color;
    const speedMul = parseFloat(this._inp('effects-anim-speed')?.value ?? '1') || 1;
    const durationMs = 2200 / speedMul;
    const peakAlpha = Number(this._inp('effects-blast-opacity')?.value ?? 35) / 100;

    this._setStatus('animating');

    const anim = this._createBlastWaveAnimation(pt, maxR, color, this._animLayer, durationMs, peakAlpha);
    this._blastAnimations.push(anim);

    // Quick polling to check when animation ends
    const checkEnd = setInterval(() => {
      if (!anim.playing) {
        clearInterval(checkEnd);
        this._blastAnimations = this._blastAnimations.filter(a => a !== anim);
        if (this._blastAnimations.length === 0) {
          if (this._strikes.length > 0) this._setStatus('ready');
          else this._setStatus('awaiting');
        }
      }
    }, 100);

    anim.start();
  }

  private _stopAllAnimations(): void {
    this._blastAnimations.forEach(a => a.stop());
    this._blastAnimations = [];
    this._animLayer.removeAll();
  }

  private _commit(): void {
    const ts = new Date().toISOString();
    [...this._analysisLayer.graphics.toArray(), ...this._markerLayer.graphics.toArray()]
      .forEach(g => {
        this._committedLayer.add(new Graphic({
          geometry: g.geometry?.clone(),
          symbol: (g as any).symbol?.clone(),
          attributes: { ...g.attributes, committedAt: ts },
        }));
      });
    this._flashStatus('Committed ✓', 'ready');
  }

  // ─── Private: UI Updates ────────────────────────────────────────────────────

  private _updatePhysicsPanel(res: any): void {
    if (!this._panelEl) return;
    const fmt = (v: number) => v >= 1000 ? (v / 1000).toFixed(2) + ' km' : Math.round(v) + ' m';

    // We need to extract the radii safely from the rings array
    const getR = (id: string) => res.rings.find((r: any) => r.id === id)?.radiusM ?? 0;

    const elLethal = this._panelEl.querySelector('#effects-ph-lethal');
    const elInjury = this._panelEl.querySelector('#effects-ph-injury');
    const elFrag = this._panelEl.querySelector('#effects-ph-frag');
    const elThermal = this._panelEl.querySelector('#effects-ph-thermal');
    const elSafe = this._panelEl.querySelector('#effects-ph-safe');
    const elQd = this._panelEl.querySelector('#effects-ph-qd');

    if (elLethal) elLethal.innerHTML = fmt(getR('lethal_composite')) + '<span class="effects-phys-unit"></span>';
    if (elInjury) elInjury.innerHTML = fmt(getR('injury_blast')) + '<span class="effects-phys-unit"></span>';
    if (elFrag) elFrag.innerHTML = fmt(getR('frag_casualty')) + '<span class="effects-phys-unit"></span>';
    if (elThermal) elThermal.innerHTML = fmt(getR('thermal')) + '<span class="effects-phys-unit"></span>';
    if (elSafe) elSafe.innerHTML = fmt(getR('safe_blast')) + '<span class="effects-phys-unit"></span>';
    if (elQd) elQd.innerHTML = fmt(getR('qd_inhabited')) + '<span class="effects-phys-unit"></span>';
  }

  private _renderStrikeList(): void {
    const listEl = this._panelEl?.querySelector('#effects-strike-list');
    if (!listEl) return;

    // The physics grid, strike list and playback actions only mean something
    // once a strike exists.
    const results = this._panelEl?.querySelector<HTMLElement>('#effects-results');
    if (results) results.hidden = this._strikes.length === 0;

    listEl.innerHTML = '';
    if (this._strikes.length === 0) {
      listEl.innerHTML = '<div class="effects-sk-empty">No strikes placed</div>';
      return;
    }

    this._strikes.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'effects-sk-row';
      row.innerHTML = `
        <div class="effects-sk-idx">${i + 1}</div>
        <div class="effects-sk-info">${s.point.latitude.toFixed(4)}°N  ${s.point.longitude.toFixed(4)}°E</div>
        <button class="effects-sk-del" data-i="${i}">✕</button>`;

      row.querySelector('.effects-sk-del')?.addEventListener('click', () => {
        this._strikes.splice(i, 1);
        this._renderStrikeList();
        if (this._strikes.length === 0) {
          this._analysisLayer.removeAll();
          this._markerLayer.removeAll();
          const btnBlast = this._panelEl?.querySelector<HTMLButtonElement>('#effects-btn-blast');
          const btnCommit = this._panelEl?.querySelector<HTMLButtonElement>('#effects-btn-commit');
          if (btnBlast) btnBlast.disabled = true;
          if (btnCommit) btnCommit.disabled = true;
          this._showHint('Click map to place detonation point');
          this._setStatus('awaiting');
          ['effects-ph-lethal','effects-ph-injury','effects-ph-frag','effects-ph-thermal','effects-ph-safe','effects-ph-qd']
            .forEach(id => {
              const el = this._panelEl?.querySelector(`#${id}`);
              if (el) el.innerHTML = '—';
            });
        } else {
          this._redrawAll();
        }
        const btnUndo = this._panelEl?.querySelector<HTMLButtonElement>('#effects-btn-undo');
        if (btnUndo) btnUndo.disabled = this._strikes.length === 0;
      });
      listEl.appendChild(row);
    });
  }

  private _setStatus(s: string): void {
    if (!this._panelEl) return;
    const statusEl = this._panelEl.querySelector('#effects-status');
    if (!statusEl) return;

    const M: Record<string, [string, string]> = {
      awaiting: ['Awaiting strike', '#888'],
      ready: ['Ready', 'var(--ms-success)'],
      busy: ['Computing…', 'var(--ms-accent)'],
      animating: ['Blast wave ↗', 'var(--ms-accent)']
    };
    const [txt, color] = M[s] ?? M.awaiting;
    statusEl.textContent = txt;
    const dot = this._panelEl.querySelector<HTMLElement>('#effects-status-dot');
    if (dot) {
      dot.style.background = color;
      dot.style.boxShadow = s === 'awaiting' ? 'none' : `0 0 6px ${color}`;
    }
  }

  private _flashStatus(msg: string, cls: string): void {
    if (!this._panelEl) return;
    const statusEl = this._panelEl.querySelector('#effects-status');
    if (!statusEl) return;

    void cls;
    const prev = statusEl.textContent;
    statusEl.textContent = msg;
    setTimeout(() => {
      statusEl.textContent = prev;
    }, 1800);
  }

  // ─── Private: Panels & Legends ────────────────────────────────────────────────

  private _showPanel(): void {
    if (!this._panelEl) {
      this._panelEl = document.createElement('div');
      this._panelEl.id = 'effects-engine-panel';
      this._panelEl.className = 'ms-panel ms-theme-ops-dark';
      this._panelEl.setAttribute('data-engine', 'effects');
      this._panelEl.style.top = '62px';
      this._panelEl.style.right = '12px';
      this._panelEl.style.width = '392px';
      document.body.appendChild(this._panelEl);
    }
    // open() deliberately starts fresh (strikes cleared), so the markup is
    // rebuilt rather than reused.
    this._panelEl.innerHTML = this._buildPanelHTML();
    this._panelEl.classList.add('ms-visible');
    this._bindPanelEvents();
    this._makeDraggable();
    this._renderStrikeList();
  }

  private _hidePanel(): void {
    this._panelEl?.classList.remove('ms-visible');
  }

  private _showLegend(): void {
    if (!this._legendEl) {
      this._legendEl = document.createElement('div');
      this._legendEl.id = 'effects-legend';
      this._legendEl.className = 'ms-map-legend';
      this._legendEl.innerHTML = `
        <div class="ms-map-legend-item"><div class="ms-map-legend-swatch" style="background:#DC3C30"></div><div class="ms-map-legend-label">Lethal (blast + frag)</div></div>
        <div class="ms-map-legend-item"><div class="ms-map-legend-swatch" style="background:#EF9F27"></div><div class="ms-map-legend-label">Injury / frag casualty</div></div>
        <div class="ms-map-legend-item"><div class="ms-map-legend-swatch" style="background:#DC7820"></div><div class="ms-map-legend-label">Thermal / 3° burn</div></div>
        <div class="ms-map-legend-item"><div class="ms-map-legend-swatch" style="background:#1D9E75"></div><div class="ms-map-legend-label">Safe distance — blast</div></div>
        <div class="ms-map-legend-item"><div class="ms-map-legend-swatch" style="background:#378ADD"></div><div class="ms-map-legend-label">QD inhabited buildings</div></div>
        <div class="ms-map-legend-item"><div class="ms-map-legend-swatch" style="background:#B428DC"></div><div class="ms-map-legend-label">Multi-strike union</div></div>
      `;
      document.body.appendChild(this._legendEl);
    }
    this._legendEl.classList.add('ms-visible');
  }

  private _hideLegend(): void {
    this._legendEl?.classList.remove('ms-visible');
  }

  private _showHint(text: string): void {
    if (!this._hintEl) {
      this._hintEl = document.createElement('div');
      this._hintEl.id = 'effects-hint';
      this._hintEl.className = 'ms-map-hint';
      document.body.appendChild(this._hintEl);
    }
    this._hintEl.textContent = text;
    this._hintEl.classList.add('ms-visible');
  }

  private _hideHint(): void {
    this._hintEl?.classList.remove('ms-visible');
  }

  private _buildPanelHTML(): string {
    const munOpts = Object.entries(MUNITION_PRESETS).map(([k, m]: [string, any]) =>
      `<option value="${k}"${k === 'mortar_81mm' ? ' selected' : ''}>${m.label}</option>`
    ).join('');

    const structOpts = Object.entries(STRUCTURE_FACTORS).map(([k, s]: [string, any]) =>
      `<option value="${k}"${k === 'open_area' ? ' selected' : ''}>${s.label}</option>`
    ).join('');

    return `
      <div class="ms-header" id="effects-drag-handle">
        <div class="ms-header-icon">FX</div>
        <div class="ms-header-title">Weapon Effect</div>
        <div class="ms-status-dot" id="effects-status-dot"></div>
        <div class="ms-status-lbl" id="effects-status">Awaiting strike</div>
        <button class="ms-header-btn ms-btn-round" id="effects-help-btn" title="How weapon effect works">?</button>
        <button class="ms-header-btn ms-btn-round" id="effects-minimize-btn" title="Minimize">▼</button>
        <button class="ms-header-btn ms-btn-round" id="effects-close-btn" title="Close (keeps graphics)">✕</button>
      </div>
      <div class="ms-help-popover" id="effects-help-popover" hidden>
        <div class="ms-help-head">
          <div>
            <div class="ms-help-kicker">Field Guide</div>
            <div class="ms-help-title">Weapon Effect</div>
          </div>
          <button class="ms-help-close" id="effects-help-close" title="Close">✕</button>
        </div>
        <div class="ms-help-body">
          <div class="ms-help-answers">
            <div class="ms-help-answers-kicker">Answers</div>
            <div class="ms-help-answers-q">What happens when it lands here?</div>
          </div>
          <p>Models blast, fragmentation, thermal, and quantity-distance effects radiating outward from a detonation point, then draws hazard rings around one or more strike locations.</p>
          <p style="font-size:var(--ms-fs-xs);color:var(--ms-text-dim);border-top:1px solid var(--ms-divider);padding-top:7px;margin-top:2px">Use <strong style="color:var(--ms-text)">Weapon Effect Zone</strong> first to determine where a weapon can reach, then place a strike here to see the consequences.</p>
          <div class="ms-help-block">
            <h4>How It Works</h4>
            <ol>
              <li>Click the map to place a strike — rings draw immediately, and more clicks add more strikes.</li>
              <li>Pick a munition preset; override its TNT equivalent, burst height and environment under Advanced.</li>
              <li>Replay the blast wave, union several strikes into one footprint, then commit.</li>
            </ol>
          </div>
          <div class="ms-help-block">
            <h4>Phenomenon</h4>
            <p>The engine combines several hazard models: overpressure for blast injury and safe standoff, fragment decay for casualty distance, thermal scaling for burn effects, and quantity-distance rules for inhabited-building separation. Those results are then converted into map rings.</p>
          </div>
          <div class="ms-help-block">
            <h4>Parameters</h4>
            <dl>
              <dt>Type</dt><dd>Loads a munition profile with default TNT equivalent, fragment velocity, casing ratio, and burst height.</dd>
              <dt>TNT eq</dt><dd>Overrides explosive yield in kilograms TNT equivalent, which drives most radius calculations.</dd>
              <dt>Det. height</dt><dd>Shifts the burst above ground; this changes the effective ground radius of several effects.</dd>
              <dt>Structure</dt><dd>Applies attenuation factors for open terrain, urban materials, or protected structures.</dd>
              <dt>Donut</dt><dd>Draws ring intervals as bands instead of filled disks stacked on top of each other.</dd>
              <dt>Labels</dt><dd>Shows named hazard categories and computed distances on the map.</dd>
              <dt>Animation</dt><dd>Plays an expanding blast sphere for visual timing and scale reference.</dd>
              <dt>Speed</dt><dd>Controls playback rate of the blast-wave animation.</dd>
              <dt>Union</dt><dd>Merges lethal footprints from multiple strikes into one combined hazard area.</dd>
            </dl>
          </div>
        </div>
      </div>
      <div class="ms-body">
        <!-- Default view: choose the munition, click the map to drop strikes
             (the map itself is the strike-picker; every click adds one), commit.
             Yield, burst height, environment and the display options live in the
             collapsed Advanced disclosure. -->
        <div class="ms-section-title">Munition / device</div>
        <div class="ms-grid full">
          <div class="ms-field">
            <label class="ms-label" for="effects-inp-munition">Type</label>
            <select id="effects-inp-munition" class="ms-select">${munOpts}</select>
          </div>
        </div>
        <div class="ms-coords" id="effects-coords">No strike placed — click the map</div>

        <div class="ms-btn-row">
          <button class="ms-btn ms-cta" id="effects-btn-commit" disabled>Commit to map ↗</button>
        </div>

        <div id="effects-results" hidden>
          <div class="ms-section-title">Computed radii — Hopkinson-Cranz model</div>
          <div class="effects-phys-grid">
            <div class="effects-phys-card effects-lethal">
              <div class="effects-phys-label">Lethal (blast+frag)</div>
              <div class="effects-phys-value" id="effects-ph-lethal">—</div>
            </div>
            <div class="effects-phys-card effects-warning">
              <div class="effects-phys-label">Injury — blast</div>
              <div class="effects-phys-value" id="effects-ph-injury">—</div>
            </div>
            <div class="effects-phys-card effects-warning">
              <div class="effects-phys-label">Frag casualty</div>
              <div class="effects-phys-value" id="effects-ph-frag">—</div>
            </div>
            <div class="effects-phys-card effects-thermal">
              <div class="effects-phys-label">Thermal / 3° burn</div>
              <div class="effects-phys-value" id="effects-ph-thermal">—</div>
            </div>
            <div class="effects-phys-card effects-safe">
              <div class="effects-phys-label">Safe — blast</div>
              <div class="effects-phys-value" id="effects-ph-safe">—</div>
            </div>
            <div class="effects-phys-card effects-qd">
              <div class="effects-phys-label">QD inhabited</div>
              <div class="effects-phys-value" id="effects-ph-qd">—</div>
            </div>
          </div>

          <div class="ms-section-title">Strikes placed</div>
          <div id="effects-strike-list"></div>

          <div class="ms-btn-row">
            <button class="ms-btn" id="effects-btn-blast" disabled>▶ Blast wave</button>
            <button class="ms-btn" id="effects-btn-undo" disabled>Undo last</button>
            <button class="ms-btn danger" id="effects-btn-clear">Clear all</button>
          </div>
        </div>

        <div class="ms-disclosure" data-open="false">
          <button class="ms-disclosure-head" type="button" id="effects-adv-toggle" aria-expanded="false" aria-controls="effects-adv-body">
            <span class="ms-disclosure-chevron" aria-hidden="true">▶</span>
            <span class="ms-disclosure-title">Advanced</span>
            <span class="ms-disclosure-meta">Yield, environment, display</span>
          </button>
          <div class="ms-disclosure-body" id="effects-adv-body" hidden>
            <div class="ms-section-title">Yield &amp; burst</div>
            <div class="ms-grid">
              <div class="ms-field">
                <label class="ms-label" for="effects-inp-tnt">TNT equiv. (kg)</label>
                <input id="effects-inp-tnt" class="ms-input" type="number" value="${MUNITION_PRESETS['mortar_81mm'].tntEquivKg}" min="0.01" step="0.1"/>
              </div>
              <div class="ms-field">
                <label class="ms-label" for="effects-inp-height">Det. height (m)</label>
                <input id="effects-inp-height" class="ms-input" type="number" value="${MUNITION_PRESETS['mortar_81mm'].detonationHeightM}" min="0" max="500" step="1"/>
              </div>
            </div>

            <div class="ms-section-title">Environment / structure</div>
            <div class="ms-grid full">
              <div class="ms-field">
                <label class="ms-label" for="effects-inp-structure">Structural factor</label>
                <select id="effects-inp-structure" class="ms-select">${structOpts}</select>
              </div>
            </div>

            <div class="ms-section-title">Display options</div>
            <div class="ms-toggle-row"><label for="effects-opt-donut">Donut rings (punch inner)</label><input id="effects-opt-donut" type="checkbox" class="ms-input" checked/></div>
            <div class="ms-toggle-row"><label for="effects-opt-labels">Ring labels</label><input id="effects-opt-labels" type="checkbox" class="ms-input" checked/></div>
            <div class="ms-toggle-row"><label for="effects-opt-anim">Show blast wave</label><input id="effects-opt-anim" type="checkbox" class="ms-input" checked/></div>
            <div class="ms-toggle-row"><label for="effects-opt-dome" title="The 3D dome at the detonation point">Show impact dome</label><input id="effects-opt-dome" type="checkbox" class="ms-input" checked/></div>
            <div class="ms-toggle-row"><label for="effects-opt-union">Multi-strike union</label><input id="effects-opt-union" type="checkbox" class="ms-input" checked/></div>
            <div class="ms-slider-row">
              <div class="ms-slider-label">Anim speed</div>
              <input id="effects-anim-speed" type="range" min="0.3" max="3" step="0.1" value="1"/>
              <div class="ms-slider-value" id="effects-anim-speed-v">1×</div>
            </div>
            <div class="ms-slider-row">
              <div class="ms-slider-label">Dome opacity</div>
              <input id="effects-dome-opacity" type="range" min="0" max="100" step="5" value="95"/>
              <div class="ms-slider-value" id="effects-dome-opacity-v">95%</div>
            </div>
            <div class="ms-slider-row">
              <div class="ms-slider-label">Blast opacity</div>
              <input id="effects-blast-opacity" type="range" min="0" max="100" step="5" value="35"/>
              <div class="ms-slider-value" id="effects-blast-opacity-v">35%</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private _bindPanelEvents(): void {
    if (!this._panelEl) return;

    this._panelEl.querySelector('#effects-help-btn')?.addEventListener('click', (event) => {
      event.stopPropagation();
      const help = this._panelEl!.querySelector<HTMLElement>('#effects-help-popover');
      if (help) help.hidden = !help.hidden;
    });
    this._panelEl.querySelector('#effects-help-close')?.addEventListener('click', () => {
      const help = this._panelEl!.querySelector<HTMLElement>('#effects-help-popover');
      if (help) help.hidden = true;
    });

    this._panelEl.querySelector('#effects-minimize-btn')?.addEventListener('click', () => {
      const body = this._panelEl!.querySelector<HTMLElement>('.ms-body');
      const btn  = this._panelEl!.querySelector<HTMLElement>('#effects-minimize-btn');
      if (!body || !btn) return;
      const minimized = body.classList.toggle('ms-minimized');
      btn.textContent = minimized ? '▶' : '▼';
      btn.title = minimized ? 'Restore' : 'Minimize';
    });
    bindDisclosures(this._panelEl);

    this._panelEl.querySelector('#effects-close-btn')?.addEventListener('click', () => {
      this._hidePanel();
      this._hideLegend();
      this._hideHint();
      this._cancelPick();
    });

    const inpMunition = this._panelEl.querySelector<HTMLSelectElement>('#effects-inp-munition');
    const inpTnt = this._panelEl.querySelector<HTMLInputElement>('#effects-inp-tnt');
    const inpHeight = this._panelEl.querySelector<HTMLInputElement>('#effects-inp-height');

    inpMunition?.addEventListener('change', () => {
      const m = MUNITION_PRESETS[inpMunition.value];
      if (m) {
        if (inpTnt) inpTnt.value = m.tntEquivKg.toString();
        if (inpHeight) inpHeight.value = m.detonationHeightM.toString();
        this._redrawAll();
      }
    });

    [inpTnt, inpHeight, this._panelEl.querySelector('#effects-inp-structure')].forEach(el => {
      el?.addEventListener('change', () => this._redrawAll());
    });

    ['#effects-opt-donut', '#effects-opt-labels', '#effects-opt-union', '#effects-opt-dome'].forEach(selector => {
      this._panelEl?.querySelector(selector)?.addEventListener('change', () => this._redrawAll());
    });

    // Impact dome opacity slider — live label + redraw.
    const domeOp = this._panelEl.querySelector<HTMLInputElement>('#effects-dome-opacity');
    const domeOpV = this._panelEl.querySelector('#effects-dome-opacity-v');
    domeOp?.addEventListener('input', () => {
      if (domeOpV) domeOpV.textContent = domeOp.value + '%';
      this._redrawAll();
    });

    const animSpeed = this._panelEl.querySelector<HTMLInputElement>('#effects-anim-speed');
    const animSpeedV = this._panelEl.querySelector('#effects-anim-speed-v');
    animSpeed?.addEventListener('input', () => {
      if (animSpeedV) animSpeedV.textContent = animSpeed.value + '×';
    });

    // Blast wave opacity slider — live label; takes effect on the next play.
    const blastOp = this._panelEl.querySelector<HTMLInputElement>('#effects-blast-opacity');
    const blastOpV = this._panelEl.querySelector('#effects-blast-opacity-v');
    blastOp?.addEventListener('input', () => {
      if (blastOpV) blastOpV.textContent = blastOp.value + '%';
    });

    // Show blast wave — master show/hide: stop any running wave + gate the
    // replay button when off.
    this._panelEl.querySelector('#effects-opt-anim')?.addEventListener('change', () => {
      const show = this._inp('effects-opt-anim')?.checked ?? true;
      if (!show) this._stopAllAnimations();
      const btnBlast = this._panelEl?.querySelector<HTMLButtonElement>('#effects-btn-blast');
      if (btnBlast) btnBlast.disabled = !show || this._strikes.length === 0;
    });

    this._panelEl.querySelector('#effects-btn-clear')?.addEventListener('click', () => {
      this._stopAllAnimations();
      this._strikes = [];
      this._analysisLayer.removeAll();
      this._markerLayer.removeAll();
      this._renderStrikeList();

      const btnBlast = this._panelEl?.querySelector<HTMLButtonElement>('#effects-btn-blast');
      const btnCommit = this._panelEl?.querySelector<HTMLButtonElement>('#effects-btn-commit');
      const btnUndo = this._panelEl?.querySelector<HTMLButtonElement>('#effects-btn-undo');
      if (btnBlast) btnBlast.disabled = true;
      if (btnCommit) btnCommit.disabled = true;
      if (btnUndo) btnUndo.disabled = true;

      this._showHint('Click map to place detonation point');
      const coordsEl = this._panelEl?.querySelector<HTMLElement>('#effects-coords');
      if (coordsEl) {
        coordsEl.textContent = 'No strike placed — click the map';
        coordsEl.style.color = 'var(--ms-text-dim)';
      }

      ['effects-ph-lethal','effects-ph-injury','effects-ph-frag','effects-ph-thermal','effects-ph-safe','effects-ph-qd']
        .forEach(id => {
          const el = this._panelEl?.querySelector(`#${id}`);
          if (el) el.innerHTML = '—';
        });
      this._setStatus('awaiting');
    });

    this._panelEl.querySelector('#effects-btn-undo')?.addEventListener('click', () => {
      if (this._strikes.length === 0) return;
      this._strikes.pop();
      this._renderStrikeList();
      const btnUndo = this._panelEl?.querySelector<HTMLButtonElement>('#effects-btn-undo');
      if (btnUndo) btnUndo.disabled = this._strikes.length === 0;

      if (this._strikes.length === 0) {
        this._analysisLayer.removeAll();
        this._markerLayer.removeAll();
        const btnBlast = this._panelEl?.querySelector<HTMLButtonElement>('#effects-btn-blast');
        const btnCommit = this._panelEl?.querySelector<HTMLButtonElement>('#effects-btn-commit');
        if (btnBlast) btnBlast.disabled = true;
        if (btnCommit) btnCommit.disabled = true;
        this._showHint('Click map to place detonation point');
        this._setStatus('awaiting');
      } else {
        this._redrawAll();
      }
    });

    this._panelEl.querySelector('#effects-btn-blast')?.addEventListener('click', () => {
      if (this._strikes.length === 0) return;
      const s = this._strikes[this._strikes.length - 1];
      this._playBlastWave(s.point, s.result);
    });

    this._panelEl.querySelector('#effects-btn-commit')?.addEventListener('click', () => {
      this._commit();
    });
  }

  private _inp(id: string): HTMLInputElement | HTMLSelectElement | null {
    return this._panelEl?.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`) ?? null;
  }

  // ─── Private: Map picking ───────────────────────────────────────────────────

  private _startPick(): void {
    if (!this._view) return;
    this._cancelPick();

    this._pickHandle = this._view.on('click', async (event: any) => {
      const result = await (this._view as any).hitTest(event, { include: [(this._view as any).map.ground] });
      const gp = result?.ground?.mapPoint ?? event.mapPoint;
      const pt = new Point({
        longitude: gp.longitude,
        latitude: gp.latitude,
        z: gp.z ?? 0,
        spatialReference: { wkid: 4326 },
      });
      this._addStrike(pt);
    });
  }

  private _cancelPick(): void {
    if (this._pickHandle) {
      this._pickHandle.remove();
      this._pickHandle = null;
    }
  }

  // ─── Private: Draggable ─────────────────────────────────────────────────────

  private _makeDraggable(): void {
    if (!this._panelEl) return;
    const handle = this._panelEl.querySelector<HTMLElement>('#effects-drag-handle');
    if (!handle) return;

    const pointerDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      this._isDragging = true;
      const rect = this._panelEl!.getBoundingClientRect();
      this._dragOffsetX = e.clientX - rect.left;
      this._dragOffsetY = e.clientY - rect.top;
      handle.setPointerCapture(e.pointerId);
    };

    const pointerMove = (e: PointerEvent) => {
      if (!this._isDragging || !this._panelEl) return;
      let left = e.clientX - this._dragOffsetX;
      let top = e.clientY - this._dragOffsetY;
      const right = left + this._panelEl.offsetWidth;
      const bottom = top + this._panelEl.offsetHeight;

      if (left < 0) left = 0;
      if (top < 0) top = 0;
      if (right > window.innerWidth) left = window.innerWidth - this._panelEl.offsetWidth;
      if (bottom > window.innerHeight) top = window.innerHeight - this._panelEl.offsetHeight;

      this._panelEl.style.left = `${left}px`;
      this._panelEl.style.top = `${top}px`;
      this._panelEl.style.right = 'auto';
    };

    const pointerUp = (e: PointerEvent) => {
      this._isDragging = false;
      handle.releasePointerCapture(e.pointerId);
    };

    handle.addEventListener('pointerdown', pointerDown);
    handle.addEventListener('pointermove', pointerMove);
    handle.addEventListener('pointerup', pointerUp);
    handle.addEventListener('pointercancel', pointerUp);
  }

  // ─── Private: Styles ────────────────────────────────────────────────────────

  // ─── Private: Effects Geometry ──────────────────────────────────────────────

  private _buildRingGraphics(impactPoint: Point, result: any, options: { asDonut?: boolean; showLabels?: boolean } = {}): Graphic[] {
    const { asDonut = true, showLabels = true } = options;
    const rings = result.rings;
    const graphics: Graphic[] = [];

    const buffered = rings.map((ring: any) => ({
      ...ring,
      geometry: geometryEngine.geodesicBuffer(impactPoint, ring.radiusM, 'meters'),
    }));

    buffered.forEach((ring: any, i: number) => {
      if (!ring.geometry) return;
      const c = EFFECTS_COLORS[ring.colorKey] ?? EFFECTS_COLORS.safe;
      const [r, g, b] = c.fill;
      const [or, og, ob, oa] = c.outline;

      const geom = asDonut && buffered[i + 1]?.geometry
        ? geometryEngine.difference(ring.geometry, buffered[i + 1].geometry)
        : ring.geometry;

      if (!geom) return;

      graphics.push(new Graphic({
        geometry: geom as Polygon,
        symbol: {
          type: 'polygon-3d',
          symbolLayers: [{
            type: 'fill',
            material: { color: [r, g, b, ring.opacity] },
            outline:  { color: [or, og, ob, oa], size: 1.6 },
            pattern:  { type: 'style', style: i === 0 ? 'none' : 'diagonal-cross' },
          }],
        } as any,
        attributes: {
          type: `Effects — ${ring.label}`,
          label: `${ring.label}  ${Math.round(ring.radiusM)} m`,
          radiusM: Math.round(ring.radiusM),
          colorKey: ring.colorKey,
        },
      }));

      if (showLabels) {
        const labelPt = destinationPoint(impactPoint.longitude, impactPoint.latitude, 0, ring.radiusM);
        const distStr = ring.radiusM >= 1000 ? (ring.radiusM / 1000).toFixed(2) + ' km' : Math.round(ring.radiusM) + ' m';
        graphics.push(new Graphic({
          geometry: new Point({ longitude: labelPt.longitude, latitude: labelPt.latitude, spatialReference: { wkid: 4326 } }),
          symbol: {
            type: 'text',
            color: `rgb(${c.fill.join(',')})`,
            haloColor: [0, 0, 0, 0.75], haloSize: 1.5,
            text: `${ring.label}  ${distStr}`,
            font: { family: 'Courier New', size: 9.5, weight: 'bold' },
            horizontalAlignment: 'center', verticalAlignment: 'bottom',
          } as any,
          attributes: { type: 'effects_label', label: ring.label },
        }));
      }
    });

    return graphics;
  }

  private _buildImpactMarker(impactPoint: Point, result: any, opacity = 0.95): Graphic[] {
    const [r, g, b] = result.munition.color;
    const a = Math.max(0, Math.min(1, opacity));
    return [
      new Graphic({
        geometry: impactPoint,
        symbol: {
          type: 'point-3d',
          symbolLayers: [{
            type: 'object', resource: { primitive: 'sphere' },
            material: { color: [r, g, b, a] },
            width: 80, height: 80, depth: 80,
          }],
          verticalOffset: { screenLength: 20, maxWorldLength: 400, minWorldLength: 4 },
        } as any,
        attributes: { type: 'Detonation point', label: `${result.munition.label} — detonation` },
      }),
    ];
  }

  private _buildBlastSphereMesh(impactPoint: Point, radiusM: number, color: number[], alpha: number): Graphic {
    const [r, g, b] = color;
    const { longitude, latitude, z = 0 } = impactPoint;

    const STACKS = 20;
    const SLICES = 36;
    const R = radiusM;
    const degPerM = 1 / 111_320;

    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    for (let si = 0; si <= STACKS; si++) {
      const phi = (si / STACKS) * Math.PI;
      for (let sl = 0; sl <= SLICES; sl++) {
        const theta = (sl / SLICES) * 2 * Math.PI;
        const x = R * Math.sin(phi) * Math.cos(theta);
        const y = R * Math.sin(phi) * Math.sin(theta);
        const z_ = R * Math.cos(phi);
        const lon = longitude + x * degPerM / Math.cos(latitude * Math.PI / 180);
        const lat_ = latitude + y * degPerM;
        positions.push(lon, lat_, z + z_);
        normals.push(x / R, y / R, z_ / R);
        uvs.push(sl / SLICES, si / STACKS);
      }
    }

    for (let si = 0; si < STACKS; si++) {
      for (let sl = 0; sl < SLICES; sl++) {
        const a = si * (SLICES + 1) + sl;
        const b = a + SLICES + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }

    return new Graphic({
      geometry: new Mesh({
        vertexAttributes: {
          position: new Float64Array(positions),
          normal: new Float32Array(normals),
          uv: new Float32Array(uvs),
        },
        components: [{
          faces: new Uint32Array(indices),
          material: {
            color: [r, g, b, Math.round(alpha * 255)],
            doubleSided: true,
          } as any,
        }],
        spatialReference: { wkid: 4326 },
      }),
      attributes: { type: 'blast_sphere' },
    });
  }

  private _createBlastWaveAnimation(impactPoint: Point, maxRadiusM: number, color: number[], animLayer: GraphicsLayer, durationMs = 2200, peakAlpha = 0.35): any {
    let rafId: any = null, playing = false;
    let sphereGraphic: Graphic | null = null;

    return {
      start: () => {
        if (playing) this._stopAnimation(rafId, sphereGraphic, animLayer);
        playing = true;
        const startMs = performance.now();

        const frame = (nowMs: number) => {
          const t = Math.min(1, (nowMs - startMs) / durationMs);
          const easedT = 1 - Math.pow(1 - t, 2.5);
          const radius = maxRadiusM * easedT;
          const alpha = peakAlpha * (1 - Math.pow(t, 0.8));

          if (sphereGraphic && animLayer.graphics.includes(sphereGraphic)) {
            animLayer.remove(sphereGraphic);
          }

          if (radius > 0.5 && alpha > 0.005) {
            sphereGraphic = this._buildBlastSphereMesh(impactPoint, radius, color, alpha);
            animLayer.add(sphereGraphic);
          }

          if (t < 1 && playing) {
            rafId = requestAnimationFrame(frame);
          } else {
            playing = false;
            if (sphereGraphic && animLayer.graphics.includes(sphereGraphic)) {
              animLayer.remove(sphereGraphic);
            }
          }
        };

        rafId = requestAnimationFrame(frame);
      },
      stop: () => {
        playing = false;
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        if (sphereGraphic && animLayer.graphics.includes(sphereGraphic)) {
          animLayer.remove(sphereGraphic);
          sphereGraphic = null;
        }
      },
      get playing() { return playing; },
    };
  }

  private _stopAnimation(rafId: any, sphereGraphic: Graphic | null, animLayer: GraphicsLayer) {
    if (rafId) cancelAnimationFrame(rafId);
    if (sphereGraphic && animLayer.graphics.includes(sphereGraphic)) {
      animLayer.remove(sphereGraphic);
    }
  }

  private _buildUnionFootprint(impactPoints: Point[], results: any[]): Graphic | null {
    const lethalGeoms = impactPoints.map((pt, i) => {
      const lethalR = results[i].rings.find((r: any) => r.id === 'lethal_composite')?.radiusM ?? 0;
      return lethalR > 0 ? geometryEngine.geodesicBuffer(pt, lethalR, 'meters') as Polygon : null;
    }).filter(Boolean) as Polygon[];

    if (lethalGeoms.length === 0) return null;
    const merged = lethalGeoms.length === 1 ? lethalGeoms[0] : geometryEngine.union(lethalGeoms) as Polygon;

    return new Graphic({
      geometry: merged,
      symbol: {
        type: 'polygon-3d',
        symbolLayers: [{
          type: 'fill',
          material: { color: [220, 60, 48, 0.25] },
          outline:  { color: [220, 60, 48, 0.90], size: 2.2 },
        }],
      } as any,
      attributes: { type: 'Combined lethal footprint', label: 'Multi-strike lethal union' },
    });
  }
}
