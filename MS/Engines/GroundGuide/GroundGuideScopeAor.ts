/**
 * GroundGuideScopeAor.ts
 *
 * The Gr Scope rail in its AOR scale (Shift+V; user, 2026-11-11, "add all with the user able to switch it on the fly",
 * from ground-guide-aor-options.html). Every option of the mockup is kept and switched from the rail's own foot (and
 * the settings / API):
 *  - layout A Deductions (six lines under the map, each its layer's switch and its deduction), B Sand model (a taller
 *    map with names and roles written on it, three lines), C Appreciation (a small map and AprDf's own tables);
 *  - map Trace (Vs72's marking on a talc-trace colour: NO-GO crisscross, SLOW-GO parallel lines, green natural, black
 *    artificial) or Dark (the Spot rail's colours);
 *  - North up (turning with the view, as the Spot rail) or Threat up (the side the approaches come from at the top, as a
 *    sand model is laid out facing the enemy).
 * Also here: the words (one place for the rail, the D sheets and Copy as Text), the approach sheet under AprDf's twelve
 * sub-heads, and the appreciation paragraph (paragraph numbers as AprDf: 6 Apchs, 7 ITGs, 8 Obs, 11 Deductions).
 * Every name and figure in the SVG goes through `esc`; DOM text through `textContent`.
 */

import type { AorApproach, AorDefLine, AorReading, AorSide, AorSource, AorXY } from './GroundGuideAor';
import { ACCENT, FONT, FS, FW, LINE, SURFACE, TEXT } from './GroundGuideTokens';

export type AorLayout = 'deductions' | 'model' | 'appreciation';
export type AorStyle = 'trace' | 'dark';
export type AorOrient = 'north' | 'threat';
export type AorLayer = 'going' | 'apch' | 'line' | 'itg' | 'dml' | 'msr';
export const AOR_LAYERS: readonly AorLayer[] = ['going', 'apch', 'line', 'itg', 'dml', 'msr'];

export interface AorFrame {
  reading: AorReading | null;
  layout: AorLayout;
  style: AorStyle;
  orient: AorOrient;
  layers: Record<AorLayer, boolean>;
  /** Where north points on screen (degrees clockwise from up): North up turns with the view. */
  northDeg: number;
  /** The source asked for, and the one used (a missing box or bdys fall back to the echelon frame). */
  source: AorSource;
  used: AorSource;
  /** Why the source fell back, or anything else to say about the frame; null when nothing. */
  note: string | null;
  echelon: string;
  profileLabel: string;
  /** "Dry · Nov". */
  when: string;
  season: 'dry' | 'wet';
  month: string;
  loading: boolean;
  keys: { detail: boolean };
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
const km = (m: number) => (m / 1000).toFixed(1);
function ppl(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(Math.round(n));
}
/** Road and place names as the bundle has them, with a spaced dash between places ("Sialkot – Nainkot"). */
export function aorName(n: string | null | undefined): string {
  const s = String(n ?? '').trim();
  if (!s || /^(metalled|main_road|unmetalled|metalled_local)$/i.test(s)) return 'unnamed Rd';
  const t = s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s(-])(\p{L})/gu, (_m, p: string, c: string) => p + c.toUpperCase()) : s;
  return t.replace(/\s*-\s*/g, ' – ').replace(/\s+/g, ' ');
}
const cap1 = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);

// ── the words ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface AorWords {
  lead: string;
  sub: string;
  rows: Record<AorLayer, [string, string]>;
  dp: string;
  confirm: string[];
  ranked: AorApproach[];
  fdl: AorDefLine | null;
}

export function aorCapacity(a: AorApproach, corridorM: number): { short: string; long: string } {
  const w = a.minWidthM;
  const who = corridorM >= 4000 ? 'Div' : corridorM >= 2000 ? 'Bde' : corridorM >= 1000 ? 'Bn' : 'Coy';
  const wide = w >= 20000 ? 'no NO-GO area narrows it' : `no narrower than ${km(w)} km between NO-GO areas`;
  if (a.fits) return { short: `${who} (+)`, long: `${who} (+): ${wide}; ${km(corridorM)} km taken for a ${who}${a.obstacles.length ? `; water crossed at ${a.obstacles.length} point${a.obstacles.length > 1 ? 's' : ''}` : ''}` };
  return { short: `Narrows ${km(w)}`, long: `Narrows to ${km(w)} km between NO-GO areas: less than the ${km(corridorM)} km a ${who} needs` };
}

