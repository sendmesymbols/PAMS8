/**
 * AdminArea.ts
 *
 * Admin Area (user, 2026-11-17): find ground for admin areas and echelons: Unit Ech (A / B Ech harbour), Bde Admin Area,
 * Div Admin Area, Replenishment Point, Amn / Sup / POL Pt, ADS. Off by default (`features.adminArea`); the top bar's
 * 🏕 Admin Area turns it on and opens its panel (docked bottom right).
 *
 *   places   the search circle (Pick, then click the map), the threat place (the Ground Guide's threat marker, or Pick)
 *            and the own front (the FDL / FLOT drawn on the map, else the threat place);
 *   settings kind, operation (Def / Adv / Wdr: the DAA's distance), month (firm and flood-free in it), the enemy gun the
 *            area must be clear of (ORBAT weapons.json, side en; field / medium / mortar by kind), where his guns stand
 *            behind the threat place, vehicles (sizes the area at 50 veh per km², SOH Sec 10 p 1054), search radius;
 *   result   ranked sites from the pure finder (AdminAreaFind.ts) on the terrain bundle (SiteScan/SiteProbe), each with
 *            its rows: Beyond en guns, Behind front (DAA), Firm, Flood / drainage, Room, Hidden from air, Road, Avoid,
 *            Water, Pucca bldg, Evac Rd, People; on the map (layer `ms-admin-area`): the circle, the sites by verdict,
 *            the enemy gun's reach from the threat place, the selected site's way to its road;
 *   output   Create on Map (2525D Regimental / Brigade / Division Support Area, or the catalog's point symbol for RP, AP
 *            and ADS), Copy as Text.
 *
 * It reads the terrain bundle only while it is on (claude_rules.md). Figures in MS/Data/AdminDoctrine.json (R / U / E).
 */

import EngineLogger from '../../Support/EngineLogger';
import DOCTRINE from '../../Data/AdminDoctrine.json';
import { MovementGuideDraw } from '../MovementGuide/MovementGuideDraw';
import { mgrsOf } from '../PlatoonGuide/PlatoonGuideText';
import { SiteBundle } from '../SiteScan/SiteProbe';
import { SiteMap, arcPts, type MapSpec } from '../SiteScan/SiteMap';
import { SitePanel, siteHint, copyToClipboard, type PanelAction, type PanelControl, type PanelPlace, type PanelReason, type PanelSite, type PanelWhyNot } from '../SiteScan/SitePanel';
import { setSetting } from '../../Support/SettingsBus';
import { MONTHS, bearingOf, dataCatalog, lngLatToMerc, mercToLngLat, seasonFor, km, metres, type Season, type Tone, type XY } from '../SiteScan/SiteScan';
import {
  ADMIN_KINDS,
  adminLines,
  adminWhyNot,
  type AdminWhyNot,
  adminRulesFrom,
  adminSize,
  enemyGuns,
  findAdminSites,
  gunFor,
  type AdminKind,
  type AdminOp,
  type AdminResult,
  type AdminRules,
  type AdminTask,
  type EnemyGun,
} from './AdminAreaFind';

const ENGINE = 'AdminArea';
const HINT = 'ms-admin-area-hint';
const ICON = '🏕';
/** A month is wet from this much rain (the bundle's climate.json thresholds.wetFromMm, WorldClim normals). */
const WET_FROM_MM = 100;
/** Without climate data: the monsoon months, as the Ground Guide's going. */
const FALLBACK_WET = [7, 8, 9];

export interface AdminAreaOptions {
  bundleUrl: string;
  cacheTiles: number;
  useWorker: boolean;
  orbatUrl: string;
  kind: AdminKind;
  op: AdminOp;
  /** 1-12, or 0 = this month. */
  month: number;
  /** weapons.json id of the enemy gun to be clear of; '' = the kind's default (field / medium / mortar). */
  enemyGun: string;
  /** Where his guns stand behind the threat place, km (0 = measured from the threat place itself). */
  gunDepthKm: number;
  /** 0 = the kind's area from the doctrine; else the area for this many vehicles. */
  vehicles: number;
  /** 0 = the kind's search radius from the doctrine. */
  radiusKm: number;
  map: boolean;
  labels: boolean;
  keys: boolean;
}

