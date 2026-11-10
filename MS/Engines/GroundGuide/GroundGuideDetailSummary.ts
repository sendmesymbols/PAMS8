/**
 * GroundGuideDetailSummary.ts
 *
 * The answer strip at the head of each Ground Detail tab (added 2026-11-07, user: "each tab opens with a one-line
 * summary strip (the answer for that letter), then pictures, then the detail rows"). Nothing is worked out here: every
 * figure is a field the tiles under it already show, read off the same verdict. A fact with a going step, a cover level
 * or a route check carries a dot in its colour beside the word, so the word still says it without the colour. Never
 * overstates: a level is the spot's own, a missing figure is left out rather than guessed.
 *
 * Visual review, 2026-11-08 (the user's picks):
 *   - item 9 "Answer block first": the strip opens with the letter's own answer, large and in its verdict colour,
 *     judged for the mode ("Rds for Tracked Vehicle: No Tankable Rd within 3 km"), then the facts;
 *   - item 8 "GROTBC answer row": the same answer, as a dot and a short word, on every tab (`letterAnswer().tab`), so
 *     the six letters' answers are seen without switching;
 *   - item 10 "One idea, one name, one number": road crossings of the circle are "Rds out" ("15 in 7 Dirs", R only);
 *     cross-country directions for the mode are "Open Dirs" ("6 of 8"), the same reading in O and T; R's route uses
 *     the road T found when the 1:50k map has none within 500 m, so the two tabs never disagree.
 *   - item 5: labels written to fit; a sub-line takes two lines before it is cut.
 *
 * DOM nodes and textContent only (names and labels never become markup).
 */

import type { GrotbcLetter } from './GroundGuideBrief';
import { COVER_FIELD_LABEL, COVER_FIELDS, COVER_KIND, COVER_WORD, type CoverField, type CoverLevel } from './GroundGuideCover';
import { fmtDistance, titleCase } from './GroundGuideEvaluator';
import { GOING_WORD, RATING_LABEL } from './GroundGuideGoing';
import { fmtPeople } from './GroundGuidePopulationView';
import type { ObstacleHit } from './GroundGuideSections';
import { fmtKmh, fmtMinutes } from './GroundGuideSpeed';
import { TONE_STEP, verdictTone } from './GroundGuideTokens';
import type { GoingStep, GroundGuideVerdict } from './GroundGuideTypes';

/** Colour of a dot or word: a going step, Marginal, a cover level, or a plain caution. */
export type Tone = GoingStep | 'marg' | 'c0' | 'c1' | 'c2' | 'c3' | 'warn';

export interface Fact {
  k: string;
  v: string;
  sub?: string | null;
  tone?: Tone | null;
}

/** One piece of the answer's big line: a word in its colour, or a small qualifier between them. */
export interface AnswerPart {
  text: string;
  tone?: Tone | null;
  small?: boolean;
}

/** A letter's answer: the block that opens its strip, and the dot and word on its tab. */
export interface LetterAnswer {
  /** "Gr for Tracked Vehicle". */
  label: string;
  parts: AnswerPart[];
  sub: string | null;
  /** The block's tint and the tab's dot (null: neutral, no dot). */
  tone: Tone | null;
  /** The tab's short answer ("GO", "No Tankable Rd", "6 of 8 open"). */
  tab: string;
  /** The tab shows a ring instead of a dot (the civil flag: advisory, not a verdict). */
  ring?: boolean;
}

const MAX_FACTS = 6;
/** Route check word per level (the R tile's own heads). */
const CHECK_WORD = { ok: 'Suits the Mode', warn: 'Limited', stop: 'Does Not Suit', unknown: 'Check First' } as const;
const CHECK_TONE = { ok: 'go', warn: 'slow', stop: 'nogo', unknown: 'warn' } as const;
const EFFECT_RANK: Record<string, number> = { 'NO-GO': 2, 'SLOW-GO': 1 };

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function at(p: { distanceM: number; compass: string }): string {
  return `${fmtDistance(p.distanceM)} ${p.compass}`;
}

function ci(n: number): string {
  return n >= 127 ? '127+' : String(n);
}

function coverTone(l: CoverLevel): Tone {
  return `c${l}` as Tone;
}

