/**
 * MovementGuideText.ts
 *
 * The Movement Guide's words: each card's brief for Copy as Text (`cardLines`) and the small formatters the window
 * uses. Pure (no DOM): a host builds the same brief headless with `movementGuide.reportText(card)`.
 */

import { compass8, bearingOf, groundDist, HAZARD_LABEL, mercToLngLat, type HazardKind, type MercXY, type NearFeature, type RouteReading, type Stretch } from './MovementGuideScan';
import type { CardId, CardResult, CardDef } from './MovementGuide';
import type { PatrolCard } from '../PlatoonGuide/PlatoonGuideRead';
import { SRC_WORD, type Fig, type WaterReading } from './MovementGuideWater';

export const km = (m: number): string => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
export const kmAt = (m: number): string => `${(m / 1000).toFixed(2)} km`;
/** "1.20-1.45 km": a stretch, chainage from the start. */
export const kmRange = (a: number, b: number): string => `${(a / 1000).toFixed(2)}-${(b / 1000).toFixed(2)} km`;
export const num = (n: number): string => Math.round(n).toLocaleString('en');
export const pos = (x: number, y: number): string => {
  const [lng, lat] = mercToLngLat(x, y);
  return `${lat.toFixed(5)} N ${lng.toFixed(5)} E`;
};
export const hhmm = (min: number): string => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}`;
};
export const dur = (min: number): string => (min < 60 ? `${Math.round(min)} min` : `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')} min`);
export const riskWord = (r: RouteReading['risk']): string => (r === 'high' ? 'HIGH' : r === 'medium' ? 'MEDIUM' : 'LOW');
/** What a picket stands on. */
export const SOURCE_WORD: Record<'high' | 'feature' | 'post' | 'rooftop', string> = {
  high: 'high Gr',
  feature: 'named height',
  post: 'post / tower on flat Gr',
  rooftop: 'rooftop',
};

const ORDER: HazardKind[] = ['ambush', 'block', 'mine', 'vp', 'noExit', 'exposed', 'overlooked', 'rooftops', 'border', 'bua', 'sensitive', 'natural', 'slow'];
export function countWords(r: RouteReading): string {
  const parts: string[] = [];
  for (const k of ORDER) {
    const n = r.counts[k];
    if (n) parts.push(`${n} ${HAZARD_LABEL[k]}`);
  }
  return parts.join(', ') || 'No dangers found on the ground read';
}
export function nearWords(from: MercXY, f: { x: number; y: number; label: string; name: string | null } | null): string {
  if (!f) return 'none within reach';
  const d = groundDist(from, [f.x, f.y]);
  return `${f.label}${f.name ? ` (${f.name})` : ''} ${km(d)} ${compass8(bearingOf(from, [f.x, f.y]))}`;
}
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padL = (s: string | number, n: number) => String(s).padStart(n);

export interface CardCtx {
  def: CardDef;
  params: Record<string, any>;
  dataLine: string;
  threatSet: boolean;
  pending: boolean;
  routeName: string | null;
  inputName: string | null;
}

function routeHead(L: string[], r: RouteReading, ctx: CardCtx): void {
  L.push(`Route ${km(r.lengthM)} (${ctx.routeName ?? 'drawn'}) · Risk ${riskWord(r.risk)} · ${countWords(r)}`);
  L.push(`BUA ${km(r.buaM)}${r.peopleNear !== null ? ` · People within 500 m ≈ ${num(r.peopleNear)} (WorldPop est.)` : ''}${r.placesPassed.length ? ` · Places: ${r.placesPassed.slice(0, 6).map((p) => p.name ?? p.kind).join(', ')}` : ''}`);
}
function stretchLine(s: Stretch): string {
  return `${kmRange(s.fromM, s.toM)}  ${pad(s.label, 24)} ${padL(s.score, 3)}  ${s.why} · ${pos(s.x, s.y)}`;
}

