/**
 * GroundAppreciation.ts
 *
 * The appreciation of the situation, drafted from the map and written out (user, 22 Nov 2026; Appreciation_Plan.md).
 * Off by default (`features.groundAppreciation`); the top bar's Aprc button turns it on and opens the sheet.
 *
 *   reading   Read takes the ground through the Ground Guide (its Gr Scope AOR reading round the VG symbol, the selected
 *             symbol or the map centre, with the sections, cover and sight readings at the MITG and on each approach),
 *             the symbols on the map (en and own by echelon and place, obstacle symbols) and the last Check my plan;
 *   model     AprcModel: every heading of the appreciation; a paragraph is drafted from the ground (GR), read from the
 *             map (MAP), proposed for the planner's judgement (YOU JUDGE) or left to him as a ruled line (YOURS);
 *   the sheet outline, the page as it prints, and what the selected paragraph rests on; a paragraph the planner writes
 *             is his and is never overwritten, a proposal prints in the fair copy only once accepted;
 *   output    Word (.docx, zipped with the JSZip of the PowerPoint bundle: no new dependency), PDF through print, text,
 *             JSON, and slides in the Briefing module (full brief, decision brief, sand model).
 *
 * It reads the terrain bundle only through the Ground Guide, and only when Read is pressed (claude_rules.md): with the
 * guide off or no bundle the sheet still opens, takes the planner's words and exports; the Gr paragraphs stay ruled.
 */

import EngineLogger from '../../Support/EngineLogger';
import { ensureTokensCss } from '../GroundGuide/GroundGuideTokens';
import { aorMapSvg, type AorFrame } from '../GroundGuide/GroundGuideScopeAor';
import type { AorReading, AorSide, AorXY } from '../GroundGuide/GroundGuideAor';
import { dockBelowBar } from '../SiteScan/SitePanel';
import { shortDate, sourceName } from '../SiteScan/SiteScan';
import {
  accept, acceptAll, applyPatches, aprcKinds, carryOver, counts, find, isStale, lines, newDoc, numberOf, setMine, shown, toText,
  type AprcCopy, type AprcDoc, type AprcFigure, type AprcKind, type AprcPara,
} from './AprcModel';
import { lightTimes, writeGround, writePlan, writeSymbols, type AprcCheckIn, type AprcGroundIn, type AprcObsn, type AprcSymbolIn } from './AprcWrite';
import { APRC_DOC_CSS, bodyHtml, esc, printHtml } from './AprcHtml';
import { DOCX_MIME, docxFiles, type DocxImage } from './AprcDocx';
import { APRC_DECKS, buildDeck, mergeDeck, type AprcDeckKind } from './AprcDeck';

const ENGINE = 'Aprc';
const PANEL_ID = 'ms-aprc-panel';
const STORE = 'pams8.aprc.v1';
const R = 6378137;

export interface GroundAppreciationOptions {
  kind: AprcKind;
  copy: AprcCopy;
  /** Figures in the document: the vector trace, a shot of the live map, or both. */
  figures: 'both' | 'trace' | 'map';
  deck: AprcDeckKind;
  /** Read the sight along each approach for its Obsn head (the Extended View's reading; a few seconds more). */
  obsn: boolean;
  echelon: 'auto' | 'coy' | 'bn' | 'bde';
  /** Mode the going is read for; `auto` takes the Gr Scope AOR setting. */
  mover: string;
  /** Keep the document in the browser between sessions. */
  keep: boolean;
}

export const DEFAULT_GROUND_APPRECIATION_OPTIONS: GroundAppreciationOptions = {
  kind: 'def',
  copy: 'draft',
  figures: 'both',
  deck: 'full',
  obsn: true,
  echelon: 'auto',
  mover: 'auto',
  keep: true,
};