function ratingTone(r: 'unrestricted' | 'restricted' | 'severe'): Tone {
  return r === 'unrestricted' ? 'go' : r === 'restricted' ? 'slow' : 'nogo';
}

/** "Rds out": road crossings of the circle, in how many directions (R only). */
export function roadsOutPhrase(exits: number, dirs: number): string {
  return `${exits} in ${dirs} Dir${dirs === 1 ? '' : 's'}`;
}

/** R's route at the point: the 1:50k map's, or the road T found when the map has none within 500 m. */
function routeFact(v: GroundGuideVerdict): Fact | null {
  const r = v.sections?.roads;
  if (!r) return null;
  const x = r.route;
  if (x) return { k: 'Route', v: titleCase(x.typeLabel), sub: [x.on ? 'At the point' : at(x), x.msr ? 'MSR' : null].filter(Boolean).join(' · ') };
  const m = v.traffic?.road?.main;
  if (m && m.distanceM <= 500) {
    const kind = m.allWeather ? 'Rd' : 'Tr';
    return { k: 'Route', v: m.shield === kind ? (m.name ? titleCase(m.name) : kind) : m.shield, sub: [at(m), m.tag, 'Not on the 1:50k map'].filter(Boolean).join(' · ') };
  }
  return { k: 'Route', v: 'None Near', sub: 'No Rd or Tr within 500 m' };
}

// ── one function a letter: the facts after the answer ───────────────────────

function factsG(v: GroundGuideVerdict): Fact[] {
  const out: Fact[] = [];
  const g = v.sections?.ground;
  if (g) {
    if (g.elevationM !== null) {
      const high = g.high ? `High Gr ${Math.round(g.high.elevationM).toLocaleString('en')} m, ${at(g.high)}` : null;
      out.push({ k: 'Height', v: `${Math.round(g.elevationM).toLocaleString('en')} m`, sub: high });
    }
    if (g.slopeDeg !== null) {
      const deg = `${g.slopeApprox ? '~' : ''}${Math.round(g.slopeDeg)}°`;
      out.push({ k: 'Slope', v: g.slopeBand ? `${deg} ${titleCase(g.slopeBand)}` : deg, sub: g.aspect ? `Faces ${g.aspect.compass}` : null });
    }
  }
  const soil = v.going?.soil;
  if (soil) {
    const cone = soil.ciDry !== null && soil.ciWet !== null ? `Cone index ${ci(soil.ciDry)} dry, ${ci(soil.ciWet)} after rain` : null;
    out.push({ k: 'Soil', v: titleCase(soil.label), sub: cone });
  }
  if (g?.terrainChange) out.push({ k: 'Changes To', v: titleCase(g.terrainChange.label), sub: at(g.terrainChange) });
  const itg = v.ground;
  if (itg) {
    const n = itg.candidates.length;
    const c = itg.candidates[0];
    if (n && c) {
      const what = c.name ? titleCase(c.name) : titleCase(c.kindLabel);
      out.push({ k: 'ITG', v: `${n} Candidate${n > 1 ? 's' : ''}`, sub: `${what}, ${at(c)}`, tone: c.level === 2 ? 'warn' : null });
    } else out.push({ k: 'ITG', v: itg.pending ? 'Loading' : 'None', sub: itg.pending ? null : `Within ${fmtDistance(itg.radiusM)}` });
  }
  return out;
}

function factsR(v: GroundGuideVerdict): Fact[] {
  const out: Fact[] = [];
  const r = v.sections?.roads;
  const route = routeFact(v);
  if (route) out.push(route);
  if (r?.check) out.push({ k: 'Route Check', v: CHECK_WORD[r.check.level], sub: r.check.text, tone: CHECK_TONE[r.check.level] });
  const d = r?.density;
  if (d) {
    const per = d.leadIsAllWeather ? d.allWeatherDensity : d.density;
    out.push({ k: 'Rd Density', v: d.lead.label, sub: `${per.toFixed(2)} km per km²${d.leadIsAllWeather ? ' after rain' : ''}` });
    const n = d.exits.length;
    const dirs = d.exitDirs.length;
    out.push({
      k: 'Rds Out',
      v: n ? roadsOutPhrase(n, dirs) : 'None',
      sub: n ? `Rd crossings of the ${fmtDistance(d.radiusM)} circle · ${d.exitDirs.join(' ')}` : `Within ${fmtDistance(d.radiusM)}`,
      tone: dirs <= 1 ? 'nogo' : dirs === 2 ? 'slow' : null,
    });
  }
  return out;
}

