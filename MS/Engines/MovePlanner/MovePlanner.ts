/**
 * MovePlanner.ts
 *
 * The Move Planner (user, 2026-11-13: "old code for DI, Enemy, Move and Assembly, Road and Rail Movement ... it has all
 * the rules ... I want to implement it, augment it"). Five plan kinds, one panel: Rd Mov, Mov & Assy, DI Mov (de-induction),
 * Rly Mov and En Mov, worked out by the pure engines in this folder with the rules in MS/Data/MoveDoctrine.json (the old
 * code's rules, checked against the SO's Handbook Sec 9 and Staff Duties Vol II; fixes and figures marked R / O / E).
 *
 *   plan     a plain JSON document per kind (kept in the browser between visits when `remember`; Save / Open as .json);
 *            `setPlan`, `getPlan`, `newPlan`.
 *   routes   "+ Route on Rds": click the SP, points to pass and the Rel P; solved on the road network when it is up
 *            (RoadNetworkEngine / GeoCore, with its load class, MSR share and weakest crossing noted), else the clicks are
 *            the route; "+ Draw Route" by hand; "+ Selected Line" from a placed line symbol; CPs by clicking.
 *   serials  added in the panel, or from the unit symbols selected on the map (name, SIDC, arm, peace location).
 *   results  every change works the plan out again: the panel's tables and graphs, and the map (routes, halts, harbours,
 *            crossing waits, stations); the timeline puts the columns on the map at any time.
 *   keys     U opens / closes the panel, Shift+U walks its views, Esc closes it.
 *
 * Nothing here reads the terrain bundle. Road solving uses the road network only when it is on and up. Off by default
 * (`features.movePlanner`).
 */

import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils';
import EngineLogger from '../../Support/EngineLogger';
import DOCTRINE from '../../Data/MoveDoctrine.json';
import { MovementGuideDraw } from '../MovementGuide/MovementGuideDraw';
import type { MercXY } from '../MovementGuide/MovementGuideScan';
import type { LngLat } from './MoveGeo';
import { armOf } from './MoveReports';
import { MovePlannerMap } from './MovePlannerMap';
import { MovePlannerPanel, VIEWS, type MvView } from './MovePlannerPanel';
import { planLines } from './MovePlannerText';
import {
  KINDS,
  KIND_LABEL,
  ROUTE_COLORS,
  computePlan,
  newEnemy,
  newId,
  newPlan,
  newSerial,
  normalisePlan,
  rulesFrom,
  type MvKind,
  type MvPlanDoc,
  type MvResult,
  type MvRouteDoc,
  type MvRules,
} from './MovePlannerModel';

const ENGINE = 'MovePlanner';
const HINT_ID = 'ms-move-planner-hint';
const STORE = 'ms-move-planner:';

export interface MovePlannerOptions {
  /** U opens / closes the panel, Shift+U walks its views. */
  keys: boolean;
  /** Draw the plan on the map. */
  map: boolean;
  labels: boolean;
  /** Halts and harbours on the map. */
  halts: boolean;
  /** Keep each kind's plan in this browser between visits. */
  remember: boolean;
  /** The kind the panel opens on. */
  kind: MvKind;
  /** Zone of the plan's clock, minutes east of UTC (Pakistan 300). */
  utcOffsetMin: number;
  /** Solve "+ Route on Rds" on the road network when it is up. */
  useNetwork: boolean;
  /** Load class for solved routes (null = none): the road network keeps to roads that carry it. */
  routeMlc: number | null;
}

export const DEFAULT_MOVE_PLANNER_OPTIONS: MovePlannerOptions = {
  keys: true,
  map: true,
  labels: true,
  halts: true,
  remember: true,
  kind: 'road',
  utcOffsetMin: 300,
  useNetwork: true,
  routeMlc: null,
};

export interface MovePlannerHost {
  /** The road network engine (null when off). */
  roadNetwork?: () => any;
  /** The graphics selected on the map. */
  selected?: () => any[];
  /** Name, SIDC and place of a unit symbol. */
  describe?: (g: any) => { name: string; sidc: string } | null;
}

