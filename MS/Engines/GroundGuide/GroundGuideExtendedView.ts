/**
 * GroundGuideExtendedView.ts
 *
 * The Ground Guide's Extended View (user, 2026-11-12: F opens it; it replaces the separate OCOKA lens and that name
 * goes). GROTBC stays the one picture; the Extended View adds to it, and is worked out only while it is on:
 *   - three tabs in the Ground Detail before the Legend: Obsn & Fd of Fire (1), Key Gr (2), Approaches (3);
 *   - a tile on the threat's side in the O tab (the obstacle in front and whether fire covers it) and in the C tab
 *     (concealment in the month's crops);
 *   - a short block on the cursor card, the H chip's figure, the Gr Scope rail's words, the Copy as Text lines.
 * The reading itself is the OCOKA engine's (GroundGuideOcoka / GroundGuideOcokaRead), from the terrain bundle only.
 * DOM nodes and textContent only. Wording follows the Ground Guide's short forms (Gr, Obsn, Obs = obstacle, Posn, Apch)
 * and the rule that sight is a chance: "may be seen", "check on the ground", never "hidden".
 */

import { fmtDistance, titleCase } from './GroundGuideEvaluator';
import { COVER_FIELD_LABEL, COVER_WORD, type CoverField } from './GroundGuideCover';
import type { Fact, LetterAnswer, Tone } from './GroundGuideDetailSummary';
import { itgTraitLines } from './GroundGuideFeatures';
import { apchAnswer, apchFacts, apchScopeRows, apchText, apchTiles, decisionAnswer, decisionFacts, decisionScopeRows, decisionText, decisionTiles, fireFacts, fireScopeRows, fireText, fireTiles } from './GroundGuideIpbApchView';
import { airAnswer, airFacts, airScopeRows, airText, airTiles } from './GroundGuideIpbAirView';
import { templateScopeRows, templateText, templateTiles } from './GroundGuideIpbTemplateView';
import { compassBearing, registerCanvas } from './GroundGuideNorth';
import { bearingDiff, compass8, type WayState } from './GroundGuideOcoka';
import { OCOKA_DOCTRINE } from './GroundGuideOcokaRead';
import { FONT, ROSE_C, ROSE_R, ROSE_RING, SCOPE_MAP, STEP_COLOR, roseFrame, roseHub, roseKey, wedgePath } from './GroundGuideTokens';
import type { GroundGuideOcoka, GroundGuideVerdict, MercXY, OcokaKeyGround } from './GroundGuideTypes';

// ── tabs and keys ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The Extended View's tabs of the Ground Detail, in order (they sit before the Legend), and their keys. */
export type ExtTab = 'XF' | 'XK' | 'XA' | 'XH' | 'XD';
export const EXT_TABS: readonly ExtTab[] = ['XF', 'XK', 'XA', 'XH', 'XD'];
export const EXT_TAB_LABEL: Record<ExtTab, string> = { XF: 'Obsn & Fd of Fire', XK: 'Key Gr', XA: 'Approaches', XH: 'Air', XD: 'Decision' };
/** Tab 4 is Air (the air avenues, LZ / DZ, AD sites; IPB_Plan.md Phase 6), Decision 5. */
export const EXT_TAB_KEY: Record<ExtTab, string> = { XF: '1', XK: '2', XA: '3', XH: '4', XD: '5' };
export function isExtTab(t: string): t is ExtTab {
  return (EXT_TABS as readonly string[]).includes(t);
}
/** What F adds, said where the key is shown (cursor card, Detail, rail, Legend). */
export const EXT_OFFER = 'Obsn & Fd of Fire, Key Gr, Approaches, Air, Decision, the threat';

/** The Gr Scope rail's switches in the Extended View: the three tabs, and the C and O layers the products sit on. */
export type ExtRow = 'XF' | 'XC' | 'XO' | 'XK' | 'XA' | 'XH' | 'XD';

const STYLE_ID = 'ms-ground-guide-ext-style';
const SEEN = '#3ee07a';
const DEAD = '#e5484d';
const SCREENED = '#ee8a1f';
const THREAT = '#ffd23f';
const APCH = '#ff5a60';
const ITG = SCOPE_MAP.itg;
const HILL = SCOPE_MAP.hill;
const CSS = `
.ms-gx-tag{padding:1px 7px;border-radius:9px;background:#8ec1ea;color:#14181d;font:750 12px/1.45 ${FONT};letter-spacing:.3px;white-space:nowrap}
.ms-gx-thr{color:${THREAT}}
.ms-gx-blk{display:grid;grid-template-columns:76px minmax(0,1fr);gap:3px 10px;align-items:baseline;padding:7px 12px 9px;border-top:1px solid rgba(255,255,255,.14)}
.ms-gx-bh{grid-column:1/-1;display:flex;align-items:center;gap:7px;min-width:0;margin-bottom:2px;font:600 12px/1.35 ${FONT};color:#c3cbd3;white-space:nowrap;overflow:hidden}
.ms-gx-wpn{overflow:hidden;text-overflow:ellipsis}
.ms-gx-bc{font:600 12px/1.35 ${FONT};color:#c3cbd3;white-space:nowrap}
.ms-gx-bv{min-width:0;font:650 13.5px/1.35 ${FONT};color:#f1f3f6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-gx-bv .ms-ggb-fd{vertical-align:0}
.ms-gx-soft{font-weight:400;color:#b8c1ca}
.ms-gx-warn{color:#ffd27a}
.ms-gx-bars{display:grid;grid-template-columns:auto minmax(60px,1fr) auto;gap:6px 9px;align-items:center;font-size:12.5px;color:#f1f3f6}
.ms-gx-bars>span:nth-child(3n+1){color:#c3cbd3}
.ms-gx-bar{height:9px;border-radius:5px;background:rgba(255,255,255,.1);overflow:hidden}
.ms-gx-bar>i{display:block;height:100%;background:${SEEN}}
.ms-gx-stack{display:flex;height:12px;border-radius:6px;overflow:hidden;margin:8px 0 5px;background:rgba(255,255,255,.1)}
.ms-gx-stack>i{display:block;height:100%}
.ms-gx-pic{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap}
.ms-gx-pic canvas{border-radius:50%;flex:none}
.ms-gx-list{display:grid;grid-template-columns:auto minmax(0,1fr);gap:5px 12px;font-size:13.5px;line-height:1.35;color:#f1f3f6}
.ms-gx-list>div{padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,.07)}
.ms-gx-list>div:nth-child(odd){color:#c3cbd3;font-size:12.5px;padding-top:1px}
.ms-gx-note{font-size:12px;line-height:1.4;color:#b8c1ca;margin-top:7px}
.ms-gx-kg{display:grid;gap:7px}
.ms-gx-kgi{display:grid;grid-template-columns:30px minmax(0,1fr);column-gap:10px;padding:8px 10px 9px;border-radius:8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09)}
.ms-gx-kgi.ms-lead{background:rgba(184,146,255,.10);border-color:rgba(184,146,255,.55)}
.ms-gx-rk{grid-row:1/span 4;align-self:start;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:800 15px/1 ${FONT};color:${ITG};border:2px solid ${ITG}}
.ms-gx-kgi.ms-lead .ms-gx-rk{background:${ITG};color:#14181d}
.ms-gx-kgn{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font:750 15px/1.3 ${FONT};color:#f1f3f6;min-width:0}
.ms-gx-kgn>b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:750}
.ms-gx-kgn>span{flex:none;font:650 13.5px/1.3 ${FONT};color:#e6eaee;white-space:nowrap}
.ms-gx-kgk{font:400 12.5px/1.35 ${FONT};color:#c3cbd3}
.ms-gx-kgk>b{color:${ITG};font-weight:700}
.ms-gx-chips{display:flex;flex-wrap:wrap;gap:4px 5px;margin-top:4px}
.ms-gx-chip{padding:1px 7px;border-radius:9px;font:650 12px/1.5 ${FONT};background:rgba(255,255,255,.09);color:#e6eaee;white-space:nowrap}
.ms-gx-chip[data-k="itg"]{background:rgba(184,146,255,.2);color:#d9c7ff}
.ms-gx-chip[data-k="apch"]{background:rgba(255,90,96,.2);color:#ffb0b3}
.ms-gx-chip[data-k="choke"]{background:rgba(238,138,31,.2);color:#ffc98a}
.ms-gx-chip[data-k="thr"]{background:rgba(255,210,63,.17);color:#ffe08a}
.ms-gx-chip[data-k="go"]{background:rgba(62,224,122,.17);color:#8ff0b3}
.ms-gx-chip[data-k="may"]{background:rgba(238,138,31,.17);color:#ffc98a}
.ms-gx-chip[data-k="no"]{background:rgba(255,255,255,.06);color:#b8c1ca}
.ms-gx-kgt{font:400 12px/1.4 ${FONT};color:#b8c1ca;margin-top:3px}
.ms-gx-hl{display:grid;grid-template-columns:auto minmax(90px,1fr) auto;gap:6px 10px;align-items:center;font:600 12.5px/1.3 ${FONT};color:#e6eaee}
.ms-gx-hl>span:nth-child(3n+1){color:#c3cbd3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px}
.ms-gx-hl>span:nth-child(3n){text-align:right;white-space:nowrap}
.ms-gx-ht{position:relative;height:10px;border-radius:5px;background:rgba(255,255,255,.07)}
.ms-gx-ht::after{content:"";position:absolute;left:50%;top:-3px;bottom:-3px;width:1.5px;background:#c9d1d9}
.ms-gx-ht>i{position:absolute;top:0;bottom:0;border-radius:5px}
`;
export function ensureExtCss(): void {
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
const pc = (v: number) => `${Math.round(v)}%`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COUNTRY: Record<GroundGuideOcoka['obs']['country'], string> = { open: 'Open', close: 'Close', veryClose: 'Very Close' };
const GRADE: Record<'good' | 'marginal' | 'poor', string> = { good: 'Good', marginal: 'Marginal', poor: 'Poor' };
const GRADE_TONE: Record<'good' | 'marginal' | 'poor', Tone> = { good: 'go', marginal: 'marg', poor: 'nogo' };
/** The cursor card's dots know go / slow / nogo and the four cover levels: Marginal borrows the Fair yellow. */
const cardTone = (t: Tone | null): string => (t === 'marg' ? 'c2' : t === 'warn' ? 'slow' : (t ?? 'none'));
const cut = (n: string, max: number): string => (n.length > max ? `${n.slice(0, max - 1).trimEnd()}…` : n);
const signed = (m: number): string => `${m >= 0 ? '+' : '−'}${Math.round(Math.abs(m))} m`;

function reachText(o: GroundGuideOcoka): string {
  return o.obs.reachMedianM >= o.radiusM - 80 ? `${fmtDistance(o.radiusM)} or more` : fmtDistance(o.obs.reachMedianM);
}
function seenWord(p: number | null): string {
  return p === null ? 'not read' : p >= 0.5 ? 'in view' : p >= 0.2 ? 'may be in view' : 'not in view';
}
function threatText(o: GroundGuideOcoka): string {
  if (o.threat.allRound) return 'Threat All Round';
  const how = o.threat.mode === 'front' ? 'front' : o.threat.mode === 'point' ? 'marker' : 'set';
  return `Threat ${o.threat.compass} ${o.threat.bearingDeg}° (${how}) · ${o.threat.sectorDeg}° arc`;
}
function weaponText(o: GroundGuideOcoka): string {
  const w = o.weapon;
  if (w.channel === 'ind' || w.channel === 'ad') return `${w.label}: ${w.channel === 'ind' ? 'indirect' : 'air defence'}, read for small arms ${fmtDistance(o.obstacle.rangeM)}`;
  return `${w.label} ${fmtDistance(w.effM)}${w.fromSymbol ? '' : ' (default)'}`;
}
function obstacleLine(o: GroundGuideOcoka): { word: string; sub: string; tone: Tone | null } {
  const x = o.obstacle;
  if (x.nogoM === null || !x.nogoLabel) return { word: 'None Toward Threat', sub: x.cautionM !== null && x.cautionLabel ? `SLOW-GO: ${x.cautionLabel} ${fmtDistance(x.cautionM)}` : `No NO-GO Gr on the arc`, tone: null };
  const word = `${x.nogoLabel} ${fmtDistance(x.nogoM)}`;
  if (x.covered) return { word, sub: `In view from here (${pc(x.seenP * 100)}): covered by fire`, tone: 'go' };
  if (x.inRange) return { word, sub: `In range but may not be seen from here (${pc(x.seenP * 100)})`, tone: 'slow' };
  return { word, sub: `Beyond ${fmtDistance(x.rangeM)}: not covered by this weapon`, tone: null };
}
function waysLine(o: GroundGuideOcoka): { word: string; sub: string; tone: Tone | null } {
  const w = o.ways;
  const word = `${w.go} GO · ${w.slow} SLOW-GO · ${w.blocked} Stopped`;
  const s = w.stops[0];
  const sub = s ? `Stopped ${s.arc} by ${s.label}${w.stops.length > 1 ? ` (+${w.stops.length - 1} more)` : ''}` : `Straight ways out to ${fmtDistance(w.radiusM)}, ${w.total} dirs`;
  return { word, sub, tone: w.go + w.slow === 0 ? 'nogo' : w.go * 2 >= w.total ? 'go' : 'slow' };
}
function coverPair(v: GroundGuideVerdict): { f: CoverField; word: string; tone: Tone }[] {
  const c = v.cover;
  if (!c) return [];
  const fields: CoverField[] = c.focus && c.focus !== 'direct' ? ['direct', c.focus] : ['direct', 'ground'];
  return fields.map((f) => ({ f, word: COVER_WORD[c.levels[f]], tone: `c${c.levels[f]}` as Tone }));
}
function fromText(o: GroundGuideOcoka): string {
  return o.plan?.fromAssumed ? `from ${o.threat.compass}` : 'from the Threat marker';
}

/** The first approach in a line: how long, whether the formation fits, where it narrows. Null while not worked out. */
function approachLine(o: GroundGuideOcoka): { word: string; sub: string; tone: Tone | null } | null {
  const p = o.plan;
  if (!p || o.threat.allRound) return null;
  const from = fromText(o);
  if (!p.avenues.length) return p.noAvenue ? { word: `No way in ${from}`, sub: `Stopped by ${p.noAvenue} (for a ${fmtDistance(p.frontageM)} frontage, within the Gr read)`, tone: 'go' } : null;
  const a = p.avenues[0];
  const c = a.chokes[0];
  const word = `Apch ${from}: ${fmtDistance(a.lengthM)}${p.avenues.length > 1 ? `, +${p.avenues.length - 1} more` : ''}`;
  if (a.fits || !c) return { word, sub: `A ${fmtDistance(p.frontageM)} frontage fits all the way (narrowest ${fmtDistance(a.minWidthM)}); ${pc(a.goPct)} GO`, tone: 'warn' };
  return { word, sub: `Narrows to ${fmtDistance(c.widthM)} at ${c.label}, ${fmtDistance(c.fromPosnM)} out (${a.chokes.length} chokepoint${a.chokes.length > 1 ? 's' : ''} for a ${fmtDistance(p.frontageM)} frontage)`, tone: null };
}
/** What the threat's place sees of the position. */
function enemyLine(o: GroundGuideOcoka): { word: string; sub: string; tone: Tone | null } | null {
  const e = o.sight?.enemy;
  if (!e) return null;
  const sub = `${fmtDistance(e.distM)} off; ${pc(e.coveredPct)} of the Gr between is out of its view`;
  if (e.seesP >= 0.5) return { word: `Threat sees this Posn (${pc(e.seesP * 100)})`, sub, tone: 'nogo' };
  if (e.seesP >= 0.2) return { word: `Threat may see this Posn (${pc(e.seesP * 100)})`, sub, tone: 'slow' };
  // Never a flat "does not see": the elevation is 30 m and the blockers are a chance. Check on the ground.
  return { word: 'Threat unlikely to see this Posn', sub: e.blockAtM !== null ? `Its line is lost ${fmtDistance(e.blockAtM)} from it; ${pc(e.coveredPct)} of the Gr between is out of its view` : sub, tone: 'go' };
}

// ── Key Gr: ranked ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Ground within this distance of an approach, metres, commands it: a proposal (direct fire on the approach from the
 * ground), not a doctrine figure. The same for a chokepoint.
 */
