import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polyline from '@arcgis/core/geometry/Polyline';
import Polygon from '@arcgis/core/geometry/Polygon';
import PictureMarkerSymbol from '@arcgis/core/symbols/PictureMarkerSymbol';
import PointSymbol3D from '@arcgis/core/symbols/PointSymbol3D';
import IconSymbol3DLayer from '@arcgis/core/symbols/IconSymbol3DLayer';
import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import Color from '@arcgis/core/Color';
import PolygonSymbol3D from '@arcgis/core/symbols/PolygonSymbol3D';
import FillSymbol3DLayer from '@arcgis/core/symbols/FillSymbol3DLayer';
import ExtrudeSymbol3DLayer from '@arcgis/core/symbols/ExtrudeSymbol3DLayer';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';

// ── Public option types ───────────────────────────────────────────────────────

export interface MagneticCompassOptions {
  enabled?: boolean;
  size?: number;
  opacity?: number;
  northColor?: [number, number, number];
  bezelColor?: [number, number, number];
  declination?: number;
}

// ── Public sector types ───────────────────────────────────────────────────────

export interface SectorConeOptions {
  centerBearingDeg: number;           // 0–359: direction the sector points
  arcWidthDeg: number;                // 1–360 (360 = full circle)
  radiusKm: number;                   // extent in kilometres (> 0)
  color?: [number, number, number];   // RGB, default [255, 165, 0]
  fillOpacity?: number;               // 0–1, default 0.25
  outlineOpacity?: number;            // 0–1, default 0.75
  outlineWidth?: number;              // pixels, default 1.5
  extrudeHeightM?: number;            // metres, 3D only; 0 or omitted = flat
  label?: string;
}

// ── Internal types ────────────────────────────────────────────────────────────

interface SectorConeInstance {
  id: string;
  options: SectorConeOptions;
  graphic: Graphic;
}

interface CompassInstance {
  id: string;
  label: string;
  mapPoint: Point;
  bezelDeg: number;
  faceGfx: Graphic;
  bezelGfx: Graphic;
  needleGfx: Graphic;
  bearingLineGfx: Graphic | null;
  bearingBackGfx: Graphic | null;
  dragState: { startAngle: number; startBezel: number } | null;
  moveState: { startPt: Point } | null;
  sectors: SectorConeInstance[];
}

// ── SVG Design Constants ──────────────────────────────────────────────────────

const VB = 260;
const CX = 130;
const CY = 130;
const RO = 118;
const RM = 77;
const RI = 70;

const LAYER_ID = 'MagneticCompassLayer';

const CARD_SHORT = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const CARD_FULL: Record<string, string> = {
  N:'NORTH', NNE:'NOR·NORTHEAST', NE:'NORTHEAST', ENE:'EAST·NORTHEAST',
  E:'EAST', ESE:'EAST·SOUTHEAST', SE:'SOUTHEAST', SSE:'SOU·SOUTHEAST',
  S:'SOUTH', SSW:'SOU·SOUTHWEST', SW:'SOUTHWEST', WSW:'WEST·SOUTHWEST',
  W:'WEST', WNW:'WEST·NORTHWEST', NW:'NORTHWEST', NNW:'NOR·NORTHWEST',
};

// ── Engine ────────────────────────────────────────────────────────────────────

export class MagneticCompass {
  private _view: MapView | SceneView | null = null;
  private _layer: GraphicsLayer | null = null;
  private _is3D = false;
  private _enabled = false;
  private _placing = false;
  private _activeId: string | null = null;
  private _counter = 0;
  private _instances: CompassInstance[] = [];

  // Sector state
  private _defaultSectorColor: [number, number, number] = [255, 165, 0];
  private _activeSectorId: string | null = null;

  // Options
  private _size = 210;
  private _opacity = 1.0;
  private _northColor: [number, number, number] = [255, 80, 80];
  private _bezelColor: [number, number, number] = [212, 160, 60];
  private _declination = 1.5;

  // Bearing line options
  private _showBearingLine = true;
  private _showBackAzimuth = true;
  private _bearingLineKm = 15;
  private _useMils = false;

  // Intersection markers
  private _intersectionGfxList: Graphic[] = [];

  // View event handles
  private _dragHandle: { remove(): void } | null = null;
  private _pointerMoveHandle: { remove(): void } | null = null;
  private _clickHandle: { remove(): void } | null = null;
  private _watchHandle: { remove(): void } | null = null;

  // Widget
  private _widget: HTMLElement | null = null;
  private _widgetOpen = false;
  private _styleEl: HTMLStyleElement | null = null;

  // Hover feedback
  private _hoveredInstId: string | null = null;
  private _hoverRingEl: HTMLElement | null = null;

  // ── Public API ──────────────────────────────────────────────────────────────

  public start(view: MapView | SceneView): void {
    this._view = view;
    this._is3D = view.type === '3d';
    this._layer = this._getOrCreateLayer();
    if (this._enabled) this._setupViewEvents();
  }

  public enable(): void {
    this._enabled = true;
    if (this._view && !this._dragHandle) this._setupViewEvents();
    this._updateWidgetEnabledState();
  }

  public disable(): void {
    this._enabled = false;
    this._placing = false;
    this._removeViewEvents();
    this._updateWidgetEnabledState();
  }

  public openWidget(): void {
    if (!this._widgetOpen) {
      this._injectStyles();
      this._createWidget();
    }
    if (this._widget) {
      this._widget.style.display = 'block';
      this._widgetOpen = true;
    }
  }

  public closeWidget(): void {
    if (this._widget) {
      this._widget.style.display = 'none';
      this._widgetOpen = false;
    }
  }

  public onViewChanged(view: MapView | SceneView): void {
    this._removeViewEvents();
    this._placing = false;

    this._view = view;
    this._is3D = view.type === '3d';
    this._layer = this._getOrCreateLayer();

    for (const inst of this._instances) {
      const faceURL   = this._toDataURL(this._buildFaceSVG());
      const bezelURL  = this._toDataURL(this._buildBezelSVG(inst.bezelDeg));
      const needleURL = this._toDataURL(this._buildNeedleSVG(this._getNeedleCorrection()));
      inst.faceGfx.symbol   = this._makeSymbol(faceURL) as any;
      inst.bezelGfx.symbol  = this._makeSymbol(bezelURL) as any;
      inst.needleGfx.symbol = this._makeSymbol(needleURL) as any;
      for (const s of inst.sectors) {
        s.graphic.symbol = this._makeSectorSymbol(s.options) as any;
      }
      // Regenerate bearing lines with correct symbol type
      if (inst.bearingLineGfx) inst.bearingLineGfx.symbol = this._makeBearingLineSymbol(false) as any;
      if (inst.bearingBackGfx) inst.bearingBackGfx.symbol = this._makeBearingLineSymbol(true)  as any;
    }

    if (this._enabled) this._setupViewEvents();
  }

  public setOptions(opts: MagneticCompassOptions): void {
    if (opts.enabled   !== undefined) opts.enabled ? this.enable() : this.disable();
    if (opts.size      !== undefined) { this._size = opts.size; this._refreshAll(); }
    if (opts.opacity   !== undefined) { this._opacity = opts.opacity; this._refreshAll(); }
    if (opts.northColor !== undefined) { this._northColor = opts.northColor; this._refreshAll(); }
    if (opts.bezelColor !== undefined) { this._bezelColor = opts.bezelColor; this._refreshAll(); }
    if (opts.declination !== undefined) {
      this._declination = opts.declination;
      this._updateWidget();
    }
  }

  // ── Save / Load ─────────────────────────────────────────────────────────────

  public exportToJSON(): string {
    const data = {
      version: 1,
      settings: {
        size: this._size,
        opacity: this._opacity,
        northColor: this._northColor,
        bezelColor: this._bezelColor,
        declination: this._declination,
        showBearingLine: this._showBearingLine,
        showBackAzimuth: this._showBackAzimuth,
        bearingLineKm: this._bearingLineKm,
        useMils: this._useMils,
      },
      compasses: this._instances.map(inst => ({
        id: inst.id,
        label: inst.label,
        longitude: inst.mapPoint.longitude,
        latitude: inst.mapPoint.latitude,
        bezelDeg: inst.bezelDeg,
        sectors: inst.sectors.map(s => ({ ...s.options })),
      })),
    };
    return JSON.stringify(data, null, 2);
  }