export function aorWords(r: AorReading, f: Pick<AorFrame, 'season' | 'month' | 'used' | 'source' | 'profileLabel'>): AorWords {
  const ranked = [...r.apchs].sort((a, b) => a.rank - b.rank);
  const first = ranked[0];
  const fdl = r.lines.find((l) => l.role === 'FDLs') ?? null;
  const over = fdl ? fdl.frontM - r.frontLimit.m : 0;
  const border = first?.cross?.border ?? null;
  const lead = !first ? 'No approach found from the threat side' : `Bias ${first.side} · FDLs on ${fdl ? fdl.id : '—'} · Str Pt ${r.mitg.name}`;
  const sub = !fdl ? (first ? 'No line cuts every approach' : '')
    : r.source === 'echelon' ? `Frame ${km(fdl.frontM)} km wide: set Bdys or a Box to test the frontage`
    : over > 0 ? `Frontage ${km(fdl.frontM)} km: ${km(over)} km over ${r.frontLimit.label}` : `Frontage ${km(fdl.frontM)} km: fits ${r.frontLimit.label}`;
  const out = r.going.nogoOut[0];
  const meet = r.apchs.filter((a) => {
    const e = a.path[a.path.length - 1];
    return Math.hypot(e[0], e[1]) < 1000;
  }).length;
  const lat = r.laterals.filter((l) => l.n > 0).map((l) => `${l.a}–${l.b} ${l.n}`).join(' · ');
  const d0 = r.dml[0];
  const roles = r.lines.filter((l) => l.role).sort((a, b) => 'WXYZ'.indexOf(a.id) - 'WXYZ'.indexOf(b.id));
  const rows: AorWords['rows'] = {
    going: [
      `${f.profileLabel} X-cty on ${Math.round(r.going.goPct)} % · SLOW-GO ${Math.round(r.going.slowPct)} %`,
      r.going.nogoInAor ? `NO-GO: ${r.going.nogoInAor} patch${r.going.nogoInAor > 1 ? 'es' : ''} in the AOR` : out?.name ? `NO-GO: none in the AOR · ${aorName(out.name)} bed beyond the bdy` : 'NO-GO: none in the AOR (only lines: canals, streams)',
    ],
    apch: first
      ? [ranked.map((a) => a.side).join(' › '), `${first.side}: ${km(first.pastM)} km past ${border ?? 'the front'}, ${first.through.length} BUAs, ${first.obstacles.length ? `${first.obstacles.length} water obs` : 'no water obs'}`]
      : ['None found', 'The going blocks every way from the threat side'],
    line: [roles.map((l) => `${l.role} ${l.id}`).join(' · ') || 'No line found', fdl ? `${fdl.id} ${fdl.name} · ${km(fdl.frontM)} km` : ''],
    itg: [`${r.mitg.name} · ${meet} apch${meet === 1 ? '' : 's'} meet`, [r.thruRoad ? `Rd ${aorName(r.thruRoad.name)} ${r.thruRoad.cls ?? ''} through it`.replace(/\s+through/, ' through') : '', r.msr ? `MSR ${km(r.msr.distM)} km` : ''].filter(Boolean).join(' · ')],
    dml: d0 ? [`Br over ${d0.water}, ${d0.side} apch${r.dml.length > 1 ? ` (+${r.dml.length - 1})` : ''}`, `${km(d0.bridgeM)} km off the crossing · class not recorded`] : ['No water across the apchs', ''],
    msr: [r.msr ? `${aorName(r.msr.name)} ${r.msr.cls ?? ''} · ${km(r.msr.distM)} km off MITG` : 'No MSR within 1.5 km of the MITG', lat ? `Laterals: ${lat}` : 'No metalled lateral between apchs'],
  };
  const dp = roles.map((l) => `${l.role} ${l.id}`).join(' · ');
  const confirm: string[] = [];
  if (f.used !== f.source) confirm.push(f.source === 'boundaries' ? 'No Bdy symbols on both sides of the MITG: the AOR is the echelon frame. Draw the bdys or pick another source.' : 'No box drawn: the AOR is the echelon frame. Draw the box from the rail.');
  if (r.country === 'Canal plains' || r.country === 'Plains') confirm.push('DCB and ditches are not in the bundle: draw them as obstacle symbols; a line of def may follow them.');
  if (r.bridges.inAor) confirm.push(`Bridge class: ${r.bridges.inAor - r.bridges.classed} of ${r.bridges.inAor} bridges in the AOR carry no load class.`);
  if (r.thruRoad) confirm.push(`Rd ${aorName(r.thruRoad.name)} through ${r.mitg.name}: the NCGDB records ${r.thruRoad.cls ?? 'no class'}; confirm it.`);
  confirm.push('30 m elevation: BUAs, bunds and kidney bunds a few metres high do not show; check heights and dominance.');
  confirm.push(`Going is the ${f.season === 'wet' ? 'after-rain' : 'dry'} reading (${f.month}); read it again for the ${f.season === 'wet' ? 'dry season' : 'wet'} before relying on it.`);
  if (r.originsAssumed) confirm.push('Threat start points are assumed forward of the AOR; drag the threat marker to set where the threat comes from.');
  return { lead, sub, rows, dp, confirm, ranked, fdl };
}