const COMMAND_M = 1000;

export interface KeyGrPick {
  c: OcokaKeyGround;
  /** 1 = the lead candidate. */
  rank: number;
  score: number;
  /** Why it stands where it does, most telling first; `k` colours the chip. */
  why: Array<{ text: string; k: 'itg' | 'apch' | 'choke' | 'thr' | 'go' | 'may' | 'no' | '' }>;
  /** The approach it commands (1-based) and how far off the line it is, metres. */
  apch: { n: number; offM: number } | null;
  /** The chokepoint it covers, when one is within COMMAND_M. */
  choke: { label: string; offM: number } | null;
  towardThreat: boolean;
}

/** Ground metres from a point to a line, both Web Mercator (`k` = cos latitude). */
function offLine(p: MercXY, path: MercXY[], k: number): number {
  if (!path.length) return Infinity;
  let best = Math.hypot(p[0] - path[0][0], p[1] - path[0][1]);
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1];
    const dx = path[i][0] - ax;
    const dy = path[i][1] - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy)));
  }
  return best * k;
}

/**
 * The ITG candidates ranked for this position, threat and approaches: strong candidates, ground higher than the
 * Posn, ground that commands an approach or covers its narrows, ground toward the threat, ground in view of the
 * Posn and ground nearer to it rank higher; the bundle's own measures (dominance, view, MSR in view) add a little.
 * The weights are a proposal. The map only proposes: the commander designates ITG / MITG.
 */
export function rankKeyGround(o: GroundGuideOcoka): KeyGrPick[] {
  const k = Math.cos((o.lngLat[1] * Math.PI) / 180);
  const avs = o.plan?.avenues ?? [];
  const half = o.threat.sectorDeg / 2;
  const picks = o.key.candidates.map((c): KeyGrPick => {
    const why: KeyGrPick['why'] = [];
    let score = c.level === 2 ? 3 : 1;
    if (c.level === 2) why.push({ text: 'Strong · check as MITG', k: 'itg' });
    const h = c.higherM;
    if (h !== null && h >= 5) {
      score += Math.min(3, h / 15);
      why.push({ text: `${Math.round(h)} m above the Posn`, k: '' });
    } else if (h !== null && h <= -15) score -= 1;
    let apch: KeyGrPick['apch'] = null;
    let choke: KeyGrPick['choke'] = null;
    for (let i = 0; i < Math.min(2, avs.length); i++) {
      const off = offLine(c.at, avs[i].path, k);
      if (off <= COMMAND_M && (!apch || off < apch.offM)) apch = { n: i + 1, offM: off };
      for (const ch of avs[i].chokes) {
        const d = Math.hypot(c.at[0] - ch.at[0], c.at[1] - ch.at[1]) * k;
        if (d <= COMMAND_M && (!choke || d < choke.offM)) choke = { label: ch.label, offM: d };
      }
    }
    if (apch) {
      score += apch.n === 1 ? 2.5 : 1.5;
      why.push({ text: apch.offM < 150 ? `On Apch ${apch.n}` : `${h !== null && h >= 5 ? 'Overlooks' : 'Beside'} Apch ${apch.n} · ${fmtDistance(apch.offM)}`, k: 'apch' });
    }
    if (choke) {
      score += 1;
      why.push({ text: `Covers the narrows · ${cut(choke.label, 22)}`, k: 'choke' });
    }
    const towardThreat = !o.threat.allRound && bearingDiff(c.bearingDeg, o.threat.bearingDeg) <= half;
    if (towardThreat) {
      score += 1;
      why.push({ text: 'Toward the threat', k: 'thr' });
    }
    if (c.seenP !== null) {
      if (c.seenP >= 0.5) score += 0.5;
      why.push({ text: c.seenP >= 0.5 ? 'In view of the Posn' : c.seenP >= 0.2 ? 'May be in view' : 'Not in view', k: c.seenP >= 0.5 ? 'go' : c.seenP >= 0.2 ? 'may' : 'no' });
    }
    score += Math.max(0, 1 - c.distanceM / Math.max(1, o.radiusM));
    const t = c.itg?.traits;
    if (t?.dominanceKm != null && t.dominanceKm >= 2) score += 0.5;
    if (t?.msrInViewKm != null) score += 0.5;
    return { c, rank: 0, score, why, apch, choke, towardThreat };
  });
  picks.sort((a, b) => b.score - a.score || a.c.distanceM - b.c.distanceM);
  picks.forEach((p, i) => (p.rank = i + 1));
  return picks;
}

const keyName = (c: OcokaKeyGround): string => (c.name ? titleCase(c.name) : titleCase(c.kindLabel));

