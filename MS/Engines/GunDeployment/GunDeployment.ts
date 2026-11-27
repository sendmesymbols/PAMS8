/**
 * GunDeployment.ts
 *
 * Gun Deployment (user, 2026-11-17): find gun areas for a Bty or Regt of a chosen gun, with crest clearance. Off by
 * default (`features.gunDeployment`); the top bar's 🎯 Gun Depl turns it on and opens its panel (docked bottom left).
 *
 *   places   the search circle (Pick, then click the map), the target (Pick, the Ground Guide's threat marker, or the
 *            selected symbol) and the front (the FDL / FLOT drawn on the map, else the threat place);
 *   settings gun (own artillery from the ORBAT, weapons.json), Bty / Regt, Def / Attk, search radius, month;
 *   result   ranked gun areas from the pure finder (GunDeploymentFind.ts) on the terrain bundle (SiteScan/SiteProbe),
 *            each with its rows: Room, Level, Firm, Air, Access, Range, Behind front, Crest (FM 6-50 Angles 1, 2 and an
 *            estimated 4), Avoid; on the map (layer `ms-gun-deployment`): the circle, the areas by verdict, the
 *            selected area's line of fire, its crest, the stretch low-angle fire cannot reach, and its range arcs;
 *   output   Create on Map (a PAA, 2525D 25240502, round the selected area), Copy as Text.
 *
 * It reads the terrain bundle only while it is on (claude_rules.md); without the bundle the panel says so and nothing
 * else changes. Figures in MS/Data/GunDoctrine.json (R / U / E).
 */

import EngineLogger from '../../Support/EngineLogger';
import DOCTRINE from '../../Data/GunDoctrine.json';
import { MovementGuideDraw } from '../MovementGuide/MovementGuideDraw';
import { mgrsOf } from '../PlatoonGuide/PlatoonGuideText';
import { SiteBundle } from '../SiteScan/SiteProbe';
import { SiteMap, arcPts, type MapSpec } from '../SiteScan/SiteMap';
import { SitePanel, siteHint, copyToClipboard, type PanelAction, type PanelControl, type PanelPlace, type PanelReason, type PanelSite, type PanelWhyNot } from '../SiteScan/SitePanel';
import { setSetting } from '../../Support/SettingsBus';
import { MONTHS, dataCatalog, groundDist, lngLatToMerc, mercToLngLat, offsetPt, seasonFor, km, type Season, type Tone, type XY } from '../SiteScan/SiteScan';
import {
  findGunSites,
  gunTaskFor,
  gunLines,
  gunWhyNot,
  type GunWhyNot,
  gunRulesFrom,
  gunWeapons,
  type Front,
  type GunOp,
  type GunResult,
  type GunRules,
  type GunTask,
  type GunUnit,
  type GunWeapon,
} from './GunDeploymentFind';

const ENGINE = 'GunDeployment';
/** Tones from best to worst, for the worst of several. */
const TONE_ORDER: Tone[] = ['ok', 'warn', 'unknown', 'bad'];
const HINT = 'ms-gun-deployment-hint';
const ICON = '🎯';
/** A month is wet from this much rain (the bundle's climate.json thresholds.wetFromMm, WorldClim normals). */
const WET_FROM_MM = 100;
/** Without climate data: the monsoon months (climate.json thresholds.monsoonMonths Jun-Sep, as the Ground Guide's going). */
const FALLBACK_WET = [7, 8, 9];
/** PAA, circular (2525D 25 240502), friendly. */
const PAA_SIDC = '10032500002405020000';

export interface GunDeploymentOptions {
  bundleUrl: string;
  cacheTiles: number;
  useWorker: boolean;
  /** Folder of the ORBAT (weapons.json). */
  orbatUrl: string;
  /** weapons.json id of the gun. */
  weapon: string;
  unit: GunUnit;
  op: GunOp;
  radiusKm: number;
  /** 1-12, or 0 = this month. */
  month: number;
  map: boolean;
  labels: boolean;
  /** Esc closes the panel. */
  keys: boolean;
}

export const DEFAULT_GUN_DEPLOYMENT_OPTIONS: GunDeploymentOptions = {
  bundleUrl: '/terrain-bundle',
  cacheTiles: 384,
  useWorker: true,
  orbatUrl: '/MS/Data/Orbat/PK',
  weapon: '155-mm-how-sp-m109-a2-a5',
  unit: 'bty',
  op: 'def',
  radiusKm: 4,
  month: 0,
  map: true,
  labels: true,
  keys: true,
};

