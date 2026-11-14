/**
 * PlatoonGuide.ts
 *
 * The Platoon Guide: what a section, platoon or company commander needs at a point, read from the terrain bundle
 * (user, 2026-11-11: "a thing like the Ground Guide named PlatoonGuide which inspects the mouse move and creates
 * something which is essential for the commander to see"; OCOKA_Roadmap.md ch. 8 "Field soldier").
 *
 *   point  hover the map (Hover on), place a Team / Sec / Pl / Coy land unit, or select one: the Ground card (going,
 *          cover, water, way out, landing site, hospital, KM stone), what I see (visibility sketch, range card,
 *          resection, who looks down on me), the dangers round me (likely mine / IED and ambush sites on the roads,
 *          covered approaches, hazards, border), people and BUA, help, and where to stop (patrol base, OP).
 *   line   select a line, right-click it, or call `patrolAround()`: the patrol route card (legs, bearings, paces,
 *          time, dead and exposed stretches, skylines, obstacles crossed, villages passed).
 *
 * Shown so the ground stays clear (user, 2026-11-13: "its mouse move card is blocking the view ... tabs can not be
 * switched, mouse is already committed in symbol drawing"; views 1 2 3 of platoon-guide-view-options.html picked):
 *   - the halo round the pointer (PlatoonGuideHalo): way out as a ring, the answers in the direction they lie, the
 *     verdict above; the old cursor card (PlatoonGuideCard) stays as `cursor: 'card'`. Neither shows while the Ground
 *     Guide's own card is on the cursor;
 *   - the answer bar: the Pl Detail folded to its tab row at the foot, every tab's answer at once (`bar`); a click on a
 *     tab opens the Pl Detail on it, with the tab's big picture (PlatoonGuideDetail);
 *   - the pin: A, or the pointer coming onto the bar, holds the reading at the point (the last place the cursor rested),
 *     so the mouse can leave the map without the reading following it; a pin marks the point on the map. A walks the
 *     tabs, Shift+A back; Esc folds the Detail and lets the pin go; placing the symbol lets it go too.
 * A selected symbol or a right-click opens the Pl Detail straight away. The map layer draws the same products.
 *
 * On every mouse move only the quick reads run (Here, People, Help); once the cursor rests (350 ms) the full reading
 * runs (sight, dangers on roads, where to stop). The dangers on roads are the Movement Guide's route scan
 * (MovementGuideScan + MovementDoctrine.json), so its rules live in one place.
 *
 * Off by default (`features.platoonGuide`). Off means off: no bundle request, no layer, no card, no listener.
 * On without a bundle: one line in the Engine Log, nothing on screen, and drawing works as it always does.
 */

import EngineLogger from '../../Support/EngineLogger';
import DOCTRINE from '../../Data/PlatoonDoctrine.json';
import MOV_DOCTRINE from '../../Data/MovementDoctrine.json';
import SPEEDS from '../../Data/MovementSpeeds.json';
import { lightAt, nightOf } from '../GroundGuide/GroundGuideOcoka';
import { screenNorth } from '../GroundGuide/GroundGuideNorth';
import { RouteScanner, rulesFrom } from '../MovementGuide/MovementGuideScan';
import { PlatoonGuideProbe } from './PlatoonGuideProbe';
import { PlatoonGuideMap } from './PlatoonGuideMap';
import { PlatoonGuideCard } from './PlatoonGuideCard';
import { PlatoonGuideHalo } from './PlatoonGuideHalo';
import { PlatoonGuideDetail, type PlTab } from './PlatoonGuideDetail';
import { patrolCard, plLngLat, plRulesFrom, readPoint, type MercXY, type PatrolCard, type PlEchelon, type PlEye, type PlFootSpeeds, type PlReading, type ScanFn } from './PlatoonGuideRead';
import { briefLines, ECHELON_WORD, mgrsOf, type PlatoonBrief } from './PlatoonGuideText';

const ENGINE = 'PlatoonGuide';
const REST_MS = 350;
const MAX_RERUNS = 12;

export interface PlatoonGuideOptions {
  bundleUrl: string;
  /** Read wherever the mouse is, without drawing. */
  hover: boolean;
  /** Read while a Team / Sec / Pl / Coy land unit is placed, and the one selected. */
  onSymbols: boolean;
  map: boolean;
  /** Paint the dead / screened ground on the map (the Pl Detail's sketch always shows it). */
  mapSight: boolean;
  /** Something at the cursor while hovering or placing (the halo or the card, `cursor`). */
  card: boolean;
  /** What sits at the cursor: the halo round the symbol (default) or the old card beside it. */
  cursor: 'halo' | 'card';
  /** The halo's way-out ring, px from the pointer (kept outside the symbol). */
  haloRadius: number;
  /** The answer bar: the Pl Detail folded to its tab row at the foot of the map. */
  bar: boolean;
  /** A pins the reading and opens / walks the Pl Detail, Esc folds it. */
  keys: boolean;
  /** The bubble when no symbol gives one. */
  echelon: Exclude<PlEchelon, 'default'>;
  eye: PlEye;
  /** Whose NO-GO decides the vehicle way out and the dangers on roads. */
  mover: 'wheeled' | 'tracked';
  threat: 'groundGuide' | 'none';
  cacheTiles: number;
  useWorker: boolean;
}