  public saveToFile(): void {
    const json = this.exportToJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'magnetic-compasses.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  public loadFromFile(): void {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const json = e.target?.result as string;
          this.importFromJSON(json);
        } catch {
          console.warn('[MagneticCompass] Failed to parse JSON');
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  public importFromJSON(json: string): void {
    const data = JSON.parse(json);
    if (!data || data.version !== 1) throw new Error('Unsupported format');

    // Restore settings
    const s = data.settings || {};
    if (s.size           !== undefined) this._size           = s.size;
    if (s.opacity        !== undefined) this._opacity        = s.opacity;
    if (s.northColor     !== undefined) this._northColor     = s.northColor;
    if (s.bezelColor     !== undefined) this._bezelColor     = s.bezelColor;
    if (s.declination    !== undefined) this._declination    = s.declination;
    if (s.showBearingLine!== undefined) this._showBearingLine= s.showBearingLine;
    if (s.showBackAzimuth!== undefined) this._showBackAzimuth= s.showBackAzimuth;
    if (s.bearingLineKm  !== undefined) this._bearingLineKm  = s.bearingLineKm;
    if (s.useMils        !== undefined) this._useMils        = s.useMils;

    // Clear existing
    this._clearAllInstances();

    // Restore compasses
    if (!this._view) return;
    for (const c of data.compasses || []) {
      const pt = new Point({ longitude: c.longitude, latitude: c.latitude, spatialReference: { wkid: 4326 } });
      const inst = this._placeCompass(pt, c.label);
      inst.id      = c.id;
      inst.bezelDeg = c.bezelDeg;
      this._refreshBezel(inst);
      for (const sec of c.sectors || []) this.addSector(inst.id, sec);
    }
    this._counter = Math.max(0, ...this._instances.map(i => parseInt(i.id.replace('mc-', '')) || 0));

    // Sync widget controls with loaded settings
    this._syncWidgetToSettings();
    this._updateWidget();
  }

  private _syncWidgetToSettings(): void {
    if (!this._widget) return;
    const q = <T extends HTMLElement>(id: string) => this._widget!.querySelector<T>(`#${id}`);
    const opEl   = q<HTMLInputElement>('mc-opacity');
    const szEl   = q<HTMLInputElement>('mc-size');
    const ncEl   = q<HTMLInputElement>('mc-north-color');
    const bcEl   = q<HTMLInputElement>('mc-bezel-color');
    const declEl = q<HTMLInputElement>('mc-decl-input');
    const blEl   = q<HTMLInputElement>('mc-bl-show');
    const baEl   = q<HTMLInputElement>('mc-bl-back');
    const kmEl   = q<HTMLInputElement>('mc-bl-km');
    const unitsEl = q<HTMLSelectElement>('mc-units');
    if (opEl)    { opEl.value   = String(this._opacity); const d = q<HTMLElement>('mc-opacity-display'); if (d) d.textContent = this._opacity.toFixed(2); }
    if (szEl)    { szEl.value   = String(this._size);    const d = q<HTMLElement>('mc-size-display');    if (d) d.textContent = String(this._size); }
    if (ncEl)    ncEl.value     = this._rgb2hex(this._northColor[0], this._northColor[1], this._northColor[2]);
    if (bcEl)    bcEl.value     = this._rgb2hex(this._bezelColor[0], this._bezelColor[1], this._bezelColor[2]);
    if (declEl)  declEl.value   = String(this._declination);
    if (blEl)    blEl.checked   = this._showBearingLine;
    if (baEl)    baEl.checked   = this._showBackAzimuth;
    if (kmEl)    kmEl.value     = String(this._bearingLineKm);
    if (unitsEl) unitsEl.value  = this._useMils ? 'mils' : 'deg';
  }

  public destroy(): void {
    this._removeViewEvents();
    this._clearAllInstances();
    this._placing = false;
    if (this._widget) {
      this._widget.remove();
      this._widget = null;
    }
    if (this._styleEl) {
      this._styleEl.remove();
      this._styleEl = null;
    }
    if (this._hoverRingEl) {
      this._hoverRingEl.remove();
      this._hoverRingEl = null;
    }
    this._hoveredInstId = null;
    this._widgetOpen = false;
  }

  // ── Sector Cone Public API ──────────────────────────────────────────────────

  public addSector(compassId: string, opts: SectorConeOptions): string | null {
    const inst = this._instances.find(i => i.id === compassId);
    if (!inst || !this._layer) return null;
    if (opts.radiusKm <= 0) return null;

    const clamped: SectorConeOptions = {
      ...opts,
      arcWidthDeg: Math.max(1, Math.min(360, opts.arcWidthDeg)),
    };

    this._counter++;
    const id = `sc_${Date.now()}_${this._counter}`;
    const polygon = this._buildSectorPolygon(inst.mapPoint, clamped);
    const symbol  = this._makeSectorSymbol(clamped);
    const graphic = new Graphic({ geometry: polygon, symbol: symbol as any });

    this._layer.add(graphic);
    inst.sectors.push({ id, options: clamped, graphic });
    this._updateWidget();
    return id;
  }

  public removeSector(compassId: string, sectorId: string): void {
    const inst = this._instances.find(i => i.id === compassId);
    if (!inst) return;
    const idx = inst.sectors.findIndex(s => s.id === sectorId);
    if (idx < 0) return;
    if (this._layer) this._layer.remove(inst.sectors[idx].graphic);
    inst.sectors.splice(idx, 1);
    if (this._activeSectorId === sectorId) this._activeSectorId = null;
    this._updateWidget();
  }

  public updateSector(compassId: string, sectorId: string, opts: Partial<SectorConeOptions>): void {
    const inst = this._instances.find(i => i.id === compassId);
    if (!inst) return;
    const sector = inst.sectors.find(s => s.id === sectorId);
    if (!sector) return;
    sector.options = { ...sector.options, ...opts };
    if (opts.arcWidthDeg !== undefined)
      sector.options.arcWidthDeg = Math.max(1, Math.min(360, sector.options.arcWidthDeg));
    this._refreshSector(inst, sector);
    this._updateWidget();
  }

  public clearSectors(compassId: string): void {
    const inst = this._instances.find(i => i.id === compassId);
    if (!inst) return;
    for (const s of inst.sectors) {
      if (this._layer) this._layer.remove(s.graphic);
    }
    inst.sectors = [];
    this._activeSectorId = null;
    this._updateWidget();
  }

  // ── SVG Generation ──────────────────────────────────────────────────────────

  private _buildFaceSVG(): string {
    const nc = this._northColor;
    const nHex = this._rgb2hex(nc[0], nc[1], nc[2]);
    const nHexDim = this._rgb2hex(Math.round(nc[0]*0.55), Math.round(nc[1]*0.55), Math.round(nc[2]*0.55));
    const bc = this._bezelColor;
    const bcHex = this._rgb2hex(bc[0], bc[1], bc[2]);

    /* 8-point star polygon */
    let star = '';
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8;
      const r = i % 2 === 0 ? 50 : 16;
      star += `${(CX + r * Math.sin(a)).toFixed(2)},${(CY - r * Math.cos(a)).toFixed(2)} `;
    }

    /* Cardinal petal diamonds */
    const petalDefs: [number, string, number][] = [
      [0,   nHex,    0.30],
      [90,  bcHex,   0.16],
      [180, nHexDim, 0.14],
      [270, bcHex,   0.16],
    ];
    const petals = petalDefs.map(([deg, col, op]) => {
      const a   = deg  * Math.PI / 180;
      const la  = (deg + 90) * Math.PI / 180;
      const tipX = (CX + (RI - 3) * Math.sin(a)).toFixed(1);
      const tipY = (CY - (RI - 3) * Math.cos(a)).toFixed(1);
      const lx   = (CX + 9 * Math.sin(la)).toFixed(1);
      const ly   = (CY - 9 * Math.cos(la)).toFixed(1);
      const rx   = (CX - 9 * Math.sin(la)).toFixed(1);
      const ry   = (CY + 9 * Math.cos(la)).toFixed(1);
      return `<polygon points="${tipX},${tipY} ${lx},${ly} ${CX},${CY} ${rx},${ry}" fill="${col}" opacity="${op}"/>`;
    }).join('');

    /* Intercardinal diagonal ticks */
    const icTicks = [45, 135, 225, 315].map(deg => {
      const a = deg * Math.PI / 180;
      const r1 = RI - 5, r2 = RI - 22;
      return `<line x1="${(CX + r1*Math.sin(a)).toFixed(1)}" y1="${(CY - r1*Math.cos(a)).toFixed(1)}"
                    x2="${(CX + r2*Math.sin(a)).toFixed(1)}" y2="${(CY - r2*Math.cos(a)).toFixed(1)}"
                    stroke="rgba(212,160,60,0.32)" stroke-width="1.6"/>`;
    }).join('');

    /* Cardinal axis cross lines */
    const axes = [0, 90].map(deg => {
      const a = deg * Math.PI / 180;
      const r = RI - 2;
      return `<line x1="${(CX + r*Math.sin(a)).toFixed(1)}" y1="${(CY - r*Math.cos(a)).toFixed(1)}"
                    x2="${(CX - r*Math.sin(a)).toFixed(1)}" y2="${(CY + r*Math.cos(a)).toFixed(1)}"
                    stroke="rgba(212,160,60,0.14)" stroke-width="0.7"/>`;
    }).join('');

    /* Cardinal letter labels */
    const cardDefs: [string, string, number, string, number, boolean][] = [
      ['N', nHex,    0,   'bold',   15, true ],
      ['S', '#b0ada0', 180, 'normal', 12, false],
      ['E', `rgba(${bc[0]},${bc[1]},${bc[2]},0.85)`, 90,  'normal', 11, false],
      ['W', `rgba(${bc[0]},${bc[1]},${bc[2]},0.85)`, 270, 'normal', 11, false],
    ];
    const cardLabels = cardDefs.map(([lbl, col, deg, fw, fs, glow]) => {
      const a = deg * Math.PI / 180;
      const r = RI - 16;
      return `<text x="${(CX + r*Math.sin(a)).toFixed(1)}" y="${(CY - r*Math.cos(a)).toFixed(1)}"
                text-anchor="middle" dominant-baseline="middle"
                fill="${col}" font-size="${fs}" font-weight="${fw}"
                font-family="Arial,Helvetica,sans-serif" ${glow ? 'filter="url(#glo)"' : ''}>${lbl}</text>`;
    }).join('');

    /* Intercardinal small letters */
    const icLabels = ['NE','SE','SW','NW'].map((lbl, i) => {
      const deg = 45 + i * 90;
      const a   = deg * Math.PI / 180;
      const r   = RI - 26;
      return `<text x="${(CX + r*Math.sin(a)).toFixed(1)}" y="${(CY - r*Math.cos(a)).toFixed(1)}"
                text-anchor="middle" dominant-baseline="middle"
                fill="rgba(180,140,60,0.28)" font-size="7.5" font-family="Arial,Helvetica,sans-serif"
                transform="rotate(${deg},${(CX + r*Math.sin(a)).toFixed(1)},${(CY - r*Math.cos(a)).toFixed(1)})">${lbl}</text>`;
    }).join('');

    /* Move-cursor hint — small cross in center face */
    const moveCross = `
<line x1="${CX-8}" y1="${CY}" x2="${CX+8}" y2="${CY}" stroke="rgba(212,160,60,0.22)" stroke-width="1"/>
<line x1="${CX}" y1="${CY-8}" x2="${CX}" y2="${CY+8}" stroke="rgba(212,160,60,0.22)" stroke-width="1"/>`;

    const op = this._opacity;
    return `<svg viewBox="0 0 ${VB} ${VB}" xmlns="http://www.w3.org/2000/svg" opacity="${op}" shape-rendering="geometricPrecision" text-rendering="geometricPrecision" image-rendering="optimizeQuality">
<defs>
  <radialGradient id="faceGrad" cx="50%" cy="40%" r="65%">
    <stop offset="0%"   stop-color="#201c10" stop-opacity="0.97"/>
    <stop offset="100%" stop-color="#060501" stop-opacity="0.99"/>
  </radialGradient>
  <filter id="dsh" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="5" stdDeviation="18" flood-color="rgba(0,0,0,0.92)"/>
  </filter>
  <filter id="glo" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur stdDeviation="1.8" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>
<circle cx="${CX}" cy="${CY}" r="${RO}" fill="rgba(0,0,0,0.01)" filter="url(#dsh)"/>
<circle cx="${CX}" cy="${CY}" r="${RO+4}"   fill="none" stroke="#1a1606" stroke-width="2.5"/>
<circle cx="${CX}" cy="${CY}" r="${RO+2}"   fill="none" stroke="#7a6018" stroke-width="1.8"/>
<circle cx="${CX}" cy="${CY}" r="${RO}"     fill="none" stroke="#4a3810" stroke-width="0.9"/>
<circle cx="${CX}" cy="${CY}" r="${RM+1}" fill="none" stroke="rgba(212,160,60,0.22)" stroke-width="0.8"/>
<circle cx="${CX}" cy="${CY}" r="${RM}" fill="url(#faceGrad)"/>
<circle cx="${CX}" cy="${CY}" r="${RI}"   fill="none" stroke="rgba(212,160,60,0.2)" stroke-width="0.7"/>
<circle cx="${CX}" cy="${CY}" r="44"      fill="none" stroke="rgba(212,160,60,0.09)" stroke-width="1.2"/>
<circle cx="${CX}" cy="${CY}" r="26"      fill="none" stroke="rgba(212,160,60,0.09)" stroke-width="1.2"/>
${axes}
<polygon points="${star}" fill="none" stroke="rgba(212,160,60,0.15)" stroke-width="0.6"/>
${petals}
${icTicks}
${cardLabels}
${icLabels}
${moveCross}
<line x1="${CX}" y1="${CY - RO - 7}" x2="${CX}" y2="${CY - RM + 4}"
      stroke="rgba(255,255,255,0.5)" stroke-width="2" stroke-linecap="round"/>
<polygon points="${CX},${CY-RO-3} ${CX-5.5},${CY-RO+11} ${CX+5.5},${CY-RO+11}"
         fill="rgba(255,255,255,0.65)"/>
</svg>`;
  }

