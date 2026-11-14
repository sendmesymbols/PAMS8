/**
 * MovePlannerPanel.ts
 *
 * The Mov Plan panel docked at the foot of the map (like the Ground Detail / Night March chart): the five kinds as tabs
 * (Rd Mov, Mov & Assy, DI Mov, Rly Mov, En Mov), the plan's settings in a strip, its views as tabs (Setup, Table, Graph
 * and the kind's own: Matrix, Flow, Progress, Reports, Trains, Demand, Induction), an answer strip, and a timeline that
 * puts the columns on the map at any time. Forms write straight into the plan (one delegated listener); every change
 * works the plan out again. U opens / closes it, Shift+U walks the views, Esc closes. Colours from GroundGuideTokens.
 */

import Utils from '../../Support/utils';
import { ensureTokensCss } from '../GroundGuide/GroundGuideTokens';
import type { LngLat } from './MoveGeo';
import { MEET_WORD, clearAt, dueAt, flowAt } from './MoveRoad';
import { MIN, DAY_MIN, dtg, durText, durHHMM, hhmm, mDayLabel, mDayOf } from './MoveTime';
import { KIND_LABEL, KIND_LONG, KINDS, ROUTE_COLORS, enemyTrains, routeDir, routeKm, vehiclesOf, type MvKind, type MvPlanDoc, type MvResult, type MvRules, type MvSerialDoc } from './MovePlannerModel';
import { armWise, hmtByFmn, priWise, progressByDay } from './MoveReports';
import { gantt, nightsOver, progressChart, STOCK_COLOR, timeDistance, trainStrip, VIZ, type GanttRow, type TdSeries } from './MovePlannerViz';
import type { StockType } from './MoveRail';

const esc = (s: unknown): string => Utils.escapeHtml(String(s ?? ''));

export type MvView = 'setup' | 'table' | 'graph' | 'matrix' | 'flow' | 'progress' | 'reports' | 'trains' | 'demand' | 'induction';
export const VIEWS: Record<MvKind, MvView[]> = {
  road: ['setup', 'table', 'graph', 'matrix', 'flow'],
  assy: ['setup', 'table', 'graph', 'matrix', 'flow'],
  di: ['setup', 'table', 'graph', 'progress', 'reports'],
  rail: ['setup', 'trains', 'table', 'graph', 'demand'],
  enemy: ['setup', 'table', 'graph', 'induction'],
};
const VIEW_LABEL: Record<MvView, string> = { setup: 'Setup', table: 'Mov Table', graph: 'Graph', matrix: 'Matrix', flow: 'Flow', progress: 'Progress', reports: 'Reports', trains: 'Trains', demand: 'Stock Req', induction: 'Induction' };

export interface PanelHost {
  plan(): MvPlanDoc;
  result(): MvResult | null;
  rules(): MvRules;
  change(mut: (p: MvPlanDoc) => void): void;
  setKind(k: MvKind): void;
  newPlan(): void;
  copyText(): void;
  exportJson(): void;
  importJson(): void;
  addRoute(mode: 'network' | 'draw' | 'line'): void;
  addCp(routeId: string): void;
  delRoute(id: string): void;
  addSerial(): void;
  delSerial(id: string): void;
  addEnemy(): void;
  delEnemy(id: string): void;
  pick(what: string, id: string | null): void;
  fromSelection(): void;
  goTo(at: LngLat | LngLat[]): void;
  setTime(t: number | null): void;
  time(): number | null;
  select(id: string | null): void;
  selected(): string | null;
  networkWord(): string;
  kindLabel(k: string): string;
  close(): void;
}

const PANEL_CSS = `
.ms-mvp{position:fixed;left:10px;right:10px;bottom:10px;z-index:2147482810;height:calc(46vh + 60px);min-height:min(460px,calc(100vh - 20px));max-height:calc(100vh - 20px);
  display:none;flex-direction:column;box-sizing:border-box;border-radius:12px;background:var(--gg-card);border:1px solid #5a6470;box-shadow:0 10px 30px rgba(0,0,0,.5);
  font:400 13px/1.4 system-ui,Segoe UI,Arial,sans-serif;color:var(--gg-text)}
.ms-mvp.ms-open{display:flex}
.ms-mvp.ms-tall{height:calc(100vh - 110px)}
.ms-mvp *{box-sizing:border-box}
.ms-mvp-h{flex:none;display:flex;align-items:center;gap:6px 8px;padding:7px 10px;background:linear-gradient(90deg,#1d2635,var(--gg-head) 45%);border-radius:11px 11px 0 0;flex-wrap:wrap}
.ms-mvp-name{font-weight:750;font-size:13.5px;color:#fff;padding:0 6px 0 2px;white-space:nowrap}
.ms-mvp-tabs{display:flex;gap:3px;flex-wrap:wrap}
.ms-mvp-tab{padding:5px 10px;border-radius:7px;border:1px solid transparent;background:transparent;color:#d5dbe1;font:600 13px/1.2 system-ui,Segoe UI,Arial,sans-serif;cursor:pointer;white-space:nowrap}
.ms-mvp-tab:hover{background:rgba(255,255,255,.08);color:#fff}
.ms-mvp-tab[aria-selected="true"]{background:#e4e8ec;border-color:#e4e8ec;color:#14181d}
.ms-mvp-tab:focus-visible,.ms-mvp-btn:focus-visible{outline:2px solid var(--gg-accent);outline-offset:1px}
.ms-mvp-sp{flex:1}
.ms-mvp-btn{font:500 12.5px/1 system-ui,Segoe UI,Arial,sans-serif;color:#e1e6eb;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.18);border-radius:6px;cursor:pointer;height:28px;padding:0 9px;white-space:nowrap}
.ms-mvp-btn:hover{background:rgba(255,255,255,.14);color:#fff}
.ms-mvp-btn.ms-x{width:28px;padding:0;font-size:17px}
.ms-mvp-btn.ms-pri{background:#2b5d86;border-color:#4f8ab8}
.ms-mvp-btn.ms-sm{height:22px;padding:0 6px;font-size:11.5px}
.ms-mvp-strip{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:5px 12px;padding:6px 12px;background:var(--gg-strip);border-top:1px solid var(--gg-hair-soft);font-size:12.5px;color:var(--gg-label)}
.ms-mvp-strip label{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.ms-mvp input,.ms-mvp select{font:500 12.5px/1.2 system-ui,Segoe UI,Arial,sans-serif;color:#f1f3f6;background:#11151a;border:1px solid #3d4650;border-radius:5px;padding:3px 5px;height:24px;min-width:0}
.ms-mvp input[type=checkbox]{height:auto;accent-color:#8ec1ea}
.ms-mvp input[type=color]{width:26px;padding:1px;height:22px}
.ms-mvp input:focus,.ms-mvp select:focus{outline:1px solid #8ec1ea;border-color:#8ec1ea}
.ms-mvp input.ms-n{width:54px;text-align:right}
.ms-mvp input.ms-nn{width:42px;text-align:right}
.ms-mvp input.ms-t{width:58px;text-align:center}
.ms-mvp input.ms-w{width:120px}
.ms-mvp input.ms-ww{width:150px}
.ms-mvp-views{flex:none;display:flex;gap:3px;padding:5px 10px 0;border-top:1px solid var(--gg-hair-soft);background:var(--gg-strip)}
.ms-mvp-views .ms-mvp-tab{border-radius:7px 7px 0 0;padding:5px 12px}
.ms-mvp-views .ms-mvp-tab[aria-selected="true"]{background:var(--gg-card);border-color:var(--gg-hair);border-bottom-color:var(--gg-card);color:#fff}
.ms-mvp-ans{flex:none;display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;padding:7px 14px;border-bottom:1px solid var(--gg-hair)}
.ms-mvp-v{font-size:15px;font-weight:750;color:#fff;padding:3px 10px;border-radius:7px;border:1px solid rgba(255,255,255,.2)}
.ms-mvp-v[data-tone="ok"]{background:rgba(47,168,98,.15);border-color:rgba(47,168,98,.6)}
.ms-mvp-v[data-tone="warn"]{background:rgba(238,138,31,.14);border-color:rgba(238,138,31,.6)}
.ms-mvp-v[data-tone="bad"]{background:rgba(229,72,77,.14);border-color:rgba(229,72,77,.6)}
.ms-mvp-f{display:flex;flex-direction:column;min-width:0}
.ms-mvp-fk{font-size:11.5px;color:var(--gg-label)}
.ms-mvp-fv{font:700 14px/1.2 system-ui,Segoe UI,Arial,sans-serif;color:#f4f6f8;font-variant-numeric:tabular-nums;white-space:nowrap}
.ms-mvp-body{flex:1 1 auto;min-height:0;overflow:auto;padding:10px 14px}
.ms-mvp-sec{margin:0 0 12px}
.ms-mvp-cap{display:flex;align-items:center;gap:8px;margin:0 0 6px;padding-bottom:4px;border-bottom:1px solid var(--gg-hair);font-weight:650;color:#e4e8ec;flex-wrap:wrap}
.ms-mvp-cap .ms-sub{font-weight:400;font-size:12px;color:var(--gg-label)}
.ms-mvp-tbl{border-collapse:collapse;font-variant-numeric:tabular-nums;width:max-content;min-width:100%}
.ms-mvp-tbl th{text-align:left;font-size:11.5px;font-weight:600;color:var(--gg-label);padding:2px 6px 4px 0;border-bottom:1px solid var(--gg-hair);white-space:nowrap;vertical-align:bottom}
.ms-mvp-tbl td{padding:3px 6px 3px 0;border-bottom:1px solid var(--gg-hair-soft);white-space:nowrap;vertical-align:middle}
.ms-mvp-tbl td.ms-r,.ms-mvp-tbl th.ms-r{text-align:right}
.ms-mvp-tbl tr.ms-sel td{background:rgba(142,193,234,.1)}
.ms-mvp-tbl tr.ms-hd td{border-top:1px solid var(--gg-hair);font-weight:650;color:#fff}
.ms-mvp-tbl tr.ms-go{cursor:pointer}
.ms-mvp-tbl tr.ms-go:hover td{background:rgba(255,255,255,.04)}
.ms-mvp-dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px;vertical-align:-1px;border:1px solid #14181d}
.ms-mvp-tag{display:inline-block;padding:1px 6px;border-radius:9px;font-size:11px;font-weight:600;background:rgba(255,255,255,.1);color:#d5dbe1;margin-left:4px}
.ms-mvp-tag.ms-bad{background:rgba(229,72,77,.25);color:#ffb3b5}
.ms-mvp-tag.ms-warn{background:rgba(238,138,31,.25);color:#ffd09a}
.ms-mvp-tag.ms-ok{background:rgba(47,168,98,.25);color:#a6ebc4}
.ms-mvp-chip{display:inline-flex;align-items:center;gap:4px;padding:1px 4px 1px 7px;border-radius:10px;background:rgba(255,255,255,.08);margin:1px 3px 1px 0;font-size:12px}
.ms-mvp-chip button{border:0;background:transparent;color:#ff8a8d;cursor:pointer;font-size:13px;padding:0 2px}
.ms-mvp-note{font-size:12px;color:var(--gg-label);margin:4px 0}
.ms-mvp-note.ms-bad{color:#ff8a8d}
.ms-mvp-note.ms-warn{color:#ffd27a}
.ms-mvp-time{flex:none;display:flex;align-items:center;gap:10px;padding:6px 14px;border-top:1px solid var(--gg-hair);background:var(--gg-strip)}
.ms-mvp-time input[type=range]{flex:1;height:auto;padding:0;accent-color:#8ec1ea;background:transparent;border:0}
.ms-mvp-time b{font:700 13.5px/1 system-ui,Segoe UI,Arial,sans-serif;color:#fff;min-width:96px;font-variant-numeric:tabular-nums}
.ms-mvp-grid2{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
.ms-mvp-empty{padding:18px;color:var(--gg-label);text-align:center}
`;