function obstacleFact(k: string, o: ObstacleHit): Fact {
  return {
    k,
    v: titleCase(o.label),
    sub: [at(o), o.effect].filter(Boolean).join(' · '),
    tone: o.effect === 'NO-GO' ? 'nogo' : o.effect === 'SLOW-GO' ? 'slow' : null,
  };
}

/** What stops the mode first, then what slows it, then the nearer: the obstacle that matters. */
function obstacleHits(v: GroundGuideVerdict): Array<[string, ObstacleHit]> {
  const o = v.sections?.obstacles;
  const hits: Array<[string, ObstacleHit]> = [];
  if (o?.natural) hits.push(['Natural Obs', o.natural]);
  if (o?.manMade) hits.push(['Man-Made Obs', o.manMade]);
  hits.sort((a, b) => (EFFECT_RANK[b[1].effect ?? ''] ?? 0) - (EFFECT_RANK[a[1].effect ?? ''] ?? 0) || a[1].distanceM - b[1].distanceM);
  return hits;
}

function factsO(v: GroundGuideVerdict): Fact[] {
  const out: Fact[] = [];
  const o = v.sections?.obstacles;
  if (o) {
    // Without a movement reading the answer block is the first obstacle already: it is not said twice.
    const hits = obstacleHits(v);
    for (const [k, h] of v.going?.movement ? hits : hits.slice(1)) out.push(obstacleFact(k, h));
    if (o.wet) out.push({ k: 'Wet Gr', v: titleCase(o.wet), sub: 'At the point', tone: 'slow' });
    if (o.bank) out.push({ k: 'Bank', v: titleCase(o.bank.label), sub: `Within ${fmtDistance(o.bank.withinM)}` });
    const c = o.canal;
    if (c) {
      const size = [c.widthM ? `${c.widthM} m wide` : null, c.depthM ? `${c.depthM} m deep` : null].filter(Boolean).join(', ');
      out.push({ k: 'Canal', v: c.name ? titleCase(c.name) : titleCase(c.label), sub: [at(c), size].filter(Boolean).join(' · ') });
    } else if (o.reach) {
      const r = o.reach;
      out.push({ k: 'River', v: r.name ? titleCase(r.name) : titleCase(r.label), sub: [at(r), r.depthM ? `${r.depthM} m deep` : null].filter(Boolean).join(' · ') });
    }
  }
  return out;
}

function factsT(v: GroundGuideVerdict): Fact[] {
  const out: Fact[] = [];
  const g = v.going;
  const m = g?.movement;
  // The same reading O leads with, under the same name.
  if (m) out.push({ k: 'Open Dirs', v: `${m.open} of 8`, sub: `${RATING_LABEL[m.rating]} · to ${fmtDistance(m.rangeM / 2)}`, tone: ratingTone(m.rating) });
  const sp = v.speed;
  if (sp) {
    out.push({ k: `Speed · ${sp.short}`, v: sp.kmh === 0 ? 'NO-GO' : fmtKmh(sp.kmh), sub: 'Cross-country', tone: sp.kmh === 0 ? 'nogo' : null });
    let best: { minutes: number; compass: string } | null = null;
    for (const r of sp.rays ?? []) if (r.minutes !== null && (!best || r.minutes < best.minutes)) best = { minutes: r.minutes, compass: r.compass };
    if (best) out.push({ k: `Time to ${fmtDistance(sp.rangeM)}`, v: fmtMinutes(best.minutes), sub: `Fastest ${best.compass}` });
  }
  const road = v.traffic?.road?.main;
  if (road) out.push({ k: 'Way Out by Rd', v: road.shield, sub: at(road) });
  return out;
}

