/**
 * GroundGuideSpeedView.ts
 *
 * T in GROTBC, Speed (`v.speed`, GroundGuideSpeed.ts) on the Ground Guide card and in the Ground Brief. Card styles,
 * one switch (`groundGuide.speed.card`), all kept so the owner can compare them live:
 *   line   S1  the speed now in large type, up / down a slope, the road with the time to reach it, a day's march;
 *   grid   S2  day / night x dry / after rain at the point, the one in force outlined;
 *   rose   S3  minutes to cover the range in eight directions, slope and ground taken along the way;
 *   modes  S4  foot / B truck / A tracked (and the symbol's mover) side by side;
 *   road   S5  a strip from here to the road: the cross-country leg, then the road speed.
 * The block sits right after the T block (or the going sections when T is off). DOM nodes and textContent only.
 */

import { registerBriefSection } from './GroundGuideBrief';
import { fmtDistance } from './GroundGuideEvaluator';
import { band, ensureGoingCss, seasonIcon } from './GroundGuideGoingView';
import { fmtKmh, fmtMinutes, speedText, type GroundGuideSpeed, type SpeedDirection } from './GroundGuideSpeed';
import type { GroundGuideVerdict } from './GroundGuideTypes';

const STYLE_ID = 'ms-ground-guide-speed-style';
const SVG_NS = 'http://www.w3.org/2000/svg';

