/**
 * NightMarch.ts
 *
 * The Night March chart (OCOKA_Roadmap.md ch. 2 "Attack": "Night march chart — bearings and paced legs (120 paces =
 * 100 m), FUP marking layout"; user, 2026-11-11: "mouse move card as well ... visually appealing and use creative
 * visualization techniques ... like bottom card styles switched with keys").
 *
 *   draw    `startDraw()` (the info bar's 🌙 button): click the SP and each turn, double-click the FUP, then click the
 *           objective (Esc for none). While drawing, the cursor card shows the leg in hand: compass dial with its drift
 *           cone, bearing grid / magnetic / mils, paces and the pace cord, time by night, the landmark it would end on,
 *           hazards, and the distance to the objective against the enemy's night sights.
 *   chart   the finished march: the map products (NightMarchMap) and the chart docked at the foot (NightMarchChartView)
 *           in six styles: Chart, Strip, Cards, Trace, FUP, Clock. W opens it and walks pages then styles (Shift+W
 *           back), Esc closes it. With the pointer on a finished route the card shows that leg: paces in and to go,
 *           when the column passes (`nightMarch.hover`).
 *   api     `chartFor(lngLats, objective)`, `useGraphic(graphic)` (a placed line), `chartText()`.
 *
 * Terrain is optional (claude_rules.md): with `nightMarch.useTerrain` on and the bundle there, the legs' times follow the
 * ground and slope and the chart names the landmarks, skylines, obstacles and the ground hidden from the objective (the
 * Platoon Guide's patrol route card and the Movement Guide's route scan); off or missing, the chart is worked out from
 * the geometry on open ground at the march table's night speed and says so. Off by default (`features.nightMarch`).
 */

import EngineLogger from '../../Support/EngineLogger';
import DOCTRINE from '../../Data/NightMarchDoctrine.json';
import PL_DOCTRINE from '../../Data/PlatoonDoctrine.json';
import MOV_DOCTRINE from '../../Data/MovementDoctrine.json';
import SPEEDS from '../../Data/MovementSpeeds.json';
import { lightAt, nightOf } from '../GroundGuide/GroundGuideOcoka';
import { screenNorth } from '../GroundGuide/GroundGuideNorth';
import { RouteScanner, rulesFrom } from '../MovementGuide/MovementGuideScan';
import { PlatoonGuideProbe } from '../PlatoonGuide/PlatoonGuideProbe';
import { plDist, plLngLat, plRulesFrom, type MercXY, type PlFootSpeeds, type ScanFn } from '../PlatoonGuide/PlatoonGuideRead';
import { mgrsOf } from '../PlatoonGuide/PlatoonGuideText';
import { legAt, liveLeg, nightMarchChart, nmRulesFrom, parseHHMM, type NmEchelon, type NmTerrain } from './NightMarchRead';
import { chartLines, ECHELON_WORD, type NightMarchBrief, type NmUnits } from './NightMarchText';
import { NightMarchCard, type NmCardCtx } from './NightMarchCard';
import { NightMarchChartView, NM_STYLES, type NmStyle } from './NightMarchChartView';
import { NightMarchDraw } from './NightMarchDraw';
import { NightMarchMap } from './NightMarchMap';

const ENGINE = 'NightMarch';
const MAX_RERUNS = 12;
const HINT_ID = 'ms-night-march-hint';

export interface NightMarchOptions {
  bundleUrl: string;
  /** Read the terrain bundle: times by ground and slope, landmarks, skylines, obstacles. Off: geometry only, no request. */
  useTerrain: boolean;
  /** The cursor card while drawing (and on a finished route when `hover`). */
  card: boolean;
  /** The card on a finished route under the pointer. */
  hover: boolean;
  /** W opens and walks the chart, Esc closes it. */
  keys: boolean;
  map: boolean;
  /** The enemy's night-sight and thermal rings round the objective. */
  rings: boolean;
  /** Leg labels and names of places on the map. */
  labels: boolean;
  echelon: NmEchelon;
  units: NmUnits;
  /** Grid-magnetic angle, degrees, east positive; null = not set (bearings grid). */
  gmaDeg: number | null;
  /** H hour, "HH:MM" (24 h); '' = timings relative to H. */
  hHour: string;
  /** The march table's ground when the terrain is not read. */
  terrain: NmTerrain;
  /** Tanks with the attack (the tank FUP distances). */
  tanks: boolean;
  /** The style the chart opens on. */
  style: NmStyle;
  cacheTiles: number;
  useWorker: boolean;
}

