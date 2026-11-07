/**
 * GroundGuideDetailSummary.ts
 *
 * The answer strip at the head of each Ground Detail tab (added 2026-11-07, user: "each tab opens with a one-line
 * summary strip (the answer for that letter), then pictures, then the detail rows"). The first fact is the letter's
 * answer and reads largest; three to five key facts follow, so the planner has the letter in one look before the
 * dials and the rows below. Nothing is worked out here: every figure is a field the tiles under it already show, read
 * off the same verdict. A fact with a going step, a cover level or a route check carries a dot in its colour beside
 * the word, so the word still says it without the colour. Never overstates: a level is the spot's own, a missing
 * figure is left out rather than guessed.
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
import type { GoingStep, GroundGuideVerdict } from './GroundGuideTypes';

/** Colour of a fact's dot: a going step, a cover level, or a plain caution. */
type Tone = GoingStep | 'c0' | 'c1' | 'c2' | 'c3' | 'warn';

interface Fact {
  k: string;
  v: string;
  sub?: string | null;
  tone?: Tone | null;
}

const MAX_FACTS = 6;
/** Route check word per level (the R tile's own heads, in Title Case). */
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

// ── one function a letter ───────────────────────────────────────────────────

function factsG(v: GroundGuideVerdict): Fact[] {
  const out: Fact[] = [];
  const g = v.sections?.ground;
  if (g) {
    const terr = g.terrain?.label ?? g.land?.label ?? null;
    out.push({ k: 'Ground', v: terr ? titleCase(terr) : 'Not Recorded', sub: g.landform ? titleCase(g.landform) : null });
    if (g.elevationM !== null) {
      const high = g.high ? `High ground ${Math.round(g.high.elevationM).toLocaleString('en')} m, ${at(g.high)}` : null;
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
  if (r) {
    const x = r.route;
    out.push(
      x
        ? { k: 'Route', v: titleCase(x.typeLabel), sub: [x.on ? 'At the point' : at(x), x.msr ? 'MSR' : null].filter(Boolean).join(' · ') }
        : { k: 'Route', v: 'None Near', sub: 'No road or track within 500 m' },
    );
    if (r.check) out.push({ k: 'Route Check', v: CHECK_WORD[r.check.level], sub: r.check.text, tone: CHECK_TONE[r.check.level] });
  }
  const road = v.traffic?.road;
  if (road) {
    const m = road.main;
    if (m) out.push({ k: `${road.caption} for ${v.profileLabel}`, v: m.shield, sub: [at(m), m.name].filter(Boolean).join(' · ') });
    else if (road.distanceM !== null && road.compass) out.push({ k: `${road.caption} for ${v.profileLabel}`, v: `${fmtDistance(road.distanceM)} ${road.compass}`, sub: road.text });
  }
  const d = r?.density;
  if (d) {
    const per = d.leadIsAllWeather ? d.allWeatherDensity : d.density;
    out.push({ k: 'Road Density', v: d.lead.label, sub: `${per.toFixed(2)} km per km²${d.leadIsAllWeather ? ' after rain' : ''}` });
    const n = d.exitDirs.length;
    out.push({ k: 'Ways Out', v: n ? String(n) : 'None', sub: n ? d.exitDirs.join(' ') : `Within ${fmtDistance(d.radiusM)}`, tone: n <= 1 ? 'nogo' : n === 2 ? 'slow' : null });
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

function factsO(v: GroundGuideVerdict): Fact[] {
  const out: Fact[] = [];
  const o = v.sections?.obstacles;
  if (o) {
    // What stops the mode first, then what slows it, then the nearer: the answer to O is the obstacle that matters.
    const hits: Array<[string, ObstacleHit]> = [];
    if (o.natural) hits.push(['Natural Obstacle', o.natural]);
    if (o.manMade) hits.push(['Man-Made Obstacle', o.manMade]);
    hits.sort((a, b) => (EFFECT_RANK[b[1].effect ?? ''] ?? 0) - (EFFECT_RANK[a[1].effect ?? ''] ?? 0) || a[1].distanceM - b[1].distanceM);
    for (const [k, h] of hits) out.push(obstacleFact(k, h));
    if (o.wet) out.push({ k: 'Wet Ground', v: titleCase(o.wet), sub: 'At the point', tone: 'slow' });
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
  const m = v.going?.movement;
  if (m) {
    out.push({ k: 'Ways Open', v: `${m.open} of 8`, sub: `To ${fmtDistance(m.rangeM / 2)}`, tone: m.rating === 'unrestricted' ? 'go' : m.rating === 'restricted' ? 'slow' : 'nogo' });
  }
  return out;
}

function factsT(v: GroundGuideVerdict): Fact[] {
  const out: Fact[] = [];
  const g = v.going;
  const p = g?.point;
  if (g && p) {
    // The season in force first (it is the answer now), the other beside it.
    const wet = g.season === 'wet';
    const now = wet ? p.wet : p.dry;
    const other = wet ? p.dry : p.wet;
    const limit = wet ? p.limitWet : p.limitDry;
    out.push({ k: `Going Now · ${wet ? 'After Rain' : 'Dry'}`, v: GOING_WORD[now], sub: limit ? `Limited by ${limit}` : v.profileLabel, tone: now });
    out.push({ k: wet ? 'When Dry' : 'After Rain', v: GOING_WORD[other], sub: (wet ? p.limitDry : p.limitWet) ? `Limited by ${wet ? p.limitDry : p.limitWet}` : null, tone: other });
  }
  const m = g?.movement;
  if (m) out.push({ k: 'Movement', v: RATING_LABEL[m.rating], sub: `${m.open} of 8 directions open`, tone: m.rating === 'unrestricted' ? 'go' : m.rating === 'restricted' ? 'slow' : 'nogo' });
  const sp = v.speed;
  if (sp) {
    out.push({ k: `Speed · ${sp.short}`, v: sp.kmh === 0 ? 'NO-GO' : fmtKmh(sp.kmh), sub: 'Cross-country', tone: sp.kmh === 0 ? 'nogo' : null });
    let best: { minutes: number; compass: string } | null = null;
    for (const r of sp.rays ?? []) if (r.minutes !== null && (!best || r.minutes < best.minutes)) best = { minutes: r.minutes, compass: r.compass };
    if (best) out.push({ k: `Time to ${fmtDistance(sp.rangeM)}`, v: fmtMinutes(best.minutes), sub: `Fastest ${best.compass}` });
  }
  const road = v.traffic?.road?.main;
  if (road) out.push({ k: 'Way Out', v: road.shield, sub: at(road) });
  return out;
}

function factsB(v: GroundGuideVerdict): Fact[] {
  const out: Fact[] = [];
  const p = v.population;
  const r = p?.reading;
  if (r) {
    out.push({ k: `People · ${r.radiusKm} km (est.)`, v: fmtPeople(r.people), sub: `${r.cls.label} · ${fmtPeople(r.perKm2)} per km²` });
    if (p?.flag) out.push({ k: 'Civil Flag', v: 'Raised', sub: p.flag.message, tone: 'warn' });
    const pl = r.places[0];
    if (pl) out.push({ k: 'Nearest Place', v: pl.name, sub: `${titleCase(pl.kindLabel)} · ${at(pl)}` });
  }
  const b = v.sections?.buildings;
  if (b) {
    if (b.density) out.push({ k: 'Built-Up Here', v: titleCase(b.density.label), sub: b.height ?? b.size ?? null });
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
  const order: CoverField[] = [lead, ...COVER_FIELDS.filter((f) => f !== lead)];
  const out: Fact[] = order.map((f) => {
    const from = c.from[f] ? titleCase(c.from[f] as string) : null;
    // The field the mode needs most says so, so the planner knows why it leads.
    const sub = f === c.focus ? [`Needed by ${v.profileLabel}`, from].filter(Boolean).join(' · ') : from;
    return { k: `${COVER_KIND[f]} · ${COVER_FIELD_LABEL[f]}`, v: COVER_WORD[c.levels[f]], sub, tone: coverTone(c.levels[f]) };
  });
  // Where to go for better: the nearest Fair or better of the lead field, or plainly none (never left to be guessed).
  const n = c.nearest[lead];
  if (n) out.push({ k: `Better ${COVER_KIND[lead]} Near`, v: COVER_WORD[n.level], sub: `${titleCase(n.label)}, ${at(n)}`, tone: coverTone(n.level) });
  else if (c.levels[lead] < 2) out.push({ k: `Better ${COVER_KIND[lead]} Near`, v: c.pending ? 'Loading' : 'None', sub: c.pending ? null : `Within ${fmtDistance(c.radiusM)}`, tone: c.pending ? null : 'c0' });
  return out;
}

const FACTS: Record<GrotbcLetter, (v: GroundGuideVerdict) => Fact[]> = { G: factsG, R: factsR, O: factsO, T: factsT, B: factsB, C: factsC };

/**
 * The strip for a letter, or null when the verdict has nothing for it (the tab then shows its own empty note).
 * The first fact is the lead; at most six are shown, in the order the letter reads them.
 */
export function detailSummary(tab: GrotbcLetter, v: GroundGuideVerdict | null): HTMLElement | null {
  if (!v || v.verdict === 'off' || v.verdict === 'exempt' || v.verdict === 'unknown') return null;
  let facts: Fact[] = [];
  try {
    facts = FACTS[tab](v).filter((f) => f.v).slice(0, MAX_FACTS);
  } catch (err) {
    console.error('[Ground Guide] detail summary', tab, err);
    return null;
  }
  if (!facts.length) return null;
  const strip = el('div', 'ms-ggd-sum-row');
  facts.forEach((f, i) => {
    const cell = el('div', i === 0 ? 'ms-ggd-fact ms-lead' : 'ms-ggd-fact');
    cell.append(el('div', 'ms-ggd-fk', f.k));
    const val = el('div', 'ms-ggd-fv');
    if (f.tone) {
      const dot = el('span', 'ms-ggd-fd');
      dot.dataset.tone = f.tone;
      val.append(dot);
    }
    val.append(f.v);
    cell.append(val);
    if (f.sub) {
      const s = el('div', 'ms-ggd-fs', f.sub);
      s.title = f.sub; // the line is clamped: the whole of it on hover
      cell.append(s);
    }
    strip.append(cell);
  });
  return strip;
}