export interface GunDeploymentHost {
  /** The Ground Guide's threat marker as lng / lat, or null. */
  threat?: () => [number, number] | null;
  /** FDL / FLOT lines drawn on the map, Web Mercator. */
  frontLines?: () => XY[][];
  /** The graphics selected on the map. */
  selected?: () => any[];
}

type BundleState = 'off' | 'loading' | 'ready' | 'missing';

function toMerc(p: any): XY | null {
  if (!p) return null;
  const sr = p.spatialReference;
  if (sr?.isWebMercator || [102100, 3857, 102113].includes(sr?.wkid)) return [p.x, p.y];
  if (typeof p.longitude === 'number' && typeof p.latitude === 'number') return lngLatToMerc(p.longitude, p.latitude);
  if (typeof p.x === 'number' && typeof p.y === 'number' && Math.abs(p.x) <= 180 && Math.abs(p.y) <= 90) return lngLatToMerc(p.x, p.y);
  return null;
}

/** The centre of a graphic's geometry, Web Mercator. */
function graphicCentre(g: any): XY | null {
  const geo = g?.geometry;
  if (!geo) return null;
  if (geo.type === 'point') return toMerc(geo);
  const c = geo.extent?.center ?? geo.centroid;
  return c ? toMerc(c) : null;
}

export default class GunDeployment {
  private _opts: GunDeploymentOptions = { ...DEFAULT_GUN_DEPLOYMENT_OPTIONS };
  private _enabled = false;
  private _R: GunRules = gunRulesFrom(DOCTRINE);
  private _getView: () => any;
  private _host: GunDeploymentHost;
  private _bundle: SiteBundle | null = null;
  private _bundleState: BundleState = 'off';
  private _bundleKey = '';
  private _weapons: GunWeapon[] = [];
  private _weaponsState: 'none' | 'loading' | 'ready' | 'failed' = 'none';
  private _centre: XY | null = null;
  private _target: XY | null = null;
  private _targetFrom: 'pick' | 'threat' | 'selected' | null = null;
  private _res: GunResult | null = null;
  /** "Why not here?": the place asked about and its reading (re-read on every run). */
  private _whyNotAt: XY | null = null;
  private _whyNot: GunWhyNot | null = null;
  private _task: GunTask | null = null;
  private _pending = false;
  private _season: { season: Season; why: string } | null = null;
  private _sel = 0;
  /** Which map pick is under way (its panel button is drawn pressed). */
  private _picking: 'centre' | 'target' | 'whyNot' | null = null;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _creator: ((items: any[]) => any[]) | null = null;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _draw: MovementGuideDraw;
  private _map: SiteMap;
  private _panel: SitePanel;