export const DEFAULT_PLATOON_GUIDE_OPTIONS: PlatoonGuideOptions = {
  bundleUrl: '/terrain-bundle',
  hover: false,
  onSymbols: true,
  map: true,
  mapSight: true,
  card: true,
  cursor: 'halo',
  haloRadius: 64,
  bar: true,
  keys: true,
  echelon: 'platoon',
  eye: 'standing',
  mover: 'wheeled',
  threat: 'groundGuide',
  cacheTiles: 256,
  useWorker: true,
};

/** 2525D land-unit echelon (SIDC positions 9-10) to the bubble; null for anything else (not read while placing). */
export function echelonOfSidc(sidc: string | null | undefined): Exclude<PlEchelon, 'default'> | null {
  const s = sidc ? String(sidc).replace(/\s+/g, '') : '';
  if (s.length < 10 || !/^\d+$/.test(s) || s.substring(4, 6) !== '10') return null;
  const e = s.substring(8, 10);
  return e === '11' ? 'team' : e === '12' || e === '13' ? 'section' : e === '14' ? 'platoon' : e === '15' ? 'company' : null;
}

function toMerc(p: any, sr?: any): MercXY | null {
  if (!p) return null;
  const s = p.spatialReference ?? sr;
  const wk = s?.wkid ?? s?.latestWkid;
  if (s?.isWebMercator || [102100, 3857, 102113, 3785].includes(wk)) return [p.x, p.y];
  const lng = typeof p.longitude === 'number' ? p.longitude : s?.isWGS84 || wk === 4326 ? p.x : null;
  const lat = typeof p.latitude === 'number' ? p.latitude : s?.isWGS84 || wk === 4326 ? p.y : null;
  if (lng === null || lat === null) return null;
  const c = Math.max(-85.05112878, Math.min(85.05112878, lat));
  return [(lng * Math.PI * 6378137) / 180, Math.log(Math.tan(Math.PI / 4 + (c * Math.PI) / 360)) * 6378137];
}
function pathOf(geom: any): MercXY[] | null {
  if (geom?.type !== 'polyline') return null;
  const sr = geom.spatialReference;
  const path = (geom.paths?.[0] ?? []).map((q: number[]) => toMerc({ x: q[0], y: q[1], spatialReference: sr })).filter(Boolean) as MercXY[];
  return path.length >= 2 ? path : null;
}

/** Where a reading came from: the cursor (hover), a symbol being placed, a selected or right-clicked symbol, the API. */
type Origin = 'cursor' | 'draw' | 'select' | 'api';

interface Subject {
  kind: 'point' | 'patrol';
  at?: MercXY;
  path?: MercXY[];
  echelon: Exclude<PlEchelon, 'default'>;
  what: string;
  origin: Origin;
}

export default class PlatoonGuide {
  private _opts: PlatoonGuideOptions = { ...DEFAULT_PLATOON_GUIDE_OPTIONS };
  private _enabled = false;
  private _state: 'off' | 'loading' | 'ready' | 'unavailable' = 'off';
  private _error: string | null = null;
  private _rules = plRulesFrom(DOCTRINE);
  private _movRules = rulesFrom(MOV_DOCTRINE);
  private _roadScanner = new RouteScanner(this._movRules);
  private _footScanner = new RouteScanner(this._movRules);
  private _probe: PlatoonGuideProbe | null = null;
  private _map = new PlatoonGuideMap(() => this._getView());
  private _card = new PlatoonGuideCard();
  private _halo = new PlatoonGuideHalo();
  private _detail = new PlatoonGuideDetail({
    close: () => this._fold(),
    goTo: (x, y) => this._goTo(x, y),
    openTab: (t) => this._openTab(t),
    enter: () => this._onEnterDetail(),
    hideBar: () => {
      this._barHidden = true;
      this._unpin();
      this._detail.close();
    },
  });
  private _configToken = 0;
  private _threatSource: (() => [number, number] | null) | null = null;
  /** True while another card owns the cursor (the Ground Guide's, while a symbol is placed): ours stays hidden then. */
  private _cursorOwner: (() => boolean) | null = null;