export interface GroundAppreciationHost {
  /** The Ground Guide, or null while it is off. */
  guide?: () => any | null;
  turnOnGuide?: () => void;
  selected?: () => any[];
  /** The symbols on the map as plan records (SerializationEngine.planRecordsOf). */
  records?: () => Array<{ id: string; drawEss: any; attrs?: Record<string, any> }>;
  threat?: () => [number, number] | null;
  /** The last Check my plan report of the Intelligent Deployment tab, or null. */
  planCheck?: () => any | null;
  briefing?: () => any | null;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (dx: number, dy: number): string => COMPASS[Math.round((((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360) / 45) % 8];
const mercToLngLat = (x: number, y: number): [number, number] => [(x / R) * (180 / Math.PI), (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI)];
const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> => Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);

const STYLE = `
#${PANEL_ID}{position:fixed;left:50%;transform:translateX(-50%);top:118px;z-index:2147482806;width:min(1240px,calc(100vw - 20px));height:calc(100vh - 140px);display:none;flex-direction:column;
 background:var(--gg-card,#1b1f25);color:#f1f3f6;border:1px solid var(--gg-hair,#4f5965);border-radius:11px;box-shadow:0 10px 28px rgba(0,0,0,.5);font:13px/1.35 system-ui,Segoe UI,Arial,sans-serif}
#${PANEL_ID}.ms-open{display:flex}
#${PANEL_ID} *{box-sizing:border-box}
#${PANEL_ID} .h{flex:none;display:flex;align-items:center;gap:8px;padding:7px 10px;background:linear-gradient(90deg,#1d2635,var(--gg-head,#3b4552) 45%);border-radius:11px 11px 0 0}
#${PANEL_ID} .t{font-weight:750;font-size:14px;color:#fff}
#${PANEL_ID} .sub{flex:1;min-width:0;color:#d5dbe2;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#${PANEL_ID} button,#${PANEL_ID} select{font:500 12.5px/1 system-ui,Segoe UI,Arial,sans-serif;color:#e1e6eb;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.18);border-radius:6px;cursor:pointer;height:27px;padding:0 9px;white-space:nowrap}
#${PANEL_ID} select{background:#11151a}
#${PANEL_ID} button:hover{background:rgba(255,255,255,.14);color:#fff}
#${PANEL_ID} button:focus-visible,#${PANEL_ID} select:focus-visible,#${PANEL_ID} textarea:focus-visible,#${PANEL_ID} input:focus-visible,#${PANEL_ID} [tabindex]:focus-visible{outline:2px solid var(--gg-accent,#8ec1ea);outline-offset:1px}
#${PANEL_ID} button.x{width:27px;padding:0;font-size:17px}
#${PANEL_ID} button.pri{background:#2b5d86;border-color:#4f8ab8;color:#fff}
#${PANEL_ID} button.pri:hover{background:#34709f}
#${PANEL_ID} button[disabled]{opacity:.45;cursor:default}
#${PANEL_ID} button[aria-pressed=true]{background:#8ec1ea;color:#0d1620;border-color:#8ec1ea;font-weight:650}
#${PANEL_ID} .tool{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:6px 6px;padding:6px 10px;background:var(--gg-strip,#20262e);border-bottom:1px solid var(--gg-hair-soft,rgba(255,255,255,.1))}
#${PANEL_ID} .tool .k{color:var(--gg-label,#9aa4ae);font-size:12px;margin-left:8px}
#${PANEL_ID} .tool .k:first-child{margin-left:0}
#${PANEL_ID} .seg{display:inline-flex}
#${PANEL_ID} .seg button{border-radius:0;border-left-width:0}
#${PANEL_ID} .seg button:first-child{border-radius:6px 0 0 6px;border-left-width:1px}
#${PANEL_ID} .seg button:last-child{border-radius:0 6px 6px 0}
#${PANEL_ID} .note{flex:none;display:none;align-items:center;gap:8px;padding:6px 10px;background:rgba(255,210,122,.12);color:#ffd27a;border-bottom:1px solid var(--gg-hair-soft,rgba(255,255,255,.1));font-size:12.5px}
#${PANEL_ID} .note.on{display:flex}
#${PANEL_ID} .grid{flex:1;min-height:0;display:grid;grid-template-columns:232px minmax(0,1fr) 300px}
#${PANEL_ID} .out{overflow:auto;padding:4px 0 10px;border-right:1px solid var(--gg-hair-soft,rgba(255,255,255,.1));background:var(--gg-strip,#20262e)}
#${PANEL_ID} .out .ph{padding:9px 12px 3px;font-size:11.5px;font-weight:700;letter-spacing:.05em;color:var(--gg-label,#9aa4ae)}
#${PANEL_ID} .out .it{display:flex;align-items:center;width:100%;height:auto;border:0;border-radius:0;background:none;padding:3px 10px 3px 12px;text-align:left;color:#dfe5ea;white-space:nowrap;overflow:hidden}
#${PANEL_ID} .out .it span.nm{overflow:hidden;text-overflow:ellipsis}
#${PANEL_ID} .out .it:hover{background:rgba(255,255,255,.06)}
#${PANEL_ID} .out .it.sel{background:rgba(142,193,234,.16);box-shadow:inset 3px 0 0 #8ec1ea}
#${PANEL_ID} .out .no{flex:none;width:28px;color:var(--gg-label,#9aa4ae);font-variant-numeric:tabular-nums}
#${PANEL_ID} .dot{flex:none;display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px}
#${PANEL_ID} .dot.gr{background:#5fd39a}#${PANEL_ID} .dot.map{background:#7fb2ff}#${PANEL_ID} .dot.judge{background:#ffd27a}
#${PANEL_ID} .dot.yours{box-shadow:inset 0 0 0 1.5px #aeb7c1}#${PANEL_ID} .dot.written{background:#b79cf0}
#${PANEL_ID} .mid{overflow:auto;padding:14px;background:#14181d}
#${PANEL_ID} .mid .aprc-doc{max-width:800px;margin:0 auto;padding:34px 46px 36px 56px;border-radius:3px;box-shadow:0 2px 12px rgba(0,0,0,.5);font-size:10.5pt}
#${PANEL_ID} .mid .ap-p{cursor:pointer;border-radius:2px}
#${PANEL_ID} .mid .ap-p:hover{background:#f2f6fb}
#${PANEL_ID} .mid .ap-p.sel{background:#fff6d6;box-shadow:0 0 0 2px #e2b23a}
#${PANEL_ID} .rt{overflow:auto;padding:10px 12px;border-left:1px solid var(--gg-hair-soft,rgba(255,255,255,.1));background:var(--gg-strip,#20262e);color:#dfe5ea;font-size:12.5px}
#${PANEL_ID} .rt h4{margin:0 0 6px;font-size:12.5px;color:#fff}
#${PANEL_ID} .rt h5{margin:12px 0 4px;font-size:11.5px;letter-spacing:.05em;color:var(--gg-label,#9aa4ae);font-weight:700}
#${PANEL_ID} .rt textarea{width:100%;min-height:110px;resize:vertical;font:12.5px/1.45 system-ui,Segoe UI,Arial,sans-serif;color:#f1f3f6;background:#11151a;border:1px solid #3d4650;border-radius:6px;padding:6px 8px}
#${PANEL_ID} .rt .row{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
#${PANEL_ID} .rt ul{margin:0;padding-left:16px}
#${PANEL_ID} .rt li{margin:3px 0}
#${PANEL_ID} .rt .st{display:flex;align-items:center;margin-bottom:8px}
#${PANEL_ID} .rt .stale{margin-top:8px;padding:6px 8px;border-radius:6px;background:rgba(229,72,77,.16);color:#ffc9cb}
#${PANEL_ID} .rt .mut{color:var(--gg-label,#9aa4ae)}
#${PANEL_ID} .foot{flex:none;display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;padding:5px 10px;border-top:1px solid var(--gg-hair-soft,rgba(255,255,255,.1));font-size:12px;color:var(--gg-label,#9aa4ae)}
#${PANEL_ID} .foot b{color:#f1f3f6;font-variant-numeric:tabular-nums}
#${PANEL_ID} .foot .msg{margin-left:auto;color:#8ec1ea}
@media (max-width:980px){#${PANEL_ID} .grid{grid-template-columns:minmax(0,1fr)}#${PANEL_ID} .out{display:none}#${PANEL_ID} .rt{border-left:0;border-top:1px solid rgba(255,255,255,.1);max-height:38vh}}
${APRC_DOC_CSS}
#${PANEL_ID} .mid .aprc-doc{font-size:10.5pt}
`;

let cssDone = false;
function ensureCss(): void {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  ensureTokensCss();
  const st = document.createElement('style');
  st.id = 'ms-aprc-css';
  st.textContent = STYLE;
  document.head.appendChild(st);
}

const STATE_WORD: Record<string, string> = { GR: 'Drafted from Gr', MAP: 'From the map', 'YOU JUDGE': 'Proposal: you judge', YOURS: 'Yours to write', WRITTEN: 'Written by you' };
const DOT: Record<string, string> = { GR: 'gr', MAP: 'map', 'YOU JUDGE': 'judge', YOURS: 'yours', WRITTEN: 'written' };

export default class GroundAppreciation {
  private _opts: GroundAppreciationOptions = { ...DEFAULT_GROUND_APPRECIATION_OPTIONS };
  private _enabled = false;
  private _getView: () => any;
  private _host: GroundAppreciationHost;
  private _doc: AprcDoc | null = null;
  private _busy = false;
  private _msg = '';
  private _note = '';
  private _sel: string | null = null;
  private _el: HTMLElement | null = null;
  private _open = false;
  private _resize: (() => void) | null = null;
  private _readSeq = 0;

  constructor(getView: () => any, host: GroundAppreciationHost = {}) {
    this._getView = getView;
    this._host = host;
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────────────────────────────────────────

  get isEnabled(): boolean {
    return this._enabled;
  }
  get panelOpen(): boolean {
    return this._open;
  }
  get busy(): boolean {
    return this._busy;
  }
  /** The appreciation as it stands (null before the first Read with nothing kept). */
  get doc(): AprcDoc | null {
    return this._doc;
  }
  get options(): Readonly<GroundAppreciationOptions> {
    return this._opts;
  }

  setOptions(o: Partial<GroundAppreciationOptions>): void {
    this._opts = { ...this._opts, ...Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== null)) } as GroundAppreciationOptions;
    if (!aprcKinds().find((k) => k.kind === this._opts.kind)?.ready) this._opts.kind = 'def';
    if (this._enabled) this._render();
  }

  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    if (!this._doc) this._doc = this._load() ?? newDoc(this._opts.kind);
    EngineLogger.nextStep(ENGINE, 'Aprc on: open the sheet and press Read');
  }

  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    this._readSeq++;
    this._busy = false;
    this.openPanel(false);
  }

  destroy(): void {
    this.disable();
    this._el?.remove();
    this._el = null;
  }

  onViewChanged(): void {
    /* nothing is drawn on the map */
  }

  openPanel(open = true): void {
    if (!open) {
      this._open = false;
      this._el?.classList.remove('ms-open');
      if (this._resize) window.removeEventListener('resize', this._resize);
      this._resize = null;
      return;
    }
    if (!this._enabled) return;
    ensureCss();
    if (!this._el) this._build();
    this._open = true;
    this._dock();
    this._el!.classList.add('ms-open');
    if (!this._resize) {
      this._resize = () => this._dock();
      window.addEventListener('resize', this._resize);
    }
    this._render();
  }

  togglePanel(): boolean {
    this.openPanel(!this._open);
    return this._open;
  }

  private _dock(): void {
    if (!this._el) return;
    dockBelowBar(this._el);
    const top = parseFloat(this._el.style.top) || 118;
    this._el.style.height = `calc(100vh - ${Math.round(top + 12)}px)`;
  }

  // ── reading ───────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Read the map and draft the appreciation. The planner's words and acceptances are kept. Resolves with the document,
   * or null when the engine is off or another Read overtook this one. `at` ([lng, lat]) sets the MITG for a host; without
   * it the MITG is a VG symbol, else the selected symbol, else the map centre.
   */
  async read(o: { at?: [number, number] | null } = {}): Promise<AprcDoc | null> {
    if (!this._enabled) return null;
    const seq = ++this._readSeq;
    this._busy = true;
    this._msg = 'Reading…';
    this._note = '';
    this._render();
    const prev = this._doc;
    const doc = newDoc(this._opts.kind);
    const notes: string[] = [];
    try {
      // 1. the ground, through the Ground Guide
      const guide = this._host.guide?.() ?? null;
      const graphic = this._host.selected?.()[0] ?? null;
      let aor: { reading: AorReading; frame: AorFrame } | null = null;
      if (!guide?.isEnabled) notes.push('Ground Guide is off: the Gr paragraphs are not read.');
      else {
        for (let i = 0; i < 12 && guide.status?.state === 'loading'; i++) await new Promise((r) => setTimeout(r, 500));
        const so = this._opts;
        aor = await withTimeout<{ reading: AorReading; frame: AorFrame } | null>(guide.aorAround(Array.isArray(o.at) ? o.at : null, { graphic, echelon: so.echelon === 'auto' ? undefined : so.echelon, profile: so.mover === 'auto' ? undefined : so.mover }), 60000);
        if (!aor) notes.push(guide.status?.state === 'ready' ? 'The ground could not be read here: outside the terrain data, or it did not load in time.' : 'No terrain data: the Gr paragraphs are not read.');
      }
      if (seq !== this._readSeq) return null;

      // 2. the symbols on the map
      const symbols = await this._symbols(aor?.reading ?? null);
      const sym = writeSymbols(symbols);
      applyPatches(doc, sym.patches);
      doc.confirm.push(...sym.confirm);

      if (aor) {
        const gin = await this._groundIn(guide, aor, graphic, sym.drawnObs);
        if (seq !== this._readSeq) return null;
        const w = writeGround(gin);
        applyPatches(doc, w.patches);
        doc.confirm.unshift(...w.confirm);
        doc.frame = w.frame ?? null;
        doc.sources = this._sources(guide);
        doc.figures = await this._figures(aor);
      } else if (this._opts.figures !== 'trace') {
        const shot = await this._mapShot();
        if (shot) doc.figures = [shot];
      }

      // 3. a checked plan
      const chk = this._checkIn();
      if (chk) {
        const pw = writePlan(chk);
        applyPatches(doc, pw.patches);
        doc.confirm.push(...pw.confirm);
      }
      if (seq !== this._readSeq) return null;
      this._doc = carryOver(prev, doc);
      this._note = notes.join(' ');
      const c = counts(this._doc);
      this._msg = `Read: ${c.gr} from Gr, ${c.map} from the map, ${c.judge} proposals, ${c.yours} yours`;
      EngineLogger.success(ENGINE, this._msg);
      this._save();
      this._emit('aprc-read', { doc: this._doc });
      return this._doc;
    } catch (err) {
      console.error('[Aprc] read', err);
      this._msg = `Read failed: ${err instanceof Error ? err.message : String(err)}`;
      EngineLogger.error(ENGINE, this._msg);
      return null;
    } finally {
      if (seq === this._readSeq) {
        this._busy = false;
        this._render();
      }
    }
  }

  private _toMerc(r: AorReading, p: AorXY): [number, number] {
    return [r.centre[0] + p[0] * r.k, r.centre[1] + p[1] * r.k];
  }

  /** Where a ground point (metres from the reading's centre) is, in words. */
  private _where(r: AorReading, p: AorXY): string {
    let best: { name: string; d: number; at: AorXY } | null = null;
    for (const q of r.map.places) {
      const d = Math.hypot(q.at[0] - p[0], q.at[1] - p[1]);
      if (!best || d < best.d) best = { name: q.name, d, at: q.at };
    }
    if (best && best.d <= 400) return `at ${best.name}`;
    if (best && best.d <= 3000) return `${(best.d / 1000).toFixed(1)} km ${compass(p[0] - best.at[0], p[1] - best.at[1])} of ${best.name}`;
    const d = Math.hypot(p[0] - r.mitg.at[0], p[1] - r.mitg.at[1]);
    return `${(d / 1000).toFixed(1)} km ${compass(p[0] - r.mitg.at[0], p[1] - r.mitg.at[1])} of ${r.mitg.name}`;
  }

  private async _symbols(r: AorReading | null): Promise<AprcSymbolIn[]> {
    const recs = this._host.records?.() ?? [];
    if (!recs.length) return [];
    try {
      const { readSymbols } = await import('../DeploymentBuilder/PlanCheck');
      return readSymbols(recs as any).map((s) => {
        let where: string | null = null;
        if (r && s.pts.length) {
          const cx = s.pts.reduce((a, p) => a + p.x, 0) / s.pts.length, cy = s.pts.reduce((a, p) => a + p.y, 0) / s.pts.length;
          where = this._where(r, [(cx - r.centre[0]) / r.k, (cy - r.centre[1]) / r.k]);
        }
        return { id: s.id, key: s.key, name: s.name, side: s.side, ech: s.ech, label: s.label, where, planned: s.status === '1' };
      });
    } catch (err) {
      console.warn('[Aprc] symbols', err);
      return [];
    }
  }

  private async _groundIn(guide: any, aor: { reading: AorReading; frame: AorFrame }, graphic: any, drawnObs: string[]): Promise<AprcGroundIn> {
    const r = aor.reading;
    const ll = mercToLngLat(...this._toMerc(r, r.mitg.at));
    const sidc: string | null = graphic?.attributes?.drawEssentials?.AMPLIFIER?.SIDC ?? null;
    const [sec, cov, ext] = await Promise.all([
      withTimeout<any>(guide.sectionsAround?.(ll) ?? Promise.resolve(null), 20000),
      withTimeout<any>(guide.coverAround?.(ll) ?? Promise.resolve(null), 20000),
      withTimeout<any>(guide.extendedAround?.(ll, { sidc, threatDeg: r.faceDeg, radiusKm: 2 }) ?? Promise.resolve(null), 30000),
    ]);
    const obsn: Partial<Record<AorSide, AprcObsn | null>> = {};
    if (this._opts.obsn && guide.extendedAround) {
      for (const a of r.apchs) {
        // a point half way along the part of the approach on the home side
        const want = a.lengthM - a.pastM / 2;
        let acc = 0, at: AorXY = a.path[a.path.length - 1];
        for (let i = 1; i < a.path.length; i++) {
          const L = Math.hypot(a.path[i][0] - a.path[i - 1][0], a.path[i][1] - a.path[i - 1][1]);
          if (acc + L >= want) {
            const t = L ? (want - acc) / L : 0;
            at = [a.path[i - 1][0] + (a.path[i][0] - a.path[i - 1][0]) * t, a.path[i - 1][1] + (a.path[i][1] - a.path[i - 1][1]) * t];
            break;
          }
          acc += L;
        }
        const e: any = await withTimeout<any>(guide.extendedAround(mercToLngLat(...this._toMerc(r, at)), { profile: 'dismounted', radiusKm: 2, threatDeg: (r.faceDeg + 180) % 360 }), 30000);
        if (!e?.obs) {
          obsn[a.side] = null;
          continue;
        }
        let near: string | null = null, nd = 1500;
        for (const q of r.map.places) {
          const d = Math.hypot(q.at[0] - at[0], q.at[1] - at[1]);
          if (d < nd) ((nd = d), (near = q.name));
        }
        const ov = e.obs.overlook;
        obsn[a.side] = { near, radiusM: e.radiusM ?? 2000, seenPct: e.obs.seenPct, clearMedianM: e.obs.clearMedianM, country: e.obs.country, overlook: ov ? { riseM: ov.riseM, distM: ov.distM, compass: COMPASS[Math.round((((ov.bearingDeg % 360) + 360) % 360) / 45) % 8] } : null };
      }
    }
    const gd = sec?.ground, rd = sec?.roads?.density, wx = sec?.weather, lv = cov?.levels;
    return {
      reading: r,
      frame: aor.frame,
      ground: gd ? { elevationM: gd.elevationM ?? null, slopeBand: gd.slopeBand ?? null, landform: gd.landform ?? null, rough: gd.rough?.label ?? null } : null,
      roads: rd ? { density: rd.density, allWeatherPct: rd.totalKm > 0 ? (100 * rd.allWeatherKm) / rd.totalKm : 0, radiusM: rd.radiusM, exitDirs: rd.exitDirs ?? [] } : null,
      weather: wx ? { monthName: wx.monthName, tmax: wx.tmax, tmin: wx.tmin, precMm: wx.precMm, windMs: wx.windMs, source: String(wx.source ?? '').replace(/NCGDB/g, '1:50k map'), dataDate: shortDate(wx.dataDate) } : null,
      visibility: ext?.weather ?? null,
      cover: lv ? { direct: lv.direct, indirect: lv.indirect, ground: lv.ground, aerial: lv.aerial } : null,
      crop: ext?.crop ?? null,
      obsn,
      light: lightTimes(new Date(), ll[1], ll[0], -new Date().getTimezoneOffset()),
      drawnObs,
      threatMarked: !r.originsAssumed,
      readAt: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16).replace('T', ' '),
    };
  }

  private _sources(guide: any): string[] {
    const m: any = guide?.bundleManifest ?? null;
    const out: string[] = [];
    for (const s of (m?.sources ?? []) as any[]) {
      if (!s?.id) continue;
      const d = shortDate(s.dataDate);
      const line = `${sourceName(s.id, s.name)}${d ? ` (${d})` : ''}`;
      if (!out.includes(line)) out.push(line);
    }
    if (m?.built) out.push(`Terrain bundle built ${String(m.built).slice(0, 10)}`);
    return out;
  }

  private _checkIn(): AprcCheckIn | null {
    const c: any = this._host.planCheck?.() ?? null;
    if (!c || !Array.isArray(c.posns)) return null;
    return {
      title: String(c.title ?? 'Plan'),
      posns: c.posns.map((p: any) => ({ label: String(p.label ?? ''), kind: String(p.kind ?? ''), ech: p.ech ?? null, planned: !!p.planned })),
      rows: (c.rows ?? []).map((r: any) => ({ name: String(r.name ?? ''), st: String(r.st ?? ''), reason: String(r.reason ?? '') })),
      triggers: (c.whatIf?.triggers ?? []).map((t: any) => ({ trigger: String(t.trigger ?? ''), who: String(t.who ?? ''), from: String(t.from ?? ''), to: String(t.to ?? ''), min: Number(t.min) || 0, enemyMin: Number(t.enemyMin) || 0, st: String(t.st ?? ''), reason: String(t.reason ?? '') })),
      confirm: c.confirm ?? [],
      assumptions: c.assumptions ?? [],
    };
  }

  // ── figures ───────────────────────────────────────────────────────────────────────────────────────────────────

  private async _figures(aor: { reading: AorReading; frame: AorFrame }): Promise<AprcFigure[]> {
    const out: AprcFigure[] = [];
    const W = 900, H = 800;
    if (this._opts.figures !== 'map') {
      const frame: AorFrame = { ...aor.frame, reading: aor.reading, style: 'trace', orient: 'north', northDeg: 0, layers: { going: true, apch: true, line: true, itg: true, dml: true, msr: true }, loading: false };
      try {
        const svg = aorMapSvg(aor.reading, frame, W, H, 'full');
        const png = await this._rasterise(svg, W, H, 2);
        out.push({ id: 'trace', kind: 'trace', caption: `Trace: apchs, lines of def and going for ${aor.frame.profileLabel.toLowerCase()}. North up.`, svg, png: png ?? undefined, w: W, h: H });
      } catch (err) {
        console.warn('[Aprc] trace', err);
      }
    }
    if (this._opts.figures !== 'trace') {
      const shot = await this._mapShot();
      if (shot) out.push(shot);
    }
    return out;
  }

  private _rasterise(svg: string, w: number, h: number, scale: number): Promise<string | null> {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        const done = (v: string | null) => resolve(v);
        const timer = setTimeout(() => done(null), 8000);
        img.onload = () => {
          clearTimeout(timer);
          try {
            const c = document.createElement('canvas');
            c.width = w * scale;
            c.height = h * scale;
            const g = c.getContext('2d');
            if (!g) return done(null);
            g.fillStyle = '#ffffff';
            g.fillRect(0, 0, c.width, c.height);
            g.drawImage(img, 0, 0, c.width, c.height);
            done(c.toDataURL('image/png'));
          } catch {
            done(null);
          }
        };
        img.onerror = () => {
          clearTimeout(timer);
          done(null);
        };
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      } catch {
        resolve(null);
      }
    });
  }

  /** A shot of the map as it is on screen, with the symbols. Null when the view cannot give one in time. */
  private async _mapShot(): Promise<AprcFigure | null> {
    const view: any = this._getView?.();
    if (!view?.takeScreenshot) return null;
    const s: any = await withTimeout<any>(view.takeScreenshot({ format: 'png' }), 8000);
    if (!s?.dataUrl) return null;
    return { id: 'map', kind: 'map', caption: 'The map as on screen when read, with the symbols.', png: s.dataUrl, w: s.data?.width ?? view.width ?? 1280, h: s.data?.height ?? view.height ?? 720 };
  }

  // ── the planner's words ───────────────────────────────────────────────────────────────────────────────────────

  /** Write a paragraph (empty text gives it back to the tool). */
  setText(id: string, text: string | null): boolean {
    if (!this._doc || !setMine(this._doc, id, text)) return false;
    this._changed();
    return true;
  }
  /** Take a proposal as it stands, or take the acceptance back. */
  accept(id: string, on = true): boolean {
    if (!this._doc || !accept(this._doc, id, on)) return false;
    this._changed();
    return true;
  }
  acceptAll(): number {
    if (!this._doc) return 0;
    const n = acceptAll(this._doc);
    if (n) this._changed();
    return n;
  }
  /** Start again: every heading, nothing written. The planner's words go too. */
  clear(): void {
    this._doc = newDoc(this._opts.kind);
    this._sel = null;
    this._msg = 'Cleared';
    this._changed();
  }

  private _changed(): void {
    this._save();
    this._render();
    this._emit('aprc-changed', { doc: this._doc });
  }

  // ── output ────────────────────────────────────────────────────────────────────────────────────────────────────

  toText(copy: AprcCopy = this._opts.copy): string {
    return this._doc ? toText(this._doc, copy) : '';
  }
  /** A whole HTML document laid out for A4 print. */
  toHtml(copy: AprcCopy = this._opts.copy): string {
    return this._doc ? printHtml(this._doc, copy) : '';
  }
  /** The document as plain data (figures as they are); `fromJSON` takes it back. */
  toJSON(): AprcDoc | null {
    return this._doc ? (JSON.parse(JSON.stringify(this._doc)) as AprcDoc) : null;
  }
  fromJSON(doc: any): boolean {
    if (!doc || doc.version !== 1 || !Array.isArray(doc.parts)) return false;
    this._doc = doc as AprcDoc;
    this._sel = null;
    this._msg = 'Opened';
    this._changed();
    return true;
  }

  /** The Word document as a Blob. Loads the PowerPoint bundle once for its JSZip. */
  async toDocx(copy: AprcCopy = this._opts.copy): Promise<Blob | null> {
    if (!this._doc) return null;
    let JSZip: any = (window as any).JSZip;
    if (!JSZip) {
      const { loadPptxGenJS } = await import('../ImportExport/PptxExporter');
      await loadPptxGenJS();
      JSZip = (window as any).JSZip;
    }
    if (!JSZip) throw new Error('JSZip is not available (the PowerPoint bundle did not load)');
    const images: Record<string, DocxImage> = {};
    for (const f of this._doc.figures) {
      if (!f.png) continue;
      const b64 = f.png.split(',')[1] ?? '';
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      images[f.id] = { bytes, w: f.w, h: f.h };
    }
    const zip = new JSZip();
    for (const [path, body] of Object.entries(docxFiles(this._doc, copy, images))) zip.file(path, body);
    return (await zip.generateAsync({ type: 'blob', mimeType: DOCX_MIME, compression: 'DEFLATE' })) as Blob;
  }

  /** The slides of a deck kind (not yet in the briefing). */
  toDeck(kind: AprcDeckKind = this._opts.deck, copy: AprcCopy = this._opts.copy): any[] {
    if (!this._doc) return [];
    const bg = this._blank(1280, 720), th = this._blank(240, 135);
    return buildDeck(this._doc, { kind, copy, blankBg: bg, thumb: th });
  }

  private _blank(w: number, h: number): string {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (g) {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
    }
    return c.toDataURL('image/png');
  }

  /**
   * Make the slides in the Briefing module. Slides that are not the appreciation's stay; an appreciation slide edited
   * since it was made is kept; the rest are replaced. Returns what happened, or null when Briefing is off.
   */
  makeSlides(kind: AprcDeckKind = this._opts.deck): { added: number; kept: number; replaced: number } | null {
    const be: any = this._host.briefing?.() ?? null;
    if (!this._doc || !be?.importBriefing || !be.getSlides) {
      this._msg = 'Slides need the Briefing module on (features.briefing)';
      this._render();
      return null;
    }
    const fresh = this.toDeck(kind);
    const m = mergeDeck(be.getSlides(), fresh);
    // The deck's own chrome (its classification banner, set in the Briefing module) is kept as it is.
    const cur = be.exportBriefing?.() ?? { version: 12 };
    be.importBriefing({ version: cur.version ?? 12, slides: m.slides, ...(cur.chrome ? { chrome: cur.chrome } : {}) });
    this._msg = `Slides: ${m.added} made${m.kept ? `, ${m.kept} you edited kept` : ''}${m.replaced ? `, ${m.replaced} replaced` : ''}`;
    EngineLogger.success(ENGINE, this._msg);
    this._render();
    return { added: m.added, kept: m.kept, replaced: m.replaced };
  }

  private _download(blob: Blob, name: string): void {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  private _fileName(ext: string): string {
    const place = (this._doc?.frame?.place ?? 'aprc').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'aprc';
    return `Aprc_${place}_${new Date().toISOString().slice(0, 10)}${this._opts.copy === 'draft' ? '_draft' : ''}.${ext}`;
  }

  async exportWord(): Promise<boolean> {
    try {
      const b = await this.toDocx();
      if (!b) return false;
      this._download(b, this._fileName('docx'));
      this._msg = `Word: ${this._opts.copy} copy saved`;
      EngineLogger.success(ENGINE, this._msg);
      this._render();
      return true;
    } catch (err) {
      this._msg = `Word export failed: ${err instanceof Error ? err.message : String(err)}`;
      EngineLogger.error(ENGINE, this._msg);
      this._render();
      return false;
    }
  }

  /** Print (Save as PDF in the print dialog). */
  exportPrint(): void {
    if (!this._doc) return;
    const fr = document.createElement('iframe');
    fr.setAttribute('aria-hidden', 'true');
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    fr.srcdoc = this.toHtml();
    fr.onload = () => {
      try {
        fr.contentWindow?.focus();
        fr.contentWindow?.print();
      } catch (err) {
        console.warn('[Aprc] print', err);
      }
      setTimeout(() => fr.remove(), 60000);
    };
    document.body.appendChild(fr);
    this._msg = 'Print: choose Save as PDF for a PDF';
    this._render();
  }

  async copyText(): Promise<boolean> {
    const t = this.toText();
    try {
      await navigator.clipboard.writeText(t);
      this._msg = 'Copied as text';
    } catch {
      this._msg = 'Copy failed: the browser refused the clipboard';
    }
    this._render();
    return this._msg === 'Copied as text';
  }

  exportJson(): void {
    if (!this._doc) return;
    this._download(new Blob([JSON.stringify(this._doc)], { type: 'application/json' }), this._fileName('json'));
  }

  private _openJson(): void {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      try {
        if (!this.fromJSON(JSON.parse(await f.text()))) throw new Error('not an appreciation file');
      } catch (err) {
        this._msg = `Open failed: ${err instanceof Error ? err.message : String(err)}`;
        this._render();
      }
    };
    inp.click();
  }

  // ── kept between sessions ─────────────────────────────────────────────────────────────────────────────────────

  private _save(): void {
    if (!this._opts.keep || !this._doc || typeof localStorage === 'undefined') return;
    try {
      // without the pictures: they are made again on Read
      localStorage.setItem(STORE, JSON.stringify({ ...this._doc, figures: [] }));
    } catch {
      /* storage full or refused: the document stays in memory */
    }
  }
  private _load(): AprcDoc | null {
    if (!this._opts.keep || typeof localStorage === 'undefined') return null;
    try {
      const d = JSON.parse(localStorage.getItem(STORE) ?? 'null');
      if (d) delete d.marking; // a document kept before the marking became a ruled line
      return d && d.version === 1 && Array.isArray(d.parts) && d.kind === this._opts.kind ? (d as AprcDoc) : null;
    } catch {
      return null;
    }
  }

  private _emit(name: string, detail: unknown): void {
    if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent(name, { detail }));
  }

  // ── the sheet ─────────────────────────────────────────────────────────────────────────────────────────────────

  private _build(): void {
    const el = document.createElement('div');
    el.id = PANEL_ID;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Appreciation of the situation');
    el.innerHTML = `<div class="h"><span class="t">Aprc</span><span class="sub" data-p="sub"></span><button class="pri" data-a="read">Read</button><button class="x" data-a="close" aria-label="Close">×</button></div>
<div class="tool" data-p="tool"></div><div class="note" data-p="note"></div>
<div class="grid"><div class="out" data-p="out"></div><div class="mid" data-p="mid"></div><div class="rt" data-p="rt"></div></div>
<div class="foot" data-p="foot"></div>`;
    el.addEventListener('click', (e) => this._click(e));
    el.addEventListener('change', (e) => this._changeEv(e));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement)?.matches?.('textarea,input')) this.openPanel(false);
      e.stopPropagation();
    });
    document.body.appendChild(el);
    this._el = el;
  }

  private _part(k: string): HTMLElement {
    return this._el!.querySelector(`[data-p="${k}"]`) as HTMLElement;
  }

  private _click(e: Event): void {
    const t = e.target as HTMLElement;
    const b = t.closest('[data-a]') as HTMLElement | null;
    if (b) {
      const a = b.dataset.a!, v = b.dataset.v ?? '';
      if (a === 'close') return this.openPanel(false);
      if (a === 'read') return void this.read();
      if (a === 'accept-all') {
        const n = this.acceptAll();
        this._msg = n ? `${n} proposals accepted` : 'No open proposal';
        return this._render();
      }
      if (a === 'copy') return this.setOptions({ copy: v as AprcCopy });
      if (a === 'word') return void this.exportWord();
      if (a === 'print') return this.exportPrint();
      if (a === 'text') return void this.copyText();
      if (a === 'json') return this.exportJson();
      if (a === 'open') return this._openJson();
      if (a === 'slides') return void this.makeSlides();
      if (a === 'guide') {
        this._host.turnOnGuide?.();
        this._msg = 'Ground Guide on: press Read when the terrain data has loaded';
        this._note = '';
        return this._render();
      }
      if (a === 'clear') {
        if (window.confirm('Clear the appreciation? Your written paragraphs go too.')) this.clear();
        return;
      }
      if (a === 'sel') return this._select(v, true);
      if (a === 'save') {
        const ta = this._el!.querySelector('.rt textarea') as HTMLTextAreaElement | null;
        if (ta && this._sel) this.setText(this._sel, ta.value);
        return;
      }
      if (a === 'give') return void (this._sel && this.setText(this._sel, null));
      if (a === 'acc') return void (this._sel && this.accept(this._sel, v !== 'off'));
      return;
    }
    const p = t.closest('.ap-p[data-id]') as HTMLElement | null;
    if (p && this._el!.contains(p)) this._select(p.dataset.id!, false);
  }

  private _changeEv(e: Event): void {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const k = t.dataset?.o;
    if (!k) return;
    if (k === 'deck') this.setOptions({ deck: t.value as AprcDeckKind });
    else if (k === 'kind') {
      this.setOptions({ kind: t.value as AprcKind });
      if (this._doc && this._doc.kind !== this._opts.kind) this.clear();
    }
  }

  private _select(id: string, scroll: boolean): void {
    this._sel = id;
    this._render();
    if (scroll) this._el?.querySelector(`.mid .ap-p[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' });
  }

  private _render(): void {
    if (!this._el || !this._open) return;
    const doc = this._doc ?? newDoc(this._opts.kind);
    const copy = this._opts.copy;
    const c = counts(doc);
    const fr = doc.frame;
    this._part('sub').textContent = this._busy ? 'Reading the ground and the map…' : fr ? `${fr.echelon} · ${fr.place} · ${fr.mover} · ${fr.month}, ${fr.season === 'wet' ? 'after rain' : 'dry'} · read ${fr.readAt}` : 'Not read yet: press Read';
    (this._el.querySelector('[data-a="read"]') as HTMLButtonElement).disabled = this._busy;
    (this._el.querySelector('[data-a="read"]') as HTMLButtonElement).textContent = fr ? 'Read again' : 'Read';

    const kinds = aprcKinds();
    this._part('tool').innerHTML =
      `<span class="k">Copy</span><span class="seg"><button data-a="copy" data-v="fair" aria-pressed="${copy === 'fair'}" title="What goes up: unwritten paragraphs and proposals not accepted print a ruled line">Fair</button><button data-a="copy" data-v="draft" aria-pressed="${copy === 'draft'}" title="With a mark on each paragraph, proposals shown, and the basis, data and Confirm on Gr annexes">Draft</button></span>` +
      `<button data-a="accept-all" ${c.open ? '' : 'disabled'} title="Take every open proposal as it stands">Accept all (${c.open})</button>` +
      `<span class="k">Kind</span><select data-o="kind" aria-label="Kind of appreciation">${kinds.map((k) => `<option value="${k.kind}" ${k.kind === doc.kind ? 'selected' : ''} ${k.ready ? '' : 'disabled'}>${esc(k.label)}${k.ready ? '' : ' (no outline yet)'}</option>`).join('')}</select>` +
      `<span class="k">Export</span><button data-a="word" title="Word document (.docx), the copy chosen">Word</button><button data-a="print" title="Print; choose Save as PDF for a PDF">PDF</button><button data-a="text" title="Copy as text">Text</button><button data-a="json" title="Save the appreciation as a file to open later">Save</button><button data-a="open" title="Open a saved appreciation">Open</button>` +
      `<span class="k">Slides</span><select data-o="deck" aria-label="Deck">${APRC_DECKS.map((d) => `<option value="${d.kind}" ${d.kind === this._opts.deck ? 'selected' : ''} title="${esc(d.note)}">${esc(d.label)}</option>`).join('')}</select><button data-a="slides" title="Make the slides in the Briefing module; slides you edited are kept">Make slides</button>` +
      `<button data-a="clear" style="margin-left:auto" title="Start again with every heading empty">Clear</button>`;

    const guideOff = !(this._host.guide?.()?.isEnabled);
    const note = this._part('note');
    const noteText = this._note || (guideOff && !fr ? 'Ground Guide is off: the Gr paragraphs are read through it.' : '');
    note.classList.toggle('on', !!noteText);
    note.innerHTML = noteText ? `<span>${esc(noteText)}</span>${guideOff && this._host.turnOnGuide ? '<button data-a="guide">Turn on Ground Guide</button>' : ''}` : '';

    // outline: top-level paragraphs
    let out = '';
    for (const l of lines(doc)) {
      if (l.type === 'part') out += `<div class="ph">${esc(l.title)}</div>`;
      else if (l.type === 'group') out += `<div class="ph" style="padding-left:18px;letter-spacing:0">${esc(l.title)}</div>`;
      else if (l.depth === 0) {
        const m = this._markOf(l.p);
        out += `<button class="it${this._sel === l.p.id || this._sel?.startsWith(`${l.p.id}.`) ? ' sel' : ''}" data-a="sel" data-v="${esc(l.p.id)}" title="${esc(STATE_WORD[m])}"><span class="dot ${DOT[m]}"></span><span class="no">${esc(l.label.replace('.', ''))}</span><span class="nm">${esc(l.p.head ?? l.part.title)}</span></button>`;
      }
    }
    this._part('out').innerHTML = out;

    const mid = this._part('mid');
    const top = mid.scrollTop;
    mid.innerHTML = `<div class="aprc-doc">${bodyHtml(doc, copy)}</div>`;
    mid.scrollTop = top;
    if (this._sel) mid.querySelector(`.ap-p[data-id="${CSS.escape(this._sel)}"]`)?.classList.add('sel');

    this._renderRight(doc);
    this._part('foot').innerHTML = `<span><span class="dot gr"></span>From Gr <b>${c.gr}</b></span><span><span class="dot map"></span>From the map <b>${c.map}</b></span><span><span class="dot judge"></span>Proposals <b>${c.judge}</b> (${c.open} open)</span><span><span class="dot yours"></span>Yours <b>${c.yours}</b></span><span><span class="dot written"></span>Written <b>${c.written}</b>${c.stale ? ` (${c.stale} to look at: Gr changed)` : ''}</span><span class="msg">${esc(this._msg)}</span>`;
  }

  /** The worst state under a paragraph, for its dot in the outline. */
  private _markOf(p: AprcPara): string {
    const marks = new Set<string>();
    const go = (q: AprcPara) => {
      const s = shown(q, 'draft');
      if (s.text !== '' || q.table) marks.add(q.mine ? 'WRITTEN' : s.mark);
      q.children.forEach(go);
    };
    go(p);
    for (const m of ['YOURS', 'YOU JUDGE', 'MAP', 'GR', 'WRITTEN']) if (marks.has(m)) return m;
    return 'YOURS';
  }

  private _renderRight(doc: AprcDoc): void {
    const rt = this._part('rt');
    const p = this._sel ? find(doc, this._sel) : null;
    if (!p) {
      rt.innerHTML = `<h4>How it works</h4><ul><li><b>Read</b> drafts what the ground and the map can tell.</li><li>Click a paragraph to see what it rests on, and to write it yourself. What you write is yours: Read never overwrites it.</li><li>A <b>proposal</b> prints in the fair copy only once you accept it or rewrite it.</li><li>What the data cannot tell prints a ruled line.</li></ul>${doc.confirm.length ? `<h5>CONFIRM ON GR (${doc.confirm.length})</h5><ul>${doc.confirm.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul>` : ''}`;
      return;
    }
    const s = shown(p, 'draft');
    const mark = p.mine ? 'WRITTEN' : s.mark;
    const cur = p.mine?.text ?? (p.draft || '');
    let h = `<h4>${esc(numberOf(doc, p.id))} ${esc(p.head ?? '')}</h4><div class="st"><span class="dot ${DOT[mark]}"></span>${esc(STATE_WORD[mark])}${p.state === 'judge' && !p.mine ? (p.accepted ? ' · accepted' : ' · not accepted') : ''}</div>`;
    h += `<textarea aria-label="The paragraph in your words" placeholder="${esc(p.prompts.length ? p.prompts.join(' · ') : 'Write this paragraph')}">${esc(cur)}</textarea><div class="row"><button class="pri" data-a="save">Save as mine</button>${p.mine ? '<button data-a="give" title="Drop your words and take the tool\'s draft again">Give back</button>' : ''}${p.state === 'judge' && !p.mine && p.draft ? (p.accepted ? '<button data-a="acc" data-v="off">Take back</button>' : '<button data-a="acc">Accept</button>') : ''}</div>`;
    if (isStale(p)) h += `<div class="stale">The reading has changed since you wrote this. It now says: ${esc(p.draft ?? '')}</div>`;
    if (p.table) h += `<p class="mut">The table is filled by the tool where it can; fill the rest in Word.</p>`;
    if (p.prompts.length) h += `<h5>TO CONSIDER</h5><ul>${p.prompts.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    if (p.basis.length) h += `<h5>RESTS ON</h5><ul>${p.basis.map((b) => `<li><span class="mut">${esc(b.kind[0].toUpperCase() + b.kind.slice(1))}:</span> ${esc(b.text)}</li>`).join('')}</ul>`;
    const conf = doc.confirm.filter((x) => x.paras.some((id) => p.id === id || p.id.startsWith(`${id}.`)));
    if (conf.length) h += `<h5>CONFIRM ON GR</h5><ul>${conf.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul>`;
    rt.innerHTML = h;
  }
}