export const DEFAULT_NIGHT_MARCH_OPTIONS: NightMarchOptions = {
  bundleUrl: '/terrain-bundle',
  useTerrain: true,
  card: true,
  hover: true,
  keys: true,
  map: true,
  rings: true,
  labels: true,
  echelon: 'company',
  units: 'deg',
  gmaDeg: null,
  hHour: '',
  terrain: 'plains',
  tanks: false,
  style: 'chart',
  cacheTiles: 256,
  useWorker: true,
};

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

interface Subject {
  path: MercXY[];
  objective: MercXY | null;
}

export default class NightMarch {
  private _opts: NightMarchOptions = { ...DEFAULT_NIGHT_MARCH_OPTIONS };
  private _enabled = false;
  private _terrainState: 'off' | 'loading' | 'ready' | 'unavailable' = 'off';
  private _terrainError: string | null = null;
  private _R = nmRulesFrom(DOCTRINE);
  private _PR = plRulesFrom(PL_DOCTRINE);
  private _movRules = rulesFrom(MOV_DOCTRINE);
  private _scanner = new RouteScanner(this._movRules);
  private _probe: PlatoonGuideProbe | null = null;
  private _configToken = 0;
  private _map = new NightMarchMap(() => this._getView());
  private _card = new NightMarchCard();
  private _view = new NightMarchChartView({
    close: () => this._view.close(),
    goTo: (x, y) => this._goTo(x, y),
    newRoute: () => this.startDraw(),
    copied: (ok) => this._hint(ok ? 'Night march chart copied as text' : 'Copy failed: the browser refused the clipboard', 1800),
  });
  private _draw = new NightMarchDraw(() => this._getView());
  private _subject: Subject | null = null;
  private _brief: NightMarchBrief | null = null;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _ptr: { el: HTMLElement; move: (e: PointerEvent) => void; leave: () => void } | null = null;
  private _hoverHandle: { remove(): void } | null = null;
  private _raf = 0;
  private _pendingLive: { route: MercXY[]; cursor: MercXY; step: 'route' | 'objective' } | null = null;
  private _dataTimer: ReturnType<typeof setTimeout> | null = null;
  private _reruns = 0;
  private _hintTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly _getView: () => any) {}

  // ── state ──────────────────────────────────────────────────────────────────────────────────────────────────────────

  get options(): Readonly<NightMarchOptions> {
    return this._opts;
  }
  get isEnabled(): boolean {
    return this._enabled;
  }
  get isDrawing(): boolean {
    return this._draw.active;
  }
  get isChartOpen(): boolean {
    return this._view.isOpen;
  }
  get chartStyle(): NmStyle {
    return this._view.style;
  }
  /** Terrain: off (switched off), loading, ready, or unavailable (no bundle: the chart works from the geometry). */
  get status(): { terrain: 'off' | 'loading' | 'ready' | 'unavailable'; error: string | null } {
    return { terrain: this._terrainState, error: this._terrainError };
  }
  get lastBrief(): NightMarchBrief | null {
    return this._brief;
  }

  setOptions(patch: Partial<NightMarchOptions> | null | undefined): void {
    if (!patch || typeof patch !== 'object') return;
    const prev = this._opts;
    const next: NightMarchOptions = { ...prev };
    for (const k of ['useTerrain', 'card', 'hover', 'keys', 'map', 'rings', 'labels', 'tanks', 'useWorker'] as const) if (typeof patch[k] === 'boolean') next[k] = patch[k] as boolean;
    if (typeof patch.bundleUrl === 'string') next.bundleUrl = patch.bundleUrl.trim().replace(/\/+$/, '');
    if (patch.echelon && ['platoon', 'company', 'battalion'].includes(patch.echelon)) next.echelon = patch.echelon;
    if (patch.units && ['deg', 'mils', 'both'].includes(patch.units)) next.units = patch.units;
    if (patch.terrain && ['plains', 'desert', 'mountain'].includes(patch.terrain)) next.terrain = patch.terrain;
    if (patch.style && NM_STYLES.includes(patch.style)) next.style = patch.style;
    if ('gmaDeg' in patch) {
      const g = patch.gmaDeg as unknown;
      next.gmaDeg = g === null || g === '' || g === undefined || (typeof g === 'number' && Number.isNaN(g)) ? null : Number.isFinite(Number(g)) && Math.abs(Number(g)) <= 30 ? Number(g) : prev.gmaDeg;
    }
    if (typeof patch.hHour === 'string') next.hHour = parseHHMM(patch.hHour) !== null ? patch.hHour.trim() : '';
    if (typeof patch.cacheTiles === 'number' && patch.cacheTiles >= 32) next.cacheTiles = Math.round(patch.cacheTiles);
    this._opts = next;
    if (!this._enabled) return;
    if (next.useTerrain !== prev.useTerrain || next.bundleUrl !== prev.bundleUrl || next.useWorker !== prev.useWorker) void this._configureTerrain();
    this._syncKeys();
    this._syncHover();
    if (!next.card) this._card.hide();
    if (!next.map) this._map.clear();
    if (next.style !== prev.style && !this._view.isOpen) this._view.setStyle(next.style);
    if (this._subject) this._run(this._subject, false);
  }

  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    this._view.setStyle(this._opts.style);
    this._syncKeys();
    this._attachPointer();
    this._syncHover();
    void this._configureTerrain();
    EngineLogger.nextStep(ENGINE, 'Night March on: 🌙 or startDraw() to draw a route, W for the chart');
  }

  disable(): void {
    this._enabled = false;
    this._configToken++;
    this._draw.cancel(false);
    this._draw.destroy();
    this._detachKeys();
    this._detachPointer();
    this._hoverHandle?.remove();
    this._hoverHandle = null;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    if (this._dataTimer) clearTimeout(this._dataTimer);
    this._dataTimer = null;
    this._probe?.destroy();
    this._probe = null;
    this._scanner.clear();
    this._map.destroy();
    this._card.destroy();
    this._view.destroy();
    this._hint(null);
    this._subject = null;
    this._brief = null;
    this._terrainState = 'off';
    this._terrainError = null;
  }

  destroy(): void {
    this.disable();
  }

  onViewChanged(): void {
    this._draw.cancel(false);
    this._draw.destroy();
    this._draw = new NightMarchDraw(() => this._getView());
    this._map.destroy();
    this._map = new NightMarchMap(() => this._getView());
    this._card.hide();
    this._hoverHandle?.remove();
    this._hoverHandle = null;
    this._detachPointer();
    if (!this._enabled) return;
    this._attachPointer();
    this._syncHover();
    if (this._brief && this._opts.map) this._showMap();
  }

  // ── terrain (optional) ─────────────────────────────────────────────────────────────────────────────────────────────

  private async _configureTerrain(): Promise<void> {
    const token = ++this._configToken;
    this._probe?.destroy();
    this._probe = null;
    this._scanner.clear();
    if (!this._enabled || !this._opts.useTerrain || !this._opts.bundleUrl) {
      this._terrainState = 'off';
      this._terrainError = null;
      if (this._subject) this._run(this._subject, false);
      return;
    }
    const probe = new PlatoonGuideProbe(() => this._onData());
    this._probe = probe;
    this._terrainState = 'loading';
    try {
      const ok = await probe.configure(this._opts.bundleUrl, { cacheTiles: this._opts.cacheTiles, useWorker: this._opts.useWorker });
      if (token !== this._configToken) return;
      if (!ok) throw new Error('no bundle URL set');
      this._terrainState = 'ready';
      EngineLogger.success(ENGINE, `Terrain bundle ready for the Night March (${probe.dataLine()})`);
      if (this._subject) this._run(this._subject, false);
    } catch (err) {
      if (token !== this._configToken) return;
      probe.destroy();
      if (this._probe === probe) this._probe = null;
      this._terrainState = 'unavailable';
      this._terrainError = (err as Error)?.message ?? String(err);
      EngineLogger.error(ENGINE, `Terrain bundle unavailable (${this._opts.bundleUrl}): ${this._terrainError}. Night March works from the geometry on open ground.`);
      if (this._subject) this._run(this._subject, false);
    }
  }

  private _terrainProbe(): PlatoonGuideProbe | null {
    return this._terrainState === 'ready' && this._probe?.ready ? this._probe : null;
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

  private _scan(probe: PlatoonGuideProbe): ScanFn {
    const going = probe.going('dismounted');
    const kinds = new Set<string>((this._movRules.exposure?.borderKinds ?? []) as string[]);
    const borders = kinds.size ? probe.borders.filter((b) => kinds.has(b.kind)) : probe.borders;
    return (path, sight, threat) => this._scanner.scan(path, probe, { going, sight, threat: threat ?? null, borders }, probe.tick);
  }

  // ── drawing ────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Draw a route: click the SP and each turn, double-click the FUP, then click the objective (Esc for none). */
  startDraw(): void {
    if (!this._enabled) return;
    this._view.close();
    this._card.hide();
    this._draw.start({
      onMove: (route, cursor, step) => this._queueLive(route, cursor, step),
      onRoute: () => this._card.hide(),
      onDone: (route, obj) => {
        this._card.hide();
        this._run({ path: route, objective: obj }, true);
      },
      onCancel: () => {
        this._card.hide();
        this._hint(null);
      },
      onStatus: (t) => this._hint(t),
    });
  }

  cancelDraw(): void {
    this._draw.cancel();
  }

  private _queueLive(route: MercXY[], cursor: MercXY, step: 'route' | 'objective'): void {
    this._pendingLive = { route, cursor, step };
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      const q = this._pendingLive;
      if (!q || !this._enabled || !this._draw.active || !this._opts.card) return;
      // In the objective step the card reads the FUP (the route's last point) against the cursor as the objective.
      const probe = this._terrainProbe();
      try {
        if (q.step === 'route') {
          const v = liveLeg(
            {
              laid: q.route,
              cursor: q.cursor,
              objective: null,
              gmaDeg: this._opts.gmaDeg,
              terrainKind: this._opts.terrain,
              tanks: this._opts.tanks,
              probe,
              patrolRules: probe ? this._PR : null,
              foot: probe ? probe.going('dismounted') : null,
              speeds: probe ? this._foot() : null,
              classLabel: probe ? (c) => probe.classLabel(c) : undefined,
            },
            this._R,
          );
          const lengths: number[] = [];
          for (let i = 0; i + 1 < q.route.length; i++) lengths.push(plDist(q.route[i], q.route[i + 1]));
          this._card.showLive(v, this._cardCtx(), lengths, this._north());
        } else {
          // Objective step: the FUP is laid; the card shows the FUP's distance to the cursor as the objective.
          const fup = q.route[q.route.length - 1];
          const v = liveLeg({ laid: q.route.slice(0, -1).length ? q.route.slice(0, -1) : [fup], cursor: fup, objective: q.cursor, gmaDeg: this._opts.gmaDeg, terrainKind: this._opts.terrain, tanks: this._opts.tanks }, this._R);
          v.legNo = q.route.length - 1;
          const lengths: number[] = [];
          for (let i = 0; i + 2 < q.route.length; i++) lengths.push(plDist(q.route[i], q.route[i + 1]));
          this._card.showLive(v, this._cardCtx(), lengths, this._north(), true);
        }
      } catch (err) {
        EngineLogger.error(ENGINE, `Live leg failed: ${(err as Error)?.message ?? err}`);
      }
    });
  }

  private _cardCtx(): NmCardCtx {
    const at = this._subject?.path[0] ?? null;
    let moon: number | null = null;
    try {
      const ll = at ? plLngLat(at) : null;
      const view = this._getView?.();
      const c = view?.center;
      const lng = ll ? ll[0] : (c?.longitude ?? null), lat = ll ? ll[1] : (c?.latitude ?? null);
      if (lng !== null && lat !== null) moon = nightOf(new Date(), lat, lng).moonIllum;
    } catch {
      moon = null;
    }
    return {
      units: this._opts.units,
      gmaDeg: this._opts.gmaDeg,
      hHourMin: parseHHMM(this._opts.hHour),
      echelonWord: ECHELON_WORD[this._opts.echelon],
      moonIllum: moon,
      keys: this._opts.keys,
      R: this._R,
      tanks: this._opts.tanks,
    };
  }

  // ── the chart ──────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Headless: the chart for [lng, lat] points (SP ... FUP) and an objective, waiting for the terrain it needs. */
  async chartFor(lngLats: Array<[number, number]>, objective: [number, number] | null = null, opts: { show?: boolean; timeoutMs?: number } = {}): Promise<NightMarchBrief | null> {
    if (!this._enabled || lngLats.length < 2) return null;
    const path = lngLats.map((p) => toMerc({ longitude: p[0], latitude: p[1] })).filter(Boolean) as MercXY[];
    const obj = objective ? toMerc({ longitude: objective[0], latitude: objective[1] }) : null;
    const s: Subject = { path, objective: obj };
    const t0 = Date.now();
    let b = this._build(s);
    while (b?.chart.pending && Date.now() - t0 < (opts.timeoutMs ?? 10000)) {
      await new Promise((r) => setTimeout(r, 150));
      if (!this._enabled) return null;
      b = this._build(s);
    }
    if (b && opts.show !== false) {
      this._subject = s;
      this._brief = b;
      this._present(true);
    }
    return b;
  }

  /** A placed line becomes the route (its last point the FUP); the objective is asked for on the map unless given. */
  useGraphic(graphic: any, objective: [number, number] | null = null): NightMarchBrief | null {
    const g = graphic?.geometry ?? graphic;
    if (!this._enabled || g?.type !== 'polyline') return null;
    const sr = g.spatialReference;
    const path = (g.paths?.[0] ?? []).map((q: number[]) => toMerc({ x: q[0], y: q[1], spatialReference: sr })).filter(Boolean) as MercXY[];
    if (path.length < 2) return null;
    const obj = objective ? toMerc({ longitude: objective[0], latitude: objective[1] }) : null;
    return this._run({ path, objective: obj }, true);
  }

  canUse(graphic: any): boolean {
    return this._enabled && graphic?.geometry?.type === 'polyline';
  }

  /** Open the chart (on a style), or close it. */
  openChart(open = true, style?: NmStyle): void {
    if (!this._enabled) return;
    if (!open) return this._view.close();
    this._view.update(this._brief, this._north());
    this._view.open(style);
  }

  /** Remove the chart from the map and the screen. */
  clear(): void {
    this._subject = null;
    this._brief = null;
    this._map.clear();
    this._card.hide();
    this._view.update(null, this._north());
  }

  chartText(): string {
    return this._brief ? chartLines(this._brief).join('\n') : '';
  }

  private _run(s: Subject, open: boolean): NightMarchBrief | null {
    if (!this._enabled) return null;
    let b: NightMarchBrief | null = null;
    try {
      b = this._build(s);
    } catch (err) {
      EngineLogger.error(ENGINE, `Chart failed: ${(err as Error)?.message ?? err}`);
      return null;
    }
    if (!b) return null;
    if (this._subject !== s) this._reruns = 0;
    this._subject = s;
    this._brief = b;
    this._present(open);
    return b;
  }

  private _present(open: boolean): void {
    const b = this._brief;
    if (!b) return;
    if (this._opts.map) this._showMap();
    this._view.update(b, this._north());
    if (open) this._view.open();
  }

  private _showMap(): void {
    if (!this._brief) return;
    this._map.show({ chart: this._brief.chart, units: this._opts.units, rings: this._opts.rings, labels: this._opts.labels });
  }

  private _build(s: Subject): NightMarchBrief | null {
    if (s.path.length < 2) return null;
    const probe = this._terrainProbe();
    if (probe) probe.focus(s.path[0][1]);
    const H = parseHHMM(this._opts.hHour);
    const chart = nightMarchChart(
      {
        path: s.path,
        objective: s.objective,
        echelon: this._opts.echelon,
        gmaDeg: this._opts.gmaDeg,
        hHourMin: H,
        terrainKind: this._opts.terrain,
        tanks: this._opts.tanks,
        probe,
        patrolRules: probe ? this._PR : null,
        foot: probe ? probe.going('dismounted') : null,
        speeds: probe ? this._foot() : null,
        classLabel: probe ? (c) => probe.classLabel(c) : undefined,
        scanRoad: probe ? this._scan(probe) : undefined,
      },
      this._R,
    );
    const [lng, lat] = plLngLat(s.path[0]);
    const fupLL = plLngLat(chart.fup.centre);
    // Elevation along the route (terrain only).
    let profile: NightMarchBrief['profile'] = null;
    if (probe && chart.lengthM > 0) {
      profile = [];
      const step = Math.max(25, chart.lengthM / 160);
      for (const lg of chart.legs) {
        const c0 = lg.cumM - lg.distM;
        for (let m = 0; m < lg.distM; m += step) {
          const t = m / lg.distM;
          profile.push({ chainM: c0 + m, elev: probe.elev(lg.from[0] + (lg.to[0] - lg.from[0]) * t, lg.from[1] + (lg.to[1] - lg.from[1]) * t) });
        }
      }
      const last = chart.legs[chart.legs.length - 1];
      if (last) profile.push({ chainM: chart.lengthM, elev: probe.elev(last.to[0], last.to[1]) });
      if (!profile.some((p) => Number.isFinite(p.elev))) profile = null;
    }
    // Tonight's light, and the light through the march when H is set (H before noon: the night ends that morning).
    let tonight: NightMarchBrief['tonight'] = null;
    let lightBand: NightMarchBrief['lightBand'] = null;
    try {
      const now = new Date();
      const n = nightOf(now, lat, lng);
      tonight = { moonlitShare: n.moonlitShare, moonIllum: n.moonIllum, level: n.level, words: `moon ${Math.round(n.moonIllum * 100)}% lit, moonlight ${Math.round(n.moonlitShare * 100)}% of the dark` };
      if (H !== null) {
        const base = new Date(now);
        base.setHours(0, 0, 0, 0);
        const hDate = new Date(base.getTime() + (H < 720 ? 1440 + H : H) * 60000);
        const leave = hDate.getTime() - chart.timing.leaveBeforeH * 60000;
        lightBand = [];
        let prev: string | null = null;
        for (let m = 0; m <= chart.timing.leaveBeforeH; m += 10) {
          const lv = lightAt(new Date(leave + m * 60000), lat, lng).level;
          if (lv !== prev) lightBand.push({ min: m, level: lv });
          prev = lv;
        }
      }
    } catch {
      /* the light is a nicety */
    }
    return {
      chart,
      units: this._opts.units,
      terrainKind: this._opts.terrain,
      gmaDeg: this._opts.gmaDeg,
      grids: { sp: mgrsOf(lng, lat), fup: mgrsOf(fupLL[0], fupLL[1]), obj: s.objective ? mgrsOf(...plLngLat(s.objective)) : null },
      tonight,
      profile,
      lightBand,
      dataLine: probe ? probe.dataLine() : null,
      what: `${ECHELON_WORD[this._opts.echelon]} night march`,
    };
  }

  /** Data arrived: build again what is on screen if it met data still loading (at most MAX_RERUNS times). */
  private _onData(): void {
    if (!this._brief?.chart.pending || this._dataTimer || !this._subject) return;
    if (++this._reruns > MAX_RERUNS) return;
    this._dataTimer = setTimeout(() => {
      this._dataTimer = null;
      if (this._subject && this._brief?.chart.pending) this._run(this._subject, false);
    }, 150);
  }

  // ── keys, pointer, hover ───────────────────────────────────────────────────────────────────────────────────────────

  /** W opens the chart and walks it (next page, then the next style; Shift+W back); Esc closes it first. */
  private _syncKeys(): void {
    const want = this._enabled && this._opts.keys;
    if (!want) return this._detachKeys();
    if (this._keyHandler) return;
    this._keyHandler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        if (!this._view.isOpen) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this._view.close();
        return;
      }
      if (k !== 'w' || e.repeat) return;
      e.preventDefault();
      if (!this._view.isOpen) this.openChart(true);
      else this._view.step(e.shiftKey ? -1 : 1);
    };
    window.addEventListener('keydown', this._keyHandler, true);
  }
  private _detachKeys(): void {
    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler, true);
    this._keyHandler = null;
  }

  private _attachPointer(): void {
    if (this._ptr) return;
    const el = this._getView?.()?.container as HTMLElement | null | undefined;
    if (!el) return;
    const move = (e: PointerEvent) => this._card.moveTo(e.clientX, e.clientY);
    const leave = () => this._card.hide();
    el.addEventListener('pointermove', move, { passive: true });
    el.addEventListener('pointerleave', leave);
    this._ptr = { el, move, leave };
  }
  private _detachPointer(): void {
    if (!this._ptr) return;
    this._ptr.el.removeEventListener('pointermove', this._ptr.move);
    this._ptr.el.removeEventListener('pointerleave', this._ptr.leave);
    this._ptr = null;
  }

  /** The card for the leg under the pointer on a finished route. */
  private _syncHover(): void {
    const want = this._enabled && this._opts.hover && this._opts.card;
    if (!want) {
      this._hoverHandle?.remove();
      this._hoverHandle = null;
      return;
    }
    if (this._hoverHandle) return;
    const view = this._getView?.();
    if (!view?.on) return;
    let shown = false;
    this._hoverHandle = view.on('pointer-move', (e: any) => {
      if (this._draw.active || !this._brief) return;
      const p = view.toMap?.({ x: e.x, y: e.y });
      const q = view.toMap?.({ x: e.x + 12, y: e.y });
      const at = p ? toMerc(p) : null;
      const at2 = q ? toMerc(q) : null;
      if (!at) return;
      const tol = at2 ? Math.max(8, plDist(at, at2)) : 60;
      const on = legAt(this._brief.chart, at, tol, this._R);
      if (on) {
        this._card.showOnLeg(on, this._brief.chart, this._cardCtx(), this._north());
        shown = true;
      } else if (shown) {
        this._card.hide();
        shown = false;
      }
    });
  }

  private _north(): number {
    return screenNorth(this._getView?.());
  }

  private _goTo(x: number, y: number): void {
    const view = this._getView?.();
    if (!view?.goTo) return;
    const sr = view.spatialReference;
    const wk = sr?.wkid ?? sr?.latestWkid;
    const ll = plLngLat([x, y]);
    const target = sr?.isWGS84 || wk === 4326 ? { x: ll[0], y: ll[1], spatialReference: { wkid: 4326 } } : { x, y, spatialReference: { wkid: 102100 } };
    void view.goTo({ target: { type: 'point', ...target } }).catch(() => undefined);
  }

  /** A one-line prompt at the top of the map while drawing (null hides it). */
  private _hint(text: string | null, ms = 0): void {
    if (this._hintTimer) clearTimeout(this._hintTimer);
    this._hintTimer = null;
    let h = document.getElementById(HINT_ID);
    if (!text) {
      h?.remove();
      return;
    }
    if (!h) {
      h = document.createElement('div');
      h.id = HINT_ID;
      h.setAttribute('role', 'status');
      h.style.cssText =
        'position:fixed;left:50%;top:96px;transform:translateX(-50%);z-index:2147482995;pointer-events:none;padding:7px 14px;border-radius:999px;' +
        'background:rgba(20,24,29,.92);border:1px solid #8ec1ea;color:#f1f3f6;font:600 13.5px/1.3 system-ui,Segoe UI,Arial,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.45);white-space:nowrap';
      document.body.appendChild(h);
    }
    h.textContent = `🌙 ${text}`;
    if (ms > 0) this._hintTimer = setTimeout(() => this._hint(null), ms);
  }
}
