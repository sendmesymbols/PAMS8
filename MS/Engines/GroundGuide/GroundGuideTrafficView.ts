/**
 * GroundGuideTrafficView.ts
 *
 * T (Trafficability) on the Ground Guide card, on top of the going engine (`v.going`, GroundGuideGoing.ts).
 *
 * The separate pieces (each its own switch):
 *   pill   a header pill when rain makes the going worse ("Rain: NO-GO"), or the season is wet;
 *   dual   a second going scale under Why, for the other season;
 *   road   a Road band (or Landing, for a helicopter): the nearest road the mode can use.
 *
 * Or T as ONE block (`traffic.block`), which then takes the place of the Cross-Country and Movement sections and the
 * Road band (styles compared in ground-guide-t-presentation.html):
 *   band      the going now in large type, then why (soil), the road out and how open the ground is;
 *   gauge     one GO to NO-GO bar with a sun (dry) and a drop (after rain) marker;
 *   calendar  twelve months coloured by the going they leave, rain bars above, this month outlined;
 *   tiles     foot / wheels / tracks (and the mode being placed), each with a dry and an after-rain bar;
 *   wayout    a line to the road coloured by the going crossed, ending in the road's shield and class;
 *   rose      the movement rose with the road marked on its rim;
 *   ticker    one slim strip under the header;
 *   tabs      Now / Rain / Road / Months, one at a time; T cycles them while drawing.
 * `traffic.where` puts the block right after Why, in GROTBC order (after the G sections, before B), or folds it to
 * one line that T opens.
 *
 * Built from DOM nodes and `textContent` only, in the card's own classes plus a few of its own (injected once).
 */

import { fmtDistance } from './GroundGuideEvaluator';
import { registerBriefSection } from './GroundGuideBrief';
import { band, ensureGoingCss, goingScale, roseSvg, seasonIcon } from './GroundGuideGoingView';
import type { TrafficRoad, TrafficRoadRef } from './GroundGuideTrafficability';
import type { GoingStep, GroundGuideCardOptions, GroundGuideVerdict } from './GroundGuideTypes';

const STYLE_ID = 'ms-ground-guide-traffic-style';
const SVG_NS = 'http://www.w3.org/2000/svg';
const WORD: Record<GoingStep, string> = { go: 'GO', slow: 'SLOW-GO', nogo: 'NO-GO' };
const ORDER: Record<GoingStep, number> = { go: 0, slow: 1, nogo: 2 };
const COLOR: Record<GoingStep, string> = { go: '#2fa862', slow: '#f0932b', nogo: '#e5484d' };
const MONTH_LETTER = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SHORT: Record<string, string> = {
  dismounted: 'Foot', wheeled: 'Wheels', tracked: 'Tracks', hls: 'Air', pack: 'Pack', gun: 'Guns', ad: 'AD',
  signals: 'Signals', amphibious: 'Amphib', generic: 'Ground', roadbound: 'Road', rail: 'Rail', vessel: 'Vessel', oversnow: 'Snow',
};
/** Line icons for the mode tiles, on a 24-unit grid (as the Legend's). */
const MODE_ICON: Record<string, string[]> = {
  dismounted: ['M15 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0z', 'M12 8l-2 6', 'M9 11l3-3 3 3 2 0', 'M10 14l-2 7', 'M10 14l3 3v4'],
  wheeled: ['M2 7h11v8H2z', 'M13 10h4l3 3v2h-7', 'M8 17.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z', 'M18 17.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z'],
  tracked: ['M5 14h14a3 3 0 0 1 0 6H5a3 3 0 0 1 0-6z', 'M8 14l1.5-4h6l1 4', 'M15 11.5h6', 'M7 17h.01', 'M12 17h.01', 'M17 17h.01'],
  hls: ['M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z', 'M9 8v8', 'M15 8v8', 'M9 12h6'],
  _: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
};

