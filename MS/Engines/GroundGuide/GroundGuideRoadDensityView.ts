/**
 * GroundGuideRoadDensityView.ts
 *
 * How the card shows road network density (GROTBC R, Road Connectivity), from `v.sections.roads.density`
 * (GroundGuideRoadDensity.ts). Every style is built and switchable live, so the owner can compare them
 * (ground-guide-road-density-options.html) and pick the default at the end:
 *
 *   `groundGuide.sections.roadDensityStyle`
 *     rows      D1  Density row (band word, km/km², all-weather) and Rds out row (the default)
 *     chip      D2  The band word alone on the R line
 *     gauge     D3  A 0-3 km/km² bar in the band tones, every road and all-weather marked
 *     rose      D4  Eight wedges round the point: where roads cross the circle, by road class (MSR / all-weather / fair)
 *     makeup    D5  Route classification: a bar of all-weather and fair-weather km, with MSR and tankable km
 *     sentence  D6  One sentence: band, figure, roads out and what it means
 *     brief     D7  Nothing on the card; the Ground Brief only
 *
 *   `groundGuide.sections.roadDensityLead` (which band the card leads with when tracks lift the total a band)
 *     afterRain  the lower, all-weather band, marked "after rain" (the default; safety first)
 *     dry        the band for every road and track
 *     both       two words, "Dense dry · Sparse after rain"
 *
 * "Rds out" (user, 2026-11-08, visual review item 10: one idea, one name, one number) counts the road crossings of the
 * circle and is always written as one phrase, "15 in 7 Dirs" (crossings in that many directions); "ways open" belongs
 * to cross-country directions in O and T and is never used here. Road classes keep off the verdict colours (item 16):
 * MSR white on a dark casing, all-weather blue, fair-weather / track violet; a density band is a quantity, not a
 * verdict, so its tones are a neutral steel ramp. The rose shares the round-picture frame and its key sits under it
 * (item 12). Sizes and colours from GroundGuideTokens.ts.
 *
 * The Ground Brief always shows it in full. DOM nodes and textContent only. CSS injected once.
 */

import { compassNode, joinNodes } from './GroundGuideNorth';
import {
  awDiffers,
  fmtDensity,
  fmtRadius,
  roadDensityMakeUp,
  roadDensityNote,
  type RoadDensityBand,
  type RoadDensityBandKey,
  type RoadDensityReading,
} from './GroundGuideRoadDensity';
import { ensureTokensCss, FONT, FS, FW, LINE, ROAD, ROSE_PX, ROSE_R, roseFrame, roseHub, roseKey, TEXT, wedgePath } from './GroundGuideTokens';

export type RoadDensityStyle = 'rows' | 'chip' | 'gauge' | 'rose' | 'makeup' | 'sentence' | 'brief';
export const ROAD_DENSITY_STYLES: readonly RoadDensityStyle[] = ['rows', 'chip', 'gauge', 'rose', 'makeup', 'sentence', 'brief'];
export type RoadDensityLead = 'afterRain' | 'dry' | 'both';
export const ROAD_DENSITY_LEADS: readonly RoadDensityLead[] = ['afterRain', 'dry', 'both'];

const STYLE_ID = 'ms-ground-guide-road-density-style';
const COMPASS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/**
 * Band tones, [background of a note, the band's word on the dark card]. A band is how much road there is, not a
 * verdict (item 16), so the tones run on one neutral steel-blue ramp: nothing here reads as GO or NO-GO.
 */
export const DENSITY_COLOURS: Record<RoadDensityBandKey, [string, string]> = {
  none: ['#262b31', TEXT.label],
  sparse: ['#232a32', '#b3c0cc'],
  moderate: ['#212b36', '#bccfe0'],
  dense: ['#1f2c3a', '#c9dcee'],
  veryDense: ['#1d2e40', '#dde9f6'],
};
/** The gauge's segments, the same ramp darker to lighter as the road net thickens. */
const DENSITY_RAMP: Record<RoadDensityBandKey, string> = {
  none: '#3a434e',
  sparse: '#4b5967',
  moderate: '#677a8d',
  dense: '#8ba1b6',
  veryDense: '#b4c7d9',
};
/** A crossing's road class: MSR (white, cased), all-weather (blue), fair-weather or track (violet); none a faint stub. */
const EXIT_COLOUR = { msr: ROAD.msr, aw: ROAD.allWeather, fair: ROAD.fairWeather, none: LINE.soft };
const FAIR_LABEL = 'Fair-weather / Tr';
/** The gauge runs to this many km/km²; anything above sits at the end. */
const GAUGE_MAX = 3;