/** Re-render key: changes when anything the cards show of the reading changes. */
export function extKey(o: GroundGuideOcoka | null | undefined): string {
  if (!o) return '';
  const f = o.fire;
  return [
    o.pending ? 1 : 0, o.threat.mode, o.threat.bearingDeg, o.threat.sectorDeg, o.weapon.label, o.weapon.effM, o.eyeM, o.month, o.light.level, o.surface ? 1 : 0,
    Math.round(o.obs.reachMedianM / 10), Math.round(o.obs.seenPct), o.obs.country, o.obs.overlook ? Math.round(o.obs.overlook.riseM / 5) : '',
    f ? `${f.grade}${Math.round(f.clearMedianM / 10)}${Math.round(f.seenPct)}${Math.round(f.deadPct)}` : '',
    o.obstacle.nogoM === null ? '' : `${o.obstacle.nogoClass}${Math.round(o.obstacle.nogoM / 10)}${o.obstacle.covered ? 'c' : ''}`,
    o.ways.go, o.ways.slow, o.ways.stops[0]?.arc ?? '', Math.round(o.key.aboveMaxM),
    o.key.candidates.map((c) => `${Math.round(c.distanceM / 50)}${c.seenP === null ? '' : c.seenP >= 0.5 ? 's' : 'n'}`).join(','),
    o.picture ? `${Math.round(o.at[0] / 20)},${Math.round(o.at[1] / 20)}` : '',
    o.sight?.enemy ? `e${Math.round(o.sight.enemy.seesP * 10)}${Math.round(o.sight.enemy.coveredPct / 5)}` : '',
    o.plan ? `p${o.plan.avenues.map((a) => `${Math.round(a.lengthM / 50)}${a.fits ? 'f' : a.chokes.length}`).join('.')}${o.plan.noAvenue ?? ''}${o.plan.better ? `b${Math.round(o.plan.better.distanceM)}${o.plan.better.compass}` : ''}` : '',
  ].join('|');
}

/**
 * The hint chip (H) with the Extended View on: beside the GO / NO-GO word, the fields of fire for the weapon (the
 * country when it needs an observer), a word when the threat probably sees the spot, and the better position to point at.
 */
export function extChip(v: GroundGuideVerdict): { figure: string; better: { distanceM: number; bearingDeg: number; compass: string } | null } | null {
  const o = v.ext;
  if (!o) return null;
  const f = o.fire;
  const sees = (o.sight?.enemy?.seesP ?? 0) >= 0.5;
  const b = o.plan?.better ?? null;
  return {
    figure: `${f ? `Fd of Fire ${GRADE[f.grade]}` : `${COUNTRY[o.obs.country]} Country`}${sees ? ' · Threat sees' : ''}`,
    better: b ? { distanceM: b.distanceM, bearingDeg: b.bearingDeg, compass: b.compass } : null,
  };
}

// ── cursor card ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The cursor card's Extended View block (under the GROTBC rows, which stay as they are): one tight section, so the
 * card stays short (user, 2026-11-07: "minimal"). A head line with the threat and the weapon, then one line a tab:
 * the fields of fire (and whether the threat sees the Posn), the lead Key Gr, the first approach. The rest is in the
 * Detail's tabs 1 2 3; the better position is on the card's foot with its key (J).
 */
export function extCardRows(v: GroundGuideVerdict): HTMLElement[] {
  ensureExtCss();
  const o = v.ext;
  const box = el('div', 'ms-gx-blk');
  const head = el('div', 'ms-gx-bh');
  head.append(el('span', 'ms-gx-tag', 'Ext View'));
  box.append(head);
  if (v.extRest) {
    // A line or an area: nothing is read, and one line says so (it comes back with the next point symbol).
    head.append(el('span', 'ms-gx-wpn', `${v.extRest} · back with a point symbol`));
    return [box];
  }
  if (!o) {
    head.append(el('span', undefined, 'Reading the elevation here…'));
    return [box];
  }
  head.append(el('span', 'ms-gx-thr', o.threat.allRound ? 'Threat all round' : `Threat ${o.threat.compass} ${o.threat.bearingDeg}°`), el('span', 'ms-gx-wpn', weaponText(o)));
  // Whose options the IPB reading shows (X turns it over).
  if (o.ipbApch) head.append(el('span', 'ms-gx-thr', o.ipbApch.side === 'enemy' ? "· En's options" : '· Your options'));
  if (o.pending) head.append(el('span', 'ms-gx-wpn', '· loading'));
  const line = (cap: string, tone: Tone | null, ...parts: Array<string | HTMLElement>): void => {
    const val = el('div', 'ms-gx-bv');
    const dot = el('span', 'ms-ggb-fd');
    dot.dataset.tone = cardTone(tone);
    val.append(dot, ...parts);
    box.append(el('div', 'ms-gx-bc', cap), val);
  };
  const f = o.fire;
  const en = enemyLine(o);
  const sees = en && en.tone !== 'go' ? el('span', 'ms-gx-warn', ` · ${en.tone === 'nogo' ? 'Threat sees' : 'Threat may see'}`) : '';
  if (f) line('Fd of Fire', GRADE_TONE[f.grade], `${GRADE[f.grade]} · clear ${fmtDistance(f.clearMedianM)}`, sees);
  else line('Obsn', null, `${COUNTRY[o.obs.country]} · view ${reachText(o)}`, sees);
  const lead = rankKeyGround(o)[0];
  if (lead) line('Key Gr', null, `${cut(keyName(lead.c), 20)} ${fmtDistance(lead.c.distanceM)} ${lead.c.compass}`); // why it leads: the Detail's tab 2
  else line('Key Gr', o.key.highest ? 'go' : null, o.key.highest ? 'This Posn is the highest Gr' : o.key.candidatesPending ? 'Loading candidates…' : `No candidate in ${fmtDistance(o.radiusM)}`);
  if (!o.threat.allRound) {
    const p = o.plan;
    const a = p?.avenues[0];
    const ch = a?.chokes[0];
    if (!p) line('Apch', null, el('span', 'ms-gx-soft', 'Working out…'));
    else if (!a) line('Apch', 'go', p.noAvenue ? `No way in · ${cut(p.noAvenue, 22)}` : 'None found');
    else line('Apch', a.fits || !ch ? 'warn' : null, `${p.fromAssumed ? `From ${o.threat.compass}` : 'From marker'} ${fmtDistance(a.lengthM)}`, el('span', 'ms-gx-soft', a.fits || !ch ? ' · frontage fits' : ` · narrows ${fmtDistance(ch.widthM)}`));
  }
  return [box];
}

// ── Detail: tab answers and facts ────────────────────────────────────────────────────────────────────────────────────

export function extAnswer(tab: ExtTab, v: GroundGuideVerdict | null): LetterAnswer | null {
  const o = v?.ext;
  if (!v || !o) return null;
  switch (tab) {
    case 'XF': {
      const f = o.fire;
      if (!f) return { label: `Obsn for ${o.weapon.label}`, parts: [{ text: `${COUNTRY[o.obs.country]} Country` }, { text: `view ${reachText(o)}`, small: true }], sub: 'Indirect / air defence weapon: it needs an observer, not a field of fire of its own.', tone: null, tab: COUNTRY[o.obs.country] };
      return {
        label: `Fd of Fire for ${o.weapon.label}, ${o.threat.allRound ? 'all round' : `toward ${o.threat.compass}`}`,
        parts: [{ text: GRADE[f.grade], tone: GRADE_TONE[f.grade] }, { text: `clear ${fmtDistance(f.clearMedianM)}`, small: true }],
        sub: `${COUNTRY[o.obs.country]} country, view ${reachText(o)}. ${f.limitedBy === 'clear' ? 'Held down by the clear distance.' : f.limitedBy === 'coverage' ? 'Held down by how much of the range is seen.' : ''} Check on the ground.`,
        tone: GRADE_TONE[f.grade],
        tab: GRADE[f.grade],
      };
    }
    case 'XK': {
      const picks = rankKeyGround(o);
      const lead = picks[0];
      const strong = picks.filter((p) => p.c.level === 2).length;
      if (!lead) {
        return {
          label: 'Key Gr round the Posn',
          parts: [{ text: o.key.highest ? 'This Posn is the Highest Gr' : `${Math.round(-o.key.aboveMaxM)} m Below the Highest Gr`, tone: o.key.highest ? 'go' : -o.key.aboveMaxM >= 15 ? 'warn' : null }],
          sub: o.key.candidatesPending ? 'ITG candidates still loading.' : `No ITG candidate within ${fmtDistance(o.radiusM)}.${o.key.highest ? '' : ` Highest Gr ${fmtDistance(o.key.distM)} ${o.key.compass}.`}`,
          tone: o.key.highest ? 'go' : null,
          tab: o.key.highest ? 'Highest Gr' : 'No candidate',
        };
      }
      return {
        label: `Lead Key Gr, 1 of ${picks.length}${strong ? ` (${strong} strong)` : ''}`,
        parts: [{ text: keyName(lead.c) }, { text: `${fmtDistance(lead.c.distanceM)} ${lead.c.compass}`, small: true }],
        sub: `${lead.why.map((w) => w.text).join(' · ') || titleCase(lead.c.kindLabel)}. A candidate: the commander designates.`,
        tone: null,
        tab: `${fmtDistance(lead.c.distanceM)} ${lead.c.compass}`,
      };
    }
    case 'XH':
      return airAnswer(o);
    case 'XD':
      return decisionAnswer(o);
    default: {
      if (o.ipbApch !== undefined) return apchAnswer(o); // the IPB avenues over the area read (extended.ipb.apchs)
      const p = o.plan;
      if (o.threat.allRound || !p) {
        const w = waysLine(o);
        return { label: `Straight ways out for ${v.profileLabel}, to ${fmtDistance(o.ways.radiusM)}`, parts: [{ text: `${o.ways.go} of ${o.ways.total} GO`, tone: w.tone }], sub: o.threat.allRound ? w.sub : `${w.sub}. Approaches a moment after the cursor rests.`, tone: w.tone, tab: `${o.ways.go} of ${o.ways.total} GO` };
      }
      if (!p.avenues.length) return { label: `Approaches ${fromText(o)}`, parts: [{ text: 'No Way In', tone: 'go' }], sub: p.noAvenue ? `Stopped by ${p.noAvenue} for a ${fmtDistance(p.frontageM)} frontage, within the Gr read.` : 'None found within the Gr read.', tone: 'go', tab: 'None' };
      const a = p.avenues[0];
      const ch = a.chokes[0];
      return {
        label: `Approaches ${fromText(o)}, for a ${fmtDistance(p.frontageM)} frontage`,
        parts: [{ text: `${p.avenues.length} Found`, tone: 'warn' }, { text: a.fits || !ch ? `frontage fits, narrowest ${fmtDistance(a.minWidthM)}` : `narrows to ${fmtDistance(ch.widthM)}`, small: true }],
        sub: a.fits || !ch ? `Apch 1: ${fmtDistance(a.lengthM)}, ${pc(a.goPct)} on GO Gr.` : `Apch 1: ${fmtDistance(a.lengthM)}; narrows at ${ch.label}, ${fmtDistance(ch.fromPosnM)} out.`,
        tone: 'warn',
        tab: a.fits || !ch ? `${p.avenues.length} · fits` : `${p.avenues.length} · ${fmtDistance(ch.widthM)}`,
      };
    }
  }
}

