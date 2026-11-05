/**
 * PlacementBrief.ts
 *
 * The Ground Brief (G while drawing): a docked panel with the ground under the symbol in GROTBC order, larger than
 * the cursor card has room for. It keeps the last draw's content until it is closed (G, Esc or its close button),
 * so it can be read after the click.
 *
 * Sections come from a registry: this file registers G Soil and the T going / movement / season sections; other
 * modules add theirs (e.g. B population) with `registerBriefSection()` as a side effect of being imported.
 * DOM nodes and textContent only.
 */

import { fmtDistance } from './PlacementEvaluator';
import { RATING_COLOR, RATING_LABEL } from './PlacementGoing';
import {
  ensureGoingCss,
  goingCanvas,
  goingScale,
  modeGrid,
  ribbon,
  roseSvg,
  seasonIcon,
  soilGauge,
  sourceChip,
  textureTriangle,
} from './PlacementGoingView';
import type { PlacementVerdict } from './PlacementTypes';

export type GrotbcLetter = 'G' | 'R' | 'O' | 'T' | 'B' | 'C';

export interface BriefSection {
  id: string;
  letter: GrotbcLetter;
  /** Order within the letter (lower first). */
  order: number;
  title: string;
  /** The section body, or null to leave the section out for this verdict. */
  render(v: PlacementVerdict): HTMLElement | null;
  /** Plain-text lines for orders (Copy as Text). */
  text?(v: PlacementVerdict): string[];
}

const LETTERS: GrotbcLetter[] = ['G', 'R', 'O', 'T', 'B', 'C'];
const LETTER_COLOR: Record<GrotbcLetter, string> = { G: '#8fb35a', R: '#c9a46b', O: '#7a5cc9', T: '#5aa9e6', B: '#9a8f86', C: '#1f8a5a' };
const sections: BriefSection[] = [];

/** Add (or replace, by id) a section of the Ground Brief. */
export function registerBriefSection(s: BriefSection): void {
  const i = sections.findIndex((x) => x.id === s.id);
  if (i >= 0) sections[i] = s;
  else sections.push(s);
}

const STYLE_ID = 'ms-placement-brief-style';
const CSS = `
.ms-pbr{position:fixed;right:16px;top:72px;z-index:2147482900;width:390px;max-width:calc(100vw - 32px);max-height:calc(100vh - 96px);overflow-y:auto;
  box-sizing:border-box;border-radius:10px;background:#1b1f25;border:1.5px solid #5b6470;box-shadow:0 6px 20px rgba(0,0,0,.45);
  font:400 12px/1.4 system-ui,Segoe UI,Arial,sans-serif;color:#f3f5f7;display:none;scrollbar-width:thin;scrollbar-color:#4a535e transparent}
.ms-pbr-h{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:8px;padding:8px 10px 8px 12px;background:#2b333d}
.ms-pbr-h b{font-size:13.5px;letter-spacing:.06em;text-transform:uppercase}
.ms-pbr-h button{margin-left:auto;font:inherit;color:#c3cbd3;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:6px;cursor:pointer;width:26px;height:24px;line-height:1}
.ms-pbr-h button:hover{background:rgba(255,255,255,.14);color:#fff}
.ms-pbr-h button:focus-visible{outline:2px solid #8ec1ea;outline-offset:1px}
.ms-pbr-m{padding:6px 12px;font-size:11px;color:#c3cbd3;background:#222830;border-bottom:1px solid rgba(255,255,255,.07);display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.ms-pbr-s{display:grid;grid-template-columns:20px 1fr;gap:0 9px;padding:9px 12px 11px}
.ms-pbr-s+.ms-pbr-s{border-top:1px solid rgba(255,255,255,.06)}
.ms-pbr-l{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:4px;font:800 10px/1 system-ui,Segoe UI,Arial,sans-serif;color:#1b1f25;margin-top:1px}
.ms-pbr-s h4{margin:0 0 7px;font:700 10px/1.2 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#aab3bd}
.ms-pbr-two{display:grid;grid-template-columns:minmax(0,136px) minmax(0,1fr);gap:10px;align-items:center}
.ms-pbr-two>svg{max-width:100%;height:auto}
.ms-pbr .ms-gv-rose,.ms-pbr .ms-gv-map{flex-wrap:wrap}
.ms-pbr .ms-gv-chip{white-space:normal}
.ms-pbr-ln{display:grid;grid-template-columns:78px 1fr;gap:0 8px;line-height:1.4;font-size:11.5px}
.ms-pbr-ln>span:first-child{color:#9aa3ad;font-size:10.5px}
.ms-pbr-list{margin:4px 0 0;padding:0;list-style:none;font-size:11px;color:#c3cbd3;line-height:1.45}
.ms-pbr-f{padding:7px 12px;font-size:10.5px;color:#8b95a0;border-top:1px solid rgba(255,255,255,.08)}
.ms-pbr-upd{color:#ffc861}
`;

