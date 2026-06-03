/**
 * EffectEngine.ts
 * Munition Effects Radius analysis engine.
 *
 * Integrated with ContextMenuManager via linkEffectEngine().
 * Right-click any symbol → Analysis → Effects Radius.
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
    this._injectStyles();
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

    // Resume mode: panel was minimised
    if (this._panelEl && this._panelEl.style.display === 'none') {
      this._panelEl.style.display = 'block';
      if (this._legendEl) this._legendEl.style.display = 'flex';
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
    const tntOv  = parseFloat(this._inp('effects-inp-tnt')?.value ?? '0.56') || null;
    const hOv    = parseFloat(this._inp('effects-inp-height')?.value ?? '0') || 0;
    
    const res = computeEffects(munKey, struct, tntOv, hOv);

    this._strikes.push({ point: pt, result: res, munKey, struct, tntOv, hOv });

    const coordsEl = this._panelEl?.querySelector('#effects-coords');
    if (coordsEl) {
      coordsEl.textContent = `Strike ${this._strikes.length}: ${pt.latitude.toFixed(4)}°N  ${pt.longitude.toFixed(4)}°E`;
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

    const munKey = this._inp('effects-inp-munition')?.value ?? 'mortar_81mm';
    const struct = this._inp('effects-inp-structure')?.value ?? 'open_area';
    const tntOv  = parseFloat(this._inp('effects-inp-tnt')?.value ?? '0.56') || null;
    const hOv    = parseFloat(this._inp('effects-inp-height')?.value ?? '0') || 0;

    this._strikes.forEach(s => {
      // Recompute with current panel values
      s.result = computeEffects(munKey, struct, tntOv, hOv);

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

    listEl.innerHTML = '';
    if (this._strikes.length === 0) {
      listEl.innerHTML = '<div style="font-size:9px;color:#888780;padding:0 0 4px">No strikes placed</div>';
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
      awaiting: ['Awaiting strike point', ''],
      ready: ['Ready', 'effects-ready'],
      busy: ['Computing…', 'effects-busy'],
      animating: ['Blast wave ↗', 'effects-animating']
    };
    const [txt, cls] = M[s] ?? M.awaiting;
    statusEl.textContent = txt;
    statusEl.className = 'effects-ph-status' + (cls ? ' ' + cls : '');
  }

  private _flashStatus(msg: string, cls: string): void {
    if (!this._panelEl) return;
    const statusEl = this._panelEl.querySelector('#effects-status');
    if (!statusEl) return;

    const prev = statusEl.textContent;
    const pc = statusEl.className;
    statusEl.textContent = msg;
    statusEl.className = 'effects-ph-status ' + cls;
    setTimeout(() => {
      statusEl.textContent = prev;
      statusEl.className = pc;
    }, 1800);
  }

  // ─── Private: Panels & Legends ────────────────────────────────────────────────

  private _showPanel(): void {
    if (!this._panelEl) {
      this._panelEl = document.createElement('div');
      this._panelEl.id = 'effects-engine-panel';
      this._panelEl.className = 'effects-panel';
      document.body.appendChild(this._panelEl);
    }
    this._panelEl.innerHTML = this._buildPanelHTML();
    this._panelEl.style.display = 'block';
    this._bindPanelEvents();
    this._makeDraggable();
    this._renderStrikeList();
  }

  private _hidePanel(): void {
    if (this._panelEl) this._panelEl.style.display = 'none';
  }

  private _showLegend(): void {
    if (!this._legendEl) {
      this._legendEl = document.createElement('div');
      this._legendEl.id = 'effects-legend';
      this._legendEl.className = 'effects-legend';
      this._legendEl.innerHTML = `
        <div class="effects-leg-row"><div class="effects-leg-dot" style="background:#DC3C30"></div><div class="effects-leg-lbl">Lethal (blast + frag)</div></div>
        <div class="effects-leg-row"><div class="effects-leg-dot" style="background:#EF9F27"></div><div class="effects-leg-lbl">Injury / frag casualty</div></div>
        <div class="effects-leg-row"><div class="effects-leg-dot" style="background:#DC7820"></div><div class="effects-leg-lbl">Thermal / 3° burn</div></div>
        <div class="effects-leg-row"><div class="effects-leg-dot" style="background:#1D9E75"></div><div class="effects-leg-lbl">Safe distance — blast</div></div>
        <div class="effects-leg-row"><div class="effects-leg-dot" style="background:#378ADD"></div><div class="effects-leg-lbl">QD inhabited buildings</div></div>
        <div class="effects-leg-row"><div class="effects-leg-dot" style="background:#B428DC"></div><div class="effects-leg-lbl">Multi-strike union</div></div>
      `;
      document.body.appendChild(this._legendEl);
    }
    this._legendEl.style.display = 'flex';
  }

  private _hideLegend(): void {
    if (this._legendEl) this._legendEl.style.display = 'none';
  }

  private _showHint(text: string): void {
    if (!this._hintEl) {
      this._hintEl = document.createElement('div');
      this._hintEl.id = 'effects-hint';
      this._hintEl.className = 'effects-hint';
      document.body.appendChild(this._hintEl);
    }
    this._hintEl.textContent = text;
    this._hintEl.style.opacity = '1';
  }

  private _hideHint(): void {
    if (this._hintEl) this._hintEl.style.opacity = '0';
  }

  private _buildPanelHTML(): string {
    const munOpts = Object.entries(MUNITION_PRESETS).map(([k, m]: [string, any]) => 
      `<option value="${k}"${k === 'mortar_81mm' ? ' selected' : ''}>${m.label}</option>`
    ).join('');

    const structOpts = Object.entries(STRUCTURE_FACTORS).map(([k, s]: [string, any]) => 
      `<option value="${k}"${k === 'open_area' ? ' selected' : ''}>${s.label}</option>`
    ).join('');

    return `
      <div class="effects-ph" id="effects-drag-handle">
        <div class="effects-ph-title">✕ Effects Radius</div>
        <div class="effects-ph-status" id="effects-status">Awaiting strike point</div>
        <button class="effects-help-btn" id="effects-help-btn" title="How effects radius works">?</button>
        <button class="effects-minimize-btn" id="effects-minimize-btn" title="Minimize">▼</button>
        <button class="effects-close-btn" id="effects-close-btn" title="Close">✕</button>
      </div>
      <div class="effects-help-popover" id="effects-help-popover" hidden>
        <div class="effects-help-head">
          <div>
            <div class="effects-help-kicker">Field Guide</div>
            <div class="effects-help-title">Effects Radius</div>
          </div>
          <button class="effects-help-close" id="effects-help-close" title="Close">✕</button>
        </div>
        <div class="effects-help-body">
          <p>Estimates blast, fragmentation, thermal, and quantity-distance effects from a munition or explosive source, then draws hazard rings around one or more strike points.</p>
          <div class="effects-help-block">
            <h4>How It Works</h4>
            <ol>
              <li>Place a strike or detonation point on the map.</li>
              <li>Pick a munition preset or override its TNT equivalent and burst height.</li>
              <li>Apply a structural environment factor to reduce or preserve blast and fragmentation reach.</li>
              <li>Draw the computed rings, animate the blast wave if desired, and optionally union several strikes into one footprint.</li>
            </ol>
          </div>
          <div class="effects-help-block">
            <h4>Phenomenon</h4>
            <p>The engine combines several hazard models: overpressure for blast injury and safe standoff, fragment decay for casualty distance, thermal scaling for burn effects, and quantity-distance rules for inhabited-building separation. Those results are then converted into map rings.</p>
          </div>
          <div class="effects-help-block">
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
      <div class="effects-body">

      <!-- Munition -->
      <div class="effects-ps">Munition / device</div>
      <div class="effects-pg">
        <div class="effects-pf effects-full">
          <div class="effects-pl">Type</div>
          <select id="effects-inp-munition" class="effects-select">${munOpts}</select>
        </div>
        <div class="effects-pf">
          <div class="effects-pl">TNT equiv. (kg)</div>
          <input id="effects-inp-tnt" class="effects-input" type="number" value="${MUNITION_PRESETS['mortar_81mm'].tntEquivKg}" min="0.01" step="0.1"/>
        </div>
        <div class="effects-pf">
          <div class="effects-pl">Det. height (m)</div>
          <input id="effects-inp-height" class="effects-input" type="number" value="${MUNITION_PRESETS['mortar_81mm'].detonationHeightM}" min="0" max="500" step="1"/>
        </div>
      </div>

      <!-- Environment -->
      <div class="effects-ps">Environment / structure</div>
      <div class="effects-pg">
        <div class="effects-pf effects-full">
          <div class="effects-pl">Structural factor</div>
          <select id="effects-inp-structure" class="effects-select">${structOpts}</select>
        </div>
      </div>

      <div class="effects-pdiv"></div>

      <!-- Display options -->
      <div class="effects-ps">Display options</div>
      <div class="effects-ptr"><label>Donut rings (punch inner)</label><input id="effects-opt-donut" type="checkbox" checked/></div>
      <div class="effects-ptr"><label>Ring labels</label><input id="effects-opt-labels" type="checkbox" checked/></div>
      <div class="effects-ptr"><label>Show blast wave</label><input id="effects-opt-anim" type="checkbox" checked/></div>
      <div class="effects-ptr"><label title="The 3D dome at the detonation point">Show impact dome</label><input id="effects-opt-dome" type="checkbox" checked/></div>
      <div class="effects-ptr"><label>Multi-strike union</label><input id="effects-opt-union" type="checkbox" checked/></div>
      <div class="effects-anim-row">
        <label>Anim speed</label>
        <input id="effects-anim-speed" type="range" min="0.3" max="3" step="0.1" value="1"/>
        <div id="effects-anim-speed-v" class="effects-anim-speed-v">1×</div>
      </div>
      <div class="effects-anim-row">
        <label>Dome opacity</label>
        <input id="effects-dome-opacity" type="range" min="0" max="100" step="5" value="95"/>
        <div id="effects-dome-opacity-v" class="effects-anim-speed-v">95%</div>
      </div>
      <div class="effects-anim-row">
        <label>Blast opacity</label>
        <input id="effects-blast-opacity" type="range" min="0" max="100" step="5" value="35"/>
        <div id="effects-blast-opacity-v" class="effects-anim-speed-v">35%</div>
      </div>

      <div class="effects-pdiv"></div>

      <!-- Physics readout -->
      <div class="effects-ps">Computed radii — Hopkinson-Cranz model</div>
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

      <div class="effects-pdiv"></div>

      <!-- Multi-strike list -->
      <div class="effects-ps">Strikes placed <span style="color:#888780;font-size:9px">(click map to add)</span></div>
      <div id="effects-strike-list"></div>

      <div id="effects-coords" class="effects-coords">Impact: not placed — click map</div>

      <div class="effects-pb-row">
        <button class="effects-pb" id="effects-btn-clear">Clear all</button>
        <button class="effects-pb" id="effects-btn-undo" disabled>Undo last</button>
        <button class="effects-pb effects-blue" id="effects-btn-blast" disabled>▶ Blast wave</button>
      </div>
      <div class="effects-pb-row" style="padding-top:0">
        <button class="effects-pb effects-green" id="effects-btn-commit" disabled>Commit to map ↗</button>
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
      const body = this._panelEl!.querySelector<HTMLElement>('.effects-body');
      const btn  = this._panelEl!.querySelector<HTMLElement>('#effects-minimize-btn');
      if (!body || !btn) return;
      const minimized = body.style.display === 'none';
      body.style.display = minimized ? '' : 'none';
      btn.textContent = minimized ? '▼' : '▶';
    });

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
      const coordsEl = this._panelEl?.querySelector('#effects-coords');
      if (coordsEl) coordsEl.textContent = 'Impact: not placed — click map';
      
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

  private _injectStyles(): void {
    if (document.getElementById('effects-engine-styles')) return;
    const style = document.createElement('style');
    style.id = 'effects-engine-styles';
    style.textContent = `
      .effects-panel {
        position: fixed;
        top: 60px;
        right: 14px;
        width: 304px;
        background: var(--ms-bg);
        border: 1px solid var(--ms-border);
        border-radius: var(--ms-radius);
        color: var(--ms-text);
        font-family: var(--ms-font);
        font-size: var(--ms-fs);
        z-index: 1100;
        max-height: calc(100vh - 28px);
        overflow-y: auto;
        display: none;
        box-shadow: var(--ms-shadow);
      }
      .effects-ph {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 9px 12px 8px;
        border-bottom: 1px solid var(--ms-divider);
        background: var(--ms-bg-header);
        position: sticky;
        top: 0;
        z-index: 2;
        cursor: move;
      }
      .effects-ph-title { font-size: var(--ms-fs-xs); letter-spacing: .13em; text-transform: uppercase; color: var(--ms-danger); font-weight: 700; flex: 1; }
      .effects-ph-status { font-size: var(--ms-fs-xs); letter-spacing: .07em; text-transform: uppercase; color: var(--ms-text-dim); transition: color .2s; }
      .effects-ready { color: var(--ms-success); }
      .effects-busy { color: var(--ms-warning); }
      .effects-animating { color: var(--ms-danger); }
      .effects-help-btn, .effects-minimize-btn, .effects-close-btn {
        background: transparent;
        border: 1px solid transparent;
        color: var(--ms-text-dim);
        font-size: 12px;
        cursor: pointer;
        padding: 0 2px;
        line-height: 1;
      }
      .effects-help-btn {
        width: 17px;
        height: 17px;
        border-color: var(--ms-border);
        border-radius: 50%;
        color: var(--ms-success);
        font-weight: 700;
      }
      .effects-help-btn:hover, .effects-minimize-btn:hover, .effects-close-btn:hover { color: var(--ms-text); }
      .effects-help-popover {
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
      .effects-help-popover[hidden] { display: none; }
      .effects-help-head {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 11px 8px;
        border-bottom: 1px solid var(--ms-divider);
        background: var(--ms-bg-header);
      }
      .effects-help-kicker {
        font-size: var(--ms-fs-xs);
        color: var(--ms-text-label);
        letter-spacing: 0.09em;
        text-transform: uppercase;
      }
      .effects-help-title {
        margin-top: 2px;
        font-size: 13px;
        color: var(--ms-success);
        font-weight: 700;
      }
      .effects-help-close {
        width: 20px;
        height: 20px;
        border: 1px solid var(--ms-border);
        border-radius: 3px;
        background: var(--ms-bg-input);
        color: var(--ms-text-dim);
        cursor: pointer;
      }
      .effects-help-close:hover { color: var(--ms-text); }
      .effects-help-body {
        padding: 10px 11px 12px;
        font-size: var(--ms-fs-xs);
        line-height: 1.45;
        color: var(--ms-text-dim);
        user-select: text;
      }
      .effects-help-body p { margin: 0 0 9px; }
      .effects-help-block { margin-top: 10px; }
      .effects-help-block h4 {
        margin: 0 0 5px;
        font-size: var(--ms-fs-xs);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ms-text);
      }
      .effects-help-block ol, .effects-help-block ul { margin: 0; padding-left: 17px; }
      .effects-help-block li { margin: 3px 0; }
      .effects-help-block dl {
        display: grid;
        grid-template-columns: 72px minmax(0, 1fr);
        gap: 5px 8px;
        margin: 0;
      }
      .effects-help-block dt { color: var(--ms-success); font-weight: 700; }
      .effects-help-block dd { margin: 0; }
      .effects-body { padding-bottom: 4px; }
      .effects-ps { font-size: var(--ms-fs-xs); letter-spacing: .1em; text-transform: uppercase; color: var(--ms-text-label); padding: 9px 12px 5px; }
      .effects-pg { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 10px; padding: 0 12px 9px; }
      .effects-pf { display: flex; flex-direction: column; gap: 3px; }
      .effects-full { grid-column: 1 / -1; }
      .effects-pl { font-size: var(--ms-fs-xs); letter-spacing: .07em; text-transform: uppercase; color: var(--ms-text-label); }
      .effects-input, .effects-select {
        background: var(--ms-bg-input); border: 1px solid var(--ms-border);
        border-radius: 3px; color: var(--ms-text); font-family: var(--ms-font);
        font-size: var(--ms-fs); padding: 5px 7px; width: 100%; outline: none; transition: border-color .15s;
      }
      .effects-input:focus, .effects-select:focus { border-color: var(--ms-danger); }
      .effects-select option { background: var(--ms-bg); }
      .effects-pdiv { height: 1px; background: var(--ms-divider); margin: 4px 0; }
      .effects-ptr { display: flex; align-items: center; justify-content: space-between; padding: 5px 12px; }
      .effects-ptr label { font-size: var(--ms-fs-xs); letter-spacing: .07em; text-transform: uppercase; color: var(--ms-text-label); cursor: pointer; }
      .effects-ptr input[type=checkbox] { accent-color: var(--ms-danger); width: 13px; height: 13px; cursor: pointer; }
      .effects-phys-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 0 12px 10px; }
      .effects-phys-card { background: var(--ms-bg-input); border: 1px solid var(--ms-border); border-radius: 3px; padding: 6px 8px; }
      .effects-phys-label { font-size: var(--ms-fs-xs); letter-spacing: .09em; text-transform: uppercase; margin-bottom: 3px; }
      .effects-phys-value { font-size: 13px; font-weight: 700; letter-spacing: .02em; }
      .effects-phys-unit { font-size: var(--ms-fs-xs); margin-left: 2px; opacity: .6; }
      .effects-lethal .effects-phys-label { color: #DC3C30; } .effects-lethal .effects-phys-value { color: #DC3C30; }
      .effects-warning .effects-phys-label { color: #EF9F27; } .effects-warning .effects-phys-value { color: #EF9F27; }
      .effects-thermal .effects-phys-label { color: #DC7820; } .effects-thermal .effects-phys-value { color: #DC7820; }
      .effects-safe .effects-phys-label { color: #1D9E75; } .effects-safe .effects-phys-value { color: #1D9E75; }
      .effects-qd .effects-phys-label { color: #378ADD; } .effects-qd .effects-phys-value { color: #378ADD; }
      .effects-anim-row { display: flex; align-items: center; gap: 8px; padding: 0 12px 8px; }
      .effects-anim-row label { font-size: var(--ms-fs-xs); letter-spacing: .07em; text-transform: uppercase; color: var(--ms-text-label); flex: 1; }
      #effects-anim-speed { flex: 2; accent-color: var(--ms-danger); }
      .effects-anim-speed-v { font-size: var(--ms-fs-sm); color: var(--ms-danger); min-width: 28px; text-align: right; }
      #effects-strike-list { padding: 0 12px 8px; display: flex; flex-direction: column; gap: 4px; max-height: 110px; overflow-y: auto; }
      .effects-sk-row { display: grid; grid-template-columns: 20px 1fr auto; gap: 6px; align-items: center; }
      .effects-sk-idx { font-size: var(--ms-fs-sm); color: var(--ms-danger); font-weight: 700; text-align: center; }
      .effects-sk-info { font-size: var(--ms-fs-xs); color: var(--ms-text-dim); letter-spacing: .03em; }
      .effects-sk-del { background: transparent; border: none; color: var(--ms-text-dim); font-size: 11px; cursor: pointer; padding: 2px 4px; }
      .effects-sk-del:hover { color: var(--ms-danger); }
      .effects-pb-row { display: flex; gap: 6px; padding: 9px 12px; }
      .effects-pb {
        flex: 1; padding: 7px; font-family: var(--ms-font); font-size: var(--ms-fs-xs); letter-spacing: .06em;
        text-transform: uppercase; cursor: pointer; border-radius: 3px; border: 1px solid var(--ms-danger);
        background: transparent; color: var(--ms-danger); transition: all .14s;
      }
      .effects-pb:hover:not(:disabled) { background: var(--ms-accent-dim); }
      .effects-blue { border-color: var(--ms-accent); color: var(--ms-accent); }
      .effects-blue:hover:not(:disabled) { background: var(--ms-accent-dim); }
      .effects-green { border-color: var(--ms-success); color: var(--ms-success); }
      .effects-green:hover:not(:disabled) { background: var(--ms-accent-dim); }
      .effects-pb:disabled { opacity: .3; cursor: not-allowed; }
      .effects-coords { font-size: var(--ms-fs-xs); color: var(--ms-danger); padding: 2px 12px 7px; letter-spacing: .05em; opacity: .75; }

      .effects-legend {
        position: fixed; bottom: 30px; left: 14px; z-index: 1100;
        background: var(--ms-bg); border: 1px solid var(--ms-border);
        border-radius: var(--ms-radius); padding: 9px 13px; display: none; flex-direction: column; gap: 5px;
        box-shadow: var(--ms-shadow);
      }
      .effects-leg-row { display: flex; align-items: center; gap: 8px; }
      .effects-leg-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
      .effects-leg-lbl { font-size: var(--ms-fs-xs); letter-spacing: .06em; text-transform: uppercase; color: var(--ms-text-dim); }

      .effects-hint {
        position: fixed; bottom: 55px; left: 50%; transform: translateX(-50%);
        background: var(--ms-bg); border: 1px solid var(--ms-danger);
        color: var(--ms-danger); font-family: var(--ms-font); font-size: var(--ms-fs);
        letter-spacing: .08em; padding: 8px 22px; border-radius: var(--ms-radius);
        pointer-events: none; z-index: 1100; text-transform: uppercase; transition: opacity .3s;
        opacity: 0;
      }
    `;
    document.head.appendChild(style);
  }

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