  constructor(getView: () => any, host: GunDeploymentHost = {}) {
    this._getView = getView;
    this._host = host;
    this._draw = new MovementGuideDraw(getView);
    this._map = new SiteMap(getView, 'ms-gun-deployment', 'Gun Deployment');
    this._panel = new SitePanel('ms-gun-deployment-panel', `${ICON} Gun Deployment`, 'left', {
      controls: () => this._controls(),
      setControl: (k, v) => this._setControl(k, v),
      places: () => this._places(),
      actions: () => this._actions(),
      act: (id) => this._act(id),
      headline: () => this._headline(),
      sites: () => this._sites(),
      selected: () => this._sel,
      select: (i) => this.select(i),
      notes: () => this._notes(),
      footer: () => this._footer(),
      close: () => this.openPanel(false),
      leftOut: () => (this._res?.rejectedWhy ?? []).map((r): PanelReason => ({ text: r.text, rules: r.rules })),
      whyNot: () => this._whyNotPanel(),
      summary: () => this._summary(),
      guide: () => this._guide(),
      setupDone: () => !!this._centre,
      clearAct: () => ({ id: 'clearAll', label: 'Clear', title: 'Take the picked places, the result and the drawings off', disabled: !this._centre && !this._target && !this._whyNotAt }),
    });
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────────────────────────────────────────────

  get isEnabled(): boolean {
    return this._enabled;
  }
  get options(): GunDeploymentOptions {
    return { ...this._opts };
  }
  get result(): GunResult | null {
    return this._res;
  }
  get panelOpen(): boolean {
    return this._panel.isOpen;
  }

  setOptions(o: Partial<GunDeploymentOptions>): void {
    this._opts = { ...this._opts, ...Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== null)) } as GunDeploymentOptions;
    if (!this._enabled) return;
    this._bindKeys();
    void this._ensureBundle();
    void this._ensureWeapons();
    this._schedule();
  }

  /** "Create on Map" hands symbols to the host (SymbolEngine.loadSymbolFromJSON, one undo step). */
  setCreator(fn: ((items: any[]) => any[]) | null): void {
    this._creator = fn;
  }

  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    this._bindKeys();
    void this._ensureBundle();
    void this._ensureWeapons();
    EngineLogger.nextStep(ENGINE, 'Gun Deployment on: pick the search circle on the map');
  }

  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    this._draw.cancel(false);
    this._panel.close();
    this._map.clear();
    this._unbindKeys();
    siteHint(HINT, ICON, null);
    this._bundle?.destroy();
    this._bundle = null;
    this._bundleState = 'off';
    this._bundleKey = '';
  }

  destroy(): void {
    this.disable();
    this._panel.destroy();
    this._map.destroy();
  }

  onViewChanged(): void {
    // a pick under way is dropped with the old view: its hint pill and pressed button go with it
    if (this._picking) {
      this._picking = null;
      siteHint(HINT, ICON, null);
      this._render();
    }
    this._draw.cancel(false);
    this._map.destroy();
    if (this._enabled) this._paint();
  }

  openPanel(open = true): void {
    if (!this._enabled) return;
    if (!open) {
      this._panel.close();
      this._draw.cancel(false);
      this._picking = null;
      siteHint(HINT, ICON, null);
      return;
    }
    this._panel.open();
    if (!this._target) this._autoTarget();
    this._schedule();
  }

  togglePanel(): boolean {
    this.openPanel(!this._panel.isOpen);
    return this._panel.isOpen;
  }

  // ── data ──────────────────────────────────────────────────────────────────────────────────────────────────────────

  private async _ensureBundle(): Promise<void> {
    const base = String(this._opts.bundleUrl || '').replace(/\/+$/, '');
    const key = `${base}|${this._opts.cacheTiles}|${this._opts.useWorker}`;
    if (this._bundleKey === key && this._bundle) return;
    this._bundle?.destroy();
    this._bundleKey = key;
    if (!base) {
      this._bundle = null;
      this._bundleState = 'missing';
      this._render();
      return;
    }
    const b = new SiteBundle(() => this._onData());
    this._bundle = b;
    this._bundleState = 'loading';
    this._render();
    const ok = await b.configure(base, { cacheTiles: this._opts.cacheTiles, useWorker: this._opts.useWorker });
    if (this._bundle !== b) return;
    this._bundleState = ok ? 'ready' : 'missing';
    if (!ok) EngineLogger.error(ENGINE, `No terrain bundle at ${base}: gun areas need terrain data`);
    this._schedule();
  }

  private async _ensureWeapons(): Promise<void> {
    if (this._weaponsState === 'ready' || this._weaponsState === 'loading') return;
    this._weaponsState = 'loading';
    try {
      const base = String(this._opts.orbatUrl || '').replace(/\/+$/, '');
      const r = await fetch(`${base}/weapons.json`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      this._weapons = gunWeapons(await r.json(), this._R.planFrac.value);
      this._weaponsState = this._weapons.length ? 'ready' : 'failed';
    } catch (err) {
      this._weaponsState = 'failed';
      EngineLogger.error(ENGINE, `ORBAT weapons not read (${(err as Error)?.message ?? err}): pick a gun from the list once it loads`);
    }
    this._schedule();
  }

  private _onData(): void {
    if (this._enabled && this._pending) this._schedule(250);
  }

  private _weapon(): GunWeapon | null {
    return this._weapons.find((w) => w.id === this._opts.weapon) ?? this._weapons.find((w) => w.type === 'how') ?? this._weapons[0] ?? null;
  }

  /** The search radius as the finder uses it (and as the map draws it). */
  private _radiusM(): number {
    return Math.max(500, Math.min(20000, Number(this._opts.radiusKm) * 1000 || 4000));
  }

  private _month(): number {
    const m = Number(this._opts.month);
    return m >= 1 && m <= 12 ? Math.floor(m) : new Date().getMonth() + 1;
  }

  private _front(): Front | null {
    const lines = (this._host.frontLines?.() ?? []).filter((r) => r.length >= 2);
    if (lines.length) return { kind: 'line', runs: lines, label: lines.length > 1 ? `the FDL (${lines.length} lines)` : 'the FDL' };
    const t = this._host.threat?.();
    if (t) return { kind: 'point', runs: [[lngLatToMerc(t[0], t[1])]], label: 'the threat place' };
    return null;
  }

  private _autoTarget(): void {
    const t = this._host.threat?.();
    if (t) {
      this._target = lngLatToMerc(t[0], t[1]);
      this._targetFrom = 'threat';
    }
  }

  // ── running ───────────────────────────────────────────────────────────────────────────────────────────────────────

  private _schedule(ms = 40): void {
    if (!this._enabled) return;
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._timer = null;
      this._run();
    }, ms);
  }

  /** Work the gun areas out now (also done on every change). */
  find(): GunResult | null {
    this._run();
    return this._res;
  }

  private _run(): void {
    if (!this._enabled) return;
    const W = this._weapon();
    const b = this._bundle;
    if (!this._centre || !W || !b || this._bundleState !== 'ready') {
      this._res = null;
      this._task = null;
      this._pending = false;
      this._paint();
      this._render();
      return;
    }
    const month = this._month();
    const prec = b.precAt(this._centre[0], this._centre[1]);
    this._season = seasonFor(month, prec, WET_FROM_MM, FALLBACK_WET);
    // the front is read off the map's graphics: once a run, not once for each use below
    const front = this._front();
    const task: GunTask = {
      centre: this._centre,
      radiusM: this._radiusM(),
      target: this._target,
      front,
      weapon: W,
      unit: this._opts.unit,
      op: this._opts.op,
      season: this._season.season,
      month,
      data: dataCatalog(b.manifest),
      inputs: {
        target: this._target ? (this._targetFrom === 'threat' ? "the Ground Guide's threat marker" : this._targetFrom === 'selected' ? 'the selected symbol on the map' : 'picked on the map') : undefined,
        front: front?.kind === 'line' ? `${front.label}, drawn on the map (FEBA / FLOT symbols)` : front ? "the Ground Guide's threat marker (no FDL drawn)" : undefined,
        centre: 'picked on the map',
      },
      seasonWhy: this._season.why,
      wetFromMm: WET_FROM_MM,
    };
    b.begin();
    let res: GunResult | null = null;
    // towed guns on mountain ground go by section (MW pp 240, 244): the circle read as mountains or not
    const t2 = gunTaskFor(b, task, this._R);
    try {
      res = findGunSites(b, b.rules, t2, this._R, (x, y) => b.standing(x, y, month));
    } catch (err) {
      EngineLogger.error(ENGINE, `Gun areas not worked out: ${(err as Error)?.message ?? err}`);
    }
    this._whyNot = null;
    if (res && this._whyNotAt) {
      try {
        this._whyNot = gunWhyNot(b, b.rules, t2, this._R, this._whyNotAt, res.sites[0] ?? null, (x, y) => b.standing(x, y, month));
      } catch (err) {
        EngineLogger.error(ENGINE, `Why not here? not read: ${(err as Error)?.message ?? err}`);
      }
    }
    this._pending = b.pending() || (prec === null && b.climateLoading);
    if (res) res.pending = this._pending;
    this._res = res;
    this._task = t2;
    if (this._sel >= (res?.sites.length ?? 0)) this._sel = 0;
    this._paint();
    this._render();
  }

  select(i: number): void {
    this._sel = Math.max(0, Math.min(i, (this._res?.sites.length ?? 1) - 1));
    const s = this._res?.sites[this._sel];
    if (s) this._goTo(s.at);
    this._paint();
    this._render();
  }

  // ── picks ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Click the map for the centre of the search circle. */
  pickCentre(): void {
    this._pick('centre', 'Click roughly where the guns should go (the search circle\'s centre). Esc cancels', (p) => {
      this._centre = p;
      if (!this._target) this._autoTarget();
    });
  }

  /** Click any place: it is read with the same gates and checks, and the panel says why it is not in the list. */
  pickWhyNot(): void {
    this._pick('whyNot', 'Click the place you want explained: the same checks, and the rule that left it out. Esc cancels', (p) => {
      this._whyNotAt = p;
    });
  }

  /** "Why not here?" for a place (Web Mercator, or lng / lat when `lngLat`); null clears it. Read on the next run. */
  setWhyNot(at: [number, number] | null, o: { lngLat?: boolean } = {}): void {
    this._whyNotAt = at ? (o.lngLat ? lngLatToMerc(at[0], at[1]) : [at[0], at[1]]) : null;
    this._schedule();
  }

  get whyNotReading(): GunWhyNot | null {
    return this._whyNot;
  }

  /** Click the map for the target. */
  pickTarget(): void {
    this._pick('target', 'Click the target (the centre of the area the fire is wanted on). Esc cancels', (p) => {
      this._target = p;
      this._targetFrom = 'pick';
    });
  }

  /** Set the places from code (Web Mercator, or lng / lat when `lngLat`). */
  setPlaces(p: { centre?: [number, number] | null; target?: [number, number] | null; lngLat?: boolean }): void {
    const conv = (q: [number, number] | null | undefined): XY | null => (q ? (p.lngLat ? lngLatToMerc(q[0], q[1]) : [q[0], q[1]]) : null);
    if (p.centre !== undefined) this._centre = conv(p.centre);
    if (p.target !== undefined) {
      this._target = conv(p.target);
      this._targetFrom = this._target ? 'pick' : null;
    }
    this._schedule();
  }

  private _pick(what: 'centre' | 'target' | 'whyNot', prompt: string, done: (p: XY) => void): void {
    if (!this._enabled) return;
    // a pick under way is dropped quietly by `start`, so the new one is the only one pressed
    this._picking = what;
    this._draw.start({
      kind: 'point',
      prompt,
      onStatus: (t) => siteHint(HINT, ICON, t),
      onCancel: () => {
        this._picking = null;
        siteHint(HINT, ICON, null);
        this._render();
      },
      onDone: (pts) => {
        this._picking = null;
        siteHint(HINT, ICON, null);
        if (pts[0]) done([pts[0][0], pts[0][1]]);
        this._schedule();
      },
    });
    this._render();
  }

  // ── output ────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** The selected (or `i`-th) gun area as a PAA on the map. Returns how many symbols were made. */
  createOnMap(i = this._sel): number {
    const s = this._res?.sites[i];
    if (!s || !this._creator) {
      if (!this._creator) siteHint(HINT, ICON, 'Create on Map is not wired in this host', 2200);
      return 0;
    }
    const area = this._res!.area;
    const r = Math.max(area.frontM.value, area.depthM.value) / 2;
    const edge = offsetPt(s.at[0], s.at[1], s.axisDeg + 90, r);
    const sidc = PAA_SIDC;
    const W = this._task?.weapon;
    const mp = (p: XY) => ({ x: p[0], y: p[1], spatialReference: { wkid: 102100 } });
    const item = {
      sidc,
      amplifier: { SIDC: sidc, UNIQUE_DESIG: `${this._opts.unit === 'regt' ? 'Regt' : 'Bty'} ${s.rank}${W ? ` ${W.name.split(' (')[0]}` : ''}` },
      drawEssentials: { SYM_GEO_TYPE: 'Area', CTRL_PTS: [mp(s.at), mp(edge)] },
    };
    const made = this._creator([item]).filter(Boolean).length;
    siteHint(HINT, ICON, made ? `Gun area ${s.rank} made as a PAA: edit, save or undo it like any other symbol` : 'The PAA could not be made', 2600);
    if (made) EngineLogger.success(ENGINE, `Gun area ${s.rank} created on the map`);
    return made;
  }

  text(): string {
    if (!this._res || !this._task) return '';
    return gunLines(this._res, this._task, (p) => this._grid(p), this._bundle?.dataLine() ?? '', this._whyNot).join('\n');
  }

  async copyText(): Promise<boolean> {
    const t = this.text();
    if (!t) return false;
    if (await copyToClipboard(t)) {
      siteHint(HINT, ICON, 'Gun areas copied as text', 1800);
      return true;
    }
    siteHint(HINT, ICON, 'Copy failed: the browser refused the clipboard', 2200);
    return false;
  }

  private _grid(p: XY): string {
    const [lng, lat] = mercToLngLat(p[0], p[1]);
    try {
      return mgrsOf(lng, lat);
    } catch {
      return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
  }

  private _goTo(p: XY): void {
    const view = this._getView();
    if (!view) return;
    const [lng, lat] = mercToLngLat(p[0], p[1]);
    void view.goTo({ center: [lng, lat], zoom: Math.max(view.zoom ?? 10, 13) }).catch(() => undefined);
  }

  // ── panel ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  private _controls(): PanelControl[] {
    const ws = this._weapons;
    const W = this._weapon();
    return [
      {
        key: 'weapon',
        label: 'Gun',
        type: 'select',
        value: W?.id ?? '',
        options: ws.length ? ws.map((w) => ({ value: w.id, label: `${w.name} (${km(w.maxM, 1)})` })) : [{ value: '', label: this._weaponsState === 'loading' ? 'Loading ORBAT…' : 'ORBAT not read' }],
        title: 'Own artillery from the ORBAT (SO\'s Handbook Sec 2): planning range 90 % of max',
        wide: true,
      },
      { key: 'unit', label: 'Area for', type: 'select', value: this._opts.unit, options: [{ value: 'bty', label: 'Bty' }, { value: 'regt', label: 'Regt' }], title: `The gun area to fit: Bty ${Math.round(this._R.areas.bty.frontM.value)} x ${Math.round(this._R.areas.bty.depthM.value)} m, Regt ${Math.round(this._R.areas.regt.frontM.value)} x ${Math.round(this._R.areas.regt.depthM.value)} m` },
      { key: 'op', label: 'Task', type: 'select', value: this._opts.op, options: [{ value: 'def', label: 'Def' }, { value: 'attk', label: 'Attk' }], title: 'How far behind the front the guns may stand' },
      { key: 'radiusKm', label: 'Look within', type: 'number', value: this._opts.radiusKm, min: 1, max: 20, step: 0.5, unit: 'km', title: 'How far round the picked place gun areas are looked for' },
      {
        key: 'month',
        label: 'Month',
        type: 'select',
        value: String(this._opts.month || 0),
        options: [{ value: '0', label: `This month (${MONTHS[new Date().getMonth()]})` }, ...MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))],
        title: 'The soil after rain or dry, and what grows on the ground, by month',
      },
    ];
  }

  private _setControl(k: string, v: string): void {
    const patch: Partial<GunDeploymentOptions> = {};
    if (k === 'weapon') patch.weapon = v;
    else if (k === 'unit') patch.unit = v === 'regt' ? 'regt' : 'bty';
    else if (k === 'op') patch.op = v === 'attk' ? 'attk' : 'def';
    else if (k === 'radiusKm') patch.radiusKm = Math.max(1, Math.min(20, Number(v) || this._opts.radiusKm));
    else if (k === 'month') patch.month = Math.max(0, Math.min(12, Number(v) || 0));
    this.setOptions(patch);
    // The panel's settings are the same ones Ctrl+K and the gear show. Write them back, or the next change made there
    // would put the old value back (the host re-applies the whole settings tree on every change).
    for (const [key, val] of Object.entries(patch)) setSetting(['gunDeployment', key], val);
  }

  private _places(): PanelPlace[] {
    const f = this._front();
    const sel = (this._host.selected?.() ?? []).length;
    return [
      {
        label: 'Look round',
        value: this._centre ? `${this._grid(this._centre)} (${km(this._radiusM(), 1)})` : 'not picked',
        set: !!this._centre,
        buttons: [{ id: 'pickCentre', label: this._centre ? 'Move' : 'Pick', title: 'Click the map where the guns should go roughly', on: this._picking === 'centre' }],
      },
      {
        label: 'Target',
        value: this._target ? `${this._grid(this._target)}${this._targetFrom === 'threat' ? ' (threat marker)' : this._targetFrom === 'selected' ? ' (selected symbol)' : ''}` : 'none: range and crest not checked',
        set: !!this._target,
        buttons: [
          { id: 'pickTarget', label: this._target ? 'Move' : 'Pick', title: 'Click the target on the map', on: this._picking === 'target' },
          ...(this._host.threat?.() ? [{ id: 'threatTarget', label: 'Threat', title: 'The Ground Guide\'s threat marker', on: this._targetFrom === 'threat' }] : []),
          ...(sel ? [{ id: 'selTarget', label: 'Selected', title: 'The selected symbol', on: this._targetFrom === 'selected' }] : []),
          ...(this._target ? [{ id: 'clearTarget', label: '✕', title: 'No target' }] : []),
        ],
      },
      { label: 'Front', value: f ? f.label : 'none (draw the FDL or mark the threat)', set: !!f, buttons: [] },
    ];
  }

  private _actions(): PanelAction[] {
    const has = !!this._res?.sites.length;
    return [
      { id: 'pickCentre', label: this._centre ? 'Look elsewhere' : 'Pick gun area', primary: !this._centre, on: this._picking === 'centre', title: 'Click the map where the guns should go roughly' },
      { id: 'whyNot', label: 'Why not here?', disabled: !this._res, on: this._picking === 'whyNot', title: 'Click any place: it is read with the same checks, and you get the rule (book and page) that left it out or put it lower' },
      { id: 'create', label: 'Create on Map', output: true, disabled: !has, title: 'The selected gun area as a PAA symbol (2525D), one undo step' },
      { id: 'copy', label: 'Copy as Text', output: true, disabled: !has, title: 'The decision record: every site with its checks, why it is where it is, the places left out, and every rule cited with book, page and words' },
    ];
  }

  /** The setup in one line, for the folded setup and the folded panel. */
  private _summary(): string {
    const W = this._weapon();
    return [W ? W.name.split(' (')[0] : '', this._opts.unit === 'regt' ? 'Regt' : 'Bty', this._opts.op === 'attk' ? 'Attk' : 'Def', km(this._radiusM(), 1), MONTHS[this._month() - 1]].filter(Boolean).join(' · ');
  }

  /** What to do, while there is no result to show. */
  private _guide(): string[] {
    if (this._bundleState === 'missing') return ['The terrain bundle is not there: Gun Deployment reads the ground from it. Check the Terrain bundle URL in the gear settings.'];
    return [
      'Pick the gun (above) and Bty or Regt.',
      'Pick where to look: click the map roughly where the guns should go.',
      'Give the target: Pick it, or use the Ground Guide threat marker or the selected symbol. Without one, range and crest are not checked.',
      'Draw the FDL (FEBA / FLOT line) to have the distance behind the front checked.',
    ];
  }

  private _act(id: string): void {
    if (id === 'clearAll') {
      this._centre = null;
      this._target = null;
      this._targetFrom = null;
      this._whyNotAt = null;
      this._whyNot = null;
      this._sel = 0;
      this._draw.cancel(false);
      this._picking = null;
      siteHint(HINT, ICON, null);
      this._schedule();
    } else if (id === 'pickCentre') this.pickCentre();
    else if (id === 'pickTarget') this.pickTarget();
    else if (id === 'threatTarget') {
      this._autoTarget();
      this._schedule();
    } else if (id === 'selTarget') {
      const g = (this._host.selected?.() ?? [])[0];
      const c = graphicCentre(g);
      if (c) {
        this._target = c;
        this._targetFrom = 'selected';
        this._schedule();
      }
    } else if (id === 'clearTarget') {
      this._target = null;
      this._targetFrom = null;
      this._schedule();
    } else if (id === 'whyNot') this.pickWhyNot();
    else if (id === 'clearWhyNot') {
      this._whyNotAt = null;
      this._whyNot = null;
      this._paint();
      this._render();
    } else if (id === 'create') this.createOnMap();
    else if (id === 'copy') void this.copyText();
  }

  private _headline(): { tone: Tone | 'idle'; text: string } {
    if (this._bundleState === 'loading') return { tone: 'idle', text: 'Opening the terrain data…' };
    if (this._bundleState === 'missing') return { tone: 'unknown', text: 'Needs terrain data: no terrain bundle at this address' };
    if (this._weaponsState === 'loading') return { tone: 'idle', text: 'Reading the ORBAT…' };
    if (!this._weapon()) return { tone: 'unknown', text: 'No gun: the ORBAT weapons were not read' };
    if (!this._centre) return { tone: 'idle', text: 'Pick where to look for gun areas' };
    const r = this._res;
    if (!r) return { tone: 'idle', text: 'Working out…' };
    if (this._pending) return { tone: 'idle', text: `Reading the ground… (${r.sites.length} so far)` };
    if (!r.sites.length) return { tone: 'bad', text: 'No gun area in this circle' };
    const best = r.sites[0];
    const good = r.sites.filter((s) => s.tone === 'ok').length;
    if (r.btys) {
      // mountains, towed guns: by sections (MW p 244)
      const t = r.btys.map((g) => `${g.label === 'The Bty' ? 'Bty' : g.label} in ${g.sites.length}`).join(', ');
      return { tone: r.btys.reduce<Tone>((w, g) => (TONE_ORDER.indexOf(g.tone) > TONE_ORDER.indexOf(w) ? g.tone : w), 'ok'), text: `Mountains: by sections (MW p 244), ${t} section site${r.sites.length > 1 ? 's' : ''}; ${good} of ${r.sites.length} clean` };
    }
    return { tone: best.tone, text: good ? `${good} good gun area${good > 1 ? 's' : ''} of ${r.sites.length}; best: ${best.verdict}` : `${r.sites.length} gun areas, none clean; best: ${best.verdict}` };
  }

  private _sites(): PanelSite[] {
    const btys = this._res?.btys ?? [];
    return (this._res?.sites ?? []).map((s) => ({
      rank: s.rank,
      grid: this._grid(s.at),
      verdict: s.verdict,
      tone: s.tone,
      score: s.score,
      // by sections: the Bty's row leads its first section's rows
      rows: [...btys.filter((g) => g.sites[0] === s).map((g) => g.row), ...s.rows].map((r) => ({ label: r.label, value: r.value, tone: r.tone, why: r.why, fix: r.fix, rules: r.rules })),
      why: s.why,
      whyRules: this._res?.orderRules,
    }));
  }

  private _whyNotPanel(): PanelWhyNot | null {
    const w = this._whyNot;
    if (!w) return null;
    return {
      grid: this._grid(w.at),
      verdict: w.verdict,
      tone: w.gates.length ? 'bad' : (w.site?.tone ?? 'unknown'),
      gates: w.gates.map((g) => ({ text: g.text, rules: g.rules })),
      vsBest: w.vsBest,
      rows: (w.site?.rows ?? []).map((r) => ({ label: r.label, value: r.value, tone: r.tone, why: r.why, fix: r.fix, rules: r.rules })),
      clearAct: 'clearWhyNot',
    };
  }

  private _notes(): string[] {
    const n = [...(this._res?.notes ?? [])];
    if (this._season && this._centre) n.push(`Ground state: ${this._season.season === 'wet' ? 'after rain' : 'dry'} (${this._season.why}).`);
    if (this._res?.sites.length) n.push('Crest figures are estimates from 30 m elevation: confirm the minimum QE with the firing tables and on the ground.');
    return n;
  }

  private _footer(): string {
    const d = this._bundle?.dataLine();
    return d ? `Data: ${d}. Figures: GunDoctrine.json (SO's Hbk Sec 2, FM 6-50)` : 'Figures: GunDoctrine.json (SO\'s Hbk Sec 2, FM 6-50)';
  }

  private _render(): void {
    this._panel.render();
  }

  // ── map ───────────────────────────────────────────────────────────────────────────────────────────────────────────

  private _paint(): void {
    if (!this._enabled || !this._opts.map) {
      this._map.clear();
      return;
    }
    const spec: MapSpec = { circle: null, polys: [], lines: [], marks: [] };
    if (this._centre) {
      spec.circle = { at: this._centre, radiusM: this._radiusM(), label: 'Gun area search' };
      spec.marks.push({ at: this._centre, kind: 'centre' });
    }
    if (this._target) spec.marks.push({ at: this._target, kind: 'target', label: 'Tgt' });
    const r = this._res;
    const W = this._task?.weapon;
    for (const [i, s] of (r?.sites ?? []).entries()) spec.polys.push({ ring: s.ring, tone: s.tone, selected: i === this._sel, label: `${s.rank}` });
    if (this._whyNot?.site) spec.polys.push({ ring: this._whyNot.site.ring, tone: this._whyNot.gates.length ? 'bad' : this._whyNot.site.tone, selected: false, label: 'Why not?' });
    else if (this._whyNotAt) spec.marks.push({ at: this._whyNotAt, kind: 'site', label: 'Why not?' });
    const s = r?.sites[this._sel];
    if (s && this._target && W) {
      spec.lines.push({ pts: [s.at, this._target], rgb: [241, 243, 246], width: 1.4, dash: true, label: `${km(groundDist(s.at, this._target))}` });
      const c = s.crest;
      if (c && c.siteMils > 0) {
        spec.marks.push({ at: c.at, kind: 'crest', label: `Crest A1+A2 ${c.a1Mils + c.a2Mils} mils` });
        const masked = c.masksAll ? W.maxM : c.lowMinRangeM;
        if (masked && masked > c.distM) {
          const toM = Math.min(masked, groundDist(s.at, this._target) + 2000, W.maxM);
          const a = offsetPt(s.at[0], s.at[1], s.axisDeg, c.distM);
          const b = offsetPt(s.at[0], s.at[1], s.axisDeg, toM);
          spec.lines.push({ pts: [a, b], rgb: [229, 72, 77], width: 4, label: c.masksAll ? 'Masked: low angle' : `Masked low angle to ${km(masked)}` });
        }
      }
      spec.lines.push({ pts: arcPts(s.at, W.planM, s.axisDeg, 60), rgb: [142, 193, 234], width: 1.6, label: `Plan rg ${km(W.planM)}` });
      spec.lines.push({ pts: arcPts(s.at, W.maxM, s.axisDeg, 60), rgb: [142, 193, 234], width: 1, dash: true, label: `Max rg ${km(W.maxM)}` });
      if (W.minM > 0) spec.lines.push({ pts: arcPts(s.at, W.minM, s.axisDeg, 60), rgb: [229, 72, 77], width: 1.2, dash: true, label: `Min rg ${km(W.minM)}` });
    }
    this._map.draw(spec, this._opts.labels);
  }

  // ── keys ──────────────────────────────────────────────────────────────────────────────────────────────────────────

  private _bindKeys(): void {
    this._unbindKeys();
    if (!this._opts.keys) return;
    this._keyHandler = (e: KeyboardEvent) => {
      if (!this._enabled || e.key !== 'Escape' || !this._panel.isOpen || this._draw.active) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      this.openPanel(false);
    };
    window.addEventListener('keydown', this._keyHandler);
  }

  private _unbindKeys(): void {
    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler);
    this._keyHandler = null;
  }
}