/** AprDf's twelve sub-heads of one approach; null where the bundle cannot know (left blank for the planner). */
export function aorSheetRows(r: AorReading, a: AorApproach): Array<[string, string | null]> {
  const others = r.laterals.filter((l) => (l.a === a.side || l.b === a.side) && l.n > 0);
  const big = [...a.through].sort((x, y) => y.people - x.people).slice(0, 3);
  const itgNear = r.map.itg.filter((p) => {
    let best = Infinity;
    for (const q of a.path) best = Math.min(best, Math.hypot(q[0] - p[0], q[1] - p[1]));
    return best < 1000;
  }).length;
  const lens = r.apchs.map((x) => x.pastM);
  const bs = r.apchs.map((x) => x.through.length);
  const sig: string[] = [];
  if (r.apchs.length > 1 && a.pastM === Math.min(...lens)) sig.push('shortest past the border');
  if (r.apchs.length > 1 && a.pastM === Math.max(...lens)) sig.push('longest past the border');
  if (r.apchs.length > 1 && a.through.length === Math.min(...bs)) sig.push('fewest BUAs on it (least friction)');
  if (r.apchs.length > 1 && a.through.length === Math.max(...bs)) sig.push('most BUAs on it (max friction)');
  sig.push(a.obstacles.length ? `crosses ${a.obstacles.map((o) => o.name).join(', ')}` : 'no water obstacle across it');
  if (others.length) sig.push(`mutual sp with ${others.map((l) => (l.a === a.side ? l.b : l.a)).join(' and ')}`);
  const c = a.cross;
  const def = [
    `Originates from ${a.from ? `${a.from}${a.fromOffsetM > 700 ? ` (${km(a.fromOffsetM)} km off)` : ''}` : 'the threat side'}${a.fromAcross ? ' across the border' : ''}`,
    c ? `crosses the ${c.border}${c.near ? ` ${km(c.nearM)} km ${c.dir} of ${c.near}` : ''}` : '',
    a.through.length ? `passes through ${a.through.map((t) => t.name).join(', ')}` : '',
    `and terminates at ${r.mitg.name}.`,
  ].filter(Boolean).join(', ').replace(', and terminates', ' and terminates');
  const cap = aorCapacity(a, r.corridorM);
  return [
    ['Definition', def],
    ['Length', `${km(a.lengthM)} km; ${km(a.pastM)} km past ${c ? `the ${c.border}` : 'the front of the AOR'}.`],
    ['Capacity', `${cap.long}.`],
    ['Tfc', `GO on ${Math.round(a.band.go * 100)} % of a 1 km band. Rds along it: ${a.roadsAlong.length ? a.roadsAlong.map((x) => `${aorName(x.name)} ${x.cls ?? ''} (${x.km} km)`.replace(' (', ' (').replace(/\s+\(/, ' (')).join(', ') : 'none for more than 0.8 km'}.`],
    ['Obs', a.obstacles.length ? a.obstacles.map((o) => `${o.name} (${o.type}${o.widthM ? `, ${o.widthM} m` : ''}) at ${km(o.atM)} km; ${o.bridgeM !== null ? `br ${Math.round(o.bridgeM)} m off, class not recorded` : 'no br within 1 km'}`).join('; ') + '.' : 'No water obstacle across it. SLOW-GO: the BUAs it passes.'],
    ['Obsn', null],
    ['Cover', `From view: BUAs ${Math.round(a.band.bua * 100)} %, trees and orchards ${Math.round(a.band.trees * 100)} % of a 1 km band. From fire: BUAs only.`],
    ['Mutual Sp', others.length ? `${others.map((l) => `with ${l.a === a.side ? l.b : l.a}: ${l.n} metalled laterals`).join('; ')}.` : 'No metalled lateral to another apch.'],
    ['Depl Areas', big.length ? `${big.map((t) => `${t.name} (${ppl(t.people)})`).join(', ')}.` : null],
    ['Dominating Features', itgNear ? `${itgNear} ITG candidate${itgNear > 1 ? 's' : ''} within 1 km of it.` : null],
    ['Dir Keeping', `${a.roadsAlong.length ? `Rds along ${a.roadsAlong.reduce((s, x) => s + x.km, 0).toFixed(1)} km of it; ` : ''}${a.through.length ? `a named BUA every ${km(a.lengthM / Math.max(1, a.through.length))} km.` : 'no named BUA on it.'}`],
    ['Significance', `${cap1(sig.join('; '))}.`],
  ];
}

/** The appreciation paragraph, in AprDf's numbering, for Copy as Text. */
export function aorText(r: AorReading, f: Pick<AorFrame, 'season' | 'month' | 'used' | 'source' | 'profileLabel' | 'echelon'>): string {
  const w = aorWords(r, f);
  const L: string[] = [];
  L.push(`GR AND WEATHER · ${f.echelon} AOR, def ${r.mitg.name} · ${f.profileLabel}, ${f.month}, ${f.season === 'wet' ? 'after rain' : 'dry'} · ${r.country}`);
  L.push('Data: land cover ESA WorldCover 2021; roads, canals, bridges, places NCGDB (undated); people WorldPop 2026. A plan to check on the ground.');
  L.push('');
  L.push('6. Apchs.');
  w.ranked.forEach((a, i) => {
    L.push(`   ${'abc'[i]}. ${a.side} Apch.`);
    aorSheetRows(r, a).forEach(([h, t], j) => L.push(`      (${j + 1}) ${h}. ${t ?? '____'}`));
  });
  L.push('7. ITGs.');
  L.push(`   a. ${r.mitg.name} (MITG).`);
  L.push('      (1) Effs if lost. ____');
  const meet = r.apchs.length;
  L.push(`      (2) Significance. ${meet} apchs converge on it${r.thruRoad ? `; Rd ${aorName(r.thruRoad.name)} ${r.thruRoad.cls ?? ''} runs through it` : ''}${r.msr ? `; MSR ${aorName(r.msr.name)} ${r.msr.cls ?? ''} ${km(r.msr.distM)} km away` : ''}.`);
  const itgs: Array<[string, string]> = [];
  for (const l of r.lines) if (l.role === 'FDLs' || l.role === 'Depth') for (const b of l.buas) if (b && !itgs.some((t) => t[0] === b)) itgs.push([b, l.id]);
  itgs.forEach(([n, id], i) => L.push(`   ${'bcdefghijk'[i]}. ${n} (astride the apchs on Line ${id}).`));
  const out = r.going.nogoOut[0];
  L.push(`8. Obs. ${r.going.nogoInAor ? `${r.going.nogoInAor} NO-GO patches in the AOR.` : `No NO-GO ground in the AOR${out?.name ? `; ${aorName(out.name)} bed (${out.km2.toFixed(1)} km2) beyond the bdy` : ''}.`} BUAs are SLOW-GO (${Math.round(r.going.buaPct)} % of the AOR).`);
  L.push('11. Deductions.');
  L.push(`   a. Pri of Apchs. ${w.ranked.map((a) => a.side).join(', ')} (shortest past the border, least terrain friction).`);
  L.push(`   b. Pri of Comb of Apchs. ${r.laterals.length ? r.laterals.map((l) => `${l.a} and ${l.b} (${l.n} laterals)`).join('; ') : 'No metalled lateral joins the apchs'}.`);
  L.push('   c. Lines of Def.');
  r.lines.forEach((l, i) => L.push(`      (${i + 1}) Line ${l.id}. ${l.name}, ${km(l.frontM)} km between bdys${l.obstacle ? ` (along ${l.obstacle})` : ''}.`));
  const pri = ['FDLs', 'Depth', 'Screen'].map((role) => r.lines.find((l) => l.role === role)).filter(Boolean) as AorDefLine[];
  if (pri.length) L.push(`      Pri: ${pri.map((l) => `Line ${l.id}`).join(', ')}.`);
  if (w.dp) L.push(`   d. DP 1 (without premises). ${w.dp}. Bias of def ${w.ranked[0]?.side ?? '—'}.`);
  if (w.sub) L.push(`   e. Frontage. ${w.sub.replace(/^Frontage /, '')}.`);
  if (r.dml.length) L.push(`   f. Prelim dml. ${r.dml.map((d) => `Br over ${d.water} on the ${d.side} apch (${Math.round(d.bridgeM)} m off the crossing, class not recorded)`).join('; ')}.`);
  L.push('');
  L.push('Confirm on Gr:');
  w.confirm.forEach((c, i) => L.push(`   ${i + 1}. ${c}`));
  return L.join('\n');
}

