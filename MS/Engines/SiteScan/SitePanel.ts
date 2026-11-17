/**
 * SitePanel.ts
 *
 * The panel a site finder docks at the foot of the map (Gun Deployment on the left, Admin Area on the right): a title
 * bar, the settings as a strip of selects and numbers, the places it works from (search circle, target, threat) each
 * with its Pick button, the actions, an answer line, the ranked sites as one line each, and the selected site's rows
 * (value, verdict colour, why, fix). One delegated listener; the host owns every state and is asked again on render.
 * Colours from GroundGuideTokens. Esc closes it (the host binds the key).
 */

import Utils from '../../Support/utils';
import { ensureTokensCss } from '../GroundGuide/GroundGuideTokens';
import { basisLabel, type RuleRef, type Tone } from './SiteScan';

const esc = (s: unknown): string => Utils.escapeHtml(String(s ?? ''));

export interface PanelControl {
  key: string;
  label: string;
  type: 'select' | 'number';
  value: string | number;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  title?: string;
}
export interface PanelAction {
  id: string;
  label: string;
  title?: string;
  primary?: boolean;
  disabled?: boolean;
}
export interface PanelPlace {
  label: string;
  value: string;
  /** Buttons beside it: action ids with labels. */
  buttons: Array<{ id: string; label: string; title?: string; on?: boolean }>;
}
export interface PanelRow {
  label: string;
  value: string;
  tone: Tone;
  why: string;
  fix?: string;
  /** The rules the check applied (book, page, words; or the proposal and why). */
  rules?: RuleRef[];
}
export interface PanelSite {
  rank: number;
  grid: string;
  verdict: string;
  tone: Tone;
  score: number;
  rows: PanelRow[];
  /** Why it stands where it does in the list. */
  why?: string[];
  /** The ordering method behind that (proposals). */
  whyRules?: RuleRef[];
}
/** A reason with the rules behind it (a place left out, a gate failed). */
export interface PanelReason {
  text: string;
  rules: RuleRef[];
}
/** "Why not here?": a place the user picked, read with the same checks. */
export interface PanelWhyNot {
  grid: string;
  verdict: string;
  tone: Tone;
  gates: PanelReason[];
  vsBest: string[];
  rows: PanelRow[];
}
export interface SitePanelHost {
  controls(): PanelControl[];
  setControl(key: string, value: string): void;
  places(): PanelPlace[];
  actions(): PanelAction[];
  act(id: string): void;
  headline(): { tone: Tone | 'idle'; text: string };
  sites(): PanelSite[];
  selected(): number;
  select(i: number): void;
  notes(): string[];
  footer(): string;
  close(): void;
  /** Places left out of the list, by reason, with the rules (optional). */
  leftOut?(): PanelReason[];
  /** The "Why not here?" reading, when one was asked for (optional). */
  whyNot?(): PanelWhyNot | null;
}

/** One rule as HTML: where (book, page), the words, whether they were checked in the book. */
export function ruleHtml(r: RuleRef): string {
  const chk =
    r.checked === 'ok'
      ? '<span class="ms-rc ok" title="These words were found on this page of the book (tools/doctrine-refs/verify.py)">✓ checked</span>'
      : r.checked === 'page?'
        ? '<span class="ms-rc warn" title="The words were found, but on another page: confirm the page">page?</span>'
        : r.checked === 'unchecked'
          ? '<span class="ms-rc" title="An online source: not checked against a local copy">online</span>'
          : r.checked === 'orbat'
            ? '<span class="ms-rc" title="From the ORBAT data (weapons.json), read from this page of the handbook; checked by tools/orbat-test">ORBAT</span>'
            : '';
  if (!r.book)
    return `<li class="ms-r-e"><b>${esc(r.figure)}</b>: <span class="ms-rb ${esc(r.basis.toLowerCase())}">${esc(basisLabel(r))}</span>${r.note ? ` ${esc(r.note)}` : ''}${r.searched ? ` <span class="ms-r-s">Looked for in: ${esc(r.searched)}.</span>` : ''}${r.decided ? ` <span class="ms-r-s">Decided ${esc(r.decided)}.</span>` : ''}</li>`;
  if (r.role === 'data') return `<li><span class="ms-rb d" title="The data this value was read from">data</span> <b>${esc(r.figure)}</b>: ${esc(r.book)}${r.quote ? `: ${esc(r.quote)}` : ''}</li>`;
  const tag = r.role === 'context' ? '<span class="ms-rb c">context</span>' : `<span class="ms-rb ${esc(r.basis.toLowerCase())}">${esc(r.basis)}</span>`;
  return `<li>${tag} <b>${esc(r.figure)}</b>: ${esc(r.book)}${r.page ? ` <b>p ${esc(r.page)}</b>` : ''}${r.quote ? ` <q>${esc(r.quote)}</q>` : ''} ${chk}${r.calc ? ` <span class="ms-r-s">Worked out: ${esc(r.calc)}</span>` : ''}${r.note ? ` <span style="color:#9aa3ad">${esc(r.note)}</span>` : ''}</li>`;
}