  private _buildBezelSVG(rotDeg: number, hovered = false): string {
    const bc = this._bezelColor;
    const bcHex = this._rgb2hex(bc[0], bc[1], bc[2]);
    const bcDim = this._rgb2hex(Math.round(bc[0]*0.55), Math.round(bc[1]*0.55), Math.round(bc[2]*0.55));
    const bcDark = this._rgb2hex(Math.round(bc[0]*0.3), Math.round(bc[1]*0.3), Math.round(bc[2]*0.3));
    const bcFaint = this._rgb2hex(Math.round(bc[0]*0.13), Math.round(bc[1]*0.13), Math.round(bc[2]*0.13));

    const cardLabelCol = hovered ? '#ffed80' : '#f0d060';
    const pipOpacity   = hovered ? '0.95'    : '0.75';

    let ticks = '';
    for (let deg = 0; deg < 360; deg += 2) {
      const rad     = deg * Math.PI / 180;
      const isCard  = deg % 90 === 0;
      const isThird = deg % 30 === 0;
      const isTenth = deg % 10 === 0;
      const r1 = RO - 1.5;
      const r2 = isCard  ? RO - 23
               : isThird ? RO - 15
               : isTenth ? RO - 9
               :            RO - 5;
      const sw  = isCard ? 2 : isThird ? 1.2 : isTenth ? 0.65 : 0.3;
      const col = isCard ? bcHex : isThird ? bcDim : isTenth ? bcDark : bcFaint;
      const x1 = (CX + r1*Math.sin(rad)).toFixed(2);
      const y1 = (CY - r1*Math.cos(rad)).toFixed(2);
      const x2 = (CX + r2*Math.sin(rad)).toFixed(2);
      const y2 = (CY - r2*Math.cos(rad)).toFixed(2);
      ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${sw}"/>`;
    }

    let labels = '';
    for (let deg = 0; deg < 360; deg += 10) {
      const isCard  = deg % 90 === 0;
      const isThird = deg % 30 === 0;
      const rad     = deg * Math.PI / 180;
      const nr      = RO - 36;
      const lx      = (CX + nr * Math.sin(rad)).toFixed(2);
      const ly      = (CY - nr * Math.cos(rad)).toFixed(2);
      const col     = isCard ? cardLabelCol : isThird ? bcHex : bcDark;
      const fs      = isCard ? 18 : isThird ? (this._useMils ? 10 : 12) : 9;
      const fw      = isCard || isThird ? 'bold' : 'normal';
      let lbl: string;
      if (isCard) {
        lbl = ['N','E','S','W'][deg / 90];
      } else if (this._useMils) {
        lbl = String(Math.round(deg * 6400 / 360)).padStart(4, '0');
      } else {
        lbl = String(deg);
      }
      labels += `<text x="${lx}" y="${ly}"
        text-anchor="middle" dominant-baseline="middle"
        fill="${col}" font-size="${fs}" font-weight="${fw}" font-family="Arial,Helvetica,sans-serif"
        transform="rotate(${deg},${lx},${ly})">${lbl}</text>`;
    }

    const pips = [0, 90, 180, 270].map(deg => {
      const a = deg * Math.PI / 180;
      const r = RO - 2;
      return `<circle cx="${(CX + r*Math.sin(a)).toFixed(1)}" cy="${(CY - r*Math.cos(a)).toFixed(1)}"
                      r="2.5" fill="${bcHex}" opacity="${pipOpacity}"/>`;
    }).join('');

    const idx = `<polygon points="${CX},${CY-RO+1} ${CX-5.5},${CY-RO+14} ${CX+5.5},${CY-RO+14}"
                           fill="#cc2a18" opacity="0.92"/>`;

    const rimHighlight = hovered
      ? `<circle cx="${CX}" cy="${CY}" r="115" fill="none" stroke="rgba(255,220,80,0.4)" stroke-width="3"/>`
      : '';

    const op = this._opacity;
    return `<svg viewBox="0 0 ${VB} ${VB}" xmlns="http://www.w3.org/2000/svg" opacity="${op}" shape-rendering="geometricPrecision" text-rendering="geometricPrecision" image-rendering="optimizeQuality">
<defs>
  <radialGradient id="bezelGrad" cx="50%" cy="28%" r="76%">
    <stop offset="0%"   stop-color="${hovered ? '#4a380e' : '#3a2c0a'}"/>
    <stop offset="100%" stop-color="#0e0b02"/>
  </radialGradient>
  <mask id="donut">
    <circle cx="${CX}" cy="${CY}" r="${RO}"   fill="white"/>
    <circle cx="${CX}" cy="${CY}" r="${RM-1}" fill="black"/>
  </mask>
</defs>
<g transform="rotate(${rotDeg},${CX},${CY})">
  <circle cx="${CX}" cy="${CY}" r="${RO}" fill="url(#bezelGrad)" mask="url(#donut)"/>
  <g mask="url(#donut)">${ticks}</g>
  ${labels}
  ${pips}
  ${idx}
  ${rimHighlight}
</g>
</svg>`;
  }

  private _buildNeedleSVG(rotDeg: number): string {
    const nc = this._northColor;
    const ncHex = this._rgb2hex(nc[0], nc[1], nc[2]);
    const ncDark = this._rgb2hex(Math.round(nc[0]*0.35), Math.round(nc[1]*0.1), Math.round(nc[2]*0.1));

    const pathN = `M${CX},${CY-60} L${CX-8},${CY+2} L${CX},${CY-4} L${CX+8},${CY+2} Z`;
    const pathS = `M${CX},${CY+60} L${CX-8},${CY+2} L${CX},${CY+8} L${CX+8},${CY+2} Z`;

    const op = this._opacity;
    return `<svg viewBox="0 0 ${VB} ${VB}" xmlns="http://www.w3.org/2000/svg" opacity="${op}" shape-rendering="geometricPrecision" text-rendering="geometricPrecision" image-rendering="optimizeQuality">
<defs>
  <radialGradient id="nRed" cx="33%" cy="18%" r="82%">
    <stop offset="0%"   stop-color="${ncHex}"/>
    <stop offset="100%" stop-color="${ncDark}"/>
  </radialGradient>
  <radialGradient id="nWht" cx="33%" cy="18%" r="82%">
    <stop offset="0%"   stop-color="#f0ece0"/>
    <stop offset="100%" stop-color="#787060"/>
  </radialGradient>
  <filter id="ndsh" x="-30%" y="-30%" width="160%" height="160%">
    <feDropShadow dx="1.5" dy="2.5" stdDeviation="3" flood-color="rgba(0,0,0,0.72)"/>
  </filter>
</defs>
<g transform="rotate(${rotDeg},${CX},${CY})" filter="url(#ndsh)">
  <path d="${pathN}" fill="url(#nRed)"/>
  <path d="${pathN}" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="1.2"/>
  <path d="${pathS}" fill="url(#nWht)"/>
  <path d="${pathS}" fill="none" stroke="rgba(0,0,0,0.25)" stroke-width="1.2"/>
</g>
<circle cx="${CX}" cy="${CY}" r="10"  fill="#10100a" stroke="#d4a03c" stroke-width="2"/>
<circle cx="${CX}" cy="${CY}" r="5.5" fill="#d4a03c"/>
<circle cx="${CX}" cy="${CY}" r="2.4" fill="#fff8e0"/>
</svg>`;
  }

  // ── Symbol factory ──────────────────────────────────────────────────────────

  private _makeSymbol(url: string): PictureMarkerSymbol | PointSymbol3D {
    if (this._is3D) {
      return new PointSymbol3D({
        symbolLayers: [new IconSymbol3DLayer({
          resource: { href: url },
          size: this._size,
          anchor: 'center',
        })],
      });
    }
    return new PictureMarkerSymbol({ url, width: this._size, height: this._size });
  }

  // ── Bearing line ────────────────────────────────────────────────────────────

  private _makeBearingLineSymbol(dashed: boolean): SimpleLineSymbol {
    const bc = this._bezelColor;
    return new SimpleLineSymbol({
      color: new Color([bc[0], bc[1], bc[2], dashed ? 0.45 : 0.85]),
      width: dashed ? 1.5 : 2.5,
      style: dashed ? 'dash' : 'solid',
    });
  }

  private _buildBearingLinePolyline(inst: CompassInstance): Polyline {
    const norm = (a: number) => ((a % 360) + 360) % 360;
    const lon = inst.mapPoint.longitude ?? 0;
    const lat = inst.mapPoint.latitude  ?? 0;
    const end = this._geodesicDestination(lon, lat, norm(inst.bezelDeg), this._bearingLineKm * 1000);
    return new Polyline({ paths: [[[lon, lat], [end.lon, end.lat]]], spatialReference: { wkid: 4326 } });
  }

  private _buildBackAzimuthPolyline(inst: CompassInstance): Polyline {
    const norm = (a: number) => ((a % 360) + 360) % 360;
    const lon = inst.mapPoint.longitude ?? 0;
    const lat = inst.mapPoint.latitude  ?? 0;
    const back = norm(inst.bezelDeg + 180);
    const end  = this._geodesicDestination(lon, lat, back, this._bearingLineKm * 1000);
    return new Polyline({ paths: [[[lon, lat], [end.lon, end.lat]]], spatialReference: { wkid: 4326 } });
  }

  private _refreshBearingLine(inst: CompassInstance): void {
    if (!this._layer) return;

    if (this._showBearingLine) {
      if (!inst.bearingLineGfx) {
        inst.bearingLineGfx = new Graphic({
          geometry: this._buildBearingLinePolyline(inst),
          symbol: this._makeBearingLineSymbol(false) as any,
        });
        this._layer.add(inst.bearingLineGfx);
      } else {
        inst.bearingLineGfx.geometry = this._buildBearingLinePolyline(inst);
        inst.bearingLineGfx.symbol   = this._makeBearingLineSymbol(false) as any;
      }
    } else if (inst.bearingLineGfx) {
      this._layer.remove(inst.bearingLineGfx);
      inst.bearingLineGfx = null;
    }

    if (this._showBackAzimuth) {
      if (!inst.bearingBackGfx) {
        inst.bearingBackGfx = new Graphic({
          geometry: this._buildBackAzimuthPolyline(inst),
          symbol: this._makeBearingLineSymbol(true) as any,
        });
        this._layer.add(inst.bearingBackGfx);
      } else {
        inst.bearingBackGfx.geometry = this._buildBackAzimuthPolyline(inst);
        inst.bearingBackGfx.symbol   = this._makeBearingLineSymbol(true) as any;
      }
    } else if (inst.bearingBackGfx) {
      this._layer.remove(inst.bearingBackGfx);
      inst.bearingBackGfx = null;
    }

    this._updateIntersections();
  }

  // ── Intersection detection ──────────────────────────────────────────────────

  private _geodesicIntersection(
    p1: Point, bearing1Deg: number,
    p2: Point, bearing2Deg: number,
  ): { lon: number; lat: number; dist1Km: number; dist2Km: number } | null {
    const R   = 111111; // metres per degree
    const rad = (d: number) => d * Math.PI / 180;
    const midLat  = ((p1.latitude ?? 0) + (p2.latitude ?? 0)) / 2;
    const cosLat  = Math.cos(rad(midLat));

    const x1 = (p1.longitude ?? 0) * R * cosLat,  y1 = (p1.latitude ?? 0) * R;
    const x2 = (p2.longitude ?? 0) * R * cosLat,  y2 = (p2.latitude ?? 0) * R;

    const b1r = rad(bearing1Deg), b2r = rad(bearing2Deg);
    const dx1 = Math.sin(b1r), dy1 = Math.cos(b1r);
    const dx2 = Math.sin(b2r), dy2 = Math.cos(b2r);

    // det of the 2×2 system
    const det = dx1 * (-dy2) - (-dx2) * dy1;
    if (Math.abs(det) < 1e-8) return null; // parallel

    const dX = x2 - x1, dY = y2 - y1;
    const t  = (dX * (-dy2) - dY * (-dx2)) / det; // metres along ray 1
    const s  = (dx1 * dY - dy1 * dX) / det;       // metres along ray 2

    if (t < 0 || s < 0) return null; // intersection is behind a ray

    return {
      lon:      (x1 + t * dx1) / (R * cosLat),
      lat:      (y1 + t * dy1) / R,
      dist1Km:  t / 1000,
      dist2Km:  s / 1000,
    };
  }

