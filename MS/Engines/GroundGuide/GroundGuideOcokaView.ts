/**
 * GroundGuideOcokaView.ts
 *
 * What the OCOKA lens shows: the cursor card's rows, the Ground Detail's five tabs (their answer, facts and tiles) and
 * the Copy as Text lines. DOM nodes and textContent only. Wording follows the Ground Guide's short forms (Gr, Obsn,
 * Obs = obstacle, Posn) and the lens's rule: sight is a chance, so it says "may be seen" and "check on the ground".
 */

import { fmtDistance } from './GroundGuideEvaluator';
import { COVER_FIELD_LABEL, COVER_KIND, COVER_WORD, type CoverField } from './GroundGuideCover';
import type { Fact, LetterAnswer, Tone } from './GroundGuideDetailSummary';
import { registerCanvas } from './GroundGuideNorth';
import { bearingDiff, compass8, type WayState } from './GroundGuideOcoka';
import { OCOKA_DOCTRINE } from './GroundGuideOcokaRead';
import { ROSE_C, STEP_COLOR, roseFrame, roseKey, wedgePath } from './GroundGuideTokens';
import type { GroundGuideOcoka, GroundGuideVerdict } from './GroundGuideTypes';

/** The OCOKA tabs of the Ground Detail, in the order of the letters, and their keys. */
export type OcokaTab = 'OO' | 'OC' | 'OX' | 'OK' | 'OA';
export const OCOKA_TABS: readonly OcokaTab[] = ['OO', 'OC', 'OX', 'OK', 'OA'];
export const OCOKA_TAB_LABEL: Record<OcokaTab, string> = { OO: 'Obsn & Fd of Fire', OC: 'Cover', OX: 'Obs', OK: 'Key Gr', OA: 'Avenues' };
export const OCOKA_TAB_KEY: Record<OcokaTab, string> = { OO: '1', OC: '2', OX: '3', OK: '4', OA: '5' };
export function isOcokaTab(t: string): t is OcokaTab {
  return (OCOKA_TABS as readonly string[]).includes(t);
}