/** A folded list of rules: the summary names book and page of each; open it for the words. */
export function rulesHtml(rules: RuleRef[] | undefined, key: string): string {
  if (!rules?.length) return '';
  const seen = new Set<string>();
  const where: string[] = [];
  for (const r of rules) {
    const w = r.role === 'data' ? `data: ${r.book.split(' - ')[0]}` : r.book ? `${r.book.replace("SO's Hbk 2019, ", 'SOH ')}${r.page ? ` p ${r.page}` : ''}` : r.basis === 'E' ? (r.decided ? 'decision' : 'proposal') : r.basis === 'M' ? 'method' : r.basis;
    if (!seen.has(w)) {
      seen.add(w);
      where.push(w);
    }
  }
  return `<details class="ms-sf-rules" data-k="${esc(key)}"><summary>📖 ${esc(where.join(' · '))}</summary><ul>${rules.map(ruleHtml).join('')}</ul></details>`;
}

const CSS = `
.ms-sf{position:fixed;bottom:10px;z-index:2147482805;width:min(470px,calc(100vw - 20px));max-height:calc(100vh - 150px);display:none;flex-direction:column;
 background:var(--gg-card);color:#f1f3f6;border:1px solid var(--gg-hair);border-radius:11px;box-shadow:0 10px 28px rgba(0,0,0,.5);font:13px/1.35 system-ui,Segoe UI,Arial,sans-serif}
.ms-sf.ms-open{display:flex}
.ms-sf.ms-left{left:10px}.ms-sf.ms-right{right:10px}
.ms-sf *{box-sizing:border-box}
.ms-sf-h{flex:none;display:flex;align-items:center;gap:8px;padding:7px 10px;background:linear-gradient(90deg,#1d2635,var(--gg-head) 45%);border-radius:11px 11px 0 0}
.ms-sf-t{font-weight:750;font-size:13.5px;color:#fff;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-sf-btn{font:500 12.5px/1 system-ui,Segoe UI,Arial,sans-serif;color:#e1e6eb;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.18);border-radius:6px;cursor:pointer;height:27px;padding:0 9px;white-space:nowrap}
.ms-sf-btn:hover{background:rgba(255,255,255,.14);color:#fff}
.ms-sf-btn:focus-visible{outline:2px solid var(--gg-accent);outline-offset:1px}
.ms-sf-btn.ms-pri{background:#2b5d86;border-color:#4f8ab8}
.ms-sf-btn.ms-on{background:#e4e8ec;color:#14181d;border-color:#e4e8ec}
.ms-sf-btn[disabled]{opacity:.45;cursor:default}
.ms-sf-btn.ms-x{width:27px;padding:0;font-size:17px}
.ms-sf-btn.ms-sm{height:22px;padding:0 7px;font-size:11.5px}
.ms-sf-strip{flex:none;display:flex;flex-wrap:wrap;gap:5px 10px;padding:6px 10px;background:var(--gg-strip);border-bottom:1px solid var(--gg-hair-soft);font-size:12px;color:var(--gg-label)}
.ms-sf-strip label{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.ms-sf select,.ms-sf input{font:500 12.5px/1.2 system-ui,Segoe UI,Arial,sans-serif;color:#f1f3f6;background:#11151a;border:1px solid #3d4650;border-radius:5px;padding:2px 4px;height:23px;max-width:210px}
.ms-sf input{width:56px;text-align:right}
.ms-sf select:focus,.ms-sf input:focus{outline:1px solid #8ec1ea;border-color:#8ec1ea}
.ms-sf-places{flex:none;padding:5px 10px;border-bottom:1px solid var(--gg-hair-soft);display:grid;grid-template-columns:auto 1fr auto;gap:4px 8px;align-items:center;font-size:12.5px}
.ms-sf-places .k{color:var(--gg-label)}
.ms-sf-places .v{color:#f1f3f6;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ms-sf-places .b{display:flex;gap:4px;justify-content:flex-end}
.ms-sf-acts{flex:none;display:flex;flex-wrap:wrap;gap:5px;padding:6px 10px;border-bottom:1px solid var(--gg-hair)}
.ms-sf-ans{flex:none;padding:7px 12px;font-weight:700;font-size:14px;border-bottom:1px solid var(--gg-hair)}
.ms-sf-ans[data-tone="ok"]{color:#74dca3}.ms-sf-ans[data-tone="warn"]{color:#ffb46b}.ms-sf-ans[data-tone="bad"]{color:#ff8a8d}.ms-sf-ans[data-tone="unknown"],.ms-sf-ans[data-tone="idle"]{color:#c3cbd3}
.ms-sf-body{flex:1 1 auto;min-height:0;overflow:auto;padding:4px 0 6px}
.ms-sf-list{list-style:none;margin:0;padding:0}
.ms-sf-list li{display:grid;grid-template-columns:22px 1fr auto;gap:8px;align-items:center;padding:4px 12px;cursor:pointer;border-left:3px solid transparent}
.ms-sf-list li:hover{background:rgba(255,255,255,.04)}
.ms-sf-list li.ms-sel{background:rgba(142,193,234,.1);border-left-color:#8ec1ea}
.ms-sf-rk{width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:750;font-size:11.5px;color:#14181d}
.ms-sf-g{font-variant-numeric:tabular-nums;color:#f1f3f6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-sf-vd{font-size:12px;white-space:nowrap}
.ms-sf-rows{margin:6px 12px 0;border-top:1px solid var(--gg-hair);padding-top:6px}
.ms-sf-row{display:grid;grid-template-columns:10px 112px 1fr;gap:2px 8px;padding:3px 0;border-bottom:1px solid var(--gg-hair-soft)}
.ms-sf-dot{width:9px;height:9px;border-radius:50%;margin-top:4px}
.ms-sf-rl{color:var(--gg-label)}
.ms-sf-rv{color:#f4f6f8;font-weight:600}
.ms-sf-why{grid-column:3;font-size:11.5px;color:var(--gg-label)}
.ms-sf-fix{grid-column:3;font-size:11.5px;color:#ffd27a}
.ms-sf-note{margin:6px 12px 0;font-size:12px;color:var(--gg-label)}
.ms-sf-rules{grid-column:3;font-size:11.5px;color:var(--gg-label);margin-top:1px}
.ms-sf-rules summary{cursor:pointer;color:#8ec1ea;list-style:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ms-sf-rules summary::-webkit-details-marker{display:none}
.ms-sf-rules[open] summary{white-space:normal}
.ms-sf-rules ul{margin:3px 0 2px;padding-left:14px}
.ms-sf-rules li{margin:2px 0;color:#d5dbe1}
.ms-sf-rules q{color:#f1f3f6;font-style:italic}
.ms-rb{display:inline-block;min-width:14px;padding:0 4px;border-radius:6px;font-size:10px;font-weight:700;text-align:center;background:rgba(255,255,255,.12);color:#e4e8ec}
.ms-rb.r{background:rgba(47,168,98,.3);color:#a6ebc4}.ms-rb.u,.ms-rb.s{background:rgba(77,166,255,.28);color:#bcdcff}.ms-rb.e{background:rgba(238,138,31,.3);color:#ffd09a}.ms-rb.c{background:rgba(255,255,255,.08);color:#c3cbd3}.ms-rb.d,.ms-rb.t{background:rgba(167,139,250,.25);color:#d9ccff}.ms-rb.m{background:rgba(144,164,174,.28);color:#d5dee3}
.ms-r-s{color:#9aa3ad}
.ms-rc{display:inline-block;padding:0 4px;border-radius:6px;font-size:10px;background:rgba(255,255,255,.08);color:#c3cbd3}
.ms-rc.ok{background:rgba(47,168,98,.25);color:#a6ebc4}.ms-rc.warn{background:rgba(238,138,31,.25);color:#ffd09a}
.ms-sf-why{grid-column:3}
.ms-sf-sec{margin:8px 12px 0;padding-top:6px;border-top:1px solid var(--gg-hair)}
.ms-sf-sec h5{margin:0 0 4px;font-size:12px;color:#e4e8ec}
.ms-sf-sec p,.ms-sf-sec li{margin:2px 0;font-size:12px;color:#d5dbe1}
.ms-sf-sec ul{margin:0;padding-left:16px}
.ms-sf-reason{margin:3px 0}
.ms-sf-reason .ms-sf-rules{margin-left:0}
.ms-sf-foot{flex:none;padding:4px 12px 6px;font-size:11px;color:var(--gg-label);border-top:1px solid var(--gg-hair-soft)}
`;

