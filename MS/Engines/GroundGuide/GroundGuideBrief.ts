/**
 * GroundGuideBrief.ts
 *
 * The registry of Ground Detail sections, and the G Soil and T going / movement / season pieces of the detail.
 * The panel itself is GroundGuideDetail.ts (D while drawing): a wide card with a tab a GROTBC letter, which took
 * the place of the vertical Ground Brief on 2026-11-06. Modules register their sections with
 * `registerBriefSection()` as a side effect of being imported (B population, C cover, the G R O B W sections,
 * T road and speed); the Detail card reads them by letter where it has no picture of its own, and `briefText()`
 * gives the plain-text version of every section for orders (Copy as Text).
 *
 * DOM nodes and textContent only.
 */

import { fmtDistance } from './GroundGuideEvaluator';
import { compassNode } from './GroundGuideNorth';
import { RATING_COLOR, RATING_LABEL } from './GroundGuideGoing';
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
} from './GroundGuideGoingView';
import type { GroundGuideGoingInfo, GroundGuideVerdict } from './GroundGuideTypes';

export type GrotbcLetter = 'G' | 'R' | 'O' | 'T' | 'B' | 'C';

export interface BriefSection {
  id: string;
  letter: GrotbcLetter;
  /** Order within the letter (lower first). */
  order: number;
  title: string;
  /** The section body, or null to leave the section out for this verdict. */
  render(v: GroundGuideVerdict): HTMLElement | null;
  /** Plain-text lines for orders (Copy as Text). */
  text?(v: GroundGuideVerdict): string[];
}

export const LETTERS: readonly GrotbcLetter[] = ['G', 'R', 'O', 'T', 'B', 'C'];
/** One accent a heading (doc 16 §4.1). */
export const LETTER_COLOR: Record<GrotbcLetter, string> = { G: '#8fb35a', R: '#c9a46b', O: '#7a5cc9', T: '#5aa9e6', B: '#9a8f86', C: '#1f8a5a' };
const sections: BriefSection[] = [];

/** Add (or replace, by id) a section of the Ground Detail. */
export function registerBriefSection(s: BriefSection): void {
  const i = sections.findIndex((x) => x.id === s.id);
  if (i >= 0) sections[i] = s;
  else sections.push(s);
}

/** The registered sections of a letter, in order. */
export function briefSectionsFor(letter: GrotbcLetter): BriefSection[] {
  return sections.filter((x) => x.letter === letter).sort((a, b) => a.order - b.order);
}

/** Plain text of every section, GROTBC order, for orders. */
export function briefText(v: GroundGuideVerdict): string {
  const lines: string[] = [`GROUND DETAIL · ${v.profileLabel}`];
  for (const letter of LETTERS) {
    for (const s of briefSectionsFor(letter)) {
      let t: string[] = [];
      try {
        t = s.text?.(v) ?? [];
      } catch {
        t = [];
      }
      if (t.length) lines.push(`${letter} ${s.title}`, ...t.map((x) => `  ${x}`));
    }
  }
  return lines.join('\n');
}

const STYLE_ID = 'ms-ground-guide-brief-style';
const CSS = `
.ms-ggbr-two{display:grid;grid-template-columns:minmax(0,136px) minmax(0,1fr);gap:10px;align-items:center}
.ms-ggbr-two>svg{max-width:100%;height:auto}
.ms-ggbr-ln{display:grid;grid-template-columns:78px 1fr;gap:0 8px;line-height:1.4;font-size:11.5px}
.ms-ggbr-ln>span:first-child{color:#9aa3ad;font-size:10.5px}
.ms-ggbr-list{margin:4px 0 0;padding:0;list-style:none;font-size:11px;color:#c3cbd3;line-height:1.45}
.ms-ggbr-upd{color:#ffc861}
`;

