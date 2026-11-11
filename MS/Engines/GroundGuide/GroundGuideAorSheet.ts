/**
 * GroundGuideAorSheet.ts
 *
 * D in the AOR scale of the Gr Scope rail (user, 2026-11-11): the appreciation behind the rail's lines, docked beside the
 * rail. One tab per approach under AprDf's twelve sub-heads (best first), then ITGs and the deductions, then what to
 * confirm on the ground; Copy as Text gives the whole paragraph in AprDf's numbering. Lines the bundle cannot know are
 * left as ____ for the planner, never guessed. Text goes in through `textContent` only.
 */

import type { AorReading } from './GroundGuideAor';
import { aorName, aorSheetRows, aorText, aorWords, type AorFrame } from './GroundGuideScopeAor';
import { ACCENT, FONT, FS, FW, LINE, SURFACE, TEXT } from './GroundGuideTokens';

const STYLE_ID = 'ms-ground-guide-aor-sheet-style';
const W = 470;
const CSS = `
.ms-ggas{position:fixed;z-index:2147482701;width:${W}px;max-height:836px;display:flex;flex-direction:column;background:${SURFACE.card};color:${TEXT.main};
  border:1.5px solid #4f5965;border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.45);font:${FW.regular} ${FS.body}px/1.45 ${FONT};overflow:hidden;text-align:left}
.ms-ggas[hidden]{display:none}
.ms-ggas *{box-sizing:border-box}
.ms-ggas-head{flex:none;display:flex;align-items:center;gap:6px;padding:8px 10px;background:${SURFACE.head};border-bottom:1px solid ${LINE.hair}}
.ms-ggas-ttl{font-weight:${FW.bold};font-size:${FS.value}px;margin-right:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-ggas button{font:${FW.semi} ${FS.meta}px/1 ${FONT};color:${TEXT.main};background:#2b313a;border:1px solid #545e6b;border-radius:6px;padding:5px 9px;cursor:pointer}
.ms-ggas button:hover{filter:brightness(1.15)}
.ms-ggas button:focus-visible{outline:2px solid ${ACCENT};outline-offset:2px}
.ms-ggas button[aria-selected="true"]{background:${ACCENT};color:#0d1620;border-color:${ACCENT}}
.ms-ggas-tabs{flex:none;display:flex;flex-wrap:wrap;gap:5px;padding:8px 10px;border-bottom:1px solid ${LINE.soft}}
.ms-ggas-body{flex:1;min-height:0;overflow:auto;padding:4px 12px 12px}
.ms-ggas-row{display:grid;grid-template-columns:128px minmax(0,1fr);gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.07)}
.ms-ggas-row:last-child{border-bottom:0}
.ms-ggas-k{color:${TEXT.label};font-size:${FS.meta}px}
.ms-ggas-blank{color:${TEXT.label};font-style:italic}
.ms-ggas-warn{color:${TEXT.warn}}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class GroundGuideAorSheet {
  private _root: HTMLDivElement | null = null;
  private _tab = '';
  private _reading: AorReading | null = null;
  private _frame: AorFrame | null = null;
  private _anchor: { rect: DOMRect | null; side: 'right' | 'left' } = { rect: null, side: 'right' };
  private _copyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly _onClose: () => void) {}

  get isOpen(): boolean {
    return !!this._root && !this._root.hidden;
  }

  /** Show it beside the rail (`rect`, the rail's box on screen), on `tab` ('' the first approach, 'confirm' what to confirm). */
  open(r: AorReading, f: AorFrame, rect: DOMRect | null, side: 'right' | 'left', tab?: string): void {
    this._reading = r;
    this._frame = f;
    this._anchor = { rect, side };
    if (tab !== undefined) this._tab = tab;
    this._render();
  }

  /** New reading while it is open (the AOR moved, a tile arrived). */
  update(r: AorReading | null, f: AorFrame, rect: DOMRect | null, side: 'right' | 'left'): void {
    if (!this.isOpen) return;
    if (!r) return this.close();
    this.open(r, f, rect, side);
  }

  close(): void {
    if (this._root) this._root.hidden = true;
  }

  destroy(): void {
    if (this._copyTimer !== null) clearTimeout(this._copyTimer);
    this._root?.remove();
    this._root = null;
  }

  private _ensure(): HTMLDivElement {
    if (this._root) return this._root;
    if (!document.getElementById(STYLE_ID)) {
      const s = document.createElement('style');
      s.id = STYLE_ID;
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    const root = el('div', 'ms-ggas');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'AOR approach sheets');
    for (const t of ['pointerdown', 'mousedown', 'dblclick', 'click']) root.addEventListener(t, (e) => e.stopPropagation());
    document.body.appendChild(root);
    this._root = root;
    return root;
  }

  private _render(): void {
    const r = this._reading, f = this._frame;
    if (!r || !f) return;
    const root = this._ensure();
    root.hidden = false;
    const w = aorWords(r, f);
    const tabs: Array<[string, string]> = w.ranked.map((a) => [a.side, `${a.rank} · ${a.side} Apch`]);
    tabs.push(['itg', 'ITGs & Ded'], ['confirm', `Confirm ${w.confirm.length}`]);
    if (!tabs.some((t) => t[0] === this._tab)) this._tab = tabs[0][0];

    const head = el('div', 'ms-ggas-head');
    head.append(el('span', 'ms-ggas-ttl', `AOR · Def ${r.mitg.name}`));
    const copy = el('button', undefined, 'Copy as Text');
    copy.type = 'button';
    copy.title = 'Copy the appreciation paragraph (AprDf numbering) as plain text';
    copy.addEventListener('click', () => {
      const txt = aorText(r, f);
      const done = (ok: boolean) => {
        copy.textContent = ok ? 'Copied' : 'Copy failed';
        if (this._copyTimer !== null) clearTimeout(this._copyTimer);
        this._copyTimer = setTimeout(() => {
          copy.textContent = 'Copy as Text';
          this._copyTimer = null;
        }, 1600);
      };
      navigator.clipboard?.writeText(txt).then(() => done(true), () => done(false)) ?? done(false);
    });
    const close = el('button', undefined, 'D · Close');
    close.type = 'button';
    close.title = 'Close (D or Esc)';
    close.addEventListener('click', () => {
      this.close();
      this._onClose();
    });
    head.append(copy, close);

    const bar = el('div', 'ms-ggas-tabs');
    bar.setAttribute('role', 'tablist');
    for (const [id, label] of tabs) {
      const b = el('button', undefined, label);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(id === this._tab));
      b.addEventListener('click', () => {
        this._tab = id;
        this._render();
      });
      bar.append(b);
    }

    const body = el('div', 'ms-ggas-body');
    const add = (k: string, v: string | null, cls?: string) => {
      const d = el('div', 'ms-ggas-row');
      d.append(el('div', 'ms-ggas-k', k));
      d.append(v === null ? el('div', 'ms-ggas-blank', '____ (the bundle cannot tell; planner to fill)') : el('div', cls, v));
      body.append(d);
    };
    const a = r.apchs.find((x) => x.side === this._tab);
    if (a) aorSheetRows(r, a).forEach(([k, v], i) => add(`(${i + 1}) ${k}`, k === 'Obsn' && v === null ? 'From the OCOKA lens: F, then D on the approach (not read at the AOR scale).' : v, k === 'Obsn' && v === null ? 'ms-ggas-blank' : undefined));
    else if (this._tab === 'itg') {
      add('MITG', `${r.mitg.name}: ${r.apchs.length} apchs end there${r.thruRoad ? `; Rd ${aorName(r.thruRoad.name)} ${r.thruRoad.cls ?? ''} runs through it` : ''}${r.msr ? `; MSR ${aorName(r.msr.name)} ${r.msr.cls ?? ''} ${(r.msr.distM / 1000).toFixed(1)} km away` : ''}.`);
      add('Effs if lost', null);
      for (const l of r.lines.filter((x) => x.role === 'FDLs' || x.role === 'Depth')) add(`ITGs on ${l.id}`, l.buas.filter(Boolean).join(', ') || '—');
      add('Pri of Apchs', `${w.ranked.map((x) => x.side).join(', ') || '—'} (shortest past the border, least terrain friction).`);
      add('Pri of Comb', r.laterals.length ? r.laterals.map((l) => `${l.a} and ${l.b} (${l.n} laterals)`).join('; ') : 'No metalled lateral joins the apchs.');
      for (const l of r.lines) add(`Line ${l.id}${l.role ? ` · ${l.role}` : ''}`, `${l.name}, ${(l.frontM / 1000).toFixed(1)} km between bdys${l.obstacle ? ` (along ${l.obstacle})` : ''}${l.lateral ? '; a metalled Rd runs along it' : ''}.`);
      if (w.dp) add('DP 1', `${w.dp}. Bias of def ${w.ranked[0]?.side ?? '—'}.`);
      if (w.sub) add('Frontage', w.sub.replace(/^Frontage /, ''), w.sub.includes('over') ? 'ms-ggas-warn' : undefined);
      add('Prelim dml', r.dml.length ? r.dml.map((d) => `Br over ${d.water} on the ${d.side} apch, ${Math.round(d.bridgeM)} m off the crossing; class not recorded`).join('; ') + '.' : 'No water obstacle across the apchs.');
    } else w.confirm.forEach((c, i) => add(String(i + 1), c));

    root.replaceChildren(head, bar, body);
    this._place();
  }

  private _place(): void {
    const root = this._root;
    if (!root) return;
    const r = this._anchor.rect;
    const top = r ? r.top : 60;
    const left = r ? (this._anchor.side === 'right' ? r.left - W - 10 : r.right + 10) : window.innerWidth - W - 20;
    root.style.top = `${Math.round(top)}px`;
    root.style.left = `${Math.max(8, Math.round(left))}px`;
    root.style.maxHeight = `${Math.round(r ? r.height : window.innerHeight - 80)}px`;
  }
}