const CSS = `
.ms-ggs-head{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
.ms-ggs-big{font-size:15px;font-weight:700;color:#fff;font-variant-numeric:tabular-nums}
.ms-ggs-cat{display:inline-block;font:800 9px/1 system-ui,Segoe UI,Arial,sans-serif;padding:3px 5px 2px;border-radius:3px;background:#25313c;color:#b9d6ef;letter-spacing:.04em}
.ms-ggs-kv{display:grid;grid-template-columns:44px minmax(0,1fr);gap:5px 8px;align-items:start;margin-top:6px}
.ms-ggs-kv>.ms-ggs-k{color:#9aa3ad;font-size:11px;padding-top:1px}
.ms-ggs-shield{flex:none;font:800 9.5px/1 system-ui,Segoe UI,Arial,sans-serif;padding:3px 5px;border-radius:3px;background:#f3f5f7;color:#1b1f25;letter-spacing:.02em;margin-right:5px}
.ms-ggs-shield.ms-msr{background:#d64541;color:#fff}
.ms-ggs-grid{display:grid;grid-template-columns:auto 1fr 1fr;gap:3px 4px;font-size:11px;align-items:center;margin-top:6px}
.ms-ggs-grid>.ms-ggs-h{font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:#9aa3ad;display:flex;gap:4px;justify-content:center;align-items:center}
.ms-ggs-grid>.ms-ggs-m{color:#c3cbd3;padding-right:6px;white-space:nowrap}
.ms-ggs-grid>.ms-ggs-c{text-align:center;padding:4px 0 3px;border-radius:3px;background:rgba(255,255,255,.06);font-weight:600;font-variant-numeric:tabular-nums}
.ms-ggs-grid>.ms-ggs-c.ms-on{background:#5aa9e6;color:#1b1f25}
.ms-ggs-rose{display:flex;gap:10px;align-items:center}
.ms-ggs-rose>svg{flex:none}
.ms-ggs-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(58px,1fr));gap:4px}
.ms-ggs-tile{border-radius:7px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);padding:6px 3px 5px;display:flex;flex-direction:column;align-items:center;gap:3px;color:#e8ebee}
.ms-ggs-tile.ms-me{border-color:#5aa9e6;background:rgba(90,169,230,.12)}
.ms-ggs-tile b{font-size:13px;font-variant-numeric:tabular-nums}
.ms-ggs-tile small{font-size:10px;color:#c3cbd3}
.ms-ggs-way{display:flex;align-items:center;margin-top:20px}
.ms-ggs-way>.ms-dot{flex:none;width:12px;height:12px;border-radius:50%;border:2px solid #fff;background:#5aa9e6}
.ms-ggs-way>.ms-leg{flex:1;height:6px;border-radius:3px;margin:0 4px;position:relative}
.ms-ggs-way>.ms-leg>span{position:absolute;left:50%;top:-16px;transform:translateX(-50%);font-size:10px;color:#c3cbd3;white-space:nowrap}
.ms-ggs-way>.ms-xc{background:repeating-linear-gradient(90deg,#9aa3ad 0 6px,transparent 6px 10px)}
.ms-ggs-way>.ms-rd{background:#f3f5f7}
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

function when(s: GroundGuideSpeed): string {
  return `${s.season === 'wet' ? 'after rain' : 'dry'} · ${s.light}`;
}

function caption(s: GroundGuideSpeed, what = 'Speed'): string {
  return `${what} · ${s.short}`;
}

function catChip(s: GroundGuideSpeed): HTMLElement | null {
  return s.cat ? el('span', 'ms-ggs-cat', `${s.cat} VEH`) : null;
}

function headline(s: GroundGuideSpeed): HTMLElement {
  const h = el('div', 'ms-ggs-head');
  h.append(el('span', 'ms-ggs-big', s.kmh === 0 ? 'NO-GO' : fmtKmh(s.kmh)), el('span', 'ms-ggb-soft', `cross-country · ${when(s)}`));
  if (s.up !== null && s.down !== null) h.append(el('span', 'ms-ggb-soft', `· up ${s.up}, down ${s.down}`));
  const c = catChip(s);
  if (c) h.append(c);
  return h;
}

function shield(s: GroundGuideSpeed): HTMLElement {
  return el('span', `ms-ggs-shield${s.road?.msr ? ' ms-msr' : ''}`, s.road?.shield ?? 'Road');
}

/** "1.2 km E · 18 min to reach · then 40 km/h (column)". */
function roadText(s: GroundGuideSpeed): string {
  const r = s.road!;
  const reach = r.reachMin === null ? 'no cross-country way from here' : r.reachMin === 0 ? 'on it' : `${fmtMinutes(r.reachMin)} to reach`;
  const how = s.roadMode === 'convoy' ? `${r.kmh} km/h in column${r.rateKmih !== null ? ` (${r.rateKmih} km in the hour)` : ''}` : `${r.kmh} km/h alone`;
  return `${r.name ? `${r.name} · ` : ''}${fmtDistance(r.distanceM)} ${r.compass} · ${reach} · then ${how}`;
}

function roadRow(s: GroundGuideSpeed): HTMLElement {
  const box = el('div');
  if (!s.road) {
    box.textContent = `No road it can use within ${fmtDistance(s.roadRadiusM)}`;
    return box;
  }
  box.append(shield(s), roadText(s));
  return box;
}

function dayText(s: GroundGuideSpeed): string | null {
  const d = s.dayKm;
  if (!d) return null;
  const load = d.load === 'none' ? 'without' : 'with';
  return `${d.lo}–${d.hi} km in 24 h (${d.ground}, ${load} combat load)`;
}

function groundText(s: GroundGuideSpeed): string | null {
  const bits: string[] = [];
  if (s.ground) bits.push(s.ground.label);
  if (s.slopeDeg !== null) bits.push(`slope ${Math.round(s.slopeDeg)}°${s.slopeBand ? ` (${s.slopeBand})` : ''}`);
  if (s.elevM !== null && s.elevM >= 2500) bits.push(`${Math.round(s.elevM)} m up`);
  return bits.length ? bits.join(' · ') : null;
}

// ── the five styles ───────────────────────────────────────────────────────

function styleLine(s: GroundGuideSpeed): HTMLElement {
  const kv = el('div', 'ms-ggs-kv');
  kv.append(el('span', 'ms-ggs-k', 'Road'), roadRow(s));
  const day = dayText(s);
  if (day) kv.append(el('span', 'ms-ggs-k', 'Day'), el('span', undefined, day));
  const g = groundText(s);
  if (g) kv.append(el('span', 'ms-ggs-k', 'Here'), el('span', 'ms-ggb-soft', g));
  return band('T', caption(s), headline(s), kv);
}

function styleGrid(s: GroundGuideSpeed): HTMLElement {
  const g = el('div', 'ms-ggs-grid');
  const hd = (season: 'dry' | 'wet', t: string) => {
    const c = el('span', 'ms-ggs-h');
    c.append(seasonIcon(season, 11), t);
    return c;
  };
  g.append(el('span'), hd('dry', 'Dry'), hd('wet', 'After Rain'));
  const cell = (v: number | null, on: boolean) => el('span', `ms-ggs-c${on ? ' ms-on' : ''}`, v === null ? '?' : v === 0 ? 'NO-GO' : String(v));
  const wet = s.season === 'wet';
  g.append(el('span', 'ms-ggs-m', 'Day'), cell(s.grid.dryDay, s.light === 'day' && !wet), cell(s.grid.wetDay, s.light === 'day' && wet));
  g.append(el('span', 'ms-ggs-m', 'Night'), cell(s.grid.dryNight, s.light === 'night' && !wet), cell(s.grid.wetNight, s.light === 'night' && wet));
  const head = el('div', 'ms-ggs-head');
  head.append(el('span', 'ms-ggb-soft', `km/h cross-country${s.up !== null ? ', uphill' : ''}`));
  const c = catChip(s);
  if (c) head.append(c);
  const road = el('div', 'ms-ggb-soft');
  road.style.marginTop = '6px';
  road.append(s.road ? `${s.road.shield}: ${roadText(s)}` : `No road within ${fmtDistance(s.roadRadiusM)}`);
  return band('T', caption(s), head, g, road);
}

function speedColor(kmh: number, top: number): string {
  if (kmh <= 0) return '#e5484d';
  const f = top > 0 ? kmh / top : 0;
  return f >= 0.66 ? '#2fa862' : f >= 0.33 ? '#f2c14e' : '#f0932b';
}

/** Eight wedges, length by km/h, coloured against the mover's best; the group turns with the map (`data-gv-rose`). */
function speedRoseSvg(rays: SpeedDirection[], rangeM: number, size: number, northDeg: number): SVGElement {
  const c = size / 2;
  const r0 = size * 0.12;
  const R = size / 2 - 4;
  const top = Math.max(1, ...rays.map((r) => r.kmh));
  const svg = svgEl('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': 'Minutes to cover the range, by direction' });
  const grp = svgEl('g', { transform: `rotate(${northDeg} ${c} ${c})`, 'data-gv-rose': `${c}` });
  grp.append(svgEl('circle', { cx: c, cy: c, r: R, fill: 'none', stroke: 'rgba(255,255,255,.1)' }));
  const P = (a: number, rr: number) => `${(c + rr * Math.sin(a)).toFixed(1)} ${(c - rr * Math.cos(a)).toFixed(1)}`;
  for (const x of rays) {
    const a0 = ((x.bearingDeg - 20.5) * Math.PI) / 180;
    const a1 = ((x.bearingDeg + 20.5) * Math.PI) / 180;
    // Open: length by speed. Blocked: a red wedge as long as the way goes before it is stopped.
    const k = x.minutes === null ? Math.max(0.1, x.reachM / Math.max(1, rangeM)) : x.kmh / top;
    const r = Math.max(r0 + 3, r0 + (R - r0) * Math.min(1, k));
    grp.append(
      svgEl('path', {
        d: `M ${P(a0, r0)} L ${P(a0, r)} A ${r} ${r} 0 0 1 ${P(a1, r)} L ${P(a1, r0)} A ${r0} ${r0} 0 0 0 ${P(a0, r0)} Z`,
        fill: x.minutes === null ? '#e5484d' : speedColor(x.kmh, top),
        'fill-opacity': 0.88,
      }),
    );
  }
  grp.append(svgEl('circle', { cx: c, cy: c, r: r0 - 2, fill: '#1b1f25', stroke: '#fff', 'stroke-width': 1.5 }));
  grp.append(svgEl('path', { d: `M ${c} 1 l 3.5 6 h -7 z`, fill: '#fff' }));
  svg.append(grp);
  return svg;
}

function roseLines(s: GroundGuideSpeed): HTMLElement {
  const box = el('div');
  const rays = s.rays ?? [];
  const open = rays.filter((r) => r.minutes !== null).sort((p, q) => p.minutes! - q.minutes!);
  const to = fmtDistance(s.rangeM);
  if (open.length) {
    box.append(el('div', 'ms-ggs-big', `${fmtMinutes(open[0].minutes!)} ${open[0].compass}`));
    box.append(el('div', 'ms-ggb-soft', `fastest to ${to}; slowest ${open[open.length - 1].compass} ${fmtMinutes(open[open.length - 1].minutes!)}`));
  } else box.append(el('div', 'ms-ggs-big', 'Blocked'));
  const shut = rays.filter((r) => r.minutes === null);
  if (shut.length) {
    const first = [...shut].sort((p, q) => p.reachM - q.reachM)[0];
    box.append(el('div', 'ms-ggb-soft', `Blocked ${shut.map((r) => r.compass).join(', ')}${first.blockedBy ? ` (${first.blockedBy.toLowerCase()} at ${fmtDistance(first.reachM)})` : ''}`));
  }
  box.append(el('div', 'ms-ggb-soft', `${when(s)}${s.road ? ` · ${s.road.shield} ${fmtDistance(s.road.distanceM)} ${s.road.compass}` : ''}`));
  return box;
}

function styleRose(s: GroundGuideSpeed, northDeg: number): HTMLElement {
  if (!s.rays) return styleLine(s);
  const row = el('div', 'ms-ggs-rose');
  row.append(speedRoseSvg(s.rays, s.rangeM, 92, northDeg), roseLines(s));
  return band('T', `${caption(s)} · Time to ${fmtDistance(s.rangeM)}`, row);
}

function styleModes(s: GroundGuideSpeed): HTMLElement {
  const tiles = el('div', 'ms-ggs-tiles');
  for (const m of s.modes) {
    const t = el('div', `ms-ggs-tile${m.active ? ' ms-me' : ''}`);
    t.title = `${m.short}${m.cat ? ` (${m.cat} vehicle)` : ''}: ${fmtKmh(m.kmh)} cross-country, ${when(s)}`;
    t.append(el('b', undefined, m.kmh === null ? '?' : m.kmh === 0 ? 'NO-GO' : String(m.kmh)), el('small', undefined, `${m.short}${m.cat ? ` · ${m.cat}` : ''}`));
    tiles.append(t);
  }
  const soft = el('div', 'ms-ggb-soft', `km/h cross-country · ${when(s)}`);
  soft.style.marginTop = '5px';
  return band('T', 'Speed · Who Moves How Fast', tiles, soft);
}

function styleRoad(s: GroundGuideSpeed): HTMLElement {
  const r = s.road;
  if (!r) return styleLine(s);
  const way = el('div', 'ms-ggs-way');
  const xc = el('span', 'ms-leg ms-xc');
  xc.append(el('span', undefined, r.reachMin === null ? `${fmtDistance(r.distanceM)} · NO-GO` : r.reachMin === 0 ? 'on the road' : `${fmtDistance(r.distanceM)} · ${fmtMinutes(r.reachMin)}`));
  const rd = el('span', 'ms-leg ms-rd');
  rd.append(el('span', undefined, `${r.kmh} km/h${s.roadMode === 'convoy' ? ' column' : ''}`));
  const sh = shield(s);
  sh.style.marginRight = '0';
  way.append(el('span', 'ms-dot'), xc, sh, rd);
  const info = el('div', 'ms-ggb-soft');
  info.style.marginTop = '6px';
  info.textContent = `${r.msr ? 'MSR · ' : ''}${r.label}${r.allWeather ? '' : ' (fair-weather)'} · cross-country ${fmtKmh(s.kmh)} · ${when(s)}`;
  return band('T', `${caption(s)} · To the Road`, way, info);
}

export function speedSection(v: GroundGuideVerdict, northDeg = 0): HTMLElement | null {
  const s = v.speed;
  if (!s || v.verdict === 'unknown' || s.card === 'off') return null;
  ensureGoingCss();
  ensureStyle();
  switch (s.card) {
    case 'grid': return styleGrid(s);
    case 'rose': return styleRose(s, northDeg);
    case 'modes': return styleModes(s);
    case 'road': return styleRoad(s);
    default: return styleLine(s);
  }
}

/**
 * Put the speed block in a card being built: right after the T block when there is one, else at `fallbackAt` (the
 * end of the going sections).
 */
export function decorateSpeed(v: GroundGuideVerdict, rows: HTMLElement[], fallbackAt: number, northDeg = 0): void {
  const sec = speedSection(v, northDeg);
  if (!sec) return;
  let at = -1;
  rows.forEach((r, i) => {
    if (r.querySelector(':scope > .ms-ggb-cap > .ms-gv-l[data-l="T"]') || r.classList.contains('ms-ggb-tcue')) at = i;
  });
  rows.splice(at >= 0 ? at + 1 : Math.min(fallbackAt, rows.length), 0, sec);
}

// The Ground Brief (G) under T, after the road line.
registerBriefSection({
  id: 'speed',
  letter: 'T',
  order: 16,
  title: 'Speed',
  render: (v) => {
    const s = v.speed;
    if (!s) return null;
    ensureGoingCss();
    ensureStyle();
    const box = el('div');
    box.append(headline(s));
    const g = el('div', 'ms-ggs-grid');
    g.append(el('span'), el('span', 'ms-ggs-h', 'Dry'), el('span', 'ms-ggs-h', 'After Rain'));
    const cell = (x: number | null) => el('span', 'ms-ggs-c', x === null ? '?' : x === 0 ? 'NO-GO' : `${x}`);
    g.append(el('span', 'ms-ggs-m', 'Day'), cell(s.grid.dryDay), cell(s.grid.wetDay), el('span', 'ms-ggs-m', 'Night'), cell(s.grid.dryNight), cell(s.grid.wetNight));
    box.append(g);
    if (s.rays) {
      const row = el('div', 'ms-ggs-rose');
      row.style.marginTop = '8px';
      row.append(speedRoseSvg(s.rays, s.rangeM, 110, 0), roseLines(s));
      box.append(row);
    }
    const lines = speedText(s).slice(1); // the headline is above
    const ul = el('ul', 'ms-ggbr-list');
    for (const l of lines) ul.append(el('li', undefined, l.trim()));
    box.append(ul);
    return box;
  },
  text: (v) => (v.speed ? speedText(v.speed) : []),
});