/** Put the shared section CSS on the page once (the Detail card and the modules' sections use it). */
export function ensureBriefCss(): void {
  ensureGoingCss();
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function h(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A label / value line as the detail draws it. */
export function briefLine(k: string, v: string): HTMLElement {
  const r = h('div', 'ms-ggbr-ln');
  r.append(h('span', undefined, k), h('span', undefined, v));
  return r;
}

export function monthName(m: number): string {
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] ?? '';
}

// ── pieces the Detail card and this module's sections share ────────────────

/** G Soil: the texture triangle beside the label, source, cone index and note; then the strength gauge. */
export function soilDetail(g: GroundGuideGoingInfo, triangle = 132): HTMLElement[] {
  const soil = g.soil;
  if (!soil) return [];
  ensureBriefCss();
  const two = h('div', 'ms-ggbr-two');
  const right = h('div');
  right.append(h('div', 'ms-gv-b', soil.label));
  const chip = sourceChip(g);
  if (chip) {
    const cl = h('div', 'ms-gv-line');
    cl.style.marginTop = '3px';
    cl.append(chip);
    right.append(cl);
  }
  if (soil.ciDry !== null) right.append(briefLine('Dry', soil.ciDry >= 127 ? 'Cone index 127+' : `Cone index ${soil.ciDry}`));
  if (soil.ciWet !== null) right.append(briefLine('After rain', soil.ciWet >= 127 ? 'Cone index 127+' : `Cone index ${soil.ciWet}`));
  if (soil.note) right.append(h('div', 'ms-gv-soft', soil.note));
  if (triangle !== 132) two.style.gridTemplateColumns = `minmax(0,${triangle + 4}px) minmax(0,1fr)`;
  two.append(soil.texture <= 12 ? textureTriangle(soil.texture, triangle) : h('div', 'ms-gv-soft', 'Map class: not on the texture triangle'), right);
  const out = [two];
  const gauge = soilGauge(g);
  if (gauge) out.push(gauge);
  return out;
}

/** T Cross-Country Going: the dry and after-rain scales, what limits each, and (optionally) the mode grid. */
export function crossCountryDetail(g: GroundGuideGoingInfo, withModes = true): HTMLElement[] {
  const p = g.point;
  if (!p) return [];
  ensureBriefCss();
  const out: HTMLElement[] = [];
  for (const season of ['dry', 'wet'] as const) {
    const r = h('div', 'ms-gv-row');
    const k = h('span', 'ms-gv-k');
    k.append(seasonIcon(season), season === 'dry' ? 'Dry' : 'After Rain');
    r.append(k, goingScale(season === 'dry' ? p.dry : p.wet));
    out.push(r);
  }
  const { limitDry: d, limitWet: w } = p;
  if (d || w) out.push(h('div', 'ms-gv-limit', d && w && d !== w ? `Limited by ${d}; after rain by ${w}` : `Limited by ${d ?? w}`));
  if (withModes && g.modes.length) {
    const mg = modeGrid(g);
    mg.style.marginTop = '9px';
    out.push(mg);
  }
  return out;
}

/** T Movement Freedom: the rose beside the rating, how many directions are open and what blocks the rest. */
export function movementDetail(g: GroundGuideGoingInfo, size = 136): HTMLElement | null {
  const m = g.movement;
  if (!m) return null;
  ensureBriefCss();
  const box = h('div', 'ms-gv-rose');
  const txt = h('div');
  const rate = h('div', 'ms-gv-rate', RATING_LABEL[m.rating]);
  rate.style.color = RATING_COLOR[m.rating];
  rate.style.fontSize = '16px';
  txt.append(rate, h('div', 'ms-gv-blk', `${m.open} of 8 directions open to ${fmtDistance(m.rangeM / 2)}`));
  const ul = h('ul', 'ms-ggbr-list');
  for (const x of m.sectors) {
    // Each blocked direction with its arrow, which turns with the map.
    const li = h('li');
    if (x.blockedBy && x.reachM < m.rangeM) li.append(compassNode(x.compass, x.bearingDeg), `: ${x.blockedBy}, ${fmtDistance(x.reachM)}`);
    else if (x.step === 'nogo') li.append(compassNode(x.compass, x.bearingDeg), ': NO-GO ground');
    if (li.childNodes.length) ul.append(li);
  }
  if (!ul.childElementCount) ul.append(h('li', undefined, `Nothing blocks the way within ${fmtDistance(m.rangeM)}`));
  txt.append(ul);
  box.append(roseSvg(g, size, true, 0), txt);
  return box;
}

// ── this module's own sections ─────────────────────────────────────────────

registerBriefSection({
  id: 'soil',
  letter: 'G',
  order: 10,
  title: 'Soil',
  render(v) {
    const g = v.going;
    if (!g?.soil) return null;
    const box = h('div');
    box.append(...soilDetail(g));
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
    box.append(...crossCountryDetail(g));
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
    const box = g ? movementDetail(g) : null;
    if (!g || !box) return null;
    const wrap = h('div');
    wrap.append(box);
    const cv = goingCanvas(g, 136, 0, true);
    if (cv && g.movement) {
      const mrow = h('div', 'ms-gv-map');
      mrow.style.marginTop = '10px';
      mrow.append(cv, h('div', 'ms-gv-soft', `Going all round the point to ${fmtDistance(g.movement.rangeM)} (north up). Green GO, orange SLOW-GO, red NO-GO.`));
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