function factsB(v: GroundGuideVerdict): Fact[] {
  const out: Fact[] = [];
  const p = v.population;
  const r = p?.reading;
  if (r) {
    out.push({ k: `People · ${r.radiusKm} km (est.)`, v: fmtPeople(r.people), sub: `${r.cls.label} · ${fmtPeople(r.perKm2)} per km²` });
    const pl = r.places[0];
    if (pl) out.push({ k: 'Nearest Place', v: pl.name, sub: `${titleCase(pl.kindLabel)} · ${at(pl)}` });
  }
  const b = v.sections?.buildings;
  if (b) {
    if (b.density) out.push({ k: 'BUA Here', v: titleCase(b.density.label), sub: b.height ?? b.size ?? null });
    // Security installations matter to the plan; services (post office, school) stay in the rows below.
    const s = b.security[0];
    if (s) out.push({ k: 'Security Site', v: titleCase(s.name ?? s.label), sub: `${s.name ? `${titleCase(s.label)} · ` : ''}${at(s)}` });
  }
  return out;
}

function factsC(v: GroundGuideVerdict): Fact[] {
  const c = v.cover;
  if (!c) return [];
  const lead: CoverField = c.focus ?? c.roseField;
  // The lead field is the answer block; the other three follow.
  const out: Fact[] = COVER_FIELDS.filter((f) => f !== lead).map((f) => {
    const from = c.from[f] ? titleCase(c.from[f] as string) : null;
    return { k: `${COVER_KIND[f]} · ${COVER_FIELD_LABEL[f]}`, v: COVER_WORD[c.levels[f]], sub: from, tone: coverTone(c.levels[f]) };
  });
  // Where to go for better: the nearest Fair or better of the lead field, or plainly none (never left to be guessed).
  const n = c.nearest[lead];
  if (n) out.unshift({ k: `Better ${COVER_KIND[lead]} Near`, v: COVER_WORD[n.level], sub: `${titleCase(n.label)}, ${at(n)}`, tone: coverTone(n.level) });
  else if (c.levels[lead] < 2) out.unshift({ k: `Better ${COVER_KIND[lead]} Near`, v: c.pending ? 'Loading' : 'None', sub: c.pending ? null : `Within ${fmtDistance(c.radiusM)}`, tone: c.pending ? null : 'c0' });
  return out;
}

const FACTS: Record<GrotbcLetter, (v: GroundGuideVerdict) => Fact[]> = { G: factsG, R: factsR, O: factsO, T: factsT, B: factsB, C: factsC };

// ── the answers ─────────────────────────────────────────────────────────────

function answerG(v: GroundGuideVerdict): LetterAnswer | null {
  const tone = verdictTone(v);
  const step = TONE_STEP[tone];
  const g = v.sections?.ground;
  const soil = v.going?.soil;
  const sub = [
    g ? titleCase(g.terrain?.label ?? g.land?.label ?? '') || null : null,
    g?.landform ? titleCase(g.landform) : null,
    g?.slopeDeg !== null && g?.slopeDeg !== undefined ? `${Math.round(g.slopeDeg)}° ${g.slopeBand ?? ''}`.trim() : null,
    soil ? soil.label.toLowerCase() : null,
  ].filter(Boolean).join(' · ');
  const label = `Gr for ${v.profileLabel}`;
  if (!step) return { label, parts: [{ text: 'Checking' }], sub: sub || null, tone: null, tab: 'Checking' };
  const parts: AnswerPart[] = [{ text: GOING_WORD[step], tone: step }];
  const pct = v.samples > 1 && v.fraction > 0 ? Math.max(1, Math.round(v.fraction * 100)) : 0;
  if (tone === 'marg') {
    const n = v.nearest;
    parts.push({ text: n && n.kind === 'no-go' && n.distanceM >= 1 ? `NO-GO ${at(n)}` : 'NO-GO at the edge', small: true });
  } else if (pct > 0) parts.push({ text: `${pct}% inside`, small: true });
  return { label, parts, sub: sub || null, tone: tone === 'marg' ? 'marg' : step, tab: GOING_WORD[step] };
}