// ── the map ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const STY = {
  trace: { bg: '#ece6d6', nat: '#2f7d32', art: '#1d1d1d', tint: 'rgba(0,0,0,.10)', tintN: 'rgba(47,125,50,.10)', water: '#2f6fc4', road: '#6b6b6b', msr: '#b4621a', wb: '#9a1c1c', bdy: '#1d1d1d', en: '#cf2027', own: '#1f4fb3', itg: '#6a3fb0', txt: '#1d1d1d', halo: '#ece6d6', grid: 'rgba(0,0,0,.05)' },
  dark: { bg: '#2b302a', nat: '#6fd27a', art: '#d9dde2', tint: 'rgba(255,255,255,.10)', tintN: 'rgba(111,210,122,.10)', water: '#5aa3f0', road: '#8d959e', msr: '#e8964a', wb: '#ff8a8a', bdy: '#e8ebee', en: '#ff5a60', own: '#7fb2ff', itg: '#c3a6ff', txt: '#f1f3f6', halo: '#2b302a', grid: 'rgba(255,255,255,.04)' },
} as const;

function rot(p: AorXY, th: number): AorXY {
  return [p[0] * Math.cos(th) - p[1] * Math.sin(th), p[0] * Math.sin(th) + p[1] * Math.cos(th)];
}

let SVG_UID = 0;