  private _drawEchelon: Exclude<PlEchelon, 'default'> | null = null;
  private _drawing = false;
  private _hoverHandle: { remove(): void } | null = null;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _ptr: { el: HTMLElement; move: (e: PointerEvent) => void; leave: () => void; enter: () => void } | null = null;
  private _raf = 0;
  private _pendingAt: { at: MercXY; echelon: Exclude<PlEchelon, 'default'>; what: string; origin: Origin } | null = null;
  private _restTimer: ReturnType<typeof setTimeout> | null = null;
  private _dataTimer: ReturnType<typeof setTimeout> | null = null;
  private _shown: { subject: Subject; full: boolean; brief: PlatoonBrief } | null = null;
  private _reruns = 0;
  private _rerunFor: Subject | null = null;
  private _wanted = true;
  /** The reading held at a point: by A or a tab click ('key', held until Esc), or by the pointer on the bar ('bar',
   *  let go when the pointer comes back to the map while the Detail is folded). */
  private _pin: { subject: Subject; how: 'key' | 'bar' } | null = null;
  /** The last full reading at the cursor (where it rested): what the bar pins, not the map's edge the pointer crossed. */
  private _restSubject: Subject | null = null;
  /** Where the symbol being placed is now (kept while pinned, for the reading of the placed symbol). */
  private _lastDraw: Subject | null = null;
  /** × on the bar: no bar until a reading is asked for again (A, a placed or selected symbol). */
  private _barHidden = false;

  constructor(private readonly _getView: () => any) {}

  // ── state ──────────────────────────────────────────────────────────────────────────────────────────────────────────

  get options(): Readonly<PlatoonGuideOptions> {
    return this._opts;
  }
  get isEnabled(): boolean {
    return this._enabled;
  }
  get isActive(): boolean {
    return this._enabled && this._state === 'ready';
  }
  get status(): { state: 'off' | 'loading' | 'ready' | 'unavailable'; error: string | null } {
    return { state: this._state, error: this._error };
  }
  /** The last brief shown, or null. */
  get lastBrief(): PlatoonBrief | null {
    return this._shown?.brief ?? null;
  }
  /** The Pl Detail is open. */
  get isDetailOpen(): boolean {
    return this._detail.isOpen;
  }
  /** The reading is pinned at a point. */
  get isPinned(): boolean {
    return !!this._pin;
  }

  setOptions(patch: Partial<PlatoonGuideOptions> & { panel?: boolean } | null | undefined): void {
    if (!patch || typeof patch !== 'object') return;
    const prev = this._opts;
    const next: PlatoonGuideOptions = { ...prev };
    for (const k of ['hover', 'onSymbols', 'map', 'mapSight', 'card', 'bar', 'keys', 'useWorker'] as const) if (typeof patch[k] === 'boolean') next[k] = patch[k] as boolean;
    if (patch.cursor === 'halo' || patch.cursor === 'card') next.cursor = patch.cursor;
    if (typeof patch.haloRadius === 'number' && Number.isFinite(patch.haloRadius)) next.haloRadius = Math.max(36, Math.min(160, Math.round(patch.haloRadius)));
    if (typeof patch.panel === 'boolean' && typeof patch.card !== 'boolean') next.card = patch.panel; // the docked panel's old switch
    if (typeof patch.bundleUrl === 'string') next.bundleUrl = patch.bundleUrl.trim().replace(/\/+$/, '');
    if (patch.echelon && ['team', 'section', 'platoon', 'company'].includes(patch.echelon)) next.echelon = patch.echelon;
    if (patch.eye && ['prone', 'kneeling', 'standing', 'rooftop'].includes(patch.eye)) next.eye = patch.eye;
    if (patch.mover === 'wheeled' || patch.mover === 'tracked') next.mover = patch.mover;
    if (patch.threat === 'groundGuide' || patch.threat === 'none') next.threat = patch.threat;
    if (typeof patch.cacheTiles === 'number' && patch.cacheTiles >= 32) next.cacheTiles = Math.round(patch.cacheTiles);
    this._opts = next;
    if (!this._enabled) return;
    if (next.bundleUrl !== prev.bundleUrl || next.useWorker !== prev.useWorker) {
      void this.configure();
      return;
    }
    this._syncHover();
    this._syncKeys();
    if (!next.map) this._map.clear();
    if (!next.card || next.cursor !== 'card') this._card.hide();
    if (!next.card || next.cursor !== 'halo') this._halo.hide();
    if (!next.bar) this._detail.showBar(false);
    else if (!prev.bar && !this._barHidden) this._detail.showBar(true);
    if (next.mover !== prev.mover) this._roadScanner.clear();
    const changed = (['echelon', 'eye', 'mover', 'threat', 'map', 'mapSight', 'card', 'cursor', 'haloRadius'] as const).some((k) => next[k] !== prev[k]);
    if (this._shown && changed) {
      const s = this._shown.subject;
      this._run(s.kind === 'point' && s.origin === 'cursor' ? { ...s, echelon: next.echelon, what: this._whatFor(next.echelon, 'cursor') } : s, true);
    }
  }