const CSS = `
.ms-ggb-tdual{display:grid;grid-template-columns:62px minmax(0,1fr);gap:4px;align-items:center;margin-top:4px}
.ms-ggb-tdual>.ms-gv-scale{margin-top:0}
.ms-ggb-tdual>span{color:#9aa3ad;font-size:10.5px}
.ms-ggb-tpill{display:flex;align-items:center;gap:5px;padding:1px 8px;border-radius:999px;background:rgba(0,0,0,.2);font-size:11.5px;white-space:nowrap}
.ms-ggb-tstep{display:inline-block;font:700 9.5px/1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:.05em;padding:3px 6px 2px;border-radius:2px;vertical-align:1px;white-space:nowrap}
.ms-ggb-tstep.ms-go{background:#2fa862;color:#fff}.ms-ggb-tstep.ms-slow{background:#f0932b;color:#1b1f25}.ms-ggb-tstep.ms-nogo{background:#e5484d;color:#fff}
.ms-ggb-tdim{opacity:.45}
.ms-ggb-thead{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
.ms-ggb-tbig{font-size:15px;font-weight:700;color:#fff}
.ms-ggb-tkv{display:grid;grid-template-columns:44px minmax(0,1fr);gap:5px 8px;align-items:start;margin-top:6px}
.ms-ggb-tkv>.ms-ggb-tk{color:#9aa3ad;font-size:11px;padding-top:1px}
.ms-ggb-troad{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.ms-ggb-tshield{flex:none;font:800 9.5px/1 system-ui,Segoe UI,Arial,sans-serif;padding:3px 5px;border-radius:3px;background:#f3f5f7;color:#1b1f25;letter-spacing:.02em}
/* MSR red, as the roads layer draws it (BundleRoadsLayer: there yellow is a recorded class below 60). */
.ms-ggb-tshield.ms-msr{background:#d64541;color:#fff}
.ms-ggb-ttag{display:inline-block;font:700 9px/1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:.05em;text-transform:uppercase;padding:3px 6px 2px;border-radius:999px;background:#25313c;color:#b9d6ef;white-space:nowrap;margin-top:3px}
.ms-ggb-tg{position:relative;margin:21px 2px 4px}
.ms-ggb-tgt{display:grid;grid-template-columns:1fr 1fr 1fr;height:10px;border-radius:5px;overflow:hidden}
.ms-ggb-tgm{position:absolute;top:-19px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:1px}
.ms-ggb-tgm::after{content:"";width:2px;height:15px;background:#fff;border-radius:1px;box-shadow:0 0 0 1px rgba(0,0,0,.5)}
.ms-ggb-tgm.ms-wet::after{background:#bfe2ff}
.ms-ggb-tgl{display:grid;grid-template-columns:1fr 1fr 1fr;font:700 9px/1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:.06em;color:#7f8994;margin-top:5px;text-align:center}
.ms-ggb-tcal{display:grid;grid-template-columns:repeat(12,1fr);gap:2px;margin-top:6px;align-items:end}
.ms-ggb-tcal>div{display:flex;flex-direction:column;align-items:center;gap:2px}
.ms-ggb-tcal b{display:block;width:100%;background:#4a90c8;border-radius:1px}
.ms-ggb-tcal i{display:block;width:100%;height:16px;border-radius:2px}
.ms-ggb-tcal i.ms-now{outline:1.5px solid #fff;outline-offset:1px}
.ms-ggb-tcal small{font:600 9px/1 system-ui,Segoe UI,Arial,sans-serif;color:#9aa3ad}
.ms-ggb-ttiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(54px,1fr));gap:4px}
.ms-ggb-ttile{border-radius:7px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);padding:6px 3px 5px;display:flex;flex-direction:column;align-items:center;gap:4px;color:#e8ebee}
.ms-ggb-ttile.ms-me{border-color:var(--pb-k);background:rgba(255,255,255,.09)}
.ms-ggb-ttile small{font-size:10px;color:#c3cbd3}
.ms-ggb-ttile>span{display:flex;gap:2px}
.ms-ggb-ttile>span>i{display:block;width:16px;height:7px;border-radius:2px}
.ms-ggb-tway{display:flex;align-items:center;margin-top:20px}
.ms-ggb-tway>.ms-dot{flex:none;width:14px;height:14px;border-radius:50%;border:2px solid #fff;background:var(--pb-c)}
.ms-ggb-tway>.ms-leg{flex:1;height:6px;border-radius:3px;margin:0 4px;position:relative}
.ms-ggb-tway>.ms-leg>span{position:absolute;left:50%;top:-16px;transform:translateX(-50%);font-size:10px;color:#c3cbd3;white-space:nowrap}
.ms-ggb-tway>.ms-end{flex:none;display:flex;flex-direction:column;align-items:center;gap:2px}
.ms-ggb-trose{display:flex;gap:10px;align-items:center}
.ms-ggb-trose>svg{flex:none}
.ms-ggb-ttick{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:5px 11px;background:#161a1f;border-bottom:1px solid rgba(255,255,255,.06);font-size:11.5px}
.ms-ggb-ttick>.ms-t{font:800 10px/1 system-ui,Segoe UI,Arial,sans-serif;background:#5aa9e6;color:#1b1f25;border-radius:3px;padding:2px 4px}
.ms-ggb-ttick>.ms-sep{color:#4a535e}
.ms-ggb-ttabs{display:flex;gap:3px;margin:1px 0 7px}
.ms-ggb-ttabs>span{flex:1;text-align:center;font:700 9.5px/1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;padding:5px 0;border-radius:5px;background:rgba(255,255,255,.05);color:#9aa3ad}
.ms-ggb-ttabs>span.ms-on{background:#5aa9e6;color:#1b1f25}
.ms-ggb-tcue{display:flex;align-items:center;gap:7px;color:#c3cbd3}
.ms-ggb-tcue>.ms-grow{flex:1;min-width:0}
.ms-ggb-tkey{display:inline-flex;align-items:center;justify-content:center;min-width:17px;height:17px;padding:0 4px;box-sizing:border-box;border-radius:4px;
  font:700 10px/1 ui-monospace,Consolas,monospace;color:#fff;background:linear-gradient(#3a424d,#2b313a);border:1px solid #545e6b;border-bottom-width:2px}
.ms-ggb-tl{display:inline-flex;align-items:center;justify-content:center;flex:none;width:15px;height:15px;border-radius:4px;font:800 10px/1 system-ui,Segoe UI,Arial,sans-serif;color:#1b1f25;background:#5aa9e6}
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

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(SVG_NS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function step(s: GoingStep, dim = false): HTMLElement {
  return el('span', `ms-ggb-tstep ms-${s}${dim ? ' ms-ggb-tdim' : ''}`, WORD[s]);
}

function modeIcon(profile: string, size = 18): SVGElement {
  const svg = svgEl('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  });
  for (const d of MODE_ICON[profile] ?? MODE_ICON._) svg.append(svgEl('path', { d }));
  return svg;
}

/** The Why section the card built (its caption reads "Why"), when there is one. */
function whyOf(rows: HTMLElement[]): HTMLElement | null {
  const r = rows[0];
  return r && r.querySelector(':scope > .ms-ggb-cap')?.textContent === 'Why' ? r : null;
}

// ── what every block says ─────────────────────────────────────────────────

interface TView {
  short: string;
  wet: boolean;
  dry: GoingStep;
  after: GoingStep;
  now: GoingStep;
  why: string;
  road: TrafficRoad | null;
}

function short(profile: string): string {
  return SHORT[profile] ?? profile;
}

/** The going at the point, dry and after rain (from `v.going`, else the verdict), and the season now. */
function viewOf(v: GroundGuideVerdict): TView {
  const g = v.going;
  const pt = g?.point;
  const fromVerdict: GoingStep = v.verdict === 'ok' || v.verdict === 'near' ? 'go' : v.verdict === 'caution' ? 'slow' : 'nogo';
  const dry = pt?.dry ?? fromVerdict;
  const after = pt?.wet ?? dry;
  const wet = g?.season === 'wet';
  return { short: short(v.profile), wet, dry, after, now: wet ? after : dry, why: whyText(v), road: v.traffic?.road ?? null };
}

/** One line on why the going is what it is: the soil, its cone index against the vehicle's, or what limits it. */
function whyText(v: GroundGuideVerdict): string {
  const g = v.going;
  const pt = g?.point;
  const soil = g?.soil;
  const name = soil ? `${soil.label} (${soil.mapped ? 'Mapped' : 'Modelled'})` : null;
  if (pt && ORDER[pt.wet] > ORDER[pt.dry]) {
    const ci = soil?.ciWet !== null && soil?.ciWet !== undefined && g?.vehicle ? `: cone index ${soil.ciWet}, needs ${g.vehicle.vci[1]} for GO` : '';
    return `${name ?? 'The ground'}, ${(pt.limitWet ?? 'soft after rain').toLowerCase()}${ci}`;
  }
  if (pt && pt.dry !== 'go') return `${name ? `${name}: ` : ''}${pt.limitDry ?? 'limited by the ground'}`;
  return name ? `${name}: firm enough dry and after rain` : v.reason ?? 'No soil data here';
}

function shield(r: TrafficRoadRef): HTMLElement {
  return el('span', `ms-ggb-tshield${r.msr ? ' ms-msr' : ''}`, r.shield);
}

/** The road out: shield, name and distance, its class tag, and an all-weather alternative. */
function roadBlock(t: TView, compact = false): HTMLElement | null {
  const r = t.road;
  if (!r) return null;
  const box = el('div');
  if (!r.main) {
    box.append(el('span', undefined, r.text));
    return box;
  }
  const m = r.main;
  const row = el('div', 'ms-ggb-troad');
  const name = el('span');
  if (m.name) name.append(el('span', 'ms-ggb-b', m.name), ' · ');
  name.append(`${fmtDistance(m.distanceM)} ${m.compass}`);
  row.append(shield(m), name);
  box.append(row);
  if (!compact && m.tag) box.append(el('span', 'ms-ggb-ttag', m.tag));
  if (r.alt) {
    const a = r.alt;
    const alt = `${a.msr ? 'MSR ' : ''}${a.shield}${a.name ? ` ${a.name}` : ''} · ${fmtDistance(a.distanceM)} ${a.compass}`;
    box.append(el('div', 'ms-ggb-soft', t.wet ? `After rain use ${alt} (all-weather)` : `All-weather: ${alt}`));
  }
  return box;
}

function moveText(v: GroundGuideVerdict): string | null {
  const m = v.going?.movement;
  if (!m) return null;
  const blocked = m.sectors.filter((x) => x.blockedBy && x.reachM < m.rangeM).sort((a, b) => a.reachM - b.reachM)[0];
  const base = `${m.open} of ${m.sectors.length} directions open to ${fmtDistance(m.rangeM)}`;
  return blocked ? `${base} · ${blocked.compass} blocked at ${fmtDistance(blocked.reachM)} (${blocked.blockedBy!.toLowerCase()})` : base;
}

/** "SLOW-GO  after rain" (or "GO  now, dry") and, in the dry season, what rain does. */
function headline(t: TView, what = ''): HTMLElement {
  const h = el('div', 'ms-ggb-thead');
  h.append(el('span', 'ms-ggb-tbig', WORD[t.now]), el('span', 'ms-ggb-soft', `${what}${t.wet ? 'after rain' : 'now, dry'}`));
  if (!t.wet && t.after !== t.dry) h.append(el('span', 'ms-ggb-soft', '· after rain'), step(t.after));
  return h;
}

// ── the eight blocks ──────────────────────────────────────────────────────

function blockBand(v: GroundGuideVerdict, t: TView): HTMLElement {
  const kv = el('div', 'ms-ggb-tkv');
  kv.append(el('span', 'ms-ggb-tk', 'Why'), el('span', undefined, t.why));
  const road = roadBlock(t);
  if (road) kv.append(el('span', 'ms-ggb-tk', t.road!.caption === 'Landing' ? 'Land' : 'Road'), road);
  const move = moveText(v);
  if (move) kv.append(el('span', 'ms-ggb-tk', 'Move'), el('span', undefined, move));
  return band('T', `Trafficability · ${t.short}`, headline(t), kv);
}

function blockGauge(_v: GroundGuideVerdict, t: TView): HTMLElement {
  const g = el('div', 'ms-ggb-tg');
  const track = el('div', 'ms-ggb-tgt');
  for (const k of ['go', 'slow', 'nogo'] as const) {
    const i = el('i');
    i.style.background = COLOR[k];
    track.append(i);
  }
  g.append(track);
  const at = (s: GoingStep) => ((ORDER[s] * 2 + 1) / 6) * 100;
  const mark = (s: GoingStep, season: 'dry' | 'wet', nudge: number) => {
    const m = el('div', `ms-ggb-tgm${season === 'wet' ? ' ms-wet' : ''}`);
    m.style.left = `${at(s) + nudge}%`;
    m.append(seasonIcon(season, 12));
    return m;
  };
  if (t.dry === t.after) g.append(mark(t.dry, t.wet ? 'wet' : 'dry', 0));
  else g.append(mark(t.dry, 'dry', -5), mark(t.after, 'wet', 5));
  const labels = el('div', 'ms-ggb-tgl');
  for (const k of ['go', 'slow', 'nogo'] as const) labels.append(el('span', undefined, WORD[k]));
  return band('T', `Going · ${t.short}`, headline(t), g, labels, el('div', 'ms-ggb-soft', t.why), roadBlock(t, true));
}

function blockCalendar(v: GroundGuideVerdict, t: TView): HTMLElement {
  const c = v.going?.climate;
  if (!c) return band('T', `Going by Month · ${t.short}`, headline(t), el('div', 'ms-ggb-soft', 'No climate data here'), roadBlock(t, true));
  const now = (v.going?.month ?? new Date().getMonth() + 1) - 1;
  const top = Math.max(...c.precMm, 1);
  const cal = el('div', 'ms-ggb-tcal');
  const wetMonths: string[] = [];
  c.precMm.forEach((mm, i) => {
    const wet = mm >= c.wetMm;
    if (wet && t.after !== t.dry) wetMonths.push(MONTH[i]);
    const d = el('div');
    const bar = el('b');
    bar.style.height = `${Math.max(2, Math.round((mm / top) * 14))}px`;
    const cell = el('i', i === now ? 'ms-now' : undefined);
    cell.style.background = COLOR[wet ? t.after : t.dry];
    cell.title = `${MONTH[i]}: ${Math.round(mm)} mm, ${WORD[wet ? t.after : t.dry]}`;
    d.append(bar, cell, el('small', undefined, MONTH_LETTER[i]));
    cal.append(d);
  });
  const note = wetMonths.length ? `${WORD[t.after]} in ${wetMonths.join(', ')} (wet months), ${WORD[t.dry]} the rest` : `${WORD[t.dry]} all year`;
  return band('T', `Going by Month · ${t.short}`, headline(t), cal, el('div', 'ms-ggb-soft', `${note} · bars: rain`), roadBlock(t, true));
}

function blockTiles(v: GroundGuideVerdict, t: TView): HTMLElement {
  const tiles = el('div', 'ms-ggb-ttiles');
  const modes = v.going?.modes?.length ? v.going.modes : [{ profile: v.profile, label: v.profileLabel, dry: t.dry, wet: t.after, active: true }];
  for (const m of modes) {
    const tile = el('div', `ms-ggb-ttile${m.active ? ' ms-me' : ''}`);
    tile.title = `${m.label}: dry ${WORD[m.dry]}, after rain ${WORD[m.wet]}`;
    const pair = el('span');
    [m.dry, m.wet].forEach((s, i) => {
      const b = el('i');
      b.style.background = COLOR[s];
      if (t.wet !== (i === 1)) b.style.opacity = '.45';
      pair.append(b);
    });
    tile.append(modeIcon(m.profile), el('small', undefined, short(m.profile)), pair);
    tiles.append(tile);
  }
  return band('T', 'Who Can Move Here', tiles, el('div', 'ms-ggb-soft', `Left bar dry, right bar after rain · ${t.why}`), roadBlock(t, true));
}

function blockWayOut(_v: GroundGuideVerdict, t: TView): HTMLElement {
  const m = t.road?.main;
  if (!m) return band('T', `Way Out · ${t.short}`, headline(t), roadBlock(t), el('div', 'ms-ggb-soft', t.why));
  const way = el('div', 'ms-ggb-tway');
  const leg = el('span', 'ms-leg');
  leg.style.background = COLOR[t.now];
  leg.append(el('span', undefined, `${fmtDistance(m.distanceM)} ${m.compass} · ${WORD[t.now]}`));
  const end = el('span', 'ms-end');
  end.append(shield(m), el('span', 'ms-ggb-soft', m.msr ? 'MSR' : m.allWeather ? 'Road' : 'Track'));
  way.append(el('span', 'ms-dot'), leg, end);
  const info = el('div');
  info.style.marginTop = '6px';
  if (m.name) info.append(el('span', 'ms-ggb-b', m.name), ' ');
  if (m.tag) info.append(el('span', 'ms-ggb-ttag', m.tag));
  const alt = t.road?.alt
    ? el('div', 'ms-ggb-soft', `${t.wet ? 'After rain use' : 'All-weather:'} ${t.road.alt.shield}${t.road.alt.name ? ` ${t.road.alt.name}` : ''} · ${fmtDistance(t.road.alt.distanceM)} ${t.road.alt.compass}`)
    : null;
  return band('T', `Way Out · ${t.short}`, headline(t), way, info, alt, el('div', 'ms-ggb-soft', t.why));
}

function blockRose(v: GroundGuideVerdict, t: TView, northDeg: number): HTMLElement {
  const g = v.going;
  if (!g?.movement) return blockBand(v, t);
  const svg = roseSvg(g, 92, false, northDeg);
  const m = t.road?.main;
  const grp = svg.querySelector('[data-gv-rose]');
  if (m && grp) {
    // The road's marker sits on the rim in its map bearing, inside the group that turns with the map.
    const c = 46;
    const a = (m.bearingDeg * Math.PI) / 180;
    const x = c + 41 * Math.sin(a);
    const y = c - 41 * Math.cos(a);
    grp.append(svgEl('rect', { x: x - 5, y: y - 5, width: 10, height: 10, rx: 2, fill: m.msr ? '#d64541' : '#f3f5f7', stroke: '#1b1f25', 'stroke-width': 1.5 }));
  }
  const text = el('div');
  text.append(el('div', 'ms-ggb-tbig', WORD[t.now]), el('div', 'ms-ggb-soft', moveText(v) ?? ''));
  if (m) {
    const r = el('div', 'ms-ggb-troad');
    r.style.marginTop = '4px';
    r.append(shield(m), el('span', undefined, `${fmtDistance(m.distanceM)} ${m.compass}`));
    text.append(r);
  } else if (t.road) text.append(el('div', undefined, t.road.text));
  const row = el('div', 'ms-ggb-trose');
  row.append(svg, text);
  return band('T', `Movement · ${t.short} · ${t.wet ? 'After Rain' : 'Dry'}`, row, el('div', 'ms-ggb-soft', t.why));
}

function blockTicker(_v: GroundGuideVerdict, t: TView): HTMLElement {
  const s = el('div', 'ms-ggb-ttick');
  s.append(el('span', 'ms-t', 'T'), seasonIcon('dry', 12), step(t.dry, t.wet), seasonIcon('wet', 12), step(t.after, !t.wet));
  const m = t.road?.main;
  if (m) s.append(el('span', 'ms-sep', '|'), shield(m), el('span', undefined, `${fmtDistance(m.distanceM)} ${m.compass}`));
  else if (t.road?.caption === 'Landing') s.append(el('span', 'ms-sep', '|'), el('span', undefined, t.road.text.split(' · ')[0]));
  return s;
}

function blockTabs(v: GroundGuideVerdict, t: TView): HTMLElement {
  const tab = v.traffic?.tab ?? 0;
  const tabs = el('div', 'ms-ggb-ttabs');
  ['Now', 'Rain', 'Road', 'Months'].forEach((n, i) => tabs.append(el('span', i === tab ? 'ms-on' : undefined, n)));
  const body: Array<HTMLElement | null> = [];
  if (tab === 0) body.push(headline(t), el('div', 'ms-ggb-soft', t.why));
  if (tab === 1) {
    const kv = el('div', 'ms-ggb-tkv');
    const k = (season: 'dry' | 'wet', label: string) => {
      const c = el('span', 'ms-ggb-tk');
      c.append(seasonIcon(season, 11), ` ${label}`);
      return c;
    };
    kv.append(k('dry', 'Dry'), step(t.dry), k('wet', 'Rain'), step(t.after));
    const soil = v.going?.soil;
    const veh = v.going?.vehicle;
    const ci = (n: number | null) => (n === null ? '?' : n >= 127 ? '127+' : String(n)); // the layer caps at 127
    body.push(kv, soil && veh ? el('div', 'ms-ggb-soft', `Cone index ${ci(soil.ciDry)} dry, ${ci(soil.ciWet)} after rain · ${t.short}: ${veh.vci[1]} for GO, ${veh.vci[0]} to move`) : el('div', 'ms-ggb-soft', t.why));
  }
  if (tab === 2) body.push(roadBlock(t) ?? el('div', 'ms-ggb-soft', 'Road line is off'), moveText(v) ? el('div', 'ms-ggb-soft', moveText(v)!) : null);
  if (tab === 3) {
    const cal = blockCalendar(v, t);
    cal.querySelector(':scope > .ms-ggb-cap')?.remove();
    body.push(...(Array.from(cal.children) as HTMLElement[]));
  }
  const cue = el('div', 'ms-ggb-soft ms-ggb-tcue');
  cue.style.marginTop = '6px';
  cue.append(el('span', 'ms-ggb-tkey', 'T'), 'Next tab');
  return band('T', `Trafficability · ${t.short}`, tabs, ...body, cue);
}

/** The one-line cue of a folded block: the going and the road, and the T key that opens it. */
function foldedCue(t: TView): HTMLElement {
  const s = el('div', 'ms-ggb-sec ms-ggb-tcue');
  const text = el('span', 'ms-grow');
  text.append(el('span', 'ms-ggb-b', WORD[t.now]));
  if (!t.wet && t.after !== t.dry) text.append(`, after rain ${WORD[t.after]}`);
  const m = t.road?.main;
  if (m) text.append(` · ${m.shield} ${fmtDistance(m.distanceM)} ${m.compass}`);
  s.append(el('span', 'ms-ggb-tl', 'T'), text, el('span', 'ms-ggb-tkey', 'T'));
  return s;
}

function block(v: GroundGuideVerdict, t: TView, northDeg: number): HTMLElement {
  switch (v.traffic!.block) {
    case 'gauge': return blockGauge(v, t);
    case 'calendar': return blockCalendar(v, t);
    case 'tiles': return blockTiles(v, t);
    case 'wayout': return blockWayOut(v, t);
    case 'rose': return blockRose(v, t, northDeg);
    case 'ticker': return blockTicker(v, t);
    case 'tabs': return blockTabs(v, t);
    default: return blockBand(v, t);
  }
}

/** The card sections to draw with a T block on: the Cross-Country and Movement sections are in the block. */
export function trafficCard(v: GroundGuideVerdict, card: GroundGuideCardOptions): GroundGuideCardOptions {
  const b = v.traffic?.block;
  return b && b !== 'off' && v.going ? { ...card, goingLines: false, movementRose: false } : card;
}

/**
 * Add T to a card being built: `rows` are its sections in order (Why first); `pills` the header's pill box, put on
 * `bar` when T adds the first pill; `roadAt` is the end of the going sections (GROTBC order). Does nothing when the
 * verdict carries no T.
 */
export function decorateTraffic(
  v: GroundGuideVerdict,
  bar: HTMLElement,
  pills: HTMLElement,
  rows: HTMLElement[],
  roadAt?: number,
  northDeg = 0,
): void {
  const t = v.traffic;
  if (!t || v.verdict === 'unknown') return;
  ensureStyle();
  ensureGoingCss();
  const pt = v.going?.point;
  const wet = v.going?.season === 'wet';
  const why = whyOf(rows);
  if (t.pill && pt && (wet || ORDER[pt.wet] > ORDER[pt.dry])) {
    pills.appendChild(el('span', 'ms-ggb-tpill', wet ? `After Rain: ${WORD[pt.wet]}` : `Rain: ${WORD[pt.wet]}`));
    if (!pills.parentElement) bar.appendChild(pills);
  }
  if (t.dual && pt && why) {
    const other = el('div', 'ms-ggb-tdual');
    other.append(el('span', undefined, wet ? 'Dry' : 'After Rain'), goingScale(wet ? pt.dry : pt.wet));
    why.appendChild(other);
  }
  const afterWhy = why ? 1 : 0;
  const grotbc = roadAt ?? rows.length;
  if (t.block === 'off') {
    if (t.road) rows.splice(grotbc, 0, band('T', `${t.road.caption} · ${wet ? 'After Rain' : 'Dry'}`, el('div', undefined, t.road.text)));
    return;
  }
  const tv = viewOf(v);
  if (t.block === 'ticker') {
    rows.splice(0, 0, blockTicker(v, tv)); // a strip right under the header, wherever `where` says
    return;
  }
  const at = t.where === 'grotbc' ? grotbc : afterWhy;
  rows.splice(at, 0, t.where === 'folded' && !t.open ? foldedCue(tv) : block(v, tv, northDeg));
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