export function aorMapSvg(r: AorReading, f: AorFrame, w: number, h: number, labels: 'min' | 'full'): string {
  const C = STY[f.style];
  const id = `ggaor${++SVG_UID}`;
  const th = f.orient === 'threat' ? (r.faceDeg * Math.PI) / 180 : (-f.northDeg * Math.PI) / 180;
  // Extent: every approach and the outline, padded.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (p: AorXY) => {
    const q = rot(p, th);
    x0 = Math.min(x0, q[0]);
    y0 = Math.min(y0, q[1]);
    x1 = Math.max(x1, q[0]);
    y1 = Math.max(y1, q[1]);
  };
  r.outline.forEach(add);
  r.apchs.forEach((a) => a.path.forEach(add));
  add([0, 0]);
  x0 -= 700;
  x1 += 700;
  y0 -= 500;
  y1 += 900;
  const s = Math.min(w / (x1 - x0), h / (y1 - y0));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const X = (p: AorXY) => {
    const q = rot(p, th);
    return (q[0] - cx) * s + w / 2;
  };
  const Y = (p: AorXY) => {
    const q = rot(p, th);
    return (cy - q[1]) * s + h / 2;
  };
  const pt = (p: AorXY) => `${X(p).toFixed(1)},${Y(p).toFixed(1)}`;
  const pts = (P: AorXY[]) => P.map(pt).join(' ');
  const on = f.layers;
  const o: string[] = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="AOR map" style="display:block;background:${C.bg}">`);
  o.push(
    `<defs><pattern id="${id}n1" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V5M0 0H5" stroke="${C.nat}" stroke-width="1.3"/></pattern>` +
      `<pattern id="${id}n2" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V5M0 0H5" stroke="${C.art}" stroke-width="1.3"/></pattern>` +
      `<pattern id="${id}n3" width="4.5" height="4.5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V4.5" stroke="${C.nat}" stroke-width="1.2"/></pattern>` +
      `<pattern id="${id}n4" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V4" stroke="${C.art}" stroke-width="1"/></pattern>` +
      `<clipPath id="${id}c"><rect width="${w}" height="${h}"/></clipPath></defs><g clip-path="url(#${id}c)">`,
  );
  // 1 km grid, faint, turning with the map.
  const gr = Math.hypot(x1 - x0, y1 - y0) / 2 + 2000;
  let gp = '';
  for (let gk = -Math.ceil(gr / 1000) * 1000; gk <= gr; gk += 1000) {
    gp += `M${pt([gk, -gr])}L${pt([gk, gr])}M${pt([-gr, gk])}L${pt([gr, gk])}`;
  }
  o.push(`<path d="${gp.replace(/,/g, ' ')}" stroke="${C.grid}" stroke-width="1" fill="none"/>`);
  // Going: NO-GO and SLOW-GO only, Vs72's marking.
  if (on.going) {
    const H = r.hatch;
    const paths: Record<string, string> = { 1: '', 2: '', 3: '', 4: '' };
    H.rows.forEach((row, ry) => {
      let c = 0;
      for (const tok of row.split(',')) {
        const [kk, nn] = tok.split(' ');
        const n = Number(nn);
        if (kk !== '0' && paths[kk] !== undefined) {
          const xa = H.x0 + c * H.cellM, xb = xa + n * H.cellM, ya = H.y0 - ry * H.cellM, yb = ya - H.cellM;
          paths[kk] += `M${pt([xa, ya])}L${pt([xb, ya])}L${pt([xb, yb])}L${pt([xa, yb])}z`;
        }
        c += n;
      }
    });
    for (const kk of ['4', '3', '2', '1']) {
      if (!paths[kk]) continue;
      const d = paths[kk].replace(/,/g, ' ');
      o.push(`<path d="${d}" fill="${kk === '1' || kk === '3' ? C.tintN : C.tint}"/><path d="${d}" fill="url(#${id}n${kk})"/>`);
    }
  }
  for (const wl of r.map.water) o.push(`<polyline points="${pts(wl.p)}" fill="none" stroke="${C.water}" stroke-width="${wl.river ? 1.8 : 1.1}" stroke-linejoin="round" opacity=".9"/>`);
  for (const rd of r.map.roads) if (!rd.msr) o.push(`<polyline points="${pts(rd.p)}" fill="none" stroke="${C.road}" stroke-width=".8" opacity=".55"/>`);
  if (on.msr) for (const rd of r.map.roads) if (rd.msr) o.push(`<polyline points="${pts(rd.p)}" fill="none" stroke="${C.bg}" stroke-width="4.6" stroke-linejoin="round"/><polyline points="${pts(rd.p)}" fill="none" stroke="${C.msr}" stroke-width="2.4" stroke-linejoin="round"/>`);
  for (const b of r.map.borders) o.push(`<polyline points="${pts(b.p)}" fill="none" stroke="${C.wb}" stroke-width="2" stroke-dasharray="9 3 2 3"/>`);
  // The AOR's outline: its bdys (the two long sides) marked with the echelon.
  o.push(`<polygon points="${pts(r.outline)}" fill="none" stroke="${C.bdy}" stroke-width="1.6" stroke-linejoin="round"/>`);
  // Lines of def.
  if (on.line)
    for (const l of r.lines) {
      const sw = l.role === 'FDLs' ? 3.2 : l.role === 'Depth' ? 2.2 : 1.6;
      const dash = l.role === 'FDLs' || l.role === 'Depth' ? '' : ' stroke-dasharray="6 4"';
      o.push(`<polyline points="${pts(l.cut)}" fill="none" stroke="${C.own}" stroke-width="${sw}"${dash}/>`);
    }
  // Approaches: the threat's, red, numbered by priority.
  if (on.apch)
    for (const a of r.apchs) {
      const P = a.path;
      if (P.length < 2) continue;
      o.push(`<polyline points="${pts(P)}" fill="none" stroke="${C.en}" stroke-width="10" stroke-opacity=".2" stroke-linejoin="round" stroke-linecap="round"/>`);
      o.push(`<polyline points="${pts(P)}" fill="none" stroke="${C.en}" stroke-width="${a.rank === 1 ? 2.6 : 1.8}" stroke-linejoin="round"/>`);
      const e = P[P.length - 1], fr = P[Math.max(0, P.length - 3)];
      const ex = X(e), ey = Y(e), fx = X(fr), fy = Y(fr), Lx = Math.hypot(ex - fx, ey - fy) || 1, ux = (ex - fx) / Lx, uy = (ey - fy) / Lx;
      o.push(`<path d="M${ex.toFixed(1)} ${ey.toFixed(1)}L${(ex - ux * 11 - uy * 6).toFixed(1)} ${(ey - uy * 11 + ux * 6).toFixed(1)}L${(ex - ux * 11 + uy * 6).toFixed(1)} ${(ey - uy * 11 - ux * 6).toFixed(1)}z" fill="${C.en}"/>`);
    }
  if (on.dml)
    for (const d of r.dml) {
      const x = X(d.at), y = Y(d.at);
      o.push(`<rect x="${(x - 7).toFixed(1)}" y="${(y - 7).toFixed(1)}" width="14" height="14" rx="2" fill="${C.bg}" stroke="${C.en}" stroke-width="1.6"/><text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" font-size="10.5" font-weight="800" font-family="${FONT}" fill="${C.en}">D</text>`);
    }
  const label = (x: number, y: number, t: string, opt: { size?: number; w?: number; a?: string; c?: string } = {}) =>
    o.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${FONT}" font-size="${opt.size ?? 10.5}" font-weight="${opt.w ?? 650}" text-anchor="${opt.a ?? 'start'}" fill="${opt.c ?? C.txt}" stroke="${C.halo}" stroke-width="3" paint-order="stroke" stroke-linejoin="round">${esc(t)}</text>`);
  const placeAt = (n: string) => r.map.places.find((p) => p.name === n)?.at ?? null;
  if (on.itg) {
    for (const l of r.lines) {
      if (l.role !== 'FDLs' && l.role !== 'Depth') continue;
      for (const n of l.buas) {
        const at = n ? placeAt(n) : null;
        if (!at) continue;
        const x = X(at), y = Y(at);
        o.push(`<path d="M${x.toFixed(1)} ${(y - 5.5).toFixed(1)}L${(x + 5.5).toFixed(1)} ${y.toFixed(1)}L${x.toFixed(1)} ${(y + 5.5).toFixed(1)}L${(x - 5.5).toFixed(1)} ${y.toFixed(1)}z" fill="${C.itg}" stroke="${C.halo}" stroke-width="1"/>`);
      }
    }
    const mx = X([0, 0]), my = Y([0, 0]);
    let st = '';
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? 4.2 : 10, an = -Math.PI / 2 + (i * Math.PI) / 5;
      st += `${i ? 'L' : 'M'}${(mx + rr * Math.cos(an)).toFixed(1)} ${(my + rr * Math.sin(an)).toFixed(1)}`;
    }
    o.push(`<path d="${st}z" fill="${C.itg}" stroke="${C.halo}" stroke-width="1.4"/>`);
  }
  // Labels.
  if (on.apch)
    for (const a of r.apchs) {
      const s0 = a.path[0];
      const x = X(s0), y = Y(s0) + 14;
      o.push(`<circle cx="${x.toFixed(1)}" cy="${(y - 12).toFixed(1)}" r="8" fill="${C.en}"/><text x="${x.toFixed(1)}" y="${(y - 8.4).toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-size="10.5" font-weight="800" fill="#fff">${a.rank}</text>`);
      label(x + 11, y - 8, a.side + (labels === 'full' ? ` · ${km(a.pastM)} km` : ''), { c: C.en });
      if (labels === 'full' && a.from) label(x + 13, y + 6, a.from, { w: 500, size: 10 });
    }
  if (on.line)
    for (const l of r.lines) {
      for (const p of l.cut) {
        const x = X(p), y = Y(p);
        o.push(`<rect x="${(x - 8).toFixed(1)}" y="${(y - 8).toFixed(1)}" width="16" height="16" rx="3" fill="${C.own}"/><text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="800" fill="#fff">${l.id}</text>`);
      }
      if (labels === 'full' && l.role) {
        const a = l.cut[0], b = l.cut[1];
        const left = X(a) < X(b) ? a : b;
        label(X(left) + 12, Y(left) - 7, l.role, { c: C.own });
      }
    }
  if (on.itg) label(X([0, 0]) - 12, Y([0, 0]) + 18, `${r.mitg.name} · MITG`, { c: C.itg });
  if (labels === 'full') {
    const named = new Set<string>();
    for (const a of r.apchs) for (const t of a.through.slice().sort((p, q) => q.people - p.people).slice(0, 1)) named.add(t.name);
    for (const n of named) {
      const at = placeAt(n);
      if (at) label(X(at) + 5, Y(at) - 4, n, { w: 500, size: 10 });
    }
  }
  for (const b of r.map.borders) {
    const p = b.p.find((q) => X(q) > 20 && X(q) < 140 && Y(q) > 12 && Y(q) < h - 12);
    if (p) {
      label(X(p), Y(p) - 7, b.name, { c: C.wb, w: 800 });
      break;
    }
  }
  o.push('</g>');
  const nx = w - 22, ny = 26, nd = (-th * 180) / Math.PI;
  o.push(`<g transform="rotate(${nd.toFixed(1)} ${nx} ${ny})"><path d="M${nx} ${ny - 14}L${nx + 6} ${ny + 4}L${nx} ${ny}L${nx - 6} ${ny + 4}z" fill="${C.txt}"/><text x="${nx}" y="${ny + 17}" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="800" fill="${C.txt}">N</text></g>`);
  const sbM = (x1 - x0) > 14000 ? 5000 : 2000;
  const sb = sbM * s, sx = 12, sy = h - 14;
  o.push(`<path d="M${sx} ${sy}h${sb.toFixed(1)}M${sx} ${sy - 4}v8M${(sx + sb).toFixed(1)} ${sy - 4}v8" stroke="${C.txt}" stroke-width="1.6"/>`);
  label(sx + sb + 6, sy + 4, `${sbM / 1000} km`, { size: 10 });
  o.push('</svg>');
  return o.join('');
}