const CSS = `
.ms-grd-chip{font-weight:${FW.semi};white-space:nowrap}
.ms-grd-s{color:${TEXT.label}}
.ms-grd-soft{color:${TEXT.label};font-size:${FS.meta}px;margin-top:4px;line-height:1.35}
.ms-grd-soft b{color:${TEXT.main};font-weight:${FW.semi}}
.ms-grd-line{font-size:${FS.meta}px;line-height:1.35;margin-top:5px;color:${TEXT.main}}
.ms-grd-line b{color:${TEXT.strong};font-weight:${FW.semi}}
.ms-grd-gauge{position:relative;height:22px;margin-top:6px}
.ms-grd-gauge>.ms-grd-track{position:absolute;left:0;right:0;top:7px;height:8px;border-radius:2px;overflow:hidden;display:flex}
.ms-grd-gauge>.ms-grd-track>i{display:block;height:100%}
.ms-grd-gauge>.ms-grd-mk{position:absolute;top:0;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:7px solid ${TEXT.main};margin-left:-5px}
.ms-grd-gauge>.ms-grd-mk.ms-aw{top:15px;border-top:0;border-bottom:7px solid ${ROAD.allWeather}}
.ms-grd-ticks{position:relative;height:15px;font:${FW.regular} ${FS.meta}px/1 ${FONT};color:${TEXT.label}}
.ms-grd-ticks>span{position:absolute;transform:translateX(-50%);white-space:nowrap}
.ms-grd-rose{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:flex-start;margin-top:5px}
.ms-grd-pic{flex:none;display:flex;flex-direction:column;align-items:center;max-width:${ROSE_PX + 50}px}
.ms-grd-pic>svg{flex:none}
.ms-grd-rose>.ms-grd-txt{flex:1 1 120px;min-width:0;font-size:${FS.meta}px;line-height:1.4;color:${TEXT.main}}
.ms-grd-rose b{color:${TEXT.strong};font-weight:${FW.semi}}
.ms-grd-key{display:flex;gap:4px 10px;flex-wrap:wrap;font-size:${FS.meta}px;color:${TEXT.label};margin-top:4px}
.ms-grd-dot{display:inline-block;width:12px;height:5px;border-radius:2px;margin-right:4px;vertical-align:middle}
.ms-grd-dot.ms-cased{background:${ROAD.msr};box-shadow:0 0 0 1.5px ${ROAD.msrCasing}}
.ms-grd-bar{display:flex;height:9px;border-radius:2px;overflow:hidden;background:${LINE.soft};margin-top:6px}
.ms-grd-bar>i{display:block;height:100%}
.ms-grd-mu{display:flex;gap:4px 12px;flex-wrap:wrap;font-size:${FS.meta}px;color:${TEXT.label};margin-top:4px}
.ms-grd-mu b{color:${TEXT.strong};font-weight:${FW.semi}}
`;