  private _buildIntersectionSVG(): string {
    const bc = this._bezelColor;
    const col = `rgba(${bc[0]},${bc[1]},${bc[2]},0.9)`;
    const fill = `rgba(${bc[0]},${bc[1]},${bc[2]},0.2)`;
    return `<svg viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision" text-rendering="geometricPrecision" image-rendering="optimizeQuality">
  <circle cx="14" cy="14" r="9" fill="${fill}" stroke="${col}" stroke-width="2"/>
  <line x1="14" y1="5"  x2="14" y2="23" stroke="${col}" stroke-width="1.5"/>
  <line x1="5"  y1="14" x2="23" y2="14" stroke="${col}" stroke-width="1.5"/>
</svg>`;
  }

  private _updateIntersections(): void {
    if (!this._layer) return;

    for (const g of this._intersectionGfxList) this._layer.remove(g);
    this._intersectionGfxList = [];

    if (!this._showBearingLine || this._instances.length < 2) {
      this._updateWidget();
      return;
    }

    const norm = (a: number) => ((a % 360) + 360) % 360;

    for (let i = 0; i < this._instances.length; i++) {
      for (let j = i + 1; j < this._instances.length; j++) {
        const a  = this._instances[i];
        const b  = this._instances[j];
        const ix = this._geodesicIntersection(
          a.mapPoint, norm(a.bezelDeg),
          b.mapPoint, norm(b.bezelDeg),
        );
        if (!ix) continue;

        const pt  = new Point({ longitude: ix.lon, latitude: ix.lat, spatialReference: { wkid: 4326 } });
        const sym = new PictureMarkerSymbol({
          url: this._toDataURL(this._buildIntersectionSVG()),
          width: 22, height: 22,
        });
        const gfx = new Graphic({
          geometry: pt,
          symbol:   sym as any,
          attributes: {
            compassA: a.id, compassB: b.id,
            dist1Km: ix.dist1Km, dist2Km: ix.dist2Km,
          },
        });
        this._layer.add(gfx);
        this._intersectionGfxList.push(gfx);
      }
    }

    this._updateWidget();
  }

  // ── Sector geometry & symbols ───────────────────────────────────────────────

  private _geodesicDestination(lon: number, lat: number, bearingDeg: number, distM: number): { lon: number; lat: number } {
    const R = 6_371_008.8;
    const δ = distM / R;
    const θ = (bearingDeg * Math.PI) / 180;
    const φ1 = (lat * Math.PI) / 180;
    const λ1 = (lon * Math.PI) / 180;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
    return { lon: λ2 * 180 / Math.PI, lat: φ2 * 180 / Math.PI };
  }

  private _buildSectorPolygon(origin: Point, opts: SectorConeOptions): Polygon {
    const lon = origin.longitude ?? 0;
    const lat = origin.latitude  ?? 0;
    const distM = opts.radiusKm * 1000;

    if (opts.arcWidthDeg >= 360) {
      const N = 72;
      const ring: number[][] = [];
      for (let i = 0; i <= N; i++) {
        const b = (i / N) * 360;
        const pt = this._geodesicDestination(lon, lat, b, distM);
        ring.push([pt.lon, pt.lat]);
      }
      ring[N] = ring[0];
      return new Polygon({ rings: [ring], spatialReference: { wkid: 4326 } });
    }

    const N = Math.max(3, Math.ceil(opts.arcWidthDeg));
    const halfArc = opts.arcWidthDeg / 2;
    const ring: number[][] = [[lon, lat]];
    for (let i = 0; i <= N; i++) {
      const b = (opts.centerBearingDeg - halfArc) + (i / N) * opts.arcWidthDeg;
      const pt = this._geodesicDestination(lon, lat, b, distM);
      ring.push([pt.lon, pt.lat]);
    }
    ring.push([lon, lat]);
    return new Polygon({ rings: [ring], spatialReference: { wkid: 4326 } });
  }

  private _makeSectorSymbol(opts: SectorConeOptions): SimpleFillSymbol | PolygonSymbol3D {
    const [r, g, b] = opts.color ?? this._defaultSectorColor;
    const fillOp    = opts.fillOpacity    ?? 0.25;
    const outlineOp = opts.outlineOpacity ?? 0.75;
    const outlineW  = opts.outlineWidth   ?? 1.5;

    if (!this._is3D) {
      return new SimpleFillSymbol({
        color: new Color([r, g, b, fillOp]),
        outline: new SimpleLineSymbol({
          color: new Color([r, g, b, outlineOp]),
          width: outlineW,
        }),
      });
    }

    const extrudeM = opts.extrudeHeightM ?? 0;

    if (extrudeM <= 0) {
      return new PolygonSymbol3D({
        symbolLayers: [new FillSymbol3DLayer({
          material: { color: [r, g, b, Math.max(0.45, fillOp)] },
          outline:  { color: [r, g, b, outlineOp], size: outlineW },
        })],
      });
    }

    return new PolygonSymbol3D({
      symbolLayers: [
        new FillSymbol3DLayer({
          material: { color: [r, g, b, Math.max(0.35, fillOp)] },
          outline:  { color: [r, g, b, outlineOp], size: outlineW },
        }),
        new ExtrudeSymbol3DLayer({
          material: { color: [r, g, b, Math.max(0.55, fillOp)] },
          size: extrudeM,
        }),
      ],
    });
  }

  private _refreshSector(inst: CompassInstance, sector: SectorConeInstance): void {
    sector.graphic.geometry = this._buildSectorPolygon(inst.mapPoint, sector.options);
    sector.graphic.symbol   = this._makeSectorSymbol(sector.options) as any;
  }

  // ── Instance management ─────────────────────────────────────────────────────

  private _placeCompass(pt: Point, labelOverride?: string): CompassInstance {
    if (!this._layer) throw new Error('No layer');

    this._counter++;
    const id    = `mc_${Date.now()}_${this._counter}`;
    const label = labelOverride ?? `Compass ${this._counter}`;

    const faceURL   = this._toDataURL(this._buildFaceSVG());
    const bezelURL  = this._toDataURL(this._buildBezelSVG(0));
    const needleURL = this._toDataURL(this._buildNeedleSVG(this._getNeedleCorrection()));

    const faceGfx   = new Graphic({ geometry: pt, symbol: this._makeSymbol(faceURL) as any });
    const bezelGfx  = new Graphic({ geometry: pt, symbol: this._makeSymbol(bezelURL) as any });
    const needleGfx = new Graphic({ geometry: pt, symbol: this._makeSymbol(needleURL) as any });

    const inst: CompassInstance = {
      id, label, mapPoint: pt, bezelDeg: 0,
      faceGfx, bezelGfx, needleGfx,
      bearingLineGfx: null, bearingBackGfx: null,
      dragState: null, moveState: null,
      sectors: [],
    };
    this._instances.push(inst);

    // Build bearing line graphics below compass in z-order
    const toAdd: Graphic[] = [];

    if (this._showBearingLine) {
      inst.bearingLineGfx = new Graphic({
        geometry: this._buildBearingLinePolyline(inst),
        symbol:   this._makeBearingLineSymbol(false) as any,
      });
      toAdd.push(inst.bearingLineGfx);
    }
    if (this._showBackAzimuth) {
      inst.bearingBackGfx = new Graphic({
        geometry: this._buildBackAzimuthPolyline(inst),
        symbol:   this._makeBearingLineSymbol(true) as any,
      });
      toAdd.push(inst.bearingBackGfx);
    }
    toAdd.push(faceGfx, bezelGfx, needleGfx);
    this._layer.addMany(toAdd);

    this._activeId = id;
    this._placing  = false;
    if (this._view) (this._view.container as HTMLElement).style.cursor = '';

    this._updateWidget();
    return inst;
  }

  private _removeInstance(id: string): void {
    const idx = this._instances.findIndex(i => i.id === id);
    if (idx < 0) return;
    const inst = this._instances[idx];
    if (this._layer) {
      this._layer.remove(inst.faceGfx);
      this._layer.remove(inst.bezelGfx);
      this._layer.remove(inst.needleGfx);
      if (inst.bearingLineGfx) this._layer.remove(inst.bearingLineGfx);
      if (inst.bearingBackGfx) this._layer.remove(inst.bearingBackGfx);
      for (const s of inst.sectors) this._layer.remove(s.graphic);
    }
    this._instances.splice(idx, 1);
    if (this._activeId === id) this._activeId = this._instances.length > 0 ? this._instances[this._instances.length - 1].id : null;
    if (this._hoveredInstId === id) {
      this._hoveredInstId = null;
      this._hideHoverRing();
    }
    this._updateIntersections();
    this._updateWidget();
  }

  private _clearAllInstances(): void {
    if (this._layer) this._layer.removeAll();
    this._instances = [];
    this._activeId = null;
    this._activeSectorId = null;
    this._intersectionGfxList = [];
    this._updateWidget();
  }

  // ── Move compass ────────────────────────────────────────────────────────────

  private _moveCompassTo(inst: CompassInstance, newPt: Point): void {
    inst.mapPoint       = newPt;
    inst.faceGfx.geometry   = newPt;
    inst.bezelGfx.geometry  = newPt;
    inst.needleGfx.geometry = newPt;

    if (inst.bearingLineGfx) inst.bearingLineGfx.geometry = this._buildBearingLinePolyline(inst);
    if (inst.bearingBackGfx) inst.bearingBackGfx.geometry = this._buildBackAzimuthPolyline(inst);

    for (const s of inst.sectors) {
      s.graphic.geometry = this._buildSectorPolygon(newPt, s.options);
    }

    this._updateIntersections();
    this._updateWidget();
  }

  // ── Refresh helpers ─────────────────────────────────────────────────────────

  private _refreshAll(): void {
    const faceURL   = this._toDataURL(this._buildFaceSVG());
    const needleRot = this._getNeedleCorrection();
    for (const inst of this._instances) {
      inst.faceGfx.symbol   = this._makeSymbol(faceURL) as any;
      inst.bezelGfx.symbol  = this._makeSymbol(this._toDataURL(this._buildBezelSVG(inst.bezelDeg))) as any;
      inst.needleGfx.symbol = this._makeSymbol(this._toDataURL(this._buildNeedleSVG(needleRot))) as any;
      if (inst.bearingLineGfx) inst.bearingLineGfx.symbol = this._makeBearingLineSymbol(false) as any;
      if (inst.bearingBackGfx) inst.bearingBackGfx.symbol = this._makeBearingLineSymbol(true)  as any;
      for (const s of inst.sectors) this._refreshSector(inst, s);
    }
  }

  private _refreshBezel(inst: CompassInstance): void {
    inst.bezelGfx.symbol = this._makeSymbol(this._toDataURL(this._buildBezelSVG(inst.bezelDeg))) as any;
    this._refreshBearingLine(inst);
  }

  private _refreshNeedles(): void {
    const rot = this._getNeedleCorrection();
    const url = this._toDataURL(this._buildNeedleSVG(rot));
    for (const inst of this._instances) {
      inst.needleGfx.symbol = this._makeSymbol(url) as any;
    }
  }

  // ── Rotation helpers ────────────────────────────────────────────────────────

  private _getNeedleCorrection(): number {
    if (!this._view) return 0;
    if (this._is3D) return 0;
    return (this._view as MapView).rotation || 0;
  }

  private _getDisplayHeading(): number {
    if (!this._view) return 0;
    if (this._is3D) {
      const sv = this._view as SceneView;
      return sv.camera ? sv.camera.heading : 0;
    }
    return (this._view as MapView).rotation || 0;
  }

  // ── Bearing display with optional Mils ─────────────────────────────────────

  private _displayBearing(deg: number): string {
    const norm = ((deg % 360) + 360) % 360;
    if (this._useMils) {
      const mils = Math.round(norm * (6400 / 360));
      return String(mils).padStart(4, '0') + ' mil';
    }
    return norm.toFixed(1) + '°';
  }