export function cardLines(_card: CardId, res: CardResult, ctx: CardCtx): string[] {
  const L: string[] = [];
  L.push(`${ctx.def.title.toUpperCase()}`);
  if (ctx.def.rule) L.push(`Rule: ${ctx.def.rule}`);
  L.push(`Data: ${ctx.dataLine || 'terrain bundle'}. Estimates from the map, not a recce: check on the ground.${ctx.pending ? ' (Some terrain was still loading.)' : ''}`);
  L.push('');
  switch (res.card) {
    case 'cordon': {
      const c = res.reading;
      const y = res.layout;
      L.push(`Cordon ${c.derived === 'drawn' ? 'as drawn' : c.derived === 'bua' ? 'round the built-up area, off the houses' : 'as a 300 m circle (no built-up area found: draw the area)'}`);
      L.push(`Perimeter ${km(c.perimeterM)} · Area ${c.areaKm2.toFixed(2)} km² · ${c.urban ? 'Built-up' : 'Rural'} (${c.buaSharePct} % of the edge built-up)`);
      L.push(`TROOPS: ${num(c.totalMen)} men = inner ${num(c.inner.men)} + outer ${num(c.outerCordon.men)} (search parties not included)`);
      if (c.urban) {
        L.push(`  Inner cordon facing inward: ${num(c.inner.perimeterMen)} (${ctx.params.menPer100m} per 100 m) + ${num(c.inner.rooftopMen)} rooftops (${km(c.rooftopM)} of buildings) + ${num(c.inner.sideRoadMen)} for ${c.sideRoads.length} side roads`);
        L.push(`  ${y.sectors.length} platoon sectors of ${Math.round(y.sectorM)} m (Pl of ${ctx.params.plMen}) in ${y.companies} companies:`);
        for (const s of y.sectors) L.push(`    ${pad(s.label, 12)} ${padL(Math.round(s.fromM), 6)}-${pad(Math.round(s.toM) + ' m', 8)} ${padL(s.men, 3)} men${s.rooftop ? ' + rooftop Sec' : ''}  post ${pos(s.x, s.y)} facing ${compass8(s.facingDeg)}`);
      } else {
        L.push(`  Rural: a section on each escape route only: ${c.inner.sections} sections, ${num(c.inner.men)} men`);
        for (const q of y.posts.filter((p) => p.kind === 'escape')) L.push(`    ${q.label} · ${pos(q.x, q.y)}`);
      }
      const side = y.posts.filter((p) => p.kind === 'sideRoad');
      if (side.length) L.push(`  Side roads (${side.length}): ${side.map((q) => `${q.label} ${pos(q.x, q.y)}`).join('; ')}`);
      const rb = y.posts.filter((p) => p.kind === 'roadBlock');
      L.push(`  Outer cordon ${ctx.params.outerRingM} m out: ${rb.length} road blocks, ${num(c.outerCordon.men)} men`);
      for (const q of rb) L.push(`    ${q.label} · ${pos(q.x, q.y)}`);
      if (c.people !== null) {
        const a = res.ages;
        L.push(`PEOPLE INSIDE ≈ ${num(c.people)} (WorldPop est.)${a ? `: men 15-49 ≈ ${num(a.males15_49)}, children under 15 ≈ ${num(a.under15)}, over 65 ≈ ${num(a.over65)}` : ''}`);
      }
      if (c.sensitive.length) {
        const by = new Map<string, number>();
        for (const s of c.sensitive) by.set(s.label, (by.get(s.label) ?? 0) + 1);
        L.push(`SENSITIVE SITES inside or within 200 m: ${[...by].map(([k, n]) => `${n} ${k}`).join(', ')}`);
      }
      if (c.hides.length) L.push(`POSSIBLE HIDES nearby: ${c.hides.map((h: NearFeature) => `${h.label}${h.name ? ` (${h.name})` : ''} ${km(h.distM)}`).join(', ')}`);
      L.push('CHECK: exits the map does not show (lanes, nullahs, rooftops joining), the stand-off from the outer houses, rooftop access.');
      break;
    }
    case 'picket': {
      const r = res.route;
      routeHead(L, r, ctx);
      const p = res.plan;
      L.push('');
      L.push(`${p.mode === 'bothSides' ? 'ROUTE PICKETING (both sides)' : 'PIQUETING (fewest posts)'}: ${p.pickets.length} pickets, ${num(p.men)} men (${ctx.params.menPer} each), Rd seen ${p.coveragePct} % within ${p.rangeM} m`);
      L.push(`  ${pad('No', 4)}${pad('Side', 5)}${pad('At', 9)}${pad('Off', 7)}${pad('Rise', 7)}${pad('On', 24)}${pad('Sees', 17)}${pad('Up by', 9)}Grid`);
      p.pickets.forEach((k, i) => {
        const t = res.timings[i];
        L.push(`  ${pad(`P${i + 1}`, 4)}${pad(k.side, 5)}${pad(kmAt(k.chainM), 9)}${pad(`${k.offsetM} m`, 7)}${pad(`${k.riseM} m`, 7)}${pad(k.name ? `${SOURCE_WORD[k.source]}, ${k.name}`.slice(0, 23) : SOURCE_WORD[k.source], 24)}${pad(kmRange(k.coversFromM, k.coversToM), 17)}${pad(`+${dur(t?.upByMin ?? 0)}`, 9)}${pos(k.x, k.y)}`);
      });
      L.push(`  "Up by" = time from the start: along the Rd at ${ctx.params.roadKmh} km/h, then the climb (Tobler). Pickets go up before the column reaches their stretch.`);
      if (p.gaps.length) L.push(`  GAPS no picket sees: ${p.gaps.map((g) => kmRange(g.fromM, g.toM)).join(', ')} (patrol them or add posts)`);
      L.push('');
      L.push(res.checkPosts.length ? 'CHECK POSTS (junctions / bridges that cannot be bypassed):' : 'CHECK POSTS: no junction on the route that cannot be bypassed.');
      res.checkPosts.forEach((c, i) => L.push(`  CP ${i + 1} at ${kmAt(c.chainM)}: ${c.why} (${c.men} men) · ${pos(c.x, c.y)}`));
      if (res.clear.length) {
        L.push('CLEAR FIRST (road opening):');
        res.clear.forEach((s, i) => L.push(`  ${i + 1}. ${stretchLine(s)}`));
      }
      for (const c of res.casevac) L.push(`CASEVAC from the ${c.where}: ${nearWords(c.c.at, c.c.hospital)}; landing site ${nearWords(c.c.at, c.c.hls)} (straight line)`);
      break;
    }
    case 'convoy': {
      const r = res.route;
      const p = res.plan;
      routeHead(L, r, ctx);
      L.push('');
      L.push(`CONVOY: ${ctx.params.vehicles} vehicles in ${p.packets.length} packets of up to ${ctx.params.packetSize}, ${ctx.params.gapMin} min apart, ${ctx.params.vehGapM} m between vehicles, by ${ctx.params.light}`);
      L.push(`  Run ${dur(p.runMin)} for ${km(p.lengthM)}${p.halts ? ` with ${p.halts} halt${p.halts > 1 ? 's' : ''}` : ''}; first packet at SP ${hhmm(p.packets[0].spMin)}, last clears RP ${hhmm(p.packets[p.packets.length - 1].rpMin)} (${dur(p.totalMin)})`);
      L.push(`  ${pad('Packet', 8)}${pad('Veh', 5)}${pad('SP', 7)}RP`);
      for (const k of p.packets) L.push(`  ${pad(k.n, 8)}${pad(k.vehicles, 5)}${pad(hhmm(k.spMin), 7)}${hhmm(k.rpMin)}`);
      L.push('');
      L.push(`BOUNDS (about ${ctx.params.boundKm} km; each ends at a safe halt):`);
      for (const b of p.bounds) {
        L.push(`  B${b.n} ${kmRange(b.fromM, b.toM)} (${km(b.toM - b.fromM)}): first packet in ${hhmm(b.firstInMin)}, last out ${hhmm(b.lastOutMin)}. Ends: ${b.haltWhy} · ${pos(b.x, b.y)}`);
        if (b.clear.length) for (const s of b.clear.slice(0, 6)) L.push(`     clear: ${stretchLine(s)}`);
        else L.push('     nothing scored 50 or more to clear');
      }
      L.push('The road opening party clears and pickets each bound before the first packet enters it.');
      break;
    }
    case 'mines': {
      routeHead(L, res.route, ctx);
      L.push('');
      L.push(`LIKELY MINE / IED SITES (score ${ctx.params.minScore} or more, worst first): ${res.sites.length}`);
      for (const m of res.sites) L.push(`  ${padL(m.rank, 2)}. ${kmAt(m.chainM)}  ${padL(m.score, 3)}  ${m.why} · ${pos(m.x, m.y)}`);
      L.push('No record of past incidents is in the data: these are places where vehicles slow, turn or cross, read from the ground.');
      break;
    }
    case 'patrol': {
      const R = res.routes;
      const chart = (title: string, c: PatrolCard | null) => {
        if (!c) return;
        L.push(`${title}: ${km(c.lengthM)}, by night ${dur(c.minNight)} (by day ${dur(c.minDay)})${c.fmp ? `, FMP ${km(c.lengthM - c.fmp.chainM)} short of the end · ${pos(c.fmp.x, c.fmp.y)}` : ''}`);
        L.push(`  ${pad('Leg', 5)}${pad('Bearing', 9)}${pad('Dist', 8)}${pad('Paces', 7)}${pad('Night', 9)}${pad('Climb', 7)}Ends at`);
        for (const l of c.legs) {
          const f = l.endFeature;
          L.push(`  ${pad(l.i + 1, 5)}${pad(`${String(Math.round(l.bearingDeg)).padStart(3, '0')}°`, 9)}${pad(`${Math.round(l.distM)} m`, 8)}${pad(num(l.paces), 7)}${pad(dur(l.minNight), 9)}${pad(`${Math.round(l.climbM)} m`, 7)}${f ? `${f.label}${f.name ? ` (${f.name})` : ''}` : 'no landmark: count paces'} · ${pos(l.to[0], l.to[1])}`);
        }
        for (const s of c.exposed ?? []) L.push(`  exposed ${kmRange(s.fromM, s.toM)}: ${s.why}`);
        for (const s of c.skyline ?? []) L.push(`  skyline ${kmRange(s.fromM, s.toM)}: ${s.why}`);
        for (const o of c.obstacles ?? []) L.push(`  obstacle at ${kmAt(o.chainM)}: ${o.label}`);
        if (c.villages?.length) L.push(`  villages passed: ${c.villages.map((v: any) => `${v.name ?? 'village'} ${kmAt(v.chainM)}`).join(', ')}`);
      };
      L.push(`Avoiding: ${[ctx.params.avoidRoads && 'tracks / roads', ctx.params.avoidVillages && 'villages', ctx.params.avoidWoodEdges && 'wood edges', ctx.params.avoidSkylines && 'skylines', ctx.threatSet && 'the threat\'s view'].filter(Boolean).join(', ') || 'nothing'} (grid ${R.cellM} m)`);
      L.push(`The route out still meets: tracks / roads ${R.met.roads} %, villages ${R.met.villages} %, wood edges ${R.met.woodEdges} %, skylines ${R.met.skylines} %${ctx.threatSet ? `, ground the threat may see ${R.met.seen} %` : ''}`);
      if (!R.out) L.push('NO ROUTE: the objective cannot be reached on foot from the start (water, cliffs or marsh in between).');
      L.push('');
      chart('NIGHT MARCH CHART: ROUTE OUT', res.out);
      L.push('');
      chart('ROUTE IN (a different way)', res.back);
      if (res.back?.sameWayBack || res.out?.sameWayBack) L.push('WARNING: the route in runs along the route out.');
      L.push('Bearings are grid; add the declination for a magnetic bearing. 120 paces = 100 m.');
      break;
    }
    case 'ambush': {
      routeHead(L, res.route, ctx);
      L.push('');
      L.push(`AMBUSH SITES on this route (${res.sites.length}), worst for the target first:`);
      for (const s of res.sites) {
        L.push(`  ${s.rank}. ${kmAt(s.chainM)} score ${s.score} · ${s.layout.shape} layout, fire from the ${s.layout.side === 'L' ? 'left' : 'right'} · ${pos(s.x, s.y)}`);
        for (const p of s.parts) L.push(`       ${p.ok ? '+' : '-'} ${p.what}`);
      }
      const s = res.sites[res.chosen];
      if (s) {
        const y = s.layout;
        L.push('');
        L.push(`LAYOUT, site ${s.rank} (${y.shape}):`);
        L.push(`  Killing zone ${km(groundDist(y.kz[0], y.kz[1]))} along the Rd: ${pos(y.kz[0][0], y.kz[0][1])} to ${pos(y.kz[1][0], y.kz[1][1])}`);
        L.push(`  Fire group ${y.side === 'L' ? 'left' : 'right'} of the Rd: ${pos(y.fireLine[0][0], y.fireLine[0][1])} to ${pos(y.fireLine[1][0], y.fireLine[1][1])}`);
        y.stops.forEach((q, i) => L.push(`  Stop group ${i + 1}: ${pos(q[0], q[1])}`));
        if (y.arm) L.push(`  ${y.shape === 'L' ? 'Short arm across the exit' : 'Second arm'}: ${pos(y.arm[0][0], y.arm[0][1])} to ${pos(y.arm[1][0], y.arm[1][1])}`);
        L.push(`  Meeting point ${y.meetingM} m back (withdrawal ${y.withdrawalCoverPct} % in cover): ${pos(y.meeting[0], y.meeting[1])}`);
      }
      break;
    }
    case 'block': {
      routeHead(L, res.route, ctx);
      L.push('');
      L.push(`ROAD BLOCK / TANK AMBUSH SITES (${res.sites.length}):`);
      if (!res.sites.length) L.push('  None: no stretch is round a bend or over a crest with NO-GO on both sides.');
      for (const s of res.sites) {
        L.push(`  ${s.rank}. ${kmAt(s.chainM)} score ${s.score} · ${pos(s.x, s.y)}`);
        for (const p of s.parts) L.push(`       ${p.ok ? '+' : '-'} ${p.what}`);
        s.positions.forEach((q, i) => L.push(`       AT ${i + 1} ${q.side === 'L' ? 'left' : 'right'} ${q.offM} m off, ${q.riseM >= 0 ? `${q.riseM} m above` : `${-q.riseM} m below`}, sees ${q.seesPct} % of the approach from ${kmAt(s.approachFromM)} · ${pos(q.x, q.y)}`));
      }
      break;
    }
    case 'infil': {
      const r = res.reading;
      L.push(`Band ${km(ctx.params.bandM)} either side of the line; the enemy on the ${Number(ctx.params.enemySide) < 0 ? 'left' : 'right'} of it; posts see ${km(ctx.params.rangeM)} at night (grid ${r.cellM} m)`);
      L.push(`Existing posts in the data: ${r.existing.length} · they see ${r.seenPct} % of the band`);
      L.push('');
      L.push(`LIKELY LANES (${r.lanes.length}), through the ground the posts do not see:`);
      for (const l of r.lanes) L.push(`  Lane ${l.n}: crosses ${l.where}, ${km(l.lengthM)} across the band, ${l.seenPct} % of it seen now`);
      L.push('');
      const nw = r.posts.filter((p) => p.source === 'new');
      L.push(`ANTI-INFILTRATION POSTS: ${nw.length} new, the lanes then ${r.afterPct} % seen`);
      for (const p of nw) L.push(`  AIP ${p.n}${p.name ? ` (${p.name})` : ''}: sees ${p.coversPct} % of the lanes · ${pos(p.x, p.y)}`);
      L.push('Night sight from the posts is read from 30 m ground with crops and trees by the month: check it by night.');
      break;
    }
    case 'water': {
      if (res.axis) {
        L.push(`AXIS ${km(res.axis.lengthM)}: ${res.axis.obstacles.length} water obstacle${res.axis.obstacles.length === 1 ? '' : 's'} from the start (home side)`);
        res.axis.obstacles.forEach((o, i) => L.push(`  ${i + 1}. ${kmAt(o.chainM)}  ${o.reading.annex ? `Annex P ${o.reading.annex} ` : ''}${o.reading.typeLabel}${o.reading.name ? ` (${o.reading.name})` : ''} · ${figWords(o.reading.width)} wide · tanks ${GOING[o.reading.verdict.tanks.v]}`));
        L.push('');
        for (const o of res.axis.obstacles) waterLines(L, o.reading, ctx);
      } else if (res.reading) {
        waterLines(L, res.reading, ctx);
        if (res.reach) {
          const r = res.reach;
          L.push(`ALONG THE REACH ${km(r.lengthM)}, ${r.stations.length} stations (30 m ground):`);
          for (const s of r.stations) L.push(`  ${pad(s.n, 3)}${pad(km(s.alongM), 9)}width ${pad(s.widthM !== null ? `${s.widthM} m` : '?', 7)}home ${pad(s.homeM !== null ? `${s.homeM} m` : '?', 7)}far ${pad(s.farM !== null ? `${s.farM} m` : '?', 7)}${s.marsh ? 'marsh ' : ''}${s.crossing ?? ''}${s.n - 1 === r.narrowest ? '  << narrowest' : ''}${s.n - 1 === r.lowestFar ? '  << lowest far bank' : ''}`);
        }
      } else L.push('No water obstacle within 500 m of the point.');
      break;
    }
  }
  return L;
}