export const DEFAULT_ADMIN_AREA_OPTIONS: AdminAreaOptions = {
  bundleUrl: '/terrain-bundle',
  cacheTiles: 384,
  useWorker: true,
  orbatUrl: '/MS/Data/Orbat/PK',
  kind: 'baa',
  op: 'def',
  month: 0,
  enemyGun: '',
  gunDepthKm: 0,
  vehicles: 0,
  radiusKm: 0,
  map: true,
  labels: true,
  keys: true,
};

export interface AdminAreaHost {
  /** The Ground Guide's threat marker as lng / lat, or null. */
  threat?: () => [number, number] | null;
  /** FDL / FLOT lines drawn on the map, Web Mercator. */
  frontLines?: () => XY[][];
}

type BundleState = 'off' | 'loading' | 'ready' | 'missing';

/** SIDC from a Symbols.json key (symbol set + entity), friendly (as the Movement Guide's `sidcOf`). */
function sidcOf(key: string): string {
  return `1003${key.slice(0, 2)}0000${key.slice(2)}0000`;
}

export default class AdminArea {
  private _opts: AdminAreaOptions = { ...DEFAULT_ADMIN_AREA_OPTIONS };
  private _enabled = false;
  private _R: AdminRules = adminRulesFrom(DOCTRINE);
  private _getView: () => any;
  private _host: AdminAreaHost;
  private _bundle: SiteBundle | null = null;
  private _bundleState: BundleState = 'off';
  private _bundleKey = '';
  private _guns: EnemyGun[] = [];
  private _gunsState: 'none' | 'loading' | 'ready' | 'failed' = 'none';
  private _centre: XY | null = null;
  private _threat: XY | null = null;
  private _threatFrom: 'marker' | 'pick' | null = null;
  private _res: AdminResult | null = null;
  /** "Why not here?": the place asked about and its reading (re-read on every run). */
  private _whyNotAt: XY | null = null;
  private _whyNot: AdminWhyNot | null = null;
  private _task: AdminTask | null = null;
  private _pending = false;
  private _season: { season: Season; why: string } | null = null;
  private _sel = 0;
  /** Which map pick is under way (its panel button is drawn pressed). */
  private _picking: 'centre' | 'threat' | 'whyNot' | null = null;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _creator: ((items: any[]) => any[]) | null = null;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _draw: MovementGuideDraw;
  private _map: SiteMap;
  private _panel: SitePanel;