  // ── Interaction helpers ─────────────────────────────────────────────────────

  private _compassScreenPt(inst: CompassInstance): { x: number; y: number } | null {
    if (!this._view) return null;
    try {
      const sp = this._view.toScreen(inst.mapPoint);
      return sp ? { x: (sp as any).x, y: (sp as any).y } : null;
    } catch { return null; }
  }

  private _screenAngleTo(inst: CompassInstance, sx: number, sy: number): number {
    const sp = this._compassScreenPt(inst);
    if (!sp) return 0;
    return Math.atan2(sy - sp.y, sx - sp.x) * 180 / Math.PI;
  }

  private _isOnBezelRing(inst: CompassInstance, sx: number, sy: number): boolean {
    const sp = this._compassScreenPt(inst);
    if (!sp) return false;
    const dist  = Math.hypot(sx - sp.x, sy - sp.y);
    const scale = (this._size / 2) / (VB / 2);
    return dist >= RM * scale && dist <= RO * scale;
  }

  private _isOnCompassFace(inst: CompassInstance, sx: number, sy: number): boolean {
    const sp = this._compassScreenPt(inst);
    if (!sp) return false;
    const dist  = Math.hypot(sx - sp.x, sy - sp.y);
    const scale = (this._size / 2) / (VB / 2);
    return dist < RM * scale;
  }

  private _findHitInstance(sx: number, sy: number): CompassInstance | null {
    for (let i = this._instances.length - 1; i >= 0; i--) {
      if (this._isOnBezelRing(this._instances[i], sx, sy)) return this._instances[i];
    }
    return null;
  }

  private _findAnyHitInstance(sx: number, sy: number): CompassInstance | null {
    for (let i = this._instances.length - 1; i >= 0; i--) {
      const inst = this._instances[i];
      if (this._isOnBezelRing(inst, sx, sy) || this._isOnCompassFace(inst, sx, sy)) return inst;
    }
    return null;
  }

  // ── View event wiring ───────────────────────────────────────────────────────

  private _setupViewEvents(): void {
    if (!this._view) return;
    this._removeViewEvents();

    this._pointerMoveHandle = this._view.on('pointer-move', (evt: __esri.ViewPointerMoveEvent) => {
      if (!this._enabled) return;
      const onBezel = this._findHitInstance(evt.x, evt.y);
      const onFace  = !onBezel ? this._instances.find(i => this._isOnCompassFace(i, evt.x, evt.y)) ?? null : null;
      const hit     = onBezel ?? onFace;

      if (this._placing) {
        (this._view!.container as HTMLElement).style.cursor = 'crosshair';
      } else if (onBezel) {
        (this._view!.container as HTMLElement).style.cursor = 'grab';
      } else if (onFace) {
        (this._view!.container as HTMLElement).style.cursor = 'move';
      } else {
        (this._view!.container as HTMLElement).style.cursor = '';
      }

      if (hit && hit.id !== this._hoveredInstId) {
        if (this._hoveredInstId) {
          const prev = this._instances.find(i => i.id === this._hoveredInstId);
          if (prev) this._setBezelHovered(prev, false);
        }
        this._hoveredInstId = hit.id;
        this._setBezelHovered(hit, true);
        this._showHoverRing(hit, false);
      } else if (!hit && this._hoveredInstId) {
        const prev = this._instances.find(i => i.id === this._hoveredInstId);
        if (prev) this._setBezelHovered(prev, false);
        this._hoveredInstId = null;
        this._hideHoverRing();
      }

      if (hit && this._hoverRingEl?.style.display !== 'none') {
        this._updateHoverRingPos(hit);
      }
    });

    this._dragHandle = this._view.on('drag', (evt: __esri.ViewDragEvent) => {
      if (!this._enabled) return;

      if (evt.action === 'start') {
        const hit = this._findAnyHitInstance(evt.x, evt.y);
        if (hit) {
          evt.stopPropagation();
          this._activeId = hit.id;

          if (this._isOnCompassFace(hit, evt.x, evt.y)) {
            // Move the whole compass
            hit.moveState = { startPt: hit.mapPoint.clone() };
            (this._view!.container as HTMLElement).style.cursor = 'grabbing';
            if (this._hoverRingEl) {
              this._hoverRingEl.classList.remove('mc-pulsing');
              this._hoverRingEl.classList.add('mc-dragging');
            }
          } else {
            // Rotate the bezel
            hit.dragState = {
              startAngle: this._screenAngleTo(hit, evt.x, evt.y),
              startBezel: hit.bezelDeg,
            };
            if (this._hoverRingEl) {
              this._hoverRingEl.classList.remove('mc-pulsing');
              this._hoverRingEl.classList.add('mc-dragging');
            }
          }
        }
      } else if (evt.action === 'update') {
        const rotating = this._instances.find(i => i.dragState !== null);
        const moving   = this._instances.find(i => i.moveState !== null);

        if (rotating) {
          evt.stopPropagation();
          const delta = this._screenAngleTo(rotating, evt.x, evt.y) - rotating.dragState!.startAngle;
          rotating.bezelDeg = rotating.dragState!.startBezel + delta;
          this._refreshBezel(rotating);
          this._updateWidget();
        } else if (moving) {
          evt.stopPropagation();
          if (this._view) {
            const newPt = (this._view as any).toMap({ x: evt.x, y: evt.y });
            if (newPt) {
              this._moveCompassTo(moving, newPt);
              this._updateHoverRingPos(moving);
            }
          }
        }
      } else if (evt.action === 'end') {
        for (const inst of this._instances) {
          inst.dragState = null;
          inst.moveState = null;
        }
        (this._view!.container as HTMLElement).style.cursor = '';
        if (this._hoverRingEl && this._hoveredInstId) {
          this._hoverRingEl.classList.remove('mc-dragging');
          this._hoverRingEl.classList.add('mc-pulsing');
        }
      }
    });

    this._clickHandle = this._view.on('click', (evt: __esri.ViewClickEvent) => {
      if (!this._enabled) return;
      const anyDragging = this._instances.some(i => i.dragState !== null || i.moveState !== null);
      if (anyDragging) return;
      if (this._placing && evt.mapPoint) {
        this._placeCompass(evt.mapPoint);
      }
    });

    this._setupWatchers();
  }

  private _setupWatchers(): void {
    if (!this._view) return;
    if (this._is3D) {
      this._watchHandle = (this._view as SceneView).watch('camera', () => {
        this._updateWidget();
      });
    } else {
      this._watchHandle = (this._view as MapView).watch('rotation', () => {
        this._refreshNeedles();
        this._updateWidget();
      });
    }
  }

  private _removeViewEvents(): void {
    this._dragHandle?.remove();
    this._dragHandle = null;
    this._pointerMoveHandle?.remove();
    this._pointerMoveHandle = null;
    this._clickHandle?.remove();
    this._clickHandle = null;
    this._watchHandle?.remove();
    this._watchHandle = null;

    if (this._hoveredInstId) {
      const prev = this._instances.find(i => i.id === this._hoveredInstId);
      if (prev) this._setBezelHovered(prev, false);
      this._hoveredInstId = null;
    }
    this._hideHoverRing();
  }

  // ── Widget ──────────────────────────────────────────────────────────────────

  private _createWidget(): void {
    if (this._widget) { this._widget.remove(); }

    const el = document.createElement('div');
    el.id = 'mc-widget';
    el.innerHTML = this._widgetHTML();
    document.body.appendChild(el);
    this._widget = el;

    this._bindWidgetEvents();
    this._updateWidget();
  }

  private _widgetHTML(): string {
    return `
<div class="mc-panel" id="mc-panel">
  <div class="mc-header" id="mc-header">
    <span class="mc-title">🧭 Magnetic Compass</span>
    <div class="mc-header-actions">
      <span class="mc-toggle-icon" id="mc-toggle-icon">▼</span>
      <button class="mc-close-btn" id="mc-close-btn" title="Close panel">✕</button>
    </div>
  </div>
  <div class="mc-body" id="mc-body">

    <!-- Info Section -->
    <div class="mc-info-section" id="mc-info-section" style="display:none">
      <div class="mc-info-cardinal" id="mc-info-cardinal">NORTH</div>
      <div class="mc-info-bearing" id="mc-info-bearing">000.0°</div>
      <div class="mc-info-divider"></div>
      <div class="mc-info-row"><span>TRUE BEARING</span><span id="mc-true-bearing">–</span></div>
      <div class="mc-info-row"><span>BACK AZIMUTH</span><span id="mc-back-azimuth">–</span></div>
      <div class="mc-info-row"><span>MAG. DECLINATION</span><span id="mc-decl-display">~1.5° W</span></div>
      <div class="mc-info-row"><span>MAP HEADING</span><span id="mc-map-heading">0.0°</span></div>
      <div class="mc-info-row"><span>COORDINATES</span><span id="mc-coords">–</span></div>
      <div class="mc-info-divider"></div>
    </div>

    <!-- Controls -->
    <div class="mc-section">
      <div class="mc-section-title">CONTROLS</div>
      <div class="mc-btn-row">
        <button class="mc-btn mc-btn-add" id="mc-add-btn" title="Click map to place a compass">＋ Add Compass</button>
        <button class="mc-btn mc-btn-danger" id="mc-clear-all-btn" title="Remove all compasses">Clear All</button>
      </div>
      <div class="mc-btn-row">
        <button class="mc-btn" id="mc-reset-all-btn" title="Reset bearing on all compasses to 0°">Reset All Bearings</button>
      </div>
      <div class="mc-btn-row" style="margin-top:4px">
        <button class="mc-btn" id="mc-save-btn" title="Save all compasses, sectors and settings to a JSON file" style="flex:1">💾 Save</button>
        <button class="mc-btn" id="mc-load-btn" title="Load compasses, sectors and settings from a JSON file"  style="flex:1">📂 Load</button>
      </div>
    </div>

    <!-- Compass List -->
    <div class="mc-section" id="mc-list-section">
      <div class="mc-section-title">PLACED COMPASSES</div>
      <div id="mc-compass-list" class="mc-compass-list">
        <div class="mc-list-empty" id="mc-list-empty">No compasses placed — click "Add Compass"</div>
      </div>
    </div>

    <!-- Sector Cones -->
    <div class="mc-section" id="mc-sector-section" style="display:none">
      <div class="mc-section-title">SECTOR CONES</div>
      <div class="mc-setting-row">
        <label>Center °</label>
        <input type="number" id="mc-sc-bearing" value="0" min="0" max="359" step="1" style="width:52px" title="Center bearing of the sector in degrees"/>
      </div>
      <div class="mc-setting-row">
        <label>Width °</label>
        <input type="number" id="mc-sc-width" value="45" min="1" max="360" step="1" style="width:52px" title="Angular width of the sector in degrees (360 = full circle)"/>
      </div>
      <div class="mc-setting-row">
        <label>Radius km</label>
        <input type="number" id="mc-sc-radius" value="2" min="0.1" max="500" step="0.1" style="width:52px" title="Radius of the sector in kilometres"/>
      </div>
      <div class="mc-setting-row">
        <label>Color</label>
        <input type="color" id="mc-sc-color" value="#ffa500" style="width:44px;height:22px;padding:1px" title="Fill and outline color of the sector"/>
      </div>
      <div class="mc-setting-row" id="mc-sc-extrude-row" style="display:none">
        <label>Height m (3D)</label>
        <input type="number" id="mc-sc-height" value="0" min="0" max="50000" step="100" style="width:52px" title="Extrusion height in metres for 3D view (0 = flat polygon)"/>
      </div>
      <div class="mc-btn-row">
        <button class="mc-btn mc-btn-add" id="mc-sc-add-btn" title="Add a sector cone to the active compass">＋ Add Sector</button>
        <button class="mc-btn mc-btn-danger" id="mc-sc-clear-btn" title="Remove all sectors from the active compass">Clear Sectors</button>
      </div>
      <div id="mc-sector-list" class="mc-compass-list" style="margin-top:5px">
        <div class="mc-list-empty" id="mc-sc-list-empty">No sectors — click "Add Sector"</div>
      </div>
    </div>

    <!-- Bearing Line -->
    <div class="mc-section" id="mc-bearing-section" style="display:none">
      <div class="mc-section-title">BEARING LINE</div>
      <div class="mc-setting-row">
        <label>Show Line</label>
        <input type="checkbox" id="mc-bl-show" checked title="Draw bearing line on the map from compass centre"/>
      </div>
      <div class="mc-setting-row">
        <label>Back Azimuth</label>
        <input type="checkbox" id="mc-bl-back" checked title="Draw the reciprocal (back-azimuth) as a dashed line"/>
      </div>
      <div class="mc-setting-row">
        <label>Length km</label>
        <input type="number" id="mc-bl-km" value="15" min="0.5" max="2000" step="0.5" style="width:52px" title="Length of the bearing line in kilometres"/>
      </div>
    </div>

    <!-- Intersections -->
    <div class="mc-section" id="mc-intersect-section" style="display:none">
      <div class="mc-section-title">INTERSECTIONS</div>
      <div id="mc-intersect-list" class="mc-compass-list"></div>
    </div>

    <!-- Appearance -->
    <div class="mc-section">
      <div class="mc-section-title">APPEARANCE</div>
      <div class="mc-setting-row">
        <label>Opacity</label>
        <input type="range" id="mc-opacity" min="0.1" max="1" step="0.05" value="1" style="width:70px"/>
        <span class="mc-val-display" id="mc-opacity-display">1.00</span>
      </div>
      <div class="mc-setting-row">
        <label>Size px</label>
        <input type="range" id="mc-size" min="80" max="320" step="10" value="210" style="width:70px"/>
        <span class="mc-val-display" id="mc-size-display">210</span>
      </div>
      <div class="mc-setting-row">
        <label>North Color</label>
        <input type="color" id="mc-north-color" value="#ff5050" style="width:44px;height:22px;padding:1px"/>
      </div>
      <div class="mc-setting-row">
        <label>Bezel Color</label>
        <input type="color" id="mc-bezel-color" value="#d4a03c" style="width:44px;height:22px;padding:1px"/>
      </div>
      <div class="mc-setting-row">
        <label>Declination °</label>
        <input type="number" id="mc-decl-input" value="1.5" step="0.1" style="width:55px"/>
      </div>
      <div class="mc-setting-row">
        <label>Units</label>
        <select id="mc-units" style="width:88px">
          <option value="deg">Degrees (°)</option>
          <option value="mils">Mils (NATO)</option>
        </select>
      </div>
    </div>

    <!-- Legend -->
    <div class="mc-section">
      <div class="mc-section-title">LEGEND</div>
      <div class="mc-legend-item"><div class="mc-leg-dot" id="mc-leg-north"></div><span>North (magnetic)</span></div>
      <div class="mc-legend-item"><div class="mc-leg-dot" style="background:#e0dcd0"></div><span>South</span></div>
      <div class="mc-legend-item"><div class="mc-leg-dot" id="mc-leg-bezel"></div><span>Bezel ring — drag to set bearing</span></div>
      <div class="mc-legend-item" style="opacity:0.6"><div class="mc-leg-dot" style="background:rgba(255,255,255,0.4)"></div><span>Centre cross — drag to move</span></div>
      <div class="mc-legend-item" style="opacity:0.5"><div class="mc-leg-dot" style="background:rgba(255,255,255,0.4)"></div><span>Lubber line = current bearing</span></div>
    </div>

  </div>
</div>`;
  }