let cssDone = false;
function ensureCss(): void {
  if (cssDone) return;
  cssDone = true;
  ensureTokensCss();
  const st = document.createElement('style');
  st.id = 'ms-move-planner-css';
  st.textContent = PANEL_CSS;
  document.head.appendChild(st);
}

const opt = (v: string, label: string, cur: string) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;
const num = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '' : String(v));

export class MovePlannerPanel {
  private _root: HTMLDivElement | null = null;
  private _view: MvView = 'setup';
  private _host: PanelHost;
  private _graphRoute = '';
  private _flowPoint = '';
  private _diPri = 0;
  private _play: ReturnType<typeof setInterval> | null = null;
  private _raf: ReturnType<typeof setTimeout> | null = null;
  constructor(host: PanelHost) {
    this._host = host;
  }

  get isOpen(): boolean {
    return !!this._root?.classList.contains('ms-open');
  }
  get view(): MvView {
    return this._view;
  }

  open(view?: MvView): void {
    ensureCss();
    if (!this._root) this._build();
    if (view) this._view = view;
    this._root!.classList.add('ms-open');
    this.render();
  }

  close(): void {
    this._stopPlay();
    this._root?.classList.remove('ms-open');
  }

  destroy(): void {
    this._stopPlay();
    if (this._raf) clearTimeout(this._raf);
    this._root?.remove();
    this._root = null;
  }

  /** Next (or previous) view of the kind. */
  step(dir: 1 | -1): void {
    const vs = VIEWS[this._host.plan().kind];
    const i = vs.indexOf(this._view);
    this._view = vs[(i + dir + vs.length) % vs.length];
    this.render();
  }

  setView(v: MvView): void {
    this._view = v;
    this.render();
  }

