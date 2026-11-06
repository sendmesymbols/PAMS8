/**
 * GroundGuideRoadDensityView.ts
 *
 * How the card shows road network density (GROTBC R, Road Connectivity), from `v.sections.roads.density`
 * (GroundGuideRoadDensity.ts). Every style is built and switchable live, so the owner can compare them
 * (ground-guide-road-density-options.html) and pick the default at the end:
 *
 *   `groundGuide.sections.roadDensityStyle`
 *     rows      D1  Density row (band chip, km/km², all-weather) and Ways out row (the default)
 *     chip      D2  The band chip alone on the R line
 *     gauge     D3  A 0-3 km/km² bar in the band colours, every road and all-weather marked
 *     rose      D4  Eight wedges round the point: where roads leave the circle, coloured MSR / all-weather / fair
 *     makeup    D5  A bar of all-weather and fair-weather km, with MSR and tankable km
 *     sentence  D6  One sentence: band, figure, ways out and what it means
 *     brief     D7  Nothing on the card; the Ground Brief only
 *
 *   `groundGuide.sections.roadDensityLead` (which band the card leads with when tracks lift the total a band)
 *     afterRain  the lower, all-weather band, marked "after rain" (the default; safety first)
 *     dry        the band for every road and track
 *     both       two chips, "Dense dry" and "Sparse after rain"
 *
 * The Ground Brief always shows it in full. DOM nodes and textContent only. CSS injected once.
 */

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

export type RoadDensityStyle = 'rows' | 'chip' | 'gauge' | 'rose' | 'makeup' | 'sentence' | 'brief';
export const ROAD_DENSITY_STYLES: readonly RoadDensityStyle[] = ['rows', 'chip', 'gauge', 'rose', 'makeup', 'sentence', 'brief'];
export type RoadDensityLead = 'afterRain' | 'dry' | 'both';
export const ROAD_DENSITY_LEADS: readonly RoadDensityLead[] = ['afterRain', 'dry', 'both'];

const STYLE_ID = 'ms-ground-guide-road-density-style';
const SVG = 'http://www.w3.org/2000/svg';
const COMPASS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Band chips: few roads (canalised) warm, many roads cool. [background, text]. */
export const DENSITY_COLOURS: Record<RoadDensityBandKey, [string, string]> = {
  none: ['#3d1c1e', '#ff8a8d'],
  sparse: ['#3a2a14', '#ffb766'],
  moderate: ['#2e2a1c', '#ffd27a'],
  dense: ['#1d3a2a', '#7ee0a5'],
  veryDense: ['#1c2c3d', '#8cc4ff'],
};
/** Exits: MSR, all-weather, fair-weather only. */
const EXIT_COLOUR = { msr: '#d64541', aw: '#3fc07a', fair: '#f0a04b', none: 'rgba(255,255,255,.08)' };
/** The gauge runs to this many km/km²; anything above sits at the end. */
const GAUGE_MAX = 3;