function toLngLat(p: MercXY): LngLat {
  const [lng, lat] = webMercatorUtils.xyToLngLat(p[0], p[1]) as [number, number];
  return [lng, lat];
}

function geomToLngLats(g: any): LngLat[] {
  if (!g) return [];
  const sr = g.spatialReference;
  const merc = !!sr?.isWebMercator || [102100, 3857, 102113].includes(sr?.wkid);
  const conv = (q: number[]): LngLat => (merc ? (webMercatorUtils.xyToLngLat(q[0], q[1]) as LngLat) : [q[0], q[1]]);
  if (g.type === 'polyline') return (g.paths ?? []).flat().map(conv);
  if (g.type === 'point') return [merc ? (webMercatorUtils.xyToLngLat(g.x, g.y) as LngLat) : [g.longitude ?? g.x, g.latitude ?? g.y]];
  if (g.type === 'polygon') return (g.rings?.[0] ?? []).map(conv);
  return [];
}

export default class MovePlanner {
  private _opts: MovePlannerOptions = { ...DEFAULT_MOVE_PLANNER_OPTIONS };
  private _enabled = false;
  private _R: MvRules = rulesFrom(DOCTRINE);
  private _plans = new Map<MvKind, MvPlanDoc>();
  private _kind: MvKind = 'road';
  private _res: MvResult | null = null;
  private _time: number | null = null;
  private _sel: string | null = null;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _hintTimer: ReturnType<typeof setTimeout> | null = null;
  private _getView: () => any;
  private _host: MovePlannerHost;
  private _map: MovePlannerMap;
  private _draw: MovementGuideDraw;
  private _panel: MovePlannerPanel;