type PartKey = 'strip' | 'places' | 'acts' | 'ans' | 'body' | 'foot';

const TONE_HEX: Record<Tone, string> = { ok: '#2fa862', warn: '#ee8a1f', bad: '#e5484d', unknown: '#9aa3ad' };

let cssDone = false;
function ensureCss(): void {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  ensureTokensCss();
  const st = document.createElement('style');
  st.id = 'ms-site-panel-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

export class SitePanel {
  private _el: HTMLElement | null = null;
  private _open = false;
  private _host: SitePanelHost;
  private _title: string;
  private _side: 'left' | 'right';
  private _id: string;

  constructor(id: string, title: string, side: 'left' | 'right', host: SitePanelHost) {
    this._id = id;
    this._title = title;
    this._side = side;
    this._host = host;
  }

  get isOpen(): boolean {
    return this._open;
  }

  open(): void {
    ensureCss();
    if (!this._el) this._build();
    this._open = true;
    fitBelowBar(this._el!);
    this._el!.classList.add('ms-open');
    this.render();
  }

  close(): void {
    this._open = false;
    this._el?.classList.remove('ms-open');
  }

  destroy(): void {
    this.close();
    this._el?.remove();
    this._el = null;
    this._parts = null;
    this._last = {};
  }

  private _build(): void {
    const el = document.createElement('section');
    el.id = this._id;
    el.className = `ms-sf ms-${this._side}`;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', this._title);
    el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act],[data-site]') as HTMLElement | null;
      if (!t || !el.contains(t)) return;
      if (t.dataset.act === '__close') {
        this._host.close();
        return;
      }
      if (t.dataset.act) this._host.act(t.dataset.act);
      else if (t.dataset.site) this._host.select(Number(t.dataset.site));
    });
    el.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement | HTMLSelectElement;
      const key = t.dataset?.ctl;
      if (key) this._host.setControl(key, t.value);
    });
    // keys typed into the panel's fields stay there (no map shortcuts)
    el.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT') e.stopPropagation();
    });
    document.body.appendChild(el);
    this._el = el;
  }

  render(): void {
    if (!this._open || !this._el) return;
    const h = this._host;
    const ctl = h
      .controls()
      .map((c) => {
        const t = c.title ? ` title="${esc(c.title)}"` : '';
        if (c.type === 'select')
          return `<label${t}>${esc(c.label)} <select data-ctl="${esc(c.key)}">${(c.options ?? [])
            .map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(c.value) ? ' selected' : ''}>${esc(o.label)}</option>`)
            .join('')}</select></label>`;
        return `<label${t}>${esc(c.label)} <input type="number" data-ctl="${esc(c.key)}" value="${esc(c.value)}"${c.min !== undefined ? ` min="${c.min}"` : ''}${c.max !== undefined ? ` max="${c.max}"` : ''}${c.step !== undefined ? ` step="${c.step}"` : ''}>${c.unit ? ` ${esc(c.unit)}` : ''}</label>`;
      })
      .join('');
    const places = h
      .places()
      .map(
        (p) =>
          `<span class="k">${esc(p.label)}</span><span class="v" title="${esc(p.value)}">${esc(p.value)}</span><span class="b">${p.buttons
            .map((b) => `<button type="button" class="ms-sf-btn ms-sm${b.on ? ' ms-on' : ''}" data-act="${esc(b.id)}"${b.title ? ` title="${esc(b.title)}"` : ''}>${esc(b.label)}</button>`)
            .join('')}</span>`,
      )
      .join('');
    const acts = h
      .actions()
      .map((a) => `<button type="button" class="ms-sf-btn${a.primary ? ' ms-pri' : ''}" data-act="${esc(a.id)}"${a.disabled ? ' disabled' : ''}${a.title ? ` title="${esc(a.title)}"` : ''}>${esc(a.label)}</button>`)
      .join('');
    const hl = h.headline();
    const sites = h.sites();
    const sel = h.selected();
    const list = sites.length
      ? `<ul class="ms-sf-list">${sites
          .map(
            (s, i) =>
              `<li data-site="${i}" class="${i === sel ? 'ms-sel' : ''}"><span class="ms-sf-rk" style="background:${TONE_HEX[s.tone]}">${s.rank}</span><span class="ms-sf-g">${esc(s.grid)}</span><span class="ms-sf-vd" style="color:${TONE_HEX[s.tone]}">${esc(s.verdict)}</span></li>`,
          )
          .join('')}</ul>`
      : '';
    const cur = sites[sel];
    const rows = cur
      ? `<div class="ms-sf-rows">${cur.rows
          .map(
            (r) =>
              `<div class="ms-sf-row"><span class="ms-sf-dot" style="background:${TONE_HEX[r.tone]}"></span><span class="ms-sf-rl">${esc(r.label)}</span><span class="ms-sf-rv">${esc(r.value)}</span><span class="ms-sf-why">${esc(r.why)}</span>${r.fix ? `<span class="ms-sf-fix">Fix: ${esc(r.fix)}</span>` : ''}${rulesHtml(r.rules, `s${cur.rank}:${r.label}`)}</div>`,
          )
          .join('')}</div>`
      : '';
    const notes = h
      .notes()
      .map((n) => `<p class="ms-sf-note">${esc(n)}</p>`)
      .join('');
    // why this one stands where it does in the list
    const order = cur?.why?.length ? `<div class="ms-sf-sec"><h5>Why #${cur.rank} is here</h5>${cur.why.map((w) => `<p>${esc(w)}</p>`).join('')}${rulesHtml(cur.whyRules, 'order')}</div>` : '';
    // "Why not here?": the gates it failed (with their rules), where #1 is better, and its own rows
    const wn = h.whyNot?.() ?? null;
    const whyNot = wn
      ? `<div class="ms-sf-sec"><h5>Why not ${esc(wn.grid)}?</h5><p style="color:${TONE_HEX[wn.tone]}">${esc(wn.verdict)}</p>` +
        wn.gates.map((g, i) => `<div class="ms-sf-reason">• ${esc(g.text)}${rulesHtml(g.rules, `wg${i}`)}</div>`).join('') +
        (wn.vsBest.length ? `<ul>${wn.vsBest.map((v) => `<li>${esc(v)}</li>`).join('')}</ul>` : '') +
        (wn.rows.length
          ? `<details class="ms-sf-rules" data-k="wnrows" style="margin-top:4px"><summary>Every check at this place (${wn.rows.length})</summary><div class="ms-sf-rows" style="margin:4px 0 0">${wn.rows
              .map((r) => `<div class="ms-sf-row"><span class="ms-sf-dot" style="background:${TONE_HEX[r.tone]}"></span><span class="ms-sf-rl">${esc(r.label)}</span><span class="ms-sf-rv">${esc(r.value)}</span><span class="ms-sf-why">${esc(r.why)}</span>${rulesHtml(r.rules, `wn:${r.label}`)}</div>`)
              .join('')}</div></details>`
          : '') +
        `</div>`
      : '';
    // places left out of the list, by reason
    const left = h.leftOut?.() ?? [];
    const leftOut = left.length ? `<div class="ms-sf-sec"><h5>Places left out</h5>${left.map((g, i) => `<div class="ms-sf-reason">• ${esc(g.text)}${rulesHtml(g.rules, `lo${i}`)}</div>`).join('')}</div>` : '';
    const foot = h.footer();
    if (!this._parts) {
      this._el.innerHTML =
        `<header class="ms-sf-h"><span class="ms-sf-t">${esc(this._title)}</span><button type="button" class="ms-sf-btn ms-x" data-act="__close" aria-label="Close" title="Close (Esc)">×</button></header>` +
        `<div class="ms-sf-strip"></div><div class="ms-sf-places"></div><div class="ms-sf-acts"></div><div class="ms-sf-ans" role="status"></div><div class="ms-sf-body"></div><div class="ms-sf-foot"></div>`;
      const q = (c: string) => this._el!.querySelector(`.${c}`) as HTMLElement;
      this._parts = { strip: q('ms-sf-strip'), places: q('ms-sf-places'), acts: q('ms-sf-acts'), ans: q('ms-sf-ans'), body: q('ms-sf-body'), foot: q('ms-sf-foot') };
    }
    // only the parts whose content changed are rewritten: a select or number box being used keeps its focus
    const set = (k: PartKey, html: string) => {
      const p = this._parts![k];
      if (this._last[k] === html) return;
      this._last[k] = html;
      // folded rule lists that were open stay open when the part is rewritten (tiles arriving, a new reading)
      const open = new Set([...p.querySelectorAll('details[open]')].map((d) => (d as HTMLElement).dataset.k ?? ''));
      const scroll = p.scrollTop;
      p.innerHTML = html;
      for (const d of p.querySelectorAll('details')) if (open.has((d as HTMLElement).dataset.k ?? '')) (d as HTMLDetailsElement).open = true;
      p.scrollTop = scroll;
      p.style.display = html ? '' : 'none';
    };
    set('strip', ctl);
    set('places', places);
    set('acts', acts);
    this._parts.ans.dataset.tone = hl.tone;
    set('ans', esc(hl.text));
    set('body', `${list}${whyNot}${rows}${order}${leftOut}${notes}`);
    set('foot', foot ? esc(foot) : '');
  }

  private _parts: Record<PartKey, HTMLElement> | null = null;
  private _last: Record<string, string> = {};
}