function answerR(v: GroundGuideVerdict): LetterAnswer | null {
  const road = v.traffic?.road;
  const label = `Rds for ${v.profileLabel}`;
  if (road && road.caption === 'Landing') return { label: `Landing for ${v.profileLabel}`, parts: [{ text: road.text }], sub: null, tone: null, tab: 'Landing' };
  if (road?.main) {
    const m = road.main;
    const wetSlow = /SLOW-GO/i.test(m.tag ?? '');
    const tone: Tone = wetSlow ? 'slow' : 'go';
    return {
      label,
      parts: [{ text: m.shield, tone }, { text: at(m), small: true }],
      sub: [m.name ? titleCase(m.name) : null, m.tag, m.msr ? 'MSR' : null, road.alt ? `All-weather ${road.alt.shield} ${at(road.alt)}` : null].filter(Boolean).join(' · ') || null,
      tone,
      tab: `${m.shield} ${fmtDistance(m.distanceM)}`,
    };
  }
  if (road) {
    // "No Tankable Rd within 3.0 km": the word for the tab, the distance small; the mode then moves cross-country.
    const mm = /^(No .+?) within (.+)$/.exec(road.text);
    const word = mm ? mm[1] : road.text;
    return { label, parts: [{ text: word, tone: 'slow' }, ...(mm ? [{ text: `within ${mm[2]}`, small: true }] : [])], sub: 'Cross-country only from here', tone: 'slow', tab: word };
  }
  // A mode that does not use roads (vessel, rail): the route at the point.
  const rf = routeFact(v);
  if (!rf) return null;
  return { label: 'Route here', parts: [{ text: rf.v }], sub: rf.sub ?? null, tone: null, tab: rf.v };
}

function answerO(v: GroundGuideVerdict): LetterAnswer | null {
  const m = v.going?.movement;
  const top = obstacleHits(v)[0];
  const topLine = top ? `${titleCase(top[1].label)} ${at(top[1])}${top[1].effect ? ` · ${top[1].effect}` : ''}` : null;
  const label = `Obs for ${v.profileLabel}`;
  if (m) {
    const tone = ratingTone(m.rating);
    return { label, parts: [{ text: `${m.open} of 8`, tone }, { text: `Open Dirs to ${fmtDistance(m.rangeM / 2)}`, small: true }], sub: topLine, tone, tab: `${m.open} of 8 open` };
  }
  if (top) {
    const tone: Tone | null = top[1].effect === 'NO-GO' ? 'nogo' : top[1].effect === 'SLOW-GO' ? 'slow' : null;
    return { label, parts: [{ text: titleCase(top[1].label), tone }, { text: at(top[1]), small: true }], sub: top[1].effect ?? null, tone, tab: titleCase(top[1].label) };
  }
  return null;
}

function answerT(v: GroundGuideVerdict): LetterAnswer | null {
  const g = v.going;
  const p = g?.point;
  if (!g || !p) return null;
  const wet = g.season === 'wet';
  const now = wet ? p.wet : p.dry;
  const other = wet ? p.dry : p.wet;
  const limit = wet ? p.limitWet : p.limitDry;
  const otherWord = wet ? 'when dry' : 'after rain';
  return {
    label: `Going for ${v.profileLabel}`,
    parts:
      other === now
        ? [
            { text: GOING_WORD[now], tone: now },
            { text: `now and ${otherWord}`, small: true },
          ]
        : [
            { text: GOING_WORD[now], tone: now },
            { text: 'now ·', small: true },
            { text: GOING_WORD[other], tone: other },
            { text: otherWord, small: true },
          ],
    sub: limit ? `Limited by ${limit}` : null,
    tone: now,
    tab: other === now ? GOING_WORD[now] : `${GOING_WORD[now]} · ${wet ? 'dry' : 'wet'} ${GOING_WORD[other]}`,
  };
}

function answerB(v: GroundGuideVerdict): LetterAnswer | null {
  const p = v.population;
  const r = p?.reading;
  if (p?.flag) {
    return {
      label: 'Civil considerations',
      parts: [{ text: 'Civil flag', tone: 'warn' }, { text: `${fmtPeople(p.flag.people)} people within ${p.flag.km} km`, small: true }],
      sub: p.flag.message,
      tone: 'warn',
      tab: 'Civil flag',
      ring: true,
    };
  }
  if (r) return { label: 'People round it (est.)', parts: [{ text: r.cls.label }, { text: `${fmtPeople(r.perKm2)} per km² within ${r.radiusKm} km`, small: true }], sub: null, tone: null, tab: r.cls.label };
  const b = v.sections?.buildings;
  if (b?.density) return { label: 'BUA here', parts: [{ text: titleCase(b.density.label) }], sub: b.height ?? b.size ?? null, tone: null, tab: titleCase(b.density.label) };
  return null;
}