const CSS = `
.ms-grd-chip{display:inline-block;font:700 9px/1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:.05em;text-transform:uppercase;padding:3px 6px 2px;border-radius:999px;vertical-align:1px;white-space:nowrap}
.ms-grd-chip+.ms-grd-chip{margin-left:4px}
.ms-grd-soft{color:#9aa3ad;font-size:11px;margin-top:4px;line-height:1.35}
.ms-grd-soft b{color:#e8ebee;font-weight:600}
.ms-grd-line{font-size:11.5px;line-height:1.35;margin-top:5px}
.ms-grd-line b{color:#fff;font-weight:600}
.ms-grd-line .ms-grd-s{color:#9aa3ad}
.ms-grd-gauge{position:relative;height:22px;margin-top:6px}
.ms-grd-gauge>.ms-grd-track{position:absolute;left:0;right:0;top:7px;height:8px;border-radius:2px;overflow:hidden;display:flex}
.ms-grd-gauge>.ms-grd-track>i{display:block;height:100%}
.ms-grd-gauge>.ms-grd-mk{position:absolute;top:0;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:7px solid #fff;margin-left:-5px}
.ms-grd-gauge>.ms-grd-mk.ms-aw{top:15px;border-top:0;border-bottom:7px solid #3fc07a}
.ms-grd-ticks{position:relative;height:11px;font:9.5px/1 system-ui,Segoe UI,Arial,sans-serif;color:#7f8994}
.ms-grd-ticks>span{position:absolute;transform:translateX(-50%)}
.ms-grd-rose{display:flex;gap:10px;align-items:center;margin-top:5px}
.ms-grd-rose>svg{flex:none}
.ms-grd-rose>div{min-width:0;font-size:11.5px;line-height:1.35}
.ms-grd-rose b{color:#fff;font-weight:600}
.ms-grd-key{display:flex;gap:8px;flex-wrap:wrap;font-size:10px;color:#9aa3ad;margin-top:4px}
.ms-grd-dot{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;vertical-align:0}
.ms-grd-bar{display:flex;height:9px;border-radius:2px;overflow:hidden;background:rgba(255,255,255,.08);margin-top:6px}
.ms-grd-bar>i{display:block;height:100%}
.ms-grd-mu{display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:#c3cbd3;margin-top:4px}
.ms-grd-mu b{color:#fff;font-weight:600}
`;