export function extFacts(tab: ExtTab, v: GroundGuideVerdict | null): Fact[] {
  const o = v?.ext;
  if (!v || !o) return [];
  const ob = o.obs;
  switch (tab) {
    case 'XF': {
      const f = o.fire;
      const out: Fact[] = [...fireFacts(o)];
      if (f) {
        out.push({ k: `Seen in ${fmtDistance(o.obstacle.rangeM)}`, v: pc(f.seenPct), sub: `${pc(f.deadPct)} dead Gr · ${pc(f.screenedPct)} screened` });
        out.push({ k: 'Primary Task (200 m)', v: f.primaryOk ? 'Met' : 'Not met', tone: f.primaryOk ? 'go' : 'slow', sub: `${pc(f.ge270Pct)} of the arc has 270 m or more` });
      }
      const en = o.sight?.enemy;
      if (en) out.push({ k: 'Threat Sees Posn', v: en.seesP >= 0.5 ? 'Yes' : en.seesP >= 0.2 ? 'May' : 'Unlikely', tone: en.seesP >= 0.5 ? 'nogo' : en.seesP >= 0.2 ? 'slow' : 'go', sub: `chance ${pc(en.seesP * 100)}` });
      out.push({ k: 'View Reaches', v: reachText(o), sub: `${COUNTRY[ob.country]} country` });
      out.push({ k: `May Be Seen, ${fmtDistance(o.radiusM)}`, v: pc(ob.seenPct), sub: `${pc(ob.terrainPct)} on the Gr alone · ${pc(ob.surePct)} sure` });
      out.push({ k: 'Overlooked', v: ob.overlook ? `${Math.round(ob.overlook.riseM)} m higher` : 'No', tone: ob.overlook && ob.overlookArcPct >= 25 ? 'warn' : null, sub: ob.overlook ? `${fmtDistance(ob.overlook.distM)} off · from ${pc(ob.overlookArcPct)} of the dirs` : null });
      const wx = o.weather;
      if (wx && wx.fogPct !== null) out.push({ k: `${MONTHS[o.month - 1]} View`, v: wx.meanViewKm !== null ? `${wx.meanViewKm} km` : '-', sub: `Fog ${pc(wx.fogPct)} of days · 3 km or less ${wx.hazePct !== null ? pc(wx.hazePct) : '-'}` });
      return out;
    }
    case 'XK': {
      const k = o.key;
      const picks = rankKeyGround(o);
      const out: Fact[] = [{ k: 'This Posn', v: k.highest ? 'Highest Gr' : `${Math.round(-k.aboveMaxM)} m below`, tone: k.highest ? 'go' : -k.aboveMaxM >= 15 ? 'warn' : null, sub: k.highest ? `within ${fmtDistance(k.withinM)}` : `highest ${fmtDistance(k.distM)} ${k.compass}` }];
      if (picks.length) {
        const seen = picks.filter((p) => p.c.seenP !== null && p.c.seenP >= 0.5).length;
        out.push({ k: 'Candidates', v: String(picks.length), sub: `${picks.filter((p) => p.c.level === 2).length} strong · ${seen} in view` });
        const onA = picks.find((p) => p.apch);
        if (!o.threat.allRound) out.push({ k: 'Commands Apch', v: onA ? `#${onA.rank}` : o.plan ? 'None' : '…', tone: onA ? 'warn' : null, sub: onA?.apch ? `${cut(keyName(onA.c), 18)}, Apch ${onA.apch.n}` : o.plan ? `none within ${fmtDistance(COMMAND_M)}` : 'approaches being worked out' });
        for (const p of picks.slice(1, 3)) out.push({ k: `#${p.rank}`, v: `${fmtDistance(p.c.distanceM)} ${p.c.compass}`, sub: cut(keyName(p.c), 22) });
      } else out.push({ k: 'Candidates', v: k.candidatesPending ? '…' : 'None', sub: `within ${fmtDistance(o.radiusM)}` });
      return out;
    }
    case 'XH':
      return airFacts(o);
    case 'XD':
      return decisionFacts(o);
    default: {
      const p = o.plan;
      const w = o.ways;
      const out: Fact[] = [];
      if (o.ipbApch !== undefined) {
        out.push(...apchFacts(o));
        if (out.length < 6) out.push({ k: 'Ways Out GO', v: `${w.go} of ${w.total}`, tone: w.go * 2 >= w.total ? 'go' : 'slow', sub: `${w.slow} SLOW-GO · ${w.blocked} stopped` });
        return out;
      }
      if (p && !o.threat.allRound) {
        p.avenues.forEach((a, i) => out.push({ k: `Apch ${i + 1}`, v: fmtDistance(a.lengthM), sub: `${pc(a.goPct)} GO · narrowest ${fmtDistance(a.minWidthM)}`, tone: a.fits ? 'warn' : null }));
        const chokes = p.avenues.reduce((n, a) => n + a.chokes.length, 0);
        if (p.avenues.length) out.push({ k: 'Chokepoints', v: String(chokes), sub: `for a ${fmtDistance(p.frontageM)} frontage` });
      }
      out.push({ k: 'Ways Out GO', v: `${w.go} of ${w.total}`, tone: w.go * 2 >= w.total ? 'go' : 'slow', sub: `${w.slow} SLOW-GO · ${w.blocked} stopped` });
      if (w.stops[0]) out.push({ k: `Stopped ${w.stops[0].arc}`, v: cut(w.stops[0].label, 18), sub: `${w.stops[0].sectors} of ${w.total} dirs` });
      return out;
    }
  }
}

// ── Detail: tiles ────────────────────────────────────────────────────────────────────────────────────────────────────

function tile(caption: string, ...content: Array<Node | string | null | undefined | false>): HTMLElement {
  const sec = el('div', 'ms-ggb-sec');
  sec.append(el('div', 'ms-ggb-cap ms-ggd-cap', caption));
  for (const c of content) if (c) sec.append(c);
  return sec;
}
/** A tile the Extended View adds to a GROTBC tab: its caption carries the "Ext View" tag, so it is clear why it comes and goes with F. */
function extraTile(caption: string, ...content: Array<Node | string | null | undefined | false>): HTMLElement {
  const t = tile(caption, ...content);
  const cap = t.firstElementChild as HTMLElement;
  cap.append(' ', el('span', 'ms-gx-tag', 'F · Ext View'));
  return t;
}
function list(rows: Array<[string, string | null | undefined]>): HTMLElement {
  const g = el('div', 'ms-gx-list');
  for (const [k, val] of rows) if (val) g.append(el('div', undefined, k), el('div', undefined, val));
  return g;
}
const note = (text: string): HTMLElement => el('div', 'ms-gx-note', text);