  private _bindWidgetEvents(): void {
    if (!this._widget) return;

    // Close button
    this._widget.querySelector('#mc-close-btn')?.addEventListener('click', () => this.closeWidget());

    // Header drag-to-move
    const header = this._widget.querySelector('#mc-header') as HTMLElement;
    let dragX = 0, dragY = 0, dragging = false;

    header.addEventListener('mousedown', (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('#mc-close-btn')) return;
      dragging = true;
      const rect = this._widget!.getBoundingClientRect();
      dragX = e.clientX - rect.left;
      dragY = e.clientY - rect.top;
      this._widget!.style.transform = 'none';
      this._widget!.style.left = rect.left + 'px';
      this._widget!.style.top  = rect.top  + 'px';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (!dragging || !this._widget) return;
      this._widget.style.left = (e.clientX - dragX) + 'px';
      this._widget.style.top  = (e.clientY - dragY) + 'px';
    });

    document.addEventListener('mouseup', () => { dragging = false; });

    let movedDuringDown = false;
    header.addEventListener('mousemove', () => { if (dragging) movedDuringDown = true; });
    header.addEventListener('mousedown', () => { movedDuringDown = false; });
    header.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('#mc-close-btn')) return;
      if (movedDuringDown) return;
      const body = this._widget!.querySelector('#mc-body') as HTMLElement;
      const icon = this._widget!.querySelector('#mc-toggle-icon') as HTMLElement;
      const collapsed = body.style.display === 'none';
      body.style.display = collapsed ? 'block' : 'none';
      icon.textContent = collapsed ? '▼' : '◀';
    });

    // Add compass button
    this._widget.querySelector('#mc-add-btn')?.addEventListener('click', () => {
      if (!this._enabled) return;
      this._placing = !this._placing;
      const btn = this._widget!.querySelector('#mc-add-btn') as HTMLElement;
      if (this._placing) {
        btn.textContent = '✕ Cancel Place';
        btn.style.borderColor = 'var(--mc-gold)';
        if (this._view) (this._view.container as HTMLElement).style.cursor = 'crosshair';
      } else {
        btn.textContent = '＋ Add Compass';
        btn.style.borderColor = '';
        if (this._view) (this._view.container as HTMLElement).style.cursor = '';
      }
    });

    // Clear all
    this._widget.querySelector('#mc-clear-all-btn')?.addEventListener('click', () => {
      this._clearAllInstances();
      this._placing = false;
      const btn = this._widget!.querySelector('#mc-add-btn') as HTMLElement;
      btn.textContent = '＋ Add Compass';
      btn.style.borderColor = '';
    });

    // Reset all bearings
    this._widget.querySelector('#mc-reset-all-btn')?.addEventListener('click', () => {
      for (const inst of this._instances) {
        inst.bezelDeg = 0;
        this._refreshBezel(inst);
      }
      this._updateWidget();
    });

    // Opacity
    const opEl = this._widget.querySelector('#mc-opacity') as HTMLInputElement;
    if (opEl) {
      opEl.addEventListener('input', () => {
        const display = this._widget!.querySelector('#mc-opacity-display') as HTMLElement;
        if (display) display.textContent = parseFloat(opEl.value).toFixed(2);
      });
      opEl.addEventListener('change', () => {
        this._opacity = parseFloat(opEl.value);
        this._refreshAll();
        window.dispatchEvent(new CustomEvent('settingsChanged', {
          detail: { path: ['drawingCues', 'magneticCompass', 'opacity'], value: this._opacity },
        }));
      });
    }

    // Size
    const szEl = this._widget.querySelector('#mc-size') as HTMLInputElement;
    if (szEl) {
      szEl.addEventListener('input', () => {
        const display = this._widget!.querySelector('#mc-size-display') as HTMLElement;
        if (display) display.textContent = szEl.value;
      });
      szEl.addEventListener('change', () => {
        this._size = parseInt(szEl.value);
        this._refreshAll();
        window.dispatchEvent(new CustomEvent('settingsChanged', {
          detail: { path: ['drawingCues', 'magneticCompass', 'size'], value: this._size },
        }));
      });
    }

    // North color
    const ncEl = this._widget.querySelector('#mc-north-color') as HTMLInputElement;
    if (ncEl) {
      ncEl.addEventListener('change', () => {
        this._northColor = this._hex2rgb(ncEl.value);
        this._refreshAll();
        const dot = this._widget!.querySelector('#mc-leg-north') as HTMLElement;
        if (dot) dot.style.background = ncEl.value;
        window.dispatchEvent(new CustomEvent('settingsChanged', {
          detail: { path: ['drawingCues', 'magneticCompass', 'northColor'], value: this._northColor },
        }));
      });
    }

    // Bezel color
    const bcEl = this._widget.querySelector('#mc-bezel-color') as HTMLInputElement;
    if (bcEl) {
      bcEl.addEventListener('change', () => {
        this._bezelColor = this._hex2rgb(bcEl.value);
        this._refreshAll();
        const dot = this._widget!.querySelector('#mc-leg-bezel') as HTMLElement;
        if (dot) dot.style.background = bcEl.value;
        window.dispatchEvent(new CustomEvent('settingsChanged', {
          detail: { path: ['drawingCues', 'magneticCompass', 'bezelColor'], value: this._bezelColor },
        }));
      });
    }

    // Declination
    const declEl = this._widget.querySelector('#mc-decl-input') as HTMLInputElement;
    if (declEl) {
      declEl.addEventListener('change', () => {
        this._declination = parseFloat(declEl.value);
        this._updateWidget();
        window.dispatchEvent(new CustomEvent('settingsChanged', {
          detail: { path: ['drawingCues', 'magneticCompass', 'declination'], value: this._declination },
        }));
      });
    }

    // Units (degrees / mils)
    const unitsEl = this._widget.querySelector('#mc-units') as HTMLSelectElement;
    if (unitsEl) {
      unitsEl.addEventListener('change', () => {
        this._useMils = unitsEl.value === 'mils';
        this._refreshAll();   // redraw bezel SVGs with new labels
        this._updateWidget();
      });
    }

    // Bearing line — show
    const blShowEl = this._widget.querySelector('#mc-bl-show') as HTMLInputElement;
    if (blShowEl) {
      blShowEl.addEventListener('change', () => {
        this._showBearingLine = blShowEl.checked;
        for (const inst of this._instances) this._refreshBearingLine(inst);
      });
    }

    // Bearing line — back azimuth
    const blBackEl = this._widget.querySelector('#mc-bl-back') as HTMLInputElement;
    if (blBackEl) {
      blBackEl.addEventListener('change', () => {
        this._showBackAzimuth = blBackEl.checked;
        for (const inst of this._instances) this._refreshBearingLine(inst);
      });
    }

    // Bearing line — length
    const blKmEl = this._widget.querySelector('#mc-bl-km') as HTMLInputElement;
    if (blKmEl) {
      blKmEl.addEventListener('change', () => {
        this._bearingLineKm = Math.max(0.5, parseFloat(blKmEl.value));
        for (const inst of this._instances) this._refreshBearingLine(inst);
      });
    }

    // Save / Load
    this._widget.querySelector('#mc-save-btn')?.addEventListener('click', () => this.saveToFile());
    this._widget.querySelector('#mc-load-btn')?.addEventListener('click', () => this.loadFromFile());

    // Init legend dot colors
    const legN = this._widget.querySelector('#mc-leg-north') as HTMLElement;
    if (legN) legN.style.background = this._rgb2hex(this._northColor[0], this._northColor[1], this._northColor[2]);
    const legB = this._widget.querySelector('#mc-leg-bezel') as HTMLElement;
    if (legB) legB.style.background = this._rgb2hex(this._bezelColor[0], this._bezelColor[1], this._bezelColor[2]);

    // Sector: Add
    this._widget.querySelector('#mc-sc-add-btn')?.addEventListener('click', () => {
      const activeInst = this._activeId ? this._instances.find(i => i.id === this._activeId) : null;
      if (!activeInst) return;
      const bearingEl = this._widget!.querySelector('#mc-sc-bearing') as HTMLInputElement;
      const widthEl   = this._widget!.querySelector('#mc-sc-width')   as HTMLInputElement;
      const radiusEl  = this._widget!.querySelector('#mc-sc-radius')  as HTMLInputElement;
      const colorEl   = this._widget!.querySelector('#mc-sc-color')   as HTMLInputElement;
      const heightEl  = this._widget!.querySelector('#mc-sc-height')  as HTMLInputElement;
      this.addSector(activeInst.id, {
        centerBearingDeg: parseFloat(bearingEl.value),
        arcWidthDeg:      parseFloat(widthEl.value),
        radiusKm:         parseFloat(radiusEl.value),
        color:            this._hex2rgb(colorEl.value),
        extrudeHeightM:   this._is3D ? parseFloat(heightEl.value) : 0,
      });
    });

    // Sector: Clear
    this._widget.querySelector('#mc-sc-clear-btn')?.addEventListener('click', () => {
      const activeInst = this._activeId ? this._instances.find(i => i.id === this._activeId) : null;
      if (activeInst) this.clearSectors(activeInst.id);
    });

    // Pre-fill bearing from bezel when hovering Add Sector
    this._widget.querySelector('#mc-sc-add-btn')?.addEventListener('mouseenter', () => {
      const activeInst = this._activeId ? this._instances.find(i => i.id === this._activeId) : null;
      if (!activeInst) return;
      const bearingEl = this._widget!.querySelector('#mc-sc-bearing') as HTMLInputElement;
      if (bearingEl) {
        const norm = (a: number) => ((a % 360) + 360) % 360;
        bearingEl.value = norm(activeInst.bezelDeg).toFixed(0);
      }
    });
  }

  private _updateWidget(): void {
    if (!this._widget) return;

    const activeInst = this._activeId ? this._instances.find(i => i.id === this._activeId) : null;
    const inst = activeInst || (this._instances.length > 0 ? this._instances[this._instances.length - 1] : null);

    // Info section
    const infoSec = this._widget.querySelector('#mc-info-section') as HTMLElement;
    if (infoSec) infoSec.style.display = inst ? 'block' : 'none';

    if (inst) {
      const norm   = (a: number) => ((a % 360) + 360) % 360;
      const bear   = norm(inst.bezelDeg);
      const cardKey = CARD_SHORT[Math.round(bear / 22.5) % 16];
      const trueB  = norm(bear - this._declination);
      const backB  = norm(bear + 180);
      const heading = this._getDisplayHeading();

      const cardEl  = this._widget.querySelector('#mc-info-cardinal') as HTMLElement;
      const bearEl  = this._widget.querySelector('#mc-info-bearing')  as HTMLElement;
      const trueEl  = this._widget.querySelector('#mc-true-bearing')  as HTMLElement;
      const backEl  = this._widget.querySelector('#mc-back-azimuth')  as HTMLElement;
      const declEl  = this._widget.querySelector('#mc-decl-display')  as HTMLElement;
      const headEl  = this._widget.querySelector('#mc-map-heading')   as HTMLElement;
      const crdEl   = this._widget.querySelector('#mc-coords')        as HTMLElement;

      if (cardEl) cardEl.textContent = CARD_FULL[cardKey] || cardKey;
      if (bearEl) bearEl.textContent = this._displayBearing(bear);
      if (trueEl) trueEl.textContent = this._displayBearing(trueB);
      if (backEl) backEl.textContent = this._displayBearing(backB);
      if (declEl) declEl.textContent = `~${Math.abs(this._declination).toFixed(1)}° ${this._declination >= 0 ? 'E' : 'W'}`;
      if (headEl) headEl.textContent = heading.toFixed(1) + '°';
      if (crdEl)  crdEl.textContent  = `${(inst.mapPoint.latitude ?? 0).toFixed(4)}°, ${(inst.mapPoint.longitude ?? 0).toFixed(4)}°`;
    }

    // Sector cones section — show only when a compass is active
    const sectorSec  = this._widget.querySelector('#mc-sector-section') as HTMLElement;
    const extrudeRow = this._widget.querySelector('#mc-sc-extrude-row') as HTMLElement;
    if (sectorSec)  sectorSec.style.display  = inst ? 'block' : 'none';
    if (extrudeRow) extrudeRow.style.display = this._is3D ? 'flex' : 'none';

    // Bearing line section — show when there's at least one compass
    const blSec = this._widget.querySelector('#mc-bearing-section') as HTMLElement;
    if (blSec) blSec.style.display = inst ? 'block' : 'none';

    // Intersections section
    this._updateIntersectionList();

    // Compass list and sector list
    this._updateCompassList();
    this._updateSectorList();
  }

  private _updateIntersectionList(): void {
    if (!this._widget) return;
    const sec     = this._widget.querySelector('#mc-intersect-section') as HTMLElement;
    const listEl  = this._widget.querySelector('#mc-intersect-list')    as HTMLElement;
    if (!sec || !listEl) return;

    const norm = (a: number) => ((a % 360) + 360) % 360;

    // Rebuild the list from current intersection graphics
    listEl.innerHTML = '';
    const pairs: string[] = [];

    for (let i = 0; i < this._instances.length; i++) {
      for (let j = i + 1; j < this._instances.length; j++) {
        const a  = this._instances[i];
        const b  = this._instances[j];
        const ix = this._geodesicIntersection(
          a.mapPoint, norm(a.bezelDeg),
          b.mapPoint, norm(b.bezelDeg),
        );
        if (!ix) continue;

        const row = document.createElement('div');
        row.className = 'mc-list-item';
        row.style.flexDirection = 'column';
        row.style.alignItems    = 'flex-start';
        row.style.gap           = '2px';
        row.innerHTML = `
          <div style="display:flex;align-items:center;gap:5px;width:100%">
            <div class="mc-leg-dot" style="background:rgba(212,160,60,0.8)"></div>
            <span class="mc-list-label" style="flex:1">${a.label} × ${b.label}</span>
          </div>
          <div class="mc-list-bearing" style="padding-left:13px">
            ${ix.lat.toFixed(4)}°, ${ix.lon.toFixed(4)}°
          </div>
          <div class="mc-list-bearing" style="padding-left:13px;color:rgba(212,160,60,0.4)">
            ${ix.dist1Km.toFixed(2)} km from ${a.label} · ${ix.dist2Km.toFixed(2)} km from ${b.label}
          </div>`;
        listEl.appendChild(row);
        pairs.push(`${a.id}:${b.id}`);
      }
    }

    sec.style.display = pairs.length > 0 ? 'block' : 'none';
  }

  private _updateCompassList(): void {
    if (!this._widget) return;
    const listEl  = this._widget.querySelector('#mc-compass-list') as HTMLElement;
    const emptyEl = this._widget.querySelector('#mc-list-empty')   as HTMLElement;
    if (!listEl) return;

    listEl.querySelectorAll('.mc-list-item').forEach(el => el.remove());

    if (this._instances.length === 0) {
      if (emptyEl) emptyEl.style.display = '';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    for (const inst of this._instances) {
      const norm = (a: number) => ((a % 360) + 360) % 360;
      const bear = norm(inst.bezelDeg);

      const item = document.createElement('div');
      item.className = 'mc-list-item' + (inst.id === this._activeId ? ' mc-list-item-active' : '');
      item.innerHTML = `
        <div class="mc-list-item-info">
          <span class="mc-list-label" title="Double-click to rename">${inst.label}</span>
          <span class="mc-list-bearing">${this._displayBearing(bear)}</span>
        </div>
        <div class="mc-list-actions">
          <button class="mc-btn mc-btn-sm mc-btn-reset" data-id="${inst.id}" title="Reset bearing to 0°">⊕</button>
          <button class="mc-btn mc-btn-sm mc-btn-del"   data-id="${inst.id}" title="Remove compass">✕</button>
        </div>`;

      // Debounced click: wait 230 ms so a dblclick can cancel before DOM is rebuilt
      let singleClickTimer: ReturnType<typeof setTimeout> | null = null;
      item.addEventListener('click', () => {
        if (singleClickTimer) clearTimeout(singleClickTimer);
        singleClickTimer = setTimeout(() => {
          this._activeId = inst.id;
          this._updateWidget();
          singleClickTimer = null;
        }, 230);
      });

      // Editable label on double-click — cancel the pending click rebuild first
      const labelSpan = item.querySelector('.mc-list-label') as HTMLElement;
      labelSpan.addEventListener('dblclick', (e) => {
        if (singleClickTimer) { clearTimeout(singleClickTimer); singleClickTimer = null; }
        e.stopPropagation();
        this._activeId = inst.id;   // make sure this compass is active

        const inp = document.createElement('input');
        inp.value     = inst.label;
        inp.className = 'mc-label-edit';
        labelSpan.replaceWith(inp);
        inp.focus();
        inp.select();

        const commit = () => {
          inst.label = inp.value.trim() || inst.label;
          this._updateWidget();
        };
        inp.addEventListener('blur',    commit);
        inp.addEventListener('keydown', (ke) => {
          if (ke.key === 'Enter')  { commit(); inp.blur(); }
          if (ke.key === 'Escape') { this._updateWidget(); }
          ke.stopPropagation();
        });
      });

      listEl.appendChild(item);
    }

    listEl.querySelectorAll('.mc-btn-reset').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id!;
        const target = this._instances.find(i => i.id === id);
        if (target) { target.bezelDeg = 0; this._refreshBezel(target); this._updateWidget(); }
      });
    });
    listEl.querySelectorAll('.mc-btn-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._removeInstance((btn as HTMLElement).dataset.id!);
      });
    });
  }

  private _updateSectorList(): void {
    if (!this._widget) return;
    const listEl  = this._widget.querySelector('#mc-sector-list')   as HTMLElement;
    const emptyEl = this._widget.querySelector('#mc-sc-list-empty') as HTMLElement;
    if (!listEl) return;

    listEl.querySelectorAll('.mc-list-item').forEach(el => el.remove());

    const activeInst = this._activeId ? this._instances.find(i => i.id === this._activeId) : null;
    if (!activeInst || activeInst.sectors.length === 0) {
      if (emptyEl) emptyEl.style.display = '';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    const norm = (a: number) => ((a % 360) + 360) % 360;
    for (const sector of activeInst.sectors) {
      const o = sector.options;
      const [r, g, b] = o.color ?? this._defaultSectorColor;
      const swatchHex = this._rgb2hex(r, g, b);
      const extrudeTxt = o.extrudeHeightM && o.extrudeHeightM > 0 ? ` ↑${o.extrudeHeightM}m` : '';
      const item = document.createElement('div');
      item.className = 'mc-list-item' + (sector.id === this._activeSectorId ? ' mc-list-item-active' : '');
      item.innerHTML = `
        <div class="mc-list-item-info">
          <div class="mc-leg-dot" style="background:${swatchHex};flex-shrink:0"></div>
          <span class="mc-list-label">${o.label ?? 'Sector'}</span>
          <span class="mc-list-bearing">${norm(o.centerBearingDeg).toFixed(0)}°±${(o.arcWidthDeg/2).toFixed(0)}° ${o.radiusKm}km${extrudeTxt}</span>
        </div>
        <div class="mc-list-actions">
          <button class="mc-btn mc-btn-sm mc-btn-del" data-cid="${activeInst.id}" data-sid="${sector.id}" title="Remove sector">✕</button>
        </div>`;
      item.addEventListener('click', () => {
        this._activeSectorId = sector.id;
        this._updateSectorList();
      });
      listEl.appendChild(item);
    }

    listEl.querySelectorAll('.mc-btn-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cid = (btn as HTMLElement).dataset.cid!;
        const sid = (btn as HTMLElement).dataset.sid!;
        this.removeSector(cid, sid);
      });
    });
  }

  private _updateWidgetEnabledState(): void {
    if (!this._widget) return;
    const addBtn = this._widget.querySelector('#mc-add-btn') as HTMLButtonElement;
    if (addBtn) addBtn.disabled = !this._enabled;
  }

  // ── Style injection ─────────────────────────────────────────────────────────

  private _injectStyles(): void {
    if (document.getElementById('mc-styles')) return;
    const style = document.createElement('style');
    style.id = 'mc-styles';
    style.textContent = `
      :root { --mc-gold: #d4a03c; --mc-gold-dim: rgba(212,160,60,0.35); }

      #mc-widget {
        position: fixed;
        top: 60px;
        left: 12px;
        z-index: 1100;
        width: 248px;
        font-family: var(--ms-font, 'Inter', sans-serif);
        font-size: var(--ms-fs, 12px);
      }

      .mc-panel {
        background: var(--ms-bg);
        border: 1px solid var(--mc-gold-dim);
        border-radius: var(--ms-radius);
        box-shadow: var(--ms-shadow);
        backdrop-filter: blur(10px);
        overflow: hidden;
      }

      .mc-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        background: var(--ms-bg-header);
        border-bottom: 1px solid var(--mc-gold-dim);
        cursor: move;
        user-select: none;
      }

      .mc-header:hover {
        background: linear-gradient(135deg, rgba(212,160,60,0.14) 0%, rgba(160,110,30,0.08) 100%);
      }

      .mc-title {
        font-weight: 700;
        color: var(--mc-gold);
        font-size: var(--ms-fs);
        letter-spacing: 0.3px;
      }

      .mc-header-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .mc-toggle-icon {
        font-size: var(--ms-fs-xs);
        color: rgba(212,160,60,0.6);
        transition: transform 0.2s ease;
      }

      .mc-close-btn {
        background: none;
        border: none;
        color: rgba(212,160,60,0.5);
        font-size: var(--ms-fs);
        cursor: pointer;
        padding: 0 2px;
        line-height: 1;
        transition: color 0.15s;
      }

      .mc-close-btn:hover { color: var(--mc-gold); }

      .mc-body {
        max-height: 72vh;
        overflow-y: auto;
        padding: 8px 0 6px;
      }

      .mc-body::-webkit-scrollbar { width: 4px; }
      .mc-body::-webkit-scrollbar-track { background: transparent; }
      .mc-body::-webkit-scrollbar-thumb { background: var(--mc-gold-dim); border-radius: 2px; }

      .mc-info-section {
        padding: 8px 14px 4px;
        border-bottom: 1px solid var(--ms-divider);
        margin-bottom: 4px;
      }

      .mc-info-cardinal {
        font-size: var(--ms-fs-xs);
        color: #a07828;
        letter-spacing: 4px;
        text-align: center;
        text-transform: uppercase;
        margin-bottom: 2px;
      }

      .mc-info-bearing {
        font-size: 36px;
        font-weight: bold;
        color: var(--mc-gold);
        text-align: center;
        letter-spacing: 3px;
        line-height: 1.1;
        font-variant-numeric: tabular-nums;
      }

      .mc-info-divider {
        height: 1px;
        background: var(--ms-divider);
        margin: 8px 0;
      }

      .mc-info-row {
        display: flex;
        justify-content: space-between;
        font-size: var(--ms-fs-sm);
        color: var(--ms-text-dim);
        margin: 3px 0;
      }

      .mc-info-row span:last-child {
        color: var(--mc-gold);
        font-variant-numeric: tabular-nums;
      }

      .mc-section {
        padding: 6px 12px;
        border-bottom: 1px solid var(--ms-divider);
      }

      .mc-section:last-child { border-bottom: none; }

      .mc-section-title {
        font-size: var(--ms-fs-xs);
        font-weight: 700;
        color: rgba(212,160,60,0.55);
        text-transform: uppercase;
        letter-spacing: 1.2px;
        margin-bottom: 7px;
      }

      .mc-btn-row {
        display: flex;
        gap: 5px;
        margin-bottom: 5px;
      }

      .mc-btn {
        flex: 1;
        padding: 5px 8px;
        background: rgba(212,160,60,0.1);
        border: 1px solid rgba(212,160,60,0.25);
        border-radius: 5px;
        color: rgba(212,160,60,0.85);
        font-size: var(--ms-fs-sm);
        font-family: var(--ms-font);
        cursor: pointer;
        transition: all 0.14s;
        white-space: nowrap;
      }

      .mc-btn:hover {
        background: rgba(212,160,60,0.2);
        color: var(--mc-gold);
        border-color: rgba(212,160,60,0.5);
      }

      .mc-btn:disabled {
        opacity: 0.35;
        cursor: not-allowed;
        pointer-events: none;
      }

      .mc-btn-add {
        background: rgba(212,160,60,0.14);
        border-color: rgba(212,160,60,0.4);
        color: var(--mc-gold);
      }

      .mc-btn-danger {
        background: rgba(180,50,50,0.12);
        border-color: rgba(180,50,50,0.3);
        color: var(--ms-danger);
      }

      .mc-btn-danger:hover {
        background: rgba(180,50,50,0.22);
        border-color: rgba(220,80,80,0.5);
        color: var(--ms-danger);
        filter: brightness(1.2);
      }

      .mc-btn-sm {
        flex: 0 0 auto;
        padding: 3px 7px;
        font-size: var(--ms-fs-sm);
      }

      .mc-compass-list {
        max-height: 130px;
        overflow-y: auto;
      }

      .mc-compass-list::-webkit-scrollbar { width: 3px; }
      .mc-compass-list::-webkit-scrollbar-thumb { background: rgba(212,160,60,0.2); }

      .mc-list-empty {
        font-size: var(--ms-fs-sm);
        color: var(--ms-text-label);
        font-style: italic;
        padding: 4px 2px;
      }

      .mc-list-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 5px 6px;
        border-radius: 5px;
        cursor: pointer;
        margin-bottom: 2px;
        transition: background 0.12s;
        border: 1px solid transparent;
      }

      .mc-list-item:hover { background: var(--ms-bg-input); }

      .mc-list-item-active {
        background: rgba(212,160,60,0.1);
        border-color: rgba(212,160,60,0.22);
      }

      .mc-list-item-info {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }

      .mc-list-label {
        color: var(--mc-gold);
        font-size: var(--ms-fs-sm);
        white-space: nowrap;
        cursor: text;
      }

      .mc-label-edit {
        background: var(--ms-bg-input);
        border: 1px solid var(--mc-gold);
        border-radius: 3px;
        color: var(--mc-gold);
        font-size: var(--ms-fs-sm);
        padding: 1px 4px;
        width: 90px;
        font-family: var(--ms-font);
        outline: none;
      }

      .mc-list-bearing {
        font-size: var(--ms-fs-sm);
        color: var(--ms-text-dim);
        font-variant-numeric: tabular-nums;
      }

      .mc-list-actions {
        display: flex;
        gap: 3px;
        flex-shrink: 0;
      }

      .mc-btn-reset { color: rgba(212,160,60,0.65); }
      .mc-btn-del   { color: var(--ms-danger); border-color: rgba(180,50,50,0.2); background: rgba(180,50,50,0.07); }

      .mc-setting-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
      }

      .mc-setting-row label {
        flex: 1;
        color: var(--ms-text-dim);
        font-size: var(--ms-fs-sm);
      }

      .mc-setting-row input[type='number'],
      .mc-setting-row select {
        background: var(--ms-bg-input);
        border: 1px solid rgba(212,160,60,0.2);
        border-radius: 4px;
        color: var(--mc-gold);
        font-size: var(--ms-fs-sm);
        padding: 3px 6px;
        font-family: var(--ms-font);
      }

      .mc-setting-row input[type='number']:focus,
      .mc-setting-row select:focus {
        outline: none;
        border-color: var(--mc-gold);
      }

      .mc-setting-row select option { background: var(--ms-bg); }

      .mc-setting-row input[type='range'] {
        accent-color: var(--mc-gold);
      }

      .mc-val-display {
        font-size: var(--ms-fs-xs);
        color: var(--ms-text-dim);
        min-width: 28px;
        text-align: right;
        margin-left: 5px;
      }

      .mc-legend-item {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: var(--ms-fs-sm);
        color: var(--ms-text-dim);
        margin-bottom: 4px;
      }

      .mc-leg-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      @keyframes mc-ring-pulse {
        0%   { transform: translate(-50%,-50%) scale(1);    opacity: 0.8; }
        65%  { transform: translate(-50%,-50%) scale(1.22); opacity: 0.35; }
        100% { transform: translate(-50%,-50%) scale(1.35); opacity: 0; }
      }

      #mc-hover-ring {
        position: fixed;
        border-radius: 50%;
        pointer-events: none;
        z-index: 1099;
        display: none;
        box-sizing: border-box;
        transform-origin: 50% 50%;
      }

      #mc-hover-ring.mc-pulsing {
        animation: mc-ring-pulse 1.3s ease-out infinite;
        border: 2px solid rgba(212,160,60,0.75);
        box-shadow: 0 0 14px rgba(212,160,60,0.45), inset 0 0 8px rgba(212,160,60,0.15);
      }

      #mc-hover-ring.mc-dragging {
        animation: none;
        border: 2.5px solid rgba(212,160,60,0.55);
        box-shadow: 0 0 20px rgba(212,160,60,0.5), inset 0 0 14px rgba(212,160,60,0.2);
        transform: translate(-50%, -50%);
      }
    `;
    document.head.appendChild(style);
    this._styleEl = style;
  }

  // ── Hover feedback helpers ──────────────────────────────────────────────────

  private _setBezelHovered(inst: CompassInstance, hovered: boolean): void {
    inst.bezelGfx.symbol = this._makeSymbol(
      this._toDataURL(this._buildBezelSVG(inst.bezelDeg, hovered))
    ) as any;
  }

  private _createHoverRingEl(): HTMLElement {
    const el = document.createElement('div');
    el.id = 'mc-hover-ring';
    document.body.appendChild(el);
    return el;
  }

  private _showHoverRing(inst: CompassInstance, dragging: boolean): void {
    if (!this._hoverRingEl) this._hoverRingEl = this._createHoverRingEl();
    const el = this._hoverRingEl;
    el.className = dragging ? 'mc-dragging' : 'mc-pulsing';
    el.style.width  = this._size + 'px';
    el.style.height = this._size + 'px';
    el.style.display = 'block';
    this._updateHoverRingPos(inst);
  }

  private _hideHoverRing(): void {
    if (this._hoverRingEl) this._hoverRingEl.style.display = 'none';
  }

  private _updateHoverRingPos(inst: CompassInstance): void {
    if (!this._hoverRingEl) return;
    const sp = this._compassScreenPt(inst);
    if (!sp) return;
    this._hoverRingEl.style.left = sp.x + 'px';
    this._hoverRingEl.style.top  = sp.y + 'px';
  }

  // ── Utilities ───────────────────────────────────────────────────────────────

  private _toDataURL(svg: string): string {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  private _rgb2hex(r: number, g: number, b: number): string {
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  private _hex2rgb(hex: string): [number, number, number] {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
      : [255, 80, 80];
  }

  private _getOrCreateLayer(): GraphicsLayer {
    if (!this._view) throw new Error('[MagneticCompass] start() must be called first');
    let layer = this._view.map.findLayerById(LAYER_ID) as GraphicsLayer | undefined;
    if (!layer) {
      layer = new GraphicsLayer({ id: LAYER_ID, elevationInfo: { mode: 'on-the-ground' } });
      this._view.map.add(layer);
    }
    return layer;
  }
}

export default MagneticCompass;