// ── the rail ────────────────────────────────────────────────────────────────────────────────────────────────────────

const STYLE_ID = 'ms-ground-guide-scope-aor-style';
const CSS = `
.ms-ggsc-aor-seg{display:inline-flex;border:1px solid #545e6b;border-radius:5px;overflow:hidden;flex:none}
.ms-ggsc-aor-seg button{border:0;border-left:1px solid #545e6b;background:#2b313a;color:${TEXT.label};font:${FW.bold} 11.5px/1 ${FONT}!important;padding:0 6px;height:20px;min-width:20px;cursor:pointer}
.ms-ggsc-aor-seg button:first-child{border-left:0}
.ms-ggsc-aor-seg button[aria-pressed="true"]{background:${ACCENT};color:#0d1620}
.ms-ggsc-aor-seg button:hover{filter:brightness(1.15)}
.ms-ggsc-aor-src{display:flex;align-items:center;gap:6px}
.ms-ggsc-aor-src .ms-ggsc-aor-draw{border:1px solid #545e6b;border-radius:5px;background:#2b313a;color:${TEXT.main};font:${FW.semi} 11.5px/1 ${FONT}!important;height:20px;padding:0 7px;cursor:pointer}
.ms-ggsc-aor-note{color:${TEXT.warn};min-width:0;overflow:hidden;text-overflow:ellipsis}
.ms-ggsc-aor-thr{margin-left:auto;flex:none;color:#ffd23f}
.ms-ggsc-aor-sub{margin-top:2px;font-size:12.5px;color:${TEXT.warn};font-weight:${FW.semi}}
.ms-ggsc-aor-map{flex:none;line-height:0;border-top:1px solid ${LINE.hair};border-bottom:1px solid ${LINE.hair};position:relative}
.ms-ggsc-aor-wait{display:grid;place-items:center;color:${TEXT.label};font-size:${FS.body}px;line-height:1.4;text-align:center;padding:0 30px}
.ms-ggsc-aor-row{display:grid;grid-template-columns:24px minmax(0,1fr);gap:8px;align-items:start;width:100%;padding:4px 12px 3px;border:0;border-bottom:1px solid rgba(255,255,255,.07);background:none;text-align:left;cursor:pointer}
.ms-ggsc-aor-row:hover{background:rgba(255,255,255,.04)}
.ms-ggsc-aor-row:last-child{border-bottom:0}
.ms-ggsc-aor-row[aria-checked="false"] .ms-ggsc-aor-c,.ms-ggsc-aor-row[aria-checked="false"] .ms-ggsc-aor-i{opacity:.4}
.ms-ggsc-aor-i{width:24px;height:24px;margin-top:1px;border-radius:5px;display:grid;place-items:center;border:1.5px solid #aab3bd}
.ms-ggsc-aor-c{min-width:0;font-size:12.5px;line-height:1.36;color:#e1e6eb}
.ms-ggsc-aor-c b{font-weight:${FW.bold};color:${TEXT.strong};margin-right:6px}
.ms-ggsc-aor-c span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms-ggsc-aor-c span+span{color:#b9c2cc}
.ms-ggsc-aor-t{width:100%;border-collapse:collapse;font-size:12px}
.ms-ggsc-aor-t th,.ms-ggsc-aor-t td{padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.08);text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px}
.ms-ggsc-aor-t th{color:#9aa4ae;font-weight:${FW.semi}}
.ms-ggsc-aor-t td.r{font-weight:${FW.bold};color:${TEXT.strong}}
.ms-ggsc-aor-ded{padding:6px 12px 0;font-size:12.5px;line-height:1.4;color:#e1e6eb}
.ms-ggsc-aor-ded div{display:grid;grid-template-columns:92px minmax(0,1fr);gap:6px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.07)}
.ms-ggsc-aor-ded div:last-child{border-bottom:0}
.ms-ggsc-aor-ded b{color:#9aa4ae;font-weight:${FW.semi}}
.ms-ggsc-aor-foot{flex:none;display:flex;align-items:center;gap:6px;height:34px;padding:0 10px;border-top:1px solid ${LINE.hair};font-size:${FS.meta}px;color:${TEXT.label};white-space:nowrap}
.ms-ggsc-aor-foot .ms-ggsc-aor-conf{margin-left:auto;border:0;background:none;color:${TEXT.warn};font:${FW.semi} ${FS.meta}px/1 ${FONT}!important;cursor:pointer;padding:0}
.ms-ggsc-aor-foot .ms-ggsc-aor-conf:hover{text-decoration:underline}
`;