  constructor(getView: () => any, host: MovePlannerHost = {}) {
    this._getView = getView;
    this._host = host;
    this._map = new MovePlannerMap(getView);
    this._draw = new MovementGuideDraw(getView);
    this._panel = new MovePlannerPanel({
      plan: () => this.getPlan(),
      result: () => this._res,
      rules: () => this._R,
      change: (mut) => this._change(mut),
      setKind: (k) => this.setKind(k),
      newPlan: () => this.newPlan(),
      copyText: () => void this.copyText(),
      exportJson: () => this.exportJson(),
      importJson: () => this.importJson(),
      addRoute: (m) => this.addRoute(m),
      addCp: (id) => this.addCp(id),
      delRoute: (id) => this._change((p) => this._removeRoute(p, id)),
      addSerial: () => this._change((p) => p.serials.push(newSerial(p, this._R))),
      delSerial: (id) => this._change((p) => (p.serials = p.serials.filter((s) => s.id !== id))),
      addEnemy: () => this._change((p) => p.enemy.push(newEnemy(p, this._R))),
      delEnemy: (id) => this._change((p) => (p.enemy = p.enemy.filter((s) => s.id !== id))),
      pick: (what, id) => this._pick(what, id),
      fromSelection: () => this.fromSelection(),
      goTo: (at) => this._goTo(at),
      setTime: (t) => this.setTime(t),
      time: () => this._time,
      select: (id) => {
        this._sel = id;
        this._paint();
        this._panel.render();
      },
      selected: () => this._sel,
      networkWord: () => this._networkWord(),
      kindLabel: (k) => this._R.rail.kinds[k]?.label.split(' (')[0] ?? k,
      close: () => this.openPanel(false),
    });
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────────────────────────────────────────────

  get isEnabled(): boolean {
    return this._enabled;
  }

  setOptions(o: Partial<MovePlannerOptions>): void {
    const kindChanged = o.kind && o.kind !== this._opts.kind;
    this._opts = { ...this._opts, ...Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) } as MovePlannerOptions;
    if (kindChanged && KINDS.includes(this._opts.kind)) this._kind = this._opts.kind;
    if (this._enabled) {
      this._bindKeys();
      this._recompute();
    }
  }

  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    if (KINDS.includes(this._opts.kind)) this._kind = this._opts.kind;
    this._bindKeys();
    this._recompute();
    EngineLogger.nextStep(ENGINE, 'Move Planner on: U opens the panel');
  }

  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    this._draw.cancel(false);
    this._panel.close();
    this._map.clear();
    this._unbindKeys();
    this._hint(null);
  }

  destroy(): void {
    this.disable();
    this._panel.destroy();
    this._map.destroy();
  }

  onViewChanged(): void {
    this._draw.cancel(false);
    this._map.destroy();
    if (this._enabled) this._paint();
  }

  // ── the plan ──────────────────────────────────────────────────────────────────────────────────────────────────────

  get kind(): MvKind {
    return this._kind;
  }

  /** The current kind's plan (a fresh one when there is none). */
  getPlan(kind: MvKind = this._kind): MvPlanDoc {
    let p = this._plans.get(kind);
    if (!p) {
      p = this._load(kind) ?? newPlan(kind, this._R, this._opts.utcOffsetMin);
      this._plans.set(kind, p);
    }
    return p;
  }

  /** Replace a plan (from a host, a file); its kind becomes the current one. Returns the worked-out result. */
  setPlan(raw: any): MvResult | null {
    const p = normalisePlan(raw, this._R);
    this._plans.set(p.kind, p);
    this._kind = p.kind;
    this._save(p);
    return this._recompute(true);
  }

  newPlan(kind: MvKind = this._kind): void {
    const p = newPlan(kind, this._R, this._opts.utcOffsetMin);
    this._plans.set(kind, p);
    this._sel = null;
    this._time = null;
    this._save(p);
    this._recompute();
  }

  setKind(k: MvKind): void {
    if (!KINDS.includes(k)) return;
    this._kind = k;
    this._sel = null;
    this._time = null;
    this._recompute();
  }

  /** The worked-out result of the current plan. */
  get result(): MvResult | null {
    return this._res;
  }

  /** Work the plan out now (also done on every change). */
  compute(): MvResult | null {
    return this._recompute(true);
  }

  private _change(mut: (p: MvPlanDoc) => void): void {
    const p = this.getPlan();
    mut(p);
    this._save(p);
    this._recompute();
  }

  private _recompute(now = false): MvResult | null {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    const run = () => {
      if (!this._enabled) return null;
      const p = this.getPlan();
      try {
        this._res = computePlan(p, this._R);
      } catch (err) {
        this._res = null;
        EngineLogger.error(ENGINE, `Could not work the plan out: ${(err as Error)?.message ?? err}`);
      }
      if (this._time !== null && this._res?.span && (this._time < this._res.span[0] || this._time > this._res.span[1])) this._time = null;
      this._paint();
      this._panel.render();
      return this._res;
    };
    if (now) return run();
    this._timer = setTimeout(run, 40);
    return this._res;
  }

  private _paint(): void {
    if (!this._enabled || !this._opts.map) {
      this._map.clear();
      return;
    }
    this._map.draw(this.getPlan(), this._res, { labels: this._opts.labels, halts: this._opts.halts, selected: this._sel });
    this._map.drawTime(this._res, this._time);
  }

  private _load(kind: MvKind): MvPlanDoc | null {
    if (!this._opts.remember) return null;
    try {
      const s = localStorage.getItem(STORE + kind);
      return s ? normalisePlan(JSON.parse(s), this._R) : null;
    } catch {
      return null;
    }
  }

  private _save(p: MvPlanDoc): void {
    if (!this._opts.remember) return;
    try {
      localStorage.setItem(STORE + p.kind, JSON.stringify(p));
    } catch {
      /* storage full or blocked: the plan stays in memory */
    }
  }

  // ── panel and keys ────────────────────────────────────────────────────────────────────────────────────────────────

  get panelOpen(): boolean {
    return this._panel.isOpen;
  }

  openPanel(open = true, view?: MvView): void {
    if (!this._enabled) return;
    if (!open) {
      this._panel.close();
      return;
    }
    this._recompute(true);
    this._panel.open(view && VIEWS[this._kind].includes(view) ? view : undefined);
  }

  togglePanel(): boolean {
    this.openPanel(!this._panel.isOpen);
    return this._panel.isOpen;
  }

  private _bindKeys(): void {
    this._unbindKeys();
    if (!this._opts.keys) return;
    this._keyHandler = (e: KeyboardEvent) => {
      if (!this._enabled || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'Escape' && this._panel.isOpen && !this._draw.active) {
        this._panel.close();
        e.preventDefault();
        return;
      }
      if (e.key !== 'u' && e.key !== 'U') return;
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey && this._panel.isOpen) this._panel.step(1);
      else this.togglePanel();
    };
    window.addEventListener('keydown', this._keyHandler, true);
  }

  private _unbindKeys(): void {
    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler, true);
    this._keyHandler = null;
  }

  // ── routes ────────────────────────────────────────────────────────────────────────────────────────────────────────

  private _networkWord(): string {
    const rn = this._host.roadNetwork?.();
    if (!this._opts.useNetwork) return 'routes are drawn (road network not used)';
    if (!rn) return 'road network off: routes are drawn as clicked';
    return rn.isAvailable ? 'road network up: routes are solved on the roads' : 'road network not reachable: routes are drawn as clicked';
  }

  private _nextRouteName(p: MvPlanDoc): { name: string; color: string } {
    const names = ['Red', 'Blue', 'Green', 'Yellow', 'White', 'Brown', 'Black', 'Purple'];
    const i = p.routes.length;
    return { name: `${names[i % names.length]} Route${i >= names.length ? ` ${Math.floor(i / names.length) + 1}` : ''}`, color: ROUTE_COLORS[i % ROUTE_COLORS.length] };
  }

  /** Add a route: solved on the roads ('network'), drawn ('draw'), or the selected line ('line'). */
  addRoute(mode: 'network' | 'draw' | 'line'): void {
    if (!this._enabled) return;
    if (mode === 'line') {
      const g = (this._host.selected?.() ?? []).find((x: any) => x?.geometry?.type === 'polyline');
      if (!g) {
        this._hint('Select a line symbol on the map first', 2200);
        return;
      }
      this.useGraphic(g);
      return;
    }
    const net = mode === 'network';
    this._panelAside(true);
    this._draw.start({
      kind: 'line',
      prompt: net ? 'Click the SP, any points the route must pass, then double-click the Rel P (Esc cancels)' : 'Draw the route: click points, double-click to finish (Esc cancels)',
      onStatus: (t) => this._hint(t ? `🚚 ${t}` : null),
      onCancel: () => this._panelAside(false),
      onDone: (pts) => {
        this._panelAside(false);
        const ll = pts.map(toLngLat);
        if (ll.length < 2) return;
        if (net) void this._solve(ll);
        else this._addRouteDoc(ll, 'drawn');
      },
    });
  }

  private async _solve(clicks: LngLat[]): Promise<void> {
    const rn = this._opts.useNetwork ? this._host.roadNetwork?.() : null;
    if (!rn) {
      this._addRouteDoc(clicks, clicks.length > 2 ? 'drawn' : 'straight', 'Road network off: the route is as clicked');
      return;
    }
    this._hint('🚚 Solving the route on the road network…');
    const params = this._opts.routeMlc ? [{ attributeName: 'LoadClass', parameterName: 'VehicleMLC', value: this._opts.routeMlc }] : undefined;
    let r: any = null;
    try {
      r = await rn.route(clicks[0], clicks[clicks.length - 1], { via: clicks.slice(1, -1), ...(params ? { parameters: params, restrictions: ['LoadClass'] } : {}) });
    } catch (err) {
      r = { ok: false, error: String((err as Error)?.message ?? err) };
    }
    this._hint(null);
    if (!r?.ok) {
      this._addRouteDoc(clicks, clicks.length > 2 ? 'drawn' : 'straight', `Not solved (${r?.error ?? 'no route'}): as clicked`);
      this._hint(`🚚 No road route (${r?.reason ?? 'error'}): the clicks are the route`, 3200);
      return;
    }
    const g = r.data.geometry;
    const coords: number[][] = g.type === 'MultiLineString' ? (g.coordinates as number[][][]).flat() : (g.coordinates as number[][]);
    const m = r.data.military;
    const note = [
      `${r.data.distanceKm.toFixed(1)} km on rds`,
      m?.minLoadClass ? `lowest load cl ${m.minLoadClass}` : '',
      m?.unknownLoadPct ? `${Math.round(m.unknownLoadPct)}% load cl not recorded` : '',
      m?.msrPct ? `${Math.round(m.msrPct)}% MSR` : '',
      m?.limitingCrossing ? `weakest crossing ${m.limitingCrossing}` : '',
      m?.closedMonths ? `closed ${m.closedMonths}` : '',
      r.data.trafficability?.limitingClass ? `worst rd ${r.data.trafficability.limitingClass}` : '',
    ].filter(Boolean).join('; ');
    this._addRouteDoc(coords.map((q) => [q[0], q[1]] as LngLat), 'network', note);
  }

  private _addRouteDoc(pts: LngLat[], source: MvRouteDoc['source'], note?: string): void {
    this._change((p) => {
      const nm = this._nextRouteName(p);
      const route: MvRouteDoc = { id: newId('r'), name: nm.name, color: nm.color, pts, source, sp: `SP ${nm.name.split(' ')[0]}`, rp: `Rel P ${nm.name.split(' ')[0]}`, cps: [], note };
      p.routes.push(route);
      // the new route goes to the serials that have none
      for (const s of p.serials) if (!s.routeId) s.routeId = route.id;
      if (p.kind === 'rail' && !p.rail.routeId) p.rail.routeId = route.id;
      for (const e of p.enemy) if (e.mode === 'road' && !e.routeId) e.routeId = route.id;
      this._sel = route.id;
    });
  }

  private _removeRoute(p: MvPlanDoc, id: string): void {
    p.routes = p.routes.filter((r) => r.id !== id);
    for (const s of p.serials) if (s.routeId === id) s.routeId = null;
    for (const e of p.enemy) if (e.routeId === id) e.routeId = null;
    if (p.rail.routeId === id) p.rail.routeId = null;
  }

  /** A placed line becomes a route. */
  useGraphic(graphic: any): boolean {
    const pts = geomToLngLats(graphic?.geometry ?? graphic);
    if (!this._enabled || pts.length < 2) return false;
    this._addRouteDoc(pts, 'line');
    return true;
  }

  canUse(graphic: any): boolean {
    return this._enabled && graphic?.geometry?.type === 'polyline';
  }

  /** Add a critical point on a route by clicking near it. */
  addCp(routeId: string): void {
    this._panelAside(true);
    this._draw.start({
      kind: 'point',
      prompt: 'Click the critical point on the route (Esc cancels)',
      onStatus: (t) => this._hint(t ? `🚚 ${t}` : null),
      onCancel: () => this._panelAside(false),
      onDone: (pts) => {
        this._panelAside(false);
        if (!pts[0]) return;
        const at = toLngLat(pts[0]);
        this._change((p) => {
          const r = p.routes.find((x) => x.id === routeId);
          if (r) r.cps.push({ name: `CP ${r.cps.length + 1}`, at });
        });
      },
    });
  }

  private _pick(what: string, id: string | null): void {
    const area = what === 'assy';
    this._panelAside(true);
    const prompts: Record<string, string> = {
      eSta: 'Click the entraining station',
      dSta: 'Click the detraining station',
      dl: "Click the unit's peace location (DL)",
      assy: 'Draw the assembly area: click its corners, double-click to finish',
      eE: "Click the enemy formation's entraining station",
      eD: 'Click its detraining station',
    };
    this._draw.start({
      kind: area ? 'area' : 'point',
      prompt: `${prompts[what] ?? 'Click on the map'} (Esc cancels)`,
      onStatus: (t) => this._hint(t ? `🚚 ${t}` : null),
      onCancel: () => this._panelAside(false),
      onDone: (pts) => {
        this._panelAside(false);
        const ll = pts.map(toLngLat);
        if (!ll.length) return;
        this._change((p) => {
          if (what === 'eSta') p.rail.eAt = ll[0];
          else if (what === 'dSta') p.rail.dAt = ll[0];
          else if (what === 'dl') {
            const s = p.serials.find((x) => x.id === id);
            if (s) s.dl = ll[0];
          } else if (what === 'assy') {
            const s = p.serials.find((x) => x.id === id);
            if (s && ll.length >= 3) s.assyArea = ll;
          } else if (what === 'eE' || what === 'eD') {
            const e = p.enemy.find((x) => x.id === id);
            if (e) {
              if (what === 'eE') e.eAt = ll[0];
              else e.dAt = ll[0];
            }
          }
        });
      },
    });
  }

  /** Lower the panel while the user clicks on the map, and bring it back after. */
  private _panelAside(aside: boolean): void {
    const el = document.querySelector('.ms-mvp') as HTMLElement | null;
    if (el) el.style.visibility = aside ? 'hidden' : '';
  }

  /** Serials from the unit symbols selected on the map: name, SIDC (arm), place (DI: the peace location). */
  fromSelection(): number {
    const gs = (this._host.selected?.() ?? []).filter((g: any) => g?.geometry?.type === 'point');
    if (!gs.length) {
      this._hint('Select unit symbols on the map first', 2200);
      return 0;
    }
    let n = 0;
    this._change((p) => {
      for (const g of gs) {
        const d = this._host.describe?.(g) ?? null;
        const name = d?.name || `Unit ${p.serials.length + 1}`;
        const sidc = d?.sidc ?? '';
        const at = geomToLngLats(g.geometry)[0] ?? null;
        p.serials.push(newSerial(p, this._R, { name, sidc, arm: armOf(sidc, this._R.arms), dl: p.kind === 'di' ? at : null }));
        n++;
      }
    });
    this._hint(`${n} serial${n > 1 ? 's' : ''} added from the map`, 1800);
    return n;
  }

  // ── time ──────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Put the columns on the map at a time (UTC ms); null takes them off. */
  setTime(t: number | null): void {
    this._time = t;
    if (this._enabled && this._opts.map) this._map.drawTime(this._res, t);
  }

  get time(): number | null {
    return this._time;
  }

  // ── output ────────────────────────────────────────────────────────────────────────────────────────────────────────

  text(): string {
    const p = this.getPlan();
    const res = this._res ?? computePlan(p, this._R);
    return planLines(p, res, this._R, (k) => this._R.rail.kinds[k]?.label.split(' (')[0] ?? k).join('\n');
  }

  async copyText(): Promise<boolean> {
    const t = this.text();
    try {
      await navigator.clipboard.writeText(t);
      this._hint('Mov table copied as text', 1800);
      return true;
    } catch {
      this._hint('Copy failed: the browser refused the clipboard', 2200);
      return false;
    }
  }

  exportJson(): void {
    const p = this.getPlan();
    const blob = new Blob([JSON.stringify(p, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(p.title || KIND_LABEL[p.kind]).replace(/[^\w\- ]+/g, '').trim() || 'mov-plan'}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  importJson(): void {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      try {
        this.setPlan(JSON.parse(await f.text()));
        this._hint(`Opened ${f.name}`, 1800);
      } catch (err) {
        this._hint(`Not a plan: ${(err as Error)?.message ?? err}`, 2600);
      }
    };
    inp.click();
  }

  private _goTo(at: LngLat | LngLat[]): void {
    const view = this._getView();
    if (!view) return;
    const pts = Array.isArray(at[0]) ? (at as LngLat[]) : [at as LngLat];
    if (!pts.length) return;
    if (pts.length === 1) {
      void view.goTo({ center: pts[0], zoom: Math.max(view.zoom ?? 10, 12) }).catch(() => undefined);
      return;
    }
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const pad = 0.1;
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    void view.goTo({ target: { type: 'extent', xmin: Math.min(...xs) - w * pad, xmax: Math.max(...xs) + w * pad, ymin: Math.min(...ys) - h * pad - h * 0.6, ymax: Math.max(...ys) + h * pad, spatialReference: { wkid: 4326 } } }).catch(() => undefined);
  }

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
    h.textContent = text.startsWith('🚚') ? text : `🚚 ${text}`;
    if (ms > 0) this._hintTimer = setTimeout(() => this._hint(null), ms);
  }
}
