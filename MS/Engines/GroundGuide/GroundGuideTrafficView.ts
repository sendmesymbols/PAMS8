/**
 * GroundGuideTrafficView.ts
 *
 * The T (Trafficability) pieces the card shows on top of the going sections (`v.going`, GroundGuideGoing.ts):
 *   pill   a header pill when rain makes the going worse ("Rain: NO-GO"), or the season is wet;
 *   dual   a second going scale under Why, for the other season;
 *   road   a Road band (or Landing, for a helicopter) after Why: the nearest road the mode can use.
 * Built from DOM nodes and `textContent` only, in the card's own classes plus a few of its own (injected once).
 */

import { registerBriefSection } from './GroundGuideBrief';
import { band, ensureGoingCss, goingScale } from './GroundGuideGoingView';
import type { GoingStep, GroundGuideVerdict } from './GroundGuideTypes';

const STYLE_ID = 'ms-ground-guide-traffic-style';
const WORD: Record<GoingStep, string> = { go: 'GO', slow: 'SLOW-GO', nogo: 'NO-GO' };
const ORDER: Record<GoingStep, number> = { go: 0, slow: 1, nogo: 2 };

const CSS = `
.ms-ggb-tdual{display:grid;grid-template-columns:62px minmax(0,1fr);gap:4px;align-items:center;margin-top:4px}
.ms-ggb-tdual>.ms-gv-scale{margin-top:0}
.ms-ggb-tdual>span{color:#9aa3ad;font-size:10.5px}
.ms-ggb-tpill{display:flex;align-items:center;gap:5px;padding:1px 8px;border-radius:999px;background:rgba(0,0,0,.2);font-size:11.5px;white-space:nowrap}
`;

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** The Why section the card built (its caption reads "Why"), when there is one. */
function whyOf(rows: HTMLElement[]): HTMLElement | null {
  const r = rows[0];
  return r && r.querySelector(':scope > .ms-ggb-cap')?.textContent === 'Why' ? r : null;
}

/**
 * Add T to a card being built: `rows` are its sections in order (Why first); `pills` the header's pill box, put on
 * `bar` when T adds the first pill; the road band goes in at `roadAt` (default: right after Why). Does nothing when
 * the verdict carries no T.
 */
export function decorateTraffic(v: GroundGuideVerdict, bar: HTMLElement, pills: HTMLElement, rows: HTMLElement[], roadAt?: number): void {
  const t = v.traffic;
  if (!t || v.verdict === 'unknown') return;
  ensureStyle();
  const pt = v.going?.point;
  const wet = v.going?.season === 'wet';
  const why = whyOf(rows);
  if (t.pill && pt && (wet || ORDER[pt.wet] > ORDER[pt.dry])) {
    pills.appendChild(el('span', 'ms-ggb-tpill', wet ? `After Rain: ${WORD[pt.wet]}` : `Rain: ${WORD[pt.wet]}`));
    if (!pills.parentElement) bar.appendChild(pills);
  }
  if (t.dual && pt && why) {
    ensureGoingCss();
    const other = el('div', 'ms-ggb-tdual');
    other.append(el('span', undefined, wet ? 'Dry' : 'After Rain'), goingScale(wet ? pt.dry : pt.wet));
    why.appendChild(other);
  }
  if (t.road) {
    ensureGoingCss();
    const s = band('T', `${t.road.caption} · ${v.going?.season === 'wet' ? 'After Rain' : 'Dry'}`, el('div', undefined, t.road.text));
    rows.splice(roadAt ?? (why ? 1 : 0), 0, s);
  }
}

// The Ground Brief (G) lists the road line under T, after the going.
registerBriefSection({
  id: 'traffic-road',
  letter: 'T',
  order: 15,
  title: 'Road for the Mode',
  render: (v) => (v.traffic?.road ? el('div', undefined, `${v.traffic.road.caption}: ${v.traffic.road.text}`) : null),
  text: (v) => (v.traffic?.road ? [`${v.traffic.road.caption}: ${v.traffic.road.text}`] : []),
});