export function ensureAorCss(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function btn(text: string, act: string, title: string, cls?: string, pressed?: boolean): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  b.dataset.aorAct = act;
  b.title = title;
  b.setAttribute('aria-label', title);
  if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
  return b;
}
function seg(opts: Array<[string, string, string, boolean]>): HTMLElement {
  const s = el('span', 'ms-ggsc-aor-seg');
  for (const [text, act, title, on] of opts) s.append(btn(text, act, title, undefined, on));
  return s;
}

const SRC_LABEL: Record<AorSource, string> = { boundaries: 'Bdys', box: 'Box', echelon: 'Ech' };

function iconFor(k: AorLayer, f: AorFrame): string {
  const C = STY[f.style];
  let s = '';
  if (k === 'going')
    s = `<defs><pattern id="ggaic1" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V4M0 0H4" stroke="${C.nat}" stroke-width="1.2"/></pattern><pattern id="ggaic2" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V4" stroke="${C.art}" stroke-width="1"/></pattern></defs><rect x="1" y="1" width="9" height="18" fill="url(#ggaic1)"/><rect x="10" y="1" width="9" height="18" fill="url(#ggaic2)"/>`;
  if (k === 'apch') s = `<path d="M3 16L14 5" stroke="${C.en}" stroke-width="2.4"/><path d="M17 2L9 4.5L15.5 11z" fill="${C.en}"/>`;
  if (k === 'line') s = `<path d="M2 10H18" stroke="${C.own}" stroke-width="3"/>`;
  if (k === 'itg') s = `<path d="M10 2.5L12 8H17.5L13 11.3L14.7 17L10 13.6L5.3 17L7 11.3L2.5 8H8z" fill="${C.itg}"/>`;
  if (k === 'dml') s = `<rect x="3" y="3" width="14" height="14" rx="2" fill="none" stroke="${C.en}" stroke-width="1.8"/><text x="10" y="14" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="800" fill="${C.en}">D</text>`;
  if (k === 'msr') s = `<path d="M2 14C7 11 12 9 18 5" stroke="${C.msr}" stroke-width="3" fill="none"/>`;
  return `<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">${s}</svg>`;
}

function row(k: AorLayer, head: string, lines: [string, string], f: AorFrame): HTMLButtonElement {
  const b = el('button', 'ms-ggsc-aor-row');
  b.type = 'button';
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-checked', String(f.layers[k]));
  b.dataset.aorLayer = k;
  b.title = `Show or hide ${head} on the map`;
  const ic = el('span', 'ms-ggsc-aor-i');
  ic.style.background = STY[f.style].bg;
  ic.innerHTML = iconFor(k, f); // fixed markup
  const c = el('span', 'ms-ggsc-aor-c');
  const l1 = el('span');
  l1.append(el('b', undefined, head), lines[0]);
  c.append(l1);
  if (lines[1]) c.append(el('span', undefined, lines[1]));
  b.append(ic, c);
  return b;
}