function answerC(v: GroundGuideVerdict): LetterAnswer | null {
  const c = v.cover;
  if (!c) return null;
  const f: CoverField = c.focus ?? c.roseField;
  const lvl = c.levels[f];
  const from = c.from[f] ? titleCase(c.from[f] as string) : null;
  return {
    label: `${COVER_KIND[f]} for ${v.profileLabel}`,
    parts: [{ text: COVER_WORD[lvl], tone: coverTone(lvl) }, { text: `from ${COVER_FIELD_LABEL[f]}`, small: true }],
    sub: [c.focus === f ? `Needed most by ${v.profileLabel}` : null, from].filter(Boolean).join(' · ') || null,
    tone: coverTone(lvl),
    tab: COVER_WORD[lvl],
  };
}

const ANSWERS: Record<GrotbcLetter, (v: GroundGuideVerdict) => LetterAnswer | null> = { G: answerG, R: answerR, O: answerO, T: answerT, B: answerB, C: answerC };

/** A letter's answer for its tab and strip, or null when the verdict has nothing for it yet. */
export function letterAnswer(tab: GrotbcLetter, v: GroundGuideVerdict | null): LetterAnswer | null {
  if (!v || v.verdict === 'off' || v.verdict === 'exempt' || v.verdict === 'unknown') return null;
  try {
    return ANSWERS[tab](v);
  } catch (err) {
    console.error('[Ground Guide] detail answer', tab, err);
    return null;
  }
}

/** The answer block that opens the strip (item 9): label, the big line in its colours, a plain line under it. */
function answerBlock(a: LetterAnswer): HTMLElement {
  const box = el('div', 'ms-ggd-ans');
  if (a.tone) box.dataset.tone = a.tone;
  box.append(el('div', 'ms-ggd-ans-l', a.label));
  const line = el('div', 'ms-ggd-ans-v');
  for (const p of a.parts) {
    const s = el(p.small ? 'small' : 'span', undefined, p.text);
    if (p.tone && !p.small) s.dataset.tone = p.tone;
    line.append(s);
  }
  box.append(line);
  if (a.sub) {
    const s = el('div', 'ms-ggd-ans-s', a.sub);
    s.title = a.sub;
    box.append(s);
  }
  return box;
}

/**
 * The strip for a letter, or null when the verdict has nothing for it (the tab then shows its own empty note): the
 * answer block, then at most six facts in the order the letter reads them.
 */
export function detailSummary(tab: GrotbcLetter, v: GroundGuideVerdict | null): HTMLElement | null {
  if (!v || v.verdict === 'off' || v.verdict === 'exempt' || v.verdict === 'unknown') return null;
  let facts: Fact[] = [];
  try {
    facts = FACTS[tab](v).filter((f) => f.v).slice(0, MAX_FACTS);
  } catch (err) {
    console.error('[Ground Guide] detail summary', tab, err);
  }
  return summaryStrip(letterAnswer(tab, v), facts);
}

/** The strip itself: an answer block, then the facts (the OCOKA lens builds its own answers and facts and draws them with this). */
export function summaryStrip(ans: LetterAnswer | null, facts: Fact[]): HTMLElement | null {
  facts = facts.filter((f) => f.v).slice(0, MAX_FACTS);
  if (!facts.length && !ans) return null;
  const strip = el('div', 'ms-ggd-sum-row');
  if (ans) strip.append(answerBlock(ans));
  for (const f of facts) {
    const cell = el('div', 'ms-ggd-fact');
    cell.append(el('div', 'ms-ggd-fk', f.k));
    const val = el('div', 'ms-ggd-fv');
    if (f.tone) {
      const dot = el('span', 'ms-ggd-fd');
      dot.dataset.tone = f.tone;
      val.append(dot);
      val.dataset.tone = f.tone;
    }
    val.append(f.v);
    cell.append(val);
    if (f.sub) {
      const s = el('div', 'ms-ggd-fs', f.sub);
      s.title = f.sub; // two lines at most: the whole of it on hover, and in Copy as Text
      cell.append(s);
    }
    strip.append(cell);
  }
  return strip;
}