  /** Read the threat place from elsewhere (SymbolEngine hands it the Ground Guide's threat marker). */
  setThreatSource(fn: (() => [number, number] | null) | null): void {
    this._threatSource = fn;
  }
  /** Tell the guide when another card owns the cursor (SymbolEngine: the Ground Guide while it is on). */
  setCursorOwner(fn: (() => boolean) | null): void {
    this._cursorOwner = fn;
  }

  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    void this.configure();
  }

  disable(): void {
    this._enabled = false;
    this._configToken++;
    this._stopTimers();
    this._hoverHandle?.remove();
    this._hoverHandle = null;
    this._detachPointer();
    this._detachKeys();
    this._probe?.destroy();
    this._probe = null;
    this._roadScanner.clear();
    this._footScanner.clear();
    this._map.destroy();
    this._card.destroy();
    this._halo.destroy();
    this._detail.destroy();
    this._shown = null;
    this._pin = null;
    this._restSubject = null;
    this._lastDraw = null;
    this._drawEchelon = null;
    this._drawing = false;
    this._state = 'off';
    this._error = null;
  }

  destroy(): void {
    this.disable();
  }

  async configure(): Promise<boolean> {
    if (!this._enabled) return false;
    const token = ++this._configToken;
    this._probe?.destroy();
    this._roadScanner.clear();
    this._footScanner.clear();
    const probe = new PlatoonGuideProbe(() => this._onData());
    this._probe = probe;
    this._state = 'loading';
    this._error = null;
    try {
      const ok = await probe.configure(this._opts.bundleUrl, { cacheTiles: this._opts.cacheTiles, useWorker: this._opts.useWorker });
      if (token !== this._configToken) return false;
      if (!ok) throw new Error('no bundle URL set');
      this._state = 'ready';
      EngineLogger.success(ENGINE, `Terrain bundle ready for the Platoon Guide (${probe.dataLine()})`);
      this._syncHover();
      this._syncKeys();
      this._attachPointer();
      if (this._shown) this._run(this._shown.subject, true);
      return true;
    } catch (err) {
      if (token !== this._configToken) return false;
      probe.destroy();
      if (this._probe === probe) this._probe = null;
      this._state = 'unavailable';
      this._error = (err as Error)?.message ?? String(err);
      this._stopTimers();
      this._shown = null;
      this._map.clear();
      this._card.hide();
      this._halo.hide();
      this._pin = null;
      this._detail.close();
      EngineLogger.error(ENGINE, `Terrain bundle unavailable (${this._opts.bundleUrl || 'no URL'}): ${this._error}. Platoon Guide idle.`);
      return false;
    }
  }

  retry(): Promise<boolean> {
    return this.configure();
  }

  // ── drawing, selection, hover ──────────────────────────────────────────────────────────────────────────────────────

  /** A draw is armed: a Team / Sec / Pl / Coy land unit is read while it is placed. */
  prepareFor(sidc: string | null | undefined): void {
    this._drawEchelon = this.isActive && this._opts.onSymbols ? echelonOfSidc(sidc) : null;
    this._drawing = true;
    this._lastDraw = null;
    this._unpin();
    this._cancelQueued();
    this._card.hide();
    this._halo.hide();
  }

  /** Hot path: every draw progress of the engine's own view. */
  onDrawProgress(detail: any): void {
    if (!this.isActive || !this._drawEchelon) return;
    const g = detail?.currentGeometry;
    const at = g?.type === 'point' ? toMerc(g) : null;
    if (!at) return;
    this._lastDraw = { kind: 'point', at, echelon: this._drawEchelon, what: this._whatFor(this._drawEchelon, 'being placed'), origin: 'draw' };
    this._queue(at, this._drawEchelon, this._whatFor(this._drawEchelon, 'being placed'), 'draw');
  }

  /** The draw ended or was cancelled: read the last point in full (where the symbol went, not a pin); the halo goes. */
  deactivate(): void {
    this._drawing = false;
    const e = this._drawEchelon;
    this._drawEchelon = null;
    this._cancelQueued();
    this._card.hide();
    this._halo.hide();
    const wasPinned = !!this._pin;
    this._unpin();
    const s = this._lastDraw ?? (this._shown?.subject.origin === 'draw' ? this._shown.subject : null);
    this._lastDraw = null;
    if (!e) return;
    if (s && this.isActive) {
      this._barHidden = false;
      this._run({ ...s, what: this._whatFor(e, 'placed'), origin: 'select' }, true, false);
    } else if (wasPinned && this._shown) this._present(this._shown.brief, this._shown.subject, false);
  }

  /** The one selected symbol: a land unit (Team to Coy) gets the Pl Detail, a line the patrol route card. */
  setTarget(graphic: any | null): void {
    if (!this.isActive || !graphic || this._drawing || !this._opts.onSymbols) return;
    this._unpin();
    const geom = graphic.geometry;
    if (geom?.type === 'polyline') {
      this.analyse(graphic);
      return;
    }
    const sidc = graphic.attributes?.drawEssentials?.SIDC ?? graphic.attributes?.drawEssentials?.AMPLIFIER?.SIDC ?? graphic.attributes?.SIDC;
    const e = echelonOfSidc(sidc);
    if (e && geom?.type === 'point') this.analyse(graphic);
  }

  /** True when a placed graphic can be read (right-click): a point or a line. */
  canAnalyse(graphic: any): boolean {
    const t = graphic?.geometry?.type;
    return this.isActive && (t === 'point' || t === 'polyline');
  }

  /** Read a placed graphic in full and open the Pl Detail: a point gets the Ground card, a line the patrol route card. */
  analyse(target: any): PlatoonBrief | null {
    if (!this.isActive) return null;
    const geom = target?.geometry ?? target;
    this._wanted = true;
    this._barHidden = false;
    this._unpin();
    // A cursor read still queued (hover) must not replace what was asked for.
    this._cancelQueued();
    this._card.hide();
    this._halo.hide();
    const path = pathOf(geom);
    if (path) return this._run({ kind: 'patrol', path, echelon: this._opts.echelon, what: 'Patrol route', origin: 'select' }, true, true);
    if (geom?.type !== 'point') return null;
    const at = toMerc(geom);
    if (!at) return null;
    const de = target?.attributes?.drawEssentials;
    const e = echelonOfSidc(de?.SIDC ?? de?.AMPLIFIER?.SIDC) ?? this._opts.echelon;
    return this._run({ kind: 'point', at, echelon: e, what: this._whatFor(e, target?.geometry ? 'symbol' : 'point'), origin: 'select' }, true, true);
  }

  /** Headless: the Ground card at [lng, lat], waiting (up to `timeoutMs`) for the terrain it needs. `show` opens the Pl Detail. */
  async pointAround(lngLat: [number, number], opts: { echelon?: Exclude<PlEchelon, 'default'>; timeoutMs?: number; show?: boolean } = {}): Promise<PlatoonBrief | null> {
    if (!this.isActive) return null;
    const at = toMerc({ longitude: lngLat[0], latitude: lngLat[1] });
    if (!at) return null;
    const e = opts.echelon ?? this._opts.echelon;
    return this._settle({ kind: 'point', at, echelon: e, what: this._whatFor(e, 'point'), origin: 'api' }, opts.timeoutMs ?? 10000, opts.show ?? false);
  }

  /** Headless: the patrol route card for [lng, lat] points. */
  async patrolAround(lngLats: Array<[number, number]>, opts: { timeoutMs?: number; show?: boolean } = {}): Promise<PlatoonBrief | null> {
    if (!this.isActive || lngLats.length < 2) return null;
    const path = lngLats.map((p) => toMerc({ longitude: p[0], latitude: p[1] })).filter(Boolean) as MercXY[];
    return this._settle({ kind: 'patrol', path, echelon: this._opts.echelon, what: 'Patrol route', origin: 'api' }, opts.timeoutMs ?? 10000, opts.show ?? false);
  }

  /** Hover on / off (the info bar button and `platoonGuide.hover`). */
  setHover(on: boolean): void {
    this.setOptions({ hover: on });
  }

  /** Open the Pl Detail (on a tab), or fold it to the bar (closed when the bar is off). */
  openDetail(open = true, tab?: PlTab): void {
    if (!open) return this._fold();
    this._barHidden = false;
    if (this._shown) this._detail.update(this._shown.brief, this._north());
    this._detail.open(tab);
  }

  /** Hold the reading at the point the cursor is on (or last rested on), so the mouse can go to the Pl Detail. */
  pin(): boolean {
    return this._pinAt('key');
  }
  /** Let the pin go: the reading follows the cursor again. */
  unpin(): void {
    this._unpin();
  }

  reportText(): string {
    return this._shown ? briefLines(this._shown.brief).join('\n') : '';
  }

  /** Show or hide everything on screen (the map products, the cursor card and the Pl Detail). */
  showPanel(open = true): void {
    this._wanted = open;
    if (!open) {
      this._card.hide();
      this._halo.hide();
      this._unpin();
      this._detail.close();
      this._map.clear();
      return;
    }
    if (this._shown) this._present(this._shown.brief, this._shown.subject, true);
  }

  onViewChanged(): void {
    this._map.destroy();
    this._map = new PlatoonGuideMap(() => this._getView());
    this._card.hide();
    this._halo.hide();
    this._hoverHandle?.remove();
    this._hoverHandle = null;
    this._detachPointer();
    this._syncHover();
    this._attachPointer();
    if (this._shown) this._present(this._shown.brief, this._shown.subject, false);
  }

  // ── reading ────────────────────────────────────────────────────────────────────────────────────────────────────────

  private _whatFor(e: Exclude<PlEchelon, 'default'>, where: string): string {
    return `${ECHELON_WORD[e] ?? 'Pl'} · ${where}`;
  }

  private _north(): number {
    return screenNorth(this._getView?.());
  }

  private _syncHover(): void {
    const want = this.isActive && this._opts.hover;
    if (!want) {
      if (this._hoverHandle) {
        this._cancelQueued();
        if (!this._drawing) {
          this._card.hide();
          this._halo.hide();
        }
      }
      this._hoverHandle?.remove();
      this._hoverHandle = null;
      return;
    }
    if (this._hoverHandle) return;
    const view = this._getView?.();
    if (!view?.on) return;
    this._hoverHandle = view.on('pointer-move', (e: any) => {
      if (this._drawing || !this.isActive || !this._opts.hover) return;
      const p = view.toMap?.({ x: e.x, y: e.y });
      const at = p ? toMerc(p) : null;
      if (at) this._queue(at, this._opts.echelon, this._whatFor(this._opts.echelon, 'cursor'), 'cursor');
    });
  }

  /** The halo / card follow the pointer over the map and go when it leaves; coming back lets a bar pin go. */
  private _attachPointer(): void {
    if (this._ptr) return;
    const el = this._getView?.()?.container as HTMLElement | null | undefined;
    if (!el) return;
    const move = (e: PointerEvent) => {
      this._card.moveTo(e.clientX, e.clientY);
      this._halo.moveTo(e.clientX, e.clientY);
    };
    const leave = () => {
      if (!this._drawing) {
        this._card.hide();
        this._halo.hide();
      }
    };
    const enter = () => {
      if (this._pin?.how === 'bar' && !this._detail.isOpen) this._unpin();
    };
    el.addEventListener('pointermove', move, { passive: true });
    el.addEventListener('pointerleave', leave);
    el.addEventListener('pointerenter', enter);
    this._ptr = { el, move, leave, enter };
  }
  private _detachPointer(): void {
    if (!this._ptr) return;
    this._ptr.el.removeEventListener('pointermove', this._ptr.move);
    this._ptr.el.removeEventListener('pointerleave', this._ptr.leave);
    this._ptr.el.removeEventListener('pointerenter', this._ptr.enter);
    this._ptr = null;
  }

  /** A pins the reading and opens the Pl Detail, then walks its tabs (Shift+A back); Esc folds it and lets the pin go. */
  private _syncKeys(): void {
    const want = this.isActive && this._opts.keys;
    if (!want) return this._detachKeys();
    if (this._keyHandler) return;
    this._keyHandler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        if (!this._detail.isOpen && !this._pin) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this._fold();
        return;
      }
      if (k !== 'a' || e.repeat) return;
      e.preventDefault();
      if (this._detail.isOpen) return this._detail.step(e.shiftKey ? -1 : 1);
      this._pinAt('key');
      this.openDetail(true);
    };
    window.addEventListener('keydown', this._keyHandler, true);
  }
  private _detachKeys(): void {
    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler, true);
    this._keyHandler = null;
  }

  /** Coalesce to one quick read per frame, and a full read once the cursor rests. */
  private _queue(at: MercXY, echelon: Exclude<PlEchelon, 'default'>, what: string, origin: Origin): void {
    if (this._pin) return; // the reading is held at the pin
    this._pendingAt = { at, echelon, what, origin };
    if (!this._raf) {
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        const q = this._pendingAt;
        if (q) this._run({ kind: 'point', at: q.at, echelon: q.echelon, what: q.what, origin: q.origin }, false);
      });
    }
    if (this._restTimer) clearTimeout(this._restTimer);
    this._restTimer = setTimeout(() => {
      this._restTimer = null;
      const q = this._pendingAt;
      if (q) this._run({ kind: 'point', at: q.at, echelon: q.echelon, what: q.what, origin: q.origin }, true);
    }, REST_MS);
  }

  private _threat(): MercXY | null {
    if (this._opts.threat !== 'groundGuide') return null;
    const t = this._threatSource?.();
    return t ? toMerc({ longitude: t[0], latitude: t[1] }) : null;
  }

  private _foot(): PlFootSpeeds {
    const f = (SPEEDS as any).movers?.foot ?? {};
    return {
      ground: f.ground ?? { open: [4, 3] },
      road: f.road?.track ?? [4, 3],
      toblerA: Array.isArray(f.slope?.a) ? f.slope.a[0] : 3.5,
      toblerB: typeof f.slope?.b === 'number' ? f.slope.b : 0.05,
    };
  }

  private _scan(scanner: RouteScanner, profile: string): ScanFn {
    const probe = this._probe!;
    const going = probe.going(profile);
    const borders = this._borders();
    return (path, sight, threat) => scanner.scan(path, probe, { going, sight, threat: threat ?? null, borders }, probe.tick);
  }

  /** International borders, the LoC and the LAC only (MovementDoctrine.json exposure.borderKinds): not provinces or planning lines. */
  private _borders() {
    const probe = this._probe!;
    const kinds = new Set<string>((this._movRules.exposure?.borderKinds ?? []) as string[]);
    return kinds.size ? probe.borders.filter((b) => kinds.has(b.kind)) : probe.borders;
  }

  private _read(s: Subject, full: boolean): PlatoonBrief | null {
    const probe = this._probe;
    if (!probe?.ready) return null;
    const threat = this._threat();
    const now = new Date();
    let reading: PlReading | null = null;
    let patrol: PatrolCard | null = null;
    let at: MercXY;
    if (s.kind === 'patrol' && s.path) {
      at = s.path[0];
      probe.focus(at[1]);
      patrol = patrolCard(probe, this._rules, s.path, {
        foot: probe.going('dismounted'),
        speeds: this._foot(),
        threat,
        classLabel: (c) => probe.classLabel(c),
        scanRoad: this._scan(this._footScanner, 'dismounted'),
      });
    } else {
      at = s.at!;
      probe.focus(at[1]);
      reading = readPoint(probe, this._rules, {
        at,
        echelon: s.echelon,
        eye: this._opts.eye,
        month: now.getMonth() + 1,
        foot: probe.going('dismounted'),
        veh: probe.going(this._opts.mover),
        classLabel: (c) => probe.classLabel(c),
        codebooks: probe.codebooks(),
        threat,
        borders: this._borders(),
        scanRoad: this._scan(this._roadScanner, this._opts.mover),
        people: probe.peopleAround(at),
        full,
      });
    }
    const [lng, lat] = plLngLat(at);
    const light = lightAt(now, lat, lng);
    const night = nightOf(now, lat, lng);
    const LW: Record<string, string> = { day: 'Day', twilight: 'Twilight', moonlight: 'Moonlight', starlight: 'Starlight (dark)' };
    const vis = probe.visibility(at, now.getMonth() + 1);
    return {
      what: s.what,
      reading,
      patrol,
      grid: mgrsOf(lng, lat),
      sheet: probe.sheetAt(at),
      light: { now: LW[light.level] ?? light.level, tonight: `moonlit ${Math.round(night.moonlitShare * 100)}% of the night, moon ${Math.round(night.moonIllum * 100)}% lit` },
      vis: vis ? { fogPct: vis.fogPct, hazePct: vis.hazePct, meanViewKm: vis.meanViewKm } : null,
      dataLine: probe.dataLine(),
      threat: !!threat,
      pending: (reading?.pending ?? false) || (patrol?.pending ?? false),
    };
  }

  /** Read and show. `open`: open the Pl Detail (a selected symbol, a right-click); otherwise it keeps its state. */
  private _run(s: Subject, full: boolean, open = false): PlatoonBrief | null {
    if (!this.isActive) return null;
    const atCursor = s.origin === 'cursor' || s.origin === 'draw';
    if (this._pin && atCursor && s !== this._pin.subject) return null;
    let b: PlatoonBrief | null = null;
    try {
      b = this._read(s, full);
    } catch (err) {
      EngineLogger.error(ENGINE, `Reading failed: ${(err as Error)?.message ?? err}`);
      return null;
    }
    if (!b) return null;
    if (full && atCursor && !this._pin) this._restSubject = s;
    this._shown = { subject: s, full, brief: b };
    this._present(b, s, open);
    return b;
  }

  private async _settle(s: Subject, timeoutMs: number, show: boolean): Promise<PlatoonBrief | null> {
    const t0 = Date.now();
    let b = this._read(s, true);
    while (b?.pending && Date.now() - t0 < timeoutMs) {
      await new Promise((r) => setTimeout(r, 150));
      if (!this.isActive) return null;
      b = this._read(s, true);
    }
    if (b && show) {
      this._cancelQueued();
      this._unpin();
      this._card.hide();
      this._halo.hide();
      this._shown = { subject: s, full: true, brief: b };
      this._wanted = true;
      this._present(b, s, true);
    }
    return b;
  }

  private _present(b: PlatoonBrief, s: Subject, open: boolean): void {
    if (!this._enabled || !this._wanted) return;
    const north = this._north();
    const pinned = !!this._pin && s === this._pin.subject;
    if (this._opts.map) this._map.show({ reading: b.reading, patrol: b.patrol && s.path ? { card: b.patrol, path: s.path } : null, sight: this._opts.mapSight, pin: pinned });
    // At the cursor: the halo (or the card), only for a reading at the cursor and not pinned, never over the Ground
    // Guide's own card while placing.
    const onCursor = (s.origin === 'cursor' || s.origin === 'draw') && !pinned;
    const owned = s.origin === 'draw' && (this._cursorOwner?.() ?? false);
    const want = this._opts.card && onCursor && !owned && !!b.reading;
    if (want && this._opts.cursor === 'halo') {
      this._halo.update(b, north, { radius: this._opts.haloRadius, keys: this._opts.keys });
      this._card.hide();
    } else if (want) {
      this._card.update(b, north, this._opts.keys);
      this._halo.hide();
    } else if (!onCursor || owned || !this._opts.card) {
      this._card.hide();
      this._halo.hide();
    }
    this._detail.update(b, north);
    if (open) this._detail.open(b.patrol && !b.reading ? 'patrol' : undefined);
    else if (this._opts.bar && !this._barHidden && !this._detail.isOpen) this._detail.showBar(true);
  }

  // ── pin, bar ───────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Hold the reading. 'bar' takes the last place the cursor rested (the pointer crossed the map to get to the bar). */
  private _pinAt(how: 'key' | 'bar'): boolean {
    if (this._pin) {
      if (how === 'key') this._pin.how = 'key';
      return true;
    }
    const cur = this._shown?.subject;
    if (!cur || (cur.origin !== 'cursor' && cur.origin !== 'draw') || cur.kind !== 'point') return false;
    const base = how === 'bar' && this._restSubject ? this._restSubject : cur;
    this._cancelQueued();
    const subject: Subject = { ...base, what: this._whatFor(base.echelon, 'pinned') };
    this._pin = { subject, how };
    this._card.hide();
    this._halo.hide();
    this._detail.setPinned(true);
    this._run(subject, true);
    return true;
  }

  private _unpin(): void {
    if (!this._pin) return;
    const s = this._shown;
    const wasShown = s?.subject === this._pin.subject;
    this._pin = null;
    this._detail.setPinned(false);
    // Take the pin off the map now; the next pointer move reads the cursor again.
    if (wasShown && s && this._opts.map) this._map.show({ reading: s.brief.reading, patrol: null, sight: this._opts.mapSight, pin: false });
  }

  /** Esc, × or ▾: the Detail folds to the bar (closed when the bar is off) and the pin goes. */
  private _fold(): void {
    this._unpin();
    if (this._opts.bar && !this._barHidden) this._detail.fold();
    else this._detail.close();
  }

  /** A tab clicked (on the bar or the open Detail): hold the reading and open the Detail on it. */
  private _openTab(t: PlTab): void {
    this._pinAt('key');
    this._barHidden = false;
    if (this._shown) this._detail.update(this._shown.brief, this._north());
    this._detail.open(t);
  }

  /** The pointer came onto the bar or the Detail: the reading must not follow it, so hold it where the cursor rested. */
  private _onEnterDetail(): void {
    if (!this._pin) this._pinAt('bar');
  }

  /** Data arrived: read again what is on screen if it met data still loading (at most MAX_RERUNS times). */
  private _onData(): void {
    if (!this._shown?.brief.pending || this._dataTimer) return;
    if (this._rerunFor !== this._shown.subject) {
      this._rerunFor = this._shown.subject;
      this._reruns = 0;
    }
    if (++this._reruns > MAX_RERUNS) return;
    this._dataTimer = setTimeout(() => {
      this._dataTimer = null;
      const s = this._shown;
      if (s?.brief.pending) this._run(s.subject, s.full);
    }, 120);
  }

  private _goTo(x: number, y: number): void {
    const view = this._getView?.();
    if (!view?.goTo) return;
    const sr = view.spatialReference;
    const wk = sr?.wkid ?? sr?.latestWkid;
    const target = sr?.isWGS84 || wk === 4326 ? { x: plLngLat([x, y])[0], y: plLngLat([x, y])[1], spatialReference: { wkid: 4326 } } : { x, y, spatialReference: { wkid: 102100 } };
    void view.goTo({ target: { type: 'point', ...target } }).catch(() => undefined);
  }

  /** Drop a cursor read waiting for the next frame or for the cursor to rest. */
  private _cancelQueued(): void {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    if (this._restTimer) clearTimeout(this._restTimer);
    this._restTimer = null;
    this._pendingAt = null;
  }

  private _stopTimers(): void {
    this._cancelQueued();
    if (this._dataTimer) clearTimeout(this._dataTimer);
    this._dataTimer = null;
  }
}