function h(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function line(k: string, v: string): HTMLElement {
  const r = h('div', 'ms-pbr-ln');
  r.append(h('span', undefined, k), h('span', undefined, v));
  return r;
}

export class PlacementBrief {
  private _el: HTMLDivElement | null = null;
  private _body: HTMLDivElement | null = null;
  private _meta: HTMLDivElement | null = null;

  constructor(private readonly _onClose: () => void) {}

  get isShown(): boolean {
    return !!this._el && this._el.style.display !== 'none';
  }

  show(v: PlacementVerdict): void {
    const root = this._ensure();
    const g = v.going;
    const meta = this._meta!;
    meta.replaceChildren();
    if (g) meta.append(seasonIcon(g.season, 12));
    meta.append(
      [v.profileLabel, g ? (g.season === 'dry' ? 'Dry Season' : 'After Rain') : null, g?.month ? monthName(g.month) : null]
        .filter(Boolean)
        .join(' · '),
    );
    if (g?.pending) meta.append(h('span', 'ms-pbr-upd', ' · updating'));
    const out: HTMLElement[] = [];
    for (const letter of LETTERS) {
      for (const s of sections.filter((x) => x.letter === letter).sort((a, b) => a.order - b.order)) {
        let body: HTMLElement | null = null;
        try {
          body = s.render(v);
        } catch {
          body = null; // one broken section never empties the brief
        }
        if (!body) continue;
        const sec = h('div', 'ms-pbr-s');
        const badge = h('span', 'ms-pbr-l', letter);
        badge.style.background = LETTER_COLOR[letter];
        if (letter === 'O' || letter === 'C') badge.style.color = '#fff';
        const col = h('div');
        col.append(h('h4', undefined, s.title), body);
        sec.append(badge, col);
        out.push(sec);
      }
    }
    if (!out.length) out.push(h('div', 'ms-pbr-s', 'No ground data here yet.'));
    this._body!.replaceChildren(...out);
    root.style.display = 'block';
  }

  /** Plain text of every section, for orders. */
  text(v: PlacementVerdict): string {
    const lines: string[] = [`GROUND BRIEF · ${v.profileLabel}`];
    for (const letter of LETTERS) {
      for (const s of sections.filter((x) => x.letter === letter).sort((a, b) => a.order - b.order)) {
        const t = s.text?.(v) ?? [];
        if (t.length) lines.push(`${letter} ${s.title}`, ...t.map((x) => `  ${x}`));
      }
    }
    return lines.join('\n');
  }

  hide(): void {
    if (this._el) this._el.style.display = 'none';
  }

  destroy(): void {
    this._el?.remove();
    this._el = this._body = this._meta = null;
  }

  private _ensure(): HTMLDivElement {
    if (this._el) return this._el;
    ensureGoingCss();
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    const root = h('div', 'ms-pbr') as HTMLDivElement;
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Ground Brief');
    const head = h('div', 'ms-pbr-h');
    const close = h('button', undefined, '×') as HTMLButtonElement;
    close.type = 'button';
    close.title = 'Close (G or Esc)';
    close.setAttribute('aria-label', 'Close the Ground Brief');
    close.addEventListener('click', () => this._onClose());
    head.append(h('b', undefined, 'Ground Brief'), close);
    const meta = h('div', 'ms-pbr-m') as HTMLDivElement;
    const body = h('div') as HTMLDivElement;
    const foot = h('div', 'ms-pbr-f', 'Soil: SoilGrids 2.0 (250 m, modelled) or NCGDB 1:50k soil areas · Going: rules.json profiles + soilStrength (starting proposal) · Season: WorldClim 1970-2000 normals');
    root.append(head, meta, body, foot);
    document.body.appendChild(root);
    this._el = root;
    this._body = body;
    this._meta = meta;
    return root;
  }
}

function monthName(m: number): string {
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] ?? '';
}

// ── this module's own sections ─────────────────────────────────────────────