/**
 * Dock a top-anchored panel just below the host's top bar (`#infoDiv` in the harness; it wraps to more rows on a
 * narrow window), else 118 px down, and keep it on the screen.
 */
export function dockBelowBar(el: HTMLElement): void {
  if (typeof document === 'undefined') return;
  const bar = document.getElementById('infoDiv');
  const b = bar?.getBoundingClientRect();
  const top = Math.round(Math.max(10, b && b.height > 0 && b.bottom < window.innerHeight * 0.6 ? b.bottom + 8 : 118));
  el.style.top = `${top}px`;
  el.style.maxHeight = `calc(100vh - ${top + 10}px)`;
}

/** Keep a bottom-anchored panel from running up under the host's top bar. */
export function fitBelowBar(el: HTMLElement): void {
  if (typeof document === 'undefined') return;
  const b = document.getElementById('infoDiv')?.getBoundingClientRect();
  const top = b && b.height > 0 && b.bottom < window.innerHeight * 0.6 ? b.bottom + 8 : 140;
  el.style.maxHeight = `calc(100vh - ${Math.round(top + 10)}px)`;
}

const hintTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** The status pill at the top of the map ("Click where the guns should go"); null takes it off. */
export function siteHint(id: string, icon: string, text: string | null, ms = 0): void {
  if (typeof document === 'undefined') return;
  const t = hintTimers.get(id);
  if (t) clearTimeout(t);
  hintTimers.delete(id);
  let h = document.getElementById(id);
  if (!text) {
    h?.remove();
    return;
  }
  if (!h) {
    h = document.createElement('div');
    h.id = id;
    h.setAttribute('role', 'status');
    h.style.cssText =
      'position:fixed;left:50%;top:96px;transform:translateX(-50%);z-index:2147482995;pointer-events:none;padding:7px 14px;border-radius:999px;' +
      'background:rgba(20,24,29,.92);border:1px solid #8ec1ea;color:#f1f3f6;font:600 13.5px/1.3 system-ui,Segoe UI,Arial,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.45);white-space:nowrap';
    document.body.appendChild(h);
  }
  h.textContent = `${icon} ${text}`;
  if (ms > 0) hintTimers.set(id, setTimeout(() => siteHint(id, icon, null), ms));
}

export default SitePanel;