/** The viewshed as a round picture, north up, turned with the map: green may be seen; toward the threat and inside the range, red is dead Gr and amber screened. */
function viewshed(o: GroundGuideOcoka, px = 172): HTMLCanvasElement | null {
  const pic = o.picture;
  if (!pic) return null;
  const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const N = Math.round(px * dpr);
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  cv.style.width = cv.style.height = `${px}px`;
  cv.setAttribute('role', 'img');
  cv.setAttribute('aria-label', `What may be seen within ${fmtDistance(pic.radiusM)}`);
  const half = o.threat.sectorDeg / 2;
  const effSteps = o.obstacle.rangeM / pic.stepM;
  const paint = (northDeg: number): void => {
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(N, N);
    const c = N / 2;
    const R = c - 2 * dpr;
    const perDeg = pic.rays / 360;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const dx = x + 0.5 - c, dy = y + 0.5 - c;
        const d = Math.hypot(dx, dy);
        const i = (y * N + x) * 4;
        if (d > R) continue;
        const brg = ((Math.atan2(dx, -dy) * 180) / Math.PI - northDeg + 720) % 360;
        const ray = Math.round(brg * perDeg) % pic.rays;
        const s = Math.min(pic.steps - 1, Math.floor((d / R) * pic.steps));
        const p = pic.p[ray * pic.steps + s];
        let r = 32, g = 38, b = 46;
        if (p !== 255) {
          if (p >= 50) {
            const k = p / 250;
            r = Math.round(32 + (62 - 32) * k);
            g = Math.round(38 + (224 - 38) * k);
            b = Math.round(46 + (122 - 46) * k);
          } else if (s <= effSteps && (o.threat.allRound || bearingDiff(brg, o.threat.bearingDeg) <= half)) {
            const terr = pic.pTerrain[ray * pic.steps + s] >= 125;
            [r, g, b] = terr ? [238, 138, 31] : [229, 72, 77];
          }
        } else [r, g, b] = [20, 24, 29];
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    const rr = Math.min(R, (o.obstacle.rangeM / pic.radiusM) * R);
    ctx.lineWidth = 1.2 * dpr;
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.beginPath();
    ctx.arc(c, c, rr, 0, Math.PI * 2);
    ctx.stroke();
    if (!o.threat.allRound) {
      ctx.strokeStyle = THREAT;
      ctx.lineWidth = 1.6 * dpr;
      for (const side of [-half, half]) {
        const t = ((o.threat.bearingDeg + side + northDeg) * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.lineTo(c + Math.sin(t) * R, c - Math.cos(t) * R);
        ctx.stroke();
      }
    }
    const tn = (northDeg * Math.PI) / 180;
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.round(11 * dpr)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', c + Math.sin(tn) * (R - 8 * dpr), c - Math.cos(tn) * (R - 8 * dpr));
    ctx.beginPath();
    ctx.arc(c, c, 3 * dpr, 0, Math.PI * 2);
    ctx.fill();
  };
  registerCanvas(cv, paint);
  paint(0);
  return cv;
}

function fireBars(o: GroundGuideOcoka): HTMLElement | null {
  const f = o.fire;
  if (!f) return null;
  const box = el('div');
  const stack = el('div', 'ms-gx-stack');
  for (const [share, colour] of [[f.seenPct, SEEN], [f.deadPct, DEAD], [f.screenedPct, SCREENED]] as Array<[number, string]>) {
    const i = el('i');
    i.style.width = `${Math.max(0, share)}%`;
    i.style.background = colour;
    stack.append(i);
  }
  stack.title = `Inside ${fmtDistance(o.obstacle.rangeM)}: ${pc(f.seenPct)} seen, ${pc(f.deadPct)} dead ground, ${pc(f.screenedPct)} screened`;
  const bars = el('div', 'ms-gx-bars');
  for (const b of f.bands) {
    if (b.seenPct === null) continue;
    const bar = el('div', 'ms-gx-bar');
    const fill = el('i');
    fill.style.width = `${Math.max(1, b.seenPct)}%`;
    bar.append(fill);
    bars.append(el('span', undefined, b.toM ? `${b.fromM}-${b.toM} m` : `${b.fromM} m +`), bar, el('span', undefined, pc(b.seenPct)));
  }
  box.append(stack, roseKey([[SEEN, `seen ${pc(f.seenPct)}`], [DEAD, `dead Gr ${pc(f.deadPct)}`], [SCREENED, `screened ${pc(f.screenedPct)}`]]), bars);
  return box;
}

const WAY_COLOUR: Record<WayState, string> = { go: STEP_COLOR.go, slow: STEP_COLOR.slow, nogo: STEP_COLOR.nogo };
function waysRose(o: GroundGuideOcoka): SVGElement {
  const w = o.ways;
  const f = roseFrame(`Straight ways out to ${fmtDistance(w.radiusM)}`);
  const width = 360 / w.total;
  w.state.forEach((s, i) => {
    const r1 = 10 + 36 * Math.min(1, w.distM[i] / w.radiusM);
    f.add('path', { d: wedgePath(7, r1, i * width - width / 2 + 1, i * width + width / 2 - 1), fill: WAY_COLOUR[s], 'fill-opacity': s === 'nogo' ? 0.9 : 0.8 });
  });
  if (!o.threat.allRound) {
    const t = (o.threat.bearingDeg * Math.PI) / 180;
    f.add('circle', { cx: (ROSE_C + 49 * Math.sin(t)).toFixed(1), cy: (ROSE_C - 49 * Math.cos(t)).toFixed(1), r: 3.2, fill: THREAT });
  }
  return f.svg;
}

let clipUid = 0;
/** The Key Gr map's reach: just past the farthest candidate (and the highest Gr), on a round figure, 1 km to the read's radius; its ring step. */
function keyGrScale(o: GroundGuideOcoka, picks: KeyGrPick[]): { radiusM: number; stepM: number } {
  const far = Math.max(0, ...picks.map((p) => p.c.distanceM), o.key.highest ? 0 : o.key.distM) * 1.2;
  const radiusM = [1000, 1500, 2000, 3000, 4000, 5000, 7500, 10000].find((r) => r >= far && r <= o.radiusM) ?? o.radiusM;
  return { radiusM, stepM: radiusM <= 2000 ? 500 : radiusM <= 5000 ? 1000 : 2500 };
}

/**
 * The Key Gr map: a round bird's-eye picture of the ground round the Posn out just past the farthest candidate, north
 * up and turned with the map. The Posn in the middle, rings (`keyGrScale`), the threat's arc, the approaches with their
 * chokepoints, the line of sight to each candidate (green in view, amber may be, grey not), the highest Gr (▲) and the
 * candidates numbered by rank, the lead one larger, a strong one ringed.
 */
function keyGrMap(o: GroundGuideOcoka, picks: KeyGrPick[], px = 184): SVGSVGElement {
  const { radiusM, stepM } = keyGrScale(o, picks);
  const f = roseFrame(`Key Gr within ${fmtDistance(radiusM)}: ${picks.length} candidate${picks.length === 1 ? '' : 's'}`, px);
  const k = Math.cos((o.lngLat[1] * Math.PI) / 180);
  const s = ROSE_R / radiusM;
  const P = (q: MercXY): [number, number] => [ROSE_C + (q[0] - o.at[0]) * k * s, ROSE_C - (q[1] - o.at[1]) * k * s];
  const id = `ms-gx-clip-${++clipUid}`;
  const defs = f.add('defs', {}, f.svg);
  const cp = f.add('clipPath', { id }, defs);
  f.add('circle', { cx: ROSE_C, cy: ROSE_C, r: ROSE_RING - 0.6 }, cp);
  const body = f.add('g', { 'clip-path': `url(#${id})` });
  for (let r = stepM; r < radiusM - 1; r += stepM) f.add('circle', { cx: ROSE_C, cy: ROSE_C, r: (r * s).toFixed(2), fill: 'none', stroke: 'rgba(255,255,255,.16)', 'stroke-width': 0.6 }, body);
  if (!o.threat.allRound) {
    const half = o.threat.sectorDeg / 2;
    f.add('path', { d: wedgePath(0.5, ROSE_RING, o.threat.bearingDeg - half, o.threat.bearingDeg + half), fill: THREAT, 'fill-opacity': 0.08, stroke: THREAT, 'stroke-opacity': 0.55, 'stroke-width': 0.6 }, body);
  }
  const avs = o.plan?.avenues ?? [];
  for (let i = avs.length - 1; i >= 0; i--) {
    const d = avs[i].path.map((q, j) => {
      const [x, y] = P(q);
      return `${j ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join('');
    f.add('path', { d, fill: 'none', stroke: '#14181d', 'stroke-width': i ? 2.4 : 3.2, 'stroke-linejoin': 'round', 'stroke-opacity': 0.75 }, body);
    f.add('path', { d, fill: 'none', stroke: APCH, 'stroke-width': i ? 1.1 : 1.7, 'stroke-linejoin': 'round', ...(i ? { 'stroke-dasharray': '3 2' } : {}) }, body);
    for (const ch of avs[i].chokes) {
      const [x, y] = P(ch.at);
      f.add('rect', { x: (x - 2.2).toFixed(1), y: (y - 2.2).toFixed(1), width: 4.4, height: 4.4, transform: `rotate(45 ${x.toFixed(1)} ${y.toFixed(1)})`, fill: SCREENED, stroke: '#14181d', 'stroke-width': 0.7 }, body);
    }
  }
  for (const p of picks) {
    const sp = p.c.seenP;
    if (sp === null) continue;
    const [x, y] = P(p.c.at);
    f.add('line', { x1: ROSE_C, y1: ROSE_C, x2: x.toFixed(1), y2: y.toFixed(1), stroke: sp >= 0.5 ? SEEN : sp >= 0.2 ? SCREENED : '#8a939d', 'stroke-width': sp >= 0.5 ? 1.1 : 0.8, ...(sp >= 0.5 ? {} : { 'stroke-dasharray': sp >= 0.2 ? '2.6 1.8' : '1 1.8' }) }, body);
  }
  if (!o.key.highest) {
    const b = ((compassBearing(o.key.compass) ?? 0) * Math.PI) / 180;
    const r = Math.min(ROSE_R - 3, o.key.distM * s);
    const x = ROSE_C + r * Math.sin(b);
    const y = ROSE_C - r * Math.cos(b);
    f.add('path', { d: `M${x.toFixed(1)} ${(y - 3.6).toFixed(1)} L${(x + 3.4).toFixed(1)} ${(y + 2.4).toFixed(1)} L${(x - 3.4).toFixed(1)} ${(y + 2.4).toFixed(1)}Z`, fill: HILL, stroke: '#14181d', 'stroke-width': 0.8, 'data-gv-upright': `${x.toFixed(1)} ${y.toFixed(1)}` }, body);
  }
  for (const p of [...picks].reverse()) {
    const [x, y] = P(p.c.at);
    const lead = p.rank === 1;
    const r = lead ? 5.6 : 4.6;
    if (p.c.level === 2) f.add('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: r + 1.9, fill: 'none', stroke: ITG, 'stroke-width': 0.9 }, body);
    f.add('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r, fill: lead ? ITG : '#20252c', stroke: lead ? '#fff' : ITG, 'stroke-width': lead ? 1.1 : 1.2 }, body);
    f.add('text', { x: x.toFixed(1), y: (y + 0.3).toFixed(1), 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': lead ? 7.4 : 6.6, 'font-weight': 800, fill: lead ? '#14181d' : '#f1f3f6', 'font-family': FONT, 'data-gv-upright': `${x.toFixed(1)} ${y.toFixed(1)}` }, body, String(p.rank));
  }
  roseHub(f, 3.4);
  return f.svg;
}

/**
 * The ranked candidates: the lead one as a full card (rank, name, where, kind, why it ranks as chips, what the bundle
 * measured on it), the others as two short lines each, so the tab stays on one page.
 */
function keyGrList(o: GroundGuideOcoka, picks: KeyGrPick[]): HTMLElement {
  const box = el('div', 'ms-gx-kg ms-ggd-split'); // the Detail splits it card by card across columns when it is tall
  for (const p of picks) {
    const c = p.c;
    const lead = p.rank === 1;
    const card = el('div', lead ? 'ms-gx-kgi ms-lead' : 'ms-gx-kgi');
    const name = el('div', 'ms-gx-kgn');
    name.append(el('b', undefined, keyName(c)), el('span', undefined, `${fmtDistance(c.distanceM)} ${c.compass}`));
    card.append(el('div', 'ms-gx-rk', String(p.rank)), name);
    const kind = `${c.name ? titleCase(c.kindLabel) : 'ITG candidate'}${c.itg?.elevationM != null ? ` · ${c.itg.elevationM.toLocaleString('en')} m` : ''}`;
    if (!lead) {
      // Two lines: the name, then what it is and why it stands here, in words.
      const why = p.why.map((w) => w.text).join(' · ');
      card.append(el('div', 'ms-gx-kgk', why ? `${kind} · ${why}` : kind));
      box.append(card);
      continue;
    }
    const k = el('div', 'ms-gx-kgk');
    k.append(el('b', undefined, 'Lead candidate'), ` · ${kind}`);
    card.append(k);
    if (p.why.length) {
      const chips = el('div', 'ms-gx-chips');
      for (const w of p.why) {
        const ch = el('span', 'ms-gx-chip', w.text);
        if (w.k) ch.dataset.k = w.k;
        chips.append(ch);
      }
      card.append(chips);
    }
    const traits = c.itg?.traits ? itgTraitLines(c.itg.traits)[0] : null;
    const reasons = c.itg?.reasonLabels?.length ? c.itg.reasonLabels.map(titleCase).join(' · ') : null;
    const more = [traits, reasons].filter(Boolean).join(' · ');
    if (more) card.append(el('div', 'ms-gx-kgt', more));
    box.append(card);
  }
  if (!picks.length) box.append(note(o.key.candidatesPending ? 'ITG candidates still loading.' : `No ITG candidate within ${fmtDistance(o.radiusM)}.`));
  return box;
}

/** Heights against the Posn: the Posn on the middle line, the highest Gr and each candidate above (right) or below (left). */
function heightLadder(o: GroundGuideOcoka, picks: KeyGrPick[]): HTMLElement | null {
  const rows: Array<{ label: string; m: number; col: string }> = [{ label: 'This Posn', m: 0, col: '#c9d1d9' }];
  if (!o.key.highest) rows.push({ label: `▲ Highest Gr, ${fmtDistance(o.key.distM)} ${o.key.compass}`, m: -o.key.aboveMaxM, col: HILL });
  for (const p of picks) if (p.c.higherM !== null) rows.push({ label: `${p.rank} ${cut(keyName(p.c), 20)}`, m: p.c.higherM, col: ITG });
  if (rows.length < 2) return null;
  const max = Math.max(10, ...rows.map((r) => Math.abs(r.m)));
  const g = el('div', 'ms-gx-hl');
  for (const r of rows) {
    const track = el('div', 'ms-gx-ht');
    const fill = el('i');
    const w = (Math.abs(r.m) / max) * 50;
    fill.style.left = r.m >= 0 ? '50%' : `${50 - w}%`;
    fill.style.width = `${Math.max(r.m === 0 ? 0 : 1.5, w)}%`;
    fill.style.background = r.col;
    track.append(fill);
    g.append(el('span', undefined, r.label), track, el('span', undefined, r.m === 0 ? '0 m' : signed(r.m)));
  }
  return g;
}

/** The tiles of an Extended View tab. */
export function extTiles(tab: ExtTab, v: GroundGuideVerdict): HTMLElement[] {
  ensureExtCss();
  const o = v.ext;
  if (!o) return [];
  const ob = o.obs;
  const out: HTMLElement[] = [];
  switch (tab) {
    case 'XF': {
      out.push(...fireTiles(o));
      const cv = viewshed(o);
      if (cv) {
        const box = el('div', 'ms-gx-pic');
        box.append(cv);
        out.push(tile(`What May Be Seen · ${fmtDistance(o.radiusM)}`, box, roseKey([[SEEN, 'may be seen'], [DEAD, 'dead Gr'], [SCREENED, 'screened'], [THREAT, 'threat arc']]), note(`Ring: ${o.weapon.label} ${fmtDistance(o.obstacle.rangeM)}. Red and amber only inside it, toward the threat.`)));
      }
      const fb = fireBars(o);
      if (fb && o.fire) out.push(tile(`Fd of Fire by Range · ${o.threat.allRound ? 'All Round' : o.threat.compass}`, fb, note(`Clear to the first dead or screened Gr: ${fmtDistance(o.fire.clearMedianM)} (worst fifth ${fmtDistance(o.fire.clearP20M)}). Minimum for a primary task 200 m; 270 to 500 m desirable.`)));
      const en = o.sight?.enemy;
      if (en) {
        out.push(
          tile(
            "Threat's View (violet on the map)",
            list([
              ['Sees this Posn', en.seesP >= 0.5 ? `Yes, chance ${pc(en.seesP * 100)}` : en.seesP >= 0.2 ? `May, chance ${pc(en.seesP * 100)}` : `Unlikely${en.blockAtM !== null ? `: its line is lost ${fmtDistance(en.blockAtM)} from it` : ''}`],
              ['Distance', fmtDistance(en.distM)],
              ['Gr between out of its view', `${pc(en.coveredPct)} (a covered approach where it joins up)`],
            ]),
            note('From the Threat marker, a vehicle commander looking for this unit. Drag the marker to try another place. With the map overlay on, all it may see is painted violet.'),
          ),
        );
      } else if (!o.threat.allRound) out.push(tile("Threat's View", note('Drag the yellow Threat marker onto the map to see what a threat at that place sees of this Posn and of the Gr between.')));
      const bt = o.plan?.better;
      if (bt) {
        out.push(
          tile(
            'Better Posn (green ring on the map)',
            list([
              ['Where', `${fmtDistance(bt.distanceM)} ${bt.compass}${Math.abs(bt.higherM) >= 2 ? `, ${Math.round(Math.abs(bt.higherM))} m ${bt.higherM > 0 ? 'higher' : 'lower'}` : ''}`],
              ['Fd of Fire there', `${GRADE[bt.grade]}: clear ${fmtDistance(bt.clearM)}, ${pc(bt.seenPct)} of the range seen`],
              ['Here', `${GRADE[bt.hereGrade]}: ${pc(bt.hereSeenPct)} of the range seen`],
            ]),
            note('J places the symbol there. Judged for the same weapon and threat, on Gr the mode can use: check on the ground.'),
          ),
        );
      }
      out.push(
        tile(
          'Obsn',
          list([
            ['Country', `${COUNTRY[ob.country]} (view ${reachText(o)})`],
            ['May be seen', `${pc(ob.seenPct)} of the Gr within ${fmtDistance(o.radiusM)}`],
            ['On the Gr alone', `${pc(ob.terrainPct)} (nothing standing on it)`],
            ['Sure', pc(ob.surePct)],
            ['Overlooked', ob.overlook ? `Gr ${Math.round(ob.overlook.riseM)} m higher, ${fmtDistance(ob.overlook.distM)} off; from ${pc(ob.overlookArcPct)} of the dirs` : 'No higher Gr in view'],
            ['At the Posn', ob.ownScreenPct >= 20 ? `Its own Gr cover screens the view (${pc(ob.ownScreenPct)})` : null],
            ['Eye', `${o.eyeLabel}, ${o.eyeM} m`],
            ['Looking for', o.weapon.target === 'vehicle' ? 'A vehicle, 2.4 m' : 'A standing man, 1.7 m'],
          ]),
          note(o.surface ? 'Buildings, tall crops, trees, bunds and walls are counted as a chance, from the map: check on the ground.' : 'On the Gr alone: buildings, crops and trees are NOT counted (extended.surface is off).'),
        ),
      );
      const wx = o.weather;
      const lt = o.light;
      out.push(
        tile(
          `Weather & Light · ${MONTHS[o.month - 1]}`,
          list([
            ['Fog', wx && wx.fogPct !== null ? `${pc(wx.fogPct)} of days` : wx ? 'No data here' : 'Not in this bundle'],
            ['View 3 km or less', wx && wx.hazePct !== null ? `${pc(wx.hazePct)} of days (haze, dust, smoke)` : null],
            ['View under 2 km', wx && wx.lt2kmPct !== null ? `${pc(wx.lt2kmPct)} of days` : null],
            ['Mean view', wx && wx.meanViewKm !== null ? `${wx.meanViewKm} km` : null],
            ['Nearest station', wx && wx.stationKm !== null ? `${Math.round(wx.stationKm)} km${wx.stationKm > 100 ? ' (far: treat as a guess)' : ''}` : null],
            ['Light', lt.night ? `Night: ${lt.level === 'moonlight' ? 'Moonlight' : 'Starlight'}${lt.moonIllum !== null ? `, moon ${pc(lt.moonIllum * 100)} lit` : ''}` : 'Day'],
            ['Night sight', o.nightSight ? `${fmtDistance(o.nightSight.ordinaryM)}; haze day ${fmtDistance(o.nightSight.hazeDayM)}, fog day ${fmtDistance(o.nightSight.fogDayM)}` : null],
          ]),
          note('Daily mean views from the nearest airports, 2016 to 2025: short fog is understated.'),
        ),
      );
      return out;
    }
    case 'XK': {
      const picks = rankKeyGround(o);
      const pic = el('div', 'ms-gx-pic');
      pic.append(keyGrMap(o, picks));
      const key: Array<[string, string]> = [[ITG, '# rank'], [SEEN, 'in view'], [SCREENED, 'may be']];
      if (o.plan?.avenues.length) key.push([APCH, 'apch']);
      if (!o.key.highest) key.push([HILL, 'highest Gr']);
      const sc = keyGrScale(o, picks);
      out.push(tile(`Key Gr · ${fmtDistance(sc.radiusM)} Round · Rings ${fmtDistance(sc.stepM)}`, pic, roseKey(key)));
      const ranked = tile(
        picks.length ? `Ranked · ${picks.length} Candidate${picks.length === 1 ? '' : 's'}` : 'Ranked',
        keyGrList(o, picks),
        picks.length > 0 && note(`Ranked higher: strong, higher than the Posn, within ${fmtDistance(COMMAND_M)} of an approach, toward the threat, in view (a proposed weighting). Candidates only: the commander designates ITG / MITG.`),
      );
      ranked.classList.add('ms-ggd-brk');
      out.push(ranked);
      const hl = heightLadder(o, picks);
      if (hl) out.push(tile('Heights Against the Posn', hl, note(o.key.highest ? `The Posn is the highest Gr within ${fmtDistance(o.key.withinM)}.` : `The highest Gr within ${fmtDistance(o.key.withinM)} is ${Math.round(-o.key.aboveMaxM)} m above the Posn.`)));
      return out;
    }
    case 'XH':
      return airTiles(o);
    case 'XD':
      return [...decisionTiles(o), ...templateTiles(o)];
    default: {
      const p = o.plan;
      if (o.ipbApch !== undefined) out.push(...apchTiles(o));
      else if (p && !o.threat.allRound) {
        const rows: Array<[string, string | null]> = [];
        p.avenues.forEach((a, i) => {
          rows.push([`Apch ${i + 1}`, `${fmtDistance(a.lengthM)}, ${pc(a.goPct)} on GO Gr; narrowest ${fmtDistance(a.minWidthM)}${a.fits ? `: a ${fmtDistance(p.frontageM)} frontage fits` : ''}`]);
          for (const c of a.chokes) rows.push(['Chokepoint', `${c.label}: ${fmtDistance(c.widthM)} wide, ${fmtDistance(c.fromPosnM)} from the Posn`]);
        });
        if (!p.avenues.length) rows.push(['Apch', p.noAvenue ? `None: stopped by ${p.noAvenue}` : 'None within the Gr read']);
        out.push(
          tile(
            `Approaches · ${p.fromAssumed ? `From ${o.threat.compass}` : 'From the Threat Marker'}`,
            list(rows),
            note(`Red lines on the map, a diamond on each chokepoint. The cheapest way over the Gr for ${v.profileLabel} with a ${fmtDistance(p.frontageM)} frontage: NO-GO is never crossed, SLOW-GO and narrow Gr cost more.${p.fromAssumed ? ' The threat is only a direction, so the approach starts out on its bearing: drag the Threat marker to a place for a real one.' : ''}`),
          ),
        );
      } else if (!o.threat.allRound) out.push(tile('Approaches', note('Worked out a moment after the cursor rests.')));
      const w = o.ways;
      const box = el('div', 'ms-gx-pic');
      box.append(waysRose(o));
      out.push(tile(`Straight Ways Out · ${fmtDistance(w.radiusM)}`, box, roseKey([[STEP_COLOR.go, `GO ${w.go}`], [STEP_COLOR.slow, `SLOW-GO ${w.slow}`], [STEP_COLOR.nogo, `stopped ${w.blocked}`]])));
      out.push(tile('Stopped By', w.stops.length ? list(w.stops.map((s) => [s.arc, `${s.label} (${s.sectors} of ${w.total} dirs)`])) : note('Nothing stops a straight way out.'), note(`For ${v.profileLabel}. A way is the best of three straight lines in its 15 degree sector; SLOW-GO when half of it or more is SLOW-GO Gr. Width against the frontage is judged on the approaches from the threat, not on these.`)));
      return out;
    }
  }
}

/**
 * What the Extended View adds to a GROTBC tab: in O the obstacle toward the threat and whether fire covers it, in C
 * the concealment the month's crops give. Nothing for the other letters, or with the Extended View off.
 */
export function extLetterTiles(letter: string, v: GroundGuideVerdict): HTMLElement[] {
  const o = v.ext;
  if (!o) return [];
  ensureExtCss();
  if (letter === 'O') {
    const x = o.obstacle;
    return [
      extraTile(
        `Obs ${o.threat.allRound ? 'All Round' : `Toward the Threat · ${o.threat.compass}`}`,
        list([
          ['Nearest NO-GO', x.nogoM !== null && x.nogoLabel ? `${x.nogoLabel}, ${fmtDistance(x.nogoM)}` : 'None on the arc'],
          ['Covered by fire', x.nogoM === null ? null : x.covered ? `Yes: in view from here (${pc(x.seenP * 100)})` : x.inRange ? `May not be: chance seen ${pc(x.seenP * 100)}` : `No: beyond ${fmtDistance(x.rangeM)}`],
          ['Across the arc', `${pc(x.acrossPct)} of it (${pc(x.blockedInRangePct)} inside ${fmtDistance(x.rangeM)})`],
          ['Nearest SLOW-GO', x.cautionM !== null && x.cautionLabel ? `${x.cautionLabel}, ${fmtDistance(x.cautionM)}` : 'None on the arc'],
        ]),
        note(`For ${o.weapon.label}. An obstacle slows or channels; it stops nothing that is not covered by fire. Obs laid by troops are read from the symbols on the map, not from here.`),
      ),
    ];
  }
  if (letter === 'C') {
    return [
      extraTile(
        `Concealment in Crops · ${MONTHS[o.month - 1]}`,
        list([
          ['Hide a standing man', `${pc(o.crop.tallPct)} of cropland`],
          ['Hide a crouching man', `${pc(o.crop.hidesPct)} of cropland`],
          ['From the threat side', o.fire ? `${pc(o.fire.seenPct)} of the Gr within ${fmtDistance(o.obstacle.rangeM)} may see this Posn` : null],
        ]),
        note('Crop shares are a proposal for the irrigated plains. Concealment in crops is never raised from them: check on the ground.'),
      ),
    ];
  }
  return [];
}

// ── Copy as Text ─────────────────────────────────────────────────────────────────────────────────────────────────────

const BASIS: Record<string, string> = { D: 'doctrine', C: 'catalogue', T: 'typical', E: 'estimate' };

/**
 * The Extended View as plain lines, for orders: what Copy as Text adds under the GROTBC brief while F is on, and what
 * `guide.extendedText()` returns to a host. A heading a tab, its lines indented: every figure the tabs show, with the
 * map products (approaches with every chokepoint, the threat's view, the better position) once they are worked out.
 * Sight is a chance: the words stay "may be seen" and "unlikely".
 */
export function extendedText(v: GroundGuideVerdict): string[] {
  const o = v.ext;
  const L: string[] = [`EXTENDED VIEW · ${v.profileLabel}`];
  if (!o) return [...L, 'No reading here.'];
  const sec = (title: string, lines: Array<string | null | false | undefined>): void => {
    const t = lines.filter((x): x is string => !!x);
    if (t.length) L.push(title, ...t.map((x) => `  ${x}`));
  };
  const ob = o.obs;
  const f = o.fire;
  const w = o.weapon;
  const p = o.plan ?? null;
  const en = o.sight?.enemy ?? null;
  const mon = MONTHS[o.month - 1];
  const hl = (m: number): string => `${Math.round(Math.abs(m))} m ${m > 0 ? 'higher' : 'lower'}`;

  L.push(`Posn ${o.lngLat[1].toFixed(5)}N ${o.lngLat[0].toFixed(5)}E, ${Math.round(o.elevationM)} m. ${mon}, ${o.light.night ? `night (${o.light.level})` : 'day'}.${v.message ? ` Gr verdict: ${v.message}.` : ''}`);
  const basis = w.fromSymbol && w.basis ? BASIS[w.basis.trim().charAt(0).toUpperCase()] : null;
  L.push(
    `${threatText(o)}${en ? `, ${fmtDistance(en.distM)} off` : ''}. ${weaponText(o)}${basis ? ` (${basis} figure)` : ''}, at a ${w.target === 'vehicle' ? 'vehicle' : 'standing man'}. Eye: ${o.eyeLabel} ${o.eyeM} m.${p ? ` Frontage ${fmtDistance(p.frontageM)}.` : ''}`,
  );

  const rule = OCOKA_DOCTRINE?.fieldOfFire?.grade;
  const bands = f ? f.bands.filter((b) => b.seenPct !== null).map((b) => `${b.toM === null ? `beyond ${fmtDistance(b.fromM)}` : `${fmtDistance(b.fromM)} to ${fmtDistance(b.toM)}`} ${pc(b.seenPct as number)}`) : [];
  const ns = o.nightSight;
  const wx = o.weather;
  sec('1 Obsn & Fd of Fire', [
    ...fireText(o),
    `${COUNTRY[ob.country]} country: view ${reachText(o)} (the middle of all directions); ${fmtDistance(ob.clearMedianM)} to the first dead or screened Gr.`,
    `${pc(ob.seenPct)} of the Gr within ${fmtDistance(o.radiusM)} may be seen (${pc(ob.terrainPct)} on the Gr alone, ${pc(ob.surePct)} sure).`,
    ob.overlook
      ? `Overlooked from Gr ${Math.round(ob.overlook.riseM)} m higher, ${fmtDistance(ob.overlook.distM)} ${compass8(ob.overlook.bearingDeg)}; higher Gr looks down from ${pc(ob.overlookArcPct)} of the directions.`
      : 'No higher Gr in view looks down on the Posn.',
    ob.ownScreenPct >= 5 ? `What stands on the Posn's own Gr screens its view with a chance of ${pc(ob.ownScreenPct)}.` : null,
    !o.surface ? 'Read on the Gr alone: buildings, crops and trees are NOT counted.' : null,
    f ? `Fd of Fire ${GRADE[f.grade]} for ${w.label}, ${o.threat.allRound ? 'all round' : `toward ${o.threat.compass}`}.${f.limitedBy === 'clear' ? ' Held down by the clear distance.' : f.limitedBy === 'coverage' ? ' Held down by how much of the range is seen.' : ''}` : 'Indirect / air defence weapon: it needs an observer, not a field of fire of its own.',
    f ? `Clear ${fmtDistance(f.clearMedianM)} to the first dead or screened Gr (worst fifth of the arc ${fmtDistance(f.clearP20M)}, best ${fmtDistance(f.clearMaxM)}); 200 m or more on ${pc(f.ge200Pct)} of the arc, 270 m or more on ${pc(f.ge270Pct)}.` : null,
    f ? `Inside ${fmtDistance(o.obstacle.rangeM)}: ${pc(f.seenPct)} may be seen, ${pc(f.deadPct)} dead Gr (the terrain hides it), ${pc(f.screenedPct)} screened (crops, buildings, trees).` : null,
    bands.length ? `Seen by range: ${bands.join(' · ')}.` : null,
    f && rule?.good && rule?.marginal
      ? `Judged on two tests, the lower stands: Good ${rule.good.clearM} m clear and ${rule.good.seenPct}% seen, Marginal ${rule.marginal.clearM} m and ${rule.marginal.seenPct}%. Minimum for a primary task (${rule.primaryTaskM ?? 200} m clear): ${f.primaryOk ? 'met' : 'NOT met'}.`
      : null,
    o.light.night ? `Night: ${o.light.level}${o.light.moonIllum !== null ? `, moon ${pc(o.light.moonIllum * 100)} lit` : ''}.` : null,
    ns ? `Night sight${ns.thermal ? ' (thermal)' : ''} ${fmtDistance(ns.deviceM)}: ${fmtDistance(ns.ordinaryM)} on an ordinary ${mon} day, ${fmtDistance(ns.hazeDayM)} on a haze day, ${fmtDistance(ns.fogDayM)} on a fog day.` : null,
    wx && wx.fogPct !== null ? `Visibility, ${mon}: fog on ${pc(wx.fogPct)} of days, view 3 km or less on ${wx.hazePct !== null ? pc(wx.hazePct) : '-'}, under 2 km on ${wx.lt2kmPct !== null ? pc(wx.lt2kmPct) : '-'}; mean view ${wx.meanViewKm ?? '-'} km${wx.stationKm !== null && wx.stationKm > 100 ? ' (nearest station far: a guess)' : ''}.` : null,
  ]);
  if (en) {
    sec("Threat's View", [
      `The threat ${en.seesP >= 0.5 ? 'probably sees' : en.seesP >= 0.2 ? 'may see' : 'is unlikely to see'} this Posn (chance ${pc(en.seesP * 100)}).${en.seesP < 0.5 && en.blockAtM !== null ? ` Its line is lost ${fmtDistance(en.blockAtM)} from it.` : ''}`,
      `${pc(en.coveredPct)} of the Gr between is out of its view: a covered approach where that Gr joins up.`,
      'Read for a vehicle commander at the Threat marker (eye 2.4 m).',
    ]);
  }
  const b = p?.better ?? null;
  if (b) {
    sec('Better Posn', [
      `${fmtDistance(b.distanceM)} ${b.compass}: Fd of Fire ${GRADE[b.grade]} (here ${GRADE[b.hereGrade]}); ${pc(b.seenPct)} of the range seen against ${pc(b.hereSeenPct)} here, clear ${fmtDistance(b.clearM)}${Math.abs(b.higherM) >= 2 ? `, ${hl(b.higherM)}` : ''}.`,
      'For the same weapon and threat, on Gr the mode can use. Cover there is NOT compared: cover is never given up for fields of fire.',
    ]);
  }

  const x = obstacleLine(o);
  const of = o.obstacle;
  sec('Obs Toward the Threat', [
    `${x.word}${of.nogoM !== null ? ' toward the threat' : ''}. ${x.sub}.`,
    of.nogoM !== null ? `NO-GO Gr lies across ${pc(of.acrossPct)} of the arc (${pc(of.blockedInRangePct)} inside the weapon's range).` : null,
    of.nogoM !== null && of.cautionM !== null && of.cautionLabel ? `SLOW-GO: ${of.cautionLabel} ${fmtDistance(of.cautionM)}.` : null,
    'Obs laid by troops are not read.',
  ]);
  sec('Concealment in Crops', [`${mon}: ${pc(o.crop.tallPct)} of crops hide a standing man, ${pc(o.crop.hidesPct)} a crouching man.`]);

  const k = o.key;
  const picks = rankKeyGround(o);
  sec('2 Key Gr', [
    k.highest ? `The Posn is the highest Gr within ${fmtDistance(k.withinM)}.` : `${Math.round(-k.aboveMaxM)} m below the highest Gr within ${fmtDistance(k.withinM)} (${Math.round(k.maxM)} m, ${fmtDistance(k.distM)} ${k.compass}).`,
    ...picks.map(
      (g) =>
        `${g.rank}. ${keyName(g.c)}${g.c.name ? `, ${g.c.kindLabel}` : ''}, ${fmtDistance(g.c.distanceM)} ${g.c.compass}${g.c.higherM !== null && Math.abs(g.c.higherM) >= 2 ? `, ${hl(g.c.higherM)}` : ''}${g.c.level >= 2 ? ', strong candidate' : ''}: ${g.why.filter((w2) => w2.k !== 'itg' && w2.k !== '').map((w2) => w2.text.charAt(0).toLowerCase() + w2.text.slice(1)).join(', ') || seenWord(g.c.seenP)}.`,
    ),
    picks.length ? 'Candidates only, ranked by a proposed weighting: the map proposes, the commander designates ITG / MITG.' : k.candidatesPending ? 'ITG candidates still loading.' : `No ITG candidate within ${fmtDistance(o.radiusM)}.`,
  ]);

  const av: string[] = [];
  if (o.ipbApch !== undefined) av.push(...apchText(o));
  else if (!o.threat.allRound) {
    if (p) {
      const from = p.fromAssumed ? `from ${o.threat.compass} (the threat has a direction, no place: the start is assumed)` : 'from the Threat marker';
      p.avenues.forEach((a, i) => {
        av.push(`Apch ${i + 1} ${from}: ${fmtDistance(a.lengthM)}, ${pc(a.goPct)} on GO Gr, narrowest ${fmtDistance(a.minWidthM)}; a ${fmtDistance(p.frontageM)} frontage ${a.fits ? 'fits all the way' : 'does NOT fit everywhere'}.`);
        for (const ch of a.chokes) av.push(`  Chokepoint: ${ch.label}, ${fmtDistance(ch.widthM)} wide, ${fmtDistance(ch.fromPosnM)} from the Posn.`);
      });
      if (!p.avenues.length) av.push(p.noAvenue ? `No way in ${from} for the mode: stopped by ${p.noAvenue} (within the Gr read).` : `No approach found ${from}.`);
    } else av.push('Approaches from the threat: not worked out yet (a moment after the cursor rests).');
  }
  const ws = o.ways;
  av.push(`Straight ways out to ${fmtDistance(ws.radiusM)}: ${ws.go} GO, ${ws.slow} SLOW-GO, ${ws.blocked} stopped, of ${ws.total}.${ws.stops.length ? ` ${ws.stops.map((s) => `Stopped ${s.arc} by ${s.label}`).join('; ')}.` : ''}`);
  sec('3 Approaches', av);
  const al = airText(o);
  if (al.length) sec('4 Air', al);
  const dl = [...decisionText(o), ...templateText(o)];
  if (dl.length) sec('5 Decision', dl);

  L.push('Sight is a chance read from 30 m elevation and the map (buildings, crops, trees): check on the ground.');
  return L;
}

// ── Gr Scope rail ────────────────────────────────────────────────────────────────────────────────────────────────────

export type ExtScopeIcon = 'fan' | 'seen' | 'dead' | 'screened' | 'cover' | 'crop' | 'obs' | 'hill' | 'itg' | 'avenue' | 'choke' | 'ways';
export interface ExtScopeItem {
  icon: ExtScopeIcon;
  bold: string;
  rest?: string;
}
/** The words of the Gr Scope rail in the Extended View: the same lines as the cards, cut to fit a legend. */
export interface ExtScopeText {
  threat: string;
  weapon: string;
  /** The answer: the fields of fire for the weapon, or the country when it needs an observer. */
  lead: string;
  leadTone: Tone | null;
  /** The threat's view of the position, when the threat is a place. */
  enemy: { text: string; tone: Tone | null } | null;
  /** "Better Posn 240 m N: Fd of Fire Marginal". */
  better: string | null;
  rows: Record<ExtRow, ExtScopeItem[]>;
}

export function extScopeText(o: GroundGuideOcoka, v: GroundGuideVerdict | null): ExtScopeText {
  const f = o.fire;
  const rows: Record<ExtRow, ExtScopeItem[]> = { XF: [], XC: [], XO: [], XK: [], XA: [], XH: [], XD: [] };
  rows.XH.push(...airScopeRows(o));
  rows.XD.push(...decisionScopeRows(o), ...templateScopeRows(o));

  rows.XF.push(...fireScopeRows(o));
  if (f) rows.XF.push({ icon: 'seen', bold: `Seen ${pc(f.seenPct)}`, rest: `of ${fmtDistance(o.obstacle.rangeM)}` }, { icon: 'dead', bold: `Dead Gr ${pc(f.deadPct)}` }, { icon: 'screened', bold: `Screened ${pc(f.screenedPct)}` });
  else rows.XF.push({ icon: 'fan', bold: 'Needs an Observer', rest: 'indirect / air defence' });
  rows.XF.push({ icon: 'fan', bold: `${COUNTRY[o.obs.country]} Country`, rest: `view ${reachText(o)}` });

  for (const x of v ? coverPair(v) : []) rows.XC.push({ icon: 'cover', bold: `${COVER_FIELD_LABEL[x.f]} ${x.word}` });
  rows.XC.push({ icon: 'crop', bold: o.crop.tallPct >= 1 ? `${pc(o.crop.tallPct)} of crops tall` : 'No crop stands tall', rest: MONTHS[o.month - 1] });

  const x = obstacleLine(o);
  const ob = o.obstacle;
  rows.XO.push({ icon: 'obs', bold: x.word, rest: ob.nogoM === null ? x.sub : ob.covered ? 'in view: covered by fire' : ob.inRange ? 'in range, may not be seen' : 'beyond the weapon' });

  // A long name (three road names in one) is cut: the rail's lines must not wrap.
  const lead = rankKeyGround(o)[0];
  if (lead) rows.XK.push({ icon: 'itg', bold: cut(keyName(lead.c), 24), rest: `lead · ${fmtDistance(lead.c.distanceM)} ${lead.c.compass}${lead.apch ? `, on Apch ${lead.apch.n}` : `, ${seenWord(lead.c.seenP)}`}` });
  const k = o.key;
  rows.XK.push(k.highest ? { icon: 'hill', bold: 'Highest Gr', rest: `within ${fmtDistance(k.withinM)}` } : { icon: 'hill', bold: `${Math.round(-k.aboveMaxM)} m below highest Gr`, rest: `${fmtDistance(k.distM)} ${k.compass}` });

  const p = o.plan;
  const ap = approachLine(o);
  if (o.ipbApch !== undefined) rows.XA.push(...apchScopeRows(o));
  else if (p && p.avenues.length && !o.threat.allRound) {
    const a = p.avenues[0];
    rows.XA.push({ icon: 'avenue', bold: `Apch ${fmtDistance(a.lengthM)}`, rest: `${p.fromAssumed ? `from ${o.threat.compass}` : 'from the Threat'}${p.avenues.length > 1 ? `, +${p.avenues.length - 1} more` : ''}` });
    const ch = a.chokes[0];
    rows.XA.push(a.fits || !ch ? { icon: 'choke', bold: `${fmtDistance(p.frontageM)} frontage fits`, rest: `narrowest ${fmtDistance(a.minWidthM)}` } : { icon: 'choke', bold: `Narrows to ${fmtDistance(ch.widthM)}`, rest: `${ch.label}, ${fmtDistance(ch.fromPosnM)} out` });
  } else if (ap) rows.XA.push({ icon: 'avenue', bold: ap.word, rest: ap.sub });
  else {
    const w = waysLine(o);
    rows.XA.push({ icon: 'ways', bold: w.word, rest: o.threat.allRound || p ? 'straight ways out' : 'approaches being worked out' });
  }

  const en = enemyLine(o);
  const bt = o.plan?.better;
  return {
    threat: threatText(o),
    weapon: weaponText(o),
    lead: f ? `Fd of Fire ${GRADE[f.grade]} · clear ${fmtDistance(f.clearMedianM)}` : `${COUNTRY[o.obs.country]} Country · view ${reachText(o)}`,
    leadTone: f ? GRADE_TONE[f.grade] : null,
    enemy: en ? { text: en.word, tone: en.tone } : null,
    better: bt ? `Better Posn ${fmtDistance(bt.distanceM)} ${bt.compass}: Fd of Fire ${GRADE[bt.grade]}` : null,
    rows,
  };
}