registerBriefSection({
  id: 'soil',
  letter: 'G',
  order: 10,
  title: 'Soil',
  render(v) {
    const g = v.going;
    const soil = g?.soil;
    if (!g || !soil) return null;
    const box = h('div');
    const two = h('div', 'ms-pbr-two');
    const right = h('div');
    right.append(h('div', 'ms-gv-b', soil.label));
    const chip = sourceChip(g);
    if (chip) {
      const cl = h('div', 'ms-gv-line');
      cl.style.marginTop = '3px';
      cl.append(chip);
      right.append(cl);
    }
    if (soil.ciDry !== null) right.append(line('Dry', soil.ciDry >= 127 ? 'Cone index 127+' : `Cone index ${soil.ciDry}`));
    if (soil.ciWet !== null) right.append(line('After rain', soil.ciWet >= 127 ? 'Cone index 127+' : `Cone index ${soil.ciWet}`));
    if (soil.note) right.append(h('div', 'ms-gv-soft', soil.note));
    two.append(soil.texture <= 12 ? textureTriangle(soil.texture, 132) : h('div', 'ms-gv-soft', 'Map class: not on the texture triangle'), right);
    box.append(two);
    const gauge = soilGauge(g);
    if (gauge) box.append(gauge);
    return box;
  },
  text(v) {
    const s = v.going?.soil;
    if (!s) return [];
    return [
      `${s.label} (${s.mapped ? '1:50k map' : `modelled, ${s.confidenceLabel || 'confidence unknown'}`})`,
      `Cone index dry ${s.ciDry ?? '-'}, after rain ${s.ciWet ?? '-'}${s.note ? `. ${s.note}` : ''}`,
    ];
  },
});

registerBriefSection({
  id: 'going',
  letter: 'T',
  order: 10,
  title: 'Cross-Country Going',
  render(v) {
    const g = v.going;
    if (!g?.point) return null;
    const box = h('div');
    for (const season of ['dry', 'wet'] as const) {
      const r = h('div', 'ms-gv-row');
      const k = h('span', 'ms-gv-k');
      k.append(seasonIcon(season), season === 'dry' ? 'Dry' : 'After Rain');
      r.append(k, goingScale(season === 'dry' ? g.point.dry : g.point.wet));
      box.append(r);
    }
    const { limitDry: d, limitWet: w } = g.point;
    if (d || w) box.append(h('div', 'ms-gv-limit', d && w && d !== w ? `Limited by ${d}; after rain by ${w}` : `Limited by ${d ?? w}`));
    if (g.modes.length) {
      const mg = modeGrid(g);
      mg.style.marginTop = '9px';
      box.append(mg);
    }
    return box;
  },
  text(v) {
    const g = v.going;
    if (!g?.point) return [];
    return [
      `${v.profileLabel}: ${g.point.dry.toUpperCase()} dry, ${g.point.wet.toUpperCase()} after rain`.replace(/SLOW/g, 'SLOW-GO').replace(/NOGO/g, 'NO-GO'),
      ...g.modes.map((m) => `${m.label}: ${m.dry} / ${m.wet}`),
    ];
  },
});

registerBriefSection({
  id: 'movement',
  letter: 'T',
  order: 20,
  title: 'Movement Freedom',
  render(v) {
    const g = v.going;
    const m = g?.movement;
    if (!g || !m) return null;
    const box = h('div', 'ms-gv-rose');
    const txt = h('div');
    const rate = h('div', 'ms-gv-rate', RATING_LABEL[m.rating]);
    rate.style.color = RATING_COLOR[m.rating];
    rate.style.fontSize = '16px';
    txt.append(rate, h('div', 'ms-gv-blk', `${m.open} of 8 directions open to ${fmtDistance(m.rangeM / 2)}`));
    const ul = h('ul', 'ms-pbr-list');
    for (const x of m.sectors) {
      if (x.blockedBy && x.reachM < m.rangeM) ul.append(h('li', undefined, `${x.compass}: ${x.blockedBy}, ${fmtDistance(x.reachM)}`));
      else if (x.step === 'nogo') ul.append(h('li', undefined, `${x.compass}: NO-GO ground`));
    }
    if (!ul.childElementCount) ul.append(h('li', undefined, `Nothing blocks the way within ${fmtDistance(m.rangeM)}`));
    txt.append(ul);
    box.append(roseSvg(g, 136, true, 0), txt);
    const wrap = h('div');
    wrap.append(box);
    const cv = goingCanvas(g, 136, 0, true);
    if (cv) {
      const mrow = h('div', 'ms-gv-map');
      mrow.style.marginTop = '10px';
      mrow.append(cv, h('div', 'ms-gv-soft', `Going all round the point to ${fmtDistance(m.rangeM)} (north up). Green GO, orange SLOW-GO, red NO-GO.`));
      wrap.append(mrow);
    }
    return wrap;
  },
  text(v) {
    const m = v.going?.movement;
    if (!m) return [];
    return [
      `${RATING_LABEL[m.rating]}: ${m.open} of 8 directions open to ${fmtDistance(m.rangeM / 2)}`,
      ...m.sectors.filter((x) => x.blockedBy && x.reachM < m.rangeM).map((x) => `${x.compass}: ${x.blockedBy}, ${fmtDistance(x.reachM)}`),
    ];
  },
});

registerBriefSection({
  id: 'season',
  letter: 'T',
  order: 30,
  title: 'Going by Month',
  render(v) {
    const g = v.going;
    return g ? ribbon(g, 54) : null;
  },
});