const GOING: Record<'go' | 'slow' | 'nogo', string> = { go: 'GO', slow: 'SLOW-GO', nogo: 'NO-GO' };
function figWords(f: Fig, unit = 'm'): string {
  if (f.src === 'none' || f.v === null) return '?';
  const r = (v: number) => (Math.abs(v) >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));
  return `${f.lo !== null && f.hi !== null && f.lo !== f.hi ? (f.lo <= 0 ? `up to ${r(f.hi)}` : `${r(f.lo)}-${r(f.hi)}`) : r(f.v)} ${unit}`;
}
function figLine(name: string, f: Fig, unit = 'm'): string {
  return `  ${pad(name, 24)}${pad(figWords(f, unit), 12)}${f.src === 'none' ? 'unknown: recce' : `${SRC_WORD[f.src]}${f.note ? `, ${f.note}` : ''}`}`;
}
function waterLines(L: string[], w: WaterReading, ctx: CardCtx): void {
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][w.season.month - 1];
  L.push(`${w.annex ? `IBB ANNEX P ${w.annex}: ` : ''}${w.typeLabel.toUpperCase()}${w.name ? ` (${w.name})` : ''} · ${pos(w.at[0], w.at[1])}`);
  L.push(`  Why: ${w.typeWhy.join('; ')} (${w.typeSrc})`);
  L.push(`  ${month}${w.season.wet ? ' (monsoon)' : ' (dry season)'}: ${w.season.text}`);
  for (const n of w.notes) L.push(`  · ${n}`);
  L.push(`  We ${w.purpose === 'cross' ? 'cross it: unknowns taken at the bigger end' : 'hold it: unknowns taken at the smaller end'}. Home bank ${w.home.dir} (${w.homeWhy}), far bank ${w.far.dir}.`);
  L.push(figLine('Width', w.width));
  L.push(figLine('Depth', w.depth));
  if (w.current.src !== 'none') L.push(figLine('Current', w.current, 'm/s'));
  if (w.bed) L.push(`  ${pad('Bed', 24)}${w.bed}`);
  L.push(figLine(`Home bank ${w.home.dir} above water`, w.home.aboveWater));
  L.push(figLine(`Home bank ${w.home.dir} above land`, w.home.aboveLand));
  L.push(figLine(`Far bank ${w.far.dir} above water`, w.far.aboveWater));
  L.push(figLine(`Far bank ${w.far.dir} above land`, w.far.aboveLand));
  if (w.sheetBanks) L.push(`  ${pad('Sheet banks', 24)}${[w.sheetBanks.a, w.sheetBanks.b].filter((v) => v !== null).map((v) => `${v} m`).join(' / ')} (side not recorded)`);
  if (w.home.marshM || w.far.marshM) L.push(`  ${pad('Marsh beside', 24)}home ${w.home.marshM} m, far ${w.far.marshM} m`);
  if (w.shape) L.push(`  ${pad('Water level', 24)}${w.shape === 'raised' ? 'above the land (in-filled)' : w.shape === 'sunk' ? 'below the land (in-cut)' : 'level with the land'} (Est. 30 m)`);
  L.push(`  GOING ACROSS (${w.purpose === 'cross' ? 'we cross' : 'the enemy crosses'}): tanks ${GOING[w.verdict.tanks.v]}: ${w.verdict.tanks.why}; wheels ${GOING[w.verdict.wheels.v]}: ${w.verdict.wheels.why}; foot ${GOING[w.verdict.foot.v]}: ${w.verdict.foot.why}`);
  L.push(`  CROSSINGS within ${ctx.params.crossingsKm} km (${w.crossings.length}):`);
  for (const q of w.crossings) L.push(`    ${pad(`${q.label}${q.name ? ` ${q.name}` : ''}`.slice(0, 30), 31)}${pad(q.load ?? '', 22)}${q.months ? `${q.months}${q.inUseNow === false ? ' (not this month)' : ''} ` : ''}${q.boats ? `${q.boats} ` : ''}${km(q.distM)} ${q.dir} · ${pos(q.x, q.y)}`);
  if (!w.crossings.length) L.push('    none recorded on this obstacle within reach');
  L.push('  CONFIRM ON THE GROUND:');
  for (const t of w.recce) L.push(`    - ${t}`);
  L.push('');
}