export function ensureRoadDensityCss(): void {
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

function sv(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(SVG, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
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

// ── Lead band ────────────────────────────────────────────────────────────────
interface LeadChip {
  band: RoadDensityBand;
  label: string;
}

/** The chip(s) the card leads with under the `lead` rule. */
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

function chip(c: LeadChip, note: string): HTMLElement {
  const e = el('span', 'ms-grd-chip', c.label);
  e.style.background = DENSITY_COLOURS[c.band.key][0];
  e.style.color = DENSITY_COLOURS[c.band.key][1];
  e.title = note;
  return e;
}

export function chipsNode(d: RoadDensityReading, lead: RoadDensityLead): DocumentFragment {
  ensureRoadDensityCss();
  const note = roadDensityNote(d);
  return frag(...leadChips(d, lead).map((c) => chip(c, note)));
}

/** "road density dense" / "road density sparse after rain" for a one-line R. */
export function densityOneLine(d: RoadDensityReading, lead: RoadDensityLead): string {
  return `road density ${leadChips(d, lead).map((c) => c.label.toLowerCase()).join(', ')}`;
}

/**
 * The figure beside the chip, and the rest after "km/km² within 5 km". The bold figure always belongs to the band the
 * chip shows, so "Moderate after rain" never sits next to the higher every-road figure.
 */
export function densityFigure(d: RoadDensityReading, lead: RoadDensityLead): [string, string] {
  const all = fmtDensity(d.density), aw = fmtDensity(d.allWeatherDensity);
  if (!d.leadIsAllWeather || lead === 'dry') return [all, awDiffers(d) ? `, all-weather ${aw}` : ''];
  if (lead === 'both') return [`${all} / ${aw}`, ' (dry / after rain)'];
  return [aw, ` all-weather, ${all} with tracks`];
}

function figureNode(d: RoadDensityReading, lead: RoadDensityLead, tail = ''): DocumentFragment {
  const [main, rest] = densityFigure(d, lead);
  return frag(b(main), soft(` km/km² within ${fmtRadius(d.radiusM)}${rest}${tail}`));
}

// ── D1 rows ──────────────────────────────────────────────────────────────────
function densityValue(d: RoadDensityReading, lead: RoadDensityLead): Node {
  if (d.band.key === 'none') return frag(chipsNode(d, lead), soft(` no road or track within ${fmtRadius(d.radiusM)}`));
  return frag(chipsNode(d, lead), ' ', figureNode(d, lead));
}

function soft(text: string): HTMLElement {
  const s = el('span', 'ms-grd-s', text);
  s.style.color = '#9aa3ad';
  return s;
}

/** "11: NE, E, SE … · all all-weather · 2 on an MSR"; null when no road is in the circle. */
export function exitsValue(d: RoadDensityReading): string | null {
  if (d.band.key === 'none' && !d.exits.length) return null;
  const n = d.exits.length;
  if (!n) return 'None: no road leaves the circle';
  const allAw = d.exits.every((e) => e.allWeather);
  const aw = allAw ? ' · all all-weather' : d.allWeatherExitDirs.length ? ` · all-weather ${d.allWeatherExitDirs.join(', ')}` : ' · none all-weather';
  const msr = d.exits.filter((e) => e.msr).length;
  return `${n}: ${d.exitDirs.join(', ')}${aw}${msr ? ` · ${msr} on an MSR` : ''}`;
}

/** Label / value rows for the R section's grid (`full` adds the make-up, for the Brief). */
export function densityRows(d: RoadDensityReading | null, lead: RoadDensityLead, full = false): Array<[string, Node | string | null]> {
  if (!d) return [];
  return [
    ['Density', densityValue(d, lead)],
    ...(full ? ([['Make-up', roadDensityMakeUp(d)]] as Array<[string, Node | string | null]>) : []),
    ['Ways out', exitsValue(d)],
  ];
}

// ── D3 gauge ─────────────────────────────────────────────────────────────────
export function densityGauge(d: RoadDensityReading, lead: RoadDensityLead): HTMLElement {
  const box = el('div');
  const g = el('div', 'ms-grd-gauge');
  const track = el('div', 'ms-grd-track');
  const steps = d.bands.filter((x) => x.key !== 'none');
  const bounds: Array<[RoadDensityBandKey, number, number]> = steps.map((x, i) => [x.key, i === 0 ? 0 : x.fromKmPerKm2, Math.min(GAUGE_MAX, steps[i + 1]?.fromKmPerKm2 ?? GAUGE_MAX)]);
  for (const [k, lo, hi] of bounds) {
    const i = el('i');
    i.style.width = `${((hi - lo) / GAUGE_MAX) * 100}%`;
    i.style.background = DENSITY_COLOURS[k][1];
    i.style.opacity = '.55';
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
  k.append(el('span', undefined, '▼ every road'));
  if (awDiffers(d)) {
    const a = el('span', undefined, '▲ all-weather');
    a.style.color = '#3fc07a';
    k.append(a);
  }
  box.append(k);
  return box;
}

// ── D4 rose ──────────────────────────────────────────────────────────────────
function exitRose(d: RoadDensityReading, size: number, centre: RoadDensityBand): SVGElement {
  const cx = size / 2, r0 = size * 0.16, R = size / 2 - 3;
  const s = sv('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
  s.append(sv('circle', { cx, cy: cx, r: R, fill: 'none', stroke: 'rgba(255,255,255,.12)' }));
  const P = (a: number, r: number) => `${(cx + r * Math.sin(a)).toFixed(1)} ${(cx - r * Math.cos(a)).toFixed(1)}`;
  const sectors = COMPASS8.map(() => ({ n: 0, msr: false, aw: false }));
  for (const e of d.exits) {
    const x = sectors[Math.round(e.bearingDeg / 45) % 8];
    x.n++;
    x.msr ||= e.msr;
    x.aw ||= e.allWeather;
  }
  sectors.forEach((x, i) => {
    const a0 = ((i * 45 - 20) * Math.PI) / 180, a1 = ((i * 45 + 20) * Math.PI) / 180;
    const reach = x.n === 0 ? 0.18 : x.n === 1 ? 0.55 : x.n === 2 ? 0.78 : 1;
    const r = r0 + (R - r0) * reach;
    const fill = x.n === 0 ? EXIT_COLOUR.none : x.msr ? EXIT_COLOUR.msr : x.aw ? EXIT_COLOUR.aw : EXIT_COLOUR.fair;
    s.append(sv('path', { d: `M ${P(a0, r0)} L ${P(a0, r)} A ${r} ${r} 0 0 1 ${P(a1, r)} L ${P(a1, r0)} A ${r0} ${r0} 0 0 0 ${P(a0, r0)} Z`, fill }));
  });
  s.append(
    sv('circle', { cx, cy: cx, r: r0 - 2, fill: DENSITY_COLOURS[centre.key][1], stroke: '#fff', 'stroke-width': 1.2 }),
    sv('path', { d: `M ${cx} 1 l 3.5 6 h -7 z`, fill: '#fff' }),
  );
  return s;
}

export function densityRose(d: RoadDensityReading, lead: RoadDensityLead): HTMLElement {
  const box = el('div');
  const row = el('div', 'ms-grd-rose');
  const t = el('div');
  const l1 = el('div');
  l1.append(chipsNode(d, lead));
  const l2 = el('div');
  l2.append(figureNode(d, lead));
  const n = d.exits.length;
  const l3 = el('div');
  l3.append(b(`${n} way${n === 1 ? '' : 's'} out`), soft(n ? ` · ${d.exitDirs.join(', ')}` : ''));
  t.append(l1, l2, l3);
  const closed = COMPASS8.filter((c) => !d.exitDirs.includes(c));
  if (n && closed.length) t.append(el('div', 'ms-grd-soft', `No road out to the ${closed.join(', ')}`));
  row.append(exitRose(d, 62, leadBand(d, lead)), t);
  const key = el('div', 'ms-grd-key');
  for (const [c, lab] of [[EXIT_COLOUR.msr, 'MSR'], [EXIT_COLOUR.aw, 'All-weather'], [EXIT_COLOUR.fair, 'Fair-weather']] as const) {
    const k = el('span');
    const dot = el('span', 'ms-grd-dot');
    dot.style.background = c;
    k.append(dot, lab);
    key.append(k);
  }
  box.append(row, key);
  return box;
}

// ── D5 make-up ───────────────────────────────────────────────────────────────
export function densityMakeup(d: RoadDensityReading, lead: RoadDensityLead): HTMLElement {
  const box = el('div');
  const line = el('div', 'ms-grd-line');
  line.append(chipsNode(d, lead), ' ', figureNode(d, lead, ` · ${Math.round(d.totalKm)} km of road`));
  box.append(line);
  if (d.totalKm > 0) {
    const bar = el('div', 'ms-grd-bar');
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
    const item = (c: string, lab: string, v: number) => {
      const s = el('span');
      const dot = el('span', 'ms-grd-dot');
      dot.style.background = c;
      s.append(dot, `${lab} `, b(`${km(v)} km`));
      return s;
    };
    mu.append(item(EXIT_COLOUR.aw, 'All-weather', d.allWeatherKm), item(EXIT_COLOUR.fair, 'Tracks', d.fairKm), item(EXIT_COLOUR.msr, 'MSR', d.msrKm), item('#8cc4ff', 'Tankable', d.tankableKm));
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
  const exits = n ? `${n} way${n === 1 ? '' : 's'} out${d.exits.every((e) => e.allWeather) ? ', all all-weather' : d.allWeatherExitDirs.length ? `, all-weather to the ${d.allWeatherExitDirs.join(', ')}` : ', none all-weather'}` : 'no road leaves the circle';
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

/** The Ground Brief block: rows with the make-up, the exit rose, what the band means, the source. */
export function densityBrief(d: RoadDensityReading, kv: (rows: Array<[string, Node | string | null]>) => HTMLElement | null): HTMLElement {
  ensureRoadDensityCss();
  const w = el('div');
  const g = kv(densityRows(d, 'both', true));
  if (g) w.append(g);
  if (d.exits.length) w.append(densityRose(d, 'both'));
  const note = el('div', 'ms-grd-soft');
  note.style.cssText = `margin-top:6px;border-radius:5px;padding:4px 7px;background:${DENSITY_COLOURS[d.lead.key][0]};color:${DENSITY_COLOURS[d.lead.key][1]}`;
  note.textContent = roadDensityNote(d);
  w.append(note, el('div', 'ms-grd-soft', 'Routing network (OSM with NCGDB load classes): roads and tracks; town streets and footpaths are not counted.'));
  return w;
}