/** The rail's parts in the AOR scale, top to bottom. Buttons carry `data-aor-act` / `data-aor-layer` for the rail's click handler. */
export function aorRailParts(f: AorFrame): HTMLElement[] {
  ensureAorCss();
  const r = f.reading;
  const w = r ? aorWords(r, f) : null;
  // Bar.
  const bar = el('div', 'ms-ggsc-bar');
  bar.style.background = SURFACE.head;
  bar.innerHTML = `<svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="#fff" stroke-width="1.8" aria-hidden="true"><path d="M2 4l5-2 6 2 5-2v14l-5 2-6-2-5 2z"/><path d="M7 2v14M13 4v14"/></svg>`;
  bar.append(el('span', 'ms-ggsc-ttl', r ? `AOR · Def ${r.mitg.name}` : 'AOR'));
  const sv = btn('⇧V', 'scale', 'Back to the Spot scale (Shift+V)', 'ms-ggsc-kv');
  const hv = el('button', 'ms-ggsc-kv', 'V');
  hv.type = 'button';
  hv.dataset.ggscAct = 'hide';
  hv.title = 'Hide the Gr Scope (V)';
  hv.setAttribute('aria-label', 'Hide the Gr Scope (V)');
  bar.append(sv, hv);
  // Mode: the mover and echelon; the AOR's source with its switch; the threat side.
  const mode = el('div', 'ms-ggsc-mode');
  const l1 = el('div');
  l1.append(el('b', undefined, `${f.profileLabel} · ${f.echelon} AOR${r ? ` · ${r.country}` : ''}`));
  const when = el('span', 'ms-ggsc-when', f.when);
  l1.append(when);
  const l2 = el('div', 'ms-ggsc-aor-src');
  l2.append('From');
  l2.append(seg((['boundaries', 'box', 'echelon'] as AorSource[]).map((s) => [SRC_LABEL[s], `src:${s}`, s === 'boundaries' ? 'AOR between the Boundary symbols either side of the MITG' : s === 'box' ? 'AOR in a box you drag on the map' : 'AOR of the echelon frontage and depth, facing the threat', f.source === s])));
  if (f.source === 'box') l2.append(btn('Draw', 'box', 'Drag a box on the map for the AOR', 'ms-ggsc-aor-draw'));
  if (f.note) {
    const n = el('span', 'ms-ggsc-aor-note', f.note);
    n.title = f.note;
    l2.append(n);
  }
  if (r) l2.append(el('span', 'ms-ggsc-aor-thr', `Threat ${compass(r.faceDeg)}`));
  mode.append(l1, l2);
  // The map (or what it waits for).
  const mapPx = f.layout === 'model' ? 520 : f.layout === 'appreciation' ? 300 : 397;
  const map = el('div', 'ms-ggsc-aor-map');
  map.style.height = `${mapPx}px`;
  if (r && r.apchs.length + r.lines.length > 0) map.innerHTML = aorMapSvg(r, f, 397, mapPx, f.layout === 'model' ? 'full' : 'min'); // fixed markup; names through esc()
  else {
    map.classList.add('ms-ggsc-aor-wait');
    map.style.background = STY[f.style].bg;
    map.style.color = STY[f.style].txt;
    map.textContent = f.loading || !r ? 'Reading the AOR: tiles, approaches, lines of def…' : 'No approach found: the going blocks every way from the threat side, or the AOR is too small.';
  }
  // The answer.
  const ans = el('div', 'ms-ggsc-ans');
  ans.append(el('div', 'ms-ggsc-lead', w ? w.lead : f.loading ? 'Reading the AOR' : 'No AOR reading'));
  if (w?.sub && f.layout !== 'appreciation') ans.append(el('div', 'ms-ggsc-aor-sub', w.sub));
  // The lines under the map, or the tables.
  const leg = el('div', 'ms-ggsc-leg');
  if (w && r) {
    if (f.layout === 'deductions') {
      leg.append(
        row('going', 'Going', w.rows.going, f),
        row('apch', 'Apchs', w.rows.apch, f),
        row('line', 'Lines', w.rows.line, f),
        row('itg', 'MITG', w.rows.itg, f),
        row('dml', 'Dml', w.rows.dml, f),
        row('msr', 'MSR', w.rows.msr, f),
      );
    } else if (f.layout === 'model') {
      leg.append(row('apch', 'Pri of Apchs', w.rows.apch, f), row('line', 'DP 1', [w.dp || '—', w.sub], f), row('itg', 'MITG', w.rows.itg, f));
    } else {
      const t = el('table', 'ms-ggsc-aor-t');
      const hr = el('tr');
      for (const hd of ['Apch', 'Past', 'Cap', 'BUAs', 'Water', 'Lat']) hr.append(el('th', undefined, hd));
      t.append(hr);
      for (const a of w.ranked) {
        const tr = el('tr');
        const latN = r.laterals.filter((l) => l.a === a.side || l.b === a.side).reduce((s, l) => s + l.n, 0);
        tr.append(el('td', 'r', `${a.rank} ${a.side}`), el('td', undefined, `${km(a.pastM)} km`), el('td', undefined, aorCapacity(a, r.corridorM).short), el('td', undefined, String(a.through.length)), el('td', undefined, a.obstacles.map((o) => o.name).join(', ') || '—'), el('td', undefined, String(latN)));
        t.append(tr);
      }
      const box = el('div');
      box.style.padding = '4px 6px 0';
      box.append(t);
      const ded = el('div', 'ms-ggsc-aor-ded');
      const comb = r.laterals[0];
      const pri = ['FDLs', 'Depth', 'Screen'].map((role) => r.lines.find((l) => l.role === role)).filter(Boolean) as AorDefLine[];
      for (const [h, v] of [
        ['Pri of Apchs', w.ranked.map((a) => a.side).join(' › ') || '—'],
        ['Pri of Comb', comb ? `${comb.a} and ${comb.b} (${comb.n} laterals)` : '—'],
        ['Lines of Def', `${r.lines.map((l) => l.id).join(' ')}${pri.length ? ` · pri ${pri.map((l) => l.id).join(', ')}` : ''}`],
        ['DP 1', w.dp || '—'],
        ['Frontage', w.sub.replace(/^Frontage /, '') || '—'],
      ] as Array<[string, string]>) {
        const d = el('div');
        d.append(el('b', undefined, h), el('span', undefined, v));
        ded.append(d);
      }
      leg.append(box, ded);
    }
  }
  // Foot: the view switches, and what to confirm on the ground (opens the sheets).
  const foot = el('div', 'ms-ggsc-aor-foot');
  foot.append(
    seg([
      ['A', 'layout:deductions', 'Layout A: deductions under the map', f.layout === 'deductions'],
      ['B', 'layout:model', 'Layout B: sand model', f.layout === 'model'],
      ['C', 'layout:appreciation', 'Layout C: appreciation tables', f.layout === 'appreciation'],
    ]),
    seg([
      ['Trace', 'style:trace', 'Trace colours (Vs72 marking)', f.style === 'trace'],
      ['Dark', 'style:dark', 'Dark colours (as the Spot rail)', f.style === 'dark'],
    ]),
    seg([
      ['N↑', 'orient:north', 'North up (turns with the view)', f.orient === 'north'],
      ['T↑', 'orient:threat', 'Threat up (the side the approaches come from at the top)', f.orient === 'threat'],
    ]),
  );
  if (w) foot.append(btn(`${f.keys.detail ? 'D · ' : ''}Confirm ${w.confirm.length}`, 'sheet', 'Open the approach sheets and what to confirm on the ground (D)', 'ms-ggsc-aor-conf'));
  return f.layout === 'model' ? [bar, mode, map, ans, leg, foot] : f.layout === 'appreciation' ? [bar, mode, map, leg, foot] : [bar, mode, ans, map, leg, foot];
}

export type { AorSide };