export function ensureRoadDensityCss(): void {
  ensureTokensCss();
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

function b(text: string): HTMLElement {
  return el('b', undefined, text);
}

function frag(...parts: Array<Node | string | null | false>): DocumentFragment {
  const f = document.createDocumentFragment();
  for (const p of parts) if (p !== null && p !== false && p !== '') f.append(p);
  return f;
}

function soft(text: string): HTMLElement {
  const s = el('span', 'ms-grd-s', text);
  s.style.color = TEXT.label;
  return s;
}

// ── Rds out: one name, one phrase ────────────────────────────────────────────
/** "15 in 7 Dirs": the road crossings of the circle and how many directions they leave in (item 10). */
export function rdsOutPhrase(d: RoadDensityReading): string {
  const n = d.exits.length;
  const k = d.exitDirs.length;
  return `${n} in ${k} Dir${k === 1 ? '' : 's'}`;
}

/** The same in full words, for sentences, tooltips and aria-labels. */
function rdsOutWords(d: RoadDensityReading): string {
  const n = d.exits.length;
  const k = d.exitDirs.length;
  return n ? `${n} road crossing${n === 1 ? '' : 's'} of the circle in ${k} direction${k === 1 ? '' : 's'}` : 'no road crosses the circle';
}

// ── Lead band ────────────────────────────────────────────────────────────────
interface LeadChip {
  band: RoadDensityBand;
  label: string;
}

/** The band word(s) the card leads with under the `lead` rule. */
export function leadChips(d: RoadDensityReading, lead: RoadDensityLead): LeadChip[] {
  if (!d.leadIsAllWeather) return [{ band: d.band, label: d.band.label }];
  if (lead === 'dry') return [{ band: d.band, label: d.band.label }];
  if (lead === 'both') return [{ band: d.band, label: `${d.band.label} dry` }, { band: d.allWeatherBand, label: `${d.allWeatherBand.label} after rain` }];
  return [{ band: d.allWeatherBand, label: `${d.allWeatherBand.label} after rain` }];
}

/** The band whose meaning the card gives (the lowest it shows). */
function leadBand(d: RoadDensityReading, lead: RoadDensityLead): RoadDensityBand {
  const c = leadChips(d, lead);
  return c[c.length - 1].band;
}

/** A band as a word in its tone (item 13: a coloured word, no pill box), its meaning in the tooltip. */
function chip(c: LeadChip, note: string): HTMLElement {
  const e = el('span', 'ms-grd-chip', c.label);
  e.style.color = DENSITY_COLOURS[c.band.key][1];
  e.title = note;
  return e;
}

export function chipsNode(d: RoadDensityReading, lead: RoadDensityLead): DocumentFragment {
  ensureRoadDensityCss();
  const note = roadDensityNote(d);
  return joinNodes(leadChips(d, lead).map((c) => chip(c, note)), ' · ');
}

/** "Rd density dense · Rds out 15 in 7 Dirs" / "Rd density sparse after rain · …" for a one-line R. */
export function densityOneLine(d: RoadDensityReading, lead: RoadDensityLead): string {
  const out = d.exits.length ? ` · Rds out ${rdsOutPhrase(d)}` : '';
  return `Rd density ${leadChips(d, lead).map((c) => c.label.toLowerCase()).join(', ')}${out}`;
}

/**
 * The figure beside the band word, and the rest after "km/km² within 5 km". The bold figure always belongs to the band
 * the word shows, so "Moderate after rain" never sits next to the higher every-road figure.
 */
export function densityFigure(d: RoadDensityReading, lead: RoadDensityLead): [string, string] {
  const all = fmtDensity(d.density), aw = fmtDensity(d.allWeatherDensity);
  if (!d.leadIsAllWeather || lead === 'dry') return [all, awDiffers(d) ? `, all-weather ${aw}` : ''];
  if (lead === 'both') return [`${all} / ${aw}`, ' (dry / after rain)'];
  return [aw, ` all-weather, ${all} with Trs`];
}

function figureNode(d: RoadDensityReading, lead: RoadDensityLead, tail = ''): DocumentFragment {
  const [main, rest] = densityFigure(d, lead);
  return frag(b(main), soft(` km/km² within ${fmtRadius(d.radiusM)}${rest}${tail}`));
}

// ── D1 rows ──────────────────────────────────────────────────────────────────
function densityValue(d: RoadDensityReading, lead: RoadDensityLead): Node {
  if (d.band.key === 'none') return frag(chipsNode(d, lead), soft(` · no Rd or Tr within ${fmtRadius(d.radiusM)}`));
  return frag(chipsNode(d, lead), ' ', figureNode(d, lead));
}

/** "15 in 7 Dirs · NE, E, SE … · all all-weather · 2 on an MSR"; null when no road is in the circle. */
export function exitsValue(d: RoadDensityReading): string | null {
  if (d.band.key === 'none' && !d.exits.length) return null;
  const n = d.exits.length;
  if (!n) return 'None: no Rd crosses the circle';
  const allAw = d.exits.every((e) => e.allWeather);
  const aw = allAw ? ' · all all-weather' : d.allWeatherExitDirs.length ? ` · all-weather ${d.allWeatherExitDirs.join(', ')}` : ' · none all-weather';
  const msr = d.exits.filter((e) => e.msr).length;
  return `${rdsOutPhrase(d)} · ${d.exitDirs.join(', ')}${aw}${msr ? ` · ${msr} on an MSR` : ''}`;
}

/** Label / value rows for the R section's grid (`full` adds the route classification, for the Brief). */
export function densityRows(d: RoadDensityReading | null, lead: RoadDensityLead, full = false): Array<[string, Node | string | null]> {
  if (!d) return [];
  return [
    ['Density', densityValue(d, lead)],
    ...(full ? ([['Route Class', roadDensityMakeUp(d)]] as Array<[string, Node | string | null]>) : []),
    ['Rds out', exitsValue(d)],
  ];
}

// ── D3 gauge ─────────────────────────────────────────────────────────────────
export function densityGauge(d: RoadDensityReading, lead: RoadDensityLead): HTMLElement {
  ensureRoadDensityCss();
  const box = el('div');
  const g = el('div', 'ms-grd-gauge');
  const track = el('div', 'ms-grd-track');
  const steps = d.bands.filter((x) => x.key !== 'none');
  const bounds: Array<[RoadDensityBandKey, number, number]> = steps.map((x, i) => [x.key, i === 0 ? 0 : x.fromKmPerKm2, Math.min(GAUGE_MAX, steps[i + 1]?.fromKmPerKm2 ?? GAUGE_MAX)]);
  for (const [k, lo, hi] of bounds) {
    const i = el('i');
    i.style.width = `${((hi - lo) / GAUGE_MAX) * 100}%`;
    i.style.background = DENSITY_RAMP[k];
    track.append(i);
  }
  g.append(track);
  const at = (v: number) => `${(Math.min(GAUGE_MAX, v) / GAUGE_MAX) * 100}%`;
  const mk = el('i', 'ms-grd-mk');
  mk.style.left = at(d.density);
  mk.title = `Every road and track: ${fmtDensity(d.density)} km/km²`;
  g.append(mk);
  if (awDiffers(d)) {
    const ma = el('i', 'ms-grd-mk ms-aw');
    ma.style.left = at(d.allWeatherDensity);
    ma.title = `All-weather: ${fmtDensity(d.allWeatherDensity)} km/km²`;
    g.append(ma);
  }
  const ticks = el('div', 'ms-grd-ticks');
  for (const v of [0, ...steps.slice(1).map((x) => x.fromKmPerKm2).filter((x) => x < GAUGE_MAX), GAUGE_MAX]) {
    const t = el('span', undefined, v === GAUGE_MAX ? `${v}+` : String(v));
    t.style.left = at(v);
    if (v === 0) t.style.transform = 'none';
    if (v === GAUGE_MAX) t.style.transform = 'translateX(-100%)';
    ticks.append(t);
  }
  const line = el('div', 'ms-grd-line');
  line.append(chipsNode(d, lead), ' ', figureNode(d, lead));
  box.append(line, g, ticks);
  const k = el('div', 'ms-grd-key');
  k.append(el('span', undefined, '▼ every Rd'));
  if (awDiffers(d)) {
    const a = el('span', undefined, '▲ all-weather');
    a.style.color = ROAD.allWeather;
    k.append(a);
  }
  box.append(k);
  return box;
}

// ── D4 rose ──────────────────────────────────────────────────────────────────
/** The classes a rose draws, for its key: only those it shows. */
interface RoseClasses {
  msr: boolean;
  aw: boolean;
  fair: boolean;
}

/**
 * Rds out as a pie on the shared frame (item 12): a wedge per compass point, as long as the crossings it holds
 * (1, 2, 3 and more), coloured by the best road class in it. North up in the turning group; the frame keeps N upright.
 */
function exitRose(d: RoadDensityReading): { svg: SVGSVGElement; classes: RoseClasses } {
  const f = roseFrame(`Roads out: ${rdsOutWords(d)}`);
  const r0 = 9;
  const sectors = COMPASS8.map(() => ({ n: 0, msr: false, aw: false }));
  for (const e of d.exits) {
    const x = sectors[Math.round(e.bearingDeg / 45) % 8];
    x.n++;
    x.msr ||= e.msr;
    x.aw ||= e.allWeather;
  }
  const classes: RoseClasses = { msr: false, aw: false, fair: false };
  sectors.forEach((x, i) => {
    const reach = x.n === 0 ? 0.14 : x.n === 1 ? 0.55 : x.n === 2 ? 0.78 : 1;
    const r = r0 + (ROSE_R - r0) * reach;
    const attrs: Record<string, string | number> =
      x.n === 0 ? { fill: EXIT_COLOUR.none }
      : x.msr ? { fill: EXIT_COLOUR.msr, stroke: ROAD.msrCasing, 'stroke-width': 1.5, 'stroke-linejoin': 'round' }
      : { fill: x.aw ? EXIT_COLOUR.aw : EXIT_COLOUR.fair };
    if (x.n) {
      if (x.msr) classes.msr = true;
      else if (x.aw) classes.aw = true;
      else classes.fair = true;
    }
    const w = f.add('path', { d: wedgePath(r0, r, i * 45 - 20, i * 45 + 20), ...attrs });
    if (x.n) f.add('title', {}, w, `${COMPASS8[i]}: ${x.n} road crossing${x.n === 1 ? '' : 's'}, ${x.msr ? 'MSR' : x.aw ? 'all-weather' : 'fair-weather or track'}`);
  });
  roseHub(f, r0 - 2);
  return { svg: f.svg, classes };
}

/** The key under the rose: the classes it draws, in their road colours. */
function roseClassKey(c: RoseClasses): HTMLElement {
  const parts: Array<[string, string]> = [];
  if (c.msr) parts.push(['cased', 'MSR']);
  if (c.aw) parts.push([ROAD.allWeather, 'All-weather']);
  if (c.fair) parts.push([ROAD.fairWeather, FAIR_LABEL]);
  return roseKey(parts.length ? parts : 'No Rd crosses the circle');
}

export function densityRose(d: RoadDensityReading, lead: RoadDensityLead): HTMLElement {
  ensureRoadDensityCss();
  const box = el('div', 'ms-grd-rose');
  const rose = exitRose(d);
  const pic = el('div', 'ms-grd-pic');
  pic.append(rose.svg, roseClassKey(rose.classes));
  const t = el('div', 'ms-grd-txt');
  const l1 = el('div');
  l1.append(chipsNode(d, lead));
  const l2 = el('div');
  l2.append(figureNode(d, lead));
  const n = d.exits.length;
  const l3 = el('div');
  l3.title = `Roads out: ${rdsOutWords(d)}`;
  l3.append(soft('Rds out '), b(n ? rdsOutPhrase(d) : 'None'));
  if (n) l3.append(soft(' · '), joinNodes(d.exitDirs.map((c) => compassNode(c)), ', '));
  t.append(l1, l2, l3);
  const closed = COMPASS8.filter((c) => !d.exitDirs.includes(c));
  if (n && closed.length) {
    const none = el('div', 'ms-grd-soft', 'No Rd out to the ');
    none.append(joinNodes(closed.map((c) => compassNode(c)), ', '));
    t.append(none);
  }
  box.append(pic, t);
  return box;
}

// ── D5 route classification ──────────────────────────────────────────────────
export function densityMakeup(d: RoadDensityReading, lead: RoadDensityLead): HTMLElement {
  ensureRoadDensityCss();
  const box = el('div');
  const line = el('div', 'ms-grd-line');
  line.append(chipsNode(d, lead), ' ', figureNode(d, lead, ` · ${Math.round(d.totalKm)} km of Rd`));
  box.append(line);
  if (d.totalKm > 0) {
    const bar = el('div', 'ms-grd-bar');
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', `All-weather ${Math.round(d.allWeatherKm)} km, fair-weather or track ${Math.round(d.fairKm)} km`);
    for (const [km, c] of [[d.allWeatherKm, EXIT_COLOUR.aw], [d.fairKm, EXIT_COLOUR.fair]] as const) {
      if (km <= 0) continue;
      const i = el('i');
      i.style.width = `${(km / d.totalKm) * 100}%`;
      i.style.background = c;
      bar.append(i);
    }
    box.append(bar);
    const mu = el('div', 'ms-grd-mu');
    const km = (v: number) => (v < 10 ? v.toFixed(1) : String(Math.round(v)));
    // A swatch only where the bar or the map draws that class; tankable is a load class, not a colour.
    const item = (swatch: string | null, lab: string, v: number) => {
      const s = el('span');
      if (swatch) {
        const dot = el('span', `ms-grd-dot${swatch === 'cased' ? ' ms-cased' : ''}`);
        if (swatch !== 'cased') dot.style.background = swatch;
        s.append(dot);
      }
      s.append(`${lab} `, b(`${km(v)} km`));
      return s;
    };
    mu.append(item(EXIT_COLOUR.aw, 'All-weather', d.allWeatherKm), item(EXIT_COLOUR.fair, FAIR_LABEL, d.fairKm), item('cased', 'MSR', d.msrKm), item(null, 'Tankable', d.tankableKm));
    box.append(mu);
  }
  return box;
}

// ── D6 sentence ──────────────────────────────────────────────────────────────
export function densitySentence(d: RoadDensityReading, lead: RoadDensityLead): string {
  const band = leadBand(d, lead);
  if (d.band.key === 'none') return `No road or track within ${fmtRadius(d.radiusM)}: cross-country only.`;
  const chips = leadChips(d, lead).map((c) => c.label).join(', ');
  const n = d.exits.length;
  const k = d.exitDirs.length;
  const exits = n
    ? `roads out ${n} in ${k} direction${k === 1 ? '' : 's'}${d.exits.every((e) => e.allWeather) ? ', all all-weather' : d.allWeatherExitDirs.length ? `, all-weather to the ${d.allWeatherExitDirs.join(', ')}` : ', none all-weather'}`
    : 'no road crosses the circle';
  const [main, rest] = densityFigure(d, lead);
  return `${chips} road net (${main} km/km² within ${fmtRadius(d.radiusM)}${rest}): ${exits}. ${band.note}`;
}

/**
 * The density block for the card under `style` (null for `rows`, which go into the R grid, and for `brief`).
 * `compact` is the sections style: in one-line R the `chip` style sits on the line instead of a block.
 */
export function densityCardBlock(d: RoadDensityReading | null | undefined, style: RoadDensityStyle, lead: RoadDensityLead): HTMLElement | null {
  if (!d || style === 'rows' || style === 'brief' || style === 'chip') return null;
  ensureRoadDensityCss();
  if (style === 'gauge') return densityGauge(d, lead);
  if (style === 'rose') return densityRose(d, lead);
  if (style === 'makeup') return densityMakeup(d, lead);
  const p = el('div', 'ms-grd-line', densitySentence(d, lead));
  return p;
}

/** The Ground Brief block: rows with the route classification, the Rds out rose, what the band means. */
export function densityBrief(d: RoadDensityReading, kv: (rows: Array<[string, Node | string | null]>) => HTMLElement | null): HTMLElement {
  ensureRoadDensityCss();
  const w = el('div');
  const g = kv(densityRows(d, 'both', true));
  if (g) w.append(g);
  if (d.exits.length) w.append(densityRose(d, 'both'));
  const note = el('div', 'ms-grd-soft');
  note.style.cssText = `margin-top:6px;border-radius:5px;padding:4px 7px;background:${DENSITY_COLOURS[d.lead.key][0]};color:${DENSITY_COLOURS[d.lead.key][1]}`;
  note.textContent = roadDensityNote(d);
  w.append(note);
  return w;
}