  constructor(getView: () => any, host: AdminAreaHost = {}) {
    this._getView = getView;
    this._host = host;
    this._draw = new MovementGuideDraw(getView);
    this._map = new SiteMap(getView, 'ms-admin-area', 'Admin Area');
    this._panel = new SitePanel('ms-admin-area-panel', `${ICON} Admin Area`, 'right', {
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
      clearAct: () => ({ id: 'clearAll', label: 'Clear', title: 'Take the picked places, the result and the drawings off', disabled: !this._centre && !this._threat && !this._whyNotAt }),
    });
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────────────────────────────────────────────

  get isEnabled(): boolean {
    return this._enabled;
  }
  get options(): AdminAreaOptions {
    return { ...this._opts };
  }
  get result(): AdminResult | null {
    return this._res;
  }
  get panelOpen(): boolean {
    return this._panel.isOpen;
  }

  setOptions(o: Partial<AdminAreaOptions>): void {
    this._opts = { ...this._opts, ...Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== null)) } as AdminAreaOptions;
    if (!ADMIN_KINDS.includes(this._opts.kind)) this._opts.kind = 'baa';
    if (!this._enabled) return;
    this._bindKeys();
    void this._ensureBundle();
    void this._ensureGuns();
    this._schedule();
  }

  setCreator(fn: ((items: any[]) => any[]) | null): void {
    this._creator = fn;
  }

  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    this._bindKeys();
    void this._ensureBundle();
    void this._ensureGuns();
    EngineLogger.nextStep(ENGINE, 'Admin Area on: pick the search circle on the map');
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
      this._panel.render();
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
    if (!this._threat) this._markerThreat();
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
      this._panel.render();
      return;
    }
    const b = new SiteBundle(() => this._onData());
    this._bundle = b;
    this._bundleState = 'loading';
    this._panel.render();
    const ok = await b.configure(base, { cacheTiles: this._opts.cacheTiles, useWorker: this._opts.useWorker });
    if (this._bundle !== b) return;
    this._bundleState = ok ? 'ready' : 'missing';
    if (!ok) EngineLogger.error(ENGINE, `No terrain bundle at ${base}: admin areas need terrain data`);
    this._schedule();
  }

  private async _ensureGuns(): Promise<void> {
    if (this._gunsState === 'ready' || this._gunsState === 'loading') return;
    this._gunsState = 'loading';
    try {
      const base = String(this._opts.orbatUrl || '').replace(/\/+$/, '');
      const r = await fetch(`${base}/weapons.json`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      this._guns = enemyGuns(await r.json());
      this._gunsState = this._guns.length ? 'ready' : 'failed';
    } catch (err) {
      this._gunsState = 'failed';
      EngineLogger.error(ENGINE, `ORBAT weapons not read (${(err as Error)?.message ?? err}): the enemy guns' reach is not checked`);
    }
    this._schedule();
  }

  private _onData(): void {
    if (this._enabled && this._pending) this._schedule(250);
  }

  private _month(): number {
    const m = Number(this._opts.month);
    return m >= 1 && m <= 12 ? Math.floor(m) : new Date().getMonth() + 1;
  }

  private _gun(): EnemyGun | null {
    return gunFor(this._guns, this._R.kinds[this._opts.kind].beyond.value, this._R, this._opts.enemyGun || null);
  }

  private _markerThreat(): void {
    const t = this._host.threat?.();
    if (t) {
      this._threat = lngLatToMerc(t[0], t[1]);
      this._threatFrom = 'marker';
    }
  }

  private _front(): { runs: XY[][]; label: string } | null {
    const lines = (this._host.frontLines?.() ?? []).filter((r) => r.length >= 2);
    if (lines.length) return { runs: lines, label: lines.length > 1 ? `the FDL (${lines.length} lines)` : 'the FDL' };
    if (this._threat) return { runs: [[this._threat]], label: 'the threat place' };
    return null;
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

  find(): AdminResult | null {
    this._run();
    return this._res;
  }

  private _radiusM(): number {
    const r = Number(this._opts.radiusKm);
    return r > 0 ? Math.min(30000, r * 1000) : this._R.kinds[this._opts.kind].radiusM;
  }

  private _run(): void {
    if (!this._enabled) return;
    const b = this._bundle;
    if (!this._centre || !b || this._bundleState !== 'ready') {
      this._res = null;
      this._task = null;
      this._pending = false;
      this._paint();
      this._panel.render();
      return;
    }
    const month = this._month();
    const prec = b.precAt(this._centre[0], this._centre[1]);
    this._season = seasonFor(month, prec, WET_FROM_MM, FALLBACK_WET);
    const task: AdminTask = {
      kind: this._opts.kind,
      centre: this._centre,
      radiusM: this._radiusM(),
      threat: this._threat ? [this._threat] : null,
      front: this._front(),
      gun: this._gun(),
      gunDepthM: Math.max(0, Number(this._opts.gunDepthKm) || 0) * 1000,
      op: this._opts.op,
      season: this._season.season,
      vehicles: Number(this._opts.vehicles) > 0 ? Number(this._opts.vehicles) : null,
      data: dataCatalog(b.manifest),
      inputs: {
        threat: this._threat ? (this._threatFrom === 'marker' ? "the Ground Guide's threat marker" : 'picked on the map') : undefined,
        front: (this._host.frontLines?.() ?? []).some((r) => r.length >= 2) ? 'the FDL drawn on the map (FEBA / FLOT symbols)' : this._threat ? 'the threat place (no FDL drawn)' : undefined,
        gun: this._opts.enemyGun ? 'chosen in the panel' : `the default for a ${this._R.kinds[this._opts.kind].short} (AdminDoctrine.json enemy.${this._R.kinds[this._opts.kind].beyond.value})`,
      },
      seasonWhy: this._season.why,
      wetFromMm: WET_FROM_MM,
      // the month the snow on the slopes above is judged in (mountain ground: MW p 281); the ground read at the centre
      month,
    };
    b.begin();
    let res: AdminResult | null = null;
    try {
      res = findAdminSites(b, b.rules, task, this._R);
    } catch (err) {
      EngineLogger.error(ENGINE, `Admin areas not worked out: ${(err as Error)?.message ?? err}`);
    }
    this._whyNot = null;
    if (res && this._whyNotAt) {
      try {
        this._whyNot = adminWhyNot(b, b.rules, task, this._R, this._whyNotAt, res.sites[0] ?? null);
      } catch (err) {
        EngineLogger.error(ENGINE, `Why not here? not read: ${(err as Error)?.message ?? err}`);
      }
    }
    // on mountain ground the Downwind row waits for the wind grid (fetched on its first read)
    this._pending = b.pending() || (prec === null && b.climateLoading) || (!!res?.mountain && b.windLoading);
    this._res = res;
    this._task = task;
    if (this._sel >= (res?.sites.length ?? 0)) this._sel = 0;
    this._paint();
    this._panel.render();
  }

  select(i: number): void {
    this._sel = Math.max(0, Math.min(i, (this._res?.sites.length ?? 1) - 1));
    const s = this._res?.sites[this._sel];
    if (s) this._goTo(s.at);
    this._paint();
    this._panel.render();
  }

  // ── picks ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  pickCentre(): void {
    this._pick('centre', 'Click roughly where the admin area should go (the search circle\'s centre). Esc cancels', (p) => {
      this._centre = p;
      if (!this._threat) this._markerThreat();
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

  get whyNotReading(): AdminWhyNot | null {
    return this._whyNot;
  }

  pickThreat(): void {
    this._pick('threat', 'Click the enemy\'s place (his forward troops). Esc cancels', (p) => {
      this._threat = p;
      this._threatFrom = 'pick';
    });
  }

  /** Set the places from code (Web Mercator, or lng / lat when `lngLat`). */
  setPlaces(p: { centre?: [number, number] | null; threat?: [number, number] | null; lngLat?: boolean }): void {
    const conv = (q: [number, number] | null | undefined): XY | null => (q ? (p.lngLat ? lngLatToMerc(q[0], q[1]) : [q[0], q[1]]) : null);
    if (p.centre !== undefined) this._centre = conv(p.centre);
    if (p.threat !== undefined) {
      this._threat = conv(p.threat);
      this._threatFrom = this._threat ? 'pick' : null;
    }
    this._schedule();
  }

  private _pick(what: 'centre' | 'threat' | 'whyNot', prompt: string, done: (p: XY) => void): void {
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
        this._panel.render();
      },
      onDone: (pts) => {
        this._picking = null;
        siteHint(HINT, ICON, null);
        if (pts[0]) done([pts[0][0], pts[0][1]]);
        this._schedule();
      },
    });
    this._panel.render();
  }

  // ── output ────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** The selected (or `i`-th) site as a symbol on the map. Returns how many symbols were made. */
  createOnMap(i = this._sel): number {
    const s = this._res?.sites[i];
    if (!s || !this._creator) {
      if (!this._creator) siteHint(HINT, ICON, 'Create on Map is not wired in this host', 2200);
      return 0;
    }
    const K = this._res!.rule;
    const sidc = sidcOf(K.symbol.key);
    const mp = (p: XY) => ({ x: p[0], y: p[1], spatialReference: { wkid: 102100 } });
    const desig = K.symbol.desig;
    let item: any;
    if (K.symbol.point) item = { sidc, amplifier: { SIDC: sidc, UNIQUE_DESIG: desig }, drawEssentials: { SYM_GEO_TYPE: 'Point', GEOM: mp(s.at) } };
    // a support area carries its 2525D word (RSA / BSA / DSA) inside, centred: a designation label would sit on it
    else if (K.symbol.key.startsWith('25')) item = { sidc, amplifier: { SIDC: sidc }, drawEssentials: { SYM_GEO_TYPE: 'Area', DRAW_TYPE: 2, CTRL_PTS: s.ring.map(mp) } };
    else item = { sidc, amplifier: { SIDC: sidc, UNIQUE_DESIG: desig }, drawEssentials: { SYM_GEO_TYPE: 'FPoint', GEOM: mp(s.at) } };
    const made = this._creator([item]).filter(Boolean).length;
    siteHint(HINT, ICON, made ? `${K.short} site ${s.rank} made on the map: edit, save or undo it like any other symbol` : 'The symbol could not be made', 2600);
    if (made) EngineLogger.success(ENGINE, `${K.short} site ${s.rank} created on the map`);
    return made;
  }

  text(): string {
    if (!this._res || !this._task) return '';
    return adminLines(this._res, this._task, (p) => this._grid(p), this._bundle?.dataLine() ?? '', this._whyNot).join('\n');
  }

  async copyText(): Promise<boolean> {
    const t = this.text();
    if (!t) return false;
    if (await copyToClipboard(t)) {
      siteHint(HINT, ICON, 'Admin area sites copied as text', 1800);
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
    void view.goTo({ center: [lng, lat], zoom: Math.max(view.zoom ?? 10, 12) }).catch(() => undefined);
  }

  // ── panel ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  private _controls(): PanelControl[] {
    const K = this._R.kinds[this._opts.kind];
    const cls = K.beyond.value;
    const g = this._gun();
    const size = adminSize({ kind: this._opts.kind, vehicles: Number(this._opts.vehicles) > 0 ? Number(this._opts.vehicles) : null } as AdminTask, this._R);
    return [
      { key: 'kind', label: 'Kind', type: 'select', value: this._opts.kind, wide: true, options: ADMIN_KINDS.map((k) => ({ value: k, label: this._R.kinds[k].label })) },
      { key: 'op', label: 'Operation', type: 'select', value: this._opts.op, options: [{ value: 'def', label: 'Def' }, { value: 'adv', label: 'Adv' }, { value: 'wdr', label: 'Wdr' }], title: 'The DAA\'s distance behind forward troops by operation (SOH Sec 10 p 1055)' },
      {
        key: 'month',
        label: 'Month',
        type: 'select',
        value: String(this._opts.month || 0),
        options: [{ value: '0', label: `This month (${MONTHS[new Date().getMonth()]})` }, ...MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))],
        title: 'Firm and flood-free in this month (the month\'s rain at the place)',
      },
      {
        key: 'enemyGun',
        label: 'Clear of enemy gun',
        wide: true,
        type: 'select',
        value: this._opts.enemyGun || '',
        options: [
          { value: '', label: `${cls} (${g ? `${g.name} ${km(g.rangeM)}` : 'none read'})` },
          ...this._guns.filter((x) => x.cls !== 'rocket').map((x) => ({ value: x.id, label: `${x.name} ${km(x.rangeM)}` })),
          ...this._guns.filter((x) => x.cls === 'rocket').map((x) => ({ value: x.id, label: `${x.name} ${km(x.rangeM)} (rkt)` })),
        ],
        title: `${K.short}: clear of his ${cls} guns (${K.beyond.basis}). ORBAT Sec 13 ranges`,
      },
      { key: 'gunDepthKm', label: 'His guns behind threat', type: 'number', value: this._opts.gunDepthKm, min: 0, max: 20, step: 0.5, unit: 'km', title: 'How far behind the threat place his guns stand; 0 measures from the threat place (safe side)' },
      { key: 'vehicles', label: 'Vehicles', type: 'number', value: this._opts.vehicles, min: 0, max: 5000, step: 10, title: `0 = the doctrine's area (${metres(size.frontM)} x ${metres(size.depthM)}); else sized at 50 veh per km² (SOH Sec 10 p 1054)` },
      { key: 'radiusKm', label: 'Look within', type: 'number', value: Number(this._opts.radiusKm) > 0 ? this._opts.radiusKm : this._radiusM() / 1000, min: 1, max: 30, step: 0.5, unit: 'km', title: 'How far round the picked place sites are looked for' },
    ];
  }

  private _setControl(k: string, v: string): void {
    const patch: Partial<AdminAreaOptions> = {};
    if (k === 'kind' && (ADMIN_KINDS as string[]).includes(v)) {
      patch.kind = v as AdminKind;
      patch.enemyGun = '';
      patch.radiusKm = 0;
      patch.vehicles = 0;
    } else if (k === 'op') patch.op = v === 'adv' ? 'adv' : v === 'wdr' ? 'wdr' : 'def';
    else if (k === 'month') patch.month = Math.max(0, Math.min(12, Number(v) || 0));
    else if (k === 'enemyGun') patch.enemyGun = v;
    else if (k === 'gunDepthKm') patch.gunDepthKm = Math.max(0, Math.min(20, Number(v) || 0));
    else if (k === 'vehicles') patch.vehicles = Math.max(0, Math.min(5000, Math.round(Number(v) || 0)));
    else if (k === 'radiusKm') patch.radiusKm = Math.max(1, Math.min(30, Number(v) || 0));
    this.setOptions(patch);
    // The panel's settings are the same ones Ctrl+K and the gear show. Write them back, or the next change made there
    // would put the old value back (the host re-applies the whole settings tree on every change).
    for (const [key, val] of Object.entries(patch)) setSetting(['adminArea', key], val);
  }

  private _places(): PanelPlace[] {
    const f = this._front();
    return [
      {
        label: 'Look round',
        value: this._centre ? `${this._grid(this._centre)} (${km(this._radiusM(), 1)})` : 'not picked',
        set: !!this._centre,
        buttons: [{ id: 'pickCentre', label: this._centre ? 'Move' : 'Pick', title: 'Click the map where the admin area should go roughly', on: this._picking === 'centre' }],
      },
      {
        label: 'Threat',
        value: this._threat ? `${this._grid(this._threat)}${this._threatFrom === 'marker' ? ' (threat marker)' : ''}` : 'none: his guns not checked',
        set: !!this._threat,
        buttons: [
          { id: 'pickThreat', label: this._threat ? 'Move' : 'Pick', title: 'Click the enemy\'s place (his forward troops)', on: this._picking === 'threat' },
          ...(this._host.threat?.() ? [{ id: 'markerThreat', label: 'Marker', title: 'The Ground Guide\'s threat marker', on: this._threatFrom === 'marker' }] : []),
          ...(this._threat ? [{ id: 'clearThreat', label: '✕', title: 'No threat' }] : []),
        ],
      },
      { label: 'Front', value: f ? f.label : 'none (draw the FDL or mark the threat)', set: !!f, buttons: [] },
    ];
  }

  private _actions(): PanelAction[] {
    const has = !!this._res?.sites.length;
    return [
      { id: 'pickCentre', label: this._centre ? 'Look elsewhere' : 'Pick area', primary: !this._centre, on: this._picking === 'centre', title: 'Click the map where the admin area should go roughly' },
      { id: 'whyNot', label: 'Why not here?', disabled: !this._res, on: this._picking === 'whyNot', title: 'Click any place: it is read with the same checks, and you get the rule (book and page) that left it out or put it lower' },
      { id: 'create', label: 'Create on Map', output: true, disabled: !has, title: 'The selected site as a symbol (2525D support area or the catalog point), one undo step' },
      { id: 'copy', label: 'Copy as Text', output: true, disabled: !has, title: 'The decision record: every site with its checks, why it is where it is, the places left out, and every rule cited with book, page and words' },
    ];
  }

  /** The setup in one line, for the folded setup and the folded panel. */
  private _summary(): string {
    const K = this._R.kinds[this._opts.kind];
    const g = this._gun();
    return [K.short, this._opts.op === 'adv' ? 'Adv' : this._opts.op === 'wdr' ? 'Wdr' : 'Def', g ? `clear of ${g.name} ${km(g.rangeM)}` : '', km(this._radiusM(), 1), MONTHS[this._month() - 1]].filter(Boolean).join(' · ');
  }

  /** What to do, while there is no result to show. */
  private _guide(): string[] {
    if (this._bundleState === 'missing') return ['The terrain bundle is not there: Admin Area reads the ground from it. Check the Terrain bundle URL in the gear settings.'];
    return [
      'Pick the kind of admin area and the operation.',
      'Pick where to look: click the map roughly where the area should go.',
      'Give the threat place (his forward troops): Pick it, or use the Ground Guide threat marker. Without one, his guns are not checked.',
      'Draw the FDL (FEBA / FLOT line) to have the distance behind the front checked (DAA).',
    ];
  }

  private _act(id: string): void {
    if (id === 'clearAll') {
      this._centre = null;
      this._threat = null;
      this._threatFrom = null;
      this._whyNotAt = null;
      this._whyNot = null;
      this._sel = 0;
      this._draw.cancel(false);
      this._picking = null;
      siteHint(HINT, ICON, null);
      this._schedule();
    } else if (id === 'pickCentre') this.pickCentre();
    else if (id === 'pickThreat') this.pickThreat();
    else if (id === 'markerThreat') {
      this._markerThreat();
      this._schedule();
    } else if (id === 'clearThreat') {
      this._threat = null;
      this._threatFrom = null;
      this._schedule();
    } else if (id === 'whyNot') this.pickWhyNot();
    else if (id === 'clearWhyNot') {
      this._whyNotAt = null;
      this._whyNot = null;
      this._paint();
      this._panel.render();
    } else if (id === 'create') this.createOnMap();
    else if (id === 'copy') void this.copyText();
  }

  private _headline(): { tone: Tone | 'idle'; text: string } {
    const K = this._R.kinds[this._opts.kind];
    if (this._bundleState === 'loading') return { tone: 'idle', text: 'Opening the terrain data…' };
    if (this._bundleState === 'missing') return { tone: 'unknown', text: 'Needs terrain data: no terrain bundle at this address' };
    if (!this._centre) return { tone: 'idle', text: `Pick where to look for the ${K.short}` };
    const r = this._res;
    if (!r) return { tone: 'idle', text: 'Working out…' };
    if (this._pending) return { tone: 'idle', text: `Reading the ground… (${r.sites.length} so far)` };
    if (!r.sites.length) return { tone: 'bad', text: `No ${K.short} site in this circle` };
    const best = r.sites[0];
    const good = r.sites.filter((s) => s.tone === 'ok').length;
    return { tone: best.tone, text: good ? `${good} good ${K.short} site${good > 1 ? 's' : ''} of ${r.sites.length}; best: ${best.verdict}` : `${r.sites.length} ${K.short} sites, none clean; best: ${best.verdict}` };
  }

  private _sites(): PanelSite[] {
    return (this._res?.sites ?? []).map((s) => ({
      rank: s.rank,
      grid: this._grid(s.at),
      verdict: s.verdict,
      tone: s.tone,
      score: s.score,
      rows: s.rows.map((r) => ({ label: r.label, value: r.value, tone: r.tone, why: r.why, fix: r.fix, rules: r.rules })),
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
    const K = this._R.kinds[this._opts.kind];
    if (this._season && this._centre) n.push(`Ground state: ${this._season.season === 'wet' ? 'wet month' : 'dry month'} (${this._season.why}).`);
    if (K.note) n.push(K.note);
    if (this._res?.sites.length) n.push('Sites come from 30 m terrain data and estimates: recce them on the ground.');
    return n;
  }

  private _footer(): string {
    const d = this._bundle?.dataLine();
    return `${d ? `Data: ${d}. ` : ''}Figures: AdminDoctrine.json (SO's Hbk Sec 10 / 13, LSF, GSP, MIB, FM 4-90)`;
  }

  // ── map ───────────────────────────────────────────────────────────────────────────────────────────────────────────

  private _paint(): void {
    if (!this._enabled || !this._opts.map) {
      this._map.clear();
      return;
    }
    const spec: MapSpec = { circle: null, polys: [], lines: [], marks: [] };
    if (this._centre) {
      spec.circle = { at: this._centre, radiusM: this._radiusM(), label: `${this._R.kinds[this._opts.kind].short} search` };
      spec.marks.push({ at: this._centre, kind: 'centre' });
    }
    if (this._threat) {
      spec.marks.push({ at: this._threat, kind: 'threat', label: 'Threat' });
      const g = this._task?.gun ?? this._gun();
      if (g) {
        const reach = g.rangeM - Math.max(0, Number(this._opts.gunDepthKm) || 0) * 1000;
        if (reach > 0) {
          // only the part of his reach that faces the search circle, so the map stays readable (one arc: filtering a
          // full circle joined its two ends with a straight line when the circle lay north of the threat)
          const toward = this._centre ? bearingOf(this._threat, this._centre) : 0;
          const pts = arcPts(this._threat, reach, toward, 120, 48);
          spec.lines.push({ pts, rgb: [229, 72, 77], width: 1.8, dash: true, label: `${g.name} reach ${km(reach)}` });
        }
      }
    }
    for (const [i, s] of (this._res?.sites ?? []).entries()) spec.polys.push({ ring: s.ring, tone: s.tone, selected: i === this._sel, label: `${s.rank}` });
    if (this._whyNot?.site) spec.polys.push({ ring: this._whyNot.site.ring, tone: this._whyNot.gates.length ? 'bad' : this._whyNot.site.tone, selected: false, label: 'Why not?' });
    else if (this._whyNotAt) spec.marks.push({ at: this._whyNotAt, kind: 'site', label: 'Why not?' });
    const s = this._res?.sites[this._sel];
    if (s?.road.road) spec.lines.push({ pts: [s.at, [s.road.road.x, s.road.road.y]], rgb: [140, 196, 255], width: 2, dash: true, label: `Rd ${metres(s.road.road.distM)}` });
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