const STYLE_ID = 'ms-ground-guide-ocoka-style';
const SEEN = '#3ee07a';
const DEAD = '#e5484d';
const SCREENED = '#ee8a1f';
const THREAT = '#ffd23f';
const CSS = `
.ms-go-lens{display:flex;flex-wrap:wrap;gap:3px 9px;align-items:center;padding:7px 12px 8px;border-top:1px solid rgba(255,255,255,.14);font:600 12px/1.35 system-ui,Segoe UI,Arial,sans-serif;color:#c3cbd3}
.ms-go-tag{padding:1px 7px;border-radius:9px;background:#8ec1ea;color:#14181d;font-weight:750;letter-spacing:.4px}
.ms-go-thr{color:${THREAT}}
.ms-go-v{font:600 13.5px/1.3 system-ui,Segoe UI,Arial,sans-serif;color:#f1f3f6}
.ms-go-s{font:400 12px/1.35 system-ui,Segoe UI,Arial,sans-serif;color:#b8c1ca;margin-top:1px}
.ms-go-s.ms-warn{color:#ffd27a}
.ms-go-bars{display:grid;grid-template-columns:auto minmax(60px,1fr) auto;gap:6px 9px;align-items:center;font-size:12.5px;color:#f1f3f6}
.ms-go-bars>span:nth-child(3n+1){color:#c3cbd3}
.ms-go-bar{height:9px;border-radius:5px;background:rgba(255,255,255,.1);overflow:hidden}
.ms-go-bar>i{display:block;height:100%;background:${SEEN}}
.ms-go-stack{display:flex;height:12px;border-radius:6px;overflow:hidden;margin:8px 0 5px;background:rgba(255,255,255,.1)}
.ms-go-stack>i{display:block;height:100%}
.ms-go-pic{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap}
.ms-go-pic canvas{border-radius:50%;flex:none}
.ms-go-list{display:grid;grid-template-columns:auto minmax(0,1fr);gap:5px 12px;font-size:13.5px;line-height:1.35;color:#f1f3f6}
.ms-go-list>div:nth-child(odd){color:#c3cbd3;font-size:12.5px;padding-top:1px}
.ms-go-note{font-size:12px;line-height:1.4;color:#b8c1ca;margin-top:7px}
`;
export function ensureOcokaCss(): void {
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
function keyLine(o: GroundGuideOcoka): { word: string; sub: string; tone: Tone | null } {
  const k = o.key;
  const c = k.candidates[0];
  const itg = c ? `ITG candidate: ${c.name ?? c.kindLabel} ${fmtDistance(c.distanceM)} ${c.compass}, ${seenWord(c.seenP)}` : k.candidatesPending ? 'ITG candidates loading' : `No ITG candidate within ${fmtDistance(o.radiusM)}`;
  if (k.highest) return { word: `Highest Gr within ${fmtDistance(k.withinM)}`, sub: itg, tone: 'go' };
  return { word: `${Math.round(-k.aboveMaxM)} m below highest Gr`, sub: `${fmtDistance(k.distM)} ${k.compass} · ${itg}`, tone: -k.aboveMaxM >= 15 ? 'warn' : null };
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

/** The avenue of approach in a line: how long, whether the formation fits, where it narrows. */
function avenueLine(o: GroundGuideOcoka): { word: string; sub: string; tone: Tone | null } | null {
  const p = o.plan;
  if (!p || o.threat.allRound) return null;
  const from = p.fromAssumed ? `from ${o.threat.compass}` : 'from the Threat marker';
  if (!p.avenues.length) return p.noAvenue ? { word: `No way in ${from}`, sub: `Stopped by ${p.noAvenue} (for a ${fmtDistance(p.frontageM)} frontage, within the Gr read)`, tone: 'go' } : null;
  const a = p.avenues[0];
  const c = a.chokes[0];
  const word = `Approach ${from}: ${fmtDistance(a.lengthM)}${p.avenues.length > 1 ? `, +${p.avenues.length - 1} more` : ''}`;
  if (a.fits) return { word, sub: `A ${fmtDistance(p.frontageM)} frontage fits all the way (narrowest ${fmtDistance(a.minWidthM)}); ${pc(a.goPct)} GO`, tone: 'warn' };
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
function betterLine(o: GroundGuideOcoka): { word: string; sub: string } | null {
  const b = o.plan?.better;
  if (!b) return null;
  return {
    word: `${fmtDistance(b.distanceM)} ${b.compass}: Fd of Fire ${GRADE[b.grade]}`,
    sub: `Here ${GRADE[b.hereGrade]}, ${pc(b.hereSeenPct)} seen; there ${pc(b.seenPct)}${Math.abs(b.higherM) >= 2 ? `, ${Math.round(Math.abs(b.higherM))} m ${b.higherM > 0 ? 'higher' : 'lower'}` : ''}. J takes it.`,
  };
}

/** Re-render key: changes when anything the cards show of the reading changes. */
export function ocokaKey(o: GroundGuideOcoka | null | undefined): string {
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
 * The hint chip (H) in the OCOKA lens: beside the GO / NO-GO word, the fields of fire for the weapon (the country
 * when it needs an observer), a word when the threat probably sees the spot, and the better position to point at.
 */
export function ocokaChip(v: GroundGuideVerdict): { figure: string; better: { distanceM: number; bearingDeg: number; compass: string } | null } | null {
  const o = v.ocoka;
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

function crow(cap: string, tone: Tone | null, word: string, sub?: string | null, warn = false): HTMLElement {
  const r = el('div', 'ms-ggb-row');
  const val = el('div', 'ms-ggb-fv ms-go-v');
  const dot = el('span', 'ms-ggb-fd');
  dot.dataset.tone = cardTone(tone);
  val.append(dot, word);
  r.append(el('div', 'ms-ggb-cap', cap), val);
  if (sub) r.append(el('div', warn ? 'ms-go-s ms-warn' : 'ms-go-s', sub));
  return r;
}

/** The cursor card's body in the OCOKA lens: who and where the threat is, then a row a letter. */
export function ocokaCardRows(v: GroundGuideVerdict): HTMLElement[] {
  ensureOcokaCss();
  const o = v.ocoka;
  const head = el('div', 'ms-go-lens');
  head.append(el('span', 'ms-go-tag', 'OCOKA'));
  if (!o) {
    head.append('Reading the elevation here…');
    return [head];
  }
  head.append(el('span', 'ms-go-thr', threatText(o)), el('span', undefined, weaponText(o)));
  const rows: HTMLElement[] = [head];
  const ob = o.obs;
  rows.push(
    crow(
      'Obsn',
      null,
      `${COUNTRY[ob.country]} · view ${reachText(o)}`,
      ob.overlook ? `Overlooked: Gr ${Math.round(ob.overlook.riseM)} m higher, ${fmtDistance(ob.overlook.distM)} off; ${pc(ob.seenPct)} of ${fmtDistance(o.radiusM)} may be seen` : `${pc(ob.seenPct)} of the Gr within ${fmtDistance(o.radiusM)} may be seen`,
      !!ob.overlook && ob.overlookArcPct >= 25,
    ),
  );
  const en = enemyLine(o);
  if (en) rows.push(crow('Threat', en.tone, en.word, en.sub));
  const f = o.fire;
  if (f) rows.push(crow('Fd of Fire', GRADE_TONE[f.grade], `${GRADE[f.grade]} · clear ${fmtDistance(f.clearMedianM)}`, `In ${fmtDistance(o.obstacle.rangeM)}: ${pc(f.seenPct)} seen, ${pc(f.deadPct)} dead Gr, ${pc(f.screenedPct)} screened`));
  else rows.push(crow('Fd of Fire', null, 'Needs an Observer', 'Indirect / air defence weapon: no line of sight of its own'));
  const cp = coverPair(v);
  if (cp.length) rows.push(crow('Cover', cp[0].tone, cp.map((x) => `${COVER_FIELD_LABEL[x.f]} ${x.word}`).join(' · '), o.crop.tallPct >= 1 ? `${MONTHS[o.month - 1]}: ${pc(o.crop.tallPct)} of crops stand tall` : `${MONTHS[o.month - 1]}: no crop stands tall`));
  const x = obstacleLine(o);
  rows.push(crow('Obs', x.tone, x.word, x.sub));
  const k = keyLine(o);
  rows.push(crow('Key Gr', k.tone, k.word, k.sub));
  const w = waysLine(o);
  const av = avenueLine(o);
  // The avenue from the threat leads once it is worked out; the straight ways out follow it.
  if (av) rows.push(crow('Avenues', av.tone, av.word, `${av.sub}. Ways out: ${w.word}`));
  else rows.push(crow('Avenues', w.tone, w.word, w.sub));
  const bt = betterLine(o);
  if (bt) rows.push(crow('Better Posn', 'go', bt.word, bt.sub));
  if (o.pending) rows.push(el('div', 'ms-ggb-note ms-ggb-soft', 'Still loading terrain data'));
  return rows;
}

// ── Detail: tab answers and facts ────────────────────────────────────────────────────────────────────────────────────

export function ocokaAnswer(tab: OcokaTab, v: GroundGuideVerdict | null): LetterAnswer | null {
  const o = v?.ocoka;
  if (!v || !o) return null;
  switch (tab) {
    case 'OO': {
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
    case 'OC': {
      const cp = coverPair(v);
      if (!cp.length) return null;
      return { label: `Cover & Concealment for ${v.profileLabel}`, parts: cp.map((x, i) => ({ text: `${i ? '· ' : ''}${COVER_KIND[x.f] === 'Cover' ? COVER_FIELD_LABEL[x.f] : COVER_FIELD_LABEL[x.f]} ${x.word}`, tone: x.tone })), sub: v.cover?.classLabel ? `Gr here: ${v.cover.classLabel}` : null, tone: cp[0].tone, tab: cp[0].word };
    }
    case 'OX': {
      const x = obstacleLine(o);
      return { label: `Obs ${o.threat.allRound ? 'all round' : `toward ${o.threat.compass}`}, for ${v.profileLabel}`, parts: [{ text: x.word, tone: x.tone }], sub: x.sub, tone: x.tone, tab: o.obstacle.nogoM !== null ? fmtDistance(o.obstacle.nogoM) : 'None' };
    }
    case 'OK': {
      const k = keyLine(o);
      return { label: 'Key Gr round the Posn', parts: [{ text: k.word, tone: k.tone }], sub: k.sub, tone: k.tone, tab: o.key.highest ? 'Highest Gr' : o.key.candidates[0] ? `ITG ${fmtDistance(o.key.candidates[0].distanceM)}` : `${Math.round(-o.key.aboveMaxM)} m below` };
    }
    default: {
      const w = waysLine(o);
      return { label: `Straight ways out for ${v.profileLabel}, to ${fmtDistance(o.ways.radiusM)}`, parts: [{ text: `${o.ways.go} of ${o.ways.total} GO`, tone: w.tone }], sub: w.sub, tone: w.tone, tab: `${o.ways.go} of ${o.ways.total} GO` };
    }
  }
}

export function ocokaFacts(tab: OcokaTab, v: GroundGuideVerdict | null): Fact[] {
  const o = v?.ocoka;
  if (!v || !o) return [];
  const ob = o.obs;
  switch (tab) {
    case 'OO': {
      const f = o.fire;
      const out: Fact[] = [];
      if (f) {
        out.push({ k: `Seen in ${fmtDistance(o.obstacle.rangeM)}`, v: pc(f.seenPct), sub: `${pc(f.deadPct)} dead Gr · ${pc(f.screenedPct)} screened` });
        out.push({ k: 'Primary Task (200 m)', v: f.primaryOk ? 'Met' : 'Not met', tone: f.primaryOk ? 'go' : 'slow', sub: `${pc(f.ge270Pct)} of the arc has 270 m or more` });
      }
      out.push({ k: 'View Reaches', v: reachText(o), sub: `${COUNTRY[ob.country]} country` });
      out.push({ k: `May Be Seen, ${fmtDistance(o.radiusM)}`, v: pc(ob.seenPct), sub: `${pc(ob.terrainPct)} on the Gr alone · ${pc(ob.surePct)} sure` });
      out.push({ k: 'Overlooked', v: ob.overlook ? `${Math.round(ob.overlook.riseM)} m higher` : 'No', tone: ob.overlook && ob.overlookArcPct >= 25 ? 'warn' : null, sub: ob.overlook ? `${fmtDistance(ob.overlook.distM)} off · from ${pc(ob.overlookArcPct)} of the dirs` : null });
      const wx = o.weather;
      if (wx && wx.fogPct !== null) out.push({ k: `${MONTHS[o.month - 1]} View`, v: wx.meanViewKm !== null ? `${wx.meanViewKm} km` : '-', sub: `Fog ${pc(wx.fogPct)} of days · 3 km or less ${wx.hazePct !== null ? pc(wx.hazePct) : '-'}` });
      return out;
    }
    case 'OC': {
      const c = v.cover;
      const out: Fact[] = c ? (['direct', 'indirect', 'ground', 'aerial'] as CoverField[]).map((f) => ({ k: COVER_FIELD_LABEL[f], v: COVER_WORD[c.levels[f]], tone: `c${c.levels[f]}` as Tone, sub: c.from[f] })) : [];
      out.push({ k: `Crops, ${MONTHS[o.month - 1]}`, v: `${pc(o.crop.tallPct)} tall`, sub: `${pc(o.crop.hidesPct)} hide a crouching man` });
      return out;
    }
    case 'OX': {
      const x = o.obstacle;
      return [
        { k: 'Across the Arc', v: pc(x.acrossPct), sub: `${pc(x.blockedInRangePct)} of it inside ${fmtDistance(x.rangeM)}` },
        { k: 'Covered by Fire', v: x.nogoM === null ? '-' : x.covered ? 'Yes' : x.inRange ? 'May not be' : 'Out of range', tone: x.nogoM === null ? null : x.covered ? 'go' : x.inRange ? 'slow' : null, sub: x.nogoM !== null ? `Chance seen from here ${pc(x.seenP * 100)}` : null },
        { k: 'Nearest SLOW-GO', v: x.cautionM !== null && x.cautionLabel ? fmtDistance(x.cautionM) : 'None', sub: x.cautionLabel },
        { k: 'Ways Stopped', v: `${o.ways.blocked} of ${o.ways.total}`, sub: o.ways.stops[0] ? `${o.ways.stops[0].arc}: ${o.ways.stops[0].label}` : null },
      ];
    }
    case 'OK': {
      const k = o.key;
      const out: Fact[] = [{ k: `Highest Gr, ${fmtDistance(k.withinM)}`, v: k.highest ? 'This Posn' : `${Math.round(k.maxM)} m`, tone: k.highest ? 'go' : null, sub: k.highest ? null : `${fmtDistance(k.distM)} ${k.compass}, ${Math.round(-k.aboveMaxM)} m above` }];
      for (const c of k.candidates.slice(0, 3)) out.push({ k: c.level === 2 ? 'ITG (strong)' : 'ITG candidate', v: `${fmtDistance(c.distanceM)} ${c.compass}`, tone: c.seenP !== null && c.seenP >= 0.5 ? 'warn' : null, sub: `${c.name ?? c.kindLabel} · ${seenWord(c.seenP)}${c.higherM !== null ? ` · ${c.higherM >= 0 ? '+' : ''}${Math.round(c.higherM)} m` : ''}` });
      return out;
    }
    default: {
      const w = o.ways;
      const out: Fact[] = [
        { k: 'GO', v: String(w.go), tone: 'go' },
        { k: 'SLOW-GO', v: String(w.slow), tone: 'slow' },
        { k: 'Stopped', v: String(w.blocked), tone: w.blocked ? 'nogo' : null },
      ];
      for (const s of w.stops.slice(0, 3)) out.push({ k: `Stopped ${s.arc}`, v: s.label, sub: `${s.sectors} of ${w.total} dirs` });
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
function list(rows: Array<[string, string | null | undefined]>): HTMLElement {
  const g = el('div', 'ms-go-list');
  for (const [k, val] of rows) if (val) g.append(el('div', undefined, k), el('div', undefined, val));
  return g;
}
const note = (text: string): HTMLElement => el('div', 'ms-go-note', text);

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
        let r = 32, g = 38, b = 46, a = 255;
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
        img.data[i + 3] = a;
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
    ctx.font = `${Math.round(11 * dpr)}px system-ui,Segoe UI,Arial,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', c + Math.sin(tn) * (R - 8 * dpr), c - Math.cos(tn) * (R - 8 * dpr));
    ctx.fillStyle = '#fff';
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
  const stack = el('div', 'ms-go-stack');
  for (const [share, colour] of [[f.seenPct, SEEN], [f.deadPct, DEAD], [f.screenedPct, SCREENED]] as Array<[number, string]>) {
    const i = el('i');
    i.style.width = `${Math.max(0, share)}%`;
    i.style.background = colour;
    stack.append(i);
  }
  stack.title = `Inside ${fmtDistance(o.obstacle.rangeM)}: ${pc(f.seenPct)} seen, ${pc(f.deadPct)} dead ground, ${pc(f.screenedPct)} screened`;
  const bars = el('div', 'ms-go-bars');
  for (const b of f.bands) {
    if (b.seenPct === null) continue;
    const bar = el('div', 'ms-go-bar');
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

/** The tiles of an OCOKA tab that are the lens's own (the Detail adds the GROTBC tiles that belong beside them). */
export function ocokaTiles(tab: OcokaTab, v: GroundGuideVerdict): HTMLElement[] {
  ensureOcokaCss();
  const o = v.ocoka;
  if (!o) return [];
  const ob = o.obs;
  const out: HTMLElement[] = [];
  switch (tab) {
    case 'OO': {
      const cv = viewshed(o);
      if (cv) {
        const box = el('div', 'ms-go-pic');
        box.append(cv);
        out.push(tile(`What May Be Seen · ${fmtDistance(o.radiusM)}`, box, roseKey([[SEEN, 'may be seen'], [DEAD, 'dead Gr'], [SCREENED, 'screened'], [THREAT, 'threat arc']]), note(`Ring: ${o.weapon.label} ${fmtDistance(o.obstacle.rangeM)}. Red and amber only inside it, toward the threat.`)));
      }
      const fb = fireBars(o);
      if (fb && o.fire) out.push(tile(`Fd of Fire by Range · ${o.threat.allRound ? 'All Round' : o.threat.compass}`, fb, note(`Clear to the first dead or screened Gr: ${fmtDistance(o.fire.clearMedianM)} (worst fifth ${fmtDistance(o.fire.clearP20M)}). Minimum for a primary task 200 m; 270 to 500 m desirable.`)));
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
          note(o.surface ? 'Buildings, tall crops, trees, bunds and walls are counted as a chance, from the map: check on the ground.' : 'On the Gr alone: buildings, crops and trees are NOT counted (ocoka.surface is off).'),
        ),
      );
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
    case 'OC':
      out.push(
        tile(
          `Crops · ${MONTHS[o.month - 1]}`,
          list([
            ['Hide a standing man', `${pc(o.crop.tallPct)} of cropland`],
            ['Hide a crouching man', `${pc(o.crop.hidesPct)} of cropland`],
            ['From the threat side', o.fire ? `${pc(o.fire.seenPct)} of the Gr within ${fmtDistance(o.obstacle.rangeM)} may see this Posn` : null],
          ]),
          note('Crop shares are a proposal for the irrigated plains. Concealment in crops is never raised from them: check on the ground.'),
        ),
      );
      return out;
    case 'OX': {
      const x = o.obstacle;
      out.push(
        tile(
          `Obs ${o.threat.allRound ? 'All Round' : `Toward ${o.threat.compass}`}`,
          list([
            ['Nearest NO-GO', x.nogoM !== null && x.nogoLabel ? `${x.nogoLabel}, ${fmtDistance(x.nogoM)}` : 'None on the arc'],
            ['Covered by fire', x.nogoM === null ? null : x.covered ? `Yes: in view from here (${pc(x.seenP * 100)})` : x.inRange ? `May not be: chance seen ${pc(x.seenP * 100)}` : `No: beyond ${fmtDistance(x.rangeM)}`],
            ['Across the arc', `${pc(x.acrossPct)} of it (${pc(x.blockedInRangePct)} inside ${fmtDistance(x.rangeM)})`],
            ['Nearest SLOW-GO', x.cautionM !== null && x.cautionLabel ? `${x.cautionLabel}, ${fmtDistance(x.cautionM)}` : 'None on the arc'],
          ]),
          note('An obstacle slows or channels; it stops nothing that is not covered by fire. Obs laid by troops are read from the symbols on the map, not from here.'),
        ),
      );
      return out;
    }
    case 'OK': {
      const k = o.key;
      const rows: Array<[string, string | null]> = [[`Highest Gr within ${fmtDistance(k.withinM)}`, k.highest ? 'This Posn' : `${Math.round(k.maxM)} m, ${fmtDistance(k.distM)} ${k.compass}: ${Math.round(-k.aboveMaxM)} m above this Posn`]];
      for (const c of k.candidates) rows.push([c.level === 2 ? 'ITG (strong)' : 'ITG candidate', `${c.name ?? c.kindLabel}, ${fmtDistance(c.distanceM)} ${c.compass}${c.higherM !== null ? `, ${c.higherM >= 0 ? '+' : ''}${Math.round(c.higherM)} m` : ''}: ${seenWord(c.seenP)}`]);
      if (!k.candidates.length) rows.push(['ITG candidates', k.candidatesPending ? 'Loading' : `None within ${fmtDistance(o.radiusM)}`]);
      out.push(tile('Key Gr and What Sees the Posn', list(rows), note('In view = a man there and this Posn may see each other. Candidates only: ITG and MITG are designated by the commander.')));
      return out;
    }
    default: {
      const p = o.plan;
      if (p && !o.threat.allRound) {
        const rows: Array<[string, string | null]> = [];
        p.avenues.forEach((a, i) => {
          rows.push([i ? 'Second avenue' : 'Avenue', `${fmtDistance(a.lengthM)}, ${pc(a.goPct)} on GO Gr; narrowest ${fmtDistance(a.minWidthM)}${a.fits ? `: a ${fmtDistance(p.frontageM)} frontage fits` : ''}`]);
          for (const c of a.chokes) rows.push(['Chokepoint', `${c.label}: ${fmtDistance(c.widthM)} wide, ${fmtDistance(c.fromPosnM)} from the Posn`]);
        });
        if (!p.avenues.length) rows.push(['Avenue', p.noAvenue ? `None: stopped by ${p.noAvenue}` : 'None within the Gr read']);
        out.push(
          tile(
            `Avenues of Approach · ${p.fromAssumed ? `From ${o.threat.compass}` : 'From the Threat Marker'}`,
            list(rows),
            note(`Red lines on the map, a diamond on each chokepoint. The cheapest way over the Gr for ${v.profileLabel} with a ${fmtDistance(p.frontageM)} frontage: NO-GO is never crossed, SLOW-GO and narrow Gr cost more.${p.fromAssumed ? ' The threat is only a direction, so the avenue starts out on its bearing: drag the Threat marker to a place for a real one.' : ''}`),
          ),
        );
      } else if (!o.threat.allRound) out.push(tile('Avenues of Approach', note('Worked out a moment after the cursor rests.')));
      const w = o.ways;
      const box = el('div', 'ms-go-pic');
      box.append(waysRose(o));
      out.push(tile(`Straight Ways Out · ${fmtDistance(w.radiusM)}`, box, roseKey([[STEP_COLOR.go, `GO ${w.go}`], [STEP_COLOR.slow, `SLOW-GO ${w.slow}`], [STEP_COLOR.nogo, `stopped ${w.blocked}`]])));
      out.push(tile('Stopped By', w.stops.length ? list(w.stops.map((s) => [s.arc, `${s.label} (${s.sectors} of ${w.total} dirs)`])) : note('Nothing stops a straight way out.'), note(`For ${v.profileLabel}. A way is the best of three straight lines in its 15 degree sector; SLOW-GO when half of it or more is SLOW-GO Gr. Width against the frontage is judged on the avenues from the threat, not on these.`)));
      return out;
    }
  }
}

// ── Copy as Text ─────────────────────────────────────────────────────────────────────────────────────────────────────

const BASIS: Record<string, string> = { D: 'doctrine', C: 'catalogue', T: 'typical', E: 'estimate' };

/**
 * The OCOKA brief: the reading in full as plain lines, for orders. It is what Copy as Text gives in the OCOKA lens and
 * what `guide.ocokaText()` returns to a host. Laid out like the GROTBC text (a heading a letter, its lines indented):
 * every figure the five tabs show, and the map products (avenues with every chokepoint, the threat's view, the better
 * position) once they are worked out. Sight is a chance: the words stay "may be seen" and "unlikely".
 */
export function ocokaText(v: GroundGuideVerdict): string[] {
  const o = v.ocoka;
  const L: string[] = [`GR DETAIL · OCOKA · ${v.profileLabel}`];
  if (!o) return [...L, 'No reading here.'];
  const sec = (letter: string, title: string, lines: Array<string | null | false | undefined>): void => {
    const t = lines.filter((x): x is string => !!x);
    if (t.length) L.push(letter ? `${letter} ${title}` : title, ...t.map((x) => `  ${x}`));
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

  sec('O', 'Obsn', [
    `${COUNTRY[ob.country]} country: view ${reachText(o)} (the middle of all directions); ${fmtDistance(ob.clearMedianM)} to the first dead or screened Gr.`,
    `${pc(ob.seenPct)} of the Gr within ${fmtDistance(o.radiusM)} may be seen (${pc(ob.terrainPct)} on the Gr alone, ${pc(ob.surePct)} sure).`,
    ob.overlook
      ? `Overlooked from Gr ${Math.round(ob.overlook.riseM)} m higher, ${fmtDistance(ob.overlook.distM)} ${compass8(ob.overlook.bearingDeg)}; higher Gr looks down from ${pc(ob.overlookArcPct)} of the directions.`
      : 'No higher Gr in view looks down on the Posn.',
    ob.ownScreenPct >= 5 ? `What stands on the Posn's own Gr screens its view with a chance of ${pc(ob.ownScreenPct)}.` : null,
    !o.surface ? 'Read on the Gr alone: buildings, crops and trees are NOT counted.' : null,
  ]);

  if (f) {
    const rule = OCOKA_DOCTRINE?.fieldOfFire?.grade;
    const bands = f.bands.filter((b) => b.seenPct !== null).map((b) => `${b.toM === null ? `beyond ${fmtDistance(b.fromM)}` : `${fmtDistance(b.fromM)} to ${fmtDistance(b.toM)}`} ${pc(b.seenPct as number)}`);
    sec('O', 'Fd of Fire', [
      `${GRADE[f.grade]} for ${w.label}, ${o.threat.allRound ? 'all round' : `toward ${o.threat.compass}`}.${f.limitedBy === 'clear' ? ' Held down by the clear distance.' : f.limitedBy === 'coverage' ? ' Held down by how much of the range is seen.' : ''}`,
      `Clear ${fmtDistance(f.clearMedianM)} to the first dead or screened Gr (worst fifth of the arc ${fmtDistance(f.clearP20M)}, best ${fmtDistance(f.clearMaxM)}); 200 m or more on ${pc(f.ge200Pct)} of the arc, 270 m or more on ${pc(f.ge270Pct)}.`,
      `Inside ${fmtDistance(o.obstacle.rangeM)}: ${pc(f.seenPct)} may be seen, ${pc(f.deadPct)} dead Gr (the terrain hides it), ${pc(f.screenedPct)} screened (crops, buildings, trees).`,
      bands.length ? `Seen by range: ${bands.join(' · ')}.` : null,
      rule?.good && rule?.marginal
        ? `Judged on two tests, the lower stands: Good ${rule.good.clearM} m clear and ${rule.good.seenPct}% seen, Marginal ${rule.marginal.clearM} m and ${rule.marginal.seenPct}%. Minimum for a primary task (${rule.primaryTaskM ?? 200} m clear): ${f.primaryOk ? 'met' : 'NOT met'}.`
        : null,
    ]);
  } else sec('O', 'Fd of Fire', ['Indirect / air defence weapon: it needs an observer, not a field of fire of its own.']);

  const ns = o.nightSight;
  sec('O', 'Light', [
    o.light.night ? `Night: ${o.light.level}${o.light.moonIllum !== null ? `, moon ${pc(o.light.moonIllum * 100)} lit` : ''}.` : null,
    ns ? `Night sight${ns.thermal ? ' (thermal)' : ''} ${fmtDistance(ns.deviceM)}: ${fmtDistance(ns.ordinaryM)} on an ordinary ${mon} day, ${fmtDistance(ns.hazeDayM)} on a haze day, ${fmtDistance(ns.fogDayM)} on a fog day.` : null,
  ]);

  const c = v.cover;
  sec('C', 'Cover', [
    c
      ? `Cover from direct fire ${COVER_WORD[c.levels.direct]}, from indirect fire ${COVER_WORD[c.levels.indirect]}. Concealment from Gr obsn ${COVER_WORD[c.levels.ground]}, from aerial obsn ${COVER_WORD[c.levels.aerial]}.${c.classLabel ? ` Gr here: ${c.classLabel}.` : ''}`
      : 'Cover not read at this spot.',
    `${mon}: ${pc(o.crop.tallPct)} of crops hide a standing man, ${pc(o.crop.hidesPct)} a crouching man.`,
  ]);

  const x = obstacleLine(o);
  const of = o.obstacle;
  sec('O', 'Obs', [
    `${x.word}${of.nogoM !== null ? ' toward the threat' : ''}. ${x.sub}.`,
    of.nogoM !== null ? `NO-GO Gr lies across ${pc(of.acrossPct)} of the arc (${pc(of.blockedInRangePct)} inside the weapon's range).` : null,
    of.nogoM !== null && of.cautionM !== null && of.cautionLabel ? `SLOW-GO: ${of.cautionLabel} ${fmtDistance(of.cautionM)}.` : null,
    'Obs laid by troops are not read.',
  ]);

  const k = o.key;
  sec('K', 'Key Gr', [
    k.highest ? `The Posn is the highest Gr within ${fmtDistance(k.withinM)}.` : `${Math.round(-k.aboveMaxM)} m below the highest Gr within ${fmtDistance(k.withinM)} (${Math.round(k.maxM)} m, ${fmtDistance(k.distM)} ${k.compass}).`,
    ...k.candidates.map(
      (g) =>
        `ITG candidate${g.level >= 2 ? ' (strong)' : ''}: ${g.name ?? g.kindLabel}${g.name ? `, ${g.kindLabel}` : ''}, ${fmtDistance(g.distanceM)} ${g.compass}${g.higherM !== null && Math.abs(g.higherM) >= 2 ? `, ${hl(g.higherM)}` : ''}, ${seenWord(g.seenP)}${g.seenP !== null ? ` (chance ${pc(g.seenP * 100)})` : ''}.`,
    ),
    k.candidates.length ? 'Candidates only: the map proposes, the commander designates.' : k.candidatesPending ? 'ITG candidates still loading.' : `No ITG candidate within ${fmtDistance(o.radiusM)}.`,
  ]);

  const av: string[] = [];
  if (!o.threat.allRound) {
    if (p) {
      const from = p.fromAssumed ? `from ${o.threat.compass} (the threat has a direction, no place: the start is assumed)` : 'from the Threat marker';
      p.avenues.forEach((a, i) => {
        av.push(`Avenue ${i + 1} ${from}: ${fmtDistance(a.lengthM)}, ${pc(a.goPct)} on GO Gr, narrowest ${fmtDistance(a.minWidthM)}; a ${fmtDistance(p.frontageM)} frontage ${a.fits ? 'fits all the way' : 'does NOT fit everywhere'}.`);
        for (const ch of a.chokes) av.push(`  Chokepoint: ${ch.label}, ${fmtDistance(ch.widthM)} wide, ${fmtDistance(ch.fromPosnM)} from the Posn.`);
      });
      if (!p.avenues.length) av.push(p.noAvenue ? `No way in ${from} for the mode: stopped by ${p.noAvenue} (within the Gr read).` : `No avenue found ${from}.`);
    } else av.push('Avenues from the threat: not worked out yet (a moment after the cursor rests).');
  }
  const ws = o.ways;
  av.push(`Straight ways out to ${fmtDistance(ws.radiusM)}: ${ws.go} GO, ${ws.slow} SLOW-GO, ${ws.blocked} stopped, of ${ws.total}.${ws.stops.length ? ` ${ws.stops.map((s) => `Stopped ${s.arc} by ${s.label}`).join('; ')}.` : ''}`);
  sec('A', 'Avenues', av);

  if (en) {
    sec('', "Threat's View", [
      `The threat ${en.seesP >= 0.5 ? 'probably sees' : en.seesP >= 0.2 ? 'may see' : 'is unlikely to see'} this Posn (chance ${pc(en.seesP * 100)}).${en.seesP < 0.5 && en.blockAtM !== null ? ` Its line is lost ${fmtDistance(en.blockAtM)} from it.` : ''}`,
      `${pc(en.coveredPct)} of the Gr between is out of its view: a covered approach where that Gr joins up.`,
      'Read for a vehicle commander at the Threat marker (eye 2.4 m).',
    ]);
  }
  const b = p?.better ?? null;
  if (b) {
    sec('', 'Better Posn', [
      `${fmtDistance(b.distanceM)} ${b.compass}: Fd of Fire ${GRADE[b.grade]} (here ${GRADE[b.hereGrade]}); ${pc(b.seenPct)} of the range seen against ${pc(b.hereSeenPct)} here, clear ${fmtDistance(b.clearM)}${Math.abs(b.higherM) >= 2 ? `, ${hl(b.higherM)}` : ''}.`,
      'For the same weapon and threat, on Gr the mode can use. Cover there is NOT compared: cover is never given up for fields of fire.',
    ]);
  }

  const wx = o.weather;
  if (wx && wx.fogPct !== null) {
    sec('W', 'Visibility', [
      `${mon}: fog on ${pc(wx.fogPct)} of days, view 3 km or less (haze, dust, smoke) on ${wx.hazePct !== null ? pc(wx.hazePct) : '-'}, under 2 km on ${wx.lt2kmPct !== null ? pc(wx.lt2kmPct) : '-'}; mean view ${wx.meanViewKm ?? '-'} km.`,
      wx.stationKm !== null ? `Nearest station ${Math.round(wx.stationKm)} km${wx.stationKm > 100 ? ': a guess at this distance' : ''}.` : null,
    ]);
  }
  L.push('Sight is a chance read from 30 m elevation and the map (buildings, crops, trees): check on the ground.');
  return L;
}

// ── Gr Scope rail ────────────────────────────────────────────────────────────────────────────────────────────────────

export type OcokaScopeIcon = 'fan' | 'seen' | 'dead' | 'screened' | 'cover' | 'crop' | 'obs' | 'hill' | 'itg' | 'avenue' | 'choke' | 'ways';
export interface OcokaScopeItem {
  icon: OcokaScopeIcon;
  bold: string;
  rest?: string;
}
/** The words of the Gr Scope rail in the OCOKA lens: the same lines as the cards, cut to fit a legend. */
export interface OcokaScopeText {
  threat: string;
  weapon: string;
  /** The answer: the fields of fire for the weapon, or the country when it needs an observer. */
  lead: string;
  leadTone: Tone | null;
  /** The threat's view of the position, when the threat is a place. */
  enemy: { text: string; tone: Tone | null } | null;
  /** "Better Posn 240 m N: Fd of Fire Marginal". */
  better: string | null;
  rows: Record<OcokaTab, OcokaScopeItem[]>;
}

export function ocokaScopeText(o: GroundGuideOcoka, v: GroundGuideVerdict | null): OcokaScopeText {
  const f = o.fire;
  const rows: Record<OcokaTab, OcokaScopeItem[]> = { OO: [], OC: [], OX: [], OK: [], OA: [] };

  if (f) rows.OO.push({ icon: 'seen', bold: `Seen ${pc(f.seenPct)}`, rest: `of ${fmtDistance(o.obstacle.rangeM)}` }, { icon: 'dead', bold: `Dead Gr ${pc(f.deadPct)}` }, { icon: 'screened', bold: `Screened ${pc(f.screenedPct)}` });
  else rows.OO.push({ icon: 'fan', bold: 'Needs an Observer', rest: 'indirect / air defence' });
  rows.OO.push({ icon: 'fan', bold: `${COUNTRY[o.obs.country]} Country`, rest: `view ${reachText(o)}` });

  for (const x of v ? coverPair(v) : []) rows.OC.push({ icon: 'cover', bold: `${COVER_FIELD_LABEL[x.f]} ${x.word}` });
  rows.OC.push({ icon: 'crop', bold: o.crop.tallPct >= 1 ? `${pc(o.crop.tallPct)} of crops tall` : 'No crop stands tall', rest: MONTHS[o.month - 1] });

  const x = obstacleLine(o);
  const ob = o.obstacle;
  rows.OX.push({ icon: 'obs', bold: x.word, rest: ob.nogoM === null ? x.sub : ob.covered ? 'in view: covered by fire' : ob.inRange ? 'in range, may not be seen' : 'beyond the weapon' });

  const k = o.key;
  rows.OK.push(k.highest ? { icon: 'hill', bold: 'Highest Gr', rest: `within ${fmtDistance(k.withinM)}` } : { icon: 'hill', bold: `${Math.round(-k.aboveMaxM)} m below highest Gr`, rest: `${fmtDistance(k.distM)} ${k.compass}` });
  const c = k.candidates[0];
  // A long name (three road names in one) is cut: the rail's lines must not wrap.
  const itgName = (n: string): string => (n.length > 26 ? `${n.slice(0, 25).trimEnd()}…` : n);
  if (c) rows.OK.push({ icon: 'itg', bold: `ITG ${itgName(c.name ?? c.kindLabel)}`, rest: `${fmtDistance(c.distanceM)} ${c.compass}, ${seenWord(c.seenP)}` });

  const p = o.plan;
  const av = avenueLine(o);
  if (p && p.avenues.length && !o.threat.allRound) {
    const a = p.avenues[0];
    rows.OA.push({ icon: 'avenue', bold: `Approach ${fmtDistance(a.lengthM)}`, rest: `${p.fromAssumed ? `from ${o.threat.compass}` : 'from the Threat'}${p.avenues.length > 1 ? `, +${p.avenues.length - 1} more` : ''}` });
    const ch = a.chokes[0];
    rows.OA.push(a.fits || !ch ? { icon: 'choke', bold: `${fmtDistance(p.frontageM)} frontage fits`, rest: `narrowest ${fmtDistance(a.minWidthM)}` } : { icon: 'choke', bold: `Narrows to ${fmtDistance(ch.widthM)}`, rest: `${ch.label}, ${fmtDistance(ch.fromPosnM)} out` });
  } else if (av) rows.OA.push({ icon: 'avenue', bold: av.word, rest: av.sub });
  else {
    const w = waysLine(o);
    rows.OA.push({ icon: 'ways', bold: w.word, rest: o.threat.allRound || p ? 'straight ways out' : 'avenues being worked out' });
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