  private _build(): void {
    const el = document.createElement('div');
    el.className = 'ms-mvp';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Move Planner');
    el.addEventListener('click', (e) => this._onClick(e));
    el.addEventListener('change', (e) => this._onChange(e));
    el.addEventListener('input', (e) => this._onInput(e));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') (e.target as HTMLInputElement).blur();
      e.stopPropagation();
    });
    document.body.appendChild(el);
    this._root = el;
  }

  // ── rendering ─────────────────────────────────────────────────────────────────────────────────────────────────────

  render(): void {
    const el = this._root;
    if (!el || !this.isOpen) return;
    const p = this._host.plan();
    if (!VIEWS[p.kind].includes(this._view)) this._view = 'setup';
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.fk ?? null;
    const scroll = el.querySelector('.ms-mvp-body')?.scrollTop ?? 0;
    const res = this._host.result();
    el.innerHTML = `${this._head(p)}${this._strip(p)}${this._viewTabs(p)}${this._answer(p, res)}<div class="ms-mvp-body">${this._body(p, res)}</div>${this._timeRow(p, res)}`;
    const body = el.querySelector('.ms-mvp-body') as HTMLElement;
    body.scrollTop = scroll;
    if (focusKey) (el.querySelector(`[data-fk="${CSS.escape(focusKey)}"]`) as HTMLElement | null)?.focus();
    if (body.querySelector('[data-pic]')) {
      if (this._raf) clearTimeout(this._raf);
      this._raf = setTimeout(() => this._drawPictures(), 0);
    }
  }

  /** Redraw only what follows the time (the graph cursor and the time label). */
  renderTime(): void {
    if (!this.isOpen || !this._root) return;
    const t = this._host.time();
    const lab = this._root.querySelector('.ms-mvp-time b');
    if (lab && t !== null) lab.textContent = dtg(this._host.result()!.clock, t);
    const rng = this._root.querySelector('.ms-mvp-time input[type=range]') as HTMLInputElement | null;
    if (rng && t !== null && document.activeElement !== rng) rng.value = String(Math.round(t / MIN));
    if (this._view === 'graph' || this._view === 'matrix') this._drawPictures();
  }

  private _head(p: MvPlanDoc): string {
    const tabs = KINDS.map((k) => `<button class="ms-mvp-tab" data-act="kind" data-v="${k}" aria-selected="${p.kind === k}" title="${esc(KIND_LONG[k])}">${esc(KIND_LABEL[k])}</button>`).join('');
    return `<div class="ms-mvp-h"><span class="ms-mvp-name">🚚 Mov Plan</span><div class="ms-mvp-tabs" role="tablist">${tabs}</div>
      <input class="ms-ww" data-p="title" data-fk="title" value="${esc(p.title)}" aria-label="Plan title">
      <span class="ms-mvp-sp"></span>
      <button class="ms-mvp-btn" data-act="new" title="Start an empty plan of this kind">New</button>
      <button class="ms-mvp-btn" data-act="open" title="Open a plan (.json)">Open</button>
      <button class="ms-mvp-btn" data-act="save" title="Save the plan as .json">Save</button>
      <button class="ms-mvp-btn" data-act="copy" title="Copy the mov table as text">Copy as Text</button>
      <button class="ms-mvp-btn" data-act="tall" title="Taller / shorter">⇕</button>
      <button class="ms-mvp-btn ms-x" data-act="close" aria-label="Close" title="Close (Esc)">×</button></div>`;
  }

  private _strip(p: MvPlanDoc): string {
    const light = `<label>Lt <select data-p="light" data-fk="light" title="First / last light">${opt('sun', 'Sunrise / Sunset', p.light)}${opt('civil', 'Civil twilight', p.light)}${opt('nautical', 'Nautical twilight', p.light)}</select></label>`;
    const mday = `<label>M Day <input type="date" data-p="mDate" data-fk="mDate" value="${esc(p.mDate)}"></label><label>UTC+<input class="ms-nn" type="number" step="0.5" data-p="offsetH" data-fk="offsetH" value="${p.offsetMin / 60}"></label>`;
    if (p.kind === 'rail') {
      const r = p.rail;
      const routes = `<option value="">Straight x ${this._host.rules().rail.circuity}</option>${p.routes.map((x) => opt(x.id, `${x.name} (${routeKm(x).toFixed(0)} km)`, r.routeId ?? '')).join('')}`;
      const wagons = (['MBFR', 'MBFU', 'BKF', 'KF', 'C', 'TLR'] as StockType[]).map((k) => `<label title="${esc(k)} the railway gives a ${r.moveType === 'night' ? 'night' : 'day'} (blank = as many as needed)">${k}<input class="ms-nn" type="number" min="0" data-rail="stock.${k}" data-fk="stock.${k}" value="${num(r.stockPerDay?.[k])}"></label>`).join('');
      return `<div class="ms-mvp-strip">${mday}${light}
        <label>E.Sta <input class="ms-w" data-rail="eSta" data-fk="eSta" value="${esc(r.eSta)}"><button class="ms-mvp-btn ms-sm" data-act="pick" data-what="eSta" title="Click the entraining station on the map">📍</button></label>
        <label>D.Sta <input class="ms-w" data-rail="dSta" data-fk="dSta" value="${esc(r.dSta)}"><button class="ms-mvp-btn ms-sm" data-act="pick" data-what="dSta" title="Click the detraining station on the map">📍</button></label>
        <label>Route <select data-rail="routeId" data-fk="routeId">${routes}</select></label>
        <label>Line <select data-rail="line" data-fk="line">${opt('main', 'Main (32)', r.line)}${opt('branch', 'Branch (24)', r.line)}</select></label>
        <label>kmph <input class="ms-nn" type="number" min="1" data-rail="kmh" data-fk="kmh" value="${num(r.kmh)}" placeholder="${r.line === 'branch' ? 24 : 32}"></label>
        <label>Mov <select data-rail="moveType" data-fk="moveType">${opt('night', 'Ni', r.moveType)}${opt('day', 'Day', r.moveType)}${opt('both', 'Day & Ni', r.moveType)}</select></label>
        <label>From M+<input class="ms-nn" type="number" data-rail="startDay" data-fk="startDay" value="${r.startDay}"> <input class="ms-t" data-rail="start" data-fk="rstart" value="${esc(r.start)}"></label>
        <label>Gap <input class="ms-nn" type="number" min="30" data-rail="intervalMin" data-fk="intervalMin" value="${r.intervalMin}"> min</label>
        <label title="Loading on a live line over the mob ramp: 30 / 45 min more by day / night"><input type="checkbox" data-rail="liveLine" ${r.liveLine ? 'checked' : ''}> Live line</label>
        <label title="60 min halt every 8 h running"><input type="checkbox" data-rail="halts" ${r.halts ? 'checked' : ''}> Halts</label>
        <label title="Units share a train when there is room"><input type="checkbox" data-rail="mixUnits" ${r.mixUnits ? 'checked' : ''}> Mix units</label>
        <span title="Wagons a day">Wagons: ${wagons}</span></div>`;
    }
    if (p.kind === 'enemy') {
      const t = this._host.rules().rail.times;
      return `<div class="ms-mvp-strip">${mday}${light}<span>Rail: loading ${t.loading}, unloading ${t.unloading}, unforeseen ${t.unforeseen} min; 60 min halt every 8 h; inducted ${this._host.rules().enemy.readyAfterMin / 60} h after the last train (MoveDoctrine.json)</span></div>`;
    }
    const win = `<label>Mov <select data-p="window" data-fk="window">${opt('night', 'Ni', p.window)}${opt('day', 'Day', p.window)}${opt('both', 'Day & Ni', p.window)}</select></label>`;
    const winClock = p.window === 'both' ? '' : `<label title="Clock window; blank = by first and last light">Window <input class="ms-t" data-p="windowFrom" data-fk="windowFrom" value="${esc(p.windowFrom)}" placeholder="${p.window === 'night' ? 'Last Lt' : 'First Lt'}">-<input class="ms-t" data-p="windowTo" data-fk="windowTo" value="${esc(p.windowTo)}" placeholder="${p.window === 'night' ? 'First Lt' : 'Last Lt'}"></label>`;
    const halts = `<label>Halts <select data-p="haltMode" data-fk="haltMode">${opt('running', 'By running time', p.haltMode)}${opt('clock', 'At 10 to odd hrs', p.haltMode)}${opt('none', 'Nil', p.haltMode)}</select></label>` +
      (p.haltMode === 'running' ? `<label>SH <input class="ms-nn" type="number" min="0" data-p="shMin" data-fk="shMin" value="${p.shMin}"> min / <input class="ms-nn" type="number" min="10" data-p="shRunMin" data-fk="shRunMin" value="${p.shRunMin}"> run</label><label>LH every <input class="ms-nn" type="number" min="0" data-p="lhEvery" data-fk="lhEvery" value="${p.lhEvery}"> x <input class="ms-nn" type="number" min="0" data-p="lhMin" data-fk="lhMin" value="${p.lhMin}"> min</label>` : '');
    const road = p.kind === 'di' ? `<label>Season <select data-p="season" data-fk="season">${opt('summer', 'Summer', p.season)}${opt('winter', 'Winter', p.season)}</select></label>` : `<label>Rds <select data-p="roadState" data-fk="roadState">${opt('good', 'Good', p.roadState)}${opt('hilly', 'Winding / Hilly', p.roadState)}${opt('bad', 'Bad', p.roadState)}</select></label>`;
    return `<div class="ms-mvp-strip">${mday}${light}<label>Start M+<input class="ms-nn" type="number" data-p="startDay" data-fk="startDay" value="${p.startDay}"> <input class="ms-t" data-p="start" data-fk="start" value="${esc(p.start)}"></label>${win}${winClock}${halts}${road}
      <label title="At last light the head halts Day TPP - Ni TPP for the column to close up to night density"><input type="checkbox" data-p="densityHalt" ${p.densityHalt ? 'checked' : ''}> Close up at Last Lt</label>
      <label title="Columns meeting head-on on a two-way road do not clash"><input type="checkbox" data-p="twoWay" ${p.twoWay ? 'checked' : ''}> Two-way rds</label></div>`;
  }

  private _viewTabs(p: MvPlanDoc): string {
    return `<div class="ms-mvp-views" role="tablist">${VIEWS[p.kind].map((v) => `<button class="ms-mvp-tab" data-act="view" data-v="${v}" aria-selected="${this._view === v}">${esc(VIEW_LABEL[v])}</button>`).join('')}<span class="ms-mvp-sp"></span><span class="ms-mvp-note" style="margin:0 4px 0 0">U open / close · Shift+U next view · Esc close</span></div>`;
  }

  private _answer(p: MvPlanDoc, res: MvResult | null): string {
    const facts: [string, string][] = [];
    let tone: 'ok' | 'warn' | 'bad' = 'ok';
    let word = 'Ready';
    if (!res) return `<div class="ms-mvp-ans"><span class="ms-mvp-v" data-tone="warn">Working out…</span></div>`;
    const c = res.clock;
    if (res.errors.length) {
      tone = 'bad';
      word = `${res.errors.length} to fix`;
    }
    if (p.kind === 'road' || p.kind === 'assy' || p.kind === 'di') {
      const n = res.serials.length;
      if (!n && !res.errors.length) {
        tone = 'warn';
        word = p.routes.length ? 'Add serials' : 'Add a route';
      }
      const waits = res.sched?.conflicts ?? [];
      const harb = res.serials.reduce((m, s) => m + s.run.stops.filter((x) => x.kind === 'DLH').length, 0);
      if (tone === 'ok' && n) {
        word = waits.length ? `Plan works, ${waits.length} wait${waits.length > 1 ? 's' : ''}` : 'Plan works';
        if (res.warnings.length) tone = 'warn';
      }
      facts.push(['Serials', `${n} / ${p.serials.length}`], ['Vehs', String(res.serials.reduce((m, s) => m + s.run.vehicles, 0))]);
      if (res.span) facts.push(['First SP', dtg(c, Math.min(...res.serials.map((s) => s.run.spDue)))], ['All closed', dtg(c, res.span[1])], ['Whole mov', durText((res.span[1] - res.span[0]) / MIN)]);
      facts.push(['Crossing waits', waits.length ? `${waits.length} (${waits.reduce((m, x) => m + x.waitMin, 0)} min)` : 'Nil'], ['Harbours', String(harb)]);
    } else if (p.kind === 'rail' && res.rail) {
      const r = res.rail;
      if (tone === 'ok') word = r.trains.length ? `${r.trains.length} train${r.trains.length > 1 ? 's' : ''}` : 'Add units';
      if (r.unknown.length && tone === 'ok') tone = 'warn';
      facts.push(['Dist', `${r.distKm.toFixed(0)} km`], ['Wagons', String(r.wagons)], ['Per night', `${r.perNight} trains`]);
      if (r.trains.length) facts.push(['First dep', dtg(c, r.trains[0].dep)], ['Last detrained', dtg(c, Math.max(...r.trains.map((t) => t.detrained)))]);
    } else if (p.kind === 'enemy' && res.enemy) {
      const e = res.enemy;
      const all = [...e.rail.map((x) => x.inducted), ...e.road.map((x) => x.inducted)];
      if (tone === 'ok') word = all.length ? `${all.length} fmn${all.length > 1 ? 's' : ''} estimated` : 'Add en fmns';
      if (all.length) facts.push(['First in', dtg(c, Math.min(...all))], ['All in', dtg(c, Math.max(...all))], ['Trains', String(e.rail.reduce((m, x) => m + x.trains, 0))]);
    }
    const err = res.errors.length ? `<span class="ms-mvp-note ms-bad">${esc(res.errors.slice(0, 3).join(' · '))}${res.errors.length > 3 ? ' …' : ''}</span>` : res.warnings.length ? `<span class="ms-mvp-note ms-warn">${esc(res.warnings.slice(0, 2).join(' · '))}</span>` : '';
    return `<div class="ms-mvp-ans"><span class="ms-mvp-v" data-tone="${tone}">${esc(word)}</span>${facts.map(([k, v]) => `<div class="ms-mvp-f"><span class="ms-mvp-fk">${esc(k)}</span><span class="ms-mvp-fv">${esc(v)}</span></div>`).join('')}${err}</div>`;
  }

  private _timeRow(p: MvPlanDoc, res: MvResult | null): string {
    if (!res?.span || p.kind === 'rail') return '';
    if (!(p.kind === 'enemy' ? res.enemy?.road.length : res.serials.length)) return '';
    const t = this._host.time() ?? res.span[0];
    const a = Math.floor(res.span[0] / MIN), b = Math.ceil(res.span[1] / MIN);
    return `<div class="ms-mvp-time"><button class="ms-mvp-btn" data-act="play" title="Play the move on the map">${this._play ? '⏸' : '▶'}</button><b>${esc(dtg(res.clock, t))}</b>
      <input type="range" min="${a}" max="${b}" step="5" value="${Math.round(t / MIN)}" data-act="time" aria-label="Time on the map">
      <button class="ms-mvp-btn" data-act="timeoff" title="Take the columns off the map">Off</button></div>`;
  }

  // ── bodies ────────────────────────────────────────────────────────────────────────────────────────────────────────

  private _body(p: MvPlanDoc, res: MvResult | null): string {
    switch (this._view) {
      case 'setup':
        return p.kind === 'rail' ? this._setupRail(p, res) : p.kind === 'enemy' ? this._setupEnemy(p) : this._setupRoad(p, res);
      case 'table':
        return p.kind === 'rail' ? this._railTable(p, res) : p.kind === 'enemy' ? this._enemyTable(p, res) : this._movTable(p, res);
      case 'graph':
        return `<div class="ms-mvp-sec">${p.kind === 'road' || p.kind === 'assy' || p.kind === 'di' ? this._graphPick(p) : ''}<div data-pic="graph"></div></div>`;
      case 'matrix':
        return `<div class="ms-mvp-sec">${p.kind === 'assy' ? this._blocks(p, res) : ''}<div class="ms-mvp-cap">Mov matrix<span class="ms-sub">road held by each serial from SP due to Rel P clear; night shaded</span></div><div data-pic="matrix"></div></div>`;
      case 'flow':
        return this._flow(p, res);
      case 'progress':
        return this._progress(p, res);
      case 'reports':
        return this._reports(p, res);
      case 'trains':
        return this._trains(p, res);
      case 'demand':
        return this._demand(p, res);
      case 'induction':
        return this._induction(p, res);
    }
    return '';
  }

  private _routesBlock(p: MvPlanDoc): string {
    const rows = p.routes
      .map((r) => {
        const km = routeKm(r);
        return `<tr class="${this._host.selected() === r.id ? 'ms-sel' : ''}"><td><input type="color" data-r="${r.id}" data-k="color" value="${esc(r.color)}"></td>
          <td><input class="ms-w" data-r="${r.id}" data-k="name" data-fk="r${r.id}name" value="${esc(r.name)}"></td>
          <td><input class="ms-w" data-r="${r.id}" data-k="sp" data-fk="r${r.id}sp" value="${esc(r.sp)}"></td>
          <td><input class="ms-w" data-r="${r.id}" data-k="rp" data-fk="r${r.id}rp" value="${esc(r.rp)}"></td>
          <td class="ms-r">${km.toFixed(1)}</td><td>${esc(routeDir(r))}</td>
          <td><span class="ms-mvp-tag ${r.source === 'straight' ? 'ms-warn' : ''}">${esc(r.source === 'network' ? 'on rds' : r.source === 'line' ? 'placed line' : r.source)}</span>${r.note ? `<span class="ms-mvp-note" title="${esc(r.note)}"> ${esc(r.note.length > 46 ? r.note.slice(0, 45) + '…' : r.note)}</span>` : ''}</td>
          <td>${r.cps.map((c, i) => `<span class="ms-mvp-chip">${esc(c.name)}<button data-act="delcp" data-id="${r.id}" data-i="${i}" title="Remove">×</button></span>`).join('')}<button class="ms-mvp-btn ms-sm" data-act="addcp" data-id="${r.id}" title="Click a critical point on the map">+ CP</button></td>
          <td><button class="ms-mvp-btn ms-sm" data-act="goroute" data-id="${r.id}">Go</button> <button class="ms-mvp-btn ms-sm" data-act="delroute" data-id="${r.id}" title="Remove the route">✕</button></td></tr>`;
      })
      .join('');
    return `<div class="ms-mvp-sec"><div class="ms-mvp-cap">Routes<span class="ms-sub">${esc(this._host.networkWord())}</span><span class="ms-mvp-sp"></span>
      <button class="ms-mvp-btn ms-pri" data-act="route" data-v="network" title="Click the SP, any points to pass, double-click the Rel P: solved on the road network (else the clicks are the route)">+ Route on Rds</button>
      <button class="ms-mvp-btn" data-act="route" data-v="draw" title="Draw the route by hand: click points, double-click to finish">+ Draw Route</button>
      <button class="ms-mvp-btn" data-act="route" data-v="line" title="Use the selected line symbol as a route">+ Selected Line</button></div>
      ${p.routes.length ? `<table class="ms-mvp-tbl"><tr><th></th><th>Route</th><th>SP</th><th>Rel P</th><th class="ms-r">km</th><th>Dir</th><th>Made</th><th>Critical Pts</th><th></th></tr>${rows}</table>` : `<div class="ms-mvp-empty">No route yet. "+ Route on Rds" and click the SP, then the Rel P.</div>`}</div>`;
  }

  private _setupRoad(p: MvPlanDoc, res: MvResult | null): string {
    const R = this._host.rules();
    const routeOpts = (cur: string | null) => `<option value="">-</option>${p.routes.map((r) => opt(r.id, r.name, cur ?? '')).join('')}`;
    const di = p.kind === 'di', assy = p.kind === 'assy', road = p.kind === 'road';
    const head = `<tr><th>Ser</th><th>${di ? 'Unit' : assy ? 'Colm' : 'Serial / Unit'}</th>${assy || di ? '<th>Fmn</th>' : ''}${di ? '<th>Corps</th><th>Op Corps</th><th title="Priority: corps / group / unit (1 = first)">Pri C/G/U</th><th>Arm</th><th title="HMT: own / bus / truck">Vehs own/bus/trk</th><th title="Concentration time DL to SP, summer / winter (min)">Conc S/W</th><th>DL</th>' : `<th class="ms-r">Vehs</th>`}${assy ? '<th title="Group priority / order">Pri G/U</th><th>Assy area</th>' : ''}${road ? '<th title="Order of march (priority at crossings)">OOM</th><th title="Tanks, transporters etc in the column: the slower speeds">Tks</th>' : ''}<th>Route</th><th title="Start time (blank = the plan\'s)">Start</th><th title="Delay after the start (min)">Delay</th><th title="Speed day / night, kmph (blank = doctrine)">Spd D/N</th><th title="Density day / night, vpkm (blank = doctrine)">Dens D/N</th>${road ? '<th title="Loading before the SP / unloading after the Rel P (min)">Ld/Unld</th>' : ''}<th class="ms-r">TPP D/N</th><th>SP due</th><th>Closed</th><th></th></tr>`;
    const rows = p.serials
      .map((s, i) => {
        const r = res?.serials.find((x) => x.doc.id === s.id);
        const sp = r ? [r.speedDay, r.speedNi] : null;
        const dn = r ? [r.densDay, r.densNi] : null;
        const f = (k: keyof MvSerialDoc, cls: string, val: string, ph = '', type = 'text') => `<input class="${cls}" type="${type}" data-s="${s.id}" data-k="${k}" data-fk="${s.id}${k}" value="${esc(val)}" placeholder="${esc(ph)}">`;
        const err = res?.errors.find((e) => e.startsWith(`${s.name}:`));
        const tpp = r ? `${r.run.tppDay}/${r.run.tppNi}` : '';
        return `<tr class="${this._host.selected() === s.id ? 'ms-sel' : ''}"><td>${i + 1}</td><td>${f('name', 'ms-w', s.name)}${err ? `<span class="ms-mvp-tag ms-bad" title="${esc(err)}">!</span>` : ''}</td>
          ${assy || di ? `<td>${f('fmn', 'ms-w', s.fmn)}</td>` : ''}
          ${di ? `<td>${f('corps', 'ms-w', s.corps)}</td><td>${f('opCorps', 'ms-w', s.opCorps)}</td><td>${f('corpsPri', 'ms-nn', num(s.corpsPri), '', 'number')}${f('gpPri', 'ms-nn', num(s.gpPri), '', 'number')}${f('unitPri', 'ms-nn', num(s.unitPri), '', 'number')}</td>
            <td><select data-s="${s.id}" data-k="arm">${Object.entries(R.arms.arms).map(([k, a]) => opt(k, a.label, s.arm)).join('')}</select></td>
            <td><input class="ms-nn" type="number" min="0" data-s="${s.id}" data-k="hmt.own" value="${num(s.hmt?.own)}"><input class="ms-nn" type="number" min="0" data-s="${s.id}" data-k="hmt.bus" value="${num(s.hmt?.bus)}"><input class="ms-nn" type="number" min="0" data-s="${s.id}" data-k="hmt.trk" value="${num(s.hmt?.trk)}"></td>
            <td>${f('concSummer', 'ms-nn', num(s.concSummer), '', 'number')}${f('concWinter', 'ms-nn', num(s.concWinter), '', 'number')}</td>
            <td><button class="ms-mvp-btn ms-sm" data-act="pick" data-what="dl" data-id="${s.id}" title="Click the unit's peace location on the map">${s.dl ? '✓ 📍' : '📍'}</button></td>`
            : `<td class="ms-r">${f('vehicles', 'ms-n', num(s.vehicles), '', 'number')}</td>`}
          ${assy ? `<td>${f('gpPri', 'ms-nn', num(s.gpPri), '', 'number')}${f('unitPri', 'ms-nn', num(s.unitPri), '', 'number')}</td><td><select data-s="${s.id}" data-k="assySize">${Object.keys(R.space.assyKm2).filter((k) => k !== 'estimates').map((k) => opt(k, k.replace('_', ' '), s.assySize)).join('')}</select> <button class="ms-mvp-btn ms-sm" data-act="pick" data-what="assy" data-id="${s.id}" title="Draw the assembly area">${s.assyArea ? '✓ ✎' : '✎'}</button></td>` : ''}
          ${road ? `<td>${f('unitPri', 'ms-nn', num(s.unitPri), '', 'number')}</td><td><input type="checkbox" data-s="${s.id}" data-k="allTypes" ${s.allTypes ? 'checked' : ''}></td>` : ''}
          <td><select data-s="${s.id}" data-k="routeId">${routeOpts(s.routeId)}</select></td>
          <td>${f('start', 'ms-t', s.start, p.start)}</td><td>${f('delayMin', 'ms-nn', num(s.delayMin), '0', 'number')}</td>
          <td>${f('speedDay', 'ms-nn', num(s.speedDay), sp ? String(sp[0]) : '', 'number')}${f('speedNi', 'ms-nn', num(s.speedNi), sp ? String(sp[1]) : '', 'number')}</td>
          <td>${f('densDay', 'ms-nn', num(s.densDay), dn ? String(dn[0]) : '', 'number')}${f('densNi', 'ms-nn', num(s.densNi), dn ? String(dn[1]) : '', 'number')}</td>
          ${road ? `<td>${f('loadMin', 'ms-nn', num(s.loadMin), '0', 'number')}${f('unloadMin', 'ms-nn', num(s.unloadMin), '0', 'number')}</td>` : ''}
          <td class="ms-r">${esc(tpp)}</td><td>${r ? esc(dtg(res!.clock, r.run.spDue)) : ''}</td><td>${r ? esc(dtg(res!.clock, r.closedMs)) : ''}</td>
          <td><button class="ms-mvp-btn ms-sm" data-act="sel" data-id="${s.id}" title="Show this serial on the map and the graph">◎</button> <button class="ms-mvp-btn ms-sm" data-act="delser" data-id="${s.id}" title="Remove">✕</button></td></tr>`;
      })
      .join('');
    const vehs = p.serials.reduce((m, s) => m + vehiclesOf(s, p.kind), 0);
    return `${this._routesBlock(p)}<div class="ms-mvp-sec"><div class="ms-mvp-cap">${di ? 'Units to de-induct' : assy ? 'Columns' : 'Serials'}<span class="ms-sub">${p.serials.length} · ${vehs} vehs${di ? ' · vehs = HMT own + bus + trk (default 10 / 7 / 10 a unit)' : ''}</span><span class="ms-mvp-sp"></span>
      <button class="ms-mvp-btn ms-pri" data-act="addser">+ ${di ? 'Unit' : assy ? 'Colm' : 'Serial'}</button><button class="ms-mvp-btn" data-act="fromsel" title="Make serials from the unit symbols selected on the map (name, SIDC, location)">+ From Selected Symbols</button></div>
      ${p.serials.length ? `<div style="overflow-x:auto"><table class="ms-mvp-tbl">${head}${rows}</table></div>` : `<div class="ms-mvp-empty">No serials yet.</div>`}</div>`;
  }

  private _setupRail(p: MvPlanDoc, res: MvResult | null): string {
    const R = this._host.rules();
    const kinds = Object.entries(R.rail.kinds);
    const rows = p.serials
      .map((s, i) => {
        const chips = s.mix.map((m, j) => `<span class="ms-mvp-chip">${m.count} ${esc(R.rail.kinds[m.kind]?.label.split(' (')[0] ?? m.kind)}<button data-act="delmix" data-id="${s.id}" data-i="${j}">×</button></span>`).join('');
        return `<tr><td>${i + 1}</td><td><input class="ms-w" data-s="${s.id}" data-k="name" data-fk="${s.id}name" value="${esc(s.name)}"></td>
          <td style="white-space:normal;max-width:520px">${chips}<span style="white-space:nowrap"><select data-mixkind="${s.id}">${kinds.map(([k, v]) => opt(k, v.label, '')).join('')}</select><input class="ms-nn" type="number" min="1" value="1" data-mixn="${s.id}"><button class="ms-mvp-btn ms-sm" data-act="addmix" data-id="${s.id}">+ Add</button></span></td>
          <td><input class="ms-n" type="number" min="0" data-s="${s.id}" data-k="pax" data-fk="${s.id}pax" value="${num(s.pax)}"></td>
          <td><input class="ms-nn" type="number" min="0" data-s="${s.id}" data-k="storesTons" data-fk="${s.id}st" value="${num(s.storesTons)}"></td>
          <td><button class="ms-mvp-btn ms-sm" data-act="delser" data-id="${s.id}">✕</button></td></tr>`;
      })
      .join('');
    const unknown = res?.rail?.unknown.length ? `<div class="ms-mvp-note ms-warn">Not loaded (no wagon in the table): ${esc(res.rail.unknown.map((u) => `${u.count} ${u.kind}`).join(', '))}</div>` : '';
    return `${this._routesBlock(p)}<div class="ms-mvp-sec"><div class="ms-mvp-cap">Units by rail<span class="ms-sub">vehicles by kind go on the wagons the table names (2 T-series tks per MBFR, 2 APCs per BKF ...); crews ride in each train's TLR; extra personnel 60 a TLR; stores 20 t a C</span><span class="ms-mvp-sp"></span><button class="ms-mvp-btn ms-pri" data-act="addser">+ Unit</button></div>
      ${p.serials.length ? `<table class="ms-mvp-tbl"><tr><th>Ser</th><th>Unit</th><th>Vehicles</th><th>Extra Pers</th><th>Stores t</th><th></th></tr>${rows}</table>` : '<div class="ms-mvp-empty">No units yet.</div>'}${unknown}</div>`;
  }

  private _setupEnemy(p: MvPlanDoc): string {
    const R = this._host.rules();
    const types = Object.entries(R.enemy.types);
    const rows = p.enemy
      .map((e, i) => {
        const f = (k: string, cls: string, val: string, ph = '', type = 'text') => `<input class="${cls}" type="${type}" data-e="${e.id}" data-k="${k}" data-fk="${e.id}${k}" value="${esc(val)}" placeholder="${esc(ph)}">`;
        return `<tr><td>${i + 1}</td><td>${f('name', 'ms-w', e.name)}</td>
          <td><select data-e="${e.id}" data-k="type">${types.map(([k, v]) => opt(k, `${v.label} (${v.trains})`, e.type)).join('')}</select></td>
          <td><select data-e="${e.id}" data-k="mode">${opt('rail', 'Rail', e.mode)}${opt('road', 'Rd', e.mode)}</select></td>
          ${e.mode === 'rail' ? `<td>${f('trains', 'ms-nn', num(e.trains), String(enemyTrains(e.type, R)), 'number')}</td>
          <td>${f('eSta', 'ms-w', e.eSta)}<button class="ms-mvp-btn ms-sm" data-act="pick" data-what="eE" data-id="${e.id}">${e.eAt ? '✓📍' : '📍'}</button></td>
          <td>${f('dSta', 'ms-w', e.dSta)}<button class="ms-mvp-btn ms-sm" data-act="pick" data-what="eD" data-id="${e.id}">${e.dAt ? '✓📍' : '📍'}</button></td>
          <td>${f('distKm', 'ms-n', num(e.distKm), e.eAt && e.dAt ? 'straight x1.25' : '', 'number')}</td><td>${f('gapMin', 'ms-nn', num(e.gapMin), '', 'number')}</td><td><input type="checkbox" data-e="${e.id}" data-k="halts" ${e.halts ? 'checked' : ''}></td>`
            : `<td colspan="3"><select data-e="${e.id}" data-k="routeId"><option value="">- route -</option>${p.routes.map((r) => opt(r.id, r.name, e.routeId ?? '')).join('')}</select></td><td>${f('vehicles', 'ms-n', num(e.vehicles), String(R.enemy.roadVehs[e.type] ?? 600), 'number')}</td><td></td><td></td>`}
          <td>${f('kmh', 'ms-nn', num(e.kmh), e.mode === 'rail' ? String(R.rail.mainKmh) : `${R.enemy.roadSpeed[0]}/${R.enemy.roadSpeed[1]}`, 'number')}</td>
          <td>M+${f('startDay', 'ms-nn', num(e.startDay), '', 'number')}</td><td>${f('start', 'ms-t', e.start)}</td>
          <td><button class="ms-mvp-btn ms-sm" data-act="delen" data-id="${e.id}">✕</button></td></tr>`;
      })
      .join('');
    return `${p.enemy.some((e) => e.mode === 'road') ? this._routesBlock(p) : ''}<div class="ms-mvp-sec"><div class="ms-mvp-cap">Enemy formations<span class="ms-sub">trains by type are estimates (armd div 55, R); formations from the same station follow one another; arrivals at a station 90 min apart</span><span class="ms-mvp-sp"></span>
      <button class="ms-mvp-btn ms-pri" data-act="adden">+ En Fmn</button>${p.enemy.some((e) => e.mode === 'road') ? '' : '<button class="ms-mvp-btn" data-act="route" data-v="network" title="A road route for formations moving by road">+ Rd Route</button>'}</div>
      ${p.enemy.length ? `<div style="overflow-x:auto"><table class="ms-mvp-tbl"><tr><th>Ser</th><th>Fmn</th><th>Type (trains)</th><th>By</th><th>Trains</th><th>E.Sta</th><th>D.Sta</th><th>km / Vehs</th><th>Gap</th><th>Halts</th><th>kmph</th><th>Day</th><th>1st Dep</th><th></th></tr>${rows}</table></div>` : '<div class="ms-mvp-empty">No enemy formations yet.</div>'}</div>`;
  }

  private _movTable(p: MvPlanDoc, res: MvResult | null): string {
    if (!res?.serials.length) return `<div class="ms-mvp-empty">Nothing worked out yet: add a route and serials in Setup.</div>`;
    const c = res.clock;
    const first = res.serials[0];
    const data = `<div class="ms-mvp-note">1. Mov ${esc(p.window === 'both' ? 'Day & Ni' : p.window === 'day' ? 'by day' : 'by night')}. 2. Average speed day ${first.speedDay} / ni ${first.speedNi} kmph. 3. Density day ${first.densDay} / ni ${first.densNi} vpkm. 4. Halts ${esc(p.haltMode === 'none' ? 'nil' : p.haltMode === 'clock' ? '10 min at 10 min to each odd hr' : `${p.shMin} min after each ${p.shRunMin} min running${p.lhEvery ? `, every ${p.lhEvery} a ${p.lhMin} min long halt` : ''}`)}. TPP = vehs x 60 / flow + 2 min per 25 vehs.</div>`;
    let rows = '';
    res.serials.forEach((s, i) => {
      const r = s.run;
      const sel = this._host.selected() === s.doc.id;
      rows += `<tr class="ms-hd ms-go${sel ? ' ms-sel' : ''}" data-act="sel" data-id="${s.doc.id}"><td>${i + 1}</td><td><span class="ms-mvp-dot" style="background:${esc(s.color)}"></span>${esc(s.doc.name)}${s.doc.fmn ? ` <span class="ms-mvp-tag">${esc(s.doc.fmn)}</span>` : ''}</td><td class="ms-r">${r.vehicles}</td><td>${esc(s.route.name)}</td><td class="ms-r">${r.tppDay}/${r.tppNi}</td><td class="ms-r">${(r.lenDayM / 1000).toFixed(1)}/${(r.lenNiM / 1000).toFixed(1)}</td><td class="ms-r">${(r.lengthM / 1000).toFixed(1)}</td><td colspan="9">${r.warnings.map((w) => `<span class="ms-mvp-tag ms-warn">${esc(w)}</span>`).join('')}</td></tr>`;
      if (s.conc) rows += `<tr><td></td><td class="ms-mvp-note">a.</td><td colspan="5"></td><td>DL</td><td>${esc(dtg(c, s.conc.from))}</td><td></td><td>${esc(s.route.sp)}</td><td>${esc(dtg(c, r.spDue))}</td><td></td><td colspan="2"></td><td>${esc(durHHMM(s.conc.minutes))}</td></tr>`;
      s.legs.forEach((g, j) => {
        rows += `<tr><td></td><td class="ms-mvp-note">${String.fromCharCode(97 + j + (s.conc ? 1 : 0))}.</td><td colspan="5"></td><td>${esc(g.from)}</td><td>${esc(dtg(c, g.fromDue))}</td><td>${esc(dtg(c, g.fromClear))}</td><td>${esc(g.to)}</td><td>${esc(dtg(c, g.toDue))}</td><td>${esc(dtg(c, g.toClear))}</td><td class="ms-r">${g.sh}/${g.lh}/${g.dlh}${g.x ? ` +${g.x}X` : ''}</td><td class="ms-r">${g.haltMin}</td><td>${esc(durHHMM(g.totalMin))}</td></tr>`;
      });
    });
    const conf = res.sched?.conflicts.length
      ? `<div class="ms-mvp-sec"><div class="ms-mvp-cap">Crossings<span class="ms-sub">the serial of lower priority waits until the other has cleared the point + ${this._host.rules().road.bufferMin} min</span></div><table class="ms-mvp-tbl"><tr><th>Where</th><th>Priority</th><th>Waits</th><th class="ms-r">Wait</th><th>Was due</th><th>Other clear</th></tr>${res.sched.conflicts
          .map((x) => {
            const nm = (id: string) => p.serials.find((s) => s.id === id)?.name ?? id;
            return `<tr class="ms-go" data-act="goat" data-x="${x.at[0]}" data-y="${x.at[1]}"><td>${esc(MEET_WORD[x.kind])}</td><td>${esc(nm(x.winner))}</td><td>${esc(nm(x.loser))}</td><td class="ms-r">${esc(durText(x.waitMin))}</td><td>${esc(dtg(c, x.dueMs))}</td><td>${esc(dtg(c, x.winnerClear))}</td></tr>`;
          })
          .join('')}</table></div>`
      : '';
    return `<div class="ms-mvp-sec"><div class="ms-mvp-cap">Mov Table<span class="ms-sub">Due = the head reaches the point; Clear = the tail has passed it</span></div>${data}
      <div style="overflow-x:auto"><table class="ms-mvp-tbl"><tr><th>Ser</th><th>Unit</th><th class="ms-r">Vehs</th><th>Route</th><th class="ms-r">TPP D/N</th><th class="ms-r">Lgth km</th><th class="ms-r">Dist km</th><th>From</th><th>Due</th><th>Clear</th><th>To</th><th>Due</th><th>Clear</th><th class="ms-r">SH/LH/DLH</th><th class="ms-r">Halts min</th><th>Total</th></tr>${rows}</table></div></div>${conf}`;
  }

  private _graphPick(p: MvPlanDoc): string {
    const res = this._host.result();
    const chips = (res?.serials ?? [])
      .filter((s) => !this._graphRoute || s.route.id === this._graphRoute)
      .map((s) => `<button class="ms-mvp-chip" style="border:0;color:#f1f3f6;cursor:pointer" data-act="sel" data-id="${esc(s.doc.id)}" title="Pick out this serial"><span class="ms-mvp-dot" style="background:${esc(s.color)}"></span>${esc(s.doc.name)}</button>`)
      .join('');
    return `<div class="ms-mvp-cap">Mov graph<span class="ms-sub">each band is the road a serial holds, head to tail; flat = halted; X = waiting at a crossing; night shaded</span><span class="ms-mvp-sp"></span><label>Route <select data-act="graphroute">${opt('', "All (each serial's own km)", this._graphRoute)}${p.routes.map((r) => opt(r.id, r.name, this._graphRoute)).join('')}</select></label></div><div style="margin:-2px 0 6px">${chips}</div>`;
  }

  private _blocks(_p: MvPlanDoc, res: MvResult | null): string {
    const b = res?.assy?.blocks ?? [];
    const sp = res?.assy?.space ?? [];
    const c = res?.clock;
    return `<div class="ms-mvp-grid2"><div class="ms-mvp-sec"><div class="ms-mvp-cap">Block timings<span class="ms-sub">by formation: first SP due to last Rel P clear</span></div>${b.length && c ? `<table class="ms-mvp-tbl"><tr><th>Ser</th><th>Fmn</th><th>ST</th><th>FT</th><th class="ms-r">Hrs</th></tr>${b.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.fmn)}</td><td>${esc(dtg(c, x.start))}</td><td>${esc(dtg(c, x.finish))}</td><td class="ms-r">${esc(durHHMM((x.finish - x.start) / MIN))}</td></tr>`).join('')}</table>` : '<div class="ms-mvp-note">-</div>'}</div>
      <div class="ms-mvp-sec"><div class="ms-mvp-cap">Assembly areas<span class="ms-sub">size against the map squares needed (armd bde gp 12-16, armd div 100-130; others estimates)</span></div>${sp.length ? `<table class="ms-mvp-tbl">${sp.map((x) => `<tr><td>${esc(x.name)}</td><td><span class="ms-mvp-tag ms-${x.tone}">${esc(x.text)}</span></td></tr>`).join('')}</table>` : '<div class="ms-mvp-note">Draw each column\'s assembly area (✎ in Setup) to check its size.</div>'}</div></div>`;
  }

  private _flow(p: MvPlanDoc, res: MvResult | null): string {
    if (!res?.serials.length) return `<div class="ms-mvp-empty">Nothing worked out yet.</div>`;
    const pts: { key: string; label: string; route: string; s: number }[] = [];
    for (const r of p.routes) {
      const km = routeKm(r) * 1000;
      pts.push({ key: `${r.id}|0`, label: `${r.name}: ${r.sp}`, route: r.id, s: 0 });
      for (const c of r.cps) {
        const sr = res.serials.find((x) => x.route.id === r.id);
        if (sr) {
          const leg = sr.legs.find((g) => g.from === c.name);
          if (leg) pts.push({ key: `${r.id}|${Math.round(leg.fromS)}`, label: `${r.name}: ${c.name}`, route: r.id, s: leg.fromS });
        }
      }
      pts.push({ key: `${r.id}|${Math.round(km)}`, label: `${r.name}: ${r.rp}`, route: r.id, s: km });
    }
    const cur = pts.find((x) => x.key === this._flowPoint) ?? pts[0];
    if (!cur) return '';
    const entries = res.serials.filter((s) => s.route.id === cur.route).map((s) => ({ id: s.doc.id, vehicles: s.run.vehicles, due: dueAt(s.run, Math.min(cur.s, s.run.lengthM)), clear: clearAt(s.run, Math.min(cur.s, s.run.lengthM)) }));
    const rows = flowAt(entries);
    const nm = (id: string) => p.serials.find((s) => s.id === id)?.name ?? id;
    const R = this._host.rules().road;
    const maxRow = Math.max(1, ...rows.map((r) => r.total));
    return `<div class="ms-mvp-sec"><div class="ms-mvp-cap">Planning table<span class="ms-sub">vehicles past the point in each hour (SO's Hbk 906): check the total against the road's capacity</span><span class="ms-mvp-sp"></span><label>Point <select data-act="flowpt">${pts.map((x) => opt(x.key, x.label, cur.key)).join('')}</select></label></div>
      <table class="ms-mvp-tbl"><tr><th>Hour</th><th>Serials (vehs)</th><th class="ms-r">Total vph</th><th style="width:260px"></th></tr>${rows
        .map((r) => `<tr><td>${esc(`${mDayLabel(mDayOf(res.clock, r.hourMs))} ${hhmm(res.clock, r.hourMs)}-${hhmm(res.clock, r.hourMs + 3600000)}`)}</td><td>${r.bySerial.map((x) => `${esc(nm(x.id))} ${x.vehs}`).join(', ') || '-'}</td><td class="ms-r">${r.total}</td><td><div style="height:9px;border-radius:3px;background:${VIZ.accent};width:${Math.round((r.total / maxRow) * 250)}px"></div></td></tr>`)
        .join('')}</table>
      <div class="ms-mvp-note">Flow of a serial = density x speed: day ${esc(String(res.serials[0].densDay * res.serials[0].speedDay))} vph, night ${esc(String(res.serials[0].densNi * res.serials[0].speedNi))} vph. Extra allowance ${R.extraMin} min per ${R.extraPer} vehs.</div></div>`;
  }

  private _progress(_p: MvPlanDoc, res: MvResult | null): string {
    if (!res?.di) return '';
    return `<div class="ms-mvp-sec"><div class="ms-mvp-cap">Progress of de-induction<span class="ms-sub">share of each corps' units closed in by the end of each day (bright = some closed that day)</span><span class="ms-mvp-sp"></span><label>Pri <select data-act="dipri">${opt('0', 'All', String(this._diPri))}${opt('1', 'I', String(this._diPri))}${opt('2', 'II', String(this._diPri))}${opt('3', 'III', String(this._diPri))}</select></label></div><div data-pic="progress"></div></div>`;
  }

  private _reports(_p: MvPlanDoc, res: MvResult | null): string {
    if (!res?.di) return '';
    const R = this._host.rules();
    const units = res.di.units;
    const aw = armWise(units, R.arms);
    const pw = priWise(units);
    const hm = hmtByFmn(units);
    const colors = this._opColors(units.map((u) => u.opCorps));
    const opLegend = Object.entries(colors).map(([k, c]) => `<span class="ms-mvp-chip"><span class="ms-mvp-dot" style="background:${c}"></span>${esc(k)}</span>`).join('');
    const armT = `<table class="ms-mvp-tbl"><tr><th>Arm</th>${aw.corps.map((c) => `<th class="ms-r">${esc(c)}</th>`).join('')}<th class="ms-r">Total</th></tr>${aw.arms
      .map((a) => {
        let tot = 0;
        const cells = aw.corps
          .map((c) => {
            const m = aw.cell(a, c);
            const parts = Object.entries(m).map(([op, n]) => {
              tot += n;
              return `<span style="color:${colors[op] ?? '#fff'};font-weight:700">${n}</span>`;
            });
            return `<td class="ms-r">${parts.join(' + ') || ''}</td>`;
          })
          .join('');
        return `<tr><td>${esc(R.arms.arms[a]?.label ?? a)}</td>${cells}<td class="ms-r">${tot || ''}</td></tr>`;
      })
      .join('')}</table>`;
    const priT = `<table class="ms-mvp-tbl"><tr><th>Pri</th>${pw.corps.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${pw.rows
      .map((r) => `<tr><td>${['I', 'II', 'III'][r.pri - 1]}</td>${pw.corps.map((c) => `<td style="white-space:normal;vertical-align:top">${(r.cells[c] ?? []).map((f) => `<div><b>${esc(f.fmn)}</b>: ${f.units.map((u) => `<span style="color:${colors[u.opCorps] ?? '#fff'}">${esc(u.name)}</span>`).join(', ')}</div>`).join('')}</td>`).join('')}</tr>`)
      .join('')}</table>`;
    const hmT = `<table class="ms-mvp-tbl"><tr><th>Ser</th><th>Op Corps</th><th>Fmn</th><th class="ms-r">Bus</th><th class="ms-r">Trk</th></tr>${hm.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.opCorps)}</td><td>${esc(r.fmn)}</td><td class="ms-r">${r.bus}</td><td class="ms-r">${r.trk}</td></tr>`).join('')}<tr class="ms-hd"><td></td><td>Total</td><td></td><td class="ms-r">${hm.reduce((m, r) => m + r.bus, 0)}</td><td class="ms-r">${hm.reduce((m, r) => m + r.trk, 0)}</td></tr></table>`;
    return `<div class="ms-mvp-note">Op corps: ${opLegend}</div><div class="ms-mvp-grid2"><div class="ms-mvp-sec"><div class="ms-mvp-cap">Arm-wise<span class="ms-sub">units by arm and giving corps, coloured by op corps</span></div>${armT}</div>
      <div class="ms-mvp-sec"><div class="ms-mvp-cap">HMT by fmn<span class="ms-sub">buses and trucks to be hired</span></div>${hmT}</div></div>
      <div class="ms-mvp-sec"><div class="ms-mvp-cap">Priority-wise<span class="ms-sub">formations by group priority and giving corps</span></div>${priT}</div>`;
  }

  private _opColors(names: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    [...new Set(names.map((n) => n || '-'))].forEach((n, i) => (out[n] = ROUTE_COLORS[i % ROUTE_COLORS.length]));
    return out;
  }

  private _trains(p: MvPlanDoc, res: MvResult | null): string {
    const r = res?.rail;
    if (!r || !r.trains.length) return `<div class="ms-mvp-empty">No trains yet: set the stations and add units with their vehicles in Setup.</div>`;
    const R = this._host.rules();
    const c = res!.clock;
    return `<div class="ms-mvp-sec"><div class="ms-mvp-cap">Trains<span class="ms-sub">each within ${R.rail.maxC} C units (engines not counted), ${R.rail.maxTons} tons and ${R.rail.maxMbfrDouble} double-loaded MBFRs; marshalled for departure, tanks facing forward</span></div>
      ${r.trains
        .map((t) => {
          const names = t.units.map((u) => p.serials.find((s) => s.id === u)?.name ?? u).join(', ');
          const st = (['MBFR', 'MBFU', 'BKF', 'KF', 'C', 'TLR'] as StockType[]).filter((k) => t.stock[k]).map((k) => `${t.stock[k]} ${k}`).join(' · ');
          const tone = t.checks.length ? 'ms-bad' : t.c > R.rail.maxC - 4 || t.tons > R.rail.maxTons - 100 ? 'ms-warn' : 'ms-ok';
          return `<div style="margin:0 0 10px"><div><b style="color:#fff">${esc(t.name)}</b> <span class="ms-mvp-tag">${esc(t.kind)}</span> ${esc(names)} <span class="ms-mvp-tag ${tone}">${t.c} C · ${t.tons} t${t.mbfrDouble ? ` · ${t.mbfrDouble} MBFR x2` : ''}</span> <span class="ms-mvp-note">${esc(st)} · dep ${esc(dtg(c, t.dep))}, arr ${esc(dtg(c, t.arr))}</span>${t.checks.map((x) => `<span class="ms-mvp-tag ms-bad">${esc(x)}</span>`).join('')}</div><div data-pic="train" data-n="${t.n}"></div></div>`;
        })
        .join('')}</div>`;
  }

  private _railTable(p: MvPlanDoc, res: MvResult | null): string {
    const r = res?.rail;
    if (!r || !r.trains.length) return `<div class="ms-mvp-empty">No trains yet.</div>`;
    const c = res!.clock;
    const R = this._host.rules();
    const dayLab = (d: number) => (p.rail.moveType === 'night' ? `Ni ${mDayLabel(d)}/${mDayLabel(d + 1)}` : mDayLabel(d));
    return `<div class="ms-mvp-sec"><div class="ms-mvp-cap">Rail mov table<span class="ms-sub">${esc(`${r.distKm.toFixed(0)} km (${r.distSource}) at ${r.kmh} kmph; ${p.rail.eSta || 'E.Sta'} to ${p.rail.dSta || 'D.Sta'}; gap ${Math.max(p.rail.intervalMin, R.rail.stationMin)} min; ${p.rail.moveType === 'night' ? `stock placed ${R.rail.placingMin} min after last light` : ''}`)}</span></div>
      <table class="ms-mvp-tbl"><tr><th>Train</th><th>M Date</th><th>Units</th><th class="ms-r">C</th><th class="ms-r">Tons</th><th>Placed</th><th>Dep</th><th>Arr</th><th>Detrained</th><th class="ms-r">Run</th><th>Notes</th></tr>${r.trains
        .map((t) => `<tr><td>${esc(t.name)}</td><td>${esc(dayLab(t.day))}</td><td>${esc(t.units.map((u) => p.serials.find((s) => s.id === u)?.name ?? u).join(', '))}</td><td class="ms-r">${t.c}</td><td class="ms-r">${t.tons}</td><td>${esc(dtg(c, t.placed))}</td><td>${esc(dtg(c, t.dep))}</td><td>${esc(dtg(c, t.arr))}</td><td>${esc(dtg(c, t.detrained))}</td><td class="ms-r">${esc(durHHMM((t.arr - t.dep) / MIN))}</td><td>${esc(t.notes.join('; '))}</td></tr>`)
        .join('')}</table></div><div class="ms-mvp-sec"><div class="ms-mvp-cap">Timetable<span class="ms-sub">placing and loading (hatched), running, unloading</span></div><div data-pic="railgantt"></div></div>`;
  }

  private _demand(p: MvPlanDoc, res: MvResult | null): string {
    const r = res?.rail;
    if (!r || !r.trains.length) return `<div class="ms-mvp-empty">No trains yet.</div>`;
    const days = [...r.demand.byDay.keys()].sort((a, b) => a - b);
    const dayLab = (d: number) => (p.rail.moveType === 'night' ? `Ni ${mDayLabel(d)}/${mDayLabel(d + 1)}` : mDayLabel(d));
    const R = this._host.rules();
    const types: StockType[] = ['Engine', 'Brake', 'MBFR', 'MBFU', 'BKF', 'KF', 'C', 'TLR'];
    return `<div class="ms-mvp-sec"><div class="ms-mvp-cap">Rolling stock required<span class="ms-sub">standard components (engines, brake vans, AD and ramp KFs, kitchen, TLR) included</span></div>
      <table class="ms-mvp-tbl"><tr><th>Stock</th>${r.trains.map((t) => `<th class="ms-r">${esc(t.name)}</th>`).join('')}${days.map((d) => `<th class="ms-r">${esc(dayLab(d))}</th>`).join('')}<th class="ms-r">Total</th></tr>${types
        .filter((k) => r.demand.total[k])
        .map((k) => `<tr><td><span class="ms-mvp-dot" style="background:${STOCK_COLOR[k]}"></span>${esc(R.rail.stock[k]?.label ?? k)}</td>${r.trains.map((t) => `<td class="ms-r">${t.stock[k] || ''}</td>`).join('')}${days.map((d) => `<td class="ms-r"><b>${r.demand.byDay.get(d)![k] || ''}</b></td>`).join('')}<td class="ms-r"><b>${r.demand.total[k]}</b></td></tr>`)
        .join('')}</table></div>`;
  }

  private _enemyTable(_p: MvPlanDoc, res: MvResult | null): string {
    const e = res?.enemy;
    if (!e || (!e.rail.length && !e.road.length)) return `<div class="ms-mvp-empty">No enemy formations worked out yet.</div>`;
    const c = res!.clock;
    return `<div class="ms-mvp-sec"><div class="ms-mvp-cap">En mov<span class="ms-sub">train k leaves at the first departure + k x gap; arrival adds running, halts, crossings and unforeseen; inducted when the last train has detrained + ${this._host.rules().enemy.readyAfterMin / 60} h</span></div>
      <table class="ms-mvp-tbl"><tr><th>Fmn</th><th>By</th><th class="ms-r">Trains</th><th>From - To</th><th class="ms-r">km</th><th>1st Dep</th><th>1st Arr</th><th>Last Dep</th><th>Last Arr</th><th>Inducted</th><th>Notes</th></tr>${e.rail
        .map((x) => `<tr><td>${esc(x.name)}</td><td>Rail</td><td class="ms-r">${x.trains}</td><td>${esc(`${x.eSta} - ${x.dSta}`)}</td><td class="ms-r">${x.distKm.toFixed(0)}</td><td>${esc(dtg(c, x.first.dep))}</td><td>${esc(dtg(c, x.first.arr))}</td><td>${esc(dtg(c, x.last.dep))}</td><td>${esc(dtg(c, x.last.arr))}</td><td><b>${esc(dtg(c, x.inducted))}</b></td><td>${esc(x.notes.join('; '))}</td></tr>`)
        .join('')}${e.road
        .map((x) => `<tr><td>${esc(x.doc.name)}</td><td>Rd</td><td class="ms-r">-</td><td>${esc(`${x.run.vehicles} vehs`)}</td><td class="ms-r">${(x.run.lengthM / 1000).toFixed(0)}</td><td>${esc(dtg(c, x.run.spDue))}</td><td>${esc(dtg(c, x.run.rpDue))}</td><td>${esc(dtg(c, x.run.spClear))}</td><td>${esc(dtg(c, x.run.rpClear))}</td><td><b>${esc(dtg(c, x.inducted))}</b></td><td>${esc(x.run.warnings.join('; '))}</td></tr>`)
        .join('')}</table></div>`;
  }

  private _induction(p: MvPlanDoc, res: MvResult | null): string {
    const m = res?.enemy?.matrix ?? [];
    if (!m.length) return `<div class="ms-mvp-empty">No enemy formations worked out yet.</div>`;
    const R = this._host.rules();
    const nm = (id: string) => p.enemy.find((e) => e.id === id)?.name ?? id;
    const ids = p.enemy.map((e) => e.id);
    return `<div class="ms-mvp-sec"><div class="ms-mvp-cap">Induction matrix<span class="ms-sub">Staff Duties Annex D to Ch 7: by the end of each day, what is moving and what is in the area</span></div>
      <table class="ms-mvp-tbl"><tr><th>Day</th>${ids.map((id) => `<th>${esc(nm(id))}</th>`).join('')}<th>In the area</th></tr>${m
        .map((r) => `<tr><td><b>${esc(mDayLabel(r.day))}</b></td>${ids.map((id) => `<td>${r.inducted.includes(id) ? '<span class="ms-mvp-tag ms-bad">In</span>' : r.moving.includes(id) ? '<span class="ms-mvp-tag ms-warn">Moving</span>' : ''}</td>`).join('')}<td>${esc(Object.entries(r.byType).map(([k, n]) => `${n} ${R.enemy.types[k]?.label ?? k}`).join(', ') || '-')}</td></tr>`)
        .join('')}</table></div><div class="ms-mvp-sec"><div class="ms-mvp-cap">Formations against the clock<span class="ms-sub">first train leaves to inducted; trains hatched</span></div><div data-pic="engantt"></div></div>`;
  }

  // ── pictures (sized to the body) ──────────────────────────────────────────────────────────────────────────────────

  private _drawPictures(): void {
    const el = this._root;
    const res = this._host.result();
    if (!el || !res) return;
    const p = this._host.plan();
    const body = el.querySelector('.ms-mvp-body') as HTMLElement | null;
    const W = Math.max(400, (body?.clientWidth ?? 800) - 30);
    const at: [number, number] = res.serials[0]?.route.pts[0] ?? p.rail.eAt ?? p.enemy[0]?.eAt ?? [74.3, 31.5];
    const cursor = this._host.time();
    const g = el.querySelector('[data-pic="graph"]') as HTMLElement | null;
    if (g && res.span) {
      if (p.kind === 'rail' || p.kind === 'enemy') {
        g.innerHTML = this._ganttFor(p, res, W, at, cursor);
      } else {
        const H = Math.max(220, (body?.clientHeight ?? 400) - 70);
        const sers = res.serials.filter((s) => !this._graphRoute || s.route.id === this._graphRoute);
        const series: TdSeries[] = sers.map((s) => ({
          id: s.doc.id,
          name: s.doc.name,
          color: s.color,
          head: s.run.segs.flatMap((x) => [[x.t0, Math.min(x.s0, s.run.lengthM) / 1000], [x.t1, Math.min(x.s1, s.run.lengthM + 1) / 1000]] as [number, number][]),
          tail: s.run.tail.map((x) => [x.t, x.s / 1000] as [number, number]),
          stops: s.run.stops,
          lengthKm: s.run.lengthM / 1000,
        }));
        const route = p.routes.find((r) => r.id === this._graphRoute);
        const marks = route && sers[0] ? [{ km: 0, name: route.sp }, ...sers[0].legs.filter((x) => x.toS < sers[0].run.lengthM - 1).map((x) => ({ km: x.toS / 1000, name: x.to })), { km: sers[0].run.lengthM / 1000, name: route.rp }] : [];
        const conflicts = (res.sched?.conflicts ?? []).filter((x) => sers.some((s) => s.doc.id === x.loser)).map((x) => ({ t: x.dueMs, km: x.sLoser / 1000, label: `${p.serials.find((s) => s.id === x.loser)?.name} waits ${x.waitMin} min (${MEET_WORD[x.kind]} ${p.serials.find((s) => s.id === x.winner)?.name})` }));
        const t0 = Math.min(...sers.map((s) => (s.conc ? s.conc.from : s.run.spDue)), res.span[0]);
        const t1 = Math.max(...sers.map((s) => s.run.tail[s.run.tail.length - 1]?.t ?? s.closedMs), res.span[1]);
        g.innerHTML = sers.length ? timeDistance({ w: W, h: H, clock: res.clock, t0: t0 - 15 * MIN, t1: t1 + 15 * MIN, series, nights: nightsOver(res.light, res.clock, t0 - DAY_MIN * MIN, t1 + DAY_MIN * MIN, at), marks, conflicts, cursor, highlight: this._host.selected() }) : '<div class="ms-mvp-empty">No serial on this route.</div>';
      }
    }
    const m = el.querySelector('[data-pic="matrix"]') as HTMLElement | null;
    if (m && res.span) {
      const rows: GanttRow[] = res.serials.map((s) => ({
        id: s.doc.id,
        label: s.doc.name,
        sub: s.doc.fmn || s.route.name,
        bars: [
          ...(s.conc ? [{ from: s.conc.from, to: s.run.spDue, color: s.color, label: 'conc', thin: true }] : []),
          { from: s.run.spDue, to: s.run.rpClear, color: s.color, label: s.route.name },
          ...s.run.stops.filter((x) => x.kind === 'DLH' || x.kind === 'X').map((x) => ({ from: x.t0, to: x.t1, color: x.kind === 'X' ? VIZ.red : VIZ.orange, label: x.label, hatch: true })),
        ],
      }));
      m.innerHTML = gantt({ w: W, clock: res.clock, t0: res.span[0] - 30 * MIN, t1: res.span[1] + 30 * MIN, rows, nights: nightsOver(res.light, res.clock, res.span[0] - DAY_MIN * MIN, res.span[1] + DAY_MIN * MIN, at), cursor });
    }
    const pr = el.querySelector('[data-pic="progress"]') as HTMLElement | null;
    if (pr && res.di) {
      const pg = progressByDay(res.di.units, res.clock, this._diPri || undefined);
      const colors: Record<string, string> = {};
      pg.corps.forEach((c, i) => (colors[c] = ROUTE_COLORS[i % ROUTE_COLORS.length]));
      pr.innerHTML = pg.days.length ? progressChart({ ...pg, colors, w: W }) : '<div class="ms-mvp-empty">No unit closed in yet.</div>';
    }
    if (p.kind === 'rail' && res.rail) {
      const R = this._host.rules();
      el.querySelectorAll('[data-pic="train"]').forEach((d) => {
        const t = res.rail!.trains.find((x) => String(x.n) === (d as HTMLElement).dataset.n);
        if (t) (d as HTMLElement).innerHTML = trainStrip(t, R.rail.stock, (k) => this._host.kindLabel(k), Math.min(W, 980));
      });
      const rg = el.querySelector('[data-pic="railgantt"]') as HTMLElement | null;
      if (rg) rg.innerHTML = this._ganttFor(p, res, W, at, cursor);
    }
    const eg = el.querySelector('[data-pic="engantt"]') as HTMLElement | null;
    if (eg) eg.innerHTML = this._ganttFor(p, res, W, at, cursor);
  }

  private _ganttFor(p: MvPlanDoc, res: MvResult, W: number, at: [number, number], cursor: number | null): string {
    if (!res.span) return '';
    const nights = nightsOver(res.light, res.clock, res.span[0] - DAY_MIN * MIN, res.span[1] + DAY_MIN * MIN, at);
    let rows: GanttRow[] = [];
    if (p.kind === 'rail' && res.rail) {
      rows = res.rail.trains.map((t) => ({
        id: String(t.n),
        label: t.name,
        sub: t.units.map((u) => p.serials.find((s) => s.id === u)?.name ?? u).join(', '),
        bars: [
          { from: t.placed, to: t.dep, color: VIZ.accent, label: 'placing, loading, marshalling', hatch: true },
          { from: t.dep, to: t.arr, color: VIZ.accent, label: 'running' },
          { from: t.arr, to: t.detrained, color: VIZ.green, label: 'unloading', hatch: true },
        ],
      }));
    } else if (p.kind === 'enemy' && res.enemy) {
      rows = [
        ...res.enemy.rail.map((x) => ({
          id: x.id,
          label: x.name,
          sub: `${x.trains} trains, ${x.eSta} - ${x.dSta}`,
          bars: [
            { from: x.first.dep, to: x.last.arr, color: VIZ.red, label: 'trains running', hatch: true },
            { from: x.first.arr, to: x.inducted, color: VIZ.red, label: 'arriving / inducting' },
          ],
          marks: [{ t: x.inducted, label: 'inducted', color: '#fff' }],
        })),
        ...res.enemy.road.map((x) => ({ id: x.doc.id, label: x.doc.name, sub: `by road, ${x.run.vehicles} vehs`, bars: [{ from: x.run.spDue, to: x.run.rpClear, color: VIZ.red, label: 'on the road' }], marks: [{ t: x.inducted, label: 'inducted', color: '#fff' }] })),
      ];
    }
    return gantt({ w: W, clock: res.clock, t0: res.span[0] - 30 * MIN, t1: res.span[1] + 30 * MIN, rows, nights, cursor, labelW: 170, rowH: 30 });
  }

  // ── events ────────────────────────────────────────────────────────────────────────────────────────────────────────

  private _onClick(e: Event): void {
    const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!t || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'range')) return;
    const a = t.dataset.act!;
    const id = t.dataset.id ?? null;
    const h = this._host;
    switch (a) {
      case 'kind':
        h.setKind(t.dataset.v as MvKind);
        break;
      case 'view':
        this.setView(t.dataset.v as MvView);
        break;
      case 'close':
        h.close();
        break;
      case 'tall':
        this._root?.classList.toggle('ms-tall');
        this.render();
        break;
      case 'new':
        h.newPlan();
        break;
      case 'open':
        h.importJson();
        break;
      case 'save':
        h.exportJson();
        break;
      case 'copy':
        h.copyText();
        break;
      case 'route':
        h.addRoute(t.dataset.v as 'network' | 'draw' | 'line');
        break;
      case 'addcp':
        if (id) h.addCp(id);
        break;
      case 'delcp':
        if (id) h.change((p) => p.routes.find((r) => r.id === id)?.cps.splice(+(t.dataset.i ?? -1), 1));
        break;
      case 'goroute': {
        const r = h.plan().routes.find((x) => x.id === id);
        if (r) h.goTo(r.pts);
        h.select(id);
        break;
      }
      case 'delroute':
        if (id) h.delRoute(id);
        break;
      case 'addser':
        h.addSerial();
        break;
      case 'delser':
        if (id) h.delSerial(id);
        break;
      case 'adden':
        h.addEnemy();
        break;
      case 'delen':
        if (id) h.delEnemy(id);
        break;
      case 'fromsel':
        h.fromSelection();
        break;
      case 'pick':
        h.pick(t.dataset.what!, id);
        break;
      case 'sel': {
        const cur = h.selected();
        h.select(cur === id ? null : id);
        const s = h.result()?.serials.find((x) => x.doc.id === id);
        if (s && cur !== id) h.goTo(s.route.pts);
        break;
      }
      case 'goat':
        h.goTo([+(t.dataset.x ?? 0), +(t.dataset.y ?? 0)]);
        break;
      case 'addmix': {
        const k = (this._root!.querySelector(`[data-mixkind="${CSS.escape(id ?? '')}"]`) as HTMLSelectElement | null)?.value;
        const n = +((this._root!.querySelector(`[data-mixn="${CSS.escape(id ?? '')}"]`) as HTMLInputElement | null)?.value ?? 0);
        if (k && n > 0)
          h.change((p) => {
            const s = p.serials.find((x) => x.id === id);
            if (!s) return;
            const ex = s.mix.find((m) => m.kind === k);
            if (ex) ex.count += n;
            else s.mix.push({ kind: k, count: n });
          });
        break;
      }
      case 'delmix':
        h.change((p) => p.serials.find((x) => x.id === id)?.mix.splice(+(t.dataset.i ?? -1), 1));
        break;
      case 'play':
        this._togglePlay();
        break;
      case 'timeoff':
        this._stopPlay();
        h.setTime(null);
        break;
    }
  }

  private _onInput(e: Event): void {
    const t = e.target as HTMLInputElement;
    if (t.dataset.act === 'time') {
      this._host.setTime(+t.value * MIN);
      this.renderTime();
    }
  }

  private _onChange(e: Event): void {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const d = t.dataset;
    const h = this._host;
    const val = t instanceof HTMLInputElement && t.type === 'checkbox' ? t.checked : t.value;
    const numOrNull = (v: any) => (v === '' || v === null ? null : Number.isFinite(+v) ? +v : null);
    if (d.act === 'graphroute') {
      this._graphRoute = String(val);
      this.render();
      return;
    }
    if (d.act === 'flowpt') {
      this._flowPoint = String(val);
      this.render();
      return;
    }
    if (d.act === 'dipri') {
      this._diPri = +val;
      this._drawPictures();
      return;
    }
    if (d.p) {
      const k = d.p;
      h.change((p: any) => {
        if (k === 'offsetH') p.offsetMin = Math.round((+val || 0) * 60);
        else if (['startDay', 'shRunMin', 'shMin', 'lhEvery', 'lhMin'].includes(k)) p[k] = +val || 0;
        else p[k] = val;
      });
      return;
    }
    if (d.rail) {
      const k = d.rail;
      h.change((p: any) => {
        const r = p.rail;
        if (k.startsWith('stock.')) {
          const ty = k.slice(6);
          const n = numOrNull(val);
          r.stockPerDay = { ...(r.stockPerDay ?? {}) };
          if (n === null) delete r.stockPerDay[ty];
          else r.stockPerDay[ty] = n;
          if (!Object.keys(r.stockPerDay).length) r.stockPerDay = null;
        } else if (k === 'kmh') r.kmh = numOrNull(val);
        else if (k === 'routeId') r.routeId = val || null;
        else if (['intervalMin', 'startDay'].includes(k)) r[k] = +val || 0;
        else r[k] = val;
      });
      return;
    }
    if (d.r) {
      const id = d.r, k = d.k!;
      h.change((p: any) => {
        const r = p.routes.find((x: any) => x.id === id);
        if (r) r[k] = val;
      });
      return;
    }
    if (d.s) {
      const id = d.s, k = d.k!;
      h.change((p: any) => {
        const s = p.serials.find((x: any) => x.id === id);
        if (!s) return;
        if (k.startsWith('hmt.')) {
          s.hmt = { ...(s.hmt ?? { own: 0, bus: 0, trk: 0 }), [k.slice(4)]: Math.max(0, +val || 0) };
          return;
        }
        if (['speedDay', 'speedNi', 'densDay', 'densNi', 'startDay'].includes(k)) s[k] = numOrNull(val);
        else if (['vehicles', 'delayMin', 'loadMin', 'unloadMin', 'concSummer', 'concWinter', 'corpsPri', 'gpPri', 'unitPri', 'pax', 'storesTons'].includes(k)) s[k] = Math.max(0, +val || 0);
        else if (k === 'routeId') s.routeId = val || null;
        else s[k] = val;
      });
      return;
    }
    if (d.e) {
      const id = d.e, k = d.k!;
      h.change((p: any) => {
        const x = p.enemy.find((y: any) => y.id === id);
        if (!x) return;
        if (['trains', 'distKm', 'kmh', 'vehicles'].includes(k)) x[k] = numOrNull(val);
        else if (['startDay', 'gapMin'].includes(k)) x[k] = +val || 0;
        else if (k === 'routeId') x.routeId = val || null;
        else x[k] = val;
      });
    }
  }

  private _togglePlay(): void {
    if (this._play) {
      this._stopPlay();
      this.render();
      return;
    }
    const res = this._host.result();
    if (!res?.span) return;
    let t = this._host.time() ?? res.span[0];
    if (t >= res.span[1]) t = res.span[0];
    const step = Math.max(5 * MIN, (res.span[1] - res.span[0]) / 240);
    this._play = setInterval(() => {
      t += step;
      if (t > res.span![1]) {
        this._stopPlay();
        this.render();
        return;
      }
      this._host.setTime(t);
      this.renderTime();
    }, 120);
    this.render();
  }

  private _stopPlay(): void {
    if (this._play) clearInterval(this._play);
    this._play = null;
  }
}
